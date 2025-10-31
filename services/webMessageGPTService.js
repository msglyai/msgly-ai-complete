// webMessageGPTService.js - GPT Service for Web-Based Message Generation (BrightData profiles)
// Separate service from gptService.js - handles message generation for web interface using BrightData profile format

const axios = require('axios');

class WebMessageGPTService {
    constructor() {
        // Primary: OpenAI GPT-5 config
        this.apiKey = process.env.OPENAI_API_KEY;
        this.baseURL = 'https://api.openai.com/v1';
        this.model = process.env.OPENAI_MODEL || 'gpt-5';
        
        // Insurance: Gemini fallback config
        this.geminiApiKey = process.env.GOOGLE_AI_API_KEY;
        this.geminiModel = process.env.GOOGLE_AI_MODEL || 'gemini-2.5-pro';
        this.geminiBaseURL = 'https://generativelanguage.googleapis.com/v1beta';
        
        if (!this.apiKey) {
            console.error('[WEB-GPT] ERROR: OPENAI_API_KEY not found');
        }
        if (!this.geminiApiKey) {
            console.error('[WEB-GPT] ERROR: GOOGLE_AI_API_KEY not found');
        }
    }

    /**
     * Format BrightData profile for GPT prompt
     * @param {object} profile - BrightData formatted profile
     * @returns {string} - Formatted profile text
     */
    formatBrightDataProfile(profile) {
        console.log('[WEB-GPT] Formatting BrightData profile for GPT');
        
        let profileText = `TARGET PROFILE:\n`;
        profileText += `Name: ${profile.fullName}\n`;
        
        if (profile.headline) {
            profileText += `Headline: ${profile.headline}\n`;
        }
        
        if (profile.location) {
            profileText += `Location: ${profile.location}\n`;
        }
        
        if (profile.about) {
            profileText += `\nAbout:\n${profile.about}\n`;
        }
        
        if (profile.currentPosition) {
            profileText += `\nCurrent Position: ${profile.currentPosition}\n`;
        }
        
        if (profile.experience && profile.experience.length > 0) {
            profileText += `\nExperience:\n`;
            profile.experience.slice(0, 3).forEach(exp => {
                profileText += `- ${exp.title || ''} at ${exp.company || ''}\n`;
                if (exp.description) {
                    profileText += `  ${exp.description.substring(0, 200)}\n`;
                }
            });
        }
        
        if (profile.education && profile.education.length > 0) {
            profileText += `\nEducation:\n`;
            profile.education.slice(0, 2).forEach(edu => {
                profileText += `- ${edu.school || edu.institution || ''}\n`;
                if (edu.degree) {
                    profileText += `  ${edu.degree}\n`;
                }
            });
        }
        
        if (profile.skills && profile.skills.length > 0) {
            profileText += `\nTop Skills: ${profile.skills.slice(0, 10).join(', ')}\n`;
        }
        
        return profileText;
    }

    /**
     * Format user profile for GPT prompt
     * @param {object} userProfile - User's profile from database
     * @returns {string} - Formatted user profile text
     */
    formatUserProfile(userProfile) {
        console.log('[WEB-GPT] Formatting user profile');
        
        let profileText = `YOUR PROFILE:\n`;
        profileText += `Name: ${userProfile.display_name || userProfile.full_name || 'User'}\n`;
        
        // Try to extract from gemini_raw_data if available
        if (userProfile.gemini_raw_data) {
            try {
                const rawData = typeof userProfile.gemini_raw_data === 'string' 
                    ? JSON.parse(userProfile.gemini_raw_data) 
                    : userProfile.gemini_raw_data;
                
                if (rawData.headline) {
                    profileText += `Headline: ${rawData.headline}\n`;
                }
                if (rawData.about) {
                    profileText += `About: ${rawData.about}\n`;
                }
                if (rawData.current_position) {
                    profileText += `Current Position: ${rawData.current_position}\n`;
                }
            } catch (error) {
                console.log('[WEB-GPT] Could not parse gemini_raw_data');
            }
        }
        
        return profileText;
    }

