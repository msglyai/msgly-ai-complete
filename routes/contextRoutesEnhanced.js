// routes/contextRoutesEnhanced.js
// Enhanced Context Management Routes with Addon Support
// Replace your existing contextsRoutes.js with this file

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');
const contextAddonService = require('../services/contextAddonService');

// ==================== CONTEXT CRUD ROUTES ====================

// GET /contexts - List user's saved contexts with usage info
router.get('/contexts', authenticateToken, async (req, res) => {
    try {
        // Get contexts
        const contextsResult = await pool.query(`
            SELECT 
                id, 
                context_name, 
                context_text, 
                context_preview,
                created_at, 
                updated_at
            FROM saved_contexts 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [req.user.id]);

        // Get comprehensive limit information
        const limits = await contextAddonService.calculateUserContextLimits(req.user.id);

        res.json({
            success: true,
            data: {
                contexts: contextsResult.rows,
                limits: limits
            }
        });
    } catch (error) {
        logger.error('Get contexts error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load contexts'
        });
    }
});

// POST /contexts - Save new context with limit checking
router.post('/contexts', authenticateToken, async (req, res) => {
    try {
        const { context_name, context_text } = req.body;

        // Validate input
        if (!context_name || !context_text) {
            return res.status(400).json({
                success: false,
                error: 'Context name and text are required'
            });
        }

        if (context_name.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Context name must be 100 characters or less'
            });
        }

        // Check user's total limits (including addons)
        const limits = await contextAddonService.calculateUserContextLimits(req.user.id);

        if (!limits.canSaveMore) {
            return res.status(400).json({
                success: false,
                error: `Context limit reached. You're using ${limits.currentUsage}/${limits.totalLimit} slots.`,
                limitReached: true,
                upgradeOptions: {
                    basePlan: limits.basePlan,
                    baseLimit: limits.baseLimit,
                    extraSlots: limits.extraSlots,
                    totalLimit: limits.totalLimit,
                    currentUsage: limits.currentUsage
                }
            });
        }

        // Create context preview (first 150 characters)
        const preview = context_text.length > 150 ? 
            context_text.substring(0, 147) + '...' : 
            context_text;

        // Save context
        try {
            const result = await pool.query(`
                INSERT INTO saved_contexts (user_id, context_name, context_text, context_preview)
                VALUES ($1, $2, $3, $4)
                RETURNING id, context_name, context_text, context_preview, created_at
            `, [req.user.id, context_name.trim(), context_text.trim(), preview]);

            // Log the save event
            await contextAddonService.logContextEvent(req.user.id, 'context_saved', {
                context_id: result.rows[0].id,
                context_name: context_name.trim()
            });

            res.json({
                success: true,
                message: 'Context saved successfully',
                data: result.rows[0]
            });
        } catch (dbError) {
            if (dbError.code === '23505') { // Unique violation
                return res.status(400).json({
                    success: false,
                    error: 'A context with this name already exists. Please choose a different name.'
                });
            }
            throw dbError;
        }

    } catch (error) {
        logger.error('Save context error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save context'
        });
    }
});

// PUT /contexts/:id - Update existing context
router.put('/contexts/:id', authenticateToken, async (req, res) => {
    try {
        const contextId = parseInt(req.params.id);
        const { context_name, context_text } = req.body;

        // Validate input
        if (!context_name || !context_text) {
            return res.status(400).json({
                success: false,
                error: 'Context name and text are required'
            });
        }

        if (context_name.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Context name must be 100 characters or less'
            });
        }

        // Create context preview
        const preview = context_text.length > 150 ? 
            context_text.substring(0, 147) + '...' : 
            context_text;

        // Update context (will fail if duplicate name due to UNIQUE constraint)
        try {
            const result = await pool.query(`
                UPDATE saved_contexts 
                SET context_name = $1, context_text = $2, context_preview = $3, updated_at = CURRENT_TIMESTAMP
                WHERE id = $4 AND user_id = $5
                RETURNING id, context_name, context_text, context_preview, updated_at
            `, [context_name.trim(), context_text.trim(), preview, contextId, req.user.id]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Context not found or access denied'
                });
            }

            res.json({
                success: true,
                message: 'Context updated successfully',
                data: result.rows[0]
            });
        } catch (dbError) {
            if (dbError.code === '23505') { // Unique violation
                return res.status(400).json({
                    success: false,
                    error: 'A context with this name already exists. Please choose a different name.'
                });
            }
            throw dbError;
        }

    } catch (error) {
        logger.error('Update context error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update context'
        });
    }
});

