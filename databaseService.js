// Database Service for LinkedIn Profiles
// Handles all database operations for the linkedin_profiles table

const { Pool } = require('pg');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Test database connection on module load
pool.on('error', (err) => {
    console.error('[DB] Unexpected database error:', err);
});

console.log('[DB] Database service initialized');

/**
 * Test database connection
 * @returns {Promise<boolean>} - True if connection successful
 */
const testConnection = async () => {
    try {
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        console.log('[DB] Database connection test successful');
        return true;
    } catch (error) {
        console.error('[DB] Database connection test failed:', error.message);
        return false;
    }
};

/**
 * Save LinkedIn profile data to database
 * @param {Object} data - Processed LinkedIn profile data from Bright Data
 * @returns {Promise<Object>} - Saved record with ID
 */
const saveLinkedInProfile = async (data) => {
    console.log(`[DB] Saving profile ${data.profileUrl || 'unknown URL'}`);
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Prepare the data for insertion
        const insertData = {
            profileUrl: data.profileUrl,
            fullName: data.fullName,
            firstName: data.firstName,
            lastName: data.lastName,
            headline: data.headline,
            summary: data.summary,
            location: data.location,
            industry: data.industry,
            currentCompany: data.currentCompany,
            currentPosition: data.currentPosition,
            connectionsCount: data.connectionsCount,
            followersCount: data.followersCount,
            profileImageUrl: data.profileImageUrl,
            backgroundImageUrl: data.backgroundImageUrl,
            experience: data.experience || [],
            education: data.education || [],
            skills: data.skills || [],
            certifications: data.certifications || [],
            courses: data.courses || [],
            projects: data.projects || [],
            publications: data.publications || [],
            volunteerWork: data.volunteerWork || [],
            honorsAwards: data.honorsAwards || [],
            languages: data.languages || [],
            activity: data.activity || [],
            articles: data.articles || [],
            recommendations: data.recommendations || [],
            rawJson: data.rawData || {},
            extractionStatus: 'completed',
            extractionMethod: data.method || 'unknown',
            brightDataSnapshotId: data.snapshotId,
            extractionCompletedAt: new Date()
        };
        
        console.log('[DB] Data prepared for insertion');
        console.log(`[DB] Profile summary: ${insertData.fullName} at ${insertData.currentCompany}`);
        console.log(`[DB] Data complexity: ${insertData.experience.length} jobs, ${insertData.education.length} schools, ${insertData.skills.length} skills`);
        
        // Insert or update using UPSERT
        const query = `
            INSERT INTO linkedin_profiles (
                profile_url, full_name, first_name, last_name, headline, summary,
                location, industry, current_company, current_position,
                connections_count, followers_count, profile_image_url, background_image_url,
                experience, education, skills, certifications, courses, projects,
                publications, volunteer_work, honors_awards, languages,
                activity, articles, recommendations, raw_json,
                extraction_status, extraction_method, bright_data_snapshot_id,
                extraction_completed_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28,
                $29, $30, $31, $32, NOW()
            )
            ON CONFLICT (profile_url) 
            DO UPDATE SET
                full_name = EXCLUDED.full_name,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                headline = EXCLUDED.headline,
                summary = EXCLUDED.summary,
                location = EXCLUDED.location,
                industry = EXCLUDED.industry,
                current_company = EXCLUDED.current_company,
                current_position = EXCLUDED.current_position,
                connections_count = EXCLUDED.connections_count,
                followers_count = EXCLUDED.followers_count,
                profile_image_url = EXCLUDED.profile_image_url,
                background_image_url = EXCLUDED.background_image_url,
                experience = EXCLUDED.experience,
                education = EXCLUDED.education,
                skills = EXCLUDED.skills,
                certifications = EXCLUDED.certifications,
                courses = EXCLUDED.courses,
                projects = EXCLUDED.projects,
                publications = EXCLUDED.publications,
                volunteer_work = EXCLUDED.volunteer_work,
                honors_awards = EXCLUDED.honors_awards,
                languages = EXCLUDED.languages,
                activity = EXCLUDED.activity,
                articles = EXCLUDED.articles,
                recommendations = EXCLUDED.recommendations,
                raw_json = EXCLUDED.raw_json,
                extraction_status = EXCLUDED.extraction_status,
                extraction_method = EXCLUDED.extraction_method,
                bright_data_snapshot_id = EXCLUDED.bright_data_snapshot_id,
                extraction_completed_at = EXCLUDED.extraction_completed_at,
                retry_count = linkedin_profiles.retry_count + 1,
                updated_at = NOW()
            RETURNING id, profile_url, full_name, current_company, extraction_status, created_at, updated_at
        `;
        
        const values = [
            insertData.profileUrl,
            insertData.fullName,
            insertData.firstName,
            insertData.lastName,
            insertData.headline,
            insertData.summary,
            insertData.location,
            insertData.industry,
            insertData.currentCompany,
            insertData.currentPosition,
            insertData.connectionsCount,
            insertData.followersCount,
            insertData.profileImageUrl,
            insertData.backgroundImageUrl,
            JSON.stringify(insertData.experience),
            JSON.stringify(insertData.education),
            JSON.stringify(insertData.skills),
            JSON.stringify(insertData.certifications),
            JSON.stringify(insertData.courses),
            JSON.stringify(insertData.projects),
            JSON.stringify(insertData.publications),
            JSON.stringify(insertData.volunteerWork),
            JSON.stringify(insertData.honorsAwards),
            JSON.stringify(insertData.languages),
            JSON.stringify(insertData.activity),
            JSON.stringify(insertData.articles),
            JSON.stringify(insertData.recommendations),
            JSON.stringify(insertData.rawJson),
            insertData.extractionStatus,
            insertData.extractionMethod,
            insertData.brightDataSnapshotId,
            insertData.extractionCompletedAt
        ];
        
        const result = await client.query(query, values);
        
        await client.query('COMMIT');
        
        const savedRecord = result.rows[0];
        console.log(`[DB] Saved record ID: ${savedRecord.id}`);
        console.log(`[DB] Profile: ${savedRecord.full_name} (${savedRecord.current_company})`);
        console.log(`[DB] Status: ${savedRecord.extraction_status}`);
        console.log(`[DB] Created: ${savedRecord.created_at}`);
        console.log(`[DB] Updated: ${savedRecord.updated_at}`);
        
        return savedRecord;
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[DB] Save error:', error.message);
        console.error('[DB] Error code:', error.code);
        console.error('[DB] Error detail:', error.detail);
        throw new Error(`Database save failed: ${error.message}`);
    } finally {
        client.release();
    }
};

