// database.js - Enhanced with TARGET PROFILE + USER PROFILE support
// Database Utilities - Complete TARGET + USER PROFILE functionality

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
        console.log('🗃️ Creating ENHANCED TARGET + USER PROFILE database tables...');

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

        // ✅ USER PROFILE table with token tracking
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
                
                -- ✅ NEW: RAW GEMINI DATA STORAGE FOR GPT 5 NANO
                gemini_raw_data JSONB,
                gemini_processed_at TIMESTAMP,
                gemini_token_usage JSONB DEFAULT '{}'::JSONB,
                
                -- ✅ NEW: TOKEN TRACKING COLUMNS
                raw_gpt_response TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                processing_time_ms INTEGER,
                api_request_id TEXT,
                response_status TEXT DEFAULT 'success',
                
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

        // ✅ Keep message_logs and credits_transactions for user functionality
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

        // ✅ Add missing columns to existing tables
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

            // ✅ Add enhanced fields to user_profiles table
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
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS gemini_token_usage JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS raw_gpt_response TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS input_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS output_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS api_request_id TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS response_status TEXT DEFAULT \'success\''
            ];

            for (const columnQuery of userProfileColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            console.log('✅ ENHANCED TARGET + USER PROFILE database columns updated successfully');
        } catch (err) {
            console.log('Some enhanced columns might already exist:', err.message);
        }

        // Create indexes for ENHANCED TARGET + USER PROFILE
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
            console.log('✅ Created ENHANCED TARGET + USER PROFILE database indexes');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ ENHANCED TARGET + USER PROFILE database tables created successfully!');
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

// ✅ USER PROFILE: Process Gemini data correctly (UNCHANGED)
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
            
            // ✅ NEW: Raw Gemini data storage for GPT 5 nano
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

