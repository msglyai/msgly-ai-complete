// Enhanced sendToGemini.js - STAGE G MODIFICATIONS
// ✅ Added optimization.mode support and structured transient error handling
const axios = require('axios');

// ✅ Rate limiting configuration (Gemini is generous)
const RATE_LIMIT = {
    DELAY_BETWEEN_REQUESTS: 1000,    // 1 second between requests
    MAX_RETRIES: 3,                  // Maximum retry attempts
    RETRY_DELAY_BASE: 3000,          // Base delay for exponential backoff (3 seconds)
    MAX_RETRY_DELAY: 20000          // Maximum retry delay (20 seconds)
};

// 🚀 INCREASED limits for TESTING - Allow more content to preserve complete data
const GEMINI_LIMITS = {
    MAX_TOKENS_INPUT: 50000,         // Same (you have 28K headroom)
    MAX_TOKENS_OUTPUT: 8000,         // Same (you have 5K headroom)
    MAX_SIZE_KB: 4000               // INCREASED: 3000 → 4000 KB (more content preserved)
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

// 🚀 STAGE G: Modified preprocessing based on optimization mode
function preprocessHTMLForGemini(html, optimizationMode = 'standard') {
    try {
        console.log(`🔄 Starting HTML preprocessing (mode: ${optimizationMode}, size: ${(html.length / 1024).toFixed(2)} KB)`);
        
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
        
        // STAGE 3: Optimization mode-based attribute removal
        console.log(`🔧 Stage 3: ${optimizationMode} mode attribute removal...`);
        
        if (optimizationMode === 'standard') {
            // Standard mode: More aggressive cleanup for user profiles
            processedHtml = processedHtml
                .replace(/\s+class="[^"]*"/gi, '')
                .replace(/\s+id="[^"]*"/gi, '')
                .replace(/\s+data-[^=]*="[^"]*"/gi, '')
                .replace(/\s+style="[^"]*"/gi, '')
                .replace(/\s+on\w+="[^"]*"/gi, '')
                .replace(/\s+aria-[^=]*="[^"]*"/gi, '')
                .replace(/\s+role="[^"]*"/gi, '')
                .replace(/\s+tabindex="[^"]*"/gi, '');
        } else {
            // Less aggressive mode: Preserve more structure for target profiles
            processedHtml = processedHtml
                // PRESERVE classes that might identify important profile sections
                .replace(/\s+class="([^"]*(?:award|certification|honor|achievement|accomplishment|license|skill)[^"]*)"/gi, ' class="$1"')
                
                // Remove most other classes but keep profile structure classes
                .replace(/\s+class="([^"]*(?:profile|experience|education|section|content|detail)[^"]*)"/gi, ' class="$1"')
                .replace(/\s+class="(?![^"]*(?:award|certification|honor|achievement|accomplishment|license|skill|profile|experience|education|section|content|detail))[^"]*"/gi, '')
                
                // PRESERVE ids that might identify sections
                .replace(/\s+id="([^"]*(?:award|certification|honor|achievement|accomplishment|license|skill|experience|education)[^"]*)"/gi, ' id="$1"')
                .replace(/\s+id="(?![^"]*(?:award|certification|honor|achievement|accomplishment|license|skill|experience|education))[^"]*"/gi, '')
                
                // Remove ALL style attributes (still heavy)
                .replace(/\s+style="[^"]*"/gi, '')
                
                // Remove ALL event handlers
                .replace(/\s+on\w+="[^"]*"/gi, '')
                
                // Remove most aria-* accessibility attributes but keep structure ones
                .replace(/\s+aria-(?!label|labelledby)[^=]*="[^"]*"/gi, '')
                
                // Remove role attributes except important ones
                .replace(/\s+role="(?!heading|listitem|list)[^"]*"/gi, '')
                
                // Remove tabindex, but keep title and alt for content context
                .replace(/\s+tabindex="[^"]*"/gi, '');
        }
        
        // STAGE 4: Remove non-content elements
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
        
        // STAGE 5: Whitespace cleanup
        console.log('🧽 Stage 5: Whitespace cleanup...');
        processedHtml = processedHtml
            // Collapse multiple spaces
            .replace(/\s{3,}/g, ' ')
            // Remove spaces around tags
            .replace(/>\s+</g, '><')
            // Remove leading/trailing whitespace
            .trim();
        
        const finalSize = processedHtml.length;
        const finalTokens = Math.ceil(finalSize / 3);
        const reduction = ((originalSize - finalSize) / originalSize * 100).toFixed(1);
        
        console.log(`✅ HTML preprocessing completed (${optimizationMode} mode):`);
        console.log(`   Original: ${(originalSize / 1024).toFixed(2)} KB`);
        console.log(`   Final: ${(finalSize / 1024).toFixed(2)} KB`);
        console.log(`   Reduction: ${reduction}%`);
        console.log(`   Estimated tokens: ~${finalTokens} (Max: ${GEMINI_LIMITS.MAX_TOKENS_INPUT})`);
        
        return processedHtml;
        
    } catch (error) {
        console.error('❌ HTML preprocessing failed:', error);
        
        try {
            // Basic fallback
            const fallback = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
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

// ✅ STAGE G: Modified main function with structured error handling
async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            // ✅ STAGE G: Return structured error instead of throwing
            return {
                success: false,
                status: 500,
                userMessage: 'GEMINI_API_KEY not configured',
                transient: false
            };
        }
        
        console.log('🤖 === GEMINI 1.5 FLASH - STAGE G START ===');
        
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
            if (htmlSizeKB > GEMINI_LIMITS.MAX_SIZE_KB) {
                return {
                    success: false,
                    status: 413,
                    userMessage: `HTML too large: ${htmlSizeKB.toFixed(2)} KB (max: ${GEMINI_LIMITS.MAX_SIZE_KB} KB)`,
                    transient: false
                };
            }
            
            // ✅ STAGE G: Use optimization mode from input
            const optimizationMode = inputData.optimization?.mode || 'standard';
            console.log(`🔧 Using optimization mode: ${optimizationMode}`);
            
            // Preprocess HTML for Gemini with optimization mode
            const preprocessedHtml = preprocessHTMLForGemini(inputData.html, optimizationMode);
            
            // Estimate token count with improved estimation
            const estimatedTokens = estimateTokenCount(preprocessedHtml);
            console.log(`🔢 Estimated tokens: ${estimatedTokens} (Max input: ${GEMINI_LIMITS.MAX_TOKENS_INPUT})`);
            
            if (estimatedTokens > GEMINI_LIMITS.MAX_TOKENS_INPUT) {
                return {
                    success: false,
                    status: 413,
                    userMessage: `Content too large: ~${estimatedTokens} tokens (max: ${GEMINI_LIMITS.MAX_TOKENS_INPUT})`,
                    transient: false
                };
            }
            
            processedData = {
                html: preprocessedHtml,
                url: inputData.url || inputData.profileUrl,
                isUserProfile: inputData.isUserProfile || false,
                optimization: inputData.optimization || {}
            };
            
            // ✅ System prompt for comprehensive data extraction
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
8. With optimized preprocessing, extract maximum data from all sections`;

            // ✅ User prompt for comprehensive data extraction
            userPrompt = `Extract comprehensive LinkedIn profile data from this HTML. Return as JSON with this EXACT structure:

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

IMPORTANT EXTRACTION NOTES:
- Extract ALL content thoroughly from every section
- For experience: Extract complete descriptions and all job details
- For education: Include all academic information and activities
- For all arrays: Extract every item found, don't limit or truncate
- Extract all available data with optimized preprocessing
- Include all text content with full context and descriptions

HTML Content:
${preprocessedHtml}`;
            
        } else if (inputData.data || inputData.results) {
            // JSON input from other sources
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

            userPrompt = `Extract comprehensive LinkedIn profile data from this JSON and return as structured JSON with the same format as specified above:

${JSON.stringify(jsonData, null, 2)}`;
            
        } else {
            return {
                success: false,
                status: 400,
                userMessage: 'Invalid input data: must contain either "html" or "data" property',
                transient: false
            };
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
                        maxOutputTokens: GEMINI_LIMITS.MAX_TOKENS_OUTPUT,  // 8000 tokens available
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
            return {
                success: false,
                status: 502,
                userMessage: 'Invalid response structure from Gemini API',
                transient: true
            };
        }
        
        const rawResponse = geminiResponse.data.candidates[0].content.parts[0].text;
        console.log(`📝 Raw response length: ${rawResponse.length} characters`);
        
        // ✅ Enhanced token usage extraction and formatting
        const usageMetadata = geminiResponse.data.usageMetadata;
        let tokenUsage = null;
        
        if (usageMetadata) {
            console.log(`💰 Usage - Prompt tokens: ${usageMetadata.promptTokenCount}, Completion tokens: ${usageMetadata.candidatesTokenCount}, Total: ${usageMetadata.totalTokenCount}`);
            
            // ✅ Format token usage exactly as specified
            tokenUsage = {
                input_tokens: usageMetadata.promptTokenCount || 0,
                output_tokens: usageMetadata.candidatesTokenCount || 0,
                total_tokens: usageMetadata.totalTokenCount || 0,
                model: 'gemini-1.5-flash',
                timestamp: new Date().toISOString()
            };
        }
        
        // Parse JSON response
        let parsedData;
        try {
            parsedData = JSON.parse(rawResponse.trim());
        } catch (parseError) {
            console.error('❌ JSON parsing failed:', parseError);
            console.log('🔍 Raw response preview:', rawResponse.substring(0, 500) + '...');
            return {
                success: false,
                status: 502,
                userMessage: 'Failed to parse Gemini response as JSON',
                transient: true
            };
        }
        
        // Validate TIER 1 critical data
        const hasProfile = parsedData.profile && parsedData.profile.name;
        const hasExperience = parsedData.experience && Array.isArray(parsedData.experience) && parsedData.experience.length > 0;
        const hasEducation = parsedData.education && Array.isArray(parsedData.education) && parsedData.education.length > 0;
        const hasAwards = parsedData.awards && Array.isArray(parsedData.awards) && parsedData.awards.length > 0;
        const hasCertifications = parsedData.certifications && Array.isArray(parsedData.certifications) && parsedData.certifications.length > 0;
        
        // Validate TIER 2 data
        const hasVolunteer = parsedData.volunteer && Array.isArray(parsedData.volunteer) && parsedData.volunteer.length > 0;
        const hasFollowing = (parsedData.followingCompanies && parsedData.followingCompanies.length > 0) || 
                            (parsedData.followingPeople && parsedData.followingPeople.length > 0);
        const hasActivity = parsedData.activity && Array.isArray(parsedData.activity) && parsedData.activity.length > 0;
        
        console.log('✅ === GEMINI 1.5 FLASH - STAGE G COMPLETED ===');
        console.log(`📊 TIER 1 Extraction Results:`);
        console.log(`   🥇 Profile name: ${hasProfile ? 'YES' : 'NO'}`);
        console.log(`   🥇 Experience entries: ${parsedData.experience?.length || 0}`);
        console.log(`   🥇 Education entries: ${parsedData.education?.length || 0}`);
        console.log(`   🥇 Awards: ${parsedData.awards?.length || 0}`);
        console.log(`   🥇 Certifications: ${parsedData.certifications?.length || 0}`);
        console.log(`📊 TIER 2 Extraction Results:`);
        console.log(`   🥈 Volunteer experiences: ${parsedData.volunteer?.length || 0}`);
        console.log(`   🥈 Following companies: ${parsedData.followingCompanies?.length || 0}`);
        console.log(`   🥈 Following people: ${parsedData.followingPeople?.length || 0}`);
        console.log(`   🥈 Activity posts: ${parsedData.activity?.length || 0}`);
        console.log(`📊 Additional Data:`);
        console.log(`   - Skills count: ${parsedData.skills?.length || 0}`);
        console.log(`   - Input type: ${inputType}`);
        console.log(`   - Token usage: ${usageMetadata?.totalTokenCount || 'N/A'}`);
        
        // ✅ Return response with enhanced token tracking
        return {
            success: true,
            data: parsedData,
            metadata: {
                inputType: inputType,
                processingTime: Date.now(),
                hasProfile: hasProfile,
                hasExperience: hasExperience,
                hasEducation: hasEducation,
                hasAwards: hasAwards,
                hasCertifications: hasCertifications,
                hasVolunteer: hasVolunteer,
                hasFollowing: hasFollowing,
                hasActivity: hasActivity,
                tier1Complete: hasProfile && (hasExperience || hasEducation),
                tier2Complete: hasVolunteer || hasFollowing || hasActivity,
                dataQuality: (hasProfile && hasExperience) ? 'high' : 'medium',
                tokenUsage: usageMetadata
            },
            usage: tokenUsage // For orchestrator compatibility
        };
        
    } catch (error) {
        console.error('❌ === GEMINI 1.5 FLASH - STAGE G FAILED ===');
        console.error('📊 Error details:');
        console.error(`   - Message: ${error.message}`);
        console.error(`   - Status: ${error.response?.status || 'N/A'}`);
        console.error(`   - Type: ${error.name || 'Unknown'}`);
        
        // ✅ STAGE G: Return structured failures instead of throwing
        let userFriendlyMessage = 'Failed to process profile data';
        let isTransient = true;
        let errorStatus = 500;
        
        if (error.response?.status === 429) {
            userFriendlyMessage = 'Rate limit exceeded. Please wait a moment and try again.';
            errorStatus = 429;
            isTransient = true;
        } else if (error.response?.status === 400) {
            userFriendlyMessage = 'Invalid request format. Please try again.';
            errorStatus = 400;
            isTransient = false;
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            userFriendlyMessage = 'API authentication failed. Please check server configuration.';
            errorStatus = 401;
            isTransient = false;
        } else if (error.response?.status === 402) {
            userFriendlyMessage = 'API quota exceeded. Please contact support.';
            errorStatus = 402;
            isTransient = false;
        } else if (error.response?.status === 503) {
            userFriendlyMessage = 'Gemini is busy. Please try again shortly.';
            errorStatus = 503;
            isTransient = true;
        } else if (error.message.includes('timeout')) {
            userFriendlyMessage = 'Processing timeout. Please try again with a smaller profile.';
            errorStatus = 408;
            isTransient = true;
        } else if (error.message.includes('too large')) {
            userFriendlyMessage = 'Profile too large to process. Please try refreshing the page.';
            errorStatus = 413;
            isTransient = false;
        } else if (error.message.includes('JSON')) {
            userFriendlyMessage = 'Failed to parse AI response. Please try again.';
            errorStatus = 502;
            isTransient = true;
        }
        
        return {
            success: false,
            error: error.message,
            userMessage: userFriendlyMessage,
            status: errorStatus,
            transient: isTransient,
            details: {
                status: error.response?.status,
                type: error.name,
                timestamp: new Date().toISOString()
            },
            usage: null
        };
    }
}

module.exports = { sendToGemini };