/**
 * Get LinkedIn profile by URL
 * @param {string} profileUrl - LinkedIn profile URL
 * @returns {Promise<Object|null>} - Profile record or null if not found
 */
const getLinkedInProfileByUrl = async (profileUrl) => {
    console.log(`[DB] Looking up profile: ${profileUrl}`);
    
    try {
        const query = 'SELECT * FROM linkedin_profiles WHERE profile_url = $1';
        const result = await pool.query(query, [profileUrl]);
        
        if (result.rows.length > 0) {
            console.log(`[DB] Profile found: ${result.rows[0].full_name}`);
            return result.rows[0];
        } else {
            console.log('[DB] Profile not found');
            return null;
        }
    } catch (error) {
        console.error('[DB] Lookup error:', error.message);
        throw new Error(`Database lookup failed: ${error.message}`);
    }
};

/**
 * Update extraction status for a profile
 * @param {string} profileUrl - LinkedIn profile URL
 * @param {string} status - New status (pending, processing, completed, failed)
 * @param {string} error - Error message if status is failed
 * @param {string} snapshotId - Bright Data snapshot ID if available
 * @returns {Promise<Object>} - Updated record
 */
const updateExtractionStatus = async (profileUrl, status, error = null, snapshotId = null) => {
    console.log(`[DB] Updating status for ${profileUrl}: ${status}`);
    
    try {
        const query = `
            UPDATE linkedin_profiles 
            SET extraction_status = $1, 
                extraction_error = $2, 
                bright_data_snapshot_id = $3,
                updated_at = NOW()
            WHERE profile_url = $4 
            RETURNING id, profile_url, extraction_status, updated_at
        `;
        
        const result = await pool.query(query, [status, error, snapshotId, profileUrl]);
        
        if (result.rows.length > 0) {
            console.log(`[DB] Status updated: ${result.rows[0].extraction_status}`);
            return result.rows[0];
        } else {
            throw new Error('Profile not found for status update');
        }
    } catch (dbError) {
        console.error('[DB] Status update error:', dbError.message);
        throw new Error(`Database status update failed: ${dbError.message}`);
    }
};

/**
 * Create initial profile record with pending status
 * @param {string} profileUrl - LinkedIn profile URL
 * @returns {Promise<Object>} - Created record
 */
