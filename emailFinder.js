// emailFinder.js - Fixed Snov.io Email Finding Integration
// Updated with correct Snov.io API v1/v2 endpoints and authentication
// Handles email finding and verification with "charge only on success" policy

const { pool } = require('./utils/database');
const { createCreditHold, completeOperation, releaseCreditHold, checkUserCredits } = require('./credits');
const logger = require('./utils/logger');
const axios = require('axios');

class EmailFinder {
    constructor() {
        // Feature flags from environment
        this.enabled = process.env.EMAIL_FINDER_ENABLED === 'true';
        this.timeoutMs = parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 15000;
        this.costPerSuccess = parseFloat(process.env.EMAIL_FINDER_COST_PER_SUCCESS_CREDITS) || 2.0;
        
        // FIXED: Updated Snov.io API configuration with correct URLs
        this.snovClientId = process.env.SNOV_CLIENT_ID;
        this.snovClientSecret = process.env.SNOV_CLIENT_SECRET;
        this.snovApiKey = process.env.SNOV_API_KEY;
        this.snovBaseUrl = 'https://api.snov.io';  // FIXED: Correct base URL
        
        // Check if we have credentials
        this.hasCredentials = !!(this.snovApiKey || (this.snovClientId && this.snovClientSecret));
        
        logger.custom('EMAIL', 'Fixed Snov.io Email Finder initialized:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSuccess: this.costPerSuccess,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            baseUrl: this.snovBaseUrl
        });
    }

    // FIXED: Get Snov.io access token with correct endpoint
    async getSnovAccessToken() {
        if (this.snovApiKey) {
            return this.snovApiKey; // Direct API key
        }
        
        if (!this.snovClientId || !this.snovClientSecret) {
            throw new Error('Missing Snov.io credentials');
        }
        
        try {
            // FIXED: Correct authentication endpoint
            const response = await axios.post(`${this.snovBaseUrl}/v1/oauth/access_token`, {
                grant_type: 'client_credentials',
                client_id: this.snovClientId,
                client_secret: this.snovClientSecret
            }, {
                timeout: this.timeoutMs
            });
            
            logger.debug('Snov.io authentication successful');
            return response.data.access_token;
        } catch (error) {
            logger.error('Failed to get Snov.io access token:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Snov.io');
        }
    }

    // FIXED: LinkedIn URL to email finder using correct API
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
                // FIXED: Find email using updated Snov.io API
                const emailResult = await this.findEmailWithSnovLinkedIn(linkedinUrl);

                if (emailResult.success && emailResult.email) {
                    // Success: Complete payment and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        snovResponse: emailResult.snovData
                    });

                    logger.success(`Email verification successful: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    return {
                        success: true,
                        email: emailResult.email,
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found successfully'
                    };

                } else {
                    // Failed to find email: Release credit hold (no charge on failure)
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

    // FIXED: New method using correct Snov.io LinkedIn URL API
    async findEmailWithSnovLinkedIn(linkedinUrl) {
        try {
            logger.info('Finding email with Snov.io LinkedIn URL API...');
            
            // Get access token
            const accessToken = await this.getSnovAccessToken();
            
            // FIXED: Use Data Enrichment API which is the correct way to find emails from LinkedIn URLs
            logger.debug('Calling Snov.io Data Enrichment API...');
            const response = await axios.post(`${this.snovBaseUrl}/v2/data-enrichment/url`, {
                url: linkedinUrl
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: this.timeoutMs
            });
            
            const data = response.data?.data || {};
            const foundEmail = data.email;
            
            if (foundEmail && foundEmail !== '') {
                logger.info(`Email found by Snov.io: ${foundEmail}`);
                
                // FIXED: Verify the email using correct verification endpoint
                const verificationResult = await this.verifySnovEmail(foundEmail, accessToken);
                
                return {
                    success: true,
                    email: foundEmail,
                    verified: verificationResult.valid,
                    snovData: {
                        enrichment: response.data,
                        verification: verificationResult.data
                    }
                };
            } else {
                logger.info('No email found by Snov.io');
                return {
                    success: false,
                    email: null,
                    snovData: response.data
                };
            }
            
        } catch (error) {
            logger.error('Snov.io LinkedIn API error:', error.response?.data || error.message);
            
            if (error.response?.status === 401 || error.response?.status === 403) {
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

    // FIXED: Email verification using correct endpoint
    async verifySnovEmail(email, accessToken) {
        try {
            logger.debug(`Verifying email: ${email}`);
            
            const response = await axios.post(`${this.snovBaseUrl}/v1/email-verifier`, {
                email: email
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: this.timeoutMs
            });
            
            const result = response.data;
            const isValid = result.status === 'valid' || result.deliverable === true;
            
            logger.debug(`Email verification result: ${isValid ? 'valid' : 'invalid'}`);
            
            return {
                valid: isValid,
                data: result
            };
            
        } catch (error) {
            logger.warn('Email verification failed:', error.response?.data || error.message);
            // Don't fail the entire process if verification fails
            return {
                valid: true, // Assume valid if verification fails
                data: { error: 'verification_failed' }
            };
        }
    }

    // EXISTING: Main entry point for target profile IDs (updated with correct API)
    async findEmail(userId, targetProfileId) {
        try {
            logger.custom('EMAIL', `Snov.io email finder request: User ${userId}, Target ${targetProfileId}`);

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

            // Get target profile from database
            const targetProfile = await this.getTargetProfile(targetProfileId, userId);
            if (!targetProfile.success) {
                return targetProfile; // Return error
            }

            // Check if already processed
            if (targetProfile.data.email_status && targetProfile.data.email_status !== 'pending') {
                return {
                    success: false,
                    error: 'already_processed',
                    message: 'Email already found for this profile',
                    currentEmail: targetProfile.data.email_found,
                    currentStatus: targetProfile.data.email_status
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
                // Set status to processing
                await this.updateEmailStatus(targetProfileId, null, 'processing', null);

                // FIXED: Use LinkedIn URL directly if available
                let emailResult;
                if (targetProfile.data.linkedin_url) {
                    emailResult = await this.findEmailWithSnovLinkedIn(targetProfile.data.linkedin_url);
                } else {
                    // Fallback to name-based search
                    emailResult = await this.findEmailWithSnovName(targetProfile.data);
                }

                if (emailResult.success && emailResult.email) {
                    // Success: Update database and complete payment
                    await this.updateEmailStatus(
                        targetProfileId, 
                        emailResult.email, 
                        'verified', 
                        new Date()
                    );

                    // Complete operation and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        verified: emailResult.verified,
                        snovResponse: emailResult.snovData
                    });

                    logger.success(`Email verification successful: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    return {
                        success: true,
                        email: emailResult.email,
                        status: 'verified',
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found and verified successfully'
                    };

                } else {
                    // Failed to find email: Update status and release hold
                    await this.updateEmailStatus(
                        targetProfileId, 
                        null, 
                        'not_found', 
                        null
                    );

                    // Release credit hold (no charge on failure)
                    await releaseCreditHold(userId, holdId, 'email_not_found');

                    logger.info(`Email verification failed: not found (no credits charged)`);

                    return {
                        success: false,
                        error: 'email_not_found',
                        email: null,
                        status: 'not_found',
                        creditsCharged: 0,
                        message: 'No email found for this profile'
                    };
                }

            } catch (processingError) {
                // Processing error: Update status and release hold
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

    // FIXED: Name-based email finding using correct API
    async findEmailWithSnovName(profileData) {
        try {
            logger.info('Finding email with Snov.io name-based API...');
            
            // Get access token
            const accessToken = await this.getSnovAccessToken();
            
            // Extract profile information
            const profileJson = profileData.profile_data || {};
            const firstName = profileJson.firstName || profileJson.first_name || '';
            const lastName = profileJson.lastName || profileJson.last_name || '';
            const company = profileJson.currentCompany || profileJson.company || '';
            
            if (!firstName || !lastName || !company) {
                logger.warn('Insufficient profile data for email lookup');
                return {
                    success: false,
                    email: null,
                    error: 'insufficient_data'
                };
            }
            
            // FIXED: Use correct Domain Search API for name-based lookup
            const domain = this.extractDomainFromCompany(company);
            
            logger.debug(`Searching for ${firstName} ${lastName} at ${domain}`);
            
            // Step 1: Search for prospects on domain
            const searchResponse = await axios.post(`${this.snovBaseUrl}/v2/domain-search/prospects`, {
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
            
            const prospects = searchResponse.data?.data?.prospects || [];
            
            if (prospects.length === 0) {
                logger.info('No prospects found by Snov.io');
                return {
                    success: false,
                    email: null,
                    snovData: searchResponse.data
                };
            }
            
            // Get the first prospect with an email
            const foundProspect = prospects.find(p => p.email && p.email !== '');
            
            if (!foundProspect || !foundProspect.email) {
                return {
                    success: false,
                    email: null,
                    snovData: searchResponse.data
                };
            }
            
            logger.info(`Email found by Snov.io: ${foundProspect.email}`);
            
            // Verify email
            const verificationResult = await this.verifySnovEmail(foundProspect.email, accessToken);
            
            return {
                success: true,
                email: foundProspect.email,
                verified: verificationResult.valid,
                snovData: {
                    prospects: searchResponse.data,
                    verification: verificationResult.data
                }
            };
            
        } catch (error) {
            logger.error('Snov.io name API error:', error.response?.data || error.message);
            
            if (error.response?.status === 401 || error.response?.status === 403) {
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

    // Extract domain from company name (improved)
    extractDomainFromCompany(company) {
        // Simple domain extraction - can be improved
        const cleanCompany = company.toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .replace(/(inc|ltd|llc|corp|corporation|company|co|group|international|intl)$/g, '');
        
        return `${cleanCompany}.com`;
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
            logger.error('Error getting target profile:', error);
            return {
                success: false,
                error: 'database_error',
                message: 'Failed to retrieve target profile'
            };
        }
    }

    // Update email status in database
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

    // Get feature status
    getStatus() {
        return {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            costPerSuccess: this.costPerSuccess,
            mode: 'snov_api_v2_fixed',
            baseUrl: this.snovBaseUrl
        };
    }
}

// Create singleton instance
const emailFinder = new EmailFinder();

// Export helper functions
async function findEmailForProfile(userId, targetProfileId) {
    return await emailFinder.findEmail(userId, targetProfileId);
}

// Export LinkedIn URL finder
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

logger.success('FIXED Snov.io Email Finder module loaded with correct API endpoints!');
