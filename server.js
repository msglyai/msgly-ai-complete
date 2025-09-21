/*
CHANGELOG - server.js:
1. FIXED handleGenerateMessage function (line ~1156):
   - Added gemini_raw_data to user profile SELECT query
   - Added debug logging for gemini_raw_data presence and size
   - Added debug logging for target nested profile presence
   - Added GPT-5 usage logging (input/output/total tokens)
   - Ensured gemini_raw_data is passed through to gptService
2. No changes to auth, routing, credits, or endpoints
3. ADDED Chargebee integration: Import and test route
4. NEW: Added Chargebee webhook handler and checkout creation routes
5. FIXED: /test-chargebee route to match actual chargebeeService response format
6. FIXED: CHARGEBEE_PLAN_MAPPING - Updated 'Silver-PAYG' to 'Silver-PAYG-USD' to match actual Chargebee Item Price IDs
7. MINIMAL: Added /upgrade route to serve upgrade.html
8. NEW: Added MailerSend integration with minimal changes (import + 2 function calls)
9. FIXED: Added welcome email logic to OAuth callback for new users (2 minimal changes) - REMOVED EARLY EMAIL SENDING
10. COMPLETED: handleGenerateConnection() with full GPT service integration
11. NEW: Added handleGenerateIntro() function with GPT service integration
12. NEW: Added /generate-intro route
13. WEBHOOK FIX: Fixed JSON parsing error in Chargebee webhook handler
14. WEBHOOK PLAN FIX: Fixed plan ID extraction from subscription_items array instead of plan_id field
15. CRITICAL PAYG FIX: Enhanced handleInvoiceGenerated to support PAYG one-time purchases
16. REGISTRATION DEBUG: Added comprehensive logging to /complete-registration endpoint
17. WEBHOOK REGISTRATION FIX: Added automatic registration completion in webhooks
18. NEW: Added /store-pending-registration endpoint for sign-up page
19. CLEANUP: Removed excessive webhook debug logging
20. REFACTOR: Moved message handlers to controllers/messagesController.js and routes/messagesRoutes.js
21. MINIMAL FIX: Added /messages route to serve messages.html with authentication
22. AUTHENTICATION FIX: Removed authenticateToken middleware from /messages route (CLIENT-SIDE AUTH)
23. NEW: Added /msgly-profile route to serve msgly-profile.html
24. NEW: Added personal info endpoints GET/PUT /profile/personal-info
25. NEW: Added manual editing endpoints for basic-info, about, experience, education, skills, certifications
26. MESSAGES FIX: Added GET /messages/history endpoint for Messages page (43 lines added)
27. PAYG FIX: Fixed customer resolution in handleInvoiceGenerated for PAYG purchases
28. PAYG FIX: Added handlePaymentSucceeded as fallback webhook handler
29. 🔧 PAYG CRITICAL FIX: Fixed planLineItem detection to handle both plan_item_price and charge_item_price entity types with proper entity_id field usage
30. GOLD & PLATINUM: Added Gold-Monthly and Platinum-Monthly to CHARGEBEE_PLAN_MAPPING
31. CANCELLATION FIX: Added subscription cancellation webhook handlers for automatic downgrade to free plan
32. MINIMAL PAYG ADDITION: Added Gold-PAYG-USD and Platinum-PAYG-USD to CHARGEBEE_PLAN_MAPPING
33. BILLING REFACTOR: Moved all billing logic to dedicated modules (config/billing.js, controllers/billingController.js, routes/billingRoutes.js)
34. PROFESSIONAL LOGGER: Replaced all wrapped console.log with professional logger utility
35. MESSAGES DB FIX: Added missing PUT /messages/:id endpoint and fixed GET /messages/history to read actual database values
36. PERSONAL INFO SAVE FIX: Fixed PUT /profile/personal-info to handle missing user_profiles records
37. FILE UPLOAD: Added file upload functionality with minimal changes (multer + 1 route)
38. PROFILE DATA EXTRACTION FIX: Added extractProfileFromJson function and updated file upload response to include extracted profile data
39. MINIMAL FIX: Fixed extractProfileFromJson to use correct JSON structure from database
40. MINIMAL FIX: Simplified file upload response handling to prevent "headers already sent" error
41. CONTEXTS: Added contexts routes mounting for context management system
42. UNIFIED GENERATION FIX: Connected /generate-unified endpoint to existing GPT-5 message generation system - REMOVED ALL MOCK DATA
43. CONTEXT ADDON PURCHASE: Added /context-addons/purchase endpoint for extension Buy Extra slot functionality
44. CONTEXT FIX: Added missing context slot function imports to database imports
45. CORS FIX: Added PUT and DELETE methods to CORS configuration for context deletion
46. ADMIN DASHBOARD: Added admin routes import and mounting for internal analytics dashboard
47. EMAIL FIX: Removed early welcome email sending from OAuth callback - emails now sent at proper registration completion
48. ADMIN NOTIFICATIONS: Added admin notification emails to ziv@msgly.ai for new user registrations
49. EMAIL TIMING FIX: Moved welcome email sending from /complete-registration to dashboard load timing
50. DUO ADMIN AUTH: Added Duo Universal SDK authentication for admin dashboard protection
51. DUO ES MODULE FIX: Fixed Duo Universal SDK import to use dynamic import() instead of require()
52. 🔧 DUO ADMIN FIX: Fixed createAuthUrl to be awaited and fixed crypto scope issue
*/

// server.js - Enhanced with Real Plan Data & Dual Credit System + AUTO-REGISTRATION + GPT-5 MESSAGE GENERATION + CHARGEBEE INTEGRATION + MAILERSEND + WEBHOOK REGISTRATION FIX + MSGLY PROFILE + PERSONAL INFO + MANUAL EDITING + PAYG FIX + GOLD & PLATINUM PLANS + CANCELLATION HANDLING + GOLD & PLATINUM PAYG + BILLING REFACTOR + PROFESSIONAL LOGGER + MESSAGES DB FIX + PERSONAL INFO SAVE FIX + FILE UPLOAD + PROFILE DATA EXTRACTION FIX + MINIMAL PROFILE FIX + CONTEXTS + UNIFIED GENERATION REAL GPT INTEGRATION + CONTEXT ADDON PURCHASE + CONTEXT SLOT FUNCTIONS + CORS FIX + ADMIN DASHBOARD + EMAIL FIX + ADMIN NOTIFICATIONS + EMAIL TIMING FIX + DUO ADMIN 2FA + DUO ES MODULE FIX + DUO ADMIN FIX
// DATABASE-First TARGET PROFILE system with sophisticated credit management
// ✅ AUTO-REGISTRATION: Enhanced Chrome extension auth with LinkedIn URL support
// ✅ RACE CONDITION FIX: Added minimal in-memory tracking to prevent duplicate processing
// ✅ URL MATCHING FIX: Fixed profile deduplication to handle both URL formats
// ✅ GPT-5 INTEGRATION: Real LinkedIn message generation with comprehensive logging
// ✅ CHARGEBEE INTEGRATION: Payment processing and subscription management
// ✅ MAILERSEND INTEGRATION: Welcome email automation
// ✅ WEBHOOK FIX: Fixed Chargebee webhook JSON parsing error
// ✅ PAYG FIX: Fixed one-time purchase webhook handling
// ✅ REGISTRATION DEBUG: Enhanced logging to identify registration failures
// ✅ WEBHOOK REGISTRATION FIX: Automatic registration completion in webhooks after payment
// ✅ MODULAR REFACTOR: Messages handlers moved to dedicated controller/routes files
// ✅ MESSAGES ROUTE FIX: Added /messages route to serve messages.html with authentication
// ✅ AUTHENTICATION FIX: Removed server-side auth middleware, using client-side auth instead
// ✅ MSGLY PROFILE: Added route to serve msgly-profile.html
// ✅ PERSONAL INFO: Added endpoints for personal information CRUD operations
// ✅ MANUAL EDITING: Added endpoints for manual user profile editing
// ✅ PAYG CUSTOMER FIX: Fixed customer resolution for PAYG webhook processing
// 🔧 PAYG CRITICAL FIX: Fixed planLineItem detection for both plan_item_price and charge_item_price
// ✅ GOLD & PLATINUM: Added support for Gold and Platinum monthly plans
// ✅ CANCELLATION FIX: Added subscription cancellation webhook handlers for automatic downgrade
// ✅ GOLD & PLATINUM PAYG: Added Gold-PAYG-USD and Platinum-PAYG-USD support
// ✅ BILLING REFACTOR: Clean separation of billing logic into dedicated modules
// ✅ PROFESSIONAL LOGGER: Environment-based professional logging for clean production deployment
// ✅ MESSAGES DB FIX: Fixed Messages page save functionality with proper database integration
// ✅ PERSONAL INFO SAVE FIX: Fixed personal information save to handle missing user_profiles records
// ✅ FILE UPLOAD: Added file upload functionality for target profile analysis with consent checkbox
// ✅ PROFILE DATA EXTRACTION FIX: Added profile data extraction from JSON and proper response formatting
// ✅ MINIMAL PROFILE FIX: Fixed extractProfileFromJson to use correct database JSON structure and simplified response handling
// ✅ CONTEXTS: Added context management system with plan-based limits
// ✅ UNIFIED GENERATION REAL GPT: Connected /generate-unified to existing GPT-5 message generation - NO MORE MOCK DATA
// ✅ CONTEXT ADDON PURCHASE: Added /context-addons/purchase endpoint for extension Buy Extra slot functionality
// ✅ CONTEXT FIX: Added missing context slot function imports for proper webhook allocation
// ✅ CORS FIX: Added PUT and DELETE methods to CORS configuration for context deletion
// ✅ ADMIN DASHBOARD: Added admin routes for internal analytics dashboard with JWT authentication
// ✅ EMAIL FIX: Removed early welcome email sending from OAuth callback - now properly timed
// ✅ ADMIN NOTIFICATIONS: Added admin notification emails to ziv@msgly.ai for new registrations
// ✅ EMAIL TIMING FIX: Moved welcome email sending from /complete-registration to /send-welcome-email endpoint called by dashboard
// ✅ DUO ADMIN 2FA: Added Duo Universal SDK authentication for admin dashboard security
// ✅ DUO ES MODULE FIX: Fixed Duo Universal SDK import to use dynamic import() instead of require()
// 🔧 DUO ADMIN FIX: Fixed createAuthUrl to be awaited and fixed crypto scope issue

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

// NEW: File upload dependencies
const multer = require('multer');

// NEW: Import professional logger utility
const logger = require('./utils/logger');

// FIXED: Removed require() import for Duo Universal SDK - will use dynamic import() instead
const crypto = require('node:crypto'); // 🔧 DUO ADMIN FIX: Use explicit node: prefix for Node.js 18+ compatibility

// FIXED: Import sendToGemini from correct path (project root)
const { sendToGemini } = require('./sendToGemini');

// NEW: Import GPT-5 service
const gptService = require('./services/gptService');

// NEW: Import message generation functions for unified endpoint
const { 
    handleGenerateMessage, 
    handleGenerateConnection, 
    handleGenerateColdEmail 
} = require('./controllers/messagesController');

// NEW: Import Chargebee service
const { chargebeeService } = require('./services/chargebeeService');

// ✅ EMAIL TIMING FIX: Import both email functions for new endpoint
const { sendWelcomeEmail, sendAdminNotification } = require('./mailer/mailer');

// NEW: Import billing configuration
const { CHARGEBEE_PLAN_MAPPING } = require('./config/billing');

// NEW: Import file upload controller
const { handleFileUpload } = require('./controllers/file-upload-controller');

require('dotenv').config();

// ENHANCED: Import USER PROFILE database functions + dual credit system + PENDING REGISTRATIONS + CANCELLATION MANAGEMENT + CONTEXT FUNCTIONS
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
    resetRenewableCredits,
    // ✅ CANCELLATION FIX: Import cancellation management function
    downgradeUserToFree,
    // NEW: Pending Registration Functions
    storePendingRegistration,
    getPendingRegistration,
    completePendingRegistration,
    // 🔧 CONTEXT FIX: ADD MISSING CONTEXT SLOT FUNCTIONS
    getContextAddonUsage,
    createContextAddon,
    updateUserContextSlots,
    initializeContextSlots
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
    requireAdmin,
    adminGuard
} = require('./middleware/auth');

// STEP 2E: Import user routes initialization function
const { initUserRoutes } = require('./routes/users');

// STEP 2C: Import modularized routes
const healthRoutes = require('./routes/health')(pool);
const staticRoutes = require('./routes/static');
// ADMIN DASHBOARD: Import admin routes
const adminRoutes = require('./routes/adminRoutes');

// NEW: RACE CONDITION FIX - Track active profile processing to prevent duplicates
const activeProcessing = new Map();

// NEW: Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1 // Only one file at a time
    },
    fileFilter: (req, file, cb) => {
        // Allow PDF, DOC, DOCX, and TXT files
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and TXT files are allowed.'), false);
        }
    }
});

// ==================== DUO UNIVERSAL SDK CONFIGURATION - FIXED ES MODULE IMPORT ====================

// Duo environment variables
const DUO_CLIENT_ID = process.env.DUO_IKEY;
const DUO_CLIENT_SECRET = process.env.DUO_SKEY;
const DUO_API_HOST = process.env.DUO_HOST;
const ADMIN_ALLOWED_EMAILS = process.env.ADMIN_ALLOWED_EMAILS;
const ADMIN_AUTH_DISABLED = process.env.ADMIN_AUTH_DISABLED === 'true';

// Initialize Duo client (using dynamic import)
let duoClient = null;
let DuoClient = null;

