// LinkedIn Profile Processing Routes
// Handles profile URL submission and coordinates Bright Data extraction with database storage

const express = require('express');
const router = express.Router();

// Import our services
const { fetchLinkedInProfile } = require('../brightDataService');
const { 
    saveLinkedInProfile, 
    getLinkedInProfileByUrl, 
    updateExtractionStatus, 
    createInitialProfile,
    getDatabaseStats
} = require('../databaseService');

console.log('[LINKEDIN_ROUTES] LinkedIn routes module loaded');

/**
 * Validate LinkedIn profile URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid LinkedIn profile URL
 */
const isValidLinkedInUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    return url.includes('linkedin.com/in/') && url.startsWith('http');
};

/**
 * Clean LinkedIn URL (remove query params, trailing slashes)
 * @param {string} url - Raw URL
 * @returns {string} - Cleaned URL
 */
const cleanLinkedInUrl = (url) => {
    let cleanUrl = url.trim();
    if (cleanUrl.includes('?')) {
        cleanUrl = cleanUrl.split('?')[0];
    }
    if (cleanUrl.endsWith('/')) {
        cleanUrl = cleanUrl.slice(0, -1);
    }
    return cleanUrl;
};

/**
 * POST /api/linkedin-profile
 * Main endpoint for processing LinkedIn profile URLs
 */
