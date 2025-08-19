// server.js - Enhanced with Real Plan Data & Dual Credit System
// DATABASE-First TARGET PROFILE system with sophisticated credit management

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const axios = require('axios');

// FIXED: Import sendToGemini from correct path (project root)
const { sendToGemini } = require('./sendToGemini');
require('dotenv').config();

// ENHANCED: Import USER PROFILE database functions + dual credit system
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
    processGeminiData,
    // NEW: Dual Credit Management
    getUserPlan,
    updateUserCredits,
    spendUserCredits,
    resetRenewableCredits
} = require('./utils/database');

// NEW: Import enhanced credit management system
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

// STEP 2B: Import all utility functions from utils/helpers.js
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

// STEP 2D: Import authentication middleware
const {
    initAuthMiddleware,
    authenticateToken,
    requireFeatureAccess,
    requireAdmin
} = require('./middleware/auth');

// STEP 2E: Import user routes initialization function
const { initUserRoutes } = require('./routes/users');

// STEP 2C: Import modularized routes
const healthRoutes = require('./routes/health')(pool);
const staticRoutes = require('./routes/static');

// Token number cleaner
function cleanTokenNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    
    // Handle various input types
    let stringValue;
    if (typeof value === 'number') {
        stringValue = value.toString();
    } else {
        stringValue = String(value);
    }
    
    // Remove all non-numeric characters except negative sign
    const cleaned = stringValue.replace(/[^0-9-]/g, '');
    
    if (cleaned === '' || cleaned === '-') {
        return null;
    }
    
    // Convert to integer
    const result = parseInt(cleaned, 10);
    const isValid = !isNaN(result) && isFinite(result);
    
    return isValid ? result : null;
}

// Check if profile exists in database
async function checkIfProfileExistsInDB(linkedinUrl) {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        const result = await pool.query(`
            SELECT 
                id,
                user_id,
                linkedin_url,
                data_json,
                input_tokens,
                output_tokens,
                total_tokens,
                created_at
            FROM target_profiles 
            WHERE linkedin_url = $1
            ORDER BY created_at DESC 
            LIMIT 1
        `, [cleanUrl]);
        
        if (result.rows.length > 0) {
            const profile = result.rows[0];
            return {
                exists: true,
                data: {
                    id: profile.id,
                    analyzedBy: profile.user_id,
                    analyzedAt: profile.created_at,
                    analysis: 'PROFILE_EXISTS',
                    tokenUsage: {
                        inputTokens: profile.input_tokens,
                        outputTokens: profile.output_tokens,
                        totalTokens: profile.total_tokens
                    }
                }
            };
        } else {
            return {
                exists: false,
                data: null
            };
        }
    } catch (error) {
        console.error('[ERROR] Error checking profile in database:', error);
        return {
            exists: false,
            data: null
        };
    }
}

// Save profile analysis to database
async function saveProfileToDB(linkedinUrl, rawJsonData, userId, tokenData = {}) {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        // Clean token values
        const cleanedInput = cleanTokenNumber(tokenData.inputTokens);
        const cleanedOutput = cleanTokenNumber(tokenData.outputTokens);
        const cleanedTotal = cleanTokenNumber(tokenData.totalTokens);

        const result = await pool.query(`
            INSERT INTO target_profiles (
                user_id,
                linkedin_url, 
                data_json,
                input_tokens,
                output_tokens,
                total_tokens,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id, created_at
        `, [
            userId,
            cleanUrl,
            JSON.stringify(rawJsonData),
            cleanedInput,
            cleanedOutput,
            cleanedTotal
        ]);
        
        const savedProfile = result.rows[0];
        
        return {
            success: true,
            id: savedProfile.id,
            createdAt: savedProfile.created_at,
            data: {
                linkedinUrl: cleanUrl,
                analyzedBy: userId,
                analyzedAt: savedProfile.created_at,
                analysis: 'RAW_JSON_SAVED',
                tokenUsage: tokenData
            }
        };
    } catch (error) {
        console.error('[ERROR] Error saving profile to database:', error);
        throw error;
    }
}

