// What changed in Stage G
// ✅ FIXED: Profile & API Routes - LLM Orchestrator + Numeric Sanitization
// routes/profiles.js - Chrome extension and API routes (JWT authentication only)
// CREDITS UPDATE: Added fractional credits support and target analyze flow with charging

const express = require('express');
const axios = require('axios'); // CREDITS UPDATE: Added for internal API calls

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

// CREDITS UPDATE: URL normalization helper (moved from server.js for reuse)
function normalizeLinkedInUrl(url = '') {
  try {
    return url.toString().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/$/, '');
  } catch { return ''; }
}

// ✅ Export initialization function with dependency injection
function initProfileRoutes(dependencies) {
    const router = express.Router();
    
    // ✅ Extract dependencies with LLM orchestrator
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

    // ✅ User profile scraping with LLM orchestrator and numeric sanitization
    router.post('/profile/user', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`🔒 User profile scraping request from user ${req.user.id} (Stage G)`);
            
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
            
            console.log('🤖 Using LLM orchestrator for user profile extraction...');
            
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
            
            console.log(`🎉 User profile successfully saved for user ${req.user.id} with LLM orchestrator and numeric sanitization!`);
            
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

    // CREDITS UPDATE: Target profile scraping with fractional credits and deduplication
    router.post('/profile/target', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`🎯 Target profile scraping request from user ${req.user.id} (Stage G with Credits)`);
            
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
            
            // CREDITS UPDATE: Step 1 - Normalize URL (server-side)
            const normalizedUrl = normalizeLinkedInUrl(profileUrl);
            console.log(`🔗 Normalized URL: ${normalizedUrl}`);
            
            // Start transaction for deduplication check
            await client.query('BEGIN');
            
            // CREDITS UPDATE: Step 2 - Check if target exists (dedupe by user_id, normalized_url)
            const existingTarget = await client.query(
                'SELECT id, created_at FROM target_profiles WHERE user_id = $1 AND normalized_url = $2 LIMIT 1',
                [req.user.id, normalizedUrl]
            );
            
            if (existingTarget.rows.length > 0) {
                await client.query('ROLLBACK');
                console.log(`💡 Target already exists for user ${req.user.id} + URL ${normalizedUrl}`);
                return res.status(200).json({
                    success: true,
                    alreadyExists: true,
                    message: 'Target already in system - no charge applied',
                    data: {
                        analyzedAt: existingTarget.rows[0].created_at,
                        normalizedUrl: normalizedUrl
                    }
                });
            }
            
            console.log(`✨ Target is new, proceeding with analysis and charging...`);
            
            // CREDITS UPDATE: Step 3 - Charge for analyze_profile action (0.25 credits = 1 point)
            console.log(`💳 Charging 1 point (0.25 credits) for analyze_profile action...`);
            
            // Get current credits_points within transaction
            const userResult = await client.query(
                'SELECT credits_points, credits_remaining FROM users WHERE id = $1 FOR UPDATE',
                [req.user.id]
            );
            
            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            const currentPoints = userResult.rows[0].credits_points || 0;
            const requiredPoints = 1; // 0.25 credits = 1 point
            
            if (currentPoints < requiredPoints) {
                await client.query('ROLLBACK');
                console.log(`❌ Insufficient credits: ${currentPoints} points < ${requiredPoints} points`);
                return res.status(402).json({
                    success: false,
                    error: 'Insufficient credits',
                    needsUpgrade: true,
                    data: {
                        required: requiredPoints / 4, // Convert back to credits for display
                        available: currentPoints / 4,
                        action: 'analyze_profile'
                    }
                });
            }
            
            // Deduct credits_points immediately
            const newPoints = currentPoints - requiredPoints;
            const newCredits = newPoints / 4;
            
            await client.query(
                'UPDATE users SET credits_points = $1, credits_remaining = $2, updated_at = NOW() WHERE id = $3',
                [newPoints, Math.floor(newCredits), req.user.id]
            );
            
            // Log credit transaction in credits_history
            await client.query(`
                INSERT INTO credits_history (user_id, action, points_used, credits_used, points_remaining, credits_remaining)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [req.user.id, 'analyze_profile', requiredPoints, requiredPoints / 4, newPoints, newCredits]);
            
            console.log(`💰 Credits charged: ${currentPoints} → ${newPoints} points (${requiredPoints / 4} credits)`);
            
            // Commit credit deduction before potentially long LLM call
            await client.query('COMMIT');
            
            console.log('🤖 Using LLM orchestrator for target profile extraction...');
            
            try {
                // Use LLM orchestrator instead of direct sendToGemini  
                const result = await processProfileWithLLM({ 
                    html, 
                    url: cleanProfileUrl, 
                    isUserProfile: false 
                });

                if (!result.success) {
                    // CREDITS UPDATE: Refund on hard failure (best effort)
                    try {
                        console.log(`🔄 LLM failed, attempting refund of ${requiredPoints} points...`);
                        await pool.query(
                            'UPDATE users SET credits_points = credits_points + $1, credits_remaining = (credits_points + $1) / 4 WHERE id = $2',
                            [requiredPoints, req.user.id]
                        );
                        console.log(`✅ Refund completed`);
                    } catch (refundError) {
                        console.error('❌ Refund failed:', refundError.message);
                    }
                    
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
                
                // CREDITS UPDATE: Step 4 - Save to DB with full parity (UPSERT by user_id, normalized_url)
                const upsertResult = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, normalized_url, linkedin_url, full_name, headline, "current_role", 
                        current_company, location, about, connections_count, followers_count,
                        total_likes, total_comments, total_shares, average_likes,
                        experience, education, skills, certifications, awards, volunteer_experience,
                        data_json, raw_html, ai_provider, ai_model, input_tokens, output_tokens, total_tokens,
                        token_usage, scraped_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT (user_id, normalized_url)
                    DO UPDATE SET
                        linkedin_url = EXCLUDED.linkedin_url,
                        full_name = EXCLUDED.full_name,
                        headline = EXCLUDED.headline,
                        "current_role" = EXCLUDED."current_role",
                        current_company = EXCLUDED.current_company,
                        location = EXCLUDED.location,
                        about = EXCLUDED.about,
                        connections_count = EXCLUDED.connections_count,
                        followers_count = EXCLUDED.followers_count,
                        total_likes = EXCLUDED.total_likes,
                        total_comments = EXCLUDED.total_comments,
                        total_shares = EXCLUDED.total_shares,
                        average_likes = EXCLUDED.average_likes,
                        experience = EXCLUDED.experience,
                        education = EXCLUDED.education,
                        skills = EXCLUDED.skills,
                        certifications = EXCLUDED.certifications,
                        awards = EXCLUDED.awards,
                        volunteer_experience = EXCLUDED.volunteer_experience,
                        data_json = EXCLUDED.data_json,
                        raw_html = EXCLUDED.raw_html,
                        ai_provider = EXCLUDED.ai_provider,
                        ai_model = EXCLUDED.ai_model,
                        input_tokens = EXCLUDED.input_tokens,
                        output_tokens = EXCLUDED.output_tokens,
                        total_tokens = EXCLUDED.total_tokens,
                        token_usage = EXCLUDED.token_usage,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `, [
                    req.user.id,                                    // $1 - user_id
                    normalizedUrl,                                  // $2 - normalized_url
                    cleanProfileUrl,                                // $3 - linkedin_url
                    p?.profile?.name || '',                         // $4 - full_name
                    p?.profile?.headline || '',                     // $5 - headline
                    p?.profile?.currentRole || '',                  // $6 - current_role
                    p?.profile?.currentCompany || '',               // $7 - current_company
                    p?.profile?.location || '',                     // $8 - location
                    p?.profile?.about || '',                        // $9 - about
                    numeric.connections_count,                      // $10 - connections_count
                    numeric.followers_count,                        // $11 - followers_count
                    numeric.total_likes,                            // $12 - total_likes
                    numeric.total_comments,                         // $13 - total_comments
                    numeric.total_shares,                           // $14 - total_shares
                    numeric.average_likes,                          // $15 - average_likes
                    JSON.stringify(p?.experience || []),            // $16 - experience
                    JSON.stringify(p?.education || []),             // $17 - education
                    JSON.stringify(p?.skills || []),                // $18 - skills
                    JSON.stringify(p?.certifications || []),        // $19 - certifications
                    JSON.stringify(p?.awards || []),                // $20 - awards
                    JSON.stringify(p?.volunteer || []),             // $21 - volunteer_experience
                    JSON.stringify(p),                              // $22 - data_json (Full AI output)
                    html,                                           // $23 - raw_html
                    aiResult.provider || 'gemini',                  // $24 - ai_provider
                    aiResult.model || 'gemini-1.5-flash',          // $25 - ai_model
                    aiResult.usage?.input_tokens || 0,              // $26 - input_tokens
                    aiResult.usage?.output_tokens || 0,             // $27 - output_tokens
                    aiResult.usage?.total_tokens || 0,              // $28 - total_tokens
                    JSON.stringify(aiResult.usage || {})            // $29 - token_usage
                ]);
                
                const targetProfile = upsertResult.rows[0];
                
                console.log(`🎯 Target profile successfully saved for user ${req.user.id} with LLM orchestrator, numeric sanitization, and credit charging!`);
                
                res.json({
                    success: true,
                    message: 'Target profile analyzed and saved successfully!',
                    alreadyExists: false,
                    data: {
                        targetProfile: {
                            id: targetProfile.id,
                            linkedinUrl: targetProfile.linkedin_url,
                            normalizedUrl: targetProfile.normalized_url,
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
                        tokenUsage: aiResult.usage,
                        storage: {
                            raw_html_saved: true,
                            parsed_json_saved: true,
                            full_parity_with_user_profile: true
                        },
                        credits: {
                            charged: requiredPoints / 4, // 0.25 credits
                            remaining: newCredits,
                            action: 'analyze_profile'
                        }
                    }
                });
                
            } catch (llmError) {
                // CREDITS UPDATE: Refund on LLM failure
                try {
                    console.log(`🔄 LLM error, attempting refund of ${requiredPoints} points...`);
                    await pool.query(
                        'UPDATE users SET credits_points = credits_points + $1, credits_remaining = (credits_points + $1) / 4 WHERE id = $2',
                        [requiredPoints, req.user.id]
                    );
                    console.log(`✅ Refund completed due to LLM error`);
                } catch (refundError) {
                    console.error('❌ Refund failed:', refundError.message);
                }
                
                throw llmError; // Re-throw to be caught by outer catch
            }
            
        } catch (error) {
            console.error('❌ Target profile scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to analyze target profile',
                details: error.message
            });
        } finally {
            client.release();
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
            
            // CREDITS UPDATE: Check credits_points instead of credits_remaining
            const userResult = await client.query(
                'SELECT credits_points, credits_remaining FROM users WHERE id = $1 FOR UPDATE',
                [req.user.id]
            );
            
            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            const currentPoints = userResult.rows[0].credits_points || 0;
            const requiredPoints = 4; // 1.00 credit = 4 points
            
            if (currentPoints < requiredPoints) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient credits. Please upgrade your plan.',
                    needsUpgrade: true,
                    data: {
                        required: requiredPoints / 4, // Convert back to credits
                        available: currentPoints / 4,
                        action: 'generate_message'
                    }
                });
            }
            
            // Deduct credits_points immediately (before API call)
            const newPoints = currentPoints - requiredPoints;
            const newCredits = newPoints / 4;
            
            await client.query(
                'UPDATE users SET credits_points = $1, credits_remaining = $2 WHERE id = $3',
                [newPoints, Math.floor(newCredits), req.user.id]
            );
            
            // Log the credit transaction in credits_history
            await client.query(`
                INSERT INTO credits_history (user_id, action, points_used, credits_used, points_remaining, credits_remaining)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [req.user.id, 'generate_message', requiredPoints, requiredPoints / 4, newPoints, newCredits]);
            
            // Log the message generation in message_logs (legacy table)
            await client.query(
                'INSERT INTO message_logs (user_id, target_name, target_url, generated_message, message_context, credits_used) VALUES ($1, $2, $3, $4, $5, $6)',
                [req.user.id, targetProfile.fullName, targetProfile.linkedinUrl, 'Message placeholder', context, 1]
            );
            
            // Commit credit deduction before potentially long API call
            await client.query('COMMIT');
            
            console.log(`💳 Credits charged for message generation: ${currentPoints} → ${newPoints} points (${requiredPoints / 4} credits)`);
            
            // Generate message (placeholder for now - integrate with GPT-4.1 later)
            const simulatedMessage = `Hi ${targetProfile.firstName || targetProfile.fullName?.split(' ')[0] || 'there'},

I noticed your impressive work at ${targetProfile.currentCompany || 'your company'}. ${context}

Would love to connect and learn more about your experience!

Best regards`;
            
            const score = Math.floor(Math.random() * 20) + 80; // Random score between 80-100
            
            console.log(`✅ Message generated successfully for user ${req.user.id}`);
            
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
                        creditsUsed: requiredPoints / 4, // 1.00 credit
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
                    id,
                    linkedin_url,
                    normalized_url,
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
                normalizedUrl: profile.normalized_url, // CREDITS UPDATE: Include normalized URL
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
