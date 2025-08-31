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

    // Test connection using Product Catalog 2.0 API
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

    // Alternative test method using item_price (Product Catalog 2.0)
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
}

const chargebeeService = new ChargebeeService();

module.exports = {
    chargebeeService
};
