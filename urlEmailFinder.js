// urlEmailFinder.js - Email Finder for Email Finder Page
// Purpose: Find emails + full profile data (name, title, company) from LinkedIn URLs
// API: Snov.io v2 LinkedIn Profile Enrichment + v2 Email Finder (2 separate calls)
// Database: Saves to email_finder_searches table (not target_profiles)
// Credits: ALWAYS 2 credits per search (managed internally)
// Version: 2.1.0 - Added automatic email verification trigger (urlEmailVerifier)

const { pool } = require('./utils/database');
const { createCreditHold, completeOperation, releaseCreditHold, checkUserCredits } = require('./credits');
const logger = require('./utils/logger');
const axios = require('axios');
const { verifyEmailForUrlFinder } = require('./urlEmailVerifier');

class EmailFinderForPage {
    constructor() {
        // Feature flags from environment
        this.enabled = process.env.EMAIL_FINDER_ENABLED === 'true';
        this.timeoutMs = parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 15000;
        this.costPerSearch = 2.0; // ALWAYS 2 credits
        
        // Snov.io API configuration
        this.snovClientId = process.env.SNOV_CLIENT_ID;
        this.snovClientSecret = process.env.SNOV_CLIENT_SECRET;
        this.snovApiKey = process.env.SNOV_API_KEY;
        this.snovBaseUrl = 'https://api.snov.io';
        
        // Check if we have credentials
        this.hasCredentials = !!(this.snovApiKey || (this.snovClientId && this.snovClientSecret));
        
        logger.success('🚀 Email Finder For Page initialized (v2 Profile + Email API)');
        console.log('Email Finder For Page Config:', {
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            timeoutMs: this.timeoutMs,
            costPerSearch: this.costPerSearch,
            authMethod: this.snovApiKey ? 'API Key' : 'OAuth',
            apiVersion: 'v2 - Profile Enrichment + Email Finder',
            database: 'email_finder_searches table'
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
                    search_date,
                    credits_used
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, 2)
                RETURNING id, full_name, job_title, company, email, verification_status
            `, [
                userId,
                linkedinUrl,
                profileData.fullName || null,
                profileData.firstName || null,
                profileData.lastName || null,
                profileData.jobTitle || null,
                profileData.company || null,
                profileData.email || null,
                profileData.verificationStatus || 'not_found'
            ]);
            
            logger.success(`[EMAIL_FINDER_PAGE] ✅ Saved to email_finder_searches:`, result.rows[0]);

            return {
                success: true,
                data: result.rows[0],
                message: 'Profile data saved successfully'
            };

        } catch (error) {
            // Check for duplicate entry
            if (error.code === '23505') {
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
                SELECT id, full_name, email, verification_status, search_date 
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
            return { isDuplicate: false };
        }
    }

    // Main function: Find email + profile data from LinkedIn URL
    async findEmailForPage(userId, linkedinUrl) {
        let creditHoldId = null;

        try {
            logger.info(`[EMAIL_FINDER_PAGE] 🔍 Starting search - User ${userId}, URL ${linkedinUrl}`);

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

            // Check for duplicate search BEFORE holding credits
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
                    message: 'Insufficient credits. Please purchase more credits to continue.',
                    availableCredits: creditCheck.availableCredits || 0
                };
            }

            // Hold 2 credits (ALWAYS 2 credits regardless of outcome)
            logger.info(`[EMAIL_FINDER_PAGE] 💳 Holding 2 credits for user ${userId}`);
            const holdResult = await createCreditHold(
                userId,
                this.costPerSearch,
                'email_verification',
                'Email Finder Page search'
            );

            if (!holdResult.success) {
                logger.error('[EMAIL_FINDER_PAGE] Failed to hold credits:', holdResult.error);
                return {
                    success: false,
                    error: 'credit_hold_failed',
                    message: 'Failed to reserve credits for search'
                };
            }

            creditHoldId = holdResult.holdId;
            logger.success(`[EMAIL_FINDER_PAGE] ✅ Credits held - Hold ID: ${creditHoldId}`);

            // Get Snov.io access token
            const accessToken = await this.getSnovAccessToken();

            // STEP 1: Get profile data from LinkedIn URL (v2 Profile Enrichment API)
            logger.info('[EMAIL_FINDER_PAGE] 📋 Step 1/2: Getting profile data...');
            const profileResult = await this.enrichProfileFromLinkedIn(linkedinUrl, accessToken);

            if (!profileResult.success || !profileResult.profileData) {
                logger.error('[EMAIL_FINDER_PAGE] Failed to get profile data');
                
                // Release credits on failure
                if (creditHoldId) {
                    await releaseCreditHold(creditHoldId);
                    logger.info('[EMAIL_FINDER_PAGE] 💳 Credits released due to profile data failure');
                }

                return {
                    success: false,
                    error: 'profile_not_found',
                    message: 'Could not find profile data for this LinkedIn URL'
                };
            }

            const profileData = profileResult.profileData;
            logger.success('[EMAIL_FINDER_PAGE] ✅ Profile data retrieved:', {
                name: profileData.fullName,
                title: profileData.jobTitle,
                company: profileData.company
            });

            // STEP 2: Find email using name + company domain (v2 Email Finder API)
            logger.info('[EMAIL_FINDER_PAGE] 📧 Step 2/2: Finding email address...');
            
            let emailData = {
                email: null,
                verificationStatus: 'not_found'
            };

            // Only try to find email if we have the required data
            if (profileData.firstName && profileData.lastName && profileData.companyDomain) {
                const emailResult = await this.findEmailByNameAndDomain(
                    profileData.firstName,
                    profileData.lastName,
                    profileData.companyDomain,
                    accessToken
                );

                if (emailResult.success && emailResult.email) {
                    emailData = {
                        email: emailResult.email,
                        verificationStatus: emailResult.verificationStatus
                    };
                    logger.success('[EMAIL_FINDER_PAGE] ✅ Email found:', emailData.email);
                } else {
                    logger.warn('[EMAIL_FINDER_PAGE] ⚠️ Email not found - will save profile with status "not_found"');
                }
            } else {
                logger.warn('[EMAIL_FINDER_PAGE] ⚠️ Missing data for email search (need firstName, lastName, companyDomain)');
            }

            // Combine profile data + email data
            const completeData = {
                ...profileData,
                email: emailData.email,
                verificationStatus: emailData.verificationStatus
            };

            // Save to database (ALWAYS save even if email not found)
            const saveResult = await this.saveToEmailFinderSearches(userId, linkedinUrl, completeData);

            if (!saveResult.success) {
                // Release credits if save failed
                if (creditHoldId) {
                    await releaseCreditHold(creditHoldId);
                    logger.info('[EMAIL_FINDER_PAGE] 💳 Credits released due to save failure');
                }

                return saveResult;
            }

            // Complete the credit operation (consume the 2 credits)
            logger.info(`[EMAIL_FINDER_PAGE] 💳 Completing credit operation - Hold ID: ${creditHoldId}`);
            await completeOperation(creditHoldId);
            logger.success('[EMAIL_FINDER_PAGE] ✅ Credits charged: 2 credits');

            // Trigger email verification in background (if email was found)
            if (completeData.email) {
                logger.info('[EMAIL_FINDER_PAGE] 🔍 Triggering background email verification...');
                // Don't await - let it run in background
                verifyEmailForUrlFinder(completeData.email, userId, linkedinUrl)
                    .then(result => {
                        logger.success('[EMAIL_FINDER_PAGE] ✅ Background verification completed:', result.status);
                    })
                    .catch(err => {
                        logger.warn('[EMAIL_FINDER_PAGE] ⚠️ Background verification failed:', err.message);
                    });
            }

            // Return success with complete data
            return {
                success: true,
                message: emailData.email 
                    ? 'Email and profile data found successfully'
                    : 'Profile data saved. Email not found.',
                data: {
                    id: saveResult.data.id,
                    fullName: completeData.fullName,
                    firstName: completeData.firstName,
                    lastName: completeData.lastName,
                    jobTitle: completeData.jobTitle,
                    company: completeData.company,
                    email: completeData.email,
                    verificationStatus: completeData.verificationStatus,
                    creditsUsed: 2
                }
            };

        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] ❌ Error in findEmailForPage:', error);

            // Release credits on error
            if (creditHoldId) {
                try {
                    await releaseCreditHold(creditHoldId);
                    logger.info('[EMAIL_FINDER_PAGE] 💳 Credits released due to error');
                } catch (releaseError) {
                    logger.error('[EMAIL_FINDER_PAGE] Error releasing credits:', releaseError);
                }
            }

            return {
                success: false,
                error: 'search_failed',
                message: 'An error occurred during the search. Please try again.'
            };
        }
    }

    // API Call #1: Enrich profile from LinkedIn URL (v2 LinkedIn Profile Enrichment)
    async enrichProfileFromLinkedIn(linkedinUrl, accessToken) {
        try {
            logger.info('[EMAIL_FINDER_PAGE] 🔄 Calling Snov.io v2 Profile Enrichment API...');

            // Step 1: Start the enrichment task
            const startResponse = await axios.post(
                `${this.snovBaseUrl}/v2/li-profiles-by-urls/start`,
                { 'urls[]': [linkedinUrl] },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: this.timeoutMs
                }
            );

            const taskHash = startResponse.data?.data?.task_hash;
            if (!taskHash) {
                logger.error('[EMAIL_FINDER_PAGE] No task hash returned from start endpoint');
                return { success: false, profileData: null };
            }

            logger.info(`[EMAIL_FINDER_PAGE] Task started - Hash: ${taskHash}`);

            // Step 2: Wait for processing (5-10 seconds typical)
            await new Promise(resolve => setTimeout(resolve, 8000));

            // Step 3: Get results
            const resultResponse = await axios.get(
                `${this.snovBaseUrl}/v2/li-profiles-by-urls/result`,
                {
                    params: { task_hash: taskHash },
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: this.timeoutMs
                }
            );

            const responseData = resultResponse.data;

            // Check if still processing
            if (responseData.status === 'in_progress') {
                logger.warn('[EMAIL_FINDER_PAGE] Still processing, waiting additional 5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 5000));

                const retryResponse = await axios.get(
                    `${this.snovBaseUrl}/v2/li-profiles-by-urls/result`,
                    {
                        params: { task_hash: taskHash },
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        timeout: this.timeoutMs
                    }
                );

                return this.parseLinkedInProfileResponse(retryResponse.data);
            }

            return this.parseLinkedInProfileResponse(responseData);

        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] Error enriching profile:', error.response?.data || error.message);
            return { success: false, profileData: null };
        }
    }

    // Parse LinkedIn Profile Enrichment API response
    parseLinkedInProfileResponse(responseData) {
        try {
            logger.info('[EMAIL_FINDER_PAGE] 📊 Parsing LinkedIn profile response...');

            if (responseData.status !== 'completed') {
                logger.warn('[EMAIL_FINDER_PAGE] Response status not completed:', responseData.status);
                return { success: false, profileData: null };
            }

            if (!responseData.data || !Array.isArray(responseData.data) || responseData.data.length === 0) {
                logger.warn('[EMAIL_FINDER_PAGE] No profile data in response');
                return { success: false, profileData: null };
            }

            const profileItem = responseData.data[0];
            const result = profileItem.result;

            if (!result) {
                logger.warn('[EMAIL_FINDER_PAGE] No result object in profile data');
                return { success: false, profileData: null };
            }

            // Extract profile data
            const firstName = result.first_name || null;
            const lastName = result.last_name || null;
            const fullName = result.name || (firstName && lastName ? `${firstName} ${lastName}` : null);

            // Get current position (job title and company)
            let jobTitle = null;
            let company = null;
            let companyDomain = null;

            if (result.positions && Array.isArray(result.positions) && result.positions.length > 0) {
                const currentPosition = result.positions[0];
                jobTitle = currentPosition.title || null;
                company = currentPosition.name || null;
                
                // Extract domain from company URL
                if (currentPosition.url) {
                    try {
                        const url = new URL(currentPosition.url);
                        companyDomain = url.hostname.replace('www.', '');
                    } catch (e) {
                        logger.warn('[EMAIL_FINDER_PAGE] Could not parse company URL');
                    }
                }
            }

            const profileData = {
                fullName,
                firstName,
                lastName,
                jobTitle,
                company,
                companyDomain,
                industry: result.industry || null,
                country: result.country || null,
                location: result.location || null
            };

            logger.success('[EMAIL_FINDER_PAGE] ✅ Profile parsed:', profileData);

            return {
                success: true,
                profileData: profileData
            };

        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] Error parsing LinkedIn profile response:', error);
            return { success: false, profileData: null };
        }
    }

    // API Call #2: Find email by name and domain (v2 Email Finder API)
    async findEmailByNameAndDomain(firstName, lastName, domain, accessToken) {
        try {
            logger.info('[EMAIL_FINDER_PAGE] 🔄 Calling Snov.io v2 Email Finder API...');
            logger.info(`[EMAIL_FINDER_PAGE] Search params: ${firstName} ${lastName} @ ${domain}`);

            // Step 1: Start the email search
            const startResponse = await axios.post(
                `${this.snovBaseUrl}/v2/emails-by-domain-by-name/start`,
                {
                    rows: [{
                        first_name: firstName,
                        last_name: lastName,
                        domain: domain
                    }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.timeoutMs
                }
            );

            const taskHash = startResponse.data?.data?.task_hash;
            if (!taskHash) {
                logger.error('[EMAIL_FINDER_PAGE] No task hash returned from email finder start');
                return { success: false, email: null };
            }

            logger.info(`[EMAIL_FINDER_PAGE] Email search started - Hash: ${taskHash}`);

            // Step 2: Wait for processing
            await new Promise(resolve => setTimeout(resolve, 6000));

            // Step 3: Get results
            const resultResponse = await axios.get(
                `${this.snovBaseUrl}/v2/emails-by-domain-by-name/result`,
                {
                    params: { task_hash: taskHash },
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: this.timeoutMs
                }
            );

            const responseData = resultResponse.data;

            // Check if still processing
            if (responseData.status === 'in_progress') {
                logger.warn('[EMAIL_FINDER_PAGE] Email search still processing, waiting additional 4 seconds...');
                await new Promise(resolve => setTimeout(resolve, 4000));

                const retryResponse = await axios.get(
                    `${this.snovBaseUrl}/v2/emails-by-domain-by-name/result`,
                    {
                        params: { task_hash: taskHash },
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        timeout: this.timeoutMs
                    }
                );

                return this.parseEmailFinderResponse(retryResponse.data);
            }

            return this.parseEmailFinderResponse(responseData);

        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] Error finding email:', error.response?.data || error.message);
            return { success: false, email: null };
        }
    }

    // Parse Email Finder API response
    parseEmailFinderResponse(responseData) {
        try {
            logger.info('[EMAIL_FINDER_PAGE] 📧 Parsing email finder response...');

            if (responseData.status !== 'completed') {
                logger.warn('[EMAIL_FINDER_PAGE] Email search status not completed:', responseData.status);
                return { success: false, email: null };
            }

            if (!responseData.data || !Array.isArray(responseData.data) || responseData.data.length === 0) {
                logger.warn('[EMAIL_FINDER_PAGE] No email data in response');
                return { success: false, email: null };
            }

            const personData = responseData.data[0];
            
            if (!personData.result || !Array.isArray(personData.result) || personData.result.length === 0) {
                logger.warn('[EMAIL_FINDER_PAGE] No email results for person');
                return { success: false, email: null };
            }

            const emailResult = personData.result[0];
            const email = emailResult.email;
            const smtpStatus = emailResult.smtp_status;

            // Map SMTP status to our verification status
            let verificationStatus = 'unknown';
            if (smtpStatus === 'valid') {
                verificationStatus = 'valid';
            } else if (smtpStatus === 'invalid' || smtpStatus === 'not_valid') {
                verificationStatus = 'invalid';
            } else {
                verificationStatus = 'unknown';
            }

            logger.success('[EMAIL_FINDER_PAGE] ✅ Email found:', email, 'Status:', verificationStatus);

            return {
                success: true,
                email: email,
                verificationStatus: verificationStatus
            };

        } catch (error) {
            logger.error('[EMAIL_FINDER_PAGE] Error parsing email finder response:', error);
            return { success: false, email: null };
        }
    }

    // Health check
    async healthCheck() {
        return {
            service: 'email_finder_for_page',
            enabled: this.enabled,
            hasCredentials: this.hasCredentials,
            apiVersion: 'v2 - Profile + Email (2 calls)',
            database: 'email_finder_searches',
            costPerSearch: this.costPerSearch
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
