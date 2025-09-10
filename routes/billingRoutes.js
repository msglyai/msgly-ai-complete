// routes/billingRoutes.js - Chargebee Webhook and Checkout Routes
// Exact copies from server.js with same middleware and logic

const express = require('express');
const router = express.Router();

// Import authentication middleware - same as server.js
const { authenticateToken } = require('../middleware/auth');

// Import Chargebee service
const { chargebeeService } = require('../services/chargebeeService');

// Import plan mapping
const { CHARGEBEE_PLAN_MAPPING } = require('../config/billing');

// Import webhook handlers
const {
    handleSubscriptionCreated,
    handleSubscriptionActivated,
    handleSubscriptionCancellationScheduled,
    handleSubscriptionCancelled,
    handleInvoiceGenerated,
    handlePaymentSucceeded
} = require('../controllers/billingController');

// 🔧 PAYG CRITICAL FIX: Enhanced Chargebee Webhook Handler with payment_succeeded support and proper plan detection + ✅ CANCELLATION FIX
router.post('/chargebee-webhook', express.json(), async (req, res) => {
    try {
        console.log('[WEBHOOK] Chargebee webhook received');
        
        const event = req.body;
        const eventType = event.event_type;
        
        console.log(`[WEBHOOK] Event type: ${eventType}`);
        
        switch (eventType) {
            case 'subscription_created':
                await handleSubscriptionCreated(event.content.subscription, event.content.customer);
                break;
            case 'subscription_activated':
                await handleSubscriptionActivated(event.content.subscription, event.content.customer);
                break;
            case 'invoice_generated':
                await handleInvoiceGenerated(event.content.invoice, event.content.subscription);
                break;
            case 'payment_succeeded':
                // PAYG FIX: Handle payment_succeeded events as backup
                await handlePaymentSucceeded(event.content.payment, event.content.invoice);
                break;
            // ✅ CANCELLATION FIX: New webhook handlers
            case 'subscription_cancellation_scheduled':
                await handleSubscriptionCancellationScheduled(event.content.subscription, event.content.customer);
                break;
            case 'subscription_cancelled':
                await handleSubscriptionCancelled(event.content.subscription, event.content.customer);
                break;
            default:
                console.log(`[WEBHOOK] Unhandled event type: ${eventType}`);
        }
        
        res.status(200).json({ 
            success: true,
            message: 'Webhook processed successfully'
        });
    } catch (error) {
        console.error('[WEBHOOK] Error processing webhook:', error);
        res.status(500).json({ 
            success: false,
            error: 'Webhook processing failed' 
        });
    }
});

// NEW: Create Chargebee Checkout
router.post('/create-checkout', authenticateToken, async (req, res) => {
    try {
        const { planId } = req.body;
        const userId = req.user.id;
        
        console.log(`[CHECKOUT] Creating checkout for user ${userId}, plan ${planId}`);
        
        if (!planId) {
            return res.status(400).json({
                success: false,
                error: 'Plan ID is required'
            });
        }
        
        // Validate plan ID
        if (!CHARGEBEE_PLAN_MAPPING[planId]) {
            return res.status(400).json({
                success: false,
                error: 'Invalid plan ID'
            });
        }
        
        // Create Chargebee checkout
        const checkout = await chargebeeService.createCheckout({
            planId: planId,
            customerEmail: req.user.email,
            customerName: req.user.display_name,
            successUrl: 'https://api.msgly.ai/dashboard?upgrade=success',
            cancelUrl: 'https://api.msgly.ai/dashboard?upgrade=cancelled'
        });
        
        if (!checkout.success) {
            console.error('[CHECKOUT] Checkout creation failed:', checkout.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to create checkout session',
                details: checkout.error
            });
        }
        
        console.log(`[CHECKOUT] Checkout created successfully`);
        
        res.json({
            success: true,
            message: 'Checkout session created successfully',
            data: {
                checkoutUrl: checkout.checkoutUrl,
                hostedPageId: checkout.hostedPageId,
                planId: planId
            }
        });
        
    } catch (error) {
        console.error('[CHECKOUT] Error creating checkout:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create checkout session',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;
