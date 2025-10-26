// routes/emailFinderPage.js - Standalone Email Finder Page Routes
// Purpose: Backend API for email-finder.html page
// Features: LinkedIn URL based email finding with Snov.io integration
// Version: 1.0.0

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// Import existing email finder and verifier
const { findEmailWithLinkedInUrl, isEmailFinderEnabled } = require('../emailFinder');
const { verifyEmail } = require('../emailVerifier');

// Import credit system
const CreditManager = require('../credits');
const creditManager = new CreditManager();

// ==================== MIDDLEWARE ====================

// Check if user has correct plan (Silver+)
async function checkPlanAccess(req, res, next) {
    try {
        const result = await pool.query(
            'SELECT plan FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'user_not_found',
                message: 'User not found'
            });
        }

        const userPlan = result.rows[0].plan.toLowerCase();
        const allowedPlans = ['silver', 'gold', 'platinum'];

        if (!allowedPlans.includes(userPlan)) {
            return res.status(403).json({
                success: false,
                error: 'plan_required',
                message: 'Email Finder requires Silver plan or above',
                currentPlan: userPlan,
                requiredPlans: allowedPlans
            });
        }

        req.userPlan = userPlan;
        next();
    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE] Plan check error:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to check plan access'
        });
    }
}

// Check if user has enough credits
async function checkCreditAvailability(req, res, next) {
    try {
        const creditCheck = await creditManager.checkCredits(req.user.id, 'email_verification');

        if (!creditCheck.success) {
            return res.status(500).json({
                success: false,
                error: 'credit_check_failed',
                message: 'Failed to check credits'
            });
        }

        if (!creditCheck.hasCredits) {
            return res.status(403).json({
                success: false,
                error: 'insufficient_credits',
                message: 'Not enough credits',
                creditsNeeded: creditCheck.requiredCredits,
                creditsAvailable: creditCheck.currentCredits,
                renewableCredits: creditCheck.renewableCredits,
                payasyougoCredits: creditCheck.payasyougoCredits
            });
        }

        req.creditInfo = creditCheck;
        next();
    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE] Credit check error:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to check credits'
        });
    }
}

// ==================== API ENDPOINTS ====================

// GET /api/email-finder-page/check-duplicate - Check if URL was already searched
router.get('/check-duplicate', authenticateToken, checkPlanAccess, async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'missing_url',
                message: 'LinkedIn URL is required'
            });
        }

        // Normalize LinkedIn URL
        const normalizedUrl = url.trim().toLowerCase();

        // Check if this user already searched this URL
        const result = await pool.query(`
            SELECT 
                id,
                linkedin_url,
                full_name,
                job_title,
                company,
                email,
                verification_status,
                search_date,
                created_at
            FROM email_finder_searches
            WHERE user_id = $1 AND LOWER(TRIM(linkedin_url)) = $2
            ORDER BY search_date DESC
            LIMIT 1
        `, [req.user.id, normalizedUrl]);

        if (result.rows.length > 0) {
            const lastSearch = result.rows[0];
            return res.json({
                success: true,
                exists: true,
                lastSearch: {
                    id: lastSearch.id,
                    linkedinUrl: lastSearch.linkedin_url,
                    fullName: lastSearch.full_name,
                    jobTitle: lastSearch.job_title,
                    company: lastSearch.company,
                    email: lastSearch.email,
                    verificationStatus: lastSearch.verification_status,
                    searchDate: lastSearch.search_date,
                    createdAt: lastSearch.created_at
                }
            });
        }

        return res.json({
            success: true,
            exists: false
        });

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE] Check duplicate error:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to check for duplicates'
        });
    }
});

