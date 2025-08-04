// auth.js - Google Authentication Module - RESTORED WORKING VERSION
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const axios = require('axios');

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

// RESTORED: Google OAuth Strategy (based on your working auth (3).js)
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
        
        // Add isNewUser flag to user object
        user.isNewUser = isNewUser;
        
        console.log(`✅ Google OAuth successful for: ${user.email}`);
        return done(null, user);
        
    } catch (error) {
        console.error('❌ Google OAuth Strategy Error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            profile: profile ? {
                id: profile.id,
                email: profile.emails?.[0]?.value,
                displayName: profile.displayName
            } : 'No profile'
        });
        return done(error, null);
    }
}));

// Google Auth Routes - RESTORED WORKING VERSION
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
        
        // Check if this is a Chrome extension request
        if (req.query.extension === 'true') {
            console.log('🔐 Chrome extension OAuth detected');
            stateData.isExtension = true;
        }
        
        const authOptions = {
            scope: ['profile', 'email']
        };
        
        // Pass state for package selection
        if (Object.keys(stateData).length > 0) {
            authOptions.state = JSON.stringify(stateData);
            console.log('🔐 OAuth state data:', stateData);
        }
        
        passport.authenticate('google', authOptions)(req, res, next);
    });

    // RESTORED: OAuth callback (from your working auth (3).js)
    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/auth/failed' }),
        async (req, res) => {
            try {
                console.log('🔐 Google OAuth callback received');
                console.log('Query params:', req.query);
                
                // Generate JWT token
                const token = jwt.sign(
                    { userId: req.user.id, email: req.user.email },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );
                
                // Parse state parameter to detect Chrome extension and package selection
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
                        console.log('⚠️ Could not parse state data:', parseError.message);
                    }
                }
                
                console.log(`🔐 OAuth callback - Extension: ${isExtension}, Package: ${packageSelection}`);
                
                // Handle Chrome extension authentication
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
                            </script>
                        </body>
                        </html>
                    `;
                    
                    return res.send(successPageHTML);
                } else {
                    // Regular web authentication - redirect based on user status
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
                
                console.log(`✅ Web authentication successful for: ${req.user.email}`);
                
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

    // Chrome Extension OAuth Token Exchange - RESTORED FROM YOUR WORKING VERSION
    app.post('/auth/chrome-extension', async (req, res) => {
        try {
            console.log('🔐 Chrome Extension OAuth token exchange request');
            console.log('📦 Request body:', req.body);
            
            const { authCode, redirectUri } = req.body;
            
            if (!authCode) {
                return res.status(400).json({
                    success: false,
                    error: 'Authorization code is required'
                });
            }
            
            if (!redirectUri) {
                return res.status(400).json({
                    success: false,
                    error: 'Redirect URI is required'
                });
            }
            
            console.log('🔄 Exchanging authorization code for access token...');
            console.log('🔗 Redirect URI:', redirectUri);
            
            // Exchange authorization code for access token with Google
            const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                code: authCode,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            
            if (!tokenResponse.data.access_token) {
                throw new Error('No access token received from Google');
            }
            
            console.log('✅ Access token received from Google');
            
            // Get user info from Google using the access token
            const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    'Authorization': `Bearer ${tokenResponse.data.access_token}`
                },
                timeout: 30000
            });
            
            const googleUser = userResponse.data;
            console.log('👤 Google User Info received:', { 
                id: googleUser.id, 
                email: googleUser.email, 
                name: googleUser.name 
            });
            
            // Find or create user in our database
            let user = await getUserByEmail(googleUser.email);
            let isNewUser = false;
            
            if (!user) {
                user = await createGoogleUser(
                    googleUser.email,
                    googleUser.name,
                    googleUser.id,
                    googleUser.picture,
                    'free',
                    'monthly'
                );
                isNewUser = true;
                console.log('👤 New user created:', user.email);
            } else if (!user.google_id) {
                await linkGoogleAccount(user.id, googleUser.id);
                user = await getUserById(user.id);
                console.log('🔗 Google account linked to existing user:', user.email);
            } else {
                console.log('👤 Existing user found:', user.email);
            }
            
            // Generate our app's JWT token
            const appToken = jwt.sign(
                { userId: user.id, email: user.email },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            console.log('✅ Chrome extension authentication successful for:', user.email);
            
            res.json({
                success: true,
                message: 'Chrome extension authentication successful',
                data: {
                    token: appToken,
                    user: {
                        id: user.id,
                        email: user.email,
                        displayName: user.display_name,
                        profilePicture: user.profile_picture,
                        packageType: user.package_type,
                        credits: user.credits_remaining,
                        isNewUser: isNewUser
                    }
                }
            });
            
        } catch (error) {
            console.error('❌ Chrome extension OAuth error:', error);
            
            let errorMessage = 'Chrome extension authentication failed';
            let statusCode = 500;
            
            if (error.response) {
                // Google API error
                console.error('Google API Error:', error.response.data);
                errorMessage = `Google OAuth error: ${error.response.data.error_description || error.response.data.error}`;
                statusCode = 400;
            } else if (error.code === 'ECONNABORTED') {
                errorMessage = 'Request timeout - please try again';
                statusCode = 408;
            }
            
            res.status(statusCode).json({
                success: false,
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });

    // Auth failure route
    app.get('/auth/failed', (req, res) => {
        console.log('❌ Google OAuth failed - redirecting to sign-up with error');
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
