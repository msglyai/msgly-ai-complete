// Updated LinkedIn Routes - Compatible with New Services
// Works with enhanced brightDataService.js and databaseService.js

const express = require('express');
const router = express.Router();

// Import new services
const BrightDataService = require('../services/brightDataService');
const DatabaseService = require('../services/databaseService');

// Initialize services
const brightDataService = new BrightDataService();
const databaseService = new DatabaseService();

console.log('🔗 LinkedIn routes loaded with enhanced services');

/**
 * GET /api/linkedin-profile
 * API information and usage instructions
 */
router.get('/', (req, res) => {
    res.json({
        message: 'LinkedIn Profile Processing API',
        version: '2.0',
        description: 'Extract and analyze LinkedIn profiles using Bright Data',
        usage: {
            processProfile: {
                method: 'POST',
                endpoint: '/api/linkedin-profile',
                body: {
                    profileUrl: 'https://www.linkedin.com/in/example-profile'
                },
                description: 'Submit a LinkedIn profile URL for processing'
            },
            getProfile: {
                method: 'GET',
                endpoint: '/api/linkedin-profile/:id',
                description: 'Retrieve processed profile data by ID'
            },
            getStats: {
                method: 'GET',
                endpoint: '/api/linkedin-profile/status/stats',
                description: 'Get processing statistics and system status'
            }
        },
        examples: {
            curl: 'curl -X POST https://api.msgly.ai/api/linkedin-profile -H "Content-Type: application/json" -d \'{"profileUrl": "https://www.linkedin.com/in/example"}\'',
            javascript: `
fetch('https://api.msgly.ai/api/linkedin-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileUrl: 'https://www.linkedin.com/in/example' })
})
.then(response => response.json())
.then(data => console.log(data));`
        },
        brightData: {
            configured: !!process.env.BRIGHT_DATA_API_KEY,
            datasetId: process.env.BRIGHT_DATA_DATASET_ID,
            collectorId: process.env.BRIGHT_DATA_COLLECTOR_ID
        },
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/linkedin-profile
 * Main endpoint for processing LinkedIn profile URLs
 */
router.post('/', async (req, res) => {
    try {
        console.log('[LDI] 🚀 LinkedIn profile processing request received');
        
        const { profileUrl } = req.body;
        
        // Validate input
        if (!profileUrl) {
            console.log('[LDI] ❌ Missing profileUrl in request');
            return res.status(400).json({
                success: false,
                error: 'profileUrl is required',
                example: { profileUrl: 'https://www.linkedin.com/in/example' }
            });
        }

        // Validate LinkedIn URL format
        if (!profileUrl.includes('linkedin.com/in/')) {
            console.log('[LDI] ❌ Invalid LinkedIn URL format:', profileUrl);
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn URL. Must be a linkedin.com/in/ profile URL',
                provided: profileUrl,
                example: 'https://www.linkedin.com/in/example'
            });
        }

        console.log('[LDI] 📋 Processing LinkedIn URL:', profileUrl);
        
        // Get user ID (if authenticated) or use anonymous processing
        let userId = null;
        if (req.user && req.user.userId) {
            userId = req.user.userId;
            console.log('[LDI] 👤 Authenticated user:', userId);
            
            // Mark extraction as started in database
            try {
                await databaseService.markExtractionStarted(userId, profileUrl);
                console.log('[LDI] 📝 Extraction marked as started in database');
            } catch (dbError) {
                console.log('[LDI] ⚠️ Could not mark extraction started:', dbError.message);
                // Continue anyway - don't fail the request
            }
        } else {
            console.log('[LDI] 🔓 Anonymous processing (no authentication)');
        }

        // Extract LinkedIn profile using Bright Data
        console.log('[LDI] 🔄 Starting Bright Data extraction...');
        const extractedProfile = await brightDataService.extractLinkedInProfile(profileUrl);
        
        console.log('[LDI] ✅ Bright Data extraction completed');
        console.log('[LDI] 📊 Extracted data summary:', {
            name: extractedProfile.name || 'Not found',
            currentPosition: extractedProfile.current_position || 'Not found',
            currentCompany: extractedProfile.current_company || 'Not found',
            experienceCount: extractedProfile.experience?.length || 0,
            educationCount: extractedProfile.education?.length || 0,
            skillsCount: extractedProfile.skills?.length || 0,
            completeness: extractedProfile.data_completeness || 0
        });

        // Save to database if user is authenticated
        let savedResult = null;
        if (userId) {
            try {
                console.log('[LDI] 💾 Saving profile to database...');
                savedResult = await databaseService.saveLinkedInProfile(userId, extractedProfile);
                console.log('[LDI] ✅ Profile saved to database successfully');
            } catch (saveError) {
                console.error('[LDI] ❌ Failed to save to database:', saveError.message);
                
                // Mark extraction as failed
                try {
                    await databaseService.markExtractionFailed(userId, saveError.message);
                } catch (markError) {
                    console.error('[LDI] ❌ Failed to mark extraction as failed:', markError.message);
                }
                
                // Return the extracted data anyway, with a warning about database save
                return res.status(200).json({
                    success: true,
                    warning: 'Profile extracted successfully but failed to save to database',
                    profile: extractedProfile,
                    databaseError: saveError.message,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Return successful response
        const response = {
            success: true,
            message: 'LinkedIn profile extracted successfully',
            profile: {
                name: extractedProfile.name,
                headline: extractedProfile.headline,
                currentPosition: extractedProfile.current_position,
                currentCompany: extractedProfile.current_company,
                location: extractedProfile.location,
                connectionsCount: extractedProfile.connections_count,
                experienceCount: extractedProfile.experience?.length || 0,
                educationCount: extractedProfile.education?.length || 0,
                skillsCount: extractedProfile.skills?.length || 0,
                certificationsCount: extractedProfile.certifications?.length || 0,
                awardsCount: extractedProfile.honors_awards?.length || 0,
                dataCompleteness: extractedProfile.data_completeness || 0
            },
            extraction: {
                timestamp: extractedProfile.extraction_timestamp,
                method: 'bright_data_api',
                status: 'completed'
            },
            timestamp: new Date().toISOString()
        };

        // Add database info if saved
        if (savedResult) {
            response.database = {
                saved: true,
                profileId: savedResult.profileId,
                message: savedResult.message
            };
        } else {
            response.database = {
                saved: false,
                reason: 'No authentication provided - profile not saved'
            };
        }

        console.log('[LDI] 🎉 LinkedIn profile processing completed successfully');
        res.json(response);

    } catch (error) {
        console.error('[LDI] ❌ LinkedIn profile processing failed:', error.message);
        console.error('[LDI] 🔍 Error stack:', error.stack);

        // Mark extraction as failed in database if user is authenticated
        if (req.user && req.user.userId) {
            try {
                await databaseService.markExtractionFailed(req.user.userId, error.message);
                console.log('[LDI] 📝 Extraction marked as failed in database');
            } catch (markError) {
                console.error('[LDI] ❌ Failed to mark extraction as failed:', markError.message);
            }
        }

        // Determine error type and status code
        let statusCode = 500;
        let errorType = 'server_error';

        if (error.message.includes('LinkedIn URL')) {
            statusCode = 400;
            errorType = 'invalid_url';
        } else if (error.message.includes('timeout')) {
            statusCode = 408;
            errorType = 'extraction_timeout';
        } else if (error.message.includes('Bright Data')) {
            statusCode = 503;
            errorType = 'extraction_service_error';
        }

        res.status(statusCode).json({
            success: false,
            error: error.message,
            errorType,
            timestamp: new Date().toISOString(),
            support: {
                message: 'If this error persists, please contact support',
                email: 'support@msgly.ai'
            }
        });
    }
});

/**
 * GET /api/linkedin-profile/:id
 * Get profile by ID (for authenticated users)
 */
router.get('/:id', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        
        if (!profileId || isNaN(profileId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid profile ID. Must be a number.',
                provided: req.params.id
            });
        }

        // For now, return a placeholder - would need to implement getProfileById in database service
        res.status(501).json({
            success: false,
            error: 'Get profile by ID not yet implemented',
            message: 'This endpoint will be available in a future update',
            alternativeEndpoint: '/api/linkedin-profile/status/stats'
        });

    } catch (error) {
        console.error('[LDI] ❌ Get profile by ID failed:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve profile',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/linkedin-profile/status/stats
 * Get processing statistics and system status
 */
router.get('/status/stats', async (req, res) => {
    try {
        console.log('[LDI] 📊 Stats request received');

        // Get database statistics
        const dbStats = await databaseService.getLinkedInStats();
        
        // Get service statistics
        const brightDataStats = await brightDataService.getStats();

        // Calculate success rate
        const successRate = dbStats.totalProfiles > 0 
            ? Math.round((dbStats.completed / dbStats.totalProfiles) * 100) 
            : 0;

        // Calculate average processing time (placeholder - would need actual timing data)
        const avgProcessingTimeSeconds = dbStats.completed > 0 ? 45 : null;

        const stats = {
            success: true,
            stats: {
                totalProfiles: dbStats.totalProfiles,
                completed: dbStats.completed,
                processing: dbStats.processing,
                pending: dbStats.pending,
                failed: dbStats.failed,
                successRate: successRate,
                avgProcessingTimeSeconds: avgProcessingTimeSeconds,
                averageCompleteness: dbStats.averageCompleteness
            },
            dataBreakdown: dbStats.dataBreakdown,
            service: {
                brightDataConfigured: brightDataStats.bright_data_configured,
                databaseConnected: true,
                environment: process.env.NODE_ENV || 'development',
                version: '2.0',
                features: brightDataStats.features
            },
            timestamp: new Date().toISOString()
        };

        console.log('[LDI] ✅ Stats generated successfully:', {
            totalProfiles: stats.stats.totalProfiles,
            completed: stats.stats.completed,
            successRate: stats.stats.successRate + '%'
        });

        res.json(stats);

    } catch (error) {
        console.error('[LDI] ❌ Stats generation failed:', error.message);
        
        // Return basic stats even if database query fails
        res.status(200).json({
            success: true,
            stats: {
                totalProfiles: 0,
                completed: 0,
                processing: 0,
                pending: 0,
                failed: 0,
                successRate: 0,
                avgProcessingTimeSeconds: null,
                averageCompleteness: 0
            },
            service: {
                brightDataConfigured: !!process.env.BRIGHT_DATA_API_KEY,
                databaseConnected: false,
                environment: process.env.NODE_ENV || 'development',
                version: '2.0',
                error: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
});

console.log('🎯 LinkedIn API endpoints configured:');
console.log('   📄 GET  /api/linkedin-profile - API documentation');
console.log('   🚀 POST /api/linkedin-profile - Process LinkedIn URLs');
console.log('   👤 GET  /api/linkedin-profile/:id - Get profile by ID');
console.log('   📊 GET  /api/linkedin-profile/status/stats - Statistics');

module.exports = router;
