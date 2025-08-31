// services/chargebeeService.js - Fixed Chargebee Service
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

class ChargebeeService {
    constructor() {
        this.isConfigured = false;
        console.log('[CHARGEBEE] Service initialized');
    }

    // Test connection using a different approach
    async testConnection() {
        try {
            console.log('[CHARGEBEE] Testing connection with plan list...');
            
            // Instead of site.retrieve(), try listing plans which is more reliable
            const result = await chargebee.plan.list({
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
                    plansCount: result.list ? result.list.length : 0,
                    isConfigured: true,
                    testMethod: 'plan.list'
                }
            };
        } catch (error) {
            console.log('[CHARGEBEE] ❌ Connection failed:', error.message);
            console.log('[CHARGEBEE] Error details:', error);
            
            this.isConfigured = false;
            return {
                success: false,
                message: '❌ Chargebee connection failed',
                error: error.message,
                details: {
                    site: process.env.CHARGEBEE_SITE,
                    hasApiKey: !!process.env.CHARGEBEE_API_KEY,
                    errorType: error.type || 'Unknown',
                    statusCode: error.http_status_code || 'N/A'
                }
            };
        }
    }

    // Alternative test method if plan.list fails
    async testConnectionAlternative() {
        try {
            console.log('[CHARGEBEE] Testing with customer list...');
            
            const result = await chargebee.customer.list({
                limit: 1
            }).request();
            
            return {
                success: true,
                message: '✅ Chargebee connection successful (alternative method)!',
                data: {
                    siteName: process.env.CHARGEBEE_SITE,
                    testMethod: 'customer.list',
                    isConfigured: true
                }
            };
        } catch (error) {
            console.log('[CHARGEBEE] ❌ Alternative test also failed:', error.message);
            throw error;
        }
    }
}

const chargebeeService = new ChargebeeService();

module.exports = {
    chargebeeService
};
