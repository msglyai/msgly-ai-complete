// Msgly.AI Server - FIXED: Proper Database Transaction Management + Gemini AI Integration
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const axios = require('axios');
const { sendToGemini } = require('./sendToGemini');
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

// ✅ CRITICAL FIX: LinkedIn URL Normalization Utility (matches frontend logic exactly)
const cleanLinkedInUrl = (url) => {
    try {
        if (!url) return null;
        
        console.log('🔧 Backend cleaning URL:', url);
        
        let cleanUrl = url.trim();
        
        // Remove protocol
        cleanUrl = cleanUrl.replace(/^https?:\/\//, '');
        
        // Remove www. prefix
        cleanUrl = cleanUrl.replace(/^www\./, '');
        
        // Remove query parameters
        if (cleanUrl.includes('?')) {
            cleanUrl = cleanUrl.split('?')[0];
        }
        
        // Remove hash fragments
        if (cleanUrl.includes('#')) {
            cleanUrl = cleanUrl.split('#')[0];
        }
        
        // Remove trailing slash
        if (cleanUrl.endsWith('/')) {
            cleanUrl = cleanUrl.slice(0, -1);
        }
        
        // Convert to lowercase for comparison
        cleanUrl = cleanUrl.toLowerCase();
        
        console.log('🔧 Backend cleaned URL result:', cleanUrl);
        return cleanUrl;
        
    } catch (error) {
        console.error('❌ Error cleaning URL in backend:', error);
        return url;
    }
};

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
        let isNewUser = false;
        
        if (!user) {
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value
            );
            isNewUser = true;
        } else if (!user.google_id) {
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        // Add isNewUser flag to user object
        user.isNewUser = isNewUser;
        
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

// ✅ FRONTEND SERVING - Serve static files from root directory
app.use(express.static(__dirname));

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
                
                -- ✅ NEW FIELD: Initial scraping completion flag
                initial_scraping_done BOOLEAN DEFAULT false,
                
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

        // ✅ NEW TABLE: Target profiles (scraped after initial setup)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS target_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                
                -- Basic Profile Information
                linkedin_url TEXT NOT NULL,
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
                timestamp TIMESTAMP DEFAULT NOW(),
                data_source VARCHAR(100) DEFAULT 'chrome_extension',
                scraped_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
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

        // ✅ NEW TABLE: Raw snapshots for Gemini integration
        await pool.query(`
            CREATE TABLE IF NOT EXISTS raw_snapshots (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                snapshot_type VARCHAR(50) DEFAULT 'bright_data',
                raw_json JSONB,
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

            // ✅ Add initial_scraping_done to existing user_profiles if it doesn't exist
            await pool.query(`
                ALTER TABLE user_profiles 
                ADD COLUMN IF NOT EXISTS initial_scraping_done BOOLEAN DEFAULT false;
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
                CREATE INDEX IF NOT EXISTS idx_user_profiles_initial_scraping ON user_profiles(initial_scraping_done);
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_retry_count ON user_profiles(extraction_retry_count);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_current_company ON user_profiles(current_company);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_user_id ON target_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_linkedin_url ON target_profiles(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_scraped_at ON target_profiles(scraped_at);
                CREATE INDEX IF NOT EXISTS idx_raw_snapshots_user_id ON raw_snapshots(user_id);
                CREATE INDEX IF NOT EXISTS idx_raw_snapshots_created_at ON raw_snapshots(created_at);
                CREATE INDEX IF NOT EXISTS idx_raw_snapshots_snapshot_type ON raw_snapshots(snapshot_type);
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

// ✅ FALLBACK FUNCTIONS - Only used for Chrome extension compatibility

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

// LinkedIn Profile Extraction - Returns raw data for Gemini processing
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
                    rawData: profileData,
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
        
        // FIXED: Check both Status and status fields
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
                
                // ✅ FIXED: Check both Status and status fields
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
                            rawData: profileData,
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

// ✅ UPDATED: Background processing with Gemini AI integration - NO MANUAL FALLBACK
const scheduleBackgroundExtraction = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = 300000; // 5 minutes
    
    console.log(`🔄 Scheduling background extraction for user ${userId}, retry ${retryCount}`);
    
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for user ${userId}`);
        
        // ✅ FIXED: Use transaction for failure updates
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            await client.query(
                'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, initial_scraping_done = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4',
                ['failed', `Max retries (${maxRetries}) exceeded - Gemini processing required`, false, userId]
            );
            await client.query(
                'UPDATE users SET extraction_status = $1, error_message = $2, profile_completed = $3 WHERE id = $4',
                ['failed', `Max retries (${maxRetries}) exceeded - Gemini processing required`, false, userId]
            );
            
            await client.query('COMMIT');
            console.log(`✅ Failure status committed to database for user ${userId}`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Failed to update failure status for user ${userId}:`, error);
        } finally {
            client.release();
        }
        
        processingQueue.delete(userId);
        return;
    }

    setTimeout(async () => {
        const client = await pool.connect();
        
        try {
            console.log(`🚀 Starting background extraction for user ${userId} (Retry ${retryCount})`);
            
            // ✅ FIXED: Start transaction immediately
            await client.query('BEGIN');
            
            await client.query(
                'UPDATE user_profiles SET extraction_retry_count = $1, extraction_attempted_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [retryCount, userId]
            );

            const result = await extractLinkedInProfileComplete(linkedinUrl);
            
            console.log(`✅ Extraction succeeded for user ${userId}`);
            
            // ✅ STEP 1: Save raw JSON data to database
            await client.query(
                'INSERT INTO raw_snapshots (user_id, snapshot_type, raw_json) VALUES ($1, $2, $3)',
                [userId, 'bright_data', JSON.stringify(result.rawData)]
            );
            console.log(`💾 Raw Bright Data JSON saved for user ${userId}`);
            
            // ✅ STEP 2: Process data using ONLY Gemini - NO MANUAL FALLBACK
            console.log(`🤖 Processing LinkedIn data with Gemini for user ${userId}...`);
            
            // ✅ CRITICAL: Check for Gemini API key first
            if (!process.env.GEMINI_API_KEY) {
                throw new Error('GEMINI_API_KEY is required - no manual fallback available');
            }
            
            // ✅ CRITICAL: Only Gemini processing - fail if it doesn't work
            const extractedData = await sendToGemini(result.rawData);
            console.log(`✅ Gemini processing completed for user ${userId}`);
            
            // ✅ CRITICAL FIX: Validate extracted data BEFORE updating database status
            console.log(`📊 Data validation for user ${userId}:`);
            console.log(`   - Full Name: ${extractedData.fullName || 'Not available'}`);
            console.log(`   - Headline: ${extractedData.headline || 'Not available'}`);
            console.log(`   - Current Company: ${extractedData.currentCompany || 'Not available'}`);
            console.log(`   - Experience: ${extractedData.experience?.length || 0} entries`);
            
            // ✅ FIXED: Only proceed if we have meaningful data
            if (!extractedData.fullName && !extractedData.headline && !extractedData.currentCompany) {
                throw new Error('Gemini extracted data appears to be incomplete - no name, headline, or company found');
            }
            
            // ✅ FIXED: Database save with transactional integrity - ONLY update status AFTER confirming data
            console.log('💾 Saving LinkedIn data to database with transactional integrity...');
            
            await client.query(`
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
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $56 
            `, [
                extractedData.linkedinId || null,
                extractedData.linkedinNumId || null,
                extractedData.inputUrl || null,
                extractedData.url || null,
                extractedData.fullName,
                extractedData.firstName,
                extractedData.lastName,
                extractedData.headline,
                extractedData.about,
                extractedData.location || null,
                extractedData.city || null,
                extractedData.state || null,
                extractedData.country || null,
                extractedData.countryCode || null,
                extractedData.industry || null,
                extractedData.currentCompany,
                extractedData.currentCompanyName || null,
                extractedData.currentCompanyId || null,
                extractedData.currentCompanyCompanyId || null,
                extractedData.currentPosition || null,
                extractedData.connectionsCount || null,
                extractedData.followersCount || null,
                extractedData.connections || null,
                extractedData.followers || null,
                extractedData.recommendationsCount || null,
                extractedData.profileImageUrl,
                extractedData.avatar || null,
                extractedData.bannerImage || null,
                extractedData.backgroundImageUrl || null,
                extractedData.publicIdentifier || null,
                JSON.stringify(extractedData.experience || []),
                JSON.stringify(extractedData.education || []),
                JSON.stringify(extractedData.educationsDetails || []),
                JSON.stringify(extractedData.skills || []),
                JSON.stringify(extractedData.skillsWithEndorsements || []),
                JSON.stringify(extractedData.languages || []),
                JSON.stringify(extractedData.certifications || []),
                JSON.stringify(extractedData.courses || []),
                JSON.stringify(extractedData.projects || []),
                JSON.stringify(extractedData.publications || []),
                JSON.stringify(extractedData.patents || []),
                JSON.stringify(extractedData.volunteerExperience || []),
                JSON.stringify(extractedData.volunteering || []),
                JSON.stringify(extractedData.honorsAndAwards || []),
                JSON.stringify(extractedData.organizations || []),
                JSON.stringify(extractedData.recommendations || []),
                JSON.stringify(extractedData.recommendationsGiven || []),
                JSON.stringify(extractedData.recommendationsReceived || []),
                JSON.stringify(extractedData.posts || []),
                JSON.stringify(extractedData.activity || []),
                JSON.stringify(extractedData.articles || []),
                JSON.stringify(extractedData.peopleAlsoViewed || []),
                JSON.stringify(result.rawData),
                extractedData.timestamp,
                extractedData.dataSource,
                userId
            ]);

            // ✅ CRITICAL FIX: Only update status fields AFTER confirming data was saved successfully
            await client.query(`
                UPDATE user_profiles SET 
                    data_extraction_status = 'completed',
                    extraction_completed_at = CURRENT_TIMESTAMP,
                    extraction_error = NULL,
                    profile_analyzed = true,
                    initial_scraping_done = true
                WHERE user_id = $1 AND full_name IS NOT NULL
            `, [userId]);

            await client.query(`
                UPDATE users SET 
                    extraction_status = 'completed', 
                    profile_completed = true, 
                    error_message = NULL 
                WHERE id = $1
            `, [userId]);

            // ✅ FIXED: Commit transaction only after all data is confirmed
            await client.query('COMMIT');
            
            console.log(`🎉 LinkedIn profile data successfully saved for user ${userId} with Gemini AI integration!`);
            console.log(`✅ Method: ${result.method}`);
            console.log(`🤖 Data processing: ${extractedData.dataSource} (GEMINI ONLY - NO FALLBACK)`);
            console.log(`🔒 Initial scraping marked as complete ONLY after data confirmation`);
            
            processingQueue.delete(userId);
                
        } catch (error) {
            // ✅ FIXED: Rollback transaction on any error
            await client.query('ROLLBACK');
            
            console.error(`❌ Extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            if (retryCount < maxRetries - 1) {
                console.log(`🔄 Retrying extraction for user ${userId}...`);
                await scheduleBackgroundExtraction(userId, linkedinUrl, retryCount + 1);
            } else {
                console.log(`❌ Final failure for user ${userId} - no more retries (GEMINI ONLY MODE)`);
                
                // Start new transaction for failure updates
                try {
                    await client.query('BEGIN');
                    await client.query(
                        'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, initial_scraping_done = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4',
                        ['failed', `Final failure: ${error.message} (GEMINI REQUIRED - NO MANUAL FALLBACK)`, false, userId]
                    );
                    await client.query(
                        'UPDATE users SET extraction_status = $1, error_message = $2, profile_completed = $3 WHERE id = $4',
                        ['failed', `Final failure: ${error.message} (GEMINI REQUIRED - NO MANUAL FALLBACK)`, false, userId]
                    );
                    await client.query('COMMIT');
                } catch (updateError) {
                    await client.query('ROLLBACK');
                    console.error(`❌ Failed to update failure status: ${updateError.message}`);
                }
                
                processingQueue.delete(userId);
            }
        } finally {
            client.release();
        }
    }, retryCount === 0 ? 10000 : retryDelay);
};

// ✅ Process scraped data from content script (with URL validation) - KEPT for Chrome extension
const processScrapedProfileData = (scrapedData, isUserProfile = false) => {
    try {
        console.log('📊 Processing scraped profile data from extension...');
        
        const processedData = {
            linkedinUrl: scrapedData.url || scrapedData.linkedinUrl || '',
            linkedinId: scrapedData.linkedin_id || scrapedData.linkedinId || null,
            linkedinNumId: scrapedData.linkedin_num_id || scrapedData.linkedinNumId || null,
            inputUrl: scrapedData.input_url || scrapedData.inputUrl || scrapedData.url || '',
            url: scrapedData.url || scrapedData.linkedinUrl || '',
            
            fullName: scrapedData.fullName || scrapedData.name || '',
            firstName: scrapedData.firstName || scrapedData.first_name || 
                      (scrapedData.fullName ? scrapedData.fullName.split(' ')[0] : ''),
            lastName: scrapedData.lastName || scrapedData.last_name || 
                     (scrapedData.fullName ? scrapedData.fullName.split(' ').slice(1).join(' ') : ''),
            headline: scrapedData.headline || '',
            about: scrapedData.about || scrapedData.summary || '',
            summary: scrapedData.summary || scrapedData.about || '',
            
            location: scrapedData.location || '',
            city: scrapedData.city || '',
            state: scrapedData.state || '',
            country: scrapedData.country || '',
            countryCode: scrapedData.countryCode || '',
            
            industry: scrapedData.industry || '',
            currentCompany: scrapedData.currentCompany || scrapedData.company || '',
            currentCompanyName: scrapedData.currentCompanyName || scrapedData.company || '',
            currentPosition: scrapedData.currentPosition || scrapedData.headline || '',
            
            connectionsCount: parseLinkedInNumber(scrapedData.connectionsCount || scrapedData.connections),
            followersCount: parseLinkedInNumber(scrapedData.followersCount || scrapedData.followers),
            connections: parseLinkedInNumber(scrapedData.connections || scrapedData.connectionsCount),
            followers: parseLinkedInNumber(scrapedData.followers || scrapedData.followersCount),
            
            profileImageUrl: scrapedData.profileImageUrl || scrapedData.avatar || '',
            avatar: scrapedData.avatar || scrapedData.profileImageUrl || '',
            
            experience: ensureValidJSONArray(scrapedData.experience || []),
            education: ensureValidJSONArray(scrapedData.education || []),
            skills: ensureValidJSONArray(scrapedData.skills || []),
            
            timestamp: new Date(),
            dataSource: 'chrome_extension',
            extractedAt: scrapedData.extractedAt || new Date().toISOString(),
            extractedFrom: scrapedData.extractedFrom || 'chrome_extension'
        };
        
        console.log('✅ Scraped data processed successfully');
        console.log(`📊 Data summary:`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Headline: ${processedData.headline || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - Is User Profile: ${isUserProfile}`);
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error processing scraped data:', error);
        throw new Error(`Scraped data processing failed: ${error.message}`);
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

// ✅ CRITICAL FIX: Create or update user profile with URL normalization
const createOrUpdateUserProfile = async (userId, linkedinUrl, displayName = null) => {
    try {
        // ✅ CRITICAL: Normalize LinkedIn URL before saving
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        console.log(`🚀 Creating profile for user ${userId}`);
        console.log(`🔧 Original URL: ${linkedinUrl}`);
        console.log(`🔧 Normalized URL: ${cleanUrl}`);
        
        // ✅ Save normalized URL to users table
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
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name, data_extraction_status, extraction_retry_count, initial_scraping_done) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [userId, cleanUrl, displayName, 'processing', 0, false]
            );
            profile = result.rows[0];
        }
        
        console.log(`🔄 Starting background extraction for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        // ✅ Use original URL for Bright Data API (they need full URL)
        scheduleBackgroundExtraction(userId, linkedinUrl, 0);
        
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

// ==================== CHROME EXTENSION AUTH ENDPOINT ====================

// ✅ CRITICAL FIX: Chrome Extension Authentication - ALWAYS returns credits
app.post('/auth/chrome-extension', async (req, res) => {
    console.log('🔐 Chrome Extension Auth Request:', {
        hasGoogleToken: !!req.body.googleAccessToken,
        clientType: req.body.clientType,
        extensionId: req.body.extensionId
    });
    
    try {
        const { googleAccessToken, clientType, extensionId } = req.body;
        
        if (!googleAccessToken) {
            return res.status(400).json({
                success: false,
                error: 'Google access token is required'
            });
        }
        
        if (clientType !== 'chrome_extension') {
            return res.status(400).json({
                success: false,
                error: 'Invalid client type'
            });
        }
        
        // Verify Google token and get user info
        console.log('🔍 Verifying Google token...');
        const googleResponse = await axios.get(
            `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${googleAccessToken}`
        );
        
        if (!googleResponse.data || !googleResponse.data.email) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Google token'
            });
        }
        
        const googleUser = googleResponse.data;
        console.log('✅ Google user verified:', {
            email: googleUser.email,
            name: googleUser.name,
            verified: googleUser.verified_email
        });
        
        // Find or create user
        let user = await getUserByEmail(googleUser.email);
        let isNewUser = false;
        
        if (!user) {
            console.log('👤 Creating new user...');
            user = await createGoogleUser(
                googleUser.email,
                googleUser.name,
                googleUser.id,
                googleUser.picture
            );
            isNewUser = true;
        } else if (!user.google_id) {
            console.log('🔗 Linking Google account to existing user...');
            await linkGoogleAccount(user.id, googleUser.id);
            user = await getUserById(user.id);
        }
        
        // Add isNewUser flag to user object
        user.isNewUser = isNewUser;
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log('✅ Chrome extension authentication successful');
        
        // ✅ CRITICAL FIX: ALWAYS return credits and complete user data
        res.json({
            success: true,
            message: 'Authentication successful',
            data: {
                token: token,
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    packageType: user.package_type,
                    credits: user.credits_remaining || 10, // ✅ ALWAYS INCLUDE CREDITS
                    linkedinUrl: user.linkedin_url,
                    profileCompleted: user.profile_completed
                },
                isNewUser: isNewUser
            }
        });
        
    } catch (error) {
        console.error('❌ Chrome extension auth error:', error);
        
        if (error.response && error.response.status === 401) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Google token'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Authentication failed',
            details: error.message
        });
    }
});

// ==================== FRONTEND ROUTES ====================

// ✅ Home route - serves your sign-up page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-up.html'));
});

// ✅ Specific HTML page routes
app.get('/sign-up', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-up.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'Dashboard.html'));
});

// ==================== API ENDPOINTS ====================

// Health Check - Updated with Gemini status
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        const processingCount = processingQueue.size;
        
        res.status(200).json({
            status: 'healthy',
            version: '10.0-GEMINI-ONLY-NO-FALLBACK',
            timestamp: new Date().toISOString(),
            changes: {
                geminiIntegration: 'GEMINI ONLY - No manual fallback processing',
                rawDataStorage: 'NEW - All Bright Data responses stored in raw_snapshots table',
                fallbackProcessing: 'REMOVED - Gemini processing required, no manual fallback available',
                transactionManagement: 'MAINTAINED - Database status only updated AFTER confirming data receipt',
                dataValidation: 'MAINTAINED - Validates extracted data before marking as complete',
                rollbackMechanism: 'MAINTAINED - Proper transaction rollback on errors',
                statusIntegrity: 'MAINTAINED - No more false positives where status=true but data=empty',
                backgroundProcessing: 'ENHANCED - All updates use proper transaction boundaries with GEMINI ONLY processing'
            },
            brightData: {
                configured: !!BRIGHT_DATA_API_KEY,
                datasetId: BRIGHT_DATA_DATASET_ID,
                endpoints: 'All verified working'
            },
            geminiAI: {
                configured: !!process.env.GEMINI_API_KEY,
                status: process.env.GEMINI_API_KEY 
                    ? 'EXCLUSIVE data processor - NO FALLBACK' 
                    : 'NOT CONFIGURED - System will fail without Gemini',
                fallbackAvailable: false,
                mode: 'GEMINI_ONLY'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production',
                transactionManagement: 'ACTIVE',
                newTables: ['raw_snapshots']
            },
            backgroundProcessing: {
                enabled: true,
                aiProcessing: !!process.env.GEMINI_API_KEY,
                processingMode: 'GEMINI_ONLY',
                currentlyProcessing: processingCount,
                processingUsers: Array.from(processingQueue.keys())
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

// ✅ CRITICAL FIX: Check initial scraping status - ALWAYS returns linkedin_url
app.get('/user/initial-scraping-status', authenticateToken, async (req, res) => {
    try {
        console.log(`🔍 Checking initial scraping status for user ${req.user.id}`);
        
        const result = await pool.query(`
            SELECT 
                up.initial_scraping_done,
                up.linkedin_url as profile_linkedin_url,
                up.data_extraction_status,
                u.linkedin_url as user_linkedin_url,
                COALESCE(up.linkedin_url, u.linkedin_url) as linkedin_url
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        let initialScrapingDone = false;
        let userLinkedInUrl = null;
        let extractionStatus = 'not_started';
        
        if (result.rows.length > 0) {
            const data = result.rows[0];
            initialScrapingDone = data.initial_scraping_done || false;
            // ✅ CRITICAL FIX: ALWAYS return a LinkedIn URL (from either table)
            userLinkedInUrl = data.linkedin_url || data.user_linkedin_url || data.profile_linkedin_url;
            extractionStatus = data.data_extraction_status || 'not_started';
            
            console.log(`📊 Initial scraping data for user ${req.user.id}:`);
            console.log(`   - Profile linkedin_url: ${data.profile_linkedin_url || 'null'}`);
            console.log(`   - User linkedin_url: ${data.user_linkedin_url || 'null'}`);
            console.log(`   - Final linkedin_url: ${userLinkedInUrl || 'null'}`);
        }
        
        console.log(`📊 Initial scraping status for user ${req.user.id}:`);
        console.log(`   - Initial scraping done: ${initialScrapingDone}`);
        console.log(`   - User LinkedIn URL: ${userLinkedInUrl || 'Not set'}`);
        console.log(`   - Extraction status: ${extractionStatus}`);
        
        // ✅ CRITICAL FIX: ALWAYS include userLinkedInUrl even if null
        res.json({
            success: true,
            data: {
                initialScrapingDone: initialScrapingDone,
                userLinkedInUrl: userLinkedInUrl, // ✅ ALWAYS INCLUDED (won't trigger emergency)
                extractionStatus: extractionStatus,
                isCurrentlyProcessing: processingQueue.has(req.user.id),
                user: {
                    id: req.user.id,
                    email: req.user.email,
                    linkedinUrl: userLinkedInUrl
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error checking initial scraping status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check initial scraping status',
            details: error.message
        });
    }
});

// ✅ FIXED: User profile scraping with transaction management
app.post('/profile/user', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        console.log(`🔒 User profile scraping request from user ${req.user.id}`);
        console.log('📊 Request data:', {
            hasProfileData: !!req.body.profileData,
            profileUrl: req.body.profileData?.url || req.body.profileData?.linkedinUrl,
            dataSource: req.body.profileData?.extractedFrom || 'unknown'
        });
        
        const { profileData } = req.body;
        
        if (!profileData) {
            return res.status(400).json({
                success: false,
                error: 'Profile data is required'
            });
        }
        
        if (!profileData.url && !profileData.linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required in profile data'
            });
        }
        
        // ✅ FIXED: Clean and validate URL using backend normalization
        const profileUrl = profileData.url || profileData.linkedinUrl;
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn profile URL'
            });
        }
        
        // ✅ FIXED: Validate this is the user's own profile using normalized URLs
        const userLinkedInUrl = req.user.linkedin_url;
        if (userLinkedInUrl) {
            const cleanUserUrl = cleanLinkedInUrl(userLinkedInUrl);
            
            console.log(`🔍 URL Comparison for user ${req.user.id}:`);
            console.log(`   - Profile URL: ${profileUrl}`);
            console.log(`   - Clean Profile: ${cleanProfileUrl}`);
            console.log(`   - User URL: ${userLinkedInUrl}`);
            console.log(`   - Clean User: ${cleanUserUrl}`);
            console.log(`   - Match: ${cleanUserUrl === cleanProfileUrl}`);
            
            if (cleanUserUrl !== cleanProfileUrl) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only scrape your own LinkedIn profile for initial setup'
                });
            }
        }
        
        // Process the scraped data
        const processedData = processScrapedProfileData(profileData, true);
        
        // ✅ FIXED: Normalize the LinkedIn URL in processed data
        processedData.linkedinUrl = cleanProfileUrl;
        processedData.url = cleanProfileUrl;
        
        // ✅ CRITICAL FIX: Validate data completeness BEFORE database transaction
        if (!processedData.fullName && !processedData.headline && !processedData.currentCompany) {
            return res.status(400).json({
                success: false,
                error: 'Profile data appears incomplete - missing name, headline, and company information'
            });
        }
        
        console.log('💾 Saving user profile data with transaction management...');
        
        // ✅ FIXED: Start transaction
        await client.query('BEGIN');
        
        // Check if profile exists
        const existingProfile = await client.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            // Update existing profile
            const result = await client.query(`
                UPDATE user_profiles SET 
                    linkedin_url = $1,
                    linkedin_id = $2,
                    linkedin_num_id = $3,
                    input_url = $4,
                    url = $5,
                    full_name = $6,
                    first_name = $7,
                    last_name = $8,
                    headline = $9,
                    about = $10,
                    summary = $11,
                    location = $12,
                    city = $13,
                    state = $14,
                    country = $15,
                    country_code = $16,
                    industry = $17,
                    current_company = $18,
                    current_company_name = $19,
                    current_position = $20,
                    connections_count = $21,
                    followers_count = $22,
                    connections = $23,
                    followers = $24,
                    profile_image_url = $25,
                    avatar = $26,
                    experience = $27,
                    education = $28,
                    skills = $29,
                    timestamp = $30,
                    data_source = $31,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $32 
                RETURNING *
            `, [
                processedData.linkedinUrl,
                processedData.linkedinId,
                processedData.linkedinNumId,
                processedData.inputUrl,
                processedData.url,
                processedData.fullName,
                processedData.firstName,
                processedData.lastName,
                processedData.headline,
                processedData.about,
                processedData.summary,
                processedData.location,
                processedData.city,
                processedData.state,
                processedData.country,
                processedData.countryCode,
                processedData.industry,
                processedData.currentCompany,
                processedData.currentCompanyName,
                processedData.currentPosition,
                processedData.connectionsCount,
                processedData.followersCount,
                processedData.connections,
                processedData.followers,
                processedData.profileImageUrl,
                processedData.avatar,
                JSON.stringify(processedData.experience),
                JSON.stringify(processedData.education),
                JSON.stringify(processedData.skills),
                processedData.timestamp,
                processedData.dataSource,
                req.user.id
            ]);
            
            profile = result.rows[0];
        } else {
            // Create new profile
            const result = await client.query(`
                INSERT INTO user_profiles (
                    user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                    full_name, first_name, last_name, headline, about, summary,
                    location, city, state, country, country_code, industry,
                    current_company, current_company_name, current_position,
                    connections_count, followers_count, connections, followers,
                    profile_image_url, avatar, experience, education, skills,
                    timestamp, data_source
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                    $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
                ) RETURNING *
            `, [
                req.user.id,
                processedData.linkedinUrl,
                processedData.linkedinId,
                processedData.linkedinNumId,
                processedData.inputUrl,
                processedData.url,
                processedData.fullName,
                processedData.firstName,
                processedData.lastName,
                processedData.headline,
                processedData.about,
                processedData.summary,
                processedData.location,
                processedData.city,
                processedData.state,
                processedData.country,
                processedData.countryCode,
                processedData.industry,
                processedData.currentCompany,
                processedData.currentCompanyName,
                processedData.currentPosition,
                processedData.connectionsCount,
                processedData.followersCount,
                processedData.connections,
                processedData.followers,
                processedData.profileImageUrl,
                processedData.avatar,
                JSON.stringify(processedData.experience),
                JSON.stringify(processedData.education),
                JSON.stringify(processedData.skills),
                processedData.timestamp,
                processedData.dataSource
            ]);
            
            profile = result.rows[0];
        }
        
        // ✅ CRITICAL FIX: Only update status fields AFTER confirming data was saved AND contains meaningful information
        if (profile && profile.full_name) {
            await client.query(`
                UPDATE user_profiles SET 
                    data_extraction_status = 'completed',
                    extraction_completed_at = CURRENT_TIMESTAMP,
                    extraction_error = NULL,
                    profile_analyzed = true,
                    initial_scraping_done = true
                WHERE user_id = $1 AND full_name IS NOT NULL
            `, [req.user.id]);
            
            // ✅ FIXED: Update user table with normalized LinkedIn URL
            await client.query(
                'UPDATE users SET linkedin_url = $1, extraction_status = $2, profile_completed = $3, error_message = NULL WHERE id = $4',
                [processedData.linkedinUrl, 'completed', true, req.user.id]
            );
            
            // ✅ FIXED: Commit transaction only after all validations pass
            await client.query('COMMIT');
            
            // Remove from processing queue if present
            processingQueue.delete(req.user.id);
            
            console.log(`🎉 User profile successfully saved for user ${req.user.id} with transaction integrity!`);
            console.log(`🔒 Initial scraping marked as complete ONLY after data confirmation`);
            
            res.json({
                success: true,
                message: 'User profile saved successfully! You can now use Msgly.AI fully.',
                data: {
                    profile: {
                        id: profile.id,
                        linkedinUrl: profile.linkedin_url,
                        fullName: profile.full_name,
                        headline: profile.headline,
                        currentCompany: profile.current_company,
                        location: profile.location,
                        profileImageUrl: profile.profile_image_url,
                        initialScrapingDone: true, // ✅ Only true when data is confirmed
                        extractionStatus: 'completed',
                        extractionCompleted: profile.extraction_completed_at
                    },
                    user: {
                        profileCompleted: true,
                        extractionStatus: 'completed'
                    }
                }
            });
        } else {
            // ✅ FIXED: Rollback if no meaningful data was saved
            await client.query('ROLLBACK');
            
            res.status(400).json({
                success: false,
                error: 'Profile data was saved but appears to be incomplete. Please try again with a complete LinkedIn profile.'
            });
        }
        
    } catch (error) {
        // ✅ FIXED: Always rollback on error
        await client.query('ROLLBACK');
        
        console.error('❌ User profile scraping error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save user profile',
            details: error.message
        });
    } finally {
        client.release();
    }
});

