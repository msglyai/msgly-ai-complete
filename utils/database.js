// ✅ RAILWAY FIXED database.js - Fixes target_profiles about column issue
// This version checks and repairs the existing table structure on Railway

const { Pool } = require('pg');
require('dotenv').config();

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ==================== RAILWAY TABLE STRUCTURE FIXER ====================

const fixTargetProfilesTable = async () => {
    try {
        console.log('🔧 Checking target_profiles table structure on Railway...');
        
        // Check if target_profiles table exists and get column info
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'target_profiles'
            );
        `);
        
        if (tableCheck.rows[0].exists) {
            console.log('📋 target_profiles table exists, checking about column...');
            
            // Check if about column is GENERATED
            const columnCheck = await pool.query(`
                SELECT column_name, data_type, is_generated, generation_expression
                FROM information_schema.columns 
                WHERE table_name = 'target_profiles' 
                AND column_name = 'about';
            `);
            
            if (columnCheck.rows.length > 0) {
                const aboutColumn = columnCheck.rows[0];
                console.log(`📊 About column info:`, aboutColumn);
                
                if (aboutColumn.is_generated === 'ALWAYS') {
                    console.log('🚨 FOUND ISSUE: about column is GENERATED, fixing...');
                    
                    // Fix the generated column by dropping and recreating it
                    await pool.query('ALTER TABLE target_profiles DROP COLUMN IF EXISTS about;');
                    await pool.query('ALTER TABLE target_profiles ADD COLUMN about TEXT;');
                    
                    console.log('✅ FIXED: about column is now regular TEXT column');
                } else {
                    console.log('✅ about column is already correct (not generated)');
                }
            } else {
                console.log('📝 Adding missing about column...');
                await pool.query('ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS about TEXT;');
            }
        } else {
            console.log('📋 target_profiles table does not exist, will be created normally');
        }
        
    } catch (error) {
        console.error('⚠️ Error checking/fixing target_profiles table:', error.message);
        // Don't throw - continue with normal table creation
    }
};

// ==================== DATABASE INITIALIZATION ====================

const initDB = async () => {
    try {
        console.log('🗃️ Creating RAILWAY FIXED database tables...');

        // 🔧 FIRST: Fix existing target_profiles table if needed
        await fixTargetProfilesTable();

        // ✅ USERS TABLE (unchanged)
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
                credits_remaining INTEGER DEFAULT 7,
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

        // ✅ USER_PROFILES TABLE - FIXED: current_role → current_job_title  
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                
                -- Initial scraping completion flag
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
                current_job_title TEXT,  -- 🔧 FIXED: Renamed from current_role
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
                
                -- Enhanced Metrics
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
                
                -- Complex Data Arrays (ALL JSONB)
                experience JSONB DEFAULT '[]'::JSONB,
                education JSONB DEFAULT '[]'::JSONB,
                skills JSONB DEFAULT '[]'::JSONB,
                certifications JSONB DEFAULT '[]'::JSONB,
                awards JSONB DEFAULT '[]'::JSONB,
                volunteer_experience JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                following_companies JSONB DEFAULT '[]'::JSONB,
                following_people JSONB DEFAULT '[]'::JSONB,
                following_hashtags JSONB DEFAULT '[]'::JSONB,
                following_newsletters JSONB DEFAULT '[]'::JSONB,
                interests_industries JSONB DEFAULT '[]'::JSONB,
                interests_topics JSONB DEFAULT '[]'::JSONB,
                groups JSONB DEFAULT '[]'::JSONB,
                featured JSONB DEFAULT '[]'::JSONB,
                services JSONB DEFAULT '[]'::JSONB,
                
                -- Complex Objects (JSONB)
                engagement_data JSONB DEFAULT '{}'::JSONB,
                creator_info JSONB DEFAULT '{}'::JSONB,
                business_info JSONB DEFAULT '{}'::JSONB,
                gemini_raw_data JSONB,
                
                -- Token tracking
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
                gemini_processed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // ✅ TARGET_PROFILES TABLE - FIXED: current_role → current_job_title
        await pool.query(`
            CREATE TABLE IF NOT EXISTS target_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                
                -- Initial scraping completion flag
                initial_scraping_done BOOLEAN DEFAULT false,
                
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
                current_job_title TEXT,  -- 🔧 FIXED: Renamed from current_role
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
                
                -- Enhanced Metrics
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
                
                -- Complex Data Arrays (ALL JSONB)
                experience JSONB DEFAULT '[]'::JSONB,
                education JSONB DEFAULT '[]'::JSONB,
                skills JSONB DEFAULT '[]'::JSONB,
                certifications JSONB DEFAULT '[]'::JSONB,
                awards JSONB DEFAULT '[]'::JSONB,
                volunteer_experience JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                following_companies JSONB DEFAULT '[]'::JSONB,
                following_people JSONB DEFAULT '[]'::JSONB,
                following_hashtags JSONB DEFAULT '[]'::JSONB,
                following_newsletters JSONB DEFAULT '[]'::JSONB,
                interests_industries JSONB DEFAULT '[]'::JSONB,
                interests_topics JSONB DEFAULT '[]'::JSONB,
                groups JSONB DEFAULT '[]'::JSONB,
                featured JSONB DEFAULT '[]'::JSONB,
                services JSONB DEFAULT '[]'::JSONB,
                
                -- Complex Objects (JSONB)
                engagement_data JSONB DEFAULT '{}'::JSONB,
                creator_info JSONB DEFAULT '{}'::JSONB,
                business_info JSONB DEFAULT '{}'::JSONB,
                gemini_raw_data JSONB,
                
                -- Token tracking
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
                gemini_processed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                
                -- Unique constraint for user + target URL combination
                CONSTRAINT target_profiles_user_url_unique UNIQUE (user_id, linkedin_url)
            );
        `);

        // ✅ Supporting tables (unchanged)
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

        // ✅ Add missing columns (safe operation)
        try {
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
            
            // Make password_hash nullable
            try {
                await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`);
            } catch (err) {
                console.log(`Password hash column already nullable: ${err.message}`);
            }

            // ✅ Add enhanced fields to both user_profiles and target_profiles
            const enhancedColumns = [
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS initial_scraping_done BOOLEAN DEFAULT false',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS current_job_title TEXT',  // 🔧 FIXED: New name
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS average_likes DECIMAL(10,2) DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS awards JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS engagement_data JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mutual_connections_count INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS volunteer_experience JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS activity JSONB DEFAULT \'[]\'::JSONB',
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
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS raw_gpt_response TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS input_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS output_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_tokens INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS api_request_id TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS response_status TEXT DEFAULT \'success\''
            ];

            // Apply same columns to target_profiles (excluding about - we fixed it above)
            const targetColumns = enhancedColumns
                .filter(query => !query.includes('ADD COLUMN IF NOT EXISTS about'))  // Skip about column
                .map(query => query.replace('user_profiles', 'target_profiles'));

            for (const columnQuery of [...enhancedColumns, ...targetColumns]) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            console.log('✅ Enhanced database columns updated successfully');
        } catch (err) {
            console.log('Some enhanced columns might already exist:', err.message);
        }

        // ✅ Create indexes
        try {
            await pool.query(`
                -- User profiles indexes
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_linkedin_url ON user_profiles(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_current_company ON user_profiles(current_company);
                
                -- Target profiles indexes
                CREATE INDEX IF NOT EXISTS idx_target_profiles_user_id ON target_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_linkedin_url ON target_profiles(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_extraction_status ON target_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_updated_at ON target_profiles(updated_at);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_current_company ON target_profiles(current_company);
                
                -- Users indexes
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
            `);
            console.log('✅ Database indexes created successfully');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ RAILWAY FIXED database tables created successfully!');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
};

