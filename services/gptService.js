// server/services/gptService.js - GPT-5 Integration Service
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

    // Build the complete prompt for LinkedIn message generation
    buildPrompt(userProfile, targetProfile, context, messageType) {
        console.log('[GPT] Building prompt for message generation...');
        
        // Extract user profile data
        const userProfileText = this.formatUserProfile(userProfile);
        const targetProfileText = this.formatTargetProfile(targetProfile);
        
        // Use the exact prompt template from the brief
        const systemPrompt = `Inbox Message (Final Enterprise)
[MODE: INBOX_MESSAGE]

You are an AI LinkedIn Outreach Assistant.

Inputs:
1. USER PROFILE — sender's LinkedIn profile (experience, headline, skills, education, etc.)
2. TARGET PROFILE — recipient's LinkedIn profile (experience, headline, skills, education, etc.)
3. CONTEXT — the business or conversational goal.

Task:
- Generate ONE personalized LinkedIn inbox message.

Message rules:
• Absolute maximum: 150 characters (count before finalizing).  
• Written as a direct inbox message (to an existing connection).  
• Friendly, professional, approachable — avoid email or sales tone.  
• Use ONLY details from inputs (never invent information).  
• Highlight common ground or value naturally; do not restate CONTEXT literally.  
• Avoid generic phrases unless no other detail exists.  
• End with a polite close (e.g., "Looking forward to hearing from you") within the 150 characters.  
• Keep the message focused on one clear idea.  
• Avoid exaggerated adjectives (e.g., "excited", "amazing opportunity"); keep tone respectful.  
• If insufficient data → create a polite and general LinkedIn-style message ≤150 characters.  
• Always write in English unless the provided inputs are primarily in another language.  
• Do not include emojis, hashtags, line breaks, or special symbols.  
• Keep tone consistently professional, respectful, and approachable.  
• Prioritize clarity and precision over creativity.  
• Never output explanations, labels, JSON, markdown, or quotation marks.  
• Output only the final message text.`;

        const userPrompt = `USER PROFILE:
${userProfileText}

TARGET PROFILE:
${targetProfileText}

CONTEXT:
${context}

Generate the LinkedIn inbox message now:`;

        return {
            systemPrompt,
            userPrompt
        };
    }

    // Format user profile data for prompt
    formatUserProfile(profile) {
        if (!profile) return "User profile not available.";
        
        const parts = [];
        
        if (profile.full_name) parts.push(`Name: ${profile.full_name}`);
        if (profile.headline) parts.push(`Headline: ${profile.headline}`);
        if (profile.current_company) parts.push(`Current Company: ${profile.current_company}`);
        if (profile.current_job_title) parts.push(`Current Position: ${profile.current_job_title}`);
        if (profile.location) parts.push(`Location: ${profile.location}`);
        
        // Add experience
        if (profile.experience && Array.isArray(profile.experience)) {
            const recentExperience = profile.experience.slice(0, 3).map(exp => 
                `${exp.title || ''} at ${exp.company || ''}${exp.duration ? ` (${exp.duration})` : ''}`
            ).join('; ');
            if (recentExperience) parts.push(`Experience: ${recentExperience}`);
        }
        
        // Add education
        if (profile.education && Array.isArray(profile.education)) {
            const education = profile.education.slice(0, 2).map(edu => 
                `${edu.degree || ''} ${edu.field ? `in ${edu.field}` : ''} from ${edu.institution || ''}`
            ).join('; ');
            if (education) parts.push(`Education: ${education}`);
        }
        
        // Add skills
        if (profile.skills && Array.isArray(profile.skills)) {
            const skills = profile.skills.slice(0, 5).join(', ');
            if (skills) parts.push(`Skills: ${skills}`);
        }
        
        return parts.length > 0 ? parts.join('\n') : "Limited user profile information available.";
    }

    // Format target profile data for prompt
    formatTargetProfile(profileData) {
        if (!profileData || !profileData.data_json) return "Target profile not available.";
        
        try {
            let profile;
            if (typeof profileData.data_json === 'string') {
                profile = JSON.parse(profileData.data_json);
            } else {
                profile = profileData.data_json;
            }
            
            const parts = [];
            
            if (profile.fullName) parts.push(`Name: ${profile.fullName}`);
            if (profile.headline) parts.push(`Headline: ${profile.headline}`);
            if (profile.currentCompany) parts.push(`Current Company: ${profile.currentCompany}`);
            if (profile.currentJobTitle) parts.push(`Current Position: ${profile.currentJobTitle}`);
            if (profile.location) parts.push(`Location: ${profile.location}`);
            
            // Add experience
            if (profile.experience && Array.isArray(profile.experience)) {
                const recentExperience = profile.experience.slice(0, 3).map(exp => 
                    `${exp.title || ''} at ${exp.company || ''}${exp.duration ? ` (${exp.duration})` : ''}`
                ).join('; ');
                if (recentExperience) parts.push(`Experience: ${recentExperience}`);
            }
            
            // Add education
            if (profile.education && Array.isArray(profile.education)) {
                const education = profile.education.slice(0, 2).map(edu => 
                    `${edu.degree || ''} ${edu.field ? `in ${edu.field}` : ''} from ${edu.institution || ''}`
                ).join('; ');
                if (education) parts.push(`Education: ${education}`);
            }
            
            return parts.length > 0 ? parts.join('\n') : "Limited target profile information available.";
            
        } catch (error) {
            console.error('[ERROR] Error parsing target profile data:', error);
            return "Target profile data parsing error.";
        }
    }

    // Extract target profile metadata for database storage
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
            
            return {
                target_first_name: profile.firstName || profile.fullName?.split(' ')[0] || null,
                target_title: profile.currentJobTitle || profile.headline || null,
                target_company: profile.currentCompany || null
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

    // Main function to generate LinkedIn message
    async generateLinkedInMessage(userProfile, targetProfile, context, messageType = 'inbox_message') {
        const startTime = Date.now();
        
        try {
            console.log('[GPT] Starting GPT-5 message generation...');
            console.log(`[GPT] Model: ${this.model}`);
            console.log(`[GPT] Message type: ${messageType}`);
            
            if (!this.apiKey) {
                throw new Error('OpenAI API key not configured');
            }

            // Build the prompt
            const { systemPrompt, userPrompt } = this.buildPrompt(userProfile, targetProfile, context, messageType);
            
            console.log('[GPT] Calling OpenAI API...');
            
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
                ],
                max_completion_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 second timeout
            });

            const endTime = Date.now();
            const latencyMs = endTime - startTime;

            console.log('[SUCCESS] GPT-5 API call successful');
            console.log(`[GPT] Latency: ${latencyMs}ms`);
            console.log(`[GPT] Token usage: ${response.data.usage.prompt_tokens} input, ${response.data.usage.completion_tokens} output, ${response.data.usage.total_tokens} total`);

            const generatedMessage = response.data.choices[0].message.content.trim();
            console.log(`[GPT] Generated message preview: ${generatedMessage.substring(0, 120)}...`);

            // Extract target metadata
            const targetMetadata = this.extractTargetMetadata(targetProfile);

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
                    prompt_version: 'inbox_message_final_enterprise_v1',
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

            console.error('[ERROR] GPT-5 message generation failed:', error.message);
            
            if (error.response) {
                console.error('[ERROR] API Response:', {
                    status: error.response.status,
                    data: error.response.data
                });
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
