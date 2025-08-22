// Enhanced sendToGemini.js - OpenAI GPT-5-nano + GPT-5-mini DUAL MODEL SUPPORT
// FIXED JSON Parsing + Token Tracking + Parallel Racing Strategy
// ✅ NEW: GPT-5 mini fallback with parallel execution for enhanced reliability

const axios = require('axios');
const https = require('https');

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
  console.log('🔥 OpenAI GPT-5-mini response received');
  console.log(`📊 Response status: ${response.status}`);
  console.log(`⏱️ Processing time: ${processingTime}ms`);
  
  // Extract token usage
  const tokenUsage = extractTokenUsage(response);
  
  // Extract response content (standard chat format)
  let rawResponse = '';
  if (response.data.choices && response.data.choices[0]?.message?.content) {
    rawResponse = response.data.choices[0].message.content;
    console.log('✅ Extracted using GPT-5-mini chat format');
  } else {
    throw new Error('Invalid response structure from GPT-5-mini');
  }
  
  // Clean up response before parsing (same as nano)
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
  
  console.log(`🧹 GPT-5-mini cleaned response length: ${cleanedResponse.length} characters`);
  console.log(`🔍 GPT-5-mini response preview: ${cleanedResponse.substring(0, 200)}...`);
  
  return {
    rawResponse: cleanedResponse,
    tokenUsage,
    processingTime,
    apiRequestId: tokenUsage.apiRequestId,
    responseStatus: 'success'
  };
}

