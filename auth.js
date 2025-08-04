// auth.js - Google Authentication Module with Chrome Extension Support - OAUTH FIXED v2
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

// Google OAuth Strategy for web flow
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
        let user = await getUserByEmail(profile.emails[0].value);
        let isNewUser = false;
        
        if (!user) {
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
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        user.isNewUser = isNewUser;
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// Google Auth Routes
const setupGoogleAuthRoutes = (app) => {
    
    // Web OAuth flow (existing)
    app.get('/auth/google', (req, res, next) => {
        console.log('🔐 Google OAuth request:', req.query);
        
        let stateData = {};
        
        if (req.query.package) {
            stateData.package = req.query.package;
            stateData.billing = req.query.billing || 'monthly';
        }
        
        if (req.query.extension === 'true') {
            console.log('🔐 Chrome extension OAuth detected');
            stateData.isExtension = true;
        }
        
        const authOptions = {
            scope: ['profile', 'email']
        };
        
        if (Object.keys(stateData).length > 0) {
            authOptions.state = JSON.stringify(stateData);
            console.log('🔐 OAuth state data:', stateData);
        }
        
        passport.authenticate('google', authOptions)(req, res, next);
    });

    // Web OAuth callback (existing)
    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/auth/failed' }),
        async (req, res) => {
            try {
                console.log('🔐 OAuth callback received');
                
                const token = jwt.sign(
                    { userId: req.user.id, email: req.user.email },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );
                
                let isExtension = false;
                let packageSelection = null;
                let billingModel = null;
                
                if (req.query.state) {
                    try {
                        const stateData = JSON.parse(req.query.state);
                        isExtension = stateData.isExtension === true;
                        packageSelection = stateData.package;
                        billingModel = stateData.billing;
                    } catch (parseError) {
                        console.log('⚠️ Could not parse state data:', parseError);
                    }
                }
                
                if (isExtension) {
                    // Return extension success page (existing code)
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
                                h1 { margin: 0 0 10px 0; font-size: 24px; font-weight: 700; }
                                p { margin: 0 0 20px 0; opacity: 0.9; line-height: 1.5; }
                                .close-btn {
                                    background: linear-gradient(135deg, #10B981, #059669);
                                    color: white;
                                    border: none;
                                    padding: 12px 24px;
                                    border-radius: 8px;
                                    font-weight: 600;
                                    cursor: pointer;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1>✅ Authentication Successful!</h1>
                                <p>Chrome extension is now ready to use!</p>
                                <button class="close-btn" onclick="window.close()">Close Window</button>
                            </div>
                            <script>
                                setTimeout(() => {
                                    try { window.close(); } catch (e) { }
                                }, 3000);
                            </script>
                        </body>
                        </html>
                    `;
                    return res.send(successPageHTML);
                } else {
                    // Regular web flow redirects
                    const needsOnboarding = req.user.isNewUser || 
                                           !req.user.linkedin_url || 
                                           !req.user.profile_completed ||
                                           req.user.extraction_status === 'not_started';
                    
                    if (packageSelection) {
                        const redirectUrl = needsOnboarding 
                            ? `/sign-up?token=${token}&package=${packageSelection}&billing=${billingModel}`
                            : `/dashboard?token=${token}&package=${packageSelection}&billing=${billingModel}`;
                        return res.redirect(redirectUrl);
                    }
                    
                    if (needsOnboarding) {
                        res.redirect(`/sign-up?token=${token}`);
                    } else {
                        res.redirect(`/dashboard?token=${token}`);
                    }
                }
                
            } catch (error) {
                console.error('❌ OAuth callback error:', error);
                res.redirect(`/sign-up?error=callback_error`);
            }
        }
    );

    // ==================== FIXED CHROME EXTENSION TOKEN EXCHANGE ====================
    
    // Chrome Extension OAuth Token Exchange - FIXED
    app.post('/auth/chrome-extension', async (req, res) => {
        try {
            console.log('🔐 Chrome Extension OAuth token exchange request - FIXED');
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
