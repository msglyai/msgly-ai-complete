// ENHANCED database.js - Added Plans Table + Dual Credit System + AUTO-REGISTRATION + GPT-5 MESSAGE LOGGING + CHARGEBEE COLUMNS + PENDING REGISTRATIONS + MESSAGES CAMPAIGN TRACKING + CANCELLATION TRACKING + SAVED CONTEXTS + CONTEXT ADDONS
// Sophisticated credit management with renewable + pay-as-you-go credits
// FIXED: Resolved SQL arithmetic issues causing "operator is not unique" errors
// FIXED: Changed VARCHAR(500) to TEXT for URL fields to fix authentication errors
// ✅ AUTO-REGISTRATION: Enhanced createGoogleUser to support auto-registration with LinkedIn URL
// ✅ URL DEDUPLICATION FIX: Fixed UNIQUE constraint creation and added duplicate cleanup
// ✅ GPT-5 INTEGRATION: Enhanced message_logs table with comprehensive logging columns
// ✅ FIXED: Added message_type column for connection/intro message differentiation
// ✅ CHARGEBEE FIX: Added chargebee_subscription_id and chargebee_customer_id columns
// ✅ REGISTRATION FIX: Added pending_registrations table for webhook-based registration completion
// ✅ MESSAGES FIX: Added campaign tracking fields to message_logs table
// ✅ PROMPT VERSION FIX: Increased prompt_version column size from VARCHAR(50) to VARCHAR(255)
// ✅ CANCELLATION FIX: Added cancellation tracking columns for subscription cancellations
// ✅ CONTEXTS FIX: Added saved_contexts table for context management with plan-based limits
// ✅ CONTEXT ADDONS: Added user_context_addons and context_slot_events tables for extra slot subscriptions
// 🆕 CONTEXT SLOT SYSTEM: Simplified context slots with direct database fields (like credit system)
// 🔧 INITIALIZATION FIX: Fixed initializeContextSlots to handle both plan_code AND package_type fields

const { Pool } = require('pg');
require('dotenv').config();

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// NEW: Clean up duplicate URLs in target_profiles table
const cleanupDuplicateTargetProfiles = async () => {
    try {
        console.log('[CLEANUP] Starting duplicate target profiles cleanup...');
        
        // Find duplicates (keep the earliest one)
        const duplicatesQuery = `
            DELETE FROM target_profiles 
            WHERE id NOT IN (
                SELECT MIN(id) 
                FROM target_profiles 
                GROUP BY linkedin_url, user_id
            )
        `;
        
        const result = await pool.query(duplicatesQuery);
        console.log(`[CLEANUP] Removed ${result.rowCount} duplicate target profiles`);
        
        return result.rowCount;
    } catch (error) {
        console.error('[CLEANUP] Error cleaning up duplicates:', error);
        return 0;
    }
};

// NEW: Ensure target_profiles table exists with proper UNIQUE constraint
const ensureTargetProfilesTable = async () => {
    try {
        console.log('[INIT] Creating target_profiles table...');
        
        // Create target_profiles table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS target_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                linkedin_url TEXT NOT NULL,
                data_json JSONB,
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Clean up any existing duplicates before adding constraint
        await cleanupDuplicateTargetProfiles();
        
        // Add UNIQUE constraint - FIXED: Correct error message
        try {
            await pool.query(`
                ALTER TABLE target_profiles 
                ADD CONSTRAINT target_profiles_linkedin_url_unique 
                UNIQUE (linkedin_url);
            `);
            console.log('[SUCCESS] Added UNIQUE constraint to target_profiles');
        } catch (err) {
            if (err.code === '42P07') {
                console.log('[INFO] UNIQUE constraint already exists on target_profiles');
            } else {
                console.log('[ERROR] UNIQUE constraint creation failed:', err.message);
            }
        }
        
        // Create index for better performance
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_target_profiles_linkedin_url 
                ON target_profiles(linkedin_url);
            `);
            console.log('[SUCCESS] Created index on target_profiles.linkedin_url');
        } catch (err) {
            console.log('[INFO] Index might already exist:', err.message);
        }
        
    } catch (error) {
        console.error('[ERROR] Failed to ensure target_profiles table:', error);
        throw error;
    }
};

// ✅ NEW: Ensure saved_contexts table exists
const ensureSavedContextsTable = async () => {
    try {
        console.log('[INIT] Creating saved_contexts table...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS saved_contexts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                context_name VARCHAR(100) NOT NULL,
                context_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                UNIQUE(user_id, context_name)
            );
        `);
        
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_saved_contexts_user_id 
                ON saved_contexts(user_id);
                CREATE INDEX IF NOT EXISTS idx_saved_contexts_created_at 
                ON saved_contexts(created_at);
            `);
            console.log('[SUCCESS] Created saved_contexts indexes');
        } catch (err) {
            console.log('[INFO] Saved contexts indexes might already exist:', err.message);
        }
        
        console.log('[SUCCESS] saved_contexts table ensured');
        
    } catch (error) {
        console.error('[ERROR] Failed to ensure saved_contexts table:', error);
        throw error;
    }
};

// ✅ NEW: Ensure context addon tables exist
const ensureContextAddonTables = async () => {
    try {
        console.log('[INIT] Creating context addon system tables...');
        
        // 1. Create user_context_addons table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_context_addons (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                chargebee_subscription_id VARCHAR(255) UNIQUE,
                chargebee_addon_id VARCHAR(255) DEFAULT 'extra-context-slot',
                addon_quantity INTEGER DEFAULT 1,
                monthly_price DECIMAL(8,2) DEFAULT 3.99,
                
                -- Billing cycle tracking
                billing_period_start DATE NOT NULL,
                billing_period_end DATE NOT NULL,
                next_billing_date DATE NOT NULL,
                
                -- Status management
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'grace_period')),
                chargebee_status VARCHAR(50),
                expires_at TIMESTAMP NULL,
                
                -- Audit fields
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                CONSTRAINT unique_chargebee_subscription UNIQUE (chargebee_subscription_id)
            );
        `);

        // 2. Create context_slot_events table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS context_slot_events (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('addon_purchased', 'addon_renewed', 'addon_expired', 'context_saved', 'context_deleted')),
                addon_id INTEGER NULL REFERENCES user_context_addons(id) ON DELETE SET NULL,
                base_limit INTEGER NOT NULL,
                active_extra_slots INTEGER NOT NULL,
                total_limit INTEGER NOT NULL,
                current_usage INTEGER NOT NULL,
                metadata JSONB NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. Add missing columns
        try {
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS contexts_count INTEGER DEFAULT 0;`);
            await pool.query(`ALTER TABLE saved_contexts ADD COLUMN IF NOT EXISTS context_preview VARCHAR(150);`);
        } catch (err) {
            console.log('[INFO] Addon columns might already exist');
        }

        // 4. Create indexes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_user_active_addons ON user_context_addons(user_id, status, next_billing_date);
            CREATE INDEX IF NOT EXISTS idx_billing_due ON user_context_addons(next_billing_date, status);
            CREATE INDEX IF NOT EXISTS idx_chargebee_subscription ON user_context_addons(chargebee_subscription_id);
            CREATE INDEX IF NOT EXISTS idx_user_events ON context_slot_events(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_event_type ON context_slot_events(event_type, created_at);
        `);

        // 5. Create trigger function for contexts_count
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_contexts_count()
            RETURNS TRIGGER AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    UPDATE users SET contexts_count = contexts_count + 1 WHERE id = NEW.user_id;
                    RETURN NEW;
                ELSIF TG_OP = 'DELETE' THEN
                    UPDATE users SET contexts_count = contexts_count - 1 WHERE id = OLD.user_id;
                    RETURN OLD;
                END IF;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // 6. Create trigger
        await pool.query(`
            DROP TRIGGER IF EXISTS contexts_count_trigger ON saved_contexts;
            CREATE TRIGGER contexts_count_trigger
                AFTER INSERT OR DELETE ON saved_contexts
                FOR EACH ROW EXECUTE FUNCTION update_contexts_count();
        `);

        // 7. Initialize contexts_count for existing users
        await pool.query(`
            UPDATE users SET contexts_count = (
                SELECT COUNT(*) FROM saved_contexts WHERE saved_contexts.user_id = users.id
            ) WHERE contexts_count IS NULL OR contexts_count = 0;
        `);

        console.log('[SUCCESS] Context addon system tables created');
        
    } catch (error) {
        console.error('[ERROR] Failed to ensure context addon tables:', error);
        throw error;
    }
};

