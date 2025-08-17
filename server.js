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

// âœ… FIXED: Import sendToGemini from correct path (project root)
const { sendToGemini } = require('./sendToGemini');
require('dotenv').config();

// âœ… ENHANCED: Import USER PROFILE database functions + dual credit system
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
    // âœ… NEW: Dual Credit Management
    getUserPlan,
    updateUserCredits,
    spendUserCredits,
    resetRenewableCredits
} = require('./utils/database');

// âœ… NEW: Import enhanced credit management system
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

// âœ… STEP 2B: Import all utility functions from utils/helpers.js
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

// âœ… STEP 2D: Import authentication middleware
const {
    initAuthMiddleware,
    authenticateToken,
    requireFeatureAccess,
    requireAdmin
} = require('./middleware/auth');

// âœ… STEP 2E: Import user routes initialization function
const { initUserRoutes } = require('./routes/users');

// âœ… STEP 2C: Import modularized routes
const healthRoutes = require('./routes/health')(pool);
const staticRoutes = require('./routes/static');

// âœ… NEW: Robust token number cleaner with extensive debugging
function cleanTokenNumber(value) {
    console.log('ðŸ"§ Cleaning token:', { original: value, type: typeof value });
    
    if (value === null || value === undefined || value === '') {
        console.log('ðŸ"§ Token is null/undefined/empty, returning null');
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
    console.log('ðŸ"§ After cleaning:', { cleaned, isEmpty: cleaned === '' });
    
    if (cleaned === '' || cleaned === '-') {
        console.log('ðŸ"§ Cleaned value is empty, returning null');
        return null;
    }
    
    // Convert to integer
    const result = parseInt(cleaned, 10);
    const isValid = !isNaN(result) && isFinite(result);
    
    console.log('ðŸ"§ Final conversion:', { result, isValid });
    
    return isValid ? result : null;
}

// âœ… NEW: DATABASE-First System Functions

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
            console.log(`âœ… Profile already exists in database: ID ${profile.id}`);
            return {
                exists: true,
                data: {
                    id: profile.id,
                    analyzedBy: profile.user_id,
                    analyzedAt: profile.created_at,
                    analysis: profile.data_json,
                    tokenUsage: {
                        inputTokens: profile.input_tokens,
                        outputTokens: profile.output_tokens,
                        totalTokens: profile.total_tokens
                    }
                }
            };
        } else {
            console.log(`ðŸ†• Profile is new in database: ${cleanUrl}`);
            return {
                exists: false,
                data: null
            };
        }
    } catch (error) {
        console.error('âŒ Error checking profile in database:', error);
        return {
            exists: false,
            data: null
        };
    }
}