// DELETE /contexts/:id - Delete context
router.delete('/contexts/:id', authenticateToken, async (req, res) => {
    try {
        const contextId = parseInt(req.params.id);

        const result = await pool.query(`
            DELETE FROM saved_contexts 
            WHERE id = $1 AND user_id = $2
            RETURNING context_name
        `, [contextId, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Context not found or access denied'
            });
        }

        // Log the deletion event
        await contextAddonService.logContextEvent(req.user.id, 'context_deleted', {
            context_id: contextId,
            context_name: result.rows[0].context_name
        });

        res.json({
            success: true,
            message: `Context "${result.rows[0].context_name}" deleted successfully`
        });

    } catch (error) {
        logger.error('Delete context error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete context'
        });
    }
});

// ==================== CONTEXT LIMIT ROUTES ====================

// GET /api/user/context-limits - Get comprehensive context limits (NEW ENDPOINT)
router.get('/api/user/context-limits', authenticateToken, async (req, res) => {
    try {
        const limits = await contextAddonService.calculateUserContextLimits(req.user.id);
        
        res.json({
            success: true,
            data: limits
        });
    } catch (error) {
        logger.error('Get context limits error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get context limits'
        });
    }
});

// GET /contexts/limits - Legacy endpoint for compatibility
router.get('/contexts/limits', authenticateToken, async (req, res) => {
    try {
        const limits = await contextAddonService.calculateUserContextLimits(req.user.id);

        res.json({
            success: true,
            data: {
                planCode: limits.basePlan,
                limit: limits.totalLimit,
                used: limits.currentUsage,
                remaining: Math.max(0, limits.totalLimit - limits.currentUsage),
                canSaveMore: limits.canSaveMore,
                // Additional info for enhanced UI
                baseLimit: limits.baseLimit,
                extraSlots: limits.extraSlots,
                activeAddons: limits.activeAddons
            }
        });
    } catch (error) {
        logger.error('Get context limits error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get context limits'
        });
    }
});

// ==================== ADDON MANAGEMENT ROUTES ====================

// GET /api/user/context-addons - Get user's addon subscriptions
router.get('/api/user/context-addons', authenticateToken, async (req, res) => {
    try {
        const addons = await contextAddonService.getUserAddons(req.user.id);
        
        res.json({
            success: true,
            data: {
                addons: addons,
                totalExtraSlots: addons
                    .filter(addon => addon.status === 'active')
                    .reduce((sum, addon) => sum + addon.addon_quantity, 0)
            }
        });
    } catch (error) {
        logger.error('Get user addons error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get addon information'
        });
    }
});

// DELETE /api/addons/extra-context-slot/:addonId - Cancel addon subscription
router.delete('/api/addons/extra-context-slot/:addonId', authenticateToken, async (req, res) => {
    try {
        const addonId = parseInt(req.params.addonId);
        
        const cancelledAddon = await contextAddonService.cancelAddon(req.user.id, addonId);
        
        res.json({
            success: true,
            message: 'Addon subscription cancelled successfully',
            data: {
                addon: cancelledAddon,
                expiresAt: cancelledAddon.expires_at
            }
        });
    } catch (error) {
        logger.error('Cancel addon error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to cancel addon subscription'
        });
    }
});

// ==================== ANALYTICS ROUTES ====================

// GET /api/context-events - Get context usage analytics (admin/debug)
router.get('/api/context-events', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                event_type,
                base_limit,
                active_extra_slots,
                total_limit,
                current_usage,
                metadata,
                created_at
            FROM context_slot_events 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 50
        `, [req.user.id]);

        res.json({
            success: true,
            data: {
                events: result.rows
            }
        });
    } catch (error) {
        logger.error('Get context events error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get context events'
        });
    }
});

module.exports = router;
