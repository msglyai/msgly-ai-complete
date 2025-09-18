// routes/contextsRoutes.js
// Context Management Routes - Save/Load/Delete user contexts with plan-based limits + CONTEXT ADDON SUPPORT
// ✅ ENHANCED: Now includes purchased context addon slots in limit calculations
// 🔧 FIXED: Robust base limit calculation that doesn't rely on database.js errors

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { pool, getContextAddonUsage } = require('../utils/database');
const logger = require('../utils/logger');

// Base context limits by plan (before addons) - CORRECTED PAYG LIMITS
const BASE_CONTEXT_LIMITS = {
    'free': 1,
    'silver-monthly': 3,
    'gold-monthly': 6,
    'platinum-monthly': 10,
    // All PAYG plans get only 1 slot (like free) - pay per message, minimal storage
    'silver-payasyougo': 1,
    'gold-payasyougo': 1,
    'platinum-payasyougo': 1
};

// Helper function to get user's base context limit (without addons)
function getBaseContextLimit(planCode) {
    return BASE_CONTEXT_LIMITS[planCode] || 1; // Default to 1 for unknown plans
}

// ✅ FIXED: Enhanced helper function to get user's total context limit (base + addons)
async function getTotalContextLimit(userId, planCode) {
    try {
        // STEP 1: Calculate the CORRECT base limit from plan code
        const expectedBaseLimit = getBaseContextLimit(planCode);
        
        // STEP 2: Get addon usage from database
        const addonUsage = await getContextAddonUsage(userId);
        
        if (addonUsage.success) {
            // STEP 3: Validate and correct the base limit if database.js returned wrong value
            const actualAddonSlots = addonUsage.addonSlots || 0;
            const actualActiveAddons = addonUsage.activeAddons || 0;
            
            // STEP 4: Calculate correct total (ignore potentially wrong baseSlots from database.js)
            const correctedTotalSlots = expectedBaseLimit + actualAddonSlots;
            
            logger.debug(`Context limit calculation for user ${userId}:`, {
                planCode: planCode,
                expectedBaseLimit: expectedBaseLimit,
                addonSlots: actualAddonSlots,
                totalSlots: correctedTotalSlots,
                databaseBaseSlots: addonUsage.baseSlots, // For debugging
                databaseTotalSlots: addonUsage.totalSlots // For debugging
            });
            
            return {
                success: true,
                totalSlots: correctedTotalSlots,
                baseSlots: expectedBaseLimit, // Use our calculated value
                addonSlots: actualAddonSlots,
                activeAddons: actualActiveAddons
            };
        } else {
            // Fallback to base plan limit if addon query fails
            logger.debug('Addon usage query failed, using base limit:', addonUsage.error);
            return {
                success: true,
                totalSlots: expectedBaseLimit,
                baseSlots: expectedBaseLimit,
                addonSlots: 0,
                activeAddons: 0
            };
        }
    } catch (error) {
        logger.error('Error calculating total context limit:', error);
        // Fallback to base plan limit on error
        const fallbackLimit = getBaseContextLimit(planCode);
        return {
            success: true,
            totalSlots: fallbackLimit,
            baseSlots: fallbackLimit,
            addonSlots: 0,
            activeAddons: 0
        };
    }
}

// GET /contexts - List user's saved contexts
router.get('/contexts', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, context_name, context_text, created_at, updated_at
            FROM saved_contexts 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [req.user.id]);

        // Get user's plan for limit calculation
        const userResult = await pool.query(`
            SELECT package_type FROM users WHERE id = $1
        `, [req.user.id]);
        
        const planCode = userResult.rows[0]?.package_type || 'free';
        
        // ✅ ENHANCED: Get total limit including addons
        const limitInfo = await getTotalContextLimit(req.user.id, planCode);

        res.json({
            success: true,
            data: {
                contexts: result.rows,
                usage: {
                    used: result.rows.length,
                    limit: limitInfo.totalSlots,
                    remaining: Math.max(0, limitInfo.totalSlots - result.rows.length),
                    // ✅ NEW: Include addon information
                    breakdown: {
                        baseSlots: limitInfo.baseSlots,
                        addonSlots: limitInfo.addonSlots,
                        activeAddons: limitInfo.activeAddons
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

// POST /contexts - Save new context
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

        // Check user's plan and current context count
        const userResult = await pool.query(`
            SELECT package_type FROM users WHERE id = $1
        `, [req.user.id]);
        
        const planCode = userResult.rows[0]?.package_type || 'free';
        
        // ✅ ENHANCED: Get total limit including addons
        const limitInfo = await getTotalContextLimit(req.user.id, planCode);

        const countResult = await pool.query(`
            SELECT COUNT(*) as count FROM saved_contexts WHERE user_id = $1
        `, [req.user.id]);

        const currentCount = parseInt(countResult.rows[0].count);

        // ✅ ENHANCED: Check against total limit (base + addons)
        if (currentCount >= limitInfo.totalSlots) {
            return res.status(400).json({
                success: false,
                error: `Context limit reached. You have ${limitInfo.totalSlots} total slot${limitInfo.totalSlots > 1 ? 's' : ''} (${limitInfo.baseSlots} base + ${limitInfo.addonSlots} addon${limitInfo.addonSlots !== 1 ? 's' : ''}).`,
                planUpgradeRequired: limitInfo.addonSlots === 0, // Only suggest upgrade if no addons
                addonPurchaseAvailable: true, // Always allow addon purchase
                currentUsage: {
                    used: currentCount,
                    limit: limitInfo.totalSlots,
                    breakdown: {
                        baseSlots: limitInfo.baseSlots,
                        addonSlots: limitInfo.addonSlots,
                        activeAddons: limitInfo.activeAddons
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
                // ✅ NEW: Include updated usage info
                usage: {
                    used: currentCount + 1,
                    limit: limitInfo.totalSlots,
                    remaining: limitInfo.totalSlots - (currentCount + 1),
                    breakdown: {
                        baseSlots: limitInfo.baseSlots,
                        addonSlots: limitInfo.addonSlots,
                        activeAddons: limitInfo.activeAddons
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

// GET /contexts/limits - Get user's context limits
router.get('/contexts/limits', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query(`
            SELECT package_type FROM users WHERE id = $1
        `, [req.user.id]);
        
        const planCode = userResult.rows[0]?.package_type || 'free';
        
        // ✅ ENHANCED: Get total limit including addons
        const limitInfo = await getTotalContextLimit(req.user.id, planCode);

        const countResult = await pool.query(`
            SELECT COUNT(*) as count FROM saved_contexts WHERE user_id = $1
        `, [req.user.id]);

        const currentCount = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: {
                planCode: planCode,
                used: currentCount,
                baseLimit: limitInfo.baseSlots,
                totalLimit: limitInfo.totalSlots,
                addonSlots: limitInfo.addonSlots,
                addons: [], // Will be populated by database.js if available
                remaining: Math.max(0, limitInfo.totalSlots - currentCount),
                canSaveMore: currentCount < limitInfo.totalSlots,
                // ✅ NEW: Include detailed breakdown
                breakdown: {
                    baseSlots: limitInfo.baseSlots,
                    addonSlots: limitInfo.addonSlots,
                    activeAddons: limitInfo.activeAddons,
                    totalSlots: limitInfo.totalSlots
                },
                // ✅ NEW: Include addon purchase availability
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

module.exports = router;
