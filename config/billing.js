// config/billing.js - Chargebee Plan Mapping Configuration
// Exact 1:1 copy from server.js CHARGEBEE_PLAN_MAPPING

const CHARGEBEE_PLAN_MAPPING = {
    'Silver-Monthly': {
        planCode: 'silver-monthly',
        renewableCredits: 30,
        billingModel: 'monthly'
    },
    'Silver-PAYG-USD': {  // FIXED: Changed from 'Silver-PAYG' to 'Silver-PAYG-USD'
        planCode: 'silver-payasyougo', 
        payasyougoCredits: 30,
        billingModel: 'one_time'
    },
    // NEW: Gold and Platinum plans
    'Gold-Monthly': {
        planCode: 'gold-monthly',
        renewableCredits: 100,
        billingModel: 'monthly'
    },
    'Platinum-Monthly': {
        planCode: 'platinum-monthly',
        renewableCredits: 250,
        billingModel: 'monthly'
    },
    // ✅ MINIMAL PAYG ADDITION: Gold and Platinum PAYG plans
    'Gold-PAYG-USD': {
        planCode: 'gold-payasyougo',
        payasyougoCredits: 100,
        billingModel: 'one_time'
    },
    'Platinum-PAYG-USD': {
        planCode: 'platinum-payasyougo',
        payasyougoCredits: 250,
        billingModel: 'one_time'
    }
};

module.exports = { CHARGEBEE_PLAN_MAPPING };
