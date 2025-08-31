// services/chargebeeService.js - Enhanced with debugging
const chargebee = require('chargebee');
require('dotenv').config();

console.log('[CHARGEBEE] Environment check:');
console.log('[CHARGEBEE] CHARGEBEE_SITE:', process.env.CHARGEBEE_SITE);
console.log('[CHARGEBEE] CHARGEBEE_API_KEY exists:', !!process.env.CHARGEBEE_API_KEY);
console.log('[CHARGEBEE] CHARGEBEE_API_KEY length:', process.env.CHARGEBEE_API_KEY?.length);

// Initialize Chargebee
if (process.env.CHARGEBEE_SITE && process.env.CHARGEBEE_API_KEY) {
    try {
        chargebee.configure({
            site: process.env.CHARGEBEE_SITE,
            api_key: process.env.CHARGEBEE_API_KEY
        });
        console.log('[CHARGEBEE] Configuration completed successfully');
    } catch (error) {
        console.error('[CHARGEBEE] Configuration failed:', error);
    }
} else {
    console.error('[CHARGEBEE] Missing required environment variables');
}

class ChargebeeService {
    constructor() {
        this.isConfigured = false;
        console.log('[CHARGEBEE] Initializing service...');
        console.log('[CHARGEBEE] chargebee object:', !!chargebee);
        console.log('[CHARGEBEE] chargebee.site:', !!chargebee?.site);
    }

    // Test connection to Chargebee
    async testConnection() {
        try {
            console.log('[CHARGEBEE] Testing connection...');
            console.log(`[CHARGEBEE] Site: ${process.env.CHARGEBEE_SITE}`);
            console.log(`[CHARGEBEE] API Key: ${process.env.CHARGEBEE_API_KEY ? 'Set' : 'Not Set'}`);
            
            // Check if chargebee is properly configured
            if (!chargebee) {
                throw new Error('Chargebee object is not available');
            }
            
            if (!chargebee.site) {
                throw new Error('Chargebee.site is not available - configuration may have failed');
            }
            
            if (!process.env.CHARGEBEE_SITE) {
                throw new Error('CHARGEBEE_SITE environment variable is not set');
            }
            
            if (!process.env.CHARGEBEE_API_KEY) {
                throw new Error('CHARGEBEE_API_KEY environment variable is not set');
            }
            
            console.log('[CHARGEBEE] All checks passed, making API call...');
            
            // Test with a simple API call
            const result = await chargebee.site.retrieve().request();
            
            if (result.site) {
                console.log(`[CHARGEBEE] ✅ Connection successful!`);
                console.log(`[CHARGEBEE] Site name: ${result.site.name}`);
                console.log(`[CHARGEBEE] Currency: ${result.site.currency_code}`);
                this.isConfigured = true;
                return { success: true, site: result.site };
            } else {
                throw new Error('No site data returned from Chargebee API');
            }
        } catch (error) {
            console.error('[CHARGEBEE] ❌ Connection failed:', error.message);
            console.error('[CHARGEBEE] Full error:', error);
            this.isConfigured = false;
            return { success: false, error: error.message };
        }
    }
}

// Create and export instance
const chargebeeService = new ChargebeeService();

module.exports = {
    chargebeeService,
    chargebee
};

console.log('[CHARGEBEE] Service loaded');
