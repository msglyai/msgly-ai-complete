// What changed in Stage G
// ✅ Added LLM orchestrator integration + numeric sanitization
// routes/profiles.js - Chrome extension and API routes (JWT authentication only)

const express = require('express');

// What changed in Stage G — numeric sanitizers
function toIntSafe(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    if (!s) return null;
    const km = s.match(/^([\d.,]+)\s*([KkMmBb])$/);
    if (km) {
        const num = parseFloat(km[1].replace(/,/g, ''));
        if (isNaN(num)) return null;
        const mult = { K:1e3, k:1e3, M:1e6, m:1e6, B:1e9, b:1e9 }[km[2]];
        return Math.round(num * mult);
    }
    const digits = s.replace(/[^\d-]/g, '');
    if (!digits || /^-?$/.test(digits)) return null;
    const n = parseInt(digits, 10);
    return Number.isFinite(n) ? n : null;
}

function toFloatSafe(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    if (!s) return null;
    const km = s.match(/^([\d.,]+)\s*([KkMmBb])$/);
    if (km) {
        const num = parseFloat(km[1].replace(/,/g, ''));
        if (isNaN(num)) return null;
        const mult = { K:1e3, k:1e3, M:1e6, m:1e6, B:1e9, b:1e9 }[km[2]];
        return num * mult;
    }
    const norm = s.replace(/,/g, '');
    const n = parseFloat(norm);
    return Number.isFinite(n) ? n : null;
}

