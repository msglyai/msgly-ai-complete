// database.js - USER PROFILE ONLY VERSION - All Target profile database logic removed
// Database Utilities - USER PROFILE ONLY - Extracted from server.js

// ==================== DATABASE CONNECTION & SETUP ====================

const { Pool } = require('pg');
require('dotenv').config();

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ==================== DATABASE INITIALIZATION ====================

const initDB = async () => {
    try {
        console.log('🗃️ Creating USER PROFILE ONLY database tables...');

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
                registration_completed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ✅ USER PROFILE ONLY: Only create user_profiles table, no target_profiles
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
                mutual_connections_count INTEGER DEFAULT 0,
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
                
                -- ✅ NEW: Additional fields for complete LinkedIn data
                following_companies JSONB DEFAULT '[]'::JSONB,
                following_people JSONB DEFAULT '[]'::JSONB,
                following_hashtags JSONB DEFAULT '[]'::JSONB,
                following_newsletters JSONB DEFAULT '[]'::JSONB,
                interests_industries JSONB DEFAULT '[]'::JSONB,
                interests_topics JSONB DEFAULT '[]'::JSONB,
                groups JSONB DEFAULT '[]'::JSONB,
                featured JSONB DEFAULT '[]'::JSONB,
                creator_info JSONB DEFAULT '{}'::JSONB,
                services JSONB DEFAULT '[]'::JSONB,
                business_info JSONB DEFAULT '{}'::JSONB,
                
                -- ✅ NEW: RAW GEMINI DATA STORAGE FOR GPT 4.1
                gemini_raw_data JSONB,
                gemini_processed_at TIMESTAMP,
                gemini_token_usage JSONB DEFAULT '{}'::JSONB,
                
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

        // ✅ USER PROFILE ONLY: Keep message_logs and credits_transactions for user functionality
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

        // ✅ USER PROFILE ONLY: Add missing columns to existing tables
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
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_completed BOOLEAN DEFAULT false'
            ];
            
            for (const columnQuery of userColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);

            // ✅ USER PROFILE ONLY: Add enhanced fields to user_profiles table
            const userProfileColumns = [
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS initial_scraping_done BOOLEAN DEFAULT false',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS "current_role" TEXT',  // ✅ FIXED: Escaped
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS average_likes DECIMAL(10,2) DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS awards JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS engagement_data JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mutual_connections_count INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS following_companies JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS following_people JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS following_hashtags JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS following_newsletters JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS interests_industries JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS interests_topics JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS groups JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS featured JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS creator_info JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS services JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS business_info JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS gemini_raw_data JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS gemini_processed_at TIMESTAMP',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS gemini_token_usage JSONB DEFAULT \'{}\'::JSONB'
            ];

            for (const columnQuery of userProfileColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            console.log('✅ USER PROFILE ONLY database columns updated successfully');
        } catch (err) {
            console.log('Some enhanced columns might already exist:', err.message);
        }

        // Create indexes for USER PROFILE ONLY
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
                CREATE INDEX IF NOT EXISTS idx_user_profiles_gemini_processed ON user_profiles(gemini_processed_at);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_mutual_connections ON user_profiles(mutual_connections_count);
            `);
            console.log('✅ Created USER PROFILE ONLY database indexes');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ USER PROFILE ONLY database tables created successfully!');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== DATA PROCESSING HELPER FUNCTIONS ====================

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

// ✅ USER PROFILE ONLY: Process Gemini data correctly
const processGeminiData = (geminiResponse, cleanProfileUrl) => {
    try {
        console.log('📊 Processing Gemini extracted data for USER PROFILE...');
        
        // ✅ CRITICAL FIX: Extract data from the correct structure
        const aiData = geminiResponse.data; // This is where the actual profile data is
        const profile = aiData.profile || {};
        const engagement = aiData.engagement || {};
        
        console.log('🔍 AI Data Structure Check:');
        console.log(`   - Profile name: ${profile.name || 'Not found'}`);
        console.log(`   - Experience count: ${aiData.experience?.length || 0}`);
        console.log(`   - Activity count: ${aiData.activity?.length || 0}`);
        console.log(`   - Certifications: ${aiData.certifications?.length || 0}`);
        
        const processedData = {
            // ✅ FIXED: Map from correct Gemini response structure
            linkedinUrl: cleanProfileUrl,
            url: cleanProfileUrl,
            
            // Basic Info - Map from profile object
            fullName: profile.name || '',
            firstName: profile.firstName || (profile.name ? profile.name.split(' ')[0] : ''),
            lastName: profile.lastName || (profile.name ? profile.name.split(' ').slice(1).join(' ') : ''),
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
            mutualConnectionsCount: parseLinkedInNumber(profile.mutualConnections) || 0,
            
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
            volunteerExperience: ensureValidJSONArray(aiData.volunteer || []),
            followingCompanies: ensureValidJSONArray(aiData.followingCompanies || []),
            followingPeople: ensureValidJSONArray(aiData.followingPeople || []),
            followingHashtags: ensureValidJSONArray(aiData.followingHashtags || []),
            followingNewsletters: ensureValidJSONArray(aiData.followingNewsletters || []),
            interestsIndustries: ensureValidJSONArray(aiData.interestsIndustries || []),
            interestsTopics: ensureValidJSONArray(aiData.interestsTopics || []),
            groups: ensureValidJSONArray(aiData.groups || []),
            featured: ensureValidJSONArray(aiData.featured || []),
            services: ensureValidJSONArray(aiData.services || []),
            engagementData: sanitizeForJSON(engagement),
            creatorInfo: sanitizeForJSON(aiData.creator || {}),
            businessInfo: sanitizeForJSON(aiData.business || {}),
            
            // ✅ NEW: Raw Gemini data storage for GPT 4.1
            geminiRawData: sanitizeForJSON(geminiResponse),
            geminiProcessedAt: new Date(),
            geminiTokenUsage: geminiResponse.metadata?.tokenUsage || {},
            
            // Metadata
            timestamp: new Date(),
            dataSource: 'html_scraping_gemini',
            hasExperience: aiData.experience && Array.isArray(aiData.experience) && aiData.experience.length > 0
        };
        
        console.log('✅ USER PROFILE Gemini data processed successfully');
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
        console.error('❌ Error processing USER PROFILE Gemini data:', error);
        throw new Error(`USER PROFILE Gemini data processing failed: ${error.message}`);
    }
};

// ==================== USER MANAGEMENT FUNCTIONS ====================

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

// ✅ USER PROFILE ONLY: Create user profile - No background extraction
const createOrUpdateUserProfile = async (userId, linkedinUrl, displayName = null) => {
    try {
        console.log(`🚀 Creating USER PROFILE for user ${userId}`);
        console.log(`🔧 Original URL: ${linkedinUrl}`);
        
        // ✅ Save URL to users table
        await pool.query(
            'UPDATE users SET linkedin_url = $1, extraction_status = $2, error_message = NULL WHERE id = $3',
            [linkedinUrl, 'not_started', userId]
        );
        
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, data_extraction_status = $3, extraction_retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
                [linkedinUrl, displayName, 'pending', userId]
            );
            profile = result.rows[0];
        } else {
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name, data_extraction_status, extraction_retry_count, initial_scraping_done) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [userId, linkedinUrl, displayName, 'pending', 0, false]
            );
            profile = result.rows[0];
        }
        
        console.log(`✅ USER PROFILE created for user ${userId} (Chrome extension required for completion)`);
        return profile;
        
    } catch (error) {
        console.error('Error in USER PROFILE creation:', error);
        throw error;
    }
};

// ==================== DATABASE CONNECTION TESTING ====================

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ USER PROFILE ONLY database connected:', result.rows[0].now);
        await initDB();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// Export all database functions and utilities - USER PROFILE ONLY
module.exports = {
    // Database connection
    pool,
    
    // Database setup
    initDB,
    testDatabase,
    
    // User management
    createUser,
    createGoogleUser,
    linkGoogleAccount,
    getUserByEmail,
    getUserById,
    createOrUpdateUserProfile,
    
    // Data processing helpers
    sanitizeForJSON,
    ensureValidJSONArray,
    parseLinkedInNumber,
    processGeminiData      // ✅ USER PROFILE ONLY: Only process user profiles
};
