// ENHANCED database.js - Added Plans Table + Dual Credit System
// Sophisticated credit management with renewable + pay-as-you-go credits

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
        console.log('Creating enhanced database tables with dual credit system...');

        // PLANS TABLE - FIXED: Drop and recreate with correct schema
        await pool.query(`DROP TABLE IF EXISTS plans CASCADE;`);
        
        await pool.query(`
            CREATE TABLE plans (
                id SERIAL PRIMARY KEY,
                plan_code VARCHAR(50) UNIQUE NOT NULL,
                plan_name VARCHAR(100) NOT NULL,
                billing_model VARCHAR(20) NOT NULL,
                price_cents INTEGER NOT NULL,
                currency VARCHAR(3) DEFAULT 'USD',
                renewable_credits INTEGER NOT NULL,
                is_pay_as_you_go BOOLEAN DEFAULT FALSE,
                description TEXT,
                features JSONB DEFAULT '[]'::JSONB,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // INSERT REAL PLAN DATA (from sign-up.html)
        await pool.query(`
            INSERT INTO plans (plan_code, plan_name, billing_model, price_cents, renewable_credits, is_pay_as_you_go, description) 
            VALUES 
                ('free', 'Free', 'monthly', 0, 7, FALSE, 'Free plan with 7 monthly renewable credits'),
                ('silver-monthly', 'Silver Monthly', 'monthly', 1390, 30, FALSE, 'Silver monthly plan with 30 renewable credits'),
                ('silver-payasyougo', 'Silver Pay-as-you-go', 'one_time', 1700, 30, TRUE, 'Silver one-time purchase of 30 non-expiring credits'),
                ('gold-monthly', 'Gold Monthly', 'monthly', 3200, 100, FALSE, 'Gold monthly plan with 100 renewable credits'),
                ('gold-payasyougo', 'Gold Pay-as-you-go', 'one_time', 3900, 100, TRUE, 'Gold one-time purchase of 100 non-expiring credits'),
                ('platinum-monthly', 'Platinum Monthly', 'monthly', 6387, 250, FALSE, 'Platinum monthly plan with 250 renewable credits'),
                ('platinum-payasyougo', 'Platinum Pay-as-you-go', 'one_time', 7800, 250, TRUE, 'Platinum one-time purchase of 250 non-expiring credits')
            ON CONFLICT (plan_code) DO UPDATE SET
                plan_name = EXCLUDED.plan_name,
                price_cents = EXCLUDED.price_cents,
                renewable_credits = EXCLUDED.renewable_credits,
                updated_at = CURRENT_TIMESTAMP;
        `);

        // ENHANCED USERS TABLE
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
                
                -- NEW: Dual Credit System
                plan_code VARCHAR(50) DEFAULT 'free' REFERENCES plans(plan_code),
                renewable_credits INTEGER DEFAULT 7,
                payasyougo_credits INTEGER DEFAULT 0,
                
                -- NEW: Billing Cycle Management
                subscription_starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                next_billing_date TIMESTAMP,
                
                -- Legacy field (will be calculated from dual credits)
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

        // USER_PROFILES TABLE (unchanged)
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
                current_job_title TEXT,
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

        // Supporting tables (unchanged)
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

        // CREDITS_TRANSACTIONS TABLE - FIXED: Drop and recreate with correct schema
        await pool.query(`DROP TABLE IF EXISTS credits_transactions CASCADE;`);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS credits_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                operation_type VARCHAR(50),
                amount DECIMAL(10,2),
                status VARCHAR(20),
                hold_id VARCHAR(100),
                operation_data JSONB,
                operation_result JSONB,
                processing_time_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );
        `);

        // Add missing columns (safe operation)
        try {
            const enhancedUserColumns = [
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url TEXT',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_data JSONB',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT \'not_started\'',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS error_message TEXT',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_completed BOOLEAN DEFAULT false',
                
                // NEW: Dual Credit System columns
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_code VARCHAR(50) DEFAULT \'free\'',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS renewable_credits INTEGER DEFAULT 7',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS payasyougo_credits INTEGER DEFAULT 0',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMP'
            ];
            
            console.log('-- NEW: Dual Credit System columns');
            
            for (const columnQuery of enhancedUserColumns) {
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

            // Add enhanced fields to user_profiles only
            const enhancedProfileColumns = [
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS initial_scraping_done BOOLEAN DEFAULT false',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS current_job_title TEXT',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS average_likes DECIMAL(10,2) DEFAULT 0',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS awards JSONB DEFAULT \'[]\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS engagement_data JSONB DEFAULT \'{}\'::JSONB',
                'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mutual_connections_count INTEGER DEFAULT 0'
            ];

            for (const columnQuery of enhancedProfileColumns) {
                try {
                    await pool.query(columnQuery);
                } catch (err) {
                    console.log(`Column might already exist: ${err.message}`);
                }
            }
            
            console.log('Enhanced database columns updated successfully');
        } catch (err) {
            console.log('Some enhanced columns might already exist:', err.message);
        }

        // Create indexes
        try {
            await pool.query(`
                -- User profiles indexes
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_linkedin_url ON user_profiles(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_current_company ON user_profiles(current_company);
                
                -- Users indexes
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
                CREATE INDEX IF NOT EXISTS idx_users_plan_code ON users(plan_code);
                
                -- Plans indexes
                CREATE INDEX IF NOT EXISTS idx_plans_plan_code ON plans(plan_code);
                CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(active);
                
                -- Credits transactions indexes
                CREATE INDEX IF NOT EXISTS idx_credits_transactions_user_id ON credits_transactions(user_id);
                CREATE INDEX IF NOT EXISTS idx_credits_transactions_hold_id ON credits_transactions(hold_id);
                CREATE INDEX IF NOT EXISTS idx_credits_transactions_status ON credits_transactions(status);
            `);
            console.log('Database indexes created successfully');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        // Set next billing dates for existing free users
        try {
            await pool.query(`
                UPDATE users 
                SET next_billing_date = subscription_starts_at + INTERVAL '1 month'
                WHERE plan_code = 'free' AND next_billing_date IS NULL;
            `);
        } catch (err) {
            console.log('Billing date update error:', err.message);
        }

        console.log('Enhanced database with dual credit system created successfully!');
    } catch (error) {
        console.error('Database setup error:', error);
        throw error;
    }
};

