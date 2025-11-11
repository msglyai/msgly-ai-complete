// Enhanced sendToGemini.js - OpenAI GPT-4o-mini PRIMARY with GPT-5-nano Parallel Racing Fallback
const axios = require('axios');
const https = require('https');

// ⚡ FALLBACK CONFIGURATION
const FALLBACK_CONFIG = {
    ATTEMPT_1_TIMEOUT: 90000,        // 90 seconds (1.5 minutes) for first attempt (mini is faster)
    ENABLE_PARALLEL_RETRY: true,     // Enable parallel racing on retry
    NANO_MODEL: 'gpt-5-nano',        // Fallback model (better quality, slower)
    NANO_TIMEOUT: 150000             // 150 seconds timeout for nano
};

// ✅ Rate limiting configuration (OpenAI GPT-5-nano)
const RATE_LIMIT = {
    DELAY_BETWEEN_REQUESTS: 1000,    // 1 second between requests
    MAX_RETRIES: 3,                  // Maximum retry attempts
    RETRY_DELAY_BASE: 3000,          // Base delay for exponential backoff (3 seconds)
    MAX_RETRY_DELAY: 20000          // Maximum retry delay (20 seconds)
};

// 🚀 INCREASED limits for TESTING - Allow more content to preserve complete data
const OPENAI_LIMITS = {
    MAX_TOKENS_INPUT: 50000,         // Same (you have 28K headroom)
    MAX_TOKENS_OUTPUT: 18000,        // INCREASED: 12000 → 18000 tokens (~13,500 words)
    MAX_SIZE_KB: 4000               // INCREASED: 3000 → 4000 KB (more content preserved)
};

// ✅ Last request timestamp for rate limiting
let lastRequestTime = 0;

// ✅ Keep-alive agent for resilient OpenAI calls
const keepAliveAgent = new https.Agent({ keepAlive: true });
const TRY_TIMEOUTS_MS = process.env.MSGLY_OPENAI_TIMEOUTS_MS
  ? process.env.MSGLY_OPENAI_TIMEOUTS_MS.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
  : [90000, 150000]; // 90s then 150s

// ✅ Resilient OpenAI call with keep-alive + longer timeouts + smart retries
async function callOpenAIWithResilience(url, body, headers) {
  let lastErr;
  for (let attempt = 0; attempt < TRY_TIMEOUTS_MS.length; attempt++) {
    const timeout = TRY_TIMEOUTS_MS[attempt];
    const started = Date.now();
    try {
      const res = await axios.post(url, body, {
        headers, 
        timeout,
        httpAgent: keepAliveAgent, 
        httpsAgent: keepAliveAgent,
        maxBodyLength: Infinity, 
        maxContentLength: Infinity,
        validateStatus: s => (s >= 200 && s < 300) || s === 429
      });
      console.log('[OpenAI] ok', { ms: Date.now() - started, status: res.status });
      return res;
    } catch (err) {
      const s = err.response?.status;
      const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
      console.error('[OpenAI] fail', {
        attempt: attempt + 1,
        ms: Date.now() - started,
        isTimeout, status: s,
        requestId: err.response?.headers?.['x-request-id']
      });
      lastErr = err;
      if (isTimeout || s === 429 || (s >= 500 && s <= 599)) {
        await new Promise(r => setTimeout(r, 500 + Math.random()*700));
        continue;
      }
      break; // do not retry on non-429 4xx
    }
  }
  throw lastErr;
}

