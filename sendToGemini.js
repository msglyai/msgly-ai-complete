// Enhanced sendToGemini.js - OpenAI GPT-3.5 Turbo Version
const axios = require('axios');

// ✅ Rate limiting configuration (OpenAI is more generous)
const RATE_LIMIT = {
    DELAY_BETWEEN_REQUESTS: 1000,    // 1 second between requests (OpenAI allows more)
    MAX_RETRIES: 3,                  // Maximum retry attempts
    RETRY_DELAY_BASE: 3000,          // Base delay for exponential backoff (3 seconds)
    MAX_RETRY_DELAY: 20000          // Maximum retry delay (20 seconds)
};

// ✅ OpenAI token limits
const OPENAI_LIMITS = {
    MAX_TOKENS_INPUT: 14000,         // Leave room for response (16K total - 2K response)
    MAX_TOKENS_OUTPUT: 2048,         // Maximum response tokens
    MAX_SIZE_KB: 1000               // Maximum HTML size to process
};

// ✅ Last request timestamp for rate limiting
let lastRequestTime = 0;

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

// ✅ CONSERVATIVE HTML preprocessing for OpenAI (TARGET: ~12,000 tokens)
function preprocessHTMLForOpenAI(html) {
    try {
        console.log(`🔄 Preprocessing HTML for OpenAI (size: ${(html.length / 1024).toFixed(2)} KB)`);
        
        let processedHtml = html;
        
        // CONSERVATIVE STEP 1: Remove obvious bloat but keep structure
        processedHtml = processedHtml
            // Remove scripts and styles (safe)
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
            
            // Remove media (safe)
            .replace(/<img[^>]*>/gi, '')
            .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
            .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '')
            .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '')
            .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
            
            // Remove forms (safe - not needed for profile data)
            .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
            .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
            .replace(/<input[^>]*\/?>/gi, '')
            
            // Remove comments (safe)
            .replace(/<!--[\s\S]*?-->/g, '');
        
        // CONSERVATIVE STEP 2: Clean attributes selectively
        processedHtml = processedHtml
            // Remove style attributes (safe)
            .replace(/\s+style="[^"]*"/gi, '')
            
            // Remove tracking attributes (safe)
            .replace(/\s+data-tracking[^=]*="[^"]*"/gi, '')
            .replace(/\s+data-analytics[^=]*="[^"]*"/gi, '')
            .replace(/\s+ga-[^=]*="[^"]*"/gi, '')
            
            // Remove interaction attributes (safe)
            .replace(/\s+on\w+="[^"]*"/gi, '')
            
            // Remove very long class attributes (conservative)
            .replace(/\s+class="[^"]{200,}"/gi, ' class=""')
            
            // Remove very long href values (conservative)
            .replace(/\s+href="[^"]{150,}"/gi, ' href="#"');
        
        // CONSERVATIVE STEP 3: Gentle whitespace cleanup
        processedHtml = processedHtml
            // Basic whitespace cleanup
            .replace(/\s+/g, ' ')
            .replace(/>\s+</g, '><')
            .replace(/\n\s*\n/g, '\n')
            .trim();
        
        // CONSERVATIVE STEP 4: Only if still too large, do targeted removal
        const estimatedTokens = Math.ceil(processedHtml.length / 3);
        console.log(`🔍 After conservative cleanup: ${estimatedTokens} estimated tokens`);
        
        if (estimatedTokens > 13000) {
            console.log(`⚠️ Still large (~${estimatedTokens} tokens), doing targeted cleanup...`);
            
            // Target removal of repetitive LinkedIn elements
            processedHtml = processedHtml
                // Remove navigation elements
                .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
                .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                
                // Remove very long class attributes more aggressively
                .replace(/\s+class="[^"]{100,}"/gi, ' class=""')
                
                // Remove data attributes except essential LinkedIn ones
                .replace(/\s+data-(?!section|experience|skills|education|about)[^=]*="[^"]*"/gi, '')
                
                // Remove aria attributes (not needed for content extraction)
                .replace(/\s+aria-[^=]*="[^"]*"/gi, '')
                .replace(/\s+role="[^"]*"/gi, '');
        }
        
        const finalSize = processedHtml.length / 1024;
        const finalTokens = Math.ceil(processedHtml.length / 3);
        
        console.log(`✅ HTML preprocessed for OpenAI (final size: ${finalSize.toFixed(2)} KB)`);
        console.log(`🔢 Estimated tokens: ${finalTokens}`);
        console.log(`🎯 Content preview (first 300 chars): ${processedHtml.substring(0, 300)}...`);
        
        return processedHtml;
        
    } catch (error) {
        console.error('❌ HTML preprocessing failed:', error);
        return html; // Return original if preprocessing fails
    }
}

