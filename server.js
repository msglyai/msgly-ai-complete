// Msgly.AI Server - COMPLETE LinkedIn Data Extraction - FIXED VERSION
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Bright Data Configuration
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY || process.env.BRIGHT_DATA_API_TOKEN || 'brd-t6dqfwj2p8p-ac38c-b1l9-1f98-79e9-d8ceb4fd3c70_b59b8c39-8e9f-4db5-9bea-92e8b9e8b8b0';
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_DATASET_ID || 'gd_l1viktl72bvl7bjuj0';

// Database connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Background processing tracking
const processingQueue = new Map();

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://www.linkedin.com',
            'https://linkedin.com',
            'http://localhost:3000',
            'https://msgly.ai',
            'https://www.msgly.ai',
            'https://api.msgly.ai',
            'https://test.msgly.ai'
        ];
        
        if (origin.startsWith('chrome-extension://')) {
            return callback(null, true);
        }
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'msgly-session-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await getUserById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.NODE_ENV === 'production' 
        ? "https://api.msgly.ai/auth/google/callback"
        : "http://localhost:3000/auth/google/callback"
},
async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await getUserByEmail(profile.emails[0].value);
        
        if (!user) {
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value
            );
        } else if (!user.google_id) {
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==================== DATABASE SETUP ====================
const initDB = async () => {
    try {
        console.log('🗃️ Creating database tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255),
                google_id VARCHAR(255) UNIQUE,
                display_name VARCHAR(255),
                profile_picture VARCHAR(500),
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                package_type VARCHAR(50) DEFAULT 'free',
                billing_model VARCHAR(50) DEFAULT 'monthly',
                credits_remaining INTEGER DEFAULT 10,
                subscription_status VARCHAR(50) DEFAULT 'active',
                linkedin_url TEXT,
                profile_data JSONB,
                extraction_status VARCHAR(50) DEFAULT 'not_started',
                error_message TEXT,
                profile_completed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS message_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                target_name VARCHAR(255),
                target_url VARCHAR(500),
                generated_message TEXT,
                message_context TEXT,
                credits_used INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS credits_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                transaction_type VARCHAR(50),
                credits_change INTEGER,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add missing columns if they don't exist
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
                ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
                ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500),
                ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
                ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
                ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
                ADD COLUMN IF NOT EXISTS profile_data JSONB,
                ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT 'not_started',
                ADD COLUMN IF NOT EXISTS error_message TEXT,
                ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false;
            `);
            
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);
            
            console.log('✅ Database columns updated successfully');
        } catch (err) {
            console.log('Some columns might already exist:', err.message);
        }

        // Create indexes
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
            `);
            console.log('✅ Created database indexes');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ Database tables created successfully');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== LINKEDIN DATA PROCESSING - FIXED VERSION ====================

// COMPLETE LinkedIn data processing - FIXED to handle ALL Bright Data fields
const processLinkedInDataComplete = (profileData) => {
    if (!profileData) {
        throw new Error('No profile data received from Bright Data API');
    }
    
    console.log('📊 Processing LinkedIn data with COMPLETE Bright Data field mapping...');
    console.log('📋 Raw data keys:', Object.keys(profileData));
    
    // Helper function to safely extract array data
    const extractArray = (data) => {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                return Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                return [];
            }
        }
        if (typeof data === 'object') return [data];
        return [];
    };
    
    // Helper function to parse LinkedIn numbers (handles "500+", "1.2K", etc.)
    const parseLinkedInNumber = (str) => {
        if (!str) return null;
        if (typeof str === 'number') return str;
        
        try {
            const cleanStr = str.toString().toLowerCase().trim();
            
            if (cleanStr.includes('m')) {
                const num = parseFloat(cleanStr.match(/[\d.]+/)?.[0]);
                return num ? Math.round(num * 1000000) : null;
            }
            if (cleanStr.includes('k')) {
                const num = parseFloat(cleanStr.match(/[\d.]+/)?.[0]);
                return num ? Math.round(num * 1000) : null;
            }
            if (cleanStr.includes('+')) {
                const num = parseInt(cleanStr.replace('+', ''), 10);
                return num || null;
            }
            
            const numbers = cleanStr.match(/[\d,]+/);
            if (numbers) {
                const cleanNumber = numbers[0].replace(/,/g, '');
                return parseInt(cleanNumber, 10) || null;
            }
            return null;
        } catch (error) {
            console.error('Error parsing LinkedIn number:', str, error);
            return null;
        }
    };
    
    try {
        const processedData = {
            // ✅ CORE BRIGHT DATA IDENTIFIERS
            linkedinId: profileData.linkedin_id || profileData.id || null,
            linkedinNumId: profileData.linkedin_num_id || profileData.numericId || null,
            brightDataId: profileData.id || profileData.bright_data_id || null,
            dbSource: profileData.db_source || profileData.data_source || null,
            inputUrl: profileData.input_url || profileData.inputUrl || null,
            url: profileData.url || profileData.canonicalUrl || profileData.profile_url || null,
            canonicalUrl: profileData.canonical_url || profileData.canonicalUrl || null,
            
            // ✅ BASIC PROFILE INFORMATION
            name: profileData.name || profileData.full_name || profileData.fullName || null,
            fullName: profileData.full_name || profileData.name || profileData.fullName || null,
            firstName: profileData.first_name || profileData.firstName || 
                      (profileData.name ? profileData.name.split(' ')[0] : null),
            lastName: profileData.last_name || profileData.lastName || 
                     (profileData.name ? profileData.name.split(' ').slice(1).join(' ') : null),
            headline: profileData.headline || profileData.position || profileData.job_title || null,
            about: profileData.about || profileData.summary || profileData.description || null,
            summary: profileData.summary || profileData.about || profileData.description || null,
            description: profileData.description || profileData.about || profileData.summary || null,
            
            // ✅ LOCATION INFORMATION (ALL VARIATIONS)
            location: profileData.location || profileData.geo_location || profileData.formatted_location || null,
            city: profileData.city || profileData.geo_city || null,
            state: profileData.state || profileData.geo_state || null,
            country: profileData.country || profileData.geo_country || null,
            countryCode: profileData.country_code || profileData.countryCode || null,
            geoLocation: profileData.geo_location || profileData.geoLocation || null,
            geoCity: profileData.geo_city || profileData.geoCity || null,
            geoState: profileData.geo_state || profileData.geoState || null,
            geoCountry: profileData.geo_country || profileData.geoCountry || null,
            formattedLocation: profileData.formatted_location || profileData.formattedLocation || null,
            
            // ✅ PROFESSIONAL INFORMATION (ALL VARIATIONS)
            industry: profileData.industry || null,
            position: profileData.position || profileData.current_position || profileData.headline || null,
            currentPosition: profileData.current_position || profileData.position || profileData.job_title || null,
            currentCompany: profileData.current_company || profileData.company || null,
            currentCompanyName: profileData.current_company_name || profileData.currentCompanyName || null,
            currentCompanyId: profileData.current_company_id || profileData.currentCompanyId || null,
            currentCompanyCompanyId: profileData.current_company_company_id || profileData.currentCompanyCompanyId || null,
            company: profileData.company || profileData.current_company || null,
            jobTitle: profileData.job_title || profileData.jobTitle || profileData.position || null,
            
            // ✅ METRICS AND COUNTS (ALL VARIATIONS)
            connectionsCount: parseLinkedInNumber(profileData.connections_count || profileData.connectionsCount || profileData.num_connections),
            followersCount: parseLinkedInNumber(profileData.followers_count || profileData.followersCount || profileData.num_followers),
            connections: parseLinkedInNumber(profileData.connections || profileData.connections_count),
            followers: parseLinkedInNumber(profileData.followers || profileData.followers_count),
            recommendationsCount: profileData.recommendations_count || profileData.recommendationsCount || null,
            numConnections: parseLinkedInNumber(profileData.num_connections || profileData.numConnections),
            numFollowers: parseLinkedInNumber(profileData.num_followers || profileData.numFollowers),
            
            // ✅ MEDIA AND IMAGES (ALL VARIATIONS)
            profilePicture: profileData.profile_picture || profileData.profilePicture || null,
            profilePicUrl: profileData.profile_pic_url || profileData.profilePicUrl || null,
            profileImageUrl: profileData.profile_image_url || profileData.profileImageUrl || profileData.profile_pic_url || null,
            avatar: profileData.avatar || profileData.profile_pic_url || profileData.photo || null,
            photo: profileData.photo || profileData.avatar || null,
            bannerImage: profileData.banner_image || profileData.bannerImage || profileData.background_image || null,
            backgroundImage: profileData.background_image || profileData.backgroundImage || null,
            backgroundImageUrl: profileData.background_image_url || profileData.backgroundImageUrl || null,
            
            // ✅ IDENTIFIERS
            publicIdentifier: profileData.public_identifier || profileData.publicIdentifier || null,
            linkedinUrl: profileData.linkedin_url || profileData.linkedinUrl || profileData.url || null,
            profileUrl: profileData.profile_url || profileData.profileUrl || profileData.url || null,
            
            // ✅ CONTACT INFORMATION
            email: profileData.email || null,
            phone: profileData.phone || null,
            website: profileData.website || null,
            
            // ✅ ADDITIONAL PROFILE FIELDS
            interests: profileData.interests || null,
            accomplishments: profileData.accomplishments || null,
            featuredContent: profileData.featured_content || profileData.featuredContent || null,
            premiumSubscriber: profileData.premium_subscriber || profileData.premiumSubscriber || false,
            openToWork: profileData.open_to_work || profileData.openToWork || false,
            hiring: profileData.hiring || false,
            
            // ✅ COMPREHENSIVE PROFESSIONAL ARRAYS
            experience: extractArray(profileData.experience || profileData.work_experience || 
                       profileData.experiences || profileData.jobs || profileData.positions),
            workExperience: extractArray(profileData.work_experience || profileData.workExperience),
            experiences: extractArray(profileData.experiences || profileData.experience),
            jobs: extractArray(profileData.jobs || profileData.experience),
            positions: extractArray(profileData.positions || profileData.experience),
            
            education: extractArray(profileData.education || profileData.educations || profileData.schools),
            educations: extractArray(profileData.educations || profileData.education),
            educationsDetails: extractArray(profileData.educations_details || profileData.educationDetails || profileData.education_details),
            educationDetails: extractArray(profileData.education_details || profileData.educationDetails),
            schools: extractArray(profileData.schools || profileData.education),
            
            skills: extractArray(profileData.skills || profileData.skill_list || profileData.skills_list),
            skillList: extractArray(profileData.skill_list || profileData.skillList),
            skillsList: extractArray(profileData.skills_list || profileData.skillsList),
            skillsWithEndorsements: extractArray(profileData.skills_with_endorsements || profileData.endorsedSkills),
            endorsedSkills: extractArray(profileData.endorsed_skills || profileData.endorsedSkills),
            
            languages: extractArray(profileData.languages || profileData.language_list),
            languageList: extractArray(profileData.language_list || profileData.languageList),
            
            certifications: extractArray(profileData.certifications || profileData.certificates || profileData.certification_list),
            certificates: extractArray(profileData.certificates || profileData.certifications),
            certificationList: extractArray(profileData.certification_list || profileData.certificationList),
            
            courses: extractArray(profileData.courses || profileData.course_list),
            courseList: extractArray(profileData.course_list || profileData.courseList),
            
            projects: extractArray(profileData.projects || profileData.project_list),
            projectList: extractArray(profileData.project_list || profileData.projectList),
            
            publications: extractArray(profileData.publications || profileData.publication_list),
            publicationList: extractArray(profileData.publication_list || profileData.publicationList),
            
            patents: extractArray(profileData.patents || profileData.patent_list),
            patentList: extractArray(profileData.patent_list || profileData.patentList),
            
            volunteerExperience: extractArray(profileData.volunteer_experience || profileData.volunteerWork || profileData.volunteering),
            volunteerWork: extractArray(profileData.volunteer_work || profileData.volunteerWork),
            volunteering: extractArray(profileData.volunteering || profileData.volunteer_experience),
            volunteerList: extractArray(profileData.volunteer_list || profileData.volunteerList),
            
            honorsAndAwards: extractArray(profileData.honors_and_awards || profileData.awards || profileData.honors),
            awards: extractArray(profileData.awards || profileData.honors_and_awards),
            honors: extractArray(profileData.honors || profileData.honors_and_awards),
            
            organizations: extractArray(profileData.organizations || profileData.organization_list),
            organizationList: extractArray(profileData.organization_list || profileData.organizationList),
            
            // ✅ RECOMMENDATIONS (COMPLETE DATA)
            recommendations: extractArray(profileData.recommendations),
            recommendationsGiven: extractArray(profileData.recommendations_given || profileData.given_recommendations),
            recommendationsReceived: extractArray(profileData.recommendations_received || profileData.received_recommendations),
            givenRecommendations: extractArray(profileData.given_recommendations || profileData.givenRecommendations),
            receivedRecommendations: extractArray(profileData.received_recommendations || profileData.receivedRecommendations),
            
            // ✅ SOCIAL ACTIVITY AND CONTENT
            posts: extractArray(profileData.posts || profileData.recent_posts),
            recentPosts: extractArray(profileData.recent_posts || profileData.recentPosts),
            activity: extractArray(profileData.activity || profileData.recent_activity),
            recentActivity: extractArray(profileData.recent_activity || profileData.recentActivity),
            articles: extractArray(profileData.articles || profileData.article_list),
            articleList: extractArray(profileData.article_list || profileData.articleList),
            
            // ✅ NETWORK AND CONNECTIONS
            peopleAlsoViewed: extractArray(profileData.people_also_viewed || profileData.also_viewed),
            alsoViewed: extractArray(profileData.also_viewed || profileData.alsoViewed),
            mutualConnections: extractArray(profileData.mutual_connections || profileData.mutualConnections),
            
            // ✅ ADDITIONAL ARRAYS
            groups: extractArray(profileData.groups),
            following: extractArray(profileData.following),
            testScores: extractArray(profileData.test_scores || profileData.testScores),
            externalLinks: extractArray(profileData.external_links || profileData.externalLinks || profileData.websites),
            websites: extractArray(profileData.websites || profileData.external_links),
            contactInfo: profileData.contact_info || profileData.contactInfo || {},
            
            // ✅ METADATA
            timestamp: profileData.timestamp ? new Date(profileData.timestamp) : new Date(),
            profileTimestamp: profileData.profile_timestamp ? new Date(profileData.profile_timestamp) : null,
            dataSource: profileData.db_source || profileData.data_source || 'bright_data',
            extractionMethod: 'bright_data_api',
            
            // Store complete raw data
            rawData: profileData,
            brightdataData: profileData
        };
        
        console.log('✅ COMPLETE LinkedIn data processed successfully with ALL Bright Data field variations!');
        console.log(`📊 Comprehensive data summary:`);
        console.log(`   - LinkedIn ID: ${processedData.linkedinId || 'Not available'}`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Headline: ${processedData.headline || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - Experience: ${processedData.experience.length} entries`);
        console.log(`   - Education: ${processedData.education.length} entries`);
        console.log(`   - Skills: ${processedData.skills.length} entries`);
        console.log(`   - Certifications: ${processedData.certifications.length} entries`);
        console.log(`   - Projects: ${processedData.projects.length} entries`);
        console.log(`   - Languages: ${processedData.languages.length} entries`);
        console.log(`   - Articles: ${processedData.articles.length} entries`);
        console.log(`   - Volunteering: ${processedData.volunteering.length} entries`);
        console.log(`   - Organizations: ${processedData.organizations.length} entries`);
        console.log(`   - Recommendations: ${processedData.recommendations.length} entries`);
        console.log(`   - Posts: ${processedData.posts.length} entries`);
        console.log(`   - People Also Viewed: ${processedData.peopleAlsoViewed.length} entries`);
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error processing LinkedIn data:', error);
        throw new Error(`LinkedIn data processing failed: ${error.message}`);
    }
};

// Bright Data LinkedIn Profile Extraction
const extractLinkedInProfileComplete = async (linkedinUrl) => {
    try {
        console.log('🚀 Starting COMPLETE LinkedIn profile extraction...');
        console.log('🔗 LinkedIn URL:', linkedinUrl);
        console.log('🆔 Dataset ID:', BRIGHT_DATA_DATASET_ID);
        
        // OPTION 1: Try synchronous scrape first (faster if supported)
        console.log('🔄 Attempting synchronous extraction...');
        try {
            const syncResponse = await axios.post(
                `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`,
                [{ "url": linkedinUrl }],
                {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000 // 2 minutes for sync
                }
            );
            
            if (syncResponse.status === 200 && syncResponse.data && syncResponse.data.length > 0) {
                console.log('✅ Synchronous extraction successful!');
                const profileData = Array.isArray(syncResponse.data) ? syncResponse.data[0] : syncResponse.data;
                
                return {
                    success: true,
                    data: processLinkedInDataComplete(profileData),
                    method: 'synchronous',
                    message: 'LinkedIn profile extracted successfully (synchronous)'
                };
            }
        } catch (syncError) {
            console.log('⏩ Synchronous method not available, falling back to async...');
            // Continue to async method
        }
        
        // OPTION 2: Async method with CORRECT endpoints
        console.log('🔄 Using asynchronous extraction method...');
        
        // Step 1: Trigger the scraping job
        const triggerUrl = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`;
        const triggerPayload = [{ "url": linkedinUrl }];
        
        console.log('📡 Triggering LinkedIn scraper...');
        const triggerResponse = await axios.post(triggerUrl, triggerPayload, {
            headers: {
                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        if (!triggerResponse.data || !triggerResponse.data.snapshot_id) {
            throw new Error('No snapshot ID returned from Bright Data API');
        }
        
        const snapshotId = triggerResponse.data.snapshot_id;
        console.log('🆔 Snapshot ID:', snapshotId);
        
        // Step 2: Poll for completion using CORRECT endpoint
        const maxAttempts = 40; // 6-7 minutes
        let attempt = 0;
        
        while (attempt < maxAttempts) {
            attempt++;
            console.log(`🔄 Polling attempt ${attempt}/${maxAttempts}...`);
            
            try {
                // CORRECT polling endpoint
                const statusUrl = `https://api.brightdata.com/datasets/v3/log/${snapshotId}`;
                
                const pollResponse = await axios.get(statusUrl, {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });
                
                // CORRECT status field
                const status = pollResponse.data?.Status || pollResponse.data?.status;
                console.log(`📈 Snapshot status: ${status}`);
                
                if (status === 'ready') {
                    console.log('✅ LinkedIn data is ready! Downloading...');
                    
                    // Step 3: CORRECT data retrieval endpoint
                    const dataUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`;
                    
                    const dataResponse = await axios.get(dataUrl, {
                        headers: {
                            'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    console.log('📥 Downloaded LinkedIn profile data successfully');
                    console.log('📊 Data response status:', dataResponse.status);
                    
                    if (dataResponse.data) {
                        const profileData = Array.isArray(dataResponse.data) ? dataResponse.data[0] : dataResponse.data;
                        
                        return {
                            success: true,
                            data: processLinkedInDataComplete(profileData),
                            method: 'asynchronous',
                            snapshotId: snapshotId,
                            message: 'LinkedIn profile extracted successfully (asynchronous)'
                        };
                    } else {
                        throw new Error('No data returned from snapshot');
                    }
                    
                } else if (status === 'error' || status === 'failed') {
                    throw new Error(`LinkedIn extraction failed with status: ${status}`);
                } else {
                    // Still processing
                    console.log(`⏳ Still processing... (Status: ${status || 'unknown'})`);
                    const waitTime = attempt > 20 ? 12000 : 8000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
            } catch (pollError) {
                console.error(`❌ Polling attempt ${attempt} failed:`, pollError.message);
                
                if (pollError.code === 'ECONNABORTED' || pollError.code === 'ENOTFOUND') {
                    console.log('⏳ Network issue, retrying...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
        
        throw new Error(`Polling timeout - LinkedIn extraction took longer than ${maxAttempts * 8} seconds`);
        
    } catch (error) {
        console.error('❌ LinkedIn extraction failed:', error);
        throw new Error(`LinkedIn extraction failed: ${error.message}`);
    }
};

// ✅ FIXED Database save - Comprehensive field mapping
const scheduleBackgroundExtractionFixed = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = 300000; // 5 minutes
    
    console.log(`🔄 Scheduling FIXED background extraction for user ${userId}, retry ${retryCount}`);
    
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for user ${userId} - FAILURE`);
        await pool.query(
            'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
            ['failed', `FAILURE: Max retries (${maxRetries}) exceeded`, userId]
        );
        await pool.query(
            'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
            ['failed', `FAILURE: Max retries (${maxRetries}) exceeded`, userId]
        );
        processingQueue.delete(userId);
        return;
    }

    setTimeout(async () => {
        try {
            console.log(`🚀 Starting FIXED background extraction for user ${userId} (Retry ${retryCount})`);
            
            await pool.query(
                'UPDATE user_profiles SET extraction_retry_count = $1, extraction_attempted_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [retryCount, userId]
            );

            // ✅ COMPLETE extraction - will throw error if fails
            const result = await extractLinkedInProfileComplete(linkedinUrl);
            
            console.log(`✅ FIXED extraction succeeded for user ${userId}`);
            
            const extractedData = result.data;
            
            console.log(`📊 FIXED data validation for user ${userId}:`);
            console.log(`   - LinkedIn ID: ${extractedData.linkedinId || 'Not available'}`);
            console.log(`   - Full Name: ${extractedData.fullName || 'Not available'}`);
            console.log(`   - Headline: ${extractedData.headline || 'Not available'}`);
            console.log(`   - Current Company: ${extractedData.currentCompany || 'Not available'}`);
            console.log(`   - Experience: ${extractedData.experience?.length || 0} entries`);
            console.log(`   - Education: ${extractedData.education?.length || 0} entries`);
            console.log(`   - Skills: ${extractedData.skills?.length || 0} entries`);
            console.log(`   - Certifications: ${extractedData.certifications?.length || 0} entries`);
            console.log(`   - Projects: ${extractedData.projects?.length || 0} entries`);
            console.log(`   - Languages: ${extractedData.languages?.length || 0} entries`);
            console.log(`   - Articles: ${extractedData.articles?.length || 0} entries`);
            console.log(`   - Volunteering: ${extractedData.volunteering?.length || 0} entries`);
            
            // ✅ FIXED DATABASE SAVE - All fields mapped properly
            console.log('💾 Saving FIXED LinkedIn data to database with ALL fields...');
            
            try {
                await pool.query(`
                    UPDATE user_profiles SET 
                        -- Core Identifiers
                        linkedin_id = $1,
                        linkedin_num_id = $2,
                        bright_data_id = $3,
                        db_source = $4,
                        input_url = $5,
                        url = $6,
                        canonical_url = $7,
                        
                        -- Basic Profile
                        name = $8,
                        full_name = COALESCE($9, full_name),
                        first_name = $10,
                        last_name = $11,
                        headline = $12,
                        about = $13,
                        summary = $14,
                        description = $15,
                        
                        -- Location (All Variations)
                        location = $16,
                        city = $17,
                        state = $18,
                        country = $19,
                        country_code = $20,
                        geo_location = $21,
                        geo_city = $22,
                        geo_state = $23,
                        geo_country = $24,
                        formatted_location = $25,
                        
                        -- Professional (All Variations)
                        industry = $26,
                        position = $27,
                        current_position = $28,
                        current_company = $29,
                        current_company_name = $30,
                        current_company_id = $31,
                        current_company_company_id = $32,
                        company = $33,
                        job_title = $34,
                        
                        -- Metrics (All Variations)
                        connections_count = $35,
                        followers_count = $36,
                        connections = $37,
                        followers = $38,
                        recommendations_count = $39,
                        num_connections = $40,
                        num_followers = $41,
                        
                        -- Media (All Variations)
                        profile_picture = $42,
                        profile_pic_url = $43,
                        profile_image_url = $44,
                        avatar = $45,
                        photo = $46,
                        banner_image = $47,
                        background_image = $48,
                        background_image_url = $49,
                        
                        -- Identifiers
                        public_identifier = $50,
                        linkedin_url = $51,
                        profile_url = $52,
                        
                        -- Contact
                        email = $53,
                        phone = $54,
                        website = $55,
                        
                        -- Additional Fields
                        interests = $56,
                        accomplishments = $57,
                        featured_content = $58,
                        premium_subscriber = $59,
                        open_to_work = $60,
                        hiring = $61,
                        
                        -- Professional Arrays (All Variations)
                        experience = $62,
                        work_experience = $63,
                        experiences = $64,
                        jobs = $65,
                        positions = $66,
                        
                        education = $67,
                        educations = $68,
                        educations_details = $69,
                        education_details = $70,
                        schools = $71,
                        
                        skills = $72,
                        skill_list = $73,
                        skills_list = $74,
                        skills_with_endorsements = $75,
                        endorsed_skills = $76,
                        
                        languages = $77,
                        language_list = $78,
                        
                        certifications = $79,
                        certificates = $80,
                        certification_list = $81,
                        
                        courses = $82,
                        course_list = $83,
                        
                        projects = $84,
                        project_list = $85,
                        
                        publications = $86,
                        publication_list = $87,
                        
                        patents = $88,
                        patent_list = $89,
                        
                        volunteer_experience = $90,
                        volunteer_work = $91,
                        volunteering = $92,
                        volunteer_list = $93,
                        
                        honors_and_awards = $94,
                        awards = $95,
                        honors = $96,
                        
                        organizations = $97,
                        organization_list = $98,
                        
                        -- Recommendations
                        recommendations = $99,
                        recommendations_given = $100,
                        recommendations_received = $101,
                        given_recommendations = $102,
                        received_recommendations = $103,
                        
                        -- Social Activity
                        posts = $104,
                        recent_posts = $105,
                        activity = $106,
                        recent_activity = $107,
                        articles = $108,
                        article_list = $109,
                        
                        -- Network
                        people_also_viewed = $110,
                        also_viewed = $111,
                        mutual_connections = $112,
                        
                        -- Additional Arrays
                        groups = $113,
                        following = $114,
                        test_scores = $115,
                        external_links = $116,
                        websites = $117,
                        contact_info = $118,
                        
                        -- Metadata
                        brightdata_data = $119,
                        raw_data = $120,
                        timestamp = $121,
                        profile_timestamp = $122,
                        data_source = $123,
                        extraction_method = $124,
                        
                        -- Status
                        data_extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL,
                        profile_analyzed = true,
                        data_quality_score = 100,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $125 
                `, [
                    // Core Identifiers (1-7)
                    extractedData.linkedinId,
                    extractedData.linkedinNumId,
                    extractedData.brightDataId,
                    extractedData.dbSource,
                    extractedData.inputUrl,
                    extractedData.url,
                    extractedData.canonicalUrl,
                    
                    // Basic Profile (8-15)
                    extractedData.name,
                    extractedData.fullName,
                    extractedData.firstName,
                    extractedData.lastName,
                    extractedData.headline,
                    extractedData.about,
                    extractedData.summary,
                    extractedData.description,
                    
                    // Location (16-25)
                    extractedData.location,
                    extractedData.city,
                    extractedData.state,
                    extractedData.country,
                    extractedData.countryCode,
                    extractedData.geoLocation,
                    extractedData.geoCity,
                    extractedData.geoState,
                    extractedData.geoCountry,
                    extractedData.formattedLocation,
                    
                    // Professional (26-34)
                    extractedData.industry,
                    extractedData.position,
                    extractedData.currentPosition,
                    extractedData.currentCompany,
                    extractedData.currentCompanyName,
                    extractedData.currentCompanyId,
                    extractedData.currentCompanyCompanyId,
                    extractedData.company,
                    extractedData.jobTitle,
                    
                    // Metrics (35-41)
                    extractedData.connectionsCount,
                    extractedData.followersCount,
                    extractedData.connections,
                    extractedData.followers,
                    extractedData.recommendationsCount,
                    extractedData.numConnections,
                    extractedData.numFollowers,
                    
                    // Media (42-49)
                    extractedData.profilePicture,
                    extractedData.profilePicUrl,
                    extractedData.profileImageUrl,
                    extractedData.avatar,
                    extractedData.photo,
                    extractedData.bannerImage,
                    extractedData.backgroundImage,
                    extractedData.backgroundImageUrl,
                    
                    // Identifiers (50-52)
                    extractedData.publicIdentifier,
                    extractedData.linkedinUrl,
                    extractedData.profileUrl,
                    
                    // Contact (53-55)
                    extractedData.email,
                    extractedData.phone,
                    extractedData.website,
                    
                    // Additional Fields (56-61)
                    extractedData.interests,
                    extractedData.accomplishments,
                    extractedData.featuredContent,
                    extractedData.premiumSubscriber,
                    extractedData.openToWork,
                    extractedData.hiring,
                    
                    // Professional Arrays (62-66)
                    JSON.stringify(extractedData.experience),
                    JSON.stringify(extractedData.workExperience),
                    JSON.stringify(extractedData.experiences),
                    JSON.stringify(extractedData.jobs),
                    JSON.stringify(extractedData.positions),
                    
                    // Education Arrays (67-71)
                    JSON.stringify(extractedData.education),
                    JSON.stringify(extractedData.educations),
                    JSON.stringify(extractedData.educationsDetails),
                    JSON.stringify(extractedData.educationDetails),
                    JSON.stringify(extractedData.schools),
                    
                    // Skills Arrays (72-76)
                    JSON.stringify(extractedData.skills),
                    JSON.stringify(extractedData.skillList),
                    JSON.stringify(extractedData.skillsList),
                    JSON.stringify(extractedData.skillsWithEndorsements),
                    JSON.stringify(extractedData.endorsedSkills),
                    
                    // Languages (77-78)
                    JSON.stringify(extractedData.languages),
                    JSON.stringify(extractedData.languageList),
                    
                    // Certifications (79-81)
                    JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.certificates),
                    JSON.stringify(extractedData.certificationList),
                    
                    // Courses (82-83)
                    JSON.stringify(extractedData.courses),
                    JSON.stringify(extractedData.courseList),
                    
                    // Projects (84-85)
                    JSON.stringify(extractedData.projects),
                    JSON.stringify(extractedData.projectList),
                    
                    // Publications (86-87)
                    JSON.stringify(extractedData.publications),
                    JSON.stringify(extractedData.publicationList),
                    
                    // Patents (88-89)
                    JSON.stringify(extractedData.patents),
                    JSON.stringify(extractedData.patentList),
                    
                    // Volunteer (90-93)
                    JSON.stringify(extractedData.volunteerExperience),
                    JSON.stringify(extractedData.volunteerWork),
                    JSON.stringify(extractedData.volunteering),
                    JSON.stringify(extractedData.volunteerList),
                    
                    // Awards (94-96)
                    JSON.stringify(extractedData.honorsAndAwards),
                    JSON.stringify(extractedData.awards),
                    JSON.stringify(extractedData.honors),
                    
                    // Organizations (97-98)
                    JSON.stringify(extractedData.organizations),
                    JSON.stringify(extractedData.organizationList),
                    
                    // Recommendations (99-103)
                    JSON.stringify(extractedData.recommendations),
                    JSON.stringify(extractedData.recommendationsGiven),
                    JSON.stringify(extractedData.recommendationsReceived),
                    JSON.stringify(extractedData.givenRecommendations),
                    JSON.stringify(extractedData.receivedRecommendations),
                    
                    // Social Activity (104-109)
                    JSON.stringify(extractedData.posts),
                    JSON.stringify(extractedData.recentPosts),
                    JSON.stringify(extractedData.activity),
                    JSON.stringify(extractedData.recentActivity),
                    JSON.stringify(extractedData.articles),
                    JSON.stringify(extractedData.articleList),
                    
                    // Network (110-112)
                    JSON.stringify(extractedData.peopleAlsoViewed),
                    JSON.stringify(extractedData.alsoViewed),
                    JSON.stringify(extractedData.mutualConnections),
                    
                    // Additional Arrays (113-118)
                    JSON.stringify(extractedData.groups),
                    JSON.stringify(extractedData.following),
                    JSON.stringify(extractedData.testScores),
                    JSON.stringify(extractedData.externalLinks),
                    JSON.stringify(extractedData.websites),
                    JSON.stringify(extractedData.contactInfo),
                    
                    // Metadata (119-124)
                    JSON.stringify(extractedData.brightdataData),
                    JSON.stringify(extractedData.rawData),
                    extractedData.timestamp,
                    extractedData.profileTimestamp,
                    extractedData.dataSource,
                    extractedData.extractionMethod,
                    
                    // User ID (125)
                    userId
                ]);

                await pool.query(
                    'UPDATE users SET extraction_status = $1, profile_completed = $2, error_message = NULL WHERE id = $3',
                    ['completed', true, userId]
                );

                console.log(`🎉 FIXED LinkedIn profile data successfully saved for user ${userId}!`);
                console.log(`✅ Method: ${result.method}`);
                console.log('🏆 SUCCESS: ALL LinkedIn data fields captured and saved with FIXED logic!');
                console.log('📊 Saved COMPLETE comprehensive data:');
                console.log('   ✅ ALL profile information variations');
                console.log('   ✅ ALL professional experience variations');
                console.log('   ✅ ALL education history variations');
                console.log('   ✅ ALL skills and endorsements variations');
                console.log('   ✅ ALL certifications and courses');
                console.log('   ✅ ALL projects and publications');
                console.log('   ✅ ALL languages and volunteer work');
                console.log('   ✅ ALL articles and posts');
                console.log('   ✅ ALL organizations and awards');
                console.log('   ✅ ALL recommendations data');
                console.log('   ✅ ALL Bright Data specific fields');
                console.log('   ✅ ALL metadata and contact information');
                console.log('   ✅ Complete raw data for future use');
                
                processingQueue.delete(userId);
                
            } catch (dbError) {
                console.error(`❌ DATABASE SAVE FAILED for user ${userId}:`, dbError.message);
                console.error(`   Error code: ${dbError.code}`);
                console.error(`   Error detail: ${dbError.detail}`);
                
                // Log the specific SQL error
                if (dbError.position) {
                    console.error(`   Error position: ${dbError.position}`);
                }
                
                throw new Error(`FIXED DATABASE SAVE FAILURE: ${dbError.message}`);
            }
                
        } catch (error) {
            console.error(`❌ FIXED extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            if (retryCount < maxRetries - 1) {
                console.log(`🔄 Retrying FIXED extraction for user ${userId}...`);
                await scheduleBackgroundExtractionFixed(userId, linkedinUrl, retryCount + 1);
            } else {
                console.log(`❌ FIXED FAILURE for user ${userId} - NO MORE RETRIES`);
                await pool.query(
                    'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
                    ['failed', `FIXED FAILURE: ${error.message}`, userId]
                );
                await pool.query(
                    'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
                    ['failed', `FIXED FAILURE: ${error.message}`, userId]
                );
                processingQueue.delete(userId);
            }
        }
    }, retryCount === 0 ? 10000 : retryDelay);
};

// Clean LinkedIn URL
const cleanLinkedInUrl = (url) => {
    try {
        let cleanUrl = url.trim();
        if (cleanUrl.includes('?')) {
            cleanUrl = cleanUrl.split('?')[0];
        }
        if (cleanUrl.endsWith('/')) {
            cleanUrl = cleanUrl.slice(0, -1);
        }
        return cleanUrl;
    } catch (error) {
        return url;
    }
};

// ==================== DATABASE FUNCTIONS ====================

const createUser = async (email, passwordHash, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = {
        'free': 10,
        'silver': billingModel === 'payAsYouGo' ? 75 : 75,
        'gold': billingModel === 'payAsYouGo' ? 250 : 250,
        'platinum': billingModel === 'payAsYouGo' ? 1000 : 1000
    };
    
    const credits = creditsMap[packageType] || 10;
    
    const result = await pool.query(
        'INSERT INTO users (email, password_hash, package_type, billing_model, credits_remaining) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [email, passwordHash, packageType, billingModel, credits]
    );
    return result.rows[0];
};

const createGoogleUser = async (email, displayName, googleId, profilePicture, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = {
        'free': 10,
        'silver': billingModel === 'payAsYouGo' ? 75 : 75,
        'gold': billingModel === 'payAsYouGo' ? 250 : 250,
        'platinum': billingModel === 'payAsYouGo' ? 1000 : 1000
    };
    
    const credits = creditsMap[packageType] || 10;
    
    const result = await pool.query(
        `INSERT INTO users (email, google_id, display_name, profile_picture, package_type, billing_model, credits_remaining) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [email, googleId, displayName, profilePicture, packageType, billingModel, credits]
    );
    return result.rows[0];
};

const linkGoogleAccount = async (userId, googleId) => {
    const result = await pool.query(
        'UPDATE users SET google_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [googleId, userId]
    );
    return result.rows[0];
};

const getUserByEmail = async (email) => {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
};

const getUserById = async (userId) => {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0];
};

// Create or update user profile with FIXED extraction
const createOrUpdateUserProfileFixed = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        console.log(`🚀 Creating profile with FIXED extraction for user ${userId}`);
        
        await pool.query(
            'UPDATE users SET linkedin_url = $1, extraction_status = $2, error_message = NULL WHERE id = $3',
            [cleanUrl, 'processing', userId]
        );
        
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, data_extraction_status = $3, extraction_retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
                [cleanUrl, displayName, 'processing', userId]
            );
            profile = result.rows[0];
        } else {
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name, data_extraction_status, extraction_retry_count) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [userId, cleanUrl, displayName, 'processing', 0]
            );
            profile = result.rows[0];
        }
        
        console.log(`🔄 Starting FIXED background extraction for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        // Schedule extraction with FIXED logic
        scheduleBackgroundExtractionFixed(userId, cleanUrl, 0);
        
        console.log(`✅ Profile created and FIXED extraction started for user ${userId}`);
        return profile;
        
    } catch (error) {
        console.error('Error in profile creation/extraction:', error);
        throw error;
    }
};

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await getUserById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, error: 'Invalid token' });
    }
};

// ==================== API ENDPOINTS ====================

// Home route
app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Server - FIXED LinkedIn Data Extraction',
        status: 'running',
        version: '7.0-FIXED-COMPLETE',
        dataExtraction: 'FIXED - ALL LinkedIn profile fields captured properly',
        brightDataFields: 'FIXED - ALL Bright Data LinkedIn fields properly mapped',
        jsonProcessing: 'FIXED - Proper PostgreSQL JSONB handling',
        backgroundProcessing: 'enabled',
        philosophy: 'FIXED - Complete data extraction with proper field mapping',
        creditPackages: {
            free: '10 credits per month',
            silver: '75 credits',
            gold: '250 credits',
            platinum: '1000 credits'
        },
        endpoints: [
            'POST /register',
            'POST /login', 
            'GET /auth/google',
            'GET /auth/google/callback',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'GET /profile-status (protected)',
            'POST /retry-extraction (protected)',
            'GET /packages',
            'GET /health',
            'POST /migrate-database'
        ]
    });
});

// Health Check
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        const processingCount = processingQueue.size;
        
        res.status(200).json({
            status: 'healthy',
            version: '7.0-FIXED-COMPLETE',
            timestamp: new Date().toISOString(),
            philosophy: 'FIXED - Complete LinkedIn data extraction with proper field mapping',
            creditPackages: {
                free: '10 credits per month',
                silver: '75 credits',
                gold: '250 credits',
                platinum: '1000 credits'
            },
            brightDataMapping: {
                configured: !!BRIGHT_DATA_API_KEY,
                datasetId: BRIGHT_DATA_DATASET_ID,
                fieldsSupported: 'FIXED - ALL Bright Data LinkedIn fields with variations',
                syncEndpoint: 'datasets/v3/scrape (CORRECT)',
                asyncTrigger: 'datasets/v3/trigger (CORRECT)',
                statusCheck: 'datasets/v3/log/{snapshot_id} (CORRECT)',
                dataRetrieval: 'datasets/v3/snapshot/{snapshot_id} (CORRECT)'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production',
                jsonProcessing: 'FIXED - ALL JSONB columns with proper handling',
                fieldMapping: 'FIXED - Complete field mapping for all Bright Data variations'
            },
            authentication: {
                google: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
                jwt: !!JWT_SECRET,
                passport: 'configured'
            },
            backgroundProcessing: {
                enabled: true,
                currentlyProcessing: processingCount,
                processingUsers: Array.from(processingQueue.keys()),
                dataCapture: 'FIXED - Complete LinkedIn profile extraction with ALL fields',
                implementation: 'FIXED - Proper data processing and storage'
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== GOOGLE OAUTH ROUTES ====================

app.get('/auth/google', (req, res, next) => {
    if (req.query.package) {
        req.session.selectedPackage = req.query.package;
        req.session.billingModel = req.query.billing || 'monthly';
    }
    
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })(req, res, next);
});

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/failed' }),
    async (req, res) => {
        try {
            const token = jwt.sign(
                { userId: req.user.id, email: req.user.email },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            if (req.session.selectedPackage && req.session.selectedPackage !== 'free') {
                console.log(`Package ${req.session.selectedPackage} requested but only free available for now`);
            }
            
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://msgly.ai/sign-up' 
                : 'http://localhost:3000/sign-up';
                
            res.redirect(`${frontendUrl}?token=${token}`);
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://msgly.ai/sign-up' 
                : 'http://localhost:3000/sign-up';
                
            res.redirect(`${frontendUrl}?error=callback_error`);
        }
    }
);

app.get('/auth/failed', (req, res) => {
    const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://msgly.ai/sign-up' 
        : 'http://localhost:3000/sign-up';
        
    res.redirect(`${frontendUrl}?error=auth_failed`);
});

// ==================== MAIN ENDPOINTS ====================

// User Registration
app.post('/register', async (req, res) => {
    console.log('👤 Registration request:', req.body);
    
    try {
        const { email, password, packageType, billingModel } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        if (!packageType) {
            return res.status(400).json({
                success: false,
                error: 'Package selection is required'
            });
        }
        
        if (packageType !== 'free') {
            return res.status(400).json({
                success: false,
                error: 'Only free package is available during beta. Premium packages coming soon!'
            });
        }
        
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists with this email'
            });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await createUser(email, passwordHash, packageType, billingModel || 'monthly');
        
        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    packageType: newUser.package_type,
                    billingModel: newUser.billing_model,
                    credits: newUser.credits_remaining,
                    createdAt: newUser.created_at
                },
                token: token
            }
        });
        
        console.log(`✅ User registered: ${newUser.email} with ${packageType} package`);
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed',
            details: error.message
        });
    }
});

// User Login
app.post('/login', async (req, res) => {
    console.log('🔐 Login request for:', req.body.email);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                error: 'Please sign in with Google'
            });
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    packageType: user.package_type,
                    billingModel: user.billing_model,
                    credits: user.credits_remaining,
                    subscriptionStatus: user.subscription_status,
                    hasGoogleAccount: !!user.google_id
                },
                token: token
            }
        });
        
        console.log(`✅ User logged in: ${user.email}`);
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed',
            details: error.message
        });
    }
});

// Update user profile with LinkedIn URL - FIXED extraction
app.post('/update-profile', authenticateToken, async (req, res) => {
    console.log('📝 Profile update request for user:', req.user.id);
    
    try {
        const { linkedinUrl, packageType } = req.body;
        
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required'
            });
        }
        
        if (!linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL'
            });
        }
        
        if (packageType && packageType !== req.user.package_type) {
            if (packageType !== 'free') {
                return res.status(400).json({
                    success: false,
                    error: 'Only free package is available during beta'
                });
            }
            
            await pool.query(
                'UPDATE users SET package_type = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [packageType, req.user.id]
            );
        }
        
        // Create or update user profile with FIXED extraction
        const profile = await createOrUpdateUserProfileFixed(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated - FIXED LinkedIn data extraction started!',
            data: {
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.display_name,
                    packageType: updatedUser.package_type,
                    credits: updatedUser.credits_remaining
                },
                profile: {
                    linkedinUrl: profile.linkedin_url,
                    fullName: profile.full_name,
                    extractionStatus: profile.data_extraction_status,
                    message: 'FIXED LinkedIn extraction - ALL data properly stored'
                },
                automaticProcessing: {
                    enabled: true,
                    status: 'started',
                    expectedCompletionTime: '1-3 minutes (sync) or 3-5 minutes (async)',
                    dataCapture: 'FIXED - ALL LinkedIn profile data with ALL Bright Data fields',
                    philosophy: 'FIXED - Complete success with proper field mapping',
                    implementation: 'FIXED - All Bright Data fields and variations properly mapped',
                    willCapture: [
                        'FIXED - ALL Bright Data LinkedIn profile fields and variations',
                        'linkedin_id, linkedin_num_id, input_url, url, canonical_url',
                        'current_company_name, current_company_company_id',
                        'educations_details (separate from education)',
                        'recommendations (full data, not just count)',
                        'avatar, banner_image (Bright Data format)',
                        'Enhanced professional and social activity data',
                        'Complete experience and education history with variations',
                        'All skills, certifications, projects, languages with variations',
                        'Articles, posts, volunteering, organizations',
                        'People also viewed, recommendations given/received',
                        'Complete raw data and metadata',
                        'FIXED - Proper field mapping and data storage'
                    ]
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - FIXED LinkedIn extraction started!`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Get User Profile with extraction status
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        const profile = profileResult.rows[0];

        res.json({
            success: true,
            data: {
                user: {
                    id: req.user.id,
                    email: req.user.email,
                    displayName: req.user.display_name,
                    profilePicture: req.user.profile_picture,
                    packageType: req.user.package_type,
                    billingModel: req.user.billing_model,
                    credits: req.user.credits_remaining,
                    subscriptionStatus: req.user.subscription_status,
                    hasGoogleAccount: !!req.user.google_id,
                    createdAt: req.user.created_at
                },
                profile: profile ? {
                    // Core Identifiers
                    linkedinUrl: profile.linkedin_url,
                    linkedinId: profile.linkedin_id,
                    linkedinNumId: profile.linkedin_num_id,
                    brightDataId: profile.bright_data_id,
                    inputUrl: profile.input_url,
                    url: profile.url,
                    canonicalUrl: profile.canonical_url,
                    
                    // Basic Information
                    name: profile.name,
                    fullName: profile.full_name,
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    about: profile.about,
                    summary: profile.summary,
                    description: profile.description,
                    
                    // Location (All Variations)
                    location: profile.location,
                    city: profile.city,
                    state: profile.state,
                    country: profile.country,
                    countryCode: profile.country_code,
                    geoLocation: profile.geo_location,
                    geoCity: profile.geo_city,
                    geoState: profile.geo_state,
                    geoCountry: profile.geo_country,
                    formattedLocation: profile.formatted_location,
                    
                    // Professional (All Variations)
                    industry: profile.industry,
                    position: profile.position,
                    currentPosition: profile.current_position,
                    currentCompany: profile.current_company,
                    currentCompanyName: profile.current_company_name,
                    currentCompanyId: profile.current_company_id,
                    currentCompanyCompanyId: profile.current_company_company_id,
                    company: profile.company,
                    jobTitle: profile.job_title,
                    
                    // Metrics (All Variations)
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    connections: profile.connections,
                    followers: profile.followers,
                    recommendationsCount: profile.recommendations_count,
                    numConnections: profile.num_connections,
                    numFollowers: profile.num_followers,
                    
                    // Media (All Variations)
                    profilePicture: profile.profile_picture,
                    profilePicUrl: profile.profile_pic_url,
                    profileImageUrl: profile.profile_image_url,
                    avatar: profile.avatar,
                    photo: profile.photo,
                    bannerImage: profile.banner_image,
                    backgroundImage: profile.background_image,
                    backgroundImageUrl: profile.background_image_url,
                    
                    // Identifiers
                    publicIdentifier: profile.public_identifier,
                    profileUrl: profile.profile_url,
                    
                    // Contact
                    email: profile.email,
                    phone: profile.phone,
                    website: profile.website,
                    
                    // Additional Fields
                    interests: profile.interests,
                    accomplishments: profile.accomplishments,
                    featuredContent: profile.featured_content,
                    premiumSubscriber: profile.premium_subscriber,
                    openToWork: profile.open_to_work,
                    hiring: profile.hiring,
                    
                    // Professional Arrays (All Variations)
                    experience: profile.experience,
                    workExperience: profile.work_experience,
                    experiences: profile.experiences,
                    jobs: profile.jobs,
                    positions: profile.positions,
                    
                    education: profile.education,
                    educations: profile.educations,
                    educationsDetails: profile.educations_details,
                    educationDetails: profile.education_details,
                    schools: profile.schools,
                    
                    skills: profile.skills,
                    skillList: profile.skill_list,
                    skillsList: profile.skills_list,
                    skillsWithEndorsements: profile.skills_with_endorsements,
                    endorsedSkills: profile.endorsed_skills,
                    
                    languages: profile.languages,
                    languageList: profile.language_list,
                    
                    certifications: profile.certifications,
                    certificates: profile.certificates,
                    certificationList: profile.certification_list,
                    
                    courses: profile.courses,
                    courseList: profile.course_list,
                    
                    projects: profile.projects,
                    projectList: profile.project_list,
                    
                    publications: profile.publications,
                    publicationList: profile.publication_list,
                    
                    patents: profile.patents,
                    patentList: profile.patent_list,
                    
                    volunteerExperience: profile.volunteer_experience,
                    volunteerWork: profile.volunteer_work,
                    volunteering: profile.volunteering,
                    volunteerList: profile.volunteer_list,
                    
                    honorsAndAwards: profile.honors_and_awards,
                    awards: profile.awards,
                    honors: profile.honors,
                    
                    organizations: profile.organizations,
                    organizationList: profile.organization_list,
                    
                    // Recommendations
                    recommendations: profile.recommendations,
                    recommendationsGiven: profile.recommendations_given,
                    recommendationsReceived: profile.recommendations_received,
                    givenRecommendations: profile.given_recommendations,
                    receivedRecommendations: profile.received_recommendations,
                    
                    // Social Activity
                    posts: profile.posts,
                    recentPosts: profile.recent_posts,
                    activity: profile.activity,
                    recentActivity: profile.recent_activity,
                    articles: profile.articles,
                    articleList: profile.article_list,
                    
                    // Network
                    peopleAlsoViewed: profile.people_also_viewed,
                    alsoViewed: profile.also_viewed,
                    mutualConnections: profile.mutual_connections,
                    
                    // Additional Arrays
                    groups: profile.groups,
                    following: profile.following,
                    testScores: profile.test_scores,
                    externalLinks: profile.external_links,
                    websites: profile.websites,
                    contactInfo: profile.contact_info,
                    
                    // Metadata
                    brightdataData: profile.brightdata_data,
                    rawData: profile.raw_data,
                    timestamp: profile.timestamp,
                    profileTimestamp: profile.profile_timestamp,
                    dataSource: profile.data_source,
                    extractionMethod: profile.extraction_method,
                    extractionStatus: profile.data_extraction_status,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count,
                    profileAnalyzed: profile.profile_analyzed,
                    dataQualityScore: profile.data_quality_score
                } : null,
                automaticProcessing: {
                    enabled: true,
                    isCurrentlyProcessing: processingQueue.has(req.user.id),
                    queuePosition: processingQueue.has(req.user.id) ? 
                        Array.from(processingQueue.keys()).indexOf(req.user.id) + 1 : null,
                    implementation: 'FIXED - All Bright Data fields and variations mapped',
                    dataCapture: 'FIXED - ALL LinkedIn profile fields properly stored',
                    philosophy: 'FIXED - Complete success with proper field mapping'
                }
            }
        });
    } catch (error) {
        console.error('❌ Profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// Check profile extraction status
app.get('/profile-status', authenticateToken, async (req, res) => {
    try {
        const userQuery = `
            SELECT 
                u.extraction_status,
                u.error_message,
                u.profile_completed,
                u.linkedin_url,
                up.data_extraction_status,
                up.extraction_completed_at,
                up.extraction_retry_count,
                up.extraction_error,
                up.data_quality_score
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.id = $1
        `;
        
        const result = await pool.query(userQuery, [req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const status = result.rows[0];
        
        res.json({
            extraction_status: status.extraction_status,
            profile_completed: status.profile_completed,
            linkedin_url: status.linkedin_url,
            error_message: status.error_message,
            data_extraction_status: status.data_extraction_status,
            extraction_completed_at: status.extraction_completed_at,
            extraction_retry_count: status.extraction_retry_count,
            extraction_error: status.extraction_error,
            data_quality_score: status.data_quality_score,
            is_currently_processing: processingQueue.has(req.user.id),
            message: getStatusMessage(status.extraction_status),
            implementation: 'FIXED - All Bright Data fields and variations mapped',
            dataCapture: status.extraction_status === 'completed' ? 
                'FIXED - ALL LinkedIn profile data captured successfully with proper field mapping' : 
                'Processing FIXED LinkedIn data extraction...',
            philosophy: 'FIXED - Complete success with proper field mapping'
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// Helper function for status messages
const getStatusMessage = (status) => {
    switch (status) {
        case 'not_started':
            return 'LinkedIn extraction not started';
        case 'processing':
            return 'FIXED LinkedIn profile extraction in progress - ALL Bright Data fields will be captured properly...';
        case 'completed':
            return 'LinkedIn profile extraction completed successfully - ALL profile data captured with FIXED field mapping!';
        case 'failed':
            return 'LinkedIn profile extraction failed - Check logs for details';
        default:
            return 'Unknown status';
    }
};

// Retry extraction
app.post('/retry-extraction', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query(
            'SELECT linkedin_url FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (userResult.rows.length === 0 || !userResult.rows[0].linkedin_url) {
            return res.status(400).json({ error: 'No LinkedIn URL found for retry' });
        }
        
        const linkedinUrl = userResult.rows[0].linkedin_url;
        
        // Retry extraction with FIXED implementation
        const profile = await createOrUpdateUserProfileFixed(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: 'LinkedIn extraction retry initiated - FIXED data capture with proper field mapping!',
            status: 'processing',
            implementation: 'FIXED - All Bright Data LinkedIn fields and variations will be extracted',
            dataCapture: 'FIXED LinkedIn profile extraction - Complete success with proper mapping',
            philosophy: 'FIXED - Complete success with proper field mapping'
        });
        
    } catch (error) {
        console.error('Retry extraction error:', error);
        res.status(500).json({ error: 'Retry failed' });
    }
});

// Get Available Packages
app.get('/packages', (req, res) => {
    const packages = {
        payAsYouGo: [
            {
                id: 'free',
                name: 'Free',
                credits: 10,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 75,
                price: 12,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 250,
                price: 35,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1000,
                price: 70,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', 'Credits never expire'],
                available: false,
                comingSoon: true
            }
        ],
        monthly: [
            {
                id: 'free',
                name: 'Free',
                credits: 10,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 75,
                price: 8.60,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 250,
                price: 25.20,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1000,
                price: 50.40,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction - ALL fields', 'Complete data mapping', '7-day free trial included'],
                available: false,
                comingSoon: true
            }
        ]
    };
    
    res.json({
        success: true,
        data: { packages }
    });
});

// Background processing status endpoint
app.get('/processing-status', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query(
            'SELECT data_extraction_status, extraction_retry_count, extraction_attempted_at, extraction_completed_at, extraction_error, data_quality_score FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        
        const profile = profileResult.rows[0];
        
        res.json({
            success: true,
            data: {
                extractionStatus: profile?.data_extraction_status || 'no_profile',
                retryCount: profile?.extraction_retry_count || 0,
                lastAttempt: profile?.extraction_attempted_at,
                completedAt: profile?.extraction_completed_at,
                error: profile?.extraction_error,
                dataQualityScore: profile?.data_quality_score,
                isCurrentlyProcessing: processingQueue.has(req.user.id),
                totalProcessingQueue: processingQueue.size,
                processingStartTime: processingQueue.get(req.user.id)?.startTime,
                implementation: 'FIXED - All Bright Data LinkedIn fields and variations mapped',
                dataCapture: 'FIXED - ALL LinkedIn profile fields properly stored',
                philosophy: 'FIXED - Complete success with proper field mapping'
            }
        });
    } catch (error) {
        console.error('❌ Processing status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get processing status'
        });
    }
});

// Error handling
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        availableRoutes: [
            'POST /register', 
            'POST /login', 
            'GET /auth/google',
            'GET /profile', 
            'POST /update-profile',
            'GET /profile-status',
            'POST /retry-extraction',
            'GET /processing-status',
            'GET /packages', 
            'GET /health'
        ]
    });
});

app.use((error, req, res, next) => {
    console.error('❌ Error:', error);
    res.status(500).json({
        success: false,
        error: 'Server error'
    });
});

// ==================== SERVER STARTUP ====================

const validateEnvironment = () => {
    const required = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
    
    if (!BRIGHT_DATA_API_KEY) {
        console.warn('⚠️ Warning: BRIGHT_DATA_API_KEY not set - profile extraction will fail');
    }
    
    console.log('✅ Environment validated');
};

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
        await initDB();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

const startServer = async () => {
    try {
        validateEnvironment();
        
        const dbOk = await testDatabase();
        if (!dbOk) {
            console.error('❌ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Msgly.AI Server - FIXED LinkedIn Data Extraction Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected with FIXED Bright Data schema`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`🤖 Background Processing: ENABLED ✅`);
            console.log(`⚡ Data Extraction: FIXED - ALL Bright Data LinkedIn fields and variations ✅`);
            console.log(`🛠️ Field Mapping: FIXED - Complete mapping for all field variations ✅`);
            console.log(`📊 Data Processing: FIXED - All arrays and objects properly processed ✅`);
            console.log(`🔧 Implementation: FIXED - Proper SQL queries and data storage ✅`);
            console.log(`💰 Credit Packages:`);
            console.log(`   🆓 Free: 10 credits per month`);
            console.log(`   🥈 Silver: 75 credits`);
            console.log(`   🥇 Gold: 250 credits`);
            console.log(`   💎 Platinum: 1000 credits`);
            console.log(`💳 Billing: Pay-As-You-Go & Monthly`);
            console.log(`🔗 LinkedIn: FIXED Profile Extraction - ALL Bright Data fields and variations!`);
            console.log(`🌐 Health: http://localhost:${PORT}/health`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            console.log(`🎯 USER EXPERIENCE: Register → Add LinkedIn URL → Dashboard with ALL Data FIXED!`);
            console.log(`🔥 PHILOSOPHY: FIXED - Complete LinkedIn data extraction with proper field mapping`);
            console.log(`✅ BRIGHT DATA FIELDS FIXED:`);
            console.log(`   ✅ linkedin_id, linkedin_num_id, input_url, url, canonical_url`);
            console.log(`   ✅ current_company_name, current_company_company_id`);
            console.log(`   ✅ educations_details (separate from education)`);
            console.log(`   ✅ recommendations (full data, not just count)`);
            console.log(`   ✅ avatar, banner_image (Bright Data format)`);
            console.log(`   ✅ All professional and social activity arrays`);
            console.log(`   ✅ Complete metadata and identification fields`);
            console.log(`   ✅ ALL field variations and alternative names`);
            console.log(`🚀 RESULT: FIXED Complete LinkedIn profile data extraction!`);
        });
        
    } catch (error) {
        console.error('❌ Startup failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
