// urlEmailVerifier.js - Email verification for Email Finder Page ONLY
// Separate process from target_profiles email verification
// Auto-triggered by urlEmailFinder when email is found
// FREE verification (no credits charged)
// Updates email_finder_searches table with Snov.io verification status
// Version: 1.0.0 - Dedicated verifier for Email Finder Page

const { pool } = require('./utils/database');
const logger = require('./utils/logger');
const axios = require('axios');

class UrlEmailVerifier {
    constructor() {
        // Snov.io API configuration (same as emailFinder)
        this.snovClientId = process.env.SNOV_CLIENT_ID;
        this.snovClientSecret = process.env.SNOV_CLIENT_SECRET;
        this.snovApiKey = process.env.SNOV_API_KEY;
        this.snovBaseUrl = 'https://api.snov.io';
        this.timeoutMs = parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 15000; // Longer timeout for verification
        
        // Check if we have credentials
        this.hasCredentials = !!(this.snovApiKey || (this.snovClientId && this.snovClientSecret));
        
        logger.custom('URL_EMAIL_VERIFIER', 'Snov.io Email Verifier for Email Finder Page initialized:', {
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            mode: 'auto_triggered_free',
            waitTime: '12 seconds',
            targetTable: 'email_finder_searches'
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
            logger.error('[URL_EMAIL_VERIFIER] Failed to get Snov.io access token:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Snov.io');
        }
    }

    // Main verification function (called by urlEmailFinder)
    async verifyEmail(email, userId, linkedinUrl) {
        logger.custom('URL_EMAIL_VERIFIER', `Starting verification for email: ${email}`);
        logger.info(`[URL_EMAIL_VERIFIER] User ID: ${userId}, LinkedIn: ${linkedinUrl}`);

        if (!this.hasCredentials) {
            logger.warn('[URL_EMAIL_VERIFIER] No Snov.io credentials - skipping verification');
            await this.updateVerificationStatus(email, userId, linkedinUrl, 'unknown', null);
            return {
                success: false,
                status: 'unknown',
                error: 'no_credentials'
            };
        }

        // Call Snov.io v2 async verification API
        const verificationResult = await this.verifySingleEmailV2(email);

        if (verificationResult.success) {
            // Update database with Snov.io's exact status
            const status = verificationResult.smtp_status || 'unknown';
            const reason = verificationResult.unknown_status_reason || null;
            
            await this.updateVerificationStatus(email, userId, linkedinUrl, status, reason);
            
            logger.success(`[URL_EMAIL_VERIFIER] ✅ Verification complete: ${email} -> ${status}`);
            
            return {
                success: true,
                status: status,
                reason: reason,
                email: email
            };
        } else {
            // Verification failed - update with 'unknown' status
            await this.updateVerificationStatus(email, userId, linkedinUrl, 'unknown', 'verification_failed');
            
            logger.warn(`[URL_EMAIL_VERIFIER] ⚠️ Verification failed: ${email} -> unknown`);
            
            return {
                success: false,
                status: 'unknown',
                error: verificationResult.error
            };
        }
    }

    // Snov.io v2 Async Email Verification (2-step process)
    async verifySingleEmailV2(email) {
        try {
            logger.info(`[URL_EMAIL_VERIFIER] Step 1: Starting verification task for ${email}`);
            
            const accessToken = await this.getSnovAccessToken();
            
            // STEP 1: Start verification task
            const startResponse = await axios.post(
                `${this.snovBaseUrl}/v2/email-verification/start`,
                { emails: [email] },
                {
                    headers: { 
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.timeoutMs
                }
            );

            logger.debug('[URL_EMAIL_VERIFIER] Start response:', startResponse.data);

            // Extract task_hash
            const taskHash = startResponse.data?.data?.task_hash || startResponse.data?.meta?.task_hash;
            
            if (!taskHash) {
                logger.error('[URL_EMAIL_VERIFIER] No task_hash received from Snov.io');
                return {
                    success: false,
                    error: 'no_task_hash',
                    smtp_status: 'unknown'
                };
            }

            logger.info(`[URL_EMAIL_VERIFIER] Task hash received: ${taskHash}`);

            // STEP 2: Wait 12 seconds for Snov.io to process (reliable timing)
            logger.info('[URL_EMAIL_VERIFIER] Step 2: Waiting 12 seconds for Snov.io to process...');
            await new Promise(resolve => setTimeout(resolve, 12000));

            // STEP 3: Get verification result
            logger.info('[URL_EMAIL_VERIFIER] Step 3: Retrieving verification result...');
            const resultResponse = await axios.get(
                `${this.snovBaseUrl}/v2/email-verification/result`,
                {
                    params: { task_hash: taskHash },
                    headers: { 
                        'Authorization': `Bearer ${accessToken}`
                    },
                    timeout: this.timeoutMs
                }
            );

            logger.debug('[URL_EMAIL_VERIFIER] Result response:', JSON.stringify(resultResponse.data, null, 2));

            // Parse response
            const responseData = resultResponse.data;
            
            if (responseData.status === 'completed' && responseData.data && responseData.data.length > 0) {
                const emailData = responseData.data[0];
                const result = emailData.result || {};
                
                const smtpStatus = result.smtp_status || 'unknown';
                const unknownReason = result.unknown_status_reason || null;
                
                logger.success(`[URL_EMAIL_VERIFIER] Snov.io verification result: ${smtpStatus}`);
                
                return {
                    success: true,
                    smtp_status: smtpStatus,  // 'valid', 'not_valid', or 'unknown'
                    unknown_status_reason: unknownReason,  // 'catchall', 'greylisted', etc.
                    is_webmail: result.is_webmail || false,
                    is_disposable: result.is_disposable || false,
                    is_gibberish: result.is_gibberish || false
                };
            } else {
                logger.warn('[URL_EMAIL_VERIFIER] Verification not completed or no data');
                return {
                    success: false,
                    smtp_status: 'unknown',
                    error: 'verification_incomplete'
                };
            }

        } catch (error) {
            logger.error('[URL_EMAIL_VERIFIER] Snov.io v2 verification error:', error.response?.data || error.message);
            
            // Handle specific error cases
            if (error.response?.status === 404) {
                return {
                    success: false,
                    smtp_status: 'unknown',
                    error: 'endpoint_not_found'
                };
            }
            
            if (error.response?.status === 401) {
                return {
                    success: false,
                    smtp_status: 'unknown',
                    error: 'authentication_failed'
                };
            }
            
            if (error.response?.status === 429) {
                return {
                    success: false,
                    smtp_status: 'unknown',
                    error: 'rate_limit_exceeded'
                };
            }
            
            return {
                success: false,
                smtp_status: 'unknown',
                error: error.message
            };
        }
    }

    // Update email_finder_searches table with verification status
    async updateVerificationStatus(email, userId, linkedinUrl, status, reason) {
        logger.info(`[URL_EMAIL_VERIFIER] Updating verification status for ${email} -> ${status}`);
        
        try {
            // Update by user_id + linkedin_url (unique combination in email_finder_searches)
            const result = await pool.query(`
                UPDATE email_finder_searches 
                SET 
                    verification_status = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $2 AND linkedin_url = $3 AND email = $4
                RETURNING id, email, verification_status, full_name, linkedin_url
            `, [status, userId, linkedinUrl, email]);

            if (result.rows.length > 0) {
                logger.success(`[URL_EMAIL_VERIFIER] ✅ Verification status updated in email_finder_searches:`, {
                    id: result.rows[0].id,
                    name: result.rows[0].full_name,
                    email: result.rows[0].email,
                    status: status,
                    linkedinUrl: result.rows[0].linkedin_url
                });
                return {
                    success: true,
                    data: result.rows[0]
                };
            } else {
                logger.warn(`[URL_EMAIL_VERIFIER] ⚠️ No record found for email: ${email}, user: ${userId}, url: ${linkedinUrl}`);
                return {
                    success: false,
                    error: 'no_record_found'
                };
            }
        } catch (error) {
            logger.error('[URL_EMAIL_VERIFIER] Error updating verification status:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Get verification status from database
    async getVerificationStatus(email, userId, linkedinUrl) {
        try {
            const result = await pool.query(`
                SELECT email, verification_status, full_name, search_date
                FROM email_finder_searches 
                WHERE user_id = $1 AND linkedin_url = $2 AND email = $3
            `, [userId, linkedinUrl, email]);

            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    success: true,
                    email: row.email,
                    status: row.verification_status,
                    name: row.full_name,
                    searchDate: row.search_date
                };
            } else {
                return {
                    success: false,
                    message: 'No record found'
                };
            }
        } catch (error) {
            logger.error('[URL_EMAIL_VERIFIER] Error getting verification status:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Health check
    async healthCheck() {
        const accessToken = await this.getSnovAccessToken();
        return {
            success: true,
            message: 'URL Email verifier ready',
            hasCredentials: this.hasCredentials,
            targetTable: 'email_finder_searches'
        };
    }

    // Get verifier status
    getStatus() {
        return {
            hasCredentials: this.hasCredentials,
            mode: 'auto_triggered_free',
            apiVersion: 'v2_async',
            timeoutMs: this.timeoutMs,
            waitTime: '12 seconds',
            targetTable: 'email_finder_searches'
        };
    }
}

// Create singleton instance
const urlEmailVerifier = new UrlEmailVerifier();

// Export functions
async function verifyEmailForUrlFinder(email, userId, linkedinUrl) {
    return await urlEmailVerifier.verifyEmail(email, userId, linkedinUrl);
}

async function getUrlVerificationStatus(email, userId, linkedinUrl) {
    return await urlEmailVerifier.getVerificationStatus(email, userId, linkedinUrl);
}

function getUrlEmailVerifierStatus() {
    return urlEmailVerifier.getStatus();
}

module.exports = {
    UrlEmailVerifier,
    urlEmailVerifier,
    verifyEmailForUrlFinder,
    getUrlVerificationStatus,
    getUrlEmailVerifierStatus
};

logger.success('URL Email Verifier module loaded - For Email Finder Page (email_finder_searches table)');
