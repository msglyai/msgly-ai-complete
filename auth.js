// auth.js - Google Authentication Module
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

// Google OAuth Strategy
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
        
        if (!user) {
            // Create temporary user entry - will be finalized in complete-registration
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value,
                'temp', // Temporary status
                'monthly'
            );
        } else if (!user.google_id) {
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// Google Auth Routes
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

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/auth/failed' }),
        async (req, res) => {
            try {
                const token = jwt.sign(
                    { userId: req.user.id, email: req.user.email },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );
                
                if (req.session.selectedPackage && req.session.selectedPackage !== 'free') {
                    console.log(`Package ${req.session.selectedPackage} requested but only free available for now`);
                }
                
                req.session.selectedPackage = null;
                req.session.billingModel = null;
                
                const frontendUrl = process.env.NODE_ENV === 'production' 
                    ? 'https://api.msgly.ai/sign-up' 
                    : 'http://localhost:3000/sign-up';
                    
                res.redirect(`${frontendUrl}?token=${token}`);
                
            } catch (error) {
                console.error('OAuth callback error:', error);
                const frontendUrl = process.env.NODE_ENV === 'production' 
                    ? 'https://api.msgly.ai/sign-up' 
                    : 'http://localhost:3000/sign-up';
                    
                res.redirect(`${frontendUrl}?error=callback_error`);
            }
        }
    );

    app.get('/auth/failed', (req, res) => {
        const frontendUrl = process.env.NODE_ENV === 'production' 
            ? 'https://api.msgly.ai/sign-up' 
            : 'http://localhost:3000/sign-up';
            
        res.redirect(`${frontendUrl}?error=auth_failed`);
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