// ✅ Export initialization function with dependency injection
function initProfileRoutes(dependencies) {
    const router = express.Router();
    
    // ✅ Extract dependencies
    const {
        pool,
        authenticateToken,
        getUserById,
        processGeminiData,
        processScrapedProfileData,
        cleanLinkedInUrl,
        getStatusMessage,
        sendToGemini
    } = dependencies;

    // ✅ Import LLM orchestrator
    const { processProfileWithLLM } = require('../utils/llmOrchestrator');

    // ==================== CHROME EXTENSION ROUTES (JWT-ONLY) ====================
    
    // ✅ User profile scraping with orchestrator and numeric sanitization
    router.post('/profile/user', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`🔒 User profile scraping request from user ${req.user.id} (Stage G)`);
            
            const { profileData } = req.body;
            
            if (!profileData) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile data is required'
                });
            }
            
            if (!profileData.url && !profileData.linkedinUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'LinkedIn URL is required in profile data'
                });
            }
            
            // Clean and validate URL
            const profileUrl = profileData.url || profileData.linkedinUrl;
            const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
            
            if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid LinkedIn profile URL'
                });
            }
            
            // Validate this is the user's own profile
            const userLinkedInUrl = req.user.linkedin_url;
            if (userLinkedInUrl) {
                const cleanUserUrl = cleanLinkedInUrl(userLinkedInUrl);
                
                if (cleanUserUrl !== cleanProfileUrl) {
                    return res.status(403).json({
                        success: false,
                        error: 'You can only scrape your own LinkedIn profile for initial setup'
                    });
                }
            }
            
            console.log('🤖 Using LLM orchestrator for user profile processing...');
            
            // ✅ Stage G: Use orchestrator instead of direct sendToGemini
            const result = await processProfileWithLLM({ 
                html: profileData.html || profileData.htmlContent, 
                url: cleanProfileUrl, 
                isUserProfile: true 
            });
            
            if (!result.success) {
                const soft = result.transient || [408,429,500,502,503,504].includes(result.status || 0);
                if (soft) {
                    return res.status(200).json({ 
                        success: false, 
                        transient: true, 
                        userMessage: result.userMessage || 'Please try again shortly.' 
                    });
                }
                return res.status(200).json({ 
                    success: false, 
                    userMessage: result.userMessage || 'Failed to process profile' 
                });
            }
            
            // ✅ Stage G: Extract and sanitize numeric values
            const aiResult = result;
            const p = aiResult.data; // final JSON from orchestrator
            
            const numeric = {
                followers_count: toIntSafe(p?.profile?.followersCount),
                connections_count: toIntSafe(p?.profile?.connectionsCount),
                total_likes: toIntSafe(p?.engagement?.totalLikes),
                total_comments: toIntSafe(p?.engagement?.totalComments),
                total_shares: toIntSafe(p?.engagement?.totalShares),
                average_likes: toFloatSafe(p?.engagement?.averageLikes)
            };
            
            console.log('[DB-INSERT] numeric sanitized:', numeric);
            
            // Start transaction
            await client.query('BEGIN');
            
            // Check if profile exists
            const existingProfile = await client.query(
                'SELECT * FROM user_profiles WHERE user_id = $1',
                [req.user.id]
            );
            
            let profile;
            if (existingProfile.rows.length > 0) {
                // Update with comprehensive data + raw AI data + sanitized numeric values
                const result = await client.query(`
                    UPDATE user_profiles SET 
                        linkedin_url = $1, url = $2, full_name = $3, first_name = $4, last_name = $5, 
                        headline = $6, "current_role" = $7, about = $8, location = $9,
                        current_company = $10, current_company_name = $11,
                        connections_count = $12, followers_count = $13,
                        total_likes = $14, total_comments = $15, total_shares = $16, average_likes = $17,
                        experience = $18, education = $19, skills = $20, certifications = $21, awards = $22,
                        volunteer_experience = $23, activity = $24, engagement_data = $25,
                        data_json = $26, ai_provider = $27, ai_model = $28, 
                        gemini_input_tokens = $29, gemini_output_tokens = $30, gemini_total_tokens = $31,
                        data_extraction_status = 'completed', extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL, profile_analyzed = true, initial_scraping_done = true,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $32 
                    RETURNING *
                `, [
                    cleanProfileUrl, cleanProfileUrl, 
                    p?.profile?.name || '', p?.profile?.firstName || '', p?.profile?.lastName || '',
                    p?.profile?.headline || '', p?.profile?.currentRole || '', p?.profile?.about || '', p?.profile?.location || '',
                    p?.profile?.currentCompany || '', p?.profile?.currentCompany || '',
                    numeric.connections_count, numeric.followers_count,
                    numeric.total_likes, numeric.total_comments, numeric.total_shares, numeric.average_likes,
                    JSON.stringify(p?.experience || []), JSON.stringify(p?.education || []), 
                    JSON.stringify(p?.skills || []), JSON.stringify(p?.certifications || []), JSON.stringify(p?.awards || []),
                    JSON.stringify(p?.volunteer || []), JSON.stringify(p?.activity || []), JSON.stringify(p?.engagement || {}),
                    JSON.stringify(p), // Full AI data to data_json
                    aiResult.provider || 'gemini', aiResult.model || 'gemini-1.5-flash',
                    aiResult.usage?.input_tokens || 0, aiResult.usage?.output_tokens || 0, aiResult.usage?.total_tokens || 0,
                    req.user.id
                ]);
                
                profile = result.rows[0];
            } else {
                // Create with comprehensive data + raw AI data + sanitized numeric values
                const result = await client.query(`
                    INSERT INTO user_profiles (
                        user_id, linkedin_url, url, full_name, first_name, last_name,
                        headline, "current_role", about, location, current_company, current_company_name,
                        connections_count, followers_count, total_likes, total_comments, total_shares, average_likes,
                        experience, education, skills, certifications, awards, volunteer_experience, activity, engagement_data,
                        data_json, ai_provider, ai_model, gemini_input_tokens, gemini_output_tokens, gemini_total_tokens,
                        data_extraction_status, extraction_completed_at, profile_analyzed, initial_scraping_done
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, 'completed', CURRENT_TIMESTAMP, true, true
                    ) RETURNING *
                `, [
                    req.user.id, cleanProfileUrl, cleanProfileUrl, 
                    p?.profile?.name || '', p?.profile?.firstName || '', p?.profile?.lastName || '',
                    p?.profile?.headline || '', p?.profile?.currentRole || '', p?.profile?.about || '', p?.profile?.location || '',
                    p?.profile?.currentCompany || '', p?.profile?.currentCompany || '',
                    numeric.connections_count, numeric.followers_count,
                    numeric.total_likes, numeric.total_comments, numeric.total_shares, numeric.average_likes,
                    JSON.stringify(p?.experience || []), JSON.stringify(p?.education || []), 
                    JSON.stringify(p?.skills || []), JSON.stringify(p?.certifications || []), JSON.stringify(p?.awards || []),
                    JSON.stringify(p?.volunteer || []), JSON.stringify(p?.activity || []), JSON.stringify(p?.engagement || {}),
                    JSON.stringify(p), // Full AI data to data_json
                    aiResult.provider || 'gemini', aiResult.model || 'gemini-1.5-flash',
                    aiResult.usage?.input_tokens || 0, aiResult.usage?.output_tokens || 0, aiResult.usage?.total_tokens || 0
                ]);
                
                profile = result.rows[0];
            }
            
            // Update user table
            await client.query(
                'UPDATE users SET linkedin_url = $1, extraction_status = $2, registration_completed = $3, error_message = NULL WHERE id = $4',
                [cleanProfileUrl, 'completed', true, req.user.id]
            );
            
            // Commit transaction
            await client.query('COMMIT');
            
            console.log(`🎉 User profile successfully saved for user ${req.user.id} with LLM orchestrator (${aiResult.provider}/${aiResult.model}) and numeric sanitization!`);
            
            res.json({
                success: true,
                message: `Profile processed successfully with ${aiResult.provider} ${aiResult.model}!`,
                data: {
                    profile: {
                        id: profile.id,
                        linkedinUrl: profile.linkedin_url,
                        fullName: profile.full_name,
                        headline: profile.headline,
                        currentRole: profile.current_role,
                        currentCompany: profile.current_company,
                        location: profile.location,
                        initialScrapingDone: true,
                        extractionStatus: 'completed',
                        extractionCompleted: profile.extraction_completed_at
                    },
                    user: {
                        registrationCompleted: true,
                        extractionStatus: 'completed'
                    },
                    orchestrator: {
                        provider: aiResult.provider,
                        model: aiResult.model,
                        tokenUsage: aiResult.usage
                    },
                    sanitization: {
                        followersCount: numeric.followers_count,
                        connectionsCount: numeric.connections_count,
                        totalLikes: numeric.total_likes,
                        totalComments: numeric.total_comments,
                        totalShares: numeric.total_shares,
                        averageLikes: numeric.average_likes
                    }
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ User profile scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save user profile',
                details: error.message
            });
        } finally {
            client.release();
        }
    });

    // ✅ Target profile scraping with orchestrator and numeric sanitization
    router.post('/profile/target', authenticateToken, async (req, res) => {
        try {
            console.log(`🎯 Target profile scraping request from user ${req.user.id} (Stage G)`);
            
            // Check if initial scraping is done
            const initialStatus = await pool.query(`
                SELECT initial_scraping_done, data_extraction_status
                FROM user_profiles 
                WHERE user_id = $1
            `, [req.user.id]);
            
            if (initialStatus.rows.length === 0 || !initialStatus.rows[0].initial_scraping_done) {
                console.log(`🚫 User ${req.user.id} has not completed initial scraping`);
                return res.status(403).json({
                    success: false,
                    error: 'Please complete your own profile scraping first before scraping target profiles',
                    code: 'INITIAL_SCRAPING_REQUIRED'
                });
            }
            
            const { profileData } = req.body;
            
            if (!profileData) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile data is required'
                });
            }
            
            if (!profileData.url && !profileData.linkedinUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'LinkedIn URL is required in profile data'
                });
            }
            
            // Clean and validate URL
            const profileUrl = profileData.url || profileData.linkedinUrl;
            const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
            
            if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid LinkedIn profile URL'
                });
            }
            
            // Validate this is NOT the user's own profile
            const userLinkedInUrl = req.user.linkedin_url;
            if (userLinkedInUrl) {
                const cleanUserUrl = cleanLinkedInUrl(userLinkedInUrl);
                
                if (cleanUserUrl === cleanProfileUrl) {
                    return res.status(400).json({
                        success: false,
                        error: 'This appears to be your own profile. Use /profile/user endpoint for your own profile.'
                    });
                }
            }
            
            console.log('🤖 Using LLM orchestrator for target profile processing...');
            
            // ✅ Stage G: Use orchestrator instead of direct sendToGemini
            const result = await processProfileWithLLM({ 
                html: profileData.html || profileData.htmlContent, 
                url: cleanProfileUrl, 
                isUserProfile: false 
            });
            
            if (!result.success) {
                const soft = result.transient || [408,429,500,502,503,504].includes(result.status || 0);
                if (soft) {
                    return res.status(200).json({ 
                        success: false, 
                        transient: true, 
                        userMessage: result.userMessage || 'Please try again shortly.' 
                    });
                }
                return res.status(200).json({ 
                    success: false, 
                    userMessage: result.userMessage || 'Failed to process profile' 
                });
            }
            
            // ✅ Stage G: Extract and sanitize numeric values
            const aiResult = result;
            const p = aiResult.data; // final JSON from orchestrator
            
            const numeric = {
                followers_count: toIntSafe(p?.profile?.followersCount),
                connections_count: toIntSafe(p?.profile?.connectionsCount),
                total_likes: toIntSafe(p?.engagement?.totalLikes),
                total_comments: toIntSafe(p?.engagement?.totalComments),
                total_shares: toIntSafe(p?.engagement?.totalShares),
                average_likes: toFloatSafe(p?.engagement?.averageLikes)
            };
            
            console.log('[DB-INSERT] target numeric sanitized:', numeric);
            
            // Check if this target profile already exists for this user
            const existingTarget = await pool.query(
                'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
                [req.user.id, cleanProfileUrl]
            );
            
            let targetProfile;
            if (existingTarget.rows.length > 0) {
                // Update with comprehensive data + raw AI data + sanitized numeric values
                const result = await pool.query(`
                    UPDATE target_profiles SET 
                        url = $1, full_name = $2, first_name = $3, last_name = $4, 
                        headline = $5, "current_role" = $6, about = $7, location = $8,
                        current_company = $9, current_company_name = $10,
                        connections_count = $11, followers_count = $12,
                        total_likes = $13, total_comments = $14, total_shares = $15, average_likes = $16,
                        experience = $17, education = $18, skills = $19, certifications = $20, awards = $21,
                        volunteer_experience = $22, activity = $23, engagement_data = $24,
                        data_json = $25, ai_provider = $26, ai_model = $27, 
                        gemini_input_tokens = $28, gemini_output_tokens = $29, gemini_total_tokens = $30,
                        scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $31 AND linkedin_url = $32
                    RETURNING *
                `, [
                    cleanProfileUrl, 
                    p?.profile?.name || '', p?.profile?.firstName || '', p?.profile?.lastName || '',
                    p?.profile?.headline || '', p?.profile?.currentRole || '', p?.profile?.about || '', p?.profile?.location || '',
                    p?.profile?.currentCompany || '', p?.profile?.currentCompany || '',
                    numeric.connections_count, numeric.followers_count,
                    numeric.total_likes, numeric.total_comments, numeric.total_shares, numeric.average_likes,
                    JSON.stringify(p?.experience || []), JSON.stringify(p?.education || []), 
                    JSON.stringify(p?.skills || []), JSON.stringify(p?.certifications || []), JSON.stringify(p?.awards || []),
                    JSON.stringify(p?.volunteer || []), JSON.stringify(p?.activity || []), JSON.stringify(p?.engagement || {}),
                    JSON.stringify(p), // Full AI data to data_json
                    aiResult.provider || 'gemini', aiResult.model || 'gemini-1.5-flash',
                    aiResult.usage?.input_tokens || 0, aiResult.usage?.output_tokens || 0, aiResult.usage?.total_tokens || 0,
                    req.user.id, cleanProfileUrl
                ]);
                
                targetProfile = result.rows[0];
            } else {
                // Create with comprehensive data + raw AI data + sanitized numeric values
                const result = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, url, full_name, first_name, last_name,
                        headline, "current_role", about, location, current_company, current_company_name,
                        connections_count, followers_count, total_likes, total_comments, total_shares, average_likes,
                        experience, education, skills, certifications, awards, volunteer_experience, activity, engagement_data,
                        data_json, ai_provider, ai_model, gemini_input_tokens, gemini_output_tokens, gemini_total_tokens
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
                    ) RETURNING *
                `, [
                    req.user.id, cleanProfileUrl, cleanProfileUrl, 
                    p?.profile?.name || '', p?.profile?.firstName || '', p?.profile?.lastName || '',
                    p?.profile?.headline || '', p?.profile?.currentRole || '', p?.profile?.about || '', p?.profile?.location || '',
                    p?.profile?.currentCompany || '', p?.profile?.currentCompany || '',
                    numeric.connections_count, numeric.followers_count,
                    numeric.total_likes, numeric.total_comments, numeric.total_shares, numeric.average_likes,
                    JSON.stringify(p?.experience || []), JSON.stringify(p?.education || []), 
                    JSON.stringify(p?.skills || []), JSON.stringify(p?.certifications || []), JSON.stringify(p?.awards || []),
                    JSON.stringify(p?.volunteer || []), JSON.stringify(p?.activity || []), JSON.stringify(p?.engagement || {}),
                    JSON.stringify(p), // Full AI data to data_json
                    aiResult.provider || 'gemini', aiResult.model || 'gemini-1.5-flash',
                    aiResult.usage?.input_tokens || 0, aiResult.usage?.output_tokens || 0, aiResult.usage?.total_tokens || 0
                ]);
                
                targetProfile = result.rows[0];
            }
            
            console.log(`🎯 Target profile successfully saved for user ${req.user.id} with LLM orchestrator (${aiResult.provider}/${aiResult.model}) and numeric sanitization!`);
            
            res.json({
                success: true,
                message: `Target profile processed successfully with ${aiResult.provider} ${aiResult.model}!`,
                data: {
                    targetProfile: {
                        id: targetProfile.id,
                        linkedinUrl: targetProfile.linkedin_url,
                        fullName: targetProfile.full_name,
                        headline: targetProfile.headline,
                        currentRole: targetProfile.current_role,
                        currentCompany: targetProfile.current_company,
                        location: targetProfile.location,
                        scrapedAt: targetProfile.scraped_at
                    },
                    orchestrator: {
                        provider: aiResult.provider,
                        model: aiResult.model,
                        tokenUsage: aiResult.usage
                    },
                    sanitization: {
                        followersCount: numeric.followers_count,
                        connectionsCount: numeric.connections_count,
                        totalLikes: numeric.total_likes,
                        totalComments: numeric.total_comments,
                        totalShares: numeric.total_shares,
                        averageLikes: numeric.average_likes
                    }
                }
            });
            
        } catch (error) {
            console.error('❌ Target profile scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save target profile',
                details: error.message
            });
        }
    });

    // ==================== API ROUTES (JWT-ONLY) ====================

    // ✅ Generate message endpoint with proper credit deduction and transaction management
    router.post('/generate-message', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`🤖 Message generation request from user ${req.user.id}`);
            
            const { targetProfile, context, messageType } = req.body;
            
            if (!targetProfile) {
                return res.status(400).json({
                    success: false,
                    error: 'Target profile is required'
                });
            }
            
            if (!context) {
                return res.status(400).json({
                    success: false,
                    error: 'Message context is required'
                });
            }
            
            // Start transaction for credit check and deduction
            await client.query('BEGIN');
            
            // Check user credits within transaction
            const userResult = await client.query(
                'SELECT credits_remaining FROM users WHERE id = $1 FOR UPDATE',
                [req.user.id]
            );
            
            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            const currentCredits = userResult.rows[0].credits_remaining;
            
            if (currentCredits <= 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient credits. Please upgrade your plan.'
                });
            }
            
            // Deduct credit immediately (before API call)
            const newCredits = currentCredits - 1;
            await client.query(
                'UPDATE users SET credits_remaining = $1 WHERE id = $2',
                [newCredits, req.user.id]
            );
            
            // Log the credit transaction
            await client.query(
                'INSERT INTO credits_transactions (user_id, transaction_type, credits_change, description) VALUES ($1, $2, $3, $4)',
                [req.user.id, 'message_generation', -1, `Generated message for ${targetProfile.fullName || 'Unknown'}`]
            );
            
            // Commit credit deduction before potentially long API call
            await client.query('COMMIT');
            
            console.log(`💳 Credit deducted for user ${req.user.id}: ${currentCredits} → ${newCredits}`);
            
            // TODO: Replace with actual GPT 4.1 API call using raw data + enhanced context
            const simulatedMessage = `Hi ${targetProfile.firstName || targetProfile.fullName?.split(' ')[0] || 'there'},

