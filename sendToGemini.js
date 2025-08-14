// What changed in Stage G + Gemini Fallback
// Enhanced sendToGemini.js - Support optimization.mode + structured transient returns + Gemini 1.5 Flash fallback on timeouts/429/5xx
const axios = require('axios');
const https = require('https');

// âœ… Rate limiting configuration (OpenAI GPT-5-nano)
const RATE_LIMIT = {
    DELAY_BETWEEN_REQUESTS: 1000,    // 1 second between requests
    MAX_RETRIES: 3,                  // Maximum retry attempts
    RETRY_DELAY_BASE: 3000,          // Base delay for exponential backoff (3 seconds)
    MAX_RETRY_DELAY: 20000          // Maximum retry delay (20 seconds)
};

// ðŸš€ AGGRESSIVE limits for consistent 95% reduction
const OPENAI_LIMITS = {
    MAX_TOKENS_INPUT: 50000,         // Same (you have 28K headroom)
    MAX_TOKENS_OUTPUT: 12000,        // INCREASED: 8000 â†' 12000 tokens
    MAX_SIZE_KB: 3000               // AGGRESSIVE: 4000 â†' 3000 KB (ensures 95% reduction)
};

// âœ… Last request timestamp for rate limiting
let lastRequestTime = 0;

// âœ… Keep-alive agent for resilient OpenAI calls
const keepAliveAgent = new https.Agent({ keepAlive: true });
const TRY_TIMEOUTS_MS = process.env.MSGLY_OPENAI_TIMEOUTS_MS
  ? process.env.MSGLY_OPENAI_TIMEOUTS_MS.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
  : [90000, 150000]; // 90s then 150s

// âœ… Resilient OpenAI call with keep-alive + longer timeouts + smart retries
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

// âœ… Rate limiting delay function
async function enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT.DELAY_BETWEEN_REQUESTS) {
        const waitTime = RATE_LIMIT.DELAY_BETWEEN_REQUESTS - timeSinceLastRequest;
        console.log(`â° Rate limiting: waiting ${waitTime}ms before next request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastRequestTime = Date.now();
}

// âœ… Enhanced retry logic with exponential backoff
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
                console.error(`âŒ All ${maxRetries} retry attempts failed`);
                break;
            }
            
            // Calculate exponential backoff delay
            const baseDelay = RATE_LIMIT.RETRY_DELAY_BASE;
            const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
            const jitteredDelay = exponentialDelay + (Math.random() * 1000); // Add jitter
            const finalDelay = Math.min(jitteredDelay, RATE_LIMIT.MAX_RETRY_DELAY);
            
            console.log(`â³ Attempt ${attempt} failed, retrying in ${Math.round(finalDelay)}ms...`);
            console.log(`   Error: ${error.message}`);
            
            await new Promise(resolve => setTimeout(resolve, finalDelay));
        }
    }
    
    throw lastError;
}

// ðŸš€ AGGRESSIVE LinkedIn HTML Preprocessor - Always 95% reduction
function preprocessHTMLForGemini(html, optimizationMode = 'aggressive') {
    try {
        console.log(`ðŸ"¥ Starting aggressive HTML preprocessing (size: ${(html.length / 1024).toFixed(2)} KB)`);
        
        let processedHtml = html;
        const originalSize = processedHtml.length;
        
        // Always use aggressive preprocessing for consistent 95% reduction
        console.log('ðŸŽ¯ Stage 1: Aggressive mode - maximum reduction for optimal processing...');
        
        // Aggressive preprocessing - remove larger sections
        processedHtml = processedHtml
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\s+class="[^"]*"/gi, '')
            .replace(/\s+data-[^=]*="[^"]*"/gi, '')
            .replace(/\s+on\w+="[^"]*"/gi, '')
            .replace(/\s+style="[^"]*"/gi, '')
            .replace(/\s{3,}/g, ' ')
            .replace(/>\s+</g, '><')
            .trim();
        
        const finalSize = processedHtml.length;
        const finalTokens = Math.ceil(finalSize / 3);
        const reductionPct = ((originalSize - finalSize) / originalSize * 100);
        
        console.log(`[Aggressive Reduction] Original HTML size: ${(originalSize / 1024).toFixed(2)} KB | Final: ${(finalSize / 1024).toFixed(2)} KB | Reduction: ${reductionPct.toFixed(1)}% | Est. tokens: ${finalTokens}`);
        
        // Guardrail: warn if reduction below 90%
        if (reductionPct < 90) {
            console.warn('âš ï¸ Reduction below 90% â€" check cleanup rules.');
        }
        
        console.log(`âœ… Aggressive HTML preprocessing completed:`);
        console.log(`   Original: ${(originalSize / 1024).toFixed(2)} KB`);
        console.log(`   Final: ${(finalSize / 1024).toFixed(2)} KB`);
        console.log(`   Reduction: ${reductionPct.toFixed(1)}%`);
        console.log(`   Estimated tokens: ~${finalTokens} (Max: ${OPENAI_LIMITS.MAX_TOKENS_INPUT})`);
        
        return processedHtml;
        
    } catch (error) {
        console.error('âŒ HTML preprocessing failed:', error);
        console.log('ðŸ"¥ Fallback: Basic processing...');
        
        try {
            const fallback = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            console.log(`ðŸ†˜ Fallback result: ${(fallback.length / 1024).toFixed(2)} KB`);
            return fallback;
        } catch (fallbackError) {
            console.error('ðŸ'¥ Even fallback failed:', fallbackError);
            return html;
        }
    }
}

