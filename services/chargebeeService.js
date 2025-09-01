// services/chargebeeService.js - Enhanced Chargebee Service with Silver Plan Integration
// STEP 8A: Added checkout creation, plan management, and subscription handling
// Preserves all existing functionality while adding Silver plan support
// FIXED: Updated createCheckout method for Product Catalog 2.0

const chargebee = require('chargebee');
require('dotenv').config();

console.log('[CHARGEBEE] Environment check:');
console.log('[CHARGEBEE] CHARGEBEE_SITE:', process.env.CHARGEBEE_SITE);
console.log('[CHARGEBEE] CHARGEBEE_API_KEY:', process.env.CHARGEBEE_API_KEY ? 'Set' : 'Not Set');

// Initialize Chargebee
try {
    chargebee.configure({
        site: process.env.CHARGEBEE_SITE,
        api_key: process.env.CHARGEBEE_API_KEY
    });
    console.log('[CHARGEBEE] ✅ SDK configured successfully');
} catch (error) {
    console.log('[CHARGEBEE] ❌ SDK configuration failed:', error.message);
}

// STEP 8A: Plan mapping between Chargebee and database
const CHARGEBEE_PLAN_MAPPING = {
    'Silver-Monthly': {
        planCode: 'silver-monthly',
        renewableCredits: 30,
        billingModel: 'monthly',
        displayName: 'Silver Monthly'
    },
    'Silver-PAYG': {
        planCode: 'silver-payasyougo', 
        payasyougoCredits: 30,
        billingModel: 'one_time',
        displayName: 'Silver Pay-as-you-go'
    },
    // Future plans can be added here
    'Gold-Monthly': {
        planCode: 'gold-monthly',
        renewableCredits: 100,
        billingModel: 'monthly',
        displayName: 'Gold Monthly'
    },
    'Platinum-Monthly': {
        planCode: 'platinum-monthly',
        renewableCredits: 250,
        billingModel: 'monthly', 
        displayName: 'Platinum Monthly'
    }
};

class ChargebeeService {
    constructor() {
        this.isConfigured = false;
        this.planMapping = CHARGEBEE_PLAN_MAPPING;
        console.log('[CHARGEBEE] Service initialized with Silver plan support');
    }

    // EXISTING METHOD: Test connection using Product Catalog 2.0 API (preserved)
    async testConnection() {
        try {
            console.log('[CHARGEBEE] Testing connection with item list (Product Catalog 2.0)...');
            
            // Use Product Catalog 2.0 API - item.list instead of plan.list
            const result = await chargebee.item.list({
                limit: 1
            }).request();
            
            console.log('[CHARGEBEE] ✅ Connection successful!');
            console.log('[CHARGEBEE] Result:', JSON.stringify(result, null, 2));
            
            this.isConfigured = true;
            return {
                success: true,
                message: '✅ Chargebee connection successful!',
                data: {
                    siteName: process.env.CHARGEBEE_SITE,
                    itemsCount: result.list ? result.list.length : 0,
                    isConfigured: true,
                    testMethod: 'item.list (Product Catalog 2.0)',
                    productCatalogVersion: '2.0'
                }
            };
        } catch (error) {
            console.log('[CHARGEBEE] ❌ Connection failed:', error.message);
            console.log('[CHARGEBEE] Error details:', error);
            
            // Try alternative method if item.list fails
            if (error.message.includes('product catalog')) {
                console.log('[CHARGEBEE] Trying alternative method...');
                return await this.testConnectionAlternative();
            }
            
            this.isConfigured = false;
            return {
                success: false,
                message: '❌ Chargebee connection failed',
                error: error.message,
                details: {
                    site: process.env.CHARGEBEE_SITE,
                    hasApiKey: !!process.env.CHARGEBEE_API_KEY,
                    errorType: error.type || 'Unknown',
                    statusCode: error.http_status_code || 'N/A',
                    productCatalogIssue: true
                }
            };
        }
    }

    // EXISTING METHOD: Alternative test method (preserved)
    async testConnectionAlternative() {
        try {
            console.log('[CHARGEBEE] Testing with item_price list (Product Catalog 2.0)...');
            
            const result = await chargebee.item_price.list({
                limit: 1
            }).request();
            
            return {
                success: true,
                message: '✅ Chargebee connection successful (alternative method)!',
                data: {
                    siteName: process.env.CHARGEBEE_SITE,
                    testMethod: 'item_price.list (Product Catalog 2.0)',
                    isConfigured: true,
                    productCatalogVersion: '2.0'
                }
            };
        } catch (error) {
            console.log('[CHARGEBEE] ❌ Alternative test also failed:', error.message);
            
            // Try the simplest possible test - customer list (works with both catalog versions)
            try {
                console.log('[CHARGEBEE] Trying final fallback with customer list...');
                const customerResult = await chargebee.customer.list({
                    limit: 1
                }).request();
                
                return {
                    success: true,
                    message: '✅ Chargebee connection successful (customer list method)!',
                    data: {
                        siteName: process.env.CHARGEBEE_SITE,
                        testMethod: 'customer.list (fallback)',
                        isConfigured: true,
                        note: 'Items/prices may need Product Catalog 2.0 setup'
                    }
                };
            } catch (finalError) {
                console.log('[CHARGEBEE] ❌ All test methods failed');
                throw finalError;
            }
        }
    }

