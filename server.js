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
*/

// server.js - Enhanced with Real Plan Data & Dual Credit System + AUTO-REGISTRATION + GPT-5 MESSAGE GENERATION + CHARGEBEE INTEGRATION + MAILERSEND
// DATABASE-First TARGET PROFILE system with sophisticated credit management
// ✅ AUTO-REGISTRATION: Enhanced Chrome extension auth with LinkedIn URL support
// ✅ RACE CONDITION FIX: Added minimal in-memory tracking to prevent duplicate processing
// ✅ URL MATCHING FIX: Fixed profile deduplication to handle both URL formats
// ✅ GPT-5 INTEGRATION: Real LinkedIn message generation with comprehensive logging
// ✅ CHARGEBEE INTEGRATION: Payment processing and subscription management
// ✅ MAILERSEND INTEGRATION: Welcome email automation

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

// NEW: Import GPT-5 service
const gptService = require('./services/gptService');

// NEW: Import Chargebee service
const { chargebeeService } = require('./services/chargebeeService');

// NEW: Import MailerSend service (MINIMAL CHANGE #1)
const { sendWelcomeEmail } = require('./mailer/mailer');

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

// NEW: RACE CONDITION FIX - Track active profile processing to prevent duplicates
const activeProcessing = new Map();

// NEW: CHARGEBEE PLAN MAPPING - Maps Chargebee plan IDs to database plan codes
// FIXED: Updated 'Silver-PAYG' to 'Silver-PAYG-USD' to match actual Chargebee Item Price IDs
const CHARGEBEE_PLAN_MAPPING = {
    'Silver-Monthly': {
        planCode: 'silver-monthly',
        renewableCredits: 30,
        billingModel: 'monthly'
    },
    'Silver-PAYG-USD': {  // FIXED: Changed from 'Silver-PAYG' to 'Silver-PAYG-USD'
        planCode: 'silver-payasyougo', 
        payasyougoCredits: 30,
        billingModel: 'one_time'
    }
    // Gold and Platinum will be added later
};

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
            console.log(`[SUCCESS] Profile already exists in database: ID ${profile.id}`);
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
            console.log(`[NEW] Profile is new in database: ${cleanUrl}`);
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
    console.log('[FIRE] saveProfileToDB FUNCTION CALLED - START OF FUNCTION');
    console.log('[CHECK] saveProfileToDB function entry - detailed parameters:');
    console.log('   linkedinUrl:', linkedinUrl);
    console.log('   userId:', userId);
    
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        // Clean token values
        const cleanedInput = cleanTokenNumber(tokenData.inputTokens);
        const cleanedOutput = cleanTokenNumber(tokenData.outputTokens);
        const cleanedTotal = cleanTokenNumber(tokenData.totalTokens);
        
        console.log('[CHECK] Final values going to database:', {
            inputTokens: cleanedInput,
            outputTokens: cleanedOutput,
            totalTokens: cleanedTotal
        });
        
        // DEBUGGING: Add error tracing before database insert
        console.log('[TARGET] ABOUT TO EXECUTE TARGET PROFILE INSERT');
        console.log('[TARGET] SQL VALUES GOING TO DATABASE:');
        console.log('   userId:', userId, typeof userId);
        console.log('   cleanUrl:', cleanUrl, typeof cleanUrl);
        console.log('   cleanedInput:', cleanedInput, typeof cleanedInput);
        console.log('   cleanedOutput:', cleanedOutput, typeof cleanedOutput);
        console.log('   cleanedTotal:', cleanedTotal, typeof cleanedTotal);

        let result;
        try {
            console.log('[CHECK] About to execute PostgreSQL INSERT query...');
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
            
            console.log('[TARGET] TARGET PROFILE INSERT SUCCESS!');
            
        } catch (dbError) {
            console.log('[TARGET] TARGET PROFILE INSERT FAILED!');
            console.log('[TARGET] DATABASE ERROR:', dbError.message);
            console.log('[TARGET] ERROR DETAIL:', dbError.detail);
            console.log('[TARGET] SQL STATE:', dbError.code);
            console.log('[TARGET] PROBLEMATIC VALUES - DETAILED:');
            console.log('   param1 (userId):', { value: userId, type: typeof userId, isNull: userId === null });
            console.log('   param2 (cleanUrl):', { value: cleanUrl, type: typeof cleanUrl, length: cleanUrl?.length });
            console.log('   param3 (rawJsonData):', { type: typeof rawJsonData, jsonLength: JSON.stringify(rawJsonData).length });
            console.log('   param4 (cleanedInput):', { value: cleanedInput, type: typeof cleanedInput, isNull: cleanedInput === null, original: tokenData.inputTokens });
            console.log('   param5 (cleanedOutput):', { value: cleanedOutput, type: typeof cleanedOutput, isNull: cleanedOutput === null, original: tokenData.outputTokens });
            console.log('   param6 (cleanedTotal):', { value: cleanedTotal, type: typeof cleanedTotal, isNull: cleanedTotal === null, original: tokenData.totalTokens });
            throw dbError;
        }
        
        const savedProfile = result.rows[0];
        
        console.log(`[SAVE] Profile saved to database: ID ${savedProfile.id}`);
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