const createInitialProfile = async (profileUrl) => {
    console.log(`[DB] Creating initial profile record for ${profileUrl}`);
    
    try {
        const query = `
            INSERT INTO linkedin_profiles (profile_url, extraction_status)
            VALUES ($1, 'pending')
            ON CONFLICT (profile_url) 
            DO UPDATE SET
                extraction_status = 'pending',
                extraction_error = NULL,
                retry_count = linkedin_profiles.retry_count + 1,
                extraction_started_at = NOW(),
                updated_at = NOW()
            RETURNING id, profile_url, extraction_status, created_at
        `;
        
        const result = await pool.query(query, [profileUrl]);
        const record = result.rows[0];
        
        console.log(`[DB] Initial record created/updated: ID ${record.id}`);
        return record;
        
    } catch (error) {
        console.error('[DB] Initial record creation error:', error.message);
        throw new Error(`Failed to create initial profile record: ${error.message}`);
    }
};

/**
 * Get profiles by status for monitoring
 * @param {string} status - Status to filter by
 * @param {number} limit - Max number of records to return
 * @returns {Promise<Array>} - Array of profile records
 */
const getProfilesByStatus = async (status, limit = 50) => {
    try {
        const query = `
            SELECT id, profile_url, full_name, current_company, 
                   extraction_status, extraction_started_at, 
                   extraction_completed_at, retry_count
            FROM linkedin_profiles 
            WHERE extraction_status = $1 
            ORDER BY extraction_started_at DESC 
            LIMIT $2
        `;
        
        const result = await pool.query(query, [status, limit]);
        console.log(`[DB] Found ${result.rows.length} profiles with status: ${status}`);
        
        return result.rows;
    } catch (error) {
        console.error('[DB] Status query error:', error.message);
        throw new Error(`Failed to query profiles by status: ${error.message}`);
    }
};

/**
 * Get database statistics
 * @returns {Promise<Object>} - Database statistics
 */
const getDatabaseStats = async () => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_profiles,
                COUNT(CASE WHEN extraction_status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN extraction_status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN extraction_status = 'processing' THEN 1 END) as processing,
                COUNT(CASE WHEN extraction_status = 'failed' THEN 1 END) as failed,
                AVG(EXTRACT(EPOCH FROM (extraction_completed_at - extraction_started_at))) as avg_processing_time
            FROM linkedin_profiles
        `;
        
        const result = await pool.query(statsQuery);
        const stats = result.rows[0];
        
        console.log('[DB] Database statistics retrieved');
        console.log(`[DB] Total profiles: ${stats.total_profiles}`);
        console.log(`[DB] Completed: ${stats.completed}`);
        console.log(`[DB] Pending: ${stats.pending}`);
        console.log(`[DB] Processing: ${stats.processing}`);
        console.log(`[DB] Failed: ${stats.failed}`);
        
        return {
            totalProfiles: parseInt(stats.total_profiles),
            completed: parseInt(stats.completed),
            pending: parseInt(stats.pending),
            processing: parseInt(stats.processing),
            failed: parseInt(stats.failed),
            avgProcessingTimeSeconds: stats.avg_processing_time ? Math.round(stats.avg_processing_time) : null
        };
    } catch (error) {
        console.error('[DB] Stats query error:', error.message);
        throw new Error(`Failed to get database statistics: ${error.message}`);
    }
};

// For standalone testing (run with: node databaseService.js)
if (require.main === module) {
    console.log('[DB] Testing database service...');
    
    const testData = {
        profileUrl: 'https://www.linkedin.com/in/test-profile',
        fullName: 'Test User',
        headline: 'Test Engineer',
        currentCompany: 'Test Company',
        experience: [{ company: 'Test Corp', position: 'Engineer' }],
        education: [{ school: 'Test University', degree: 'Computer Science' }],
        skills: ['JavaScript', 'Node.js'],
        rawData: { test: true },
        method: 'test'
    };
    
    saveLinkedInProfile(testData)
        .then(result => {
            console.log('[DB] Test successful!');
            console.log('[DB] Result:', result);
            return getDatabaseStats();
        })
        .then(stats => {
            console.log('[DB] Stats:', stats);
        })
        .catch(error => {
            console.error('[DB] Test failed:', error.message);
            process.exit(1);
        });
}

module.exports = {
    saveLinkedInProfile,
    getLinkedInProfileByUrl,
    updateExtractionStatus,
    createInitialProfile,
    getProfilesByStatus,
    getDatabaseStats,
    testConnection
};