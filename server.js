// server.js - Clean with TARGET PROFILE + USER PROFILE support (Broken code removed)
// Msgly.AI Server - Complete with Traffic Light System - Enhanced TARGET + USER PROFILE

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const axios = require('axios');

// ✅ FIXED: Import sendToGemini from correct path (project root)
const { sendToGemini } = require('./sendToGemini');
require('dotenv').config();

// ✅ ENHANCED: Import all database functions including NEW TARGET PROFILE functions
const {
    pool,
    initDB,
    testDatabase,
    createUser,
    createGoogleUser,
    linkGoogleAccount,
    getUserByEmail,
    getUserById,
    createOrUpdateUserProfile,
    sanitizeForJSON,
    ensureValidJSONArray,
    parseLinkedInNumber,
    processGeminiData,          // ✅ USER PROFILE processing
    processTargetGeminiData,    // ✅ NEW: TARGET PROFILE processing
    createOrUpdateTargetProfile // ✅ NEW: TARGET PROFILE database functions
} = require('./utils/database');

// ✅ NEW: Import credit management system
const {
    createCreditHold,
    completeOperation,
    releaseCreditHold,
    checkUserCredits,
    getCurrentCredits,
    getTransactionHistory,
    cleanupExpiredHolds,
    getOperationCost
} = require('./credits');

// ✅ STEP 2B: Import all utility functions from utils/helpers.js
const {
    cleanLinkedInUrl,
    isValidLinkedInUrl,
    extractLinkedInUsername,
    getSetupStatusMessage,
    getStatusMessage,
    validateEnvironment,
    isValidEmail,
    isValidPassword,
    sanitizeString,
    parseNumericValue,
    formatCredits,
    generateRandomId,
    deepClone,
    formatDate,
    timeAgo,
    createLogMessage,
    logWithEmoji
} = require('./utils/helpers');

// ✅ STEP 2D: Import authentication middleware
const {
    initAuthMiddleware,
    authenticateToken,
    requireFeatureAccess,
    requireAdmin
} = require('./middleware/auth');

// ✅ STEP 2E: Import user routes initialization function
const { initUserRoutes } = require('./routes/users');

// ✅ STEP 2C: Import modularized routes
const healthRoutes = require('./routes/health')(pool);
const staticRoutes = require('./routes/static');