// ✅ NEW: Ensure pending_registrations table exists
const ensurePendingRegistrationsTable = async () => {
    try {
        console.log('[INIT] Creating pending_registrations table...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_registrations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                linkedin_url TEXT NOT NULL,
                package_type VARCHAR(50) NOT NULL,
                terms_accepted BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                expired_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
            );
        `);
        
        // Create indexes for fast lookup
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_pending_registrations_user_id 
                ON pending_registrations(user_id);
                CREATE INDEX IF NOT EXISTS idx_pending_registrations_created_at 
                ON pending_registrations(created_at);
            `);
            console.log('[SUCCESS] Created pending_registrations indexes');
        } catch (err) {
            console.log('[INFO] Pending registrations indexes might already exist:', err.message);
        }
        
        console.log('[SUCCESS] pending_registrations table ensured');
        
    } catch (error) {
        console.error('[ERROR] Failed to ensure pending_registrations table:', error);
        throw error;
    }
};

// ✅ NEW: Fix prompt_version column size to accommodate longer prompt versions
const fixPromptVersionColumn = async () => {
    try {
        console.log('[INIT] Updating prompt_version column size...');
        await pool.query(`
            ALTER TABLE message_logs 
            ALTER COLUMN prompt_version TYPE VARCHAR(255);
        `);
        console.log('[SUCCESS] ✅ prompt_version column updated to VARCHAR(255)');
    } catch (error) {
        console.log('[INFO] Column update may have failed:', error.message);
    }
};

// 🆕 NEW: Initialize existing users with proper context slots based on their plans - FIXED: Handle both plan_code AND package_type
const initializeContextSlots = async () => {
    try {
        console.log('[INIT] Initializing context slots for existing users...');
        
        // 🔧 FIXED: Use comprehensive CTE approach to handle both field names
        const result = await pool.query(`
            WITH plan_mapping AS (
                SELECT id, 
                       COALESCE(plan_code, package_type, 'free') as effective_plan,
                       CASE 
                           WHEN COALESCE(plan_code, package_type, 'free') = 'silver-monthly' THEN 3
                           WHEN COALESCE(plan_code, package_type, 'free') = 'gold-monthly' THEN 6
                           WHEN COALESCE(plan_code, package_type, 'free') = 'platinum-monthly' THEN 10
                           WHEN COALESCE(plan_code, package_type, 'free') LIKE '%-payasyougo' THEN 1
                           ELSE 1  -- free and unknown plans default to 1
                       END as correct_base_slots
                FROM users
            )
            UPDATE users 
            SET plan_context_slots = plan_mapping.correct_base_slots,
                total_context_slots = plan_mapping.correct_base_slots + COALESCE(users.extra_context_slots, 0),
                updated_at = CURRENT_TIMESTAMP
            FROM plan_mapping 
            WHERE users.id = plan_mapping.id
            AND (users.plan_context_slots IS NULL 
                 OR users.plan_context_slots != plan_mapping.correct_base_slots 
                 OR users.plan_context_slots = 1) -- Force update even existing 1s to ensure correct values
        `);
        
        console.log(`[INIT] ✅ Updated ${result.rowCount} users with correct context slots`);
        
        // 🔧 VERIFICATION: Log the results for verification
        const verification = await pool.query(`
            SELECT 
                COALESCE(plan_code, package_type, 'unknown') as effective_plan,
                plan_context_slots,
                COUNT(*) as user_count
            FROM users 
            GROUP BY effective_plan, plan_context_slots
            ORDER BY effective_plan, plan_context_slots
        `);
        
        console.log('[INIT] Context slots verification results:');
        verification.rows.forEach(row => {
            console.log(`  ${row.effective_plan}: ${row.plan_context_slots} slots (${row.user_count} users)`);
        });
        
        console.log('[SUCCESS] ✅ Context slots initialization completed successfully');
        
    } catch (error) {
        console.error('[ERROR] Failed to initialize context slots:', error);
    }
};