// âœ… Improved token count estimation
function estimateTokenCount(text) {
    const hasHtmlTags = /<[^>]*>/.test(text);
    const charsPerToken = hasHtmlTags ? 3 : 4;
    return Math.ceil(text.length / charsPerToken);
}

// âœ… Send to OpenAI GPT-5-nano (keep EXACT original call structure)
async function sendToNano({ systemPrompt, userPrompt, preprocessedHtml }) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  console.log('ðŸ"¤ Sending request to OpenAI GPT-5-nano Responses API...');
  
  // EXACT original request structure from your working code
  const response = await callOpenAIWithResilience(
    'https://api.openai.com/v1/responses',
    {
      model: 'gpt-5-nano',
      text: { format: { type: 'json_object' } },
      max_output_tokens: 12000,
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
  
  console.log('ðŸ"¥ OpenAI API response received');
  console.log(`ðŸ"Š Response status: ${response.status}`);
  
  // EXACT original response parsing
  const data = response.data;
  const rawResponse = data.output_text ?? 
    (Array.isArray(data.output)
      ? data.output
          .map(p => Array.isArray(p.content) 
            ? p.content.map(c => c.text || '').join('')
            : '')
          .join('')
      : '');
  
  return rawResponse;
}

// âœ… Gemini 1.5 Flash fallback (safe for its limits)
async function sendToGeminiFlashFallback({ systemPrompt, userPrompt, preprocessedHtml }) {
  // Endpoint & key
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  // Shorten descriptions to avoid 8k cut; prefer completeness
  const FALLBACK_RULES =
    'Return JSON only. Prefer completeness over detail. ' +
    'If token budget is tight, add short entries (title, company, dateRange) rather than skipping. ' +
    'Summaries: experience â‰¤ 400 chars, honors â‰¤ 250 chars. No skills. Same schema as usual.';

  const contents = [
    {
      role: 'user',
      parts: [
        { text: String(systemPrompt || '') + '\n' + FALLBACK_RULES },
        { text: String(userPrompt || '') },            // instructions/schema only
        { text: String(preprocessedHtml || '') }       // full HTML once
      ]
    }
  ];

  const body = {
    contents,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 6000,            // â†" under ~8k ceiling to avoid truncation
      responseMimeType: 'application/json'
      // (optionally you can add responseSchema if you maintain a compact JSON schema)
    },
    safetySettings: [] // keep neutral; we need raw JSON
  };

  const res = await axios.post(url, body, { timeout: 90000 }); // allow enough time
  const data = res.data;

  // extract text safely
  let text =
    data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

  // If Gemini truncated (MAX_TOKENS) or JSON.parse fails, request a JSON suffix
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const tail = text.slice(-1200);
    const contReq = {
      contents: [
        ...contents,
        {
          role: 'user',
          parts: [{ text:
            'Continue the JSON only, from exactly where you stopped. ' +
            'Return only the missing valid JSON suffix; do not repeat earlier content.\n\n' +
            'Context (tail):\n' + tail
          }]
        }
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json'
      },
      safetySettings: []
    };
    const contRes = await axios.post(url, contReq, { timeout: 45000 });
    const contText = contRes.data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    text += contText; // append
    // return combined text (still a plain JSON string for our callers)
  }

  return text;
}

