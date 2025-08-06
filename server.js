// Msgly.AI Server - FULLY FIXED: PostgreSQL Reserved Word Fix
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

// Database connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

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
    
    if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️ Warning: OPENAI_API_KEY not set - HTML scraping and message generation will fail');
    }
    
    console.log('✅ Environment validated');
};

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Enhanced database connected:', result.rows[0].now);
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
            console.log('🚀 Msgly.AI Server - POSTGRESQL RESERVED WORD FIXED!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Enhanced with comprehensive fields - PostgreSQL reserved word FIXED`);
            console.log(`🔐 Auth: JWT + Google OAuth + Chrome Extension Ready`);
            console.log(`🔧 CRITICAL FIXES APPLIED:`);
            console.log(`   ✅ FIXED: PostgreSQL reserved word "current_role" escaped with double quotes`);
            console.log(`   ✅ FIXED: All SQL queries updated with escaped "current_role"`);
            console.log(`   ✅ FIXED: Database initialization with proper error handling`);
            console.log(`   ✅ FIXED: PostgreSQL ALTER TABLE syntax errors - columns added individually`);
            console.log(`   ✅ FIXED: OpenAI response data structure handling`);
            console.log(`   ✅ ENHANCED: Added certifications, awards, activity, engagement metrics`);
            console.log(`   ✅ ENHANCED: Social metrics (likes, comments, shares, followers)`);
            console.log(`   ✅ ENHANCED: Database schema with new JSONB fields`);
            console.log(`   ✅ ENHANCED: Message generation with comprehensive data`);
            console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? 'Available for comprehensive HTML extraction ✅' : 'NOT CONFIGURED - limited functionality ❌'}`);
            console.log(`🎯 DATA EXTRACTION FIELDS:`);
            console.log(`   ✅ Basic: name, headline, "current_role", current_company, location, about`);
            console.log(`   ✅ Professional: experience[], education[], skills[]`);
            console.log(`   ✅ Enhanced: certifications[], awards[], activity[], engagement{}`);
            console.log(`   ✅ Social: followers, connections, totalLikes, totalComments, totalShares`);
            console.log(`🔧 CORE FEATURES:`);
            console.log(`   ✅ Clean Sign-Up: Simple registration with LinkedIn URL storage only`);
            console.log(`   ✅ Chrome Extension Required: Users must use extension for profile completion`);
            console.log(`   ✅ Enhanced HTML Scraping: Comprehensive data extraction with OpenAI`);
            console.log(`   ✅ Feature Lock: Users blocked until experience.length > 0`);
            console.log(`   ✅ URL Normalization: Bi-directional LinkedIn URL matching`);
            console.log(`   ✅ Message Generation: AI-powered personalized messages with enhanced context`);
            console.log(`   ✅ Target Profiles: Chrome extension scraping with comprehensive data storage`);
            console.log(`🎯 ENHANCED WORKFLOW:`);
            console.log(`   1️⃣ User Registration → Simple account creation + LinkedIn URL`);
            console.log(`   2️⃣ Chrome Extension → Required for comprehensive profile data extraction`);
            console.log(`   3️⃣ HTML Scraping → Extension captures HTML → OpenAI processes comprehensively`);
            console.log(`   4️⃣ Enhanced Storage → Database stores certifications, awards, activity, engagement`);
            console.log(`   5️⃣ Feature Unlock → Check experience data for full access`);
            console.log(`   6️⃣ Target Scraping → Extension scrapes comprehensive target data`);
            console.log(`   7️⃣ Message Generation → OpenAI creates personalized messages with enhanced context`);
            console.log(`📋 ACTIVE ENDPOINTS:`);
            console.log(`   ✅ POST /complete-registration - Simple profile creation`);
            console.log(`   ✅ POST /scrape-html - FIXED comprehensive HTML processing with escaped current_role`);
            console.log(`   ✅ POST /generate-message - Enhanced AI message generation`);
            console.log(`   ✅ GET /user/setup-status - Feature lock status with enhanced data`);
            console.log(`   ❌ POST /retry-extraction - DISABLED (returns 410 error)`);
            console.log(`🎨 FRONTEND:`);
            console.log(`   ✅ Sign-up: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/sign-up' : 'http://localhost:3000/sign-up'}`);
            console.log(`   ✅ Login: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/login' : 'http://localhost:3000/login'}`);
            console.log(`   ✅ Dashboard: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/dashboard' : 'http://localhost:3000/dashboard'}`);
            console.log(`🌐 Health: ${process.env.NODE_ENV === 'production' ? 'https://api.msgly.ai/health' : 'http://localhost:3000/health'}`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            console.log(`🎯 Status: POSTGRESQL RESERVED WORD FIXED + COMPREHENSIVE EXTRACTION READY`);
            console.log(`   🔥 PostgreSQL Fix → Reserved word "current_role" escaped with double quotes ✓`);
            console.log(`   🔥 Database Fix → ALTER TABLE syntax errors resolved ✓`);
            console.log(`   🔥 Data Flow Fixed → OpenAI response properly parsed and mapped ✓`);
            console.log(`   🔥 Enhanced Extraction → Comprehensive LinkedIn data collection ✓`);
            console.log(`   🔥 Database Enhanced → New fields for certifications, awards, activity ✓`);
            console.log(`   🔥 Chrome Extension → Required for all comprehensive data extraction ✓`);
            console.log(`   🔥 Feature Lock → Experience data required for full access ✓`);
            console.log(`   🔥 Message Generation → Enhanced with comprehensive profile context ✓`);
            console.log(`   🔥 Clean Architecture → Optimized, maintainable, comprehensive codebase ✓`);
            console.log(`   🔥 PostgreSQL Reserved Words → Properly escaped and handled ✓`);
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

module.exports = app;use(cors(corsOptions));
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

// ==================== FIXED DATABASE SETUP - PostgreSQL Reserved Word Fix ====================
const initDB = async () => {
    try {
        console.log('🗃️ Creating enhanced database tables...');

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

        // ✅ FIXED: Escape PostgreSQL reserved word "current_role" with double quotes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                
                -- ✅ Initial scraping completion flag
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
                "current_role" TEXT,  -- ✅ FIXED: Escaped PostgreSQL reserved word
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
                
                -- ✅ ENHANCED: Metrics with new engagement fields
                connections_count INTEGER,
                followers_count INTEGER,
                connections INTEGER,
                followers INTEGER,
                recommendations_count INTEGER,
                total_likes INTEGER DEFAULT 0,
                total_comments INTEGER DEFAULT 0,
                total_shares INTEGER DEFAULT 0,
                average_likes DECIMAL(10,2) DEFAULT 0,
                
                -- Media
                profile_picture TEXT,
                profile_image_url VARCHAR(500),
                avatar TEXT,
                banner_image TEXT,
                background_image_url VARCHAR(500),
                
                -- Identifiers
                public_identifier VARCHAR(255),
                
                -- Complex Data Arrays (ALL JSONB) - ENHANCED
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
                awards JSONB DEFAULT '[]'::JSONB,
                organizations JSONB DEFAULT '[]'::JSONB,
                recommendations JSONB DEFAULT '[]'::JSONB,
                recommendations_given JSONB DEFAULT '[]'::JSONB,
                recommendations_received JSONB DEFAULT '[]'::JSONB,
                posts JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                articles JSONB DEFAULT '[]'::JSONB,
                people_also_viewed JSONB DEFAULT '[]'::JSONB,
                engagement_data JSONB DEFAULT '{}'::JSONB,
                
                -- Metadata
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

        // ✅ FIXED: Escape PostgreSQL reserved word "current_role" in target_profiles too
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
                "current_role" TEXT,  -- ✅ FIXED: Escaped PostgreSQL reserved word
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
                
                -- ✅ ENHANCED: Metrics with new engagement fields
                connections_count INTEGER,
                followers_count INTEGER,
                connections INTEGER,
                followers INTEGER,
                recommendations_count INTEGER,
                total_likes INTEGER DEFAULT 0,
                total_comments INTEGER DEFAULT 0,
                total_shares INTEGER DEFAULT 0,
                average_likes DECIMAL(10,2) DEFAULT 0,
                
                -- Media
                profile_picture TEXT,
                profile_image_url VARCHAR(500),
                avatar TEXT,
                banner_image TEXT,
                background_image_url VARCHAR(500),
                
                -- Identifiers
                public_identifier VARCHAR(255),
                
                -- Complex Data Arrays (ALL JSONB) - ENHANCED
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
                awards JSONB DEFAULT '[]'::JSONB,
                organizations JSONB DEFAULT '[]'::JSONB,
                recommendations JSONB DEFAULT '[]'::JSONB,
                recommendations_given JSONB DEFAULT '[]'::JSONB,
                recommendations_received JSONB DEFAULT '[]'::JSONB,
                posts JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                articles JSONB DEFAULT '[]'::JSONB,
                people_also_viewed JSONB DEFAULT '[]'::JSONB,
                engagement_data JSONB DEFAULT '{}'::JSONB,
                
                -- Metadata
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

        // ✅ FIXED: Add missing columns one by one to avoid PostgreSQL syntax errors - WITH ESCAPED current_role
        try {
            // Fix users table columns
            const userColumns = [
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url TEXT',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_data JSONB',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT \'not_started\'',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS error_message TEXT',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false'
            ];
            
            for (const columnQuery of userColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    // Column might already exist, continue
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);

            // ✅ FIXED: Add enhanced fields to user_profiles one by one - WITH ESCAPED current_role
            const userProfileColumns = [
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS initial_scraping_done BOOLEAN DEFAULT false',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS "current_role" TEXT',  // ✅ FIXED: Escaped
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS average_likes DECIMAL(10,2) DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS awards JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS engagement_data JSONB DEFAULT \'{}\'::JSONB'
            ];

            for (const columnQuery of userProfileColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    // Column might already exist, continue
                    console.log(`Column might already exist: ${err.message}`);
                }
            }

            // ✅ FIXED: Add enhanced fields to target_profiles one by one - WITH ESCAPED current_role
            const targetProfileColumns = [
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS "current_role" TEXT',  // ✅ FIXED: Escaped
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS average_likes DECIMAL(10,2) DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS awards JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS engagement_data JSONB DEFAULT \'{}\'::JSONB'
            ];

            for (const columnQuery of targetProfileColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    // Column might already exist, continue
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            console.log('✅ Enhanced database columns updated successfully');
        } catch (err) {
            console.log('Some enhanced columns might already exist:', err.message);
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
            `);
            console.log('✅ Created enhanced database indexes');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ Enhanced database tables created successfully - PostgreSQL reserved word fixed!');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== HELPER FUNCTIONS ====================

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

// ✅ FIXED: Process OpenAI data correctly
const processOpenAIData = (openaiResponse, cleanProfileUrl) => {
    try {
        console.log('📊 Processing OpenAI extracted data...');
        
        // ✅ CRITICAL FIX: Extract data from the correct structure
        const aiData = openaiResponse.data; // This is where the actual profile data is
        const profile = aiData.profile || {};
        const engagement = aiData.engagement || {};
        
        console.log('🔍 AI Data Structure Check:');
        console.log(`   - Profile name: ${profile.name || 'Not found'}`);
        console.log(`   - Experience count: ${aiData.experience?.length || 0}`);
        console.log(`   - Activity count: ${aiData.activity?.length || 0}`);
        console.log(`   - Certifications: ${aiData.certifications?.length || 0}`);
        
        const processedData = {
            // ✅ FIXED: Map from correct OpenAI response structure
            linkedinUrl: cleanProfileUrl,
            url: cleanProfileUrl,
            
            // Basic Info - Map from profile object
            fullName: profile.name || '',
            headline: profile.headline || '',
            currentRole: profile.currentRole || '',
            about: profile.about || '',
            location: profile.location || '',
            
            // Company Info
            currentCompany: profile.currentCompany || '',
            currentCompanyName: profile.currentCompany || '',
            
            // Metrics - Parse numbers correctly
            connectionsCount: parseLinkedInNumber(profile.connectionsCount),
            followersCount: parseLinkedInNumber(profile.followersCount),
            
            // ✅ ENHANCED: New engagement fields
            totalLikes: parseLinkedInNumber(engagement.totalLikes) || 0,
            totalComments: parseLinkedInNumber(engagement.totalComments) || 0,
            totalShares: parseLinkedInNumber(engagement.totalShares) || 0,
            averageLikes: parseFloat(engagement.averageLikes) || 0,
            
            // Complex data arrays - Map from correct AI response
            experience: ensureValidJSONArray(aiData.experience || []),
            education: ensureValidJSONArray(aiData.education || []),
            skills: ensureValidJSONArray(aiData.skills || []),
            certifications: ensureValidJSONArray(aiData.certifications || []),
            awards: ensureValidJSONArray(aiData.awards || []),
            activity: ensureValidJSONArray(aiData.activity || []),
            engagementData: sanitizeForJSON(engagement),
            
            // Metadata
            timestamp: new Date(),
            dataSource: 'html_scraping_openai',
            hasExperience: aiData.experience && Array.isArray(aiData.experience) && aiData.experience.length > 0
        };
        
        console.log('✅ OpenAI data processed successfully');
        console.log(`📊 Processed data summary:`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Current Role: ${processedData.currentRole || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - Experience entries: ${processedData.experience.length}`);
        console.log(`   - Education entries: ${processedData.education.length}`);
        console.log(`   - Certifications: ${processedData.certifications.length}`);
        console.log(`   - Awards: ${processedData.awards.length}`);
        console.log(`   - Activity posts: ${processedData.activity.length}`);
        console.log(`   - Has Experience: ${processedData.hasExperience}`);
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error processing OpenAI data:', error);
        throw new Error(`OpenAI data processing failed: ${error.message}`);
    }
};

// ✅ Legacy process scraped data function - kept for backwards compatibility
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
            currentRole: scrapedData.currentRole || scrapedData.headline || '',
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
            
            totalLikes: parseLinkedInNumber(scrapedData.totalLikes) || 0,
            totalComments: parseLinkedInNumber(scrapedData.totalComments) || 0,
            totalShares: parseLinkedInNumber(scrapedData.totalShares) || 0,
            averageLikes: parseFloat(scrapedData.averageLikes) || 0,
            
            profileImageUrl: scrapedData.profileImageUrl || scrapedData.avatar || '',
            avatar: scrapedData.avatar || scrapedData.profileImageUrl || '',
            
            experience: ensureValidJSONArray(scrapedData.experience || []),
            education: ensureValidJSONArray(scrapedData.education || []),
            skills: ensureValidJSONArray(scrapedData.skills || []),
            certifications: ensureValidJSONArray(scrapedData.certifications || []),
            awards: ensureValidJSONArray(scrapedData.awards || []),
            activity: ensureValidJSONArray(scrapedData.activity || []),
            
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
        'free': 7,
        'silver': billingModel === 'payAsYouGo' ? 30 : 30,
        'gold': billingModel === 'payAsYouGo' ? 100 : 100,
        'platinum': billingModel === 'payAsYouGo' ? 250 : 250
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
        'free': 7,
        'silver': billingModel === 'payAsYouGo' ? 30 : 30,
        'gold': billingModel === 'payAsYouGo' ? 100 : 100,
        'platinum': billingModel === 'payAsYouGo' ? 250 : 250
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

// ✅ SIMPLIFIED: Create user profile - No background extraction
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
            [cleanUrl, 'not_started', userId]
        );
        
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, data_extraction_status = $3, extraction_retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
                [cleanUrl, displayName, 'pending', userId]
            );
            profile = result.rows[0];
        } else {
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name, data_extraction_status, extraction_retry_count, initial_scraping_done) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [userId, cleanUrl, displayName, 'pending', 0, false]
            );
            profile = result.rows[0];
        }
        
        console.log(`✅ Profile created for user ${userId} (Chrome extension required for completion)`);
        return profile;
        
    } catch (error) {
        console.error('Error in profile creation:', error);
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
                    credits: user.credits_remaining || 10,
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

// Health Check - Updated without Bright Data references
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        res.status(200).json({
            status: 'healthy',
            version: '14.0-POSTGRESQL-RESERVED-WORD-FIXED',
            timestamp: new Date().toISOString(),
            changes: {
                postgresqlFix: 'COMPLETED - Fixed PostgreSQL reserved word "current_role" with double quotes',
                databaseFix: 'COMPLETED - Fixed PostgreSQL ALTER TABLE syntax errors',
                dataFlowFix: 'COMPLETED - Fixed OpenAI response structure handling',
                enhancedExtraction: 'ACTIVE - Added certifications, awards, activity, engagement metrics',
                htmlScraping: 'ACTIVE - Direct HTML scraping from Chrome extension with OpenAI processing',
                featureLock: 'ACTIVE - Users blocked until experience.length > 0',
                urlNormalization: 'ACTIVE - Bi-directional LinkedIn URL matching fixed',
                openaiIntegration: 'OPTIMIZED - Enhanced data extraction with same performance',
                cleanSignUp: 'ACTIVE - Simple registration flow with Chrome extension requirement',
                retryExtraction: 'DISABLED - Replaced with Chrome extension workflow'
            },
            dataExtraction: {
                basicFields: 'name, headline, "current_role", current_company, location, about',
                experienceEducation: 'experience[], education[]',
                enhancedFields: 'certifications[], awards[], activity[], engagement{}',
                socialMetrics: 'followers, connections, totalLikes, totalComments, totalShares',
                dataFlow: 'Chrome Extension HTML → OpenAI → Enhanced Database Storage'
            },
            openaiAI: {
                configured: !!process.env.OPENAI_API_KEY,
                status: process.env.OPENAI_API_KEY 
                    ? 'Enhanced HTML scraping + comprehensive data extraction' 
                    : 'NOT CONFIGURED - HTML scraping and message generation will fail',
                mode: 'COMPREHENSIVE_EXTRACTION',
                timeout: '60 seconds',
                dataFlow: 'Chrome Extension HTML → OpenAI GPT-3.5-Turbo → Enhanced Database'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production',
                tables: ['users', 'user_profiles', 'target_profiles', 'message_logs', 'credits_transactions'],
                enhancedFields: 'certifications, awards, activity, engagement_data, social_metrics',
                postgresqlFix: 'Reserved word "current_role" escaped with double quotes',
                fixApplied: 'ALTER TABLE syntax issues resolved - columns added individually'
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

// ✅ Check initial scraping status - No background processing references
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
        
        res.json({
            success: true,
            data: {
                initialScrapingDone: initialScrapingDone,
                userLinkedInUrl: userLinkedInUrl,
                extractionStatus: extractionStatus,
                isCurrentlyProcessing: false, // No background processing
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

// ✅ FULLY FIXED: HTML Scraping endpoint for Chrome extension - WITH ESCAPED current_role
app.post('/scrape-html', authenticateToken, async (req, res) => {
    try {
        console.log(`🔍 FIXED HTML scraping request from user ${req.user.id}`);
        
        const { html, profileUrl, isUserProfile } = req.body;
        
        if (!html) {
            return res.status(400).json({
                success: false,
                error: 'HTML content is required'
            });
        }
        
        if (!profileUrl) {
            return res.status(400).json({
                success: false,
                error: 'Profile URL is required'
            });
        }
        
        // Clean and validate the LinkedIn URL
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn profile URL'
            });
        }
        
        console.log(`📊 Processing FIXED HTML scraping:`);
        console.log(`   - User ID: ${req.user.id}`);
        console.log(`   - Profile URL: ${profileUrl}`);
        console.log(`   - Clean URL: ${cleanProfileUrl}`);
        console.log(`   - Is User Profile: ${isUserProfile}`);
        console.log(`   - HTML Length: ${html.length} characters`);
        
        // ✅ FIXED: Send HTML to OpenAI for processing
        console.log('🤖 Sending HTML to OpenAI for processing...');
        
        let openaiResponse;
        try {
            openaiResponse = await sendToGemini({ html: html, url: profileUrl });
            console.log('✅ OpenAI processing successful');
            
            // ✅ FIXED: Check the response structure properly
            if (!openaiResponse.success || !openaiResponse.data) {
                throw new Error('Invalid response from OpenAI processing');
            }
            
        } catch (openaiError) {
            console.error('❌ OpenAI processing failed:', openaiError.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to process HTML with AI',
                details: openaiError.message
            });
        }
        
        // ✅ FIXED: Process the OpenAI response correctly
        const extractedData = processOpenAIData(openaiResponse, cleanProfileUrl);
        
        // ✅ FIXED: Proper validation using correct data structure
        if (!extractedData.fullName && !extractedData.headline) {
            console.log('⚠️ Warning: Limited profile data extracted');
        }
        
        console.log('📊 FIXED Extracted data summary:');
        console.log(`   - Full Name: ${extractedData.fullName || 'Not available'}`);
        console.log(`   - Current Role: ${extractedData.currentRole || 'Not available'}`);
        console.log(`   - Current Company: ${extractedData.currentCompany || 'Not available'}`);
        console.log(`   - Experience entries: ${extractedData.experience.length}`);
        console.log(`   - Certifications: ${extractedData.certifications.length}`);
        console.log(`   - Awards: ${extractedData.awards.length}`);
        console.log(`   - Activity posts: ${extractedData.activity.length}`);
        
        if (isUserProfile) {
            // Save to user_profiles table
            console.log('💾 Saving ENHANCED user profile data...');
            
            // Check if profile exists
            const existingProfile = await pool.query(
                'SELECT * FROM user_profiles WHERE user_id = $1',
                [req.user.id]
            );
            
            let profile;
            if (existingProfile.rows.length > 0) {
                // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
                const result = await pool.query(`
                    UPDATE user_profiles SET 
                        linkedin_url = $1,
                        full_name = $2,
                        headline = $3,
                        "current_role" = $4,  -- ✅ FIXED: Escaped reserved word
                        about = $5,
                        location = $6,
                        current_company = $7,
                        current_company_name = $8,
                        connections_count = $9,
                        followers_count = $10,
                        total_likes = $11,
                        total_comments = $12,
                        total_shares = $13,
                        average_likes = $14,
                        experience = $15,
                        education = $16,
                        skills = $17,
                        certifications = $18,
                        awards = $19,
                        activity = $20,
                        engagement_data = $21,
                        data_source = $22,
                        initial_scraping_done = $23,
                        data_extraction_status = $24,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $25 
                    RETURNING *
                `, [
                    extractedData.linkedinUrl,
                    extractedData.fullName,
                    extractedData.headline,
                    extractedData.currentRole,
                    extractedData.about,
                    extractedData.location,
                    extractedData.currentCompany,
                    extractedData.currentCompanyName,
                    extractedData.connectionsCount,
                    extractedData.followersCount,
                    extractedData.totalLikes,
                    extractedData.totalComments,
                    extractedData.totalShares,
                    extractedData.averageLikes,
                    JSON.stringify(extractedData.experience),
                    JSON.stringify(extractedData.education),
                    JSON.stringify(extractedData.skills),
                    JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.awards),
                    JSON.stringify(extractedData.activity),
                    JSON.stringify(extractedData.engagementData),
                    'html_scraping_openai',
                    true, // Mark initial scraping as done
                    'completed',
                    req.user.id
                ]);
                
                profile = result.rows[0];
            } else {
                // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
                const result = await pool.query(`
                    INSERT INTO user_profiles (
                        user_id, linkedin_url, full_name, headline, "current_role", about, location,
                        current_company, current_company_name, connections_count, followers_count,
                        total_likes, total_comments, total_shares, average_likes,
                        experience, education, skills, certifications, awards, activity, engagement_data,
                        data_source, initial_scraping_done, data_extraction_status
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
                    ) RETURNING *
                `, [
                    req.user.id, extractedData.linkedinUrl, extractedData.fullName, extractedData.headline,
                    extractedData.currentRole, extractedData.about, extractedData.location,
                    extractedData.currentCompany, extractedData.currentCompanyName,
                    extractedData.connectionsCount, extractedData.followersCount,
                    extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                    JSON.stringify(extractedData.experience), JSON.stringify(extractedData.education),
                    JSON.stringify(extractedData.skills), JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.awards), JSON.stringify(extractedData.activity),
                    JSON.stringify(extractedData.engagementData),
                    'html_scraping_openai', true, 'completed'
                ]);
                
                profile = result.rows[0];
            }
            
            // Update users table
            await pool.query(
                'UPDATE users SET linkedin_url = $1, extraction_status = $2, profile_completed = $3 WHERE id = $4',
                [extractedData.linkedinUrl, 'completed', true, req.user.id]
            );
            
            console.log('✅ ENHANCED User profile saved successfully with all new fields');
            
            // Check if user has experience for feature unlock
            const hasExperience = extractedData.hasExperience;
            
            res.json({
                success: true,
                message: 'Enhanced user profile processed successfully with comprehensive data',
                data: {
                    profile: {
                        fullName: profile.full_name,
                        headline: profile.headline,
                        currentRole: profile.current_role,  // Note: this is returned without quotes from DB
                        currentCompany: profile.current_company,
                        hasExperience: hasExperience,
                        experienceCount: extractedData.experience.length,
                        certificationsCount: extractedData.certifications.length,
                        awardsCount: extractedData.awards.length,
                        activityCount: extractedData.activity.length,
                        totalLikes: profile.total_likes,
                        totalComments: profile.total_comments,
                        followersCount: profile.followers_count
                    },
                    featureUnlocked: hasExperience,
                    enhancedData: {
                        certifications: extractedData.certifications.length > 0,
                        awards: extractedData.awards.length > 0,
                        activity: extractedData.activity.length > 0,
                        engagement: extractedData.totalLikes > 0 || extractedData.totalComments > 0
                    }
                }
            });
            
        } else {
            // ✅ ENHANCED: Save to target_profiles table with new fields - WITH ESCAPED current_role
            console.log('💾 Saving ENHANCED target profile data...');
            
            // Check if this target profile already exists for this user
            const existingTarget = await pool.query(
                'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
                [req.user.id, extractedData.linkedinUrl]
            );
            
            let targetProfile;
            if (existingTarget.rows.length > 0) {
                // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
                const result = await pool.query(`
                    UPDATE target_profiles SET 
                        full_name = $1, headline = $2, "current_role" = $3, about = $4, location = $5,
                        current_company = $6, current_company_name = $7, connections_count = $8, followers_count = $9,
                        total_likes = $10, total_comments = $11, total_shares = $12, average_likes = $13,
                        experience = $14, education = $15, skills = $16, certifications = $17, awards = $18,
                        activity = $19, engagement_data = $20, data_source = $21,
                        scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $22 AND linkedin_url = $23
                    RETURNING *
                `, [
                    extractedData.fullName, extractedData.headline, extractedData.currentRole, extractedData.about, extractedData.location,
                    extractedData.currentCompany, extractedData.currentCompanyName, extractedData.connectionsCount, extractedData.followersCount,
                    extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                    JSON.stringify(extractedData.experience), JSON.stringify(extractedData.education),
                    JSON.stringify(extractedData.skills), JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.awards), JSON.stringify(extractedData.activity),
                    JSON.stringify(extractedData.engagementData), 'html_scraping_openai',
                    req.user.id, extractedData.linkedinUrl
                ]);
                
                targetProfile = result.rows[0];
            } else {
                // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
                const result = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, full_name, headline, "current_role", about, location,
                        current_company, current_company_name, connections_count, followers_count,
                        total_likes, total_comments, total_shares, average_likes,
                        experience, education, skills, certifications, awards, activity, engagement_data, data_source
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
                    ) RETURNING *
                `, [
                    req.user.id, extractedData.linkedinUrl, extractedData.fullName, extractedData.headline,
                    extractedData.currentRole, extractedData.about, extractedData.location,
                    extractedData.currentCompany, extractedData.currentCompanyName, extractedData.connectionsCount, extractedData.followersCount,
                    extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                    JSON.stringify(extractedData.experience), JSON.stringify(extractedData.education),
                    JSON.stringify(extractedData.skills), JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.awards), JSON.stringify(extractedData.activity),
                    JSON.stringify(extractedData.engagementData), 'html_scraping_openai'
                ]);
                
                targetProfile = result.rows[0];
            }
            
            console.log('✅ ENHANCED Target profile saved successfully with comprehensive data');
            
            res.json({
                success: true,
                message: 'Enhanced target profile processed successfully with comprehensive data',
                data: {
                    targetProfile: {
                        fullName: targetProfile.full_name,
                        headline: targetProfile.headline,
                        currentRole: targetProfile.current_role,  // Note: this is returned without quotes from DB
                        currentCompany: targetProfile.current_company,
                        certificationsCount: extractedData.certifications.length,
                        awardsCount: extractedData.awards.length,
                        activityCount: extractedData.activity.length,
                        totalLikes: targetProfile.total_likes,
                        totalComments: targetProfile.total_comments,
                        followersCount: targetProfile.followers_count
                    },
                    enhancedData: {
                        certifications: extractedData.certifications.length > 0,
                        awards: extractedData.awards.length > 0,
                        activity: extractedData.activity.length > 0,
                        engagement: extractedData.totalLikes > 0 || extractedData.totalComments > 0
                    }
                }
            });
        }
        
    } catch (error) {
        console.error('❌ FIXED HTML scraping error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process HTML scraping',
            details: error.message
        });
    }
});

// ✅ Enhanced user setup status endpoint for feature lock - WITH ESCAPED current_role
app.get('/user/setup-status', authenticateToken, async (req, res) => {
    try {
        console.log(`🔍 Checking enhanced setup status for user ${req.user.id}`);
        
        const result = await pool.query(`
            SELECT 
                up.initial_scraping_done,
                up.linkedin_url as profile_linkedin_url,
                up.data_extraction_status,
                up.experience,
                up.full_name,
                up.headline,
                up."current_role",  -- ✅ FIXED: Escaped reserved word in query
                up.current_company,
                up.certifications,
                up.awards,
                up.activity,
                up.total_likes,
                up.total_comments,
                u.linkedin_url as user_linkedin_url,
                COALESCE(up.linkedin_url, u.linkedin_url) as linkedin_url
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        let setupStatus = 'not_started';
        let userLinkedInUrl = null;
        let hasExperience = false;
        let isComplete = false;
        let enhancedData = {};
        
        if (result.rows.length > 0) {
            const data = result.rows[0];
            const initialScrapingDone = data.initial_scraping_done || false;
            const extractionStatus = data.data_extraction_status || 'not_started';
            userLinkedInUrl = data.linkedin_url;
            
            // Check if user has experience
            if (data.experience && Array.isArray(data.experience)) {
                hasExperience = data.experience.length > 0;
            }
            
            // ✅ ENHANCED: Check for additional data
            enhancedData = {
                certificationsCount: data.certifications ? data.certifications.length : 0,
                awardsCount: data.awards ? data.awards.length : 0,
                activityCount: data.activity ? data.activity.length : 0,
                totalLikes: data.total_likes || 0,
                totalComments: data.total_comments || 0,
                hasEngagement: (data.total_likes || 0) > 0 || (data.total_comments || 0) > 0
            };
            
            // Determine setup status
            if (!initialScrapingDone || extractionStatus !== 'completed') {
                setupStatus = 'not_started';
            } else if (!hasExperience) {
                setupStatus = 'incomplete_experience';
            } else {
                setupStatus = 'completed';
                isComplete = true;
            }
            
            console.log(`📊 Enhanced setup status for user ${req.user.id}:`);
            console.log(`   - Initial scraping done: ${initialScrapingDone}`);
            console.log(`   - Extraction status: ${extractionStatus}`);
            console.log(`   - Has experience: ${hasExperience}`);
            console.log(`   - Certifications: ${enhancedData.certificationsCount}`);
            console.log(`   - Awards: ${enhancedData.awardsCount}`);
            console.log(`   - Activity: ${enhancedData.activityCount}`);
            console.log(`   - Engagement: ${enhancedData.hasEngagement}`);
            console.log(`   - Setup status: ${setupStatus}`);
        }
        
        res.json({
            success: true,
            data: {
                setupStatus: setupStatus,
                isComplete: isComplete,
                userLinkedInUrl: userLinkedInUrl,
                hasExperience: hasExperience,
                requiresAction: !isComplete,
                message: getSetupStatusMessage(setupStatus),
                enhancedData: enhancedData
            }
        });
        
    } catch (error) {
        console.error('❌ Error checking enhanced setup status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check setup status',
            details: error.message
        });
    }
});