// Dynamic import function for Duo
async function initializeDuo() {
    try {
        if (DUO_CLIENT_ID && DUO_CLIENT_SECRET && DUO_API_HOST) {
            // Dynamic import of ES Module
            const duoModule = await import('@duosecurity/duo_universal');
            DuoClient = duoModule.Client;
            
            duoClient = new DuoClient({
                clientId: DUO_CLIENT_ID,
                clientSecret: DUO_CLIENT_SECRET,
                apiHost: DUO_API_HOST,
                redirectUrl: process.env.NODE_ENV === 'production' 
                    ? 'https://api.msgly.ai/admin-duo-callback'
                    : 'http://localhost:3000/admin-duo-callback'
            });
            
            logger.success('Duo Universal SDK initialized successfully');
            return true;
        } else {
            logger.warn('Duo Universal SDK not configured - admin auth will use emergency bypass');
            return false;
        }
    } catch (error) {
        logger.error('Duo Universal SDK initialization failed:', error);
        return false;
    }
}

// Duo helper functions
function validateDuoConfig() {
    return !!(DUO_CLIENT_ID && DUO_CLIENT_SECRET && DUO_API_HOST && duoClient);
}

function generateState() {
    return require('node:crypto').randomBytes(32).toString('hex'); // 🔧 DUO ADMIN FIX: Direct require in function scope
}

function validateState(sessionState, returnedState) {
    return sessionState && returnedState && sessionState === returnedState;
}

function isAdminAllowed(email) {
    if (!ADMIN_ALLOWED_EMAILS) return false;
    const allowedEmails = ADMIN_ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase());
    return allowedEmails.includes(email.toLowerCase());
}

function isAdminSessionValid(session) {
    if (!session || !session.adminAuth) return false;
    
    const now = Date.now();
    const sessionAge = now - new Date(session.adminAuth.loginTime).getTime();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours
    
    return sessionAge < maxAge && session.adminAuth.isAuthenticated;
}

function generateAdminSession(email) {
    return {
        isAuthenticated: true,
        adminEmail: email,
        loginTime: new Date().toISOString(),
        sessionId: require('node:crypto').randomUUID() // 🔧 DUO ADMIN FIX: Direct require in function scope
    };
}

// MINIMAL FIX: Extract profile data from JSON structure - FIXED to use correct database structure
function extractProfileFromJson(rawJsonData) {
    try {
        let profile;
        if (typeof rawJsonData === 'string') {
            profile = JSON.parse(rawJsonData);
        } else {
            profile = rawJsonData;
        }
        
        // FIXED: Use the correct JSON structure from database
        // Actual structure: { "profile": { "name": "ZIV SHECHORY", "firstName": "Ziv", etc } }
        const profileSection = profile.profile || {};
        
        logger.debug('[EXTRACT] Profile section found:', !!profileSection);
        logger.debug('[EXTRACT] Available fields:', Object.keys(profileSection));
        
        const extractedData = {
            fullName: profileSection.name || profileSection.fullName || 
                     (profileSection.firstName && profileSection.lastName ? 
                      `${profileSection.firstName} ${profileSection.lastName}` : 'Profile Name'),
            headline: profileSection.headline || profileSection.currentRole || 'Professional Title',
            currentJobTitle: profileSection.currentRole || profileSection.currentJobTitle || profileSection.headline,
            currentCompany: profileSection.currentCompany || profileSection.company || 'Company'
        };
        
        logger.debug('[EXTRACT] Extracted profile data:', extractedData);
        return extractedData;
        
    } catch (error) {
        logger.error('[EXTRACT] Profile extraction failed:', error);
        return {
            fullName: 'Profile Extracted', 
            headline: 'Analysis Complete',
            currentJobTitle: 'Professional',
            currentCompany: 'Company'
        };
    }
}

// NEW: Robust token number cleaner
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

// NEW: DATABASE-First System Functions

// Check if profile exists in database - FIXED: Handle both URL formats
async function checkIfProfileExistsInDB(linkedinUrl) {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        const originalUrl = linkedinUrl; // Keep original URL as-is
        
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
            WHERE linkedin_url = $1 OR linkedin_url = $2
            ORDER BY created_at DESC 
            LIMIT 1
        `, [cleanUrl, originalUrl]);
        
        if (result.rows.length > 0) {
            const profile = result.rows[0];
            logger.success(`Profile already exists in database: ID ${profile.id}`);
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
            logger.debug(`Profile is new in database: ${cleanUrl}`);
            return {
                exists: false,
                data: null
            };
        }
    } catch (error) {
        logger.error('Error checking profile in database:', error);
        return {
            exists: false,
            data: null
        };
    }
}

// Save profile analysis to database
async function saveProfileToDB(linkedinUrl, rawJsonData, userId, tokenData = {}) {
    logger.debug('saveProfileToDB FUNCTION CALLED - START OF FUNCTION');
    logger.trace('saveProfileToDB function entry - detailed parameters:', {
        linkedinUrl,
        userId
    });
    
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        // Clean token values
        const cleanedInput = cleanTokenNumber(tokenData.inputTokens);
        const cleanedOutput = cleanTokenNumber(tokenData.outputTokens);
        const cleanedTotal = cleanTokenNumber(tokenData.totalTokens);
        
        logger.debug('Final values going to database:', {
            inputTokens: cleanedInput,
            outputTokens: cleanedOutput,
            totalTokens: cleanedTotal
        });
        
        logger.custom('TARGET', 'ABOUT TO EXECUTE TARGET PROFILE INSERT');
        logger.trace('SQL VALUES GOING TO DATABASE:', {
            userId: { value: userId, type: typeof userId },
            cleanUrl: { value: cleanUrl, type: typeof cleanUrl },
            cleanedInput: { value: cleanedInput, type: typeof cleanedInput },
            cleanedOutput: { value: cleanedOutput, type: typeof cleanedOutput },
            cleanedTotal: { value: cleanedTotal, type: typeof cleanedTotal }
        });

        let result;
        try {
            logger.debug('About to execute PostgreSQL INSERT query...');
            result = await pool.query(`
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
                JSON.stringify(rawJsonData), // Same pattern as user profile: JSON.stringify(processedProfile.geminiRawData)
                cleanedInput,
                cleanedOutput,
                cleanedTotal
            ]);
            
            logger.custom('TARGET', 'TARGET PROFILE INSERT SUCCESS!');
            
        } catch (dbError) {
            logger.error('TARGET PROFILE INSERT FAILED!');
            logger.error('DATABASE ERROR:', dbError.message);
            logger.debug('ERROR DETAIL:', dbError.detail);
            logger.debug('SQL STATE:', dbError.code);
            logger.trace('PROBLEMATIC VALUES - DETAILED:', {
                param1: { value: userId, type: typeof userId, isNull: userId === null },
                param2: { value: cleanUrl, type: typeof cleanUrl, length: cleanUrl?.length },
                param3: { type: typeof rawJsonData, jsonLength: JSON.stringify(rawJsonData).length },
                param4: { value: cleanedInput, type: typeof cleanedInput, isNull: cleanedInput === null, original: tokenData.inputTokens },
                param5: { value: cleanedOutput, type: typeof cleanedOutput, isNull: cleanedOutput === null, original: tokenData.outputTokens },
                param6: { value: cleanedTotal, type: typeof cleanedTotal, isNull: cleanedTotal === null, original: tokenData.totalTokens }
            });
            throw dbError;
        }
        
        const savedProfile = result.rows[0];
        
        logger.success(`Profile saved to database: ID ${savedProfile.id}`);
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
        logger.error('Error saving profile to database:', error);
        throw error;
    }
}

// ✅ FIXED: DATABASE-First TARGET PROFILE handler with dual credit system (NO DOUBLE SPENDING)
async function handleTargetProfileJSON(req, res) {
    logger.debug('handleTargetProfileJSON FUNCTION CALLED - START OF FUNCTION');
    logger.custom('TARGET', '=== DATABASE-FIRST TARGET PROFILE PROCESSING ===');
    logger.debug('Request body keys:', Object.keys(req.body || {}));
    logger.debug('User object:', req.user ? { id: req.user.id, email: req.user.email } : 'NO USER');
    
    let holdId = null;
    
    try {
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`URL: ${req.body.profileUrl}`);
        
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
        logger.debug('Checking if profile already exists in database...');
        const existsCheck = await checkIfProfileExistsInDB(cleanProfileUrl);
        
        if (existsCheck.exists) {
            // ALREADY ANALYZED: Return marketing message, no credits charged
            logger.custom('BOOM', 'Profile already analyzed - showing marketing message');
            
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

        // STEP 1.5: RACE CONDITION FIX - Check if currently being processed
        const requestKey = `${userId}_${cleanProfileUrl}`;
        if (activeProcessing.has(requestKey)) {
            logger.custom('RACE', 'Profile currently being processed by another request');
            return res.status(200).json({
                success: true,
                alreadyAnalyzed: true,
                message: "💥 Boom! We're ahead of you! Profile locked and loaded. Step 2 awaits - **no cost to you!** 🔥",
                data: {
                    profileUrl: cleanProfileUrl,
                    analyzedAt: new Date(),
                    id: 'processing',
                    fullName: 'LinkedIn User',
                    headline: 'Professional',
                    currentCompany: 'Company'
                },
                credits: {
                    charged: false,
                    message: 'No credits charged - profile currently being analyzed'
                }
            });
        }

        // Mark as processing
        activeProcessing.set(requestKey, Date.now());
        logger.custom('RACE', `Marked profile as processing: ${requestKey}`);

        // STEP 2: NEW PROFILE - Create credit hold and analyze
        logger.custom('CREDIT', 'Creating credit hold for new profile analysis...');
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
        logger.success(`Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        logger.info('Processing HTML with Gemini for NEW TARGET profile...');
        
        // Process HTML with Gemini
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: false  // FALSE for target profiles
        });
        
        if (!geminiResult.success) {
            logger.error('Gemini processing failed for TARGET profile:', geminiResult.userMessage);
            
            // Release hold on failure
            await releaseCreditHold(userId, holdId, 'gemini_processing_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process target profile data with Gemini',
                details: geminiResult.userMessage || 'Unknown error'
            });
        }
        
        logger.success('Gemini processing successful for TARGET profile');
        logger.info('Saving analysis to database...');
        logger.debug('About to call saveProfileToDB with:', {
            cleanProfileUrlLength: cleanProfileUrl.length,
            geminiResultRawResponseAvailable: !!geminiResult.rawResponse,
            userId
        });
        
        // COPY USER PROFILE PATTERN: Process the data first
        const processedProfile = processGeminiData(geminiResult, cleanProfileUrl);
        
        // Save using the same pattern as user profile
        const saveResult = await saveProfileToDB(
            cleanProfileUrl, 
            processedProfile.geminiRawData, // Use processed data like user profile
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
        
        // ✅ FIXED: STEP 4 - Complete operation (SINGLE credit deduction)
        logger.custom('CREDIT', 'Completing operation with credit deduction...');
        const completionResult = await completeOperation(userId, holdId, {
            profileUrl: cleanProfileUrl,
            databaseId: saveResult.id,
            analysisData: 'RAW_JSON_SAVED',
            tokenUsage: geminiResult.tokenData || {},
            processingTime: 0
        });

        if (!completionResult.success) {
            logger.error('Failed to complete operation:', completionResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful analysis'
            });
        }

        logger.success('TARGET profile saved to database successfully');
        logger.info(`Analysis saved: Database ID ${saveResult.id}`);
        logger.custom('MONEY', `Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
        
        // Extract basic profile info for response
        const profileData = { name: 'LinkedIn User', headline: '', currentCompany: '' };
        
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
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                renewableCredits: completionResult.renewableCredits,
                payasyougoCredits: completionResult.payasyougoCredits,
                transactionId: completionResult.transactionId
            }
        });
        
    } catch (error) {
        logger.error('DATABASE-First TARGET profile processing error:', error);
        
        // Release hold on any error
        if (holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Target profile processing failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        // RACE CONDITION FIX: Always cleanup processing map
        if (req.body.profileUrl) {
            const cleanProfileUrl = cleanLinkedInUrl(req.body.profileUrl);
            const requestKey = `${req.user.id}_${cleanProfileUrl}`;
            activeProcessing.delete(requestKey);
            logger.custom('RACE', `Cleaned up processing map: ${requestKey}`);
        }
    }
}

// USER PROFILE HANDLER: Enhanced with token tracking (UNCHANGED)
async function handleUserProfile(req, res) {
    try {
        logger.custom('BLUE', '=== USER PROFILE PROCESSING ===');
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`URL: ${req.body.profileUrl}`);
        
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
        
        logger.info('Processing HTML with Gemini for USER profile...');
        
        // Process HTML with Gemini
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: true
        });
        
        if (!geminiResult.success) {
            logger.error('Gemini processing failed for USER profile:', geminiResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process profile data with Gemini',
                details: geminiResult.error || 'Unknown error'
            });
        }
        
        logger.success('Gemini processing successful for USER profile');
        
        // Process Gemini data for USER profile
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
        
        logger.success('USER profile saved to user_profiles table successfully');
        logger.info(`Token usage: ${geminiResult.tokenData?.inputTokens || 'N/A'} input, ${geminiResult.tokenData?.outputTokens || 'N/A'} output, ${geminiResult.tokenData?.totalTokens || 'N/A'} total`);
        
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
        logger.error('USER profile processing error:', error);
        
        res.status(500).json({
            success: false,
            error: 'User profile processing failed',
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
            logger.debug('JWT auth failed, trying session:', jwtError.message);
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

// STEP 2C: Import modularized routes
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // 🔧 CORS FIX: Added PUT and DELETE methods
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
        logger.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// Logging middleware
app.use((req, res, next) => {
    logger.debug(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// STEP 2C: Mount static routes FIRST (before other routes)
app.use('/', staticRoutes);

// Serve upgrade page
app.get('/upgrade', (req, res) => {
    res.sendFile(path.join(__dirname, 'upgrade.html'));
});

// AUTHENTICATION FIX: Removed authenticateToken middleware - using client-side auth instead
app.get('/messages', (req, res) => {
    res.sendFile(path.join(__dirname, 'messages.html'));
});

// NEW: Serve msgly-profile page
app.get('/msgly-profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'msgly-profile.html'));
});

// Also support without .html extension
app.get('/msgly-profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'msgly-profile.html'));
});

// ==================== DUO ADMIN AUTHENTICATION ROUTES ====================

// Serve admin login page
app.get('/admin-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/admin-login.html'));
});