// ==================== DATA PROCESSING FUNCTIONS ====================

// Helper functions (unchanged)
const sanitizeForJSON = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    }
    return value;
};

const ensureValidJSONArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [value];
        } catch {
            return [value];
        }
    }
    return [];
};

const parseLinkedInNumber = (value) => {
    if (!value) return null;
    const numStr = value.toString().replace(/[^\d]/g, '');
    const num = parseInt(numStr);
    return isNaN(num) ? null : num;
};

// ✅ USER PROFILE processing (unchanged from working version)
const processGeminiData = async (userId, geminiResponse, inputUrl) => {
    try {
        console.log(`🔄 Processing GPT-5 nano data for USER profile ${userId}...`);
        
        const profile = geminiResponse.profile;
        if (!profile) {
            throw new Error('No profile data found in Gemini response');
        }

        const processedData = {
            userId: userId,
            linkedinUrl: inputUrl,
            linkedinId: sanitizeForJSON(profile.linkedinId),
            inputUrl: inputUrl,
            url: sanitizeForJSON(profile.url),
            fullName: sanitizeForJSON(profile.name),
            firstName: sanitizeForJSON(profile.firstName),
            lastName: sanitizeForJSON(profile.lastName),
            headline: sanitizeForJSON(profile.headline),
            currentJobTitle: sanitizeForJSON(profile.currentJobTitle), // 🔧 FIXED: New field name
            about: sanitizeForJSON(profile.about),
            summary: sanitizeForJSON(profile.summary),
            location: sanitizeForJSON(profile.location),
            city: sanitizeForJSON(profile.city),
            state: sanitizeForJSON(profile.state),
            country: sanitizeForJSON(profile.country),
            countryCode: sanitizeForJSON(profile.countryCode),
            industry: sanitizeForJSON(profile.industry),
            currentCompany: sanitizeForJSON(profile.currentCompany),
            currentCompanyName: sanitizeForJSON(profile.currentCompanyName),
            connectionsCount: parseLinkedInNumber(profile.connectionsCount),
            followersCount: parseLinkedInNumber(profile.followersCount),
            mutualConnectionsCount: parseLinkedInNumber(profile.mutualConnectionsCount) || 0,
            totalLikes: parseLinkedInNumber(profile.totalLikes) || 0,
            totalComments: parseLinkedInNumber(profile.totalComments) || 0,
            totalShares: parseLinkedInNumber(profile.totalShares) || 0,
            averageLikes: profile.averageLikes || 0,
            profilePicture: sanitizeForJSON(profile.profilePicture),
            backgroundImageUrl: sanitizeForJSON(profile.backgroundImageUrl),
            publicIdentifier: sanitizeForJSON(profile.publicIdentifier),
            experience: ensureValidJSONArray(profile.experience),
            education: ensureValidJSONArray(profile.education),
            skills: ensureValidJSONArray(profile.skills),
            certifications: ensureValidJSONArray(profile.certifications),
            awards: ensureValidJSONArray(profile.awards),
            volunteerExperience: ensureValidJSONArray(profile.volunteerExperience),
            activity: ensureValidJSONArray(profile.activity),
            followingCompanies: ensureValidJSONArray(profile.followingCompanies),
            followingPeople: ensureValidJSONArray(profile.followingPeople),
            followingHashtags: ensureValidJSONArray(profile.followingHashtags),
            followingNewsletters: ensureValidJSONArray(profile.followingNewsletters),
            interestsIndustries: ensureValidJSONArray(profile.interestsIndustries),
            interestsTopics: ensureValidJSONArray(profile.interestsTopics),
            groups: ensureValidJSONArray(profile.groups),
            featured: ensureValidJSONArray(profile.featured),
            services: ensureValidJSONArray(profile.services),
            engagementData: profile.engagementData || {},
            creatorInfo: profile.creatorInfo || {},
            businessInfo: profile.businessInfo || {},
            geminiRawData: geminiResponse,
            rawGptResponse: typeof geminiResponse === 'string' ? geminiResponse : JSON.stringify(geminiResponse),
            inputTokens: geminiResponse.usage?.input_tokens || null,
            outputTokens: geminiResponse.usage?.output_tokens || null,
            totalTokens: geminiResponse.usage?.total_tokens || null,
            processingTimeMs: geminiResponse.processing_time_ms || null,
            apiRequestId: geminiResponse.api_request_id || null,
            responseStatus: geminiResponse.response_status || 'success'
        };

        const savedProfile = await createOrUpdateUserProfile(processedData);
        console.log(`✅ USER PROFILE GPT-5 nano data processed successfully`);
        return savedProfile;

    } catch (error) {
        console.error('❌ Error processing USER PROFILE GPT-5 nano data:', error);
        throw error;
    }
};

