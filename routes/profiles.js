// What changed in Stage G
// âœ… FIXED: Profile & API Routes - LLM Orchestrator + Numeric Sanitization
// routes/profiles.js - Chrome extension and API routes (JWT authentication only)

const express = require('express');

// What changed in Stage G â€" numeric sanitizers
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

// âœ… Export initialization function with dependency injection
function initProfileRoutes(dependencies) {
    const router = express.Router();
    
    // âœ… Extract dependencies with LLM orchestrator
    const {
        pool,
        authenticateToken,
        getUserById,
        processGeminiData,
        processScrapedProfileData,
        cleanLinkedInUrl,
        getStatusMessage,
        sendToGemini,
        processProfileWithLLM  // NEW: LLM orchestrator
    } = dependencies;

    // ==================== CHROME EXTENSION ROUTES (JWT-ONLY) ====================

    // âœ… User profile scraping with LLM orchestrator and numeric sanitization
    router.post('/profile/user', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`ðŸ"' User profile scraping request from user ${req.user.id} (Stage G)`);
            
            const { html, profileUrl, isUserProfile } = req.body;
            
            if (!html || !profileUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'HTML content and profileUrl are required'
                });
            }
            
            // Clean and validate URL
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
            
            console.log('ðŸ¤– Using LLM orchestrator for user profile extraction...');
            
            // Use LLM orchestrator instead of direct sendToGemini
            const result = await processProfileWithLLM({ 
                html, 
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

            // Process the AI result
            const aiResult = result;
            const p = aiResult.data;
            
            // Apply numeric sanitization before DB insert
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
                // Update with sanitized numeric values
                const result = await client.query(`
                    UPDATE user_profiles SET 
                        linkedin_url = $1,
                        full_name = $2,
                        headline = $3,
                        "current_role" = $4,
                        current_company = $5,
                        location = $6,
                        about = $7,
                        connections_count = $8,
                        followers_count = $9,
                        total_likes = $10,
                        total_comments = $11,
                        total_shares = $12,
                        average_likes = $13,
                        experience = $14,
                        education = $15,
                        skills = $16,
                        certifications = $17,
                        awards = $18,
                        volunteer_experience = $19,
                        data_json = $20,
                        ai_provider = $21,
                        ai_model = $22,
                        input_tokens = $23,
                        output_tokens = $24,
                        total_tokens = $25,
                        initial_scraping_done = true,
                        data_extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $26 
                    RETURNING *
                `, [
                    cleanProfileUrl,
                    p?.profile?.name || '',
                    p?.profile?.headline || '',
                    p?.profile?.currentRole || '',
                    p?.profile?.currentCompany || '',
                    p?.profile?.location || '',
                    p?.profile?.about || '',
                    numeric.connections_count,
                    numeric.followers_count,
                    numeric.total_likes,
                    numeric.total_comments,
                    numeric.total_shares,
                    numeric.average_likes,
                    JSON.stringify(p?.experience || []),
                    JSON.stringify(p?.education || []),
                    JSON.stringify(p?.skills || []),
                    JSON.stringify(p?.certifications || []),
                    JSON.stringify(p?.awards || []),
                    JSON.stringify(p?.volunteer || []),
                    JSON.stringify(p),  // Full AI output
                    aiResult.provider || 'gemini',
                    aiResult.model || 'gemini-1.5-flash',
                    aiResult.usage?.input_tokens || 0,
                    aiResult.usage?.output_tokens || 0,
                    aiResult.usage?.total_tokens || 0,
                    req.user.id
                ]);
                
                profile = result.rows[0];
            } else {
                // Insert with sanitized numeric values
                const result = await client.query(`
                    INSERT INTO user_profiles (
                        user_id, linkedin_url, full_name, headline, "current_role", 
                        current_company, location, about, connections_count, followers_count,
                        total_likes, total_comments, total_shares, average_likes,
                        experience, education, skills, certifications, awards, volunteer_experience,
                        data_json, ai_provider, ai_model, input_tokens, output_tokens, total_tokens,
                        initial_scraping_done, data_extraction_status, extraction_completed_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, true, 'completed', CURRENT_TIMESTAMP
                    ) RETURNING *
                `, [
                    req.user.id, cleanProfileUrl, p?.profile?.name || '', p?.profile?.headline || '', 
                    p?.profile?.currentRole || '', p?.profile?.currentCompany || '', p?.profile?.location || '', 
                    p?.profile?.about || '', numeric.connections_count, numeric.followers_count,
                    numeric.total_likes, numeric.total_comments, numeric.total_shares, numeric.average_likes,
                    JSON.stringify(p?.experience || []), JSON.stringify(p?.education || []), 
                    JSON.stringify(p?.skills || []), JSON.stringify(p?.certifications || []), 
                    JSON.stringify(p?.awards || []), JSON.stringify(p?.volunteer || []),
                    JSON.stringify(p), aiResult.provider || 'gemini', aiResult.model || 'gemini-1.5-flash',
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
            
            console.log(`ðŸŽ‰ User profile successfully saved for user ${req.user.id} with LLM orchestrator and numeric sanitization!`);
            
            res.json({
                success: true,
                message: 'User profile saved successfully with LLM fallback and numeric sanitization!',
                data: {
                    profile: {
                        id: profile.id,
                        linkedinUrl: profile.linkedin_url,
                        fullName: profile.full_name,
                        headline: profile.headline,
                        currentRole: profile.current_role,
                        currentCompany: profile.current_company,
                        location: profile.location,
                        profileImageUrl: profile.profile_image_url,
                        initialScrapingDone: true,
                        extractionStatus: 'completed',
                        extractionCompleted: profile.extraction_completed_at,
                        numericData: numeric
                    },
                    user: {
                        registrationCompleted: true,
                        extractionStatus: 'completed'
                    },
                    aiProvider: aiResult.provider,
                    aiModel: aiResult.model,
                    tokenUsage: aiResult.usage
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('âŒ User profile scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save user profile',
                details: error.message
            });
        } finally {
            client.release();
        }
    });

    // âŒ DISABLED: Target profile scraping - Use server.js simple system instead
    /*
    router.post('/profile/target', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`ðŸŽ¯ Target profile scraping request from user ${req.user.id} (Stage G)`);
            
            const { html, profileUrl, isUserProfile } = req.body;
            
            if (!html || !profileUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'HTML content and profileUrl are required'
                });
            }
            
            // Clean and validate URL
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
            
            console.log('ðŸ¤– Using LLM orchestrator for target profile extraction...');
            
            // Use LLM orchestrator instead of direct sendToGemini  
            const result = await processProfileWithLLM({ 
                html, 
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

            // Process the AI result
            const aiResult = result;
            const p = aiResult.data;
            
            // Apply numeric sanitization before DB insert
            const numeric = {
                followers_count: toIntSafe(p?.profile?.followersCount),
                connections_count: toIntSafe(p?.profile?.connectionsCount),
                total_likes: toIntSafe(p?.engagement?.totalLikes),
                total_comments: toIntSafe(p?.engagement?.totalComments),
                total_shares: toIntSafe(p?.engagement?.totalShares),
                average_likes: toFloatSafe(p?.engagement?.averageLikes)
            };
            
            console.log('[DB-INSERT] target numeric sanitized:', numeric);
            
            // âœ… FIXED: Start transaction for target profile
            await client.query('BEGIN');
            
            // Check if this target profile already exists for this user
            const existingTarget = await client.query(
                'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
                [req.user.id, cleanProfileUrl]
            );
            
            let targetProfile;
            if (existingTarget.rows.length > 0) {
                // Update with sanitized numeric values
                const result = await client.query(`
                    UPDATE target_profiles SET 
                        full_name = $1,
                        headline = $2,
                        "current_role" = $3,
                        current_company = $4,
                        location = $5,
                        about = $6,
                        connections_count = $7,
                        followers_count = $8,
                        total_likes = $9,
                        total_comments = $10,
                        total_shares = $11,
                        average_likes = $12,
                        experience = $13,
                        education = $14,
                        skills = $15,
                        certifications = $16,
                        awards = $17,
                        volunteer_experience = $18,
                        data_json = $19,
                        ai_provider = $20,
                        ai_model = $21,
                        input_tokens = $22,
                        output_tokens = $23,
                        total_tokens = $24,
                        scraped_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $25 AND linkedin_url = $26
                    RETURNING *
                `, [
                    p?.profile?.name || '', p?.profile?.headline || '', p?.profile?.currentRole || '',
                    p?.profile?.currentCompany || '', p?.profile?.location || '', p?.profile?.about || '',
                    numeric.connections_count, numeric.followers_count, numeric.total_likes,
                    numeric.total_comments, numeric.total_shares, numeric.average_likes,
                    JSON.stringify(p?.experience || []), JSON.stringify(p?.education || []),
                    JSON.stringify(p?.skills || []), JSON.stringify(p?.certifications || []),
                    JSON.stringify(p?.awards || []), JSON.stringify(p?.volunteer || []),
                    JSON.stringify(p), aiResult.provider || 'gemini', aiResult.model || 'gemini-1.5-flash',
                    aiResult.usage?.input_tokens || 0, aiResult.usage?.output_tokens || 0, aiResult.usage?.total_tokens || 0,
                    req.user.id, cleanProfileUrl
                ]);
                
                targetProfile = result.rows[0];
                console.log(`âœ… Updated existing target profile ${targetProfile.id} for user ${req.user.id}`);
            } else {
                // Insert with sanitized numeric values
                const result = await client.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, full_name, headline, "current_role", 
                        current_company, location, about, connections_count, followers_count,
                        total_likes, total_comments, total_shares, average_likes,
                        experience, education, skills, certifications, awards, volunteer_experience,
                        data_json, ai_provider, ai_model, input_tokens, output_tokens, total_tokens
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
                    ) RETURNING *
                `, [
                    req.user.id, cleanProfileUrl, p?.profile?.name || '', p?.profile?.headline || '',
                    p?.profile?.currentRole || '', p?.profile?.currentCompany || '', p?.profile?.location || '',
                    p?.profile?.about || '', numeric.connections_count, numeric.followers_count,
                    numeric.total_likes, numeric.total_comments, numeric.total_shares, numeric.average_likes,
                    JSON.stringify(p?.experience || []), JSON.stringify(p?.education || []),
                    JSON.stringify(p?.skills || []), JSON.stringify(p?.certifications || []),
                    JSON.stringify(p?.awards || []), JSON.stringify(p?.volunteer || []),
                    JSON.stringify(p), aiResult.provider || 'gemini', aiResult.model || 'gemini-1.5-flash',
                    aiResult.usage?.input_tokens || 0, aiResult.usage?.output_tokens || 0, aiResult.usage?.total_tokens || 0
                ]);
                
                targetProfile = result.rows[0];
                console.log(`âœ… Inserted new target profile ${targetProfile.id} for user ${req.user.id}`);
            }
            
            // âœ… FIXED: Commit transaction
            await client.query('COMMIT');
            
            console.log(`ðŸŽ¯ Target profile successfully saved for user ${req.user.id} with LLM orchestrator and numeric sanitization!`);
            
            res.json({
                success: true,
                message: 'Target profile saved successfully with LLM fallback and numeric sanitization!',
                data: {
                    targetProfile: {
                        id: targetProfile.id,
                        linkedinUrl: targetProfile.linkedin_url,
                        fullName: targetProfile.full_name,
                        headline: targetProfile.headline,
                        currentRole: targetProfile.current_role,
                        currentCompany: targetProfile.current_company,
                        location: targetProfile.location,
                        profileImageUrl: targetProfile.profile_image_url,
                        scrapedAt: targetProfile.scraped_at,
                        numericData: numeric
                    },
                    aiProvider: aiResult.provider,
                    aiModel: aiResult.model,
                    tokenUsage: aiResult.usage
                }
            });
            
        } catch (error) {
            // âœ… FIXED: Rollback transaction on error
            await client.query('ROLLBACK');
            console.error('âŒ Target profile scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save target profile',
                details: error.message
            });
        } finally {
            // âœ… FIXED: Release client connection
            client.release();
        }
    });
    */

    // ==================== API ROUTES (JWT-ONLY) ====================

    // âœ… Generate message endpoint with proper credit deduction and transaction management
    router.post('/generate-message', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`ðŸ¤– Message generation request from user ${req.user.id}`);
            
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
            
            console.log(`ðŸ'³ Credit deducted for user ${req.user.id}: ${currentCredits} â†' ${newCredits}`);
            
            // Generate message (placeholder for now - integrate with GPT-4.1 later)
            const simulatedMessage = `Hi ${targetProfile.firstName || targetProfile.fullName?.split(' ')[0] || 'there'},

I noticed your impressive work at ${targetProfile.currentCompany || 'your company'}. ${context}

Would love to connect and learn more about your experience!

Best regards`;
            
            const score = Math.floor(Math.random() * 20) + 80; // Random score between 80-100
            
            // Log message generation
            await pool.query(
                'INSERT INTO message_logs (user_id, target_name, target_url, generated_message, message_context, credits_used) VALUES ($1, $2, $3, $4, $5, $6)',
                [req.user.id, targetProfile.fullName, targetProfile.linkedinUrl, simulatedMessage, context, 1]
            );
            
            console.log(`âœ… Message generated successfully for user ${req.user.id}`);
            
            res.json({
                success: true,
                message: 'Message generated successfully',
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
                console.error('âŒ Rollback error:', rollbackError);
            }
            
            console.error('âŒ Message generation error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate message',
                details: error.message
            });
        } finally {
            client.release();
        }
    });

    // âœ… Get target profiles for user
    router.get('/target-profiles', authenticateToken, async (req, res) => {
        try {
            console.log(`ðŸ"‹ Fetching target profiles for user ${req.user.id}`);
            
            const result = await pool.query(`
                SELECT 
                    id,
                    linkedin_url,
                    full_name,
                    headline,
                    "current_role",
                    current_company,
                    location,
                    profile_image_url,
                    total_likes,
                    total_comments,
                    followers_count,
                    ai_provider,
                    ai_model,
                    scraped_at,
                    updated_at
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
                aiProvider: profile.ai_provider,
                aiModel: profile.ai_model,
                scrapedAt: profile.scraped_at,
                updatedAt: profile.updated_at
            }));
            
            console.log(`âœ… Found ${profiles.length} target profiles for user ${req.user.id}`);
            
            res.json({
                success: true,
                data: {
                    profiles: profiles,
                    count: profiles.length
                }
            });
            
        } catch (error) {
            console.error('âŒ Error fetching target profiles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch target profiles',
                details: error.message
            });
        }
    });

    // âœ… Delete target profile
    router.delete('/target-profiles/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            console.log(`ðŸ—'ï¸ Deleting target profile ${id} for user ${req.user.id}`);
            
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
            
            console.log(`âœ… Deleted target profile ${id} for user ${req.user.id}`);
            
            res.json({
                success: true,
                message: 'Target profile deleted successfully'
            });
            
        } catch (error) {
            console.error('âŒ Error deleting target profile:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete target profile',
                details: error.message
            });
        }
    });

    // âœ… Return the configured router
    return router;
}

// âœ… Export the initialization function
module.exports = { initProfileRoutes };