// ✅ FIXED: DATABASE-First TARGET PROFILE handler with dual credit system (NO DOUBLE SPENDING)
async function handleTargetProfileJSON(req, res) {
    console.log('[FIRE] handleTargetProfileJSON FUNCTION CALLED - START OF FUNCTION');
    console.log('[TARGET] === DATABASE-FIRST TARGET PROFILE PROCESSING ===');
    console.log('[CHECK] Request body keys:', Object.keys(req.body || {}));
    console.log('[CHECK] User object:', req.user ? { id: req.user.id, email: req.user.email } : 'NO USER');
    
    let holdId = null;
    
    try {
        console.log(`[USER] User ID: ${req.user.id}`);
        console.log(`[LINK] URL: ${req.body.profileUrl}`);
        
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
        console.log('[CHECK] Checking if profile already exists in database...');
        const existsCheck = await checkIfProfileExistsInDB(cleanProfileUrl);
        
        if (existsCheck.exists) {
            // ALREADY ANALYZED: Return marketing message, no credits charged
            console.log('[BOOM] Profile already analyzed - showing marketing message');
            
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
            console.log('[RACE] Profile currently being processed by another request');
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
        console.log(`[RACE] Marked profile as processing: ${requestKey}`);

        // STEP 2: NEW PROFILE - Create credit hold and analyze
        console.log('[CREDIT] Creating credit hold for new profile analysis...');
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
        console.log(`[SUCCESS] Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        
        console.log('[AI] Processing HTML with Gemini for NEW TARGET profile...');
        
        // Process HTML with Gemini
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: false  // FALSE for target profiles
        });
        
        if (!geminiResult.success) {
            console.error('[ERROR] Gemini processing failed for TARGET profile:', geminiResult.userMessage);
            
            // Release hold on failure
            await releaseCreditHold(userId, holdId, 'gemini_processing_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process target profile data with Gemini',
                details: geminiResult.userMessage || 'Unknown error'
            });
        }
        
        console.log('[SUCCESS] Gemini processing successful for TARGET profile');
        
        // STEP 3: Save analysis result to database
        console.log('[SAVE] Saving analysis to database...');
        console.log('[CHECK] About to call saveProfileToDB with:');
        console.log('   cleanProfileUrl length:', cleanProfileUrl.length);
        console.log('   geminiResult.rawResponse available:', !!geminiResult.rawResponse);
        console.log('   userId:', userId);
        
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
        console.log('[CREDIT] Completing operation with credit deduction...');
        const completionResult = await completeOperation(userId, holdId, {
            profileUrl: cleanProfileUrl,
            databaseId: saveResult.id,
            analysisData: 'RAW_JSON_SAVED',
            tokenUsage: geminiResult.tokenData || {},
            processingTime: 0
        });

        if (!completionResult.success) {
            console.error('[ERROR] Failed to complete operation:', completionResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful analysis'
            });
        }

        console.log('[SUCCESS] TARGET profile saved to database successfully');
        console.log(`[DATA] Analysis saved: Database ID ${saveResult.id}`);
        console.log(`[MONEY] Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
        
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
    } finally {
        // RACE CONDITION FIX: Always cleanup processing map
        if (req.body.profileUrl) {
            const cleanProfileUrl = cleanLinkedInUrl(req.body.profileUrl);
            const requestKey = `${req.user.id}_${cleanProfileUrl}`;
            activeProcessing.delete(requestKey);
            console.log(`[RACE] Cleaned up processing map: ${requestKey}`);
        }
    }
}

// USER PROFILE HANDLER: Enhanced with token tracking (UNCHANGED)
async function handleUserProfile(req, res) {
    try {
        console.log('[BLUE] === USER PROFILE PROCESSING ===');
        console.log(`[USER] User ID: ${req.user.id}`);
        console.log(`[LINK] URL: ${req.body.profileUrl}`);
        
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
        
        console.log('[AI] Processing HTML with Gemini for USER profile...');
        
        // Process HTML with Gemini
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: true
        });
        
        if (!geminiResult.success) {
            console.error('[ERROR] Gemini processing failed for USER profile:', geminiResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process profile data with Gemini',
                details: geminiResult.error || 'Unknown error'
            });
        }
        
        console.log('[SUCCESS] Gemini processing successful for USER profile');
        
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
        
        console.log('[SUCCESS] USER profile saved to user_profiles table successfully');
        console.log(`[DATA] Token usage: ${geminiResult.tokenData?.inputTokens || 'N/A'} input, ${geminiResult.tokenData?.outputTokens || 'N/A'} output, ${geminiResult.tokenData?.totalTokens || 'N/A'} total`);
        
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

// FIXED: Enhanced Message Generation with GPT-5 and comprehensive logging
async function handleGenerateMessage(req, res) {
    let holdId = null;
    
    try {
        console.log('[MESSAGE] === GPT-5 MESSAGE GENERATION WITH DUAL CREDITS ===');
        console.log(`[USER] User ID: ${req.user.id}`);
        console.log('[CHECK] Request payload keys:', Object.keys(req.body));
        console.log('[CHECK] targetProfileUrl present:', !!req.body.targetProfileUrl);
        console.log('[CHECK] outreachContext present:', !!req.body.outreachContext);
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        console.log('[CHECK] targetProfileUrl:', targetProfileUrl.substring(0, 50) + '...');
        console.log('[CHECK] outreachContext length:', outreachContext.length);

        // Create credit hold
        console.log('[CREDIT] Creating credit hold for message generation...');
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
        console.log(`[SUCCESS] Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);

        // FIXED STEP 1: Load user profile from database - ADDED gemini_raw_data
        console.log('[DATABASE] Loading user profile JSON...');
        const userProfileResult = await pool.query(`
            SELECT 
                gemini_raw_data,
                full_name,
                headline,
                current_job_title,
                current_company,
                location,
                experience,
                education,
                skills,
                about
            FROM user_profiles
            WHERE user_id = $1
        `, [userId]);

        if (userProfileResult.rows.length === 0) {
            await releaseCreditHold(userId, holdId, 'user_profile_not_found');
            return res.status(400).json({
                success: false,
                error: 'User profile not found. Please complete your profile setup first.'
            });
        }

        const userProfile = userProfileResult.rows[0];
        
        // FIXED: Added debug logging for gemini_raw_data
        console.log('[DEBUG] User gemini_raw_data present:', !!userProfile.gemini_raw_data);
        if (userProfile.gemini_raw_data) {
            const geminiDataSize = typeof userProfile.gemini_raw_data === 'string' 
                ? userProfile.gemini_raw_data.length 
                : JSON.stringify(userProfile.gemini_raw_data).length;
            console.log('[DEBUG] User gemini_raw_data size (bytes):', geminiDataSize);
        }
        console.log('[CHECK] user profile has name:', !!userProfile.full_name);

        // STEP 2: Load target profile from database  
        console.log('[DATABASE] Loading target profile JSON...');
        const cleanTargetUrl = cleanLinkedInUrl(targetProfileUrl);
        const targetProfileResult = await pool.query(`
            SELECT 
                id,
                data_json,
                linkedin_url
            FROM target_profiles
            WHERE linkedin_url = $1 OR linkedin_url = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [cleanTargetUrl, targetProfileUrl]);

        if (targetProfileResult.rows.length === 0) {
            await releaseCreditHold(userId, holdId, 'target_profile_not_found');
            return res.status(400).json({
                success: false,
                error: 'Target profile not found. Please analyze the target profile first.'
            });
        }

        const targetProfile = targetProfileResult.rows[0];
        console.log('[CHECK] target_profile_json present:', !!targetProfile.data_json);
        console.log('[CHECK] target profile ID:', targetProfile.id);
        
        // FIXED: Added debug logging for nested profile structure
        let hasNestedProfile = false;
        if (targetProfile.data_json) {
            try {
                const parsedData = typeof targetProfile.data_json === 'string' 
                    ? JSON.parse(targetProfile.data_json) 
                    : targetProfile.data_json;
                hasNestedProfile = !!(parsedData.data && parsedData.data.profile);
            } catch (e) {
                // Parsing error, log but continue
                console.log('[DEBUG] Error parsing target profile data_json for debug check');
            }
        }
        console.log('[DEBUG] Target nested profile present:', hasNestedProfile);

        // STEP 3: Call GPT-5 service for message generation
        console.log('[GPT] Calling GPT-5 service for message generation...');
        const gptStartTime = Date.now();
        
        const gptResult = await gptService.generateLinkedInMessage(
            userProfile,
            targetProfile,
            outreachContext,
            'inbox_message'
        );

        const gptEndTime = Date.now();
        const gptLatency = gptEndTime - gptStartTime;

        console.log(`[GPT] GPT-5 call completed in ${gptLatency}ms`);
        console.log('[CHECK] GPT-5 success:', gptResult.success);

        // FIXED: Added GPT-5 usage logging after call
        if (gptResult.success && gptResult.tokenUsage) {
            console.log(`[DEBUG] GPT-5 usage - Input: ${gptResult.tokenUsage.input_tokens}, Output: ${gptResult.tokenUsage.output_tokens}, Total: ${gptResult.tokenUsage.total_tokens}`);
        }

        if (!gptResult.success) {
            console.error('[ERROR] GPT-5 message generation failed:', gptResult.error);
            await releaseCreditHold(userId, holdId, 'gpt_generation_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Message generation failed',
                details: gptResult.userMessage || 'AI service temporarily unavailable'
            });
        }

        const generatedMessage = gptResult.message;
        console.log('[SUCCESS] Message generated successfully');
        console.log('[GPT] Generated message preview:', generatedMessage.substring(0, 120) + '...');
        console.log('[GPT] Token usage:', gptResult.tokenUsage);

        // STEP 4: Store comprehensive data in message_logs table
        console.log('[DATABASE] Storing message generation data...');
        
        const messageLogResult = await pool.query(`
            INSERT INTO message_logs (
                user_id,
                target_profile_url,
                generated_message,
                context_text,
                target_first_name,
                target_title,
                target_company,
                model_name,
                prompt_version,
                input_tokens,
                output_tokens,
                total_tokens,
                latency_ms,
                data_json,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
            RETURNING id
        `, [
            userId,
            targetProfileUrl,
            generatedMessage,
            outreachContext,
            gptResult.metadata.target_first_name,
            gptResult.metadata.target_title,
            gptResult.metadata.target_company,
            gptResult.metadata.model_name,
            gptResult.metadata.prompt_version,
            gptResult.tokenUsage.input_tokens,
            gptResult.tokenUsage.output_tokens,
            gptResult.tokenUsage.total_tokens,
            gptResult.metadata.latency_ms,
            JSON.stringify(gptResult.rawResponse)
        ]);

        const messageLogId = messageLogResult.rows[0].id;
        console.log('[SUCCESS] Message log inserted with ID:', messageLogId);

        // STEP 5: Complete the credit hold (this handles the deduction)
        const completionResult = await completeOperation(userId, holdId, {
            messageGenerated: true,
            messageLength: generatedMessage.length,
            targetUrl: targetProfileUrl,
            messageLogId: messageLogId,
            tokenUsage: gptResult.tokenUsage
        });

        if (!completionResult.success) {
            console.error('[ERROR] Failed to complete operation:', completionResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful generation'
            });
        }

        console.log(`[MONEY] Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);

        res.json({
            success: true,
            message: 'LinkedIn message generated successfully with GPT-5',
            data: {
                generatedMessage: generatedMessage,
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage,
                processingTime: gptLatency
            },
            credits: {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                renewableCredits: completionResult.renewableCredits,
                payasyougoCredits: completionResult.payasyougoCredits,
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
        console.log('[CONNECT] === CONNECTION GENERATION WITH DUAL CREDITS ===');
        console.log(`[USER] User ID: ${req.user.id}`);
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        // Create credit hold
        console.log('[CREDIT] Creating credit hold for connection generation...');
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
        console.log(`[SUCCESS] Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);

        // TODO: Implement actual connection message generation with AI
        // For now, return a placeholder
        const generatedConnection = `I'd love to connect with you given your background in ${outreachContext}. Looking forward to potential collaboration opportunities.`;

        // Complete the credit hold (this handles the deduction)
        const completionResult = await completeOperation(userId, holdId, {
            connectionGenerated: true,
            messageLength: generatedConnection.length,
            targetUrl: targetProfileUrl
        });

        if (!completionResult.success) {
            console.error('[ERROR] Failed to complete operation:', completionResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process credits after successful generation'
            });
        }

        console.log(`[MONEY] Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);

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
                renewableCredits: completionResult.renewableCredits,
                payasyougoCredits: completionResult.payasyougoCredits,
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

// NEW: CHARGEBEE WEBHOOK HANDLER FUNCTIONS (MINIMAL CHANGE #2 - Added welcome email)
async function handleSubscriptionCreated(subscription, customer) {
    try {
        console.log('[WEBHOOK] Processing subscription_created');
        console.log('  - Subscription ID:', subscription.id);
        console.log('  - Customer email:', customer.email);
        console.log('  - Plan ID:', subscription.plan_id);
        
        // Find user by email
        const user = await getUserByEmail(customer.email);
        if (!user) {
            console.error('[WEBHOOK] User not found:', customer.email);
            return;
        }
        
        // Map Chargebee plan to database plan
        const planMapping = CHARGEBEE_PLAN_MAPPING[subscription.plan_id];
        if (!planMapping) {
            console.error('[WEBHOOK] Unknown plan ID:', subscription.plan_id);
            return;
        }
        
        let planCode = planMapping.planCode;
        let renewableCredits = planMapping.renewableCredits || 0;
        let payasyougoCredits = planMapping.payasyougoCredits || 0;
        
        // Update user subscription
        await pool.query(`
            UPDATE users 
            SET 
                plan_code = $1,
                renewable_credits = $2,
                payasyougo_credits = COALESCE(payasyougo_credits, 0) + $3,
                subscription_starts_at = $4,
                next_billing_date = $5,
                chargebee_subscription_id = $6,
                subscription_status = 'active',
                updated_at = NOW()
            WHERE id = $7
        `, [
            planCode,
            renewableCredits,
            payasyougoCredits,
            new Date(subscription.started_at * 1000),
            subscription.next_billing_at ? new Date(subscription.next_billing_at * 1000) : null,
            subscription.id,
            user.id
        ]);
        
        console.log(`[WEBHOOK] User ${user.id} upgraded to ${planCode}`);
        console.log(`  - Renewable credits: ${renewableCredits}`);
        console.log(`  - Pay-as-you-go credits added: ${payasyougoCredits}`);
        
        // NEW: Send welcome email for paid users (NON-BLOCKING)
        try {
            // Check if welcome email already sent
            const emailCheck = await pool.query(
                'SELECT welcome_email_sent FROM users WHERE id = $1',
                [user.id]
            );
            
            if (emailCheck.rows.length > 0 && !emailCheck.rows[0].welcome_email_sent) {
                console.log(`[MAILER] Sending welcome email for paid user: ${user.email}`);
                
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
                    
                    console.log(`[MAILER] Welcome email sent successfully: ${emailResult.messageId}`);
                } else {
                    console.error(`[MAILER] Welcome email failed: ${emailResult.error}`);
                }
            }
        } catch (emailError) {
            console.error('[MAILER] Non-blocking email error:', emailError);
            // Don't fail the webhook - email is not critical
        }
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling subscription_created:', error);
    }
}

async function handleSubscriptionActivated(subscription, customer) {
    try {
        console.log('[WEBHOOK] Processing subscription_activated');
        console.log('  - Subscription ID:', subscription.id);
        console.log('  - Customer email:', customer.email);
        
        // Find user by Chargebee subscription ID or email
        let user = await pool.query(`
            SELECT * FROM users 
            WHERE chargebee_subscription_id = $1 OR email = $2
        `, [subscription.id, customer.email]);
        
        if (user.rows.length === 0) {
            console.error('[WEBHOOK] User not found for subscription activation:', customer.email);
            return;
        }
        
        user = user.rows[0];
        
        // Update subscription status
        await pool.query(`
            UPDATE users 
            SET 
                subscription_status = 'active',
                chargebee_subscription_id = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [subscription.id, user.id]);
        
        console.log(`[WEBHOOK] Subscription activated for user ${user.id}`);
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling subscription_activated:', error);
    }
}