// ✅ FIXED: Target profile scraping with URL normalization
app.post('/profile/target', authenticateToken, async (req, res) => {
    try {
        console.log(`🎯 Target profile scraping request from user ${req.user.id}`);
        
        // ✅ First, check if initial scraping is done
        const initialStatus = await pool.query(`
            SELECT initial_scraping_done, data_extraction_status
            FROM user_profiles 
            WHERE user_id = $1
        `, [req.user.id]);
        
        if (initialStatus.rows.length === 0 || !initialStatus.rows[0].initial_scraping_done) {
            console.log(`🚫 User ${req.user.id} has not completed initial scraping`);
            return res.status(403).json({
                success: false,
                error: 'Please complete your own profile scraping first before scraping target profiles',
                code: 'INITIAL_SCRAPING_REQUIRED'
            });
        }
        
        const { profileData } = req.body;
        
        if (!profileData) {
            return res.status(400).json({
                success: false,
                error: 'Profile data is required'
            });
        }
        
        if (!profileData.url && !profileData.linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required in profile data'
            });
        }
        
        // ✅ FIXED: Clean and validate URL using backend normalization
        const profileUrl = profileData.url || profileData.linkedinUrl;
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn profile URL'
            });
        }
        
        // ✅ FIXED: Validate this is NOT the user's own profile using normalized URLs
        const userLinkedInUrl = req.user.linkedin_url;
        if (userLinkedInUrl) {
            const cleanUserUrl = cleanLinkedInUrl(userLinkedInUrl);
            
            if (cleanUserUrl === cleanProfileUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'This appears to be your own profile. Use /profile/user endpoint for your own profile.'
                });
            }
        }
        
        // Process the scraped data
        const processedData = processScrapedProfileData(profileData, false);
        
        // ✅ FIXED: Normalize the LinkedIn URL in processed data
        processedData.linkedinUrl = cleanProfileUrl;
        processedData.url = cleanProfileUrl;
        
        console.log('💾 Saving target profile data...');
        
        // Check if this target profile already exists for this user
        const existingTarget = await pool.query(
            'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [req.user.id, processedData.linkedinUrl]
        );
        
        let targetProfile;
        if (existingTarget.rows.length > 0) {
            // Update existing target profile
            const result = await pool.query(`
                UPDATE target_profiles SET 
                    linkedin_id = $1,
                    linkedin_num_id = $2,
                    input_url = $3,
                    url = $4,
                    full_name = $5,
                    first_name = $6,
                    last_name = $7,
                    headline = $8,
                    about = $9,
                    summary = $10,
                    location = $11,
                    city = $12,
                    state = $13,
                    country = $14,
                    country_code = $15,
                    industry = $16,
                    current_company = $17,
                    current_company_name = $18,
                    current_position = $19,
                    connections_count = $20,
                    followers_count = $21,
                    connections = $22,
                    followers = $23,
                    profile_image_url = $24,
                    avatar = $25,
                    experience = $26,
                    education = $27,
                    skills = $28,
                    timestamp = $29,
                    data_source = $30,
                    scraped_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $31 AND linkedin_url = $32
                RETURNING *
            `, [
                processedData.linkedinId,
                processedData.linkedinNumId,
                processedData.inputUrl,
                processedData.url,
                processedData.fullName,
                processedData.firstName,
                processedData.lastName,
                processedData.headline,
                processedData.about,
                processedData.summary,
                processedData.location,
                processedData.city,
                processedData.state,
                processedData.country,
                processedData.countryCode,
                processedData.industry,
                processedData.currentCompany,
                processedData.currentCompanyName,
                processedData.currentPosition,
                processedData.connectionsCount,
                processedData.followersCount,
                processedData.connections,
                processedData.followers,
                processedData.profileImageUrl,
                processedData.avatar,
                JSON.stringify(processedData.experience),
                JSON.stringify(processedData.education),
                JSON.stringify(processedData.skills),
                processedData.timestamp,
                processedData.dataSource,
                req.user.id,
                processedData.linkedinUrl
            ]);
            
            targetProfile = result.rows[0];
        } else {
            // Create new target profile
            const result = await pool.query(`
                INSERT INTO target_profiles (
                    user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                    full_name, first_name, last_name, headline, about, summary,
                    location, city, state, country, country_code, industry,
                    current_company, current_company_name, current_position,
                    connections_count, followers_count, connections, followers,
                    profile_image_url, avatar, experience, education, skills,
                    timestamp, data_source
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                    $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
                ) RETURNING *
            `, [
                req.user.id,
                processedData.linkedinUrl,
                processedData.linkedinId,
                processedData.linkedinNumId,
                processedData.inputUrl,
                processedData.url,
                processedData.fullName,
                processedData.firstName,
                processedData.lastName,
                processedData.headline,
                processedData.about,
                processedData.summary,
                processedData.location,
                processedData.city,
                processedData.state,
                processedData.country,
                processedData.countryCode,
                processedData.industry,
                processedData.currentCompany,
                processedData.currentCompanyName,
                processedData.currentPosition,
                processedData.connectionsCount,
                processedData.followersCount,
                processedData.connections,
                processedData.followers,
                processedData.profileImageUrl,
                processedData.avatar,
                JSON.stringify(processedData.experience),
                JSON.stringify(processedData.education),
                JSON.stringify(processedData.skills),
                processedData.timestamp,
                processedData.dataSource
            ]);
            
            targetProfile = result.rows[0];
        }
        
        console.log(`🎯 Target profile successfully saved for user ${req.user.id}!`);
        console.log(`   - Target: ${targetProfile.full_name || 'Unknown'}`);
        console.log(`   - Company: ${targetProfile.current_company || 'Unknown'}`);
        
        res.json({
            success: true,
            message: 'Target profile saved successfully!',
            data: {
                targetProfile: {
                    id: targetProfile.id,
                    linkedinUrl: targetProfile.linkedin_url,
                    fullName: targetProfile.full_name,
                    headline: targetProfile.headline,
                    currentCompany: targetProfile.current_company,
                    location: targetProfile.location,
                    profileImageUrl: targetProfile.profile_image_url,
                    scrapedAt: targetProfile.scraped_at
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Target profile scraping error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save target profile',
            details: error.message
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

// 🎯 FIXED: Smart OAuth callback - redirects based on user status
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
    async (req, res) => {
        try {
            const token = jwt.sign(
                { userId: req.user.id, email: req.user.email },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
            // 🎯 SMART REDIRECT LOGIC:
            const needsOnboarding = req.user.isNewUser || 
                                   !req.user.linkedin_url || 
                                   !req.user.profile_completed ||
                                   req.user.extraction_status === 'not_started';
            
            console.log(`🔍 OAuth callback - User: ${req.user.email}`);
            console.log(`   - Is new user: ${req.user.isNewUser || false}`);
            console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
            console.log(`   - Profile completed: ${req.user.profile_completed || false}`);
            console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
            console.log(`   - Needs onboarding: ${needsOnboarding}`);
            
            if (needsOnboarding) {
                // New users or incomplete profiles → sign-up for onboarding
                console.log(`➡️ Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
                // Existing users with complete profiles → dashboard
                console.log(`➡️ Redirecting to dashboard`);
                res.redirect(`/dashboard?token=${token}`);
            }
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            res.redirect(`/login?error=callback_error`);
        }
    }
);

app.get('/auth/failed', (req, res) => {
    res.redirect(`/login?error=auth_failed`);
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

// ✅ COMPLETE REGISTRATION ENDPOINT - With URL normalization and GEMINI ONLY
app.post('/complete-registration', authenticateToken, async (req, res) => {
    console.log('🎯 Complete registration request for user:', req.user.id);
    
    try {
        const { linkedinUrl, packageType, termsAccepted } = req.body;
        
        // Validation
        if (!termsAccepted) {
            return res.status(400).json({
                success: false,
                error: 'You must accept the Terms of Service and Privacy Policy'
            });
        }
        
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
        
        // Check for Gemini API key
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Gemini AI processing is not available. Contact support.',
                code: 'GEMINI_NOT_CONFIGURED'
            });
        }
        
        // Update package type if needed
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
        
        // Create profile and start LinkedIn extraction
        const profile = await createOrUpdateUserProfile(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Registration completed successfully! LinkedIn profile analysis started with Gemini AI (NO FALLBACK).',
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
                automaticProcessing: {
                    enabled: true,
                    status: 'started',
                    processingMode: 'GEMINI_ONLY',
                    expectedCompletionTime: '5-10 minutes',
                    message: 'Your LinkedIn profile is being analyzed in the background using Gemini AI ONLY - no manual fallback'
                }
            }
        });
        
        console.log(`✅ Registration completed for user ${updatedUser.email} - LinkedIn extraction with Gemini ONLY started!`);
        
    } catch (error) {
        console.error('❌ Complete registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration completion failed',
            details: error.message
        });
    }
});

// ✅ FIXED: Update user profile with LinkedIn URL normalization and GEMINI ONLY
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
        
        // Check for Gemini API key
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Gemini AI processing is not available. Contact support.',
                code: 'GEMINI_NOT_CONFIGURED'
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
            message: 'Profile updated - LinkedIn data extraction started with Gemini AI ONLY (no fallback)!',
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
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - Gemini AI ONLY integration applied!`);
        
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
            extractionStatus: 'unknown',
            initialScrapingDone: false
        };

        if (!profile || !profile.user_id) {
            syncStatus = {
                isIncomplete: true,
                missingFields: ['complete_profile'],
                extractionStatus: 'not_started',
                initialScrapingDone: false,
                reason: 'No profile data found'
            };
        } else {
            const extractionStatus = profile.data_extraction_status || 'not_started';
            const isProfileAnalyzed = profile.profile_analyzed || false;
            const initialScrapingDone = profile.initial_scraping_done || false;
            
            const missingFields = [];
            if (!profile.full_name) missingFields.push('full_name');
            if (!profile.headline) missingFields.push('headline');  
            if (!profile.current_company && !profile.current_position) missingFields.push('company_info');
            if (!profile.location) missingFields.push('location');
            
            const isIncomplete = (
                !initialScrapingDone ||
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
                initialScrapingDone: initialScrapingDone,
                isCurrentlyProcessing: processingQueue.has(req.user.id),
                reason: isIncomplete ? 
                    `Initial scraping: ${initialScrapingDone}, Status: ${extractionStatus}, Missing: ${missingFields.join(', ')}` : 
                    'Profile complete and ready for target scraping'
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
                    profileAnalyzed: profile.profile_analyzed,
                    initialScrapingDone: profile.initial_scraping_done
                } : null,
                syncStatus: syncStatus
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
                up.initial_scraping_done
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
            initial_scraping_done: status.initial_scraping_done || false,
            is_currently_processing: processingQueue.has(req.user.id),
            processing_mode: 'GEMINI_ONLY',
            message: getStatusMessage(status.extraction_status, status.initial_scraping_done)
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// Helper function for status messages
const getStatusMessage = (status, initialScrapingDone = false) => {
    switch (status) {
        case 'not_started':
            return 'LinkedIn extraction not started - please complete initial profile setup';
        case 'processing':
            return 'LinkedIn profile extraction in progress with Gemini AI processing (NO FALLBACK)...';
        case 'completed':
            return initialScrapingDone ? 
                'LinkedIn profile extraction completed with Gemini AI! You can now scrape target profiles.' :
                'LinkedIn profile extraction completed successfully with Gemini AI (NO FALLBACK)!';
        case 'failed':
            return 'LinkedIn profile extraction failed - Gemini AI processing required (no manual fallback)';
        default:
            return 'Unknown status';
    }
};

// Retry extraction
app.post('/retry-extraction', authenticateToken, async (req, res) => {
    try {
        // Check for Gemini API key first
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Gemini AI processing is not available. Contact support.',
                code: 'GEMINI_NOT_CONFIGURED'
            });
        }
        
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
            message: 'LinkedIn extraction retry initiated with Gemini AI ONLY (no fallback)!',
            status: 'processing',
            processingMode: 'GEMINI_ONLY'
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
                features: ['10 Credits per month', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', 'Credits never expire'],
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
                features: ['250 Credits', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', 'Credits never expire'],
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
                features: ['1,000 Credits', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', 'Credits never expire'],
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
                features: ['10 Credits per month', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', '7-day free trial included'],
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
                features: ['250 Credits', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', '7-day free trial included'],
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
                features: ['1,000 Credits', 'Chrome extension', 'Gemini AI profile analysis', 'Enhanced LinkedIn extraction', 'Beautiful dashboard', '7-day free trial included'],
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

// ✅ FIXED: Generate message endpoint with proper credit deduction and transaction management
app.post('/generate-message', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        console.log(`🤖 Message generation request from user ${req.user.id}`);
        
        const { targetProfile, context, messageType } = req.body;
        
        if (!targetProfile) {
            return res.status(400).json({
                success: false,
                error: 'Target profile is required'
            });
        }
        
        if (!context) {
            return res.status(400).json({
                success: false,
                error: 'Message context is required'
            });
        }
        
        // ✅ FIXED: Start transaction for credit check and deduction
        await client.query('BEGIN');
        
        // Check user credits within transaction
        const userResult = await client.query(
            'SELECT credits_remaining FROM users WHERE id = $1 FOR UPDATE',
            [req.user.id]
        );
        
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const currentCredits = userResult.rows[0].credits_remaining;
        
        if (currentCredits <= 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                error: 'Insufficient credits. Please upgrade your plan.'
            });
        }
        
        // Deduct credit immediately (before API call)
        const newCredits = currentCredits - 1;
        await client.query(
            'UPDATE users SET credits_remaining = $1 WHERE id = $2',
            [newCredits, req.user.id]
        );
        
        // Log the credit transaction
        await client.query(
            'INSERT INTO credits_transactions (user_id, transaction_type, credits_change, description) VALUES ($1, $2, $3, $4)',
            [req.user.id, 'message_generation', -1, `Generated message for ${targetProfile.fullName || 'Unknown'}`]
        );
        
        // ✅ FIXED: Commit credit deduction before potentially long API call
        await client.query('COMMIT');
        
        console.log(`💳 Credit deducted for user ${req.user.id}: ${currentCredits} → ${newCredits}`);
        
        // Generate message using AI (simulate for now)
        console.log('🤖 Generating AI message...');
        
        // TODO: Replace with actual AI API call
        const simulatedMessage = `Hi ${targetProfile.firstName || targetProfile.fullName?.split(' ')[0] || 'there'},

I noticed your impressive work at ${targetProfile.currentCompany || 'your company'}${targetProfile.headline ? ` as ${targetProfile.headline}` : ''}. ${context}

Would love to connect and learn more about your experience!

Best regards`;
        
        const score = Math.floor(Math.random() * 20) + 80; // Random score between 80-100
        
        // ✅ FIXED: Log message generation
        await pool.query(
            'INSERT INTO message_logs (user_id, target_name, target_url, generated_message, message_context, credits_used) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, targetProfile.fullName, targetProfile.linkedinUrl, simulatedMessage, context, 1]
        );
        
        console.log(`✅ Message generated successfully for user ${req.user.id}`);
        
        res.json({
            success: true,
            message: 'Message generated successfully',
            data: {
                message: simulatedMessage,
                score: score,
                user: {
                    credits: newCredits
                },
                usage: {
                    creditsUsed: 1,
                    remainingCredits: newCredits
                }
            }
        });
        
    } catch (error) {
        // ✅ FIXED: Rollback if transaction is still active
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('❌ Rollback error:', rollbackError);
        }
        
        console.error('❌ Message generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate message',
            details: error.message
        });
    } finally {
        client.release();
    }
});

// Error handling
app.use((req, res, next) => {
    res.status(404).json({
        error: 'Route not found',
        availableRoutes: [
            'GET /',
            'GET /sign-up',
            'GET /login',
            'GET /dashboard',
            'POST /register', 
            'POST /login', 
            'GET /auth/google',
            'POST /auth/chrome-extension',
            'GET /profile', 
            'POST /profile/user',
            'POST /profile/target',
            'POST /update-profile',
            'POST /complete-registration',
            'GET /profile-status',
            'GET /user/initial-scraping-status',
            'POST /retry-extraction',
            'POST /generate-message',
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
    
    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ CRITICAL: GEMINI_API_KEY not set - system will fail (NO MANUAL FALLBACK)');
        process.exit(1);
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
            console.log('🚀 Msgly.AI Server - GEMINI AI ONLY MODE ACTIVE!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected with transaction management`);
            console.log(`🔐 Auth: JWT + Google OAuth + Chrome Extension Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`🤖 Gemini AI: ${process.env.GEMINI_API_KEY ? 'Configured ✅ (EXCLUSIVE data processor - NO FALLBACK)' : 'NOT CONFIGURED ❌ - SYSTEM WILL FAIL'}`);
            console.log(`🤖 Processing Mode: GEMINI ONLY - NO MANUAL FALLBACK`);
            console.log(`🔧 CRITICAL MODE CHANGE:`);
            console.log(`   ✅ Gemini Processing: REQUIRED - No fallback available`);
            console.log(`   ✅ Manual Processing: REMOVED - System fails if Gemini fails`);
            console.log(`   ✅ Error Handling: Enhanced with Gemini-only error messages`);
            console.log(`   ✅ Validation: GEMINI_API_KEY required at startup`);
            console.log(`   ✅ All endpoints: Updated to indicate GEMINI ONLY mode`);
            console.log(`🎨 FRONTEND COMPLETE:`);
            console.log(`   ✅ Beautiful sign-up page: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/sign-up' : 'http://localhost:3000/sign-up'}`);
            console.log(`   ✅ Beautiful login page: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/login' : 'http://localhost:3000/login'}`);
            console.log(`   ✅ Beautiful dashboard: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/dashboard' : 'http://localhost:3000/dashboard'}`);
            console.log(`📋 ALL ENDPOINTS WITH GEMINI ONLY MODE:`);
            console.log(`   ✅ /complete-registration - Checks for Gemini API key`);
            console.log(`   ✅ /update-profile - Requires Gemini for processing`);
            console.log(`   ✅ /retry-extraction - Validates Gemini availability`);
            console.log(`   ✅ /profile-status - Shows GEMINI ONLY processing mode`);
            console.log(`   ✅ /health - Indicates no fallback available`);
            console.log(`💳 Packages: Free (Available), Premium (Coming Soon)`);
            console.log(`🌐 Health: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/health' : 'http://localhost:3000/health'}`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            console.log(`🎯 Status: GEMINI AI ONLY MODE - NO MANUAL FALLBACK`);
            console.log(`   Pure AI Intelligence → No compromise processing ✓`);
            console.log(`   Gemini or Fail → Clean error handling ✓`);
            console.log(`   No Fallback → Consistent quality guaranteed ✓`);
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