// ✅ ENHANCED: TARGET PROFILE handler with credit management
async function handleTargetProfile(req, res) {
    let holdId = null;
    
    try {
        console.log('🎯 === TARGET PROFILE PROCESSING WITH CREDITS ===');
        console.log(`👤 User ID: ${req.user.id}`);
        console.log(`🔗 URL: ${req.body.profileUrl}`);
        
        const { html, profileUrl } = req.body;
        const userId = req.user.id;
        
        if (!html || !profileUrl) {
            return res.status(400).json({
                success: false,
                error: 'HTML content and profileUrl are required for target profile processing'
            });
        }

        // ✅ NEW: Create credit hold before processing
        console.log('💳 Creating credit hold for target analysis...');
        const holdResult = await createCreditHold(userId, 'target_analysis', {
            profileUrl: profileUrl,
            timestamp: new Date().toISOString()
        });

        if (!holdResult.success) {
            if (holdResult.error === 'insufficient_credits') {
                return res.status(402).json({
                    success: false,
                    error: 'insufficient_credits',
                    userMessage: holdResult.userMessage,
                    currentCredits: holdResult.currentCredits,
                    requiredCredits: holdResult.requiredCredits
                });
            }
            
            return res.status(500).json({
                success: false,
                error: 'Failed to create credit hold',
                details: holdResult.error
            });
        }

        holdId = holdResult.holdId;
        console.log(`✅ Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        
        // Clean and validate LinkedIn URL
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        console.log('🤖 Processing HTML with GPT-5 nano for TARGET profile...');
        
        // Process HTML with GPT-5 nano
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: false  // ✅ FALSE for target profiles
        });
        
        if (!geminiResult.success) {
            console.error('❌ GPT-5 nano processing failed for TARGET profile:', geminiResult.userMessage);
            
            // ✅ NEW: Release hold on failure
            await releaseCreditHold(userId, holdId, 'gemini_processing_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process target profile data with GPT-5 nano',
                details: geminiResult.userMessage || 'Unknown error'
            });
        }
        
        console.log('✅ GPT-5 nano processing successful for TARGET profile');
        
        // ✅ CLEAN: Process GPT-5 nano data for TARGET profile using NEW database function
        const processedProfile = processTargetGeminiData(geminiResult, cleanProfileUrl);
        
        // ✅ ENHANCED: Add token tracking data to processed profile
        if (geminiResult.tokenData) {
            processedProfile.rawGptResponse = geminiResult.tokenData.rawGptResponse;
            processedProfile.inputTokens = geminiResult.tokenData.inputTokens;
            processedProfile.outputTokens = geminiResult.tokenData.outputTokens;
            processedProfile.totalTokens = geminiResult.tokenData.totalTokens;
            processedProfile.processingTimeMs = geminiResult.tokenData.processingTimeMs;
            processedProfile.apiRequestId = geminiResult.tokenData.apiRequestId;
            processedProfile.responseStatus = geminiResult.tokenData.responseStatus;
        }
        
        // ✅ CLEAN: Save to target_profiles table using NEW database function
        const savedProfile = await createOrUpdateTargetProfile(userId, cleanProfileUrl, processedProfile);
        
        // ✅ NEW: Complete operation and deduct credits
        console.log('💳 Completing operation and deducting credits...');
        const completionResult = await completeOperation(userId, holdId, {
            profileId: savedProfile.id,
            fullName: processedProfile.fullName,
            processingTimeMs: processedProfile.processingTimeMs,
            tokenUsage: {
                inputTokens: processedProfile.inputTokens,
                outputTokens: processedProfile.outputTokens,
                totalTokens: processedProfile.totalTokens
            }
        });

        if (!completionResult.success) {
            console.error('❌ Failed to complete credit operation:', completionResult.error);
            // Release hold as fallback
            await releaseCreditHold(userId, holdId, 'completion_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful analysis'
            });
        }
        
        console.log('✅ TARGET profile saved to target_profiles table successfully');
        console.log(`📊 Token usage: ${processedProfile.inputTokens || 'N/A'} input, ${processedProfile.outputTokens || 'N/A'} output, ${processedProfile.totalTokens || 'N/A'} total`);
        console.log(`💰 Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
        
        res.json({
            success: true,
            message: 'Target profile analyzed and saved successfully',
            data: {
                fullName: processedProfile.fullName,
                headline: processedProfile.headline,
                currentRole: processedProfile.currentRole,
                currentCompany: processedProfile.currentCompany,
                experienceCount: processedProfile.experience?.length || 0,
                educationCount: processedProfile.education?.length || 0,
                hasExperience: processedProfile.hasExperience,
                profileId: savedProfile.id,
                tokenUsage: {
                    inputTokens: processedProfile.inputTokens,
                    outputTokens: processedProfile.outputTokens,
                    totalTokens: processedProfile.totalTokens,
                    processingTimeMs: processedProfile.processingTimeMs
                }
            },
            credits: {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                transactionId: completionResult.transactionId
            }
        });
        
    } catch (error) {
        console.error('❌ TARGET profile processing error:', error);
        
        // ✅ NEW: Release hold on any error
        if (holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Target profile processing failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// ✅ USER PROFILE HANDLER: Enhanced with token tracking (IMPROVED)
async function handleUserProfile(req, res) {
    try {
        console.log('🔵 === USER PROFILE PROCESSING ===');
        console.log(`👤 User ID: ${req.user.id}`);
        console.log(`🔗 URL: ${req.body.profileUrl}`);
        
        const { html, profileUrl } = req.body;
        const userId = req.user.id;
        
        if (!html || !profileUrl) {
            return res.status(400).json({
                success: false,
                error: 'HTML content and profileUrl are required for user profile processing'
            });
        }
        
        // Clean and validate LinkedIn URL
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        console.log('🤖 Processing HTML with GPT-5 nano for USER profile...');
        
        // Process HTML with GPT-5 nano
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: true
        });
        
        if (!geminiResult.success) {
            console.error('❌ GPT-5 nano processing failed for USER profile:', geminiResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process profile data with GPT-5 nano',
                details: geminiResult.error || 'Unknown error'
            });
        }
        
        console.log('✅ GPT-5 nano processing successful for USER profile');
        
        // Process GPT-5 nano data for USER profile
        const processedProfile = processGeminiData(geminiResult, cleanProfileUrl);
        
        // Save to user_profiles table only
        const savedProfile = await createOrUpdateUserProfile(userId, cleanProfileUrl, processedProfile.fullName);
        
        // ✅ ENHANCED: Update user_profiles with processed data + token tracking
        await pool.query(`
            UPDATE user_profiles SET 
                full_name = $1,
                headline = $2,
                "current_role" = $3,
                about = $4,
                location = $5,
                current_company = $6,
                connections_count = $7,
                followers_count = $8,
                experience = $9,
                education = $10,
                skills = $11,
                certifications = $12,
                awards = $13,
                volunteer_experience = $14,
                activity = $15,
                engagement_data = $16,
                gemini_raw_data = $17,
                raw_gpt_response = $18,
                input_tokens = $19,
                output_tokens = $20,
                total_tokens = $21,
                processing_time_ms = $22,
                api_request_id = $23,
                response_status = $24,
                gemini_processed_at = NOW(),
                data_extraction_status = 'completed',
                initial_scraping_done = true,
                profile_analyzed = true,
                extraction_completed_at = NOW(),
                updated_at = NOW()
            WHERE user_id = $25
        `, [
            processedProfile.fullName,
            processedProfile.headline,
            processedProfile.currentRole,
            processedProfile.about,
            processedProfile.location,
            processedProfile.currentCompany,
            processedProfile.connectionsCount,
            processedProfile.followersCount,
            JSON.stringify(processedProfile.experience),
            JSON.stringify(processedProfile.education),
            JSON.stringify(processedProfile.skills),
            JSON.stringify(processedProfile.certifications),
            JSON.stringify(processedProfile.awards),
            JSON.stringify(processedProfile.volunteerExperience),
            JSON.stringify(processedProfile.activity),
            JSON.stringify(processedProfile.engagementData),
            JSON.stringify(processedProfile.geminiRawData),
            // ✅ NEW: Token tracking data
            geminiResult.tokenData?.rawGptResponse || null,
            geminiResult.tokenData?.inputTokens || null,
            geminiResult.tokenData?.outputTokens || null,
            geminiResult.tokenData?.totalTokens || null,
            geminiResult.tokenData?.processingTimeMs || null,
            geminiResult.tokenData?.apiRequestId || null,
            geminiResult.tokenData?.responseStatus || 'success',
            userId
        ]);
        
        // Update users table registration status
        await pool.query(
            'UPDATE users SET registration_completed = true, extraction_status = $1 WHERE id = $2',
            ['completed', userId]
        );
        
        console.log('✅ USER profile saved to user_profiles table successfully');
        console.log(`📊 Token usage: ${geminiResult.tokenData?.inputTokens || 'N/A'} input, ${geminiResult.tokenData?.outputTokens || 'N/A'} output, ${geminiResult.tokenData?.totalTokens || 'N/A'} total`);
        
        res.json({
            success: true,
            message: 'User profile processed and saved successfully',
            data: {
                fullName: processedProfile.fullName,
                headline: processedProfile.headline,
                currentRole: processedProfile.currentRole,
                experienceCount: processedProfile.experience?.length || 0,
                educationCount: processedProfile.education?.length || 0,
                hasExperience: processedProfile.hasExperience,
                tokenUsage: {
                    inputTokens: geminiResult.tokenData?.inputTokens,
                    outputTokens: geminiResult.tokenData?.outputTokens,
                    totalTokens: geminiResult.tokenData?.totalTokens,
                    processingTimeMs: geminiResult.tokenData?.processingTimeMs
                }
            }
        });
        
    } catch (error) {
        console.error('❌ USER profile processing error:', error);
        
        res.status(500).json({
            success: false,
            error: 'User profile processing failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// ✅ NEW: Message Generation Endpoint (1 credit)
async function handleGenerateMessage(req, res) {
    let holdId = null;
    
    try {
        console.log('📧 === MESSAGE GENERATION WITH CREDITS ===');
        console.log(`👤 User ID: ${req.user.id}`);
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        // ✅ Create credit hold
        console.log('💳 Creating credit hold for message generation...');
        const holdResult = await createCreditHold(userId, 'message_generation', {
            targetProfileUrl: targetProfileUrl,
            outreachContext: outreachContext,
            timestamp: new Date().toISOString()
        });

        if (!holdResult.success) {
            if (holdResult.error === 'insufficient_credits') {
                return res.status(402).json({
                    success: false,
                    error: 'insufficient_credits',
                    userMessage: holdResult.userMessage,
                    currentCredits: holdResult.currentCredits,
                    requiredCredits: holdResult.requiredCredits
                });
            }
            
            return res.status(500).json({
                success: false,
                error: 'Failed to create credit hold',
                details: holdResult.error
            });
        }

        holdId = holdResult.holdId;
        console.log(`✅ Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);

        // TODO: Implement actual message generation with AI
        // For now, return a placeholder
        const generatedMessage = `Hi [Name],

I noticed your experience in ${outreachContext} and would love to connect. I believe there could be some interesting opportunities for collaboration.

Best regards,
[Your Name]`;

        // ✅ Complete operation and deduct credits
        console.log('💳 Completing operation and deducting credits...');
        const completionResult = await completeOperation(userId, holdId, {
            messageGenerated: true,
            messageLength: generatedMessage.length,
            targetUrl: targetProfileUrl
        });

        if (!completionResult.success) {
            console.error('❌ Failed to complete credit operation:', completionResult.error);
            await releaseCreditHold(userId, holdId, 'completion_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful generation'
            });
        }

        console.log(`💰 Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);

        res.json({
            success: true,
            message: 'LinkedIn message generated successfully',
            data: {
                generatedMessage: generatedMessage,
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl
            },
            credits: {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                transactionId: completionResult.transactionId
            }
        });

    } catch (error) {
        console.error('❌ Message generation error:', error);
        
        if (holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Message generation failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// ✅ NEW: Connection Request Generation Endpoint (1 credit)
async function handleGenerateConnection(req, res) {
    let holdId = null;
    
    try {
        console.log('🤝 === CONNECTION GENERATION WITH CREDITS ===');
        console.log(`👤 User ID: ${req.user.id}`);
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        // ✅ Create credit hold
        console.log('💳 Creating credit hold for connection generation...');
        const holdResult = await createCreditHold(userId, 'connection_generation', {
            targetProfileUrl: targetProfileUrl,
            outreachContext: outreachContext,
            timestamp: new Date().toISOString()
        });

        if (!holdResult.success) {
            if (holdResult.error === 'insufficient_credits') {
                return res.status(402).json({
                    success: false,
                    error: 'insufficient_credits',
                    userMessage: holdResult.userMessage,
                    currentCredits: holdResult.currentCredits,
                    requiredCredits: holdResult.requiredCredits
                });
            }
            
            return res.status(500).json({
                success: false,
                error: 'Failed to create credit hold',
                details: holdResult.error
            });
        }

        holdId = holdResult.holdId;
        console.log(`✅ Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);

        // TODO: Implement actual connection message generation with AI
        // For now, return a placeholder
        const generatedConnection = `I'd love to connect with you given your background in ${outreachContext}. Looking forward to potential collaboration opportunities.`;

        // ✅ Complete operation and deduct credits
        console.log('💳 Completing operation and deducting credits...');
        const completionResult = await completeOperation(userId, holdId, {
            connectionGenerated: true,
            messageLength: generatedConnection.length,
            targetUrl: targetProfileUrl
        });

        if (!completionResult.success) {
            console.error('❌ Failed to complete credit operation:', completionResult.error);
            await releaseCreditHold(userId, holdId, 'completion_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful generation'
            });
        }

        console.log(`💰 Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);

        res.json({
            success: true,
            message: 'Connection request generated successfully',
            data: {
                generatedConnection: generatedConnection,
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl
            },
            credits: {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                transactionId: completionResult.transactionId
            }
        });

    } catch (error) {
        console.error('❌ Connection generation error:', error);
        
        if (holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Connection generation failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// ✅ STEP 2D: Initialize authentication middleware with database functions
initAuthMiddleware({ getUserById });

// 🔧 DUAL AUTHENTICATION HELPER FUNCTION
const authenticateDual = async (req, res, next) => {
    // First try JWT authentication
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await getUserById(decoded.userId);
            if (user) {
                req.user = user;
                req.authMethod = 'jwt';
                return next();
            }
        } catch (jwtError) {
            console.log('JWT auth failed, trying session:', jwtError.message);
        }
    }
    
    // Then try session authentication
    if (req.isAuthenticated && req.isAuthenticated()) {
        req.authMethod = 'session';
        return next();
    }
    
    // If both fail, return 401
    return res.status(401).json({
        success: false,
        error: 'Please log in to access your profile'
    });
};

// ✅ STEP 2E: Initialize user routes with dependencies and get router
const userRoutes = initUserRoutes({
    pool,
    authenticateToken,
    getUserByEmail,
    getUserById,
    createUser,
    createOrUpdateUserProfile,
    getSetupStatusMessage
});

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://www.linkedin.com',
            'https://linkedin.com',
            'http://localhost:3000',
            'https://msgly.ai',
            'https://www.msgly.ai',
            'https://api.msgly.ai',
            'https://test.msgly.ai'
        ];
        
        if (origin.startsWith('chrome-extension://')) {
            return callback(null, true);
        }
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// ✅ MIDDLEWARE SETUP - PROPERLY POSITIONED
app.use(cors(corsOptions));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'msgly-session-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

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
                profile.photos[0]?.value
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

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ✅ STEP 2C: Mount static routes FIRST (before other routes)
app.use('/', staticRoutes);

// ✅ MODULARIZATION: Mount health routes
app.use('/', healthRoutes);

// ✅ STEP 2E: Mount user routes
app.use('/', userRoutes);

// ==================== CHROME EXTENSION AUTH ENDPOINT ====================

app.post('/auth/chrome-extension', async (req, res) => {
    console.log('🔑 Chrome Extension Auth Request:', {
        hasGoogleToken: !!req.body.googleAccessToken,
        clientType: req.body.clientType,
        extensionId: req.body.extensionId
    });
    
    try {
        const { googleAccessToken, clientType, extensionId } = req.body;
        
        if (!googleAccessToken) {
            return res.status(400).json({
                success: false,
                error: 'Google access token is required'
            });
        }
        
        if (clientType !== 'chrome_extension') {
            return res.status(400).json({
                success: false,
                error: 'Invalid client type'
            });
        }
        
        // Verify Google token and get user info
        console.log('🔍 Verifying Google token...');
        const googleResponse = await axios.get(
            `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${googleAccessToken}`
        );
        
        if (!googleResponse.data || !googleResponse.data.email) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Google token'
            });
        }
        
        const googleUser = googleResponse.data;
        console.log('✅ Google user verified:', {
            email: googleUser.email,
            name: googleUser.name,
            verified: googleUser.verified_email
        });
        
        // Find or create user
        let user = await getUserByEmail(googleUser.email);
        let isNewUser = false;
        
        if (!user) {
            console.log('👤 Creating new user...');
            user = await createGoogleUser(
                googleUser.email,
                googleUser.name,
                googleUser.id,
                googleUser.picture
            );
            isNewUser = true;
        } else if (!user.google_id) {
            console.log('🔗 Linking Google account to existing user...');
            await linkGoogleAccount(user.id, googleUser.id);
            user = await getUserById(user.id);
        }
        
        user.isNewUser = isNewUser;
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log('✅ Chrome extension authentication successful');
        
        res.json({
            success: true,
            message: 'Authentication successful',
            data: {
                token: token,
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    packageType: user.package_type,
                    credits: user.credits_remaining || 10,
                    linkedinUrl: user.linkedin_url,
                    registrationCompleted: user.registration_completed
                },
                isNewUser: isNewUser
            }
        });
        
    } catch (error) {
        console.error('❌ Chrome extension auth error:', error);
        
        if (error.response && error.response.status === 401) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Google token'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Authentication failed',
            details: error.message
        });
    }
});

// ==================== ENHANCED PROFILE PROCESSING ROUTES ====================

// ✅ Enhanced /scrape-html route with intelligent routing
app.post('/scrape-html', authenticateToken, (req, res) => {
    // ✅ REQUIRED LOGGING: Route entry
    console.log('🔍 route=/scrape-html');
    console.log(`🔍 isUserProfile=${req.body.isUserProfile}`);
    
    // ✅ Enhanced: Route based on isUserProfile parameter
    if (req.body.isUserProfile === true) {
        console.log('🔍 selectedHandler=USER');
        console.log('🔵 USER handler start');
        console.log(`🔍 userId=${req.user.id}`);
        console.log(`🔍 truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleUserProfile(req, res);
    } else {
        console.log('🔍 selectedHandler=TARGET');
        console.log('🎯 TARGET handler start');
        console.log(`🔍 userId=${req.user.id}`);
        console.log(`🔍 truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleTargetProfile(req, res);
    }
});

// ✅ CLEAN: Dedicated TARGET PROFILE endpoint
app.post('/target-profile/analyze', authenticateToken, (req, res) => {
    console.log('🎯 route=/target-profile/analyze');
    console.log('🎯 TARGET PROFILE ANALYSIS handler start');
    console.log(`🔍 userId=${req.user.id}`);
    console.log(`🔍 truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
    
    // Force isUserProfile to false for target profiles
    req.body.isUserProfile = false;
    
    return handleTargetProfile(req, res);
});

// ✅ NEW: Message Generation Endpoints
app.post('/generate-message', authenticateToken, handleGenerateMessage);
app.post('/generate-connection', authenticateToken, handleGenerateConnection);

// ✅ NEW: Credit Management Endpoints
app.get('/credits/balance', authenticateToken, async (req, res) => {
    try {
        const result = await getCurrentCredits(req.user.id);
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            data: {
                credits: result.credits,
                userId: req.user.id
            }
        });
    } catch (error) {
        console.error('❌ Error getting credit balance:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get credit balance'
        });
    }
});

app.get('/credits/history', authenticateToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const result = await getTransactionHistory(req.user.id, limit);
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            data: {
                transactions: result.transactions,
                userId: req.user.id
            }
        });
    } catch (error) {
        console.error('❌ Error getting transaction history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get transaction history'
        });
    }
});

// ==================== SESSION-DEPENDENT ROUTES (STAY IN SERVER.JS) ====================

// ✅ KEPT IN SERVER: Google OAuth Routes (Session creation/management)
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
    passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
    async (req, res) => {
        try {
            const token = jwt.sign(
                { userId: req.user.id, email: req.user.email },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
            const needsOnboarding = req.user.isNewUser || 
                                   !req.user.linkedin_url || 
                                   !req.user.registration_completed ||
                                   req.user.extraction_status === 'not_started';
            
            console.log(`🔍 OAuth callback - User: ${req.user.email}`);
            console.log(`   - Is new user: ${req.user.isNewUser || false}`);
            console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
            console.log(`   - Registration completed: ${req.user.registration_completed || false}`);
            console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
            console.log(`   - Needs onboarding: ${needsOnboarding}`);
            
            if (needsOnboarding) {
                console.log(`➡️ Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
                console.log(`➡️ Redirecting to dashboard`);
                res.redirect(`/dashboard?token=${token}`);
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

// 🚦 TRAFFIC LIGHT STATUS ENDPOINT - USER PROFILE ONLY (UNCHANGED)
app.get('/traffic-light-status', authenticateDual, async (req, res) => {
    try {
        console.log(`🚦 Traffic light status request from user ${req.user.id} using ${req.authMethod} auth`);

        const profileResult = await pool.query(`
            SELECT 
                u.registration_completed,
                u.linkedin_url,
                up.initial_scraping_done,
                up.data_extraction_status,
                up.profile_analyzed,
                up.extraction_completed_at,
                up.experience,
                up.full_name,
                up.headline,
                up.current_company,
                up.current_company_name
            FROM users u 
            LEFT JOIN user_profiles up ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        const data = profileResult.rows[0];
        
        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'User profile not found'
            });
        }

        // 🚦 DETERMINE TRAFFIC LIGHT STATUS - USER PROFILE ONLY
        const isRegistrationComplete = data.registration_completed || false;
        const isInitialScrapingDone = data.initial_scraping_done || false;
        const extractionStatus = data.data_extraction_status || 'pending';
        const hasExperience = data.experience && Array.isArray(data.experience) && data.experience.length > 0;

        let trafficLightStatus;
        let statusMessage;
        let actionRequired;

        if (isRegistrationComplete && isInitialScrapingDone && extractionStatus === 'completed' && hasExperience) {
            trafficLightStatus = 'GREEN';
            statusMessage = 'Profile fully synced and ready! Enhanced TARGET + USER PROFILE mode active.';
            actionRequired = null;
        } else if (isRegistrationComplete && isInitialScrapingDone) {
            trafficLightStatus = 'ORANGE';
            statusMessage = 'We\'re analyzing your profile data. This usually takes a few minutes.';
            actionRequired = 'WAIT_FOR_ANALYSIS';
        } else if (isRegistrationComplete) {
            trafficLightStatus = 'RED';
            statusMessage = 'Please visit your own LinkedIn profile with the Msgly.AI Chrome extension installed and active.';
            actionRequired = 'VISIT_LINKEDIN_PROFILE';
        } else {
            trafficLightStatus = 'RED';
            statusMessage = 'Please complete your registration by providing your LinkedIn URL.';
            actionRequired = 'COMPLETE_REGISTRATION';
        }

        console.log(`🚦 User ${req.user.id} Traffic Light Status: ${trafficLightStatus}`);
        console.log(`   - Registration Complete: ${isRegistrationComplete}`);
        console.log(`   - Initial Scraping Done: ${isInitialScrapingDone}`);
        console.log(`   - Extraction Status: ${extractionStatus}`);
        console.log(`   - Has Experience: ${hasExperience}`);

        res.json({
            success: true,
            data: {
                trafficLightStatus: trafficLightStatus,
                statusMessage: statusMessage,
                actionRequired: actionRequired,
                details: {
                    registrationCompleted: isRegistrationComplete,
                    initialScrapingDone: isInitialScrapingDone,
                    extractionStatus: extractionStatus,
                    hasExperience: hasExperience,
                    experienceCount: hasExperience ? data.experience.length : 0,
                    profileAnalyzed: data.profile_analyzed || false,
                    extractionCompletedAt: data.extraction_completed_at,
                    hasLinkedInUrl: !!data.linkedin_url,
                    hasBasicProfile: !!(data.full_name && data.headline),
                    hasCompanyInfo: !!(data.current_company || data.current_company_name)
                },
                debugInfo: {
                    userId: req.user.id,
                    authMethod: req.authMethod,
                    timestamp: new Date().toISOString(),
                    mode: 'ENHANCED_TARGET_USER_PROFILE'
                }
            }
        });

    } catch (error) {
        console.error('❌ Traffic light status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check traffic light status'
        });
    }
});