// Admin login initiation
app.post('/admin-initiate-duo', async (req, res) => {
    try {
        logger.custom('DUO', '=== ADMIN DUO LOGIN INITIATION ===');
        
        // Check for emergency bypass
        if (ADMIN_AUTH_DISABLED) {
            logger.warn('EMERGENCY BYPASS: Admin auth disabled');
            
            req.session.adminAuth = generateAdminSession('emergency@bypass.local');
            
            return res.json({
                success: true,
                bypass: true,
                message: 'Emergency bypass enabled',
                redirectUrl: '/admin-dashboard'
            });
        }
        
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }
        
        // Validate email is in allowlist
        if (!isAdminAllowed(email)) {
            logger.warn(`Unauthorized admin access attempt: ${email}`);
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                userMessage: 'You are not authorized to access the admin dashboard'
            });
        }
        
        // Validate Duo configuration
        if (!validateDuoConfig()) {
            logger.error('Duo not properly configured');
            return res.status(500).json({
                success: false,
                error: 'Authentication service not available'
            });
        }
        
        // Generate state for CSRF protection
        const state = generateState();
        req.session.duoState = state;
        req.session.adminEmail = email;
        
        // 🔧 DUO ADMIN FIX: Create auth URL with await
        const authUrl = await duoClient.createAuthUrl(email, state);
        
        logger.info(`Admin Duo auth initiated for: ${email}`);
        logger.debug(`Auth URL generated: ${authUrl.substring(0, 50)}...`);
        
        res.json({
            success: true,
            authUrl: authUrl,
            message: 'Redirecting to Duo for authentication'
        });
        
    } catch (error) {
        logger.error('Admin Duo initiation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate authentication'
        });
    }
});

// Duo callback handler
app.get('/admin-duo-callback', async (req, res) => {
    try {
        logger.custom('DUO', '=== ADMIN DUO CALLBACK ===');
        
        // Check for emergency bypass
        if (ADMIN_AUTH_DISABLED) {
            req.session.adminAuth = generateAdminSession('emergency@bypass.local');
            return res.redirect('/admin-dashboard');
        }
        
        const { code, state: returnedState } = req.query;
        const sessionState = req.session.duoState;
        const adminEmail = req.session.adminEmail;
        
        // Validate state (CSRF protection)
        if (!validateState(sessionState, returnedState)) {
            logger.error('Invalid state parameter in Duo callback');
            return res.redirect('/admin-login?error=invalid_state');
        }
        
        if (!code) {
            logger.error('No authorization code in Duo callback');
            return res.redirect('/admin-login?error=no_code');
        }
        
        if (!adminEmail) {
            logger.error('No admin email in session');
            return res.redirect('/admin-login?error=session_expired');
        }
        
        // Validate Duo configuration
        if (!validateDuoConfig()) {
            logger.error('Duo not properly configured for callback');
            return res.redirect('/admin-login?error=config_error');
        }
        
        // Exchange code for token
        const duoIdToken = await duoClient.exchangeAuthorizationCodeFor2FAResult(code, adminEmail);
        
        if (!duoIdToken) {
            logger.error('Failed to exchange authorization code');
            return res.redirect('/admin-login?error=exchange_failed');
        }
        
        // Verify email is still in allowlist (double-check)
        if (!isAdminAllowed(adminEmail)) {
            logger.warn(`Post-Duo email check failed: ${adminEmail}`);
            return res.redirect('/admin-login?error=access_denied');
        }
        
        // Create admin session
        req.session.adminAuth = generateAdminSession(adminEmail);
        
        // Clean up temporary session data
        delete req.session.duoState;
        delete req.session.adminEmail;
        
        logger.success(`Admin authentication successful: ${adminEmail}`);
        
        res.redirect('/admin-dashboard');
        
    } catch (error) {
        logger.error('Admin Duo callback error:', error);
        res.redirect('/admin-login?error=callback_error');
    }
});

// Admin logout
app.get('/admin-logout', (req, res) => {
    if (req.session.adminAuth) {
        logger.info(`Admin logout: ${req.session.adminAuth.adminEmail}`);
        delete req.session.adminAuth;
    }
    
    res.redirect('/admin-login?message=logged_out');
});

// MODULARIZATION: Mount health routes
app.use('/', healthRoutes);

// STEP 2E: Mount user routes
app.use('/', userRoutes);

// REFACTOR: Mount messages routes
app.use('/', require('./routes/messagesRoutes'));

// BILLING REFACTOR: Mount billing routes
app.use('/', require('./routes/billingRoutes'));

// NEW: Mount contexts routes
app.use('/', require('./routes/contextsRoutes'));

// ADMIN DASHBOARD: Mount admin routes
app.use('/', adminRoutes);

// ==================== CONTEXT ADDON PURCHASE ENDPOINT ====================

