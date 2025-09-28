// routes/messagesRoutes.js
// Messages Routes - GPT-5 powered message generation endpoints + Messages CRUD + Email Finder + EMAIL DISPLAY FROM MESSAGE_LOGS

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const messagesController = require('../controllers/messagesController');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// Enhanced: Import email finder functionality
const { findEmailWithLinkedInUrl, getEmailFromCache, findOrGetEmail, isEmailFinderEnabled } = require('../emailFinder');

// ==================== MESSAGE GENERATION ENDPOINTS ====================

// Generate LinkedIn connection request
router.post('/generate-connection-request', authenticateToken, messagesController.generateConnectionRequest);

// Generate LinkedIn intro request  
router.post('/generate-intro-request', authenticateToken, messagesController.generateIntroRequest);

// Generate LinkedIn inbox message
router.post('/generate-inbox-message', authenticateToken, messagesController.generateInboxMessage);

// Generate cold email
router.post('/generate-cold-email', authenticateToken, messagesController.generateColdEmail);

// ==================== EMAIL FINDER ENDPOINTS ====================

// Enhanced: Email finder endpoint with message_logs persistence
router.post('/api/ask-email', authenticateToken, async (req, res) => {
    try {
        logger.custom('EMAIL', 'ASK EMAIL REQUEST - Enhanced with message_logs persistence');
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`Request body:`, req.body);

        const { linkedinUrl } = req.body;
        const userId = req.user.id;

        // Validate request
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required'
            });
        }

        // Check if email finder is enabled
        if (!isEmailFinderEnabled()) {
            return res.status(503).json({
                success: false,
                error: 'Email finder service is currently unavailable'
            });
        }

        logger.info(`[EMAIL_FINDER] Processing email request for URL: ${linkedinUrl}`);

        // Use enhanced findOrGetEmail method with smart caching
        const result = await findOrGetEmail(userId, linkedinUrl);

        logger.info(`[EMAIL_FINDER] Result:`, {
            success: result.success,
            email: result.email ? '***@***.***' : null,
            creditsCharged: result.creditsCharged || 0,
            source: result.source || 'api'
        });

        if (result.success) {
            res.json({
                success: true,
                email: result.email,
                status: result.status || result.verificationStatus || 'verified',
                source: result.source || 'snov.io',
                creditsCharged: result.creditsCharged || 0,
                newBalance: result.newBalance,
                verifiedAt: result.verifiedAt,
                message: result.message || 'Email found successfully'
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                message: result.message,
                creditsCharged: result.creditsCharged || 0,
                currentCredits: result.currentCredits,
                requiredCredits: result.requiredCredits
            });
        }

    } catch (error) {
        logger.error('[EMAIL_FINDER] Email finder endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Email finder service error',
            message: 'Please try again later'
        });
    }
});

// Check email status for a LinkedIn URL
router.get('/api/email-status/:encodedUrl', authenticateToken, async (req, res) => {
    try {
        const linkedinUrl = decodeURIComponent(req.params.encodedUrl);
        const userId = req.user.id;

        logger.info(`[EMAIL_STATUS] Checking email status for URL: ${linkedinUrl}`);

        const result = await getEmailFromCache(userId, linkedinUrl);

        if (result.success) {
            res.json({
                success: true,
                hasEmail: true,
                email: result.email,
                status: result.status,
                verifiedAt: result.verifiedAt,
                foundAt: result.foundAt
            });
        } else {
            res.json({
                success: true,
                hasEmail: false,
                message: 'No email found in cache'
            });
        }

    } catch (error) {
        logger.error('[EMAIL_STATUS] Email status check error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check email status'
        });
    }
});

// ==================== MESSAGE CRUD ENDPOINTS ====================

