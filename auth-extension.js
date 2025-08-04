// auth-extension.js - Chrome Extension Google Auth Endpoint - FIXED
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

// Chrome Extension OAuth endpoint
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
        
        // Find or create user
        let user = await dbFunctions.getUserByEmail(profile.email);
        let isNewUser = false;
        
        if (!user) {
            // Create new user for Chrome extension
            console.log('👤 Creating new user from Chrome extension auth');
            user = await dbFunctions.createGoogleUser(
                profile.email,
                profile.name,
                profile.id,
                profile.picture,
                'free',
                'monthly'
            );
            isNewUser = true;
        } else if (!user.google_id) {
            // Link Google account to existing user
            console.log('🔗 Linking Google account to existing user');
            await dbFunctions.linkGoogleAccount(user.id, profile.id);
            user = await dbFunctions.getUserById(user.id);
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log(`✅ Chrome extension auth successful for user: ${user.email}`);
        
        // Return user data and token
        res.json({
            success: true,
            message: 'Chrome extension authentication successful',
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
                    extractionStatus: user.extraction_status,
                    createdAt: user.created_at,
                    isNewUser: isNewUser
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Chrome extension auth error:', error);
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                success: false,
                error: 'Google authentication service temporarily unavailable'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Chrome extension authentication failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = { router, initAuthExtension };