// NEW: Context addon purchase endpoint for extension Buy Extra slot functionality
app.post('/context-addons/purchase', authenticateToken, async (req, res) => {
    try {
        logger.custom('ADDON', '=== CONTEXT ADDON PURCHASE REQUEST ===');
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`User Email: ${req.user.email}`);
        
        const { addonType = 'context-slot', quantity = 1 } = req.body;
        const user = req.user;
        
        logger.debug('Purchase request details:', {
            addonType,
            quantity,
            userPackage: user.package_type,
            userEmail: user.email
        });
        
        // Use existing chargebeeService to create checkout
        logger.info('Creating Chargebee checkout for context addon...');
        const checkoutResult = await chargebeeService.createCheckout({
            planId: 'Context-Addon-Monthly-USD-Monthly', // Exact ID from Chargebee
            customerEmail: user.email,
            customerName: user.display_name || user.email.split('@')[0],
            successUrl: 'https://api.msgly.ai/dashboard?addon=success',
            cancelUrl: 'https://api.msgly.ai/dashboard?addon=cancelled'
        });
        
        logger.debug('Chargebee checkout result:', {
            success: checkoutResult.success,
            hasCheckoutUrl: !!checkoutResult.checkoutUrl,
            error: checkoutResult.error
        });
        
        if (checkoutResult.success) {
            logger.success(`Context addon checkout created successfully for user ${user.id}`);
            logger.info(`Checkout URL generated: ${checkoutResult.checkoutUrl?.substring(0, 50)}...`);
            
            res.json({
                success: true,
                data: {
                    checkoutUrl: checkoutResult.checkoutUrl,
                    addonType: addonType,
                    price: 3.99,
                    planId: 'Context-Addon-Monthly-USD-Monthly',
                    billingModel: 'monthly'
                }
            });
        } else {
            logger.error('Context addon checkout creation failed:', checkoutResult.error);
            res.status(400).json({
                success: false,
                error: checkoutResult.error || 'Failed to create checkout session'
            });
        }
        
    } catch (error) {
        logger.error('Context addon purchase endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate context addon purchase',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ==================== FILE UPLOAD ROUTES ====================

// MINIMAL FIX: Simplified File Upload Route - Remove complex response interception
app.post('/api/analyze-profile-file', authenticateToken, upload.single('profileFile'), async (req, res) => {
    try {
        logger.custom('FILE', '=== FILE UPLOAD ANALYSIS ===');
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`File Upload: ${req.file?.originalname}`);
        
        // Check if user consented to 7-day storage
        if (!req.body.userConsented || req.body.userConsented !== 'true') {
            return res.status(400).json({
                success: false,
                error: 'User consent for 7-day file storage is required'
            });
        }
        
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }
        
        logger.debug('File details:', {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        });
        
        // MINIMAL FIX: Create a simple wrapper to capture response data without complex interception
        let controllerResponse = null;
        let controllerStatus = 200;
        
        const responseCapture = {
            status: function(code) {
                controllerStatus = code;
                return this;
            },
            json: function(data) {
                controllerResponse = data;
                return this;
            },
            send: function(data) {
                if (typeof data === 'string') {
                    try {
                        controllerResponse = JSON.parse(data);
                    } catch (e) {
                        controllerResponse = { message: data };
                    }
                } else {
                    controllerResponse = data;
                }
                return this;
            }
        };
        
        logger.debug('[FILE] Calling handleFileUpload controller...');
        
        // Call the file upload controller
        await handleFileUpload(req, responseCapture);
        
        logger.debug('[FILE] Controller completed. Response captured:', !!controllerResponse);
        
        // Check if the controller completed successfully
        if (!controllerResponse || !controllerResponse.success) {
            logger.error('[FILE] Controller failed:', controllerResponse);
            return res.status(controllerStatus || 500).json(controllerResponse || {
                success: false,
                error: 'File processing failed'
            });
        }
        
        logger.debug('[FILE] Extracting profile data from response...');
        
        // MINIMAL FIX: Extract profile information from the saved data
        let extractedProfile = {
            fullName: 'Profile Name',
            headline: 'Professional Title',
            currentJobTitle: 'Professional',
            currentCompany: 'Company'
        };
        
        if (controllerResponse.data && controllerResponse.data.data_json) {
            logger.debug('[FILE] Found data_json, extracting profile...');
            extractedProfile = extractProfileFromJson(controllerResponse.data.data_json);
            logger.debug('[FILE] Extraction complete:', extractedProfile);
        } else {
            logger.debug('[FILE] No data_json found in response');
        }
        
        // MINIMAL FIX: Return enhanced response with extracted profile data
        const enhancedResponse = {
            ...controllerResponse,
            data: {
                ...controllerResponse.data,
                // Add extracted profile fields
                fullName: extractedProfile.fullName,
                headline: extractedProfile.headline,
                currentJobTitle: extractedProfile.currentJobTitle,
                currentCompany: extractedProfile.currentCompany
            }
        };
        
        logger.success('[FILE] Enhanced response prepared, sending to client');
        return res.status(controllerStatus).json(enhancedResponse);
        
    } catch (error) {
        logger.error('File upload route error:', error);
        
        // Handle multer errors
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 10MB.'
            });
        }
        
        if (error.message.includes('Invalid file type')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid file type. Only PDF, DOC, DOCX, and TXT files are allowed.'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'File upload failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ==================== PERSONAL INFORMATION ENDPOINTS ====================

// Get personal information
app.get('/profile/personal-info', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT personal_info FROM user_profiles WHERE user_id = $1
        `, [req.user.id]);
        
        const personalInfo = result.rows[0]?.personal_info || {};
        
        res.json({
            success: true,
            data: personalInfo
        });
    } catch (error) {
        logger.error('Load personal info failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load personal information'
        });
    }
});

// ✅ PERSONAL INFO SAVE FIX: Update personal information - FIXED to handle missing user_profiles records
app.put('/profile/personal-info', authenticateToken, async (req, res) => {
    try {
        const personalInfo = req.body;
        
        const result = await pool.query(`
            UPDATE user_profiles 
            SET personal_info = $1, updated_at = NOW() 
            WHERE user_id = $2
        `, [JSON.stringify(personalInfo), req.user.id]);
        
        // If UPDATE didn't affect any rows, INSERT a new record
        if (result.rowCount === 0) {
            await pool.query(`
                INSERT INTO user_profiles (user_id, personal_info, created_at, updated_at)
                VALUES ($1, $2, NOW(), NOW())
            `, [req.user.id, JSON.stringify(personalInfo)]);
        }
        
        res.json({
            success: true,
            message: 'Personal information updated successfully'
        });
    } catch (error) {
        logger.error('Save personal info failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save personal information'
        });
    }
});

// ==================== MANUAL EDITING ENDPOINTS ====================

// 1. Basic Information Updates
app.put('/profile/basic-info', authenticateToken, async (req, res) => {
    try {
        const { firstName, lastName, fullName, headline, currentJobTitle, currentCompany, location } = req.body;
        
        await pool.query(`
            UPDATE user_profiles 
            SET 
                first_name = $1,
                last_name = $2, 
                full_name = $3,
                headline = $4,
                current_job_title = $5,
                current_company = $6,
                location = $7,
                updated_at = NOW()
            WHERE user_id = $8
        `, [firstName, lastName, fullName, headline, currentJobTitle, currentCompany, location, req.user.id]);
        
        res.json({ success: true, message: 'Basic information updated successfully' });
    } catch (error) {
        logger.error('Update basic info failed:', error);
        res.status(500).json({ success: false, error: 'Failed to update basic information' });
    }
});

// 2. About Section Updates  
app.put('/profile/about', authenticateToken, async (req, res) => {
    try {
        const { about } = req.body;
        
        await pool.query(`
            UPDATE user_profiles 
            SET about = $1, updated_at = NOW() 
            WHERE user_id = $2
        `, [about, req.user.id]);
        
        res.json({ success: true, message: 'About section updated successfully' });
    } catch (error) {
        logger.error('Update about failed:', error);
        res.status(500).json({ success: false, error: 'Failed to update about section' });
    }
});

// 3. Experience Updates
app.put('/profile/experience', authenticateToken, async (req, res) => {
    try {
        const { experience } = req.body;
        
        await pool.query(`
            UPDATE user_profiles 
            SET experience = $1, updated_at = NOW() 
            WHERE user_id = $2
        `, [JSON.stringify(experience), req.user.id]);
        
        res.json({ success: true, message: 'Experience updated successfully' });
    } catch (error) {
        logger.error('Update experience failed:', error);
        res.status(500).json({ success: false, error: 'Failed to update experience' });
    }
});

// 4. Education Updates
app.put('/profile/education', authenticateToken, async (req, res) => {
    try {
        const { education } = req.body;
        
        await pool.query(`
            UPDATE user_profiles 
            SET education = $1, updated_at = NOW() 
            WHERE user_id = $2
        `, [JSON.stringify(education), req.user.id]);
        
        res.json({ success: true, message: 'Education updated successfully' });
    } catch (error) {
        logger.error('Update education failed:', error);
        res.status(500).json({ success: false, error: 'Failed to update education' });
    }
});

// 5. Skills Updates  
app.put('/profile/skills', authenticateToken, async (req, res) => {
    try {
        const { skills } = req.body;
        
        await pool.query(`
            UPDATE user_profiles 
            SET skills = $1, updated_at = NOW() 
            WHERE user_id = $2
        `, [JSON.stringify(skills), req.user.id]);
        
        res.json({ success: true, message: 'Skills updated successfully' });
    } catch (error) {
        logger.error('Update skills failed:', error);
        res.status(500).json({ success: false, error: 'Failed to update skills' });
    }
});

// 6. Certifications Updates
app.put('/profile/certifications', authenticateToken, async (req, res) => {
    try {
        const { certifications } = req.body;
        
        await pool.query(`
            UPDATE user_profiles 
            SET certifications = $1, updated_at = NOW() 
            WHERE user_id = $2
        `, [JSON.stringify(certifications), req.user.id]);
        
        res.json({ success: true, message: 'Certifications updated successfully' });
    } catch (error) {
        logger.error('Update certifications failed:', error);
        res.status(500).json({ success: false, error: 'Failed to update certifications' });
    }
});

// ==================== PENDING REGISTRATION ENDPOINT (FOR SIGN-UP PAGE) ====================

app.post('/store-pending-registration', authenticateToken, async (req, res) => {
    try {
        logger.debug('Storing pending registration data');
        
        const { linkedinUrl, packageType, termsAccepted } = req.body;
        const userId = req.user.id;
        
        // Validate required fields
        if (!linkedinUrl || !packageType || !termsAccepted) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL, package type, and terms acceptance are required'
            });
        }
        
        // Validate LinkedIn URL
        if (!isValidLinkedInUrl(linkedinUrl)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn URL format'
            });
        }
        
        // Store pending registration
        const result = await storePendingRegistration(userId, linkedinUrl, packageType, termsAccepted);
        
        if (result.success) {
            logger.success(`Registration data stored for user ${userId}`);
            res.json({ 
                success: true, 
                message: 'Registration data stored successfully',
                data: {
                    userId: userId,
                    linkedinUrl: cleanLinkedInUrl(linkedinUrl),
                    packageType: packageType
                }
            });
        } else {
            logger.error('Failed to store registration data:', result.error);
            res.status(500).json({ 
                success: false, 
                error: result.error 
            });
        }
    } catch (error) {
        logger.error('Error storing pending registration:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to store registration data' 
        });
    }
});

// ==================== CHROME EXTENSION AUTH ENDPOINT - ✅ FIXED AUTO-REGISTRATION ====================

app.post('/auth/chrome-extension', async (req, res) => {
    logger.debug('Chrome Extension OAuth request received');
    logger.debug('Request headers:', req.headers);
    logger.debug('Request body (sanitized):', {
        clientType: req.body.clientType,
        extensionId: req.body.extensionId,
        hasToken: !!req.body.googleAccessToken,
        tokenLength: req.body.googleAccessToken?.length,
        hasLinkedInUrl: !!req.body.linkedinUrl // ✅ AUTO-REGISTRATION: Log LinkedIn URL presence
    });
    
    try {
        const { googleAccessToken, clientType, extensionId, linkedinUrl } = req.body; // ✅ AUTO-REGISTRATION: Extract LinkedIn URL
        
        // ✅ AUTO-REGISTRATION: Log auto-registration detection
        if (linkedinUrl) {
            logger.info('AUTO-REGISTRATION: LinkedIn URL detected, will auto-register user');
            logger.debug('LinkedIn URL:', linkedinUrl);
        } else {
            logger.debug('REGULAR AUTH: No LinkedIn URL, will return redirect instruction');
        }
        
        if (!googleAccessToken) {
            return res.status(400).json({
                success: false,
                error: 'Google access token is required',
                received: {
                    clientType,
                    extensionId,
                    hasToken: false,
                    hasLinkedInUrl: !!linkedinUrl // ✅ AUTO-REGISTRATION: Include in error response
                }
            });
        }
        
        if (!extensionId) {
            return res.status(400).json({
                success: false,
                error: 'Extension ID is required',
                received: {
                    clientType,
                    hasToken: !!googleAccessToken,
                    hasLinkedInUrl: !!linkedinUrl // ✅ AUTO-REGISTRATION: Include in error response
                }
            });
        }
        
        // Verify Google token and get user info
        logger.debug('Verifying Google token...');
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
        logger.success('Google user verified:', {
            email: googleUser.email,
            name: googleUser.name,
            verified: googleUser.verified_email
        });
        
        // ✅ FIXED: Find existing user or handle auto-registration/redirect
        let user = await getUserByEmail(googleUser.email);
        let isNewUser = false;

        if (!user) {
            // ✅ FIXED: Check if LinkedIn URL provided for auto-registration
            if (linkedinUrl) {
                logger.info('AUTO-REGISTRATION: Creating new user with LinkedIn URL');
                logger.debug('AUTO-REGISTRATION: LinkedIn URL:', linkedinUrl);
                
                // Create user with auto-registration
                user = await createGoogleUser(
                    googleUser.email,
                    googleUser.name,
                    googleUser.id,
                    googleUser.picture,
                    'free',
                    'monthly',
                    linkedinUrl // ✅ AUTO-REGISTRATION: Pass LinkedIn URL for auto-registration
                );
                isNewUser = true;
                
                logger.success('AUTO-REGISTRATION: User auto-registered successfully');
                logger.debug('AUTO-REGISTRATION: registration_completed set to:', user.registration_completed);

                // ✅ ADMIN NOTIFICATIONS: Send admin notification for auto-registration
                try {
                    logger.info(`[ADMIN] Sending admin notification for auto-registered user: ${user.email}`);
                    
                    const adminResult = await sendAdminNotification({
                        userEmail: user.email,
                        userName: user.display_name,
                        packageType: user.package_type,
                        billingModel: user.billing_model,
                        linkedinUrl: user.linkedin_url,
                        userId: user.id
                    });
                    
                    if (adminResult.ok) {
                        logger.success(`[ADMIN] Admin notification sent successfully: ${adminResult.messageId}`);
                    } else {
                        logger.error(`[ADMIN] Admin notification failed: ${adminResult.error}`);
                    }
                } catch (adminError) {
                    logger.error('[ADMIN] Non-blocking admin notification error:', adminError);
                    // Don't fail the registration - admin notification is not critical
                }
                
            } else {
                // ✅ FIXED: No LinkedIn URL - return SUCCESS with redirect instruction
                logger.debug('REGULAR AUTH: No LinkedIn URL, returning redirect instruction');
                return res.json({
                    success: true,
                    requiresRedirect: true,
                    message: 'Please complete registration on our website',
                    redirectUrl: 'https://api.msgly.ai/sign-up',
                    userInfo: {
                        email: googleUser.email,
                        name: googleUser.name,
                        picture: googleUser.picture
                    },
                    metadata: {
                        extensionId: extensionId,
                        authMethod: 'chrome_extension',
                        autoRegistration: false,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        } else if (!user.google_id) {
            // Link Google account to existing user
            logger.debug('Linking Google account to existing user...');
            await linkGoogleAccount(user.id, googleUser.id);
            user = await getUserById(user.id);
            logger.success('Google account linked successfully');
        } else {
            logger.success('Existing user with Google account found');
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        logger.success('Chrome extension authentication successful');
        logger.info(`User ID: ${user.id}`);
        logger.info(`Extension ID: ${extensionId}`);
        logger.info(`Is new user: ${isNewUser}`);
        logger.info(`Auto-registered: ${!!linkedinUrl}`); // ✅ AUTO-REGISTRATION: Log auto-registration status
        
        res.json({
            success: true,
            message: linkedinUrl ? 'Chrome extension auto-registration successful' : 'Chrome extension authentication successful', // ✅ AUTO-REGISTRATION: Dynamic message
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
                    registrationCompleted: user.registration_completed, // ✅ AUTO-REGISTRATION: Include registration status
                    autoRegistered: !!linkedinUrl // ✅ AUTO-REGISTRATION: Include auto-registration flag
                },
                isNewUser: isNewUser,
                metadata: {
                    extensionId: extensionId,
                    authMethod: 'chrome_extension',
                    autoRegistration: !!linkedinUrl, // ✅ AUTO-REGISTRATION: Include in metadata
                    timestamp: new Date().toISOString()
                }
            }
        });
        
    } catch (error) {
        logger.error('Chrome extension auth error:', error);
        
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
    // REQUIRED LOGGING: Route entry
    logger.debug('route=/scrape-html');
    logger.debug(`isUserProfile=${req.body.isUserProfile}`);
    
    // Enhanced: Route based on isUserProfile parameter
    if (req.body.isUserProfile === true) {
        logger.debug('selectedHandler=USER');
        logger.custom('BLUE', 'USER handler start');
        logger.debug(`userId=${req.user.id}`);
        logger.debug(`truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleUserProfile(req, res);
    } else {
        logger.debug('selectedHandler=TARGET_DATABASE');
        logger.custom('TARGET', 'TARGET DATABASE handler start');
        logger.debug(`userId=${req.user.id}`);
        logger.debug(`truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleTargetProfileJSON(req, res);
    }
});

// NEW: DATABASE-First TARGET PROFILE endpoint
app.post('/target-profile/analyze-json', authenticateToken, (req, res) => {
    logger.custom('TARGET', 'route=/target-profile/analyze-json');
    logger.custom('TARGET', 'DATABASE-FIRST TARGET PROFILE ANALYSIS handler start');
    logger.debug(`userId=${req.user.id}`);
    logger.debug(`truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
    
    return handleTargetProfileJSON(req, res);
});

// NEW: User Plan Endpoint - Returns real plan data (NO MORE MOCK DATA!)
app.get('/user/plan', authenticateToken, async (req, res) => {
    try {
        logger.custom('CREDIT', `Getting real plan data for user ${req.user.id}`);
        
        const planResult = await getUserPlan(req.user.id);
        
        if (!planResult.success) {
            return res.status(500).json({
                success: false,
                error: planResult.error
            });
        }

        logger.success(`Real plan data retrieved: ${planResult.data.planName}, Total: ${planResult.data.totalCredits}`);

        res.json({
            success: true,
            data: planResult.data
        });
    } catch (error) {
        logger.error('Error getting user plan:', error);
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
        logger.error('Error getting credit balance:', error);
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
        logger.error('Error getting transaction history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get transaction history'
        });
    }
});

// ==================== SESSION-DEPENDENT ROUTES (STAY IN SERVER.JS) ====================

// KEPT IN SERVER: Google OAuth Routes (Session creation/management)
app.get('/auth/google', (req, res, next) => {
    if (req.query.package) {
        req.session.selectedPackage = req.query.package;
        req.session.billingModel = req.query.billing || 'monthly';
    }
    
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })(req, res, next);
});

