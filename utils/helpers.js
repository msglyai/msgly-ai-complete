// Msgly.AI Utility Functions - STEP 2B EXTRACTION
// All utility functions, helpers, and validation functions extracted from server.js

// ==================== URL NORMALIZATION UTILITIES ====================

/**
 * ✅ CRITICAL: LinkedIn URL Normalization Utility
 * Matches frontend logic exactly for consistent URL handling
 */
const cleanLinkedInUrl = (url) => {
    try {
        if (!url) return null;
        
        console.log('🔧 Backend cleaning URL:', url);
        
        let cleanUrl = url.trim();
        
        // Remove protocol
        cleanUrl = cleanUrl.replace(/^https?:\/\//, '');
        
        // Remove www. prefix
        cleanUrl = cleanUrl.replace(/^www\./, '');
        
        // Remove query parameters
        if (cleanUrl.includes('?')) {
            cleanUrl = cleanUrl.split('?')[0];
        }
        
        // Remove hash fragments
        if (cleanUrl.includes('#')) {
            cleanUrl = cleanUrl.split('#')[0];
        }
        
        // Remove trailing slash
        if (cleanUrl.endsWith('/')) {
            cleanUrl = cleanUrl.slice(0, -1);
        }
        
        // Convert to lowercase for comparison
        cleanUrl = cleanUrl.toLowerCase();
        
        console.log('🔧 Backend cleaned URL result:', cleanUrl);
        return cleanUrl;
        
    } catch (error) {
        console.error('❌ Error cleaning URL in backend:', error);
        return url;
    }
};

/**
 * Validate if a URL is a valid LinkedIn profile URL
 */
const isValidLinkedInUrl = (url) => {
    if (!url) return false;
    
    const cleanUrl = cleanLinkedInUrl(url);
    return cleanUrl && cleanUrl.includes('linkedin.com/in/');
};

/**
 * Extract LinkedIn username from URL
 */
const extractLinkedInUsername = (url) => {
    try {
        const cleanUrl = cleanLinkedInUrl(url);
        if (!cleanUrl) return null;
        
        const match = cleanUrl.match(/linkedin\.com\/in\/([^\/]+)/);
        return match ? match[1] : null;
    } catch (error) {
        console.error('Error extracting LinkedIn username:', error);
        return null;
    }
};

// ==================== STATUS MESSAGE HELPERS ====================

/**
 * Get user-friendly setup status message
 */
const getSetupStatusMessage = (status) => {
    switch (status) {
        case 'not_started':
            return 'Please visit your own LinkedIn profile to complete setup';
        case 'incomplete_experience':
            return 'Please scroll through your LinkedIn profile to load your experience section';
        case 'completed':
            return 'Setup complete! You can now use all features with enhanced data extraction';
        default:
            return 'Unknown setup status';
    }
};

/**
 * Get profile extraction status message
 */
const getStatusMessage = (status, initialScrapingDone = false) => {
    switch (status) {
        case 'not_started':
            return 'Profile setup not started - please use the Chrome extension for enhanced profile extraction';
        case 'processing':
            return 'Profile being processed...';
        case 'completed':
            return initialScrapingDone ? 
                'Enhanced profile setup completed! You can now scrape target profiles with comprehensive data.' :
                'Profile setup completed successfully!';
        case 'failed':
            return 'Profile setup incomplete - please try again using the Chrome extension';
        default:
            return 'Unknown status';
    }
};

// ==================== VALIDATION UTILITIES ====================

/**
 * Validate environment variables
 */
const validateEnvironment = () => {
    const required = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
    
    if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️ Warning: OPENAI_API_KEY not set - HTML scraping and message generation will fail');
    }
    
    console.log('✅ Environment validated');
};

/**
 * Validate email format
 */
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Validate password strength
 */
const isValidPassword = (password) => {
    // At least 8 characters, 1 letter, 1 number
    return password && password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
};

/**
 * Sanitize string input
 */
const sanitizeString = (str) => {
    if (!str) return '';
    return str.trim().replace(/[<>'"]/g, '');
};

// ==================== DATA PROCESSING UTILITIES ====================

/**
 * Parse numeric values with fallback
 */
const parseNumericValue = (value, fallback = 0) => {
    if (typeof value === 'number') return value;
    if (!value) return fallback;
    
    const parsed = parseInt(value.toString().replace(/[^\d]/g, ''), 10);
    return isNaN(parsed) ? fallback : parsed;
};

/**
 * Format credits display
 */
const formatCredits = (credits) => {
    if (!credits || credits < 0) return '0';
    if (credits >= 1000) return `${(credits / 1000).toFixed(1)}k`;
    return credits.toString();
};

/**
 * Generate random ID
 */
const generateRandomId = (length = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(deepClone);
    
    const cloned = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
};

// ==================== DATE/TIME UTILITIES ====================

/**
 * Format date for display
 */
const formatDate = (date, options = {}) => {
    if (!date) return '';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const defaultOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    };
    
    return d.toLocaleDateString('en-US', { ...defaultOptions, ...options });
};

/**
 * Calculate time ago from date
 */
const timeAgo = (date) => {
    if (!date) return '';
    
    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
};

// ==================== LOGGING UTILITIES ====================

/**
 * Create formatted log message
 */
const createLogMessage = (level, message, data = null) => {
    const timestamp = new Date().toISOString();
    const logData = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${logData}`;
};

/**
 * Log with emoji prefixes
 */
const logWithEmoji = (level, emoji, message, data = null) => {
    const logMessage = createLogMessage(level, message, data);
    console.log(`${emoji} ${logMessage}`);
};

// Export all utility functions and helpers
module.exports = {
    // URL utilities
    cleanLinkedInUrl,
    isValidLinkedInUrl,
    extractLinkedInUsername,
    
    // Status message helpers
    getSetupStatusMessage,
    getStatusMessage,
    
    // Validation utilities
    validateEnvironment,
    isValidEmail,
    isValidPassword,
    sanitizeString,
    
    // Data processing utilities
    parseNumericValue,
    formatCredits,
    generateRandomId,
    deepClone,
    
    // Date/time utilities
    formatDate,
    timeAgo,
    
    // Logging utilities
    createLogMessage,
    logWithEmoji
};