// âœ… Default path + fallback wrapper
async function analyzeWithNanoThenGemini(payload) {
  try {
    const t = await sendToNano(payload);
    return t;
  } catch (err) {
    const s = err.response?.status;
    const retriable = err.code === 'ECONNABORTED' || s === 429 || (s >= 500 && s <= 599);
    if (!retriable) throw err;
    if (process.env.MSGLY_FALLBACK_GEMINI !== 'true') throw err;
    console.warn('[Fallback] switching to Gemini 1.5 Flashâ€¦');
    return await sendToGeminiFlashFallback(payload);
  }
}

// âœ… MAIN function to send data to OpenAI GPT-5-nano with aggressive mode always + Gemini fallback
async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            return { success: false, status: 500, userMessage: 'OPENAI_API_KEY not configured', transient: false };
        }
        
        console.log('ðŸ¤– === OPENAI GPT-5-NANO WITH AGGRESSIVE OPTIMIZATION + GEMINI FALLBACK ===');
        
        // Determine input type and prepare data
        let processedData;
        let inputType;
        let systemPrompt;
        let userPrompt;
        let preprocessedHtml;
        
        // Always use aggressive optimization for consistent 95% reduction
        const optimizationMode = 'aggressive';
        console.log(`ðŸ"Š Optimization mode: ${optimizationMode} (ALWAYS AGGRESSIVE for ${inputData.isUserProfile ? 'USER' : 'TARGET'} profile)`);
        
        if (inputData.html) {
            inputType = 'HTML from Chrome Extension';
            console.log(`ðŸ"„ Input type: ${inputType}`);
            console.log(`ðŸ" Original HTML size: ${(inputData.html.length / 1024).toFixed(2)} KB`);
            
            const htmlSizeKB = inputData.html.length / 1024;
            if (htmlSizeKB > OPENAI_LIMITS.MAX_SIZE_KB) {
                return { 
                    success: false, 
                    status: 413, 
                    userMessage: `HTML too large: ${htmlSizeKB.toFixed(2)} KB (max: ${OPENAI_LIMITS.MAX_SIZE_KB} KB)`,
                    transient: false 
                };
            }
            
            // Preprocess HTML with aggressive optimization
            preprocessedHtml = preprocessHTMLForGemini(inputData.html, optimizationMode);
            
            const estimatedTokens = estimateTokenCount(preprocessedHtml);
            console.log(`ðŸ"¢ Estimated tokens: ${estimatedTokens} (Max input: ${OPENAI_LIMITS.MAX_TOKENS_INPUT})`);
            
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
ðŸ¥‡ TIER 1 (HIGHEST PRIORITY - Extract first):
- Basic profile info: name, headline, currentRole, currentCompany, location, about
- Experience/work history: ALL job entries with titles, companies, durations, descriptions
- Education: ALL education entries with schools, degrees, fields, years, grades, activities  
- Awards: ALL awards/honors/recognitions found
- Certifications: ALL certifications/licenses found

ðŸ¥ˆ TIER 2 (SECONDARY PRIORITY - Extract after TIER 1):
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
8. With aggressive optimization mode, extract maximum data from all sections`;

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
            console.log(`ðŸ"Š Input type: ${inputType}`);
            
            const jsonData = inputData.data || inputData.results || inputData;
            processedData = jsonData;
            
            systemPrompt = `You are a LinkedIn profile data extraction expert. Extract and structure comprehensive profile information from the provided JSON data with TIER 1/2 prioritization.

CRITICAL REQUIREMENTS:
1. TIER 1 data is HIGHEST PRIORITY (profile, experience, education, awards, certifications)
2. TIER 2 data is SECONDARY (volunteer, following, activity, social metrics)  
3. Return ONLY valid JSON - no markdown, no explanations
4. Use the exact structure provided
5. Extract ALL available data thoroughly from every section`;

            userPrompt = `Extract comprehensive LinkedIn profile data from this JSON with aggressive optimization mode and return as structured JSON with the same format as specified above:

${JSON.stringify(jsonData, null, 2)}`;
            
        } else {
            return { 
                success: false, 
                status: 400, 
                userMessage: 'Invalid input data: must contain either "html" or "data" property',
                transient: false 
            };
        }
        
        console.log(`ðŸŽ¯ Processing ${inputType} with ${optimizationMode} optimization...`);
        console.log(`ðŸ" Total prompt length: ${(systemPrompt + userPrompt).length} characters`);
        
        // Enforce rate limiting
        await enforceRateLimit();
        
        // Use the new wrapper that tries nano first, then falls back to Gemini
        const rawResponse = await analyzeWithNanoThenGemini({
            systemPrompt,
            userPrompt,
            preprocessedHtml
        });
        
        if (!rawResponse) {
            return { 
                success: false, 
                status: 500, 
                userMessage: 'Invalid response structure from API',
                transient: true 
            };
        }
        
        console.log(`ðŸ" Raw response length: ${rawResponse.length} characters`);
        
        // Parse JSON response with robust error handling
        let parsedData;
        try {
            parsedData = JSON.parse(rawResponse.trim());
        } catch (parseError) {
            console.error('âŒ JSON parsing failed:', parseError);
            console.log('ðŸ" Raw response preview:', rawResponse.substring(0, 500) + '...');
            return { 
                success: false, 
                status: 500, 
                userMessage: 'Failed to parse API response as JSON',
                transient: true 
            };
        }
        
        // Validate data
        const hasProfile = parsedData.profile && parsedData.profile.name;
        const hasExperience = parsedData.experience && Array.isArray(parsedData.experience) && parsedData.experience.length > 0;
        const hasEducation = parsedData.education && Array.isArray(parsedData.education) && parsedData.education.length > 0;
        
        console.log('âœ… === OPENAI GPT-5-NANO WITH AGGRESSIVE OPTIMIZATION + GEMINI FALLBACK COMPLETED ===');
        console.log(`ðŸ"Š Extraction Results:`);
        console.log(`   ðŸ¥‡ Profile name: ${hasProfile ? 'YES' : 'NO'}`);
        console.log(`   ðŸ¥‡ Experience entries: ${parsedData.experience?.length || 0}`);
        console.log(`   ðŸ¥‡ Education entries: ${parsedData.education?.length || 0}`);
        console.log(`   ðŸ¥‡ Awards: ${parsedData.awards?.length || 0}`);
        console.log(`   ðŸ¥‡ Certifications: ${parsedData.certifications?.length || 0}`);
        console.log(`   ðŸ¥ˆ Volunteer experiences: ${parsedData.volunteer?.length || 0}`);
        console.log(`   ðŸ¥ˆ Following companies: ${parsedData.followingCompanies?.length || 0}`);
        console.log(`   ðŸ¥ˆ Activity posts: ${parsedData.activity?.length || 0}`);
        console.log(`   - Optimization mode: ${optimizationMode}`);
        
        return {
            success: true,
            data: parsedData,
            metadata: {
                inputType: inputType,
                processingTime: Date.now(),
                hasProfile: hasProfile,
                hasExperience: hasExperience,
                hasEducation: hasEducation,
                dataQuality: (hasProfile && hasExperience) ? 'high' : 'medium',
                optimizationMode: optimizationMode
            }
        };
        
    } catch (error) {
        console.error('âŒ === OPENAI GPT-5-NANO + GEMINI FALLBACK FAILED ===');
        console.error('ðŸ"Š Error details:');
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
                optimizationMode: 'aggressive',
                requestId: error.response?.headers?.['x-request-id'] || null
            },
            usage: null
        };
    }
}

module.exports = { sendToGemini };
