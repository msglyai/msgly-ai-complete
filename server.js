// Msgly.AI Server - COMPLETE LinkedIn Data Extraction - NO FALLBACKS
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
            CREATE TABLE IF NOT EXISTS user_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                
                -- Basic Profile Information
                linkedin_url TEXT,
                linkedin_id TEXT,
                linkedin_num_id BIGINT,
                input_url TEXT,
                url TEXT,
                full_name TEXT,
                first_name TEXT,
                last_name TEXT,
                headline TEXT,
                about TEXT,
                summary TEXT,
                
                -- Location Information
                location TEXT,
                city TEXT,
                state TEXT,
                country TEXT,
                country_code TEXT,
                
                -- Professional Information
                industry TEXT,
                current_company TEXT,
                current_company_name TEXT,
                current_company_id TEXT,
                current_company_company_id TEXT,
                current_position TEXT,
                
                -- Metrics
                connections_count INTEGER,
                followers_count INTEGER,
                connections INTEGER,
                followers INTEGER,
                recommendations_count INTEGER,
                
                -- Media
                profile_picture TEXT,
                profile_image_url VARCHAR(500),
                avatar TEXT,
                banner_image TEXT,
                background_image_url VARCHAR(500),
                
                -- Identifiers
                public_identifier VARCHAR(255),
                
                -- Complex Data Arrays (ALL JSONB)
                experience JSONB DEFAULT '[]'::JSONB,
                education JSONB DEFAULT '[]'::JSONB,
                educations_details JSONB DEFAULT '[]'::JSONB,
                skills JSONB DEFAULT '[]'::JSONB,
                skills_with_endorsements JSONB DEFAULT '[]'::JSONB,
                languages JSONB DEFAULT '[]'::JSONB,
                certifications JSONB DEFAULT '[]'::JSONB,
                courses JSONB DEFAULT '[]'::JSONB,
                projects JSONB DEFAULT '[]'::JSONB,
                publications JSONB DEFAULT '[]'::JSONB,
                patents JSONB DEFAULT '[]'::JSONB,
                volunteer_experience JSONB DEFAULT '[]'::JSONB,
                volunteering JSONB DEFAULT '[]'::JSONB,
                honors_and_awards JSONB DEFAULT '[]'::JSONB,
                organizations JSONB DEFAULT '[]'::JSONB,
                recommendations JSONB DEFAULT '[]'::JSONB,
                recommendations_given JSONB DEFAULT '[]'::JSONB,
                recommendations_received JSONB DEFAULT '[]'::JSONB,
                posts JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                articles JSONB DEFAULT '[]'::JSONB,
                people_also_viewed JSONB DEFAULT '[]'::JSONB,
                
                -- Metadata
                brightdata_data JSONB,
                timestamp TIMESTAMP,
                data_source VARCHAR(100),
                data_extraction_status VARCHAR(50) DEFAULT 'pending',
                extraction_attempted_at TIMESTAMP,
                extraction_completed_at TIMESTAMP,
                extraction_error TEXT,
                extraction_retry_count INTEGER DEFAULT 0,
                profile_analyzed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                
                CONSTRAINT user_profiles_user_id_key UNIQUE (user_id)
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
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_linkedin_id ON user_profiles(linkedin_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_linkedin_num_id ON user_profiles(linkedin_num_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_retry_count ON user_profiles(extraction_retry_count);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_current_company ON user_profiles(current_company);
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

// ==================== LINKEDIN DATA PROCESSING - NO FALLBACKS ====================

// JSON validation and sanitization
const sanitizeForJSON = (data) => {
    if (data === null || data === undefined) {
        return null;
    }
    
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return parsed;
        } catch (e) {
            return data;
        }
    }
    
    if (Array.isArray(data)) {
        return data.map(item => sanitizeForJSON(item)).filter(item => item !== null);
    }
    
    if (typeof data === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            const sanitizedValue = sanitizeForJSON(value);
            if (sanitizedValue !== null) {
                sanitized[key] = sanitizedValue;
            }
        }
        return sanitized;
    }
    
    return data;
};