// ✅ Estimate token count (rough approximation for OpenAI)
function estimateTokenCount(text) {
    // Rough estimation: 1 token ≈ 4 characters for English text
    // More conservative for HTML (more special characters)
    return Math.ceil(text.length / 3);
}

// ✅ Main function to send data to OpenAI
async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is not set');
        }
        
        console.log('🤖 === ENHANCED OPENAI PROCESSING START ===');
        
        // Determine input type and prepare data
        let processedData;
        let inputType;
        let systemPrompt;
        let userPrompt;
        
        if (inputData.html) {
            // HTML input from Chrome extension
            inputType = 'HTML from Chrome Extension';
            console.log(`📄 Input type: ${inputType}`);
            console.log(`📏 Original HTML size: ${(inputData.html.length / 1024).toFixed(2)} KB`);
            
            // Check HTML size limits
            const htmlSizeKB = inputData.html.length / 1024;
            if (htmlSizeKB > OPENAI_LIMITS.MAX_SIZE_KB) {
                throw new Error(`HTML too large: ${htmlSizeKB.toFixed(2)} KB (max: ${OPENAI_LIMITS.MAX_SIZE_KB} KB)`);
            }
            
            // Preprocess HTML for OpenAI
            const preprocessedHtml = preprocessHTMLForOpenAI(inputData.html);
            
            // Estimate token count
            const estimatedTokens = estimateTokenCount(preprocessedHtml);
            console.log(`🔢 Estimated tokens: ${estimatedTokens}`);
            
            if (estimatedTokens > OPENAI_LIMITS.MAX_TOKENS_INPUT) {
                throw new Error(`Content too large: ~${estimatedTokens} tokens (max: ${OPENAI_LIMITS.MAX_TOKENS_INPUT})`);
            }
            
            processedData = {
                html: preprocessedHtml,
                url: inputData.url || inputData.profileUrl,
                isUserProfile: inputData.isUserProfile || false,
                optimization: inputData.optimization || {}
            };
            
            // System prompt for OpenAI
            systemPrompt = `You are a LinkedIn profile data extraction expert. Your task is to analyze HTML content and extract structured profile information into valid JSON format.

CRITICAL REQUIREMENTS:
1. EXPERIENCE data is HIGHEST PRIORITY (needed for feature unlock)
2. Return ONLY valid JSON - no markdown, no explanations, no comments
3. Use the exact JSON structure provided
4. Extract all text content, ignore styling and layout elements
5. If a section is empty, use empty array [] or empty string ""`;

            // User prompt with HTML content
            userPrompt = `Extract LinkedIn profile data from this HTML and return as JSON with this exact structure:

{
  "profile": {
    "name": "Full Name",
    "headline": "Professional Headline", 
    "location": "City, Country",
    "about": "About section text"
  },
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name", 
      "duration": "Start Date - End Date",
      "description": "Job description and achievements",
      "location": "Job location"
    }
  ],
  "education": [
    {
      "school": "University/School Name",
      "degree": "Degree Type",
      "field": "Field of Study", 
      "duration": "Start Year - End Year"
    }
  ],
  "skills": ["Skill 1", "Skill 2", "Skill 3"],
  "certifications": [
    {
      "name": "Certification Name",
      "issuer": "Issuing Organization",
      "date": "Issue Date"
    }
  ]
}

HTML Content:
${preprocessedHtml}`;
            
        } else if (inputData.data || inputData.results) {
            // JSON input from Bright Data or other sources
            inputType = 'JSON Data';
            console.log(`📊 Input type: ${inputType}`);
            
            const jsonData = inputData.data || inputData.results || inputData;
            processedData = jsonData;
            
            systemPrompt = `You are a LinkedIn profile data extraction expert. Extract and structure profile information from the provided JSON data.

CRITICAL REQUIREMENTS:
1. EXPERIENCE data is HIGHEST PRIORITY (needed for feature unlock)  
2. Return ONLY valid JSON - no markdown, no explanations
3. Use the exact structure provided`;

            userPrompt = `Extract LinkedIn profile data from this JSON and return as structured JSON:

${JSON.stringify(jsonData, null, 2)}`;
            
        } else {
            throw new Error('Invalid input data: must contain either "html" or "data" property');
        }
        
        console.log(`🎯 Processing ${inputType}...`);
        console.log(`📝 Total prompt length: ${(systemPrompt + userPrompt).length} characters`);
        
        // Enforce rate limiting
        await enforceRateLimit();
        
        // Make request to OpenAI with retry logic
        const openaiResponse = await retryWithBackoff(async () => {
            console.log('📤 Sending request to OpenAI API...');
            
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: "gpt-3.5-turbo-16k", // Use 16K context version for large HTML
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user", 
                            content: userPrompt
                        }
                    ],
                    temperature: 0.1,           // Low temperature for consistent extraction
                    max_tokens: OPENAI_LIMITS.MAX_TOKENS_OUTPUT,
                    top_p: 0.95,
                    frequency_penalty: 0,
                    presence_penalty: 0,
                    response_format: { "type": "json_object" } // Force JSON response (GPT-3.5 Turbo feature)
                },
                {
                    timeout: 60000, // 60 second timeout
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    }
                }
            );
            
            return response;
        });
        
        console.log('📥 OpenAI API response received');
        console.log(`📊 Response status: ${openaiResponse.status}`);
        
        // Process OpenAI response
        if (!openaiResponse.data?.choices?.[0]?.message?.content) {
            throw new Error('Invalid response structure from OpenAI API');
        }
        
        const rawResponse = openaiResponse.data.choices[0].message.content;
        console.log(`📝 Raw response length: ${rawResponse.length} characters`);
        console.log(`💰 Usage - Prompt tokens: ${openaiResponse.data.usage?.prompt_tokens}, Completion tokens: ${openaiResponse.data.usage?.completion_tokens}`);
        
        // Parse JSON response
        let parsedData;
        try {
            parsedData = JSON.parse(rawResponse.trim());
        } catch (parseError) {
            console.error('❌ JSON parsing failed:', parseError);
            console.log('🔍 Raw response preview:', rawResponse.substring(0, 500) + '...');
            throw new Error('Failed to parse OpenAI response as JSON');
        }
        
        // Validate critical data
        const hasExperience = parsedData.experience && Array.isArray(parsedData.experience) && parsedData.experience.length > 0;
        const hasProfile = parsedData.profile && parsedData.profile.name;
        
        console.log('✅ === OPENAI PROCESSING COMPLETED ===');
        console.log(`📊 Processing results:`);
        console.log(`   - Profile name: ${hasProfile ? 'YES' : 'NO'}`);
        console.log(`   - Experience entries: ${parsedData.experience?.length || 0}`);
        console.log(`   - Education entries: ${parsedData.education?.length || 0}`);
        console.log(`   - Skills count: ${parsedData.skills?.length || 0}`);
        console.log(`   - Input type: ${inputType}`);
        console.log(`   - Token usage: ${openaiResponse.data.usage?.total_tokens || 'N/A'}`);
        
        if (!hasExperience) {
            console.warn('⚠️ WARNING: No experience data extracted - this may affect feature unlock');
        }
        
        return {
            success: true,
            data: parsedData,
            metadata: {
                inputType: inputType,
                processingTime: Date.now(),
                hasExperience: hasExperience,
                hasProfile: hasProfile,
                dataQuality: hasExperience && hasProfile ? 'high' : 'medium',
                tokenUsage: openaiResponse.data.usage
            }
        };
        
    } catch (error) {
        console.error('❌ === OPENAI PROCESSING FAILED ===');
        console.error('📊 Error details:');
        console.error(`   - Message: ${error.message}`);
        console.error(`   - Status: ${error.response?.status || 'N/A'}`);
        console.error(`   - Type: ${error.name || 'Unknown'}`);
        
        // Handle specific OpenAI error types
        let userFriendlyMessage = 'Failed to process profile data';
        
        if (error.response?.status === 429) {
            userFriendlyMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        } else if (error.response?.status === 400) {
            userFriendlyMessage = 'Invalid request format. Please try again.';
        } else if (error.response?.status === 401) {
            userFriendlyMessage = 'API authentication failed. Please check server configuration.';
        } else if (error.response?.status === 402) {
            userFriendlyMessage = 'API quota exceeded. Please contact support.';
        } else if (error.message.includes('timeout')) {
            userFriendlyMessage = 'Processing timeout. Please try again with a smaller profile.';
        } else if (error.message.includes('too large')) {
            userFriendlyMessage = 'Profile too large to process. Please try refreshing the page.';
        } else if (error.message.includes('JSON')) {
            userFriendlyMessage = 'Failed to parse AI response. Please try again.';
        }
        
        return {
            success: false,
            error: error.message,
            userMessage: userFriendlyMessage,
            details: {
                status: error.response?.status,
                type: error.name,
                timestamp: new Date().toISOString()
            }
        };
    }
}

module.exports = { sendToGemini };
