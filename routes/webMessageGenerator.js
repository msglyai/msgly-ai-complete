// webMessageGenerator.js - Express routes for web-based message generation
// Handles LinkedIn profile analysis via BrightData and message generation

const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const brightDataService = require('../services/brightDataService');
const webMessageGPTService = require('../services/webMessageGPTService');
const { spendUserCredits } = require('../database');

/**
 * POST /api/web-message-generator/analyze-profile
 * Analyze LinkedIn profile using BrightData
 */
router.post('/analyze-profile', async (req, res) => {
    try {
        const { linkedinUrl } = req.body;
        const userId = req.user?.id;
        
        console.log('[WEB-MSG] Profile analysis requested:', linkedinUrl);
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        if (!linkedinUrl) {
            return res.status(400).json({ error: 'LinkedIn URL is required' });
        }
        
        // Check if profile already exists in cache
        const existingProfile = await pool.query(
            'SELECT * FROM brightdata_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [userId, linkedinUrl]
        );
        
        if (existingProfile.rows.length > 0) {
            console.log('[WEB-MSG] Using cached profile');
            const cached = existingProfile.rows[0];
            
            return res.json({
                success: true,
                cached: true,
                profile: brightDataService.formatProfileForGPT(cached.profile_data),
                profileId: cached.id
            });
        }
        
        // Deduct credits first (1.0 credit for BrightData analysis)
        const creditResult = await spendUserCredits(userId, 1.0, 'brightdata_analysis');
        
        if (!creditResult.success) {
            return res.status(402).json({ 
                error: 'Insufficient credits',
                credits_remaining: creditResult.credits_remaining 
            });
        }
        
        console.log('[WEB-MSG] Credits deducted. Triggering BrightData scrape...');
        
        // Get profile from BrightData
        const { snapshotId, profileData } = await brightDataService.getLinkedInProfile(linkedinUrl);
        
        // Store in database
        const insertResult = await pool.query(
            `INSERT INTO brightdata_profiles (user_id, linkedin_url, profile_data, snapshot_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, linkedin_url) 
             DO UPDATE SET 
                profile_data = EXCLUDED.profile_data,
                snapshot_id = EXCLUDED.snapshot_id,
                updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [userId, linkedinUrl, JSON.stringify(profileData), snapshotId]
        );
        
        const savedProfile = insertResult.rows[0];
        
        console.log('[WEB-MSG] ✅ Profile analyzed and saved');
        
        res.json({
            success: true,
            cached: false,
            profile: brightDataService.formatProfileForGPT(profileData),
            profileId: savedProfile.id,
            credits_remaining: creditResult.credits_remaining
        });
        
    } catch (error) {
        console.error('[WEB-MSG] Error analyzing profile:', error);
        res.status(500).json({ 
            error: 'Failed to analyze profile',
            details: error.message 
        });
    }
});

/**
 * POST /api/web-message-generator/generate
 * Generate message for analyzed profile
 */
router.post('/generate', async (req, res) => {
    try {
        const { linkedinUrl, messageType, context } = req.body;
        const userId = req.user?.id;
        
        console.log('[WEB-MSG] Message generation requested');
        console.log('[WEB-MSG] Type:', messageType);
        console.log('[WEB-MSG] URL:', linkedinUrl);
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        if (!linkedinUrl || !messageType) {
            return res.status(400).json({ 
                error: 'LinkedIn URL and message type are required' 
            });
        }
        
        // Validate message type
        const validTypes = ['linkedin_message', 'connection_request', 'cold_email'];
        if (!validTypes.includes(messageType)) {
            return res.status(400).json({ error: 'Invalid message type' });
        }
        
        // Get BrightData profile from database
        const profileResult = await pool.query(
            'SELECT * FROM brightdata_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [userId, linkedinUrl]
        );
        
        if (profileResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Profile not found. Please analyze the profile first.' 
            });
        }
        
        const brightDataProfile = profileResult.rows[0];
        
        // Deduct credits for message generation (1.0 credit per message)
        const creditResult = await spendUserCredits(userId, 1.0, 'web_message_generation');
        
        if (!creditResult.success) {
            return res.status(402).json({ 
                error: 'Insufficient credits',
                credits_remaining: creditResult.credits_remaining 
            });
        }
        
        console.log('[WEB-MSG] Credits deducted. Generating message...');
        
        // Get user profile
        const userResult = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
        );
        const userProfile = userResult.rows[0];
        
        // Get user's full profile data if available
        const userProfileResult = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        const fullUserProfile = userProfileResult.rows[0] || userProfile;
        
        // Format BrightData profile for GPT
        const formattedProfile = brightDataService.formatProfileForGPT(
            brightDataProfile.profile_data
        );
        
        // Generate message
        const result = await webMessageGPTService.generateMessage(
            fullUserProfile,
            formattedProfile,
            context,
            messageType
        );
        
        // Save to database
        await pool.query(
            `INSERT INTO web_generated_messages 
             (user_id, brightdata_profile_id, linkedin_url, message_type, generated_message, profile_summary, credits_used, context_text)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                userId,
                brightDataProfile.id,
                linkedinUrl,
                messageType,
                result.message,
                JSON.stringify(formattedProfile),
                1.0,
                context
            ]
        );
        
        console.log('[WEB-MSG] ✅ Message generated and saved');
        
        res.json({
            success: true,
            message: result.message,
            model_used: result.model_used,
            credits_remaining: creditResult.credits_remaining
        });
        
    } catch (error) {
        console.error('[WEB-MSG] Error generating message:', error);
        res.status(500).json({ 
            error: 'Failed to generate message',
            details: error.message 
        });
    }
});