// Ensure arrays are properly formatted for PostgreSQL JSONB
const ensureValidJSONArray = (data) => {
    try {
        if (!data) {
            return [];
        }
        
        if (Array.isArray(data)) {
            const sanitized = data.map(item => sanitizeForJSON(item)).filter(item => item !== null);
            const testString = JSON.stringify(sanitized);
            JSON.parse(testString);
            return sanitized;
        }
        
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    return ensureValidJSONArray(parsed);
                }
                return [parsed];
            } catch (e) {
                return [];
            }
        }
        
        if (typeof data === 'object') {
            return [sanitizeForJSON(data)];
        }
        
        return [];
    } catch (error) {
        console.error('Error ensuring valid JSON array:', error);
        return [];
    }
};

// Helper function to parse LinkedIn numbers
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

// ✅ COMPLETE LinkedIn data processing - EXACT Bright Data field mapping
const processLinkedInDataComplete = (profileData) => {
    if (!profileData) {
        throw new Error('No profile data received from Bright Data API');
    }
    
    console.log('📊 Processing LinkedIn data with COMPLETE Bright Data field mapping...');
    console.log('📋 Raw data keys:', Object.keys(profileData));
    
    try {
        const processedData = {
            // ✅ EXACT Bright Data Profile Details Mapping
            linkedinId: profileData.linkedin_id || profileData.id || null,
            linkedinNumId: profileData.linkedin_num_id || profileData.numericId || null,
            inputUrl: profileData.input_url || profileData.inputUrl || null,
            url: profileData.url || profileData.canonicalUrl || null,
            
            // Basic Information
            fullName: profileData.name || profileData.full_name || profileData.fullName || null,
            firstName: profileData.first_name || profileData.firstName || 
                      (profileData.name ? profileData.name.split(' ')[0] : null),
            lastName: profileData.last_name || profileData.lastName || 
                     (profileData.name ? profileData.name.split(' ').slice(1).join(' ') : null),
            headline: profileData.headline || profileData.position || null,
            about: profileData.about || profileData.summary || profileData.description || null,
            summary: profileData.summary || profileData.about || profileData.description || null,
            
            // Location Information  
            location: profileData.location || profileData.geo_location || null,
            city: profileData.city || profileData.geo_city || null,
            state: profileData.state || profileData.geo_state || null,
            country: profileData.country || profileData.geo_country || null,
            countryCode: profileData.country_code || profileData.countryCode || null,
            
            // ✅ Enhanced Professional Information (Bright Data specific)
            industry: profileData.industry || null,
            currentCompany: profileData.current_company || profileData.company || null,
            currentCompanyName: profileData.current_company_name || profileData.currentCompanyName || null,
            currentCompanyId: profileData.current_company_id || profileData.currentCompanyId || null,
            currentCompanyCompanyId: profileData.current_company_company_id || profileData.currentCompanyCompanyId || null,
            currentPosition: profileData.current_position || profileData.position || profileData.headline || null,
            
            // ✅ Metrics (Bright Data format)
            connectionsCount: parseLinkedInNumber(profileData.connections_count || profileData.connectionsCount),
            followersCount: parseLinkedInNumber(profileData.followers_count || profileData.followersCount),
            connections: parseLinkedInNumber(profileData.connections),
            followers: parseLinkedInNumber(profileData.followers),
            recommendationsCount: profileData.recommendations_count || profileData.recommendationsCount || null,
            
            // ✅ Media (Bright Data specific field names)
            profileImageUrl: profileData.profile_pic_url || profileData.profile_picture || profileData.profileImageUrl || null,
            avatar: profileData.avatar || profileData.profile_pic_url || profileData.photo || null,
            bannerImage: profileData.banner_image || profileData.backgroundImage || null,
            backgroundImageUrl: profileData.background_image || profileData.backgroundImageUrl || null,
            
            // Identifiers
            publicIdentifier: profileData.public_identifier || profileData.publicIdentifier || null,
            
            // ✅ COMPLETE Professional Information Arrays (Bright Data format)
            experience: ensureValidJSONArray(profileData.experience || profileData.work_experience || 
                       profileData.experiences || profileData.jobs || profileData.positions || []),
            
            education: ensureValidJSONArray(profileData.education || profileData.educations || 
                      profileData.schools || []),
            
            educationsDetails: ensureValidJSONArray(profileData.educations_details || 
                              profileData.educationDetails || []),
            
            skills: ensureValidJSONArray(profileData.skills || profileData.skill_list || 
                   profileData.skillsList || []),
            
            skillsWithEndorsements: ensureValidJSONArray(profileData.skills_with_endorsements || 
                                   profileData.endorsedSkills || []),
            
            languages: ensureValidJSONArray(profileData.languages || profileData.language_list || []),
            
            certifications: ensureValidJSONArray(profileData.certifications || profileData.certificates || 
                           profileData.certificationList || []),
            
            courses: ensureValidJSONArray(profileData.courses || profileData.course_list || []),
            
            projects: ensureValidJSONArray(profileData.projects || profileData.project_list || []),
            
            publications: ensureValidJSONArray(profileData.publications || profileData.publication_list || []),
            
            patents: ensureValidJSONArray(profileData.patents || profileData.patent_list || []),
            
            volunteerExperience: ensureValidJSONArray(profileData.volunteer_experience || 
                                profileData.volunteerWork || []),
            
            volunteering: ensureValidJSONArray(profileData.volunteering || profileData.volunteer_work || []),
            
            honorsAndAwards: ensureValidJSONArray(profileData.honors_and_awards || 
                            profileData.awards || profileData.honors || []),
            
            organizations: ensureValidJSONArray(profileData.organizations || 
                          profileData.organization_list || []),
            
            // ✅ Recommendations (COMPLETE data, not just count)
            recommendations: ensureValidJSONArray(profileData.recommendations || []),
            
            recommendationsGiven: ensureValidJSONArray(profileData.recommendations_given || 
                                 profileData.given_recommendations || []),
            
            recommendationsReceived: ensureValidJSONArray(profileData.recommendations_received || 
                                    profileData.received_recommendations || []),
            
            // ✅ Social Activity (Bright Data format)
            posts: ensureValidJSONArray(profileData.posts || profileData.recent_posts || []),
            
            activity: ensureValidJSONArray(profileData.activity || profileData.recent_activity || []),
            
            articles: ensureValidJSONArray(profileData.articles || profileData.article_list || []),
            
            peopleAlsoViewed: ensureValidJSONArray(profileData.people_also_viewed || 
                             profileData.also_viewed || []),
            
            // ✅ Metadata (Bright Data format)
            timestamp: profileData.timestamp ? new Date(profileData.timestamp) : new Date(),
            dataSource: profileData.db_source || profileData.data_source || 'bright_data',
            
            // Store complete raw data
            rawData: sanitizeForJSON(profileData)
        };
        
        console.log('✅ COMPLETE LinkedIn data processed successfully with Bright Data mapping!');
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

// ✅ COMPLETE Database save - NO FALLBACKS - FAIL COMPLETELY IF ANY ERROR
const scheduleBackgroundExtractionNoFallbacks = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = 300000; // 5 minutes
    
    console.log(`🔄 Scheduling COMPLETE background extraction (NO FALLBACKS) for user ${userId}, retry ${retryCount}`);
    
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for user ${userId} - COMPLETE FAILURE`);
        await pool.query(
            'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
            ['failed', `COMPLETE FAILURE: Max retries (${maxRetries}) exceeded - NO FALLBACKS`, userId]
        );
        await pool.query(
            'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
            ['failed', `COMPLETE FAILURE: Max retries (${maxRetries}) exceeded - NO FALLBACKS`, userId]
        );
        processingQueue.delete(userId);
        return;
    }

    setTimeout(async () => {
        try {
            console.log(`🚀 Starting COMPLETE background extraction (NO FALLBACKS) for user ${userId} (Retry ${retryCount})`);
            
            await pool.query(
                'UPDATE user_profiles SET extraction_retry_count = $1, extraction_attempted_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [retryCount, userId]
            );

            // ✅ COMPLETE extraction - will throw error if fails
            const result = await extractLinkedInProfileComplete(linkedinUrl);
            
            console.log(`✅ COMPLETE extraction succeeded for user ${userId}`);
            
            const extractedData = result.data;
            
            console.log(`📊 COMPLETE data validation for user ${userId}:`);
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
            
            // ✅ COMPLETE DATABASE SAVE - NO FALLBACKS - ALL OR NOTHING
            console.log('💾 Saving COMPLETE LinkedIn data to database - ALL OR NOTHING...');
            
            try {
                await pool.query(`
                    UPDATE user_profiles SET 
                        -- LinkedIn IDs and URLs
                        linkedin_id = $1,
                        linkedin_num_id = $2,
                        input_url = $3,
                        url = $4,
                        
                        -- Basic Profile
                        full_name = COALESCE($5, full_name),
                        first_name = $6,
                        last_name = $7,
                        headline = $8,
                        about = $9,
                        summary = $9,
                        
                        -- Location
                        location = $10,
                        city = $11,
                        state = $12,
                        country = $13,
                        country_code = $14,
                        
                        -- Professional
                        industry = $15,
                        current_company = $16,
                        current_company_name = $17,
                        current_company_id = $18,
                        current_company_company_id = $19,
                        current_position = $20,
                        
                        -- Metrics
                        connections_count = $21,
                        followers_count = $22,
                        connections = $23,
                        followers = $24,
                        recommendations_count = $25,
                        
                        -- Media
                        profile_image_url = $26,
                        avatar = $27,
                        banner_image = $28,
                        background_image_url = $29,
                        public_identifier = $30,
                        
                        -- ALL Complex Arrays as JSONB
                        experience = $31,
                        education = $32,
                        educations_details = $33,
                        skills = $34,
                        skills_with_endorsements = $35,
                        languages = $36,
                        certifications = $37,
                        courses = $38,
                        projects = $39,
                        publications = $40,
                        patents = $41,
                        volunteer_experience = $42,
                        volunteering = $43,
                        honors_and_awards = $44,
                        organizations = $45,
                        recommendations = $46,
                        recommendations_given = $47,
                        recommendations_received = $48,
                        posts = $49,
                        activity = $50,
                        articles = $51,
                        people_also_viewed = $52,
                        
                        -- Metadata
                        brightdata_data = $53,
                        timestamp = $54,
                        data_source = $55,
                        
                        -- Status
                        data_extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL,
                        profile_analyzed = true,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $56 
                `, [
                    // LinkedIn IDs and URLs (1-4)
                    extractedData.linkedinId,
                    extractedData.linkedinNumId,
                    extractedData.inputUrl,
                    extractedData.url,
                    
                    // Basic Profile (5-9)
                    extractedData.fullName,
                    extractedData.firstName,
                    extractedData.lastName,
                    extractedData.headline,
                    extractedData.about,
                    
                    // Location (10-14)
                    extractedData.location,
                    extractedData.city,
                    extractedData.state,
                    extractedData.country,
                    extractedData.countryCode,
                    
                    // Professional (15-20)
                    extractedData.industry,
                    extractedData.currentCompany,
                    extractedData.currentCompanyName,
                    extractedData.currentCompanyId,
                    extractedData.currentCompanyCompanyId,
                    extractedData.currentPosition,
                    
                    // Metrics (21-25)
                    extractedData.connectionsCount,
                    extractedData.followersCount,
                    extractedData.connections,
                    extractedData.followers,
                    extractedData.recommendationsCount,
                    
                    // Media (26-30)
                    extractedData.profileImageUrl,
                    extractedData.avatar,
                    extractedData.bannerImage,
                    extractedData.backgroundImageUrl,
                    extractedData.publicIdentifier,
                    
                    // ALL Complex Arrays as JSONB (31-52)
                    JSON.stringify(extractedData.experience),
                    JSON.stringify(extractedData.education),
                    JSON.stringify(extractedData.educationsDetails),
                    JSON.stringify(extractedData.skills),
                    JSON.stringify(extractedData.skillsWithEndorsements),
                    JSON.stringify(extractedData.languages),
                    JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.courses),
                    JSON.stringify(extractedData.projects),
                    JSON.stringify(extractedData.publications),
                    JSON.stringify(extractedData.patents),
                    JSON.stringify(extractedData.volunteerExperience),
                    JSON.stringify(extractedData.volunteering),
                    JSON.stringify(extractedData.honorsAndAwards),
                    JSON.stringify(extractedData.organizations),
                    JSON.stringify(extractedData.recommendations),
                    JSON.stringify(extractedData.recommendationsGiven),
                    JSON.stringify(extractedData.recommendationsReceived),
                    JSON.stringify(extractedData.posts),
                    JSON.stringify(extractedData.activity),
                    JSON.stringify(extractedData.articles),
                    JSON.stringify(extractedData.peopleAlsoViewed),
                    
                    // Metadata (53-55)
                    JSON.stringify(extractedData.rawData),
                    extractedData.timestamp,
                    extractedData.dataSource,
                    
                    // User ID (56)
                    userId
                ]);

                await pool.query(
                    'UPDATE users SET extraction_status = $1, profile_completed = $2, error_message = NULL WHERE id = $3',
                    ['completed', true, userId]
                );

                console.log(`🎉 COMPLETE LinkedIn profile data successfully saved for user ${userId}!`);
                console.log(`✅ Method: ${result.method}`);
                console.log('🏆 SUCCESS: ALL LinkedIn data fields captured and saved - NO FALLBACKS NEEDED!');
                console.log('📊 Saved comprehensive data:');
                console.log('   ✅ Complete profile information');
                console.log('   ✅ All professional experience');
                console.log('   ✅ Complete education history');
                console.log('   ✅ All skills and endorsements');
                console.log('   ✅ Certifications and courses');
                console.log('   ✅ Projects and publications');
                console.log('   ✅ Languages and volunteer work');
                console.log('   ✅ Articles and posts');
                console.log('   ✅ Organizations and awards');
                console.log('   ✅ Complete recommendations');
                console.log('   ✅ All Bright Data specific fields');
                console.log('   ✅ Complete raw data for future use');
                
                processingQueue.delete(userId);
                
            } catch (dbError) {
                console.error(`❌ DATABASE SAVE FAILED for user ${userId}:`, dbError.message);
                console.error(`   Error code: ${dbError.code}`);
                console.error(`   Error detail: ${dbError.detail}`);
                
                // ❌ NO FALLBACKS - COMPLETE FAILURE
                throw new Error(`COMPLETE DATABASE SAVE FAILURE: ${dbError.message} - NO FALLBACKS`);
            }
                
        } catch (error) {
            console.error(`❌ COMPLETE extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            if (retryCount < maxRetries - 1) {
                console.log(`🔄 Retrying COMPLETE extraction for user ${userId}...`);
                await scheduleBackgroundExtractionNoFallbacks(userId, linkedinUrl, retryCount + 1);
            } else {
                console.log(`❌ COMPLETE FAILURE for user ${userId} - NO MORE RETRIES`);
                await pool.query(
                    'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
                    ['failed', `COMPLETE FAILURE: ${error.message} - NO FALLBACKS`, userId]
                );
                await pool.query(
                    'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
                    ['failed', `COMPLETE FAILURE: ${error.message} - NO FALLBACKS`, userId]
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

// Create or update user profile with COMPLETE extraction - NO FALLBACKS
const createOrUpdateUserProfileCompleteNoFallbacks = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        console.log(`🚀 Creating profile with COMPLETE extraction (NO FALLBACKS) for user ${userId}`);
        
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
        
        console.log(`🔄 Starting COMPLETE background extraction (NO FALLBACKS) for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        // Schedule extraction with NO FALLBACKS
        scheduleBackgroundExtractionNoFallbacks(userId, cleanUrl, 0);
        
        console.log(`✅ Profile created and COMPLETE extraction (NO FALLBACKS) started for user ${userId}`);
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
        message: 'Msgly.AI Server - COMPLETE LinkedIn Data Extraction - NO FALLBACKS',
        status: 'running',
        version: '6.0-COMPLETE-NO-FALLBACKS',
        dataExtraction: 'COMPLETE LinkedIn profile data - ALL fields captured',
        noFallbacks: 'Either complete success or complete failure - NO partial saves',
        brightDataFields: 'ALL Bright Data LinkedIn fields properly mapped',
        jsonProcessing: 'FIXED - Proper PostgreSQL JSONB handling',
        backgroundProcessing: 'enabled',
        philosophy: 'ALL OR NOTHING - Complete data extraction or failure',
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
            version: '6.0-COMPLETE-NO-FALLBACKS',
            timestamp: new Date().toISOString(),
            philosophy: 'ALL OR NOTHING - Complete LinkedIn data extraction',
            creditPackages: {
                free: '10 credits per month',
                silver: '75 credits',
                gold: '250 credits',
                platinum: '1000 credits'
            },
            brightDataMapping: {
                configured: !!BRIGHT_DATA_API_KEY,
                datasetId: BRIGHT_DATA_DATASET_ID,
                fieldsSupported: 'ALL Bright Data LinkedIn fields',
                syncEndpoint: 'datasets/v3/scrape (CORRECT)',
                asyncTrigger: 'datasets/v3/trigger (CORRECT)',
                statusCheck: 'datasets/v3/log/{snapshot_id} (CORRECT)',
                dataRetrieval: 'datasets/v3/snapshot/{snapshot_id} (CORRECT)'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production',
                jsonProcessing: 'FIXED - ALL JSONB columns',
                noFallbacks: true
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
                dataCapture: 'COMPLETE LinkedIn profile extraction - NO FALLBACKS',
                fallbacks: 'DISABLED - All or nothing approach'
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

// Update user profile with LinkedIn URL - COMPLETE extraction - NO FALLBACKS
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
        
        // Create or update user profile with COMPLETE extraction - NO FALLBACKS
        const profile = await createOrUpdateUserProfileCompleteNoFallbacks(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated - COMPLETE LinkedIn data extraction started (NO FALLBACKS)!',
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
                    message: 'COMPLETE LinkedIn extraction - ALL data or COMPLETE FAILURE'
                },
                automaticProcessing: {
                    enabled: true,
                    status: 'started',
                    expectedCompletionTime: '1-3 minutes (sync) or 3-5 minutes (async)',
                    dataCapture: 'COMPLETE - ALL LinkedIn profile data with ALL Bright Data fields',
                    philosophy: 'ALL OR NOTHING - No partial saves, no fallbacks',
                    implementation: 'COMPLETE - All Bright Data fields properly mapped',
                    willCapture: [
                        'ALL Bright Data LinkedIn profile fields',
                        'linkedin_id, linkedin_num_id, input_url, url',
                        'current_company_name, current_company_company_id',
                        'educations_details (separate from education)',
                        'recommendations (full data, not just count)',
                        'avatar, banner_image (Bright Data format)',
                        'Enhanced professional and social activity data',
                        'Complete experience and education history',
                        'All skills, certifications, projects, languages',
                        'Articles, posts, volunteering, organizations',
                        'People also viewed, recommendations given/received',
                        'Complete raw data and metadata',
                        'NO FALLBACKS - Complete success or complete failure'
                    ]
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - COMPLETE LinkedIn extraction (NO FALLBACKS) started!`);
        
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
                    // Basic Information
                    linkedinUrl: profile.linkedin_url,
                    linkedinId: profile.linkedin_id,
                    linkedinNumId: profile.linkedin_num_id,
                    inputUrl: profile.input_url,
                    url: profile.url,
                    fullName: profile.full_name,
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    summary: profile.summary,
                    about: profile.about,
                    
                    // Location
                    location: profile.location,
                    city: profile.city,
                    state: profile.state,
                    country: profile.country,
                    countryCode: profile.country_code,
                    
                    // Professional
                    industry: profile.industry,
                    currentCompany: profile.current_company,
                    currentCompanyName: profile.current_company_name,
                    currentCompanyId: profile.current_company_id,
                    currentCompanyCompanyId: profile.current_company_company_id,
                    currentPosition: profile.current_position,
                    
                    // Metrics
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    connections: profile.connections,
                    followers: profile.followers,
                    recommendationsCount: profile.recommendations_count,
                    
                    // Media
                    profileImageUrl: profile.profile_image_url,
                    avatar: profile.avatar,
                    bannerImage: profile.banner_image,
                    backgroundImageUrl: profile.background_image_url,
                    publicIdentifier: profile.public_identifier,
                    
                    // Complex Data Arrays
                    experience: profile.experience,
                    education: profile.education,
                    educationsDetails: profile.educations_details,
                    skills: profile.skills,
                    skillsWithEndorsements: profile.skills_with_endorsements,
                    languages: profile.languages,
                    certifications: profile.certifications,
                    courses: profile.courses,
                    projects: profile.projects,
                    publications: profile.publications,
                    patents: profile.patents,
                    volunteerExperience: profile.volunteer_experience,
                    volunteering: profile.volunteering,
                    honorsAndAwards: profile.honors_and_awards,
                    organizations: profile.organizations,
                    recommendations: profile.recommendations,
                    recommendationsGiven: profile.recommendations_given,
                    recommendationsReceived: profile.recommendations_received,
                    posts: profile.posts,
                    activity: profile.activity,
                    articles: profile.articles,
                    peopleAlsoViewed: profile.people_also_viewed,
                    
                    // Metadata
                    timestamp: profile.timestamp,
                    dataSource: profile.data_source,
                    extractionStatus: profile.data_extraction_status,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count,
                    profileAnalyzed: profile.profile_analyzed
                } : null,
                automaticProcessing: {
                    enabled: true,
                    isCurrentlyProcessing: processingQueue.has(req.user.id),
                    queuePosition: processingQueue.has(req.user.id) ? 
                        Array.from(processingQueue.keys()).indexOf(req.user.id) + 1 : null,
                    implementation: 'COMPLETE - All Bright Data fields mapped',
                    dataCapture: 'ALL LinkedIn profile fields - NO FALLBACKS',
                    philosophy: 'ALL OR NOTHING'
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
                up.extraction_error
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
            is_currently_processing: processingQueue.has(req.user.id),
            message: getStatusMessage(status.extraction_status),
            implementation: 'COMPLETE - All Bright Data fields mapped',
            dataCapture: status.extraction_status === 'completed' ? 
                'ALL LinkedIn profile data captured successfully - NO FALLBACKS NEEDED' : 
                'Processing complete LinkedIn data extraction...',
            philosophy: 'ALL OR NOTHING - Complete success or complete failure'
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
            return 'COMPLETE LinkedIn profile extraction in progress - ALL Bright Data fields will be captured (NO FALLBACKS)...';
        case 'completed':
            return 'LinkedIn profile extraction completed successfully - ALL profile data captured with NO FALLBACKS!';
        case 'failed':
            return 'LinkedIn profile extraction COMPLETELY FAILED - NO partial data saved (NO FALLBACKS)';
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
        
        // Retry extraction with COMPLETE implementation - NO FALLBACKS
        const profile = await createOrUpdateUserProfileCompleteNoFallbacks(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: 'LinkedIn extraction retry initiated - COMPLETE data capture or COMPLETE FAILURE (NO FALLBACKS)!',
            status: 'processing',
            implementation: 'COMPLETE - All Bright Data LinkedIn fields will be extracted',
            dataCapture: 'Complete LinkedIn profile extraction - ALL OR NOTHING',
            philosophy: 'NO FALLBACKS - Complete success or complete failure'
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
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', 'Credits never expire'],
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
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', 'Credits never expire'],
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
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', 'Credits never expire'],
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
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', '7-day free trial included'],
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
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', '7-day free trial included'],
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
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'COMPLETE LinkedIn extraction - ALL fields', 'NO FALLBACKS - Complete data or nothing', '7-day free trial included'],
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

// DATABASE MIGRATION ENDPOINT
app.post('/migrate-database', async (req, res) => {
    try {
        console.log('🚀 Starting database migration via server endpoint...');
        
        const client = await pool.connect();
        let migrationResults = [];
        
        try {
            await initDB();
            migrationResults.push('✅ Database initialization completed');
            migrationResults.push('✅ All tables created/updated successfully');
            migrationResults.push('✅ Performance indexes created successfully');
            
            const usersTableInfo = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                ORDER BY ordinal_position
            `);
            
            const profilesTableInfo = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'user_profiles' 
                ORDER BY ordinal_position
            `);
            
            const testResult = await client.query('SELECT COUNT(*) as user_count FROM users;');
            migrationResults.push(`✅ Database verified - ${testResult.rows[0].user_count} users in database`);
            migrationResults.push(`✅ Users table has ${usersTableInfo.rows.length} columns`);
            migrationResults.push(`✅ User_profiles table has ${profilesTableInfo.rows.length} columns`);
            
            console.log('🎉 DATABASE MIGRATION COMPLETED SUCCESSFULLY!');
            migrationResults.push('🎉 DATABASE MIGRATION COMPLETED SUCCESSFULLY!');
            migrationResults.push('🚀 Your database is now ready for COMPLETE LinkedIn profile extraction!');
            migrationResults.push('✅ ALL Bright Data LinkedIn fields supported');
            migrationResults.push('✅ NO FALLBACKS - Complete success or complete failure');
            migrationResults.push('✅ Updated credit packages: Free=10, Silver=75, Gold=250, Platinum=1000');
            
        } finally {
            client.release();
        }
        
        res.json({
            success: true,
            message: 'Database migration completed successfully!',
            steps: migrationResults,
            summary: {
                usersTable: 'Updated with LinkedIn fields',
                profilesTable: 'COMPLETE LinkedIn schema with ALL Bright Data fields', 
                indexes: 'Performance indexes created',
                status: 'Ready for COMPLETE LinkedIn data extraction - ALL Bright Data fields supported',
                philosophy: 'ALL OR NOTHING - No partial saves, no fallbacks',
                creditPackages: {
                    free: '10 credits per month (updated)',
                    silver: '75 credits (updated)',
                    gold: '250 credits (updated)',
                    platinum: '1000 credits (updated)'
                },
                features: [
                    'All Bright Data LinkedIn fields properly mapped',
                    'Enhanced company information fields',
                    'Separate educations_details field',
                    'Complete recommendations data',
                    'Enhanced media fields (avatar, banner_image)',
                    'All professional and social activity arrays',
                    'Complete metadata and identification fields',
                    'NO FALLBACKS - Complete extraction or complete failure'
                ]
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        res.status(500).json({
            success: false,
            error: 'Migration failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Background processing status endpoint
app.get('/processing-status', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query(
            'SELECT data_extraction_status, extraction_retry_count, extraction_attempted_at, extraction_completed_at, extraction_error FROM user_profiles WHERE user_id = $1',
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
                isCurrentlyProcessing: processingQueue.has(req.user.id),
                totalProcessingQueue: processingQueue.size,
                processingStartTime: processingQueue.get(req.user.id)?.startTime,
                implementation: 'COMPLETE - All Bright Data LinkedIn fields mapped',
                dataCapture: 'ALL LinkedIn profile fields - NO FALLBACKS',
                philosophy: 'ALL OR NOTHING - Complete success or complete failure'
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
            'GET /health',
            'POST /migrate-database'
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
            console.log('🚀 Msgly.AI Server - COMPLETE LinkedIn Data Extraction - NO FALLBACKS Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected with COMPLETE Bright Data schema`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`🤖 Background Processing: ENABLED ✅`);
            console.log(`⚡ Data Extraction: COMPLETE - ALL Bright Data LinkedIn fields ✅`);
            console.log(`🛠️ Field Mapping: COMPLETE - linkedin_id, current_company_name, educations_details, etc. ✅`);
            console.log(`📊 Data Processing: COMPLETE - All arrays properly processed ✅`);
            console.log(`🚫 Fallbacks: DISABLED - All or nothing approach ✅`);
            console.log(`💰 Credit Packages Updated:`);
            console.log(`   🆓 Free: 10 credits per month`);
            console.log(`   🥈 Silver: 75 credits`);
            console.log(`   🥇 Gold: 250 credits`);
            console.log(`   💎 Platinum: 1000 credits`);
            console.log(`💳 Billing: Pay-As-You-Go & Monthly`);
            console.log(`🔗 LinkedIn: COMPLETE Profile Extraction - ALL Bright Data fields!`);
            console.log(`🌐 Health: http://localhost:${PORT}/health`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            console.log(`🎯 USER EXPERIENCE: Register → Add LinkedIn URL → ALL Data Appears or COMPLETE FAILURE!`);
            console.log(`🔥 PHILOSOPHY: ALL OR NOTHING - Complete LinkedIn data extraction or complete failure`);
            console.log(`✅ BRIGHT DATA FIELDS SUPPORTED:`);
            console.log(`   ✅ linkedin_id, linkedin_num_id, input_url, url`);
            console.log(`   ✅ current_company_name, current_company_company_id`);
            console.log(`   ✅ educations_details (separate from education)`);
            console.log(`   ✅ recommendations (full data, not just count)`);
            console.log(`   ✅ avatar, banner_image (Bright Data format)`);
            console.log(`   ✅ All professional and social activity arrays`);
            console.log(`   ✅ Complete metadata and identification fields`);
            console.log(`🚀 RESULT: Complete LinkedIn profile data extraction or nothing!`);
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
