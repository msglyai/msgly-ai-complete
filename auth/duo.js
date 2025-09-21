// auth/duo.js - Duo Web SDK Integration Helper
const duo_web = require('@duosecurity/duo_web');

// Environment variables
const DUO_IKEY = process.env.DUO_IKEY;
const DUO_SKEY = process.env.DUO_SKEY;
const DUO_HOST = process.env.DUO_HOST;

// Validate Duo configuration
function validateDuoConfig() {
    if (!DUO_IKEY || !DUO_SKEY || !DUO_HOST) {
        throw new Error('Missing Duo configuration. Please set DUO_IKEY, DUO_SKEY, and DUO_HOST environment variables.');
    }
}

// Generate Duo signature for authentication request
function generateDuoSignature(username) {
    try {
        validateDuoConfig();
        
        // Generate signature with 5-minute expiration
        const duoSig = duo_web.sign_request(
            DUO_IKEY,
            DUO_SKEY,
            Date.now().toString(), // Use timestamp as akey for uniqueness
            username
        );
        
        return duoSig;
    } catch (error) {
        console.error('Error generating Duo signature:', error);
        throw new Error('Failed to generate Duo authentication signature');
    }
}

// Verify Duo response signature
function verifyDuoResponse(sig_response) {
    try {
        validateDuoConfig();
        
        // Verify the response signature
        const authenticated_username = duo_web.verify_response(
            DUO_IKEY,
            DUO_SKEY,
            Date.now().toString(), // Use timestamp as akey
            sig_response
        );
        
        return authenticated_username;
    } catch (error) {
        console.error('Error verifying Duo response:', error);
        return null;
    }
}

// Check if user is allowed admin access
function isAdminAllowed(email) {
    const allowedEmails = process.env.ADMIN_ALLOWED_EMAILS;
    
    if (!allowedEmails) {
        console.error('ADMIN_ALLOWED_EMAILS not configured');
        return false;
    }
    
    const emailList = allowedEmails.split(',').map(email => email.trim().toLowerCase());
    return emailList.includes(email.toLowerCase());
}

// Generate admin session data
function generateAdminSession(email) {
    return {
        adminAuthenticated: true,
        adminEmail: email,
        duoVerified: true,
        loginTime: Date.now(),
        // Session expires in 2 hours
        expiresAt: Date.now() + (2 * 60 * 60 * 1000)
    };
}

// Check if admin session is valid
function isAdminSessionValid(session) {
    if (!session || !session.adminAuthenticated || !session.duoVerified) {
        return false;
    }
    
    // Check expiration
    if (Date.now() > session.expiresAt) {
        return false;
    }
    
    // Verify email is still allowed
    if (!isAdminAllowed(session.adminEmail)) {
        return false;
    }
    
    return true;
}

module.exports = {
    validateDuoConfig,
    generateDuoSignature,
    verifyDuoResponse,
    isAdminAllowed,
    generateAdminSession,
    isAdminSessionValid,
    DUO_HOST
};