// 🔧 FIXED: Get User Profile - USER PROFILE ONLY (UNCHANGED)
app.get('/profile', authenticateDual, async (req, res) => {
    try {
        console.log(`🔍 Profile request from user ${req.user.id} using ${req.authMethod} auth`);

        const profileResult = await pool.query(`
            SELECT 
                up.*,
                u.extraction_status as user_extraction_status,
                u.registration_completed as user_registration_completed
            FROM user_profiles up 
            RIGHT JOIN users u ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        const profile = profileResult.rows[0];

        let syncStatus = {
            isIncomplete: false,
            missingFields: [],
            extractionStatus: 'unknown',
            initialScrapingDone: false
        };

        if (!profile || !profile.user_id) {
            syncStatus = {
                isIncomplete: true,
                missingFields: ['complete_profile'],
                extractionStatus: 'not_started',
                initialScrapingDone: false,
                reason: 'No profile data found'
            };
        } else {
            const extractionStatus = profile.data_extraction_status || 'not_started';
            const isProfileAnalyzed = profile.profile_analyzed || false;
            const initialScrapingDone = profile.initial_scraping_done || false;
            
            const missingFields = [];
            if (!profile.full_name) missingFields.push('full_name');
            if (!profile.headline) missingFields.push('headline');  
            if (!profile.current_company && !profile.current_position) missingFields.push('company_info');
            if (!profile.location) missingFields.push('location');
            
            const isIncomplete = (
                !initialScrapingDone ||
                extractionStatus !== 'completed' ||
                !isProfileAnalyzed ||
                missingFields.length > 0
            );
            
            syncStatus = {
                isIncomplete: isIncomplete,
                missingFields: missingFields,
                extractionStatus: extractionStatus,
                profileAnalyzed: isProfileAnalyzed,
                initialScrapingDone: initialScrapingDone,
                isCurrentlyProcessing: false,
                reason: isIncomplete ? 
                    `Initial scraping: ${initialScrapingDone}, Status: ${extractionStatus}, Missing: ${missingFields.join(', ')}` : 
                    'Profile complete and ready - Enhanced TARGET + USER PROFILE mode'
            };
        }

        res.json({
            success: true,
            data: {
                user: {
                    id: req.user.id,
                    email: req.user.email,
                    displayName: req.user.display_name,
                    profilePicture: req.user.profile_picture,
                    packageType: req.user.package_type,
                    billingModel: req.user.billing_model,
                    credits: req.user.credits_remaining,
                    subscriptionStatus: req.user.subscription_status,
                    hasGoogleAccount: !!req.user.google_id,
                    createdAt: req.user.created_at,
                    registrationCompleted: req.user.registration_completed,
                    authMethod: req.authMethod
                },
                profile: profile && profile.user_id ? {
                    linkedinUrl: profile.linkedin_url,
                    linkedinId: profile.linkedin_id,
                    linkedinNumId: profile.linkedin_num_id,
                    inputUrl: profile.input_url,
                    url: profile.url,
                    fullName: profile.full_name,
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    currentRole: profile.current_role,
                    summary: profile.summary,
                    about: profile.about,
                    location: profile.location,
                    city: profile.city,
                    state: profile.state,
                    country: profile.country,
                    countryCode: profile.country_code,
                    industry: profile.industry,
                    currentCompany: profile.current_company,
                    currentCompanyName: profile.current_company_name,
                    currentCompanyId: profile.current_company_id,
                    currentPosition: profile.current_position,
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    totalLikes: profile.total_likes,
                    totalComments: profile.total_comments,
                    totalShares: profile.total_shares,
                    averageLikes: profile.average_likes,
                    recommendationsCount: profile.recommendations_count,
                    publicIdentifier: profile.public_identifier,
                    experience: profile.experience,
                    education: profile.education,
                    skills: profile.skills,
                    skillsWithEndorsements: profile.skills_with_endorsements,
                    languages: profile.languages,
                    certifications: profile.certifications,
                    awards: profile.awards,
                    courses: profile.courses,
                    projects: profile.projects,
                    publications: profile.publications,
                    patents: profile.patents,
                    volunteerExperience: profile.volunteer_experience,
                    organizations: profile.organizations,
                    recommendations: profile.recommendations,
                    recommendationsGiven: profile.recommendations_given,
                    recommendationsReceived: profile.recommendations_received,
                    posts: profile.posts,
                    activity: profile.activity,
                    articles: profile.articles,
                    peopleAlsoViewed: profile.people_also_viewed,
                    engagementData: profile.engagement_data,
                    timestamp: profile.timestamp,
                    dataSource: profile.data_source,
                    extractionStatus: profile.data_extraction_status,
                    initialScrapingDone: profile.initial_scraping_done,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count,
                    profileAnalyzed: profile.profile_analyzed,
                    // ✅ NEW: Token tracking data
                    inputTokens: profile.input_tokens,
                    outputTokens: profile.output_tokens,
                    totalTokens: profile.total_tokens,
                    processingTimeMs: profile.processing_time_ms,
                    apiRequestId: profile.api_request_id,
                    responseStatus: profile.response_status
                } : null,
                syncStatus: syncStatus,
                mode: 'ENHANCED_TARGET_USER_PROFILE'
            }
        });
    } catch (error) {
        console.error('❌ Enhanced profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// 🔧 FIXED: Check profile extraction status - USER PROFILE ONLY (UNCHANGED)
app.get('/profile-status', authenticateDual, async (req, res) => {
    try {
        console.log(`🔍 Profile status request from user ${req.user.id} using ${req.authMethod} auth`);

        const userQuery = `
            SELECT 
                u.extraction_status,
                u.error_message,
                u.registration_completed,
                u.linkedin_url,
                up.data_extraction_status,
                up.extraction_completed_at,
                up.extraction_retry_count,
                up.extraction_error,
                up.initial_scraping_done
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.id = $1
        `;
        
        const result = await pool.query(userQuery, [req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const status = result.rows[0];
        
        res.json({
            extraction_status: status.extraction_status,
            registration_completed: status.registration_completed,
            linkedin_url: status.linkedin_url,
            error_message: status.error_message,
            data_extraction_status: status.data_extraction_status,
            extraction_completed_at: status.extraction_completed_at,
            extraction_retry_count: status.extraction_retry_count,
            extraction_error: status.extraction_error,
            initial_scraping_done: status.initial_scraping_done || false,
            is_currently_processing: false,
            processing_mode: 'ENHANCED_TARGET_USER_PROFILE',
            message: getStatusMessage(status.extraction_status, status.initial_scraping_done)
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// ==================== REMAINING API ENDPOINTS ====================

// Get Available Packages
app.get('/packages', (req, res) => {
    const packages = {
        payAsYouGo: [
            {
                id: 'free',
                name: 'Free',
                credits: 7,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'Enhanced TARGET + USER PROFILE mode', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Beautiful dashboard', 'No credit card required'],
                available: true
            }
        ],
        monthly: [
            {
                id: 'free',
                name: 'Free',
                credits: 7,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'Enhanced TARGET + USER PROFILE mode', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Beautiful dashboard', 'No credit card required'],
                available: true
            }
        ]
    };
    
    res.json({
        success: true,
        data: { packages }
    });
});

// ✅ NEW: Cleanup expired holds (run periodically)
setInterval(async () => {
    try {
        await cleanupExpiredHolds();
    } catch (error) {
        console.error('❌ Error during scheduled cleanup:', error);
    }
}, 30 * 60 * 1000); // Run every 30 minutes

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled Error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.path,
        method: req.method,
        message: 'Enhanced TARGET + USER PROFILE mode active with Credit Management',
        availableRoutes: [
            'GET /',
            'GET /sign-up',
            'GET /login', 
            'GET /dashboard',
            'GET /health',
            'POST /register',
            'POST /login',
            'GET /auth/google',
            'GET /auth/google/callback',
            'POST /auth/chrome-extension',
            'POST /complete-registration',
            'POST /update-profile',
            'GET /profile',
            'GET /profile-status',
            'GET /traffic-light-status',
            'POST /scrape-html (Enhanced routing: USER + TARGET)',
            'POST /target-profile/analyze (CLEAN: Dedicated TARGET endpoint)',
            'POST /generate-message (NEW: 1 credit)',
            'POST /generate-connection (NEW: 1 credit)',
            'GET /credits/balance (NEW: Credit management)',
            'GET /credits/history (NEW: Transaction history)',
            'GET /user/setup-status',
            'GET /user/initial-scraping-status',
            'GET /user/stats',
            'PUT /user/settings',
            'GET /packages'
        ]
    });
});

// ==================== SERVER STARTUP ====================

const startServer = async () => {
    try {
        validateEnvironment();
        
        const dbOk = await testDatabase();
        if (!dbOk) {
            console.error('❌ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Enhanced Msgly.AI Server - CREDIT MANAGEMENT SYSTEM ACTIVE!');
            console.log(`🔍 Port: ${PORT}`);
            console.log(`🗃️ Database: Enhanced PostgreSQL with TOKEN TRACKING + CREDIT SYSTEM`);
            console.log(`🔑 Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`🚦 TRAFFIC LIGHT SYSTEM ACTIVE`);
            console.log(`✅ CLEAN TARGET + USER PROFILE MODE:`);
            console.log(`   🔵 USER PROFILE: Automatic analysis on own LinkedIn profile`);
            console.log(`   🎯 TARGET PROFILE: Manual analysis via "Analyze" button click (0.25 credits)`);
            console.log(`   📄 /scrape-html: Intelligent routing based on isUserProfile parameter`);
            console.log(`   🎯 /target-profile/analyze: Clean dedicated TARGET PROFILE endpoint`);
            console.log(`   🗃️ Database: user_profiles table for USER, target_profiles table for TARGET`);
            console.log(`   🚦 Traffic Light system tracks User profile completion only`);
            console.log(`💳 CREDIT MANAGEMENT SYSTEM:`);
            console.log(`   🎯 Target Analysis: 0.25 credits`);
            console.log(`   📧 Message Generation: 1.0 credits`);
            console.log(`   🤝 Connection Generation: 1.0 credits`);
            console.log(`   🔒 Credit holds prevent double-spending`);
            console.log(`   💰 Deduction AFTER successful operations`);
            console.log(`   📊 Complete transaction audit trail`);
            console.log(`   ⚡ Real-time credit balance updates`);
            console.log(`   🧹 Automatic cleanup of expired holds`);
            console.log(`✅ NEW ENDPOINTS:`);
            console.log(`   POST /generate-message (1 credit)`);
            console.log(`   POST /generate-connection (1 credit)`);
            console.log(`   GET /credits/balance`);
            console.log(`   GET /credits/history`);
            console.log(`✅ TOKEN TRACKING SYSTEM:`);
            console.log(`   📊 Both USER and TARGET profiles save GPT-5 nano JSON responses`);
            console.log(`   📢 Input/output/total token counts tracked for all profiles`);
            console.log(`   ⏱️ Processing time and API request IDs logged`);
            console.log(`   💾 Raw responses stored for debugging and analysis`);
            console.log(`✅ PRODUCTION-READY CREDIT SYSTEM WITH HOLD PROTECTION!`);
        });
        
    } catch (error) {
        console.error('❌ Startup failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