async function handleInvoiceGenerated(invoice, subscription) {
    try {
        console.log('[WEBHOOK] Processing invoice_generated');
        console.log('  - Invoice ID:', invoice.id);
        console.log('  - Subscription ID:', subscription?.id);
        console.log('  - Amount:', invoice.total);
        
        if (!subscription) {
            console.log('[WEBHOOK] No subscription associated with invoice');
            return;
        }
        
        // Find user by Chargebee subscription ID
        const user = await pool.query(`
            SELECT * FROM users 
            WHERE chargebee_subscription_id = $1
        `, [subscription.id]);
        
        if (user.rows.length === 0) {
            console.error('[WEBHOOK] User not found for invoice:', subscription.id);
            return;
        }
        
        const userData = user.rows[0];
        console.log(`[WEBHOOK] Invoice generated for user ${userData.id}`);
        
        // Handle renewal if this is a recurring subscription
        if (invoice.status === 'paid' && subscription.plan_id) {
            const planMapping = CHARGEBEE_PLAN_MAPPING[subscription.plan_id];
            if (planMapping && planMapping.billingModel === 'monthly') {
                // Reset renewable credits for monthly subscription
                await pool.query(`
                    UPDATE users 
                    SET 
                        renewable_credits = $1,
                        next_billing_date = $2,
                        updated_at = NOW()
                    WHERE id = $3
                `, [
                    planMapping.renewableCredits,
                    subscription.next_billing_at ? new Date(subscription.next_billing_at * 1000) : null,
                    userData.id
                ]);
                
                console.log(`[WEBHOOK] Renewable credits reset to ${planMapping.renewableCredits} for user ${userData.id}`);
            }
        }
        
    } catch (error) {
        console.error('[WEBHOOK] Error handling invoice_generated:', error);
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

// Serve upgrade page
app.get('/upgrade', (req, res) => {
    res.sendFile(path.join(__dirname, 'upgrade.html'));
});

// MODULARIZATION: Mount health routes
app.use('/', healthRoutes);

// STEP 2E: Mount user routes
app.use('/', userRoutes);

// ==================== NEW: CHARGEBEE WEBHOOK AND CHECKOUT ROUTES ====================

// NEW: Chargebee Webhook Handler
app.post('/chargebee-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        console.log('[WEBHOOK] Chargebee webhook received');
        
        // Parse the webhook payload
        const event = JSON.parse(req.body.toString());
        const eventType = event.event_type;
        
        console.log(`[WEBHOOK] Event type: ${eventType}`);
        
        switch (eventType) {
            case 'subscription_created':
                await handleSubscriptionCreated(event.content.subscription, event.content.customer);
                break;
            case 'subscription_activated':
                await handleSubscriptionActivated(event.content.subscription, event.content.customer);
                break;
            case 'invoice_generated':
                await handleInvoiceGenerated(event.content.invoice, event.content.subscription);
                break;
            case 'payment_succeeded':
                console.log(`[WEBHOOK] Payment succeeded for subscription: ${event.content.subscription?.id}`);
                // Handle successful payment if needed
                break;
            default:
                console.log(`[WEBHOOK] Unhandled event type: ${eventType}`);
        }
        
        res.status(200).json({ 
            success: true,
            message: 'Webhook processed successfully'
        });
    } catch (error) {
        console.error('[WEBHOOK] Error processing webhook:', error);
        res.status(500).json({ 
            success: false,
            error: 'Webhook processing failed' 
        });
    }
});

