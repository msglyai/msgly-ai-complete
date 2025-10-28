// routes/messagesRoutes.js - FIXED: Email visibility per user (email_requests table)
// Messages Routes - GPT-5 powered message generation endpoints + Messages CRUD + Email Finder
// Version: 1.2.0 - FIXED: Email visibility filtered by user requests (only show if user asked)

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

// Import email finder integration
const { findEmailWithLinkedInUrl, isEmailFinderEnabled } = require('../emailFinder');

// EXISTING: Message generation routes (unchanged)
router.post('/generate-message', authenticateToken, handleGenerateMessage);
router.post('/generate-connection', authenticateToken, handleGenerateConnection);
router.post('/generate-intro', authenticateToken, handleGenerateIntro);
router.post('/generate-cold-email', authenticateToken, handleGenerateColdEmail); // EXISTING: Keep this

// ==================== NEW: MESSAGES CRUD ENDPOINTS ====================

// GET /messages/history - Get messages for user (FIXED: JOIN with target_profiles for email data)
router.get('/messages/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ml.id,
                ml.target_first_name as "targetProfile.firstName",
                ml.target_title as "targetProfile.role", 
                ml.target_company as "targetProfile.company",
                ml.generated_message as message,
                ml.edited_message,
                ml.edited_at,
                ml.edit_count,
                ml.message_type,
                ml.context_text as context,
                ml.created_at,
                -- FIXED: Read actual database values instead of hardcoded 'pending'
                COALESCE(ml.sent_status, 'pending') as sent,
                COALESCE(ml.reply_status, 'pending') as "gotReply",
                COALESCE(ml.comments, '') as comments,
                ml.sent_date,
                ml.reply_date,
                ml.target_profile_url as linkedinUrl,
                -- FIXED: Only show email if THIS user requested it
                CASE 
                    WHEN er.user_id IS NOT NULL THEN tp.email_found
                    ELSE NULL
                END as email_found,
                CASE 
                    WHEN er.user_id IS NOT NULL THEN tp.email_status
                    ELSE NULL
                END as email_status,
                CASE 
                    WHEN er.user_id IS NOT NULL THEN tp.email_verified_at
                    ELSE NULL
                END as email_verified_at
            FROM message_logs ml 
            LEFT JOIN target_profiles tp ON tp.linkedin_url = ml.target_profile_url
            LEFT JOIN email_requests er ON er.linkedin_url = ml.target_profile_url AND er.user_id = ml.user_id
            WHERE ml.user_id = $1 
            ORDER BY ml.created_at DESC
        `, [req.user.id]);

        const messages = result.rows.map(row => ({
            id: row.id,
            targetProfile: {
                firstName: row["targetProfile.firstName"] || 'Unknown',
                role: row["targetProfile.role"] || 'Professional', 
                company: row["targetProfile.company"] || 'Company',
                linkedinUrl: row.linkedinUrl
            },
            message: row.message || '',
            editedMessage: row.edited_message,
            editedAt: row.edited_at,
            editCount: row.edit_count || 0,
            message_type: row.message_type,
            context: row.context || 'No context available',
            sent: row.sent,
            gotReply: row.gotReply,
            comments: row.comments,
            createdAt: row.created_at,
            sentDate: row.sent_date,
            replyDate: row.reply_date,
            // FIXED: Include email data from target_profiles
            emailFound: row.email_found,
            emailStatus: row.email_status,
            emailVerifiedAt: row.email_verified_at
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

// PUT /messages/:id - Update message status and comments (EXACT ORIGINAL VERSION)
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

// PUT /messages/individual/:messageId - Update individual message status (NEW: For per-message toggles)
router.put('/messages/individual/:messageId', authenticateToken, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const { sent, got_reply } = req.body;
        const userId = req.user.id;
        
        logger.info(`[INDIVIDUAL_MESSAGE] Updating message ${messageId} for user ${userId}`);
        logger.info(`[INDIVIDUAL_MESSAGE] New status: sent=${sent}, got_reply=${got_reply}`);
        
        // Validate input
        const validStatuses = ['yes', 'no', 'pending'];
        if (sent && !validStatuses.includes(sent)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid sent status. Must be: yes, no, or pending' 
            });
        }
        if (got_reply && !validStatuses.includes(got_reply)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid got_reply status. Must be: yes, no, or pending' 
            });
        }
        
        // Verify message exists and belongs to user
        const checkResult = await pool.query(
            'SELECT id FROM message_logs WHERE id = $1 AND user_id = $2',
            [messageId, userId]
        );
        
        if (checkResult.rows.length === 0) {
            logger.warn(`[INDIVIDUAL_MESSAGE] Message ${messageId} not found for user ${userId}`);
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }
        
        // Build update query dynamically based on provided fields
        const updateFields = [];
        const updateValues = [];
        let paramCounter = 1;
        
        if (sent !== undefined) {
            updateFields.push(`sent_status = $${paramCounter}::varchar`);
            updateValues.push(sent);
            
            // Set sent_date if status is 'yes' and date is not set
            updateFields.push(`sent_date = CASE WHEN $${paramCounter}::varchar = 'yes' AND sent_date IS NULL THEN NOW() ELSE sent_date END`);
            paramCounter++;
        }
        
        if (got_reply !== undefined) {
            updateFields.push(`reply_status = $${paramCounter}::varchar`);
            updateValues.push(got_reply);
            
            // Set reply_date if status is 'yes' and date is not set
            updateFields.push(`reply_date = CASE WHEN $${paramCounter}::varchar = 'yes' AND reply_date IS NULL THEN NOW() ELSE reply_date END`);
            paramCounter++;
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No fields to update. Provide sent or got_reply.' 
            });
        }
        
        // Add WHERE clause parameters
        updateValues.push(messageId, userId);
        const messageIdParam = paramCounter;
        const userIdParam = paramCounter + 1;
        
        // Execute update
        const updateQuery = `
            UPDATE message_logs 
            SET ${updateFields.join(', ')}
            WHERE id = $${messageIdParam} AND user_id = $${userIdParam}
            RETURNING id, sent_status, reply_status, sent_date, reply_date
        `;
        
        const result = await pool.query(updateQuery, updateValues);
        
        if (result.rows.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Update failed'
            });
        }
        
        logger.success(`[INDIVIDUAL_MESSAGE] Successfully updated message ${messageId}`);
        
        res.json({
            success: true,
            message: result.rows[0]
        });
        
    } catch (error) {
        logger.error('[INDIVIDUAL_MESSAGE] Error updating message:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update message. Please try again.' 
        });
    }
});

// PUT /messages/individual/:messageId/edit - Edit message content (NEW: Saves to edited_message column)
router.put('/messages/individual/:messageId/edit', authenticateToken, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const { edited_message } = req.body;
        const userId = req.user.id;
        
        logger.info(`[EDIT_MESSAGE] Editing message ${messageId} for user ${userId}`);
        
        // Validate input
        if (!edited_message || typeof edited_message !== 'string') {
            return res.status(400).json({ 
                success: false, 
                error: 'edited_message is required and must be a string' 
            });
        }
        
        if (edited_message.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'edited_message cannot be empty' 
            });
        }
        
        // Verify message exists and belongs to user
        const checkResult = await pool.query(
            'SELECT id, generated_message, edit_count FROM message_logs WHERE id = $1 AND user_id = $2',
            [messageId, userId]
        );
        
        if (checkResult.rows.length === 0) {
            logger.warn(`[EDIT_MESSAGE] Message ${messageId} not found for user ${userId}`);
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }
        
        const currentEditCount = checkResult.rows[0].edit_count || 0;
        
        // Update message with edited content
        const result = await pool.query(`
            UPDATE message_logs 
            SET 
                edited_message = $1::text,
                edited_at = NOW(),
                edit_count = $2
            WHERE id = $3 AND user_id = $4
            RETURNING id, generated_message, edited_message, edited_at, edit_count
        `, [edited_message.trim(), currentEditCount + 1, messageId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Update failed'
            });
        }
        
        logger.success(`[EDIT_MESSAGE] Successfully edited message ${messageId} (edit count: ${currentEditCount + 1})`);
        
        res.json({
            success: true,
            message: result.rows[0]
        });
        
    } catch (error) {
        logger.error('[EDIT_MESSAGE] Error editing message:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to edit message. Please try again.' 
        });
    }
});

// ==================== EMAIL FINDER ENDPOINT ====================

// POST /api/ask-email - FIXED: Waits for verification to complete before responding
router.post('/api/ask-email', authenticateToken, async (req, res) => {
    try {
        logger.info('=== EMAIL FINDER REQUEST (WITH VERIFICATION WAIT) ===');
        logger.info(`User ID: ${req.user.id}`);
        
        const { messageId } = req.body;
        
        // DEBUG: Log incoming request
        console.log('DEBUG - Request body:', req.body, 'User ID:', req.user?.id);
        
        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'messageId is required'
            });
        }
        
        // Look up LinkedIn URL from message_logs using messageId
        const messageResult = await pool.query(
            'SELECT target_profile_url FROM message_logs WHERE id = $1 AND user_id = $2',
            [messageId, req.user.id]
        );
        
        if (messageResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }
        
        const linkedinUrl = messageResult.rows[0].target_profile_url;
        
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL not found for this message'
            });
        }
        
        logger.info(`Found LinkedIn URL for message ${messageId}: ${linkedinUrl}`);
        
        // FIXED: Check if user has Silver+ plan using plan_code instead of package_type
        const allowedPlans = ['silver-monthly', 'gold-monthly', 'platinum-monthly', 'silver-payg', 'gold-payg', 'platinum-payg'];
        const userPlan = req.user.plan_code?.toLowerCase();
        
        if (!allowedPlans.includes(userPlan)) {
            return res.status(403).json({
                success: false,
                error: 'plan_upgrade_required',
                message: 'Email finder feature requires Silver plan or higher',
                userMessage: 'Upgrade to Silver, Gold, or Platinum to access email finder',
                currentPlan: req.user.plan_code,
                requiredPlans: ['Silver', 'Gold', 'Platinum'],
                upgradeUrl: '/upgrade'
            });
        }
        
        // Check if email finder is enabled
        if (!isEmailFinderEnabled()) {
            return res.status(503).json({
                success: false,
                error: 'email_finder_disabled',
                message: 'Email finder feature is currently disabled'
            });
        }
        
        // STEP 1: Call email finder (finds email, triggers verification)
        logger.info('[STEP 1] Finding email...');
        const finderResult = await findEmailWithLinkedInUrl(req.user.id, linkedinUrl);
        
        if (!finderResult.success) {
            logger.warn(`[EMAIL_FINDER] Failed: ${finderResult.error}`);
            return res.json(finderResult);
        }
        
        if (!finderResult.email) {
            logger.warn('[EMAIL_FINDER] No email found');
            return res.json(finderResult);
        }
        
        logger.success(`[EMAIL_FINDER] ✅ Email found: ${finderResult.email}`);
        
        // STEP 2: FIXED - Wait for verification to complete (16 seconds total)
        logger.info('[STEP 2] Waiting for verification to complete...');
        
        // Wait 16 seconds for verification (email finding ~3s + verification ~12s + buffer ~1s)
        await new Promise(resolve => setTimeout(resolve, 16000));
        
        // STEP 3: Get final verification status from database
        logger.info('[STEP 3] Retrieving final verification status...');
        const statusResult = await pool.query(`
            SELECT email_found, email_status, email_verified_at
            FROM target_profiles 
            WHERE linkedin_url = $1 AND user_id = $2
        `, [linkedinUrl, req.user.id]);
        
        if (statusResult.rows.length > 0) {
            const row = statusResult.rows[0];
            logger.success(`[EMAIL_FINDER] ✅ Complete result: email=${row.email_found}, status=${row.email_status}`);
            
            // Return complete result with email + verification status
            return res.json({
                success: true,
                email: row.email_found,
                status: row.email_status || 'unknown',
                verifiedAt: row.email_verified_at,
                creditsCharged: finderResult.creditsCharged,
                newBalance: finderResult.newBalance,
                message: 'Email found and verified successfully'
            });
        } else {
            // Fallback: return finder result if DB query fails
            logger.warn('[EMAIL_FINDER] Could not retrieve verification status from DB');
            return res.json({
                success: true,
                email: finderResult.email,
                status: 'pending_verification',
                creditsCharged: finderResult.creditsCharged,
                newBalance: finderResult.newBalance,
                message: 'Email found, verification status pending'
            });
        }
        
    } catch (error) {
        logger.error('Email finder error:', error);
        res.status(500).json({
            success: false,
            error: 'Email finder temporarily unavailable'
        });
    }
});

module.exports = router;
