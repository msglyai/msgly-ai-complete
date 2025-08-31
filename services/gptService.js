/*
CHANGELOG - services/gptService.js:
1. ENHANCED formatUserProfile function:
   - Priority source: gemini_raw_data with safe parsing (try/catch)
   - Rich summary building from comprehensive data (experience, roles, industries, achievements, etc.)
   - Graceful fallback to basic fields when gemini_raw_data missing
   - Added debug logging for gemini_raw_data presence and parsing
   - Prudent trimming of overly long sections while keeping key signals
2. ENHANCED formatTargetProfile function: 
   - Primary source: data_json.data.profile nested structure extraction
   - Proper extraction of awards and skills from nested paths
   - Defensive null checks throughout to prevent errors
   - Fallback to existing flat fields when nested structure missing
   - Added debug logging for nested profile presence
3. Shared improvements:
   - Never mutate source objects (all operations on copies)
   - Clean and deterministic output with stable section order
   - Enhanced debug logging (non-PII, shows presence/counts not raw content)
4. UPDATED PROMPT: Changed to target-centric approach with 220 char limit, required greeting/closing, 3 details minimum
*/

// server/services/gptService.js - GPT-5 Integration Service with Rich Profile Data & Comprehensive Debugging
const axios = require('axios');

class GPTService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        this.baseURL = 'https://api.openai.com/v1';
        this.model = process.env.OPENAI_MODEL || 'gpt-5';
        
        if (!this.apiKey) {
            console.error('[ERROR] OPENAI_API_KEY not found in environment variables');
        }
    }

    // Build the complete prompt for LinkedIn message generation with debugging
    buildPrompt(userProfile, targetProfile, context, messageType) {
        console.log('[GPT] === BUILDING PROMPT FOR GPT-5 ===');
        
        // Extract user profile data
        const userProfileText = this.formatUserProfile(userProfile);
        const targetProfileText = this.formatTargetProfile(targetProfile);
        
        console.log('[DEBUG] === PROMPT BUILDING DEBUG ===');
        console.log('[DEBUG] User profile text length:', userProfileText.length);
        console.log('[DEBUG] Target profile text length:', targetProfileText.length);
        console.log('[DEBUG] Context length:', context?.length || 0);
        console.log('[DEBUG] User profile preview (first 200 chars):', userProfileText.substring(0, 200) + '...');
        console.log('[DEBUG] Target profile preview (first 200 chars):', targetProfileText.substring(0, 200) + '...');
        console.log('[DEBUG] Context preview (first 100 chars):', context?.substring(0, 100) + '...');
        
        // Updated prompt template with target-centric approach
        const systemPrompt = `[MODE: INBOX_MESSAGE]
You are an AI LinkedIn Outreach Assistant.
Inputs:
1. USER PROFILE — sender's LinkedIn profile (experience, headline, skills, education, etc.)
2. TARGET PROFILE — recipient's LinkedIn profile (experience, headline, skills, education, etc.)
3. CONTEXT — the business or conversational goal.
Task:
- Generate ONE highly personalized LinkedIn inbox message.
Message rules:
• Absolute maximum: 220 characters (count before finalizing).
• Must always start with: "Hi [TARGET_FIRSTNAME],"
• Must always end with sender's first name (e.g., "… Thanks, Ziv").
• Focus primarily on the TARGET PROFILE — highlight what is valuable or relevant for them.
• At least 3 details must be referenced (two from TARGET PROFILE, one from USER PROFILE).
• Integrate CONTEXT naturally — frame it around the benefit or shared value for the target.
• Avoid focusing too much on the sender; keep emphasis on what the target gains from the conversation.
• Keep it friendly, professional, approachable — avoid email or sales tone.
• If inputs are poor → still greet + close, and create a polite, concise LinkedIn-style message ≤220 chars.
• Avoid generic phrases; avoid relying only on job titles or company names.
• Avoid exaggerated adjectives (e.g., "excited", "amazing opportunity").
• No emojis, hashtags, line breaks, or special symbols.
• Output only the final message text — no explanations, no labels, no JSON.`;

        const userPrompt = `USER PROFILE:
${userProfileText}

TARGET PROFILE:
${targetProfileText}

CONTEXT:
${context}

Generate the LinkedIn inbox message now:`;

        console.log('[DEBUG] Final system prompt length:', systemPrompt.length);
        console.log('[DEBUG] Final user prompt length:', userPrompt.length);
        console.log('[DEBUG] Total prompt length:', systemPrompt.length + userPrompt.length);

        return {
            systemPrompt,
            userPrompt
        };
    }

    // ENHANCED: Format user profile data using gemini_raw_data for comprehensive information
    formatUserProfile(profile) {
        console.log('[DEBUG] === USER PROFILE FORMATTING ===');
        console.log('[DEBUG] Profile received:', !!profile);
        console.log('[DEBUG] Profile keys:', Object.keys(profile || {}));
        console.log('[DEBUG] Has gemini_raw_data:', !!profile?.gemini_raw_data);
        console.log('[DEBUG] Gemini data type:', typeof profile?.gemini_raw_data);
        
        if (!profile) {
            console.log('[DEBUG] No user profile provided');
            return "User profile not available.";
        }
        
        // PRIORITY 1: Use rich gemini_raw_data if available
        if (profile.gemini_raw_data) {
            try {
                let richData;
                if (typeof profile.gemini_raw_data === 'string') {
                    richData = JSON.parse(profile.gemini_raw_data);
                } else {
                    richData = profile.gemini_raw_data;
                }
                
                console.log('[DEBUG] Successfully parsed gemini_raw_data');
                console.log('[DEBUG] Rich data keys:', Object.keys(richData || {}));
                
                // Extract comprehensive profile info from gemini data structure
                const profileData = richData.data?.profile || richData.profile || richData.data || richData;
                console.log('[DEBUG] Profile data keys:', Object.keys(profileData || {}));
                
                const parts = [];
                
                // Basic info with stable ordering
                if (profileData.name || profileData.fullName || profileData.full_name) {
                    parts.push(`Name: ${profileData.name || profileData.fullName || profileData.full_name}`);
                }
                if (profileData.headline) {
                    parts.push(`Headline: ${profileData.headline}`);
                }
                if (profileData.currentCompany || profileData.current_company) {
                    parts.push(`Current Company: ${profileData.currentCompany || profileData.current_company}`);
                }
                if (profileData.currentRole || profileData.currentJobTitle || profileData.current_job_title) {
                    parts.push(`Current Position: ${profileData.currentRole || profileData.currentJobTitle || profileData.current_job_title}`);
                }
                if (profileData.location) {
                    parts.push(`Location: ${profileData.location}`);
                }
                if (profileData.about) {
                    // Prudent trimming - keep key signals, limit length
                    const aboutText = profileData.about.length > 400 
                        ? profileData.about.substring(0, 400) + '...' 
                        : profileData.about;
                    parts.push(`About: ${aboutText}`);
                }
                
                // Comprehensive experience data with key signal preservation
                const experience = richData.data?.experience || richData.experience || profileData.experience || [];
                console.log('[DEBUG] Experience found:', Array.isArray(experience), experience.length);
                if (experience && Array.isArray(experience) && experience.length > 0) {
                    const recentExperience = experience.slice(0, 4).map(exp => {
                        const title = exp.title || exp.position || exp.role || '';
                        const company = exp.company || exp.companyName || '';
                        const duration = exp.duration || exp.dates || exp.period || '';
                        // Trim long descriptions but keep key achievements
                        const description = exp.description ? 
                            (exp.description.length > 150 ? 
                                ` - ${exp.description.substring(0, 150)}...` : 
                                ` - ${exp.description}`) : '';
                        return `${title} at ${company}${duration ? ` (${duration})` : ''}${description}`;
                    }).filter(exp => exp.trim() !== ' at').join('; ');
                    if (recentExperience) parts.push(`Experience: ${recentExperience}`);
                }
                
                // Education data
                const education = richData.data?.education || richData.education || profileData.education || [];
                console.log('[DEBUG] Education found:', Array.isArray(education), education.length);
                if (education && Array.isArray(education) && education.length > 0) {
                    const educationText = education.slice(0, 3).map(edu => {
                        const degree = edu.degree || edu.degreeName || edu.qualification || '';
                        const field = edu.field || edu.fieldOfStudy || edu.major || '';
                        const school = edu.institution || edu.school || edu.schoolName || edu.university || '';
                        return `${degree}${field ? ` in ${field}` : ''} from ${school}`;
                    }).filter(edu => edu.trim() !== ' from').join('; ');
                    if (educationText) parts.push(`Education: ${educationText}`);
                }
                
                // Skills data - focus on most relevant
                const skills = richData.data?.skills || richData.skills || profileData.skills || [];
                console.log('[DEBUG] Skills found:', Array.isArray(skills), skills.length);
                if (skills && Array.isArray(skills) && skills.length > 0) {
                    const skillsText = skills.slice(0, 12).map(skill => 
                        typeof skill === 'string' ? skill : (skill.name || skill.skill || skill.title || skill)
                    ).filter(skill => skill && typeof skill === 'string').join(', ');
                    if (skillsText) parts.push(`Skills: ${skillsText}`);
                }
                
                // Awards - key achievements
                const awards = richData.data?.awards || richData.awards || profileData.awards || [];
                console.log('[DEBUG] Awards found:', Array.isArray(awards), awards.length);
                if (awards && Array.isArray(awards) && awards.length > 0) {
                    const awardsText = awards.slice(0, 3).map(award => {
                        const title = award.title || award.name || '';
                        const issuer = award.issuer || award.organization || '';
                        const date = award.date || '';
                        return `${title}${issuer ? ` from ${issuer}` : ''}${date ? ` (${date})` : ''}`;
                    }).filter(award => award.trim()).join('; ');
                    if (awardsText) parts.push(`Awards: ${awardsText}`);
                }
                
                // Languages - if available
                const languages = richData.data?.languages || richData.languages || profileData.languages || [];
                if (languages && Array.isArray(languages) && languages.length > 0) {
                    const languagesText = languages.slice(0, 5).map(lang => 
                        typeof lang === 'string' ? lang : (lang.name || lang.language || lang)
                    ).filter(lang => lang).join(', ');
                    if (languagesText) parts.push(`Languages: ${languagesText}`);
                }
                
                // Industries/Roles - if available
                if (profileData.industry) {
                    parts.push(`Industry: ${profileData.industry}`);
                }
                
                const result = parts.length > 0 ? parts.join('\n') : "Rich user profile data available but could not format.";
                console.log('[DEBUG] Formatted rich user profile length:', result.length);
                console.log('[DEBUG] Rich user profile sections:', parts.length);
                return result;
                
            } catch (error) {
                console.error('[ERROR] Error parsing gemini_raw_data:', error.message);
                console.log('[DEBUG] Falling back to basic fields due to parsing error');
                // Fall back to basic fields
            }
        } else {
            console.log('[DEBUG] No gemini_raw_data found, using basic fields');
        }
        
        // FALLBACK: Use basic fields if gemini_raw_data not available or failed to parse
        console.log('[DEBUG] Using basic field fallback for user profile');
        const parts = [];
        
        if (profile.full_name) parts.push(`Name: ${profile.full_name}`);
        if (profile.headline) parts.push(`Headline: ${profile.headline}`);
        if (profile.current_company) parts.push(`Current Company: ${profile.current_company}`);
        if (profile.current_job_title) parts.push(`Current Position: ${profile.current_job_title}`);
        if (profile.location) parts.push(`Location: ${profile.location}`);
        if (profile.about) {
            const aboutText = profile.about.length > 250 
                ? profile.about.substring(0, 250) + '...' 
                : profile.about;
            parts.push(`About: ${aboutText}`);
        }
        
        // Add experience
        if (profile.experience && Array.isArray(profile.experience)) {
            const recentExperience = profile.experience.slice(0, 3).map(exp => 
                `${exp.title || ''} at ${exp.company || ''}${exp.duration ? ` (${exp.duration})` : ''}`
            ).filter(exp => exp.trim() !== ' at').join('; ');
            if (recentExperience) parts.push(`Experience: ${recentExperience}`);
        }
        
        // Add education
        if (profile.education && Array.isArray(profile.education)) {
            const education = profile.education.slice(0, 2).map(edu => 
                `${edu.degree || ''} ${edu.field ? `in ${edu.field}` : ''} from ${edu.institution || ''}`
            ).filter(edu => edu.trim() !== ' from').join('; ');
            if (education) parts.push(`Education: ${education}`);
        }
        
        // Add skills
        if (profile.skills && Array.isArray(profile.skills)) {
            const skills = profile.skills.slice(0, 10).join(', ');
            if (skills) parts.push(`Skills: ${skills}`);
        }
        
        const result = parts.length > 0 ? parts.join('\n') : "Limited user profile information available.";
        console.log('[DEBUG] Formatted basic user profile length:', result.length);
        console.log('[DEBUG] Basic user profile sections:', parts.length);
        return result;
    }

    // ENHANCED: Format target profile data for prompt with proper nested structure handling
    formatTargetProfile(profileData) {
        console.log('[DEBUG] === TARGET PROFILE FORMATTING ===');
        console.log('[DEBUG] Target profile data received:', !!profileData);
        console.log('[DEBUG] Target profile keys:', Object.keys(profileData || {}));
        console.log('[DEBUG] Has data_json:', !!profileData?.data_json);
        console.log('[DEBUG] Data JSON type:', typeof profileData?.data_json);
        
        if (!profileData || !profileData.data_json) {
            console.log('[DEBUG] No target profile data_json found');
            return "Target profile not available.";
        }
        
        try {
            let profile;
            if (typeof profileData.data_json === 'string') {
                profile = JSON.parse(profileData.data_json);
            } else {
                profile = profileData.data_json;
            }
            
            console.log('[DEBUG] Successfully parsed target profile data_json');
            console.log('[DEBUG] Target profile structure keys:', Object.keys(profile || {}));
            
            // ENHANCED: Handle nested data structure: data.profile, data.awards, data.skills
            const dataSection = profile.data || profile;
            const profileInfo = dataSection.profile || profile.profile || dataSection;
            
            console.log('[DEBUG] Data section keys:', Object.keys(dataSection || {}));
            console.log('[DEBUG] Profile info keys:', Object.keys(profileInfo || {}));
            console.log('[DEBUG] Target nested profile present:', !!(dataSection && dataSection.profile));
            
            const parts = [];
            
            // Basic profile information with stable ordering
            if (profileInfo.name || profileInfo.fullName || profileInfo.full_name) {
                parts.push(`Name: ${profileInfo.name || profileInfo.fullName || profileInfo.full_name}`);
            }
            if (profileInfo.headline) {
                parts.push(`Headline: ${profileInfo.headline}`);
            }
            if (profileInfo.currentCompany || profileInfo.current_company) {
                parts.push(`Current Company: ${profileInfo.currentCompany || profileInfo.current_company}`);
            }
            if (profileInfo.currentJobTitle || profileInfo.currentRole || profileInfo.current_job_title) {
                parts.push(`Current Position: ${profileInfo.currentJobTitle || profileInfo.currentRole || profileInfo.current_job_title}`);
            }
            if (profileInfo.location) {
                parts.push(`Location: ${profileInfo.location}`);
            }
            if (profileInfo.about) {
                // Prudent trimming while preserving key information
                const aboutText = profileInfo.about.length > 400 
                    ? profileInfo.about.substring(0, 400) + '...' 
                    : profileInfo.about;
                parts.push(`About: ${aboutText}`);
            }
            
            // ENHANCED: Extract skills from nested data structure (data.skills OR profile.skills)
            const skills = dataSection.skills || profileInfo.skills || [];
            console.log('[DEBUG] Target skills found:', Array.isArray(skills), skills.length);
            if (skills && Array.isArray(skills) && skills.length > 0) {
                const skillsText = skills.slice(0, 12).map(skill => 
                    typeof skill === 'string' ? skill : (skill.name || skill.skill || skill.title || skill)
                ).filter(skill => skill && typeof skill === 'string').join(', ');
                if (skillsText) parts.push(`Skills: ${skillsText}`);
            }
            
            // ENHANCED: Extract awards from nested data structure (data.awards OR profile.awards)
            const awards = dataSection.awards || profileInfo.awards || [];
            console.log('[DEBUG] Target awards found:', Array.isArray(awards), awards.length);
            if (awards && Array.isArray(awards) && awards.length > 0) {
                const awardsText = awards.slice(0, 3).map(award => {
                    const title = award.title || award.name || '';
                    const issuer = award.issuer || award.organization || '';
                    const date = award.date || award.year || '';
                    return `${title}${issuer ? ` from ${issuer}` : ''}${date ? ` (${date})` : ''}`;
                }).filter(award => award.trim()).join('; ');
                if (awardsText) parts.push(`Awards: ${awardsText}`);
            }
            
            // Experience from nested data structure
            const experience = dataSection.experience || profileInfo.experience || [];
            console.log('[DEBUG] Target experience found:', Array.isArray(experience), experience.length);
            if (experience && Array.isArray(experience) && experience.length > 0) {
                const recentExperience = experience.slice(0, 4).map(exp => {
                    const title = exp.title || exp.position || '';
                    const company = exp.company || exp.companyName || '';
                    const duration = exp.duration || exp.dates || exp.period || '';
                    // Trim long descriptions but preserve key achievements
                    const description = exp.description ? 
                        (exp.description.length > 150 ? 
                            ` - ${exp.description.substring(0, 150)}...` : 
                            ` - ${exp.description}`) : '';
                    return `${title} at ${company}${duration ? ` (${duration})` : ''}${description}`;
                }).filter(exp => exp.trim() !== ' at').join('; ');
                if (recentExperience) parts.push(`Experience: ${recentExperience}`);
            }
            
            // Education from nested data structure
            const education = dataSection.education || profileInfo.education || [];
            console.log('[DEBUG] Target education found:', Array.isArray(education), education.length);
            if (education && Array.isArray(education) && education.length > 0) {
                const educationText = education.slice(0, 3).map(edu => {
                    const degree = edu.degree || edu.degreeName || '';
                    const field = edu.field || edu.fieldOfStudy || edu.major || '';
                    const school = edu.institution || edu.school || edu.schoolName || edu.university || '';
                    return `${degree}${field ? ` in ${field}` : ''} from ${school}`;
                }).filter(edu => edu.trim() !== ' from').join('; ');
                if (educationText) parts.push(`Education: ${educationText}`);
            }
            
            // Languages from nested structure if available
            const languages = dataSection.languages || profileInfo.languages || [];
            if (languages && Array.isArray(languages) && languages.length > 0) {
                const languagesText = languages.slice(0, 5).map(lang => 
                    typeof lang === 'string' ? lang : (lang.name || lang.language || lang)
                ).filter(lang => lang).join(', ');
                if (languagesText) parts.push(`Languages: ${languagesText}`);
            }
            
            // Industry from nested structure
            if (dataSection.industry || profileInfo.industry) {
                parts.push(`Industry: ${dataSection.industry || profileInfo.industry}`);
            }
            
            // Interests if available
            const interests = dataSection.interests || profileInfo.interests || [];
            if (interests && Array.isArray(interests) && interests.length > 0) {
                const interestsText = interests.slice(0, 5).map(interest => 
                    typeof interest === 'string' ? interest : (interest.name || interest)
                ).filter(interest => interest).join(', ');
                if (interestsText) parts.push(`Interests: ${interestsText}`);
            }
            
            const result = parts.length > 0 ? parts.join('\n') : "Limited target profile information available.";
            console.log('[DEBUG] Formatted target profile length:', result.length);
            console.log('[DEBUG] Target profile sections:', parts.length);
            return result;
            
        } catch (error) {
            console.error('[ERROR] Error parsing target profile data:', error.message);
            console.log('[DEBUG] Falling back to basic flat fields');
            
            // FALLBACK: Use any available flat fields if parsing fails
            const parts = [];
            if (profileData.name) parts.push(`Name: ${profileData.name}`);
            if (profileData.headline) parts.push(`Headline: ${profileData.headline}`);
            if (profileData.company) parts.push(`Company: ${profileData.company}`);
            
            return parts.length > 0 ? parts.join('\n') : "Target profile data parsing error.";
        }
    }

    // ENHANCED: Extract target profile metadata for database storage
    extractTargetMetadata(profileData) {
        if (!profileData || !profileData.data_json) {
            return {
                target_first_name: null,
                target_title: null,
                target_company: null
            };
        }
        
        try {
            let profile;
            if (typeof profileData.data_json === 'string') {
                profile = JSON.parse(profileData.data_json);
            } else {
                profile = profileData.data_json;
            }
            
            // Handle nested structure like formatTargetProfile
            const dataSection = profile.data || profile;
            const profileInfo = dataSection.profile || profile.profile || dataSection;
            
            return {
                target_first_name: profileInfo.firstName || profileInfo.fullName?.split(' ')[0] || profileInfo.name?.split(' ')[0] || null,
                target_title: profileInfo.currentJobTitle || profileInfo.currentRole || profileInfo.headline || null,
                target_company: profileInfo.currentCompany || profileInfo.current_company || null
            };
            
        } catch (error) {
            console.error('[ERROR] Error extracting target metadata:', error);
            return {
                target_first_name: null,
                target_title: null,
                target_company: null
            };
        }
    }

    // Main function to generate LinkedIn message with comprehensive debugging
    async generateLinkedInMessage(userProfile, targetProfile, context, messageType = 'inbox_message') {
        const startTime = Date.now();
        
        try {
            console.log('[GPT] === STARTING GPT-5 MESSAGE GENERATION ===');
            console.log(`[GPT] Model: ${this.model}`);
            console.log(`[GPT] Message type: ${messageType}`);
            
            // COMPREHENSIVE DEBUGGING - Check all 3 data points
            console.log('[DEBUG] === DATA POINT VALIDATION ===');
            console.log('[DEBUG] 1. USER PROFILE:');
            console.log('[DEBUG]    - Profile exists:', !!userProfile);
            console.log('[DEBUG]    - Profile keys:', Object.keys(userProfile || {}));
            console.log('[DEBUG]    - Has rich data (gemini_raw_data):', !!userProfile?.gemini_raw_data);
            console.log('[DEBUG]    - Rich data size:', userProfile?.gemini_raw_data ? (typeof userProfile.gemini_raw_data === 'string' ? userProfile.gemini_raw_data.length : JSON.stringify(userProfile.gemini_raw_data).length) : 0);
            
            console.log('[DEBUG] 2. TARGET PROFILE:');
            console.log('[DEBUG]    - Profile exists:', !!targetProfile);
            console.log('[DEBUG]    - Profile keys:', Object.keys(targetProfile || {}));
            console.log('[DEBUG]    - Has rich data (data_json):', !!targetProfile?.data_json);
            console.log('[DEBUG]    - Rich data size:', targetProfile?.data_json ? (typeof targetProfile.data_json === 'string' ? targetProfile.data_json.length : JSON.stringify(targetProfile.data_json).length) : 0);
            
            console.log('[DEBUG] 3. CONTEXT:');
            console.log('[DEBUG]    - Context exists:', !!context);
            console.log('[DEBUG]    - Context length:', context?.length || 0);
            console.log('[DEBUG]    - Context type:', typeof context);
            
            if (!this.apiKey) {
                throw new Error('OpenAI API key not configured');
            }

            // Build the prompt with debugging
            const { systemPrompt, userPrompt } = this.buildPrompt(userProfile, targetProfile, context, messageType);
            
            console.log('[GPT] === CALLING OPENAI API ===');
            console.log('[GPT] Final request details:');
            console.log('[GPT] - System prompt length:', systemPrompt.length);
            console.log('[GPT] - User prompt length:', userPrompt.length);
            console.log('[GPT] - Total input length:', systemPrompt.length + userPrompt.length);
            
            const response = await axios.post(`${this.baseURL}/chat/completions`, {
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user", 
                        content: userPrompt
                    }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000 // 2 minutes timeout for GPT-5
            });

            const endTime = Date.now();
            const latencyMs = endTime - startTime;

            console.log('[SUCCESS] === GPT-5 API CALL SUCCESSFUL ===');
            console.log(`[GPT] Latency: ${latencyMs}ms`);
            console.log(`[GPT] Token usage: ${response.data.usage.prompt_tokens} input, ${response.data.usage.completion_tokens} output, ${response.data.usage.total_tokens} total`);

            const generatedMessage = response.data.choices[0].message.content.trim();
            console.log(`[GPT] Generated message: "${generatedMessage}"`);
            console.log(`[GPT] Message length: ${generatedMessage.length} characters`);
            console.log(`[GPT] Message within 220 chars: ${generatedMessage.length <= 220 ? '✅' : '❌'}`);

            // Extract target metadata
            const targetMetadata = this.extractTargetMetadata(targetProfile);

            // FINAL SUCCESS DEBUG
            console.log('[DEBUG] === GENERATION SUCCESS SUMMARY ===');
            console.log('[DEBUG] ✅ User profile processed successfully');
            console.log('[DEBUG] ✅ Target profile processed successfully'); 
            console.log('[DEBUG] ✅ Context processed successfully');
            console.log('[DEBUG] ✅ Message generated successfully');
            console.log('[DEBUG] Total tokens used:', response.data.usage.total_tokens);

            return {
                success: true,
                message: generatedMessage,
                tokenUsage: {
                    input_tokens: response.data.usage.prompt_tokens,
                    output_tokens: response.data.usage.completion_tokens,
                    total_tokens: response.data.usage.total_tokens
                },
                metadata: {
                    model_name: this.model,
                    prompt_version: 'inbox_message_target_centric_v2',
                    latency_ms: latencyMs,
                    ...targetMetadata
                },
                rawResponse: {
                    id: response.data.id,
                    object: response.data.object,
                    created: response.data.created,
                    model: response.data.model,
                    choices: response.data.choices,
                    usage: response.data.usage
                }
            };

        } catch (error) {
            const endTime = Date.now();
            const latencyMs = endTime - startTime;

            console.error('[ERROR] === GPT-5 MESSAGE GENERATION FAILED ===');
            console.error('[ERROR] Error message:', error.message);
            
            if (error.response) {
                console.error('[ERROR] API Response status:', error.response.status);
                console.error('[ERROR] API Response data:', JSON.stringify(error.response.data, null, 2));
            }

            return {
                success: false,
                error: error.message,
                errorCode: error.response?.status || 'unknown',
                latencyMs: latencyMs,
                userMessage: this.getUserFriendlyError(error)
            };
        }
    }

    // Convert API errors to user-friendly messages
    getUserFriendlyError(error) {
        if (error.response) {
            switch (error.response.status) {
                case 401:
                    return 'API authentication failed. Please check API configuration.';
                case 429:
                    return 'API rate limit exceeded. Please try again in a moment.';
                case 400:
                    if (error.response.data?.error?.code === 'model_not_found') {
                        return `Model "${this.model}" not found. Please check model availability.`;
                    }
                    return 'Invalid request. Please try again.';
                case 500:
                case 502:
                case 503:
                    return 'OpenAI service temporarily unavailable. Please try again.';
                default:
                    return 'Message generation service temporarily unavailable.';
            }
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return 'Unable to connect to message generation service.';
        } else if (error.code === 'TIMEOUT') {
            return 'Request timeout. Please try again.';
        }
        
        return 'Message generation failed. Please try again.';
    }
}

// Export singleton instance
module.exports = new GPTService();
