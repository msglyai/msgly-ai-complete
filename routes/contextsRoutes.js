// routes/contextsRoutes.js
// Context Management Routes - Save/Load/Delete user contexts with plan-based limits

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// Context limits by plan
const CONTEXT_LIMITS = {
    'free': 1,
    'silver-monthly': 3,
    'gold-monthly': 6,
    'platinum-monthly': 10,
    // PAYG plans use free limits since they're credit purchases, not plan upgrades
    'silver-payasyougo': 1,
    'gold-payasyougo': 1,
    'platinum-payasyougo': 1
};

// Helper function to get user's context limit
function getContextLimit(planCode) {
    return CONTEXT_LIMITS[planCode] || 1; // Default to 1 for unknown plans
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
        const limit = getContextLimit(planCode);

        res.json({
            success: true,
            data: {
                contexts: result.rows,
                usage: {
                    used: result.rows.length,
                    limit: limit,
                    remaining: Math.max(0, limit - result.rows.length)
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
        const limit = getContextLimit(planCode);

        const countResult = await pool.query(`
            SELECT COUNT(*) as count FROM saved_contexts WHERE user_id = $1
        `, [req.user.id]);

        const currentCount = parseInt(countResult.rows[0].count);

        if (currentCount >= limit) {
            return res.status(400).json({
                success: false,
                error: `Context limit reached. Your ${planCode} plan allows ${limit} saved context${limit > 1 ? 's' : ''}.`,
                planUpgradeRequired: true
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
        const limit = getContextLimit(planCode);

        const countResult = await pool.query(`
            SELECT COUNT(*) as count FROM saved_contexts WHERE user_id = $1
        `, [req.user.id]);

        const currentCount = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: {
                planCode: planCode,
                limit: limit,
                used: currentCount,
                remaining: Math.max(0, limit - currentCount),
                canSaveMore: currentCount < limit
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
