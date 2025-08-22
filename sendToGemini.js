// Enhanced sendToGemini.js - OpenAI GPT-5-nano + GPT-5-mini DUAL MODEL SUPPORT
// FIXED JSON Parsing + Token Tracking + Parallel Racing Strategy
// ✅ NEW: GPT-5 mini fallback with parallel execution for enhanced reliability

const axios = require('axios');
const https = require('https');

// ✅ Rate limiting configuration (OpenAI GPT-5-nano + mini)
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

// ✅ ENHANCED: Extract token usage from OpenAI response
function extractTokenUsage(response) {
    try {
        const data = response.data;
        const usage = data.usage || {};
        
        return {
            inputTokens: usage.input_tokens || usage.prompt_tokens || null,
            outputTokens: usage.output_tokens || usage.completion_tokens || null,
            totalTokens: usage.total_tokens || 
                         ((usage.input_tokens || 0) + (usage.output_tokens || 0)) || 
                         ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) || null,
            apiRequestId: response.headers?.['x-request-id'] || null
        };
    } catch (error) {
        console.error('❌ Error extracting token usage:', error);
        return {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            apiRequestId: null
        };
    }
}

// ✅ FIXED: Send to OpenAI GPT-5-nano with ROBUST JSON parsing for TARGET profiles
async function sendToNano({ systemPrompt, userPrompt, preprocessedHtml }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const startTime = Date.now();
  
  console.log('📤 Sending request to OpenAI GPT-5-nano Responses API...');
  
  // EXACT original request structure from your working code
  const response = await callOpenAIWithResilience(
    'https://api.openai.com/v1/responses',
    {
      model: 'gpt-5-nano',
      text: { format: { type: 'json_object' } },
      max_output_tokens: 18000,
      input: [
        { role: 'system', content: systemPrompt ?? '' },
        { role: 'user', content: userPrompt ?? '' },
        { role: 'user', content: preprocessedHtml ?? '' }
      ]
    },
    {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'responses-2024-12-17'
    }
  );
  
  const processingTime = Date.now() - startTime;
  console.log('🔥 OpenAI GPT-5-nano API response received');
  console.log(`📊 Response status: ${response.status}`);
  console.log(`⏱️ Processing time: ${processingTime}ms`);
  
  // ✅ Extract token usage
  const tokenUsage = extractTokenUsage(response);
  
  // ✅ CRITICAL FIX: ROBUST response extraction with multiple fallback methods
  const data = response.data;
  let rawResponse = '';
  
  try {
    // Method 1: Standard extraction (works for most cases)
    if (data.output_text) {
      rawResponse = data.output_text;
      console.log('✅ Extracted using method 1: output_text');
    }
    // Method 2: Array-based output extraction
    else if (Array.isArray(data.output) && data.output.length > 0) {
      rawResponse = data.output
        .map(p => {
          if (Array.isArray(p.content)) {
            return p.content.map(c => c.text || '').join('');
          }
          return p.text || p.content || '';
        })
        .join('');
      console.log('✅ Extracted using method 2: output array');
    }
    // Method 3: Direct content extraction for alternative API formats
    else if (data.output && typeof data.output === 'object') {
      const output = data.output;
      rawResponse = output.text || 
                   output.content || 
                   (output.message && output.message.content) || 
                   JSON.stringify(output);
      console.log('✅ Extracted using method 3: direct object');
    }
    // Method 4: Choices-based extraction (ChatGPT format)
    else if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      rawResponse = data.choices
        .map(choice => choice.message?.content || choice.text || '')
        .join('');
      console.log('✅ Extracted using method 4: choices array');
    }
    // Method 5: Response field (alternative format)
    else if (data.response) {
      rawResponse = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);
      console.log('✅ Extracted using method 5: response field');
    }
    // Method 6: Last resort - stringify entire data
    else {
      console.log('⚠️ Using fallback method 6: full data stringify');
      rawResponse = JSON.stringify(data);
    }
    
  } catch (extractionError) {
    console.error('❌ Response extraction failed:', extractionError);
    console.log('🆘 Emergency fallback to raw data stringify');
    rawResponse = JSON.stringify(data);
  }
  
  console.log(`🔍 Extracted response length: ${rawResponse?.length || 0} characters`);
  
  // ✅ CRITICAL FIX: Robust JSON validation and cleanup
  if (!rawResponse || rawResponse.length < 10) {
    throw new Error('Empty or invalid response from OpenAI API');
  }
  
  // Clean up response before parsing
  let cleanedResponse = rawResponse.trim();
  
  // Remove common non-JSON prefixes/suffixes
  if (cleanedResponse.startsWith('```json')) {
    cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  }
  if (cleanedResponse.startsWith('```')) {
    cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  
  // Find JSON object boundaries
  const firstBrace = cleanedResponse.indexOf('{');
  const lastBrace = cleanedResponse.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
  }
  
  console.log(`🧹 Cleaned response length: ${cleanedResponse.length} characters`);
  console.log(`🔍 Response preview: ${cleanedResponse.substring(0, 200)}...`);
  
  return {
    rawResponse: cleanedResponse,
    tokenUsage,
    processingTime,
    apiRequestId: tokenUsage.apiRequestId,
    responseStatus: 'success'
  };
}