// ✅ TARGET PROFILE processing 
const processTargetGeminiData = async (userId, linkedinUrl, geminiResponse) => {
    try {
        console.log(`🎯 Processing GPT-5 nano data for TARGET profile...`);
        
        const profile = geminiResponse.profile;
        if (!profile) {
            throw new Error('No profile data found in Gemini response');
        }

        const processedData = {
            userId: userId,
            linkedinUrl: linkedinUrl,
            linkedinId: sanitizeForJSON(profile.linkedinId),
            inputUrl: linkedinUrl,
            url: sanitizeForJSON(profile.url),
            fullName: sanitizeForJSON(profile.name),
            firstName: sanitizeForJSON(profile.firstName),
            lastName: sanitizeForJSON(profile.lastName),
            headline: sanitizeForJSON(profile.headline),
            currentJobTitle: sanitizeForJSON(profile.currentJobTitle), // 🔧 FIXED: New field name
            about: sanitizeForJSON(profile.about),
            summary: sanitizeForJSON(profile.summary),
            location: sanitizeForJSON(profile.location),
            city: sanitizeForJSON(profile.city),
            state: sanitizeForJSON(profile.state),
            country: sanitizeForJSON(profile.country),
            countryCode: sanitizeForJSON(profile.countryCode),
            industry: sanitizeForJSON(profile.industry),
            currentCompany: sanitizeForJSON(profile.currentCompany),
            currentCompanyName: sanitizeForJSON(profile.currentCompanyName),
            connectionsCount: parseLinkedInNumber(profile.connectionsCount),
            followersCount: parseLinkedInNumber(profile.followersCount),
            mutualConnectionsCount: parseLinkedInNumber(profile.mutualConnectionsCount) || 0,
            totalLikes: parseLinkedInNumber(profile.totalLikes) || 0,
            totalComments: parseLinkedInNumber(profile.totalComments) || 0,
            totalShares: parseLinkedInNumber(profile.totalShares) || 0,
            averageLikes: profile.averageLikes || 0,
            profilePicture: sanitizeForJSON(profile.profilePicture),
            backgroundImageUrl: sanitizeForJSON(profile.backgroundImageUrl),
            publicIdentifier: sanitizeForJSON(profile.publicIdentifier),
            experience: ensureValidJSONArray(profile.experience),
            education: ensureValidJSONArray(profile.education),
            skills: ensureValidJSONArray(profile.skills),
            certifications: ensureValidJSONArray(profile.certifications),
            awards: ensureValidJSONArray(profile.awards),
            volunteerExperience: ensureValidJSONArray(profile.volunteerExperience),
            activity: ensureValidJSONArray(profile.activity),
            followingCompanies: ensureValidJSONArray(profile.followingCompanies),
            followingPeople: ensureValidJSONArray(profile.followingPeople),
            followingHashtags: ensureValidJSONArray(profile.followingHashtags),
            followingNewsletters: ensureValidJSONArray(profile.followingNewsletters),
            interestsIndustries: ensureValidJSONArray(profile.interestsIndustries),
            interestsTopics: ensureValidJSONArray(profile.interestsTopics),
            groups: ensureValidJSONArray(profile.groups),
            featured: ensureValidJSONArray(profile.featured),
            services: ensureValidJSONArray(profile.services),
            engagementData: profile.engagementData || {},
            creatorInfo: profile.creatorInfo || {},
            businessInfo: profile.businessInfo || {},
            geminiRawData: geminiResponse,
            rawGptResponse: typeof geminiResponse === 'string' ? geminiResponse : JSON.stringify(geminiResponse),
            inputTokens: geminiResponse.usage?.input_tokens || null,
            outputTokens: geminiResponse.usage?.output_tokens || null,
            totalTokens: geminiResponse.usage?.total_tokens || null,
            processingTimeMs: geminiResponse.processing_time_ms || null,
            apiRequestId: geminiResponse.api_request_id || null,
            responseStatus: geminiResponse.response_status || 'success'
        };

        const savedProfile = await createOrUpdateTargetProfile(userId, linkedinUrl, processedData);
        console.log(`✅ TARGET PROFILE GPT-5 nano data processed successfully`);
        return savedProfile;

    } catch (error) {
        console.error('❌ Error processing TARGET PROFILE GPT-5 nano data:', error);
        throw error;
    }
};