// ENHANCED: DATABASE-First TARGET PROFILE handler with dual credit system
async function handleTargetProfileJSON(req, res) {
    let holdId = null;
    
    try {
        const { html, profileUrl } = req.body;
        const userId = req.user.id;
        
        if (!html || !profileUrl) {
            return res.status(400).json({
                success: false,
                error: 'HTML content and profileUrl are required for target profile processing'
            });
        }

        // Clean and validate LinkedIn URL
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        // STEP 1: Check if profile already exists in database
        const existsCheck = await checkIfProfileExistsInDB(cleanProfileUrl);
        
        if (existsCheck.exists) {
            // ALREADY ANALYZED: Return marketing message, no credits charged
            return res.json({
                success: true,
                alreadyAnalyzed: true,
                message: '[BOOM] Boom! This profile is already analyzed and ready. Jump straight to message magic - your personalized outreach awaits!',
                data: {
                    profileUrl: cleanProfileUrl,
                    analyzedAt: existsCheck.data.analyzedAt,
                    id: existsCheck.data.id,
                    // Basic profile info for message generation
                    fullName: 'LinkedIn User',
                    headline: 'Professional',
                    currentCompany: 'Company',
                    tokenUsage: existsCheck.data.tokenUsage
                },
                credits: {
                    charged: false,
                    message: 'No credits charged - profile already analyzed'
                }
            });
        }

        // STEP 2: NEW PROFILE - Create credit hold and analyze
        const holdResult = await createCreditHold(userId, 'target_analysis', {
            profileUrl: cleanProfileUrl,
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
        
        // Process HTML with GPT-5 nano
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: false  // FALSE for target profiles
        });
        
        if (!geminiResult.success) {
            console.error('[ERROR] GPT-5 nano processing failed for TARGET profile:', geminiResult.userMessage);
            
            // Release hold on failure
            await releaseCreditHold(userId, holdId, 'gemini_processing_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process target profile data with GPT-5 nano',
                details: geminiResult.userMessage || 'Unknown error'
            });
        }
        
        // STEP 3: Save analysis result to database
        const processedProfile = processGeminiData(geminiResult, cleanProfileUrl);
        
        // Save using the same pattern as user profile
        const saveResult = await saveProfileToDB(
            cleanProfileUrl, 
            processedProfile.geminiRawData,
            userId, 
            geminiResult.tokenData || {}
        );
        
        if (!saveResult.success) {
            // Release hold on save failure
            await releaseCreditHold(userId, holdId, 'database_save_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to save analysis to database'
            });
        }
        
        // STEP 4: Complete operation using dual credit system
        const spendResult = await spendUserCredits(userId, 0.25);
        
        if (!spendResult.success) {
            console.error('[ERROR] Failed to spend credits:', spendResult.error);
            await releaseCreditHold(userId, holdId, 'credit_deduction_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful analysis'
            });
        }
        
        // Complete the credit hold
        const completionResult = await completeOperation(userId, holdId, {
            profileUrl: cleanProfileUrl,
            databaseId: saveResult.id,
            analysisData: 'RAW_JSON_SAVED',
            tokenUsage: geminiResult.tokenData || {},
            spentCredits: spendResult.spent,
            newCredits: spendResult.newTotalCredits
        });

        res.json({
            success: true,
            alreadyAnalyzed: false,
            message: 'Target profile analyzed and saved successfully',
            data: {
                profileUrl: cleanProfileUrl,
                databaseId: saveResult.id,
                analyzedAt: saveResult.createdAt,
                // Basic profile info for message generation
                fullName: 'LinkedIn User',
                headline: 'Professional',
                currentCompany: 'Company',
                experienceCount: 1,
                educationCount: 1,
                tokenUsage: geminiResult.tokenData || {}
            },
            credits: {
                charged: true,
                deducted: spendResult.spent,
                newBalance: spendResult.newTotalCredits,
                renewableCredits: spendResult.newRenewableCredits,
                payasyougoCredits: spendResult.newPayasyougoCredits,
                transactionId: completionResult.transactionId
            }
        });
        
    } catch (error) {
        console.error('[ERROR] DATABASE-First TARGET profile processing error:', error);
        
        // Release hold on any error
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

// USER PROFILE HANDLER: Enhanced with token tracking
async function handleUserProfile(req, res) {
    try {
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
        
        // Process HTML with GPT-5 nano
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: true
        });
        
        if (!geminiResult.success) {
            console.error('[ERROR] GPT-5 nano processing failed for USER profile:', geminiResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process profile data with GPT-5 nano',
                details: geminiResult.error || 'Unknown error'
            });
        }
        
        // Process GPT-5 nano data for USER profile
        const processedProfile = processGeminiData(geminiResult, cleanProfileUrl);
        
        // Save to user_profiles table only
        const savedProfile = await createOrUpdateUserProfile(userId, cleanProfileUrl, processedProfile.fullName);
        
        // ENHANCED: Update user_profiles with processed data + token tracking
        await pool.query(`
            UPDATE user_profiles SET 
                full_name = $1,
                headline = $2,
                current_job_title = $3,
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
            processedProfile.currentJobTitle,
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
            // NEW: Token tracking data
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
        
        res.json({
            success: true,
            message: 'User profile processed and saved successfully',
            data: {
                fullName: processedProfile.fullName,
                headline: processedProfile.headline,
                currentJobTitle: processedProfile.currentJobTitle,
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
        console.error('[ERROR] USER profile processing error:', error);
        
        res.status(500).json({
            success: false,
            error: 'User profile processing failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// ENHANCED: Message Generation with dual credit system
async function handleGenerateMessage(req, res) {
    let holdId = null;
    
    try {
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        // Create credit hold
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

        // TODO: Implement actual message generation with AI
        // For now, return a placeholder
        const generatedMessage = `Hi [Name],

I noticed your experience in ${outreachContext} and would love to connect. I believe there could be some interesting opportunities for collaboration.

Best regards,
[Your Name]`;

        // Spend credits using dual credit system
        const spendResult = await spendUserCredits(userId, 1.0);

        if (!spendResult.success) {
            console.error('[ERROR] Failed to spend credits:', spendResult.error);
            await releaseCreditHold(userId, holdId, 'credit_deduction_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful generation'
            });
        }

        // Complete the credit hold
        const completionResult = await completeOperation(userId, holdId, {
            messageGenerated: true,
            messageLength: generatedMessage.length,
            targetUrl: targetProfileUrl,
            spentCredits: spendResult.spent,
            newCredits: spendResult.newTotalCredits
        });

        res.json({
            success: true,
            message: 'LinkedIn message generated successfully',
            data: {
                generatedMessage: generatedMessage,
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl
            },
            credits: {
                deducted: spendResult.spent,
                newBalance: spendResult.newTotalCredits,
                renewableCredits: spendResult.newRenewableCredits,
                payasyougoCredits: spendResult.newPayasyougoCredits,
                transactionId: completionResult.transactionId
            }
        });

    } catch (error) {
        console.error('[ERROR] Message generation error:', error);
        
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

// ENHANCED: Connection Request Generation with dual credit system
async function handleGenerateConnection(req, res) {
    let holdId = null;
    
    try {
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        // Create credit hold
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

        // TODO: Implement actual connection message generation with AI
        // For now, return a placeholder
        const generatedConnection = `I'd love to connect with you given your background in ${outreachContext}. Looking forward to potential collaboration opportunities.`;

        // Spend credits using dual credit system
        const spendResult = await spendUserCredits(userId, 1.0);

        if (!spendResult.success) {
            console.error('[ERROR] Failed to spend credits:', spendResult.error);
            await releaseCreditHold(userId, holdId, 'credit_deduction_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful generation'
            });
        }

        // Complete the credit hold
        const completionResult = await completeOperation(userId, holdId, {
            connectionGenerated: true,
            messageLength: generatedConnection.length,
            targetUrl: targetProfileUrl,
            spentCredits: spendResult.spent,
            newCredits: spendResult.newTotalCredits
        });

        res.json({
            success: true,
            message: 'Connection request generated successfully',
            data: {
                generatedConnection: generatedConnection,
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl
            },
            credits: {
                deducted: spendResult.spent,
                newBalance: spendResult.newTotalCredits,
                renewableCredits: spendResult.newRenewableCredits,
                payasyougoCredits: spendResult.newPayasyougoCredits,
                transactionId: completionResult.transactionId
            }
        });

    } catch (error) {
        console.error('[ERROR] Connection generation error:', error);
        
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

// STEP 2D: Initialize authentication middleware with database functions
initAuthMiddleware({ getUserById });

// DUAL AUTHENTICATION HELPER FUNCTION
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

// STEP 2E: Initialize user routes with dependencies and get router
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

// MIDDLEWARE SETUP - PROPERLY POSITIONED
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

// STEP 2C: Mount static routes FIRST (before other routes)
app.use('/', staticRoutes);

// MODULARIZATION: Mount health routes
app.use('/', healthRoutes);

// STEP 2E: Mount user routes
app.use('/', userRoutes);

// ==================== CHROME EXTENSION AUTH ENDPOINT ====================

app.post('/auth/chrome-extension', async (req, res) => {
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
        
        // Find or create user
        let user = await getUserByEmail(googleUser.email);
        let isNewUser = false;
        
        if (!user) {
            user = await createGoogleUser(
                googleUser.email,
                googleUser.name,
                googleUser.id,
                googleUser.picture
            );
            isNewUser = true;
        } else if (!user.google_id) {
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
                    // Calculate total credits from dual system
                    credits: (user.renewable_credits || 0) + (user.payasyougo_credits || 0),
                    linkedinUrl: user.linkedin_url,
                    registrationCompleted: user.registration_completed
                },
                isNewUser: isNewUser
            }
        });
        
    } catch (error) {
        console.error('[ERROR] Chrome extension auth error:', error);
        
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

// Enhanced /scrape-html route with intelligent routing
app.post('/scrape-html', authenticateToken, (req, res) => {
    // Enhanced: Route based on isUserProfile parameter
    if (req.body.isUserProfile === true) {
        return handleUserProfile(req, res);
    } else {
        return handleTargetProfileJSON(req, res);
    }
});

// NEW: DATABASE-First TARGET PROFILE endpoint
app.post('/target-profile/analyze-json', authenticateToken, (req, res) => {
    return handleTargetProfileJSON(req, res);
});

// ENHANCED: Message Generation Endpoints with dual credits
app.post('/generate-message', authenticateToken, handleGenerateMessage);
app.post('/generate-connection', authenticateToken, handleGenerateConnection);

// NEW: User Plan Endpoint - Returns real plan data
app.get('/user/plan', authenticateToken, async (req, res) => {
    try {
        const planResult = await getUserPlan(req.user.id);
        
        if (!planResult.success) {
            return res.status(500).json({
                success: false,
                error: planResult.error
            });
        }

        res.json({
            success: true,
            data: planResult.data
        });
    } catch (error) {
        console.error('[ERROR] Error getting user plan:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user plan'
        });
    }
});

