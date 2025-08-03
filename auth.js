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

// FIXED: Google OAuth Strategy with state support
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.NODE_ENV === 'production' 
        ? "https://api.msgly.ai/auth/google/callback"
        : "http://localhost:3000/auth/google/callback",
    passReqToCallback: true,  // IMPORTANT: This allows us to access req in the callback
    state: true  // IMPORTANT: Enable state parameter support
},
async (req, accessToken, refreshToken, profile, done) => {
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
    
    // FIXED: Google OAuth for Chrome Extension using state parameter
    app.get('/auth/google', (req, res, next) => {
        console.log('🔐 Google OAuth request:', req.query);
        
        // Create state object for OAuth
        let stateData = {};
        
        // Store package selection if provided
        if (req.query.package) {
            stateData.package = req.query.package;
            stateData.billing = req.query.billing || 'monthly';
        }
        
        // IMPORTANT: Check if this is a Chrome extension request
        if (req.query.extension === 'true') {
            console.log('🔐 Chrome extension OAuth detected');
            stateData.isExtension = true;
        }
        
        // FIXED: Use state parameter instead of session
        const authOptions = {
            scope: ['profile', 'email']
        };
        
        // If we have state data, pass it to OAuth
        if (Object.keys(stateData).length > 0) {
            authOptions.state = JSON.stringify(stateData);
            console.log('🔐 OAuth state data:', stateData);
        }
        
        passport.authenticate('google', authOptions)(req, res, next);
    });

    // FIXED: OAuth callback with state-based Chrome extension detection
    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/auth/failed' }),
        async (req, res) => {
            try {
                console.log('🔐 OAuth callback received');
                console.log('Query params:', req.query);
                
                const token = jwt.sign(
                    { userId: req.user.id, email: req.user.email },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );
                
                // FIXED: Parse state parameter to detect Chrome extension
                let isExtension = false;
                let packageSelection = null;
                let billingModel = null;
                
                if (req.query.state) {
                    try {
                        const stateData = JSON.parse(req.query.state);
                        console.log('🔐 Parsed state data:', stateData);
                        
                        isExtension = stateData.isExtension === true;
                        packageSelection = stateData.package;
                        billingModel = stateData.billing;
                    } catch (parseError) {
                        console.log('⚠️ Could not parse state data:', parseError);
                    }
                }
                
                console.log(`🔐 OAuth callback - Extension: ${isExtension}`);
                
                // FIXED: Handle Chrome extension authentication
                if (isExtension) {
                    console.log('🔐 Sending Chrome extension success page');
                    
                    const successPageHTML = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Msgly.AI - Authentication Successful</title>
                            <meta charset="utf-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1">
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
                                    animation: slideIn 0.5s ease-out;
                                }
                                @keyframes slideIn {
                                    from { opacity: 0; transform: translateY(20px); }
                                    to { opacity: 1; transform: translateY(0); }
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
                                    animation: pulse 2s infinite;
                                }
                                @keyframes pulse {
                                    0%, 100% { transform: scale(1); }
                                    50% { transform: scale(1.05); }
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
                                .countdown {
                                    font-size: 14px;
                                    opacity: 0.7;
                                    margin-top: 16px;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="success-icon">✓</div>
                                <h1>Authentication Successful!</h1>
                                <p>You have been successfully authenticated with Msgly.AI. This window will close automatically.</p>
                                <button class="close-btn" onclick="closeWindow()">Close Window</button>
                                <div class="countdown">Closing in <span id="countdown">3</span> seconds...</div>
                            </div>
                            
                            <script>
                                console.log('🔐 Chrome Extension OAuth success page loaded');
                                const token = '${token}';
                                
                                // Primary method: Send message to opener window (Chrome extension)
                                function sendTokenToExtension() {
                                    if (window.opener && !window.opener.closed) {
                                        console.log('📨 Sending token to extension');
                                        window.opener.postMessage({
                                            type: 'MSGLY_OAUTH_SUCCESS',
                                            token: token
                                        }, '*');
                                        return true;
                                    }
                                    return false;
                                }
                                
                                // Send token immediately
                                sendTokenToExtension();
                                
                                // Fallback: Store in localStorage temporarily
                                try {
                                    localStorage.setItem('msgly_temp_token', token);
                                    console.log('📝 Token stored in localStorage as fallback');
                                } catch (error) {
                                    console.log('Could not store in localStorage:', error);
                                }
                                
                                // Close window function
                                function closeWindow() {
                                    sendTokenToExtension();
                                    setTimeout(() => window.close(), 100);
                                }
                                
                                // Countdown and auto-close
                                let seconds = 3;
                                const countdownEl = document.getElementById('countdown');
                                
                                const countdown = setInterval(() => {
                                    seconds--;
                                    if (countdownEl) countdownEl.textContent = seconds;
                                    
                                    if (seconds <= 0) {
                                        clearInterval(countdown);
                                        closeWindow();
                                    }
                                }, 1000);
                                
                                // Send token multiple times to ensure delivery
                                setTimeout(() => sendTokenToExtension(), 500);
                                setTimeout(() => sendTokenToExtension(), 1000);
                                setTimeout(() => sendTokenToExtension(), 1500);
                                
                                // Handle clicks anywhere to close
                                document.addEventListener('click', (e) => {
                                    if (e.target.tagName !== 'BUTTON') {
                                        closeWindow();
                                    }
                                });
                            </script>
                        </body>
                        </html>
                    `;
                    
                    return res.send(successPageHTML);
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
                    
                    // Handle package selection redirect
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
                }
                
            } catch (error) {
                console.error('❌ OAuth callback error:', error);
                
                // Check if it was an extension request by looking at the state
                let isExtensionError = false;
                if (req.query.state) {
                    try {
                        const stateData = JSON.parse(req.query.state);
                        isExtensionError = stateData.isExtension === true;
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
                
                if (isExtensionError) {
                    // Send error page for extension
                    return res.send(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Authentication Error - Msgly.AI</title>
                            <style>
                                body { 
                                    font-family: Arial, sans-serif; 
                                    text-align: center; 
                                    padding: 50px; 
                                    background: linear-gradient(135deg, #FF2370, #8039DF); 
                                    color: white;
                                    min-height: 100vh;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    margin: 0;
                                }
                                .error {
                                    background: rgba(255, 255, 255, 0.1);
                                    padding: 30px;
                                    border-radius: 16px;
                                    backdrop-filter: blur(10px);
                                    border: 1px solid rgba(255, 255, 255, 0.2);
                                    max-width: 400px;
                                }
                                .error-icon {
                                    font-size: 48px;
                                    margin-bottom: 16px;
                                }
                                button {
                                    background: linear-gradient(135deg, #10B981, #059669);
                                    color: white;
                                    border: none;
                                    padding: 12px 24px;
                                    border-radius: 8px;
                                    font-weight: 600;
                                    cursor: pointer;
                                    margin-top: 16px;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="error">
                                <div class="error-icon">❌</div>
                                <h2>Authentication Error</h2>
                                <p>There was an error during authentication. Please try again.</p>
                                <button onclick="window.close()">Close Window</button>
                            </div>
                            <script>
                                setTimeout(() => window.close(), 5000);
                            </script>
                        </body>
                        </html>
                    `);
                } else {
                    // Regular web error redirect
                    res.redirect(`/sign-up?error=callback_error`);
                }
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
