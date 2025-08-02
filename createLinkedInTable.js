// Create LinkedIn Profiles Table
// Run this with: node createLinkedInTable.js

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const createLinkedInTable = async () => {
    console.log('🚀 Creating LinkedIn profiles table...');
    
    try {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS linkedin_profiles (
                id SERIAL PRIMARY KEY,
                profile_url TEXT UNIQUE NOT NULL,
                
                -- Basic Profile Information
                full_name TEXT,
                first_name TEXT,
                last_name TEXT,
                headline TEXT,
                summary TEXT,
                location TEXT,
                industry TEXT,
                
                -- Professional Information
                current_company TEXT,
                current_position TEXT,
                
                -- Social Metrics
                connections_count INTEGER,
                followers_count INTEGER,
                
                -- Media
                profile_image_url TEXT,
                background_image_url TEXT,
                
                -- Complex Data as JSONB (stores arrays and objects)
                experience JSONB DEFAULT '[]'::JSONB,
                education JSONB DEFAULT '[]'::JSONB,
                skills JSONB DEFAULT '[]'::JSONB,
                certifications JSONB DEFAULT '[]'::JSONB,
                courses JSONB DEFAULT '[]'::JSONB,
                projects JSONB DEFAULT '[]'::JSONB,
                publications JSONB DEFAULT '[]'::JSONB,
                volunteer_work JSONB DEFAULT '[]'::JSONB,
                honors_awards JSONB DEFAULT '[]'::JSONB,
                languages JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                articles JSONB DEFAULT '[]'::JSONB,
                recommendations JSONB DEFAULT '[]'::JSONB,
                
                -- Complete Raw Data Storage
                raw_json JSONB,
                
                -- Metadata
                extraction_status VARCHAR(50) DEFAULT 'pending',
                extraction_method VARCHAR(50),
                bright_data_snapshot_id VARCHAR(255),
                extraction_started_at TIMESTAMP DEFAULT NOW(),
                extraction_completed_at TIMESTAMP,
                extraction_error TEXT,
                retry_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `;

        const createIndexesSQL = `
            CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_url ON linkedin_profiles(profile_url);
            CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_status ON linkedin_profiles(extraction_status);
            CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_created ON linkedin_profiles(created_at);
            CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_company ON linkedin_profiles(current_company);
            CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_name ON linkedin_profiles(full_name);
        `;

        const createTriggerSQL = `
            CREATE OR REPLACE FUNCTION update_linkedin_profiles_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ language 'plpgsql';

            DROP TRIGGER IF EXISTS linkedin_profiles_updated_at ON linkedin_profiles;
            CREATE TRIGGER linkedin_profiles_updated_at 
                BEFORE UPDATE ON linkedin_profiles 
                FOR EACH ROW 
                EXECUTE FUNCTION update_linkedin_profiles_updated_at();
        `;

        // Execute table creation
        console.log('📋 Creating table...');
        await pool.query(createTableSQL);
        console.log('✅ Table created successfully!');

        // Execute indexes creation
        console.log('🔍 Creating indexes...');
        await pool.query(createIndexesSQL);
        console.log('✅ Indexes created successfully!');

        // Execute trigger creation
        console.log('⚡ Creating triggers...');
        await pool.query(createTriggerSQL);
        console.log('✅ Triggers created successfully!');

        // Verify table exists
        const tableCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'linkedin_profiles' 
            ORDER BY ordinal_position;
        `);

        console.log(`📊 Table verification: ${tableCheck.rows.length} columns found`);
        console.log('🎉 LinkedIn profiles table setup complete!');
        
        console.log('\n📋 Table columns:');
        tableCheck.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.column_name} (${row.data_type})`);
        });

        // Test table with a simple query
        const testQuery = await pool.query('SELECT COUNT(*) as count FROM linkedin_profiles;');
        console.log(`\n📈 Current records in table: ${testQuery.rows[0].count}`);

        console.log('\n🚀 Ready to use the LinkedIn API!');
        console.log('   Endpoint: POST /api/linkedin-profile');
        console.log('   Payload: { "profileUrl": "https://linkedin.com/in/example" }');

    } catch (error) {
        console.error('❌ Error creating table:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    } finally {
        await pool.end();
        console.log('\n✅ Database connection closed');
        process.exit(0);
    }
};

// Run the function
createLinkedInTable();