router.post('/', async (req, res) => {
    const startTime = Date.now();
    const { profileUrl } = req.body;
    
    console.log(`[LDI] Received profileUrl: ${profileUrl}`);
    console.log(`[LDI] Request timestamp: ${new Date().toISOString()}`);
    console.log(`[LDI] Request headers:`, {
        userAgent: req.headers['user-agent'],
        contentType: req.headers['content-type'],
        origin: req.headers.origin
    });
    
    // Input validation
    if (!profileUrl) {
        console.log('[LDI] Error: No profile URL provided');
        return res.status(400).json({
            success: false,
            error: 'Profile URL is required',
            code: 'MISSING_URL'
        });
    }
    
    if (!isValidLinkedInUrl(profileUrl)) {
        console.log(`[LDI] Error: Invalid LinkedIn URL format: ${profileUrl}`);
        return res.status(400).json({
            success: false,
            error: 'Invalid LinkedIn profile URL. Must be a valid LinkedIn profile link.',
            code: 'INVALID_URL',
            receivedUrl: profileUrl
        });
    }
    
    const cleanUrl = cleanLinkedInUrl(profileUrl);
    console.log(`[LDI] Cleaned URL: ${cleanUrl}`);
    
    try {
        // Step 1: Create initial database record
        console.log('[LDI] Creating initial database record...');
        const initialRecord = await createInitialProfile(cleanUrl);
        console.log(`[LDI] Initial record created with ID: ${initialRecord.id}`);
        
        // Step 2: Check if we already have recent data for this profile
        const existingProfile = await getLinkedInProfileByUrl(cleanUrl);
        if (existingProfile && existingProfile.extraction_status === 'completed') {
            const daysSinceExtraction = (Date.now() - new Date(existingProfile.updated_at).getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysSinceExtraction < 7) {
                console.log(`[LDI] Using existing data (${Math.round(daysSinceExtraction)} days old)`);
                const processingTime = Date.now() - startTime;
                
                return res.status(200).json({
                    success: true,
                    id: existingProfile.id,
                    profileUrl: cleanUrl,
                    status: 'completed',
                    source: 'existing_data',
                    data: {
                        fullName: existingProfile.full_name,
                        headline: existingProfile.headline,
                        currentCompany: existingProfile.current_company,
                        location: existingProfile.location,
                        connectionsCount: existingProfile.connections_count,
                        lastUpdated: existingProfile.updated_at
                    },
                    processingTimeMs: processingTime,
                    message: 'Profile data retrieved from recent extraction'
                });
            }
        }
        
        // Step 3: Update status to processing
        console.log('[LDI] Updating status to processing...');
        await updateExtractionStatus(cleanUrl, 'processing');
        
        // Step 4: Fetch from Bright Data
        console.log('[LDI] Starting Bright Data extraction...');
        const brightDataResult = await fetchLinkedInProfile(cleanUrl);
        
        if (!brightDataResult.success) {
            throw new Error('Bright Data extraction failed');
        }
        
        console.log(`[LDI] Bright Data extraction successful via ${brightDataResult.method} method`);
        console.log(`[LDI] Profile: ${brightDataResult.data.fullName} at ${brightDataResult.data.currentCompany}`);
        
        // Step 5: Save to database
        console.log('[LDI] Saving extracted data to database...');
        const profileData = {
            ...brightDataResult.data,
            profileUrl: cleanUrl,
            method: brightDataResult.method,
            snapshotId: brightDataResult.snapshotId
        };
        
        const savedRecord = await saveLinkedInProfile(profileData);
        console.log(`[LDI] Data saved successfully with ID: ${savedRecord.id}`);
        
        // Step 6: Calculate processing time and send response
        const processingTime = Date.now() - startTime;
        console.log(`[LDI] Response sent with ID: ${savedRecord.id}`);
        console.log(`[LDI] Total processing time: ${processingTime}ms`);
        
        res.status(200).json({
            success: true,
            id: savedRecord.id,
            profileUrl: cleanUrl,
            status: 'completed',
            method: brightDataResult.method,
            snapshotId: brightDataResult.snapshotId,
            data: {
                fullName: brightDataResult.data.fullName,
                headline: brightDataResult.data.headline,
                currentCompany: brightDataResult.data.currentCompany,
                location: brightDataResult.data.location,
                connectionsCount: brightDataResult.data.connectionsCount,
                experienceCount: brightDataResult.data.experience?.length || 0,
                educationCount: brightDataResult.data.education?.length || 0,
                skillsCount: brightDataResult.data.skills?.length || 0,
                certificationsCount: brightDataResult.data.certifications?.length || 0
            },
            processingTimeMs: processingTime,
            extractedAt: new Date().toISOString(),
            message: 'LinkedIn profile extracted and saved successfully'
        });
        
    } catch (error) {
        console.error('[LDI] Processing error:', error.message);
        console.error('[LDI] Error stack:', error.stack);
        
        // Update database with error status
        try {
            await updateExtractionStatus(cleanUrl, 'failed', error.message);
            console.log('[LDI] Error status saved to database');
        } catch (dbError) {
            console.error('[LDI] Failed to save error status:', dbError.message);
        }
        
        const processingTime = Date.now() - startTime;
        
        // Determine appropriate error response
        let statusCode = 500;
        let errorCode = 'PROCESSING_ERROR';
        
        if (error.message.includes('Invalid LinkedIn URL')) {
            statusCode = 400;
            errorCode = 'INVALID_URL';
        } else if (error.message.includes('timeout')) {
            statusCode = 408;
            errorCode = 'TIMEOUT';
        } else if (error.message.includes('rate limit')) {
            statusCode = 429;
            errorCode = 'RATE_LIMITED';
        }
        
        res.status(statusCode).json({
            success: false,
            error: 'Failed to process LinkedIn profile',
            details: error.message,
            code: errorCode,
            profileUrl: cleanUrl,
            processingTimeMs: processingTime,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/linkedin-profile/:id
 * Get a specific profile by ID
 */
router.get('/:id', async (req, res) => {
    const profileId = req.params.id;
    console.log(`[LDI] Getting profile by ID: ${profileId}`);
    
    try {
        const query = 'SELECT * FROM linkedin_profiles WHERE id = $1';
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        });
        
        const result = await pool.query(query, [profileId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found',
                code: 'NOT_FOUND'
            });
        }
        
        const profile = result.rows[0];
        console.log(`[LDI] Profile found: ${profile.full_name}`);
        
        res.json({
            success: true,
            data: {
                id: profile.id,
                profileUrl: profile.profile_url,
                fullName: profile.full_name,
                headline: profile.headline,
                currentCompany: profile.current_company,
                location: profile.location,
                connectionsCount: profile.connections_count,
                followersCount: profile.followers_count,
                experience: profile.experience,
                education: profile.education,
                skills: profile.skills,
                certifications: profile.certifications,
                extractionStatus: profile.extraction_status,
                extractedAt: profile.extraction_completed_at,
                createdAt: profile.created_at
            }
        });
        
    } catch (error) {
        console.error('[LDI] Profile lookup error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve profile',
            details: error.message
        });
    }
});

/**
 * GET /api/linkedin-profile/status/stats
 * Get database statistics and processing status
 */
router.get('/status/stats', async (req, res) => {
    console.log('[LDI] Getting database statistics...');
    
    try {
        const stats = await getDatabaseStats();
        
        console.log('[LDI] Statistics retrieved successfully');
        
        res.json({
            success: true,
            stats: {
                totalProfiles: stats.totalProfiles,
                completed: stats.completed,
                pending: stats.pending,
                processing: stats.processing,
                failed: stats.failed,
                avgProcessingTimeSeconds: stats.avgProcessingTimeSeconds,
                successRate: stats.totalProfiles > 0 ? 
                    Math.round((stats.completed / stats.totalProfiles) * 100) : 0
            },
            timestamp: new Date().toISOString(),
            service: {
                brightDataConfigured: !!process.env.BRIGHT_DATA_API_KEY,
                databaseConnected: true,
                environment: process.env.NODE_ENV || 'development'
            }
        });
        
    } catch (error) {
        console.error('[LDI] Stats error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve statistics',
            details: error.message
        });
    }
});

/**
 * POST /api/linkedin-profile/retry/:id
 * Retry failed extractions
 */
router.post('/retry/:id', async (req, res) => {
    const profileId = req.params.id;
    console.log(`[LDI] Retrying extraction for profile ID: ${profileId}`);
    
    try {
        // Get the profile URL
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        });
        
        const result = await pool.query('SELECT profile_url FROM linkedin_profiles WHERE id = $1', [profileId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found',
                code: 'NOT_FOUND'
            });
        }
        
        const profileUrl = result.rows[0].profile_url;
        
        // Redirect to main processing endpoint
        req.body = { profileUrl };
        return router.handle({ ...req, method: 'POST', url: '/' }, res);
        
    } catch (error) {
        console.error('[LDI] Retry error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to retry extraction',
            details: error.message
        });
    }
});

console.log('[LINKEDIN_ROUTES] Routes configured:');
console.log('  POST /api/linkedin-profile - Main processing endpoint');
console.log('  GET /api/linkedin-profile/:id - Get profile by ID');
console.log('  GET /api/linkedin-profile/status/stats - Get statistics');
console.log('  POST /api/linkedin-profile/retry/:id - Retry failed extraction');

module.exports = router;
