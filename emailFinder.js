// emailFinder.js - Email Finding Module with Credit Integration
// STAGE 3: Dummy mode with full credit system integration
// STAGE 4: Will add real Snov.io API integration
// Handles email finding and verification with "charge only on success" policy

const { pool } = require('./utils/database');
const { createCreditHold, completeOperation, releaseCreditHold, checkUserCredits } = require('./credits');

class EmailFinder {
    constructor() {
        // Feature flags from environment
        this.enabled = process.env.EMAIL_FINDER_ENABLED === 'true';
        this.dummyMode = process.env.EMAIL_FINDER_DUMMY_MODE === 'true';
        this.timeoutMs = parseInt(process.env.EMAIL_FINDER_TIMEOUT_MS) || 10000;
        this.rateLimitPerMin = parseInt(process.env.EMAIL_FINDER_RATE_LIMIT_PER_MIN) || 10;
        this.costPerSuccess = parseFloat(process.env.EMAIL_FINDER_COST_PER_SUCCESS_CREDITS) || 2.0;
        
        console.log('📧 Email Finder initialized:', {
            enabled: this.enabled,
            dummyMode: this.dummyMode,
            timeoutMs: this.timeoutMs,
            costPerSuccess: this.costPerSuccess
        });
    }

    // Main entry point: Find and verify email for a target profile
    async findEmail(userId, targetProfileId) {
        try {
            console.log(`📧 Email finder request: User ${userId}, Target ${targetProfileId}`);

            // Check if feature is enabled
            if (!this.enabled) {
                return {
                    success: false,
                    error: 'email_finder_disabled',
                    message: 'Email finder feature is currently disabled'
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
            console.log(`💳 Creating credit hold for ${this.costPerSuccess} credits`);
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

                // Find email (dummy or real depending on mode)
                const emailResult = this.dummyMode 
                    ? await this.findEmailDummy(targetProfile.data)
                    : await this.findEmailReal(targetProfile.data);

                if (emailResult.success && emailResult.email && emailResult.status === 'verified') {
                    // Success: Update database and complete payment
                    await this.updateEmailStatus(
                        targetProfileId, 
                        emailResult.email, 
                        emailResult.status, 
                        new Date()
                    );

                    // Complete operation and charge credits
                    const paymentResult = await completeOperation(userId, holdId, {
                        email: emailResult.email,
                        status: emailResult.status,
                        processingTimeMs: emailResult.processingTimeMs || null
                    });

                    console.log(`✅ Email verification successful: ${emailResult.email} (${this.costPerSuccess} credits charged)`);

                    return {
                        success: true,
                        email: emailResult.email,
                        status: emailResult.status,
                        creditsCharged: this.costPerSuccess,
                        newBalance: paymentResult.newBalance || creditCheck.currentCredits - this.costPerSuccess,
                        message: 'Email found and verified successfully'
                    };

                } else {
                    // Failed to find/verify email: Update status and release hold
                    const finalStatus = emailResult.email ? 'unverified' : 'not_found';
                    await this.updateEmailStatus(
                        targetProfileId, 
                        emailResult.email || null, 
                        finalStatus, 
                        null
                    );

                    // Release credit hold (no charge on failure)
                    await releaseCreditHold(userId, holdId, 'email_not_verified');

                    console.log(`❌ Email verification failed: ${finalStatus} (no credits charged)`);

                    return {
                        success: false,
                        error: 'email_not_verified',
                        email: emailResult.email || null,
                        status: finalStatus,
                        creditsCharged: 0,
                        message: emailResult.email 
                            ? 'Email found but could not be verified'
                            : 'No email found for this profile'
                    };
                }

            } catch (processingError) {
                // Processing error: Update status and release hold
                console.error('❌ Email finder processing error:', processingError);
                
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
            console.error('❌ Email finder error:', error);
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
            console.error('❌ Error getting target profile:', error);
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

            console.log(`📧 Updated email status: Profile ${targetProfileId} -> ${status}`);
            return { success: true };

        } catch (error) {
            console.error('❌ Error updating email status:', error);
            return { success: false, error: error.message };
        }
    }

    // STAGE 3: Dummy email finding for testing
    async findEmailDummy(profileData) {
        console.log('🎭 Running in dummy mode - generating fake email result');
        
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

        const profileJson = profileData.profile_data || {};
        
        // Extract names for realistic email generation
        const firstName = profileJson.firstName || profileJson.first_name || 'john';
        const lastName = profileJson.lastName || profileJson.last_name || 'doe';
        const company = profileJson.currentCompany || profileJson.company || 'company';
        
        // Generate realistic dummy email
        const emailDomain = this.generateDummyDomain(company);
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${emailDomain}`;
        
        // 80% success rate in dummy mode
        const isSuccess = Math.random() > 0.2;
        
        if (isSuccess) {
            return {
                success: true,
                email: email,
                status: 'verified',
                processingTimeMs: 1500
            };
        } else {
            // 20% failure rate
            const failureType = Math.random();
            if (failureType < 0.6) {
                // Email found but not verified
                return {
                    success: false,
                    email: email,
                    status: 'unverified'
                };
            } else {
                // No email found
                return {
                    success: false,
                    email: null,
                    status: 'not_found'
                };
            }
        }
    }

    // Generate realistic domain for dummy emails
    generateDummyDomain(company) {
        const cleanCompany = company.toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 10);
        
        const domains = ['com', 'org', 'net', 'io'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        
        return `${cleanCompany}.${domain}`;
    }

    // STAGE 4: Real email finding (placeholder for now)
    async findEmailReal(profileData) {
        console.log('🚫 Real Snov.io integration not implemented yet (Stage 4)');
        
        // For now, return not found until Stage 4
        return {
            success: false,
            email: null,
            status: 'not_found'
        };
    }

    // Check if user is admin (for early access testing)
    isAdminUser(userId) {
        // Add your admin user IDs here for early testing
        const adminUserIds = [1]; // Add your user ID here
        return adminUserIds.includes(userId);
    }

    // Get feature status
    getStatus() {
        return {
            enabled: this.enabled,
            dummyMode: this.dummyMode,
            costPerSuccess: this.costPerSuccess,
            rateLimitPerMin: this.rateLimitPerMin
        };
    }
}

// Create singleton instance
const emailFinder = new EmailFinder();

// Export helper functions
async function findEmailForProfile(userId, targetProfileId) {
    return await emailFinder.findEmail(userId, targetProfileId);
}

function getEmailFinderStatus() {
    return emailFinder.getStatus();
}

function isEmailFinderEnabled() {
    return emailFinder.enabled;
}

module.exports = {
    EmailFinder,
    emailFinder,
    findEmailForProfile,
    getEmailFinderStatus,
    isEmailFinderEnabled
};

console.log('📧 Email Finder module loaded successfully!');