// ENHANCED: Credit Management Endpoints with dual system
app.get('/credits/balance', authenticateToken, async (req, res) => {
    try {
        const planResult = await getUserPlan(req.user.id);
        
        if (!planResult.success) {
            return res.status(500).json({
                success: false,
                error: planResult.error
            });
        }

        res.json({
            success: true,
            data: {
                totalCredits: planResult.data.totalCredits,
                renewableCredits: planResult.data.renewableCredits,
                payasyougoCredits: planResult.data.payasyougoCredits,
                planRenewableCredits: planResult.data.planRenewableCredits,
                userId: req.user.id
            }
        });
    } catch (error) {
        console.error('[ERROR] Error getting credit balance:', error);
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
        console.error('[ERROR] Error getting transaction history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get transaction history'
        });
    }
});

// ==================== SESSION-DEPENDENT ROUTES ====================

// Google OAuth Routes
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
            
            if (needsOnboarding) {
                res.redirect(`/sign-up?token=${token}`);
            } else {
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

// ENHANCED TRAFFIC LIGHT STATUS ENDPOINT
app.get('/traffic-light-status', authenticateDual, async (req, res) => {
    try {
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

        // DETERMINE TRAFFIC LIGHT STATUS
        const isRegistrationComplete = data.registration_completed || false;
        const isInitialScrapingDone = data.initial_scraping_done || false;
        const extractionStatus = data.data_extraction_status || 'pending';
        const hasExperience = data.experience && Array.isArray(data.experience) && data.experience.length > 0;

        let trafficLightStatus;
        let statusMessage;
        let actionRequired;

        if (isRegistrationComplete && isInitialScrapingDone && extractionStatus === 'completed' && hasExperience) {
            trafficLightStatus = 'GREEN';
            statusMessage = 'Profile fully synced and ready! Enhanced DATABASE-FIRST TARGET + USER PROFILE mode active with dual credit system.';
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
                    mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS'
                }
            }
        });

    } catch (error) {
        console.error('[ERROR] Traffic light status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check traffic light status'
        });
    }
});