// ✅ MODIFIED: MAIN function with dual model parallel racing support
async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            return { success: false, status: 500, userMessage: 'OPENAI_API_KEY not configured', transient: false };
        }
        
        console.log('🤖 === OPENAI DUAL MODEL SYSTEM WITH ENHANCED TOKEN TRACKING ===');
        
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
        
        // ✅ NEW: Parallel racing strategy starting from attempt 2
        let nanoResult = null;
        let miniResult = null;
        let attempt = 1;
        const maxAttempts = 3;
        
        const totalProcessingStartTime = Date.now();
        
        while (attempt <= maxAttempts && !nanoResult && !miniResult) {
            console.log(`🎪 === ATTEMPT ${attempt} ===`);
            
            if (attempt === 1) {
                // Attempt 1: Try nano only (fast path)
                console.log('🚀 Attempt 1: GPT-5 nano only (fast path)');
                try {
                    const nanoApiResult = await sendToNano({
                        systemPrompt,
                        userPrompt,
                        preprocessedHtml
                    });
                    
                    if (nanoApiResult.rawResponse) {
                        // Try to parse nano response
                        try {
                            const parsedData = JSON.parse(nanoApiResult.rawResponse);
                            console.log('✅ Nano parsing successful');
                            
                            nanoResult = {
                                data: parsedData,
                                tokenData: {
                                    rawGptResponse: nanoApiResult.rawResponse,
                                    inputTokens: nanoApiResult.tokenUsage.inputTokens,
                                    outputTokens: nanoApiResult.tokenUsage.outputTokens,
                                    totalTokens: nanoApiResult.tokenUsage.totalTokens,
                                    processingTimeMs: nanoApiResult.processingTime,
                                    apiRequestId: nanoApiResult.apiRequestId,
                                    responseStatus: nanoApiResult.responseStatus
                                }
                            };
                            
                            console.log('🎉 Attempt 1 SUCCESS: Using nano result');
                            break; // Success on first attempt
                            
                        } catch (parseError) {
                            console.error('❌ Nano JSON parsing failed on attempt 1:', parseError.message);
                            // Continue to attempt 2 with parallel racing
                        }
                    }
                } catch (nanoError) {
                    console.error('❌ Nano failed on attempt 1:', nanoError.message);
                    // Continue to attempt 2 with parallel racing
                }
            } else {
                // Attempt 2+: Parallel racing of both models
                console.log(`🏁 Attempt ${attempt}: Parallel racing (nano + mini)`);
                
                const parallelPromises = [
                    sendToNano({
                        systemPrompt,
                        userPrompt,
                        preprocessedHtml
                    }).catch(err => ({ error: err, model: 'nano' })),
                    
                    sendToMini({
                        systemPrompt,
                        userPrompt,
                        preprocessedHtml
                    }).catch(err => ({ error: err, model: 'mini' }))
                ];
                
                try {
                    const [nanoApiResult, miniApiResult] = await Promise.allSettled(parallelPromises);
                    
                    // Process nano result
                    if (nanoApiResult.status === 'fulfilled' && !nanoApiResult.value.error && nanoApiResult.value.rawResponse) {
                        try {
                            const parsedNano = JSON.parse(nanoApiResult.value.rawResponse);
                            console.log('✅ Parallel nano parsing successful');
                            
                            nanoResult = {
                                data: parsedNano,
                                tokenData: {
                                    rawGptResponse: nanoApiResult.value.rawResponse,
                                    inputTokens: nanoApiResult.value.tokenUsage.inputTokens,
                                    outputTokens: nanoApiResult.value.tokenUsage.outputTokens,
                                    totalTokens: nanoApiResult.value.tokenUsage.totalTokens,
                                    processingTimeMs: nanoApiResult.value.processingTime,
                                    apiRequestId: nanoApiResult.value.apiRequestId,
                                    responseStatus: nanoApiResult.value.responseStatus
                                }
                            };
                        } catch (parseError) {
                            console.error('❌ Parallel nano JSON parsing failed:', parseError.message);
                        }
                    } else {
                        console.log('❌ Parallel nano failed or errored');
                    }
                    
                    // Process mini result
                    if (miniApiResult.status === 'fulfilled' && !miniApiResult.value.error && miniApiResult.value.rawResponse) {
                        try {
                            const parsedMini = JSON.parse(miniApiResult.value.rawResponse);
                            console.log('✅ Parallel mini parsing successful');
                            
                            miniResult = {
                                data: parsedMini,
                                tokenData: {
                                    rawGptResponse: miniApiResult.value.rawResponse,
                                    inputTokens: miniApiResult.value.tokenUsage.inputTokens,
                                    outputTokens: miniApiResult.value.tokenUsage.outputTokens,
                                    totalTokens: miniApiResult.value.tokenUsage.totalTokens,
                                    processingTimeMs: miniApiResult.value.processingTime,
                                    apiRequestId: miniApiResult.value.apiRequestId,
                                    responseStatus: miniApiResult.value.responseStatus
                                }
                            };
                        } catch (parseError) {
                            console.error('❌ Parallel mini JSON parsing failed:', parseError.message);
                        }
                    } else {
                        console.log('❌ Parallel mini failed or errored');
                    }
                    
                    // Check if we have any successful results
                    if (nanoResult || miniResult) {
                        console.log(`🎉 Attempt ${attempt} SUCCESS: Got results from ${nanoResult ? 'nano' : ''} ${miniResult ? 'mini' : ''}`);
                        break; // Success
                    } else {
                        console.log(`❌ Attempt ${attempt} failed: Both models failed`);
                    }
                    
                } catch (parallelError) {
                    console.error(`❌ Parallel execution failed on attempt ${attempt}:`, parallelError.message);
                }
            }
            
            attempt++;
            
            if (attempt <= maxAttempts && !nanoResult && !miniResult) {
                const waitTime = 2000 * attempt; // Increasing wait time
                console.log(`⏳ Waiting ${waitTime}ms before attempt ${attempt}...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        // Check final results
        if (!nanoResult && !miniResult) {
            return { 
                success: false, 
                status: 500, 
                userMessage: 'All dual model attempts failed - neither nano nor mini could process the profile',
                transient: true 
            };
        }
        
        // ✅ NEW: Return both results (no winner selection)
        const totalProcessingTime = Date.now() - totalProcessingStartTime;
        
        console.log('✅ === DUAL MODEL SYSTEM WITH TOKEN TRACKING COMPLETED ===');
        console.log(`📊 Extraction Results:`);
        console.log(`   🥇 Profile name: ${nanoResult?.data?.profile?.name || miniResult?.data?.profile?.name || 'Unknown'}`);
        console.log(`   🥇 Nano result: ${nanoResult ? 'SUCCESS' : 'FAILED'}`);
        console.log(`   🥇 Mini result: ${miniResult ? 'SUCCESS' : 'FAILED'}`);
        
        if (nanoResult) {
            console.log(`   📊 Nano - Experience: ${nanoResult.data.experience?.length || 0}, Education: ${nanoResult.data.education?.length || 0}`);
            console.log(`   📊 Nano tokens: ${nanoResult.tokenData.inputTokens}→${nanoResult.tokenData.outputTokens} (${nanoResult.tokenData.totalTokens} total)`);
        }
        
        if (miniResult) {
            console.log(`   📊 Mini - Experience: ${miniResult.data.experience?.length || 0}, Education: ${miniResult.data.education?.length || 0}`);
            console.log(`   📊 Mini tokens: ${miniResult.tokenData.inputTokens}→${miniResult.tokenData.outputTokens} (${miniResult.tokenData.totalTokens} total)`);
        }
        
        console.log(`   - Optimization mode: ${optimizationMode}`);
        console.log(`   - Total processing time: ${totalProcessingTime}ms`);
        
        // Prepare response data (use nano if available, fallback to mini)
        const primaryData = nanoResult?.data || miniResult?.data;
        const primaryTokenData = nanoResult?.tokenData || miniResult?.tokenData;
        
        return {
            success: true,
            data: primaryData,
            metadata: {
                inputType: inputType,
                processingTime: totalProcessingTime,
                hasProfile: !!(primaryData?.profile?.name),
                hasExperience: !!(primaryData?.experience?.length > 0),
                hasEducation: !!(primaryData?.education?.length > 0),
                dataQuality: (primaryData?.profile?.name && primaryData?.experience?.length > 0) ? 'high' : 'medium',
                optimizationMode: optimizationMode,
                modelsUsed: [
                    ...(nanoResult ? ['gpt-5-nano'] : []),
                    ...(miniResult ? ['gpt-5-mini'] : [])
                ],
                tokenUsage: primaryTokenData
            },
            // ✅ NEW: Return both results when available
            bothResults: {
                nano: nanoResult,
                mini: miniResult
            },
            // Legacy single result for backward compatibility
            tokenData: primaryTokenData
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
            },
            bothResults: {
                nano: null,
                mini: null
            }
        };
    }
}

module.exports = { sendToGemini };