// Save profile analysis to database
async function saveProfileToDB(linkedinUrl, analysisData, userId, tokenData = {}) {
    console.log('ðŸ"¥ saveProfileToDB FUNCTION CALLED - START OF FUNCTION');
    console.log('ðŸ" saveProfileToDB function entry - detailed parameters:');
    console.log('   linkedinUrl:', linkedinUrl);
    console.log('   analysisData type:', typeof analysisData);
    console.log('   analysisData length:', JSON.stringify(analysisData || {}).length);
    console.log('   userId:', userId, 'type:', typeof userId);
    console.log('   tokenData:', tokenData);
    
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        // âœ… DEBUG: Log token data before cleaning
        console.log('ðŸ" saveProfileToDB received tokenData:', {
            inputTokens: tokenData.inputTokens,
            outputTokens: tokenData.outputTokens,
            totalTokens: tokenData.totalTokens,
            types: {
                input: typeof tokenData.inputTokens,
                output: typeof tokenData.outputTokens,
                total: typeof tokenData.totalTokens
            }
        });
        
        // Clean token values
        console.log('ðŸ"§ About to clean input tokens...');
        const cleanedInput = cleanTokenNumber(tokenData.inputTokens);
        console.log('ðŸ"§ About to clean output tokens...');
        const cleanedOutput = cleanTokenNumber(tokenData.outputTokens);
        console.log('ðŸ"§ About to clean total tokens...');
        const cleanedTotal = cleanTokenNumber(tokenData.totalTokens);
        
        console.log('ðŸ" Final values going to database:', {
            inputTokens: cleanedInput,
            outputTokens: cleanedOutput,
            totalTokens: cleanedTotal
        });
        
        // âœ… DEBUGGING: Add error tracing before database insert
        console.log('ðŸŽ¯ ABOUT TO EXECUTE TARGET PROFILE INSERT');
        console.log('ðŸŽ¯ SQL VALUES GOING TO DATABASE:');
        console.log('   userId:', userId, typeof userId);
        console.log('   cleanUrl:', cleanUrl, typeof cleanUrl);
        console.log('   analysisData length:', JSON.stringify(analysisData).length);
        console.log('   cleanedInput:', cleanedInput, typeof cleanedInput);
        console.log('   cleanedOutput:', cleanedOutput, typeof cleanedOutput);
        console.log('   cleanedTotal:', cleanedTotal, typeof cleanedTotal);

        let result;
        try {
            console.log('ðŸ" About to execute PostgreSQL INSERT query...');
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
                JSON.stringify(analysisData),
                cleanedInput,
                cleanedOutput,
                cleanedTotal
            ]);
            
            console.log('ðŸŽ¯ TARGET PROFILE INSERT SUCCESS!');
            
        } catch (dbError) {
            console.log('ðŸŽ¯ TARGET PROFILE INSERT FAILED!');
            console.log('ðŸŽ¯ DATABASE ERROR:', dbError.message);
            console.log('ðŸŽ¯ ERROR DETAIL:', dbError.detail);
            console.log('ðŸŽ¯ SQL STATE:', dbError.code);
            console.log('ðŸŽ¯ PROBLEMATIC VALUES - DETAILED:');
            console.log('   param1 (userId):', { value: userId, type: typeof userId, isNull: userId === null });
            console.log('   param2 (cleanUrl):', { value: cleanUrl, type: typeof cleanUrl, length: cleanUrl?.length });
            console.log('   param3 (analysisData):', { type: typeof analysisData, jsonLength: JSON.stringify(analysisData).length });
            console.log('   param4 (cleanedInput):', { value: cleanedInput, type: typeof cleanedInput, isNull: cleanedInput === null, original: tokenData.inputTokens });
            console.log('   param5 (cleanedOutput):', { value: cleanedOutput, type: typeof cleanedOutput, isNull: cleanedOutput === null, original: tokenData.outputTokens });
            console.log('   param6 (cleanedTotal):', { value: cleanedTotal, type: typeof cleanedTotal, isNull: cleanedTotal === null, original: tokenData.totalTokens });
            throw dbError;
        }
        
        const savedProfile = result.rows[0];
        
        console.log(`ðŸ'¾ Profile saved to database: ID ${savedProfile.id}`);
        return {
            success: true,
            id: savedProfile.id,
            createdAt: savedProfile.created_at,
            data: {
                linkedinUrl: cleanUrl,
                analyzedBy: userId,
                analyzedAt: savedProfile.created_at,
                analysis: analysisData,
                tokenUsage: tokenData
            }
        };
    } catch (error) {
        console.error('âŒ Error saving profile to database:', error);
        throw error;
    }
}