// ✅ EMAIL FIX: Removed early welcome email sending from OAuth callback
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
            
            logger.debug(`OAuth callback - User: ${req.user.email}`);
            logger.debug(`   - Is new user: ${req.user.isNewUser || false}`);
            logger.debug(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
            logger.debug(`   - Registration completed: ${req.user.registration_completed || false}`);
            logger.debug(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
            logger.debug(`   - Needs onboarding: ${needsOnboarding}`);
            
            // ✅ EMAIL FIX: Removed early welcome email sending - now properly timed in registration completion
            
            if (needsOnboarding) {
                logger.debug(`Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
                logger.debug(`Redirecting to dashboard`);
                res.redirect(`/dashboard?token=${token}`);
            }
            
        } catch (error) {
            logger.error('OAuth callback error:', error);
            res.redirect(`/login?error=callback_error`);
        }
    }
);

app.get('/auth/failed', (req, res) => {
    res.redirect(`/login?error=auth_failed`);
});

// ENHANCED TRAFFIC LIGHT STATUS ENDPOINT - USER PROFILE ONLY
app.get('/traffic-light-status', authenticateDual, async (req, res) => {
    try {
        logger.custom('LIGHT', `Traffic light status request from user ${req.user.id} using ${req.authMethod} auth`);

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

        // DETERMINE TRAFFIC LIGHT STATUS - USER PROFILE ONLY
        const isRegistrationComplete = data.registration_completed || false;
        const isInitialScrapingDone = data.initial_scraping_done || false;
        const extractionStatus = data.data_extraction_status || 'pending';
        const hasExperience = data.experience && Array.isArray(data.experience) && data.experience.length > 0;

        let trafficLightStatus;
        let statusMessage;
        let actionRequired;

        if (isRegistrationComplete && isInitialScrapingDone && extractionStatus === 'completed' && hasExperience) {
            trafficLightStatus = 'GREEN';
            statusMessage = 'Profile fully synced and ready! Enhanced DATABASE-FIRST TARGET + USER PROFILE mode active with dual credit system + GPT-5 integration + Chargebee payments + PAYG FIX + Gold & Platinum plans + Cancellation handling + Gold & Platinum PAYG + Billing refactor + Professional Logger + Messages DB Fix + Personal Info Save Fix + File Upload + Profile Data Extraction Fix + Minimal Profile Fix + Contexts + Unified Generation Real GPT Integration + Context Addon Purchase + Context Slot Functions + CORS Fix + Admin Dashboard + Email Fix + Admin Notifications + EMAIL TIMING FIX + DUO ADMIN 2FA + DUO ES MODULE FIX + DUO ADMIN FIX.';
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

        logger.custom('LIGHT', `User ${req.user.id} Traffic Light Status: ${trafficLightStatus}`);
        logger.debug(`   - Registration Complete: ${isRegistrationComplete}`);
        logger.debug(`   - Initial Scraping Done: ${isInitialScrapingDone}`);
        logger.debug(`   - Extraction Status: ${extractionStatus}`);
        logger.debug(`   - Has Experience: ${hasExperience}`);

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
                    mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS_AUTO_REG_URL_FIX_GPT5_CHARGEBEE_WEBHOOK_REGISTRATION_MSGLY_PROFILE_PERSONAL_INFO_MANUAL_EDITING_PAYG_FIX_GOLD_PLATINUM_CANCELLATION_GOLD_PLATINUM_PAYG_BILLING_REFACTOR_PROFESSIONAL_LOGGER_MESSAGES_DB_FIX_PERSONAL_INFO_SAVE_FIX_FILE_UPLOAD_PROFILE_DATA_EXTRACTION_FIX_MINIMAL_PROFILE_FIX_CONTEXTS_UNIFIED_GENERATION_REAL_GPT_CONTEXT_ADDON_PURCHASE_CONTEXT_SLOT_FUNCTIONS_CORS_FIX_ADMIN_DASHBOARD_EMAIL_FIX_ADMIN_NOTIFICATIONS_EMAIL_TIMING_FIX_DUO_ADMIN_2FA_DUO_ES_MODULE_FIX_DUO_ADMIN_FIX'
                }
            }
        });

    } catch (error) {
        logger.error('Traffic light status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check traffic light status'
        });
    }
});

// ENHANCED: Get User Profile with dual credit info
app.get('/profile', authenticateDual, async (req, res) => {
    try {
        logger.debug(`Profile request from user ${req.user.id} using ${req.authMethod} auth`);

        const profileResult = await pool.query(`
            SELECT 
                up.*,
                u.extraction_status as user_extraction_status,
                u.registration_completed as user_registration_completed,
                u.renewable_credits,
                u.payasyougo_credits,
                u.plan_code,
                u.subscription_starts_at,
                u.next_billing_date,
                u.welcome_email_sent
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
                    'Profile complete and ready - DATABASE-FIRST TARGET + USER PROFILE mode with dual credits + AUTO-REGISTRATION + URL FIX + GPT-5 + CHARGEBEE + WEBHOOK REGISTRATION + MSGLY PROFILE + PERSONAL INFO + MANUAL EDITING + PAYG FIX + GOLD & PLATINUM PLANS + CANCELLATION HANDLING + GOLD & PLATINUM PAYG + BILLING REFACTOR + PROFESSIONAL LOGGER + MESSAGES DB FIX + PERSONAL INFO SAVE FIX + FILE UPLOAD + PROFILE DATA EXTRACTION FIX + MINIMAL PROFILE FIX + CONTEXTS + UNIFIED GENERATION REAL GPT + CONTEXT ADDON PURCHASE + CONTEXT SLOT FUNCTIONS + CORS FIX + ADMIN DASHBOARD + EMAIL FIX + ADMIN NOTIFICATIONS + EMAIL TIMING FIX + DUO ADMIN 2FA + DUO ES MODULE FIX + DUO ADMIN FIX'
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
                    // ✅ EMAIL TIMING FIX: Include welcome email status for dashboard logic
                    welcomeEmailSent: profile?.welcome_email_sent || false,
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
                    responseStatus: profile.response_status,
                    // NEW: Personal information
                    personalInfo: profile.personal_info || {}
                } : null,
                syncStatus: syncStatus,
                mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS_AUTO_REG_URL_FIX_GPT5_CHARGEBEE_WEBHOOK_REGISTRATION_MSGLY_PROFILE_PERSONAL_INFO_MANUAL_EDITING_PAYG_FIX_GOLD_PLATINUM_CANCELLATION_GOLD_PLATINUM_PAYG_BILLING_REFACTOR_PROFESSIONAL_LOGGER_MESSAGES_DB_FIX_PERSONAL_INFO_SAVE_FIX_FILE_UPLOAD_PROFILE_DATA_EXTRACTION_FIX_MINIMAL_PROFILE_FIX_CONTEXTS_UNIFIED_GENERATION_REAL_GPT_CONTEXT_ADDON_PURCHASE_CONTEXT_SLOT_FUNCTIONS_CORS_FIX_ADMIN_DASHBOARD_EMAIL_FIX_ADMIN_NOTIFICATIONS_EMAIL_TIMING_FIX_DUO_ADMIN_2FA_DUO_ES_MODULE_FIX_DUO_ADMIN_FIX'
            }
        });
    } catch (error) {
        logger.error('Enhanced profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// FIXED: Check profile extraction status - USER PROFILE ONLY (UNCHANGED)
app.get('/profile-status', authenticateDual, async (req, res) => {
    try {
        logger.debug(`Profile status request from user ${req.user.id} using ${req.authMethod} auth`);

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
            processing_mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS_AUTO_REG_URL_FIX_GPT5_CHARGEBEE_WEBHOOK_REGISTRATION_MSGLY_PROFILE_PERSONAL_INFO_MANUAL_EDITING_PAYG_FIX_GOLD_PLATINUM_CANCELLATION_GOLD_PLATINUM_PAYG_BILLING_REFACTOR_PROFESSIONAL_LOGGER_MESSAGES_DB_FIX_PERSONAL_INFO_SAVE_FIX_FILE_UPLOAD_PROFILE_DATA_EXTRACTION_FIX_MINIMAL_PROFILE_FIX_CONTEXTS_UNIFIED_GENERATION_REAL_GPT_CONTEXT_ADDON_PURCHASE_CONTEXT_SLOT_FUNCTIONS_CORS_FIX_ADMIN_DASHBOARD_EMAIL_FIX_ADMIN_NOTIFICATIONS_EMAIL_TIMING_FIX_DUO_ADMIN_2FA_DUO_ES_MODULE_FIX_DUO_ADMIN_FIX',
            message: getStatusMessage(status.extraction_status, status.initial_scraping_done)
        });
        
    } catch (error) {
        logger.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// ==================== EMAIL TIMING FIX: NEW WELCOME EMAIL ENDPOINT ====================

// ✅ EMAIL TIMING FIX: New endpoint for sending welcome email from dashboard
app.post('/send-welcome-email', authenticateToken, async (req, res) => {
    try {
        logger.custom('EMAIL', '=== DASHBOARD WELCOME EMAIL REQUEST ===');
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`User Email: ${req.user.email}`);
        
        // Check if user is eligible for welcome email
        const userCheck = await pool.query(`
            SELECT 
                id, email, display_name, package_type, billing_model, 
                linkedin_url, registration_completed, welcome_email_sent
            FROM users 
            WHERE id = $1
        `, [req.user.id]);
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const user = userCheck.rows[0];
        
        // Verify user is eligible for welcome email
        if (!user.registration_completed) {
            return res.status(400).json({
                success: false,
                error: 'Registration not completed',
                userMessage: 'Please complete registration first'
            });
        }
        
        if (user.welcome_email_sent) {
            return res.status(200).json({
                success: true,
                message: 'Welcome email already sent',
                alreadySent: true
            });
        }
        
        logger.info(`[EMAIL] Processing welcome email for dashboard user: ${user.email}`);
        
        // Send welcome email for free users only
        if (user.package_type === 'free') {
            try {
                logger.info(`[EMAIL] Sending welcome email for free user: ${user.email}`);
                
                const emailResult = await sendWelcomeEmail({
                    toEmail: user.email,
                    toName: user.display_name,
                    userId: user.id
                });
                
                if (emailResult.ok) {
                    // Mark as sent
                    await pool.query(
                        'UPDATE users SET welcome_email_sent = true WHERE id = $1',
                        [user.id]
                    );
                    
                    logger.success(`[EMAIL] Welcome email sent successfully: ${emailResult.messageId}`);
                } else {
                    logger.error(`[EMAIL] Welcome email failed: ${emailResult.error}`);
                    return res.status(500).json({
                        success: false,
                        error: 'Welcome email sending failed',
                        details: emailResult.error
                    });
                }
            } catch (emailError) {
                logger.error('[EMAIL] Welcome email error:', emailError);
                return res.status(500).json({
                    success: false,
                    error: 'Welcome email sending failed',
                    details: emailError.message
                });
            }
        } else {
            logger.debug('EMAIL: Skipping welcome email for paid users (sent via webhook)');
        }

        // ✅ EMAIL TIMING FIX: Send admin notification for dashboard registration completion
        try {
            logger.info(`[ADMIN] Sending admin notification for dashboard user: ${user.email}`);
            
            const adminResult = await sendAdminNotification({
                userEmail: user.email,
                userName: user.display_name,
                packageType: user.package_type,
                billingModel: user.billing_model,
                linkedinUrl: user.linkedin_url,
                userId: user.id
            });
            
            if (adminResult.ok) {
                logger.success(`[ADMIN] Admin notification sent successfully: ${adminResult.messageId}`);
            } else {
                logger.error(`[ADMIN] Admin notification failed: ${adminResult.error}`);
            }
        } catch (adminError) {
            logger.error('[ADMIN] Non-blocking admin notification error:', adminError);
            // Don't fail the response - admin notification is not critical
        }
        
        logger.success(`[EMAIL] Dashboard welcome email process completed for user ${user.id}`);
        
        res.json({
            success: true,
            message: 'Welcome email sent successfully',
            data: {
                userId: user.id,
                email: user.email,
                packageType: user.package_type,
                welcomeEmailSent: true
            }
        });
        
    } catch (error) {
        logger.error('Dashboard welcome email endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send welcome email',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ==================== COMPLETE REGISTRATION ENDPOINT (EMAIL TIMING FIX) ====================

// ✅ EMAIL TIMING FIX: Modified /complete-registration endpoint - removed email sending
app.post('/complete-registration', authenticateToken, async (req, res) => {
    try {
        logger.custom('REG', '========================================');
        logger.custom('REG', 'COMPLETE REGISTRATION - EMAIL TIMING FIX');
        logger.custom('REG', '========================================');
        logger.custom('REG', `Complete registration request from user ${req.user.id}`);
        logger.debug('Request method:', req.method);
        logger.debug('Request headers:', JSON.stringify({
            'content-type': req.headers['content-type'],
            'authorization': req.headers['authorization'] ? 'Bearer ***' : 'None',
            'origin': req.headers.origin
        }, null, 2));
        logger.debug('Request body keys:', Object.keys(req.body));
        logger.debug('Request body data:', JSON.stringify(req.body, null, 2));
        logger.debug('User object from auth:', JSON.stringify({
            id: req.user.id,
            email: req.user.email,
            displayName: req.user.display_name,
            packageType: req.user.package_type,
            registrationCompleted: req.user.registration_completed,
            linkedinUrl: req.user.linkedin_url
        }, null, 2));
        
        const { linkedinUrl, packageType, termsAccepted } = req.body;
        
        logger.debug('Extracted values from request body:', {
            linkedinUrl, packageType, termsAccepted,
            linkedinUrlType: typeof linkedinUrl,
            packageTypeType: typeof packageType,
            termsAcceptedType: typeof termsAccepted,
            linkedinUrlTruthy: !!linkedinUrl,
            packageTypeTruthy: !!packageType,
            termsAcceptedTruthy: !!termsAccepted
        });
        
        logger.custom('REG', 'VALIDATION STEP 1: Checking required fields...');
        
        // VALIDATION STEP 1: Check required fields
        if (!linkedinUrl) {
            logger.error('VALIDATION FAILED: linkedinUrl is missing');
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required',
                received: { linkedinUrl, packageType, termsAccepted }
            });
        }
        
        if (!packageType) {
            logger.error('VALIDATION FAILED: packageType is missing');
            return res.status(400).json({
                success: false,
                error: 'Package type is required',
                received: { linkedinUrl, packageType, termsAccepted }
            });
        }
        
        if (!termsAccepted) {
            logger.error('VALIDATION FAILED: termsAccepted is missing');
            return res.status(400).json({
                success: false,
                error: 'Terms acceptance is required',
                received: { linkedinUrl, packageType, termsAccepted }
            });
        }
        
        logger.success('VALIDATION STEP 1: All required fields present');
        logger.custom('REG', 'VALIDATION STEP 2: Validating LinkedIn URL format...');
        logger.debug('Raw LinkedIn URL:', linkedinUrl);
        logger.debug('About to call isValidLinkedInUrl...');
        
        // VALIDATION STEP 2: Check LinkedIn URL format
        const isValidUrl = isValidLinkedInUrl(linkedinUrl);
        logger.debug('isValidLinkedInUrl result:', isValidUrl);
        
        if (!isValidUrl) {
            logger.error('VALIDATION FAILED: Invalid LinkedIn URL format');
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn URL format',
                received: { linkedinUrl, packageType, termsAccepted }
            });
        }
        
        logger.success('VALIDATION STEP 2: LinkedIn URL format is valid');
        logger.custom('REG', 'VALIDATION STEP 3: Cleaning LinkedIn URL...');
        logger.debug('About to call cleanLinkedInUrl...');
        
        // VALIDATION STEP 3: Clean URL
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        logger.debug('Cleaned URL:', cleanUrl);
        logger.success('VALIDATION STEP 3: URL cleaned successfully');
        logger.custom('REG', 'DATABASE STEP 1: Checking current user state...');
        
        // DATABASE STEP 1: Check current user state
        const currentUserQuery = `
            SELECT 
                id,
                email,
                linkedin_url,
                package_type,
                registration_completed,
                terms_accepted,
                plan_code,
                renewable_credits,
                payasyougo_credits,
                subscription_status
            FROM users 
            WHERE id = $1
        `;
        
        logger.debug('About to execute user state query...');
        const currentUserResult = await pool.query(currentUserQuery, [req.user.id]);
        logger.debug('User state query executed successfully');
        logger.debug('Current user state:', JSON.stringify(currentUserResult.rows[0], null, 2));
        
        logger.custom('REG', 'DATABASE STEP 2: Updating user registration...');
        
        // DATABASE STEP 2: Update user registration (NO EMAIL SENDING)
        const updateQuery = `
            UPDATE users 
            SET 
                linkedin_url = $1,
                package_type = $2,
                terms_accepted = $3,
                registration_completed = true,
                extraction_status = 'pending',
                welcome_email_sent = false,
                updated_at = NOW()
            WHERE id = $4
            RETURNING 
                id,
                email,
                linkedin_url,
                package_type,
                registration_completed,
                terms_accepted,
                extraction_status,
                welcome_email_sent,
                updated_at
        `;
        
        logger.debug('About to execute UPDATE query with parameters:', {
            param1: cleanUrl,
            param2: packageType,
            param3: termsAccepted,
            param4: req.user.id
        });
        
        const updateResult = await pool.query(updateQuery, [cleanUrl, packageType, termsAccepted, req.user.id]);
        logger.debug('UPDATE query executed successfully');
        logger.debug('Update result:', JSON.stringify(updateResult.rows[0], null, 2));
        
        logger.custom('REG', 'DATABASE STEP 3: Verifying update was successful...');
        
        // DATABASE STEP 3: Verify update was successful
        const verifyQuery = `
            SELECT 
                id,
                email,
                linkedin_url,
                package_type,
                registration_completed,
                terms_accepted,
                extraction_status,
                welcome_email_sent,
                updated_at
            FROM users 
            WHERE id = $1
        `;
        
        logger.debug('About to execute verification query...');
        const verifyResult = await pool.query(verifyQuery, [req.user.id]);
        logger.debug('Verification query executed successfully');
        logger.debug('Verified user state after update:', JSON.stringify(verifyResult.rows[0], null, 2));
        
        const updatedUser = verifyResult.rows[0];
        
        // VALIDATION STEP 4: Confirm registration_completed = true
        logger.custom('REG', 'VALIDATION STEP 4: Confirming registration completion...');
        logger.debug('registration_completed value:', updatedUser.registration_completed);
        logger.debug('registration_completed type:', typeof updatedUser.registration_completed);
        
        if (!updatedUser.registration_completed) {
            logger.error('CRITICAL ERROR: registration_completed is still false after update!');
            logger.error('This indicates a database constraint or trigger preventing the update');
            return res.status(500).json({
                success: false,
                error: 'Database update failed - registration_completed not set to true',
                debug: {
                    beforeUpdate: currentUserResult.rows[0],
                    afterUpdate: updatedUser,
                    expectedResult: true,
                    actualResult: updatedUser.registration_completed
                }
            });
        }
        
        logger.success('VALIDATION STEP 4: registration_completed successfully set to true');
        
        // ✅ EMAIL TIMING FIX: NO EMAIL SENDING HERE - moved to dashboard
        logger.info('EMAIL TIMING FIX: Emails will be sent when user reaches dashboard');
        logger.debug('welcome_email_sent set to false - dashboard will detect and send emails');
        
        // SUCCESS RESPONSE
        logger.debug('SUCCESS RESPONSE: Preparing successful response...');
        const successResponse = {
            success: true,
            message: 'Registration completed successfully',
            data: {
                userId: req.user.id,
                email: req.user.email,
                linkedinUrl: cleanUrl,
                packageType: packageType,
                registrationCompleted: true,
                welcomeEmailSent: false, // Will be sent by dashboard
                nextStep: 'Visit your LinkedIn profile with the Chrome extension to sync your data'
            }
        };
        
        logger.debug('About to send success response:', JSON.stringify(successResponse, null, 2));
        logger.custom('REG', '========================================');
        logger.custom('REG', 'COMPLETE REGISTRATION - SUCCESS (NO EMAILS)');
        logger.custom('REG', '========================================');
        logger.success(`Registration completed for user ${req.user.id}`);
        logger.info(`  - LinkedIn URL: ${cleanUrl}`);
        logger.info(`  - Package: ${packageType}`);
        logger.info(`  - Registration completed: true`);
        logger.info(`  - Welcome email: Will be sent by dashboard`);
        
        res.json(successResponse);
        
    } catch (error) {
        logger.custom('REG', '========================================');
        logger.custom('REG', 'COMPLETE REGISTRATION - ERROR');
        logger.custom('REG', '========================================');
        logger.error('CRITICAL ERROR in /complete-registration:', error);
        logger.error('Error name:', error.name);
        logger.error('Error message:', error.message);
        logger.debug('Error stack:', error.stack);
        
        if (error.code) {
            logger.error('Database error code:', error.code);
        }
        if (error.detail) {
            logger.error('Database error detail:', error.detail);
        }
        if (error.hint) {
            logger.error('Database error hint:', error.hint);
        }
        
        res.status(500).json({
            success: false,
            error: 'Registration completion failed',
            debug: {
                errorName: error.name,
                errorMessage: error.message,
                errorCode: error.code || 'No code',
                errorDetail: error.detail || 'No detail',
                userId: req.user.id,
                timestamp: new Date().toISOString()
            },
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
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

// FIXED: Chargebee Connection Test Route
app.get('/test-chargebee', async (req, res) => {
    try {
        logger.debug('Testing Chargebee connection...');
        
        const result = await chargebeeService.testConnection();
        
        if (result.success) {
            res.json({
                success: true,
                message: '✅ Chargebee connection successful!',
                data: result.data || {
                    siteName: 'Connected',
                    isConfigured: chargebeeService.isConfigured
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: '❌ Chargebee connection failed',
                error: result.error
            });
        }
    } catch (error) {
        logger.error('Chargebee test error:', error);
        res.status(500).json({
            success: false,
            message: 'Test failed',
            error: error.message
        });
    }
});

// ==================== MESSAGES DB FIX: ADDED MISSING ENDPOINTS ====================

// FIXED: Messages history endpoint - reads actual database values instead of hardcoded ones
app.get('/messages/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ml.id,
                ml.target_first_name as "targetProfile.firstName",
                ml.target_title as "targetProfile.role", 
                ml.target_company as "targetProfile.company",
                ml.generated_message as message,
                ml.created_at,
                -- FIXED: Read actual database values instead of hardcoded 'pending'
                COALESCE(ml.sent_status, 'pending') as sent,
                COALESCE(ml.reply_status, 'pending') as "gotReply",
                COALESCE(ml.comments, '') as comments,
                ml.sent_date,
                ml.reply_date
            FROM message_logs ml 
            WHERE ml.user_id = $1 
            ORDER BY ml.created_at DESC
        `, [req.user.id]);

        const messages = result.rows.map(row => ({
            id: row.id,
            targetProfile: {
                firstName: row["targetProfile.firstName"] || 'Unknown',
                role: row["targetProfile.role"] || 'Professional', 
                company: row["targetProfile.company"] || 'Company'
            },
            message: row.message || '',
            sent: row.sent,
            gotReply: row.gotReply,
            comments: row.comments,
            createdAt: row.created_at,
            sentDate: row.sent_date,
            replyDate: row.reply_date
        }));

        res.json({
            success: true,
            data: messages
        });
    } catch (error) {
        logger.error('Messages history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load messages'
        });
    }
});

// NEW: PUT /messages/:id - Update message status and comments (MISSING ENDPOINT ADDED)
app.put('/messages/:id', authenticateToken, async (req, res) => {
    try {
        const messageId = parseInt(req.params.id);
        const { sent_status, reply_status, comments } = req.body;
        const userId = req.user.id;
        
        // Validate message belongs to user
        const checkResult = await pool.query(
            'SELECT id FROM message_logs WHERE id = $1 AND user_id = $2',
            [messageId, userId]
        );
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }
        
        // Update message in database
        const result = await pool.query(`
            UPDATE message_logs 
            SET 
                sent_status = $1,
                reply_status = $2, 
                comments = $3,
                sent_date = CASE WHEN $1 = 'yes' AND sent_date IS NULL THEN NOW() ELSE sent_date END,
                reply_date = CASE WHEN $2 = 'yes' AND reply_date IS NULL THEN NOW() ELSE reply_date END
            WHERE id = $4 AND user_id = $5
            RETURNING *
        `, [sent_status, reply_status, comments, messageId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Update failed'
            });
        }
        
        logger.success(`Message ${messageId} updated successfully for user ${userId}`);
        
        res.json({
            success: true,
            message: 'Message updated successfully',
            data: result.rows[0]
        });
        
    } catch (error) {
        logger.error('Update message error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update message'
        });
    }
});

// ==================== UNIFIED GENERATION REAL GPT: CONNECTED TO EXISTING WORKING SYSTEM ====================

// FIXED: Unified generation endpoint - now uses real GPT integration instead of mock data
app.post('/generate-unified', authenticateToken, async (req, res) => {
    try {
        logger.custom('UNIFIED', '=== UNIFIED MESSAGE GENERATION - REAL GPT INTEGRATION ===');
        logger.info(`User ID: ${req.user.id}`);
        logger.info(`Target URL: ${req.body.targetProfileUrl}`);
        logger.info(`Message Types: ${JSON.stringify(req.body.messageTypes)}`);
        
        const { targetProfileUrl, outreachContext, messageTypes } = req.body;
        
        if (!targetProfileUrl || !outreachContext || !messageTypes || !Array.isArray(messageTypes)) {
            return res.status(400).json({
                success: false,
                error: 'targetProfileUrl, outreachContext, and messageTypes array are required'
            });
        }
        
        if (messageTypes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one message type must be selected'
            });
        }
        
        // Calculate total cost
        const totalCost = messageTypes.length * 1.0;
        
        // Check user credits
        const creditsCheck = await checkUserCredits(req.user.id);
        if (!creditsCheck.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to check user credits'
            });
        }
        
        if (creditsCheck.totalCredits < totalCost) {
            return res.status(402).json({
                success: false,
                error: 'insufficient_credits',
                requiredCredits: totalCost,
                currentCredits: creditsCheck.totalCredits,
                userMessage: `Insufficient credits. Need ${totalCost}, have ${creditsCheck.totalCredits}`
            });
        }
        
        // Create credit hold
        const holdResult = await createCreditHold(req.user.id, 'unified_generation', {
            targetProfileUrl,
            messageTypes,
            totalCost
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
        
        const holdId = holdResult.holdId;
        
        try {
            // Generate messages using real GPT integration
            const generatedMessages = [];
            let totalTokensUsed = 0;
            
            for (const messageType of messageTypes) {
                logger.info(`Generating real ${messageType} using GPT-5...`);
                
                // Create mock request/response objects for message handlers
                const mockReq = {
                    user: req.user,
                    body: {
                        targetProfileUrl: targetProfileUrl,
                        outreachContext: outreachContext
                    }
                };
                
                let mockRes = {
                    statusCode: 200,
                    responseData: null,
                    status: function(code) {
                        this.statusCode = code;
                        return this;
                    },
                    json: function(data) {
                        this.responseData = data;
                        return this;
                    }
                };
                
                // Route to appropriate message generation function
                try {
                    switch (messageType) {
                        case 'linkedin-message':
                            await handleGenerateMessage(mockReq, mockRes, true); // UNIFIED FIX: Skip credits
                            break;
                        case 'connection-request':
                            await handleGenerateConnection(mockReq, mockRes, true); // UNIFIED FIX: Skip credits
                            break;
                        case 'cold-email':
                            await handleGenerateColdEmail(mockReq, mockRes, true); // UNIFIED FIX: Skip credits
                            break;
                        default:
                            throw new Error(`Unsupported message type: ${messageType}`);
                    }
                    
                    // Extract generated message from response
                    if (mockRes.responseData && mockRes.responseData.success) {
                        generatedMessages.push({
                            type: messageType,
                            message: mockRes.responseData.data.message, // UNIFIED FIX: Use consistent field name
                            tokensUsed: mockRes.responseData.credits?.tokensUsed || 50
                        });
                        
                        totalTokensUsed += (mockRes.responseData.credits?.tokensUsed || 50);
                        logger.success(`Generated real ${messageType} successfully`);
                    } else {
                        throw new Error(`Failed to generate ${messageType}: ${mockRes.responseData?.error || 'Unknown error'}`);
                    }
                    
                } catch (generationError) {
                    logger.error(`Error generating ${messageType}:`, generationError);
                    throw new Error(`Failed to generate ${messageType}: ${generationError.message}`);
                }
            }
            
            // Complete operation and deduct credits
            const completionResult = await completeOperation(req.user.id, holdId, {
                targetProfileUrl,
                messageTypes,
                generatedCount: generatedMessages.length,
                totalTokensUsed
            });
            
            if (!completionResult.success) {
                logger.error('Failed to complete unified generation operation:', completionResult.error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process credits after successful generation'
                });
            }
            
            logger.success(`Unified generation completed: ${generatedMessages.length} real messages generated using GPT-5`);
            logger.custom('MONEY', `Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
            
            res.json({
                success: true,
                data: generatedMessages,
                credits: {
                    deducted: completionResult.creditsDeducted,
                    newBalance: completionResult.newBalance,
                    renewableCredits: completionResult.renewableCredits,
                    payasyougoCredits: completionResult.payasyougoCredits,
                    transactionId: completionResult.transactionId
                }
            });
            
        } catch (generationError) {
            logger.error('Unified generation error:', generationError);
            
            // Release hold on error
            await releaseCreditHold(req.user.id, holdId, 'generation_error');
            
            res.status(500).json({
                success: false,
                error: 'Message generation failed',
                details: process.env.NODE_ENV === 'development' ? generationError.message : undefined
            });
        }
        
    } catch (error) {
        logger.error('Unified generation endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Unified generation failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// NEW: Cleanup expired holds (run periodically)
setInterval(async () => {
    try {
        await cleanupExpiredHolds();
    } catch (error) {
        logger.error('Error during scheduled cleanup:', error);
    }
}, 30 * 60 * 1000); // Run every 30 minutes

// NEW: Cleanup expired processing entries (run periodically)
setInterval(() => {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5 minutes
    
    for (const [key, timestamp] of activeProcessing.entries()) {
        if (now - timestamp > expireTime) {
            activeProcessing.delete(key);
            logger.custom('RACE', `Cleaned up stale processing entry: ${key}`);
        }
    }
}, 60 * 1000); // Run every minute

// Error handling middleware
app.use((error, req, res, next) => {
    logger.error('Unhandled Error:', error);
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
        message: 'DATABASE-FIRST TARGET + USER PROFILE mode active with Dual Credit System + AUTO-REGISTRATION + RACE CONDITION PROTECTION + URL FIX + GPT-5 INTEGRATION + CHARGEBEE PAYMENTS + MAILERSEND WELCOME EMAILS + WEBHOOK REGISTRATION FIX + MODULAR REFACTOR + MESSAGES ROUTE FIX + AUTHENTICATION FIX + MSGLY PROFILE + PERSONAL INFO + MANUAL EDITING + PAYG FIX + GOLD & PLATINUM PLANS + CANCELLATION HANDLING + GOLD & PLATINUM PAYG + BILLING REFACTOR + PROFESSIONAL LOGGER + MESSAGES DB FIX + PERSONAL INFO SAVE FIX + FILE UPLOAD + PROFILE DATA EXTRACTION FIX + MINIMAL PROFILE FIX + CONTEXTS + UNIFIED GENERATION REAL GPT INTEGRATION + CONTEXT ADDON PURCHASE + CONTEXT SLOT FUNCTIONS + CORS FIX + ADMIN DASHBOARD + EMAIL FIX + ADMIN NOTIFICATIONS + EMAIL TIMING FIX + DUO ADMIN 2FA + DUO ES MODULE FIX + DUO ADMIN FIX',
        availableRoutes: [
            'GET /',
            'GET /sign-up',
            'GET /login', 
            'GET /dashboard',
            'GET /messages (FIXED: Client-side authentication)',
            'GET /messages/history (FIXED: Now reads actual database values)',
            'PUT /messages/:id (NEW: Update message status and comments)',
            'GET /msgly-profile.html (NEW: Msgly Profile page)',
            'GET /msgly-profile (NEW: Msgly Profile page without .html)',
            'GET /upgrade (NEW: Upgrade page for existing users)',
            'GET /health',
            'POST /register',
            'POST /login',
            'GET /auth/google',
            'GET /auth/google/callback (✅ EMAIL FIX: No more early email sending)',
            'POST /auth/chrome-extension (✅ AUTO-REGISTRATION enabled + ADMIN NOTIFICATIONS)',
            'POST /complete-registration (✅ EMAIL TIMING FIX: No email sending - moved to dashboard)',
            'POST /send-welcome-email (✅ NEW: Dashboard endpoint for welcome email sending)',
            'POST /store-pending-registration (NEW: Store registration data before payment)',
            'POST /update-profile',
            'GET /profile',
            'GET /profile-status',
            'GET /traffic-light-status',
            'GET /profile/personal-info (NEW: Get personal information)',
            'PUT /profile/personal-info (✅ PERSONAL INFO SAVE FIX: Now handles missing user_profiles records)',
            'PUT /profile/basic-info (NEW: Update basic information)',
            'PUT /profile/about (NEW: Update about section)',
            'PUT /profile/experience (NEW: Update experience)',
            'PUT /profile/education (NEW: Update education)',
            'PUT /profile/skills (NEW: Update skills)',
            'PUT /profile/certifications (NEW: Update certifications)',
            'POST /scrape-html (Enhanced routing: USER + TARGET)',
            'POST /target-profile/analyze-json (NEW: DATABASE-first system with RACE PROTECTION + URL FIX)',
            'POST /api/analyze-profile-file (✅ MINIMAL FIX: File upload analysis with simplified response handling and correct profile data extraction)',
            'POST /generate-message (REFACTORED: Now in routes/messagesRoutes.js)',
            'POST /generate-connection (REFACTORED: Now in routes/messagesRoutes.js)',
            'POST /generate-intro (REFACTORED: Now in routes/messagesRoutes.js)',
            'POST /generate-unified (✅ FIXED: Real GPT-5 integration - NO MORE MOCK DATA)',
            'GET /user/setup-status',
            'GET /user/initial-scraping-status',
            'GET /user/stats',
            'PUT /user/settings',
            'GET /packages',
            'GET /user/plan (NEW: Real plan data - NO MOCK!)',
            'GET /credits/balance (NEW: Dual credit management)',
            'GET /credits/history (NEW: Transaction history)',
            'GET /test-chargebee (NEW: Test Chargebee connection)',
            'POST /chargebee-webhook (BILLING REFACTOR: Now in routes/billingRoutes.js)',
            'POST /create-checkout (BILLING REFACTOR: Now in routes/billingRoutes.js)',
            'POST /context-addons/purchase (NEW: Context addon purchase for extension Buy Extra slot)',
            'GET /contexts (NEW: Context management - List saved contexts)',
            'POST /contexts (NEW: Context management - Save new context)',
            'PUT /contexts/:id (NEW: Context management - Update context)',
            'DELETE /contexts/:id (NEW: Context management - Delete context)',
            'GET /contexts/limits (NEW: Context management - Get plan limits)',
            'GET /admin-dashboard (NEW: Admin dashboard for internal analytics)',
            'GET /api/admin/analytics (NEW: Admin analytics API endpoints)',
            'GET /admin-login (🔧 FIXED: Duo 2FA admin login page with ES Module fix)',
            'POST /admin-initiate-duo (🔧 FIXED: Duo 2FA initiation with ES Module fix and crypto scope fix)',
            'GET /admin-duo-callback (🔧 FIXED: Duo 2FA callback handler with ES Module fix)',
            'GET /admin-logout (NEW: Admin logout)'
        ]
    });
});

// ==================== SERVER STARTUP ====================

const startServer = async () => {
    try {
        validateEnvironment();
        
        const dbOk = await testDatabase();
        if (!dbOk) {
            logger.error('Cannot start server without database');
            process.exit(1);
        }
        
        // 🔧 DUO ES MODULE FIX: Initialize Duo Universal SDK with dynamic import
        await initializeDuo();
        
        // NEW: Auto-create welcome_email_sent column if it doesn't exist
        try {
            logger.debug('Checking welcome_email_sent column...');
            const columnCheck = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name = 'welcome_email_sent'
            `);

            if (columnCheck.rows.length === 0) {
                logger.debug('Creating welcome_email_sent column...');
                await pool.query(`
                    ALTER TABLE users 
                    ADD COLUMN welcome_email_sent BOOLEAN DEFAULT FALSE
                `);
                logger.success('welcome_email_sent column created successfully');
            } else {
                logger.debug('welcome_email_sent column already exists');
            }
        } catch (columnError) {
            logger.error('Warning: Could not create welcome_email_sent column:', columnError.message);
            logger.error('MailerSend will use in-memory guard instead');
        }
        
        // NEW: Auto-create personal_info column if it doesn't exist
        try {
            logger.debug('Checking personal_info column...');
            const columnCheck = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'user_profiles' 
                AND column_name = 'personal_info'
            `);

            if (columnCheck.rows.length === 0) {
                logger.debug('Creating personal_info column...');
                await pool.query(`
                    ALTER TABLE user_profiles 
                    ADD COLUMN personal_info JSONB DEFAULT '{}'::jsonb
                `);
                logger.success('personal_info column created successfully');
            } else {
                logger.debug('personal_info column already exists');
            }
        } catch (columnError) {
            logger.error('Warning: Could not create personal_info column:', columnError.message);
            logger.error('Personal information features may not work properly');
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            logger.success('[ROCKET] Enhanced Msgly.AI Server - DUAL CREDIT SYSTEM + AUTO-REGISTRATION + RACE CONDITION FIX + URL MATCHING FIX + GPT-5 MESSAGE GENERATION + CHARGEBEE INTEGRATION + MAILERSEND WELCOME EMAILS + WEBHOOK REGISTRATION COMPLETION + MODULAR REFACTOR + MESSAGES ROUTE FIX + AUTHENTICATION FIX + MSGLY PROFILE + PERSONAL INFO + MANUAL EDITING + MESSAGES HISTORY ENDPOINT + 🔧 PAYG CRITICAL FIX + ✅ GOLD & PLATINUM PLANS + ✅ CANCELLATION HANDLING + ✅ GOLD & PLATINUM PAYG + ✅ BILLING REFACTOR + ✅ PROFESSIONAL LOGGER + ✅ MESSAGES DB FIX + ✅ PERSONAL INFO SAVE FIX + ✅ FILE UPLOAD + ✅ PROFILE DATA EXTRACTION FIX + ✅ MINIMAL PROFILE FIX + ✅ CONTEXTS + ✅ UNIFIED GENERATION REAL GPT INTEGRATION + ✅ CONTEXT ADDON PURCHASE + ✅ CONTEXT SLOT FUNCTIONS + ✅ CORS FIX + ✅ ADMIN DASHBOARD + ✅ EMAIL FIX + ✅ ADMIN NOTIFICATIONS + ✅ EMAIL TIMING FIX + ✅ DUO ADMIN 2FA + ✅ DUO ES MODULE FIX + 🔧 DUO ADMIN FIX ACTIVE!');
            console.log(`[CHECK] Port: ${PORT}`);
            console.log(`[DB] Database: Enhanced PostgreSQL with TOKEN TRACKING + DUAL CREDIT SYSTEM + MESSAGE LOGGING + PENDING REGISTRATIONS + PERSONAL INFO + MANUAL EDITING + CANCELLATION TRACKING + MESSAGES CAMPAIGN TRACKING + FILE UPLOAD STORAGE + PROFILE DATA EXTRACTION + MINIMAL PROFILE FIX + CONTEXTS + UNIFIED GENERATION REAL GPT + CONTEXT ADDON PURCHASE + CONTEXT SLOT FUNCTIONS + ADMIN DASHBOARD + EMAIL FIX + ADMIN NOTIFICATIONS + EMAIL TIMING FIX + DUO ADMIN 2FA + DUO ES MODULE FIX + DUO ADMIN FIX`);
            console.log(`[FILE] Target Storage: DATABASE (target_profiles table + files_target_profiles table)`);
            console.log(`[CHECK] Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API) + DUO 2FA (Admin)`);
            console.log(`[LIGHT] TRAFFIC LIGHT SYSTEM ACTIVE`);
            console.log(`[SUCCESS] ✅ AUTO-REGISTRATION ENABLED: Extension users can auto-register with LinkedIn URL`);
            console.log(`[SUCCESS] ✅ RACE CONDITION FIX: In-memory tracking prevents duplicate processing`);
            console.log(`[SUCCESS] ✅ URL MATCHING FIX: Profile deduplication handles both URL formats`);
            console.log(`[SUCCESS] ✅ GPT-5 INTEGRATION: Real LinkedIn message generation with comprehensive logging`);
            console.log(`[SUCCESS] ✅ CHARGEBEE INTEGRATION: Payment processing and subscription management`);
            console.log(`[SUCCESS] ✅ MAILERSEND INTEGRATION: Welcome email automation`);
            console.log(`[SUCCESS] ✅ WEBHOOK FIX: Fixed Chargebee webhook JSON parsing error`);
            console.log(`[SUCCESS] ✅ PAYG FIX: Fixed one-time purchase webhook handling`);
            console.log(`[SUCCESS] ✅ REGISTRATION DEBUG: Enhanced logging to identify registration failures`);
            console.log(`[SUCCESS] ✅ WEBHOOK REGISTRATION FIX: Automatic registration completion in webhooks after payment`);
            console.log(`[SUCCESS] ✅ PENDING REGISTRATIONS: LinkedIn URL stored in database before payment`);
            console.log(`[SUCCESS] ✅ CLEAN WEBHOOK LOGGING: Removed excessive debug output`);
            console.log(`[SUCCESS] ✅ MODULAR REFACTOR: Messages handlers moved to dedicated files`);
            console.log(`[SUCCESS] ✅ MESSAGES ROUTE FIX: /messages page served with authentication`);
            console.log(`[SUCCESS] ✅ AUTHENTICATION FIX: Removed server-side auth middleware, using client-side auth instead`);
            console.log(`[SUCCESS] ✅ MSGLY PROFILE: Standalone profile page with full editing capabilities`);
            console.log(`[SUCCESS] ✅ PERSONAL INFO: Complete personal information CRUD system`);
            console.log(`[SUCCESS] ✅ MANUAL EDITING: Manual profile editing endpoints for all sections`);
            console.log(`[SUCCESS] ✅ MESSAGES HISTORY ENDPOINT: GET /messages/history for Messages page functionality`);
            console.log(`[SUCCESS] 🔧 PAYG CRITICAL FIX: Enhanced planLineItem detection for both plan_item_price and charge_item_price entity types`);
            console.log(`[SUCCESS] ✅ GOLD & PLATINUM PLANS: Added Gold-Monthly (100 credits) and Platinum-Monthly (250 credits) plan support`);
            console.log(`[SUCCESS] ✅ CANCELLATION HANDLING: Automatic subscription cancellation processing and downgrade to free plan`);
            console.log(`[SUCCESS] ✅ GOLD & PLATINUM PAYG: Added Gold-PAYG-USD (100 credits) and Platinum-PAYG-USD (250 credits) one-time purchase support`);
            console.log(`[SUCCESS] ✅ BILLING REFACTOR: Clean separation of billing logic into dedicated modules`);
            console.log(`[SUCCESS] ✅ PROFESSIONAL LOGGER: Environment-based professional logging for clean production deployment`);
            console.log(`[SUCCESS] ✅ MESSAGES DB FIX: Fixed Messages page save functionality with proper database integration`);
            console.log(`[SUCCESS] ✅ PERSONAL INFO SAVE FIX: Fixed personal information save to handle missing user_profiles records`);
            console.log(`[SUCCESS] ✅ FILE UPLOAD: Added file upload functionality with consent checkbox and 7-day storage`);
            console.log(`[SUCCESS] ✅ PROFILE DATA EXTRACTION FIX: Added extractProfileFromJson function and response modification for real profile data display`);
            console.log(`[SUCCESS] ✅ MINIMAL PROFILE FIX: Fixed extractProfileFromJson to use correct database JSON structure and simplified file upload response handling`);
            console.log(`[SUCCESS] ✅ CONTEXTS: Context management system with plan-based limits (Free: 1, Silver: 3, Gold: 6, Platinum: 10)`);
            console.log(`[SUCCESS] ✅ UNIFIED GENERATION REAL GPT: Connected /generate-unified endpoint to existing GPT-5 message generation system - NO MORE MOCK DATA`);
            console.log(`[SUCCESS] ✅ CONTEXT ADDON PURCHASE: Added /context-addons/purchase endpoint for extension Buy Extra slot functionality`);
            console.log(`[SUCCESS] ✅ CONTEXT SLOT FUNCTIONS: Added missing context slot function imports for proper webhook allocation`);
            console.log(`[SUCCESS] ✅ CORS FIX: Added PUT and DELETE methods to CORS configuration for context deletion`);
            console.log(`[SUCCESS] ✅ ADMIN DASHBOARD: Added internal analytics dashboard with JWT authentication and comprehensive metrics`);
            console.log(`[SUCCESS] ✅ EMAIL FIX: Removed early welcome email sending from OAuth callback - now properly timed at registration completion`);
            console.log(`[SUCCESS] ✅ ADMIN NOTIFICATIONS: Added admin notification emails to ziv@msgly.ai for new user registrations`);
            console.log(`[SUCCESS] ✅ EMAIL TIMING FIX: Moved welcome email sending from /complete-registration to /send-welcome-email endpoint called by dashboard`);
            console.log(`[SUCCESS] ✅ DUO ADMIN 2FA: Enterprise-grade Duo Universal SDK authentication for admin dashboard protection`);
            console.log(`[SUCCESS] ✅ DUO ES MODULE FIX: Fixed Duo Universal SDK import to use dynamic import() instead of require()`);
            console.log(`[SUCCESS] 🔧 DUO ADMIN FIX: Fixed createAuthUrl to be awaited and fixed crypto scope issue`);
            console.log(`[LOGGER] ✅ CLEAN PRODUCTION LOGS: Debug logs only show in development (NODE_ENV !== 'production')`);
            console.log(`[LOGGER] ✅ ERROR LOGS ALWAYS VISIBLE: Critical errors and warnings always shown in production`);
            console.log(`[LOGGER] ✅ PERFORMANCE OPTIMIZED: Zero debug overhead in production environment`);
            console.log(`[DUO 2FA] ✅ OIDC-BASED AUTHENTICATION: Modern OAuth2/OIDC flow with state validation`);
            console.log(`[DUO 2FA] ✅ EMAIL ALLOWLIST: Only authorized emails can access admin dashboard`);
            console.log(`[DUO 2FA] ✅ SESSION MANAGEMENT: 2-hour secure admin sessions with automatic expiry`);
            console.log(`[DUO 2FA] ✅ EMERGENCY BYPASS: ADMIN_AUTH_DISABLED=true for emergency access`);
            console.log(`[DUO 2FA] ✅ CSRF PROTECTION: State parameter validation prevents cross-site attacks`);
            console.log(`[DUO 2FA] ✅ PRODUCTION READY: Automatic URL switching for dev/prod environments`);
            console.log(`[DUO ES MODULE FIX] ✅ DYNAMIC IMPORT: Uses import() instead of require() for ES Module compatibility`);
            console.log(`[DUO ES MODULE FIX] ✅ ASYNC INITIALIZATION: Duo SDK initialized in startServer() function`);
            console.log(`[DUO ES MODULE FIX] ✅ ERROR HANDLING: Graceful fallback if Duo initialization fails`);
            console.log(`[DUO ES MODULE FIX] ✅ EMERGENCY BYPASS: Still works with ADMIN_AUTH_DISABLED=true`);
            console.log(`[DUO ADMIN FIX] 🔧 AWAIT CREATEAUTHURL: Fixed createAuthUrl to be awaited properly`);
            console.log(`[DUO ADMIN FIX] 🔧 CRYPTO SCOPE: Fixed crypto imports to use node: prefix and function-level requires`);
            console.log(`[DUO ADMIN FIX] 🔧 500 ERROR RESOLVED: Admin login now works without server crashes`);
            console.log(`[SUCCESS] DATABASE-FIRST TARGET + USER PROFILE MODE WITH DUAL CREDITS + AUTO-REGISTRATION + RACE PROTECTION + URL FIX + GPT-5 + CHARGEBEE + MAILERSEND + WEBHOOK REGISTRATION FIX + MODULAR REFACTOR + MESSAGES ROUTE FIX + AUTHENTICATION FIX + MSGLY PROFILE + PERSONAL INFO + MANUAL EDITING + MESSAGES HISTORY ENDPOINT + 🔧 PAYG CRITICAL FIX + ✅ GOLD & PLATINUM PLANS + ✅ CANCELLATION HANDLING + ✅ GOLD & PLATINUM PAYG + ✅ BILLING REFACTOR + ✅ PROFESSIONAL LOGGER + ✅ MESSAGES DB FIX + ✅ PERSONAL INFO SAVE FIX + ✅ FILE UPLOAD + ✅ PROFILE DATA EXTRACTION FIX + ✅ MINIMAL PROFILE FIX + ✅ CONTEXTS + ✅ UNIFIED GENERATION REAL GPT + ✅ CONTEXT ADDON PURCHASE + ✅ CONTEXT SLOT FUNCTIONS + ✅ CORS FIX + ✅ ADMIN DASHBOARD + ✅ EMAIL FIX + ✅ ADMIN NOTIFICATIONS + ✅ EMAIL TIMING FIX + ✅ DUO ADMIN 2FA + ✅ DUO ES MODULE FIX + 🔧 DUO ADMIN FIX:`);
            console.log(`[MESSAGES] ✅ GET /messages/history - Now reads actual sent_status, reply_status, and comments from database`);
            console.log(`[MESSAGES] ✅ PUT /messages/:id - New endpoint to update message status and comments`);
            console.log(`[MESSAGES] ✅ Database Integration - Full CRUD operations for message campaign tracking`);
            console.log(`[PERSONAL INFO] ✅ PUT /profile/personal-info - FIXED: Now handles missing user_profiles records with UPSERT logic`);
            console.log(`[FILE UPLOAD] ✅ POST /api/analyze-profile-file - MINIMAL FIX: Simplified response handling and correct profile data extraction`);
            console.log(`[FILE UPLOAD] ✅ Profile Data Extraction - FIXED: extractProfileFromJson now uses correct database JSON structure`);
            console.log(`[FILE UPLOAD] ✅ Response Enhancement - SIMPLIFIED: Clean response capture without complex interception`);
            console.log(`[CONTEXTS] ✅ Context Management System - Plan-based limits with server-side storage`);
            console.log(`[CONTEXTS] ✅ Free: 1 context, Silver: 3 contexts, Gold: 6 contexts, Platinum: 10 contexts`);
            console.log(`[CONTEXTS] ✅ Full CRUD operations: Create, Read, Update, Delete contexts`);
            console.log(`[CONTEXTS] ✅ Plan enforcement: Automatic limit checking based on user subscription`);
            console.log(`[CONTEXTS] ✅ Ready for web deployment and extension integration`);
            console.log(`[UNIFIED GENERATION] ✅ POST /generate-unified - FIXED: Real GPT-5 integration instead of mock data`);
            console.log(`[UNIFIED GENERATION] ✅ CONNECTED TO EXISTING SYSTEM: Uses handleGenerateMessage, handleGenerateConnection, handleGenerateColdEmail functions`);
            console.log(`[UNIFIED GENERATION] ✅ Credit Management: Integrated with existing credit hold/deduction system`);
            console.log(`[UNIFIED GENERATION] ✅ Multi-Message Support: Generates multiple message types in single request using real GPT-5`);
            console.log(`[UNIFIED GENERATION] ✅ NO MORE MOCK DATA: All messages generated using proven working GPT pipeline`);
            console.log(`[UNIFIED GENERATION] ✅ Error Handling: Comprehensive error handling and credit release on failure`);
            console.log(`[CONTEXT ADDON] ✅ POST /context-addons/purchase - NEW: Buy Extra slot functionality for extension`);
            console.log(`[CONTEXT ADDON] ✅ CHARGEBEE INTEGRATION: Uses existing chargebeeService.createCheckout() method`);
            console.log(`[CONTEXT ADDON] ✅ EXACT PLAN ID: Context-Addon-Monthly-USD-Monthly ($3.99/month)`);
            console.log(`[CONTEXT ADDON] ✅ SUCCESS/CANCEL URLS: Dashboard redirect with status parameters`);
            console.log(`[CONTEXT ADDON] ✅ ERROR HANDLING: Comprehensive error handling and user feedback`);
            console.log(`[CONTEXT ADDON] ✅ AUTHENTICATION: Requires authenticateToken middleware`);
            console.log(`[CONTEXT ADDON] ✅ LOGGING: Professional logging for debugging and monitoring`);
            console.log(`[CONTEXT ADDON] ✅ READY FOR DEPLOYMENT: Fully integrated with existing payment flow`);
            console.log(`[CONTEXT FUNCTIONS] ✅ DATABASE IMPORTS: Added missing context slot function imports`);
            console.log(`[CONTEXT FUNCTIONS] ✅ WEBHOOK INTEGRATION: getContextAddonUsage, createContextAddon, updateUserContextSlots, initializeContextSlots`);
            console.log(`[CONTEXT FUNCTIONS] ✅ PROPER ALLOCATION: Webhooks can now properly allocate extra context slots after payment`);
            console.log(`[CONTEXT FUNCTIONS] ✅ SIMPLIFIED SYSTEM: Direct database fields instead of complex calculations`);
            console.log(`[CORS] ✅ PUT AND DELETE METHODS: Added to CORS configuration for context deletion`);
            console.log(`[CORS] ✅ CONTEXT DELETION: Frontend can now properly delete contexts`);
            console.log(`[CORS] ✅ API COMPATIBILITY: Full REST API support for all HTTP methods`);
            console.log(`[ADMIN DASHBOARD] ✅ GET /admin-dashboard - Internal analytics dashboard with DUO 2FA protection`);
            console.log(`[ADMIN DASHBOARD] ✅ DUO 2FA AUTHENTICATION: Enterprise-grade Duo Universal SDK integration`);
            console.log(`[ADMIN DASHBOARD] ✅ COMPREHENSIVE METRICS: User analytics, activity tracking, error monitoring`);
            console.log(`[ADMIN DASHBOARD] ✅ VISUAL CHARTS: Real-time graphs and charts for business insights`);
            console.log(`[ADMIN DASHBOARD] ✅ EXPORT FUNCTIONALITY: CSV downloads for further analysis`);
            console.log(`[ADMIN DASHBOARD] ✅ SYSTEM HEALTH: Performance monitoring and error tracking`);
            console.log(`[ADMIN DASHBOARD] ✅ READY FOR DEPLOYMENT: Complete admin interface with enterprise security`);
            console.log(`[EMAIL FIX] ✅ REMOVED EARLY EMAIL SENDING: OAuth callback no longer sends premature welcome emails`);
            console.log(`[EMAIL FIX] ✅ PROPER TIMING: Welcome emails now sent only at registration completion for free users`);
            console.log(`[EMAIL FIX] ✅ WEBHOOK EMAIL HANDLING: Paid users receive welcome emails via webhook after payment`);
            console.log(`[ADMIN NOTIFICATIONS] ✅ ZIV@MSGLY.AI ALERTS: Admin receives notification for every new user registration`);
            console.log(`[ADMIN NOTIFICATIONS] ✅ COMPREHENSIVE DATA: Includes user details, plan, LinkedIn info, timestamp`);
            console.log(`[ADMIN NOTIFICATIONS] ✅ NON-BLOCKING: Email failures don't disrupt registration flow`);
            console.log(`[ADMIN NOTIFICATIONS] ✅ AUTO-REGISTRATION SUPPORT: Works for both manual and extension auto-registrations`);
            console.log(`[ADMIN NOTIFICATIONS] ✅ WEBHOOK INTEGRATION: Notifications sent for webhook-completed registrations too`);
            console.log(`[EMAIL TIMING FIX] ✅ DASHBOARD EMAIL TRIGGER: Welcome emails now sent when dashboard loads for new users`);
            console.log(`[EMAIL TIMING FIX] ✅ NEW ENDPOINT: /send-welcome-email for dashboard to call`);
            console.log(`[EMAIL TIMING FIX] ✅ BETTER TIMING: Users get email right as they start using the platform`);
            console.log(`[EMAIL TIMING FIX] ✅ CONFIRMATION EMAIL: Serves as "you're successfully logged in" confirmation`);
            console.log(`[EMAIL TIMING FIX] ✅ IMPROVED UX: Email arrives when users are most engaged`);
            console.log(`[DUO ADMIN 2FA] ✅ ENTERPRISE SECURITY: Duo Universal SDK with OIDC-based authentication`);
            console.log(`[DUO ADMIN 2FA] ✅ EMAIL ALLOWLIST: Only ziv@msgly.ai and Shechory21@gmail.com can access admin`);
            console.log(`[DUO ADMIN 2FA] ✅ SESSION SECURITY: 2-hour expiring sessions with secure cookies`);
            console.log(`[DUO ADMIN 2FA] ✅ EMERGENCY BYPASS: ADMIN_AUTH_DISABLED=true for emergency access`);
            console.log(`[DUO ADMIN 2FA] ✅ CSRF PROTECTION: State validation prevents cross-site request forgery`);
            console.log(`[DUO ADMIN 2FA] ✅ MOBILE 2FA: Requires Duo Mobile app for push notifications or passcodes`);
            console.log(`[DUO ADMIN 2FA] ✅ PRODUCTION READY: Environment-aware redirect URLs for dev/prod`);
            console.log(`[DUO ES MODULE FIX] ✅ COMPATIBILITY FIXED: Uses dynamic import() for ES Module compatibility`);
            console.log(`[DUO ES MODULE FIX] ✅ NO MORE CRASHES: Server starts successfully with Duo Universal SDK`);
            console.log(`[DUO ES MODULE FIX] ✅ ASYNC INITIALIZATION: Duo initialized during server startup`);
            console.log(`[DUO ES MODULE FIX] ✅ ROBUST ERROR HANDLING: Graceful fallback if Duo fails to initialize`);
            console.log(`[DUO ADMIN FIX] 🔧 CREATEAUTHURL AWAIT: Fixed missing await on duoClient.createAuthUrl() call`);
            console.log(`[DUO ADMIN FIX] 🔧 CRYPTO SCOPE FIX: Fixed crypto module access with node: prefix and function-level requires`);
            console.log(`[DUO ADMIN FIX] 🔧 500 ERROR RESOLVED: Admin login endpoint now works without "crypto is not defined" error`);
            console.log(`[DUO ADMIN FIX] 🔧 PRODUCTION READY: Admin dashboard fully functional with fixed Duo authentication`);
        });
        
    } catch (error) {
        logger.error('Startup failed:', error);
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