// ✅ NEW: Send to OpenAI GPT-5-mini with same structure as sendToNano
async function sendToMini({ systemPrompt, userPrompt, preprocessedHtml }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const startTime = Date.now();
  
  console.log('📤 Sending request to OpenAI GPT-5-mini Chat API...');
  
  // GPT-5 mini uses standard chat completions endpoint
  const response = await callOpenAIWithResilience(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: systemPrompt ?? '' },
        { role: 'user', content: userPrompt ?? '' },
        { role: 'user', content: preprocessedHtml ?? '' }
      ],
      max_tokens: 18000,
      response_format: { type: 'json_object' }
    },
    {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  );
  
  const processingTime = Date.now() - startTime;
  console.log('🔥 OpenAI GPT-5-mini API response received');
  console.log(`📊 Response status: ${response.status}`);
  console.log(`⏱️ Processing time: ${processingTime}ms`);
  
  // Extract token usage
  const tokenUsage = extractTokenUsage(response);
  
  // Extract response content (standard chat format)
  let rawResponse = '';
  try {
    if (response.data.choices && response.data.choices[0]?.message?.content) {
      rawResponse = response.data.choices[0].message.content;
      console.log('✅ Extracted using GPT-5-mini chat format');
    } else {
      throw new Error('Invalid response structure from GPT-5-mini');
    }
  } catch (extractionError) {
    console.error('❌ GPT-5-mini response extraction failed:', extractionError);
    throw new Error('Failed to extract response from GPT-5-mini');
  }
  
  console.log(`🔍 Mini extracted response length: ${rawResponse?.length || 0} characters`);
  
  // Clean up response before parsing (same logic as nano)
  let cleanedResponse = rawResponse.trim();
  
  // Remove common non-JSON prefixes/suffixes
  if (cleanedResponse.startsWith('```json')) {
    cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  }
  if (cleanedResponse.startsWith('```')) {
    cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  
  // Find JSON object boundaries
  const firstBrace = cleanedResponse.indexOf('{');
  const lastBrace = cleanedResponse.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
  }
  
  console.log(`🧹 Mini cleaned response length: ${cleanedResponse.length} characters`);
  console.log(`🔍 Mini response preview: ${cleanedResponse.substring(0, 200)}...`);
  
  return {
    rawResponse: cleanedResponse,
    tokenUsage,
    processingTime,
    apiRequestId: tokenUsage.apiRequestId,
    responseStatus: 'success'
  };
}