/**
 * POST /api/web-message-generator/batch-generate
 * Generate all 3 message types at once
 */
router.post('/batch-generate', async (req, res) => {
    try {
        const { linkedinUrl, context } = req.body;
        const userId = req.user?.id;
        
        console.log('[WEB-MSG] Batch generation requested for:', linkedinUrl);
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        if (!linkedinUrl) {
            return res.status(400).json({ error: 'LinkedIn URL is required' });
        }
        
        // Check credits (need 3 credits for 3 messages)
        const userResult = await pool.query(
            'SELECT renewable_credits, payasyougo_credits FROM users WHERE id = $1',
            [userId]
        );
        const user = userResult.rows[0];
        const totalCredits = (user.renewable_credits || 0) + (user.payasyougo_credits || 0);
        
        if (totalCredits < 3) {
            return res.status(402).json({ 
                error: 'Insufficient credits. Need 3 credits for batch generation.',
                credits_remaining: totalCredits 
            });
        }
        
        // Get BrightData profile
        const profileResult = await pool.query(
            'SELECT * FROM brightdata_profiles WHERE user_id = $1 AND linkedin_url = $2',
            [userId, linkedinUrl]
        );
        
        if (profileResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Profile not found. Please analyze the profile first.' 
            });
        }
        
        const brightDataProfile = profileResult.rows[0];
        
        // Get user's full profile
        const userProfileResult = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        const fullUserProfile = userProfileResult.rows[0] || userResult.rows[0];
        
        // Format profile
        const formattedProfile = brightDataService.formatProfileForGPT(
            brightDataProfile.profile_data
        );
        
        // Generate all 3 message types
        const messageTypes = ['linkedin_message', 'connection_request', 'cold_email'];
        const messages = {};
        
        for (const messageType of messageTypes) {
            // Deduct credit
            const creditResult = await spendUserCredits(userId, 1.0, 'web_message_generation');
            
            if (!creditResult.success) {
                return res.status(402).json({ 
                    error: `Insufficient credits during batch generation`,
                    credits_remaining: creditResult.credits_remaining 
                });
            }
            
            // Generate message
            const result = await webMessageGPTService.generateMessage(
                fullUserProfile,
                formattedProfile,
                context,
                messageType
            );
            
            messages[messageType] = result.message;
            
            // Save to database
            await pool.query(
                `INSERT INTO web_generated_messages 
                 (user_id, brightdata_profile_id, linkedin_url, message_type, generated_message, profile_summary, credits_used, context_text)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    userId,
                    brightDataProfile.id,
                    linkedinUrl,
                    messageType,
                    result.message,
                    JSON.stringify(formattedProfile),
                    1.0,
                    context
                ]
            );
        }
        
        // Get remaining credits
        const finalUserResult = await pool.query(
            'SELECT renewable_credits, payasyougo_credits FROM users WHERE id = $1',
            [userId]
        );
        const finalUser = finalUserResult.rows[0];
        const creditsRemaining = (finalUser.renewable_credits || 0) + (finalUser.payasyougo_credits || 0);
        
        console.log('[WEB-MSG] ✅ Batch generation complete');
        
        res.json({
            success: true,
            messages,
            credits_used: 3,
            credits_remaining: creditsRemaining
        });
        
    } catch (error) {
        console.error('[WEB-MSG] Error in batch generation:', error);
        res.status(500).json({ 
            error: 'Failed to generate messages',
            details: error.message 
        });
    }
});

/**
 * GET /api/web-message-generator/history
 * Get message generation history for user
 */
router.get('/history', async (req, res) => {
    try {
        const userId = req.user?.id;
        const limit = parseInt(req.query.limit) || 20;
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const result = await pool.query(
            `SELECT * FROM web_generated_messages 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        
        res.json({
            success: true,
            history: result.rows
        });
        
    } catch (error) {
        console.error('[WEB-MSG] Error fetching history:', error);
        res.status(500).json({ 
            error: 'Failed to fetch history',
            details: error.message 
        });
    }
});

module.exports = router;
