// emailFinder.js - FINAL FIX: Direct messageId persistence - NO URL MATCHING
// Direct integration with Snov.io API using LinkedIn URLs
// Handles email finding and verification with direct messageId-based persistence
// FIXED: Removed all URL matching logic - uses messageId directly

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
        
        logger.custom('EMAIL', 'Snov.io Email Finder initialized - DIRECT MESSAGE_ID PERSISTENCE:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSuccess: this.costPerSuccess,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            persistenceMode: 'direct_message_id'
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

    // FIXED: Direct messageId-based persistence - NO URL MATCHING
    async saveEmailToMessageId(messageId, email, verificationStatus, userId) {
        try {
            logger.info(`[EMAIL_FINDER] Saving email directly to messageId ${messageId} - Email: ${email}, Status: ${verificationStatus}`);
            
            const timestamp = new Date();
            
            // SIMPLIFIED: Direct UPDATE using messageId - NO URL COMPARISON
            const result = await pool.query(`
                UPDATE message_logs 
                SET 
                    email_found = $1,
                    email_status = $2,
                    email_verified_at = $3
                WHERE id = $4 AND user_id = $5
                RETURNING id, email_found, email_status, email_verified_at
            `, [email, verificationStatus, timestamp, messageId, userId]);

            if (result.rows.length > 0) {
                logger.success(`[EMAIL_FINDER] ✅ Successfully updated message_logs record:`, result.rows[0]);
                return {
                    success: true,
                    data: result.rows[0],
                    message: 'Email saved to message_logs successfully'
                };
            } else {
                logger.warn(`[EMAIL_FINDER] ⚠️ No message_logs record found for messageId: ${messageId}, User: ${userId}`);
                return {
                    success: false,
                    message: 'No message_logs record found to update'
                };
            }

        } catch (error) {
            logger.error('[EMAIL_FINDER] Error saving email to message_logs:', error);
            return {
                success: false,
                error: error.message,
                message: 'Failed to save email to message_logs'
            };
        }
    }

    // FIXED: Get email verification status using messageId directly
    async getEmailFromMessageId(messageId, userId) {
        try {
            const result = await pool.query(`
                SELECT email_found, email_status, email_verified_at, created_at
                FROM message_logs 
                WHERE id = $1 AND user_id = $2 
                AND email_found IS NOT NULL
            `, [messageId, userId]);

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
                    message: 'No email found in message_logs for this message'
                };
            }

        } catch (error) {
            logger.error('[EMAIL_FINDER] Error getting email from message_logs:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Verify single email using Snov.io API
    async verifySingleEmail(email) {
        try {
            logger.info(`[EMAIL_FINDER] Verifying email: ${email}`);
            
            const accessToken = await this.getSnovAccessToken();
            
            const response = await axios.post(`${this.snovBaseUrl}/v1/email-verifier`, {
                access_token: accessToken,
                email: email
            }, {
                timeout: this.timeoutMs
            });

            logger.debug(`[EMAIL_FINDER] Email verification response:`, response.data);

            const result = response.data;
            const status = result.result === 'valid' ? 'verified' : 'not_found';

            return {
                success: true,
                status: status,
                result: result.result,
                reason: result.reason || null
            };

        } catch (error) {
            logger.error('[EMAIL_FINDER] Email verification error:', error.response?.data || error.message);
            
            return {
                success: false,
                status: 'not_found',
                error: error.message
            };
        }
    }

    // FIXED: Main LinkedIn URL email finder with direct messageId persistence
    async findEmailWithMessageId(userId, messageId, linkedinUrl) {
        try {
            logger.custom('EMAIL', `LinkedIn URL email finder: User ${userId}, MessageId ${messageId}, URL ${linkedinUrl}`);

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

            // FIXED: First check if we already have the email using messageId
            const existingEmail = await this.getEmailFromMessageId(messageId, userId);
            
            if (existingEmail.success) {
                logger.info(`[EMAIL_FINDER] Email already found for messageId ${messageId}: ${existingEmail.email}`);
                return {
                    success: true,
                    email: existingEmail.email,
                    status: existingEmail.status,
                    source: 'cached',
                    verifiedAt: existingEmail.verifiedAt,
                    creditsCharged: 0,
                    message: 'Email retrieved from cache (no credits charged)'
                };
            }

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
                messageId: messageId,
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
                // Find email using correct Snov.io v1 API with delay
                const emailResult = await this.findEmailWithSnovV1(linkedinUrl);

                if (emailResult.success && emailResult.email) {
                    // Verify the email
                    const verificationResult = await this.verifySingleEmail(emailResult.email);
                    logger.debug(`[EMAIL_FINDER] Verification result:`, verificationResult);
                    
                    // FIXED: Save email and verification result using messageId directly
                    const saveResult = await this.saveEmailToMessageId(messageId, emailResult.email, verificationResult.status, userId);
                    logger.debug(`[EMAIL_FINDER] Save result:`, saveResult);

                    // Success: Complete payment and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        verificationStatus: verificationResult.status,
                        snovResponse: emailResult.snovData,
                        saved: saveResult.success
                    });

                    logger.success(`Email verification successful: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    return {
                        success: true,
                        email: emailResult.email,
                        verificationStatus: verificationResult.status,
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found and verified successfully',
                        saved: saveResult.success
                    };

                } else {
                    // Failed to find email: Save "not found" status and release credit hold
                    await this.saveEmailToMessageId(messageId, null, 'not_found', userId);
                    await releaseCreditHold(userId, holdId, 'email_not_found');

                    logger.info(`Email verification failed: not found (no credits charged)`);

                    return {
                        success: false,
                        error: 'email_not_found',
                        creditsCharged: 0,
                        message: 'No email found for this LinkedIn profile'
                    };
                }

            } catch (processingError) {
                // Processing error: Save error status and release credit hold
                logger.error('Email finder processing error:', processingError);
                await this.saveEmailToMessageId(messageId, null, 'not_found', userId);
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

    // Main LinkedIn URL email finder with enhanced persistence
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
                // Find email using correct Snov.io v1 API with delay
                const emailResult = await this.findEmailWithSnovV1(linkedinUrl);

                if (emailResult.success && emailResult.email) {
                    // Verify the email
                    const verificationResult = await this.verifySingleEmail(emailResult.email);
                    logger.debug(`[EMAIL_FINDER] Verification result:`, verificationResult);

                    // Success: Complete payment and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        verificationStatus: verificationResult.status,
                        snovResponse: emailResult.snovData
                    });

                    logger.success(`Email verification successful: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    return {
                        success: true,
                        email: emailResult.email,
                        verificationStatus: verificationResult.status,
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found and verified successfully'
                    };

                } else {
                    // Failed to find email: Release credit hold
                    await releaseCreditHold(userId, holdId, 'email_not_found');

                    logger.info(`Email verification failed: not found (no credits charged)`);

                    return {
                        success: false,
                        error: 'email_not_found',
                        creditsCharged: 0,
                        message: 'No email found for this LinkedIn profile'
                    };
                }

            } catch (processingError) {
                // Processing error: Release credit hold
                logger.error('Email finder processing error:', processingError);
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

    // FINAL FIX: Correct Snov.io v1 API implementation with proper authentication AND required delay
    async findEmailWithSnovV1(linkedinUrl) {
        try {
            logger.info('Finding email with Snov.io v1 LinkedIn URL API...');
            
            // Get access token
            const accessToken = await this.getSnovAccessToken();
            
            // Step 1: Add LinkedIn URL for search (v1 API with access_token as parameter)
            logger.debug('Step 1: Adding LinkedIn URL to Snov.io...');
            const addUrlResponse = await axios.post(`${this.snovBaseUrl}/v1/add-url-for-search`, {
                access_token: accessToken,
                url: linkedinUrl
            }, {
                timeout: this.timeoutMs
            });
            
            logger.debug('URL added to Snov.io:', addUrlResponse.data);
            
            // CRITICAL FIX: Wait for Snov.io to process the LinkedIn URL (3-5 seconds)
            logger.debug('Waiting for Snov.io to process LinkedIn URL...');
            await new Promise(resolve => setTimeout(resolve, 4000)); // 4 second delay
            
            // Step 2: Get emails from the URL (v1 API with access_token as parameter)
            logger.debug('Step 2: Getting emails from LinkedIn URL...');
            const emailsResponse = await axios.post(`${this.snovBaseUrl}/v1/get-emails-from-url`, {
                access_token: accessToken,
                url: linkedinUrl
            }, {
                timeout: this.timeoutMs
            });
            
            logger.debug('Snov.io email response:', emailsResponse.data);
            
            // Parse response for found emails
            const responseData = emailsResponse.data;
            
            // Check if response indicates success
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
                // Find the first valid email
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

    // Keep original profile-based email finder for backward compatibility
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

            logger.info(`Creating credit hold for ${this.costPerSuccess} credits`);
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
                await this.updateEmailStatus(targetProfileId, null, 'processing', null);

                // Use LinkedIn URL if available, otherwise try name-based search
                let emailResult;
                if (targetProfile.data.linkedin_url) {
                    emailResult = await this.findEmailWithSnovV1(targetProfile.data.linkedin_url);
                } else {
                    emailResult = await this.findEmailWithSnovNames(targetProfile.data);
                }

                if (emailResult.success && emailResult.email) {

                    await this.updateEmailStatus(
                        targetProfileId, 
                        emailResult.email, 
                        'verified', 
                        new Date()
                    );

                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        snovResponse: emailResult.snovData
                    });

                    logger.success(`Email verification successful: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    return {
                        success: true,
                        email: emailResult.email,
                        status: 'verified',
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found successfully'
                    };

                } else {

                    await this.updateEmailStatus(
                        targetProfileId, 
                        null, 
                        'not_found', 
                        null
                    );

                    await releaseCreditHold(userId, holdId, 'email_not_found');

                    logger.info(`Email verification failed: not found (no credits charged)`);

                    return {
                        success: false,
                        error: 'email_not_found',
                        creditsCharged: 0,
                        message: 'No email found for this profile'
                    };
                }

            } catch (processingError) {
                logger.error('Email finder processing error:', processingError);
                
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
            logger.error('Email finder error:', error);
            return {
                success: false,
                error: 'system_error',
                message: 'System error occurred. Please try again.',
                details: error.message
            };
        }
    }

    // Fallback: Name-based email search using domain search (v2 API with Bearer token)
    async findEmailWithSnovNames(profileData) {
        try {
            logger.info('Finding email with Snov.io name-based search...');
            
            const accessToken = await this.getSnovAccessToken();
            
            const profileJson = profileData.profile_data || {};
            const firstName = profileJson.firstName || profileJson.first_name || '';
            const lastName = profileJson.lastName || profileJson.last_name || '';
            const company = profileJson.currentCompany || profileJson.company || '';
            
            if (!firstName || !lastName || !company) {
                logger.warn('Insufficient profile data for name-based email lookup');
                return {
                    success: false,
                    email: null,
                    error: 'insufficient_data'
                };
            }
            
            // Use v2 API for domain search with Bearer token
            const domain = this.extractDomainFromCompany(company);
            
            const response = await axios.post(`${this.snovBaseUrl}/v2/domain-search/prospects`, {
                domain: domain,
                first_name: firstName,
                last_name: lastName
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
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

    // Helper functions (unchanged)
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

    // Health check method
    async healthCheck() {
        try {
            const accessToken = await this.getSnovAccessToken();
            return {
                success: true,
                message: 'Snov.io API connection successful',
                hasCredentials: this.hasCredentials,
                persistenceMode: 'direct_message_id'
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
            mode: 'snov_v1_linkedin_url_with_delay_fix_and_direct_message_id_persistence',
            persistenceStrategy: 'direct_message_id'
        };
    }
}

// Create singleton instance
const emailFinder = new EmailFinder();

// Export helper functions with messageId support
async function findEmailForProfile(userId, targetProfileId) {
    return await emailFinder.findEmail(userId, targetProfileId);
}

async function findEmailWithLinkedInUrl(userId, linkedinUrl) {
    return await emailFinder.findEmailWithLinkedInUrl(userId, linkedinUrl);
}

// FIXED: New function for direct messageId-based email finding
async function findEmailWithMessageId(userId, messageId, linkedinUrl) {
    return await emailFinder.findEmailWithMessageId(userId, messageId, linkedinUrl);
}

// FIXED: Check if email exists using messageId
async function getEmailFromCache(userId, messageId) {
    return await emailFinder.getEmailFromMessageId(messageId, userId);
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
    findEmailWithMessageId,
    getEmailFromCache,
    getEmailFinderStatus,
    isEmailFinderEnabled
};

logger.success('Snov.io Email Finder module loaded with DIRECT MESSAGE_ID PERSISTENCE - NO URL MATCHING!');
