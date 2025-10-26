// emailFinderForPage.js - Email Finder for Email Finder Page
// Purpose: Find emails + full profile data (name, title, company) from LinkedIn URLs
// API: Snov.io v2 LinkedIn Profile Enrichment (/v2/li-profiles-by-urls/*)
// Database: Saves to email_finder_searches table (not target_profiles)
// Credits: 2 credits per search (managed internally)
// Version: 1.0.0

const { pool } = require('./utils/database');
const { createCreditHold, completeOperation, releaseCreditHold, checkUserCredits } = require('./credits');
const logger = require('./utils/logger');
const axios = require('axios');

class EmailFinderForPage {
    constructor() {
        // Feature flags from environment
        this.enabled = process.env.EMAIL_FINDER_ENABLED === 'true';
        this.timeoutMs = parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 15000; // Longer timeout for v2 API
        this.costPerSearch = parseFloat(process.env.EMAIL_FINDER_COST_PER_SUCCESS_CREDITS) || 2.0;
        
        // Snov.io API configuration
        this.snovClientId = process.env.SNOV_CLIENT_ID;
        this.snovClientSecret = process.env.SNOV_CLIENT_SECRET;
        this.snovApiKey = process.env.SNOV_API_KEY;
        this.snovBaseUrl = 'https://api.snov.io';
        
        // Check if we have credentials
        this.hasCredentials = !!(this.snovApiKey || (this.snovClientId && this.snovClientSecret));
        
        logger.success('🚀 Email Finder For Page initialized (v2 LinkedIn Profile Enrichment)');
        console.log('Email Finder For Page Config:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSearch: this.costPerSearch,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            apiVersion: 'v2 - LinkedIn Profile Enrichment',
            database: 'email_finder_searches table'
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

    // Save complete profile data to email_finder_searches table
    async saveToEmailFinderSearches(userId, linkedinUrl, profileData) {
        try {
            logger.info(`[EMAIL_FINDER_PAGE] Saving to email_finder_searches - URL: ${linkedinUrl}`);
            
            const result = await pool.query(`
                INSERT INTO email_finder_searches (
                    user_id, 
                    linkedin_url, 
                    full_name, 
                    first_name, 
                    last_name, 
                    job_title, 
                    company, 
                    email, 
                    verification_status, 
                    searched_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
                RETURNING id, full_name, email, verification_status
            `, [
                userId,
                linkedinUrl,
                profileData.fullName || null,
                profileData.firstName || null,
                profileData.lastName || null,
                profileData.jobTitle || null,
                profileData.company || null,
                profileData.email || null,
                profileData.verificationStatus || 'unknown'
            ]);
            
            logger.success(`[EMAIL_FINDER_PAGE] ✅ Saved to email_finder_searches:`, result.rows[0]);

            return {
                success: true,
                data: result.rows[0],
                message: 'Profile data saved successfully'
            };

        } catch (error) {
            // Check for duplicate entry
            if (error.code === '23505') { // Unique constraint violation
                logger.warn(`[EMAIL_FINDER_PAGE] ⚠️ Duplicate entry - user already searched this URL`);
                return {
                    success: false,
                    error: 'duplicate_search',
                    message: 'You have already searched this LinkedIn profile'
                };
            }
            
            logger.error('[EMAIL_FINDER_PAGE] Error saving to email_finder_searches:', error);
            return {
                success: false,
                error: error.message,
                message: 'Failed to save search results'
            };
        }
    }

    // Check if user already searched this URL
    async checkDuplicateSearch(userId, linkedinUrl) {
        try {
            const result = await pool.query(`
                SELECT id, email, verification_status, searched_at 
                FROM email_finder_searches 
                WHERE user_id = $1 AND linkedin_url = $2
                LIMIT 1
            `, [userId, linkedinUrl]);

            if (result.rows.length > 0) {
                return {
                    isDuplicate: true,
                    existingSearch: result.rows[0]
                };
            }

            return { isDuplicate: false };

        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] Error checking duplicate:', error);
            return { isDuplicate: false }; // Allow search on error
        }
    }

    // Main function: Find email + profile data from LinkedIn URL
    async findEmailForPage(userId, linkedinUrl) {
        try {
            logger.info(`[EMAIL_FINDER_PAGE] Starting search - User ${userId}, URL ${linkedinUrl}`);

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

            // Check for duplicate search
            const duplicateCheck = await this.checkDuplicateSearch(userId, linkedinUrl);
            if (duplicateCheck.isDuplicate) {
                logger.warn(`[EMAIL_FINDER_PAGE] ⚠️ Duplicate search detected`);
                return {
                    success: false,
                    error: 'duplicate_search',
                    message: 'You have already searched this LinkedIn profile',
                    existingData: duplicateCheck.existingSearch
                };
            }

            // Check user credits before processing
            const creditCheck = await checkUserCredits(userId, 'email_verification');
            if (!creditCheck.success || !creditCheck.hasCredits) {
                return {
                    success: false,
                    error: 'insufficient_credits',
                    message: `You need ${this.costPerSearch} credits to find an email. You have ${creditCheck.currentCredits || 0} credits.`,
                    currentCredits: creditCheck.currentCredits || 0,
                    requiredCredits: this.costPerSearch
                };
            }

            // Create credit hold
            logger.info(`[EMAIL_FINDER_PAGE] 💳 Creating credit hold for ${this.costPerSearch} credits`);
            const holdResult = await createCreditHold(userId, 'email_verification', {
                linkedinUrl: linkedinUrl
            });

            if (!holdResult.success) {
                return {
                    success: false,
                    error: 'credit_hold_failed',
                    message: holdResult.error === 'insufficient_credits' 
                        ? `Insufficient credits: need ${this.costPerSearch}, have ${holdResult.currentCredits}`
                        : 'Failed to reserve credits for this operation'
                };
            }

            const holdId = holdResult.holdId;
            logger.success(`[EMAIL_FINDER_PAGE] ✅ Credit hold created: ${holdId}`);

            try {
                // Call Snov.io v2 LinkedIn Profile Enrichment API
                logger.success('[EMAIL_FINDER_PAGE] 🚀 Calling Snov.io v2 API...');
                const profileResult = await this.enrichLinkedInProfile(linkedinUrl);

                if (profileResult.success && profileResult.profileData) {
                    const profileData = profileResult.profileData;
                    
                    // Save complete profile data to email_finder_searches
                    const saveResult = await this.saveToEmailFinderSearches(
                        userId,
                        linkedinUrl,
                        profileData
                    );

                    if (!saveResult.success) {
                        // If save failed due to duplicate, release hold and return error
                        if (saveResult.error === 'duplicate_search') {
                            await releaseCreditHold(userId, holdId, 'duplicate_search');
                            return {
                                success: false,
                                error: 'duplicate_search',
                                message: saveResult.message
                            };
                        }
                    }

                    // Complete payment and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        profileData: profileData,
                        saved: saveResult.success
                    });

                    logger.success(`[EMAIL_FINDER_PAGE] ✅ Search complete (${this.costPerSearch} credits charged)`);

                    // Wait for email verification if email found
                    let verificationStatus = profileData.verificationStatus || 'unknown';
                    if (profileData.email) {
                        try {
                            const { emailVerifier } = require('./emailVerifier');
                            logger.info(`[EMAIL_FINDER_PAGE] ⏳ Verifying email...`);
                            const verifyResult = await emailVerifier.verifyEmail(profileData.email, userId, linkedinUrl);
                            verificationStatus = verifyResult.status || 'unknown';
                            
                            // Update verification status in database
                            await pool.query(`
                                UPDATE email_finder_searches 
                                SET verification_status = $1 
                                WHERE user_id = $2 AND linkedin_url = $3
                            `, [verificationStatus, userId, linkedinUrl]);
                            
                            logger.success(`[EMAIL_FINDER_PAGE] ✅ Verification complete: ${verificationStatus}`);
                        } catch (verifierError) {
                            logger.error('[EMAIL_FINDER_PAGE] Verification failed:', verifierError);
                            verificationStatus = 'unknown';
                        }
                    }

                    return {
                        success: true,
                        profileData: {
                            ...profileData,
                            verificationStatus: verificationStatus
                        },
                        creditsCharged: this.costPerSearch,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSearch,
                        message: 'Profile data and email found successfully',
                        saved: saveResult.success
                    };

                } else {
                    // No profile data found - still charge credits
                    logger.info(`[EMAIL_FINDER_PAGE] ⚠️ Profile data not found - charging credits`);
                    
                    // Save "not found" result
                    await this.saveToEmailFinderSearches(userId, linkedinUrl, {
                        fullName: null,
                        firstName: null,
                        lastName: null,
                        jobTitle: null,
                        company: null,
                        email: null,
                        verificationStatus: 'not_found'
                    });
                    
                    // Charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        status: 'not_found',
                        message: 'Search completed - no profile data found'
                    });

                    logger.info(`[EMAIL_FINDER_PAGE] ⚠️ Profile not found (${this.costPerSearch} credits charged)`);

                    return {
                        success: true,
                        error: 'profile_not_found',
                        status: 'not_found',
                        creditsCharged: this.costPerSearch,
                        newBalance: paymentResult.newBalance,
                        message: 'Search completed - no profile data found for this LinkedIn URL'
                    };
                }

            } catch (processingError) {
                // Processing error: Release credit hold
                logger.error('[EMAIL_FINDER_PAGE] 🚨 Processing error:', processingError);
                await releaseCreditHold(userId, holdId, 'processing_error');

                return {
                    success: false,
                    error: 'processing_error',
                    message: 'Temporary issue finding profile data. Please try again.',
                    creditsCharged: 0,
                    errorDetails: processingError.message
                };
            }

        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] System error:', error);
            return {
                success: false,
                error: 'system_error',
                message: 'System error occurred. Please try again.',
                details: error.message
            };
        }
    }

    // Snov.io v2 LinkedIn Profile Enrichment API
    async enrichLinkedInProfile(linkedinUrl) {
        logger.info('[EMAIL_FINDER_PAGE] 🌐 Enriching LinkedIn profile with Snov.io v2 API...');
        logger.info(`[EMAIL_FINDER_PAGE] LinkedIn URL: ${linkedinUrl}`);
        
        try {
            // Get access token
            logger.info('[EMAIL_FINDER_PAGE] 📝 Getting Snov.io access token...');
            const accessToken = await this.getSnovAccessToken();
            logger.success('[EMAIL_FINDER_PAGE] ✅ Access token retrieved');
            
            // Step 1: Start profile enrichment
            logger.info('[EMAIL_FINDER_PAGE] 📤 Step 1: Starting profile enrichment...');
            const startResponse = await axios.post(
                `${this.snovBaseUrl}/v2/li-profiles-by-urls/start`,
                {
                    'urls[]': [linkedinUrl]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: this.timeoutMs
                }
            );
            
            logger.success('[EMAIL_FINDER_PAGE] ✅ Step 1 complete: Enrichment started');
            logger.debug('[EMAIL_FINDER_PAGE] Start response:', startResponse.data);
            
            const taskHash = startResponse.data?.data?.task_hash;
            if (!taskHash) {
                throw new Error('No task_hash returned from Snov.io');
            }
            
            // Wait for Snov.io to process (v2 API needs more time)
            logger.info('[EMAIL_FINDER_PAGE] ⏳ Waiting 8 seconds for Snov.io to process...');
            await new Promise(resolve => setTimeout(resolve, 8000)); // 8 second delay
            
            // Step 2: Get enrichment results
            logger.info('[EMAIL_FINDER_PAGE] 📥 Step 2: Retrieving enrichment results...');
            const resultResponse = await axios.get(
                `${this.snovBaseUrl}/v2/li-profiles-by-urls/result`,
                {
                    params: { task_hash: taskHash },
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    timeout: this.timeoutMs
                }
            );
            
            logger.success('[EMAIL_FINDER_PAGE] ✅ Step 2 complete: Results received');
            logger.debug('[EMAIL_FINDER_PAGE] Result response:', resultResponse.data);
            
            const responseData = resultResponse.data;
            
            // Check if processing is complete
            if (responseData.data?.status === 'in_progress') {
                logger.warn('[EMAIL_FINDER_PAGE] ⚠️ Still processing - need to wait longer');
                // Wait additional time and retry
                await new Promise(resolve => setTimeout(resolve, 5000));
                const retryResponse = await axios.get(
                    `${this.snovBaseUrl}/v2/li-profiles-by-urls/result`,
                    {
                        params: { task_hash: taskHash },
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        timeout: this.timeoutMs
                    }
                );
                return this.parseProfileData(retryResponse.data);
            }
            
            return this.parseProfileData(responseData);
            
        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] Error enriching profile:', error.response?.data || error.message);
            throw error;
        }
    }

    // Parse Snov.io v2 API response and extract profile data
    parseProfileData(responseData) {
        try {
            logger.info('[EMAIL_FINDER_PAGE] 📊 Parsing profile data...');
            
            if (!responseData.success || !responseData.data) {
                logger.warn('[EMAIL_FINDER_PAGE] ⚠️ No data in response');
                return {
                    success: false,
                    profileData: null
                };
            }
            
            const profiles = responseData.data.profiles || [];
            if (profiles.length === 0) {
                logger.warn('[EMAIL_FINDER_PAGE] ⚠️ No profiles returned');
                return {
                    success: false,
                    profileData: null
                };
            }
            
            const profile = profiles[0]; // Get first profile
            
            // Extract data from response
            const firstName = profile.firstName || null;
            const lastName = profile.lastName || null;
            const fullName = profile.name || (firstName && lastName ? `${firstName} ${lastName}` : null);
            
            // Get job title and company from currentJob array
            const currentJob = profile.currentJob?.[0] || {};
            const jobTitle = currentJob.position || profile.position || null;
            const company = currentJob.companyName || profile.companyName || null;
            
            // Get email and verification status
            const emails = profile.emails || [];
            let email = null;
            let emailStatus = 'unknown';
            
            if (emails.length > 0) {
                const primaryEmail = emails[0];
                email = primaryEmail.email || null;
                
                // Map Snov.io status to our status
                if (primaryEmail.emailStatus === 'valid') {
                    emailStatus = 'valid';
                } else if (primaryEmail.emailStatus === 'invalid' || primaryEmail.emailStatus === 'not_valid') {
                    emailStatus = 'invalid';
                } else {
                    emailStatus = 'unknown';
                }
            }
            
            const profileData = {
                fullName,
                firstName,
                lastName,
                jobTitle,
                company,
                email,
                verificationStatus: emailStatus,
                industry: profile.industry || null,
                country: profile.country || null,
                locality: profile.locality || null,
                companyLinkedInUrl: profile.companyLinkedInUrl || null,
                companyDomain: profile.companyDomain || null
            };
            
            logger.success('[EMAIL_FINDER_PAGE] ✅ Profile data parsed successfully');
            logger.debug('[EMAIL_FINDER_PAGE] Parsed data:', profileData);
            
            return {
                success: true,
                profileData: profileData
            };
            
        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] Error parsing profile data:', error);
            return {
                success: false,
                profileData: null
            };
        }
    }

    // Health check
    async healthCheck() {
        return {
            service: 'email_finder_for_page',
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            apiVersion: 'v2',
            database: 'email_finder_searches'
        };
    }
}

// Create singleton instance
const emailFinderForPage = new EmailFinderForPage();

// Export singleton and class
module.exports = {
    emailFinderForPage,
    EmailFinderForPage,
    findEmailForPage: (userId, linkedinUrl) => emailFinderForPage.findEmailForPage(userId, linkedinUrl),
    isEmailFinderForPageEnabled: () => emailFinderForPage.enabled
};
