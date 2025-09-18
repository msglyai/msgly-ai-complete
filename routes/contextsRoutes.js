// routes/contextsRoutes.js
// Context Management Routes - Save/Load/Delete user contexts with plan-based limits + CONTEXT ADDON SUPPORT
// ✅ UPDATED: Now uses simplified context slot system with direct database fields
// 🔧 SIMPLIFIED: Removed complex calculations, uses database.js functions directly

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { getContextAddonUsage, getUserContextAddons } = require('../utils/database');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// GET /contexts - List user's saved contexts with addon-aware limits
router.get('/contexts', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, context_name, context_text, created_at, updated_at
            FROM saved_contexts 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [req.user.id]);

        // 🆕 SIMPLIFIED: Use database function for context limits
        const limitData = await getContextAddonUsage(req.user.id);
        
        if (!limitData.success) {
            throw new Error(limitData.error);
        }

        const { used, baseLimit, addonSlots, totalLimit } = limitData.data;

        res.json({
            success: true,
            data: {
                contexts: result.rows,
                usage: {
                    used: used,
                    baseLimit: baseLimit,
                    addonSlots: addonSlots,
                    totalLimit: totalLimit,
                    remaining: Math.max(0, totalLimit - used),
                    canSaveMore: used < totalLimit,
                    // Include breakdown for dashboard display
                    breakdown: {
                        baseSlots: baseLimit,
                        addonSlots: addonSlots,
                        totalSlots: totalLimit
                    }
                }
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

// POST /contexts - Save new context with addon-aware limit checking
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

        // 🆕 SIMPLIFIED: Use database function for limit checking
        const limitData = await getContextAddonUsage(req.user.id);
        
        if (!limitData.success) {
            throw new Error(limitData.error);
        }

        const { used, baseLimit, addonSlots, totalLimit } = limitData.data;

        // Check if user has reached their limit
        if (used >= totalLimit) {
            return res.status(400).json({
                success: false,
                error: `Context limit reached. You have ${totalLimit} total slot${totalLimit > 1 ? 's' : ''} (${baseLimit} base + ${addonSlots} addon${addonSlots !== 1 ? 's' : ''}).`,
                planUpgradeRequired: addonSlots === 0, // Only suggest upgrade if no addons
                addonPurchaseAvailable: true, // Always allow addon purchase
                currentUsage: {
                    used: used,
                    limit: totalLimit,
                    breakdown: {
                        baseSlots: baseLimit,
                        addonSlots: addonSlots,
                        totalSlots: totalLimit
                    }
                }
            });
        }

        // Save context (will fail if duplicate name due to UNIQUE constraint)
        try {
            const result = await pool.query(`
                INSERT INTO saved_contexts (user_id, context_name, context_text)
                VALUES ($1, $2, $3)
                RETURNING id, context_name, context_text, created_at
            `, [req.user.id, context_name.trim(), context_text.trim()]);

            res.json({
                success: true,
                message: 'Context saved successfully',
                data: result.rows[0],
                // Include updated usage info
                usage: {
                    used: used + 1,
                    limit: totalLimit,
                    remaining: totalLimit - (used + 1),
                    breakdown: {
                        baseSlots: baseLimit,
                        addonSlots: addonSlots,
                        totalSlots: totalLimit
                    }
                }
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

        // Verify context belongs to user and update
        try {
            const result = await pool.query(`
                UPDATE saved_contexts 
                SET context_name = $1, context_text = $2, updated_at = CURRENT_TIMESTAMP
                WHERE id = $3 AND user_id = $4
                RETURNING id, context_name, context_text, updated_at
            `, [context_name.trim(), context_text.trim(), contextId, req.user.id]);

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

// GET /contexts/limits - Get user's context limits (used by frontend)
router.get('/contexts/limits', authenticateToken, async (req, res) => {
    try {
        // 🆕 SIMPLIFIED: Use database function for all limit data
        const limitData = await getContextAddonUsage(req.user.id);
        
        if (!limitData.success) {
            throw new Error(limitData.error);
        }

        const { used, baseLimit, addonSlots, totalLimit, planCode } = limitData.data;

        // Get active addons for detailed display
        const addonsData = await getUserContextAddons(req.user.id);
        const activeAddons = addonsData.success ? addonsData.data : [];

        res.json({
            success: true,
            data: {
                planCode: planCode || 'free',
                used: used,
                baseLimit: baseLimit,
                totalLimit: totalLimit,
                addonSlots: addonSlots,
                addons: activeAddons,
                remaining: Math.max(0, totalLimit - used),
                canSaveMore: used < totalLimit,
                // Include detailed breakdown for dashboard
                breakdown: {
                    baseSlots: baseLimit,
                    addonSlots: addonSlots,
                    totalSlots: totalLimit
                },
                // Include addon purchase info
                addonInfo: {
                    canPurchaseMore: true,
                    addonPrice: 3.99,
                    addonSlotsPerPurchase: 1,
                    billingModel: 'monthly'
                }
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

module.exports = router