// ==================== DATABASE INITIALIZATION ====================

const initDB = async () => {
    try {
        console.log('Creating enhanced database tables with dual credit system + GPT-5 message logging + CHARGEBEE COLUMNS + PENDING REGISTRATIONS + MESSAGES CAMPAIGN TRACKING + CANCELLATION TRACKING + SAVED CONTEXTS + CONTEXT ADDONS + SIMPLIFIED CONTEXT SLOTS...');

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

        // ENHANCED USERS TABLE - FIXED: Changed profile_picture VARCHAR(500) to TEXT + ADDED CHARGEBEE COLUMNS + 🆕 CONTEXT SLOT FIELDS
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255),
                google_id VARCHAR(255) UNIQUE,
                display_name VARCHAR(255),
                profile_picture TEXT,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                package_type VARCHAR(50) DEFAULT 'free',
                billing_model VARCHAR(50) DEFAULT 'monthly',
                
                -- NEW: Dual Credit System
                plan_code VARCHAR(50) DEFAULT 'free' REFERENCES plans(plan_code),
                renewable_credits INTEGER DEFAULT 7,
                payasyougo_credits INTEGER DEFAULT 0,
                
                -- 🆕 NEW: Direct Context Slot Fields (like credit system)
                plan_context_slots INTEGER DEFAULT 1,
                extra_context_slots INTEGER DEFAULT 0,
                total_context_slots INTEGER DEFAULT 1,
                contexts_count INTEGER DEFAULT 0,
                
                -- NEW: Billing Cycle Management
                subscription_starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                next_billing_date TIMESTAMP,
                
                -- ✅ CHARGEBEE FIX: Add missing Chargebee columns
                chargebee_subscription_id VARCHAR(100) UNIQUE,
                chargebee_customer_id VARCHAR(100),
                
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

        // USER_PROFILES TABLE - FIXED: Changed profile_image_url VARCHAR(500) to TEXT
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
                
                -- Media - FIXED: Changed profile_image_url VARCHAR(500) to TEXT
                profile_picture TEXT,
                profile_image_url TEXT,
                avatar TEXT,
                banner_image TEXT,
                background_image_url TEXT,
                
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

        // ENHANCED MESSAGE_LOGS TABLE - ✅ GPT-5 INTEGRATION: Added comprehensive logging columns + CAMPAIGN TRACKING
        await pool.query(`
            CREATE TABLE IF NOT EXISTS message_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                
                -- Basic message data
                target_name VARCHAR(255),
                target_url TEXT,
                target_profile_url TEXT,
                generated_message TEXT,
                message_context TEXT,
                credits_used INTEGER DEFAULT 1,
                
                -- ✅ NEW: GPT-5 Integration columns
                context_text TEXT,
                target_first_name VARCHAR(255),
                target_title VARCHAR(500),
                target_company VARCHAR(500),
                model_name VARCHAR(100),
                prompt_version VARCHAR(50),
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                latency_ms INTEGER,
                data_json JSONB,
                
                -- ✅ NEW: Campaign tracking fields for Messages page
                sent_status VARCHAR(20) DEFAULT 'pending',
                reply_status VARCHAR(20) DEFAULT 'pending',
                comments TEXT,
                sent_date TIMESTAMP,
                reply_date TIMESTAMP,
                
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

        // NEW: TARGET_PROFILES TABLE with proper UNIQUE constraint
        await ensureTargetProfilesTable();
        
        // ✅ NEW: SAVED_CONTEXTS TABLE for context management
        await ensureSavedContextsTable();
        
        // ✅ NEW: CONTEXT ADDON TABLES for extra slot subscriptions
        await ensureContextAddonTables();
        
        // ✅ NEW: PENDING_REGISTRATIONS TABLE for webhook-based registration
        await ensurePendingRegistrationsTable();

        // ✅ NEW: Fix prompt_version column size to accommodate longer prompt versions
        await fixPromptVersionColumn();

        // Add missing columns (safe operation) + CHARGEBEE COLUMNS + MESSAGES CAMPAIGN TRACKING + CANCELLATION TRACKING + 🆕 CONTEXT SLOT FIELDS
        try {
            const enhancedUserColumns = [
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT',
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
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMP',
                
                // 🆕 NEW: Context Slot System columns (like credit system)
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_context_slots INTEGER DEFAULT 1',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_context_slots INTEGER DEFAULT 0',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS total_context_slots INTEGER DEFAULT 1',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS contexts_count INTEGER DEFAULT 0',
                
                // ✅ CHARGEBEE FIX: Add missing Chargebee columns
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS chargebee_subscription_id VARCHAR(100) UNIQUE',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS chargebee_customer_id VARCHAR(100)',
                
                // ✅ CANCELLATION FIX: Add cancellation tracking columns
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_scheduled_at TIMESTAMP',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_effective_date TIMESTAMP',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_plan_code VARCHAR(50)'
            ];
            
            console.log('-- NEW: Dual Credit System columns + CHARGEBEE COLUMNS + CANCELLATION TRACKING + 🆕 CONTEXT SLOT FIELDS');
            
            for (const columnQuery of enhancedUserColumns) {
                try {
                    await pool.query(columnQuery);
                    // Log context slot column additions
                    if (columnQuery.includes('plan_context_slots')) {
                        console.log('🆕 CONTEXT SLOTS: Added plan_context_slots column');
                    }
                    if (columnQuery.includes('extra_context_slots')) {
                        console.log('🆕 CONTEXT SLOTS: Added extra_context_slots column');
                    }
                    if (columnQuery.includes('total_context_slots')) {
                        console.log('🆕 CONTEXT SLOTS: Added total_context_slots column');
                    }
                    // Log Chargebee column additions
                    if (columnQuery.includes('chargebee_subscription_id')) {
                        console.log('✅ CHARGEBEE FIX: Added chargebee_subscription_id column');
                    }
                    if (columnQuery.includes('chargebee_customer_id')) {
                        console.log('✅ CHARGEBEE FIX: Added chargebee_customer_id column');
                    }
                    // Log cancellation column additions
                    if (columnQuery.includes('cancellation_scheduled_at')) {
                        console.log('✅ CANCELLATION FIX: Added cancellation_scheduled_at column');
                    }
                    if (columnQuery.includes('cancellation_effective_date')) {
                        console.log('✅ CANCELLATION FIX: Added cancellation_effective_date column');
                    }
                    if (columnQuery.includes('previous_plan_code')) {
                        console.log('✅ CANCELLATION FIX: Added previous_plan_code column');
                    }
                } catch (err) {
                    console.log(`Column might already exist: ${err.message}`);
                }
            }

            // FIXED: Update existing VARCHAR(500) columns to TEXT
            try {
                await pool.query(`ALTER TABLE users ALTER COLUMN profile_picture TYPE TEXT;`);
                console.log('Updated users.profile_picture to TEXT');
            } catch (err) {
                console.log(`Profile picture column update: ${err.message}`);
            }

            try {
                await pool.query(`ALTER TABLE user_profiles ALTER COLUMN profile_image_url TYPE TEXT;`);
                console.log('Updated user_profiles.profile_image_url to TEXT');
            } catch (err) {
                console.log(`Profile image URL column update: ${err.message}`);
            }

            try {
                await pool.query(`ALTER TABLE message_logs ALTER COLUMN target_url TYPE TEXT;`);
                console.log('Updated message_logs.target_url to TEXT');
            } catch (err) {
                console.log(`Target URL column update: ${err.message}`);
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

            // ✅ NEW: Add GPT-5 message logging columns to existing message_logs table + MESSAGE_TYPE FIX + CAMPAIGN TRACKING
            const gpt5MessageColumns = [
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS target_profile_url TEXT',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS context_text TEXT',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS target_first_name VARCHAR(255)',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS target_title VARCHAR(500)',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS target_company VARCHAR(500)',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS model_name VARCHAR(100)',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(50)',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS input_tokens INTEGER',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS output_tokens INTEGER',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS total_tokens INTEGER',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS latency_ms INTEGER',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS data_json JSONB',
                
                // ✅ CRITICAL FIX: Add missing message_type column for connection/intro message differentiation
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS message_type VARCHAR(50) DEFAULT \'message\'',
                
                // ✅ NEW: Campaign tracking fields for Messages page
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS sent_status VARCHAR(20) DEFAULT \'pending\'',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS reply_status VARCHAR(20) DEFAULT \'pending\'',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS comments TEXT',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS sent_date TIMESTAMP',
                'ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS reply_date TIMESTAMP'
            ];

            console.log('-- ✅ NEW: GPT-5 Message Logging columns + MESSAGE_TYPE FIX + CAMPAIGN TRACKING');
            
            for (const columnQuery of gpt5MessageColumns) {
                try {
                    await pool.query(columnQuery);
                    // Log successful addition of message_type column
                    if (columnQuery.includes('message_type')) {
                        console.log('✅ FIXED: Added message_type column to message_logs table');
                    }
                    // Log successful addition of campaign tracking columns
                    if (columnQuery.includes('sent_status')) {
                        console.log('✅ MESSAGES FIX: Added sent_status column for campaign tracking');
                    }
                    if (columnQuery.includes('reply_status')) {
                        console.log('✅ MESSAGES FIX: Added reply_status column for campaign tracking');
                    }
                    if (columnQuery.includes('comments')) {
                        console.log('✅ MESSAGES FIX: Added comments column for campaign tracking');
                    }
                } catch (err) {
                    console.log(`GPT-5 column might already exist: ${err.message}`);
                }
            }
            
            console.log('Enhanced database columns updated successfully');
        } catch (err) {
            console.log('Some enhanced columns might already exist:', err.message);
        }

        // 🆕 NEW: Initialize context slots for existing users - FIXED VERSION
        await initializeContextSlots();

        // Create indexes + CHARGEBEE INDEXES + CAMPAIGN TRACKING INDEXES + CANCELLATION INDEXES + SAVED CONTEXTS INDEXES + CONTEXT ADDON INDEXES + 🆕 CONTEXT SLOT INDEXES
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
                
                -- 🆕 CONTEXT SLOTS: Add context slot indexes for fast usage calculation
                CREATE INDEX IF NOT EXISTS idx_users_context_usage ON users(plan_context_slots, extra_context_slots, total_context_slots);
                CREATE INDEX IF NOT EXISTS idx_users_contexts_count ON users(contexts_count);
                
                -- ✅ CHARGEBEE FIX: Add Chargebee indexes for fast webhook processing
                CREATE INDEX IF NOT EXISTS idx_users_chargebee_subscription_id ON users(chargebee_subscription_id);
                CREATE INDEX IF NOT EXISTS idx_users_chargebee_customer_id ON users(chargebee_customer_id);
                
                -- ✅ CANCELLATION FIX: Add cancellation indexes for fast processing
                CREATE INDEX IF NOT EXISTS idx_users_cancellation_effective_date ON users(cancellation_effective_date);
                CREATE INDEX IF NOT EXISTS idx_users_cancellation_scheduled_at ON users(cancellation_scheduled_at);
                
                -- Plans indexes
                CREATE INDEX IF NOT EXISTS idx_plans_plan_code ON plans(plan_code);
                CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(active);
                
                -- Credits transactions indexes
                CREATE INDEX IF NOT EXISTS idx_credits_transactions_user_id ON credits_transactions(user_id);
                CREATE INDEX IF NOT EXISTS idx_credits_transactions_hold_id ON credits_transactions(hold_id);
                CREATE INDEX IF NOT EXISTS idx_credits_transactions_status ON credits_transactions(status);
                
                -- Target profiles indexes
                CREATE INDEX IF NOT EXISTS idx_target_profiles_user_id ON target_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_target_profiles_created_at ON target_profiles(created_at);
                
                -- ✅ NEW: Saved contexts indexes for fast user context lookups
                CREATE INDEX IF NOT EXISTS idx_saved_contexts_user_id ON saved_contexts(user_id);
                CREATE INDEX IF NOT EXISTS idx_saved_contexts_created_at ON saved_contexts(created_at);
                
                -- ✅ NEW: Context addon indexes for fast addon processing
                CREATE INDEX IF NOT EXISTS idx_user_active_addons ON user_context_addons(user_id, status, next_billing_date);
                CREATE INDEX IF NOT EXISTS idx_billing_due ON user_context_addons(next_billing_date, status);
                CREATE INDEX IF NOT EXISTS idx_chargebee_subscription ON user_context_addons(chargebee_subscription_id);
                CREATE INDEX IF NOT EXISTS idx_user_events ON context_slot_events(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_event_type ON context_slot_events(event_type, created_at);
                
                -- ✅ NEW: Message logs indexes for GPT-5 integration + MESSAGE_TYPE + CAMPAIGN TRACKING
                CREATE INDEX IF NOT EXISTS idx_message_logs_user_id ON message_logs(user_id);
                CREATE INDEX IF NOT EXISTS idx_message_logs_model_name ON message_logs(model_name);
                CREATE INDEX IF NOT EXISTS idx_message_logs_created_at ON message_logs(created_at);
                CREATE INDEX IF NOT EXISTS idx_message_logs_target_profile_url ON message_logs(target_profile_url);
                CREATE INDEX IF NOT EXISTS idx_message_logs_message_type ON message_logs(message_type);
                CREATE INDEX IF NOT EXISTS idx_message_logs_sent_status ON message_logs(sent_status);
                CREATE INDEX IF NOT EXISTS idx_message_logs_reply_status ON message_logs(reply_status);
            `);
            console.log('Database indexes created successfully (including Chargebee indexes + Campaign tracking indexes + Cancellation indexes + Saved contexts indexes + Context addon indexes + 🆕 Context slot indexes)');
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

        console.log('✅ Enhanced database with dual credit system, URL deduplication fix, GPT-5 message logging, MESSAGE_TYPE column, CHARGEBEE COLUMNS, PENDING REGISTRATIONS, MESSAGES CAMPAIGN TRACKING, PROMPT_VERSION FIX, CANCELLATION TRACKING, SAVED CONTEXTS, CONTEXT ADDONS, 🆕 SIMPLIFIED CONTEXT SLOTS, and REMOVED ALL VARCHAR LIMITATIONS created successfully!');
    } catch (error) {
        console.error('Database setup error:', error);
        throw error;
    }
};

