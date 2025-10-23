// emailVerifier.js - FIXED: Email verification with 8-second wait and flexible URL matching
// Separate process from email finding
// Auto-triggered by emailFinder when email is found
// FREE verification (no credits charged)
// Updates target_profiles with Snov.io verification status
// Version: 1.1.0 - FIXED: 8s wait + flexible URL matching

const { pool } = require('./utils/database');
const logger = require('./utils/logger');
const axios = require('axios');

class EmailVerifier {
    constructor() {
        // Snov.io API configuration (same as emailFinder)
        this.snovClientId = process.env.SNOV_CLIENT_ID;
        this.snovClientSecret = process.env.SNOV_CLIENT_SECRET;
        this.snovApiKey = process.env.SNOV_API_KEY;
        this.snovBaseUrl = 'https://api.snov.io';
        this.timeoutMs = parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 15000; // Longer timeout for verification
        
        // Check if we have credentials
        this.hasCredentials = !!(this.snovApiKey || (this.snovClientId && this.snovClientSecret));
        
        logger.custom('EMAIL_VERIFIER', 'Snov.io Email Verifier initialized:', {
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            mode: 'auto_triggered_free',
            waitTime: '12 seconds',
            matchingMethod: 'by EMAIL (not URL)'
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
            logger.error('[EMAIL_VERIFIER] Failed to get Snov.io access token:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Snov.io');
        }
    }

    // Main verification function (called by emailFinder)
    async verifyEmail(email, userId, linkedinUrl) {
        try {
            logger.custom('EMAIL_VERIFIER', `Starting verification for email: ${email}`);
            logger.info(`[EMAIL_VERIFIER] User: ${userId}, LinkedIn: ${linkedinUrl}`);

            if (!this.hasCredentials) {
                logger.warn('[EMAIL_VERIFIER] No Snov.io credentials - skipping verification');
                await this.updateVerificationStatus(linkedinUrl, userId, 'unknown', null);
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
                
                await this.updateVerificationStatus(linkedinUrl, userId, status, reason);
                
                logger.success(`[EMAIL_VERIFIER] ✅ Verification complete: ${email} -> ${status}`);
                
                return {
                    success: true,
                    status: status,
                    reason: reason,
                    email: email
                };
            } else {
                // Verification failed - update with 'unknown' status
                await this.updateVerificationStatus(linkedinUrl, userId, 'unknown', 'verification_failed');
                
                logger.warn(`[EMAIL_VERIFIER] ⚠️ Verification failed: ${email} -> unknown`);
                
                return {
                    success: false,
                    status: 'unknown',
                    error: verificationResult.error
                };
            }

        } catch (error) {
            logger.error('[EMAIL_VERIFIER] Verification error:', error);
            
            // On error, update with 'unknown' status
            try {
                await this.updateVerificationStatus(linkedinUrl, userId, 'unknown', 'error');
            } catch (dbError) {
                logger.error('[EMAIL_VERIFIER] Failed to update DB after error:', dbError);
            }
            
            return {
                success: false,
                status: 'unknown',
                error: error.message
            };
        }
    }

    // Snov.io v2 Async Email Verification (2-step process)
    async verifySingleEmailV2(email) {
        try {
            logger.info(`[EMAIL_VERIFIER] Step 1: Starting verification task for ${email}`);
            
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

            logger.debug('[EMAIL_VERIFIER] Start response:', startResponse.data);

            // Extract task_hash
            const taskHash = startResponse.data?.data?.task_hash || startResponse.data?.meta?.task_hash;
            
            if (!taskHash) {
                logger.error('[EMAIL_VERIFIER] No task_hash received from Snov.io');
                return {
                    success: false,
                    error: 'no_task_hash',
                    smtp_status: 'unknown'
                };
            }

            logger.info(`[EMAIL_VERIFIER] Task hash received: ${taskHash}`);

            // STEP 2: FIXED - Wait 12 seconds for Snov.io to process (reliable timing)
            logger.info('[EMAIL_VERIFIER] Step 2: Waiting 12 seconds for Snov.io to process...');
            await new Promise(resolve => setTimeout(resolve, 12000));

            // STEP 3: Get verification result
            logger.info('[EMAIL_VERIFIER] Step 3: Retrieving verification result...');
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

            logger.debug('[EMAIL_VERIFIER] Result response:', JSON.stringify(resultResponse.data, null, 2));

            // Parse response
            const responseData = resultResponse.data;
            
            if (responseData.status === 'completed' && responseData.data && responseData.data.length > 0) {
                const emailData = responseData.data[0];
                const result = emailData.result || {};
                
                const smtpStatus = result.smtp_status || 'unknown';
                const unknownReason = result.unknown_status_reason || null;
                
                logger.success(`[EMAIL_VERIFIER] Snov.io verification result: ${smtpStatus}`);
                
                return {
                    success: true,
                    smtp_status: smtpStatus,  // 'valid', 'not_valid', or 'unknown'
                    unknown_status_reason: unknownReason,  // 'catchall', 'greylisted', etc.
                    is_webmail: result.is_webmail || false,
                    is_disposable: result.is_disposable || false,
                    is_gibberish: result.is_gibberish || false
                };
            } else {
                logger.warn('[EMAIL_VERIFIER] Verification not completed or no data');
                return {
                    success: false,
                    smtp_status: 'unknown',
                    error: 'verification_incomplete'
                };
            }

        } catch (error) {
            logger.error('[EMAIL_VERIFIER] Snov.io v2 verification error:', error.response?.data || error.message);
            
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

    // FIXED: Update target_profiles by EMAIL (not LinkedIn URL)
    async updateVerificationStatus(linkedinUrl, userId, status, reason) {
        try {
            logger.info(`[EMAIL_VERIFIER] Updating DB by EMAIL (not URL) -> Status: ${status}`);
            
            const timestamp = new Date();
            
            // First, get the email for this LinkedIn URL
            const emailResult = await pool.query(`
                SELECT email_found 
                FROM target_profiles 
                WHERE linkedin_url = $1 AND user_id = $2 AND email_found IS NOT NULL
                LIMIT 1
            `, [linkedinUrl, userId]);
            
            if (emailResult.rows.length === 0 || !emailResult.rows[0].email_found) {
                logger.warn(`[EMAIL_VERIFIER] ⚠️ No email found for ${linkedinUrl} (user: ${userId})`);
                return {
                    success: false,
                    error: 'no_email_found'
                };
            }
            
            const email = emailResult.rows[0].email_found;
            logger.info(`[EMAIL_VERIFIER] Found email: ${email}, updating all records with this email...`);
            
            // FIXED: Update by EMAIL instead of LinkedIn URL
            // This updates ALL records with this email (more reliable)
            const result = await pool.query(`
                UPDATE target_profiles 
                SET 
                    email_status = $1,
                    email_verified_at = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $3
                AND email_found = $4
                RETURNING id, email_found, email_status, email_verified_at, linkedin_url
            `, [status, timestamp, userId, email]);

            if (result.rows.length > 0) {
                logger.success(`[EMAIL_VERIFIER] ✅ Updated ${result.rows.length} record(s) successfully:`, {
                    email: email,
                    status: status,
                    recordsUpdated: result.rows.length,
                    linkedInUrls: result.rows.map(r => r.linkedin_url)
                });
                return {
                    success: true,
                    data: result.rows[0],
                    recordsUpdated: result.rows.length
                };
            } else {
                logger.warn(`[EMAIL_VERIFIER] ⚠️ No records updated for email: ${email} (user: ${userId})`);
                return {
                    success: false,
                    error: 'no_records_updated'
                };
            }

        } catch (error) {
            logger.error('[EMAIL_VERIFIER] DB update error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Get verification status from database
    async getVerificationStatus(linkedinUrl, userId) {
        try {
            const result = await pool.query(`
                SELECT email_found, email_status, email_verified_at
                FROM target_profiles 
                WHERE linkedin_url = $1 AND user_id = $2
            `, [linkedinUrl, userId]);

            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    success: true,
                    email: row.email_found,
                    status: row.email_status,
                    verifiedAt: row.email_verified_at
                };
            } else {
                return {
                    success: false,
                    message: 'No record found'
                };
            }

        } catch (error) {
            logger.error('[EMAIL_VERIFIER] Error getting verification status:', error);
            return {
                success: false,
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
                message: 'Email verifier ready',
                hasCredentials: this.hasCredentials
            };
        } catch (error) {
            return {
                success: false,
                message: 'Email verifier not ready',
                error: error.message,
                hasCredentials: this.hasCredentials
            };
        }
    }

    // Get verifier status
    getStatus() {
        return {
            hasCredentials: this.hasCredentials,
            mode: 'auto_triggered_free',
            apiVersion: 'v2_async',
            timeoutMs: this.timeoutMs,
            waitTime: '12 seconds'
        };
    }
}

// Create singleton instance
const emailVerifier = new EmailVerifier();

// Export functions
async function verifyEmail(email, userId, linkedinUrl) {
    return await emailVerifier.verifyEmail(email, userId, linkedinUrl);
}

async function getVerificationStatus(linkedinUrl, userId) {
    return await emailVerifier.getVerificationStatus(linkedinUrl, userId);
}

function getEmailVerifierStatus() {
    return emailVerifier.getStatus();
}

module.exports = {
    EmailVerifier,
    emailVerifier,
    verifyEmail,
    getVerificationStatus,
    getEmailVerifierStatus
};

logger.success('Snov.io Email Verifier module loaded - FIXED: 12s wait + matches by EMAIL!');