    /**
     * Build prompt for message generation
     * @param {object} userProfile - User's profile
     * @param {object} targetProfile - BrightData formatted target profile
     * @param {string} context - User's custom context
     * @param {string} messageType - Type of message (linkedin_message, connection_request, cold_email)
     * @returns {object} - {systemPrompt, userPrompt}
     */
    buildPrompt(userProfile, targetProfile, context, messageType) {
        console.log(`[WEB-GPT] Building prompt for ${messageType}`);
        
        const userProfileText = this.formatUserProfile(userProfile);
        const targetProfileText = this.formatBrightDataProfile(targetProfile);
        
        let systemPrompt = '';
        
        // EXACT PROMPTS FROM ORIGINAL gptService.js
        switch (messageType) {
            case 'connection_request':
                systemPrompt = `[MODE: CONNECTION_REQUEST]
I send you:
My LinkedIn profile (USER PROFILE)
My Target's LinkedIn profile (TARGET PROFILE)
The CONTEXT (business or conversational goal)
Please build the most personalized LinkedIn connection request note.
**Rules:**
* Absolute maximum: **150 characters**.
* Always start with: **"Hi [TARGET_FIRSTNAME],"**
* Always end with sender's first name (e.g., "… Thanks, Ziv").
* Must reference at least **1 detail from USER PROFILE** and **1 detail from TARGET PROFILE**.
* You may use more than one detail from each profile if relevant and it improves personalization.
* You may use details from the TARGET PROFILE "About" section **only if they are unique, personal, or add value**; skip generic/vague phrases.
* Must end with a **clear CTA relevant to CONTEXT** (even short, like "Would love to connect").
* Integrate CONTEXT naturally — frame it around the benefit or shared value for the target.
* Keep tone **friendly, approachable, natural** (not salesy).
* Language must be **English only, simple, natural, and human-like** (not formal, academic, or marketing-style).
**Restrictions:**
* Do **NOT** use emojis.
* Do **NOT** use hashtags.
* Do **NOT** use quotation marks unless quoting an exact profile title.
* Do **NOT** use unusual punctuation (e.g., "!!!", "??", "--", "~~").
* Do **NOT** use bullet points or lists.
* Do **NOT** use line breaks — message must be one single line.
* Do **NOT** generate multiple options — only one single message.
* Do **NOT** exceed the character limit.
* Do **NOT** output explanations, reasoning, or meta-text — only the message itself.
* Do **NOT** use generic AI-sounding phrases.
* Do **NOT** invent details — only use what exists in USER PROFILE, TARGET PROFILE, or CONTEXT.`;
                break;

            case 'cold_email':
                systemPrompt = `[MODE: COLD_EMAIL]
I send you:
1. My LinkedIn profile (USER PROFILE)
2. My Target's LinkedIn profile (TARGET PROFILE)
3. The CONTEXT (business or conversational goal)
Please build the most **personalized cold email**.
**Rules:**
* Character budget: **400-550 characters** (subject + body content only, excluding format labels).
* ABSOLUTE MAXIMUM: **550 characters** - NEVER exceed this limit.
* Optimize for brevity: Use only the characters needed for a complete, compelling message.
* Aim for 400-500 characters for most cases.
* Use 500-550 characters ONLY when additional context genuinely adds value.
* A tight, effective 420-character email beats a padded 550-character one.
* Include a short SUBJECT line — must be relevant to CONTEXT, interesting, natural, never salesy or spammy.
* Email body must start with: **"Hi [TARGET_FIRSTNAME],"**
* Email body must start with an **ICEBREAKER**: a friendly, natural fact from the TARGET PROFILE, recent activity, or a relevant topical comment. It must never feel pushy, rude, or offensive.
* Output format must be:
  Subject: [your subject line]
  
  Body: [your email body starting with "Hi [TARGET_FIRSTNAME],"]
* Include one blank line between "Subject:" and "Body:" for clear separation.
* The labels "Subject:" and "Body:" and the blank line are formatting only and do NOT count toward your 550-character budget.
* Always begin with a natural ice-breaker line based on the target's most recent and relevant context. It must feel authentic and specific, never generic like "Hope you're well."
* If the target's most recent role started within the last 3 months → congratulate naturally on the new role (e.g., "Congrats on your new role at [COMPANY]!"). The model may rephrase, but must keep it clear and friendly.
* If they were recently promoted → acknowledge the promotion briefly and positively.
* If they've been in their current role or company for multiple years → recognize the milestone naturally (e.g., "Impressive to see your [X]-year journey at [COMPANY]!").
* If their profile highlights a unique achievement (e.g., award, major project, publication) → you may open by mentioning it, but keep it concise and personal.
* If their "About" section includes a clear personal passion or interest (only if unique and specific, not generic) → you may use it for a warm, authentic opening.
* Must reference at least **1 detail from USER PROFILE** and **1 detail from TARGET PROFILE**.
* You may use more than one detail from each profile if relevant and it improves personalization.
* Must end with sender's first name (e.g., "... Thanks, Ziv").
* Must end with a **clear CTA relevant to CONTEXT** (e.g., suggest a quick call, invite to try the tool, offer to send more info). The CTA must always be explicit and unambiguous — clearly telling the target what to do next.
* Integrate CONTEXT naturally — frame it around the benefit or shared value for the target.
* Focus mainly on the TARGET PROFILE — not the sender.
* Highlight relevant common ground if it exists; skip it if not useful.
* Even within the character limit, all sentences must remain clear and complete. Do not cut words or leave unfinished phrases; avoid shorthand that could confuse the reader.
* **Language must be English only, simple, natural, and human-like (not formal, academic, or marketing-style).**
**Restrictions:**
* Do **NOT** use emojis.
* Do **NOT** use hashtags.
* Do **NOT** use quotation marks unless quoting an exact profile title.
* Do **NOT** use unusual punctuation (e.g., "!!!", "??", "--", "~~").
* Do **NOT** use bullet points or lists.
* Do **NOT** use line breaks — email must be a single compact block (subject + body).
* Do **NOT** generate multiple options — only one single cold email.
* Do **NOT** exceed the character limit.
* Do **NOT** output explanations, reasoning, or meta-text — only the cold email itself.
* Do **NOT** use generic AI-sounding phrases.
* Do **NOT** invent details — only use what exists in USER PROFILE, TARGET PROFILE, or CONTEXT.`;
                break;
                
            default: // 'linkedin_message'
                systemPrompt = `[MODE: INBOX_MESSAGE]
I send you:
1. My LinkedIn profile (USER PROFILE)
2. My Target's LinkedIn profile (TARGET PROFILE)
3. The CONTEXT (business or conversational goal)
Please build the most **personalized LinkedIn inbox message**.
**Rules:**
* Character budget: **170-270 characters**.
* ABSOLUTE MAXIMUM: **270 characters** - NEVER exceed this limit.
* Optimize for brevity: Use only the characters needed for a complete, compelling message.
* Aim for 200-250 characters for most cases.
* Use 250-270 characters ONLY when additional context genuinely adds value.
* A tight, effective 200-character message beats a padded 270-character one.
* Always start with: **"Hi [TARGET_FIRSTNAME],"**
* Always end with sender's first name (e.g., "... Thanks, Ziv").
* Must reference at least **1 detail from USER PROFILE** and **1 detail from TARGET PROFILE**.
* You may use **more than one detail** from each profile if relevant and it improves personalization.
* Always begin with a natural ice-breaker line based on the target's most recent and relevant context. It must feel authentic and specific, never generic like "Hope you're well."
* If the target's most recent role started within the last 3 months → congratulate naturally on the new role (e.g., "Congrats on your new role at [COMPANY]!"). The model may rephrase, but must keep it clear and friendly.
* If they were recently promoted → acknowledge the promotion briefly and positively.
* If they've been in their current role or company for multiple years → recognize the milestone naturally (e.g., "Impressive to see your [X]-year journey at [COMPANY]!").
* If their profile highlights a unique achievement (e.g., award, major project, publication) → you may open by mentioning it, but keep it concise and personal.
* If their "About" section includes a clear personal passion or interest (only if unique and specific, not generic) → you may use it for a warm, authentic opening.
* Must end with a **clear CTA relevant to CONTEXT** (e.g., ask a question, invite to connect, suggest a quick chat).
* The CTA must always be explicit and unambiguous — clearly telling the target what to do next (e.g., try the tool via link, connect, schedule a chat, or share feedback).
* Integrate CONTEXT naturally — frame it around the benefit or shared value for the target.
* Focus mainly on the TARGET PROFILE — not the sender.
* Highlight relevant common ground if it exists; skip it if not useful.
* Even within the character limit, all sentences must remain clear and complete. Do not cut words or leave unfinished phrases; avoid shorthand that could confuse the reader.
* **Language must be English only, simple, natural, and human-like (not formal, academic, or marketing-style).**
**Restrictions:**
* Do **NOT** use emojis.
* Do **NOT** use hashtags.
* Do **NOT** use quotation marks unless quoting an exact profile title.
* Do **NOT** use unusual punctuation (e.g., "!!!", "??", "--", "~~").
* Do **NOT** use bullet points or lists.
* Do **NOT** use line breaks — message must be one single line.
* Do **NOT** generate multiple options — only one single message.
* Do **NOT** exceed the character limit.
* Do **NOT** output explanations, reasoning, or meta-text — only the message itself.
* Do **NOT** use generic AI-sounding phrases.
* Do **NOT** invent details — only use what exists in USER PROFILE, TARGET PROFILE, or CONTEXT.`;
        }

        const userPrompt = `USER PROFILE:
${userProfileText}

TARGET PROFILE:
${targetProfileText}

CONTEXT:
${context || 'Professional networking'}

Generate the ${messageType === 'connection_request' ? 'connection request' : messageType === 'cold_email' ? 'cold email' : 'LinkedIn inbox message'} now:`;

        return { systemPrompt, userPrompt };
    }