// ==================== DUAL CREDIT MANAGEMENT FUNCTIONS ====================

// NEW: Get user plan with real data
const getUserPlan = async (userId) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.plan_code,
                u.renewable_credits,
                u.payasyougo_credits,
                u.subscription_starts_at,
                u.next_billing_date,
                u.subscription_status,
                p.plan_name,
                p.billing_model,
                p.price_cents,
                p.renewable_credits as plan_renewable_credits,
                p.is_pay_as_you_go
            FROM users u
            LEFT JOIN plans p ON u.plan_code = p.plan_code
            WHERE u.id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            throw new Error('User not found');
        }

        const user = result.rows[0];
        
        // Calculate total credits (pay-as-you-go + renewable)
        const totalCredits = (user.renewable_credits || 0) + (user.payasyougo_credits || 0);
        
        // Calculate next billing date for display
        let renewalDate = 'Never';
        if (user.next_billing_date) {
            renewalDate = new Date(user.next_billing_date).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
        }

        return {
            success: true,
            data: {
                userId: user.id,
                planCode: user.plan_code,
                planName: user.plan_name || 'Free',
                billingModel: user.billing_model || 'monthly',
                subscriptionStatus: user.subscription_status || 'active',
                
                // Credit breakdown
                renewableCredits: user.renewable_credits || 0,
                payasyougoCredits: user.payasyougo_credits || 0,
                totalCredits: totalCredits,
                
                // Plan details
                planRenewableCredits: user.plan_renewable_credits || 7,
                priceCents: user.price_cents || 0,
                
                // Billing info
                subscriptionStartsAt: user.subscription_starts_at,
                nextBillingDate: user.next_billing_date,
                renewalDate: renewalDate,
                
                // UI display data
                creditsDisplay: `${totalCredits}/${user.plan_renewable_credits || 7} Credits`,
                renewalDisplay: `Renews ${renewalDate}`,
                progressPercentage: Math.round(((user.renewable_credits || 0) / (user.plan_renewable_credits || 7)) * 100)
            }
        };
    } catch (error) {
        console.error('Error getting user plan:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// NEW: Update user credits (dual system)
const updateUserCredits = async (userId, creditChange, creditType = 'payasyougo') => {
    try {
        let updateQuery;
        
        if (creditType === 'renewable') {
            updateQuery = `
                UPDATE users 
                SET renewable_credits = GREATEST(0, renewable_credits + $1),
                    credits_remaining = renewable_credits + payasyougo_credits,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING renewable_credits, payasyougo_credits, (renewable_credits + payasyougo_credits) as total_credits
            `;
        } else {
            updateQuery = `
                UPDATE users 
                SET payasyougo_credits = GREATEST(0, payasyougo_credits + $1),
                    credits_remaining = renewable_credits + payasyougo_credits,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING renewable_credits, payasyougo_credits, (renewable_credits + payasyougo_credits) as total_credits
            `;
        }
        
        const result = await pool.query(updateQuery, [creditChange, userId]);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const credits = result.rows[0];
        
        return {
            success: true,
            renewableCredits: credits.renewable_credits,
            payasyougoCredits: credits.payasyougo_credits,
            totalCredits: credits.total_credits
        };
    } catch (error) {
        console.error('Error updating user credits:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// NEW: Spend credits (pay-as-you-go first, then renewable)
const spendUserCredits = async (userId, amount) => {
    try {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get current credits
            const userResult = await client.query(
                'SELECT renewable_credits, payasyougo_credits FROM users WHERE id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const { renewable_credits, payasyougo_credits } = userResult.rows[0];
            const totalAvailable = renewable_credits + payasyougo_credits;
            
            if (totalAvailable < amount) {
                throw new Error('Insufficient credits');
            }
            
            let newPayasyougo = payasyougo_credits;
            let newRenewable = renewable_credits;
            
            // Spend pay-as-you-go first
            if (payasyougo_credits >= amount) {
                newPayasyougo = payasyougo_credits - amount;
            } else {
                // Spend all pay-as-you-go, then renewable
                const remaining = amount - payasyougo_credits;
                newPayasyougo = 0;
                newRenewable = renewable_credits - remaining;
            }
            
            // Update credits
            await client.query(`
                UPDATE users 
                SET 
                    renewable_credits = $1,
                    payasyougo_credits = $2,
                    credits_remaining = $1 + $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [newRenewable, newPayasyougo, userId]);
            
            await client.query('COMMIT');
            
            return {
                success: true,
                spent: amount,
                newRenewableCredits: newRenewable,
                newPayasyougoCredits: newPayasyougo,
                newTotalCredits: newRenewable + newPayasyougo
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error spending user credits:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// NEW: Reset renewable credits (monthly billing cycle)
const resetRenewableCredits = async (userId) => {
    try {
        const planResult = await pool.query(`
            SELECT p.renewable_credits
            FROM users u
            JOIN plans p ON u.plan_code = p.plan_code
            WHERE u.id = $1
        `, [userId]);
        
        if (planResult.rows.length === 0) {
            throw new Error('User or plan not found');
        }
        
        const planRenewableCredits = planResult.rows[0].renewable_credits;
        
        // Reset renewable credits to plan amount, keep pay-as-you-go unchanged
        const result = await pool.query(`
            UPDATE users 
            SET 
                renewable_credits = $1,
                credits_remaining = $1 + payasyougo_credits,
                next_billing_date = next_billing_date + INTERVAL '1 month',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING renewable_credits, payasyougo_credits, (renewable_credits + payasyougo_credits) as total_credits
        `, [planRenewableCredits, userId]);
        
        const credits = result.rows[0];
        
        return {
            success: true,
            renewableCredits: credits.renewable_credits,
            payasyougoCredits: credits.payasyougo_credits,
            totalCredits: credits.total_credits
        };
    } catch (error) {
        console.error('Error resetting renewable credits:', error);
        return {
            success: false,
            error: error.message
        };
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

// USER PROFILE ONLY: Process Gemini data (keeps working)
const processGeminiData = (geminiResponse, cleanProfileUrl) => {
    try {
        console.log('Processing Gemini extracted data for USER profile...');
        
        const aiData = geminiResponse.data;
        const profile = aiData.profile || {};
        const engagement = aiData.engagement || {};
        
        console.log('AI Data Structure Check:');
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
            currentJobTitle: profile.currentRole || '',
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
        
        console.log('Gemini data processed successfully for USER profile');
        console.log(`Processed data summary:`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Current Job Title: ${processedData.currentJobTitle || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - About section: ${processedData.about ? 'Available' : 'Not available'}`);
        console.log(`   - Experience entries: ${processedData.experience.length}`);
        console.log(`   - Has Experience: ${processedData.hasExperience}`);
        
        return processedData;
        
    } catch (error) {
        console.error('Error processing Gemini data for USER profile:', error);
        throw new Error(`Gemini data processing failed: ${error.message}`);
    }
};

// ==================== USER MANAGEMENT FUNCTIONS ====================

const createUser = async (email, passwordHash, packageType = 'free', billingModel = 'monthly') => {
    // Get credits from plans table
    const planResult = await pool.query(
        'SELECT renewable_credits FROM plans WHERE plan_code = $1',
        [packageType]
    );
    
    const renewableCredits = planResult.rows[0]?.renewable_credits || 7;
    
    const result = await pool.query(`
        INSERT INTO users (
            email, password_hash, package_type, billing_model, plan_code,
            renewable_credits, payasyougo_credits, credits_remaining,
            subscription_starts_at, next_billing_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [
        email, passwordHash, packageType, billingModel, packageType,
        renewableCredits, 0, renewableCredits,
        new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Next month
    ]);
    
    return result.rows[0];
};

const createGoogleUser = async (email, displayName, googleId, profilePicture, packageType = 'free', billingModel = 'monthly') => {
    // Get credits from plans table
    const planResult = await pool.query(
        'SELECT renewable_credits FROM plans WHERE plan_code = $1',
        [packageType]
    );
    
    const renewableCredits = planResult.rows[0]?.renewable_credits || 7;
    
    const result = await pool.query(`
        INSERT INTO users (
            email, google_id, display_name, profile_picture, 
            package_type, billing_model, plan_code,
            renewable_credits, payasyougo_credits, credits_remaining,
            subscription_starts_at, next_billing_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *
    `, [
        email, googleId, displayName, profilePicture, 
        packageType, billingModel, packageType,
        renewableCredits, 0, renewableCredits,
        new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Next month
    ]);
    
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

// USER PROFILE: Create user profile (UNCHANGED - still working)
const createOrUpdateUserProfile = async (userId, linkedinUrl, displayName = null) => {
    try {
        console.log(`Creating USER PROFILE for user ${userId}`);
        console.log(`Original URL: ${linkedinUrl}`);
        
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
        
        console.log(`USER PROFILE created for user ${userId}`);
        return profile;
        
    } catch (error) {
        console.error('Error in USER PROFILE creation:', error);
        throw error;
    }
};

// Helper functions
const getUserProfile = async (userId) => {
    try {
        const result = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error fetching user profile:', error);
        throw error;
    }
};

// ==================== DATABASE CONNECTION TESTING ====================

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('Enhanced database connected:', result.rows[0].now);
        await initDB();
        return true;
    } catch (error) {
        console.error('Database connection failed:', error.message);
        return false;
    }
};

// Enhanced export with dual credit system
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
    
    // USER PROFILE functions only
    getUserProfile,
    
    // NEW: Dual Credit Management
    getUserPlan,
    updateUserCredits,
    spendUserCredits,
    resetRenewableCredits,
    
    // Data processing helpers (used by USER profiles only)
    sanitizeForJSON,
    ensureValidJSONArray,
    parseLinkedInNumber,
    processGeminiData
};
