// ✅ COMPLETE FIXED database.js - Ready for Deployment
// Fixed parameter count issue + reserved word issue

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
        console.log('🗃️ Creating FIXED TARGET + USER PROFILE database tables...');

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
                
                -- Additional fields for complete LinkedIn data
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
                
                -- RAW GEMINI DATA STORAGE FOR GPT 5 NANO
                gemini_raw_data JSONB,
                gemini_processed_at TIMESTAMP,
                gemini_token_usage JSONB DEFAULT '{}'::JSONB,
                
                -- TOKEN TRACKING COLUMNS
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
                
                -- Additional fields for complete LinkedIn data
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
                
                -- RAW GEMINI DATA STORAGE FOR GPT 5 NANO
                gemini_raw_data JSONB,
                gemini_processed_at TIMESTAMP,
                gemini_token_usage JSONB DEFAULT '{}'::JSONB,
                
                -- TOKEN TRACKING COLUMNS
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

            // Apply same columns to target_profiles
            const targetColumns = enhancedColumns.map(query => 
                query.replace('user_profiles', 'target_profiles')
            );

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

        console.log('✅ FIXED database tables created successfully!');
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

// ✅ USER PROFILE: Process Gemini data (FIXED: currentRole → currentJobTitle)
const processGeminiData = (geminiResponse, cleanProfileUrl) => {
    try {
        console.log('📊 Processing Gemini extracted data for USER PROFILE...');
        
        const aiData = geminiResponse.data;
        const profile = aiData.profile || {};
        const engagement = aiData.engagement || {};
        
        console.log('🔍 AI Data Structure Check:');
        console.log(`   - Profile name: ${profile.name || 'Not found'}`);
        console.log(`   - Experience count: ${aiData.experience?.length || 0}`);
        console.log(`   - Activity count: ${aiData.activity?.length || 0}`);
        console.log(`   - Certifications: ${aiData.certifications?.length || 0}`);
        
        const processedData = {
            linkedinUrl: cleanProfileUrl,
            url: cleanProfileUrl,
            
            // Basic Info
            fullName: profile.name || '',
            firstName: profile.firstName || (profile.name ? profile.name.split(' ')[0] : ''),
            lastName: profile.lastName || (profile.name ? profile.name.split(' ').slice(1).join(' ') : ''),
            headline: profile.headline || '',
            currentJobTitle: profile.currentRole || '',  // 🔧 FIXED: Changed mapping
            about: profile.about || '',
            location: profile.location || '',
            
            // Company Info
            currentCompany: profile.currentCompany || '',
            currentCompanyName: profile.currentCompany || '',
            
            // Metrics
            connectionsCount: parseLinkedInNumber(profile.connectionsCount),
            followersCount: parseLinkedInNumber(profile.followersCount),
            mutualConnectionsCount: parseLinkedInNumber(profile.mutualConnections) || 0,
            
            // Enhanced engagement fields
            totalLikes: parseLinkedInNumber(engagement.totalLikes) || 0,
            totalComments: parseLinkedInNumber(engagement.totalComments) || 0,
            totalShares: parseLinkedInNumber(engagement.totalShares) || 0,
            averageLikes: parseFloat(engagement.averageLikes) || 0,
            
            // Complex data arrays
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
            
            // Raw Gemini data storage
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
        console.log(`   - Current Job Title: ${processedData.currentJobTitle || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - About section: ${processedData.about ? 'Available' : 'Not available'}`);
        console.log(`   - Experience entries: ${processedData.experience.length}`);
        console.log(`   - Has Experience: ${processedData.hasExperience}`);
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error processing USER PROFILE Gemini data:', error);
        throw new Error(`USER PROFILE Gemini data processing failed: ${error.message}`);
    }
};

// ✅ TARGET PROFILE: Process Gemini data (FIXED: currentRole → currentJobTitle)
const processTargetGeminiData = (geminiResponse, cleanProfileUrl) => {
    try {
        console.log('📊 Processing Gemini extracted data for TARGET PROFILE...');
        
        const aiData = geminiResponse.data;
        const profile = aiData.profile || {};
        const engagement = aiData.engagement || {};
        
        console.log('🔍 TARGET AI Data Structure Check:');
        console.log(`   - Profile name: ${profile.name || 'Not found'}`);
        console.log(`   - Experience count: ${aiData.experience?.length || 0}`);
        console.log(`   - Activity count: ${aiData.activity?.length || 0}`);
        console.log(`   - Certifications: ${aiData.certifications?.length || 0}`);
        
        const processedData = {
            linkedinUrl: cleanProfileUrl,
            url: cleanProfileUrl,
            
            // Basic Info - EXACT same mapping as USER
            fullName: profile.name || '',
            firstName: profile.firstName || (profile.name ? profile.name.split(' ')[0] : ''),
            lastName: profile.lastName || (profile.name ? profile.name.split(' ').slice(1).join(' ') : ''),
            headline: profile.headline || '',
            currentJobTitle: profile.currentRole || '',  // 🔧 FIXED: Changed mapping
            about: profile.about || '',
            location: profile.location || '',
            
            // Company Info
            currentCompany: profile.currentCompany || '',
            currentCompanyName: profile.currentCompany || '',
            
            // Metrics
            connectionsCount: parseLinkedInNumber(profile.connectionsCount),
            followersCount: parseLinkedInNumber(profile.followersCount),
            mutualConnectionsCount: parseLinkedInNumber(profile.mutualConnections) || 0,
            
            // Enhanced engagement fields
            totalLikes: parseLinkedInNumber(engagement.totalLikes) || 0,
            totalComments: parseLinkedInNumber(engagement.totalComments) || 0,
            totalShares: parseLinkedInNumber(engagement.totalShares) || 0,
            averageLikes: parseFloat(engagement.averageLikes) || 0,
            
            // Complex data arrays - EXACT same mapping as USER
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
            
            // Raw Gemini data storage
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
        console.log(`   - Current Job Title: ${processedData.currentJobTitle || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - About section: ${processedData.about ? 'Available' : 'Not available'}`);
        console.log(`   - Experience entries: ${processedData.experience.length}`);
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

// ✅ USER PROFILE: Create user profile (UNCHANGED)
const createOrUpdateUserProfile = async (userId, linkedinUrl, displayName = null) => {
    try {
        console.log(`🚀 Creating USER PROFILE for user ${userId}`);
        console.log(`🔗 Original URL: ${linkedinUrl}`);
        
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
        
        console.log(`✅ USER PROFILE created for user ${userId}`);
        return profile;
        
    } catch (error) {
        console.error('Error in USER PROFILE creation:', error);
        throw error;
    }
};

// ✅ TARGET PROFILE: Create and update target profiles (FIXED parameter count)
const createOrUpdateTargetProfile = async (userId, linkedinUrl, targetData) => {
    try {
        console.log(`🎯 Creating TARGET PROFILE for user ${userId}`);
        console.log(`🔗 Target URL: ${linkedinUrl}`);
        
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
                    current_job_title = $5,
                    current_company = $6,
                    connections_count = $7,
                    followers_count = $8,
                    mutual_connections_count = $9,
                    total_likes = $10,
                    total_comments = $11,
                    total_shares = $12,
                    average_likes = $13,
                    experience = $14,
                    education = $15,
                    skills = $16,
                    certifications = $17,
                    awards = $18,
                    volunteer_experience = $19,
                    activity = $20,
                    following_companies = $21,
                    following_people = $22,
                    following_hashtags = $23,
                    following_newsletters = $24,
                    interests_industries = $25,
                    interests_topics = $26,
                    groups = $27,
                    featured = $28,
                    services = $29,
                    engagement_data = $30,
                    creator_info = $31,
                    business_info = $32,
                    gemini_raw_data = $33,
                    raw_gpt_response = $34,
                    input_tokens = $35,
                    output_tokens = $36,
                    total_tokens = $37,
                    processing_time_ms = $38,
                    api_request_id = $39,
                    response_status = $40,
                    gemini_processed_at = NOW(),
                    data_extraction_status = 'completed',
                    profile_analyzed = true,
                    extraction_completed_at = NOW(),
                    updated_at = NOW()
                WHERE user_id = $41 AND linkedin_url = $42
                RETURNING *
            `, [
                targetData.fullName,
                targetData.headline,
                targetData.about,
                targetData.location,
                targetData.currentJobTitle,
                targetData.currentCompany,
                targetData.connectionsCount,
                targetData.followersCount,
                targetData.mutualConnectionsCount,
                targetData.totalLikes,
                targetData.totalComments,
                targetData.totalShares,
                targetData.averageLikes,
                JSON.stringify(targetData.experience),
                JSON.stringify(targetData.education),
                JSON.stringify(targetData.skills),
                JSON.stringify(targetData.certifications),
                JSON.stringify(targetData.awards),
                JSON.stringify(targetData.volunteerExperience),
                JSON.stringify(targetData.activity),
                JSON.stringify(targetData.followingCompanies),
                JSON.stringify(targetData.followingPeople),
                JSON.stringify(targetData.followingHashtags),
                JSON.stringify(targetData.followingNewsletters),
                JSON.stringify(targetData.interestsIndustries),
                JSON.stringify(targetData.interestsTopics),
                JSON.stringify(targetData.groups),
                JSON.stringify(targetData.featured),
                JSON.stringify(targetData.services),
                JSON.stringify(targetData.engagementData),
                JSON.stringify(targetData.creatorInfo),
                JSON.stringify(targetData.businessInfo),
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
            // 🔧 FIXED: Corrected INSERT statement with exact parameter count (42 parameters)
            const result = await pool.query(`
                INSERT INTO target_profiles (
                    user_id, linkedin_url, full_name, headline, about, location,
                    current_job_title, current_company, connections_count, followers_count,
                    mutual_connections_count, total_likes, total_comments, total_shares,
                    average_likes, experience, education, skills, certifications, awards,
                    volunteer_experience, activity, following_companies, following_people,
                    following_hashtags, following_newsletters, interests_industries,
                    interests_topics, groups, featured, services, engagement_data,
                    creator_info, business_info, gemini_raw_data, raw_gpt_response,
                    input_tokens, output_tokens, total_tokens, processing_time_ms,
                    api_request_id, response_status, gemini_processed_at,
                    data_extraction_status, profile_analyzed, extraction_completed_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, NOW(), 'completed', true, NOW()
                ) RETURNING *
            `, [
                userId,                                      // $1
                linkedinUrl,                                 // $2
                targetData.fullName,                         // $3
                targetData.headline,                         // $4
                targetData.about,                            // $5
                targetData.location,                         // $6
                targetData.currentJobTitle,                  // $7
                targetData.currentCompany,                   // $8
                targetData.connectionsCount,                 // $9
                targetData.followersCount,                   // $10
                targetData.mutualConnectionsCount,           // $11
                targetData.totalLikes,                       // $12
                targetData.totalComments,                    // $13
                targetData.totalShares,                      // $14
                targetData.averageLikes,                     // $15
                JSON.stringify(targetData.experience),       // $16
                JSON.stringify(targetData.education),        // $17
                JSON.stringify(targetData.skills),           // $18
                JSON.stringify(targetData.certifications),   // $19
                JSON.stringify(targetData.awards),           // $20
                JSON.stringify(targetData.volunteerExperience), // $21
                JSON.stringify(targetData.activity),         // $22
                JSON.stringify(targetData.followingCompanies), // $23
                JSON.stringify(targetData.followingPeople),  // $24
                JSON.stringify(targetData.followingHashtags), // $25
                JSON.stringify(targetData.followingNewsletters), // $26
                JSON.stringify(targetData.interestsIndustries), // $27
                JSON.stringify(targetData.interestsTopics),  // $28
                JSON.stringify(targetData.groups),           // $29
                JSON.stringify(targetData.featured),         // $30
                JSON.stringify(targetData.services),         // $31
                JSON.stringify(targetData.engagementData),   // $32
                JSON.stringify(targetData.creatorInfo),      // $33
                JSON.stringify(targetData.businessInfo),     // $34
                JSON.stringify(targetData.geminiRawData),    // $35
                targetData.rawGptResponse || null,           // $36
                targetData.inputTokens || null,              // $37
                targetData.outputTokens || null,             // $38
                targetData.totalTokens || null,              // $39
                targetData.processingTimeMs || null,         // $40
                targetData.apiRequestId || null,             // $41
                targetData.responseStatus || 'success'       // $42 - FIXED PARAMETER!
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
        console.log('✅ COMPLETE database connected:', result.rows[0].now);
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