// ✅ Rate limiting delay function
async function enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT.DELAY_BETWEEN_REQUESTS) {
        const waitTime = RATE_LIMIT.DELAY_BETWEEN_REQUESTS - timeSinceLastRequest;
        console.log(`⏰ Rate limiting: waiting ${waitTime}ms before next request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastRequestTime = Date.now();
}

// ✅ Enhanced retry logic with exponential backoff
async function retryWithBackoff(fn, maxRetries = RATE_LIMIT.MAX_RETRIES) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Don't retry on non-retryable errors
            if (error.response?.status === 400 || error.response?.status === 401) {
                throw error;
            }
            
            if (attempt === maxRetries) {
                console.error(`❌ All ${maxRetries} retry attempts failed`);
                break;
            }
            
            // Calculate exponential backoff delay
            const baseDelay = RATE_LIMIT.RETRY_DELAY_BASE;
            const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
            const jitteredDelay = exponentialDelay + (Math.random() * 1000); // Add jitter
            const finalDelay = Math.min(jitteredDelay, RATE_LIMIT.MAX_RETRY_DELAY);
            
            console.log(`⏳ Attempt ${attempt} failed, retrying in ${Math.round(finalDelay)}ms...`);
            console.log(`   Error: ${error.message}`);
            
            await new Promise(resolve => setTimeout(resolve, finalDelay));
        }
    }
    
    throw lastError;
}

// 🚀 LESS AGGRESSIVE LinkedIn HTML Preprocessor based on optimization mode
function preprocessHTMLForGemini(html, optimizationMode = 'less_aggressive') {
    try {
        console.log(`🔥 Starting ${optimizationMode} HTML preprocessing (size: ${(html.length / 1024).toFixed(2)} KB)`);
        
        let processedHtml = html;
        const originalSize = processedHtml.length;
        
        // Different preprocessing based on mode
        if (optimizationMode === 'standard') {
            // More aggressive preprocessing for user profiles
            console.log('🎯 Stage 1: Standard mode - more aggressive preprocessing...');
            
            // Remove larger sections for standard mode
            processedHtml = processedHtml
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
                .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
                .replace(/\s+class="[^"]*"/gi, '')
                .replace(/\s+data-[^=]*="[^"]*"/gi, '')
                .replace(/\s+on\w+="[^"]*"/gi, '')
                .replace(/\s+style="[^"]*"/gi, '')
                .replace(/\s{3,}/g, ' ')
                .replace(/>\s+</g, '><')
                .trim();
        } else {
            // Less aggressive preprocessing for target profiles
            console.log('🎯 Stage 1: Less aggressive mode - preserving more content...');
            
            // Find and extract only the main profile content
            const mainContentPatterns = [
                /<main[^>]*>([\s\S]*?)<\/main>/i,
                /<div[^>]*class="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                /<section[^>]*class="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
                /<div[^>]*id="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/div>/i
            ];
            
            for (let pattern of mainContentPatterns) {
                const match = processedHtml.match(pattern);
                if (match && match[1].length > 1000) {
                    processedHtml = match[1];
                    console.log(`✅ Found main content: ${(processedHtml.length / 1024).toFixed(2)} KB`);
                    break;
                }
            }
            
            // Remove scripts and styles but preserve more structure
            processedHtml = processedHtml
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/<img[^>]*>/gi, '')
                .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
                .replace(/\s+style="[^"]*"/gi, '')
                .replace(/\s+on\w+="[^"]*"/gi, '')
                .replace(/\s{3,}/g, ' ')
                .replace(/>\s+</g, '><')
                .trim();
        }
        
        const finalSize = processedHtml.length;
        const finalTokens = Math.ceil(finalSize / 3);
        const reduction = ((originalSize - finalSize) / originalSize * 100).toFixed(1);
        
        console.log(`✅ ${optimizationMode} HTML preprocessing completed:`);
        console.log(`   Original: ${(originalSize / 1024).toFixed(2)} KB`);
        console.log(`   Final: ${(finalSize / 1024).toFixed(2)} KB`);
        console.log(`   Reduction: ${reduction}%`);
        console.log(`   Estimated tokens: ~${finalTokens} (Max: ${OPENAI_LIMITS.MAX_TOKENS_INPUT})`);
        
        return processedHtml;
        
    } catch (error) {
        console.error('❌ HTML preprocessing failed:', error);
        console.log('🔥 Fallback: Basic processing...');
        
        try {
            const fallback = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            console.log(`🆘 Fallback result: ${(fallback.length / 1024).toFixed(2)} KB`);
            return fallback;
        } catch (fallbackError) {
            console.error('💥 Even fallback failed:', fallbackError);
            return html;
        }
    }
}

// ✅ Improved token count estimation
function estimateTokenCount(text) {
    const hasHtmlTags = /<[^>]*>/.test(text);
    const charsPerToken = hasHtmlTags ? 3 : 4;
    return Math.ceil(text.length / charsPerToken);
}

// ⚡ GPT-4o-mini Function (PRIMARY MODEL - Fast & Efficient)
async function callGPT5Mini({ systemPrompt, userPrompt, preprocessedHtml }) {
    const apiKey = process.env.OPENAI_API_KEY;
    const startTime = Date.now();
    
    console.log('⚡ Sending request to GPT-4o-mini (PRIMARY)...');
    
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt || '' },
                    { role: 'user', content: userPrompt || '' },
                    { role: 'user', content: preprocessedHtml || '' }
                ],
                response_format: { type: 'json_object' },
                max_tokens: 16000,
                temperature: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 90000, // 90 seconds for mini
                httpAgent: keepAliveAgent,
                httpsAgent: keepAliveAgent
            }
        );
        
        const processingTime = Date.now() - startTime;
        console.log(`⚡ GPT-4o-mini response received in ${processingTime}ms`);
        console.log(`📊 Response status: ${response.status}`);
        
        // Extract response
        const rawResponse = response.data.choices[0].message.content.trim();
        
        // Extract token usage
        const tokenUsage = {
            inputTokens: response.data.usage?.prompt_tokens || null,
            outputTokens: response.data.usage?.completion_tokens || null,
            totalTokens: response.data.usage?.total_tokens || null
        };
        
        console.log(`📊 Mini Token Usage: Input=${tokenUsage.inputTokens}, Output=${tokenUsage.outputTokens}, Total=${tokenUsage.totalTokens}`);
        
        return {
            rawResponse,
            tokenUsage,
            processingTime,
            model: 'gpt-4o-mini',
            fallbackUsed: true,
            apiRequestId: response.headers['x-request-id'] || null,
            responseStatus: 'success'
        };
        
    } catch (error) {
        console.error('❌ GPT-5-mini fallback failed:', error.message);
        throw error;
    }
}

// ⚡ GPT-4o-mini with Timeout Wrapper (PRIMARY)
async function callGPT5MiniWithTimeout({ systemPrompt, userPrompt, preprocessedHtml }, timeoutMs) {
    return new Promise(async (resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            reject(new Error(`GPT-4o-mini timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        
        try {
            const result = await callGPT5Mini({ systemPrompt, userPrompt, preprocessedHtml });
            clearTimeout(timeoutHandle);
            resolve(result);
        } catch (error) {
            clearTimeout(timeoutHandle);
            reject(error);
        }
    });
}