// ==================== DUAL CREDIT MANAGEMENT FUNCTIONS ====================

// NEW: Get user plan with real data - FIXED
const getUserPlan = async (userId) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.plan_code,
                COALESCE(u.renewable_credits, 0) as renewable_credits,
                COALESCE(u.payasyougo_credits, 0) as payasyougo_credits,
                u.subscription_starts_at,
                u.next_billing_date,
                u.subscription_status,
                u.chargebee_subscription_id,
                u.chargebee_customer_id,
                u.cancellation_scheduled_at,
                u.cancellation_effective_date,
                u.previous_plan_code,
                p.plan_name,
                p.billing_model,
                p.price_cents,
                COALESCE(p.renewable_credits, 7) as plan_renewable_credits,
                p.is_pay_as_you_go
            FROM users u
            LEFT JOIN plans p ON u.plan_code = p.plan_code
            WHERE u.id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            throw new Error('User not found');
        }

        const user = result.rows[0];
        
        // Calculate total credits (pay-as-you-go + renewable) - FIXED: Use Number conversion
        const renewableCredits = Number(user.renewable_credits) || 0;
        const payasyougoCredits = Number(user.payasyougo_credits) || 0;
        const totalCredits = renewableCredits + payasyougoCredits;
        
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
                renewableCredits: renewableCredits,
                payasyougoCredits: payasyougoCredits,
                totalCredits: totalCredits,
                
                // Plan details
                planRenewableCredits: Number(user.plan_renewable_credits) || 7,
                priceCents: user.price_cents || 0,
                
                // Billing info
                subscriptionStartsAt: user.subscription_starts_at,
                nextBillingDate: user.next_billing_date,
                renewalDate: renewalDate,
                
                // ✅ CHARGEBEE FIX: Include Chargebee IDs for debugging
                chargebeeSubscriptionId: user.chargebee_subscription_id,
                chargebeeCustomerId: user.chargebee_customer_id,
                
                // ✅ CANCELLATION FIX: Include cancellation tracking
                cancellationScheduledAt: user.cancellation_scheduled_at,
                cancellationEffectiveDate: user.cancellation_effective_date,
                previousPlanCode: user.previous_plan_code,
                
                // UI display data
                creditsDisplay: `${totalCredits}/${Number(user.plan_renewable_credits) || 7} Credits`,
                renewalDisplay: `Renews ${renewalDate}`,
                progressPercentage: Math.round((renewableCredits / (Number(user.plan_renewable_credits) || 7)) * 100)
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

