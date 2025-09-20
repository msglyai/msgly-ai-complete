// controllers/billingController.js - Chargebee Webhook Handlers
// Exact copies from server.js with same imports and logic

// Import dependencies used by webhook handlers
const {
    pool,
    getUserByEmail,
    getPendingRegistration,
    completePendingRegistration,
    downgradeUserToFree,
    // CONTEXT FIX: Add missing context slot functions
    getContextAddonUsage,
    createContextAddon,
    updateUserContextSlots,
    initializeContextSlots
} = require('../utils/database');

// ✅ ADMIN NOTIFICATIONS: Import both email functions
const { sendWelcomeEmail, sendAdminNotification } = require('../mailer/mailer');
const { CHARGEBEE_PLAN_MAPPING } = require('../config/billing');

// CONTEXT ADDON FIX: Add Context addon to plan mapping
const EXTENDED_PLAN_MAPPING = {
    ...CHARGEBEE_PLAN_MAPPING,
    // Add Context addon mapping
    'Context-Addon-Monthly-USD-Monthly': {
        planCode: 'context-addon',
        addonType: 'context-slot',
        billingModel: 'monthly',
        extraContextSlots: 1,
        price: 3.99,
        displayName: 'Extra Context Slot'
    }
};

// ENHANCED: CHARGEBEE WEBHOOK HANDLER FUNCTIONS - Now with automatic registration completion
async function handleSubscriptionCreated(subscription, customer) {
    try {
        console.log('[WEBHOOK] Processing subscription_created');
        
        // Extract plan from subscription_items array instead of subscription.plan_id
        const planItem = subscription.subscription_items?.find(item => item.item_type === 'plan');
        const planId = planItem?.item_price_id;
        
        // Find user by email
        const user = await getUserByEmail(customer.email);
        if (!user) {
            console.error('[WEBHOOK] User not found:', customer.email);
            return;
        }
        
        // Map Chargebee plan to database plan - USE EXTENDED MAPPING
        const planMapping = EXTENDED_PLAN_MAPPING[planId];
        if (!planMapping) {
            console.error('[WEBHOOK] Unknown plan ID:', planId);
            return;
        }
        
        // CONTEXT ADDON FIX: Handle Context addons differently
        if (planMapping.addonType === 'context-slot') {
            console.log(`[WEBHOOK] Processing Context addon subscription for user ${user.id}`);
            
            // Add extra context slots instead of changing plan
            try {
                await updateUserContextSlots(user.id, planMapping.extraContextSlots);
                
                // Create addon record
                await createContextAddon(user.id, {
                    addonType: planMapping.addonType,
                    extraSlots: planMapping.extraContextSlots,
                    chargebeeSubscriptionId: subscription.id,
                    price: planMapping.price,
                    billingModel: planMapping.billingModel
                });
                
                console.log(`[WEBHOOK] Context addon processed: ${planMapping.extraContextSlots} extra slots added to user ${user.id}`);
                
                // ✅ ADMIN NOTIFICATIONS: Context addon purchase notification
                try {
                    console.log(`[ADMIN] Sending admin notification for context addon purchase: ${user.email}`);
                    
                    const adminResult = await sendAdminNotification({
                        userEmail: user.email,
                        userName: user.display_name,
                        packageType: `Context Addon (${planMapping.displayName})`,
                        billingModel: planMapping.billingModel,
                        linkedinUrl: user.linkedin_url,
                        userId: user.id
                    });
                    
                    if (adminResult.ok) {
                        console.log(`[ADMIN] Context addon admin notification sent successfully: ${adminResult.messageId}`);
                    } else {
                        console.error(`[ADMIN] Context addon admin notification failed: ${adminResult.error}`);
                    }
                } catch (adminError) {
                    console.error('[ADMIN] Non-blocking context addon admin notification error:', adminError);
                }
                
            } catch (contextError) {
                console.error('[WEBHOOK] Context addon processing failed:', contextError);
            }
        } else {
            // Regular plan subscription
            let planCode = planMapping.planCode;
            let renewableCredits = planMapping.renewableCredits || 0;
            let payasyougoCredits = planMapping.payasyougoCredits || 0;
            
            // Update user subscription
            await pool.query(`
                UPDATE users 
                SET 
                    plan_code = $1,
                    renewable_credits = $2,
                    payasyougo_credits = COALESCE(payasyougo_credits, 0) + $3,
                    subscription_starts_at = $4,
                    next_billing_date = $5,
                    chargebee_subscription_id = $6,
                    subscription_status = 'active',
                    updated_at = NOW()
                WHERE id = $7
            `, [
                planCode,
                renewableCredits,
                payasyougoCredits,
                new Date(subscription.started_at * 1000),
                subscription.next_billing_at ? new Date(subscription.next_billing_at * 1000) : null,
                subscription.id,
                user.id
            ]);
            
            console.log(`[WEBHOOK] User ${user.id} upgraded to ${planCode}`);

            // ✅ ADMIN NOTIFICATIONS: Monthly subscription notification
            try {
                console.log(`[ADMIN] Sending admin notification for subscription: ${user.email}`);
                
                const adminResult = await sendAdminNotification({
                    userEmail: user.email,
                    userName: user.display_name,
                    packageType: planMapping.displayName || planCode,
                    billingModel: 'monthly',
                    linkedinUrl: user.linkedin_url,
                    userId: user.id
                });
                
                if (adminResult.ok) {
                    console.log(`[ADMIN] Subscription admin notification sent successfully: ${adminResult.messageId}`);
                } else {
                    console.error(`[ADMIN] Subscription admin notification failed: ${adminResult.error}`);
                }
            } catch (adminError) {
                console.error('[ADMIN] Non-blocking subscription admin notification error:', adminError);
            }
        }
        
        // NEW: Check for pending registration and complete it automatically
        const pendingReg = await getPendingRegistration(user.id);
        if (pendingReg.success && pendingReg.data) {
            console.log('[WEBHOOK] Found pending registration, completing automatically...');
            
            const completionResult = await completePendingRegistration(user.id, pendingReg.data.linkedin_url);
            if (completionResult.success) {
                console.log('[WEBHOOK] Registration completed automatically after subscription');
            } else {
                console.error('[WEBHOOK] Failed to complete pending registration:', completionResult.error);
            }
        }
        
        // NEW: Send welcome email for paid users (NON-BLOCKING)
        try {
            // Check if welcome email already sent
            const emailCheck = await pool.query(
                'SELECT welcome_email_sent FROM users WHERE id = $1',
                [user.id]
            );
            
            if (emailCheck.rows.length > 0 && !emailCheck.rows[0].welcome_email_sent) {
                const emailResult = await sendWelcomeEmail({
                    toEmail: user.email,
                    toName: user.display_name,
                    userId: user.id
                });
                
                if (emailResult.ok) {
                    // Mark as sent
                    await pool.query(
                        'UPDATE users SET welcome_email_sent = true WHERE id = $1',
                        [user.id]
                    );
                    
                    console.log(`[MAILER] Welcome email sent successfully`);
                }
            }
        } catch (emailError) {
            console.error('[MAILER] Non-blocking email error:', emailError);
            // Don't fail the webhook - email is not critical
        }
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling subscription_created:', error);
    }
}