// ✅ MODIFIED: Send to OpenAI with DUAL MODEL SUPPORT and parallel racing strategy
async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            return { success: false, status: 500, userMessage: 'OPENAI_API_KEY not configured', transient: false };
        }
        
        console.log('🤖 === OPENAI DUAL MODEL SYSTEM (NANO + MINI) WITH ENHANCED TOKEN TRACKING ===');
        
        // Determine input type and prepare data
        let processedData;
        let inputType;
        let systemPrompt;
        let userPrompt;
        let preprocessedHtml;
        
        // Extract optimization mode from input - force same aggressive reduction for target profiles
        let optimizationMode;
        if (inputData.isUserProfile) {
            // User profiles: respect their optimization preference
            optimizationMode = inputData.optimization?.mode || 'less_aggressive';
        } else {
            // Target profiles: force same aggressive reduction as user profiles (95% reduction)
            optimizationMode = 'less_aggressive';
        }
        console.log(`📊 Optimization mode: ${optimizationMode} (${inputData.isUserProfile ? 'USER' : 'TARGET'} profile)`);
        
        if (inputData.html) {
            inputType = 'HTML from Chrome Extension';
            console.log(`📄 Input type: ${inputType}`);
            console.log(`🔍 Original HTML size: ${(inputData.html.length / 1024).toFixed(2)} KB`);
            
            const htmlSizeKB = inputData.html.length / 1024;
            if (htmlSizeKB > OPENAI_LIMITS.MAX_SIZE_KB) {
                return { 
                    success: false, 
                    status: 413, 
                    userMessage: `HTML too large: ${htmlSizeKB.toFixed(2)} KB (max: ${OPENAI_LIMITS.MAX_SIZE_KB} KB)`,
                    transient: false 
                };
            }
            
            // Preprocess HTML with optimization mode
            preprocessedHtml = preprocessHTMLForGemini(inputData.html, optimizationMode);
            
            const estimatedTokens = estimateTokenCount(preprocessedHtml);
            console.log(`🔢 Estimated tokens: ${estimatedTokens} (Max input: ${OPENAI_LIMITS.MAX_TOKENS_INPUT})`);
            
            if (estimatedTokens > OPENAI_LIMITS.MAX_TOKENS_INPUT) {
                return { 
                    success: false, 
                    status: 413, 
                    userMessage: `Content too large: ~${estimatedTokens} tokens (max: ${OPENAI_LIMITS.MAX_TOKENS_INPUT})`,
                    transient: false 
                };
            }
            
            processedData = {
                html: preprocessedHtml,
                url: inputData.url || inputData.profileUrl,
                isUserProfile: inputData.isUserProfile || false,
                optimization: inputData.optimization || {}
            };
            
            // System prompt for comprehensive data extraction
            systemPrompt = `You are a LinkedIn profile data extraction expert. Your task is to analyze HTML content and extract comprehensive LinkedIn profile information into valid JSON format.

CRITICAL EXTRACTION PRIORITY:
🥇 TIER 1 (HIGHEST PRIORITY - Extract first):
- Basic profile info: name, headline, currentRole, currentCompany, location, about
- Experience/work history: ALL job entries with titles, companies, durations, descriptions
- Education: ALL education entries with schools, degrees, fields, years, grades, activities  
- Awards: ALL awards/honors/recognitions found
- Certifications: ALL certifications/licenses found

🥈 TIER 2 (SECONDARY PRIORITY - Extract after TIER 1):
- Volunteer work: organizations, roles
- Following data: companies followed, people followed
- Activity content: recent posts and content
- Social metrics: followers, connections, mutual connections

CRITICAL REQUIREMENTS:
1. PRIORITIZE TIER 1 DATA - Extract completely before moving to TIER 2
2. Extract ALL available content from every section thoroughly
3. Return ONLY valid JSON - no markdown, no explanations, no comments
4. Use the exact JSON structure provided below
5. Extract all available text content, ignore styling and layout elements
6. If a section is empty, use empty array [] or empty string ""
7. For arrays, extract EVERY item found - don't truncate due to length
8. With optimization mode ${optimizationMode}, extract maximum data from all sections`;

            userPrompt = `Extract comprehensive LinkedIn profile data from this HTML. Optimization mode: ${optimizationMode}

Return as JSON with this EXACT structure:

{
  "profile": {
    "name": "Full Name",
    "firstName": "First Name", 
    "lastName": "Last Name",
    "headline": "Professional Headline",
    "currentRole": "Current Job Title", 
    "currentCompany": "Current Company Name",
    "location": "City, Country",
    "about": "About section text",
    "followersCount": "Number of followers",
    "connectionsCount": "Number of connections",
    "mutualConnections": "Number of mutual connections"
  },
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name", 
      "companyUrl": "Company LinkedIn URL if available",
      "duration": "Start Date - End Date",
      "startDate": "Start Date",
      "endDate": "End Date or Present",
      "location": "Job location",
      "description": "Job description and achievements - full content"
    }
  ],
  "education": [
    {
      "school": "University/School Name",
      "degree": "Degree Type",
      "field": "Field of Study", 
      "startYear": "Start Year",
      "endYear": "End Year",
      "duration": "Start Year - End Year",
      "grade": "GPA or Grade if available",
      "activities": "Activities & societies if available",
      "description": "Additional details if available"
    }
  ],
  "awards": [
    {
      "title": "Award Title",
      "issuer": "Issuing Organization",
      "date": "Award Date",
      "description": "Award description if available"
    }
  ],
  "certifications": [
    {
      "name": "Certification Name",
      "issuer": "Issuing Organization",
      "date": "Issue Date",
      "url": "Certificate URL if available",
      "description": "Certificate description if available"
    }
  ],
  "volunteer": [
    {
      "organization": "Organization Name",
      "role": "Volunteer Role",
      "cause": "Cause area if available",
      "startDate": "Start Date if available",
      "endDate": "End Date if available", 
      "description": "Description of volunteer work"
    }
  ],
  "followingCompanies": [
    "Company Name 1",
    "Company Name 2"
  ],
  "followingPeople": [
    "Person Name 1", 
    "Person Name 2"
  ],
  "activity": [
    {
      "type": "post|article|share|video",
      "content": "Activity content preview",
      "date": "Activity date",
      "likes": "Number of likes",
      "comments": "Number of comments",
      "shares": "Number of shares"
    }
  ],
  "skills": ["Skill 1", "Skill 2", "Skill 3"],
  "engagement": {
    "totalLikes": "Sum of all likes across posts",
    "totalComments": "Sum of all comments across posts", 
    "totalShares": "Sum of all shares across posts",
    "averageLikes": "Average likes per post"
  }
}

The full HTML is provided separately as input_text in this same request.
Return ONLY valid JSON. No explanations/markdown.`;
            
        } else if (inputData.data || inputData.results) {
            inputType = 'JSON Data';
            console.log(`📊 Input type: ${inputType}`);
            
            const jsonData = inputData.data || inputData.results || inputData;
            processedData = jsonData;
            
            systemPrompt = `You are a LinkedIn profile data extraction expert. Extract and structure comprehensive profile information from the provided JSON data with TIER 1/2 prioritization.

CRITICAL REQUIREMENTS:
1. TIER 1 data is HIGHEST PRIORITY (profile, experience, education, awards, certifications)
2. TIER 2 data is SECONDARY (volunteer, following, activity, social metrics)  
3. Return ONLY valid JSON - no markdown, no explanations
4. Use the exact structure provided
5. Extract ALL available data thoroughly from every section`;

            userPrompt = `Extract comprehensive LinkedIn profile data from this JSON with optimization mode ${optimizationMode} and return as structured JSON with the same format as specified above:

${JSON.stringify(jsonData, null, 2)}`;
            
        } else {
            return { 
                success: false, 
                status: 400, 
                userMessage: 'Invalid input data: must contain either "html" or "data" property',
                transient: false 
            };
        }
        
        console.log(`🎯 Processing ${inputType} with ${optimizationMode} optimization...`);
        console.log(`🔍 Total prompt length: ${(systemPrompt + userPrompt).length} characters`);
        
        // Enforce rate limiting
        await enforceRateLimit();
        
        // ✅ NEW: DUAL MODEL STRATEGY with parallel racing
        let nanoResult = null;
        let miniResult = null;
        
        const processingStartTime = Date.now();
        
        // For USER profiles, use nano only (no change in behavior)
        if (inputData.isUserProfile) {
            console.log('[BLUE] USER PROFILE: Using GPT-5 nano only (standard behavior)');
            
            const apiResult = await sendToNano({
                systemPrompt,
                userPrompt,
                preprocessedHtml
            });
            
            if (!apiResult.rawResponse) {
                return { 
                    success: false, 
                    status: 500, 
                    userMessage: 'Invalid response structure from GPT-5 nano',
                    transient: true 
                };
            }
            
            nanoResult = apiResult;
        } 
        // For TARGET profiles, use dual model strategy
        else {
            console.log('[TARGET] TARGET PROFILE: Using DUAL MODEL strategy (nano + mini)');
            
            try {
                // Attempt 1: Try nano only first
                console.log('[NANO] Attempt 1: Trying GPT-5 nano only...');
                const nanoAttempt = await sendToNano({
                    systemPrompt,
                    userPrompt,
                    preprocessedHtml
                });
                
                if (nanoAttempt.rawResponse && nanoAttempt.rawResponse.length > 10) {
                    console.log('[NANO] GPT-5 nano succeeded on first attempt');
                    nanoResult = nanoAttempt;
                } else {
                    throw new Error('Nano returned empty response');
                }
                
            } catch (nanoFirstError) {
                console.log('[NANO] Attempt 1 failed, proceeding to parallel racing...');
                console.log('[PARALLEL] Starting GPT-5 nano + mini parallel execution...');
                
                // Attempt 2+: Parallel racing nano + mini
                const [nanoAttemptResult, miniAttemptResult] = await Promise.allSettled([
                    sendToNano({
                        systemPrompt,
                        userPrompt,
                        preprocessedHtml
                    }),
                    sendToMini({
                        systemPrompt,
                        userPrompt,
                        preprocessedHtml
                    })
                ]);
                
                // Process parallel results
                if (nanoAttemptResult.status === 'fulfilled' && 
                    nanoAttemptResult.value.rawResponse && 
                    nanoAttemptResult.value.rawResponse.length > 10) {
                    nanoResult = nanoAttemptResult.value;
                    console.log('[NANO] GPT-5 nano succeeded in parallel execution');
                }
                
                if (miniAttemptResult.status === 'fulfilled' && 
                    miniAttemptResult.value.rawResponse && 
                    miniAttemptResult.value.rawResponse.length > 10) {
                    miniResult = miniAttemptResult.value;
                    console.log('[MINI] GPT-5 mini succeeded in parallel execution');
                }
                
                // Ensure at least one model succeeded
                if (!nanoResult && !miniResult) {
                    throw new Error('Both models failed in parallel execution');
                }
            }
        }
        
        // Ensure we have at least one result
        if (!nanoResult && !miniResult) {
            return { 
                success: false, 
                status: 500, 
                userMessage: 'All available models failed to process the profile',
                transient: true 
            };
        }
        
        // Parse results from both models (if available)
        let nanoData = null;
        let miniData = null;
        
        if (nanoResult) {
            try {
                nanoData = JSON.parse(nanoResult.rawResponse);
                console.log('✅ Nano JSON parsing successful');
            } catch (nanoParseError) {
                console.error('❌ Nano JSON parsing failed:', nanoParseError.message);
                // If nano was our only result and parsing failed, try to fix it
                if (!miniResult) {
                    let fixedResponse = nanoResult.rawResponse;
                    const openBraces = (fixedResponse.match(/\{/g) || []).length;
                    const closeBraces = (fixedResponse.match(/\}/g) || []).length;
                    if (openBraces > closeBraces) {
                        const missingBraces = openBraces - closeBraces;
                        fixedResponse += '}}'.repeat(missingBraces);
                        try {
                            nanoData = JSON.parse(fixedResponse);
                            console.log('✅ Nano JSON parsing successful after fixing');
                        } catch (secondParseError) {
                            console.error('❌ Nano JSON parsing failed even after fixes');
                        }
                    }
                }
            }
        }
        
        if (miniResult) {
            try {
                miniData = JSON.parse(miniResult.rawResponse);
                console.log('✅ Mini JSON parsing successful');
            } catch (miniParseError) {
                console.error('❌ Mini JSON parsing failed:', miniParseError.message);
                // If mini was our only result and parsing failed, try to fix it
                if (!nanoResult) {
                    let fixedResponse = miniResult.rawResponse;
                    const openBraces = (fixedResponse.match(/\{/g) || []).length;
                    const closeBraces = (fixedResponse.match(/\}/g) || []).length;
                    if (openBraces > closeBraces) {
                        const missingBraces = openBraces - closeBraces;
                        fixedResponse += '}}'.repeat(missingBraces);
                        try {
                            miniData = JSON.parse(fixedResponse);
                            console.log('✅ Mini JSON parsing successful after fixing');
                        } catch (secondParseError) {
                            console.error('❌ Mini JSON parsing failed even after fixes');
                        }
                    }
                }
            }
        }
        
        // Ensure we have at least one parsed result
        if (!nanoData && !miniData) {
            return { 
                success: false, 
                status: 500, 
                userMessage: 'Failed to parse response from any model',
                transient: true 
            };
        }
        
        // Use whichever data we have for validation (prefer nano if both exist, but either is fine)
        const validationData = nanoData || miniData;
        const hasProfile = validationData.profile && validationData.profile.name;
        const hasExperience = validationData.experience && Array.isArray(validationData.experience) && validationData.experience.length > 0;
        const hasEducation = validationData.education && Array.isArray(validationData.education) && validationData.education.length > 0;
        
        const totalProcessingTime = Date.now() - processingStartTime;
        
        console.log('✅ === DUAL MODEL SYSTEM WITH TOKEN TRACKING COMPLETED ===');
        console.log(`📊 Extraction Results:`);
        console.log(`   🥇 Profile name: ${hasProfile ? 'YES' : 'NO'}`);
        console.log(`   🥇 Experience entries: ${validationData.experience?.length || 0}`);
        console.log(`   🥇 Education entries: ${validationData.education?.length || 0}`);
        console.log(`   🥇 Awards: ${validationData.awards?.length || 0}`);
        console.log(`   🥇 Certifications: ${validationData.certifications?.length || 0}`);
        console.log(`   🥈 Volunteer experiences: ${validationData.volunteer?.length || 0}`);
        console.log(`   🥈 Following companies: ${validationData.followingCompanies?.length || 0}`);
        console.log(`   🥈 Activity posts: ${validationData.activity?.length || 0}`);
        console.log(`   - Optimization mode: ${optimizationMode}`);
        console.log(`🤖 Models Used:`);
        console.log(`   - Nano: ${nanoResult ? 'SUCCESS' : 'FAILED'}`);
        console.log(`   - Mini: ${miniResult ? 'SUCCESS' : 'FAILED'}`);
        console.log(`📊 Token Usage:`);
        if (nanoResult) {
            console.log(`   - Nano Input: ${nanoResult.tokenUsage.inputTokens || 'N/A'}`);
            console.log(`   - Nano Output: ${nanoResult.tokenUsage.outputTokens || 'N/A'}`);
            console.log(`   - Nano Total: ${nanoResult.tokenUsage.totalTokens || 'N/A'}`);
        }
        if (miniResult) {
            console.log(`   - Mini Input: ${miniResult.tokenUsage.inputTokens || 'N/A'}`);
            console.log(`   - Mini Output: ${miniResult.tokenUsage.outputTokens || 'N/A'}`);
            console.log(`   - Mini Total: ${miniResult.tokenUsage.totalTokens || 'N/A'}`);
        }
        console.log(`   - Total Processing time: ${totalProcessingTime}ms`);
        
        return {
            success: true,
            data: validationData, // Return one parsed result for backward compatibility
            metadata: {
                inputType: inputType,
                processingTime: totalProcessingTime,
                hasProfile: hasProfile,
                hasExperience: hasExperience,
                hasEducation: hasEducation,
                dataQuality: (hasProfile && hasExperience) ? 'high' : 'medium',
                optimizationMode: optimizationMode,
                modelsUsed: [
                    ...(nanoResult ? ['gpt-5-nano'] : []),
                    ...(miniResult ? ['gpt-5-mini'] : [])
                ],
                tokenUsage: nanoResult?.tokenUsage || miniResult?.tokenUsage // Use whichever we have
            },
            // ✅ NEW: Both model results for server to save
            bothResults: {
                nano: nanoResult ? {
                    data: nanoData,
                    tokenData: {
                        rawGptResponse: nanoResult.rawResponse,
                        inputTokens: nanoResult.tokenUsage.inputTokens,
                        outputTokens: nanoResult.tokenUsage.outputTokens,
                        totalTokens: nanoResult.tokenUsage.totalTokens,
                        processingTimeMs: nanoResult.processingTime,
                        apiRequestId: nanoResult.apiRequestId,
                        responseStatus: nanoResult.responseStatus
                    }
                } : null,
                mini: miniResult ? {
                    data: miniData,
                    tokenData: {
                        rawGptResponse: miniResult.rawResponse,
                        inputTokens: miniResult.tokenUsage.inputTokens,
                        outputTokens: miniResult.tokenUsage.outputTokens,
                        totalTokens: miniResult.tokenUsage.totalTokens,
                        processingTimeMs: miniResult.processingTime,
                        apiRequestId: miniResult.apiRequestId,
                        responseStatus: miniResult.responseStatus
                    }
                } : null
            },
            // ✅ Legacy tokenData field for backward compatibility
            tokenData: nanoResult?.tokenUsage || miniResult?.tokenUsage ? {
                rawGptResponse: (nanoResult || miniResult).rawResponse,
                inputTokens: (nanoResult || miniResult).tokenUsage.inputTokens,
                outputTokens: (nanoResult || miniResult).tokenUsage.outputTokens,
                totalTokens: (nanoResult || miniResult).tokenUsage.totalTokens,
                processingTimeMs: (nanoResult || miniResult).processingTime,
                apiRequestId: (nanoResult || miniResult).apiRequestId,
                responseStatus: (nanoResult || miniResult).responseStatus
            } : null
        };
        
    } catch (error) {
        console.error('❌ === DUAL MODEL SYSTEM FAILED ===');
        console.error('📊 Error details:');
        console.error(`   - Message: ${error.message}`);
        console.error(`   - Status: ${error.response?.status || 'N/A'}`);
        console.error(`   - Request ID: ${error.response?.headers?.['x-request-id'] || 'N/A'}`);
        console.error(`   - Type: ${error.name || 'Unknown'}`);
        
        // Enhanced error logging - print the response body
        if (error.response?.data) {
            console.error('API error body:', JSON.stringify(error.response.data));
        }
        
        // Handle specific API error types with structured transient response
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
            userFriendlyMessage = 'Processing timeout. Please try again with a smaller profile.';
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
                optimizationMode: 'unknown',
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

module.exports = { sendToGemini };
