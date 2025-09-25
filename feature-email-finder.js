// feature-email-finder.js - Snov.io Email Finder & Verification Module
// Silver+ plan restriction, integrates with existing credit system

const fetch = require('node-fetch');

class EmailFinderService {
    constructor(pool, creditsService) {
        this.pool = pool;
        this.creditsService = creditsService;
        
        // Configuration from environment variables with defaults
        this.config = {
            enabled: process.env.EMAIL_FINDER_ENABLED === 'true',
            clientId: process.env.SNOV_CLIENT_ID,
            clientSecret: process.env.SNOV_CLIENT_SECRET,
            timeout: parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 10000,
            rateLimit: parseInt(process.env.EMAIL_FINDER_RATE_LIMIT_PER_HOUR) || 100,
            costCredits: parseInt(process.env.EMAIL_FINDER_COST_PER_SUCCESS_CREDITS) || 2
        };
        
        // Rate limiting tracker
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
            console.log(`[EMAIL_FINDER] Starting lookup - User: ${userId}, Message: ${messageId}`);
            
            // 1. Feature flag check
            if (!this.config.enabled) {
                return this.errorResponse('Email finder feature is currently disabled');
            }
            
            // 2. Check if user has Silver+ plan
            const planCheck = await this.checkUserPlan(userId);
            if (!planCheck.success) {
                return planCheck; // Return the plan restriction error
            }
            
            // 3. Rate limiting check
            const rateLimitCheck = this.checkRateLimit(userId);
            if (!rateLimitCheck.allowed) {
                return this.errorResponse(`Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} minutes`);
            }
            
            // 4. Get and validate message
            const message = await this.getMessage(userId, messageId);
            if (!message.success) {
                return this.errorResponse(message.error);
            }
            
            // 5. Check if already verified (idempotency)
            if (this.isAlreadyVerified(message.data)) {
                console.log(`[EMAIL_FINDER] Email already verified for message ${messageId}`);
                return {
                    success: true,
                    status: 'already_verified',
                    email: message.data.data_json?.email_finder?.email,
                    message: 'Email already verified'
                };
            }
            
            // 6. Create credit hold
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
            
            // 7. Extract lookup data from message
            const lookupData = this.extractLookupData(message.data);
            if (!lookupData.success) {
                await this.creditsService.releaseHold(userId, holdId);
                return this.errorResponse(lookupData.error);
            }
            
            // 8. Perform Snov.io lookup
            const snovResult = await this.performSnovLookup(lookupData.data);
            
            // 9. Update database with result
            const updateResult = await this.updateMessageWithResult(messageId, snovResult);
            if (!updateResult.success) {
                await this.creditsService.releaseHold(userId, holdId);
                return this.errorResponse('Failed to save results');
            }
            
            // 10. Handle credits based on result
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
    
    // ==================== PLAN RESTRICTION ====================
    
    async checkUserPlan(userId) {
        try {
            const result = await this.pool.query(
                'SELECT plan_code FROM users WHERE id = $1',
                [userId]
            );
            
            if (result.rows.length === 0) {
                return this.errorResponse('User not found');
            }
            
            const planCode = result.rows[0].plan_code || 'free';
            
            // Block free users
            if (planCode === 'free') {
                return {
                    success: false,
                    status: 'plan_restriction',
                    error: 'Email finder is available for Silver plan and above',
                    needsUpgrade: true
                };
            }
            
            return { success: true };
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Error checking user plan:', error);
            return this.errorResponse('Failed to verify plan access');
        }
    }
    
    // ==================== RATE LIMITING ====================
    
    checkRateLimit(userId) {
        const now = Date.now();
        const hourWindow = 60 * 60 * 1000; // 1 hour
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
                snov_confidence: snovResult.confidence || null
            };
            
            const result = await this.pool.query(`
                UPDATE message_logs 
                SET 
                    data_json = COALESCE(data_json, '{}'::jsonb) || jsonb_build_object('email_finder', $1::jsonb),
                    updated_at = NOW()
                WHERE id = $2
                RETURNING id
            `, [JSON.stringify(emailFinderData), messageId]);
            
            return { success: result.rows.length > 0 };
            
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
            const token = await this.getAccessToken();
            if (!token) {
                return {
                    status: 'error',
                    error: 'Authentication failed'
                };
            }
            
            console.log(`[EMAIL_FINDER] Looking up: ${lookupData.firstName} at ${lookupData.domain}`);
            
            // 1. Find email
            const findResult = await this.findEmail(token, lookupData);
            if (!findResult.success || !findResult.email) {
                return {
                    status: 'not_found'
                };
            }
            
            console.log(`[EMAIL_FINDER] Found email, verifying...`);
            
            // 2. Verify email
            const verifyResult = await this.verifyEmail(token, findResult.email);
            if (!verifyResult.success) {
                return {
                    status: 'error',
                    error: 'Verification failed'
                };
            }
            
            if (verifyResult.status === 'valid') {
                return {
                    status: 'verified',
                    email: findResult.email,
                    confidence: verifyResult.confidence
                };
            } else {
                return {
                    status: 'not_found'
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
                this.tokenExpiry = Date.now() + (55 * 60 * 1000); // 55 minutes
                return this.accessToken;
            }
            
            return null;
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Auth error:', error);
            return null;
        }
    }
    
    async findEmail(token, lookupData) {
        try {
            const response = await this.makeRequest(this.endpoints.findEmail, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    firstName: lookupData.firstName,
                    lastName: lookupData.lastName || '',
                    domain: lookupData.domain
                })
            });
            
            let email = null;
            
            if (response.data && response.data.length > 0) {
                email = response.data[0].email;
            } else if (response.email) {
                email = response.email;
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
                throw new Error('No task hash received');
            }
            
            // Poll for results
            for (let attempt = 0; attempt < 10; attempt++) {
                await this.sleep(1000); // Wait 1 second
                
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
                
                if (resultResponse.status === 'processing') {
                    continue;
                }
                
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
            let firstName = messageData.target_first_name;
            let lastName = null;
            let domain = null;
            
            // Extract name from target_name if needed
            if (!firstName && messageData.target_name) {
                const nameParts = messageData.target_name.trim().split(' ');
                firstName = nameParts[0];
                lastName = nameParts.slice(1).join(' ');
            }
            
            // Extract domain from company
            if (messageData.target_company) {
                domain = this.extractDomainFromCompany(messageData.target_company);
            }
            
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
                    domain: domain
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
        const cleanCompany = company.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '')
            .replace(/(inc|llc|corp|ltd|company|co)$/, '');
        
        return `${cleanCompany}.com`;
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
    
    logUsage(userId, messageId, status, creditsUsed, latencyMs) {
        console.log('[EMAIL_FINDER_USAGE]', JSON.stringify({
            timestamp: new Date().toISOString(),
            user_id: userId,
            message_id: messageId,
            status: status,
            credits_delta: creditsUsed,
            latency_ms: latencyMs
        }));
    }
}

module.exports = EmailFinderService;