// NEW: Create Chargebee Checkout
app.post('/create-checkout', authenticateToken, async (req, res) => {
    try {
        const { planId } = req.body;
        const userId = req.user.id;
        
        console.log(`[CHECKOUT] Creating checkout for user ${userId}, plan ${planId}`);
        
        if (!planId) {
            return res.status(400).json({
                success: false,
                error: 'Plan ID is required'
            });
        }
        
        // Validate plan ID
        if (!CHARGEBEE_PLAN_MAPPING[planId]) {
            return res.status(400).json({
                success: false,
                error: 'Invalid plan ID'
            });
        }
        
        // Create Chargebee checkout
        const checkout = await chargebeeService.createCheckout({
            planId: planId,
            customerEmail: req.user.email,
            customerName: req.user.display_name,
            successUrl: 'https://api.msgly.ai/dashboard?upgrade=success',
            cancelUrl: 'https://api.msgly.ai/dashboard?upgrade=cancelled'
        });
        
        if (!checkout.success) {
            console.error('[CHECKOUT] Checkout creation failed:', checkout.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to create checkout session',
                details: checkout.error
            });
        }
        
        console.log(`[CHECKOUT] Checkout created successfully: ${checkout.checkoutUrl}`);
        
        res.json({
            success: true,
            message: 'Checkout session created successfully',
            data: {
                checkoutUrl: checkout.checkoutUrl,
                hostedPageId: checkout.hostedPageId,
                planId: planId
            }
        });
        
    } catch (error) {
        console.error('[CHECKOUT] Error creating checkout:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create checkout session',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ==================== CHROME EXTENSION AUTH ENDPOINT - ✅ FIXED AUTO-REGISTRATION ====================

app.post('/auth/chrome-extension', async (req, res) => {
    console.log('🔍 Chrome Extension OAuth request received');
    console.log('📊 Request headers:', req.headers);
    console.log('📊 Request body (sanitized):', {
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
            console.log('🎯 AUTO-REGISTRATION: LinkedIn URL detected, will auto-register user');
            console.log('🔗 LinkedIn URL:', linkedinUrl);
        } else {
            console.log('🔍 REGULAR AUTH: No LinkedIn URL, will return redirect instruction');
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
        console.log('[CHECK] Verifying Google token...');
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
        console.log('[SUCCESS] Google user verified:', {
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
                console.log('🎯 AUTO-REGISTRATION: Creating new user with LinkedIn URL');
                console.log('🔗 AUTO-REGISTRATION: LinkedIn URL:', linkedinUrl);
                
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
                
                console.log('✅ AUTO-REGISTRATION: User auto-registered successfully');
                console.log('🎯 AUTO-REGISTRATION: registration_completed set to:', user.registration_completed);
                
            } else {
                // ✅ FIXED: No LinkedIn URL - return SUCCESS with redirect instruction
                console.log('🔍 REGULAR AUTH: No LinkedIn URL, returning redirect instruction');
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
            console.log('[LINK] Linking Google account to existing user...');
            await linkGoogleAccount(user.id, googleUser.id);
            user = await getUserById(user.id);
            console.log('✅ Google account linked successfully');
        } else {
            console.log('✅ Existing user with Google account found');
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log('[SUCCESS] Chrome extension authentication successful');
        console.log(`👤 User ID: ${user.id}`);
        console.log(`🆔 Extension ID: ${extensionId}`);
        console.log(`🆕 Is new user: ${isNewUser}`);
        console.log(`🎯 Auto-registered: ${!!linkedinUrl}`); // ✅ AUTO-REGISTRATION: Log auto-registration status
        
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
    // REQUIRED LOGGING: Route entry
    console.log('[CHECK] route=/scrape-html');
    console.log(`[CHECK] isUserProfile=${req.body.isUserProfile}`);
    
    // Enhanced: Route based on isUserProfile parameter
    if (req.body.isUserProfile === true) {
        console.log('[CHECK] selectedHandler=USER');
        console.log('[BLUE] USER handler start');
        console.log(`[CHECK] userId=${req.user.id}`);
        console.log(`[CHECK] truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleUserProfile(req, res);
    } else {
        console.log('[CHECK] selectedHandler=TARGET_DATABASE');
        console.log('[TARGET] TARGET DATABASE handler start');
        console.log(`[CHECK] userId=${req.user.id}`);
        console.log(`[CHECK] truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleTargetProfileJSON(req, res);
    }
});

// NEW: DATABASE-First TARGET PROFILE endpoint
app.post('/target-profile/analyze-json', authenticateToken, (req, res) => {
    console.log('[TARGET] route=/target-profile/analyze-json');
    console.log('[TARGET] DATABASE-FIRST TARGET PROFILE ANALYSIS handler start');
    console.log(`[CHECK] userId=${req.user.id}`);
    console.log(`[CHECK] truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
    
    return handleTargetProfileJSON(req, res);
});

// ENHANCED: Message Generation Endpoints with GPT-5 integration
app.post('/generate-message', authenticateToken, handleGenerateMessage);
app.post('/generate-connection', authenticateToken, handleGenerateConnection);

// NEW: User Plan Endpoint - Returns real plan data (NO MORE MOCK DATA!)
app.get('/user/plan', authenticateToken, async (req, res) => {
    try {
        console.log(`[CREDIT] Getting real plan data for user ${req.user.id}`);
        
        const planResult = await getUserPlan(req.user.id);
        
        if (!planResult.success) {
            return res.status(500).json({
                success: false,
                error: planResult.error
            });
        }

        console.log(`[SUCCESS] Real plan data retrieved: ${planResult.data.planName}, Total: ${planResult.data.totalCredits}`);

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
            
            console.log(`[CHECK] OAuth callback - User: ${req.user.email}`);
            console.log(`   - Is new user: ${req.user.isNewUser || false}`);
            console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
            console.log(`   - Registration completed: ${req.user.registration_completed || false}`);
            console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
            console.log(`   - Needs onboarding: ${needsOnboarding}`);
            
            if (needsOnboarding) {
                console.log(`[ARROW] Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
                console.log(`[ARROW] Redirecting to dashboard`);
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

// ENHANCED TRAFFIC LIGHT STATUS ENDPOINT - USER PROFILE ONLY
app.get('/traffic-light-status', authenticateDual, async (req, res) => {
    try {
        console.log(`[LIGHT] Traffic light status request from user ${req.user.id} using ${req.authMethod} auth`);

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
            statusMessage = 'Profile fully synced and ready! Enhanced DATABASE-FIRST TARGET + USER PROFILE mode active with dual credit system + GPT-5 integration + Chargebee payments.';
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

        console.log(`[LIGHT] User ${req.user.id} Traffic Light Status: ${trafficLightStatus}`);
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
                    mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS_AUTO_REG_URL_FIX_GPT5_CHARGEBEE'
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

// ENHANCED: Get User Profile with dual credit info
app.get('/profile', authenticateDual, async (req, res) => {
    try {
        console.log(`[CHECK] Profile request from user ${req.user.id} using ${req.authMethod} auth`);

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
                    'Profile complete and ready - DATABASE-FIRST TARGET + USER PROFILE mode with dual credits + AUTO-REGISTRATION + URL FIX + GPT-5 + CHARGEBEE'
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
                mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS_AUTO_REG_URL_FIX_GPT5_CHARGEBEE'
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

// FIXED: Check profile extraction status - USER PROFILE ONLY (UNCHANGED)
app.get('/profile-status', authenticateDual, async (req, res) => {
    try {
        console.log(`[CHECK] Profile status request from user ${req.user.id} using ${req.authMethod} auth`);

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
            processing_mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS_AUTO_REG_URL_FIX_GPT5_CHARGEBEE',
            message: getStatusMessage(status.extraction_status, status.initial_scraping_done)
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// ==================== COMPLETE REGISTRATION ENDPOINT (MINIMAL CHANGE #3 - Added welcome email) ====================

app.post('/complete-registration', authenticateToken, async (req, res) => {
    try {
        console.log(`[REG] Complete registration request from user ${req.user.id}`);
        console.log('[CHECK] Request body:', Object.keys(req.body));
        
        const { linkedinUrl, packageType, termsAccepted } = req.body;
        
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
        
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        // Update user registration
        await pool.query(`
            UPDATE users 
            SET 
                linkedin_url = $1,
                package_type = $2,
                terms_accepted = $3,
                registration_completed = true,
                extraction_status = 'pending',
                updated_at = NOW()
            WHERE id = $4
        `, [cleanUrl, packageType, termsAccepted, req.user.id]);
        
        console.log(`[SUCCESS] Registration completed for user ${req.user.id}`);
        console.log(`  - LinkedIn URL: ${cleanUrl}`);
        console.log(`  - Package: ${packageType}`);
        console.log(`  - Registration completed: true`);
        
        // NEW: Send welcome email for free users (NON-BLOCKING)
        if (packageType === 'free') {
            try {
                console.log(`[MAILER] Sending welcome email for free user: ${req.user.email}`);
                
                const emailResult = await sendWelcomeEmail({
                    toEmail: req.user.email,
                    toName: req.user.display_name,
                    userId: req.user.id
                });
                
                if (emailResult.ok) {
                    // Mark as sent
                    await pool.query(
                        'UPDATE users SET welcome_email_sent = true WHERE id = $1',
                        [req.user.id]
                    );
                    
                    console.log(`[MAILER] Welcome email sent successfully: ${emailResult.messageId}`);
                } else {
                    console.error(`[MAILER] Welcome email failed: ${emailResult.error}`);
                }
            } catch (emailError) {
                console.error('[MAILER] Non-blocking email error:', emailError);
                // Don't fail the registration - email is not critical
            }
        }
        
        res.json({
            success: true,
            message: 'Registration completed successfully',
            data: {
                userId: req.user.id,
                email: req.user.email,
                linkedinUrl: cleanUrl,
                packageType: packageType,
                registrationCompleted: true,
                nextStep: 'Visit your LinkedIn profile with the Chrome extension to sync your data'
            }
        });
        
    } catch (error) {
        console.error('[ERROR] Complete registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration completion failed',
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
        console.log('[TEST] Testing Chargebee connection...');
        
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
        console.error('[TEST] Chargebee test error:', error);
        res.status(500).json({
            success: false,
            message: 'Test failed',
            error: error.message
        });
    }
});

// NEW: Cleanup expired holds (run periodically)
setInterval(async () => {
    try {
        await cleanupExpiredHolds();
    } catch (error) {
        console.error('[ERROR] Error during scheduled cleanup:', error);
    }
}, 30 * 60 * 1000); // Run every 30 minutes

// NEW: Cleanup expired processing entries (run periodically)
setInterval(() => {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5 minutes
    
    for (const [key, timestamp] of activeProcessing.entries()) {
        if (now - timestamp > expireTime) {
            activeProcessing.delete(key);
            console.log(`[RACE] Cleaned up stale processing entry: ${key}`);
        }
    }
}, 60 * 1000); // Run every minute

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
        message: 'DATABASE-FIRST TARGET + USER PROFILE mode active with Dual Credit System + AUTO-REGISTRATION + RACE CONDITION PROTECTION + URL FIX + GPT-5 INTEGRATION + CHARGEBEE PAYMENTS + MAILERSEND WELCOME EMAILS',
        availableRoutes: [
            'GET /',
            'GET /sign-up',
            'GET /login', 
            'GET /dashboard',
            'GET /upgrade (NEW: Upgrade page for existing users)',
            'GET /health',
            'POST /register',
            'POST /login',
            'GET /auth/google',
            'GET /auth/google/callback',
            'POST /auth/chrome-extension (✅ AUTO-REGISTRATION enabled)',
            'POST /complete-registration (✅ WELCOME EMAIL for free users)',
            'POST /update-profile',
            'GET /profile',
            'GET /profile-status',
            'GET /traffic-light-status',
            'POST /scrape-html (Enhanced routing: USER + TARGET)',
            'POST /target-profile/analyze-json (NEW: DATABASE-first system with RACE PROTECTION + URL FIX)',
            'POST /generate-message (NEW: GPT-5 integration with 1 credit dual system)',
            'POST /generate-connection (NEW: 1 credit with dual system)',
            'GET /user/setup-status',
            'GET /user/initial-scraping-status',
            'GET /user/stats',
            'PUT /user/settings',
            'GET /packages',
            'GET /user/plan (NEW: Real plan data - NO MOCK!)',
            'GET /credits/balance (NEW: Dual credit management)',
            'GET /credits/history (NEW: Transaction history)',
            'GET /test-chargebee (NEW: Test Chargebee connection)',
            'POST /chargebee-webhook (NEW: Handle Chargebee payment notifications + WELCOME EMAIL for paid users)',
            'POST /create-checkout (NEW: Create Silver plan checkout sessions)'
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
        
        // NEW: Auto-create welcome_email_sent column if it doesn't exist
        try {
            console.log('[DB] Checking welcome_email_sent column...');
            const columnCheck = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name = 'welcome_email_sent'
            `);

            if (columnCheck.rows.length === 0) {
                console.log('[DB] Creating welcome_email_sent column...');
                await pool.query(`
                    ALTER TABLE users 
                    ADD COLUMN welcome_email_sent BOOLEAN DEFAULT FALSE
                `);
                console.log('[DB] ✅ welcome_email_sent column created successfully');
            } else {
                console.log('[DB] ✅ welcome_email_sent column already exists');
            }
        } catch (columnError) {
            console.error('[DB] Warning: Could not create welcome_email_sent column:', columnError.message);
            console.error('[DB] MailerSend will use in-memory guard instead');
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('[ROCKET] Enhanced Msgly.AI Server - DUAL CREDIT SYSTEM + AUTO-REGISTRATION + RACE CONDITION FIX + URL MATCHING FIX + GPT-5 MESSAGE GENERATION + CHARGEBEE INTEGRATION + MAILERSEND WELCOME EMAILS ACTIVE!');
            console.log(`[CHECK] Port: ${PORT}`);
            console.log(`[DB] Database: Enhanced PostgreSQL with TOKEN TRACKING + DUAL CREDIT SYSTEM + MESSAGE LOGGING`);
            console.log(`[FILE] Target Storage: DATABASE (target_profiles table)`);
            console.log(`[CHECK] Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`[LIGHT] TRAFFIC LIGHT SYSTEM ACTIVE`);
            console.log(`[SUCCESS] ✅ AUTO-REGISTRATION ENABLED: Extension users can auto-register with LinkedIn URL`);
            console.log(`[SUCCESS] ✅ RACE CONDITION FIX: In-memory tracking prevents duplicate processing`);
            console.log(`[SUCCESS] ✅ URL MATCHING FIX: Profile deduplication handles both URL formats`);
            console.log(`[SUCCESS] ✅ GPT-5 INTEGRATION: Real LinkedIn message generation with comprehensive logging`);
            console.log(`[SUCCESS] ✅ CHARGEBEE INTEGRATION: Payment processing and subscription management`);
            console.log(`[SUCCESS] ✅ MAILERSEND INTEGRATION: Welcome email automation for free and paid users`);
            console.log(`[WEBHOOK] ✅ CHARGEBEE WEBHOOK: https://api.msgly.ai/chargebee-webhook`);
            console.log(`[CHECKOUT] ✅ CHECKOUT CREATION: https://api.msgly.ai/create-checkout`);
            console.log(`[UPGRADE] ✅ UPGRADE PAGE: https://api.msgly.ai/upgrade`);
            console.log(`[EMAIL] ✅ WELCOME EMAILS: Automated for all new users`);
            console.log(`[SUCCESS] DATABASE-FIRST TARGET + USER PROFILE MODE WITH DUAL CREDITS + AUTO-REGISTRATION + RACE PROTECTION + URL FIX + GPT-5 + CHARGEBEE + MAILERSEND:`);
            console.log(`   [BLUE] USER PROFILE: Automatic analysis on own LinkedIn profile (user_profiles table)`);
            console.log(`   [TARGET] TARGET PROFILE: Manual analysis via "Analyze" button click (target_profiles table)`);
            console.log(`   [BOOM] SMART DEDUPLICATION: Already analyzed profiles show marketing message`);
            console.log(`   [RACE] BULLETPROOF PROTECTION: No duplicate AI processing or credit charges`);
            console.log(`   [URL] URL MATCHING FIX: Handles both clean and protocol URLs in database`);
            console.log(`   [GPT] GPT-5 MESSAGE GENERATION: Real AI-powered LinkedIn messages`);
            console.log(`   [PAYMENT] CHARGEBEE INTEGRATION: Subscription and payment processing`);
            console.log(`   [EMAIL] MAILERSEND INTEGRATION: Welcome emails for all users`);
            console.log(`   [CHECK] /scrape-html: Intelligent routing based on isUserProfile parameter`);
            console.log(`   [TARGET] /target-profile/analyze-json: DATABASE-first TARGET PROFILE endpoint with all fixes`);
            console.log(`   [MESSAGE] /generate-message: GPT-5 powered message generation with full logging`);
            console.log(`   [TEST] /test-chargebee: Test Chargebee connection and configuration`);
            console.log(`   [WEBHOOK] /chargebee-webhook: Handle payment notifications from Chargebee`);
            console.log(`   [CHECKOUT] /create-checkout: Create Silver plan checkout sessions`);
            console.log(`   [UPGRADE] /upgrade: Upgrade page for existing users`);
            console.log(`   [EMAIL] /complete-registration: Welcome email for free users`);
            console.log(`   [DB] Database: user_profiles table for USER profiles`);
            console.log(`   [FILE] Database: target_profiles table for TARGET profiles`);
            console.log(`   [LOG] Database: message_logs table for AI generation tracking`);
            console.log(`   [LIGHT] Traffic Light system tracks User profile completion only`);
            console.log(`[CREDIT] DUAL CREDIT SYSTEM:`);
            console.log(`   [CYCLE] RENEWABLE CREDITS: Reset monthly to plan amount`);
            console.log(`   [INFINITY] PAY-AS-YOU-GO CREDITS: Never expire, spent first`);
            console.log(`   [MONEY] SPENDING ORDER: Pay-as-you-go first, then renewable`);
            console.log(`   [CALENDAR] BILLING CYCLE: Only renewable credits reset`);
            console.log(`   [TARGET] Target Analysis: 0.25 credits (only for NEW profiles)`);
            console.log(`   [BOOM] Already Analyzed: FREE with marketing message`);
            console.log(`   [MESSAGE] Message Generation: 1.0 credits (GPT-5 powered)`);
            console.log(`   [CONNECT] Connection Generation: 1.0 credits`);
            console.log(`   [LOCK] Credit holds prevent double-spending`);
            console.log(`   [MONEY] Deduction AFTER successful operations`);
            console.log(`   [DATA] Complete transaction audit trail`);
            console.log(`   [LIGHTNING] Real-time credit balance updates`);
            console.log(`   [CLEAN] Automatic cleanup of expired holds`);
            console.log(`   [SUCCESS] ✅ GPT-5 MESSAGE GENERATION:`);
            console.log(`   [API] OpenAI GPT-5 integration with proper error handling`);
            console.log(`   [PROMPT] LinkedIn-specific prompt engineering for 150-char messages`);
            console.log(`   [DATABASE] User + target profile loading from database`);
            console.log(`   [LOG] Comprehensive logging: request ID, user ID, target ID, token usage`);
            console.log(`   [STORE] Full message generation data stored in message_logs table`);
            console.log(`   [TOKEN] Token usage tracking: input, output, total tokens + latency`);
            console.log(`   [META] Target metadata extraction: first name, title, company`);
            console.log(`   [ERROR] Robust error handling with user-friendly messages`);
            console.log(`   [FALLBACK] Model fallback if GPT-5 unavailable`);
            console.log(`   [SUCCESS] ✅ CHARGEBEE PAYMENT INTEGRATION:`);
            console.log(`   [CONNECTION] Chargebee service with connection testing`);
            console.log(`   [TEST] /test-chargebee endpoint for configuration validation`);
            console.log(`   [PLANS] Subscription plan management and synchronization`);
            console.log(`   [CHECKOUT] Hosted checkout integration for seamless payments`);
            console.log(`   [WEBHOOKS] Event handling for subscription lifecycle management`);
            console.log(`   [BILLING] Automatic credit allocation and renewal processing`);
            console.log(`   [SILVER] Silver Monthly plan: $13.90/month, 30 renewable credits`);
            console.log(`   [SILVER] Silver PAYG: $17.00 one-time, 30 pay-as-you-go credits`);
            console.log(`   [SUCCESS] ✅ MAILERSEND WELCOME EMAIL SYSTEM:`);
            console.log(`   [FREE] Free users: Welcome email after /complete-registration`);
            console.log(`   [PAID] Paid users: Welcome email after Chargebee payment success`);
            console.log(`   [GUARD] Database column welcome_email_sent prevents duplicates`);
            console.log(`   [SAFE] Non-blocking: Email failures don't affect signup flow`);
            console.log(`   [TEMPLATE] Beautiful HTML template with Chrome extension focus`);
            console.log(`   [RETRY] Automatic retry with jitter for 429/5xx errors`);
            console.log(`   [DUAL] MailerSend API primary + SMTP fallback`);
            console.log(`[SUCCESS] PRODUCTION-READY DATABASE-FIRST DUAL CREDIT SYSTEM WITH GPT-5 INTEGRATION, CHARGEBEE PAYMENTS, AND MAILERSEND WELCOME EMAILS!`);
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
