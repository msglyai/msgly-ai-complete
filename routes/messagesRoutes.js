// routes/messagesRoutes.js
// Messages Routes - GPT-5 powered message generation endpoints + Messages CRUD + EMAIL FINDER

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const {
    handleGenerateMessage,
    handleGenerateConnection,
    handleGenerateIntro,
    handleGenerateColdEmail  // EXISTING: Keep cold email functionality
} = require('../controllers/messagesController');

// NEW: Import database, logger, and email finder for CRUD operations
const { pool } = require('../utils/database');
const logger = require('../utils/logger');
const { findEmailWithLinkedInUrl } = require('../emailFinder');

// EXISTING: Message generation routes (unchanged)
router.post('/generate-message', authenticateToken, handleGenerateMessage);
router.post('/generate-connection', authenticateToken, handleGenerateConnection);
router.post('/generate-intro', authenticateToken, handleGenerateIntro);
router.post('/generate-cold-email', authenticateToken, handleGenerateColdEmail); // EXISTING: Keep this

// ==================== NEW: MESSAGES CRUD ENDPOINTS ====================

// GET /messages/history - Get messages for user (FIXED: includes context data)
router.get('/messages/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ml.id,
                ml.target_first_name as "targetProfile.firstName",
                ml.target_title as "targetProfile.role", 
                ml.target_company as "targetProfile.company",
                ml.generated_message as message,
                ml.context_text as context,
                ml.created_at,
                -- FIXED: Read actual database values instead of hardcoded 'pending'
                COALESCE(ml.sent_status, 'pending') as sent,
                COALESCE(ml.reply_status, 'pending') as "gotReply",
                COALESCE(ml.comments, '') as comments,
                -- NEW: Include found email information
                ml.found_email,
                ml.email_found_date,
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
            context: row.context || 'No context available',
            sent: row.sent,
            gotReply: row.gotReply,
            comments: row.comments,
            // NEW: Include email information
            foundEmail: row.found_email,
            emailFoundDate: row.email_found_date,
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

// ==================== NEW: EMAIL FINDER ENDPOINT ====================

// POST /api/ask-email - Find email for message (MISSING ENDPOINT ADDED)
router.post('/api/ask-email', authenticateToken, async (req, res) => {
    try {
        const { messageId } = req.body;
        const userId = req.user.id;
        
        logger.custom('EMAIL_FINDER', `=== ASK EMAIL REQUEST ===`);
        logger.info(`User ID: ${userId}, Message ID: ${messageId}`);
        
        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'Message ID is required'
            });
        }
        
        // Get message details including LinkedIn URL
        const messageResult = await pool.query(`
            SELECT 
                id, user_id, target_profile_url, 
                target_first_name, target_company, 
                found_email, email_found_date
            FROM message_logs 
            WHERE id = $1 AND user_id = $2
        `, [messageId, userId]);
        
        if (messageResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }
        
        const message = messageResult.rows[0];
        
        // Check if email already found
        if (message.found_email) {
            return res.json({
                success: true,
                email: message.found_email,
                message: 'Email already found',
                alreadyFound: true,
                foundDate: message.email_found_date
            });
        }
        
        // Extract LinkedIn URL from target_profile_url
        const linkedinUrl = message.target_profile_url;
        
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'No LinkedIn URL found for this message'
            });
        }
        
        logger.info(`Finding email for LinkedIn URL: ${linkedinUrl}`);
        
        // Call email finder service
        const emailResult = await findEmailWithLinkedInUrl(userId, linkedinUrl);
        
        if (emailResult.success && emailResult.email) {
            // SUCCESS: Update message with found email
            await pool.query(`
                UPDATE message_logs 
                SET 
                    found_email = $1,
                    email_found_date = NOW()
                WHERE id = $2 AND user_id = $3
            `, [emailResult.email, messageId, userId]);
            
            logger.success(`Email found and saved: ${emailResult.email} for message ${messageId}`);
            
            res.json({
                success: true,
                email: emailResult.email,
                creditsCharged: emailResult.creditsCharged,
                newBalance: emailResult.newBalance,
                message: 'Email found successfully'
            });
            
        } else {
            // FAILED: Email not found
            logger.info(`Email not found for message ${messageId}: ${emailResult.message}`);
            
            res.json({
                success: false,
                error: emailResult.error || 'email_not_found',
                creditsCharged: emailResult.creditsCharged || 0,
                message: emailResult.message || 'No email found for this LinkedIn profile'
            });
        }
        
    } catch (error) {
        logger.error('Ask email error:', error);
        res.status(500).json({
            success: false,
            error: 'system_error',
            message: 'System error occurred. Please try again.'
        });
    }
});

module.exports = router;