    /**
     * Call Gemini API as fallback
     */
    async callGeminiAPI(systemPrompt, userPrompt) {
        const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
        
        const response = await axios.post(
            `${this.geminiBaseURL}/models/${this.geminiModel}:generateContent`,
            {
                contents: [{
                    parts: [{ text: combinedPrompt }]
                }],
                generationConfig: {
                    maxOutputTokens: 1000,
                    temperature: 0.7
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.geminiApiKey
                },
                timeout: 120000
            }
        );
        
        return response;
    }

    /**
     * Generate message using GPT-5 (with Gemini fallback)
     * @param {object} userProfile - User's profile from database
     * @param {object} targetProfile - BrightData formatted profile
     * @param {string} context - User's custom context
     * @param {string} messageType - Type of message
     * @returns {Promise<object>} - {message, model_used, token_usage}
     */
    async generateMessage(userProfile, targetProfile, context, messageType) {
        const startTime = Date.now();
        
        try {
            console.log('[WEB-GPT] === STARTING MESSAGE GENERATION ===');
            console.log(`[WEB-GPT] Message type: ${messageType}`);
            console.log(`[WEB-GPT] Target: ${targetProfile.fullName}`);
            
            if (!this.apiKey) {
                throw new Error('OpenAI API key not configured');
            }

            // Build prompt
            const { systemPrompt, userPrompt } = this.buildPrompt(
                userProfile, 
                targetProfile, 
                context, 
                messageType
            );
            
            console.log('[WEB-GPT] Prompt lengths:', {
                system: systemPrompt.length,
                user: userPrompt.length
            });
            
            // Try GPT-5 first
            let response;
            let modelUsed = this.model;
            let fallbackTriggered = false;
            
            try {
                console.log('[WEB-GPT] Calling GPT-5...');
                response = await axios.post(
                    `${this.baseURL}/chat/completions`,
                    {
                        model: this.model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ]
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 120000
                    }
                );
                
                console.log('[WEB-GPT] ✅ GPT-5 successful');
                
            } catch (error) {
                console.log('[WEB-GPT] ⚠️ GPT-5 failed, trying Gemini...');
                fallbackTriggered = true;
                
                response = await this.callGeminiAPI(systemPrompt, userPrompt);
                modelUsed = this.geminiModel;
                console.log('[WEB-GPT] ✅ Gemini fallback successful');
            }

            // Extract message based on model
            let generatedMessage;
            let tokenUsage;
            
            if (modelUsed.includes('gemini')) {
                generatedMessage = response.data.candidates[0].content.parts[0].text.trim();
                tokenUsage = {
                    input_tokens: response.data.usageMetadata?.promptTokenCount || 0,
                    output_tokens: response.data.usageMetadata?.candidatesTokenCount || 0,
                    total_tokens: response.data.usageMetadata?.totalTokenCount || 0
                };
            } else {
                generatedMessage = response.data.choices[0].message.content.trim();
                tokenUsage = {
                    input_tokens: response.data.usage.prompt_tokens,
                    output_tokens: response.data.usage.completion_tokens,
                    total_tokens: response.data.usage.total_tokens
                };
            }

            const latencyMs = Date.now() - startTime;
            
            console.log('[WEB-GPT] === GENERATION COMPLETE ===');
            console.log(`[WEB-GPT] Model: ${modelUsed}`);
            console.log(`[WEB-GPT] Tokens: ${tokenUsage.total_tokens}`);
            console.log(`[WEB-GPT] Latency: ${latencyMs}ms`);
            console.log(`[WEB-GPT] Message length: ${generatedMessage.length} chars`);
            
            return {
                message: generatedMessage,
                model_used: modelUsed,
                token_usage: tokenUsage,
                latency_ms: latencyMs,
                fallback_triggered: fallbackTriggered
            };
            
        } catch (error) {
            console.error('[WEB-GPT] ❌ Generation failed:', error.message);
            throw new Error(`Message generation failed: ${error.message}`);
        }
    }
}

module.exports = new WebMessageGPTService();
