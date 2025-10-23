// emailFinder.js - FIXED: Per-user email visibility + charge for not_found + await verification
// Direct integration with Snov.io API using LinkedIn URLs
// Handles email finding with "charge on search" policy (found OR not_found = charged)
// Enhanced with target_profiles persistence - ONE email per profile
// SEPARATED: Verification moved to emailVerifier.js (but awaited before returning)
// NEW: email_requests table tracks which users requested email
// Version: 1.3.0 - Per-user visibility + charge for not_found + await verification

const { pool } = require('./utils/database');
const { createCreditHold, completeOperation, releaseCreditHold, checkUserCredits } = require('./credits');
const logger = require('./utils/logger');
const axios = require('axios');

class EmailFinder {
    constructor() {
        // Feature flags from environment
        this.enabled = process.env.EMAIL_FINDER_ENABLED === 'true';
        this.timeoutMs = parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 10000;
        this.costPerSuccess = parseFloat(process.env.EMAIL_FINDER_COST_PER_SUCCESS_CREDITS) || 2.0;
        
        // Snov.io API configuration
        this.snovClientId = process.env.SNOV_CLIENT_ID;
        this.snovClientSecret = process.env.SNOV_CLIENT_SECRET;
        this.snovApiKey = process.env.SNOV_API_KEY;
        this.snovBaseUrl = 'https://api.snov.io';
        
        // Check if we have credentials
        this.hasCredentials = !!(this.snovApiKey || (this.snovClientId && this.snovClientSecret));
        
        logger.custom('EMAIL', '🚀 NO CACHE MODE - Snov.io Email Finder initialized:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSuccess: this.costPerSuccess,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            persistenceMode: 'target_profiles',
            cacheMode: '❌ DISABLED - Always calls Snov.io',
            verificationMode: 'separated_auto_trigger'
        });
    }

    // Get Snov.io access token
    async getSnovAccessToken() {
        if (this.snovApiKey) {
            return this.snovApiKey; // Direct API key
        }
        
        if (!this.snovClientId || !this.snovClientSecret) {
            throw new Error('Missing Snov.io credentials');
        }
        
        try {
            const response = await axios.post(`${this.snovBaseUrl}/v1/oauth/access_token`, {
                grant_type: 'client_credentials',
                client_id: this.snovClientId,
                client_secret: this.snovClientSecret
            });
            
            return response.data.access_token;
        } catch (error) {
            logger.error('Failed to get Snov.io access token:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Snov.io');
        }
    }

    // FIXED: Save ONLY email to target_profiles (ONLY UPDATE existing records by linkedin_url)
    async saveEmailToTargetProfiles(linkedinUrl, email, userId) {
        try {
            logger.info(`[EMAIL_FINDER] Saving email to target_profiles - URL: ${linkedinUrl}, Email: ${email}`);
            
            // FIXED: Check if record exists (by linkedin_url ONLY - shared across all users)
            const existingProfile = await pool.query(`
                SELECT id FROM target_profiles 
                WHERE linkedin_url = $1
            `, [linkedinUrl]);

            if (existingProfile.rows.length === 0) {
                // Record doesn't exist - should have been created by Chrome extension
                logger.error(`[EMAIL_FINDER] ❌ No target_profile found for ${linkedinUrl}`);
                return {
                    success: false,
                    error: 'profile_not_found',
                    message: 'Target profile must be created via Chrome extension before finding email'
                };
            }
            
            // FIXED: Update existing record - ONLY by linkedin_url (updates shared record for ALL users)
            const result = await pool.query(`
                UPDATE target_profiles 
                SET 
                    email_found = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE linkedin_url = $2
                RETURNING id, email_found
            `, [email, linkedinUrl]);
            
            logger.success(`[EMAIL_FINDER] ✅ Updated target_profile (email only):`, result.rows[0]);

            return {
                success: true,
                data: result.rows[0],
                message: 'Email saved to target_profiles successfully'
            };

        } catch (error) {
            logger.error('[EMAIL_FINDER] Error saving to target_profiles:', error);
            return {
                success: false,
                error: error.message,
                message: 'Failed to save email to target_profiles'
            };
        }
    }

    // NEW: Mark user as requested (add to email_requests table)
    async markUserRequested(userId, linkedinUrl) {
        try {
            logger.info(`[EMAIL_FINDER] 📝 Marking user ${userId} as requested for ${linkedinUrl}`);
            
            // Insert or update email_requests (UPSERT)
            await pool.query(`
                INSERT INTO email_requests (user_id, linkedin_url, requested_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, linkedin_url) 
                DO UPDATE SET requested_at = CURRENT_TIMESTAMP
            `, [userId, linkedinUrl]);
            
            logger.success(`[EMAIL_FINDER] ✅ User ${userId} marked as requested`);
            return { success: true };
            
        } catch (error) {
            logger.error('[EMAIL_FINDER] Error marking user as requested:', error);
            return { success: false, error: error.message };
        }
    }

    // Main LinkedIn URL email finder (VERIFICATION REMOVED - Auto-triggered separately)
    async findEmailWithLinkedInUrl(userId, linkedinUrl) {
        try {
            logger.custom('EMAIL', `LinkedIn URL email finder: User ${userId}, URL ${linkedinUrl}`);

            // Check if feature is enabled
            if (!this.enabled) {
                return {
                    success: false,
                    error: 'email_finder_disabled',
                    message: 'Email finder feature is currently disabled'
                };
            }

            // Check if we have Snov.io credentials
            if (!this.hasCredentials) {
                return {
                    success: false,
                    error: 'snov_not_configured',
                    message: 'Snov.io API credentials not configured'
                };
            }

            // ❌ CACHE REMOVED - ALWAYS calls Snov.io
            logger.info(`[EMAIL_FINDER] ⚠️ NO CACHE - Going directly to Snov.io for every request`);

            // Check user credits before processing
            const creditCheck = await checkUserCredits(userId, 'email_verification');
            if (!creditCheck.success || !creditCheck.hasCredits) {
                return {
                    success: false,
                    error: 'insufficient_credits',
                    message: `You need ${this.costPerSuccess} credits to verify an email. You have ${creditCheck.currentCredits || 0} credits.`,
                    currentCredits: creditCheck.currentCredits || 0,
                    requiredCredits: this.costPerSuccess
                };
            }

            // Create credit hold
            logger.info(`[EMAIL_FINDER] 💳 Creating credit hold for ${this.costPerSuccess} credits`);
            const holdResult = await createCreditHold(userId, 'email_verification', {
                linkedinUrl: linkedinUrl
            });

            if (!holdResult.success) {
                return {
                    success: false,
                    error: 'credit_hold_failed',
                    message: holdResult.error === 'insufficient_credits' 
                        ? `Insufficient credits: need ${this.costPerSuccess}, have ${holdResult.currentCredits}`
                        : 'Failed to reserve credits for this operation'
                };
            }

            const holdId = holdResult.holdId;
            logger.success(`[EMAIL_FINDER] ✅ Credit hold created: ${holdId}`);
            
            console.log('═══════════════════════════════════════════════════════');
            console.log('🔍 DEBUG CHECKPOINT 1: After credit hold creation');
            console.log('Hold ID:', holdId);
            console.log('LinkedIn URL:', linkedinUrl);
            console.log('User ID:', userId);
            console.log('About to enter try block...');
            console.log('═══════════════════════════════════════════════════════');

            try {
                console.log('🔍 DEBUG CHECKPOINT 2: Inside try block - BEFORE Snov.io call');
                
                // Find email using Snov.io v1 API with delay
                logger.custom('EMAIL', '🚀 Calling Snov.io API NOW...');
                
                console.log('🔍 DEBUG CHECKPOINT 3: About to call findEmailWithSnovV1()');
                const emailResult = await this.findEmailWithSnovV1(linkedinUrl);
                console.log('🔍 DEBUG CHECKPOINT 4: Returned from findEmailWithSnovV1()');
                console.log('Email Result:', JSON.stringify(emailResult));

                if (emailResult.success && emailResult.email) {
                    console.log('🔍 DEBUG CHECKPOINT 5: Email found! Processing save...');
                    
                    // FIXED: Save ONLY email (no status)
                    const saveResult = await this.saveEmailToTargetProfiles(
                        linkedinUrl, 
                        emailResult.email, 
                        userId
                    );
                    console.log('🔍 DEBUG CHECKPOINT 6: After saveEmailToTargetProfiles');
                    logger.debug(`[EMAIL_FINDER] Save result:`, saveResult);

                    console.log('🔍 DEBUG CHECKPOINT 7: About to complete operation (charge credits)');
                    // Success: Complete payment and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        verificationStatus: 'pending_verification',
                        snovResponse: emailResult.snovData,
                        saved: saveResult.success
                    });
                    console.log('🔍 DEBUG CHECKPOINT 8: Credits charged successfully');

                    logger.success(`[EMAIL_FINDER] ✅ Email found: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    // NEW: Mark user as requested (user paid, user can see result)
                    await this.markUserRequested(userId, linkedinUrl);

                    // FIXED: AWAIT VERIFICATION (not fire-and-forget)
                    let verificationStatus = 'unknown';
                    try {
                        const { emailVerifier } = require('./emailVerifier');
                        logger.info(`[EMAIL_FINDER] ⏳ Waiting for verification to complete...`);
                        const verifyResult = await emailVerifier.verifyEmail(emailResult.email, userId, linkedinUrl);
                        verificationStatus = verifyResult.status || 'unknown';
                        logger.success(`[EMAIL_FINDER] ✅ Verification complete: ${verificationStatus}`);
                    } catch (verifierError) {
                        logger.error('[EMAIL_FINDER] Verification failed:', verifierError);
                        verificationStatus = 'unknown';
                    }

                    return {
                        success: true,
                        email: emailResult.email,
                        status: verificationStatus,  // Return actual verification status
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found and verified',
                        saved: saveResult.success
                    };

                } else {
                    console.log('🔍 DEBUG CHECKPOINT 9: Email NOT found by Snov.io');
                    console.log('Email result:', JSON.stringify(emailResult));
                    
                    // FIXED: Not found = Charge 2 credits + mark user as requested (no status save)
                    logger.info(`[EMAIL_FINDER] ⚠️ Email not found - charging credits and marking user as requested`);
                    
                    console.log('🔍 DEBUG CHECKPOINT 10: About to charge credits for not_found');
                    // Charge credits (user paid for search even if not found)
                    const paymentResult = await completeOperation(userId, holdId, {
                        status: 'not_found',
                        message: 'Search completed - no email found'
                    });
                    console.log('🔍 DEBUG CHECKPOINT 11: Credits charged for not_found');
                    
                    // NEW: Mark user as requested (user paid, user can see "not found")
                    await this.markUserRequested(userId, linkedinUrl);

                    logger.info(`[EMAIL_FINDER] ⚠️ Email not found (${this.costPerSuccess} credits charged)`);

                    return {
                        success: true,  // Search was successful (just no email found)
                        error: 'email_not_found',
                        status: 'not_found',
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance,
                        message: 'Search completed - no email found for this LinkedIn profile'
                    };
                }

            } catch (processingError) {
                console.log('═══════════════════════════════════════════════════════');
                console.log('🚨 DEBUG: CAUGHT ERROR IN TRY BLOCK!');
                console.log('Error type:', processingError.constructor.name);
                console.log('Error message:', processingError.message);
                console.log('Error stack:', processingError.stack);
                console.log('═══════════════════════════════════════════════════════');
                
                // Processing error: Release credit hold (no status saved)
                logger.error('[EMAIL_FINDER] 🚨 Processing error:', processingError);
                logger.error('[EMAIL_FINDER] Error details:', processingError.message);
                logger.error('[EMAIL_FINDER] Stack trace:', processingError.stack);
                
                await releaseCreditHold(userId, holdId, 'processing_error');

                return {
                    success: false,
                    error: 'processing_error',
                    message: 'Temporary issue finding email. Please try again.',
                    creditsCharged: 0,
                    errorDetails: processingError.message
                };
            }

        } catch (error) {
            logger.error('[EMAIL_FINDER] System error:', error);
            return {
                success: false,
                error: 'system_error',
                message: 'System error occurred. Please try again.',
                details: error.message
            };
        }
    }

    // Snov.io v1 API implementation with proper delay - NO CATCH, let errors throw
    async findEmailWithSnovV1(linkedinUrl) {
        console.log('═══════════════════════════════════════════════════════');
        console.log('🔍 DEBUG: ENTERED findEmailWithSnovV1()');
        console.log('LinkedIn URL received:', linkedinUrl);
        console.log('═══════════════════════════════════════════════════════');
        
        logger.info('[EMAIL_FINDER] 🌐 Finding email with Snov.io v1 LinkedIn URL API...');
        logger.info(`[EMAIL_FINDER] LinkedIn URL: ${linkedinUrl}`);
        
        // Get access token (will throw if fails)
        logger.info('[EMAIL_FINDER] 📝 Step 0: Getting Snov.io access token...');
        const accessToken = await this.getSnovAccessToken();
        logger.success('[EMAIL_FINDER] ✅ Access token retrieved');
        
        // Step 1: Add LinkedIn URL for search
        logger.info('[EMAIL_FINDER] 📤 Step 1: Adding LinkedIn URL to Snov.io...');
        const addUrlResponse = await axios.post(`${this.snovBaseUrl}/v1/add-url-for-search`, {
            access_token: accessToken,
            url: linkedinUrl
        }, {
            timeout: this.timeoutMs
        });
        
        logger.success('[EMAIL_FINDER] ✅ Step 1 complete: URL added to Snov.io');
        logger.debug('[EMAIL_FINDER] Response:', addUrlResponse.data);
        
        // CRITICAL: Wait for Snov.io to process the LinkedIn URL
        logger.info('[EMAIL_FINDER] ⏳ Waiting 4 seconds for Snov.io to process...');
        await new Promise(resolve => setTimeout(resolve, 4000)); // 4 second delay
        
        // Step 2: Get emails from the URL
        logger.info('[EMAIL_FINDER] 📥 Step 2: Retrieving emails from Snov.io...');
        const emailsResponse = await axios.post(`${this.snovBaseUrl}/v1/get-emails-from-url`, {
            access_token: accessToken,
            url: linkedinUrl
        }, {
            timeout: this.timeoutMs
        });
        
        logger.success('[EMAIL_FINDER] ✅ Step 2 complete: Response received from Snov.io');
        logger.debug('[EMAIL_FINDER] Snov.io response:', emailsResponse.data);
        
        const responseData = emailsResponse.data;
        
        if (!responseData.success) {
            logger.warn('[EMAIL_FINDER] ⚠️ Snov.io API returned success: false');
            return {
                success: false,
                email: null,
                snovData: responseData
            };
        }

        const emails = responseData.data?.emails || [];
        
        if (emails && emails.length > 0) {
            const validEmail = emails.find(emailObj => 
                emailObj.email && 
                emailObj.email.includes('@') &&
                emailObj.email !== ''
            );
            
            if (validEmail) {
                logger.success(`[EMAIL_FINDER] ✅✅✅ Email found by Snov.io: ${validEmail.email}`);
                
                return {
                    success: true,
                    email: validEmail.email,
                    snovData: responseData
                };
            }
        }
        
        logger.info('[EMAIL_FINDER] ℹ️ No emails found by Snov.io');
        return {
            success: false,
            email: null,
            snovData: responseData
        };
    }

    // BACKWARD COMPATIBILITY: Helper functions
    extractDomainFromCompany(company) {
        const cleanCompany = company.toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .replace(/(inc|ltd|llc|corp|corporation|company|co)$/, '');
        
        return `${cleanCompany}.com`;
    }

    async getTargetProfile(targetProfileId, userId) {
        try {
            const result = await pool.query(`
                SELECT 
                    id, user_id, linkedin_url, data_json,
                    email_found, email_status, email_verified_at
                FROM target_profiles 
                WHERE id = $1 AND user_id = $2
            `, [targetProfileId, userId]);

            if (result.rows.length === 0) {
                return {
                    success: false,
                    error: 'target_not_found',
                    message: 'Target profile not found'
                };
            }

            const profile = result.rows[0];

            return {
                success: true,
                data: {
                    id: profile.id,
                    user_id: profile.user_id,
                    linkedin_url: profile.linkedin_url,
                    profile_data: profile.data_json || {},
                    email_found: profile.email_found,
                    email_status: profile.email_status,
                    email_verified_at: profile.email_verified_at
                }
            };

        } catch (error) {
            logger.error('Error getting target profile:', error);
            return {
                success: false,
                error: 'database_error',
                message: 'Failed to retrieve target profile'
            };
        }
    }

    async updateEmailStatus(targetProfileId, email, status, verifiedAt) {
        try {
            await pool.query(`
                UPDATE target_profiles 
                SET 
                    email_found = $2,
                    email_status = $3,
                    email_verified_at = $4,
                    updated_at = NOW()
                WHERE id = $1
            `, [targetProfileId, email, status, verifiedAt]);

            logger.debug(`Updated email status: Profile ${targetProfileId} -> ${status}`);
            return { success: true };

        } catch (error) {
            logger.error('Error updating email status:', error);
            return { success: false, error: error.message };
        }
    }

    // Health check
    async healthCheck() {
        try {
            const accessToken = await this.getSnovAccessToken();
            return {
                success: true,
                message: 'Snov.io API connection successful',
                hasCredentials: this.hasCredentials,
                persistenceMode: 'target_profiles'
            };
        } catch (error) {
            return {
                success: false,
                message: 'Snov.io API connection failed',
                error: error.message,
                hasCredentials: this.hasCredentials
            };
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            costPerSuccess: this.costPerSuccess,
            mode: 'snov_v1_target_profiles',
            persistenceStrategy: 'target_profiles',
            verificationMode: 'separated_auto_trigger'
        };
    }
}

// Create singleton instance
const emailFinder = new EmailFinder();

// COMPLETE: Export all functions (including backward compatibility)
async function findEmailForProfile(userId, targetProfileId) {
    return await emailFinder.findEmail(userId, targetProfileId);
}

async function findEmailWithLinkedInUrl(userId, linkedinUrl) {
    return await emailFinder.findEmailWithLinkedInUrl(userId, linkedinUrl);
}

function getEmailFinderStatus() {
    return emailFinder.getStatus();
}

function isEmailFinderEnabled() {
    return emailFinder.enabled && emailFinder.hasCredentials;
}

module.exports = {
    EmailFinder,
    emailFinder,
    findEmailForProfile,
    findEmailWithLinkedInUrl,
    getEmailFinderStatus,
    isEmailFinderEnabled
};

logger.success('✅ Snov.io Email Finder loaded - NO CACHE MODE - Always searches Snov.io!');
