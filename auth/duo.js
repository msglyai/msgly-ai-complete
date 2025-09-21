// auth/duo.js - Duo Universal SDK Integration
const { Client } = require('@duosecurity/duo_universal');
const crypto = require('crypto');

// Environment variables
const DUO_CLIENT_ID = process.env.DUO_IKEY; // Universal SDK uses clientId (same as Integration Key)
const DUO_CLIENT_SECRET = process.env.DUO_SKEY; // Universal SDK uses clientSecret (same as Secret Key)
const DUO_API_HOST = process.env.DUO_HOST;
const BASE_URL = process.env.NODE_ENV === 'production' 
    ? 'https://api.msgly.ai' 
    : 'http://localhost:3000';

// Initialize Duo client
let duoClient = null;

function initializeDuoClient() {
    if (!DUO_CLIENT_ID || !DUO_CLIENT_SECRET || !DUO_API_HOST) {
        throw new Error('Missing Duo configuration. Please set DUO_IKEY, DUO_SKEY, and DUO_HOST environment variables.');
    }

    if (!duoClient) {
        duoClient = new Client({
            clientId: DUO_CLIENT_ID,
            clientSecret: DUO_CLIENT_SECRET,
            apiHost: DUO_API_HOST,
            redirectUrl: `${BASE_URL}/admin-duo-callback`
        });
        console.log('[DUO] Client initialized with redirect URL:', `${BASE_URL}/admin-duo-callback`);
    }

    return duoClient;
}

// Validate Duo configuration
async function validateDuoConfig() {
    try {
        const client = initializeDuoClient();
        
        // Test health check to ensure Duo is accessible
        const isHealthy = await client.healthCheck();
        if (!isHealthy) {
            throw new Error('Duo service is not accessible');
        }
        
        console.log('[DUO] Configuration validated successfully');
        return true;
    } catch (error) {
        console.error('[DUO] Configuration validation failed:', error.message);
        throw error;
    }
}

// Generate secure state for CSRF protection
function generateState() {
    return crypto.randomBytes(32).toString('hex');
}

// Create Duo authentication URL
async function createAuthUrl(username, state) {
    try {
        const client = initializeDuoClient();
        
        console.log('[DUO] Creating auth URL for user:', username);
        const authUrl = await client.createAuthUrl(username, state);
        console.log('[DUO] Auth URL created successfully');
        
        return authUrl;
    } catch (error) {
        console.error('[DUO] Error creating auth URL:', error);
        throw new Error('Failed to create Duo authentication URL');
    }
}

// Exchange authorization code for 2FA result
async function exchangeAuthCode(duoCode, username, state) {
    try {
        const client = initializeDuoClient();
        
        console.log('[DUO] Exchanging authorization code for user:', username);
        const token = await client.exchangeAuthorizationCodeFor2FAResult(duoCode, username);
        
        console.log('[DUO] Token exchange successful');
        return token;
    } catch (error) {
        console.error('[DUO] Error exchanging authorization code:', error);
        throw new Error('Failed to verify Duo authentication');
    }
}

// Check if user is allowed admin access
function isAdminAllowed(email) {
    const allowedEmails = process.env.ADMIN_ALLOWED_EMAILS;
    
    if (!allowedEmails) {
        console.error('[DUO] ADMIN_ALLOWED_EMAILS not configured');
        return false;
    }
    
    const emailList = allowedEmails.split(',').map(email => email.trim().toLowerCase());
    const isAllowed = emailList.includes(email.toLowerCase());
    
    console.log('[DUO] Email access check:', {
        email: email,
        allowed: isAllowed
    });
    
    return isAllowed;
}

// Generate admin session data
function generateAdminSession(email, duoToken) {
    const session = {
        adminAuthenticated: true,
        adminEmail: email,
        duoVerified: true,
        duoToken: duoToken, // Store token for additional verification if needed
        loginTime: Date.now(),
        // Session expires in 2 hours
        expiresAt: Date.now() + (2 * 60 * 60 * 1000)
    };
    
    console.log('[DUO] Generated admin session for:', email);
    return session;
}

// Check if admin session is valid
function isAdminSessionValid(session) {
    if (!session || !session.adminAuthenticated || !session.duoVerified) {
        console.log('[DUO] Invalid session: missing required fields');
        return false;
    }
    
    // Check expiration
    if (Date.now() > session.expiresAt) {
        console.log('[DUO] Session expired');
        return false;
    }
    
    // Verify email is still allowed
    if (!isAdminAllowed(session.adminEmail)) {
        console.log('[DUO] Email no longer allowed:', session.adminEmail);
        return false;
    }
    
    return true;
}

// Store state in session with expiration (for CSRF protection)
function storeState(session, state) {
    session.duoState = state;
    session.duoStateExpiry = Date.now() + (10 * 60 * 1000); // 10 minutes
    console.log('[DUO] State stored in session');
}

// Validate state from callback (CSRF protection)
function validateState(session, receivedState) {
    if (!session.duoState || !session.duoStateExpiry) {
        console.log('[DUO] No state found in session');
        return false;
    }
    
    if (Date.now() > session.duoStateExpiry) {
        console.log('[DUO] State expired');
        return false;
    }
    
    if (session.duoState !== receivedState) {
        console.log('[DUO] State mismatch');
        return false;
    }
    
    // Clear state after validation
    delete session.duoState;
    delete session.duoStateExpiry;
    
    console.log('[DUO] State validated successfully');
    return true;
}

module.exports = {
    validateDuoConfig,
    generateState,
    createAuthUrl,
    exchangeAuthCode,
    isAdminAllowed,
    generateAdminSession,
    isAdminSessionValid,
    storeState,
    validateState,
    DUO_API_HOST
};