// POST /api/email-finder-page/search - Search for email by LinkedIn URL
router.post('/search', authenticateToken, checkPlanAccess, checkCreditAvailability, async (req, res) => {
    try {
        const { linkedin_url } = req.body;

        if (!linkedin_url) {
            return res.status(400).json({
                success: false,
                error: 'missing_url',
                message: 'LinkedIn URL is required'
            });
        }

        logger.info(`[EMAIL_FINDER_PAGE] Starting email search for URL: ${linkedin_url}`);
        logger.info(`[EMAIL_FINDER_PAGE] User ID: ${req.user.id}, Plan: ${req.userPlan}`);

        // Step 1: Create credit hold
        const holdResult = await creditManager.createHold(
            req.user.id,
            'email_verification',
            {
                linkedin_url: linkedin_url,
                source: 'email_finder_page'
            }
        );

        if (!holdResult.success) {
            return res.status(403).json({
                success: false,
                error: holdResult.error,
                message: holdResult.userMessage || 'Failed to hold credits'
            });
        }

        logger.info(`[EMAIL_FINDER_PAGE] Credit hold created: ${holdResult.holdId}`);

        try {
            // Step 2: Call email finder (existing service)
            const emailResult = await findEmailWithLinkedInUrl(linkedin_url, req.user.id);

            if (!emailResult.success) {
                // Release hold on failure
                await creditManager.releaseHold(req.user.id, holdResult.holdId);
                
                return res.status(400).json({
                    success: false,
                    error: 'email_finder_failed',
                    message: emailResult.error || 'Failed to find email',
                    details: emailResult
                });
            }

            logger.success(`[EMAIL_FINDER_PAGE] Email found: ${emailResult.email}`);

            // Step 3: Complete operation and deduct credits
            const completeResult = await creditManager.completeOperation(
                req.user.id,
                holdResult.holdId,
                {
                    email: emailResult.email,
                    firstName: emailResult.firstName,
                    lastName: emailResult.lastName,
                    success: true
                }
            );

            if (!completeResult.success) {
                logger.error('[EMAIL_FINDER_PAGE] Failed to complete credit deduction:', completeResult.error);
                // Continue anyway - email was found
            }

            // Step 4: Save to email_finder_searches table
            const saveResult = await pool.query(`
                INSERT INTO email_finder_searches (
                    user_id,
                    linkedin_url,
                    full_name,
                    first_name,
                    last_name,
                    job_title,
                    company,
                    email,
                    verification_status,
                    search_date,
                    credits_used
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 2)
                RETURNING id, search_date
            `, [
                req.user.id,
                linkedin_url,
                emailResult.fullName || `${emailResult.firstName || ''} ${emailResult.lastName || ''}`.trim(),
                emailResult.firstName,
                emailResult.lastName,
                emailResult.position || emailResult.jobTitle,
                emailResult.company,
                emailResult.email,
                'pending' // Will be updated by emailVerifier.js automatically
            ]);

            const searchId = saveResult.rows[0].id;
            const searchDate = saveResult.rows[0].search_date;

            logger.success(`[EMAIL_FINDER_PAGE] Search saved to database: ID ${searchId}`);

            // Step 5: Get updated credit balance
            const creditsResult = await pool.query(`
                SELECT 
                    COALESCE(renewable_credits, 0) + COALESCE(payasyougo_credits, 0) as total_credits
                FROM users
                WHERE id = $1
            `, [req.user.id]);

            const creditsRemaining = parseFloat(creditsResult.rows[0]?.total_credits || 0);

            // Step 6: Email verification will be triggered automatically by emailVerifier.js
            // We'll update the verification status asynchronously

            // Return success response
            return res.json({
                success: true,
                data: {
                    id: searchId,
                    linkedinUrl: linkedin_url,
                    fullName: emailResult.fullName || `${emailResult.firstName || ''} ${emailResult.lastName || ''}`.trim(),
                    firstName: emailResult.firstName,
                    lastName: emailResult.lastName,
                    jobTitle: emailResult.position || emailResult.jobTitle,
                    company: emailResult.company,
                    email: emailResult.email,
                    verificationStatus: 'pending', // Will be updated by emailVerifier.js
                    searchDate: searchDate
                },
                creditsUsed: 2,
                creditsRemaining: creditsRemaining
            });

        } catch (error) {
            // Release hold on error
            await creditManager.releaseHold(req.user.id, holdResult.holdId);
            throw error;
        }

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE] Search error:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to search for email',
            details: error.message
        });
    }
});

// GET /api/email-finder-page/history - Get search history for user
router.get('/history', authenticateToken, checkPlanAccess, async (req, res) => {
    try {
        const { sort = 'recent_first' } = req.query;

        // Determine sort order
        let orderByClause = 'search_date DESC'; // Default: most recent first

        switch (sort) {
            case 'oldest_first':
                orderByClause = 'search_date ASC';
                break;
            case 'name_az':
                orderByClause = 'full_name ASC NULLS LAST';
                break;
            case 'name_za':
                orderByClause = 'full_name DESC NULLS LAST';
                break;
            case 'company_az':
                orderByClause = 'company ASC NULLS LAST';
                break;
            case 'company_za':
                orderByClause = 'company DESC NULLS LAST';
                break;
            case 'verified_first':
                orderByClause = "CASE WHEN verification_status = 'valid' THEN 0 WHEN verification_status = 'not_valid' THEN 2 ELSE 1 END, search_date DESC";
                break;
            case 'unverified_first':
                orderByClause = "CASE WHEN verification_status = 'not_valid' THEN 0 WHEN verification_status = 'valid' THEN 2 ELSE 1 END, search_date DESC";
                break;
            default:
                orderByClause = 'search_date DESC';
        }

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
                verification_reason,
                search_date,
                credits_used,
                created_at
            FROM email_finder_searches
            WHERE user_id = $1
            ORDER BY ${orderByClause}
        `, [req.user.id]);

        const searches = result.rows.map(row => ({
            id: row.id,
            linkedinUrl: row.linkedin_url,
            fullName: row.full_name,
            firstName: row.first_name,
            lastName: row.last_name,
            jobTitle: row.job_title,
            company: row.company,
            email: row.email,
            verificationStatus: row.verification_status,
            verificationReason: row.verification_reason,
            searchDate: row.search_date,
            creditsUsed: row.credits_used,
            createdAt: row.created_at
        }));

        return res.json({
            success: true,
            count: searches.length,
            searches: searches,
            sort: sort
        });

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE] History error:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to load search history'
        });
    }
});

// GET /api/email-finder-page/stats - Get statistics for user
router.get('/stats', authenticateToken, checkPlanAccess, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_searches,
                COUNT(CASE WHEN verification_status = 'valid' THEN 1 END) as verified_count,
                COUNT(CASE WHEN verification_status = 'not_valid' THEN 1 END) as invalid_count,
                COUNT(CASE WHEN verification_status = 'unknown' THEN 1 END) as unknown_count,
                SUM(credits_used) as total_credits_used
            FROM email_finder_searches
            WHERE user_id = $1
        `, [req.user.id]);

        const stats = result.rows[0];

        return res.json({
            success: true,
            stats: {
                totalSearches: parseInt(stats.total_searches) || 0,
                verifiedCount: parseInt(stats.verified_count) || 0,
                invalidCount: parseInt(stats.invalid_count) || 0,
                unknownCount: parseInt(stats.unknown_count) || 0,
                totalCreditsUsed: parseFloat(stats.total_credits_used) || 0
            }
        });

    } catch (error) {
        logger.error('[EMAIL_FINDER_PAGE] Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Failed to load statistics'
        });
    }
});

module.exports = router;

logger.success('Email Finder Page routes loaded!');
