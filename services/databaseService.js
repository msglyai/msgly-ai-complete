// Complete Database Service - Production Ready
// Handles all LinkedIn profile data storage

const { Pool } = require('pg');

class DatabaseService {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        console.log('✅ Database service initialized');
    }

    // Save complete LinkedIn profile data
    async saveLinkedInProfile(userId, profileData) {
        const client = await this.pool.connect();
        
        try {
            console.log('[DB] 💾 Saving LinkedIn profile for user:', userId);
            console.log('[DB] 📊 Profile summary:', {
                name: profileData.name || 'Not found',
                currentPosition: profileData.current_position || 'Not found',
                currentCompany: profileData.current_company || 'Not found',
                experienceCount: profileData.experience?.length || 0,
                educationCount: profileData.education?.length || 0,
                skillsCount: profileData.skills?.length || 0,
                certificationsCount: profileData.certifications?.length || 0,
                awardsCount: profileData.honors_awards?.length || 0,
                completeness: profileData.data_completeness || 0
            });

            // Check if profile already exists
            const existingResult = await client.query(
                'SELECT id FROM linkedin_profiles WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                [userId]
            );

            let result;
            
            if (existingResult.rows.length > 0) {
                // Update existing profile
                console.log('[DB] 🔄 Updating existing LinkedIn profile');
                
                result = await client.query(`
                    UPDATE linkedin_profiles SET 
                        profile_url = $2,
                        name = $3,
                        headline = $4,
                        summary = $5,
                        location = $6,
                        profile_picture = $7,
                        background_image = $8,
                        current_position = $9,
                        current_company = $10,
                        current_company_url = $11,
                        connections_count = $12,
                        followers_count = $13,
                        experience = $14,
                        education = $15,
                        skills = $16,
                        certifications = $17,
                        honors_awards = $18,
                        publications = $19,
                        projects = $20,
                        volunteer_experience = $21,
                        languages = $22,
                        courses = $23,
                        recommendations_received = $24,
                        recommendations_given = $25,
                        extraction_timestamp = $26,
                        data_completeness = $27,
                        raw_data_summary = $28,
                        extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                    RETURNING id, name, current_position, current_company, data_completeness
                `, [
                    existingResult.rows[0].id,
                    profileData.profile_url,
                    profileData.name,
                    profileData.headline,
                    profileData.summary,
                    profileData.location,
                    profileData.profile_picture,
                    profileData.background_image,
                    profileData.current_position,
                    profileData.current_company,
                    profileData.current_company_url,
                    profileData.connections_count || 0,
                    profileData.followers_count || 0,
                    JSON.stringify(profileData.experience || []),
                    JSON.stringify(profileData.education || []),
                    JSON.stringify(profileData.skills || []),
                    JSON.stringify(profileData.certifications || []),
                    JSON.stringify(profileData.honors_awards || []),
                    JSON.stringify(profileData.publications || []),
                    JSON.stringify(profileData.projects || []),
                    JSON.stringify(profileData.volunteer_experience || []),
                    JSON.stringify(profileData.languages || []),
                    JSON.stringify(profileData.courses || []),
                    JSON.stringify(profileData.recommendations_received || []),
                    JSON.stringify(profileData.recommendations_given || []),
                    profileData.extraction_timestamp,
                    profileData.data_completeness || 0,
                    JSON.stringify(profileData.raw_data_summary || {})
                ]);
                
            } else {
                // Insert new profile
                console.log('[DB] ➕ Creating new LinkedIn profile');
                
                result = await client.query(`
                    INSERT INTO linkedin_profiles (
                        user_id, profile_url, name, headline, summary, location,
                        profile_picture, background_image, current_position, 
                        current_company, current_company_url, connections_count, 
                        followers_count, experience, education, skills, 
                        certifications, honors_awards, publications, projects,
                        volunteer_experience, languages, courses, 
                        recommendations_received, recommendations_given,
                        extraction_timestamp, data_completeness, raw_data_summary,
                        extraction_status, extraction_completed_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
                        $26, $27, $28, 'completed', CURRENT_TIMESTAMP
                    )
                    RETURNING id, name, current_position, current_company, data_completeness
                `, [
                    userId,
                    profileData.profile_url,
                    profileData.name,
                    profileData.headline,
                    profileData.summary,
                    profileData.location,
                    profileData.profile_picture,
                    profileData.background_image,
                    profileData.current_position,
                    profileData.current_company,
                    profileData.current_company_url,
                    profileData.connections_count || 0,
                    profileData.followers_count || 0,
                    JSON.stringify(profileData.experience || []),
                    JSON.stringify(profileData.education || []),
                    JSON.stringify(profileData.skills || []),
                    JSON.stringify(profileData.certifications || []),
                    JSON.stringify(profileData.honors_awards || []),
                    JSON.stringify(profileData.publications || []),
                    JSON.stringify(profileData.projects || []),
                    JSON.stringify(profileData.volunteer_experience || []),
                    JSON.stringify(profileData.languages || []),
                    JSON.stringify(profileData.courses || []),
                    JSON.stringify(profileData.recommendations_received || []),
                    JSON.stringify(profileData.recommendations_given || []),
                    profileData.extraction_timestamp,
                    profileData.data_completeness || 0,
                    JSON.stringify(profileData.raw_data_summary || {})
                ]);
            }

            const savedProfile = result.rows[0];
            
            console.log('[DB] ✅ LinkedIn profile saved successfully!');
            console.log('[DB] 📋 Details:', {
                id: savedProfile.id,
                name: savedProfile.name,
                position: savedProfile.current_position,
                company: savedProfile.current_company,
                completeness: savedProfile.data_completeness + '%'
            });

            return {
                success: true,
                profileId: savedProfile.id,
                name: savedProfile.name,
                currentPosition: savedProfile.current_position,
                currentCompany: savedProfile.current_company,
                dataCompleteness: savedProfile.data_completeness,
                message: 'LinkedIn profile saved successfully'
            };

        } catch (error) {
            console.error('[DB] ❌ Error saving LinkedIn profile:', error);
            throw new Error(`Database save failed: ${error.message}`);
        } finally {
            client.release();
        }
    }

    // Get LinkedIn profile for a user
    async getLinkedInProfile(userId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    id, profile_url, name, headline, summary, location,
                    profile_picture, background_image, current_position,
                    current_company, current_company_url, connections_count,
                    followers_count, experience, education, skills,
                    certifications, honors_awards, publications, projects,
                    volunteer_experience, languages, courses,
                    recommendations_received, recommendations_given,
                    extraction_timestamp, data_completeness, raw_data_summary,
                    extraction_status, created_at, updated_at
                FROM linkedin_profiles 
                WHERE user_id = $1 
                ORDER BY updated_at DESC 
                LIMIT 1
            `, [userId]);
            
            if (result.rows.length === 0) {
                return null;
            }

            return result.rows[0];

        } catch (error) {
            console.error('[DB] ❌ Error getting LinkedIn profile:', error);
            throw new Error(`Failed to retrieve profile: ${error.message}`);
        }
    }

    // Get comprehensive statistics
    async getLinkedInStats() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_profiles,
                    COUNT(CASE WHEN extraction_status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN extraction_status = 'processing' THEN 1 END) as processing,
                    COUNT(CASE WHEN extraction_status = 'pending' THEN 1 END) as pending,
                    COUNT(CASE WHEN extraction_status = 'failed' THEN 1 END) as failed,
                    ROUND(AVG(data_completeness)) as avg_completeness,
                    COUNT(CASE WHEN current_position IS NOT NULL THEN 1 END) as with_current_position,
                    COUNT(CASE WHEN current_company IS NOT NULL THEN 1 END) as with_current_company,
                    COUNT(CASE WHEN jsonb_array_length(experience) > 0 THEN 1 END) as with_experience,
                    COUNT(CASE WHEN jsonb_array_length(education) > 0 THEN 1 END) as with_education,
                    COUNT(CASE WHEN jsonb_array_length(skills) > 0 THEN 1 END) as with_skills,
                    COUNT(CASE WHEN jsonb_array_length(certifications) > 0 THEN 1 END) as with_certifications,
                    COUNT(CASE WHEN jsonb_array_length(honors_awards) > 0 THEN 1 END) as with_awards
                FROM linkedin_profiles
            `);
            
            const stats = result.rows[0];
            
            return {
                totalProfiles: parseInt(stats.total_profiles) || 0,
                completed: parseInt(stats.completed) || 0,
                processing: parseInt(stats.processing) || 0,
                pending: parseInt(stats.pending) || 0,
                failed: parseInt(stats.failed) || 0,
                averageCompleteness: parseInt(stats.avg_completeness) || 0,
                dataBreakdown: {
                    withCurrentPosition: parseInt(stats.with_current_position) || 0,
                    withCurrentCompany: parseInt(stats.with_current_company) || 0,
                    withExperience: parseInt(stats.with_experience) || 0,
                    withEducation: parseInt(stats.with_education) || 0,
                    withSkills: parseInt(stats.with_skills) || 0,
                    withCertifications: parseInt(stats.with_certifications) || 0,
                    withAwards: parseInt(stats.with_awards) || 0
                }
            };

        } catch (error) {
            console.error('[DB] ❌ Error getting stats:', error);
            return {
                totalProfiles: 0,
                completed: 0,
                processing: 0,
                pending: 0,
                failed: 0,
                averageCompleteness: 0,
                dataBreakdown: {
                    withCurrentPosition: 0,
                    withCurrentCompany: 0,
                    withExperience: 0,
                    withEducation: 0,
                    withSkills: 0,
                    withCertifications: 0,
                    withAwards: 0
                }
            };
        }
    }

    // Mark extraction as started
    async markExtractionStarted(userId, profileUrl) {
        try {
            const result = await this.pool.query(`
                INSERT INTO linkedin_profiles (user_id, profile_url, extraction_status, extraction_attempted_at)
                VALUES ($1, $2, 'processing', CURRENT_TIMESTAMP)
                ON CONFLICT (user_id) 
                DO UPDATE SET 
                    extraction_status = 'processing',
                    extraction_attempted_at = CURRENT_TIMESTAMP,
                    extraction_retry_count = linkedin_profiles.extraction_retry_count + 1
                RETURNING id
            `, [userId, profileUrl]);
            
            return result.rows[0].id;

        } catch (error) {
            console.error('[DB] ❌ Error marking extraction started:', error);
            throw new Error(`Failed to mark extraction started: ${error.message}`);
        }
    }

    // Mark extraction as failed
    async markExtractionFailed(userId, errorMessage) {
        try {
            await this.pool.query(`
                UPDATE linkedin_profiles 
                SET extraction_status = 'failed',
                    extraction_error = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
            `, [userId, errorMessage]);

        } catch (error) {
            console.error('[DB] ❌ Error marking extraction failed:', error);
        }
    }

    // Search profiles
    async searchProfiles(criteria = {}) {
        try {
            let query = `
                SELECT id, name, current_position, current_company, headline, 
                       location, data_completeness, updated_at
                FROM linkedin_profiles 
                WHERE extraction_status = 'completed'
            `;
            const params = [];
            let paramCount = 0;

            if (criteria.name) {
                paramCount++;
                query += ` AND name ILIKE $${paramCount}`;
                params.push(`%${criteria.name}%`);
            }

            if (criteria.company) {
                paramCount++;
                query += ` AND current_company ILIKE $${paramCount}`;
                params.push(`%${criteria.company}%`);
            }

            if (criteria.position) {
                paramCount++;
                query += ` AND current_position ILIKE $${paramCount}`;
                params.push(`%${criteria.position}%`);
            }

            query += ` ORDER BY updated_at DESC LIMIT 50`;

            const result = await this.pool.query(query, params);
            return result.rows;

        } catch (error) {
            console.error('[DB] ❌ Error searching profiles:', error);
            return [];
        }
    }

    // Test database connection
    async testConnection() {
        try {
            const result = await this.pool.query('SELECT NOW()');
            console.log('[DB] ✅ Database connection successful');
            return true;
        } catch (error) {
            console.error('[DB] ❌ Database connection failed:', error);
            return false;
        }
    }
}

module.exports = DatabaseService;
