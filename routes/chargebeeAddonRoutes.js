// routes/chargebeeAddonRoutes.js
// Chargebee Addon Integration for Extra Context Slots
// Separate file for addon purchase and webhook handling

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');
const contextAddonService = require('../services/contextAddonService');

// Chargebee configuration
const chargebee = require('chargebee');

// Initialize Chargebee
if (process.env.CHARGEBEE_SITE && process.env.CHARGEBEE_API_KEY) {
    chargebee.configure({
        site: process.env.CHARGEBEE_SITE,
        api_key: process.env.CHARGEBEE_API_KEY
    });
    logger.info('Chargebee configured for context addons');
} else {
    logger.warn('Chargebee not configured - addon purchases will not work');
}

// ==================== ADDON PURCHASE ROUTES ====================

// POST /api/addons/extra-context-slot/purchase - Purchase extra context slot
router.post('/api/addons/extra-context-slot/purchase', authenticateToken, async (req, res) => {
    try {
        const { quantity = 1 } = req.body;
        
        if (!chargebee || !process.env.CHARGEBEE_SITE) {
            return res.status(500).json({
                success: false,
                error: 'Addon purchasing is not configured'
            });
        }

        // Validate quantity
        if (quantity < 1 || quantity > 10) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be between 1 and 10'
            });
        }

        // Get user info
        const userResult = await pool.query(`
            SELECT email, first_name, last_name 
            FROM users 
            WHERE id = $1
        `, [req.user.id]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = userResult.rows[0];

        // Create Chargebee checkout for addon subscription
        const checkoutResult = await new Promise((resolve, reject) => {
            chargebee.hosted_page.checkout_new_for_item({
                subscription: {
                    plan_id: 'extra-context-slot', // This needs to be created in Chargebee
                    plan_quantity: quantity
                },
                customer: {
                    id: `user_${req.user.id}`,
                    email: user.email,
                    first_name: user.first_name || '',
                    last_name: user.last_name || ''
                },
                billing_address: {
                    first_name: user.first_name || '',
                    last_name: user.last_name || '',
                    email: user.email
                },
                redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/addon-success`,
                cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/addon-cancelled`
            }).request((error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });

        res.json({
            success: true,
            chargebee_checkout_url: checkoutResult.hosted_page.url,
            checkout_id: checkoutResult.hosted_page.id
        });

    } catch (error) {
        logger.error('Addon purchase error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create addon purchase checkout'
        });
    }
});

// ==================== CHARGEBEE WEBHOOK HANDLING ====================

// POST /webhooks/chargebee-addons - Handle Chargebee addon webhooks
router.post('/webhooks/chargebee-addons', async (req, res) => {
    try {
        const event = req.body;
        
        logger.info('Received Chargebee addon webhook:', {
            event_type: event.event_type,
            subscription_id: event.content?.subscription?.id
        });

        switch (event.event_type) {
            case 'subscription_created':
                await handleAddonSubscriptionCreated(event);
                break;
                
            case 'subscription_renewed':
                await handleAddonSubscriptionRenewed(event);
                break;
                
            case 'subscription_cancelled':
                await handleAddonSubscriptionCancelled(event);
                break;
                
            case 'subscription_reactivated':
                await handleAddonSubscriptionReactivated(event);
                break;
                
            case 'payment_failed':
                await handleAddonPaymentFailed(event);
                break;
                
            default:
                logger.info('Unhandled addon webhook event:', event.event_type);
        }

        res.status(200).json({ success: true });
        
    } catch (error) {
        logger.error('Chargebee addon webhook error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== WEBHOOK HANDLERS ====================

async function handleAddonSubscriptionCreated(event) {
    const subscription = event.content.subscription;
    const customer = event.content.customer;
    
    try {
        // Extract user ID from customer ID (format: user_123)
        const userId = parseInt(customer.id.replace('user_', ''));
        
        if (!userId) {
            throw new Error('Invalid customer ID format');
        }

        // Calculate billing dates
        const billingPeriodStart = new Date(subscription.current_term_start * 1000);
        const billingPeriodEnd = new Date(subscription.current_term_end * 1000);
        const nextBillingDate = new Date(subscription.next_billing_at * 1000);

        // Create addon record
        await contextAddonService.createContextAddon(userId, subscription.id, {
            quantity: subscription.plan_quantity || 1,
            price: (subscription.plan_unit_price || 399) / 100, // Convert cents to dollars
            billing_period_start: billingPeriodStart,
            billing_period_end: billingPeriodEnd,
            next_billing_date: nextBillingDate,
            chargebee_status: subscription.status
        });

        logger.info(`Addon subscription created for user ${userId}:`, subscription.id);
        
    } catch (error) {
        logger.error('Error handling addon subscription created:', error);
        throw error;
    }
}

async function handleAddonSubscriptionRenewed(event) {
    const subscription = event.content.subscription;
    
    try {
        const nextBillingDate = new Date(subscription.next_billing_at * 1000);
        
        await contextAddonService.updateAddonStatus(subscription.id, 'active', {
            next_billing_date: nextBillingDate,
            chargebee_status: subscription.status
        });

        logger.info(`Addon subscription renewed:`, subscription.id);
        
    } catch (error) {
        logger.error('Error handling addon subscription renewed:', error);
        throw error;
    }
}

async function handleAddonSubscriptionCancelled(event) {
    const subscription = event.content.subscription;
    
    try {
        // Set 3-day grace period
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 3);
        
        await contextAddonService.updateAddonStatus(subscription.id, 'cancelled', {
            expires_at: expiresAt,
            chargebee_status: subscription.status
        });

        logger.info(`Addon subscription cancelled:`, subscription.id);
        
    } catch (error) {
        logger.error('Error handling addon subscription cancelled:', error);
        throw error;
    }
}

async function handleAddonSubscriptionReactivated(event) {
    const subscription = event.content.subscription;
    
    try {
        const nextBillingDate = new Date(subscription.next_billing_at * 1000);
        
        await contextAddonService.updateAddonStatus(subscription.id, 'active', {
            next_billing_date: nextBillingDate,
            expires_at: null,
            chargebee_status: subscription.status
        });

        logger.info(`Addon subscription reactivated:`, subscription.id);
        
    } catch (error) {
        logger.error('Error handling addon subscription reactivated:', error);
        throw error;
    }
}

async function handleAddonPaymentFailed(event) {
    const subscription = event.content.subscription;
    
    try {
        // Set grace period status
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 3);
        
        await contextAddonService.updateAddonStatus(subscription.id, 'grace_period', {
            expires_at: expiresAt,
            chargebee_status: subscription.status
        });

        logger.warn(`Addon payment failed - grace period started:`, subscription.id);
        
    } catch (error) {
        logger.error('Error handling addon payment failed:', error);
        throw error;
    }
}

// ==================== UTILITY ROUTES ====================

// GET /api/addons/checkout-status/:checkoutId - Check checkout completion status
router.get('/api/addons/checkout-status/:checkoutId', authenticateToken, async (req, res) => {
    try {
        const checkoutId = req.params.checkoutId;
        
        if (!chargebee) {
            return res.status(500).json({
                success: false,
                error: 'Chargebee not configured'
            });
        }

        const result = await new Promise((resolve, reject) => {
            chargebee.hosted_page.retrieve(checkoutId).request((error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });

        res.json({
            success: true,
            status: result.hosted_page.state,
            subscription_id: result.hosted_page.content?.subscription?.id
        });

    } catch (error) {
        logger.error('Checkout status check error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check checkout status'
        });
    }
});

module.exports = router;
