// services/contextAddonService.js
// Context Addon Management Service - Separate file for clean code organization

const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// Base plan context limits
const BASE_PLAN_LIMITS = {
    'free': 1,
    'silver-monthly': 3,
    'gold-monthly': 6,
    'platinum-monthly': 10,
    // PAYG plans use free limits since they're credit purchases, not plan upgrades
    'silver-payasyougo': 1,
    'gold-payasyougo': 1,
    'platinum-payasyougo': 1
};

/**
 * Calculate user's total context limits including addons
 */
async function calculateUserContextLimits(userId) {
    try {
        // Get user's base plan
        const userResult = await pool.query(`
            SELECT package_type, contexts_count 
            FROM users 
            WHERE id = $1
        `, [userId]);
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const user = userResult.rows[0];
        const basePlan = user.package_type || 'free';
        const baseLimit = BASE_PLAN_LIMITS[basePlan] || 1;
        const currentUsage = user.contexts_count || 0;
        
        // Get active extra slots from addons
        const addonsResult = await pool.query(`
            SELECT 
                COUNT(*) as active_addons,
                SUM(addon_quantity) as total_extra_slots,
                array_agg(
                    json_build_object(
                        'id', id,
                        'chargebee_subscription_id', chargebee_subscription_id,
                        'addon_quantity', addon_quantity,
                        'monthly_price', monthly_price,
                        'next_billing_date', next_billing_date,
                        'status', status,
                        'created_at', created_at
                    )
                ) as addon_details
            FROM user_context_addons 
            WHERE user_id = $1 AND status = 'active'
        `, [userId]);
        
        const addons = addonsResult.rows[0];
        const extraSlots = parseInt(addons.total_extra_slots) || 0;
        const totalLimit = baseLimit + extraSlots;
        
        return {
            basePlan,
            baseLimit,
            extraSlots,
            totalLimit,
            currentUsage,
            canSaveMore: currentUsage < totalLimit,
            activeAddons: addons.addon_details?.[0] ? addons.addon_details : []
        };
    } catch (error) {
        logger.error('Error calculating context limits:', error);
        throw error;
    }
}

/**
 * Create a new context addon subscription
 */
async function createContextAddon(userId, chargebeeSubscriptionId, addonData) {
    try {
        const result = await pool.query(`
            INSERT INTO user_context_addons (
                user_id, 
                chargebee_subscription_id, 
                addon_quantity, 
                monthly_price,
                billing_period_start,
                billing_period_end,
                next_billing_date,
                status,
                chargebee_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            userId,
            chargebeeSubscriptionId,
            addonData.quantity || 1,
            addonData.price || 3.99,
            addonData.billing_period_start,
            addonData.billing_period_end,
            addonData.next_billing_date,
            'active',
            addonData.chargebee_status
        ]);
        
        // Log the event
        await logContextEvent(userId, 'addon_purchased', {
            addon_id: result.rows[0].id,
            subscription_id: chargebeeSubscriptionId,
            quantity: addonData.quantity || 1
        });
        
        return result.rows[0];
    } catch (error) {
        logger.error('Error creating context addon:', error);
        throw error;
    }
}

/**
 * Update addon status (for renewals, cancellations, etc.)
 */
async function updateAddonStatus(chargebeeSubscriptionId, status, updateData = {}) {
    try {
        const updateFields = ['status = $2'];
        const values = [chargebeeSubscriptionId, status];
        let paramCount = 2;
        
        if (updateData.next_billing_date) {
            updateFields.push(`next_billing_date = $${++paramCount}`);
            values.push(updateData.next_billing_date);
        }
        
        if (updateData.expires_at) {
            updateFields.push(`expires_at = $${++paramCount}`);
            values.push(updateData.expires_at);
        }
        
        if (updateData.chargebee_status) {
            updateFields.push(`chargebee_status = $${++paramCount}`);
            values.push(updateData.chargebee_status);
        }
        
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        
        const query = `
            UPDATE user_context_addons 
            SET ${updateFields.join(', ')}
            WHERE chargebee_subscription_id = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length > 0) {
            const addon = result.rows[0];
            
            // Log the event
            const eventType = status === 'cancelled' ? 'addon_expired' : 'addon_renewed';
            await logContextEvent(addon.user_id, eventType, {
                addon_id: addon.id,
                subscription_id: chargebeeSubscriptionId,
                new_status: status
            });
        }
        
        return result.rows[0];
    } catch (error) {
        logger.error('Error updating addon status:', error);
        throw error;
    }
}

/**
 * Cancel a user's addon subscription
 */
async function cancelAddon(userId, addonId) {
    try {
        const result = await pool.query(`
            UPDATE user_context_addons 
            SET status = 'cancelled', 
                expires_at = CURRENT_TIMESTAMP + INTERVAL '3 days',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND user_id = $2 AND status = 'active'
            RETURNING *
        `, [addonId, userId]);
        
        if (result.rows.length === 0) {
            throw new Error('Addon not found or already cancelled');
        }
        
        const addon = result.rows[0];
        
        // Log the event
        await logContextEvent(userId, 'addon_expired', {
            addon_id: addonId,
            subscription_id: addon.chargebee_subscription_id,
            cancelled_by_user: true
        });
        
        return addon;
    } catch (error) {
        logger.error('Error cancelling addon:', error);
        throw error;
    }
}

/**
 * Get user's active addons
 */
async function getUserAddons(userId) {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                chargebee_subscription_id,
                addon_quantity,
                monthly_price,
                billing_period_start,
                billing_period_end,
                next_billing_date,
                status,
                created_at
            FROM user_context_addons 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [userId]);
        
        return result.rows;
    } catch (error) {
        logger.error('Error getting user addons:', error);
        throw error;
    }
}

/**
 * Log context-related events for analytics
 */
async function logContextEvent(userId, eventType, metadata = {}) {
    try {
        // Get current limits for the event
        const limits = await calculateUserContextLimits(userId);
        
        await pool.query(`
            INSERT INTO context_slot_events (
                user_id,
                event_type,
                addon_id,
                base_limit,
                active_extra_slots,
                total_limit,
                current_usage,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            userId,
            eventType,
            metadata.addon_id || null,
            limits.baseLimit,
            limits.extraSlots,
            limits.totalLimit,
            limits.currentUsage,
            JSON.stringify(metadata)
        ]);
        
        logger.info(`Context event logged: ${eventType} for user ${userId}`);
    } catch (error) {
        logger.error('Error logging context event:', error);
        // Don't throw - logging failures shouldn't break the main flow
    }
}

/**
 * Process expired addons (for cron job)
 */
async function processExpiredAddons() {
    try {
        const result = await pool.query(`
            UPDATE user_context_addons 
            SET status = 'expired'
            WHERE status IN ('cancelled', 'grace_period') 
            AND expires_at < CURRENT_TIMESTAMP
            RETURNING user_id, id, chargebee_subscription_id
        `);
        
        // Log expiration events
        for (const addon of result.rows) {
            await logContextEvent(addon.user_id, 'addon_expired', {
                addon_id: addon.id,
                subscription_id: addon.chargebee_subscription_id,
                expired_by_system: true
            });
        }
        
        logger.info(`Processed ${result.rows.length} expired addons`);
        return result.rows.length;
    } catch (error) {
        logger.error('Error processing expired addons:', error);
        throw error;
    }
}

module.exports = {
    calculateUserContextLimits,
    createContextAddon,
    updateAddonStatus,
    cancelAddon,
    getUserAddons,
    logContextEvent,
    processExpiredAddons,
    BASE_PLAN_LIMITS
};
