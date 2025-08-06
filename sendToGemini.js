// Enhanced sendToGemini.js - Google Gemini 1.5 Flash Version - FIXED DATA EXTRACTION
const axios = require('axios');

// ✅ Rate limiting configuration (Gemini is generous)
const RATE_LIMIT = {
    DELAY_BETWEEN_REQUESTS: 1000,    // 1 second between requests
    MAX_RETRIES: 3,                  // Maximum retry attempts
    RETRY_DELAY_BASE: 3000,          // Base delay for exponential backoff (3 seconds)
    MAX_RETRY_DELAY: 20000          // Maximum retry delay (20 seconds)
};

// ✅ Gemini 1.5 Flash token limits - MORE GENEROUS
const GEMINI_LIMITS = {
    MAX_TOKENS_INPUT: 25000,         // 2x more than GPT-3.5 (was 14000)
    MAX_TOKENS_OUTPUT: 4000,         // More generous output (was 2048)
    MAX_SIZE_KB: 1500               // Larger HTML size allowed (was 1000)
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

// 🚀 ULTRA-AGGRESSIVE LinkedIn HTML Preprocessor - Research-Based Fix Applied
// ✅ KEPT EXACTLY THE SAME - Only updated references to GEMINI_LIMITS
function preprocessHTMLForGemini(html) {
    try {
        console.log(`🔄 Starting ultra-aggressive HTML preprocessing (size: ${(html.length / 1024).toFixed(2)} KB)`);
        
        let processedHtml = html;
        const originalSize = processedHtml.length;
        
        // STAGE 1: Extract only main content areas (LinkedIn profile content)
        console.log('🎯 Stage 1: Extracting main LinkedIn profile content...');
        
        // Find and extract only the main profile content
        const mainContentPatterns = [
            /<main[^>]*>([\s\S]*?)<\/main>/i,
            /<div[^>]*class="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<section[^>]*class="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
            /<div[^>]*id="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/div>/i
        ];
        
        for (let pattern of mainContentPatterns) {
            const match = processedHtml.match(pattern);
            if (match && match[1].length > 1000) { // Only use if substantial content
                processedHtml = match[1];
                console.log(`✅ Found main content: ${(processedHtml.length / 1024).toFixed(2)} KB`);
                break;
            }
        }
        
        // STAGE 2: Remove all non-content sections
        console.log('🧹 Stage 2: Removing non-content sections...');
        processedHtml = processedHtml
            // Remove navigation, headers, footers
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
            
            // Remove ads and promoted content
            .replace(/<div[^>]*class="[^"]*ad[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
            .replace(/<div[^>]*class="[^"]*promoted[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
            .replace(/<div[^>]*class="[^"]*sponsor[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
            
            // Remove social widgets and sharing buttons
            .replace(/<div[^>]*class="[^"]*share[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
            .replace(/<div[^>]*class="[^"]*social[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
        
        // STAGE 3: NUCLEAR attribute removal (LinkedIn's biggest token bloat)
        console.log('💥 Stage 3: Nuclear attribute removal...');
        processedHtml = processedHtml
            // Remove ALL class attributes (LinkedIn's BEM classes are 100-200+ chars each!)
            .replace(/\s+class="[^"]*"/gi, '')
            
            // Remove ALL id attributes
            .replace(/\s+id="[^"]*"/gi, '')
            
            // Remove ALL data-* attributes (LinkedIn tracking bloat)
            .replace(/\s+data-[^=]*="[^"]*"/gi, '')
            
            // Remove ALL style attributes
            .replace(/\s+style="[^"]*"/gi, '')
            
            // Remove ALL event handlers
            .replace(/\s+on\w+="[^"]*"/gi, '')
            
            // Remove ALL aria-* accessibility attributes (not needed for extraction)
            .replace(/\s+aria-[^=]*="[^"]*"/gi, '')
            
            // Remove ALL role attributes
            .replace(/\s+role="[^"]*"/gi, '')
            
            // Remove tabindex, title, and other UI attributes
            .replace(/\s+tabindex="[^"]*"/gi, '')
            .replace(/\s+title="[^"]*"/gi, '')
            .replace(/\s+alt="[^"]*"/gi, '')
            
            // Remove ALL remaining attributes except href and src
            .replace(/(<a[^>]*)\s+(?!href)[a-zA-Z-]+="[^"]*"/gi, '$1')
            .replace(/(<img[^>]*)\s+(?!src)[a-zA-Z-]+="[^"]*"/gi, '$1');
        
        // STAGE 4: Remove all non-content elements
        console.log('🗑️ Stage 4: Removing non-content elements...');
        processedHtml = processedHtml
            // Remove scripts, styles, comments
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            
            // Remove all media (images, videos, SVGs take tons of tokens)
            .replace(/<img[^>]*>/gi, '')
            .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
            .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '')
            .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '')
            .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
            .replace(/<canvas[^>]*>[\s\S]*?<\/canvas>/gi, '')
            
            // Remove interactive elements (not needed for profile extraction)
            .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
            .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
            .replace(/<input[^>]*\/?>/gi, '')
            .replace(/<select[^>]*>[\s\S]*?<\/select>/gi, '')
            .replace(/<textarea[^>]*>[\s\S]*?<\/textarea>/gi, '');
        
        // STAGE 5: Simplify HTML structure to minimal semantic tags
        console.log('🏗️ Stage 5: Simplifying HTML structure...');
        processedHtml = processedHtml
            // Convert complex tags to simple divs
            .replace(/<article[^>]*>/gi, '<div>')
            .replace(/<\/article>/gi, '</div>')
            .replace(/<section[^>]*>/gi, '<div>')
            .replace(/<\/section>/gi, '</div>')
            .replace(/<aside[^>]*>/gi, '<div>')
            .replace(/<\/aside>/gi, '</div>')
            
            // Keep only essential semantic tags: h1-h6, p, div, span, ul, li, a
            // Remove everything else but preserve content
            .replace(/<(?!\/?(?:h[1-6]|p|div|span|ul|ol|li|a|strong|em|br)\b)[^>]*>/gi, '')
            
            // Remove empty elements (very common after attribute removal)
            .replace(/<div[^>]*>\s*<\/div>/gi, '')
            .replace(/<p[^>]*>\s*<\/p>/gi, '')
            .replace(/<span[^>]*>\s*<\/span>/gi, '')
            .replace(/<li[^>]*>\s*<\/li>/gi, '')
            .replace(/<h[1-6][^>]*>\s*<\/h[1-6]>/gi, '');
        
        // STAGE 6: EXTREME whitespace cleanup
        console.log('🧽 Stage 6: Extreme whitespace cleanup...');
        processedHtml = processedHtml
            // Collapse all whitespace to single spaces
            .replace(/\s+/g, ' ')
            // Remove spaces around tags
            .replace(/>\s+</g, '><')
            // Remove leading/trailing whitespace
            .trim();
        
        // STAGE 7: Final size check and nuclear fallback
        const currentSize = processedHtml.length;
        const estimatedTokens = Math.ceil(currentSize / 3); // Conservative estimate for HTML
        
        console.log(`📊 After processing: ${(currentSize / 1024).toFixed(2)} KB, ~${estimatedTokens} tokens`);
        
        // NUCLEAR FALLBACK: If still too large, extract only text content
        if (estimatedTokens > GEMINI_LIMITS.MAX_TOKENS_INPUT * 0.8) {
            console.log('🚨 NUCLEAR FALLBACK: Extracting text-only content...');
            
            // Extract only text content, preserve basic structure with minimal markup
            processedHtml = processedHtml
                // Convert headings to simple text with markers
                .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n## $1 ##\n')
                // Convert paragraphs to text with line breaks
                .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
                // Convert list items to simple lines
                .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
                // Remove all remaining HTML tags
                .replace(/<[^>]*>/g, '')
                // Clean up multiple line breaks
                .replace(/\n\s*\n\s*\n/g, '\n\n')
                // Final whitespace cleanup
                .replace(/\s+/g, ' ')
                .trim();
        }
        
        const finalSize = processedHtml.length;
        const finalTokens = Math.ceil(finalSize / 3);
        const reduction = ((originalSize - finalSize) / originalSize * 100).toFixed(1);
        
        console.log(`✅ HTML preprocessing completed:`);
        console.log(`   Original: ${(originalSize / 1024).toFixed(2)} KB`);
        console.log(`   Final: ${(finalSize / 1024).toFixed(2)} KB`);
        console.log(`   Reduction: ${reduction}%`);
        console.log(`   Estimated tokens: ~${finalTokens}`);
        
        return processedHtml;
        
    } catch (error) {
        console.error('❌ HTML preprocessing failed:', error);
        console.log('🔄 Fallback: Attempting basic text extraction...');
        
        try {
            // Emergency fallback: extract just text
            const fallback = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            console.log(`🆘 Fallback result: ${(fallback.length / 1024).toFixed(2)} KB`);
            return fallback;
        } catch (fallbackError) {
            console.error('💥 Even fallback failed:', fallbackError);
            return html; // Last resort: return original
        }
    }
}

// ✅ Improved token count estimation (research-based)
function estimateTokenCount(text) {
    // More accurate estimation based on research
    // HTML with remaining markup: ~3 chars per token
    // Plain text: ~4 chars per token
    const hasHtmlTags = /<[^>]*>/.test(text);
    const charsPerToken = hasHtmlTags ? 3 : 4;
    return Math.ceil(text.length / charsPerToken);
}

// ✅ Main function to send data to Gemini 1.5 Flash
async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        
        console.log('🤖 === ENHANCED GEMINI 1.5 FLASH PROCESSING START ===');
        
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
            
            // Check HTML size limits (more generous now)
            const htmlSizeKB = inputData.html.length / 1024;
            if (htmlSizeKB > GEMINI_LIMITS.MAX_SIZE_KB) {
                throw new Error(`HTML too large: ${htmlSizeKB.toFixed(2)} KB (max: ${GEMINI_LIMITS.MAX_SIZE_KB} KB)`);
            }
            
            // Preprocess HTML for Gemini with same aggressive function
            const preprocessedHtml = preprocessHTMLForGemini(inputData.html);
            
            // Estimate token count with improved estimation
            const estimatedTokens = estimateTokenCount(preprocessedHtml);
            console.log(`🔢 Estimated tokens: ${estimatedTokens}`);
            
            if (estimatedTokens > GEMINI_LIMITS.MAX_TOKENS_INPUT) {
                throw new Error(`Content too large: ~${estimatedTokens} tokens (max: ${GEMINI_LIMITS.MAX_TOKENS_INPUT})`);
            }
            
            processedData = {
                html: preprocessedHtml,
                url: inputData.url || inputData.profileUrl,
                isUserProfile: inputData.isUserProfile || false,
                optimization: inputData.optimization || {}
            };
            
            // ✅ ENHANCED System prompt for Gemini with more data fields
            systemPrompt = `You are a LinkedIn profile data extraction expert. Your task is to analyze HTML content and extract comprehensive LinkedIn profile information into valid JSON format.

CRITICAL REQUIREMENTS:
1. EXPERIENCE data is HIGHEST PRIORITY (needed for feature unlock)
2. Return ONLY valid JSON - no markdown, no explanations, no comments
3. Use the exact JSON structure provided below
4. Extract all available text content, ignore styling and layout elements
5. If a section is empty, use empty array [] or empty string ""
6. Look for ALL social engagement metrics (likes, comments, followers)
7. Extract activity posts, awards, and certifications if available`;

            // ✅ ENHANCED User prompt with comprehensive data structure
            userPrompt = `Extract comprehensive LinkedIn profile data from this HTML and return as JSON with this EXACT structure:

{
  "profile": {
    "name": "Full Name",
    "headline": "Professional Headline",
    "currentRole": "Current Job Title", 
    "currentCompany": "Current Company Name",
    "location": "City, Country",
    "about": "About section text",
    "followersCount": "Number of followers",
    "connectionsCount": "Number of connections"
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
  "certifications": [
    {
      "name": "Certification Name",
      "issuer": "Issuing Organization",
      "date": "Issue Date",
      "url": "Certificate URL if available"
    }
  ],
  "awards": [
    {
      "title": "Award Title",
      "issuer": "Organization",
      "date": "Award Date",
      "description": "Award description"
    }
  ],
  "activity": [
    {
      "type": "post|article|share",
      "content": "Activity content preview",
      "date": "Activity date",
      "likes": "Number of likes",
      "comments": "Number of comments",
      "shares": "Number of shares"
    }
  ],
  "engagement": {
    "totalLikes": "Sum of all likes across posts",
    "totalComments": "Sum of all comments across posts",
    "totalShares": "Sum of all shares across posts",
    "averageLikes": "Average likes per post"
  },
  "skills": ["Skill 1", "Skill 2", "Skill 3"]
}

IMPORTANT: Look for numbers, engagement metrics, follower counts, and activity data throughout the HTML. Extract as much detail as possible.

HTML Content:
${preprocessedHtml}`;
            
        } else if (inputData.data || inputData.results) {
            // JSON input from other sources
            inputType = 'JSON Data';
            console.log(`📊 Input type: ${inputType}`);
            
            const jsonData = inputData.data || inputData.results || inputData;
            processedData = jsonData;
            
            systemPrompt = `You are a LinkedIn profile data extraction expert. Extract and structure comprehensive profile information from the provided JSON data.

CRITICAL REQUIREMENTS:
1. EXPERIENCE data is HIGHEST PRIORITY (needed for feature unlock)  
2. Return ONLY valid JSON - no markdown, no explanations
3. Use the exact structure provided
4. Extract engagement metrics and activity data`;

            userPrompt = `Extract comprehensive LinkedIn profile data from this JSON and return as structured JSON with the same format as specified above:

${JSON.stringify(jsonData, null, 2)}`;
            
        } else {
            throw new Error('Invalid input data: must contain either "html" or "data" property');
        }
        
        console.log(`🎯 Processing ${inputType}...`);
        console.log(`📝 Total prompt length: ${(systemPrompt + userPrompt).length} characters`);
        
        // Enforce rate limiting
        await enforceRateLimit();
        
        // Make request to Gemini with retry logic
        const geminiResponse = await retryWithBackoff(async () => {
            console.log('📤 Sending request to Gemini 1.5 Flash API...');
            
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
                {
                    contents: [{
                        parts: [{
                            text: `${systemPrompt}\n\n${userPrompt}`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.1,               // Low temperature for consistent extraction
                        topK: 1,                       // Most focused responses
                        topP: 0.95,                    
                        maxOutputTokens: GEMINI_LIMITS.MAX_TOKENS_OUTPUT,
                        responseMimeType: "application/json" // Force JSON response
                    },
                    safetySettings: [
                        {
                            category: "HARM_CATEGORY_HARASSMENT",
                            threshold: "BLOCK_NONE"
                        },
                        {
                            category: "HARM_CATEGORY_HATE_SPEECH", 
                            threshold: "BLOCK_NONE"
                        },
                        {
                            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                            threshold: "BLOCK_NONE"
                        },
                        {
                            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                            threshold: "BLOCK_NONE"
                        }
                    ]
                },
                {
                    timeout: 60000, // 60 second timeout
                    headers: {
                        'Content-Type': 'application/json',
                    }
                }
            );
            
            return response;
        });
        
        console.log('📥 Gemini API response received');
        console.log(`📊 Response status: ${geminiResponse.status}`);
        
        // Process Gemini response
        if (!geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response structure from Gemini API');
        }
        
        const rawResponse = geminiResponse.data.candidates[0].content.parts[0].text;
        console.log(`📝 Raw response length: ${rawResponse.length} characters`);
        
        // Log usage metrics if available
        const usageMetadata = geminiResponse.data.usageMetadata;
        if (usageMetadata) {
            console.log(`💰 Usage - Prompt tokens: ${usageMetadata.promptTokenCount}, Completion tokens: ${usageMetadata.candidatesTokenCount}, Total: ${usageMetadata.totalTokenCount}`);
        }
        
        // Parse JSON response
        let parsedData;
        try {
            parsedData = JSON.parse(rawResponse.trim());
        } catch (parseError) {
            console.error('❌ JSON parsing failed:', parseError);
            console.log('🔍 Raw response preview:', rawResponse.substring(0, 500) + '...');
            throw new Error('Failed to parse Gemini response as JSON');
        }
        
        // Validate critical data
        const hasExperience = parsedData.experience && Array.isArray(parsedData.experience) && parsedData.experience.length > 0;
        const hasProfile = parsedData.profile && parsedData.profile.name;
        
        console.log('✅ === GEMINI 1.5 FLASH PROCESSING COMPLETED ===');
        console.log(`📊 Processing results:`);
        console.log(`   - Profile name: ${hasProfile ? 'YES' : 'NO'}`);
        console.log(`   - Experience entries: ${parsedData.experience?.length || 0}`);
        console.log(`   - Education entries: ${parsedData.education?.length || 0}`);
        console.log(`   - Skills count: ${parsedData.skills?.length || 0}`);
        console.log(`   - Certifications: ${parsedData.certifications?.length || 0}`);
        console.log(`   - Awards: ${parsedData.awards?.length || 0}`);
        console.log(`   - Activity posts: ${parsedData.activity?.length || 0}`);
        console.log(`   - Input type: ${inputType}`);
        console.log(`   - Token usage: ${usageMetadata?.totalTokenCount || 'N/A'}`);
        
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
                tokenUsage: usageMetadata
            }
        };
        
    } catch (error) {
        console.error('❌ === GEMINI 1.5 FLASH PROCESSING FAILED ===');
        console.error('📊 Error details:');
        console.error(`   - Message: ${error.message}`);
        console.error(`   - Status: ${error.response?.status || 'N/A'}`);
        console.error(`   - Type: ${error.name || 'Unknown'}`);
        
        // Handle specific Gemini error types
        let userFriendlyMessage = 'Failed to process profile data';
        
        if (error.response?.status === 429) {
            userFriendlyMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        } else if (error.response?.status === 400) {
            userFriendlyMessage = 'Invalid request format. Please try again.';
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            userFriendlyMessage = 'API authentication failed. Please check server configuration.';
        } else if (error.response?.status === 402) {
            userFriendlyMessage = 'API quota exceeded. Please contact support.';
        } else if (error.message.includes('timeout')) {
            userFriendlyMessage = 'Processing timeout. Please try again with a smaller profile.';
        } else if (error.message.includes('too large')) {
            userFriendlyMessage = 'Profile too large to process. Please try refreshing the page.';
        } else if (error.message.includes('JSON')) {
            userFriendlyMessage = 'Failed to parse AI response. Please try again.';
        } else if (error.message.includes('SAFETY')) {
            userFriendlyMessage = 'Content safety check triggered. Please try again.';
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