I noticed your impressive work at ${targetProfile.currentCompany || 'your company'}${targetProfile.currentRole && targetProfile.currentRole !== targetProfile.headline ? ` as ${targetProfile.currentRole}` : targetProfile.headline ? ` as ${targetProfile.headline}` : ''}. ${context}

Would love to connect and learn more about your experience!

Best regards`;
            
            const score = Math.floor(Math.random() * 20) + 80; // Random score between 80-100
            
            // Log message generation
            await pool.query(
                'INSERT INTO message_logs (user_id, target_name, target_url, generated_message, message_context, credits_used) VALUES ($1, $2, $3, $4, $5, $6)',
                [req.user.id, targetProfile.fullName, targetProfile.linkedinUrl, simulatedMessage, context, 1]
            );
            
            console.log(`✅ Message generated successfully for user ${req.user.id}`);
            
            res.json({
                success: true,
                message: 'Message generated successfully using comprehensive profile data',
                data: {
                    message: simulatedMessage,
                    score: score,
                    user: {
                        credits: newCredits
                    },
                    usage: {
                        creditsUsed: 1,
                        remainingCredits: newCredits
                    }
                }
            });
            
        } catch (error) {
            // Rollback if transaction is still active
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('❌ Rollback error:', rollbackError);
            }
            
            console.error('❌ Message generation error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate message',
                details: error.message
            });
        } finally {
            client.release();
        }
    });

    // ✅ Get target profiles for user
    router.get('/target-profiles', authenticateToken, async (req, res) => {
        try {
            console.log(`📋 Fetching target profiles for user ${req.user.id}`);
            
            const result = await pool.query(`
                SELECT 
                    id, linkedin_url, full_name, headline, "current_role", current_company, location,
                    profile_image_url, total_likes, total_comments, followers_count,
                    scraped_at, updated_at, ai_provider, ai_model
                FROM target_profiles 
                WHERE user_id = $1 
                ORDER BY scraped_at DESC
            `, [req.user.id]);
            
            const profiles = result.rows.map(profile => ({
                id: profile.id,
                linkedinUrl: profile.linkedin_url,
                fullName: profile.full_name,
                headline: profile.headline,
                currentRole: profile.current_role,
                currentCompany: profile.current_company,
                location: profile.location,
                profileImageUrl: profile.profile_image_url,
                totalLikes: profile.total_likes,
                totalComments: profile.total_comments,
                followersCount: profile.followers_count,
                scrapedAt: profile.scraped_at,
                updatedAt: profile.updated_at,
                aiProvider: profile.ai_provider,
                aiModel: profile.ai_model
            }));
            
            console.log(`✅ Found ${profiles.length} target profiles for user ${req.user.id}`);
            
            res.json({
                success: true,
                data: {
                    profiles: profiles,
                    count: profiles.length
                }
            });
            
        } catch (error) {
            console.error('❌ Error fetching target profiles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch target profiles',
                details: error.message
            });
        }
    });

    // ✅ Delete target profile
    router.delete('/target-profiles/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            console.log(`🗑️ Deleting target profile ${id} for user ${req.user.id}`);
            
            // Verify the profile belongs to the user
            const checkResult = await pool.query(
                'SELECT id FROM target_profiles WHERE id = $1 AND user_id = $2',
                [id, req.user.id]
            );
            
            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Target profile not found or unauthorized'
                });
            }
            
            // Delete the profile
            await pool.query(
                'DELETE FROM target_profiles WHERE id = $1 AND user_id = $2',
                [id, req.user.id]
            );
            
            console.log(`✅ Deleted target profile ${id} for user ${req.user.id}`);
            
            res.json({
                success: true,
                message: 'Target profile deleted successfully'
            });
            
        } catch (error) {
            console.error('❌ Error deleting target profile:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete target profile',
                details: error.message
            });
        }
    });

    // ✅ Return the configured router
    return router;
}

// ✅ Export the initialization function
module.exports = { initProfileRoutes };
