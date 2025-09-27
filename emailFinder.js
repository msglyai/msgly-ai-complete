// emailFinder.js - Real Snov.io Email Finding Integration
// Direct integration with Snov.io API using LinkedIn URLs
// Handles email finding and verification with "charge only on success" policy

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
        this.snovBaseUrl = 'https://app.snov.io/restapi';
        
        // Check if we have credentials
        this.hasCredentials = !!(this.snovApiKey || (this.snovClientId && this.snovClientSecret));
        
        logger.custom('EMAIL', 'Real Snov.io Email Finder initialized:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSuccess: this.costPerSuccess,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth'
        });
    }

    // Get Snov.io access token (if using OAuth)
    async getSnovAccessToken() {
        if (this.snovApiKey) {
            return this.snovApiKey; // Direct API key
        }
        
        if (!this.snovClientId || !this.snovClientSecret) {
            throw new Error('Missing Snov.io credentials');
        }
        
        try {
            const response = await axios.post(`${this.snovBaseUrl}/get-access-token`, {
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

    // NEW: Simple LinkedIn URL to email finder
    async findEmailWithLinkedInUrl(userId, linkedinUrl) {
        try {
            logger.custom('EMAIL', `Simple LinkedIn URL email finder: User ${userId}, URL ${linkedinUrl}`);

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
                // Find email using LinkedIn URL directly
                const emailResult = await this.findEmailWithSnovUrl(linkedinUrl);

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

    // NEW: Direct LinkedIn URL to Snov.io email finding
    async findEmailWithSnovUrl(linkedinUrl) {
        try {
            logger.info('Finding email with Snov.io LinkedIn URL API...');
            
            // Get access token
            const accessToken = await this.getSnovAccessToken();
            
            // Call Snov.io with LinkedIn URL directly
            logger.debug('Calling Snov.io get-emails-from-url API...');
            const response = await axios.post(`${this.snovBaseUrl}/get-emails-from-url`, {
                url: linkedinUrl
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: this.timeoutMs
            });
            
            const emails = response.data?.emails || [];
            const foundEmail = emails[0]?.email;
            
            if (foundEmail) {
                logger.info(`Email found by Snov.io: ${foundEmail}`);
                
                return {
                    success: true,
                    email: foundEmail,
                    snovData: response.data
                };
            } else {
                logger.info('No emails found by Snov.io');
                return {
                    success: false,
                    email: null,
                    snovData: response.data
                };
            }
            
        } catch (error) {
            logger.error('Snov.io API error:', error.response?.data || error.message);
            
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

    // EXISTING: Main entry point for target profile IDs (for backward compatibility)
    async findEmail(userId, targetProfileId) {
        try {
            // Get target profile LinkedIn URL
            const targetProfile = await this.getTargetProfile(targetProfileId, userId);
            if (!targetProfile.success) {
                return targetProfile;
            }

            const linkedinUrl = targetProfile.data.linkedin_url;
            if (!linkedinUrl) {
                return {
                    success: false,
                    error: 'no_linkedin_url',
                    message: 'No LinkedIn URL found for this profile'
                };
            }

            // Use the new LinkedIn URL method
            return await this.findEmailWithLinkedInUrl(userId, linkedinUrl);

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

    // Get feature status
    getStatus() {
        return {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            costPerSuccess: this.costPerSuccess,
            mode: 'linkedin_url_direct'
        };
    }
}

// Create singleton instance
const emailFinder = new EmailFinder();

// Export helper functions
async function findEmailForProfile(userId, targetProfileId) {
    return await emailFinder.findEmail(userId, targetProfileId);
}

// NEW: Export LinkedIn URL finder
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
    findEmailWithLinkedInUrl,  // NEW: Add this export
    getEmailFinderStatus,
    isEmailFinderEnabled
};

logger.success('LinkedIn URL Direct Snov.io Email Finder module loaded successfully!');