    // FIXED: Create checkout session for Silver plans - UPDATED FOR PRODUCT CATALOG 2.0
    async createCheckout(options) {
        try {
            console.log('[CHARGEBEE] Creating checkout session for Product Catalog 2.0...', {
                planId: options.planId,
                customerEmail: options.customerEmail
            });

            // Validate plan ID
            if (!this.planMapping[options.planId]) {
                throw new Error(`Unknown plan ID: ${options.planId}`);
            }

            const planInfo = this.planMapping[options.planId];
            
            // FIXED: Use Product Catalog 2.0 API - checkout_new_for_items instead of checkout_new
            const result = await chargebee.hosted_page.checkout_new_for_items({
                subscription_items: [{
                    item_price_id: options.planId  // Use item_price_id for Product Catalog 2.0
                }],
                customer: {
                    email: options.customerEmail,
                    first_name: options.customerName || options.customerEmail.split('@')[0]
                },
                redirect_url: options.successUrl || 'https://api.msgly.ai/dashboard?upgrade=success',
                cancel_url: options.cancelUrl || 'https://api.msgly.ai/dashboard?upgrade=cancelled'
            }).request();

            console.log('[CHARGEBEE] ✅ Checkout created successfully (Product Catalog 2.0)');
            
            return {
                success: true,
                checkoutUrl: result.hosted_page.url,
                hostedPageId: result.hosted_page.id,
                planInfo: planInfo
            };

        } catch (error) {
            console.error('[CHARGEBEE] ❌ Checkout creation failed:', error);
            return {
                success: false,
                error: error.message,
                details: error
            };
        }
    }

    // NEW METHOD: Get available plans
    async getPlans() {
        try {
            console.log('[CHARGEBEE] Retrieving available plans...');
            
            // For now, return our mapped plans
            // In production, you might want to fetch from Chargebee directly
            const availablePlans = Object.entries(this.planMapping).map(([chargebeePlanId, planInfo]) => ({
                chargebeePlanId,
                ...planInfo,
                active: true
            }));

            return {
                success: true,
                plans: availablePlans
            };

        } catch (error) {
            console.error('[CHARGEBEE] ❌ Failed to get plans:', error);
            return {
                success: false,
                error: error.message,
                plans: []
            };
        }
    }

    // NEW METHOD: Handle subscription events (for webhook processing)
    async handleSubscriptionEvent(eventType, subscription, customer) {
        try {
            console.log('[CHARGEBEE] Processing subscription event:', eventType);
            
            const planId = subscription.plan_id;
            const planInfo = this.planMapping[planId];
            
            if (!planInfo) {
                console.warn('[CHARGEBEE] ⚠️ Unknown plan ID in subscription:', planId);
                return {
                    success: false,
                    error: `Unknown plan: ${planId}`
                };
            }

            return {
                success: true,
                eventType,
                planInfo,
                subscription: {
                    id: subscription.id,
                    planId: subscription.plan_id,
                    status: subscription.status,
                    startedAt: subscription.started_at,
                    nextBillingAt: subscription.next_billing_at,
                    customerId: subscription.customer_id
                },
                customer: {
                    id: customer?.id,
                    email: customer?.email,
                    firstName: customer?.first_name
                }
            };

        } catch (error) {
            console.error('[CHARGEBEE] ❌ Error processing subscription event:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // NEW METHOD: Validate webhook signature (for security)
    validateWebhookSignature(payload, signature) {
        try {
            // In production, implement proper webhook signature validation
            // For testing, we'll skip signature validation
            console.log('[CHARGEBEE] Webhook signature validation (test mode)');
            return true;

        } catch (error) {
            console.error('[CHARGEBEE] ❌ Webhook signature validation failed:', error);
            return false;
        }
    }

    // NEW METHOD: Get plan info by Chargebee plan ID
    getPlanInfo(chargebeePlanId) {
        return this.planMapping[chargebeePlanId] || null;
    }

    // NEW METHOD: Get all mapped plan IDs
    getMappedPlanIds() {
        return Object.keys(this.planMapping);
    }

    // NEW METHOD: Check if service is ready for production
    isProductionReady() {
        return this.isConfigured && 
               process.env.CHARGEBEE_SITE && 
               process.env.CHARGEBEE_API_KEY;
    }
}

const chargebeeService = new ChargebeeService();

// Export both the service instance and plan mapping
module.exports = {
    chargebeeService,
    CHARGEBEE_PLAN_MAPPING
};