// NEW: Update user credits (dual system) - FIXED
const updateUserCredits = async (userId, creditChange, creditType = 'payasyougo') => {
    try {
        // First get current credits
        const currentResult = await pool.query(
            'SELECT COALESCE(renewable_credits, 0) as renewable_credits, COALESCE(payasyougo_credits, 0) as payasyougo_credits FROM users WHERE id = $1',
            [userId]
        );
        
        if (currentResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const current = currentResult.rows[0];
        let newRenewable = Number(current.renewable_credits) || 0;
        let newPayasyougo = Number(current.payasyougo_credits) || 0;
        
        // Calculate new values in JavaScript
        if (creditType === 'renewable') {
            newRenewable = Math.max(0, newRenewable + creditChange);
        } else {
            newPayasyougo = Math.max(0, newPayasyougo + creditChange);
        }
        
        const newTotal = newRenewable + newPayasyougo;
        
        // Update with calculated values
        const result = await pool.query(`
            UPDATE users 
            SET renewable_credits = $1,
                payasyougo_credits = $2,
                credits_remaining = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING renewable_credits, payasyougo_credits, credits_remaining
        `, [newRenewable, newPayasyougo, newTotal, userId]);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const credits = result.rows[0];
        
        return {
            success: true,
            renewableCredits: Number(credits.renewable_credits),
            payasyougoCredits: Number(credits.payasyougo_credits),
            totalCredits: Number(credits.credits_remaining)
        };
    } catch (error) {
        console.error('Error updating user credits:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// NEW: Spend credits (pay-as-you-go first, then renewable) - FIXED
const spendUserCredits = async (userId, amount) => {
    try {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get current credits - FIXED: Handle NULL values
            const userResult = await client.query(
                'SELECT COALESCE(renewable_credits, 0) as renewable_credits, COALESCE(payasyougo_credits, 0) as payasyougo_credits FROM users WHERE id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const { renewable_credits, payasyougo_credits } = userResult.rows[0];
            // FIXED: Ensure we're working with numbers
            const renewableNum = Number(renewable_credits) || 0;
            const payasyougoNum = Number(payasyougo_credits) || 0;
            const totalAvailable = renewableNum + payasyougoNum;
            
            if (totalAvailable < amount) {
                throw new Error('Insufficient credits');
            }
            
            let newPayasyougo = payasyougoNum;
            let newRenewable = renewableNum;
            
            // Spend pay-as-you-go first
            if (payasyougoNum >= amount) {
                newPayasyougo = payasyougoNum - amount;
            } else {
                // Spend all pay-as-you-go, then renewable
                const remaining = amount - payasyougoNum;
                newPayasyougo = 0;
                newRenewable = renewableNum - remaining;
            }
            
            // Ensure no negative credits
            newPayasyougo = Math.max(0, newPayasyougo);
            newRenewable = Math.max(0, newRenewable);
            
            // FIXED: Calculate total in JavaScript instead of SQL
            const newTotal = newRenewable + newPayasyougo;
            
            // Update credits - FIXED: Pass calculated total instead of SQL arithmetic
            await client.query(`
                UPDATE users 
                SET 
                    renewable_credits = $1,
                    payasyougo_credits = $2,
                    credits_remaining = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [newRenewable, newPayasyougo, userId, newTotal]);
            
            await client.query('COMMIT');
            
            return {
                success: true,
                spent: amount,
                newRenewableCredits: newRenewable,
                newPayasyougoCredits: newPayasyougo,
                newTotalCredits: newTotal
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

// NEW: Reset renewable credits (monthly billing cycle) - FIXED
const resetRenewableCredits = async (userId) => {
    try {
        const planResult = await pool.query(`
            SELECT COALESCE(p.renewable_credits, 7) as renewable_credits
            FROM users u
            JOIN plans p ON u.plan_code = p.plan_code
            WHERE u.id = $1
        `, [userId]);
        
        if (planResult.rows.length === 0) {
            throw new Error('User or plan not found');
        }
        
        const planRenewableCredits = Number(planResult.rows[0].renewable_credits) || 7;
        
        // Get current payasyougo credits
        const currentResult = await pool.query(
            'SELECT COALESCE(payasyougo_credits, 0) as payasyougo_credits FROM users WHERE id = $1',
            [userId]
        );
        
        const currentPayasyougo = Number(currentResult.rows[0]?.payasyougo_credits) || 0;
        const newTotal = planRenewableCredits + currentPayasyougo;
        
        // Reset renewable credits to plan amount, keep pay-as-you-go unchanged - FIXED
        const result = await pool.query(`
            UPDATE users 
            SET 
                renewable_credits = $1,
                credits_remaining = $3,
                next_billing_date = next_billing_date + INTERVAL '1 month',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING renewable_credits, payasyougo_credits, credits_remaining
        `, [planRenewableCredits, userId, newTotal]);
        
        const credits = result.rows[0];
        
        return {
            success: true,
            renewableCredits: Number(credits.renewable_credits),
            payasyougoCredits: Number(credits.payasyougo_credits),
            totalCredits: Number(credits.credits_remaining)
        };
    } catch (error) {
        console.error('Error resetting renewable credits:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// ✅ CANCELLATION FIX: New function to downgrade user to free plan
const downgradeUserToFree = async (userId) => {
    try {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get current user data
            const userResult = await client.query(`
                SELECT plan_code, renewable_credits, payasyougo_credits 
                FROM users WHERE id = $1
            `, [userId]);
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const user = userResult.rows[0];
            
            // Downgrade to free plan
            const result = await client.query(`
                UPDATE users 
                SET 
                    plan_code = 'free',
                    renewable_credits = 7,
                    credits_remaining = 7 + COALESCE(payasyougo_credits, 0),
                    subscription_status = 'cancelled',
                    chargebee_subscription_id = NULL,
                    next_billing_date = NULL,
                    cancellation_scheduled_at = NULL,
                    cancellation_effective_date = NULL,
                    plan_context_slots = 1,
                    total_context_slots = 1 + COALESCE(extra_context_slots, 0),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `, [userId]);
            
            await client.query('COMMIT');
            
            console.log(`[CANCELLATION] User ${userId} downgraded to free plan`);
            
            return {
                success: true,
                data: result.rows[0]
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error downgrading user to free:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// ==================== 🆕 SIMPLIFIED CONTEXT SLOT MANAGEMENT FUNCTIONS ====================

// 🆕 Get user's context addon slots and usage - SIMPLIFIED: Direct field access
const getContextAddonUsage = async (userId) => {
    try {
        const result = await pool.query(`
            SELECT 
                plan_context_slots,
                extra_context_slots,
                total_context_slots,
                contexts_count,
                plan_code
            FROM users 
            WHERE id = $1
        `, [userId]);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const user = result.rows[0];
        
        return {
            success: true,
            data: {
                used: user.contexts_count || 0,
                baseLimit: user.plan_context_slots || 1,
                addonSlots: user.extra_context_slots || 0,
                totalLimit: user.total_context_slots || 1,
                planCode: user.plan_code
            }
        };
        
    } catch (error) {
        console.error('Error getting context addon usage:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// 🆕 Create context addon subscription - SIMPLIFIED: Direct field increment
const createContextAddon = async (userId, chargebeeSubscriptionId, addonDetails = {}) => {
    try {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Create addon record
            const addonResult = await client.query(`
                INSERT INTO user_context_addons (
                    user_id,
                    chargebee_subscription_id,
                    addon_quantity,
                    monthly_price,
                    billing_period_start,
                    billing_period_end,
                    next_billing_date,
                    status,
                    chargebee_status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `, [
                userId,
                chargebeeSubscriptionId,
                addonDetails.quantity || 1,
                addonDetails.price || 3.99,
                addonDetails.periodStart || new Date(),
                addonDetails.periodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                addonDetails.nextBillingDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                'active',
                addonDetails.chargebeeStatus || 'active'
            ]);
            
            // 🆕 SIMPLIFIED: Increment extra_context_slots directly
            await client.query(`
                UPDATE users 
                SET extra_context_slots = extra_context_slots + $1,
                    total_context_slots = plan_context_slots + extra_context_slots + $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [addonDetails.quantity || 1, userId]);
            
            await client.query('COMMIT');
            
            console.log(`[CONTEXT_ADDON] Created addon subscription for user ${userId}: ${chargebeeSubscriptionId}`);
            
            return {
                success: true,
                data: addonResult.rows[0]
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error creating context addon:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// 🆕 Get user's active context addons
const getUserContextAddons = async (userId) => {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                chargebee_subscription_id,
                addon_quantity,
                monthly_price,
                next_billing_date,
                status,
                created_at
            FROM user_context_addons 
            WHERE user_id = $1 AND status = 'active'
            ORDER BY created_at DESC
        `, [userId]);
        
        return {
            success: true,
            data: result.rows
        };
    } catch (error) {
        console.error('Error getting user context addons:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// 🆕 Update user context slots when plan changes (like credit functions)
const updateUserContextSlots = async (userId, newPlanCode) => {
    try {
        // Plan to context slots mapping
        const planContextSlots = {
            'free': 1,
            'silver-monthly': 3,
            'gold-monthly': 6,
            'platinum-monthly': 10,
            'silver-payasyougo': 1,
            'gold-payasyougo': 1,
            'platinum-payasyougo': 1
        };
        
        const newBaseSlots = planContextSlots[newPlanCode] || 1;
        
        const result = await pool.query(`
            UPDATE users 
            SET plan_context_slots = $1,
                total_context_slots = $1 + COALESCE(extra_context_slots, 0),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING plan_context_slots, extra_context_slots, total_context_slots
        `, [newBaseSlots, userId]);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const slots = result.rows[0];
        
        return {
            success: true,
            baseSlots: Number(slots.plan_context_slots),
            extraSlots: Number(slots.extra_context_slots),
            totalSlots: Number(slots.total_context_slots)
        };
    } catch (error) {
        console.error('Error updating user context slots:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// 🆕 Remove context addon (decrement slots)
const removeContextAddon = async (userId, addonId) => {
    try {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get addon details
            const addonResult = await client.query(`
                SELECT addon_quantity FROM user_context_addons 
                WHERE id = $1 AND user_id = $2
            `, [addonId, userId]);
            
            if (addonResult.rows.length === 0) {
                throw new Error('Addon not found');
            }
            
            const addonQuantity = addonResult.rows[0].addon_quantity || 1;
            
            // Cancel addon
            await client.query(`
                UPDATE user_context_addons 
                SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [addonId]);
            
            // 🆕 SIMPLIFIED: Decrement extra_context_slots directly
            await client.query(`
                UPDATE users 
                SET extra_context_slots = GREATEST(0, extra_context_slots - $1),
                    total_context_slots = plan_context_slots + GREATEST(0, extra_context_slots - $1),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [addonQuantity, userId]);
            
            await client.query('COMMIT');
            
            return {
                success: true,
                removedSlots: addonQuantity
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error removing context addon:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// ==================== PENDING REGISTRATIONS FUNCTIONS ====================

// ✅ NEW: Store pending registration before payment
const storePendingRegistration = async (userId, linkedinUrl, packageType) => {
    try {
        // Remove any existing pending registrations for this user
        await pool.query(
            'DELETE FROM pending_registrations WHERE user_id = $1',
            [userId]
        );
        
        // Store new pending registration
        const result = await pool.query(`
            INSERT INTO pending_registrations (
                user_id, linkedin_url, package_type, terms_accepted
            ) VALUES ($1, $2, $3, $4) 
            RETURNING *
        `, [userId, linkedinUrl, packageType, true]);
        
        console.log(`[PENDING_REG] Stored pending registration for user ${userId}: ${packageType}`);
        
        return {
            success: true,
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Error storing pending registration:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// ✅ NEW: Get pending registration for user
const getPendingRegistration = async (userId) => {
    try {
        const result = await pool.query(`
            SELECT * FROM pending_registrations 
            WHERE user_id = $1 AND completed_at IS NULL AND expired_at > CURRENT_TIMESTAMP
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId]);
        
        if (result.rows.length === 0) {
            return {
                success: false,
                error: 'No pending registration found'
            };
        }
        
        return {
            success: true,
            data: result.rows[0]
        };
    } catch (error) {
        console.error('Error getting pending registration:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// ✅ NEW: Complete pending registration (called by webhook)
const completePendingRegistration = async (userId) => {
    try {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get pending registration
            const pendingResult = await client.query(`
                SELECT * FROM pending_registrations 
                WHERE user_id = $1 AND completed_at IS NULL AND expired_at > CURRENT_TIMESTAMP
                ORDER BY created_at DESC
                LIMIT 1
            `, [userId]);
            
            if (pendingResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'No pending registration found'
                };
            }
            
            const pendingReg = pendingResult.rows[0];
            
            // Update user with LinkedIn URL and mark registration complete
            await client.query(`
                UPDATE users 
                SET linkedin_url = $1, 
                    registration_completed = true,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [pendingReg.linkedin_url, userId]);
            
            // Mark pending registration as completed
            await client.query(`
                UPDATE pending_registrations 
                SET completed_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [pendingReg.id]);
            
            await client.query('COMMIT');
            
            console.log(`[PENDING_REG] Completed registration for user ${userId} with LinkedIn URL: ${pendingReg.linkedin_url}`);
            
            return {
                success: true,
                data: {
                    linkedinUrl: pendingReg.linkedin_url,
                    packageType: pendingReg.package_type,
                    registrationCompleted: true
                }
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error completing pending registration:', error);
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
        const aiData = geminiResponse.data;
        const profile = aiData.profile || {};
        const engagement = aiData.engagement || {};
        
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
    
    // 🆕 Get context slots for plan
    const planContextSlots = {
        'free': 1,
        'silver-monthly': 3,
        'gold-monthly': 6,
        'platinum-monthly': 10,
        'silver-payasyougo': 1,
        'gold-payasyougo': 1,
        'platinum-payasyougo': 1
    };
    
    const contextSlots = planContextSlots[packageType] || 1;
    
    const result = await pool.query(`
        INSERT INTO users (
            email, password_hash, package_type, billing_model, plan_code,
            renewable_credits, payasyougo_credits, credits_remaining,
            plan_context_slots, extra_context_slots, total_context_slots,
            subscription_starts_at, next_billing_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *
    `, [
        email, passwordHash, packageType, billingModel, packageType,
        renewableCredits, 0, renewableCredits,
        contextSlots, 0, contextSlots,
        new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Next month
    ]);
    
    return result.rows[0];
};

// ✅ AUTO-REGISTRATION: Enhanced createGoogleUser with LinkedIn URL support
const createGoogleUser = async (email, displayName, googleId, profilePicture, packageType = 'free', billingModel = 'monthly', linkedinUrl = null) => {
    // Get credits from plans table
    const planResult = await pool.query(
        'SELECT renewable_credits FROM plans WHERE plan_code = $1',
        [packageType]
    );
    
    const renewableCredits = planResult.rows[0]?.renewable_credits || 7;
    
    // 🆕 Get context slots for plan
    const planContextSlots = {
        'free': 1,
        'silver-monthly': 3,
        'gold-monthly': 6,
        'platinum-monthly': 10,
        'silver-payasyougo': 1,
        'gold-payasyougo': 1,
        'platinum-payasyougo': 1
    };
    
    const contextSlots = planContextSlots[packageType] || 1;
    
    // ✅ AUTO-REGISTRATION: Set registration_completed = true when LinkedIn URL is provided
    const registrationCompleted = !!linkedinUrl;
    
    const result = await pool.query(`
        INSERT INTO users (
            email, google_id, display_name, profile_picture, 
            package_type, billing_model, plan_code,
            renewable_credits, payasyougo_credits, credits_remaining,
            plan_context_slots, extra_context_slots, total_context_slots,
            subscription_starts_at, next_billing_date,
            linkedin_url, registration_completed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *
    `, [
        email, googleId, displayName, profilePicture, 
        packageType, billingModel, packageType,
        renewableCredits, 0, renewableCredits,
        contextSlots, 0, contextSlots,
        new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Next month
        linkedinUrl, registrationCompleted // ✅ AUTO-REGISTRATION: Add LinkedIn URL and registration status
    ]);
    
    const user = result.rows[0];
    
    return user;
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

// Enhanced export with dual credit system + AUTO-REGISTRATION + URL DEDUPLICATION FIX + GPT-5 INTEGRATION + MESSAGE_TYPE FIX + CHARGEBEE COLUMNS + PENDING REGISTRATIONS + MESSAGES CAMPAIGN TRACKING + PROMPT_VERSION FIX + CANCELLATION TRACKING + SAVED CONTEXTS + CONTEXT ADDONS + 🆕 SIMPLIFIED CONTEXT SLOT SYSTEM
module.exports = {
    // Database connection
    pool,
    
    // Database setup
    initDB,
    testDatabase,
    
    // NEW: Cleanup functions
    cleanupDuplicateTargetProfiles,
    ensureTargetProfilesTable,
    ensureSavedContextsTable,
    ensureContextAddonTables, // ✅ NEW: Context addon tables function
    ensurePendingRegistrationsTable,
    fixPromptVersionColumn,
    initializeContextSlots, // 🆕 NEW: Initialize context slots function
    
    // ✅ AUTO-REGISTRATION: Enhanced user management with LinkedIn URL support
    createUser,
    createGoogleUser, // ✅ AUTO-REGISTRATION: Now supports linkedinUrl parameter
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
    
    // ✅ CANCELLATION FIX: New cancellation management function
    downgradeUserToFree,
    
    // ✅ NEW: Pending Registration Management
    storePendingRegistration,
    getPendingRegistration,
    completePendingRegistration,
    
    // 🆕 NEW: Context Slot Management (like credit functions)
    getContextAddonUsage,
    createContextAddon,
    getUserContextAddons,
    updateUserContextSlots,
    removeContextAddon,
    
    // Data processing helpers (used by USER profiles only)
    sanitizeForJSON,
    ensureValidJSONArray,
    parseLinkedInNumber,
    processGeminiData
};