// Get User Profile with dual credit info
app.get('/profile', authenticateDual, async (req, res) => {
    try {
        const profileResult = await pool.query(`
            SELECT 
                up.*,
                u.extraction_status as user_extraction_status,
                u.registration_completed as user_registration_completed,
                u.renewable_credits,
                u.payasyougo_credits,
                u.plan_code,
                u.subscription_starts_at,
                u.next_billing_date
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
                    'Profile complete and ready - DATABASE-FIRST TARGET + USER PROFILE mode with dual credits'
            };
        }

        // Calculate total credits from dual system
        const totalCredits = (profile?.renewable_credits || 0) + (profile?.payasyougo_credits || 0);

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
                    // Enhanced credit info
                    credits: totalCredits,
                    renewableCredits: profile?.renewable_credits || 0,
                    payasyougoCredits: profile?.payasyougo_credits || 0,
                    planCode: profile?.plan_code || 'free',
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
                    currentJobTitle: profile.current_job_title,
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
                    // NEW: Token tracking data
                    inputTokens: profile.input_tokens,
                    outputTokens: profile.output_tokens,
                    totalTokens: profile.total_tokens,
                    processingTimeMs: profile.processing_time_ms,
                    apiRequestId: profile.api_request_id,
                    responseStatus: profile.response_status
                } : null,
                syncStatus: syncStatus,
                mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS'
            }
        });
    } catch (error) {
        console.error('[ERROR] Enhanced profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// Check profile extraction status
app.get('/profile-status', authenticateDual, async (req, res) => {
    try {
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
            processing_mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS',
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
                validity: '7 free credits monthly',
                features: ['7 Credits per month', 'Enhanced Chrome extension', 'DATABASE-FIRST TARGET + USER PROFILE mode', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Beautiful dashboard', 'No credit card required'],
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
                validity: '7 free credits monthly',
                features: ['7 Credits per month', 'Enhanced Chrome extension', 'DATABASE-FIRST TARGET + USER PROFILE mode', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Beautiful dashboard', 'No credit card required'],
                available: true
            }
        ]
    };
    
    res.json({
        success: true,
        data: { packages }
    });
});

// Cleanup expired holds (run periodically)
setInterval(async () => {
    try {
        await cleanupExpiredHolds();
    } catch (error) {
        console.error('[ERROR] Error during scheduled cleanup:', error);
    }
}, 30 * 60 * 1000); // Run every 30 minutes

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('[ERROR] Unhandled Error:', error);
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
        message: 'DATABASE-FIRST TARGET + USER PROFILE mode active with Dual Credit System',
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
            'POST /target-profile/analyze-json (NEW: DATABASE-first system)',
            'POST /generate-message (NEW: 1 credit with dual system)',
            'POST /generate-connection (NEW: 1 credit with dual system)',
            'GET /user/plan (NEW: Real plan data - NO MOCK!)',
            'GET /credits/balance (NEW: Dual credit management)',
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
            console.error('[ERROR] Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('[ROCKET] Enhanced Msgly.AI Server - DUAL CREDIT SYSTEM ACTIVE!');
            console.log(`[CHECK] Port: ${PORT}`);
            console.log(`[DB] Database: Enhanced PostgreSQL with TOKEN TRACKING + DUAL CREDIT SYSTEM`);
            console.log(`[FILE] Target Storage: DATABASE (target_profiles table)`);
            console.log(`[CHECK] Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`[LIGHT] TRAFFIC LIGHT SYSTEM ACTIVE`);
            console.log(`[SUCCESS] DATABASE-FIRST TARGET + USER PROFILE MODE WITH DUAL CREDITS:`);
            console.log(`   [BLUE] USER PROFILE: Automatic analysis on own LinkedIn profile (user_profiles table)`);
            console.log(`   [TARGET] TARGET PROFILE: Manual analysis via "Analyze" button click (target_profiles table)`);
            console.log(`   [BOOM] SMART DEDUPLICATION: Already analyzed profiles show marketing message`);
            console.log(`   [CHECK] /scrape-html: Intelligent routing based on isUserProfile parameter`);
            console.log(`   [TARGET] /target-profile/analyze-json: DATABASE-first TARGET PROFILE endpoint`);
            console.log(`   [DB] Database: user_profiles table for USER profiles`);
            console.log(`   [FILE] Database: target_profiles table for TARGET profiles`);
            console.log(`   [LIGHT] Traffic Light system tracks User profile completion only`);
            console.log(`[CREDIT] DUAL CREDIT SYSTEM:`);
            console.log(`   [CYCLE] RENEWABLE CREDITS: Reset monthly to plan amount`);
            console.log(`   [INFINITY] PAY-AS-YOU-GO CREDITS: Never expire, spent first`);
            console.log(`   [MONEY] SPENDING ORDER: Pay-as-you-go first, then renewable`);
            console.log(`   [CALENDAR] BILLING CYCLE: Only renewable credits reset`);
            console.log(`   [TARGET] Target Analysis: 0.25 credits (only for NEW profiles)`);
            console.log(`   [BOOM] Already Analyzed: FREE with marketing message`);
            console.log(`   [MESSAGE] Message Generation: 1.0 credits`);
            console.log(`   [CONNECT] Connection Generation: 1.0 credits`);
            console.log(`   [LOCK] Credit holds prevent double-spending`);
            console.log(`   [MONEY] Deduction AFTER successful operations`);
            console.log(`   [DATA] Complete transaction audit trail`);
            console.log(`   [LIGHTNING] Real-time credit balance updates`);
            console.log(`   [CLEAN] Automatic cleanup of expired holds`);
            console.log(`[SUCCESS] REAL PLAN DATA ENDPOINTS (NO MORE MOCK!):`);
            console.log(`   GET /user/plan (Real plan data from database)`);
            console.log(`   POST /target-profile/analyze-json (DATABASE-first system)`);
            console.log(`   POST /generate-message (1 credit with dual system)`);
            console.log(`   POST /generate-connection (1 credit with dual system)`);
            console.log(`   GET /credits/balance (Dual credit breakdown)`);
            console.log(`   GET /credits/history (Full transaction history)`);
            console.log(`[SUCCESS] TOKEN TRACKING SYSTEM:`);
            console.log(`   [DATA] USER profiles save GPT-5 nano data to user_profiles table`);
            console.log(`   [FILE] TARGET profiles save GPT-5 nano data to target_profiles table`);
            console.log(`   [NUMBERS] Input/output/total token counts tracked for all profiles`);
            console.log(`   [TIME] Processing time and API request IDs logged`);
            console.log(`   [SAVE] Raw responses stored for debugging and analysis`);
            console.log(`[SUCCESS] PRODUCTION-READY DATABASE-FIRST DUAL CREDIT SYSTEM WITH ZERO MOCK DATA!`);
        });
        
    } catch (error) {
        console.error('[ERROR] Startup failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[STOP] Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[STOP] Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
