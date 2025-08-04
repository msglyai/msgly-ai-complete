// auth.js - Google Authentication Module - WEB AUTHENTICATION ONLY - FIXED
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

// Google OAuth Strategy - WEB AUTHENTICATION ONLY
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.NODE_ENV === 'production' 
        ? "https://api.msgly.ai/auth/google/callback"
        : "http://localhost:3000/auth/google/callback",
    passReqToCallback: true,
    state: true
},
async (req, accessToken, refreshToken, profile, done) => {
    try {
        console.log('🔐 Google OAuth Strategy - Processing user:', profile.emails[0].value);
        
        let user = await getUserByEmail(profile.emails[0].value);
        let isNewUser = false;
        
        if (!user) {
            console.log('👤 Creating new user via Google OAuth');
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value,
                'free',
                'monthly'
            );
            isNewUser = true;
        } else if (!user.google_id) {
            console.log('🔗 Linking Google account to existing user');
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        } else {
            console.log('👤 Existing Google user found');
        }
        
        user.isNewUser = isNewUser;
        
        console.log(`✅ Google OAuth successful for: ${user.email}`);
        return done(null, user);
        
    } catch (error) {
        console.error('❌ Google OAuth error:', error);
        return done(error, null);
    }
}));

// Google Auth Routes - WEB AUTHENTICATION ONLY
const setupGoogleAuthRoutes = (app) => {
    
    // Google OAuth initiate
    app.get('/auth/google', (req, res, next) => {
        console.log('🔐 Starting Google OAuth flow for web authentication');
        console.log('Query params:', req.query);
        
        // Create state object for package selection tracking
        let stateData = {};
        
        if (req.query.package) {
            stateData.package = req.query.package;
            stateData.billing = req.query.billing || 'monthly';
            console.log('📦 Package selection detected:', stateData);
        }
        
        const authOptions = {
            scope: ['profile', 'email']
        };
        
        // Pass state for package selection
        if (Object.keys(stateData).length > 0) {
            authOptions.state = JSON.stringify(stateData);
        }
        
        passport.authenticate('google', authOptions)(req, res, next);
    });

    // OAuth callback - WEB AUTHENTICATION ONLY
    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/auth/failed' }),
        async (req, res) => {
            try {
                console.log('🔐 Google OAuth callback received');
                
                // Generate JWT token
                const token = jwt.sign(
                    { userId: req.user.id, email: req.user.email },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );
                
                // Parse state for package selection
                let packageSelection = null;
                let billingModel = null;
                
                if (req.query.state) {
                    try {
                        const stateData = JSON.parse(req.query.state);
                        packageSelection = stateData.package;
                        billingModel = stateData.billing;
                        console.log('📦 Parsed package selection:', stateData);
                    } catch (parseError) {
                        console.log('⚠️ Could not parse state data:', parseError.message);
                    }
                }
                
                // Determine if user needs onboarding
                const needsOnboarding = req.user.isNewUser || 
                                       !req.user.linkedin_url || 
                                       !req.user.profile_completed ||
                                       req.user.extraction_status === 'not_started';
                
                console.log(`🔍 User status for ${req.user.email}:`);
                console.log(`   - Is new user: ${req.user.isNewUser || false}`);
                console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
                console.log(`   - Profile completed: ${req.user.profile_completed || false}`);
                console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
                console.log(`   - Needs onboarding: ${needsOnboarding}`);
                
                // Redirect logic
                if (packageSelection) {
                    console.log('📦 Redirecting with package selection:', packageSelection);
                    const redirectUrl = needsOnboarding 
                        ? `/sign-up?token=${token}&package=${packageSelection}&billing=${billingModel}`
                        : `/dashboard?token=${token}&package=${packageSelection}&billing=${billingModel}`;
                    return res.redirect(redirectUrl);
                }
                
                // Default redirect logic
                if (needsOnboarding) {
                    console.log(`➡️ Redirecting to sign-up for onboarding`);
                    res.redirect(`/sign-up?token=${token}`);
                } else {
                    console.log(`➡️ Redirecting to dashboard`);
                    res.redirect(`/dashboard?token=${token}`);
                }
                
                console.log(`✅ Web authentication successful for: ${req.user.email}`);
                
            } catch (error) {
                console.error('❌ OAuth callback error:', error);
                res.redirect(`/sign-up?error=callback_error`);
            }
        }
    );

    // Auth failure route
    app.get('/auth/failed', (req, res) => {
        console.log('❌ Google OAuth failed');
        res.redirect(`/sign-up?error=auth_failed`);
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
