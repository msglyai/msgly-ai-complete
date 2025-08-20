// auth-extension.js - Chrome Extension Google Auth Endpoint - FIXED with Enhanced Debugging + AUTO-REGISTRATION
const express = require('express');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const router = express.Router();
let dbFunctions = {};

const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';

// Initialize with database functions from server.js
const initAuthExtension = (functions) => {
    dbFunctions = functions;
};

// Chrome Extension OAuth endpoint - FIXED with Enhanced Debugging + AUTO-REGISTRATION
router.post('/auth/chrome-extension', async (req, res) => {
    console.log('🔐 Chrome Extension OAuth request received');
    console.log('📊 Request headers:', req.headers);
    console.log('📊 Request body (sanitized):', {
        clientType: req.body.clientType,
        extensionId: req.body.extensionId,
        hasToken: !!req.body.googleAccessToken,
        tokenLength: req.body.googleAccessToken?.length,
        debug: req.body.debug,
        hasLinkedInUrl: !!req.body.linkedinUrl // ✅ AUTO-REGISTRATION: Log LinkedIn URL presence
    });
    
    try {
        const { googleAccessToken, clientType, extensionId, debug, linkedinUrl } = req.body; // ✅ AUTO-REGISTRATION: Extract LinkedIn URL
        
        // ✅ AUTO-REGISTRATION: Log auto-registration detection
        if (linkedinUrl) {
            console.log('🎯 AUTO-REGISTRATION: LinkedIn URL detected, will auto-register user');
            console.log('🔗 LinkedIn URL:', linkedinUrl);
        } else {
            console.log('📝 REGULAR AUTH: No LinkedIn URL, will use normal auth flow');
        }
        
        // Enhanced validation
        if (!googleAccessToken) {
            console.error('❌ Missing Google access token');
            return res.status(400).json({
                success: false,
                error: 'Missing Google access token',
                received: {
                    clientType,
                    extensionId,
                    hasToken: false,
                    debug,
                    hasLinkedInUrl: !!linkedinUrl // ✅ AUTO-REGISTRATION: Include in error response
                }
            });
        }
        
        if (!extensionId) {
            console.error('❌ Missing extension ID');
            return res.status(400).json({
                success: false,
                error: 'Missing extension ID',
                received: {
                    clientType,
                    hasToken: !!googleAccessToken,
                    debug,
                    hasLinkedInUrl: !!linkedinUrl // ✅ AUTO-REGISTRATION: Include in error response
                }
            });
        }
        
        console.log('🔄 Fetching user info from Google using access token...');
        console.log('🔍 Token info (first 20 chars):', googleAccessToken.substring(0, 20) + '...');
        console.log('🆔 Extension ID:', extensionId);
        console.log('🛠 Debug info:', debug);
        
        // FIXED: Enhanced token validation before Google API call
        try {
            // First validate the token with Google's tokeninfo endpoint
            console.log('🔍 Validating token with Google tokeninfo...');
            const tokenInfoResponse = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${googleAccessToken}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            });
            
            if (!tokenInfoResponse.ok) {
                console.error('❌ Token validation failed:', tokenInfoResponse.status, tokenInfoResponse.statusText);
                const tokenErrorText = await tokenInfoResponse.text().catch(() => 'No response body');
                console.error('❌ Token validation error body:', tokenErrorText);
                
                return res.status(401).json({
                    success: false,
                    error: 'Invalid Google access token - token validation failed',
                    details: {
                        status: tokenInfoResponse.status,
                        statusText: tokenInfoResponse.statusText,
                        body: tokenErrorText
                    }
                });
            }
            
            const tokenInfo = await tokenInfoResponse.json();
            console.log('✅ Token validation successful:', {
                scope: tokenInfo.scope,
                audience: tokenInfo.audience,
                expires_in: tokenInfo.expires_in
            });
            
            // Check if token has required scopes
            const hasEmailScope = tokenInfo.scope && tokenInfo.scope.includes('userinfo.email');
            const hasProfileScope = tokenInfo.scope && tokenInfo.scope.includes('userinfo.profile');
            
            if (!hasEmailScope || !hasProfileScope) {
                console.error('❌ Token missing required scopes:', tokenInfo.scope);
                return res.status(401).json({
                    success: false,
                    error: 'Token missing required scopes',
                    details: {
                        receivedScopes: tokenInfo.scope,
                        requiredScopes: 'userinfo.email userinfo.profile'
                    }
                });
            }
            
        } catch (tokenValidationError) {
            console.error('❌ Token validation error:', tokenValidationError);
            return res.status(401).json({
                success: false,
                error: 'Token validation failed',
                details: tokenValidationError.message
            });
        }
        
        // Get user info from Google using the validated access token
        console.log('👤 Fetching user profile from Google...');
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${googleAccessToken}`,
                'Accept': 'application/json'
            },
            timeout: 15000
        });
        
        console.log('📡 Google userinfo response status:', userResponse.status);
        console.log('📡 Google userinfo response headers:', [...userResponse.headers.entries()]);
        
        if (!userResponse.ok) {
            console.error('❌ Google userinfo API error:', userResponse.status, userResponse.statusText);
            const errorText = await userResponse.text().catch(() => 'No response body');
            console.error('❌ Google userinfo API error body:', errorText);
            
            let errorMessage = 'Failed to fetch user info from Google';
            
            if (userResponse.status === 401) {
                errorMessage = 'Invalid or expired Google access token';
            } else if (userResponse.status === 403) {
                errorMessage = 'Insufficient permissions for Google access token';
            } else if (userResponse.status === 429) {
                errorMessage = 'Google API rate limit exceeded';
            } else {
                errorMessage = `Google API error: ${userResponse.status} ${userResponse.statusText}`;
            }
            
            return res.status(401).json({
                success: false,
                error: errorMessage,
                details: {
                    googleStatus: userResponse.status,
                    googleStatusText: userResponse.statusText,
                    googleError: errorText
                }
            });
        }
        
        const profile = await userResponse.json();
        console.log('✅ Google user info received:', { 
            email: profile.email, 
            name: profile.name,
            id: profile.id,
            verified_email: profile.verified_email,
            picture: profile.picture
        });
        
        // Enhanced profile validation
        if (!profile.email || !profile.id) {
            console.error('❌ Incomplete Google profile data:', profile);
            return res.status(401).json({
                success: false,
                error: 'Incomplete Google profile data',
                details: {
                    hasEmail: !!profile.email,
                    hasId: !!profile.id,
                    hasName: !!profile.name,
                    receivedFields: Object.keys(profile)
                }
            });
        }
        
        if (!profile.verified_email) {
            console.error('❌ Google email not verified:', profile.email);
            return res.status(401).json({
                success: false,
                error: 'Google email not verified',
                details: {
                    email: profile.email,
                    verified_email: profile.verified_email
                }
            });
        }
        
        console.log('🔍 Database lookup for user:', profile.email);
        
        // Find or create user
        let user = await dbFunctions.getUserByEmail(profile.email);
        let isNewUser = false;
        
        console.log('👤 Existing user found:', !!user);
        
        if (!user) {
            // ✅ AUTO-REGISTRATION: Create new user with LinkedIn URL for auto-registration
            console.log('👤 Creating new user from Chrome extension auth');
            
            if (linkedinUrl) {
                console.log('🎯 AUTO-REGISTRATION: Creating user with LinkedIn URL for auto-registration');
                console.log('🔗 AUTO-REGISTRATION: LinkedIn URL:', linkedinUrl);
            }
            
            try {
                user = await dbFunctions.createGoogleUser(
                    profile.email,
                    profile.name,
                    profile.id,
                    profile.picture,
                    'free',
                    'monthly',
                    linkedinUrl // ✅ AUTO-REGISTRATION: Pass LinkedIn URL to createGoogleUser
                );
                isNewUser = true;
                console.log('✅ New user created successfully:', user.id);
                
                // ✅ AUTO-REGISTRATION: Log auto-registration status
                if (linkedinUrl) {
                    console.log('🎯 AUTO-REGISTRATION: User auto-registered with LinkedIn profile');
                    console.log('🎯 AUTO-REGISTRATION: registration_completed set to:', user.registration_completed);
                } else {
                    console.log('📝 REGULAR REGISTRATION: User created without LinkedIn URL');
                }
                
            } catch (createError) {
                console.error('❌ Failed to create new user:', createError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create new user account',
                    details: createError.message
                });
            }
        } else if (!user.google_id) {
            // Link Google account to existing user
            console.log('🔗 Linking Google account to existing user:', user.id);
            try {
                await dbFunctions.linkGoogleAccount(user.id, profile.id);
                user = await dbFunctions.getUserById(user.id);
                console.log('✅ Google account linked successfully');
            } catch (linkError) {
                console.error('❌ Failed to link Google account:', linkError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to link Google account',
                    details: linkError.message
                });
            }
        } else {
            console.log('✅ Existing user with Google account found');
        }
        
        // Generate JWT token
        console.log('🔑 Generating JWT token for user:', user.id);
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email,
                source: 'chrome_extension',
                extensionId: extensionId
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log(`✅ Chrome extension auth successful for user: ${user.email}`);
        console.log(`👤 User ID: ${user.id}`);
        console.log(`🆔 Extension ID: ${extensionId}`);
        console.log(`🆕 Is new user: ${isNewUser}`);
        console.log(`🎯 Auto-registered: ${!!linkedinUrl}`); // ✅ AUTO-REGISTRATION: Log auto-registration status
        
        // Return user data and token - ENHANCED response
        const responseData = {
            success: true,
            message: linkedinUrl ? 'Chrome extension auto-registration successful' : 'Chrome extension authentication successful', // ✅ AUTO-REGISTRATION: Dynamic message
            data: {
                token: token,
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    packageType: user.package_type,
                    billingModel: user.billing_model,
                    credits: user.credits_remaining,
                    subscriptionStatus: user.subscription_status,
                    hasGoogleAccount: !!user.google_id,
                    linkedinUrl: user.linkedin_url,
                    profileCompleted: user.profile_completed,
                    registrationCompleted: user.registration_completed, // ✅ AUTO-REGISTRATION: Include registration status
                    extractionStatus: user.extraction_status,
                    createdAt: user.created_at,
                    isNewUser: isNewUser,
                    autoRegistered: !!linkedinUrl // ✅ AUTO-REGISTRATION: Include auto-registration flag
                },
                metadata: {
                    extensionId: extensionId,
                    authMethod: 'chrome_extension',
                    autoRegistration: !!linkedinUrl, // ✅ AUTO-REGISTRATION: Include in metadata
                    tokenExpiry: '30 days',
                    timestamp: new Date().toISOString()
                }
            }
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Chrome extension auth error:', error);
        console.error('❌ Error stack:', error.stack);
        
        // Enhanced error handling
        let errorMessage = 'Chrome extension authentication failed';
        let statusCode = 500;
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            errorMessage = 'Google authentication service temporarily unavailable';
            statusCode = 503;
        } else if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') {
            errorMessage = 'Request to Google services timed out';
            statusCode = 504;
        } else if (error.message.includes('invalid_grant')) {
            errorMessage = 'Invalid or expired Google token';
            statusCode = 401;
        } else if (error.message.includes('invalid_client')) {
            errorMessage = 'OAuth client configuration error';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? {
                message: error.message,
                stack: error.stack,
                code: error.code,
                name: error.name
            } : {
                message: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
});

// FIXED: Health check endpoint for Chrome extension debugging
router.get('/auth/chrome-extension/health', (req, res) => {
    console.log('🏥 Chrome extension auth health check');
    
    res.json({
        success: true,
        service: 'Chrome Extension Auth',
        status: 'healthy',
        version: '2.0.9-FIXED-ENHANCED-DEBUG-AUTO-REG', // ✅ AUTO-REGISTRATION: Updated version
        timestamp: new Date().toISOString(),
        endpoints: {
            auth: '/auth/chrome-extension',
            health: '/auth/chrome-extension/health'
        },
        requirements: {
            googleAccessToken: 'required',
            extensionId: 'required',
            clientType: 'optional (defaults to chrome_extension)',
            linkedinUrl: 'optional (for auto-registration)', // ✅ AUTO-REGISTRATION: Document LinkedIn URL parameter
            scopes: 'userinfo.email, userinfo.profile'
        },
        features: {
            autoRegistration: true, // ✅ AUTO-REGISTRATION: Document auto-registration feature
            registrationCompleted: 'Set to true when linkedinUrl provided'
        },
        debugging: {
            enhanced: true,
            tokenValidation: true,
            autoRegistrationLogging: true, // ✅ AUTO-REGISTRATION: Document auto-registration logging
            errorDetails: process.env.NODE_ENV === 'development'
        }
    });
});

module.exports = { router, initAuthExtension };