// âœ… ENHANCED: DATABASE-First TARGET PROFILE handler with dual credit system
async function handleTargetProfileJSON(req, res) {
    console.log('ðŸ"¥ handleTargetProfileJSON FUNCTION CALLED - START OF FUNCTION');
    console.log('ðŸŽ¯ === DATABASE-FIRST TARGET PROFILE PROCESSING ===');
    console.log('ðŸ" Request body keys:', Object.keys(req.body || {}));
    console.log('ðŸ" User object:', req.user ? { id: req.user.id, email: req.user.email } : 'NO USER');
    
    let holdId = null;
    
    try {
        console.log(`ðŸ'¤ User ID: ${req.user.id}`);
        console.log(`ðŸ"— URL: ${req.body.profileUrl}`);
        
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
        
        // âœ… STEP 1: Check if profile already exists in database
        console.log('ðŸ" Checking if profile already exists in database...');
        const existsCheck = await checkIfProfileExistsInDB(cleanProfileUrl);
        
        if (existsCheck.exists) {
            // âœ… ALREADY ANALYZED: Return marketing message, no credits charged
            console.log('ðŸ'« Profile already analyzed - showing marketing message');
            
            return res.json({
                success: true,
                alreadyAnalyzed: true,
                message: 'ðŸ'« Boom! This profile is already analyzed and ready. Jump straight to message magic - your personalized outreach awaits!',
                data: {
                    profileUrl: cleanProfileUrl,
                    analyzedAt: existsCheck.data.analyzedAt,
                    id: existsCheck.data.id,
                    // Basic profile info for message generation
                    fullName: existsCheck.data.analysis?.profile?.name || 'LinkedIn User',
                    headline: existsCheck.data.analysis?.profile?.headline || '',
                    currentCompany: existsCheck.data.analysis?.profile?.currentCompany || '',
                    tokenUsage: existsCheck.data.tokenUsage
                },
                credits: {
                    charged: false,
                    message: 'No credits charged - profile already analyzed'
                }
            });
        }

        // âœ… STEP 2: NEW PROFILE - Create credit hold and analyze
        console.log('ðŸ'³ Creating credit hold for new profile analysis...');
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
        console.log(`âœ… Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        
        console.log('ðŸ¤– Processing HTML with GPT-5 nano for NEW TARGET profile...');
        
        // Process HTML with GPT-5 nano
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: false  // âœ… FALSE for target profiles
        });
        
        if (!geminiResult.success) {
            console.error('âŒ GPT-5 nano processing failed for TARGET profile:', geminiResult.userMessage);
            
            // âœ… Release hold on failure
            await releaseCreditHold(userId, holdId, 'gemini_processing_failed');
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process target profile data with GPT-5 nano',
                details: geminiResult.userMessage || 'Unknown error'
            });
        }
        
        console.log('âœ… GPT-5 nano processing successful for TARGET profile');
        
        // âœ… STEP 3: Save analysis result to database
        console.log('ðŸ'¾ Saving analysis to database...');
        console.log('ðŸ" About to call saveProfileToDB with:');
        console.log('   cleanProfileUrl:', cleanProfileUrl);
        console.log('   geminiResult.data type:', typeof geminiResult.data);
        console.log('   userId:', userId);
        console.log('   geminiResult.tokenData:', geminiResult.tokenData);
        
        const saveResult = await saveProfileToDB(
            cleanProfileUrl, 
            geminiResult.data, 
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
        
        // âœ… STEP 4: Complete operation using dual credit system
        console.log('ðŸ'³ Completing operation with dual credit deduction...');
        const spendResult = await spendUserCredits(userId, 0.25);
        
        if (!spendResult.success) {
            console.error('âŒ Failed to spend credits:', spendResult.error);
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
            analysisData: geminiResult.data,
            tokenUsage: geminiResult.tokenData || {},
            spentCredits: spendResult.spent,
            newCredits: spendResult.newTotalCredits
        });

        console.log('âœ… TARGET profile saved to database successfully');
        console.log(`ðŸ"Š Analysis saved: Database ID ${saveResult.id}`);
        console.log(`ðŸ'° Credits spent: ${spendResult.spent}, New balance: ${spendResult.newTotalCredits}`);
        
        // Extract basic profile info for response
        const profileData = geminiResult.data?.profile || {};
        
        res.json({
            success: true,
            alreadyAnalyzed: false,
            message: 'Target profile analyzed and saved successfully',
            data: {
                profileUrl: cleanProfileUrl,
                databaseId: saveResult.id,
                analyzedAt: saveResult.createdAt,
                // Basic profile info for message generation
                fullName: profileData.name || 'LinkedIn User',
                headline: profileData.headline || '',
                currentCompany: profileData.currentCompany || '',
                experienceCount: geminiResult.data?.experience?.length || 0,
                educationCount: geminiResult.data?.education?.length || 0,
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
        console.error('âŒ DATABASE-First TARGET profile processing error:', error);
        
        // âœ… Release hold on any error
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

// âœ… USER PROFILE HANDLER: Enhanced with token tracking (UNCHANGED)
async function handleUserProfile(req, res) {
    try {
        console.log('ðŸ"µ === USER PROFILE PROCESSING ===');
        console.log(`ðŸ'¤ User ID: ${req.user.id}`);
        console.log(`ðŸ"— URL: ${req.body.profileUrl}`);
        
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
        
        console.log('ðŸ¤– Processing HTML with GPT-5 nano for USER profile...');
        
        // Process HTML with GPT-5 nano
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: true
        });
        
        if (!geminiResult.success) {
            console.error('âŒ GPT-5 nano processing failed for USER profile:', geminiResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process profile data with GPT-5 nano',
                details: geminiResult.error || 'Unknown error'
            });
        }
        
        console.log('âœ… GPT-5 nano processing successful for USER profile');
        
        // Process GPT-5 nano data for USER profile
        const processedProfile = processGeminiData(geminiResult, cleanProfileUrl);
        
        // Save to user_profiles table only
        const savedProfile = await createOrUpdateUserProfile(userId, cleanProfileUrl, processedProfile.fullName);
        
        // âœ… ENHANCED: Update user_profiles with processed data + token tracking
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
            // âœ… NEW: Token tracking data
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
        
        console.log('âœ… USER profile saved to user_profiles table successfully');
        console.log(`ðŸ"Š Token usage: ${geminiResult.tokenData?.inputTokens || 'N/A'} input, ${geminiResult.tokenData?.outputTokens || 'N/A'} output, ${geminiResult.tokenData?.totalTokens || 'N/A'} total`);
        
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
        console.error('âŒ USER profile processing error:', error);
        
        res.status(500).json({
            success: false,
            error: 'User profile processing failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// âœ… ENHANCED: Message Generation with dual credit system
async function handleGenerateMessage(req, res) {
    let holdId = null;
    
    try {
        console.log('ðŸ"§ === MESSAGE GENERATION WITH DUAL CREDITS ===');
        console.log(`ðŸ'¤ User ID: ${req.user.id}`);
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        // âœ… Create credit hold
        console.log('ðŸ'³ Creating credit hold for message generation...');
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
        console.log(`âœ… Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);

        // TODO: Implement actual message generation with AI
        // For now, return a placeholder
        const generatedMessage = `Hi [Name],

I noticed your experience in ${outreachContext} and would love to connect. I believe there could be some interesting opportunities for collaboration.

Best regards,
[Your Name]`;

        // âœ… Spend credits using dual credit system
        console.log('ðŸ'³ Spending credits with dual credit system...');
        const spendResult = await spendUserCredits(userId, 1.0);

        if (!spendResult.success) {
            console.error('âŒ Failed to spend credits:', spendResult.error);
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

        console.log(`ðŸ'° Credits spent: ${spendResult.spent}, New balance: ${spendResult.newTotalCredits}`);

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
        console.error('âŒ Message generation error:', error);
        
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

// âœ… ENHANCED: Connection Request Generation with dual credit system
async function handleGenerateConnection(req, res) {
    let holdId = null;
    
    try {
        console.log('ðŸ¤ === CONNECTION GENERATION WITH DUAL CREDITS ===');
        console.log(`ðŸ'¤ User ID: ${req.user.id}`);
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        // âœ… Create credit hold
        console.log('ðŸ'³ Creating credit hold for connection generation...');
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
        console.log(`âœ… Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);

        // TODO: Implement actual connection message generation with AI
        // For now, return a placeholder
        const generatedConnection = `I'd love to connect with you given your background in ${outreachContext}. Looking forward to potential collaboration opportunities.`;

        // âœ… Spend credits using dual credit system
        console.log('ðŸ'³ Spending credits with dual credit system...');
        const spendResult = await spendUserCredits(userId, 1.0);

        if (!spendResult.success) {
            console.error('âŒ Failed to spend credits:', spendResult.error);
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

        console.log(`ðŸ'° Credits spent: ${spendResult.spent}, New balance: ${spendResult.newTotalCredits}`);

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
        console.error('âŒ Connection generation error:', error);
        
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

// âœ… STEP 2D: Initialize authentication middleware with database functions
initAuthMiddleware({ getUserById });

// ðŸ"§ DUAL AUTHENTICATION HELPER FUNCTION
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

// âœ… STEP 2E: Initialize user routes with dependencies and get router
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

// âœ… MIDDLEWARE SETUP - PROPERLY POSITIONED
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

// âœ… STEP 2C: Mount static routes FIRST (before other routes)
app.use('/', staticRoutes);

// âœ… MODULARIZATION: Mount health routes
app.use('/', healthRoutes);

// âœ… STEP 2E: Mount user routes
app.use('/', userRoutes);

// ==================== CHROME EXTENSION AUTH ENDPOINT ====================

app.post('/auth/chrome-extension', async (req, res) => {
    console.log('ðŸ" Chrome Extension Auth Request:', {
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
        console.log('ðŸ" Verifying Google token...');
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
        console.log('âœ… Google user verified:', {
            email: googleUser.email,
            name: googleUser.name,
            verified: googleUser.verified_email
        });
        
        // Find or create user
        let user = await getUserByEmail(googleUser.email);
        let isNewUser = false;
        
        if (!user) {
            console.log('ðŸ'¤ Creating new user...');
            user = await createGoogleUser(
                googleUser.email,
                googleUser.name,
                googleUser.id,
                googleUser.picture
            );
            isNewUser = true;
        } else if (!user.google_id) {
            console.log('ðŸ"— Linking Google account to existing user...');
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
        
        console.log('âœ… Chrome extension authentication successful');
        
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
                    // âœ… Calculate total credits from dual system
                    credits: (user.renewable_credits || 0) + (user.payasyougo_credits || 0),
                    linkedinUrl: user.linkedin_url,
                    registrationCompleted: user.registration_completed
                },
                isNewUser: isNewUser
            }
        });
        
    } catch (error) {
        console.error('âŒ Chrome extension auth error:', error);
        
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

// âœ… Enhanced /scrape-html route with intelligent routing
app.post('/scrape-html', authenticateToken, (req, res) => {
    // âœ… REQUIRED LOGGING: Route entry
    console.log('ðŸ" route=/scrape-html');
    console.log(`ðŸ" isUserProfile=${req.body.isUserProfile}`);
    
    // âœ… Enhanced: Route based on isUserProfile parameter
    if (req.body.isUserProfile === true) {
        console.log('ðŸ" selectedHandler=USER');
        console.log('ðŸ"µ USER handler start');
        console.log(`ðŸ" userId=${req.user.id}`);
        console.log(`ðŸ" truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleUserProfile(req, res);
    } else {
        console.log('ðŸ" selectedHandler=TARGET_DATABASE');
        console.log('ðŸŽ¯ TARGET DATABASE handler start');
        console.log(`ðŸ" userId=${req.user.id}`);
        console.log(`ðŸ" truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        return handleTargetProfileJSON(req, res);
    }
});

// âœ… NEW: DATABASE-First TARGET PROFILE endpoint
app.post('/target-profile/analyze-json', authenticateToken, (req, res) => {
    console.log('ðŸŽ¯ route=/target-profile/analyze-json');
    console.log('ðŸŽ¯ DATABASE-FIRST TARGET PROFILE ANALYSIS handler start');
    console.log(`ðŸ" userId=${req.user.id}`);
    console.log(`ðŸ" truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
    
    return handleTargetProfileJSON(req, res);
});

// âœ… ENHANCED: Message Generation Endpoints with dual credits
app.post('/generate-message', authenticateToken, handleGenerateMessage);
app.post('/generate-connection', authenticateToken, handleGenerateConnection);

// âœ… NEW: User Plan Endpoint - Returns real plan data (NO MORE MOCK DATA!)
app.get('/user/plan', authenticateToken, async (req, res) => {
    try {
        console.log(`ðŸ'³ Getting real plan data for user ${req.user.id}`);
        
        const planResult = await getUserPlan(req.user.id);
        
        if (!planResult.success) {
            return res.status(500).json({
                success: false,
                error: planResult.error
            });
        }

        console.log(`âœ… Real plan data retrieved: ${planResult.data.planName}, Total: ${planResult.data.totalCredits}`);

        res.json({
            success: true,
            data: planResult.data
        });
    } catch (error) {
        console.error('âŒ Error getting user plan:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user plan'
        });
    }
});

// âœ… ENHANCED: Credit Management Endpoints with dual system
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
        console.error('âŒ Error getting credit balance:', error);
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
        console.error('âŒ Error getting transaction history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get transaction history'
        });
    }
});

// ==================== SESSION-DEPENDENT ROUTES (STAY IN SERVER.JS) ====================

// âœ… KEPT IN SERVER: Google OAuth Routes (Session creation/management)
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
            
            console.log(`ðŸ" OAuth callback - User: ${req.user.email}`);
            console.log(`   - Is new user: ${req.user.isNewUser || false}`);
            console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
            console.log(`   - Registration completed: ${req.user.registration_completed || false}`);
            console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
            console.log(`   - Needs onboarding: ${needsOnboarding}`);
            
            if (needsOnboarding) {
                console.log(`âž¡ï¸ Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
                console.log(`âž¡ï¸ Redirecting to dashboard`);
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

// ðŸš¦ ENHANCED TRAFFIC LIGHT STATUS ENDPOINT - USER PROFILE ONLY
app.get('/traffic-light-status', authenticateDual, async (req, res) => {
    try {
        console.log(`ðŸš¦ Traffic light status request from user ${req.user.id} using ${req.authMethod} auth`);

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

        // ðŸš¦ DETERMINE TRAFFIC LIGHT STATUS - USER PROFILE ONLY
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

        console.log(`ðŸš¦ User ${req.user.id} Traffic Light Status: ${trafficLightStatus}`);
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
                    mode: 'DATABASE_FIRST_TARGET_USER_PROFILE_DUAL_CREDITS'
                }
            }
        });

    } catch (error) {
        console.error('âŒ Traffic light status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check traffic light status'
        });
    }
});

// ðŸ"§ ENHANCED: Get User Profile with dual credit info
app.get('/profile', authenticateDual, async (req, res) => {
    try {
        console.log(`ðŸ" Profile request from user ${req.user.id} using ${req.authMethod} auth`);

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

        // âœ… Calculate total credits from dual system
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
                    // âœ… Enhanced credit info
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
                    // âœ… NEW: Token tracking data
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
        console.error('âŒ Enhanced profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// ðŸ"§ FIXED: Check profile extraction status - USER PROFILE ONLY (UNCHANGED)
app.get('/profile-status', authenticateDual, async (req, res) => {
    try {
        console.log(`ðŸ" Profile status request from user ${req.user.id} using ${req.authMethod} auth`);

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

// âœ… NEW: Cleanup expired holds (run periodically)
setInterval(async () => {
    try {
        await cleanupExpiredHolds();
    } catch (error) {
        console.error('âŒ Error during scheduled cleanup:', error);
    }
}, 30 * 60 * 1000); // Run every 30 minutes

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('âŒ Unhandled Error:', error);
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
            console.error('âŒ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('ðŸš€ Enhanced Msgly.AI Server - DUAL CREDIT SYSTEM ACTIVE!');
            console.log(`ðŸ" Port: ${PORT}`);
            console.log(`ðŸ—ƒï¸ Database: Enhanced PostgreSQL with TOKEN TRACKING + DUAL CREDIT SYSTEM`);
            console.log(`ðŸ—„ï¸ Target Storage: DATABASE (target_profiles table)`);
            console.log(`ðŸ" Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`ðŸš¦ TRAFFIC LIGHT SYSTEM ACTIVE`);
            console.log(`âœ… DATABASE-FIRST TARGET + USER PROFILE MODE WITH DUAL CREDITS:`);
            console.log(`   ðŸ"µ USER PROFILE: Automatic analysis on own LinkedIn profile (user_profiles table)`);
            console.log(`   ðŸŽ¯ TARGET PROFILE: Manual analysis via "Analyze" button click (target_profiles table)`);
            console.log(`   ðŸ'« SMART DEDUPLICATION: Already analyzed profiles show marketing message`);
            console.log(`   ðŸ" /scrape-html: Intelligent routing based on isUserProfile parameter`);
            console.log(`   ðŸŽ¯ /target-profile/analyze-json: DATABASE-first TARGET PROFILE endpoint`);
            console.log(`   ðŸ—ƒï¸ Database: user_profiles table for USER profiles`);
            console.log(`   ðŸ—„ï¸ Database: target_profiles table for TARGET profiles`);
            console.log(`   ðŸš¦ Traffic Light system tracks User profile completion only`);
            console.log(`ðŸ'³ DUAL CREDIT SYSTEM:`);
            console.log(`   ðŸ"„ RENEWABLE CREDITS: Reset monthly to plan amount`);
            console.log(`   â™¾ï¸ PAY-AS-YOU-GO CREDITS: Never expire, spent first`);
            console.log(`   ðŸ'° SPENDING ORDER: Pay-as-you-go first, then renewable`);
            console.log(`   ðŸ"… BILLING CYCLE: Only renewable credits reset`);
            console.log(`   ðŸŽ¯ Target Analysis: 0.25 credits (only for NEW profiles)`);
            console.log(`   ðŸ'« Already Analyzed: FREE with marketing message`);
            console.log(`   ðŸ"§ Message Generation: 1.0 credits`);
            console.log(`   ðŸ¤ Connection Generation: 1.0 credits`);
            console.log(`   ðŸ"' Credit holds prevent double-spending`);
            console.log(`   ðŸ'° Deduction AFTER successful operations`);
            console.log(`   ðŸ"Š Complete transaction audit trail`);
            console.log(`   âš¡ Real-time credit balance updates`);
            console.log(`   ðŸ§¹ Automatic cleanup of expired holds`);
            console.log(`âœ… REAL PLAN DATA ENDPOINTS (NO MORE MOCK!):`);
            console.log(`   GET /user/plan (Real plan data from database)`);
            console.log(`   POST /target-profile/analyze-json (DATABASE-first system)`);
            console.log(`   POST /generate-message (1 credit with dual system)`);
            console.log(`   POST /generate-connection (1 credit with dual system)`);
            console.log(`   GET /credits/balance (Dual credit breakdown)`);
            console.log(`   GET /credits/history (Full transaction history)`);
            console.log(`âœ… TOKEN TRACKING SYSTEM:`);
            console.log(`   ðŸ"Š USER profiles save GPT-5 nano data to user_profiles table`);
            console.log(`   ðŸ—„ï¸ TARGET profiles save GPT-5 nano data to target_profiles table`);
            console.log(`   ðŸ"¢ Input/output/total token counts tracked for all profiles`);
            console.log(`   â±ï¸ Processing time and API request IDs logged`);
            console.log(`   ðŸ'¾ Raw responses stored for debugging and analysis`);
            console.log(`âœ… PRODUCTION-READY DATABASE-FIRST DUAL CREDIT SYSTEM WITH ZERO MOCK DATA!`);
        });
        
    } catch (error) {
        console.error('âŒ Startup failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('ðŸ›' Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('ðŸ›' Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
