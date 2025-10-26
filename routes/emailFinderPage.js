// routes/emailFinderPage.js - Email Finder Page Routes
// Purpose: Backend API for email-finder.html page
// Features: LinkedIn URL based email finding with full profile data
// Database: Saves to email_finder_searches table
// Version: 2.0.0 - Using emailFinderForPage.js with v2 API

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// Import the URL-based email finder (v2 API with full profile data)
const { findEmailForPage, isEmailFinderForPageEnabled } = require('../urlEmailFinder');

// Health check endpoint
router.get('/health', authenticateToken, async (req, res) => {
    try {
        const enabled = isEmailFinderForPageEnabled();
        res.json({
            success: true,
            service: 'email_finder_page',
            enabled: enabled,
            apiVersion: 'v2 - LinkedIn Profile Enrichment'
        });
    } catch (error) {
        logger.error('Health check error:', error);
        res.status(500).json({
            success: false,
            error: 'health_check_failed'
        });
    }
});

// Search for email + profile data by LinkedIn URL
router.post('/search', authenticateToken, async (req, res) => {
    try {
        const { linkedin_url } = req.body;
        const userId = req.user.id;

        logger.info(`[EMAIL_FINDER_PAGE_ROUTE] Search request - User: ${userId}, URL: ${linkedin_url}`);

        // Validate input
        if (!linkedin_url || !linkedin_url.includes('linkedin.com')) {
            return res.status(400).json({
                success: false,
                error: 'invalid_url',
                message: 'Please provide a valid LinkedIn profile URL'
            });
        }

        // Call the email finder for page (handles credits internally)
        const result = await findEmailForPage(userId, linkedin_url);

        // Return result
        if (result.success) {
            logger.success(`[EMAIL_FINDER_PAGE_ROUTE] ✅ Search successful`);
            return res.json(result);
        } else {
            // Search failed but not a server error (e.g., duplicate, no credits, not found)
            logger.warn(`[EMAIL_FINDER_PAGE_ROUTE] ⚠️ Search failed: ${result.error}`);
            
            // Return appropriate status code based on error type
            if (result.error === 'insufficient_credits') {
                return res.status(402).json(result); // Payment Required
            } else if (result.error === 'duplicate_search') {
                return res.status(409).json(result); // Conflict
            } else {
                return res.status(400).json(result); // Bad Request
            }
        }

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE_ROUTE] Error in search endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Server error occurred while searching'
        });
    }
});

// Get search history for current user
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { sort = 'recent_first', limit = 50 } = req.query;

        logger.info(`[EMAIL_FINDER_PAGE_ROUTE] Getting history - User: ${userId}, Sort: ${sort}`);

        // Determine sort order
        const orderBy = sort === 'oldest_first' ? 'searched_at ASC' : 'searched_at DESC';

        const result = await pool.query(`
            SELECT 
                id,
                linkedin_url,
                full_name,
                first_name,
                last_name,
                job_title,
                company,
                email,
                verification_status,
                searched_at
            FROM email_finder_searches
            WHERE user_id = $1
            ORDER BY ${orderBy}
            LIMIT $2
        `, [userId, limit]);

        logger.success(`[EMAIL_FINDER_PAGE_ROUTE] ✅ Retrieved ${result.rows.length} history records`);

        res.json({
            success: true,
            searches: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE_ROUTE] Error getting history:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to retrieve search history'
        });
    }
});

// Check if LinkedIn URL was already searched (duplicate check)
router.post('/check-duplicate', authenticateToken, async (req, res) => {
    try {
        const { linkedin_url } = req.body;
        const userId = req.user.id;

        if (!linkedin_url) {
            return res.status(400).json({
                success: false,
                error: 'invalid_url',
                message: 'LinkedIn URL is required'
            });
        }

        const result = await pool.query(`
            SELECT 
                id,
                full_name,
                email,
                verification_status,
                searched_at
            FROM email_finder_searches
            WHERE user_id = $1 AND linkedin_url = $2
            LIMIT 1
        `, [userId, linkedin_url]);

        if (result.rows.length > 0) {
            return res.json({
                success: true,
                isDuplicate: true,
                existingSearch: result.rows[0]
            });
        } else {
            return res.json({
                success: true,
                isDuplicate: false
            });
        }

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE_ROUTE] Error checking duplicate:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to check for duplicates'
        });
    }
});

// Delete a search from history
router.delete('/history/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const searchId = req.params.id;

        logger.info(`[EMAIL_FINDER_PAGE_ROUTE] Deleting search - User: ${userId}, Search ID: ${searchId}`);

        // Delete only if owned by user
        const result = await pool.query(`
            DELETE FROM email_finder_searches
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `, [searchId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'not_found',
                message: 'Search not found or access denied'
            });
        }

        logger.success(`[EMAIL_FINDER_PAGE_ROUTE] ✅ Search deleted: ${searchId}`);

        res.json({
            success: true,
            message: 'Search deleted successfully'
        });

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE_ROUTE] Error deleting search:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to delete search'
        });
    }
});

// Get statistics for user's searches
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_searches,
                COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as emails_found,
                COUNT(CASE WHEN verification_status = 'valid' THEN 1 END) as valid_emails,
                COUNT(CASE WHEN verification_status = 'unknown' THEN 1 END) as unknown_emails,
                COUNT(CASE WHEN verification_status = 'invalid' THEN 1 END) as invalid_emails,
                COUNT(CASE WHEN verification_status = 'not_found' THEN 1 END) as not_found
            FROM email_finder_searches
            WHERE user_id = $1
        `, [userId]);

        const stats = result.rows[0];

        res.json({
            success: true,
            stats: {
                totalSearches: parseInt(stats.total_searches),
                emailsFound: parseInt(stats.emails_found),
                validEmails: parseInt(stats.valid_emails),
                unknownEmails: parseInt(stats.unknown_emails),
                invalidEmails: parseInt(stats.invalid_emails),
                notFound: parseInt(stats.not_found),
                successRate: stats.total_searches > 0 
                    ? Math.round((stats.emails_found / stats.total_searches) * 100) 
                    : 0
            }
        });

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE_ROUTE] Error getting stats:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to retrieve statistics'
        });
    }
});

module.exports = router;
