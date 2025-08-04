// auth-extension.js - Chrome Extension Google Auth Endpoint
const express = require('express');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';

// Load user DB functions
const {
  getUserByEmail,
  getUserById,
  createGoogleUser,
  linkGoogleAccount
} = require('./db'); // adjust if needed

router.post('/auth/chrome-extension', async (req, res) => {
    console.log('🔐 Chrome Extension OAuth request received');
    console.log('📊 Request body:', req.body);
    
    try {
        const { googleAccessToken, clientType, extensionId } = req.body;
        
        if (!googleAccessToken) {
            console.error('❌ Missing Google access token');
            return res.status(400).json({
                success: false,
                error: 'Missing Google access token'
            });
        }
        
        console.log('🔄 Fetching user info from Google using access token...');
        
        // Get user info from Google using the access token
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${googleAccessToken}`,
            },
        });
        
        if (!userResponse.ok) {
            console.error('❌ Google API error:', userResponse.status, userResponse.statusText);
            const errorText = await userResponse.text();
            console.error('❌ Google API error body:', errorText);
            return res.status(401).json({
                success: false,
                error: 'Invalid Google access token'
            });
        }
        
        const profile = await userResponse.json();
        console.log('✅ Google user info received:', { email: profile.email, name: profile.name });
        
        if (!profile.email || !profile.id) {
            console.error('❌ Incomplete Google profile data:', profile);
            return res.status(401).json({
                success: false,
                error: 'Invalid Google token - incomplete profile data'
            });
        }
        
        const email = profile.email;
        const name = profile.name;
        const avatar = profile.picture;
        const googleId = profile.id;
        
        console.log('🔍 Looking up user by email:', email);
        
        // Create or get user (using same functions as web auth)
        let user = await getUserByEmail(email);
        let isNewUser = false;
        
        if (!user) {
            console.log('👤 Creating new user for Chrome extension...');
            user = await createGoogleUser(email, name, googleId, avatar, 'free', 'monthly');
            isNewUser = true;
        } else if (!user.google_id) {
            console.log('🔗 Linking Google account to existing user...');
            await linkGoogleAccount(user.id, googleId);
            user = await getUserById(user.id);
        }
        
        console.log(`✅ User authenticated: ${user.email} (${isNewUser ? 'new' : 'existing'})`);
        
        // Generate JWT token (same as web auth)
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        const responseData = {
            success: true,
            message: 'Chrome extension authentication successful',
            data: {
                token: token,
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    packageType: user.package_type,
                    credits: user.credits_remaining,
                    subscriptionStatus: user.subscription_status,
                    isNewUser: isNewUser
                },
                extensionId: extensionId
            }
        };
        
        console.log('🎉 Chrome Extension OAuth completed successfully!');
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Chrome extension OAuth error:', error);
        
        let errorMessage = 'Authentication failed';
        let statusCode = 500;
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNABORTED') {
            statusCode = 503;
            errorMessage = 'Network error - please try again';
        } else if (error.message.includes('Google')) {
            statusCode = 401;
            errorMessage = error.message;
        }
        
        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;