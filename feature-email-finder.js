// feature-email-finder.js - Snov.io Email Finder & Verification Module
// Minimum-server edition: All logic isolated in this single dedicated module
// Integrates with existing credit system, authentication, and database structure

const { Pool } = require('pg');

class EmailFinderService {
    constructor(pool, creditsService) {
        this.pool = pool;
        this.creditsService = creditsService;
        
        // Configuration from environment variables
        this.config = {
            enabled: process.env.EMAIL_FINDER_ENABLED === 'true',
            clientId: process.env.SNOV_CLIENT_ID,
            clientSecret: process.env.SNOV_CLIENT_SECRET,
            timeout: parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 10000,
            rateLimit: parseInt(process.env.EMAIL_FINDER_RATE_LIMIT_PER_HOUR) || 100,
            costCredits: parseInt(process.env.EMAIL_FINDER_COST_PER_SUCCESS_CREDITS) || 2,
            logLevel: process.env.EMAIL_FINDER_LOG_LEVEL || 'info'
        };
        
        // In-memory rate limiting (simple implementation)
        this.rateLimitTracker = new Map();
        
        // Snov.io API endpoints
        this.endpoints = {
            auth: 'https://api.snov.io/v1/oauth/access_token',
            findEmail: 'https://api.snov.io/v1/get-emails-from-names',
            verifyStart: 'https://api.snov.io/v2/email-verification/start',
            verifyResult: 'https://api.snov.io/v2/email-verification/result'
        };
        
        // Token cache
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    // ==================== MAIN PUBLIC METHOD ====================
    
    async processEmailLookup(userId, messageId) {
        const startTime = Date.now();
        let holdId = null;
        
        try {
            console.log(`[EMAIL_FINDER] Starting email lookup - User: ${userId}, Message: ${messageId}`);
            
            // 1. Feature flag check
            if (!this.config.enabled) {
                return this.errorResponse('Email finder feature is currently disabled');
            }
            
            // 2. Rate limiting check
            const rateLimitCheck = this.checkRateLimit(userId);
            if (!rateLimitCheck.allowed) {
                return this.errorResponse(`Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} minutes`);
            }
            
            // 3. Get and validate message
            const message = await this.getMessage(userId, messageId);
            if (!message.success) {
                return this.errorResponse(message.error);
            }
            
            // 4. Check if already verified (idempotency)
            if (this.isAlreadyVerified(message.data)) {
                console.log(`[EMAIL_FINDER] Email already verified for message ${messageId}`);
                return {
                    success: true,
                    status: 'already_verified',
                    email: message.data.data_json?.email_finder?.email,
                    message: 'Email already verified'
                };
            }
            
            // 5. Create credit hold
            const creditHold = await this.creditsService.createHold(userId, 'email_finder', {
                messageId: messageId,
                targetName: message.data.target_name
            });
            
            if (!creditHold.success) {
                return this.errorResponse(creditHold.error === 'insufficient_credits' 
                    ? 'Insufficient credits. Please upgrade your plan.' 
                    : creditHold.userMessage || 'Credit check failed');
            }
            
            holdId = creditHold.holdId;
            
            // 6. Extract lookup data from message
            const lookupData = this.extractLookupData(message.data);
            if (!lookupData.success) {
                await this.creditsService.releaseHold(userId, holdId);
                return this.errorResponse(lookupData.error);
            }
            
            // 7. Perform Snov.io lookup
            const snovResult = await this.performSnovLookup(lookupData.data);
            
            // 8. Process result and update database
            const updateResult = await this.updateMessageWithResult(messageId, snovResult);
            if (!updateResult.success) {
                await this.creditsService.releaseHold(userId, holdId);
                return this.errorResponse('Failed to save results');
            }
            
            // 9. Handle credit completion based on result
            const processingTime = Date.now() - startTime;
            
            if (snovResult.status === 'verified') {
                // Success: Complete the hold (deduct credits)
                await this.creditsService.completeOperation(userId, holdId, {
                    success: true,
                    email: snovResult.email,
                    processingTimeMs: processingTime
                });
                
                this.logUsage(userId, messageId, 'verified', this.config.costCredits, processingTime);
                
                return {
                    success: true,
                    status: 'verified',
                    email: snovResult.email,
                    creditsUsed: this.config.costCredits
                };
                
            } else {
                // Not found or error: Release hold (no charge)
                await this.creditsService.releaseHold(userId, holdId);
                
                this.logUsage(userId, messageId, snovResult.status, 0, processingTime);
                
                return {
                    success: true,
                    status: snovResult.status,
                    message: snovResult.status === 'not_found' 
                        ? 'Email not found' 
                        : 'Lookup failed',
                    creditsUsed: 0
                };
            }
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Error in processEmailLookup:', error);
            
            // Release hold on error
            if (holdId) {
                try {
                    await this.creditsService.releaseHold(userId, holdId);
                } catch (releaseError) {
                    console.error('[EMAIL_FINDER] Failed to release hold on error:', releaseError);
                }
            }
            
            return this.errorResponse('Email lookup failed');
        }
    }
    
    // ==================== RATE LIMITING ====================
    
    checkRateLimit(userId) {
        const now = Date.now();
        const hourWindow = 60 * 60 * 1000; // 1 hour in milliseconds
        const key = `${userId}_${Math.floor(now / hourWindow)}`;
        
        const current = this.rateLimitTracker.get(key) || 0;
        
        if (current >= this.config.rateLimit) {
            const nextWindow = Math.ceil(now / hourWindow) * hourWindow;
            const retryAfterMs = nextWindow - now;
            const retryAfterMin = Math.ceil(retryAfterMs / (60 * 1000));
            
            return {
                allowed: false,
                retryAfter: retryAfterMin
            };
        }
        
        this.rateLimitTracker.set(key, current + 1);
        
        // Clean old entries (keep only last 2 hours)
        const oldestKey = Math.floor((now - 2 * hourWindow) / hourWindow);
        for (const [trackerKey] of this.rateLimitTracker) {
            const keyTime = parseInt(trackerKey.split('_')[1]);
            if (keyTime < oldestKey) {
                this.rateLimitTracker.delete(trackerKey);
            }
        }
        
        return { allowed: true };
    }
    
    // ==================== DATABASE OPERATIONS ====================
    
    async getMessage(userId, messageId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    id, user_id, target_name, target_url, target_profile_url,
                    target_first_name, target_title, target_company,
                    data_json, created_at
                FROM message_logs 
                WHERE id = $1 AND user_id = $2
            `, [messageId, userId]);
            
            if (result.rows.length === 0) {
                return {
                    success: false,
                    error: 'Message not found or access denied'
                };
            }
            
            return {
                success: true,
                data: result.rows[0]
            };
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Database error getting message:', error);
            return {
                success: false,
                error: 'Database error'
            };
        }
    }
    
    async updateMessageWithResult(messageId, snovResult) {
        try {
            const emailFinderData = {
                email: snovResult.email || null,
                status: snovResult.status,
                verified_at: snovResult.status === 'verified' ? new Date().toISOString() : null,
                snov_confidence: snovResult.confidence || null,
                lookup_method: snovResult.method || null
            };
            
            // Update the data_json field with email finder results
            const result = await this.pool.query(`
                UPDATE message_logs 
                SET 
                    data_json = COALESCE(data_json, '{}'::jsonb) || jsonb_build_object('email_finder', $1::jsonb),
                    updated_at = NOW()
                WHERE id = $2
                RETURNING id
            `, [JSON.stringify(emailFinderData), messageId]);
            
            if (result.rows.length === 0) {
                return {
                    success: false,
                    error: 'Failed to update message'
                };
            }
            
            return { success: true };
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Database error updating message:', error);
            return {
                success: false,
                error: 'Database update failed'
            };
        }
    }
    
    // ==================== SNOV.IO API OPERATIONS ====================
    
    async performSnovLookup(lookupData) {
        try {
            // Get access token
            const token = await this.getAccessToken();
            if (!token) {
                return {
                    status: 'error',
                    error: 'Authentication failed'
                };
            }
            
            console.log(`[EMAIL_FINDER] Looking up email for: ${lookupData.firstName} ${lookupData.lastName} at ${lookupData.domain}`);
            
            // 1. Find email
            const findResult = await this.findEmail(token, lookupData);
            if (!findResult.success || !findResult.email) {
                return {
                    status: 'not_found',
                    method: 'find_email'
                };
            }
            
            console.log(`[EMAIL_FINDER] Found potential email: ${this.maskEmail(findResult.email)}`);
            
            // 2. Verify email
            const verifyResult = await this.verifyEmail(token, findResult.email);
            if (!verifyResult.success) {
                return {
                    status: 'error',
                    error: 'Verification failed',
                    method: 'verify_email'
                };
            }
            
            if (verifyResult.status === 'valid') {
                console.log(`[EMAIL_FINDER] Email verified successfully`);
                return {
                    status: 'verified',
                    email: findResult.email,
                    confidence: verifyResult.confidence,
                    method: 'find_and_verify'
                };
            } else {
                return {
                    status: 'not_found',
                    method: 'verification_failed'
                };
            }
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Snov.io lookup error:', error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }
    
    async getAccessToken() {
        // Check if we have a valid cached token
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }
        
        try {
            const response = await this.makeRequest(this.endpoints.auth, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret
                })
            });
            
            if (response.access_token) {
                this.accessToken = response.access_token;
                // Token expires in 1 hour, cache for 55 minutes to be safe
                this.tokenExpiry = Date.now() + (55 * 60 * 1000);
                return this.accessToken;
            }
            
            console.error('[EMAIL_FINDER] No access token in response:', response);
            return null;
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Auth error:', error);
            return null;
        }
    }
    
    async findEmail(token, lookupData) {
        try {
            const requestBody = {
                firstName: lookupData.firstName,
                lastName: lookupData.lastName,
                domain: lookupData.domain
            };
            
            const response = await this.makeRequest(this.endpoints.findEmail, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            // Handle different response formats from Snov.io
            let email = null;
            
            if (response.data && response.data.length > 0) {
                // Array format - take first result
                email = response.data[0].email;
            } else if (response.email) {
                // Direct email field
                email = response.email;
            } else if (response.emails && response.emails.length > 0) {
                // Emails array - take first
                email = response.emails[0];
            }
            
            if (email && this.isValidEmail(email)) {
                return {
                    success: true,
                    email: email
                };
            }
            
            return {
                success: false,
                error: 'No valid email found'
            };
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Find email error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async verifyEmail(token, email) {
        try {
            // Start verification
            const startResponse = await this.makeRequest(this.endpoints.verifyStart, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    emails: [email]
                })
            });
            
            if (!startResponse.task_hash) {
                throw new Error('No task hash received from verification start');
            }
            
            // Poll for results (with timeout)
            const maxAttempts = 10;
            const pollInterval = 1000; // 1 second
            
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await this.sleep(pollInterval);
                
                const resultResponse = await this.makeRequest(
                    `${this.endpoints.verifyResult}?task_hash=${startResponse.task_hash}`,
                    {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );
                
                if (resultResponse.data && resultResponse.data.length > 0) {
                    const result = resultResponse.data[0];
                    return {
                        success: true,
                        status: this.normalizeVerificationStatus(result.status),
                        confidence: result.confidence || 'unknown'
                    };
                }
                
                // If still processing, continue polling
                if (resultResponse.status === 'processing') {
                    continue;
                }
                
                // If error or completed but no data, break
                break;
            }
            
            return {
                success: false,
                error: 'Verification timeout'
            };
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Verify email error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // ==================== HELPER METHODS ====================
    
    extractLookupData(messageData) {
        try {
            // Try to extract from various fields in the message
            let firstName = messageData.target_first_name;
            let lastName = null;
            let domain = null;
            
            // Extract name from target_name if first_name not available
            if (!firstName && messageData.target_name) {
                const nameParts = messageData.target_name.trim().split(' ');
                firstName = nameParts[0];
                lastName = nameParts.slice(1).join(' ');
            }
            
            // Extract domain from company or URL
            if (messageData.target_company) {
                domain = this.extractDomainFromCompany(messageData.target_company);
            }
            
            // Try to extract from LinkedIn URL as fallback
            if (!domain && messageData.target_profile_url) {
                domain = this.extractDomainFromLinkedIn(messageData.target_profile_url);
            }
            
            // Validate we have minimum required data
            if (!firstName) {
                return {
                    success: false,
                    error: 'No target name found'
                };
            }
            
            if (!domain) {
                return {
                    success: false,
                    error: 'No company domain found'
                };
            }
            
            return {
                success: true,
                data: {
                    firstName: firstName,
                    lastName: lastName || '',
                    domain: domain,
                    company: messageData.target_company || 'Unknown'
                }
            };
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Error extracting lookup data:', error);
            return {
                success: false,
                error: 'Failed to extract lookup data'
            };
        }
    }
    
    extractDomainFromCompany(company) {
        // Simple domain extraction - can be enhanced
        const cleanCompany = company.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '')
            .replace(/(inc|llc|corp|ltd|company|co)$/, '');
        
        return `${cleanCompany}.com`;
    }
    
    extractDomainFromLinkedIn(linkedinUrl) {
        // Extract company from LinkedIn URL if possible
        // This is a basic implementation - could be enhanced
        try {
            const url = new URL(linkedinUrl);
            if (url.pathname.includes('/company/')) {
                const companySlug = url.pathname.split('/company/')[1].split('/')[0];
                return `${companySlug}.com`;
            }
        } catch (e) {
            // Invalid URL, ignore
        }
        return null;
    }
    
    isAlreadyVerified(messageData) {
        try {
            const emailFinder = messageData.data_json?.email_finder;
            return emailFinder && emailFinder.status === 'verified' && emailFinder.email;
        } catch (error) {
            return false;
        }
    }
    
    normalizeVerificationStatus(snovStatus) {
        // Normalize Snov.io status to our internal status
        const statusMap = {
            'valid': 'valid',
            'invalid': 'invalid',
            'unverifiable': 'unverifiable',
            'unknown': 'unknown'
        };
        
        return statusMap[snovStatus?.toLowerCase()] || 'unknown';
    }
    
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    maskEmail(email) {
        if (!email) return 'unknown';
        const [local, domain] = email.split('@');
        const maskedLocal = local.length > 3 
            ? local.substring(0, 1) + '*'.repeat(local.length - 2) + local.slice(-1)
            : local.substring(0, 1) + '*'.repeat(local.length - 1);
        return `${maskedLocal}@${domain}`;
    }
    
    async makeRequest(url, options) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
            
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timeout');
            }
            throw error;
        }
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    errorResponse(message) {
        return {
            success: false,
            status: 'error',
            error: message
        };
    }
    
    // ==================== LOGGING & MONITORING ====================
    
    logUsage(userId, messageId, status, creditsUsed, latencyMs) {
        const logData = {
            timestamp: new Date().toISOString(),
            user_id: userId,
            message_id: messageId,
            status: status,
            credits_delta: creditsUsed,
            latency_ms: latencyMs
        };
        
        if (this.config.logLevel === 'info' || this.config.logLevel === 'debug') {
            console.log('[EMAIL_FINDER_USAGE]', JSON.stringify(logData));
        }
    }
    
    // ==================== ADMIN SUPPORT ====================
    
    async getRecentAttempts(limit = 50) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    ml.id as message_id,
                    ml.user_id,
                    ml.target_name,
                    ml.target_company,
                    ml.data_json->>'email_finder' as email_finder_data,
                    ml.created_at,
                    ml.updated_at,
                    u.email as user_email
                FROM message_logs ml
                LEFT JOIN users u ON ml.user_id = u.id
                WHERE ml.data_json ? 'email_finder'
                ORDER BY ml.updated_at DESC
                LIMIT $1
            `, [limit]);
            
            return {
                success: true,
                attempts: result.rows.map(row => ({
                    messageId: row.message_id,
                    userId: row.user_id,
                    userEmail: row.user_email,
                    targetName: row.target_name,
                    targetCompany: row.target_company,
                    emailFinderData: JSON.parse(row.email_finder_data || '{}'),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                }))
            };
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Error getting recent attempts:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = EmailFinderService;
