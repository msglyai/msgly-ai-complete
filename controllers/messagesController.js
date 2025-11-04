// controllers/messagesController.js
// Messages Controller - GPT-5 powered message generation handlers
// UNIFIED FIX: Added skipCredits parameter to prevent double charging when called from unified endpoint

const { pool } = require('../utils/database');
const { cleanLinkedInUrl } = require('../utils/helpers');
const {
    createCreditHold,
    releaseCreditHold,
    completeOperation
} = require('../credits');
const gptService = require('../services/gptService');

// FIXED: Enhanced Message Generation with GPT-5 and comprehensive logging + VARCHAR(50) fix + UNIFIED SUPPORT
async function handleGenerateMessage(req, res, skipCredits = false) {
    let holdId = null;
    
    try {
        console.log('[MESSAGE] === GPT-5 MESSAGE GENERATION WITH DUAL CREDITS ===');
        console.log(`[USER] User ID: ${req.user.id}`);
        console.log('[CHECK] Request payload keys:', Object.keys(req.body));
        console.log('[CHECK] targetProfileUrl present:', !!req.body.targetProfileUrl);
        console.log('[CHECK] outreachContext present:', !!req.body.outreachContext);
        console.log('[UNIFIED] Skip credits:', skipCredits); // NEW: Log unified mode
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        console.log('[CHECK] targetProfileUrl:', targetProfileUrl.substring(0, 50) + '...');
        console.log('[CHECK] outreachContext length:', outreachContext.length);

        // UNIFIED FIX: Only create credit hold if not called from unified endpoint
        if (!skipCredits) {
            // Create credit hold
            console.log('[CREDIT] Creating credit hold for message generation...');
            const holdResult = await createCreditHold(userId, 'message_generation', {
                targetProfileUrl: targetProfileUrl,
                outreachContext: outreachContext,
                timestamp: new Date().toISOString()
            });

            if (!holdResult.success) {
                if (holdResult.error === 'insufficient_credits') {
                    return res.status(402).json({
                        success: false,
                        error: 'insufficient_credits',
                        userMessage: holdResult.userMessage,
                        currentCredits: holdResult.currentCredits,
                        requiredCredits: holdResult.requiredCredits
                    });
                }
                
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create credit hold',
                    details: holdResult.error
                });
            }

            holdId = holdResult.holdId;
            console.log(`[SUCCESS] Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        } else {
            console.log('[UNIFIED] Skipping credit hold - managed by unified endpoint');
        }

        // FIXED STEP 1: Load user profile from database - ADDED gemini_raw_data
        console.log('[DATABASE] Loading user profile JSON...');
        const userProfileResult = await pool.query(`
            SELECT 
                gemini_raw_data,
                full_name,
                headline,
                current_job_title,
                current_company,
                location,
                experience,
                education,
                skills,
                about
            FROM user_profiles
            WHERE user_id = $1
        `, [userId]);

        if (userProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'user_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'User profile not found. Please complete your profile setup first.'
            });
        }

        const userProfile = userProfileResult.rows[0];
        
        // FIXED: Added debug logging for gemini_raw_data
        console.log('[DEBUG] User gemini_raw_data present:', !!userProfile.gemini_raw_data);
        if (userProfile.gemini_raw_data) {
            const geminiDataSize = typeof userProfile.gemini_raw_data === 'string' 
                ? userProfile.gemini_raw_data.length 
                : JSON.stringify(userProfile.gemini_raw_data).length;
            console.log('[DEBUG] User gemini_raw_data size (bytes):', geminiDataSize);
        }
        console.log('[CHECK] user profile has name:', !!userProfile.full_name);

        // STEP 2: Load target profile from database  
        console.log('[DATABASE] Loading target profile JSON...');
        const cleanTargetUrl = cleanLinkedInUrl(targetProfileUrl);
        const targetProfileResult = await pool.query(`
            SELECT 
                id,
                data_json,
                linkedin_url
            FROM target_profiles
            WHERE linkedin_url = $1 OR linkedin_url = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [cleanTargetUrl, targetProfileUrl]);

        if (targetProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'target_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'Target profile not found. Please analyze the target profile first.'
            });
        }

        const targetProfile = targetProfileResult.rows[0];
        console.log('[CHECK] target_profile_json present:', !!targetProfile.data_json);
        console.log('[CHECK] target profile ID:', targetProfile.id);
        
        // FIXED: Added debug logging for nested profile structure
        let hasNestedProfile = false;
        if (targetProfile.data_json) {
            try {
                const parsedData = typeof targetProfile.data_json === 'string' 
                    ? JSON.parse(targetProfile.data_json) 
                    : targetProfile.data_json;
                hasNestedProfile = !!(parsedData.data && parsedData.data.profile);
            } catch (e) {
                // Parsing error, log but continue
                console.log('[DEBUG] Error parsing target profile data_json for debug check');
            }
        }
        console.log('[DEBUG] Target nested profile present:', hasNestedProfile);

        // STEP 3: Call GPT-5 service for message generation
        console.log('[GPT] Calling GPT-5 service for message generation...');
        const gptStartTime = Date.now();
        
        const gptResult = await gptService.generateLinkedInMessage(
            userProfile,
            targetProfile,
            outreachContext,
            'inbox_message'
        );

        const gptEndTime = Date.now();
        const gptLatency = gptEndTime - gptStartTime;

        console.log(`[GPT] GPT-5 call completed in ${gptLatency}ms`);
        console.log('[CHECK] GPT-5 success:', gptResult.success);

        // FIXED: Added GPT-5 usage logging after call
        if (gptResult.success && gptResult.tokenUsage) {
            console.log(`[DEBUG] GPT-5 usage - Input: ${gptResult.tokenUsage.input_tokens}, Output: ${gptResult.tokenUsage.output_tokens}, Total: ${gptResult.tokenUsage.total_tokens}`);
        }

        if (!gptResult.success) {
            console.error('[ERROR] GPT-5 message generation failed:', gptResult.error);
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'gpt_generation_failed');
            }
            
            return res.status(500).json({
                success: false,
                error: 'Message generation failed',
                details: gptResult.userMessage || 'AI service temporarily unavailable'
            });
        }

        const generatedMessage = gptResult.message;
        console.log('[SUCCESS] Message generated successfully');
        console.log('[GPT] Generated message preview:', generatedMessage.substring(0, 120) + '...');
        console.log('[GPT] Token usage:', gptResult.tokenUsage);

        // STEP 4: Store comprehensive data in message_logs table
        console.log('[DATABASE] Storing message generation data...');
        
        // FIXED: Truncate metadata to prevent VARCHAR(50) errors
        const safeFirstName = (gptResult.metadata.target_first_name || '').substring(0, 45);
        const safeTitle = (gptResult.metadata.target_title || '').substring(0, 45);
        const safeCompany = (gptResult.metadata.target_company || '').substring(0, 45);
        
        // DIAGNOSTIC: Log all string field lengths to identify VARCHAR(50) problem
        console.log('[DEBUG] Field lengths before INSERT:');
        console.log('  target_profile_url:', targetProfileUrl?.length || 0);
        console.log('  generated_message:', generatedMessage?.length || 0); 
        console.log('  context_text:', outreachContext?.length || 0);
        console.log('  target_first_name:', safeFirstName?.length || 0);
        console.log('  target_title:', safeTitle?.length || 0);
        console.log('  target_company:', safeCompany?.length || 0);
        console.log('  model_name:', gptResult.metadata.model_name?.length || 0);
        console.log('  prompt_version:', gptResult.metadata.prompt_version?.length || 0);
        
        const messageLogResult = await pool.query(`
            INSERT INTO message_logs (
                user_id,
                target_profile_url,
                generated_message,
                context_text,
                target_first_name,
                target_title,
                target_company,
                model_name,
                prompt_version,
                input_tokens,
                output_tokens,
                total_tokens,
                latency_ms,
                data_json,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
            RETURNING id
        `, [
            userId,
            cleanTargetUrl, // âœ… FIXED: Use cleaned URL instead of raw URL
            generatedMessage,
            outreachContext,
            safeFirstName,
            safeTitle,
            safeCompany,
            gptResult.metadata.model_name,
            gptResult.metadata.prompt_version,
            gptResult.tokenUsage.input_tokens,
            gptResult.tokenUsage.output_tokens,
            gptResult.tokenUsage.total_tokens,
            gptResult.metadata.latency_ms,
            JSON.stringify(gptResult.rawResponse)
        ]);

        const messageLogId = messageLogResult.rows[0].id;
        console.log('[SUCCESS] Message log inserted with ID:', messageLogId);

        // UNIFIED FIX: Only complete operation if not called from unified endpoint
        let completionResult = null;
        if (!skipCredits) {
            // STEP 5: Complete the credit hold (this handles the deduction)
            completionResult = await completeOperation(userId, holdId, {
                messageGenerated: true,
                messageLength: generatedMessage.length,
                targetUrl: targetProfileUrl,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage
            });

            if (!completionResult.success) {
                console.error('[ERROR] Failed to complete operation:', completionResult.error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process credits after successful generation'
                });
            }

            console.log(`[MONEY] Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
        } else {
            console.log('[UNIFIED] Skipping credit completion - managed by unified endpoint');
        }

        // UNIFIED FIX: Return consistent response format for both direct and unified calls
        const responseData = {
            success: true,
            message: 'LinkedIn message generated successfully with GPT-5',
            data: {
                message: generatedMessage, // UNIFIED: Consistent field name
                generatedMessage: generatedMessage, // Keep original field for backwards compatibility
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage,
                processingTime: gptLatency
            }
        };

        // Add credits info only if not skipped
        if (!skipCredits && completionResult) {
            responseData.credits = {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                renewableCredits: completionResult.renewableCredits,
                payasyougoCredits: completionResult.payasyougoCredits,
                transactionId: completionResult.transactionId,
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0 // UNIFIED: Add tokensUsed field
            };
        } else {
            // For unified calls, still include token usage for unified endpoint processing
            responseData.credits = {
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0
            };
        }

        res.json(responseData);

    } catch (error) {
        console.error('[ERROR] Message generation error:', error);
        
        if (!skipCredits && holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Message generation failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// COMPLETED: Connection Request Generation with dual credit system + VARCHAR(50) fix + UNIFIED SUPPORT
async function handleGenerateConnection(req, res, skipCredits = false) {
    let holdId = null;
    
    try {
        console.log('[CONNECT] === CONNECTION GENERATION WITH DUAL CREDITS ===');
        console.log(`[USER] User ID: ${req.user.id}`);
        console.log('[UNIFIED] Skip credits:', skipCredits); // NEW: Log unified mode
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        console.log('[CHECK] targetProfileUrl:', targetProfileUrl.substring(0, 50) + '...');
        console.log('[CHECK] outreachContext length:', outreachContext.length);

        // UNIFIED FIX: Only create credit hold if not called from unified endpoint
        if (!skipCredits) {
            // Create credit hold
            console.log('[CREDIT] Creating credit hold for connection generation...');
            const holdResult = await createCreditHold(userId, 'connection_generation', {
                targetProfileUrl: targetProfileUrl,
                outreachContext: outreachContext,
                timestamp: new Date().toISOString()
            });

            if (!holdResult.success) {
                if (holdResult.error === 'insufficient_credits') {
                    return res.status(402).json({
                        success: false,
                        error: 'insufficient_credits',
                        userMessage: holdResult.userMessage,
                        currentCredits: holdResult.currentCredits,
                        requiredCredits: holdResult.requiredCredits
                    });
                }
                
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create credit hold',
                    details: holdResult.error
                });
            }

            holdId = holdResult.holdId;
            console.log(`[SUCCESS] Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        } else {
            console.log('[UNIFIED] Skipping credit hold - managed by unified endpoint');
        }

        // STEP 1: Load user profile from database
        console.log('[DATABASE] Loading user profile JSON...');
        const userProfileResult = await pool.query(`
            SELECT 
                gemini_raw_data,
                full_name,
                headline,
                current_job_title,
                current_company,
                location,
                experience,
                education,
                skills,
                about
            FROM user_profiles
            WHERE user_id = $1
        `, [userId]);

        if (userProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'user_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'User profile not found. Please complete your profile setup first.'
            });
        }

        const userProfile = userProfileResult.rows[0];
        console.log('[CHECK] user profile has name:', !!userProfile.full_name);

        // STEP 2: Load target profile from database  
        console.log('[DATABASE] Loading target profile JSON...');
        const cleanTargetUrl = cleanLinkedInUrl(targetProfileUrl);
        const targetProfileResult = await pool.query(`
            SELECT 
                id,
                data_json,
                linkedin_url
            FROM target_profiles
            WHERE linkedin_url = $1 OR linkedin_url = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [cleanTargetUrl, targetProfileUrl]);

        if (targetProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'target_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'Target profile not found. Please analyze the target profile first.'
            });
        }

        const targetProfile = targetProfileResult.rows[0];
        console.log('[CHECK] target profile ID:', targetProfile.id);

        // STEP 3: Call GPT service for connection generation
        console.log('[GPT] Calling GPT service for connection generation...');
        const gptStartTime = Date.now();
        
        const gptResult = await gptService.generateLinkedInConnection(
            userProfile,
            targetProfile,
            outreachContext
        );

        const gptEndTime = Date.now();
        const gptLatency = gptEndTime - gptStartTime;

        console.log(`[GPT] Connection generation completed in ${gptLatency}ms`);
        console.log('[CHECK] GPT success:', gptResult.success);

        if (!gptResult.success) {
            console.error('[ERROR] Connection generation failed:', gptResult.error);
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'gpt_generation_failed');
            }
            
            return res.status(500).json({
                success: false,
                error: 'Connection generation failed',
                details: gptResult.userMessage || 'AI service temporarily unavailable'
            });
        }

        const generatedConnection = gptResult.message;
        console.log('[SUCCESS] Connection request generated successfully');
        console.log('[GPT] Generated connection preview:', generatedConnection.substring(0, 120) + '...');

        // STEP 4: Store in message_logs table
        console.log('[DATABASE] Storing connection generation data...');
        
        // FIXED: Truncate metadata to prevent VARCHAR(50) errors
        const safeFirstName = (gptResult.metadata.target_first_name || '').substring(0, 45);
        const safeTitle = (gptResult.metadata.target_title || '').substring(0, 45);
        const safeCompany = (gptResult.metadata.target_company || '').substring(0, 45);
        
        const messageLogResult = await pool.query(`
            INSERT INTO message_logs (
                user_id,
                target_profile_url,
                generated_message,
                context_text,
                message_type,
                target_first_name,
                target_title,
                target_company,
                model_name,
                prompt_version,
                input_tokens,
                output_tokens,
                total_tokens,
                latency_ms,
                data_json,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
            RETURNING id
        `, [
            userId,
            cleanTargetUrl, // âœ… FIXED: Use cleaned URL instead of raw URL
            generatedConnection,
            outreachContext,
            'connection_request',
            safeFirstName,
            safeTitle,
            safeCompany,
            gptResult.metadata.model_name,
            gptResult.metadata.prompt_version,
            gptResult.tokenUsage.input_tokens,
            gptResult.tokenUsage.output_tokens,
            gptResult.tokenUsage.total_tokens,
            gptResult.metadata.latency_ms,
            JSON.stringify(gptResult.rawResponse)
        ]);

        const messageLogId = messageLogResult.rows[0].id;
        console.log('[SUCCESS] Connection log inserted with ID:', messageLogId);

        // UNIFIED FIX: Only complete operation if not called from unified endpoint
        let completionResult = null;
        if (!skipCredits) {
            // STEP 5: Complete the credit hold
            completionResult = await completeOperation(userId, holdId, {
                connectionGenerated: true,
                messageLength: generatedConnection.length,
                targetUrl: targetProfileUrl,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage
            });

            if (!completionResult.success) {
                console.error('[ERROR] Failed to complete operation:', completionResult.error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process credits after successful generation'
                });
            }

            console.log(`[MONEY] Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
        } else {
            console.log('[UNIFIED] Skipping credit completion - managed by unified endpoint');
        }

        // UNIFIED FIX: Return consistent response format for both direct and unified calls
        const responseData = {
            success: true,
            message: 'Connection request generated successfully',
            data: {
                message: generatedConnection, // UNIFIED: Consistent field name
                generatedConnection: generatedConnection, // Keep original field for backwards compatibility
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage,
                processingTime: gptLatency
            }
        };

        // Add credits info only if not skipped
        if (!skipCredits && completionResult) {
            responseData.credits = {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                renewableCredits: completionResult.renewableCredits,
                payasyougoCredits: completionResult.payasyougoCredits,
                transactionId: completionResult.transactionId,
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0 // UNIFIED: Add tokensUsed field
            };
        } else {
            // For unified calls, still include token usage for unified endpoint processing
            responseData.credits = {
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0
            };
        }

        res.json(responseData);

    } catch (error) {
        console.error('[ERROR] Connection generation error:', error);
        
        if (!skipCredits && holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Connection generation failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// NEW: Intro Request Generation with dual credit system + VARCHAR(50) fix + UNIFIED SUPPORT
async function handleGenerateIntro(req, res, skipCredits = false) {
    let holdId = null;
    
    try {
        console.log('[INTRO] === INTRO REQUEST GENERATION WITH DUAL CREDITS ===');
        console.log(`[USER] User ID: ${req.user.id}`);
        console.log('[UNIFIED] Skip credits:', skipCredits); // NEW: Log unified mode
        
        const { targetProfileUrl, outreachContext, mutualConnectionName } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext || !mutualConnectionName) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL, outreach context, and mutual connection name are required'
            });
        }

        console.log('[CHECK] targetProfileUrl:', targetProfileUrl.substring(0, 50) + '...');
        console.log('[CHECK] outreachContext length:', outreachContext.length);
        console.log('[CHECK] mutualConnectionName:', mutualConnectionName);

        // UNIFIED FIX: Only create credit hold if not called from unified endpoint
        if (!skipCredits) {
            // Create credit hold
            console.log('[CREDIT] Creating credit hold for intro generation...');
            const holdResult = await createCreditHold(userId, 'intro_generation', {
                targetProfileUrl: targetProfileUrl,
                outreachContext: outreachContext,
                mutualConnectionName: mutualConnectionName,
                timestamp: new Date().toISOString()
            });

            if (!holdResult.success) {
                if (holdResult.error === 'insufficient_credits') {
                    return res.status(402).json({
                        success: false,
                        error: 'insufficient_credits',
                        userMessage: holdResult.userMessage,
                        currentCredits: holdResult.currentCredits,
                        requiredCredits: holdResult.requiredCredits
                    });
                }
                
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create credit hold',
                    details: holdResult.error
                });
            }

            holdId = holdResult.holdId;
            console.log(`[SUCCESS] Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        } else {
            console.log('[UNIFIED] Skipping credit hold - managed by unified endpoint');
        }

        // STEP 1: Load user profile from database
        console.log('[DATABASE] Loading user profile JSON...');
        const userProfileResult = await pool.query(`
            SELECT 
                gemini_raw_data,
                full_name,
                headline,
                current_job_title,
                current_company,
                location,
                experience,
                education,
                skills,
                about
            FROM user_profiles
            WHERE user_id = $1
        `, [userId]);

        if (userProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'user_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'User profile not found. Please complete your profile setup first.'
            });
        }

        const userProfile = userProfileResult.rows[0];
        console.log('[CHECK] user profile has name:', !!userProfile.full_name);

        // STEP 2: Load target profile from database  
        console.log('[DATABASE] Loading target profile JSON...');
        const cleanTargetUrl = cleanLinkedInUrl(targetProfileUrl);
        const targetProfileResult = await pool.query(`
            SELECT 
                id,
                data_json,
                linkedin_url
            FROM target_profiles
            WHERE linkedin_url = $1 OR linkedin_url = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [cleanTargetUrl, targetProfileUrl]);

        if (targetProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'target_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'Target profile not found. Please analyze the target profile first.'
            });
        }

        const targetProfile = targetProfileResult.rows[0];
        console.log('[CHECK] target profile ID:', targetProfile.id);

        // STEP 3: Call GPT service for intro generation
        console.log('[GPT] Calling GPT service for intro generation...');
        const gptStartTime = Date.now();
        
        const gptResult = await gptService.generateIntroRequest(
            userProfile,
            targetProfile,
            outreachContext,
            mutualConnectionName
        );

        const gptEndTime = Date.now();
        const gptLatency = gptEndTime - gptStartTime;

        console.log(`[GPT] Intro generation completed in ${gptLatency}ms`);
        console.log('[CHECK] GPT success:', gptResult.success);

        if (!gptResult.success) {
            console.error('[ERROR] Intro generation failed:', gptResult.error);
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'gpt_generation_failed');
            }
            
            return res.status(500).json({
                success: false,
                error: 'Intro generation failed',
                details: gptResult.userMessage || 'AI service temporarily unavailable'
            });
        }

        // Extract Part A and Part B from GPT result
        const partA = gptResult.partA || '';
        const partB = gptResult.partB || '';
        const combinedMessage = `Part A: ${partA}\nPart B: ${partB}`;
        
        console.log('[SUCCESS] Intro request generated successfully');
        console.log('[GPT] Part A preview:', partA.substring(0, 80) + '...');
        console.log('[GPT] Part B preview:', partB.substring(0, 80) + '...');

        // STEP 4: Store in message_logs table (concatenated format)
        console.log('[DATABASE] Storing intro generation data...');
        
        // FIXED: Truncate metadata to prevent VARCHAR(50) errors
        const safeFirstName = (gptResult.metadata.target_first_name || '').substring(0, 45);
        const safeTitle = (gptResult.metadata.target_title || '').substring(0, 45);
        const safeCompany = (gptResult.metadata.target_company || '').substring(0, 45);
        
        const messageLogResult = await pool.query(`
            INSERT INTO message_logs (
                user_id,
                target_profile_url,
                generated_message,
                context_text,
                message_type,
                target_first_name,
                target_title,
                target_company,
                model_name,
                prompt_version,
                input_tokens,
                output_tokens,
                total_tokens,
                latency_ms,
                data_json,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
            RETURNING id
        `, [
            userId,
            cleanTargetUrl, // âœ… FIXED: Use cleaned URL instead of raw URL
            combinedMessage,
            outreachContext,
            'intro_request',
            safeFirstName,
            safeTitle,
            safeCompany,
            gptResult.metadata.model_name,
            gptResult.metadata.prompt_version,
            gptResult.tokenUsage.input_tokens,
            gptResult.tokenUsage.output_tokens,
            gptResult.tokenUsage.total_tokens,
            gptResult.metadata.latency_ms,
            JSON.stringify({ partA, partB, mutualConnectionName, rawResponse: gptResult.rawResponse })
        ]);

        const messageLogId = messageLogResult.rows[0].id;
        console.log('[SUCCESS] Intro log inserted with ID:', messageLogId);

        // UNIFIED FIX: Only complete operation if not called from unified endpoint
        let completionResult = null;
        if (!skipCredits) {
            // STEP 5: Complete the credit hold
            completionResult = await completeOperation(userId, holdId, {
                introGenerated: true,
                messageLength: combinedMessage.length,
                targetUrl: targetProfileUrl,
                mutualConnectionName: mutualConnectionName,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage
            });

            if (!completionResult.success) {
                console.error('[ERROR] Failed to complete operation:', completionResult.error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process credits after successful generation'
                });
            }

            console.log(`[MONEY] Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
        } else {
            console.log('[UNIFIED] Skipping credit completion - managed by unified endpoint');
        }

        // UNIFIED FIX: Return consistent response format for both direct and unified calls
        const responseData = {
            success: true,
            message: 'Intro request generated successfully',
            data: {
                message: combinedMessage, // UNIFIED: Consistent field name
                partA: partA,
                partB: partB,
                combinedMessage: combinedMessage, // Keep original field for backwards compatibility
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl,
                mutualConnectionName: mutualConnectionName,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage,
                processingTime: gptLatency
            }
        };

        // Add credits info only if not skipped
        if (!skipCredits && completionResult) {
            responseData.credits = {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                renewableCredits: completionResult.renewableCredits,
                payasyougoCredits: completionResult.payasyougoCredits,
                transactionId: completionResult.transactionId,
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0 // UNIFIED: Add tokensUsed field
            };
        } else {
            // For unified calls, still include token usage for unified endpoint processing
            responseData.credits = {
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0
            };
        }

        res.json(responseData);

    } catch (error) {
        console.error('[ERROR] Intro generation error:', error);
        
        if (!skipCredits && holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Intro generation failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// NEW: Cold Email Generation with dual credit system + VARCHAR(50) fix + UNIFIED SUPPORT
async function handleGenerateColdEmail(req, res, skipCredits = false) {
    let holdId = null;
    
    try {
        console.log('[COLD_EMAIL] === COLD EMAIL GENERATION WITH DUAL CREDITS ===');
        console.log(`[USER] User ID: ${req.user.id}`);
        console.log('[UNIFIED] Skip credits:', skipCredits); // NEW: Log unified mode
        
        const { targetProfileUrl, outreachContext } = req.body;
        const userId = req.user.id;
        
        if (!targetProfileUrl || !outreachContext) {
            return res.status(400).json({
                success: false,
                error: 'Target profile URL and outreach context are required'
            });
        }

        console.log('[CHECK] targetProfileUrl:', targetProfileUrl.substring(0, 50) + '...');
        console.log('[CHECK] outreachContext length:', outreachContext.length);

        // UNIFIED FIX: Only create credit hold if not called from unified endpoint
        if (!skipCredits) {
            // Create credit hold
            console.log('[CREDIT] Creating credit hold for cold email generation...');
            const holdResult = await createCreditHold(userId, 'cold_email_generation', {
                targetProfileUrl: targetProfileUrl,
                outreachContext: outreachContext,
                timestamp: new Date().toISOString()
            });

            if (!holdResult.success) {
                if (holdResult.error === 'insufficient_credits') {
                    return res.status(402).json({
                        success: false,
                        error: 'insufficient_credits',
                        userMessage: holdResult.userMessage,
                        currentCredits: holdResult.currentCredits,
                        requiredCredits: holdResult.requiredCredits
                    });
                }
                
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create credit hold',
                    details: holdResult.error
                });
            }

            holdId = holdResult.holdId;
            console.log(`[SUCCESS] Credit hold created: ${holdId} for ${holdResult.amountHeld} credits`);
        } else {
            console.log('[UNIFIED] Skipping credit hold - managed by unified endpoint');
        }

        // STEP 1: Load user profile from database
        console.log('[DATABASE] Loading user profile JSON...');
        const userProfileResult = await pool.query(`
            SELECT 
                gemini_raw_data,
                full_name,
                headline,
                current_job_title,
                current_company,
                location,
                experience,
                education,
                skills,
                about
            FROM user_profiles
            WHERE user_id = $1
        `, [userId]);

        if (userProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'user_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'User profile not found. Please complete your profile setup first.'
            });
        }

        const userProfile = userProfileResult.rows[0];
        console.log('[CHECK] user profile has name:', !!userProfile.full_name);

        // STEP 2: Load target profile from database  
        console.log('[DATABASE] Loading target profile JSON...');
        const cleanTargetUrl = cleanLinkedInUrl(targetProfileUrl);
        const targetProfileResult = await pool.query(`
            SELECT 
                id,
                data_json,
                linkedin_url
            FROM target_profiles
            WHERE linkedin_url = $1 OR linkedin_url = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [cleanTargetUrl, targetProfileUrl]);

        if (targetProfileResult.rows.length === 0) {
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'target_profile_not_found');
            }
            return res.status(400).json({
                success: false,
                error: 'Target profile not found. Please analyze the target profile first.'
            });
        }

        const targetProfile = targetProfileResult.rows[0];
        console.log('[CHECK] target profile ID:', targetProfile.id);

        // STEP 3: Call GPT service for cold email generation
        console.log('[GPT] Calling GPT service for cold email generation...');
        const gptStartTime = Date.now();
        
        const gptResult = await gptService.generateColdEmail(
            userProfile,
            targetProfile,
            outreachContext
        );

        const gptEndTime = Date.now();
        const gptLatency = gptEndTime - gptStartTime;

        console.log(`[GPT] Cold email generation completed in ${gptLatency}ms`);
        console.log('[CHECK] GPT success:', gptResult.success);

        if (!gptResult.success) {
            console.error('[ERROR] Cold email generation failed:', gptResult.error);
            if (!skipCredits && holdId) {
                await releaseCreditHold(userId, holdId, 'gpt_generation_failed');
            }
            
            return res.status(500).json({
                success: false,
                error: 'Cold email generation failed',
                details: gptResult.userMessage || 'AI service temporarily unavailable'
            });
        }

        const generatedColdEmail = gptResult.message;
        console.log('[SUCCESS] Cold email generated successfully');
        console.log('[GPT] Generated cold email preview:', generatedColdEmail.substring(0, 120) + '...');

        // STEP 4: Store in message_logs table
        console.log('[DATABASE] Storing cold email generation data...');
        
        // FIXED: Truncate metadata to prevent VARCHAR(50) errors
        const safeFirstName = (gptResult.metadata.target_first_name || '').substring(0, 45);
        const safeTitle = (gptResult.metadata.target_title || '').substring(0, 45);
        const safeCompany = (gptResult.metadata.target_company || '').substring(0, 45);
        
        const messageLogResult = await pool.query(`
            INSERT INTO message_logs (
                user_id,
                target_profile_url,
                generated_message,
                context_text,
                message_type,
                target_first_name,
                target_title,
                target_company,
                model_name,
                prompt_version,
                input_tokens,
                output_tokens,
                total_tokens,
                latency_ms,
                data_json,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
            RETURNING id
        `, [
            userId,
            cleanTargetUrl, // âœ… FIXED: Use cleaned URL instead of raw URL
            generatedColdEmail,
            outreachContext,
            'cold_email',
            safeFirstName,
            safeTitle,
            safeCompany,
            gptResult.metadata.model_name,
            gptResult.metadata.prompt_version,
            gptResult.tokenUsage.input_tokens,
            gptResult.tokenUsage.output_tokens,
            gptResult.tokenUsage.total_tokens,
            gptResult.metadata.latency_ms,
            JSON.stringify(gptResult.rawResponse)
        ]);

        const messageLogId = messageLogResult.rows[0].id;
        console.log('[SUCCESS] Cold email log inserted with ID:', messageLogId);

        // UNIFIED FIX: Only complete operation if not called from unified endpoint
        let completionResult = null;
        if (!skipCredits) {
            // STEP 5: Complete the credit hold
            completionResult = await completeOperation(userId, holdId, {
                coldEmailGenerated: true,
                messageLength: generatedColdEmail.length,
                targetUrl: targetProfileUrl,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage
            });

            if (!completionResult.success) {
                console.error('[ERROR] Failed to complete operation:', completionResult.error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process credits after successful generation'
                });
            }

            console.log(`[MONEY] Credits deducted: ${completionResult.creditsDeducted}, New balance: ${completionResult.newBalance}`);
        } else {
            console.log('[UNIFIED] Skipping credit completion - managed by unified endpoint');
        }

        // UNIFIED FIX: Return consistent response format for both direct and unified calls
        const responseData = {
            success: true,
            message: 'Cold email generated successfully',
            data: {
                message: generatedColdEmail, // UNIFIED: Consistent field name
                generatedColdEmail: generatedColdEmail, // Keep original field for backwards compatibility
                outreachContext: outreachContext,
                targetProfileUrl: targetProfileUrl,
                messageLogId: messageLogId,
                tokenUsage: gptResult.tokenUsage,
                processingTime: gptLatency
            }
        };

        // Add credits info only if not skipped
        if (!skipCredits && completionResult) {
            responseData.credits = {
                deducted: completionResult.creditsDeducted,
                newBalance: completionResult.newBalance,
                renewableCredits: completionResult.renewableCredits,
                payasyougoCredits: completionResult.payasyougoCredits,
                transactionId: completionResult.transactionId,
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0 // UNIFIED: Add tokensUsed field
            };
        } else {
            // For unified calls, still include token usage for unified endpoint processing
            responseData.credits = {
                tokensUsed: gptResult.tokenUsage?.total_tokens || 0
            };
        }

        res.json(responseData);

    } catch (error) {
        console.error('[ERROR] Cold email generation error:', error);
        
        if (!skipCredits && holdId) {
            await releaseCreditHold(req.user.id, holdId, 'processing_error');
        }
        
        res.status(500).json({
            success: false,
            error: 'Cold email generation failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

module.exports = {
    handleGenerateMessage,
    handleGenerateConnection,
    handleGenerateIntro,
    handleGenerateColdEmail
};
