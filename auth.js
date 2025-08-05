// auth.js - Google Authentication Module - UPDATED WITH SMART ROUTING
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Database functions (imported from server.js)
let getUserByEmail, getUserById, createGoogleUser, linkGoogleAccount;

// Initialize with database functions
const initAuth = (dbFunctions) => {
    getUserByEmail = dbFunctions.getUserByEmail;
    getUserById = dbFunctions.getUserById;
    createGoogleUser = dbFunctions.createGoogleUser;
    linkGoogleAccount = dbFunctions.linkGoogleAccount;
};

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await getUserById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// UPDATED Google OAuth Strategy - Smart user detection
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.NODE_ENV === 'production' 
        ? "https://api.msgly.ai/auth/google/callback"
        : "http://localhost:3000/auth/google/callback"
},
async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await getUserByEmail(profile.emails[0].value);
        let isNewUser = false;
        
        if (!user) {
            // Create new user - needs registration completion
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value
            );
            isNewUser = true;
            console.log(`🆕 Created new user: ${user.email}`);
        } else if (!user.google_id) {
            // Link Google to existing account
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
            console.log(`🔗 Linked Google account for existing user: ${user.email}`);
        } else {
            // Returning Google user
            console.log(`👤 Returning user: ${user.email}`);
        }
        
        // UPDATED: Check registration completion status
        const registrationComplete = user.linkedin_url && 
                                   user.profile_completed &&
                                   user.extraction_status !== 'not_started';
        
        // Set routing flags
        user.isNewUser = isNewUser;
        user.registrationComplete = registrationComplete;
        
        console.log(`📊 User status - New: ${isNewUser}, Complete: ${registrationComplete}`);
        
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// UPDATED Google Auth Routes - Smart routing based on completion status
const setupGoogleAuthRoutes = (app) => {
    app.get('/auth/google', (req, res, next) => {
        if (req.query.package) {
            req.session.selectedPackage = req.query.package;
            req.session.billingModel = req.query.billing || 'monthly';
        }
        
        passport.authenticate('google', { 
            scope: ['profile', 'email'] 
        })(req, res, next);
    });

    // UPDATED OAuth Callback - Smart routing logic
    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
        async (req, res) => {
            try {
                const token = jwt.sign(
                    { userId: req.user.id, email: req.user.email },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );
                
                // Clear session data
                req.session.selectedPackage = null;
                req.session.billingModel = null;
                
                // UPDATED: Smart routing based on completion status
                if (req.user.registrationComplete) {
                    // Complete user → Dashboard
                    console.log(`✅ Complete user ${req.user.email} → Dashboard`);
                    res.redirect(`/dashboard?token=${token}`);
                } else {
                    // Incomplete user (new or existing) → Sign-up
                    console.log(`📝 Incomplete user ${req.user.email} → Sign-up`);
                    res.redirect(`/sign-up?token=${token}`);
                }
                
            } catch (error) {
                console.error('OAuth callback error:', error);
                res.redirect(`/login?error=callback_error`);
            }
        }
    );

    app.get('/auth/failed', (req, res) => {
        res.redirect(`/login?error=auth_failed`);
    });
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

module.exports = {
    initAuth,
    setupGoogleAuthRoutes,
    authenticateToken,
    passport
};