// Enhanced: Get message history with email data from message_logs
router.get('/messages/history', authenticateToken, async (req, res) => {
    try {
        logger.info(`[MESSAGES] Getting message history for user ${req.user.id}`);

        const result = await pool.query(`
            SELECT 
                id,
                target_name,
                target_url,
                target_profile_url,
                generated_message,
                message_context,
                credits_used,
                context_text,
                target_first_name,
                target_title,
                target_company,
                model_name,
                prompt_version,
                input_tokens,
                output_tokens,
                total_tokens,
                latency_ms,
                data_json,
                message_type,
                sent_status,
                reply_status,
                comments,
                sent_date,
                reply_date,
                email_found,
                email_status,
                email_verified_at,
                created_at
            FROM message_logs 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [req.user.id]);

        const messages = result.rows.map(row => ({
            id: row.id,
            targetName: row.target_name,
            targetUrl: row.target_url,
            targetProfileUrl: row.target_profile_url,
            generatedMessage: row.generated_message,
            messageContext: row.message_context,
            creditsUsed: row.credits_used,
            contextText: row.context_text,
            targetFirstName: row.target_first_name,
            targetTitle: row.target_title,
            targetCompany: row.target_company,
            modelName: row.model_name,
            promptVersion: row.prompt_version,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            totalTokens: row.total_tokens,
            latencyMs: row.latency_ms,
            dataJson: row.data_json,
            messageType: row.message_type,
            sentStatus: row.sent_status,
            replyStatus: row.reply_status,
            comments: row.comments,
            sentDate: row.sent_date,
            replyDate: row.reply_date,
            // Enhanced: Email finder data from message_logs
            emailFound: row.email_found,
            emailStatus: row.email_status,
            emailVerifiedAt: row.email_verified_at,
            createdAt: row.created_at
        }));

        logger.success(`[MESSAGES] Retrieved ${messages.length} messages with email data`);

        res.json({
            success: true,
            messages: messages,
            count: messages.length
        });

    } catch (error) {
        logger.error('[MESSAGES] Error getting message history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get message history'
        });
    }
});

// Update message campaign tracking information
router.put('/messages/:id', authenticateToken, async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = req.user.id;
        const { sentStatus, replyStatus, comments, sentDate, replyDate } = req.body;

        logger.info(`[MESSAGES] Updating message ${messageId} for user ${userId}`);
        logger.debug('Update data:', { sentStatus, replyStatus, comments, sentDate, replyDate });

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

        // Build dynamic update query
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (sentStatus !== undefined) {
            updates.push(`sent_status = $${paramCount++}`);
            values.push(sentStatus);
        }
        if (replyStatus !== undefined) {
            updates.push(`reply_status = $${paramCount++}`);
            values.push(replyStatus);
        }
        if (comments !== undefined) {
            updates.push(`comments = $${paramCount++}`);
            values.push(comments);
        }
        if (sentDate !== undefined) {
            updates.push(`sent_date = $${paramCount++}`);
            values.push(sentDate ? new Date(sentDate) : null);
        }
        if (replyDate !== undefined) {
            updates.push(`reply_date = $${paramCount++}`);
            values.push(replyDate ? new Date(replyDate) : null);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }

        // Add WHERE clause parameters
        values.push(messageId, userId);
        const whereParams = `$${paramCount++}, $${paramCount}`;

        const updateQuery = `
            UPDATE message_logs 
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ${whereParams.split(', ')[0]} AND user_id = ${whereParams.split(', ')[1]}
            RETURNING 
                id, sent_status, reply_status, comments, sent_date, reply_date,
                email_found, email_status, email_verified_at
        `;

        const result = await pool.query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found or update failed'
            });
        }

        const updatedMessage = result.rows[0];

        logger.success(`[MESSAGES] Message ${messageId} updated successfully`);

        res.json({
            success: true,
            message: 'Message updated successfully',
            data: {
                id: updatedMessage.id,
                sentStatus: updatedMessage.sent_status,
                replyStatus: updatedMessage.reply_status,
                comments: updatedMessage.comments,
                sentDate: updatedMessage.sent_date,
                replyDate: updatedMessage.reply_date,
                // Include email data in response
                emailFound: updatedMessage.email_found,
                emailStatus: updatedMessage.email_status,
                emailVerifiedAt: updatedMessage.email_verified_at
            }
        });

    } catch (error) {
        logger.error('[MESSAGES] Error updating message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update message'
        });
    }
});

// Delete message
router.delete('/messages/:id', authenticateToken, async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = req.user.id;

        logger.info(`[MESSAGES] Deleting message ${messageId} for user ${userId}`);

        const result = await pool.query(
            'DELETE FROM message_logs WHERE id = $1 AND user_id = $2 RETURNING id',
            [messageId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }

        logger.success(`[MESSAGES] Message ${messageId} deleted successfully`);

        res.json({
            success: true,
            message: 'Message deleted successfully'
        });

    } catch (error) {
        logger.error('[MESSAGES] Error deleting message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete message'
        });
    }
});

// Get single message with full details
router.get('/messages/:id', authenticateToken, async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = req.user.id;

        logger.info(`[MESSAGES] Getting message ${messageId} for user ${userId}`);

        const result = await pool.query(`
            SELECT 
                id, target_name, target_url, target_profile_url, generated_message,
                message_context, credits_used, context_text, target_first_name,
                target_title, target_company, model_name, prompt_version,
                input_tokens, output_tokens, total_tokens, latency_ms, data_json,
                message_type, sent_status, reply_status, comments, sent_date, reply_date,
                email_found, email_status, email_verified_at, created_at
            FROM message_logs 
            WHERE id = $1 AND user_id = $2
        `, [messageId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }

        const message = result.rows[0];

        res.json({
            success: true,
            message: {
                id: message.id,
                targetName: message.target_name,
                targetUrl: message.target_url,
                targetProfileUrl: message.target_profile_url,
                generatedMessage: message.generated_message,
                messageContext: message.message_context,
                creditsUsed: message.credits_used,
                contextText: message.context_text,
                targetFirstName: message.target_first_name,
                targetTitle: message.target_title,
                targetCompany: message.target_company,
                modelName: message.model_name,
                promptVersion: message.prompt_version,
                inputTokens: message.input_tokens,
                outputTokens: message.output_tokens,
                totalTokens: message.total_tokens,
                latencyMs: message.latency_ms,
                dataJson: message.data_json,
                messageType: message.message_type,
                sentStatus: message.sent_status,
                replyStatus: message.reply_status,
                comments: message.comments,
                sentDate: message.sent_date,
                replyDate: message.reply_date,
                // Enhanced: Email finder data
                emailFound: message.email_found,
                emailStatus: message.email_status,
                emailVerifiedAt: message.email_verified_at,
                createdAt: message.created_at
            }
        });

    } catch (error) {
        logger.error('[MESSAGES] Error getting message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get message'
        });
    }
});

// ==================== ANALYTICS ENDPOINTS ====================

// Get message statistics
router.get('/messages/stats/overview', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        logger.info(`[MESSAGES] Getting message statistics for user ${userId}`);

        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_messages,
                COUNT(CASE WHEN sent_status = 'sent' THEN 1 END) as sent_messages,
                COUNT(CASE WHEN reply_status = 'replied' THEN 1 END) as replied_messages,
                COUNT(CASE WHEN email_found IS NOT NULL THEN 1 END) as emails_found,
                COUNT(CASE WHEN email_status = 'verified' THEN 1 END) as emails_verified,
                SUM(credits_used) as total_credits_used,
                AVG(latency_ms) as avg_latency_ms
            FROM message_logs 
            WHERE user_id = $1
        `, [userId]);

        const stats = result.rows[0];

        res.json({
            success: true,
            stats: {
                totalMessages: parseInt(stats.total_messages) || 0,
                sentMessages: parseInt(stats.sent_messages) || 0,
                repliedMessages: parseInt(stats.replied_messages) || 0,
                emailsFound: parseInt(stats.emails_found) || 0,
                emailsVerified: parseInt(stats.emails_verified) || 0,
                totalCreditsUsed: parseInt(stats.total_credits_used) || 0,
                avgLatencyMs: Math.round(parseFloat(stats.avg_latency_ms)) || 0,
                replyRate: stats.sent_messages > 0 ? 
                    Math.round((stats.replied_messages / stats.sent_messages) * 100) : 0,
                emailFoundRate: stats.total_messages > 0 ? 
                    Math.round((stats.emails_found / stats.total_messages) * 100) : 0
            }
        });

    } catch (error) {
        logger.error('[MESSAGES] Error getting message statistics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get message statistics'
        });
    }
});

// ==================== EMAIL FINDER STATUS ENDPOINT ====================

// Get email finder service status
router.get('/api/email-finder/status', authenticateToken, async (req, res) => {
    try {
        const { getEmailFinderStatus } = require('../emailFinder');
        const status = getEmailFinderStatus();

        res.json({
            success: true,
            emailFinder: {
                enabled: status.enabled,
                hasCredentials: status.hasCredentials,
                costPerSuccess: status.costPerSuccess,
                mode: status.mode,
                persistenceStrategy: status.persistenceStrategy || 'message_logs'
            }
        });

    } catch (error) {
        logger.error('[EMAIL_FINDER] Error getting email finder status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get email finder status'
        });
    }
});

module.exports = router;