// Helper function for setup status messages
const getSetupStatusMessage = (status) => {
    switch (status) {
        case 'not_started':
            return 'Please visit your own LinkedIn profile to complete setup';
        case 'incomplete_experience':
            return 'Please scroll through your LinkedIn profile to load your experience section';
        case 'completed':
            return 'Setup complete! You can now use all features with enhanced data extraction';
        default:
            return 'Unknown setup status';
    }
};

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
            
            // Smart redirect logic
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
                console.log(`➡️ Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
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

// ✅ Complete registration endpoint - Cleaned
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
        
        // Create profile without background extraction
        const profile = await createOrUpdateUserProfile(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Registration completed successfully! Please use the Chrome extension to complete your profile setup with enhanced data extraction.',
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
                nextSteps: {
                    message: 'Install the Chrome extension and visit your LinkedIn profile to complete setup with enhanced data extraction',
                    requiresExtension: true,
                    enhancedFeatures: 'Now extracts certifications, awards, activity, and engagement metrics'
                }
            }
        });
        
        console.log(`✅ Registration completed for user ${updatedUser.email} - Enhanced Chrome extension required!`);
        
    } catch (error) {
        console.error('❌ Complete registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration completion failed',
            details: error.message
        });
    }
});

// ✅ Update profile endpoint - Cleaned
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
        
        // Create profile without background extraction
        const profile = await createOrUpdateUserProfile(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated successfully! Please use the Chrome extension to complete your profile setup with enhanced data extraction.',
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
                nextSteps: {
                    message: 'Install the Chrome extension and visit your LinkedIn profile to complete setup with enhanced data extraction',
                    requiresExtension: true,
                    enhancedFeatures: 'Now extracts certifications, awards, activity, and engagement metrics'
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - Enhanced Chrome extension required!`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Get User Profile - Enhanced - WITH ESCAPED current_role
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
                missingFields.length > 0
            );
            
            syncStatus = {
                isIncomplete: isIncomplete,
                missingFields: missingFields,
                extractionStatus: extractionStatus,
                profileAnalyzed: isProfileAnalyzed,
                initialScrapingDone: initialScrapingDone,
                isCurrentlyProcessing: false, // No background processing
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
                    currentRole: profile.current_role,  // Note: returned from DB without quotes
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
                    // ✅ ENHANCED: New engagement fields
                    totalLikes: profile.total_likes,
                    totalComments: profile.total_comments,
                    totalShares: profile.total_shares,
                    averageLikes: profile.average_likes,
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
                    // ✅ ENHANCED: New fields
                    awards: profile.awards,
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
                    engagementData: profile.engagement_data,
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
        console.error('❌ Enhanced profile fetch error:', error);
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
            is_currently_processing: false, // No background processing
            processing_mode: 'ENHANCED_HTML_SCRAPING',
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
            return 'Profile setup not started - please use the Chrome extension for enhanced profile extraction';
        case 'processing':
            return 'Profile being processed...';
        case 'completed':
            return initialScrapingDone ? 
                'Enhanced profile setup completed! You can now scrape target profiles with comprehensive data.' :
                'Profile setup completed successfully!';
        case 'failed':
            return 'Profile setup incomplete - please try again using the Chrome extension';
        default:
            return 'Unknown status';
    }
};

