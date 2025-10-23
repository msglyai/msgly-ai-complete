// emailFinder.js - NO CACHE VERSION - ALWAYS calls Snov.io
// Direct integration with Snov.io API using LinkedIn URLs
// Database is ONLY for display - NEVER returns cached emails
// ALWAYS searches Snov.io and ALWAYS charges credits on success
// Version: 4.0.0 - FINAL - NO CACHE - Always fresh searches

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
        
        logger.custom('EMAIL_FINDER', '🚀 NO CACHE MODE - Snov.io Email Finder initialized:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSuccess: this.costPerSuccess,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            cacheMode: '❌ DISABLED - Always searches Snov.io',
            verificationMode: 'auto_trigger_after_find'
        });
    }

    // Get Snov.io access token
    async getSnovAccessToken() {
        if (this.snovApiKey) {
            return this.snovApiKey;
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
            logger.error('[EMAIL_FINDER] Failed to get Snov.io access token:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Snov.io');
        }
    }

    // Save email to target_profiles (for display only)
    async saveEmailToTargetProfiles(linkedinUrl, email, userId) {
        try {
            logger.info(`[EMAIL_FINDER] 💾 Saving email to DB (display only): ${email}`);
            
            const existingProfile = await pool.query(`
                SELECT id FROM target_profiles 
                WHERE linkedin_url = $1 AND user_id = $2
            `, [linkedinUrl, userId]);

            let result;
            
            if (existingProfile.rows.length > 0) {
                result = await pool.query(`
                    UPDATE target_profiles 
                    SET 
                        email_found = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE linkedin_url = $2 AND user_id = $3
                    RETURNING id, email_found
                `, [email, linkedinUrl, userId]);
                
                logger.success(`[EMAIL_FINDER] ✅ Updated target_profile`);
            } else {
                result = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, email_found, created_at, updated_at
                    ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING id, email_found
                `, [userId, linkedinUrl, email]);
                
                logger.success(`[EMAIL_FINDER] ✅ Created new target_profile`);
            }

            return {
                success: true,
                data: result.rows[0]
            };

        } catch (error) {
            logger.error('[EMAIL_FINDER] Error saving to DB:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Save status flags (for not_found, error cases)
    async saveStatusOnly(linkedinUrl, status, userId) {
        try {
            logger.info(`[EMAIL_FINDER] Saving status flag: ${status}`);
            
            const existingProfile = await pool.query(`
                SELECT id FROM target_profiles 
                WHERE linkedin_url = $1 AND user_id = $2
            `, [linkedinUrl, userId]);

            let result;
            
            if (existingProfile.rows.length > 0) {
                result = await pool.query(`
                    UPDATE target_profiles 
                    SET 
                        email_status = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE linkedin_url = $2 AND user_id = $3
                    RETURNING id, email_status
                `, [status, linkedinUrl, userId]);
            } else {
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

    // Get target profile from database
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
            logger.error('[EMAIL_FINDER] Error getting target profile:', error);
            return {
                success: false,
                error: 'database_error',
                message: 'Failed to retrieve target profile'
            };
        }
    }

    // Update email status in target_profiles
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

            logger.debug(`[EMAIL_FINDER] Updated email status: Profile ${targetProfileId} -> ${status}`);
            return { success: true };

        } catch (error) {
            logger.error('[EMAIL_FINDER] Error updating email status:', error);
            return { success: false, error: error.message };
        }
    }

    // MAIN METHOD: Profile-based email finder (NO CACHE - ALWAYS calls Snov.io)
    async findEmail(userId, targetProfileId) {
        try {
            logger.custom('EMAIL_FINDER', `🔍 Profile-based email finder (NO CACHE): User ${userId}, Target ${targetProfileId}`);

            // Check if feature is enabled
            if (!this.enabled) {
                return {
                    success: false,
                    error: 'email_finder_disabled',
                    message: 'Email finder feature is currently disabled'
                };
            }

            // Check credentials
            if (!this.hasCredentials) {
                return {
                    success: false,
                    error: 'snov_not_configured',
                    message: 'Snov.io API credentials not configured'
                };
            }

            // Get target profile
            const targetProfile = await this.getTargetProfile(targetProfileId, userId);
            if (!targetProfile.success) {
                return targetProfile;
            }

            // ❌ REMOVED: Cache check - NO MORE: if (targetProfile.data.email_status && ...) return cached
            // ✅ ALWAYS go to Snov.io regardless of existing email_status

            logger.info('[EMAIL_FINDER] ⚠️ Cache DISABLED - Always calling Snov.io');

            // Check user credits
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
                targetProfileId: targetProfileId,
                linkedinUrl: targetProfile.data.linkedin_url
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

            try {
                // Update status to processing
                await this.updateEmailStatus(targetProfileId, null, 'processing', null);

                // ALWAYS call Snov.io
                logger.info('[EMAIL_FINDER] 🚀 Calling Snov.io API NOW...');
                const emailResult = await this.findEmailWithSnovV1(targetProfile.data.linkedin_url);

                if (emailResult.success && emailResult.email) {
                    // Save email
                    if (targetProfile.data.linkedin_url) {
                        await this.saveEmailToTargetProfiles(
                            targetProfile.data.linkedin_url, 
                            emailResult.email, 
                            userId
                        );
                        
                        // Auto-trigger verification
                        try {
                            const { emailVerifier } = require('./emailVerifier');
                            logger.info(`[EMAIL_FINDER] 🔄 Auto-triggering verification for ${emailResult.email}`);
                            emailVerifier.verifyEmail(emailResult.email, userId, targetProfile.data.linkedin_url)
                                .catch(err => logger.error('[EMAIL_FINDER] Auto-verify failed:', err));
                        } catch (verifierError) {
                            logger.error('[EMAIL_FINDER] Could not load emailVerifier:', verifierError);
                        }
                    }

                    // Update status to found
                    await this.updateEmailStatus(
                        targetProfileId, 
                        emailResult.email, 
                        'found', 
                        new Date()
                    );

                    // Complete payment
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        snovResponse: emailResult.snovData
                    });

                    logger.success(`[EMAIL_FINDER] ✅ Email found from Snov.io: ${emailResult.email}`);
                    logger.success(`[EMAIL_FINDER] 💰 Credits charged: ${this.costPerSuccess}`);

                    return {
                        success: true,
                        email: emailResult.email,
                        status: 'found',
                        source: 'snov_io_fresh',
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found successfully - verification in progress'
                    };

                } else {
                    // No email found
                    if (targetProfile.data.linkedin_url) {
                        await this.saveStatusOnly(
                            targetProfile.data.linkedin_url, 
                            'not_found', 
                            userId
                        );
                    }

                    await this.updateEmailStatus(
                        targetProfileId, 
                        null, 
                        'not_found', 
                        null
                    );

                    await releaseCreditHold(userId, holdId, 'email_not_found');

                    logger.info(`[EMAIL_FINDER] ❌ No email found (no credits charged)`);

                    return {
                        success: false,
                        error: 'email_not_found',
                        status: 'not_found',
                        creditsCharged: 0,
                        message: 'No email found for this LinkedIn profile'
                    };
                }

            } catch (processingError) {
                logger.error('[EMAIL_FINDER] Processing error:', processingError);
                await this.updateEmailStatus(targetProfileId, null, 'error', null);
                await releaseCreditHold(userId, holdId, 'processing_error');

                return {
                    success: false,
                    error: 'processing_error',
                    message: 'Temporary issue finding email. Please try again.',
                    creditsCharged: 0
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

    // Snov.io v1 API implementation
    async findEmailWithSnovV1(linkedinUrl) {
        try {
            logger.info('[EMAIL_FINDER] 📞 Calling Snov.io v1 LinkedIn URL API...');
            
            const accessToken = await this.getSnovAccessToken();
            
            // Step 1: Add LinkedIn URL
            logger.debug('[EMAIL_FINDER] Step 1: Adding LinkedIn URL to Snov.io...');
            const addUrlResponse = await axios.post(`${this.snovBaseUrl}/v1/add-url-for-search`, {
                access_token: accessToken,
                url: linkedinUrl
            }, {
                timeout: this.timeoutMs
            });
            
            logger.debug('[EMAIL_FINDER] URL added successfully');
            
            // Wait for Snov.io to process
            logger.debug('[EMAIL_FINDER] ⏳ Waiting 4 seconds for Snov.io to process...');
            await new Promise(resolve => setTimeout(resolve, 4000));
            
            // Step 2: Get emails
            logger.debug('[EMAIL_FINDER] Step 2: Retrieving emails from Snov.io...');
            const emailsResponse = await axios.post(`${this.snovBaseUrl}/v1/get-emails-from-url`, {
                access_token: accessToken,
                url: linkedinUrl
            }, {
                timeout: this.timeoutMs
            });
            
            logger.debug('[EMAIL_FINDER] Snov.io response received');
            
            const responseData = emailsResponse.data;
            
            if (!responseData.success) {
                logger.warn('[EMAIL_FINDER] Snov.io returned success: false');
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
                    logger.info(`[EMAIL_FINDER] ✅ Email found: ${validEmail.email}`);
                    
                    return {
                        success: true,
                        email: validEmail.email,
                        snovData: responseData
                    };
                }
            }
            
            logger.info('[EMAIL_FINDER] No emails found by Snov.io');
            return {
                success: false,
                email: null,
                snovData: responseData
            };
            
        } catch (error) {
            logger.error('[EMAIL_FINDER] Snov.io API error:', error.response?.data || error.message);
            
            if (error.response?.status === 401) {
                return {
                    success: false,
                    email: null,
                    error: 'Snov.io authentication failed'
                };
            }
            
            if (error.response?.status === 429) {
                return {
                    success: false,
                    email: null,
                    error: 'Snov.io rate limit reached'
                };
            }
            
            return {
                success: false,
                email: null,
                error: error.message
            };
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
                cacheMode: 'DISABLED - Always fresh'
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
            mode: 'snov_v1_no_cache',
            cacheMode: '❌ DISABLED - Always searches Snov.io',
            verificationMode: 'auto_trigger'
        };
    }
}

// Create singleton instance
const emailFinder = new EmailFinder();

// Export functions
async function findEmailForProfile(userId, targetProfileId) {
    return await emailFinder.findEmail(userId, targetProfileId);
}

async function findEmailWithLinkedInUrl(userId, linkedinUrl) {
    try {
        logger.custom('EMAIL_FINDER', `🔍 LinkedIn URL email finder (NO CACHE): User ${userId}, URL ${linkedinUrl}`);

        // Check if feature is enabled
        if (!emailFinder.enabled) {
            return {
                success: false,
                error: 'email_finder_disabled',
                message: 'Email finder feature is currently disabled'
            };
        }

        // Check credentials
        if (!emailFinder.hasCredentials) {
            return {
                success: false,
                error: 'snov_not_configured',
                message: 'Snov.io API credentials not configured'
            };
        }

        // ❌ NO CACHE CHECK - ALWAYS call Snov.io
        logger.info('[EMAIL_FINDER] ⚠️ Cache DISABLED - Calling Snov.io directly');

        // Check user credits
        const creditCheck = await checkUserCredits(userId, 'email_verification');
        if (!creditCheck.success || !creditCheck.hasCredits) {
            return {
                success: false,
                error: 'insufficient_credits',
                message: `You need ${emailFinder.costPerSuccess} credits to verify an email. You have ${creditCheck.currentCredits || 0} credits.`,
                currentCredits: creditCheck.currentCredits || 0,
                requiredCredits: emailFinder.costPerSuccess
            };
        }

        // Create credit hold
        logger.info(`[EMAIL_FINDER] 💳 Creating credit hold for ${emailFinder.costPerSuccess} credits`);
        const holdResult = await createCreditHold(userId, 'email_verification', {
            linkedinUrl: linkedinUrl
        });

        if (!holdResult.success) {
            return {
                success: false,
                error: 'credit_hold_failed',
                message: holdResult.error === 'insufficient_credits' 
                    ? `Insufficient credits: need ${emailFinder.costPerSuccess}, have ${holdResult.currentCredits}`
                    : 'Failed to reserve credits for this operation'
            };
        }

        const holdId = holdResult.holdId;

        try {
            // ALWAYS call Snov.io
            logger.info('[EMAIL_FINDER] 🚀 Calling Snov.io API NOW...');
            const emailResult = await emailFinder.findEmailWithSnovV1(linkedinUrl);

            if (emailResult.success && emailResult.email) {
                // Save email
                await emailFinder.saveEmailToTargetProfiles(
                    linkedinUrl, 
                    emailResult.email, 
                    userId
                );
                
                // Complete payment
                const paymentResult = await completeOperation(userId, holdId, {
                    email: emailResult.email,
                    snovResponse: emailResult.snovData
                });

                logger.success(`[EMAIL_FINDER] ✅ Email found from Snov.io: ${emailResult.email}`);
                logger.success(`[EMAIL_FINDER] 💰 Credits charged: ${emailFinder.costPerSuccess}`);

                // Auto-trigger verification
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
                    source: 'snov_io_fresh',
                    creditsCharged: emailFinder.costPerSuccess,
                    newBalance: paymentResult.newBalance || creditCheck.currentCredits - emailFinder.costPerSuccess,
                    message: 'Email found from Snov.io - verification in progress'
                };

            } else {
                // No email found
                await emailFinder.saveStatusOnly(linkedinUrl, 'not_found', userId);
                await releaseCreditHold(userId, holdId, 'email_not_found');

                logger.info(`[EMAIL_FINDER] ❌ No email found (no credits charged)`);

                return {
                    success: false,
                    error: 'email_not_found',
                    status: 'not_found',
                    creditsCharged: 0,
                    message: 'No email found for this LinkedIn profile'
                };
            }

        } catch (processingError) {
            logger.error('[EMAIL_FINDER] Processing error:', processingError);
            await emailFinder.saveStatusOnly(linkedinUrl, 'error', userId);
            await releaseCreditHold(userId, holdId, 'processing_error');

            return {
                success: false,
                error: 'processing_error',
                message: 'Temporary issue finding email. Please try again.',
                creditsCharged: 0
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
