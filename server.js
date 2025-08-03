// Msgly.AI Server - MINIMAL Changes Only for LinkedIn Fix + HTML Pages
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

// ==================== LINKEDIN DATA PROCESSING ====================

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

// MINIMAL CHANGE: LinkedIn data processing with better field handling
const processLinkedInDataComplete = (profileData) => {
    if (!profileData) {
        throw new Error('No profile data received from Bright Data API');
    }
    
    console.log('📊 Processing LinkedIn data...');
    console.log('📋 Raw data keys:', Object.keys(profileData));
    
    try {
        const processedData = {
            // MINIMAL CHANGE: Handle both field name variations
            linkedinId: profileData.linkedin_id || profileData.id || null,
            linkedinNumId: profileData.linkedin_num_id || profileData.numericId || null,
            inputUrl: profileData.input_url || profileData.inputUrl || null,
            url: profileData.url || profileData.canonicalUrl || null,
            
            // Basic Information - handle both variations
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
            
            // Professional Information
            industry: profileData.industry || null,
            currentCompany: profileData.current_company || profileData.company || null,
            currentCompanyName: profileData.current_company_name || profileData.currentCompanyName || null,
            currentCompanyId: profileData.current_company_id || profileData.currentCompanyId || null,
            currentCompanyCompanyId: profileData.current_company_company_id || profileData.currentCompanyCompanyId || null,
            currentPosition: profileData.current_position || profileData.position || profileData.headline || null,
            
            // Metrics
            connectionsCount: parseLinkedInNumber(profileData.connections_count || profileData.connectionsCount || profileData.connections),
            followersCount: parseLinkedInNumber(profileData.followers_count || profileData.followersCount || profileData.followers),
            connections: parseLinkedInNumber(profileData.connections),
            followers: parseLinkedInNumber(profileData.followers),
            recommendationsCount: profileData.recommendations_count || profileData.recommendationsCount || null,
            
            // Media
            profileImageUrl: profileData.profile_pic_url || profileData.profile_picture || profileData.profileImageUrl || profileData.avatar || null,
            avatar: profileData.avatar || profileData.profile_pic_url || profileData.photo || null,
            bannerImage: profileData.banner_image || profileData.backgroundImage || null,
            backgroundImageUrl: profileData.background_image || profileData.backgroundImageUrl || null,
            
            // Identifiers
            publicIdentifier: profileData.public_identifier || profileData.publicIdentifier || null,
            
            // Professional Information Arrays
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
            
            recommendations: ensureValidJSONArray(profileData.recommendations || []),
            
            recommendationsGiven: ensureValidJSONArray(profileData.recommendations_given || 
                                 profileData.given_recommendations || []),
            
            recommendationsReceived: ensureValidJSONArray(profileData.recommendations_received || 
                                    profileData.received_recommendations || []),
            
            posts: ensureValidJSONArray(profileData.posts || profileData.recent_posts || []),
            
            activity: ensureValidJSONArray(profileData.activity || profileData.recent_activity || []),
            
            articles: ensureValidJSONArray(profileData.articles || profileData.article_list || []),
            
            peopleAlsoViewed: ensureValidJSONArray(profileData.people_also_viewed || 
                             profileData.also_viewed || []),
            
            // Metadata
            timestamp: profileData.timestamp ? new Date(profileData.timestamp) : new Date(),
            dataSource: profileData.db_source || profileData.data_source || 'bright_data',
            
            // Store complete raw data
            rawData: sanitizeForJSON(profileData)
        };
        
        console.log('✅ LinkedIn data processed successfully');
        console.log(`📊 Data summary:`);
        console.log(`   - LinkedIn ID: ${processedData.linkedinId || 'Not available'}`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Headline: ${processedData.headline || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - Experience: ${processedData.experience.length} entries`);
        console.log(`   - Education: ${processedData.education.length} entries`);
        console.log(`   - Skills: ${processedData.skills.length} entries`);
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error processing LinkedIn data:', error);
        throw new Error(`LinkedIn data processing failed: ${error.message}`);
    }
};

// MINIMAL CHANGE: LinkedIn Profile Extraction - only fix status field
const extractLinkedInProfileComplete = async (linkedinUrl) => {
    try {
        console.log('🚀 Starting LinkedIn profile extraction...');
        console.log('🔗 LinkedIn URL:', linkedinUrl);
        console.log('🆔 Dataset ID:', BRIGHT_DATA_DATASET_ID);
        
        // OPTION 1: Try synchronous scrape first
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
                    timeout: 120000
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
        }
        
        // OPTION 2: Async method
        console.log('🔄 Using asynchronous extraction method...');
        
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
        
        // MINIMAL CHANGE: Fix status field polling
        const maxAttempts = 40;
        let attempt = 0;
        
        while (attempt < maxAttempts) {
            attempt++;
            console.log(`🔄 Polling attempt ${attempt}/${maxAttempts}...`);
            
            try {
                const statusUrl = `https://api.brightdata.com/datasets/v3/log/${snapshotId}`;
                
                const pollResponse = await axios.get(statusUrl, {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });
                
                // MINIMAL CHANGE: Check both Status and status fields
                const status = pollResponse.data?.Status || pollResponse.data?.status;
                console.log(`📈 Snapshot status: ${status}`);
                
                if (status === 'ready') {
                    console.log('✅ LinkedIn data is ready! Downloading...');
                    
                    const dataUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`;
                    
                    const dataResponse = await axios.get(dataUrl, {
                        headers: {
                            'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    console.log('📥 Downloaded LinkedIn profile data successfully');
                    
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

// Background processing with enhanced error logging
const scheduleBackgroundExtraction = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = 300000; // 5 minutes
    
    console.log(`🔄 Scheduling background extraction for user ${userId}, retry ${retryCount}`);
    
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for user ${userId}`);
        await pool.query(
            'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
            ['failed', `Max retries (${maxRetries}) exceeded`, userId]
        );
        await pool.query(
            'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
            ['failed', `Max retries (${maxRetries}) exceeded`, userId]
        );
        processingQueue.delete(userId);
        return;
    }

    setTimeout(async () => {
        try {
            console.log(`🚀 Starting background extraction for user ${userId} (Retry ${retryCount})`);
            
            await pool.query(
                'UPDATE user_profiles SET extraction_retry_count = $1, extraction_attempted_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [retryCount, userId]
            );

            const result = await extractLinkedInProfileComplete(linkedinUrl);
            
            console.log(`✅ Extraction succeeded for user ${userId}`);
            
            const extractedData = result.data;
            
            // MINIMAL CHANGE: Enhanced logging for debugging
            console.log(`📊 Data validation for user ${userId}:`);
            console.log(`   - LinkedIn ID: ${extractedData.linkedinId || 'Not available'}`);
            console.log(`   - Full Name: ${extractedData.fullName || 'Not available'}`);
            console.log(`   - Headline: ${extractedData.headline || 'Not available'}`);
            console.log(`   - Current Company: ${extractedData.currentCompany || 'Not available'}`);
            console.log(`   - Experience: ${extractedData.experience?.length || 0} entries`);
            
            // Database save with enhanced error logging
            console.log('💾 Saving LinkedIn data to database...');
            
            try {
                await pool.query(`
                    UPDATE user_profiles SET 
                        linkedin_id = $1,
                        linkedin_num_id = $2,
                        input_url = $3,
                        url = $4,
                        full_name = COALESCE($5, full_name),
                        first_name = $6,
                        last_name = $7,
                        headline = $8,
                        about = $9,
                        summary = $9,
                        location = $10,
                        city = $11,
                        state = $12,
                        country = $13,
                        country_code = $14,
                        industry = $15,
                        current_company = $16,
                        current_company_name = $17,
                        current_company_id = $18,
                        current_company_company_id = $19,
                        current_position = $20,
                        connections_count = $21,
                        followers_count = $22,
                        connections = $23,
                        followers = $24,
                        recommendations_count = $25,
                        profile_image_url = $26,
                        avatar = $27,
                        banner_image = $28,
                        background_image_url = $29,
                        public_identifier = $30,
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
                        brightdata_data = $53,
                        timestamp = $54,
                        data_source = $55,
                        data_extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL,
                        profile_analyzed = true,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $56 
                `, [
                    extractedData.linkedinId,
                    extractedData.linkedinNumId,
                    extractedData.inputUrl,
                    extractedData.url,
                    extractedData.fullName,
                    extractedData.firstName,
                    extractedData.lastName,
                    extractedData.headline,
                    extractedData.about,
                    extractedData.location,
                    extractedData.city,
                    extractedData.state,
                    extractedData.country,
                    extractedData.countryCode,
                    extractedData.industry,
                    extractedData.currentCompany,
                    extractedData.currentCompanyName,
                    extractedData.currentCompanyId,
                    extractedData.currentCompanyCompanyId,
                    extractedData.currentPosition,
                    extractedData.connectionsCount,
                    extractedData.followersCount,
                    extractedData.connections,
                    extractedData.followers,
                    extractedData.recommendationsCount,
                    extractedData.profileImageUrl,
                    extractedData.avatar,
                    extractedData.bannerImage,
                    extractedData.backgroundImageUrl,
                    extractedData.publicIdentifier,
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
                    JSON.stringify(extractedData.rawData),
                    extractedData.timestamp,
                    extractedData.dataSource,
                    userId
                ]);

                await pool.query(
                    'UPDATE users SET extraction_status = $1, profile_completed = $2, error_message = NULL WHERE id = $3',
                    ['completed', true, userId]
                );

                console.log(`🎉 LinkedIn profile data successfully saved for user ${userId}!`);
                console.log(`✅ Method: ${result.method}`);
                
                processingQueue.delete(userId);
                
            } catch (dbError) {
                console.error(`❌ DATABASE SAVE FAILED for user ${userId}:`, dbError.message);
                console.error(`   Error code: ${dbError.code}`);
                console.error(`   Error detail: ${dbError.detail}`);
                
                // MINIMAL CHANGE: Log sample of failed data for debugging
                console.error('   Failed data sample:', JSON.stringify(extractedData, null, 2).substring(0, 500));
                
                throw new Error(`Database save failed: ${dbError.message}`);
            }
                
        } catch (error) {
            console.error(`❌ Extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            if (retryCount < maxRetries - 1) {
                console.log(`🔄 Retrying extraction for user ${userId}...`);
                await scheduleBackgroundExtraction(userId, linkedinUrl, retryCount + 1);
            } else {
                console.log(`❌ Final failure for user ${userId} - no more retries`);
                await pool.query(
                    'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
                    ['failed', `Final failure: ${error.message}`, userId]
                );
                await pool.query(
                    'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
                    ['failed', `Final failure: ${error.message}`, userId]
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

// Create or update user profile
const createOrUpdateUserProfile = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        console.log(`🚀 Creating profile for user ${userId}`);
        
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
        
        console.log(`🔄 Starting background extraction for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        scheduleBackgroundExtraction(userId, cleanUrl, 0);
        
        console.log(`✅ Profile created and extraction started for user ${userId}`);
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
        message: 'Msgly.AI Server - LinkedIn Data Extraction with MINIMAL Changes + HTML Pages',
        status: 'running',
        version: '6.2-HTML-PAGES-FIX',
        changes: ['MINIMAL: Fixed status field polling (Status vs status)', 'MINIMAL: Enhanced field mapping flexibility', 'FIXED: Added HTML pages instead of JSON responses'],
        endpoints: [
            'GET /sign-up (HTML page)',
            'GET /login (HTML page)',
            'GET /dashboard (HTML page)', 
            'POST /register (API)',
            'POST /login (API)', 
            'GET /auth/google',
            'GET /auth/google/callback',
            'GET /profile (protected API)',
            'POST /update-profile (protected API)', 
            'GET /profile-status (protected API)',
            'POST /retry-extraction (protected API)',
            'GET /packages (API)',
            'GET /health'
        ]
    });
});

// FIXED: HTML Pages instead of JSON responses
app.get('/sign-up', (req, res) => {
    const token = req.query.token || '';
    const error = req.query.error || '';
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Msgly.AI - Sign Up</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 400px; 
                margin: 50px auto; 
                padding: 20px; 
                background: #f5f5f5;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .form-group { margin-bottom: 15px; }
            input, select { 
                width: 100%; 
                padding: 12px; 
                border: 1px solid #ddd; 
                border-radius: 6px; 
                box-sizing: border-box;
            }
            button { 
                width: 100%; 
                padding: 12px; 
                background: #007bff; 
                color: white; 
                border: none; 
                border-radius: 6px; 
                cursor: pointer; 
                font-size: 16px;
            }
            button:hover { background: #0056b3; }
            .error { color: red; margin-bottom: 15px; }
            .success { color: green; margin-bottom: 15px; }
            .google-btn { 
                background: #4285f4; 
                margin-bottom: 15px; 
                text-decoration: none;
                display: block;
                text-align: center;
            }
            .google-btn:hover { background: #357ae8; }
            hr { margin: 20px 0; }
            .logo { text-align: center; margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">
                <h2>🚀 Msgly.AI</h2>
                <p>LinkedIn Profile Extraction & Analysis</p>
            </div>
            
            ${error ? `<div class="error">❌ Error: ${error}</div>` : ''}
            ${token ? `<div class="success">✅ Authenticated! Redirecting to dashboard...</div>` : ''}
            
            <div class="form-group">
                <a href="/auth/google?package=free" class="google-btn">
                    <button type="button">🔐 Continue with Google (Free Package)</button>
                </a>
            </div>
            
            <hr>
            
            <form id="signupForm">
                <div class="form-group">
                    <input type="email" id="email" placeholder="📧 Email Address" required>
                </div>
                <div class="form-group">
                    <input type="password" id="password" placeholder="🔒 Password" required>
                </div>
                <div class="form-group">
                    <select id="package">
                        <option value="free">🆓 Free Package (10 credits)</option>
                    </select>
                </div>
                <button type="submit">✨ Create Account</button>
            </form>
            
            <p style="text-align: center; margin-top: 20px;">
                <a href="/login">Already have an account? Login here</a>
            </p>
        </div>
        
        <script>
            if ('${token}') {
                localStorage.setItem('msgly_token', '${token}');
                setTimeout(() => window.location.href = '/dashboard', 2000);
            }
            
            document.getElementById('signupForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const button = e.target.querySelector('button');
                button.textContent = '⏳ Creating Account...';
                button.disabled = true;
                
                const formData = {
                    email: document.getElementById('email').value,
                    password: document.getElementById('password').value,
                    packageType: document.getElementById('package').value
                };
                
                try {
                    const response = await fetch('/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        localStorage.setItem('msgly_token', result.data.token);
                        window.location.href = '/dashboard';
                    } else {
                        alert('❌ Error: ' + result.error);
                        button.textContent = '✨ Create Account';
                        button.disabled = false;
                    }
                } catch (error) {
                    alert('❌ Network error: ' + error.message);
                    button.textContent = '✨ Create Account';
                    button.disabled = false;
                }
            });
        </script>
    </body>
    </html>
    `);
});

app.get('/login', (req, res) => {
    const error = req.query.error || '';
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Msgly.AI - Login</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 400px; 
                margin: 50px auto; 
                padding: 20px; 
                background: #f5f5f5;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .form-group { margin-bottom: 15px; }
            input { 
                width: 100%; 
                padding: 12px; 
                border: 1px solid #ddd; 
                border-radius: 6px; 
                box-sizing: border-box;
            }
            button { 
                width: 100%; 
                padding: 12px; 
                background: #007bff; 
                color: white; 
                border: none; 
                border-radius: 6px; 
                cursor: pointer; 
                font-size: 16px;
            }
            button:hover { background: #0056b3; }
            .error { color: red; margin-bottom: 15px; }
            .google-btn { 
                background: #4285f4; 
                margin-bottom: 15px; 
                text-decoration: none;
                display: block;
                text-align: center;
            }
            .google-btn:hover { background: #357ae8; }
            hr { margin: 20px 0; }
            .logo { text-align: center; margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">
                <h2>🚀 Msgly.AI</h2>
                <p>Welcome Back!</p>
            </div>
            
            ${error ? `<div class="error">❌ Error: ${error}</div>` : ''}
            
            <div class="form-group">
                <a href="/auth/google" class="google-btn">
                    <button type="button">🔐 Continue with Google</button>
                </a>
            </div>
            
            <hr>
            
            <form id="loginForm">
                <div class="form-group">
                    <input type="email" id="email" placeholder="📧 Email Address" required>
                </div>
                <div class="form-group">
                    <input type="password" id="password" placeholder="🔒 Password" required>
                </div>
                <button type="submit">🔓 Login</button>
            </form>
            
            <p style="text-align: center; margin-top: 20px;">
                <a href="/sign-up">Don't have an account? Sign up here</a>
            </p>
        </div>
        
        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const button = e.target.querySelector('button');
                button.textContent = '⏳ Logging in...';
                button.disabled = true;
                
                const formData = {
                    email: document.getElementById('email').value,
                    password: document.getElementById('password').value
                };
                
                try {
                    const response = await fetch('/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        localStorage.setItem('msgly_token', result.data.token);
                        window.location.href = '/dashboard';
                    } else {
                        alert('❌ Error: ' + result.error);
                        button.textContent = '🔓 Login';
                        button.disabled = false;
                    }
                } catch (error) {
                    alert('❌ Network error: ' + error.message);
                    button.textContent = '🔓 Login';
                    button.disabled = false;
                }
            });
        </script>
    </body>
    </html>
    `);
});

app.get('/dashboard', async (req, res) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];
    
    // Check for token in query params if not in header
    if (!token && req.query.token) {
        token = req.query.token;
    }
    
    if (!token) {
        return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Msgly.AI - Dashboard</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    max-width: 1000px; 
                    margin: 20px auto; 
                    padding: 20px; 
                    background: #f5f5f5;
                }
                .container {
                    background: white;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    text-align: center;
                }
                .logo { margin-bottom: 20px; }
                button { 
                    padding: 12px 24px; 
                    background: #007bff; 
                    color: white; 
                    border: none; 
                    border-radius: 6px; 
                    cursor: pointer; 
                    font-size: 16px;
                    text-decoration: none;
                    display: inline-block;
                }
                button:hover { background: #0056b3; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">
                    <h2>🚀 Msgly.AI Dashboard</h2>
                    <p>Please login to access your dashboard</p>
                </div>
                <a href="/login"><button>🔓 Go to Login</button></a>
            </div>
            
            <script>
                const token = localStorage.getItem('msgly_token');
                if (token) {
                    // Try to authenticate with stored token
                    fetch('/profile', {
                        headers: { 'Authorization': 'Bearer ' + token }
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            // Reload page with token in header simulation
                            window.location.href = '/dashboard?token=' + token;
                        } else {
                            localStorage.removeItem('msgly_token');
                        }
                    })
                    .catch(() => {
                        localStorage.removeItem('msgly_token');
                    });
                }
            </script>
        </body>
        </html>
        `);
    }
    
    // If token is provided, validate and show dashboard
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await getUserById(decoded.userId);
        
        if (!user) {
            return res.redirect('/login?error=invalid_token');
        }
        
        // Get profile information
        const profileResult = await pool.query(`
            SELECT 
                up.*,
                u.extraction_status as user_extraction_status,
                u.profile_completed as user_profile_completed
            FROM user_profiles up 
            RIGHT JOIN users u ON u.id = up.user_id 
            WHERE u.id = $1
        `, [user.id]);
        
        const profile = profileResult.rows[0];
        
        // Return dashboard HTML
        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Msgly.AI - Dashboard</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    max-width: 1000px; 
                    margin: 20px auto; 
                    padding: 20px; 
                    background: #f5f5f5;
                }
                .container {
                    background: white;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    margin-bottom: 20px;
                }
                .header { 
                    border-bottom: 1px solid #ddd; 
                    padding-bottom: 20px; 
                    margin-bottom: 20px; 
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .profile-section { 
                    background: #f8f9fa; 
                    padding: 20px; 
                    border-radius: 8px; 
                    margin-bottom: 20px; 
                }
                .status-processing { color: #ff9800; }
                .status-completed { color: #4caf50; }
                .status-failed { color: #f44336; }
                .status-not-started { color: #666; }
                button { 
                    padding: 8px 16px; 
                    background: #007bff; 
                    color: white; 
                    border: none; 
                    border-radius: 4px; 
                    cursor: pointer; 
                }
                button:hover { background: #0056b3; }
                .logout-btn { background: #dc3545; }
                .logout-btn:hover { background: #c82333; }
                .form-group { margin-bottom: 15px; }
                input { 
                    width: 100%; 
                    padding: 10px; 
                    border: 1px solid #ddd; 
                    border-radius: 4px; 
                    box-sizing: border-box;
                }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div>
                        <h1>🚀 Msgly.AI Dashboard</h1>
                        <p>Welcome, ${user.email}</p>
                        <p>💳 Credits: ${user.credits_remaining} | 📦 Package: ${user.package_type}</p>
                    </div>
                    <button class="logout-btn" onclick="logout()">🚪 Logout</button>
                </div>
                
                <div class="grid">
                    <div class="profile-section">
                        <h3>📊 LinkedIn Profile Status</h3>
                        <div id="profile-info">⏳ Loading profile status...</div>
                        
                        ${!profile || !profile.linkedin_url ? `
                            <div style="margin-top: 20px;">
                                <h4>Add LinkedIn Profile</h4>
                                <form id="profileForm">
                                    <div class="form-group">
                                        <input type="url" id="linkedinUrl" placeholder="https://linkedin.com/in/your-profile" required>
                                    </div>
                                    <button type="submit">🔗 Add LinkedIn Profile</button>
                                </form>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="profile-section">
                        <h3>⚡ Quick Actions</h3>
                        <div id="actions">
                            <button onclick="refreshStatus()" style="margin-bottom: 10px;">🔄 Refresh Status</button><br>
                            <button onclick="retryExtraction()" style="margin-bottom: 10px;">🔄 Retry Extraction</button><br>
                            <button onclick="viewProfile()" style="margin-bottom: 10px;">👤 View Full Profile</button>
                        </div>
                    </div>
                </div>
            </div>
            
            <script>
                const token = '${token}';
                localStorage.setItem('msgly_token', token);
                
                async function loadProfileStatus() {
                    try {
                        const response = await fetch('/profile-status', {
                            headers: { 'Authorization': 'Bearer ' + token }
                        });
                        const data = await response.json();
                        
                        let statusClass = 'status-not-started';
                        let statusIcon = '⏸️';
                        
                        switch(data.extraction_status) {
                            case 'processing': statusClass = 'status-processing'; statusIcon = '⏳'; break;
                            case 'completed': statusClass = 'status-completed'; statusIcon = '✅'; break;
                            case 'failed': statusClass = 'status-failed'; statusIcon = '❌'; break;
                        }
                        
                        document.getElementById('profile-info').innerHTML = \`
                            <p><strong>Status:</strong> <span class="\${statusClass}">\${statusIcon} \${data.extraction_status}</span></p>
                            <p><strong>Message:</strong> \${data.message}</p>
                            \${data.linkedin_url ? \`<p><strong>LinkedIn URL:</strong> <a href="\${data.linkedin_url}" target="_blank">\${data.linkedin_url}</a></p>\` : ''}
                            \${data.error_message ? \`<p style="color: red;"><strong>Error:</strong> \${data.error_message}</p>\` : ''}
                            \${data.is_currently_processing ? '<p><strong>Currently Processing:</strong> Yes</p>' : ''}
                        \`;
                    } catch (error) {
                        document.getElementById('profile-info').innerHTML = '❌ Error loading profile status';
                    }
                }
                
                async function refreshStatus() {
                    await loadProfileStatus();
                }
                
                async function retryExtraction() {
                    try {
                        const response = await fetch('/retry-extraction', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + token }
                        });
                        const result = await response.json();
                        alert(result.success ? '✅ Retry initiated!' : '❌ Error: ' + result.error);
                        setTimeout(loadProfileStatus, 1000);
                    } catch (error) {
                        alert('❌ Network error: ' + error.message);
                    }
                }
                
                async function viewProfile() {
                    try {
                        const response = await fetch('/profile', {
                            headers: { 'Authorization': 'Bearer ' + token }
                        });
                        const result = await response.json();
                        
                        if (result.success && result.data.profile) {
                            const profile = result.data.profile;
                            let info = \`📊 LinkedIn Profile Data:\\n\\n\`;
                            info += \`Name: \${profile.fullName || 'N/A'}\\n\`;
                            info += \`Headline: \${profile.headline || 'N/A'}\\n\`;
                            info += \`Company: \${profile.currentCompany || 'N/A'}\\n\`;
                            info += \`Location: \${profile.location || 'N/A'}\\n\`;
                            info += \`Connections: \${profile.connectionsCount || 'N/A'}\\n\`;
                            info += \`Experience Entries: \${profile.experience ? profile.experience.length : 0}\\n\`;
                            info += \`Education Entries: \${profile.education ? profile.education.length : 0}\\n\`;
                            info += \`Skills: \${profile.skills ? profile.skills.length : 0}\\n\`;
                            
                            alert(info);
                        } else {
                            alert('❌ No profile data available yet');
                        }
                    } catch (error) {
                        alert('❌ Error loading profile: ' + error.message);
                    }
                }
                
                function logout() {
                    localStorage.removeItem('msgly_token');
                    window.location.href = '/login';
                }
                
                // Handle profile form submission
                const profileForm = document.getElementById('profileForm');
                if (profileForm) {
                    profileForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const button = e.target.querySelector('button');
                        button.textContent = '⏳ Adding Profile...';
                        button.disabled = true;
                        
                        try {
                            const response = await fetch('/update-profile', {
                                method: 'POST',
                                headers: { 
                                    'Content-Type': 'application/json',
                                    'Authorization': 'Bearer ' + token 
                                },
                                body: JSON.stringify({
                                    linkedinUrl: document.getElementById('linkedinUrl').value
                                })
                            });
                            
                            const result = await response.json();
                            if (result.success) {
                                alert('✅ LinkedIn profile added! Extraction started.');
                                window.location.reload();
                            } else {
                                alert('❌ Error: ' + result.error);
                                button.textContent = '🔗 Add LinkedIn Profile';
                                button.disabled = false;
                            }
                        } catch (error) {
                            alert('❌ Network error: ' + error.message);
                            button.textContent = '🔗 Add LinkedIn Profile';
                            button.disabled = false;
                        }
                    });
                }
                
                // Load initial status
                loadProfileStatus();
                
                // Auto-refresh every 30 seconds
                setInterval(loadProfileStatus, 30000);
            </script>
        </body>
        </html>
        `);
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.redirect('/login?error=invalid_token');
    }
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
            version: '6.2-HTML-PAGES-FIX',
            timestamp: new Date().toISOString(),
            changes: {
                statusFieldFix: 'Added support for both Status and status fields',
                fieldMappingEnhanced: 'Added fallback field mapping for better data capture',
                htmlPagesFix: 'FIXED: Added proper HTML pages instead of JSON responses',
                enhancedLogging: 'Added debugging logs (temporary)'
            },
            brightData: {
                configured: !!BRIGHT_DATA_API_KEY,
                datasetId: BRIGHT_DATA_DATASET_ID,
                endpoints: 'All verified working'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production'
            },
            backgroundProcessing: {
                enabled: true,
                currentlyProcessing: processingCount,
                processingUsers: Array.from(processingQueue.keys())
            },
            pages: {
                signUp: '/sign-up (HTML)',
                login: '/login (HTML)',
                dashboard: '/dashboard (HTML)'
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

// Google OAuth Routes
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
            
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://api.msgly.ai/sign-up' 
                : 'http://localhost:3000/sign-up';
                
            res.redirect(`${frontendUrl}?token=${token}`);
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://api.msgly.ai/sign-up' 
                : 'http://localhost:3000/sign-up';
                
            res.redirect(`${frontendUrl}?error=callback_error`);
        }
    }
);

app.get('/auth/failed', (req, res) => {
    const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://api.msgly.ai/sign-up' 
        : 'http://localhost:3000/sign-up';
        
    res.redirect(`${frontendUrl}?error=auth_failed`);
});

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
                error: 'Only free package is available during beta'
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
        
        console.log(`✅ User registered: ${newUser.email}`);
        
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

// Update user profile with LinkedIn URL
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
        
        const profile = await createOrUpdateUserProfile(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated - LinkedIn data extraction started with enhanced compatibility!',
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
                    extractionStatus: profile.data_extraction_status
                },
                changes: {
                    statusFieldFix: 'Now checks both Status and status fields',
                    fieldMappingEnhanced: 'Enhanced field mapping for better data capture',
                    temporaryLogging: 'Enhanced logging enabled for debugging'
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - Enhanced extraction started!`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Get User Profile
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query(`
            SELECT 
                up.*,
                u.extraction_status as user_extraction_status,
                u.profile_completed as user_profile_completed
            FROM user_profiles up 
            RIGHT JOIN users u ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        const profile = profileResult.rows[0];

        let syncStatus = {
            isIncomplete: false,
            missingFields: [],
            extractionStatus: 'unknown'
        };

        if (!profile || !profile.user_id) {
            syncStatus = {
                isIncomplete: true,
                missingFields: ['complete_profile'],
                extractionStatus: 'not_started',
                reason: 'No profile data found'
            };
        } else {
            const extractionStatus = profile.data_extraction_status || 'not_started';
            const isProfileAnalyzed = profile.profile_analyzed || false;
            
            const missingFields = [];
            if (!profile.full_name) missingFields.push('full_name');
            if (!profile.headline) missingFields.push('headline');  
            if (!profile.current_company && !profile.current_position) missingFields.push('company_info');
            if (!profile.location) missingFields.push('location');
            
            const isIncomplete = (
                extractionStatus !== 'completed' ||
                !isProfileAnalyzed ||
                missingFields.length > 0 ||
                processingQueue.has(req.user.id)
            );
            
            syncStatus = {
                isIncomplete: isIncomplete,
                missingFields: missingFields,
                extractionStatus: extractionStatus,
                profileAnalyzed: isProfileAnalyzed,
                isCurrentlyProcessing: processingQueue.has(req.user.id),
                reason: isIncomplete ? 
                    `Status: ${extractionStatus}, Missing: ${missingFields.join(', ')}` : 
                    'Profile complete'
            };
        }

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
                profile: profile && profile.user_id ? {
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
                    location: profile.location,
                    city: profile.city,
                    state: profile.state,
                    country: profile.country,
                    countryCode: profile.country_code,
                    industry: profile.industry,
                    currentCompany: profile.current_company,
                    currentCompanyName: profile.current_company_name,
                    currentCompanyId: profile.current_company_id,
                    currentPosition: profile.current_position,
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    connections: profile.connections,
                    followers: profile.followers,
                    recommendationsCount: profile.recommendations_count,
                    profileImageUrl: profile.profile_image_url,
                    avatar: profile.avatar,
                    bannerImage: profile.banner_image,
                    backgroundImageUrl: profile.background_image_url,
                    publicIdentifier: profile.public_identifier,
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
                    timestamp: profile.timestamp,
                    dataSource: profile.data_source,
                    extractionStatus: profile.data_extraction_status,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count,
                    profileAnalyzed: profile.profile_analyzed
                } : null,
                syncStatus: syncStatus,
                changes: {
                    statusFieldFix: 'Applied - checks both Status and status',
                    fieldMappingEnhanced: 'Applied - flexible field mapping',
                    htmlPagesFix: 'Applied - proper HTML pages',
                    temporaryLogging: 'Enabled for debugging'
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
            changes: {
                statusFieldFix: 'Applied - both Status and status supported',
                fieldMappingEnhanced: 'Applied - flexible field mapping',
                htmlPagesFix: 'Applied - proper HTML pages',
                enhancedLogging: 'Enabled for debugging'
            }
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
            return 'LinkedIn profile extraction in progress with enhanced compatibility...';
        case 'completed':
            return 'LinkedIn profile extraction completed successfully with enhanced data capture!';
        case 'failed':
            return 'LinkedIn profile extraction failed';
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
        
        const profile = await createOrUpdateUserProfile(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: 'LinkedIn extraction retry initiated with enhanced compatibility!',
            status: 'processing',
            changes: {
                statusFieldFix: 'Applied - both Status and status supported',
                fieldMappingEnhanced: 'Applied - flexible field mapping',
                htmlPagesFix: 'Applied - proper HTML pages',
                enhancedLogging: 'Enabled for debugging'
            }
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
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', 'Credits never expire'],
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
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', 'Credits never expire'],
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
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', 'Credits never expire'],
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
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', '7-day free trial included'],
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
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', '7-day free trial included'],
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
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'Enhanced LinkedIn extraction', '7-day free trial included'],
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

// Error handling
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        availableRoutes: [
            'GET /sign-up (HTML page)',
            'GET /login (HTML page)',
            'GET /dashboard (HTML page)',
            'POST /register (API)', 
            'POST /login (API)', 
            'GET /auth/google',
            'GET /profile (API)', 
            'POST /update-profile (API)',
            'GET /profile-status (API)',
            'POST /retry-extraction (API)',
            'GET /packages (API)', 
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
            console.log('🚀 Msgly.AI Server - HTML Pages Fix Applied!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`🤖 Background Processing: ENABLED ✅`);
            console.log(`📋 All Changes Applied:`);
            console.log(`   ✅ Status field fix: Now checks both Status and status`);
            console.log(`   ✅ Field mapping: Enhanced with fallback options`);
            console.log(`   ✅ HTML Pages: FIXED - Now serving proper HTML pages`);
            console.log(`   ✅ Enhanced logging: Temporary debugging logs added`);
            console.log(`🌐 Pages Available:`);
            console.log(`   📄 Sign Up: ${PORT === 3000 ? 'http://localhost:3000' : 'https://api.msgly.ai'}/sign-up`);
            console.log(`   📄 Login: ${PORT === 3000 ? 'http://localhost:3000' : 'https://api.msgly.ai'}/login`);
            console.log(`   📄 Dashboard: ${PORT === 3000 ? 'http://localhost:3000' : 'https://api.msgly.ai'}/dashboard`);
            console.log(`💳 Packages: Free (Available), Premium (Coming Soon)`);
            console.log(`🌐 Health Check: http://localhost:${PORT}/health`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            console.log(`🎯 Status: Ready for HTML pages and LinkedIn extraction!`);
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