// ✅ NEW: TARGET PROFILE - Process Gemini data (DUPLICATE of USER for future business logic)
const processTargetGeminiData = (geminiResponse, cleanProfileUrl) => {
    try {
        console.log('📊 Processing Gemini extracted data for TARGET PROFILE...');
        
        // ✅ CRITICAL FIX: Extract data from the correct structure
        const aiData = geminiResponse.data; // This is where the actual profile data is
        const profile = aiData.profile || {};
        const engagement = aiData.engagement || {};
        
        console.log('🔍 TARGET AI Data Structure Check:');
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
            
            // ✅ NEW: Raw Gemini data storage for GPT 5 nano
            geminiRawData: sanitizeForJSON(geminiResponse),
            geminiProcessedAt: new Date(),
            geminiTokenUsage: geminiResponse.metadata?.tokenUsage || {},
            
            // Metadata
            timestamp: new Date(),
            dataSource: 'html_scraping_gemini_target',
            hasExperience: aiData.experience && Array.isArray(aiData.experience) && aiData.experience.length > 0
        };
        
        console.log('✅ TARGET PROFILE Gemini data processed successfully');
        console.log(`📊 Processed TARGET data summary:`);
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
        console.error('❌ Error processing TARGET PROFILE Gemini data:', error);
        throw new Error(`TARGET PROFILE Gemini data processing failed: ${error.message}`);
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

// ✅ USER PROFILE: Create user profile - No background extraction (UNCHANGED)
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

// ✅ NEW: TARGET PROFILE - Create and update target profiles (DUPLICATE for future business logic)
const createOrUpdateTargetProfile = async (userId, linkedinUrl, targetData) => {
    try {
        console.log(`🎯 Creating TARGET PROFILE for user ${userId}`);
        console.log(`🔗 Target URL: ${linkedinUrl}`);
        
        // 🔮 FUTURE: Add your TARGET-specific business logic here:
        // - Credit cost checking
        // - Duplicate analysis prevention
        // - Rate limiting per user
        // - Premium features
        // - Target profile scoring
        
        const existingProfile = await pool.query(
            'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [userId, linkedinUrl]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            const result = await pool.query(`
                UPDATE target_profiles SET 
                    full_name = $1,
                    headline = $2,
                    about = $3,
                    location = $4,
                    current_company = $5,
                    connections_count = $6,
                    followers_count = $7,
                    experience = $8,
                    education = $9,
                    skills = $10,
                    certifications = $11,
                    awards = $12,
                    volunteer_experience = $13,
                    activity = $14,
                    engagement_data = $15,
                    gemini_raw_data = $16,
                    raw_gpt_response = $17,
                    input_tokens = $18,
                    output_tokens = $19,
                    total_tokens = $20,
                    processing_time_ms = $21,
                    api_request_id = $22,
                    response_status = $23,
                    gemini_processed_at = NOW(),
                    data_extraction_status = 'completed',
                    profile_analyzed = true,
                    extraction_completed_at = NOW(),
                    updated_at = NOW()
                WHERE user_id = $24 AND linkedin_url = $25
                RETURNING *
            `, [
                targetData.fullName,
                targetData.headline,
                targetData.about,
                targetData.location,
                targetData.currentCompany,
                targetData.connectionsCount,
                targetData.followersCount,
                JSON.stringify(targetData.experience),
                JSON.stringify(targetData.education),
                JSON.stringify(targetData.skills),
                JSON.stringify(targetData.certifications),
                JSON.stringify(targetData.awards),
                JSON.stringify(targetData.volunteerExperience),
                JSON.stringify(targetData.activity),
                JSON.stringify(targetData.engagementData),
                JSON.stringify(targetData.geminiRawData),
                targetData.rawGptResponse || null,
                targetData.inputTokens || null,
                targetData.outputTokens || null,
                targetData.totalTokens || null,
                targetData.processingTimeMs || null,
                targetData.apiRequestId || null,
                targetData.responseStatus || 'success',
                userId,
                linkedinUrl
            ]);
            profile = result.rows[0];
        } else {
            const result = await pool.query(`
                INSERT INTO target_profiles (
                    user_id, linkedin_url, full_name, headline, about, location,
                    current_company, connections_count, followers_count, experience,
                    education, skills, certifications, awards, volunteer_experience,
                    activity, engagement_data, gemini_raw_data, raw_gpt_response,
                    input_tokens, output_tokens, total_tokens, processing_time_ms,
                    api_request_id, response_status, gemini_processed_at,
                    data_extraction_status, profile_analyzed, extraction_completed_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), 'completed', true, NOW()
                ) RETURNING *
            `, [
                userId,
                linkedinUrl,
                targetData.fullName,
                targetData.headline,
                targetData.about,
                targetData.location,
                targetData.currentCompany,
                targetData.connectionsCount,
                targetData.followersCount,
                JSON.stringify(targetData.experience),
                JSON.stringify(targetData.education),
                JSON.stringify(targetData.skills),
                JSON.stringify(targetData.certifications),
                JSON.stringify(targetData.awards),
                JSON.stringify(targetData.volunteerExperience),
                JSON.stringify(targetData.activity),
                JSON.stringify(targetData.engagementData),
                JSON.stringify(targetData.geminiRawData),
                targetData.rawGptResponse || null,
                targetData.inputTokens || null,
                targetData.outputTokens || null,
                targetData.totalTokens || null,
                targetData.processingTimeMs || null,
                targetData.apiRequestId || null,
                targetData.responseStatus || 'success'
            ]);
            profile = result.rows[0];
        }
        
        console.log(`✅ TARGET PROFILE saved successfully for user ${userId}`);
        return profile;
        
    } catch (error) {
        console.error('❌ Error in TARGET PROFILE creation:', error);
        throw error;
    }
};

// ==================== DATABASE CONNECTION TESTING ====================

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ ENHANCED TARGET + USER PROFILE database connected:', result.rows[0].now);
        await initDB();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// Export all database functions and utilities - ENHANCED TARGET + USER PROFILE
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
    
    // ✅ NEW: TARGET PROFILE functions
    processTargetGeminiData,
    createOrUpdateTargetProfile,
    
    // Data processing helpers
    sanitizeForJSON,
    ensureValidJSONArray,
    parseLinkedInNumber,
    processGeminiData      // ✅ USER PROFILE processing (unchanged)
};