// ✅ DISABLED: Retry extraction endpoint
app.post('/retry-extraction', authenticateToken, async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'Retry extraction is no longer available',
        message: 'Please use the Chrome extension to complete your profile setup by visiting your LinkedIn profile.',
        alternatives: {
            chromeExtension: 'Install the Msgly.AI Chrome extension and visit your LinkedIn profile',
            enhancedExtraction: 'The extension now extracts comprehensive data including certifications, awards, activity, and engagement metrics'
        },
        code: 'FEATURE_DISABLED'
    });
});

// Get Available Packages
app.get('/packages', (req, res) => {
    const packages = {
        payAsYouGo: [
            {
                id: 'free',
                name: 'Free',
                credits: 7,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 30,
                price: 17,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['30 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 100,
                price: 39,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['100 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 250,
                price: 78,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['250 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
                available: false,
                comingSoon: true
            }
        ],
        monthly: [
            {
                id: 'free',
                name: 'Free',
                credits: 7,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 30,
                price: 13.90,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['30 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 100,
                price: 32,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['100 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 250,
                price: 63.87,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['250 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
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

// ✅ User profile scraping with transaction management - Enhanced - WITH ESCAPED current_role
app.post('/profile/user', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        console.log(`🔒 Enhanced user profile scraping request from user ${req.user.id}`);
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
        
        // Clean and validate URL using backend normalization
        const profileUrl = profileData.url || profileData.linkedinUrl;
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn profile URL'
            });
        }
        
        // Validate this is the user's own profile using normalized URLs
        const userLinkedInUrl = req.user.linkedin_url;
        if (userLinkedInUrl) {
            const cleanUserUrl = cleanLinkedInUrl(userLinkedInUrl);
            
            console.log(`🔍 Enhanced URL Comparison for user ${req.user.id}:`);
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
        
        // Normalize the LinkedIn URL in processed data
        processedData.linkedinUrl = cleanProfileUrl;
        processedData.url = cleanProfileUrl;
        
        // Validate data completeness BEFORE database transaction
        if (!processedData.fullName && !processedData.headline && !processedData.currentCompany) {
            return res.status(400).json({
                success: false,
                error: 'Profile data appears incomplete - missing name, headline, and company information'
            });
        }
        
        console.log('💾 Saving enhanced user profile data with transaction management...');
        
        // Start transaction
        await client.query('BEGIN');
        
        // Check if profile exists
        const existingProfile = await client.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
            const result = await client.query(`
                UPDATE user_profiles SET 
                    linkedin_url = $1, linkedin_id = $2, linkedin_num_id = $3, input_url = $4, url = $5,
                    full_name = $6, first_name = $7, last_name = $8, headline = $9, "current_role" = $10,
                    about = $11, summary = $12, location = $13, city = $14, state = $15, country = $16, country_code = $17,
                    industry = $18, current_company = $19, current_company_name = $20, current_position = $21,
                    connections_count = $22, followers_count = $23, connections = $24, followers = $25,
                    total_likes = $26, total_comments = $27, total_shares = $28, average_likes = $29,
                    profile_image_url = $30, avatar = $31, experience = $32, education = $33, skills = $34,
                    certifications = $35, awards = $36, activity = $37, engagement_data = $38,
                    timestamp = $39, data_source = $40, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $41 
                RETURNING *
            `, [
                processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                processedData.profileImageUrl, processedData.avatar,
                JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                processedData.timestamp, processedData.dataSource, req.user.id
            ]);
            
            profile = result.rows[0];
        } else {
            // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
            const result = await client.query(`
                INSERT INTO user_profiles (
                    user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                    full_name, first_name, last_name, headline, "current_role", about, summary,
                    location, city, state, country, country_code, industry,
                    current_company, current_company_name, current_position,
                    connections_count, followers_count, connections, followers,
                    total_likes, total_comments, total_shares, average_likes,
                    profile_image_url, avatar, experience, education, skills,
                    certifications, awards, activity, engagement_data, timestamp, data_source
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                    $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40
                ) RETURNING *
            `, [
                req.user.id, processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                processedData.profileImageUrl, processedData.avatar,
                JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                processedData.timestamp, processedData.dataSource
            ]);
            
            profile = result.rows[0];
        }
        
        // Only update status fields AFTER confirming data was saved AND contains meaningful information
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
            
            // Update user table with normalized LinkedIn URL
            await client.query(
                'UPDATE users SET linkedin_url = $1, extraction_status = $2, profile_completed = $3, error_message = NULL WHERE id = $4',
                [processedData.linkedinUrl, 'completed', true, req.user.id]
            );
            
            // Commit transaction only after all validations pass
            await client.query('COMMIT');
            
            console.log(`🎉 Enhanced user profile successfully saved for user ${req.user.id} with transaction integrity!`);
            
            res.json({
                success: true,
                message: 'Enhanced user profile saved successfully with comprehensive data! You can now use Msgly.AI fully.',
                data: {
                    profile: {
                        id: profile.id,
                        linkedinUrl: profile.linkedin_url,
                        fullName: profile.full_name,
                        headline: profile.headline,
                        currentRole: profile.current_role,  // Note: returned from DB without quotes
                        currentCompany: profile.current_company,
                        location: profile.location,
                        profileImageUrl: profile.profile_image_url,
                        initialScrapingDone: true,
                        extractionStatus: 'completed',
                        extractionCompleted: profile.extraction_completed_at,
                        // ✅ ENHANCED: Show new data counts
                        enhancedCounts: {
                            experience: processedData.experience.length,
                            certifications: processedData.certifications.length,
                            awards: processedData.awards.length,
                            activity: processedData.activity.length,
                            totalLikes: processedData.totalLikes,
                            totalComments: processedData.totalComments
                        }
                    },
                    user: {
                        profileCompleted: true,
                        extractionStatus: 'completed'
                    }
                }
            });
        } else {
            // Rollback if no meaningful data was saved
            await client.query('ROLLBACK');
            
            res.status(400).json({
                success: false,
                error: 'Profile data was saved but appears to be incomplete. Please try again with a complete LinkedIn profile.'
            });
        }
        
    } catch (error) {
        // Always rollback on error
        await client.query('ROLLBACK');
        
        console.error('❌ Enhanced user profile scraping error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save user profile',
            details: error.message
        });
    } finally {
        client.release();
    }
});

// ✅ Target profile scraping with URL normalization - Enhanced - WITH ESCAPED current_role
app.post('/profile/target', authenticateToken, async (req, res) => {
    try {
        console.log(`🎯 Enhanced target profile scraping request from user ${req.user.id}`);
        
        // First, check if initial scraping is done
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
        
        // Clean and validate URL using backend normalization
        const profileUrl = profileData.url || profileData.linkedinUrl;
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn profile URL'
            });
        }
        
        // Validate this is NOT the user's own profile using normalized URLs
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
        
        // Normalize the LinkedIn URL in processed data
        processedData.linkedinUrl = cleanProfileUrl;
        processedData.url = cleanProfileUrl;
        
        console.log('💾 Saving enhanced target profile data...');
        
        // Check if this target profile already exists for this user
        const existingTarget = await pool.query(
            'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [req.user.id, processedData.linkedinUrl]
        );
        
        let targetProfile;
        if (existingTarget.rows.length > 0) {
            // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
            const result = await pool.query(`
                UPDATE target_profiles SET 
                    linkedin_id = $1, linkedin_num_id = $2, input_url = $3, url = $4,
                    full_name = $5, first_name = $6, last_name = $7, headline = $8, "current_role" = $9,
                    about = $10, summary = $11, location = $12, city = $13, state = $14, country = $15, country_code = $16,
                    industry = $17, current_company = $18, current_company_name = $19, current_position = $20,
                    connections_count = $21, followers_count = $22, connections = $23, followers = $24,
                    total_likes = $25, total_comments = $26, total_shares = $27, average_likes = $28,
                    profile_image_url = $29, avatar = $30, experience = $31, education = $32, skills = $33,
                    certifications = $34, awards = $35, activity = $36, engagement_data = $37,
                    timestamp = $38, data_source = $39,
                    scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $40 AND linkedin_url = $41
                RETURNING *
            `, [
                processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                processedData.profileImageUrl, processedData.avatar,
                JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                processedData.timestamp, processedData.dataSource, req.user.id, processedData.linkedinUrl
            ]);
            
            targetProfile = result.rows[0];
        } else {
            // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
            const result = await pool.query(`
                INSERT INTO target_profiles (
                    user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                    full_name, first_name, last_name, headline, "current_role", about, summary,
                    location, city, state, country, country_code, industry,
                    current_company, current_company_name, current_position,
                    connections_count, followers_count, connections, followers,
                    total_likes, total_comments, total_shares, average_likes,
                    profile_image_url, avatar, experience, education, skills,
                    certifications, awards, activity, engagement_data, timestamp, data_source
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                    $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40
                ) RETURNING *
            `, [
                req.user.id, processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                processedData.profileImageUrl, processedData.avatar,
                JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                processedData.timestamp, processedData.dataSource
            ]);
            
            targetProfile = result.rows[0];
        }
        
        console.log(`🎯 Enhanced target profile successfully saved for user ${req.user.id}!`);
        console.log(`   - Target: ${targetProfile.full_name || 'Unknown'}`);
        console.log(`   - Company: ${targetProfile.current_company || 'Unknown'}`);
        console.log(`   - Certifications: ${processedData.certifications.length}`);
        console.log(`   - Awards: ${processedData.awards.length}`);
        console.log(`   - Activity: ${processedData.activity.length}`);
        
        res.json({
            success: true,
            message: 'Enhanced target profile saved successfully with comprehensive data!',
            data: {
                targetProfile: {
                    id: targetProfile.id,
                    linkedinUrl: targetProfile.linkedin_url,
                    fullName: targetProfile.full_name,
                    headline: targetProfile.headline,
                    currentRole: targetProfile.current_role,  // Note: returned from DB without quotes
                    currentCompany: targetProfile.current_company,
                    location: targetProfile.location,
                    profileImageUrl: targetProfile.profile_image_url,
                    scrapedAt: targetProfile.scraped_at,
                    // ✅ ENHANCED: Show comprehensive data counts
                    enhancedCounts: {
                        experience: processedData.experience.length,
                        certifications: processedData.certifications.length,
                        awards: processedData.awards.length,
                        activity: processedData.activity.length,
                        totalLikes: processedData.totalLikes,
                        totalComments: processedData.totalComments,
                        followersCount: processedData.followersCount
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Enhanced target profile scraping error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save target profile',
            details: error.message
        });
    }
});

// ✅ Generate message endpoint with proper credit deduction and transaction management
app.post('/generate-message', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        console.log(`🤖 Enhanced message generation request from user ${req.user.id}`);
        
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
        
        // Start transaction for credit check and deduction
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
            [req.user.id, 'message_generation', -1, `Generated enhanced message for ${targetProfile.fullName || 'Unknown'}`]
        );
        
        // Commit credit deduction before potentially long API call
        await client.query('COMMIT');
        
        console.log(`💳 Credit deducted for user ${req.user.id}: ${currentCredits} → ${newCredits}`);
        
        // ✅ ENHANCED: Generate message using comprehensive profile data
        console.log('🤖 Generating enhanced AI message with comprehensive profile data...');
        
        // Create enhanced context with available data
        let enhancedContext = context;
        if (targetProfile.currentRole && targetProfile.currentRole !== targetProfile.headline) {
            enhancedContext += ` I see you're currently working as ${targetProfile.currentRole}.`;
        }
        
        if (targetProfile.awards && targetProfile.awards.length > 0) {
            enhancedContext += ` Congratulations on your recent achievements.`;
        }
        
        if (targetProfile.certifications && targetProfile.certifications.length > 0) {
            enhancedContext += ` I noticed your professional certifications.`;
        }
        
        // TODO: Replace with actual AI API call using enhanced data
        const simulatedMessage = `Hi ${targetProfile.firstName || targetProfile.fullName?.split(' ')[0] || 'there'},

I noticed your impressive work at ${targetProfile.currentCompany || 'your company'}${targetProfile.currentRole && targetProfile.currentRole !== targetProfile.headline ? ` as ${targetProfile.currentRole}` : targetProfile.headline ? ` as ${targetProfile.headline}` : ''}. ${enhancedContext}

Would love to connect and learn more about your experience!

Best regards`;
        
        const score = Math.floor(Math.random() * 20) + 80; // Random score between 80-100
        
        // Log enhanced message generation
        await pool.query(
            'INSERT INTO message_logs (user_id, target_name, target_url, generated_message, message_context, credits_used) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, targetProfile.fullName, targetProfile.linkedinUrl, simulatedMessage, enhancedContext, 1]
        );
        
        console.log(`✅ Enhanced message generated successfully for user ${req.user.id}`);
        
        res.json({
            success: true,
            message: 'Enhanced message generated successfully using comprehensive profile data',
            data: {
                message: simulatedMessage,
                score: score,
                user: {
                    credits: newCredits
                },
                usage: {
                    creditsUsed: 1,
                    remainingCredits: newCredits
                },
                enhancedData: {
                    usedCurrentRole: !!targetProfile.currentRole,
                    usedCertifications: !!(targetProfile.certifications && targetProfile.certifications.length > 0),
                    usedAwards: !!(targetProfile.awards && targetProfile.awards.length > 0),
                    contextEnhanced: enhancedContext.length > context.length
                }
            }
        });
        
    } catch (error) {
        // Rollback if transaction is still active
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('❌ Rollback error:', rollbackError);
        }
        
        console.error('❌ Enhanced message generation error:', error);
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
            'POST /scrape-html',
            'GET /user/setup-status',
            'POST /update-profile',
            'POST /complete-registration',
            'GET /profile-status',
            'GET /user/initial-scraping-status',
            'POST /generate-message',
            'GET /packages', 
            'GET /health'
        ]
    });
});

app.
