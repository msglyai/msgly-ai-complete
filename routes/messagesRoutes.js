// routes/messagesRoutes.js
// Messages Routes - GPT-5 powered message generation endpoints + Messages CRUD + Email Finder

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const {
    handleGenerateMessage,
    handleGenerateConnection,
    handleGenerateIntro,
    handleGenerateColdEmail  // EXISTING: Keep cold email functionality
} = require('../controllers/messagesController');

// NEW: Import database and logger for CRUD operations
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// Import real Snov.io email finder integration
const { findEmailForProfile, isEmailFinderEnabled } = require('../emailFinder');

// EXISTING: Message generation routes (unchanged)
router.post('/generate-message', authenticateToken, handleGenerateMessage);
router.post('/generate-connection', authenticateToken, handleGenerateConnection);
router.post('/generate-intro', authenticateToken, handleGenerateIntro);
router.post('/generate-cold-email', authenticateToken, handleGenerateColdEmail); // EXISTING: Keep this

// ==================== NEW: MESSAGES CRUD ENDPOINTS ====================

// GET /messages/history - Get messages for user (FIXED: includes message_type field)
router.get('/messages/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ml.id,
                ml.target_first_name as "targetProfile.firstName",
                ml.target_title as "targetProfile.role", 
                ml.target_company as "targetProfile.company",
                ml.generated_message as message,
                ml.message_type,
                ml.context_text as context,
                ml.created_at,
                -- FIXED: Read actual database values instead of hardcoded 'pending'
                COALESCE(ml.sent_status, 'pending') as sent,
                COALESCE(ml.reply_status, 'pending') as "gotReply",
                COALESCE(ml.comments, '') as comments,
                ml.sent_date,
                ml.reply_date
            FROM message_logs ml 
            WHERE ml.user_id = $1 
            ORDER BY ml.created_at DESC
        `, [req.user.id]);

        const messages = result.rows.map(row => ({
            id: row.id,
            targetProfile: {
                firstName: row["targetProfile.firstName"] || 'Unknown',
                role: row["targetProfile.role"] || 'Professional', 
                company: row["targetProfile.company"] || 'Company'
            },
            message: row.message || '',
            message_type: row.message_type,
            context: row.context || 'No context available',
            sent: row.sent,
            gotReply: row.gotReply,
            comments: row.comments,
            createdAt: row.created_at,
            sentDate: row.sent_date,
            replyDate: row.reply_date
        }));

        res.json({
            success: true,
            data: messages
        });
    } catch (error) {
        logger.error('Messages history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load messages'
        });
    }
});

// PUT /messages/:id - Update message status and comments (FIXED: SQL type casting)
router.put('/messages/:id', authenticateToken, async (req, res) => {
    try {
        const messageId = parseInt(req.params.id);
        const { sent_status, reply_status, comments } = req.body;
        const userId = req.user.id;
        
        // Validate message belongs to user
        const checkResult = await pool.query(
            'SELECT id FROM message_logs WHERE id = $1 AND user_id = $2',
            [messageId, userId]
        );
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }
        
        // FIXED: Update message with explicit type casting to avoid PostgreSQL type inference errors
        const result = await pool.query(`
            UPDATE message_logs 
            SET 
                sent_status = $1::varchar,
                reply_status = $2::varchar, 
                comments = $3::text,
                sent_date = CASE WHEN $1::varchar = 'yes' AND sent_date IS NULL THEN NOW() ELSE sent_date END,
                reply_date = CASE WHEN $2::varchar = 'yes' AND reply_date IS NULL THEN NOW() ELSE reply_date END
            WHERE id = $4 AND user_id = $5
            RETURNING *
        `, [sent_status, reply_status, comments, messageId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Update failed'
            });
        }
        
        logger.success(`Message ${messageId} updated successfully for user ${userId}`);
        
        res.json({
            success: true,
            message: 'Message updated successfully',
            data: result.rows[0]
        });
        
    } catch (error) {
        logger.error('Update message error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update message'
        });
    }
});

// ==================== EMAIL FINDER ENDPOINT ====================

// POST /api/ask-email - Find and verify email using real Snov.io API (Silver+ plans only)
router.post('/api/ask-email', authenticateToken, async (req, res) => {
    try {
        logger.custom('EMAIL', '=== REAL SNOV.IO EMAIL FINDER REQUEST ===');
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`User Plan: ${req.user.package_type}`);
        logger.info(`Target Profile ID: ${req.body.targetProfileId}`);
        
        const { targetProfileId } = req.body;
        
        if (!targetProfileId) {
            return res.status(400).json({
                success: false,
                error: 'targetProfileId is required'
            });
        }
        
        // Check if user has Silver+ plan for email finder access
        const allowedPlans = ['silver-monthly', 'gold-monthly', 'platinum-monthly', 'silver-payg', 'gold-payg', 'platinum-payg'];
        const userPlan = req.user.package_type?.toLowerCase();
        
        if (!allowedPlans.includes(userPlan)) {
            logger.warn(`Email finder access denied for user ${req.user.id} with plan: ${userPlan}`);
            return res.status(403).json({
                success: false,
                error: 'plan_upgrade_required',
                message: 'Email finder feature requires Silver plan or higher',
                userMessage: 'Upgrade to Silver, Gold, or Platinum to access email finder',
                currentPlan: req.user.package_type,
                requiredPlans: ['Silver', 'Gold', 'Platinum'],
                upgradeUrl: '/upgrade'
            });
        }
        
        // Check if email finder is enabled and configured
        if (!isEmailFinderEnabled()) {
            return res.status(503).json({
                success: false,
                error: 'email_finder_disabled',
                message: 'Email finder feature is currently disabled or not configured'
            });
        }
        
        // Call real Snov.io email finder service
        const result = await findEmailForProfile(req.user.id, targetProfileId);
        
        logger.custom('EMAIL', `Real Snov.io result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        
        if (result.success) {
            logger.success(`Email found via Snov.io: ${result.email}, Credits charged: ${result.creditsCharged}`);
        } else {
            logger.info(`Snov.io email finder failed: ${result.error}, Credits charged: ${result.creditsCharged || 0}`);
        }
        
        res.json(result);
        
    } catch (error) {
        logger.error('Real Snov.io email finder endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Email finder temporarily unavailable'
        });
    }
});

module.exports = router;