async function handleSubscriptionActivated(subscription, customer) {
    try {
        console.log('[WEBHOOK] Processing subscription_activated');
        
        // Find user by Chargebee subscription ID or email
        let user = await pool.query(`
            SELECT * FROM users 
            WHERE chargebee_subscription_id = $1 OR email = $2
        `, [subscription.id, customer.email]);
        
        if (user.rows.length === 0) {
            console.error('[WEBHOOK] User not found for subscription activation:', customer.email);
            return;
        }
        
        user = user.rows[0];
        
        // Update subscription status
        await pool.query(`
            UPDATE users 
            SET 
                subscription_status = 'active',
                chargebee_subscription_id = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [subscription.id, user.id]);
        
        console.log(`[WEBHOOK] Subscription activated for user ${user.id}`);
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling subscription_activated:', error);
    }
}

// ✅ CANCELLATION FIX: New webhook handler for subscription_cancellation_scheduled
async function handleSubscriptionCancellationScheduled(subscription, customer) {
    try {
        console.log('[WEBHOOK] Processing subscription_cancellation_scheduled');
        
        // Find user by email
        const user = await getUserByEmail(customer.email);
        if (!user) {
            console.error('[WEBHOOK] User not found:', customer.email);
            return;
        }
        
        // Store cancellation scheduled date and effective date, keep plan active
        await pool.query(`
            UPDATE users 
            SET 
                cancellation_scheduled_at = NOW(),
                cancellation_effective_date = $1,
                previous_plan_code = plan_code,
                updated_at = NOW()
            WHERE id = $2
        `, [
            new Date(subscription.current_term_end * 1000), // When cancellation becomes effective
            user.id
        ]);
        
        console.log(`[WEBHOOK] Cancellation scheduled for user ${user.id}, effective: ${new Date(subscription.current_term_end * 1000)}`);
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling subscription_cancellation_scheduled:', error);
    }
}

// ✅ CANCELLATION FIX: New webhook handler for subscription_cancelled
async function handleSubscriptionCancelled(subscription, customer) {
    try {
        console.log('[WEBHOOK] Processing subscription_cancelled');
        
        // Find user by email
        const user = await getUserByEmail(customer.email);
        if (!user) {
            console.error('[WEBHOOK] User not found:', customer.email);
            return;
        }
        
        // Immediately downgrade user to free plan
        const downgradeResult = await downgradeUserToFree(user.id);
        
        if (downgradeResult.success) {
            console.log(`[WEBHOOK] User ${user.id} successfully downgraded to free plan`);
        } else {
            console.error(`[WEBHOOK] Failed to downgrade user ${user.id}:`, downgradeResult.error);
        }
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling subscription_cancelled:', error);
    }
}

// 🔧 PAYG CRITICAL FIX + CONTEXT ADDON FIX: Enhanced invoice_generated handler 
async function handleInvoiceGenerated(invoice, subscription) {
    try {
        console.log('[WEBHOOK] Processing invoice_generated');
        console.log('[WEBHOOK] Invoice status:', invoice.status);
        console.log('[WEBHOOK] Invoice customer_id:', invoice.customer_id);
        console.log('[WEBHOOK] Invoice recurring:', invoice.recurring);
        
        // Check if this is a paid invoice
        if (invoice.status !== 'paid') {
            console.log('[WEBHOOK] Invoice not paid, skipping processing');
            return;
        }
        
        // Handle BOTH cases - subscription renewals AND one-time purchases
        if (subscription) {
            // CASE 1: Subscription renewal (Monthly plans)
            const user = await pool.query(`
                SELECT * FROM users 
                WHERE chargebee_subscription_id = $1
            `, [subscription.id]);
            
            if (user.rows.length === 0) {
                console.error('[WEBHOOK] User not found for subscription invoice:', subscription.id);
                return;
            }
            
            const userData = user.rows[0];
            console.log(`[WEBHOOK] Subscription renewal for user ${userData.id}`);
            
            // Extract plan from subscription_items for renewal
            const planItem = subscription.subscription_items?.find(item => item.item_type === 'plan');
            const planId = planItem?.item_price_id;
            
            if (planId) {
                const planMapping = EXTENDED_PLAN_MAPPING[planId];
                if (planMapping) {
                    // CONTEXT ADDON FIX: Handle Context addon renewals
                    if (planMapping.addonType === 'context-slot') {
                        console.log(`[WEBHOOK] Processing Context addon renewal for user ${userData.id}`);
                        // Context addons don't need renewal processing - slots are persistent
                        console.log(`[WEBHOOK] Context addon renewal processed (no action needed)`);
                    } else if (planMapping.billingModel === 'monthly') {
                        // Reset renewable credits for monthly subscription
                        await pool.query(`
                            UPDATE users 
                            SET 
                                renewable_credits = $1,
                                next_billing_date = $2,
                                updated_at = NOW()
                            WHERE id = $3
                        `, [
                            planMapping.renewableCredits,
                            subscription.next_billing_at ? new Date(subscription.next_billing_at * 1000) : null,
                            userData.id
                        ]);
                        
                        console.log(`[WEBHOOK] Renewable credits reset for user ${userData.id}`);
                    }
                }
            }
            
        } else if (invoice.recurring === false || !subscription) {
            // CASE 2: One-time purchase (PAYG plans + Context addons) - FIXED VERSION
            console.log('[WEBHOOK] Processing one-time purchase');
            console.log('[WEBHOOK] Looking for customer with ID:', invoice.customer_id);
            
            // PAYG FIX: Proper customer resolution for one-time purchases
            let user = null;
            
            // Method 1: Try to find user by chargebee_customer_id first
            if (invoice.customer_id) {
                const userByCustomerId = await pool.query(`
                    SELECT * FROM users 
                    WHERE chargebee_customer_id = $1
                `, [invoice.customer_id]);
                
                if (userByCustomerId.rows.length > 0) {
                    user = userByCustomerId.rows[0];
                    console.log(`[WEBHOOK] Found user by customer_id: ${user.email}`);
                }
            }
            
            // Method 2: If not found, get customer details from Chargebee API
            if (!user && invoice.customer_id) {
                try {
                    console.log('[WEBHOOK] Fetching customer details from Chargebee API...');
                    const chargebee = require('chargebee');
                    
                    const customerResponse = await chargebee.customer.retrieve(invoice.customer_id).request();
                    const customer = customerResponse.customer;
                    
                    console.log('[WEBHOOK] Customer email from API:', customer.email);
                    
                    if (customer.email) {
                        user = await getUserByEmail(customer.email);
                        if (user) {
                            console.log(`[WEBHOOK] Found user by email lookup: ${user.email}`);
                            
                            // Update user with Chargebee customer ID for future lookups
                            await pool.query(`
                                UPDATE users 
                                SET chargebee_customer_id = $1 
                                WHERE id = $2
                            `, [invoice.customer_id, user.id]);
                        }
                    }
                } catch (apiError) {
                    console.error('[WEBHOOK] Failed to fetch customer from Chargebee API:', apiError.message);
                }
            }
            
            if (!user) {
                console.error('[WEBHOOK] Cannot find user for one-time purchase:', invoice.customer_id);
                return;
            }
            
            console.log(`[WEBHOOK] Processing one-time purchase for user ${user.id} (${user.email})`);
            
            // CONTEXT ADDON FIX: Enhanced plan detection for Context addons + PAYG plans
            const planLineItem = invoice.line_items?.find(item => {
                // Handle both regular plans and PAYG charges
                const isValidEntityType = (
                    item.entity_type === 'plan_item_price' ||  // Monthly subscription plans
                    item.entity_type === 'charge_item_price'   // PAYG/one-time charges
                );
                
                const hasValidEntityId = item.entity_id && EXTENDED_PLAN_MAPPING[item.entity_id];
                
                return isValidEntityType && hasValidEntityId;
            });
            
            const planId = planLineItem?.entity_id;  // Use entity_id instead of item_price_id
            
            if (planId) {
                const planMapping = EXTENDED_PLAN_MAPPING[planId];
                
                // CONTEXT ADDON FIX: Handle Context addon purchases
                if (planMapping.addonType === 'context-slot') {
                    console.log(`[WEBHOOK] Processing Context addon purchase for user ${user.id}`);
                    
                    try {
                        // Add extra context slots
                        await updateUserContextSlots(user.id, planMapping.extraContextSlots);
                        
                        // Create addon record
                        await createContextAddon(user.id, {
                            addonType: planMapping.addonType,
                            extraSlots: planMapping.extraContextSlots,
                            chargebeeCustomerId: invoice.customer_id,
                            price: planMapping.price,
                            billingModel: planMapping.billingModel,
                            invoiceId: invoice.id
                        });
                        
                        console.log(`[WEBHOOK] Context addon purchase processed: ${planMapping.extraContextSlots} extra slots added to user ${user.id}`);

                        // ✅ ADMIN NOTIFICATIONS: Context addon one-time purchase notification
                        try {
                            console.log(`[ADMIN] Sending admin notification for context addon one-time purchase: ${user.email}`);
                            
                            const adminResult = await sendAdminNotification({
                                userEmail: user.email,
                                userName: user.display_name,
                                packageType: `Context Addon PAYG (${planMapping.displayName})`,
                                billingModel: 'one-time',
                                linkedinUrl: user.linkedin_url,
                                userId: user.id
                            });
                            
                            if (adminResult.ok) {
                                console.log(`[ADMIN] Context addon PAYG admin notification sent successfully: ${adminResult.messageId}`);
                            } else {
                                console.error(`[ADMIN] Context addon PAYG admin notification failed: ${adminResult.error}`);
                            }
                        } catch (adminError) {
                            console.error('[ADMIN] Non-blocking context addon PAYG admin notification error:', adminError);
                        }
                        
                    } catch (contextError) {
                        console.error('[WEBHOOK] Context addon purchase processing failed:', contextError);
                    }
                    
                } else if (planMapping.billingModel === 'one_time') {
                    // Regular PAYG purchase
                    console.log(`[WEBHOOK] Adding ${planMapping.payasyougoCredits} PAYG credits to user ${user.id}`);
                    
                    // ✅ PAYG FIX: Add credits only, never change plan_code
                    const updateResult = await pool.query(`
                        UPDATE users 
                        SET 
                            payasyougo_credits = COALESCE(payasyougo_credits, 0) + $1,
                            chargebee_customer_id = $2,
                            updated_at = NOW()
                        WHERE id = $3
                        RETURNING payasyougo_credits, renewable_credits
                    `, [
                        planMapping.payasyougoCredits,
                        invoice.customer_id,
                        user.id
                    ]);
                    
                    if (updateResult.rows.length > 0) {
                        const updatedCredits = updateResult.rows[0];
                        console.log(`[WEBHOOK] PAYG credits added for user ${user.id}`);
                        console.log(`[WEBHOOK] New PAYG credits: ${updatedCredits.payasyougo_credits}`);
                        console.log(`[WEBHOOK] Renewable credits: ${updatedCredits.renewable_credits}`);

                        // ✅ ADMIN NOTIFICATIONS: PAYG purchase notification
                        try {
                            console.log(`[ADMIN] Sending admin notification for PAYG purchase: ${user.email}`);
                            
                            const adminResult = await sendAdminNotification({
                                userEmail: user.email,
                                userName: user.display_name,
                                packageType: `${planMapping.displayName || planId} PAYG`,
                                billingModel: 'one-time',
                                linkedinUrl: user.linkedin_url,
                                userId: user.id
                            });
                            
                            if (adminResult.ok) {
                                console.log(`[ADMIN] PAYG admin notification sent successfully: ${adminResult.messageId}`);
                            } else {
                                console.error(`[ADMIN] PAYG admin notification failed: ${adminResult.error}`);
                            }
                        } catch (adminError) {
                            console.error('[ADMIN] Non-blocking PAYG admin notification error:', adminError);
                        }
                    }
                }
                
                // Common processing for all one-time purchases
                
                // NEW: Check for pending registration and complete it automatically
                const pendingReg = await getPendingRegistration(user.id);
                if (pendingReg.success && pendingReg.data) {
                    console.log('[WEBHOOK] Found pending registration, completing automatically...');
                    
                    const completionResult = await completePendingRegistration(user.id, pendingReg.data.linkedin_url);
                    if (completionResult.success) {
                        console.log('[WEBHOOK] Registration completed automatically after purchase');
                    } else {
                        console.error('[WEBHOOK] Failed to complete pending registration:', completionResult.error);
                    }
                }
                
                // NEW: Send welcome email for one-time purchase users (NON-BLOCKING)
                try {
                    // Check if welcome email already sent
                    const emailCheck = await pool.query(
                        'SELECT welcome_email_sent FROM users WHERE id = $1',
                        [user.id]
                    );
                    
                    if (emailCheck.rows.length > 0 && !emailCheck.rows[0].welcome_email_sent) {
                        const emailResult = await sendWelcomeEmail({
                            toEmail: user.email,
                            toName: user.display_name,
                            userId: user.id
                        });
                        
                        if (emailResult.ok) {
                            // Mark as sent
                            await pool.query(
                                'UPDATE users SET welcome_email_sent = true WHERE id = $1',
                                [user.id]
                            );
                            
                            console.log(`[MAILER] Welcome email sent successfully for one-time purchase`);
                        }
                    }
                } catch (emailError) {
                    console.error('[MAILER] Non-blocking email error:', emailError);
                    // Don't fail the webhook - email is not critical
                }
                
            } else {
                console.log('[WEBHOOK] No matching plan found in line_items');
                console.log('[WEBHOOK] Available line_items:', JSON.stringify(invoice.line_items?.map(item => ({
                    entity_type: item.entity_type,
                    entity_id: item.entity_id,
                    description: item.description
                })), null, 2));
            }
        }
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling invoice_generated:', error);
    }
}

// PAYG FIX: New payment_succeeded handler as backup
async function handlePaymentSucceeded(payment, invoice) {
    try {
        console.log('[WEBHOOK] Processing payment_succeeded');
        console.log('[WEBHOOK] Payment customer_id:', payment.customer_id);
        console.log('[WEBHOOK] Invoice ID:', invoice?.id);
        
        // For one-time purchases, sometimes payment_succeeded has better customer info
        if (payment.customer_id && invoice && invoice.recurring === false) {
            console.log('[WEBHOOK] Payment succeeded for one-time purchase, ensuring user update...');
            
            // Find user by customer ID
            const user = await pool.query(`
                SELECT id, email, payasyougo_credits, plan_code FROM users 
                WHERE chargebee_customer_id = $1
            `, [payment.customer_id]);
            
            if (user.rows.length > 0) {
                const userData = user.rows[0];
                console.log(`[WEBHOOK] Payment success confirmed for user ${userData.id}`);
                console.log(`[WEBHOOK] Current PAYG credits: ${userData.payasyougo_credits}`);
                
                // If credits are still 0, something went wrong with invoice_generated
                if (userData.payasyougo_credits === 0 || userData.payasyougo_credits === "0") {
                    console.log('[WEBHOOK] PAYG credits are 0, attempting recovery...');
                    
                    // CONTEXT ADDON FIX: Use enhanced plan detection in recovery as well
                    if (invoice.line_items) {
                        const planLineItem = invoice.line_items.find(item => {
                            const isValidEntityType = (
                                item.entity_type === 'plan_item_price' ||
                                item.entity_type === 'charge_item_price'
                            );
                            const hasValidEntityId = item.entity_id && EXTENDED_PLAN_MAPPING[item.entity_id];
                            return isValidEntityType && hasValidEntityId;
                        });
                        
                        if (planLineItem) {
                            const planMapping = EXTENDED_PLAN_MAPPING[planLineItem.entity_id];
                            
                            // Handle Context addon recovery
                            if (planMapping.addonType === 'context-slot') {
                                console.log('[WEBHOOK] Recovery: Processing Context addon via payment_succeeded');
                                
                                try {
                                    await updateUserContextSlots(userData.id, planMapping.extraContextSlots);
                                    console.log('[WEBHOOK] Recovery: Context addon processed successfully');
                                } catch (contextError) {
                                    console.error('[WEBHOOK] Recovery: Context addon processing failed:', contextError);
                                }
                                
                            } else if (planMapping.billingModel === 'one_time') {
                                console.log('[WEBHOOK] Recovery: Adding PAYG credits via payment_succeeded');
                                
                                // ✅ PAYG FIX: Add credits only, never change plan_code (recovery)
                                await pool.query(`
                                    UPDATE users 
                                    SET 
                                        payasyougo_credits = COALESCE(payasyougo_credits, 0) + $1,
                                        updated_at = NOW()
                                    WHERE id = $2
                                `, [
                                    planMapping.payasyougoCredits,
                                    userData.id
                                ]);
                                
                                console.log('[WEBHOOK] Recovery successful: PAYG credits added');
                            }
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling payment_succeeded:', error);
    }
}

module.exports = {
    handleSubscriptionCreated,
    handleSubscriptionActivated,
    handleSubscriptionCancellationScheduled,
    handleSubscriptionCancelled,
    handleInvoiceGenerated,
    handlePaymentSucceeded
};
