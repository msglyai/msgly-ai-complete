 // Msgly.AI Database Utilities - STEP 2A EXTRACTION - COMPLETE WITH ALL LINKEDIN FIELDS
// All database functions, helpers, and utilities extracted from server.js
// G2A UPDATE: Added missing columns to user_profiles for parity with target_profiles

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
                registration_completed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ✅ G2A: Updated user_profiles with full parity to target_profiles
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
                
                -- ✅ G2A: Enhanced metrics with parity to target_profiles
                connections_count INTEGER,
                followers_count INTEGER,
                mutual_connections_count INTEGER DEFAULT 0,
                connections INTEGER,
                followers INTEGER,
                recommendations_count INTEGER,
                total_likes INTEGER DEFAULT 0,
                total_comments INTEGER DEFAULT 0,
                total_shares INTEGER DEFAULT 0,
                average_likes INTEGER DEFAULT 0,  -- ✅ G2A: Changed to INTEGER for parity
                
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
                
                -- ✅ Additional fields for complete LinkedIn data
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
                
                -- ✅ G2A: NEW FIELDS FOR PARITY WITH TARGET_PROFILES
                data_json JSONB,
                ai_provider TEXT,
                ai_model TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                artifacts_json JSONB,
                
                -- ✅ Legacy RAW GEMINI DATA STORAGE (kept for compatibility)
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

        // ✅ G2A: Add missing columns one by one to avoid PostgreSQL syntax errors
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
                    // Column might already exist, continue
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);

            // ✅ G2A: Add NEW FIELDS to user_profiles for parity with target_profiles
            const userProfileColumns = [
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS initial_scraping_done BOOLEAN DEFAULT false',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS "current_role" TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS average_likes INTEGER DEFAULT 0',  // ✅ G2A: INTEGER not DECIMAL
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
                // ✅ G2A: ADD THE CRITICAL NEW FIELDS FOR PARITY
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS data_json JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ai_provider TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ai_model TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS input_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS output_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS artifacts_json JSONB'
            ];

            for (const columnQuery of userProfileColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    // Column might already exist, continue
                    console.log(`Column might already exist: ${err.message}`);
                }
            }

            // ✅ G2A: Fix average_likes to be INTEGER in user_profiles (for parity)
            try {
                await pool.query('ALTER TABLE user_profiles ALTER COLUMN average_likes TYPE INTEGER USING average_likes::INTEGER');
            } catch (err) {
                console.log(`Average_likes conversion might have failed: ${err.message}`);
            }

            // ✅ FIXED: Add enhanced fields to target_profiles one by one - WITH ESCAPED current_role
            const targetProfileColumns = [
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS "current_role" TEXT',  // ✅ FIXED: Escaped
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS average_likes DECIMAL(10,2) DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS awards JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS engagement_data JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS mutual_connections_count INTEGER DEFAULT 0',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS following_companies JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS following_people JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS following_hashtags JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS following_newsletters JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS interests_industries JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS interests_topics JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS groups JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS featured JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS creator_info JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS services JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS business_info JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS gemini_raw_data JSONB',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS gemini_processed_at TIMESTAMP',
                'ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS gemini_token_usage JSONB DEFAULT \'{}\'::JSONB'
            ];

            for (const columnQuery of targetProfileColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    // Column might already exist, continue
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            console.log('✅ G2A: Database columns updated successfully - user_profiles now has parity with target_profiles!');
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
                CREATE INDEX IF NOT EXISTS idx_user_profiles_gemini_processed ON user_profiles(gemini_processed_at);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_mutual_connections ON user_profiles(mutual_connections_count);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_gemini_processed ON target_profiles(gemini_processed_at);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_mutual_connections ON target_profiles(mutual_connections_count);
                -- ✅ G2A: New indexes for the parity fields
                CREATE INDEX IF NOT EXISTS idx_user_profiles_ai_provider ON user_profiles(ai_provider);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_ai_model ON user_profiles(ai_model);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_total_tokens ON user_profiles(total_tokens);
            `);
            console.log('✅ Created enhanced database indexes');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ G2A: Enhanced database tables created successfully - user_profiles has full parity with target_profiles!');
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

// ✅ FIXED: Process Gemini data correctly (RENAMED from processOpenAIData)
const processGeminiData = (geminiResponse, cleanProfileUrl) => {
    try {
        console.log('📊 Processing Gemini extracted data...');
        
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
        
        console.log('✅ Gemini data processed successfully');
        console.log(`📊 Processed data summary:`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Current Role: ${processedData.currentRole || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - Experience entries: ${processedData.experience.length}`);
        console.log(`   - Education entries: ${processedData.education.length}`);
        console.log(`   - Certifications: ${processedData.certifications.length}`);
        console.log(`   - Awards: ${processedData.awards.length}`);
        console.log(`   - Activity posts: ${processedData.activity.length}`);
        console.log(`   - Volunteer experiences: ${processedData.volunteerExperience.length}`);
        console.log(`   - Following companies: ${processedData.followingCompanies.length}`);
        console.log(`   - Following people: ${processedData.followingPeople.length}`);
        console.log(`   - Raw Gemini data stored: ${!!processedData.geminiRawData}`);
        console.log(`   - Has Experience: ${processedData.hasExperience}`);
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error processing Gemini data:', error);
        throw new Error(`Gemini data processing failed: ${error.message}`);
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
            mutualConnectionsCount: parseLinkedInNumber(scrapedData.mutualConnections) || 0,
            
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
            volunteerExperience: ensureValidJSONArray(scrapedData.volunteerExperience || []),
            followingCompanies: ensureValidJSONArray(scrapedData.followingCompanies || []),
            followingPeople: ensureValidJSONArray(scrapedData.followingPeople || []),
            
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

// ✅ SIMPLIFIED: Create user profile - No background extraction
const createOrUpdateUserProfile = async (userId, linkedinUrl, displayName = null) => {
    try {
        // ✅ CRITICAL: Use cleanLinkedInUrl from main server
        console.log(`🚀 Creating profile for user ${userId}`);
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
        
        console.log(`✅ Profile created for user ${userId} (Chrome extension required for completion)`);
        return profile;
        
    } catch (error) {
        console.error('Error in profile creation:', error);
        throw error;
    }
};

// ==================== DATABASE CONNECTION TESTING ====================

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ G2A: Enhanced database connected:', result.rows[0].now);
        await initDB();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// Export all database functions and utilities
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
    processGeminiData,      // ✅ RENAMED: processOpenAIData → processGeminiData
    processScrapedProfileData
};
