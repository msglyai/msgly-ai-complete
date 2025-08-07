// Enhanced sendToGemini.js - DOUBLED LIMITS + TIER 1/2 PRIORITIZED EXTRACTION
const axios = require('axios');

// ✅ Rate limiting configuration (Gemini is generous)
const RATE_LIMIT = {
    DELAY_BETWEEN_REQUESTS: 1000,    // 1 second between requests
    MAX_RETRIES: 3,                  // Maximum retry attempts
    RETRY_DELAY_BASE: 3000,          // Base delay for exponential backoff (3 seconds)
    MAX_RETRY_DELAY: 20000          // Maximum retry delay (20 seconds)
};

// 🚀 DOUBLED Gemini 1.5 Flash token limits for COMPLETE TIER 1/2 DATA EXTRACTION
const GEMINI_LIMITS = {
    MAX_TOKENS_INPUT: 50000,         // DOUBLED: 25000 → 50000 (allows larger LinkedIn profiles)
    MAX_TOKENS_OUTPUT: 8000,         // DOUBLED: 4000 → 8000 (CRITICAL for all TIER 1/2 data)
    MAX_SIZE_KB: 3000               // DOUBLED: 1500 → 3000 (less aggressive preprocessing)
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

// 🚀 ULTRA-AGGRESSIVE LinkedIn HTML Preprocessor - Updated for DOUBLED limits
function preprocessHTMLForGemini(html) {
    try {
        console.log(`🔄 Starting HTML preprocessing for TIER 1/2 extraction (size: ${(html.length / 1024).toFixed(2)} KB)`);
        
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
        
        // STAGE 7: Final size check with DOUBLED limits
        const currentSize = processedHtml.length;
        const estimatedTokens = Math.ceil(currentSize / 3); // Conservative estimate for HTML
        
        console.log(`📊 After processing: ${(currentSize / 1024).toFixed(2)} KB, ~${estimatedTokens} tokens`);
        
        // NUCLEAR FALLBACK: If still too large even with doubled limits
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
        
        console.log(`✅ HTML preprocessing completed for TIER 1/2 extraction:`);
        console.log(`   Original: ${(originalSize / 1024).toFixed(2)} KB`);
        console.log(`   Final: ${(finalSize / 1024).toFixed(2)} KB`);
        console.log(`   Reduction: ${reduction}%`);
        console.log(`   Estimated tokens: ~${finalTokens} (Max: ${GEMINI_LIMITS.MAX_TOKENS_INPUT})`);
        
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

// ✅ Main function to send data to Gemini 1.5 Flash with TIER 1/2 prioritization
async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        
        console.log('🤖 === GEMINI 1.5 FLASH - TIER 1/2 PRIORITIZED EXTRACTION START ===');
        
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
            
            // Check HTML size limits (DOUBLED now)
            const htmlSizeKB = inputData.html.length / 1024;
            if (htmlSizeKB > GEMINI_LIMITS.MAX_SIZE_KB) {
                throw new Error(`HTML too large: ${htmlSizeKB.toFixed(2)} KB (max: ${GEMINI_LIMITS.MAX_SIZE_KB} KB)`);
            }
            
            // Preprocess HTML for Gemini
            const preprocessedHtml = preprocessHTMLForGemini(inputData.html);
            
            // Estimate token count with improved estimation
            const estimatedTokens = estimateTokenCount(preprocessedHtml);
            console.log(`🔢 Estimated tokens: ${estimatedTokens} (Max input: ${GEMINI_LIMITS.MAX_TOKENS_INPUT})`);
            
            if (estimatedTokens > GEMINI_LIMITS.MAX_TOKENS_INPUT) {
                throw new Error(`Content too large: ~${estimatedTokens} tokens (max: ${GEMINI_LIMITS.MAX_TOKENS_INPUT})`);
            }
            
            processedData = {
                html: preprocessedHtml,
                url: inputData.url || inputData.profileUrl,
                isUserProfile: inputData.isUserProfile || false,
                optimization: inputData.optimization || {}
            };
            
            // ✅ TIER 1/2 PRIORITIZED System prompt for Gemini
            systemPrompt = `You are a LinkedIn profile data extraction expert. Your task is to analyze HTML content and extract comprehensive LinkedIn profile information into valid JSON format.

CRITICAL EXTRACTION PRIORITY:
🥇 TIER 1 (HIGHEST PRIORITY - Extract first):
- Basic profile info: name, headline, currentRole, currentCompany, location, about
- Experience/work history: ALL job entries with titles, companies, durations, descriptions
- Education: ALL education entries with schools, degrees, fields, years, grades, activities  
- Awards: ALL awards with titles, issuers, dates, descriptions

🥈 TIER 2 (SECONDARY PRIORITY - Extract after TIER 1):
- Volunteer work: organizations, roles
- Following data: companies followed, people followed
- Activity content: recent posts and content
- Social metrics: followers, connections, mutual connections

CRITICAL REQUIREMENTS:
1. PRIORITIZE TIER 1 DATA - Extract completely before moving to TIER 2
2. Return ONLY valid JSON - no markdown, no explanations, no comments
3. Use the exact JSON structure provided below
4. Extract all available text content, ignore styling and layout elements
5. If a section is empty, use empty array [] or empty string ""
6. For arrays, extract EVERY item found - don't truncate due to length
7. DOUBLED output token limit allows for complete data extraction`;

            // ✅ TIER 1/2 PRIORITIZED User prompt with ENHANCED structure
            userPrompt = `Extract comprehensive LinkedIn profile data from this HTML. PRIORITIZE TIER 1 fields first, then TIER 2. Return as JSON with this EXACT structure:

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
      "description": "Job description and achievements"
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
  "certifications": [
    {
      "name": "Certification Name",
      "issuer": "Issuing Organization",
      "date": "Issue Date",
      "url": "Certificate URL if available"
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
- TIER 1 fields must be extracted completely first (profile, experience, education, awards)
- For experience: Extract EVERY job, with company URLs when available
- For education: Include grades, activities, descriptions when present
- For awards: Extract ALL awards with full details
- TIER 2 fields: Extract volunteer work, following data, activity content
- Look for numbers, engagement metrics, follower counts throughout HTML
- Extract as much detail as possible with doubled token limits
- Don't truncate arrays - extract all items found

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
1. TIER 1 data is HIGHEST PRIORITY (profile, experience, education, awards)
2. TIER 2 data is SECONDARY (volunteer, following, activity, social metrics)  
3. Return ONLY valid JSON - no markdown, no explanations
4. Use the exact structure provided
5. Extract engagement metrics and activity data`;

            userPrompt = `Extract comprehensive LinkedIn profile data from this JSON with TIER 1/2 prioritization and return as structured JSON with the same format as specified above:

${JSON.stringify(jsonData, null, 2)}`;
            
        } else {
            throw new Error('Invalid input data: must contain either "html" or "data" property');
        }
        
        console.log(`🎯 Processing ${inputType} with TIER 1/2 prioritization...`);
        console.log(`📝 Total prompt length: ${(systemPrompt + userPrompt).length} characters`);
        
        // Enforce rate limiting
        await enforceRateLimit();
        
        // Make request to Gemini with retry logic
        const geminiResponse = await retryWithBackoff(async () => {
            console.log('📤 Sending TIER 1/2 prioritized request to Gemini 1.5 Flash API...');
            
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
                        maxOutputTokens: GEMINI_LIMITS.MAX_TOKENS_OUTPUT,  // DOUBLED: 4000 → 8000
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
        
        // Validate TIER 1 critical data
        const hasProfile = parsedData.profile && parsedData.profile.name;
        const hasExperience = parsedData.experience && Array.isArray(parsedData.experience) && parsedData.experience.length > 0;
        const hasEducation = parsedData.education && Array.isArray(parsedData.education) && parsedData.education.length > 0;
        const hasAwards = parsedData.awards && Array.isArray(parsedData.awards) && parsedData.awards.length > 0;
        
        // Validate TIER 2 data
        const hasVolunteer = parsedData.volunteer && Array.isArray(parsedData.volunteer) && parsedData.volunteer.length > 0;
        const hasFollowing = (parsedData.followingCompanies && parsedData.followingCompanies.length > 0) || 
                            (parsedData.followingPeople && parsedData.followingPeople.length > 0);
        const hasActivity = parsedData.activity && Array.isArray(parsedData.activity) && parsedData.activity.length > 0;
        
        console.log('✅ === GEMINI 1.5 FLASH - TIER 1/2 EXTRACTION COMPLETED ===');
        console.log(`📊 TIER 1 Extraction Results:`);
        console.log(`   🥇 Profile name: ${hasProfile ? 'YES' : 'NO'}`);
        console.log(`   🥇 Experience entries: ${parsedData.experience?.length || 0}`);
        console.log(`   🥇 Education entries: ${parsedData.education?.length || 0}`);
        console.log(`   🥇 Awards: ${parsedData.awards?.length || 0}`);
        console.log(`📊 TIER 2 Extraction Results:`);
        console.log(`   🥈 Volunteer experiences: ${parsedData.volunteer?.length || 0}`);
        console.log(`   🥈 Following companies: ${parsedData.followingCompanies?.length || 0}`);
        console.log(`   🥈 Following people: ${parsedData.followingPeople?.length || 0}`);
        console.log(`   🥈 Activity posts: ${parsedData.activity?.length || 0}`);
        console.log(`📊 Additional Data:`);
        console.log(`   - Skills count: ${parsedData.skills?.length || 0}`);
        console.log(`   - Certifications: ${parsedData.certifications?.length || 0}`);
        console.log(`   - Input type: ${inputType}`);
        console.log(`   - Token usage: ${usageMetadata?.totalTokenCount || 'N/A'}`);
        console.log(`   - Max output tokens used: ${GEMINI_LIMITS.MAX_TOKENS_OUTPUT}`);
        
        if (!hasExperience && !hasEducation) {
            console.warn('⚠️ WARNING: No TIER 1 experience or education data extracted - this may affect feature unlock');
        }
        
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
                hasVolunteer: hasVolunteer,
                hasFollowing: hasFollowing,
                hasActivity: hasActivity,
                tier1Complete: hasProfile && (hasExperience || hasEducation),
                tier2Complete: hasVolunteer || hasFollowing || hasActivity,
                dataQuality: (hasProfile && hasExperience) ? 'high' : 'medium',
                tokenUsage: usageMetadata,
                limitsUsed: {
                    maxInputTokens: GEMINI_LIMITS.MAX_TOKENS_INPUT,
                    maxOutputTokens: GEMINI_LIMITS.MAX_TOKENS_OUTPUT,
                    maxSizeKB: GEMINI_LIMITS.MAX_SIZE_KB
                }
            }
        };
        
    } catch (error) {
        console.error('❌ === GEMINI 1.5 FLASH - TIER 1/2 EXTRACTION FAILED ===');
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
            userFriendlyMessage = 'Profile too large to process even with doubled limits. Please try refreshing the page.';
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
                timestamp: new Date().toISOString(),
                limitsUsed: {
                    maxInputTokens: GEMINI_LIMITS.MAX_TOKENS_INPUT,
                    maxOutputTokens: GEMINI_LIMITS.MAX_TOKENS_OUTPUT,
                    maxSizeKB: GEMINI_LIMITS.MAX_SIZE_KB
                }
            }
        };
    }
}

module.exports = { sendToGemini };
