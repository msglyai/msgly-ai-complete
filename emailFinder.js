// emailFinder.js - COMPLETE FILE: Email finding ONLY (verification separated)
// Direct integration with Snov.io API using LinkedIn URLs
// Handles email finding with "charge only on success" policy
// Enhanced with target_profiles persistence - ONE email per profile
// SEPARATED: Verification moved to emailVerifier.js (auto-triggered)
// Version: FIXED - Email Finder saves ONLY email, Verifier saves status

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

    // FIXED: Save ONLY email to target_profiles (no status, no timestamp)
    async saveEmailToTargetProfiles(linkedinUrl, email, userId) {
        try {
            logger.info(`[EMAIL_FINDER] Saving email ONLY to target_profiles - URL: ${linkedinUrl}, Email: ${email}`);
            
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

    // Get email from target_profiles cache
    async getEmailFromTargetProfiles(linkedinUrl, userId) {
        try {
            const result = await pool.query(`
                SELECT email_found, email_status, email_verified_at, created_at
                FROM target_profiles 
                WHERE user_id = $1 AND linkedin_url = $2 
                AND email_found IS NOT NULL
                ORDER BY created_at DESC 
                LIMIT 1
            `, [userId, linkedinUrl]);

            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    success: true,
                    email: row.email_found,
                    status: row.email_status,
                    verifiedAt: row.email_verified_at,
                    foundAt: row.created_at
                };
            } else {
                return {
                    success: false,
                    message: 'No email found in target_profiles for this LinkedIn URL'
                };
            }

        } catch (error) {
            logger.error('[EMAIL_FINDER] Error getting email from target_profiles:', error);
            return {
                success: false,
                error: error.message
            };
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
            logger.info(`Creating credit hold for ${this.costPerSuccess} credits`);
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

            try {
                // Find email using Snov.io v1 API with delay
                const emailResult = await this.findEmailWithSnovV1(linkedinUrl);

                if (emailResult.success && emailResult.email) {
                    // FIXED: Save ONLY email (no status)
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

                    logger.success(`Email found successfully: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    // AUTO-TRIGGER VERIFICATION (fire-and-forget, async, FREE)
                    try {
                        const { emailVerifier } = require('./emailVerifier');
                        logger.info(`[EMAIL_FINDER] Auto-triggering verification for ${emailResult.email}`);
                        emailVerifier.verifyEmail(emailResult.email, userId, linkedinUrl)
                            .catch(err => logger.error('[EMAIL_FINDER] Auto-verify failed:', err));
                    } catch (verifierError) {
                        logger.error('[EMAIL_FINDER] Could not load emailVerifier:', verifierError);
                    }

                    return {
                        success: true,
                        email: emailResult.email,
                        status: 'pending_verification',  // Status will be updated by verifier
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found successfully - verification in progress',
                        saved: saveResult.success
                    };

                } else {
                    // Failed to find email: Save "not_found" status and release credit hold
                    await this.saveStatusOnly(linkedinUrl, 'not_found', userId);
                    await releaseCreditHold(userId, holdId, 'email_not_found');

                    logger.info(`Email search failed: not found (no credits charged)`);

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
                logger.error('Email finder processing error:', processingError);
                await this.saveStatusOnly(linkedinUrl, 'error', userId);
                await releaseCreditHold(userId, holdId, 'processing_error');

                return {
                    success: false,
                    error: 'processing_error',
                    message: 'Temporary issue finding email. Please try again.',
                    creditsCharged: 0
                };
            }

        } catch (error) {
            logger.error('Email finder error:', error);
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
            logger.info('Finding email with Snov.io v1 LinkedIn URL API...');
            
            // Get access token
            const accessToken = await this.getSnovAccessToken();
            
            // Step 1: Add LinkedIn URL for search
            logger.debug('Step 1: Adding LinkedIn URL to Snov.io...');
            const addUrlResponse = await axios.post(`${this.snovBaseUrl}/v1/add-url-for-search`, {
                access_token: accessToken,
                url: linkedinUrl
            }, {
                timeout: this.timeoutMs
            });
            
            logger.debug('URL added to Snov.io:', addUrlResponse.data);
            
            // CRITICAL: Wait for Snov.io to process the LinkedIn URL
            logger.debug('Waiting for Snov.io to process LinkedIn URL...');
            await new Promise(resolve => setTimeout(resolve, 4000)); // 4 second delay
            
            // Step 2: Get emails from the URL
            logger.debug('Step 2: Getting emails from LinkedIn URL...');
            const emailsResponse = await axios.post(`${this.snovBaseUrl}/v1/get-emails-from-url`, {
                access_token: accessToken,
                url: linkedinUrl
            }, {
                timeout: this.timeoutMs
            });
            
            logger.debug('Snov.io email response:', emailsResponse.data);
            
            const responseData = emailsResponse.data;
            
            if (!responseData.success) {
                logger.warn('Snov.io API returned success: false');
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
                    logger.info(`Email found by Snov.io v1: ${validEmail.email}`);
                    
                    return {
                        success: true,
                        email: validEmail.email,
                        snovData: responseData
                    };
                }
            }
            
            logger.info('No emails found by Snov.io v1');
            return {
                success: false,
                email: null,
                snovData: responseData
            };
            
        } catch (error) {
            logger.error('Snov.io v1 API error:', error.response?.data || error.message);
            
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

    // BACKWARD COMPATIBILITY: Profile-based email finder
    async findEmail(userId, targetProfileId) {
        try {
            logger.custom('EMAIL', `Profile-based email finder: User ${userId}, Target ${targetProfileId}`);

            if (!this.enabled) {
                return {
                    success: false,
                    error: 'email_finder_disabled',
                    message: 'Email finder feature is currently disabled'
                };
            }

            if (!this.hasCredentials) {
                return {
                    success: false,
                    error: 'snov_not_configured',
                    message: 'Snov.io API credentials not configured'
                };
            }

            const targetProfile = await this.getTargetProfile(targetProfileId, userId);
            if (!targetProfile.success) {
                return targetProfile;
            }

            if (targetProfile.data.email_status && targetProfile.data.email_status !== 'pending') {
                return {
                    success: false,
                    error: 'already_processed',
                    message: 'Email already found for this profile',
                    currentEmail: targetProfile.data.email_found,
                    currentStatus: targetProfile.data.email_status
                };
            }

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

            const linkedinUrl = targetProfile.data.linkedin_url;
            if (!linkedinUrl) {
                return {
                    success: false,
                    error: 'missing_linkedin_url',
                    message: 'No LinkedIn URL found in profile'
                };
            }

            return await this.findEmailWithLinkedInUrl(userId, linkedinUrl);

        } catch (error) {
            logger.error('Profile-based email finder error:', error);
            return {
                success: false,
                error: 'system_error',
                message: 'System error occurred',
                details: error.message
            };
        }
    }

    // Fallback: Search by name and company
    async findEmailByNameAndCompany(firstName, lastName, company) {
        try {
            logger.info(`Finding email by name: ${firstName} ${lastName} at ${company}`);
            
            const accessToken = await this.getSnovAccessToken();
            
            const domain = this.extractDomainFromCompany(company);
            
            const response = await axios.post(`${this.snovBaseUrl}/v1/get-emails-from-names`, {
                access_token: accessToken,
                firstName: firstName,
                lastName: lastName,
                domain: domain
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: this.timeoutMs
            });
            
            const prospects = response.data?.data?.prospects || [];
            
            if (prospects.length === 0) {
                logger.info('No emails found by name-based search');
                return {
                    success: false,
                    email: null,
                    snovData: response.data
                };
            }
            
            const foundProspect = prospects.find(p => p.email && p.email !== '');
            
            if (!foundProspect || !foundProspect.email) {
                return {
                    success: false,
                    email: null,
                    snovData: response.data
                };
            }
            
            logger.info(`Email found by name search: ${foundProspect.email}`);
            
            return {
                success: true,
                email: foundProspect.email,
                snovData: response.data
            };
            
        } catch (error) {
            logger.error('Snov.io name search error:', error.response?.data || error.message);
            
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

async function getEmailFromCache(userId, linkedinUrl) {
    return await emailFinder.getEmailFromTargetProfiles(linkedinUrl, userId);
}

async function findOrGetEmail(userId, linkedinUrl) {
    try {
        // First check cache
        const existingEmail = await emailFinder.getEmailFromTargetProfiles(linkedinUrl, userId);
        
        if (existingEmail.success) {
            logger.info(`[EMAIL_FINDER] Email retrieved from cache: ${existingEmail.email}`);
            return {
                success: true,
                email: existingEmail.email,
                status: existingEmail.status,
                source: 'cached',
                verifiedAt: existingEmail.verifiedAt,
                creditsCharged: 0
            };
        }

        // If not found, search for new email
        logger.info(`[EMAIL_FINDER] No cached email found, searching for new email...`);
        return await emailFinder.findEmailWithLinkedInUrl(userId, linkedinUrl);

    } catch (error) {
        logger.error('[EMAIL_FINDER] Error in findOrGetEmail:', error);
        return {
            success: false,
            error: error.message,
            message: 'Email search failed'
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
    getEmailFromCache,
    findOrGetEmail,
    getEmailFinderStatus,
    isEmailFinderEnabled
};

logger.success('✅ Snov.io Email Finder loaded - NO CACHE MODE - Always searches Snov.io!');