// ==================== DATABASE FUNCTIONS ====================

const createUser = async (email, hashedPassword) => {
    try {
        const result = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
            [email, hashedPassword]
        );
        return result.rows[0];
    } catch (error) {
        if (error.code === '23505') {
            throw new Error('User already exists');
        }
        throw error;
    }
};

const createGoogleUser = async (googleId, email, displayName, profilePicture, firstName, lastName) => {
    try {
        const result = await pool.query(`
            INSERT INTO users (google_id, email, display_name, profile_picture, first_name, last_name, registration_completed)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            RETURNING *
        `, [googleId, email, displayName, profilePicture, firstName, lastName]);
        
        return result.rows[0];
    } catch (error) {
        if (error.code === '23505') {
            throw new Error('User already exists');
        }
        throw error;
    }
};

const linkGoogleAccount = async (userId, googleId, displayName, profilePicture) => {
    try {
        const result = await pool.query(`
            UPDATE users 
            SET google_id = $2, display_name = $3, profile_picture = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [userId, googleId, displayName, profilePicture]);
        
        return result.rows[0];
    } catch (error) {
        throw error;
    }
};

const getUserByEmail = async (email) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return result.rows[0];
    } catch (error) {
        throw error;
    }
};

const getUserById = async (id) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0];
    } catch (error) {
        throw error;
    }
};

// ✅ USER PROFILE database function (unchanged from working version)
const createOrUpdateUserProfile = async (processedData) => {
    try {
        console.log(`💾 Saving USER profile to database for user ${processedData.userId}...`);
        
        let profile;
        const existingProfile = await pool.query(
            'SELECT id FROM user_profiles WHERE user_id = $1',
            [processedData.userId]
        );

        if (existingProfile.rows.length > 0) {
            console.log(`🔄 Updating existing USER profile for user ${processedData.userId}`);
            const result = await pool.query(`
                UPDATE user_profiles SET
                    linkedin_url = $2, linkedin_id = $3, input_url = $4, url = $5,
                    full_name = $6, first_name = $7, last_name = $8, headline = $9,
                    current_job_title = $10, about = $11, summary = $12, location = $13,
                    city = $14, state = $15, country = $16, country_code = $17,
                    industry = $18, current_company = $19, current_company_name = $20,
                    connections_count = $21, followers_count = $22, mutual_connections_count = $23,
                    total_likes = $24, total_comments = $25, total_shares = $26, average_likes = $27,
                    profile_picture = $28, background_image_url = $29, public_identifier = $30,
                    experience = $31, education = $32, skills = $33, certifications = $34, awards = $35,
                    volunteer_experience = $36, activity = $37, following_companies = $38,
                    following_people = $39, following_hashtags = $40, following_newsletters = $41,
                    interests_industries = $42, interests_topics = $43, groups = $44, featured = $45,
                    services = $46, engagement_data = $47, creator_info = $48, business_info = $49,
                    gemini_raw_data = $50, raw_gpt_response = $51, input_tokens = $52, output_tokens = $53,
                    total_tokens = $54, processing_time_ms = $55, api_request_id = $56, response_status = $57,
                    gemini_processed_at = NOW(), data_extraction_status = 'completed', 
                    profile_analyzed = true, extraction_completed_at = NOW(), updated_at = NOW()
                WHERE user_id = $1 RETURNING *
            `, [
                processedData.userId, processedData.linkedinUrl, processedData.linkedinId,
                processedData.inputUrl, processedData.url, processedData.fullName,
                processedData.firstName, processedData.lastName, processedData.headline,
                processedData.currentJobTitle, processedData.about, processedData.summary,
                processedData.location, processedData.city, processedData.state,
                processedData.country, processedData.countryCode, processedData.industry,
                processedData.currentCompany, processedData.currentCompanyName,
                processedData.connectionsCount, processedData.followersCount,
                processedData.mutualConnectionsCount, processedData.totalLikes,
                processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                processedData.profilePicture, processedData.backgroundImageUrl,
                processedData.publicIdentifier, JSON.stringify(processedData.experience),
                JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards),
                JSON.stringify(processedData.volunteerExperience), JSON.stringify(processedData.activity),
                JSON.stringify(processedData.followingCompanies), JSON.stringify(processedData.followingPeople),
                JSON.stringify(processedData.followingHashtags), JSON.stringify(processedData.followingNewsletters),
                JSON.stringify(processedData.interestsIndustries), JSON.stringify(processedData.interestsTopics),
                JSON.stringify(processedData.groups), JSON.stringify(processedData.featured),
                JSON.stringify(processedData.services), JSON.stringify(processedData.engagementData),
                JSON.stringify(processedData.creatorInfo), JSON.stringify(processedData.businessInfo),
                JSON.stringify(processedData.geminiRawData), processedData.rawGptResponse,
                processedData.inputTokens, processedData.outputTokens, processedData.totalTokens,
                processedData.processingTimeMs, processedData.apiRequestId, processedData.responseStatus
            ]);
            profile = result.rows[0];
        } else {
            console.log(`➕ Creating new USER profile for user ${processedData.userId}`);
            const result = await pool.query(`
                INSERT INTO user_profiles (
                    user_id, linkedin_url, linkedin_id, input_url, url, full_name, first_name, last_name, headline,
                    current_job_title, about, summary, location, city, state, country, country_code,
                    industry, current_company, current_company_name, connections_count, followers_count,
                    mutual_connections_count, total_likes, total_comments, total_shares, average_likes,
                    profile_picture, background_image_url, public_identifier, experience, education, skills,
                    certifications, awards, volunteer_experience, activity, following_companies,
                    following_people, following_hashtags, following_newsletters, interests_industries,
                    interests_topics, groups, featured, services, engagement_data, creator_info,
                    business_info, gemini_raw_data, raw_gpt_response, input_tokens, output_tokens,
                    total_tokens, processing_time_ms, api_request_id, response_status,
                    gemini_processed_at, data_extraction_status, profile_analyzed, extraction_completed_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, NOW(), 'completed', true, NOW()
                ) RETURNING *
            `, [
                processedData.userId, processedData.linkedinUrl, processedData.linkedinId,
                processedData.inputUrl, processedData.url, processedData.fullName,
                processedData.firstName, processedData.lastName, processedData.headline,
                processedData.currentJobTitle, processedData.about, processedData.summary,
                processedData.location, processedData.city, processedData.state,
                processedData.country, processedData.countryCode, processedData.industry,
                processedData.currentCompany, processedData.currentCompanyName,
                processedData.connectionsCount, processedData.followersCount,
                processedData.mutualConnectionsCount, processedData.totalLikes,
                processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                processedData.profilePicture, processedData.backgroundImageUrl,
                processedData.publicIdentifier, JSON.stringify(processedData.experience),
                JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards),
                JSON.stringify(processedData.volunteerExperience), JSON.stringify(processedData.activity),
                JSON.stringify(processedData.followingCompanies), JSON.stringify(processedData.followingPeople),
                JSON.stringify(processedData.followingHashtags), JSON.stringify(processedData.followingNewsletters),
                JSON.stringify(processedData.interestsIndustries), JSON.stringify(processedData.interestsTopics),
                JSON.stringify(processedData.groups), JSON.stringify(processedData.featured),
                JSON.stringify(processedData.services), JSON.stringify(processedData.engagementData),
                JSON.stringify(processedData.creatorInfo), JSON.stringify(processedData.businessInfo),
                JSON.stringify(processedData.geminiRawData), processedData.rawGptResponse,
                processedData.inputTokens, processedData.outputTokens, processedData.totalTokens,
                processedData.processingTimeMs, processedData.apiRequestId, processedData.responseStatus
            ]);
            profile = result.rows[0];
        }
        
        console.log(`✅ USER PROFILE saved successfully for user ${processedData.userId}`);
        return profile;
        
    } catch (error) {
        console.error('❌ Error in USER PROFILE creation:', error);
        throw error;
    }
};

// ✅ TARGET PROFILE database function - FIXED parameter count
const createOrUpdateTargetProfile = async (userId, linkedinUrl, targetData) => {
    try {
        console.log(`🎯 Saving TARGET profile to database for user ${userId}...`);
        
        let profile;
        const existingProfile = await pool.query(
            'SELECT id FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [userId, linkedinUrl]
        );

        if (existingProfile.rows.length > 0) {
            console.log(`🔄 Updating existing TARGET profile for user ${userId}`);
            const result = await pool.query(`
                UPDATE target_profiles SET
                    linkedin_id = $3, input_url = $4, url = $5, full_name = $6, first_name = $7,
                    last_name = $8, headline = $9, current_job_title = $10, about = $11, summary = $12,
                    location = $13, city = $14, state = $15, country = $16, country_code = $17,
                    industry = $18, current_company = $19, current_company_name = $20,
                    connections_count = $21, followers_count = $22, mutual_connections_count = $23,
                    total_likes = $24, total_comments = $25, total_shares = $26, average_likes = $27,
                    profile_picture = $28, background_image_url = $29, public_identifier = $30,
                    experience = $31, education = $32, skills = $33, certifications = $34, awards = $35,
                    volunteer_experience = $36, activity = $37, following_companies = $38,
                    following_people = $39, following_hashtags = $40, following_newsletters = $41,
                    interests_industries = $42, interests_topics = $43, groups = $44, featured = $45,
                    services = $46, engagement_data = $47, creator_info = $48, business_info = $49,
                    gemini_raw_data = $50, raw_gpt_response = $51, input_tokens = $52, output_tokens = $53,
                    total_tokens = $54, processing_time_ms = $55, api_request_id = $56, response_status = $57,
                    gemini_processed_at = NOW(), data_extraction_status = 'completed', 
                    profile_analyzed = true, extraction_completed_at = NOW(), updated_at = NOW()
                WHERE user_id = $1 AND linkedin_url = $2 RETURNING *
            `, [
                userId, linkedinUrl, targetData.linkedinId, targetData.inputUrl, targetData.url,
                targetData.fullName, targetData.firstName, targetData.lastName, targetData.headline,
                targetData.currentJobTitle, targetData.about, targetData.summary, targetData.location,
                targetData.city, targetData.state, targetData.country, targetData.countryCode,
                targetData.industry, targetData.currentCompany, targetData.currentCompanyName,
                targetData.connectionsCount, targetData.followersCount, targetData.mutualConnectionsCount,
                targetData.totalLikes, targetData.totalComments, targetData.totalShares, targetData.averageLikes,
                targetData.profilePicture, targetData.backgroundImageUrl, targetData.publicIdentifier,
                JSON.stringify(targetData.experience), JSON.stringify(targetData.education),
                JSON.stringify(targetData.skills), JSON.stringify(targetData.certifications),
                JSON.stringify(targetData.awards), JSON.stringify(targetData.volunteerExperience),
                JSON.stringify(targetData.activity), JSON.stringify(targetData.followingCompanies),
                JSON.stringify(targetData.followingPeople), JSON.stringify(targetData.followingHashtags),
                JSON.stringify(targetData.followingNewsletters), JSON.stringify(targetData.interestsIndustries),
                JSON.stringify(targetData.interestsTopics), JSON.stringify(targetData.groups),
                JSON.stringify(targetData.featured), JSON.stringify(targetData.services),
                JSON.stringify(targetData.engagementData), JSON.stringify(targetData.creatorInfo),
                JSON.stringify(targetData.businessInfo), JSON.stringify(targetData.geminiRawData),
                targetData.rawGptResponse || null, targetData.inputTokens || null, targetData.outputTokens || null,
                targetData.totalTokens || null, targetData.processingTimeMs || null,
                targetData.apiRequestId || null, targetData.responseStatus || 'success'
            ]);
            profile = result.rows[0];
        } else {
            console.log(`➕ Creating new TARGET profile for user ${userId}`);
            const result = await pool.query(`
                INSERT INTO target_profiles (
                    user_id, linkedin_url, linkedin_id, input_url, url, full_name, first_name, last_name,
                    headline, current_job_title, about, summary, location, city, state, country, country_code,
                    industry, current_company, current_company_name, connections_count, followers_count,
                    mutual_connections_count, total_likes, total_comments, total_shares, average_likes,
                    profile_picture, background_image_url, public_identifier, experience, education, skills,
                    certifications, awards, volunteer_experience, activity, following_companies,
                    following_people, following_hashtags, following_newsletters, interests_industries,
                    interests_topics, groups, featured, services, engagement_data, creator_info,
                    business_info, gemini_raw_data, raw_gpt_response, input_tokens, output_tokens,
                    total_tokens, processing_time_ms, api_request_id, response_status,
                    gemini_processed_at, data_extraction_status, profile_analyzed, extraction_completed_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, NOW(), 'completed', true, NOW()
                ) RETURNING *
            `, [
                userId,                                      // $1
                linkedinUrl,                                 // $2
                targetData.linkedinId,                       // $3
                targetData.inputUrl,                         // $4
                targetData.url,                              // $5
                targetData.fullName,                         // $6
                targetData.firstName,                        // $7
                targetData.lastName,                         // $8
                targetData.headline,                         // $9
                targetData.currentJobTitle,                  // $10
                targetData.about,                            // $11 - ✅ FIXED: Now regular TEXT column
                targetData.summary,                          // $12
                targetData.location,                         // $13
                targetData.city,                             // $14
                targetData.state,                            // $15
                targetData.country,                          // $16
                targetData.countryCode,                      // $17
                targetData.industry,                         // $18
                targetData.currentCompany,                   // $19
                targetData.currentCompanyName,               // $20
                targetData.connectionsCount,                 // $21
                targetData.followersCount,                   // $22
                targetData.mutualConnectionsCount,           // $23
                targetData.totalLikes,                       // $24
                targetData.totalComments,                    // $25
                targetData.totalShares,                      // $26
                targetData.averageLikes,                     // $27
                targetData.profilePicture,                   // $28
                targetData.backgroundImageUrl,               // $29
                targetData.publicIdentifier,                 // $30
                JSON.stringify(targetData.experience),       // $31
                JSON.stringify(targetData.education),        // $32
                JSON.stringify(targetData.skills),           // $33
                JSON.stringify(targetData.certifications),   // $34
                JSON.stringify(targetData.awards),           // $35
                JSON.stringify(targetData.volunteerExperience), // $36
                JSON.stringify(targetData.activity),         // $37
                JSON.stringify(targetData.followingCompanies), // $38
                JSON.stringify(targetData.followingPeople),  // $39
                JSON.stringify(targetData.followingHashtags), // $40
                JSON.stringify(targetData.followingNewsletters), // $41
                JSON.stringify(targetData.interestsIndustries), // $42
                JSON.stringify(targetData.interestsTopics),  // $43
                JSON.stringify(targetData.groups),           // $44
                JSON.stringify(targetData.featured),         // $45
                JSON.stringify(targetData.services),         // $46
                JSON.stringify(targetData.engagementData),   // $47
                JSON.stringify(targetData.creatorInfo),      // $48
                JSON.stringify(targetData.businessInfo),     // $49
                JSON.stringify(targetData.geminiRawData),    // $50
                targetData.rawGptResponse || null,           // $51
                targetData.inputTokens || null,              // $52
                targetData.outputTokens || null,             // $53
                targetData.totalTokens || null,              // $54
                targetData.processingTimeMs || null,         // $55
                targetData.apiRequestId || null,             // $56
                targetData.responseStatus || 'success'       // $57 - ✅ FIXED: All 57 parameters mapped!
            ]);
            profile = result.rows[0];
        }
        
        console.log(`✅ TARGET PROFILE saved successfully for user ${userId}`);
        console.log(`📄 About section: ${targetData.about ? 'Included' : 'Not available'}`);
        return profile;
        
    } catch (error) {
        console.error('❌ Error in TARGET PROFILE creation:', error);
        throw error;
    }
};

// ✅ Helper functions
const getTargetProfile = async (userId, linkedinUrl) => {
    try {
        const result = await pool.query(
            'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [userId, linkedinUrl]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Error fetching target profile:', error);
        throw error;
    }
};

const getUserProfile = async (userId) => {
    try {
        const result = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Error fetching user profile:', error);
        throw error;
    }
};

// ==================== DATABASE CONNECTION TESTING ====================

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ RAILWAY FIXED database connected:', result.rows[0].now);
        await initDB();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// ✅ Export all functions
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
    
    // TARGET PROFILE functions
    processTargetGeminiData,
    createOrUpdateTargetProfile,
    getTargetProfile,
    getUserProfile,
    
    // Data processing helpers
    sanitizeForJSON,
    ensureValidJSONArray,
    parseLinkedInNumber,
    processGeminiData
};
