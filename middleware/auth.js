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
    requireFeatureAccess,
    requireAdmin
};
