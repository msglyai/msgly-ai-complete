// middleware/auth.js - JWT Authentication Middleware - STEP 2D EXTRACTION
const jwt = require('jsonwebtoken');

// Import database function - will be initialized from server.js
let getUserById;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';

// Initialize with database functions
const initAuthMiddleware = (dbFunctions) => {
    getUserById = dbFunctions.getUserById;
};

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await getUserById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, error: 'Invalid token' });
    }
};

// NEW: Admin Guard - Replaces all previous admin auth for /admin* routes
const adminGuard = (req, res, next) => {
    console.log('[ADMIN_GUARD] Checking admin access for:', req.path);
    
    // Emergency bypass check
    if (process.env.ADMIN_AUTH_DISABLED === 'true') {
        console.log('[ADMIN_GUARD] Emergency bypass enabled - allowing access');
        return next();
    }
    
    // Check if user has valid admin session
    if (!req.session || !req.session.adminAuth) {
        console.log('[ADMIN_GUARD] No admin session found - redirecting to login');
        return redirectToAdminLogin(req, res);
    }
    
    // Validate admin session (basic validation for now)
    if (!isAdminSessionValid(req.session.adminAuth)) {
        console.log('[ADMIN_GUARD] Invalid admin session - clearing and redirecting');
        req.session.adminAuth = null;
        return redirectToAdminLogin(req, res);
    }
    
    console.log('[ADMIN_GUARD] Valid admin session found for:', req.session.adminAuth.adminEmail);
    next();
};

// Helper function to redirect to admin login
function redirectToAdminLogin(req, res) {
    // For API requests, return JSON error
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({
            success: false,
            error: 'Admin authentication required',
            redirectTo: '/admin-login'
        });
    }
    
    // For HTML requests, redirect to login
    return res.redirect('/admin-login');
}

// Helper function to validate admin session
function isAdminSessionValid(session) {
    if (!session || !session.adminAuthenticated || !session.duoVerified) {
        return false;
    }
    
    // Check expiration
    if (Date.now() > session.expiresAt) {
        return false;
    }
    
    // Verify email is still allowed
    const allowedEmails = process.env.ADMIN_ALLOWED_EMAILS;
    if (!allowedEmails) {
        return false;
    }
    
    const emailList = allowedEmails.split(',').map(email => email.trim().toLowerCase());
    return emailList.includes(session.adminEmail.toLowerCase());
}

// Optional: Additional auth-related middleware can be added here in future
const requireFeatureAccess = (featureName) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        
        // Feature access logic can be expanded here
        // For now, just ensure user has completed registration
        if (!req.user.registration_completed && featureName !== 'basic') {
            return res.status(403).json({ 
                success: false, 
                error: 'Please complete registration first',
                requiredFeature: featureName
            });
        }
        
        next();
    };
};

// Optional: Admin check middleware
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    
    if (!req.user.is_admin) {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    next();
};

module.exports = {
    initAuthMiddleware,
    authenticateToken,
    adminGuard,
    requireFeatureAccess,
    requireAdmin
};
