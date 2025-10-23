// emailFinder.js - FIXED: ALL CACHE REMOVED - Always calls Snov.io
// Direct integration with Snov.io API using LinkedIn URLs
// Handles email finding with "charge only on success" policy
// Enhanced with target_profiles persistence - ONE email per profile
// SEPARATED: Verification moved to emailVerifier.js (auto-triggered)
// Version: CACHE COMPLETELY REMOVED + BETTER ERROR LOGGING

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
        
        logger.custom('EMAIL', '🚀 CACHE COMPLETELY REMOVED - Snov.io Email Finder initialized:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSuccess: this.costPerSuccess,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            persistenceMode: 'target_profiles',
            cacheMode: '❌ NO CACHE - ALWAYS calls Snov.io',
            verificationMode: 'separated_auto_trigger'
        });
    }

    // Get Snov.io access token
    async getSnovAccessToken() {
        try {
            logger.info('[EMAIL_FINDER] 🔑 Getting Snov.io access token...');
            
            if (this.snovApiKey) {
                logger.success('[EMAIL_FINDER] ✅ Using API Key authentication');
                return this.snovApiKey; // Direct API key
            }
            
            if (!this.snovClientId || !this.snovClientSecret) {
                logger.error('[EMAIL_FINDER] 🚨 FAILED: Missing Snov.io credentials (no API key, no OAuth)');
                throw new Error('Missing Snov.io credentials');
            }
            
            logger.info('[EMAIL_FINDER] Using OAuth authentication...');
            const response = await axios.post(`${this.snovBaseUrl}/v1/oauth/access_token`, {
                grant_type: 'client_credentials',
                client_id: this.snovClientId,
                client_secret: this.snovClientSecret
            });
            
            logger.success('[EMAIL_FINDER] ✅ OAuth token retrieved successfully');
            return response.data.access_token;
            
        } catch (error) {
            logger.error('[EMAIL_FINDER] 🚨 FAILED AT STEP: Getting Snov.io access token');
            logger.error('[EMAIL_FINDER] Error details:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Snov.io');
        }
    }

    // FIXED: Save ONLY email to target_profiles (no status, no timestamp)
    async saveEmailToTargetProfiles(linkedinUrl, email, userId) {
        try {
            logger.info(`[EMAIL_FINDER] Saving email to target_profiles - URL: ${linkedinUrl}, Email: ${email}`);
            
            // First, check if target_profiles record exists
            const existingProfile = await pool.query(`
                SELECT id FROM target_profiles 
                WHERE linkedin_url = $1 AND user_id = $2
            `, [linkedinUrl, userId]);

            let result;
            
            if (existingProfile.rows.length > 0) {
                // Update existing profile - ONLY email_found
                result = await pool.query(`
                    UPDATE target_profiles 
                    SET 
                        email_found = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE linkedin_url = $2 AND user_id = $3
                    RETURNING id, email_found
                `, [email, linkedinUrl, userId]);
                
                logger.success(`[EMAIL_FINDER] ✅ Updated existing target_profile (email only):`, result.rows[0]);
            } else {
                // Create new profile record - ONLY email_found
                result = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, email_found, created_at, updated_at
                    ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING id, email_found
                `, [userId, linkedinUrl, email]);
                
                logger.success(`[EMAIL_FINDER] ✅ Created new target_profile (email only):`, result.rows[0]);
            }

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

    // FIXED: Save only status/error flags (for not_found, error cases)
    async saveStatusOnly(linkedinUrl, status, userId) {
        try {
            logger.info(`[EMAIL_FINDER] Saving status flag: ${status} for ${linkedinUrl}`);
            
            const existingProfile = await pool.query(`
                SELECT id FROM target_profiles 
                WHERE linkedin_url = $1 AND user_id = $2
            `, [linkedinUrl, userId]);

            let result;
            
            if (existingProfile.rows.length > 0) {
                // Update existing profile with status flag only
                result = await pool.query(`
                    UPDATE target_profiles 
                    SET 
                        email_status = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE linkedin_url = $2 AND user_id = $3
                    RETURNING id, email_status
                `, [status, linkedinUrl, userId]);
            } else {
                // Create new profile with status flag
                result = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, email_status, created_at, updated_at
                    ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING id, email_status
                `, [userId, linkedinUrl, status]);
            }

            logger.success(`[EMAIL_FINDER] ✅ Saved status flag: ${status}`);
            return { success: true, data: result.rows[0] };

        } catch (error) {
            logger.error('[EMAIL_FINDER] Error saving status flag:', error);
            return { success: false, error: error.message };
        }
    }

    // Main LinkedIn URL email finder (NO CACHE - ALWAYS calls Snov.io)
    async findEmailWithLinkedInUrl(userId, linkedinUrl) {
        try {
            logger.custom('EMAIL', `🔍 EMAIL FINDER REQUEST - User: ${userId}, LinkedIn: ${linkedinUrl}`);
            logger.custom('EMAIL', '⚠️ NO CACHE MODE - Will call Snov.io regardless of previous searches');

            // Check if feature is enabled
            if (!this.enabled) {
                logger.warn('[EMAIL_FINDER] ❌ Feature is DISABLED in environment');
                return {
                    success: false,
                    error: 'email_finder_disabled',
                    message: 'Email finder feature is currently disabled'
                };
            }

            // Check if we have Snov.io credentials
            if (!this.hasCredentials) {
                logger.error('[EMAIL_FINDER] ❌ NO Snov.io credentials configured');
                return {
                    success: false,
                    error: 'snov_not_configured',
                    message: 'Snov.io API credentials not configured'
                };
            }

            logger.success('[EMAIL_FINDER] ✅ Feature enabled, credentials available');

            // Check user credits before processing
            logger.info('[EMAIL_FINDER] 💳 Checking user credits...');
            const creditCheck = await checkUserCredits(userId, 'email_verification');
            if (!creditCheck.success || !creditCheck.hasCredits) {
                logger.warn(`[EMAIL_FINDER] ❌ Insufficient credits: need ${this.costPerSuccess}, have ${creditCheck.currentCredits || 0}`);
                return {
                    success: false,
                    error: 'insufficient_credits',
                    message: `You need ${this.costPerSuccess} credits to verify an email. You have ${creditCheck.currentCredits || 0} credits.`,
                    currentCredits: creditCheck.currentCredits || 0,
                    requiredCredits: this.costPerSuccess
                };
            }

            logger.success(`[EMAIL_FINDER] ✅ User has ${creditCheck.currentCredits} credits (need ${this.costPerSuccess})`);

            // Create credit hold
            logger.info(`[EMAIL_FINDER] 💰 Creating credit hold for ${this.costPerSuccess} credits...`);
            const holdResult = await createCreditHold(userId, 'email_verification', {
                linkedinUrl: linkedinUrl
            });

            if (!holdResult.success) {
                logger.error('[EMAIL_FINDER] ❌ Failed to create credit hold');
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

            try {
                // 🚀 ALWAYS CALL SNOV.IO - NO CACHE CHECK
                logger.custom('EMAIL', '🚀 CALLING SNOV.IO NOW - No cache, no checks, going straight to API...');
                
                const emailResult = await this.findEmailWithSnovV1(linkedinUrl);

                if (emailResult.success && emailResult.email) {
                    logger.success(`[EMAIL_FINDER] ✅✅✅ EMAIL FOUND: ${emailResult.email}`);
                    
                    // Save ONLY email (no status)
                    const saveResult = await this.saveEmailToTargetProfiles(
                        linkedinUrl, 
                        emailResult.email, 
                        userId
                    );
                    logger.debug(`[EMAIL_FINDER] Save result:`, saveResult);

                    // Success: Complete payment and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        verificationStatus: 'pending_verification',
                        snovResponse: emailResult.snovData,
                        saved: saveResult.success
                    });

                    logger.success(`[EMAIL_FINDER] 💰 ${this.costPerSuccess} credits charged successfully`);

                    // AUTO-TRIGGER VERIFICATION (fire-and-forget, async, FREE)
                    try {
                        const { emailVerifier } = require('./emailVerifier');
                        logger.info(`[EMAIL_FINDER] 🔄 Auto-triggering verification for ${emailResult.email}`);
                        emailVerifier.verifyEmail(emailResult.email, userId, linkedinUrl)
                            .catch(err => logger.error('[EMAIL_FINDER] Auto-verify failed:', err));
                    } catch (verifierError) {
                        logger.error('[EMAIL_FINDER] Could not load emailVerifier:', verifierError);
                    }

                    return {
                        success: true,
                        email: emailResult.email,
                        status: 'pending_verification',
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found successfully - verification in progress',
                        saved: saveResult.success
                    };

                } else {
                    logger.warn('[EMAIL_FINDER] ❌ Snov.io did not find email');
                    
                    // Failed to find email: Save "not_found" status and release credit hold
                    await this.saveStatusOnly(linkedinUrl, 'not_found', userId);
                    await releaseCreditHold(userId, holdId, 'email_not_found');

                    logger.info(`[EMAIL_FINDER] 💸 No credits charged (email not found)`);

                    return {
                        success: false,
                        error: 'email_not_found',
                        status: 'not_found',
                        creditsCharged: 0,
                        message: 'No email found for this LinkedIn profile'
                    };
                }

            } catch (processingError) {
                // Processing error: Save error status and release credit hold
                logger.error('[EMAIL_FINDER] 🚨 PROCESSING ERROR:', processingError);
                logger.error('[EMAIL_FINDER] Error stack:', processingError.stack);
                
                await this.saveStatusOnly(linkedinUrl, 'error', userId);
                await releaseCreditHold(userId, holdId, 'processing_error');

                return {
                    success: false,
                    error: 'processing_error',
                    message: 'Temporary issue finding email. Please try again.',
                    creditsCharged: 0,
                    details: processingError.message
                };
            }

        } catch (error) {
            logger.error('[EMAIL_FINDER] 🚨 SYSTEM ERROR:', error);
            logger.error('[EMAIL_FINDER] Error stack:', error.stack);
            return {
                success: false,
                error: 'system_error',
                message: 'System error occurred. Please try again.',
                details: error.message
            };
        }
    }

    // Snov.io v1 API implementation with proper delay
    async findEmailWithSnovV1(linkedinUrl) {
        try {
            logger.info('[EMAIL_FINDER] 🌐 Finding email with Snov.io v1 LinkedIn URL API...');
            logger.info(`[EMAIL_FINDER] 🔗 LinkedIn URL: ${linkedinUrl}`);
            
            // Get access token
            const accessToken = await this.getSnovAccessToken();
            
            // Step 1: Add LinkedIn URL for search
            logger.info('[EMAIL_FINDER] 📤 STEP 1: Adding LinkedIn URL to Snov.io...');
            try {
                const addUrlResponse = await axios.post(`${this.snovBaseUrl}/v1/add-url-for-search`, {
                    access_token: accessToken,
                    url: linkedinUrl
                }, {
                    timeout: this.timeoutMs
                });
                
                logger.success('[EMAIL_FINDER] ✅ STEP 1 COMPLETE: URL added to Snov.io');
                logger.debug('[EMAIL_FINDER] Response:', addUrlResponse.data);
            } catch (step1Error) {
                logger.error('[EMAIL_FINDER] 🚨 FAILED AT STEP 1: Adding LinkedIn URL to Snov.io');
                logger.error('[EMAIL_FINDER] Step 1 error:', step1Error.response?.data || step1Error.message);
                throw step1Error;
            }
            
            // CRITICAL: Wait for Snov.io to process the LinkedIn URL
            logger.info('[EMAIL_FINDER] ⏳ Waiting 4 seconds for Snov.io to process LinkedIn URL...');
            await new Promise(resolve => setTimeout(resolve, 4000));
            
            // Step 2: Get emails from the URL
            logger.info('[EMAIL_FINDER] 📥 STEP 2: Retrieving emails from LinkedIn URL...');
            try {
                const emailsResponse = await axios.post(`${this.snovBaseUrl}/v1/get-emails-from-url`, {
                    access_token: accessToken,
                    url: linkedinUrl
                }, {
                    timeout: this.timeoutMs
                });
                
                logger.success('[EMAIL_FINDER] ✅ STEP 2 COMPLETE: Emails retrieved from Snov.io');
                logger.debug('[EMAIL_FINDER] Response:', emailsResponse.data);
                
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
                        logger.success(`[EMAIL_FINDER] ✅✅✅ EMAIL FOUND: ${validEmail.email}`);
                        
                        return {
                            success: true,
                            email: validEmail.email,
                            snovData: responseData
                        };
                    }
                }
                
                logger.info('[EMAIL_FINDER] ℹ️ No emails found by Snov.io v1');
                return {
                    success: false,
                    email: null,
                    snovData: responseData
                };
                
            } catch (step2Error) {
                logger.error('[EMAIL_FINDER] 🚨 FAILED AT STEP 2: Getting emails from Snov.io');
                logger.error('[EMAIL_FINDER] Step 2 error:', step2Error.response?.data || step2Error.message);
                throw step2Error;
            }
            
        } catch (error) {
            logger.error('[EMAIL_FINDER] 🚨 Snov.io v1 API error:', error.response?.data || error.message);
            
            if (error.response?.status === 401) {
                logger.error('[EMAIL_FINDER] ❌ AUTHENTICATION FAILED - Check your Snov.io API credentials');
                return {
                    success: false,
                    email: null,
                    error: 'Snov.io authentication failed'
                };
            }
            
            if (error.response?.status === 429) {
                logger.error('[EMAIL_FINDER] ❌ RATE LIMIT EXCEEDED - Too many requests to Snov.io');
                return {
                    success: false,
                    email: null,
                    error: 'Rate limit exceeded'
                };
            }
            
            return {
                success: false,
                email: null,
                error: error.message
            };
        }
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
            cacheMode: 'DISABLED - Always calls Snov.io',
            verificationMode: 'separated_auto_trigger'
        };
    }
}

// Create singleton instance
const emailFinder = new EmailFinder();

// Export main function (NO CACHE WRAPPER)
async function findEmailWithLinkedInUrl(userId, linkedinUrl) {
    return await emailFinder.findEmailWithLinkedInUrl(userId, linkedinUrl);
}

// BACKWARD COMPATIBILITY: Keep old function name
async function findEmailForProfile(userId, targetProfileId) {
    return await emailFinder.findEmail(userId, targetProfileId);
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

logger.success('✅ Snov.io Email Finder loaded - CACHE COMPLETELY REMOVED - ALWAYS calls Snov.io!');
