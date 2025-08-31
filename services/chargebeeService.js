// services/chargebeeService.js - Basic Chargebee Connection Test
const chargebee = require('chargebee');
require('dotenv').config();

// Initialize Chargebee
chargebee.configure({
    site: process.env.CHARGEBEE_SITE,
    api_key: process.env.CHARGEBEE_API_KEY
});

class ChargebeeService {
    constructor() {
        this.isConfigured = false;
        console.log('[CHARGEBEE] Initializing service...');
    }

    // Test connection to Chargebee
    async testConnection() {
        try {
            console.log('[CHARGEBEE] Testing connection...');
            console.log(`[CHARGEBEE] Site: ${process.env.CHARGEBEE_SITE}`);
            console.log(`[CHARGEBEE] API Key: ${process.env.CHARGEBEE_API_KEY ? 'Set' : 'Not Set'}`);
            
            // Test with a simple API call
            const result = await chargebee.site.retrieve().request();
            
            if (result.site) {
                console.log(`[CHARGEBEE] ✅ Connection successful!`);
                console.log(`[CHARGEBEE] Site name: ${result.site.name}`);
                console.log(`[CHARGEBEE] Currency: ${result.site.currency_code}`);
                this.isConfigured = true;
                return { success: true, site: result.site };
            }
        } catch (error) {
            console.error('[CHARGEBEE] ❌ Connection failed:', error.message);
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