// ⚡ GPT-5-nano with Timeout Wrapper (FALLBACK)
async function callGPT5NanoWithTimeout({ systemPrompt, userPrompt, preprocessedHtml }, timeoutMs) {
    return new Promise(async (resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            reject(new Error(`GPT-5-nano timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        
        try {
            const result = await sendToNano({ systemPrompt, userPrompt, preprocessedHtml });
            clearTimeout(timeoutHandle);
            resolve(result);
        } catch (error) {
            clearTimeout(timeoutHandle);
            reject(error);
        }
    });
}

// ✅ OpenAI GPT-5-nano Responses API Call
async function sendToNano({ systemPrompt, userPrompt, preprocessedHtml }) {
    const apiKey = process.env.OPENAI_API_KEY;
    const startTime = Date.now();
    
    console.log('📤 Sending request to OpenAI GPT-5-nano Responses API...');
    
    const response = await callOpenAIWithResilience(
        'https://api.openai.com/v1/responses',
        {
            model: 'gpt-5-nano',
            text: {
                format: { type: 'json_object' }
            },
            max_output_tokens: OPENAI_LIMITS.MAX_TOKENS_OUTPUT,
            input: [
                { role: 'system', content: systemPrompt || '' },
                { role: 'user', content: userPrompt || '' },
                { role: 'user', content: preprocessedHtml || '' }
            ]
        },
        {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'responses=v1'
        }
    );
    
    const processingTime = Date.now() - startTime;
    
    console.log('🔥 OpenAI API response received');
    console.log(`📊 Response status: ${response.status}`);
    
    // Extract the text response from the Responses API format
    const outputArray = response.data?.output || [];
    let cleanedResponse = '';
    
    for (let item of outputArray) {
        if (item.type === 'text' && item.content) {
            cleanedResponse += item.content;
        }
    }
    
    if (!cleanedResponse) {
        throw new Error('No text output in response');
    }
    
    // Clean up markdown code blocks if present
    cleanedResponse = cleanedResponse
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    
    console.log(`🔍 Extracted response length: ${cleanedResponse.length} characters`);
    
    // Extract token usage from Responses API format
    const tokenUsage = {
        inputTokens: response.data.usage?.input_tokens || null,
        outputTokens: response.data.usage?.output_tokens || null,
        totalTokens: (response.data.usage?.input_tokens || 0) + (response.data.usage?.output_tokens || 0)
    };
    
    console.log(`📊 Nano Token Usage: Input=${tokenUsage.inputTokens}, Output=${tokenUsage.outputTokens}, Total=${tokenUsage.totalTokens}`);
    
    return {
        rawResponse: cleanedResponse,
        tokenUsage,
        processingTime,
        model: 'gpt-5-nano',
        fallbackUsed: false,
        apiRequestId: response.headers['x-request-id'] || null,
        responseStatus: 'success'
    };
}

// ✅ Extract token usage helper
function extractTokenUsage(response) {
    return {
        inputTokens: response.data.usage?.input_tokens || response.data.usage?.prompt_tokens || null,
        outputTokens: response.data.usage?.output_tokens || response.data.usage?.completion_tokens || null,
        totalTokens: response.data.usage?.total_tokens || 
                     ((response.data.usage?.input_tokens || 0) + (response.data.usage?.output_tokens || 0)) ||
                     ((response.data.usage?.prompt_tokens || 0) + (response.data.usage?.completion_tokens || 0)) ||
                     null
    };
}

// 🚀 MAIN FUNCTION: sendToGemini with Parallel Racing Fallback
async function sendToGemini({ 
    html, 
    systemPrompt, 
    userPrompt, 
    inputType = 'user-profile',
    optimizationMode = 'less_aggressive'
}) {
    try {
        const overallStartTime = Date.now();
        
        console.log('🔥 === STARTING OPENAI GPT-4O-MINI PROCESSING WITH GPT-5-NANO FALLBACK ===');
        console.log(`📊 Input type: ${inputType}`);
        console.log(`📊 Optimization mode: ${optimizationMode}`);
        console.log(`📊 HTML size: ${(html.length / 1024).toFixed(2)} KB`);
        
        // Preprocess HTML
        const preprocessedHtml = preprocessHTMLForGemini(html, optimizationMode);
        
        if (preprocessedHtml.length > OPENAI_LIMITS.MAX_SIZE_KB * 1024) {
            console.error(`❌ HTML too large: ${(preprocessedHtml.length / 1024).toFixed(2)} KB > ${OPENAI_LIMITS.MAX_SIZE_KB} KB`);
            return {
                success: false,
                status: 400,
                userMessage: 'Profile HTML is too large to process. Please try a different profile.',
                transient: false
            };
        }
        
        // Set default prompts if not provided
        if (!systemPrompt || !userPrompt) {
            systemPrompt = 'You are a LinkedIn profile data extraction expert. Extract structured profile information from HTML.';
            userPrompt = `Extract all available profile information from this LinkedIn HTML and return it as a structured JSON object with these fields:
{
  "profile": {"name": "", "headline": "", "location": "", "about": "", "profileUrl": ""},
  "experience": [{"title": "", "company": "", "duration": "", "description": ""}],
  "education": [{"school": "", "degree": "", "field": "", "dates": ""}],
  "skills": [],
  "certifications": [{"name": "", "issuer": "", "date": ""}],
  "awards": [{"title": "", "issuer": "", "date": "", "description": ""}],
  "volunteer": [{"role": "", "organization": "", "duration": "", "description": ""}],
  "followingCompanies": [],
  "activity": [{"type": "", "content": "", "engagement": "", "date": ""}]
}`;
        }
        
        console.log(`🎯 Processing ${inputType} with ${optimizationMode} optimization...`);
        console.log(`🔍 Total prompt length: ${(systemPrompt + userPrompt).length} characters`);
        
        // Enforce rate limiting
        await enforceRateLimit();
        
        // ============================================
        // ATTEMPT 1: GPT-4o-mini Primary
        // ============================================
        console.log('📤 ATTEMPT 1: GPT-4o-mini (primary - faster, cheaper)...');
        
        try {
            const miniResult = await callGPT5MiniWithTimeout(
                { systemPrompt, userPrompt, preprocessedHtml },
                FALLBACK_CONFIG.ATTEMPT_1_TIMEOUT
            );
            
            const totalTime = Date.now() - overallStartTime;
            console.log(`✅ Attempt 1 SUCCESS: Mini completed in ${totalTime}ms`);
            
            // Parse and validate the response
            const { parsedData, isValid } = await parseAndValidateResponse(miniResult);
            
            if (!isValid) {
                throw new Error('Response validation failed');
            }
            
            return {
                success: true,
                data: parsedData,
                metadata: {
                    inputType: inputType,
                    processingTime: miniResult.processingTime,
                    totalTime: totalTime,
                    model: miniResult.model,
                    attempt: 1,
                    fallbackUsed: false,
                    hasProfile: parsedData.profile && parsedData.profile.name,
                    hasExperience: parsedData.experience && parsedData.experience.length > 0,
                    hasEducation: parsedData.education && parsedData.education.length > 0,
                    dataQuality: (parsedData.profile?.name && parsedData.experience?.length > 0) ? 'high' : 'medium',
                    optimizationMode: optimizationMode,
                    tokenUsage: miniResult.tokenUsage
                },
                tokenData: {
                    rawGptResponse: miniResult.rawResponse,
                    inputTokens: miniResult.tokenUsage.inputTokens,
                    outputTokens: miniResult.tokenUsage.outputTokens,
                    totalTokens: miniResult.tokenUsage.totalTokens,
                    processingTimeMs: miniResult.processingTime,
                    apiRequestId: miniResult.apiRequestId,
                    responseStatus: miniResult.responseStatus
                }
            };
            
        } catch (attempt1Error) {
            const attempt1Time = Date.now() - overallStartTime;
            console.log(`❌ Attempt 1 FAILED after ${attempt1Time}ms: ${attempt1Error.message}`);
            
            if (!FALLBACK_CONFIG.ENABLE_PARALLEL_RETRY) {
                throw attempt1Error;
            }
            
            // ============================================
            // ATTEMPT 2: Parallel Race (Mini Retry + Nano Fallback)
            // ============================================
            console.log('⚡ ATTEMPT 2: Parallel race (Mini retry + Nano fallback)...');
            console.log('🏁 Racing both models - first to finish wins!');
            
            const retryStartTime = Date.now();
            
            // Launch BOTH models at the same time
            const miniRetryPromise = callGPT5Mini({ systemPrompt, userPrompt, preprocessedHtml })
                .then(result => ({
                    ...result,
                    model: 'gpt-4o-mini',
                    attempt: 2,
                    retryTime: Date.now() - retryStartTime
                }))
                .catch(err => {
                    console.log(`❌ Mini retry failed: ${err.message}`);
                    return Promise.reject(err);
                });
            
            const nanoPromise = sendToNano({ systemPrompt, userPrompt, preprocessedHtml })
                .then(result => ({
                    ...result,
                    model: 'gpt-5-nano',
                    attempt: 2,
                    retryTime: Date.now() - retryStartTime
                }))
                .catch(err => {
                    console.log(`❌ Nano fallback failed: ${err.message}`);
                    return Promise.reject(err);
                });
            
            // Race them - first to finish wins
            const winner = await Promise.race([miniRetryPromise, nanoPromise]);
            
            const totalTime = Date.now() - overallStartTime;
            
            console.log(`🏁 WINNER: ${winner.model}`);
            console.log(`   Retry time: ${winner.retryTime}ms`);
            console.log(`   Total time: ${totalTime}ms`);
            
            // Parse and validate the winner's response
            const { parsedData, isValid } = await parseAndValidateResponse(winner);
            
            if (!isValid) {
                throw new Error('Winner response validation failed');
            }
            
            return {
                success: true,
                data: parsedData,
                metadata: {
                    inputType: inputType,
                    processingTime: winner.processingTime,
                    totalTime: totalTime,
                    retryTime: winner.retryTime,
                    model: winner.model,
                    attempt: 2,
                    fallbackUsed: true,
                    parallelRace: true,
                    hasProfile: parsedData.profile && parsedData.profile.name,
                    hasExperience: parsedData.experience && parsedData.experience.length > 0,
                    hasEducation: parsedData.education && parsedData.education.length > 0,
                    dataQuality: (parsedData.profile?.name && parsedData.experience?.length > 0) ? 'high' : 'medium',
                    optimizationMode: optimizationMode,
                    tokenUsage: winner.tokenUsage
                },
                tokenData: {
                    rawGptResponse: winner.rawResponse,
                    inputTokens: winner.tokenUsage.inputTokens,
                    outputTokens: winner.tokenUsage.outputTokens,
                    totalTokens: winner.tokenUsage.totalTokens,
                    processingTimeMs: winner.processingTime,
                    apiRequestId: winner.apiRequestId,
                    responseStatus: winner.responseStatus
                }
            };
        }
        
    } catch (error) {
        console.error('❌ === BOTH ATTEMPTS FAILED ===');
        console.error('📊 Error details:');
        console.error(`   - Message: ${error.message}`);
        console.error(`   - Status: ${error.response?.status || 'N/A'}`);
        console.error(`   - Request ID: ${error.response?.headers?.['x-request-id'] || 'N/A'}`);
        console.error(`   - Type: ${error.name || 'Unknown'}`);
        
        if (error.response?.data) {
            console.error('API error body:', JSON.stringify(error.response.data));
        }
        
        // Handle specific API error types
        let userFriendlyMessage = 'Failed to process profile data';
        let isTransient = false;
        let status = error.response?.status || 500;
        
        if (error.response?.status === 429) {
            userFriendlyMessage = 'Rate limit exceeded. Please wait a moment and try again.';
            isTransient = true;
        } else if (error.response?.status === 503) {
            userFriendlyMessage = 'API is busy. Please try again in a moment.';
            isTransient = true;
        } else if (error.response?.status === 504) {
            userFriendlyMessage = 'Request timeout. Please try again.';
            isTransient = true;
        } else if (error.message.includes('timeout')) {
            userFriendlyMessage = 'Processing timeout. Both AI models timed out - profile may be too large.';
            isTransient = true;
            status = 503;
        } else if (error.response?.status === 400) {
            userFriendlyMessage = 'Invalid request format. Please try again.';
            isTransient = false;
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            userFriendlyMessage = 'API authentication failed. Please check server configuration.';
            isTransient = false;
        }
        
        return {
            success: false,
            error: error.message,
            userMessage: userFriendlyMessage,
            status: status,
            transient: isTransient,
            details: {
                type: error.name,
                timestamp: new Date().toISOString(),
                optimizationMode: optimizationMode,
                requestId: error.response?.headers?.['x-request-id'] || null
            },
            usage: null,
            tokenData: {
                rawGptResponse: null,
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                processingTimeMs: null,
                apiRequestId: error.response?.headers?.['x-request-id'] || null,
                responseStatus: 'error'
            }
        };
    }
}

// ✅ Helper: Parse and Validate Response
async function parseAndValidateResponse(apiResult) {
    if (!apiResult.rawResponse) {
        return { parsedData: null, isValid: false };
    }
    
    console.log(`🔍 Raw response length: ${apiResult.rawResponse.length} characters`);
    
    // Try to parse JSON
    let parsedData;
    try {
        parsedData = JSON.parse(apiResult.rawResponse);
        console.log('✅ JSON parsing successful');
    } catch (parseError) {
        console.error('❌ JSON parsing failed:', parseError.message);
        console.log('🔍 Raw response causing error:', apiResult.rawResponse.substring(0, 1000) + '...');
        
        // Try to fix common JSON issues
        let fixedResponse = apiResult.rawResponse;
        
        // Fix truncated JSON by adding missing closing braces
        const openBraces = (fixedResponse.match(/\{/g) || []).length;
        const closeBraces = (fixedResponse.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
            const missingBraces = openBraces - closeBraces;
            fixedResponse += '}'.repeat(missingBraces);
            console.log(`🔧 Added ${missingBraces} missing closing braces`);
        }
        
        // Try parsing the fixed version
        try {
            parsedData = JSON.parse(fixedResponse);
            console.log('✅ JSON parsing successful after fixing');
        } catch (secondParseError) {
            console.error('❌ JSON parsing failed even after fixes:', secondParseError.message);
            return { parsedData: null, isValid: false };
        }
    }
    
    // Validate data
    const hasProfile = parsedData.profile && parsedData.profile.name;
    const hasExperience = parsedData.experience && Array.isArray(parsedData.experience) && parsedData.experience.length > 0;
    const hasEducation = parsedData.education && Array.isArray(parsedData.education) && parsedData.education.length > 0;
    
    console.log('✅ === PROCESSING COMPLETED ===');
    console.log(`📊 Extraction Results:`);
    console.log(`   🥇 Profile name: ${hasProfile ? 'YES' : 'NO'}`);
    console.log(`   🥇 Experience entries: ${parsedData.experience?.length || 0}`);
    console.log(`   🥇 Education entries: ${parsedData.education?.length || 0}`);
    console.log(`   🥇 Awards: ${parsedData.awards?.length || 0}`);
    console.log(`   🥇 Certifications: ${parsedData.certifications?.length || 0}`);
    console.log(`   🥈 Volunteer experiences: ${parsedData.volunteer?.length || 0}`);
    console.log(`   🥈 Following companies: ${parsedData.followingCompanies?.length || 0}`);
    console.log(`   🥈 Activity posts: ${parsedData.activity?.length || 0}`);
    console.log(`📊 Token Usage:`);
    console.log(`   - Input tokens: ${apiResult.tokenUsage.inputTokens || 'N/A'}`);
    console.log(`   - Output tokens: ${apiResult.tokenUsage.outputTokens || 'N/A'}`);
    console.log(`   - Total tokens: ${apiResult.tokenUsage.totalTokens || 'N/A'}`);
    console.log(`   - Processing time: ${apiResult.processingTime}ms`);
    console.log(`   - Model used: ${apiResult.model}`);
    
    return { parsedData, isValid: true };
}

module.exports = { sendToGemini };
