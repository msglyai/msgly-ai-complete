// Enhanced Database Service - Async LinkedIn Processing Support
// Works with the official Bright Data LinkedIn service for background processing

const { Pool } = require('pg');

class DatabaseService {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        console.log('[DATABASE] 📊 Enhanced Database Service initialized');
    }

    // Save LinkedIn profile data from async background processing
    async saveAsyncLinkedInProfile(snapshotId, profileData) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            console.log(`[DATABASE] 💾 Saving async LinkedIn profile data for snapshot: ${snapshotId}`);
            
            // Find user by snapshot ID or LinkedIn URL
            let userId = null;
            
            // First try to find by snapshot ID in processing records
            const snapshotQuery = `
                SELECT user_id FROM linkedin_extractions 
                WHERE snapshot_id = $1 AND status = 'processing'
                ORDER BY created_at DESC 
                LIMIT 1
            `;
            const snapshotResult = await client.query(snapshotQuery, [snapshotId]);
            
            if (snapshotResult.rows.length > 0) {
                userId = snapshotResult.rows[0].user_id;
            } else {
                // Fallback: try to find by LinkedIn URL
                if (profileData.profileUrl) {
                    const urlQuery = `
                        SELECT id FROM users 
                        WHERE linkedin_url = $1
                        ORDER BY created_at DESC 
                        LIMIT 1
                    `;
                    const urlResult = await client.query(urlQuery, [profileData.profileUrl]);
                    
                    if (urlResult.rows.length > 0) {
                        userId = urlResult.rows[0].id;
                    }
                }
            }
            
            if (!userId) {
                throw new Error(`Cannot find user for snapshot ID: ${snapshotId}`);
            }
            
            // Save comprehensive LinkedIn profile data
            const insertQuery = `
                INSERT INTO linkedin_profiles (
                    user_id, snapshot_id, name, headline, location, summary,
                    profile_url, linkedin_id, profile_picture,
                    current_position, current_company,
                    experience, education, skills, certifications,
                    languages, awards, publications, projects, 
                    volunteer_experience, connections, followers,
                    recommendations, courses, patents, test_scores,
                    extracted_at, data_source, completeness, processing_time,
                    raw_data, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                    $31, NOW(), NOW()
                )
                ON CONFLICT (user_id) 
                DO UPDATE SET
                    snapshot_id = EXCLUDED.snapshot_id,
                    name = EXCLUDED.name,
                    headline = EXCLUDED.headline,
                    location = EXCLUDED.location,
                    summary = EXCLUDED.summary,
                    profile_url = EXCLUDED.profile_url,
                    linkedin_id = EXCLUDED.linkedin_id,
                    profile_picture = EXCLUDED.profile_picture,
                    current_position = EXCLUDED.current_position,
                    current_company = EXCLUDED.current_company,
                    experience = EXCLUDED.experience,
                    education = EXCLUDED.education,
                    skills = EXCLUDED.skills,
                    certifications = EXCLUDED.certifications,
                    languages = EXCLUDED.languages,
                    awards = EXCLUDED.awards,
                    publications = EXCLUDED.publications,
                    projects = EXCLUDED.projects,
                    volunteer_experience = EXCLUDED.volunteer_experience,
                    connections = EXCLUDED.connections,
                    followers = EXCLUDED.followers,
                    recommendations = EXCLUDED.recommendations,
                    courses = EXCLUDED.courses,
                    patents = EXCLUDED.patents,
                    test_scores = EXCLUDED.test_scores,
                    extracted_at = EXCLUDED.extracted_at,
                    data_source = EXCLUDED.data_source,
                    completeness = EXCLUDED.completeness,
                    processing_time = EXCLUDED.processing_time,
                    raw_data = EXCLUDED.raw_data,
                    updated_at = NOW()
                RETURNING id
            `;
            
            const values = [
                userId, snapshotId, profileData.name, profileData.headline, profileData.location,
                profileData.summary, profileData.profileUrl, profileData.linkedinId, 
                profileData.profilePicture, profileData.currentPosition, profileData.currentCompany,
                JSON.stringify(profileData.experience || []),
                JSON.stringify(profileData.education || []),
                JSON.stringify(profileData.skills || []),
                JSON.stringify(profileData.certifications || []),
                JSON.stringify(profileData.languages || []),
                JSON.stringify(profileData.awards || []),
                JSON.stringify(profileData.publications || []),
                JSON.stringify(profileData.projects || []),
                JSON.stringify(profileData.volunteerExperience || []),
                profileData.connections,
                profileData.followers,
                JSON.stringify(profileData.recommendations || []),
                JSON.stringify(profileData.courses || []),
                JSON.stringify(profileData.patents || []),
                JSON.stringify(profileData.testScores || []),
                profileData.extractedAt,
                profileData.dataSource || 'Bright Data LinkedIn API',
                profileData.completeness || 0,
                profileData.processingTime,
                JSON.stringify(profileData)
            ];
            
            const result = await client.query(insertQuery, values);
            
            // Update extraction status to completed
            const updateExtractionQuery = `
                UPDATE linkedin_extractions 
                SET 
                    status = 'completed',
                    completed_at = NOW(),
                    result_data = $1,
                    error_message = NULL
                WHERE snapshot_id = $2
            `;
            
            await client.query(updateExtractionQuery, [
                JSON.stringify({ profileId: result.rows[0]?.id, completeness: profileData.completeness }),
                snapshotId
            ]);
            
            await client.query('COMMIT');
            
            console.log(`[DATABASE] ✅ Async LinkedIn profile saved successfully for user: ${userId}`);
            console.log(`[DATABASE] 📊 Profile completeness: ${profileData.completeness}%`);
            console.log(`[DATABASE] 👤 Profile: ${profileData.name} - ${profileData.currentPosition}`);
            
            return {
                success: true,
                profileId: result.rows[0]?.id,
                userId: userId,
                completeness: profileData.completeness
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[DATABASE] ❌ Failed to save async LinkedIn profile:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // Mark async extraction as failed
    async markAsyncExtractionFailed(snapshotId, errorMessage) {
        try {
            console.log(`[DATABASE] ❌ Marking async extraction as failed: ${snapshotId}`);
            
            const updateQuery = `
                UPDATE linkedin_extractions 
                SET 
                    status = 'failed',
                    completed_at = NOW(),
                    error_message = $1
                WHERE snapshot_id = $2
            `;
            
            await this.pool.query(updateQuery, [errorMessage, snapshotId]);
            
            console.log(`[DATABASE] 📝 Extraction marked as failed: ${snapshotId}`);
            
        } catch (error) {
            console.error('[DATABASE] ❌ Failed to mark extraction as failed:', error.message);
        }
    }

    // Track LinkedIn extraction start (for async processing)
    async markExtractionStarted(userId, profileUrl, snapshotId = null) {
        try {
            console.log(`[DATABASE] 🚀 Marking LinkedIn extraction started for user: ${userId}`);
            
            const insertQuery = `
                INSERT INTO linkedin_extractions (
                    user_id, profile_url, snapshot_id, status, created_at
                ) VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (user_id) 
                DO UPDATE SET
                    profile_url = EXCLUDED.profile_url,
                    snapshot_id = EXCLUDED.snapshot_id,
                    status = EXCLUDED.status,
                    created_at = NOW(),
                    completed_at = NULL,
                    error_message = NULL
                RETURNING id
            `;
            
            const result = await this.pool.query(insertQuery, [
                userId, profileUrl, snapshotId, 'processing'
            ]);
            
            console.log(`[DATABASE] ✅ Extraction tracking started: ${result.rows[0].id}`);
            return result.rows[0].id;
            
        } catch (error) {
            console.error('[DATABASE] ❌ Failed to mark extraction started:', error.message);
            throw error;
        }
    }

    // Get extraction status for a user
    async getExtractionStatus(userId) {
        try {
            const query = `
                SELECT 
                    id, snapshot_id, status, created_at, completed_at, 
                    error_message, result_data
                FROM linkedin_extractions 
                WHERE user_id = $1 
                ORDER BY created_at DESC 
                LIMIT 1
            `;
            
            const result = await this.pool.query(query, [userId]);
            
            if (result.rows.length === 0) {
                return { status: 'not_started' };
            }
            
            return result.rows[0];
            
        } catch (error) {
            console.error('[DATABASE] ❌ Failed to get extraction status:', error.message);
            return { status: 'error', error: error.message };
        }
    }

    // Original methods for immediate processing (backward compatibility)
    async saveLinkedInProfile(userId, profileData) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            console.log(`[DATABASE] 💾 Saving LinkedIn profile for user: ${userId}`);
            
            const insertQuery = `
                INSERT INTO linkedin_profiles (
                    user_id, name, headline, location, summary,
                    profile_url, linkedin_id, profile_picture,
                    current_position, current_company,
                    experience, education, skills, certifications,
                    languages, awards, publications, projects, 
                    volunteer_experience, connections, followers,
                    recommendations, courses, patents, test_scores,
                    extracted_at, data_source, completeness,
                    raw_data, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25, $26, $27, $28, $29,
                    NOW(), NOW()
                )
                ON CONFLICT (user_id) 
                DO UPDATE SET
                    name = EXCLUDED.name,
                    headline = EXCLUDED.headline,
                    location = EXCLUDED.location,
                    summary = EXCLUDED.summary,
                    profile_url = EXCLUDED.profile_url,
                    linkedin_id = EXCLUDED.linkedin_id,
                    profile_picture = EXCLUDED.profile_picture,
                    current_position = EXCLUDED.current_position,
                    current_company = EXCLUDED.current_company,
                    experience = EXCLUDED.experience,
                    education = EXCLUDED.education,
                    skills = EXCLUDED.skills,
                    certifications = EXCLUDED.certifications,
                    languages = EXCLUDED.languages,
                    awards = EXCLUDED.awards,
                    publications = EXCLUDED.publications,
                    projects = EXCLUDED.projects,
                    volunteer_experience = EXCLUDED.volunteer_experience,
                    connections = EXCLUDED.connections,
                    followers = EXCLUDED.followers,
                    recommendations = EXCLUDED.recommendations,
                    courses = EXCLUDED.courses,
                    patents = EXCLUDED.patents,
                    test_scores = EXCLUDED.test_scores,
                    extracted_at = EXCLUDED.extracted_at,
                    data_source = EXCLUDED.data_source,
                    completeness = EXCLUDED.completeness,
                    raw_data = EXCLUDED.raw_data,
                    updated_at = NOW()
                RETURNING id
            `;
            
            const values = [
                userId, profileData.name, profileData.headline, profileData.location,
                profileData.summary, profileData.profileUrl, profileData.linkedinId, 
                profileData.profilePicture, profileData.currentPosition, profileData.currentCompany,
                JSON.stringify(profileData.experience || []),
                JSON.stringify(profileData.education || []),
                JSON.stringify(profileData.skills || []),
                JSON.stringify(profileData.certifications || []),
                JSON.stringify(profileData.languages || []),
                JSON.stringify(profileData.awards || []),
                JSON.stringify(profileData.publications || []),
                JSON.stringify(profileData.projects || []),
                JSON.stringify(profileData.volunteerExperience || []),
                profileData.connections,
                profileData.followers,
                JSON.stringify(profileData.recommendations || []),
                JSON.stringify(profileData.courses || []),
                JSON.stringify(profileData.patents || []),
                JSON.stringify(profileData.testScores || []),
                profileData.extractedAt,
                profileData.dataSource || 'Bright Data LinkedIn API',
                profileData.completeness || 0,
                JSON.stringify(profileData)
            ];
            
            const result = await client.query(insertQuery, values);
            
            await client.query('COMMIT');
            
            console.log(`[DATABASE] ✅ LinkedIn profile saved successfully`);
            return result.rows[0].id;
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[DATABASE] ❌ Failed to save LinkedIn profile:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    async markExtractionFailed(userId, errorMessage) {
        try {
            console.log(`[DATABASE] ❌ Marking extraction failed for user: ${userId}`);
            
            const updateQuery = `
                INSERT INTO linkedin_extractions (
                    user_id, status, error_message, created_at, completed_at
                ) VALUES ($1, $2, $3, NOW(), NOW())
                ON CONFLICT (user_id) 
                DO UPDATE SET
                    status = EXCLUDED.status,
                    error_message = EXCLUDED.error_message,
                    completed_at = NOW()
            `;
            
            await this.pool.query(updateQuery, [userId, 'failed', errorMessage]);
            
            console.log(`[DATABASE] 📝 Extraction marked as failed for user: ${userId}`);
            
        } catch (error) {
            console.error('[DATABASE] ❌ Failed to mark extraction as failed:', error.message);
        }
    }

    // Get comprehensive LinkedIn profile statistics
    async getLinkedInStats() {
        try {
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_profiles,
                    COUNT(CASE WHEN current_position IS NOT NULL THEN 1 END) as with_current_position,
                    COUNT(CASE WHEN current_company IS NOT NULL THEN 1 END) as with_current_company,
                    COUNT(CASE WHEN experience != '[]' AND experience IS NOT NULL THEN 1 END) as with_experience,
                    COUNT(CASE WHEN education != '[]' AND education IS NOT NULL THEN 1 END) as with_education,
                    COUNT(CASE WHEN skills != '[]' AND skills IS NOT NULL THEN 1 END) as with_skills,
                    COUNT(CASE WHEN certifications != '[]' AND certifications IS NOT NULL THEN 1 END) as with_certifications,
                    COUNT(CASE WHEN awards != '[]' AND awards IS NOT NULL THEN 1 END) as with_awards,
                    COUNT(CASE WHEN publications != '[]' AND publications IS NOT NULL THEN 1 END) as with_publications,
                    COUNT(CASE WHEN projects != '[]' AND projects IS NOT NULL THEN 1 END) as with_projects,
                    AVG(completeness) as average_completeness,
                    MAX(created_at) as last_extraction
                FROM linkedin_profiles
            `;
            
            const extractionStatsQuery = `
                SELECT 
                    COUNT(*) as total_extractions,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
                FROM linkedin_extractions
            `;
            
            const [statsResult, extractionResult] = await Promise.all([
                this.pool.query(statsQuery),
                this.pool.query(extractionStatsQuery)
            ]);
            
            const stats = statsResult.rows[0];
            const extractions = extractionResult.rows[0];
            
            const totalProfiles = parseInt(stats.total_profiles) || 0;
            const completed = parseInt(extractions.completed) || 0;
            const total = parseInt(extractions.total_extractions) || 0;
            
            return {
                totalProfiles: totalProfiles,
                completed: completed,
                processing: parseInt(extractions.processing) || 0,
                pending: parseInt(extractions.pending) || 0,
                failed: parseInt(extractions.failed) || 0,
                successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
                avgProcessingTimeSeconds: null, // Could be calculated if we track timing
                averageCompleteness: Math.round(parseFloat(stats.average_completeness) || 0),
                dataBreakdown: {
                    withCurrentPosition: parseInt(stats.with_current_position) || 0,
                    withCurrentCompany: parseInt(stats.with_current_company) || 0,
                    withExperience: parseInt(stats.with_experience) || 0,
                    withEducation: parseInt(stats.with_education) || 0,
                    withSkills: parseInt(stats.with_skills) || 0,
                    withCertifications: parseInt(stats.with_certifications) || 0,
                    withAwards: parseInt(stats.with_awards) || 0,
                    withPublications: parseInt(stats.with_publications) || 0,
                    withProjects: parseInt(stats.with_projects) || 0
                }
            };
            
        } catch (error) {
            console.error('[DATABASE] ❌ Failed to get LinkedIn stats:', error.message);
            return {
                totalProfiles: 0,
                completed: 0,
                processing: 0,
                pending: 0,
                failed: 0,
                successRate: 0,
                avgProcessingTimeSeconds: null,
                averageCompleteness: 0,
                dataBreakdown: {
                    withCurrentPosition: 0,
                    withCurrentCompany: 0,
                    withExperience: 0,
                    withEducation: 0,
                    withSkills: 0,
                    withCertifications: 0,
                    withAwards: 0,
                    withPublications: 0,
                    withProjects: 0
                }
            };
        }
    }

    // Get LinkedIn profile by user ID
    async getLinkedInProfile(userId) {
        try {
            const query = `
                SELECT * FROM linkedin_profiles 
                WHERE user_id = $1 
                ORDER BY updated_at DESC 
                LIMIT 1
            `;
            
            const result = await this.pool.query(query, [userId]);
            
            if (result.rows.length === 0) {
                return null;
            }
            
            const profile = result.rows[0];
            
            // Parse JSON fields
            try {
                profile.experience = JSON.parse(profile.experience || '[]');
                profile.education = JSON.parse(profile.education || '[]');
                profile.skills = JSON.parse(profile.skills || '[]');
                profile.certifications = JSON.parse(profile.certifications || '[]');
                profile.languages = JSON.parse(profile.languages || '[]');
                profile.awards = JSON.parse(profile.awards || '[]');
                profile.publications = JSON.parse(profile.publications || '[]');
                profile.projects = JSON.parse(profile.projects || '[]');
                profile.volunteer_experience = JSON.parse(profile.volunteer_experience || '[]');
                profile.recommendations = JSON.parse(profile.recommendations || '[]');
                profile.courses = JSON.parse(profile.courses || '[]');
                profile.patents = JSON.parse(profile.patents || '[]');
                profile.test_scores = JSON.parse(profile.test_scores || '[]');
            } catch (parseError) {
                console.error('[DATABASE] ❌ Failed to parse JSON fields:', parseError.message);
            }
            
            return profile;
            
        } catch (error) {
            console.error('[DATABASE] ❌ Failed to get LinkedIn profile:', error.message);
            return null;
        }
    }

    // Database health check
    async testConnection() {
        try {
            const result = await this.pool.query('SELECT NOW() as timestamp');
            console.log('[DATABASE] ✅ Connection test successful');
            return {
                connected: true,
                timestamp: result.rows[0].timestamp
            };
        } catch (error) {
            console.error('[DATABASE] ❌ Connection test failed:', error.message);
            return {
                connected: false,
                error: error.message
            };
        }
    }
}

module.exports = DatabaseService;
