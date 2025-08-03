// auth.js - Google Authentication Module with Chrome Extension Support
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
        let isNewUser = false;
        
        if (!user) {
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value,
                'free', // Default package
                'monthly'
            );
            isNewUser = true;
        } else if (!user.google_id) {
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        // Add isNewUser flag to user object
        user.isNewUser = isNewUser;
        
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// Google Auth Routes
const setupGoogleAuthRoutes = (app) => {
    
    // FIXED: Google OAuth for Chrome Extension
    app.get('/auth/google', (req, res, next) => {
        // Store package selection if provided
        if (req.query.package) {
            req.session.selectedPackage = req.query.package;
            req.session.billingModel = req.query.billing || 'monthly';
        }
        
        // Check if this is a Chrome extension request
        if (req.query.extension === 'true') {
            req.session.isExtension = true;
        }
        
        passport.authenticate('google', { 
            scope: ['profile', 'email'] 
        })(req, res, next);
    });

    // FIXED: OAuth callback with Chrome extension support
    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/auth/failed' }),
        async (req, res) => {
            try {
                const token = jwt.sign(
                    { userId: req.user.id, email: req.user.email },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );
                
                // Reset session data
                const isExtension = req.session.isExtension;
                req.session.selectedPackage = null;
                req.session.billingModel = null;
                req.session.isExtension = null;
                
                // FIXED: Handle Chrome extension authentication differently
                if (isExtension) {
                    // For Chrome extension - send a success page that communicates with the extension
                    const successPageHTML = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Msgly.AI - Authentication Successful</title>
                            <style>
                                body {
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                                    background: linear-gradient(135deg, #8039DF 0%, #3E0075 100%);
                                    color: white;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    min-height: 100vh;
                                    margin: 0;
                                    text-align: center;
                                }
                                .container {
                                    background: rgba(255, 255, 255, 0.1);
                                    padding: 40px;
                                    border-radius: 16px;
                                    backdrop-filter: blur(10px);
                                    border: 1px solid rgba(255, 255, 255, 0.2);
                                    max-width: 400px;
                                }
                                .success-icon {
                                    width: 60px;
                                    height: 60px;
                                    background: #10B981;
                                    border-radius: 50%;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    margin: 0 auto 20px;
                                    font-size: 24px;
                                }
                                h1 {
                                    margin: 0 0 10px 0;
                                    font-size: 24px;
                                    font-weight: 700;
                                }
                                p {
                                    margin: 0 0 20px 0;
                                    opacity: 0.9;
                                    line-height: 1.5;
                                }
                                .close-btn {
                                    background: linear-gradient(135deg, #10B981, #059669);
                                    color: white;
                                    border: none;
                                    padding: 12px 24px;
                                    border-radius: 8px;
                                    font-weight: 600;
                                    cursor: pointer;
                                    transition: transform 0.2s;
                                }
                                .close-btn:hover {
                                    transform: translateY(-2px);
                                }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="success-icon">✓</div>
                                <h1>Authentication Successful!</h1>
                                <p>You can now close this window and return to LinkedIn to use Msgly.AI.</p>
                                <button class="close-btn" onclick="window.close()">Close Window</button>
                            </div>
                            
                            <script>
                                console.log('🔐 Extension OAuth success page loaded');
                                const token = '${token}';
                                
                                // Primary method: Send message to opener window (Chrome extension)
                                if (window.opener && !window.opener.closed) {
                                    console.log('📨 Sending token to opener window');
                                    window.opener.postMessage({
                                        type: 'MSGLY_OAUTH_SUCCESS',
                                        token: token
                                    }, '*');
                                    
                                    // Send multiple times to ensure delivery
                                    setTimeout(() => {
                                        window.opener.postMessage({
                                            type: 'MSGLY_OAUTH_SUCCESS',
                                            token: token
                                        }, '*');
                                    }, 500);
                                    
                                    setTimeout(() => {
                                        window.opener.postMessage({
                                            type: 'MSGLY_OAUTH_SUCCESS',
                                            token: token
                                        }, '*');
                                    }, 1000);
                                }
                                
                                // Fallback method: Try localStorage (extension can check this)
                                try {
                                    localStorage.setItem('msgly_temp_token', token);
                                    console.log('📝 Token stored in localStorage as fallback');
                                } catch (error) {
                                    console.log('Could not store in localStorage:', error);
                                }
                                
                                // Auto-close the popup after 3 seconds
                                setTimeout(() => {
                                    console.log('🔐 Auto-closing authentication window');
                                    window.close();
                                }, 3000);
                                
                                // Also try to close when user clicks anywhere
                                document.addEventListener('click', () => {
                                    if (window.opener) {
                                        window.opener.postMessage({
                                            type: 'MSGLY_OAUTH_SUCCESS',
                                            token: token
                                        }, '*');
                                    }
                                    setTimeout(() => window.close(), 500);
                                });
                            </script>
                        </body>
                        </html>
                    `;
                    
                    res.send(successPageHTML);
                } else {
                    // For regular web authentication - redirect based on user status
                    const needsOnboarding = req.user.isNewUser || 
                                           !req.user.linkedin_url || 
                                           !req.user.profile_completed ||
                                           req.user.extraction_status === 'not_started';
                    
                    console.log(`🔍 OAuth callback - User: ${req.user.email}`);
                    console.log(`   - Is new user: ${req.user.isNewUser || false}`);
                    console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
                    console.log(`   - Profile completed: ${req.user.profile_completed || false}`);
                    console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
                    console.log(`   - Needs onboarding: ${needsOnboarding}`);
                    
                    if (needsOnboarding) {
                        console.log(`➡️ Redirecting to sign-up for onboarding`);
                        res.redirect(`/sign-up?token=${token}`);
                    } else {
                        console.log(`➡️ Redirecting to dashboard`);
                        res.redirect(`/dashboard?token=${token}`);
                    }
                }
                
            } catch (error) {
                console.error('OAuth callback error:', error);
                res.redirect(`/sign-up?error=callback_error`);
            }
        }
    );

    app.get('/auth/failed', (req, res) => {
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
