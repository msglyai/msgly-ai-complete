/*
CHANGELOG - services/gptService.js:
1. ENHANCED formatUserProfile function:
   - Priority source: gemini_raw_data with safe parsing (try/catch)
   - Rich summary building from comprehensive data (experience, roles, industries, achievements, etc.)
   - Graceful fallback to basic fields when gemini_raw_data missing
   - Added debug logging for gemini_raw_data presence and parsing
   - REMOVED ALL TRUNCATION: Send complete data without pruning
2. ENHANCED formatTargetProfile function: 
   - Primary source: data_json.data.profile nested structure extraction
   - Proper extraction of awards and skills from nested paths
   - Defensive null checks throughout to prevent errors
   - Fallback to existing flat fields when nested structure missing
   - Added debug logging for nested profile presence
   - REMOVED ALL TRUNCATION: Send complete data without pruning
3. Shared improvements:
   - Never mutate source objects (all operations on copies)
   - Clean and deterministic output with stable section order
   - Enhanced debug logging (non-PII, shows presence/counts not raw content)
4. UPDATED PROMPT: Changed to target-centric approach with 220 char limit, required greeting/closing, 3 details minimum
5. ADDED GEMINI FALLBACK: Insurance policy - Gemini 2.5 Pro activates only when GPT-5 fails
6. COMPLETED CONNECTION REQUEST: Full implementation following LinkedIn message pattern
7. ADDED INTRO REQUEST: New method for mutual connection introductions
8. ADDED CALL-TO-ACTION REQUIREMENT: All message types now require CTA at the end
9. MODIFIED: All data formatting functions now send COMPLETE DATA without any truncation
10. UPDATED INBOX MESSAGE PROMPT: Replaced with new human-like, natural language version
11. FIXED CHARACTER ENCODING: Cleaned up all corrupted characters in prompts
12. FIXED DATABASE TRUNCATION: Changed to 40-char limit for extra safety
13. UPDATED CONNECTION REQUEST PROMPT: New personalized prompt with sender name requirement
*/

// server/services/gptService.js - GPT-5 Integration Service with Rich Profile Data & Comprehensive Debugging - FULL DATA VERSION
const axios = require('axios');

class GPTService {
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
            console.error('[ERROR] OPENAI_API_KEY not found in environment variables');
        }
        if (!this.geminiApiKey) {
            console.error('[ERROR] GOOGLE_AI_API_KEY not found in environment variables');
        }
    }

    // Insurance fallback: Gemini API call method
    async callGeminiAPI(systemPrompt, userPrompt) {
        const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
        
        const response = await axios.post(
            `${this.geminiBaseURL}/models/${this.geminiModel}:generateContent`,
            {
                contents: [
                    {
                        parts: [
                            {
                                text: combinedPrompt
                            }
                        ]
                    }
                ],
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

    // Build the complete prompt for LinkedIn message generation with debugging
    buildPrompt(userProfile, targetProfile, context, messageType) {
        console.log('[GPT] === BUILDING PROMPT FOR GPT-5 ===');
        console.log(`[GPT] Message Type: ${messageType}`);
        
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
        
        // Select prompt template based on message type
        let systemPrompt;
        
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
                
            case 'intro_request':
                systemPrompt = `[MODE: INTRO_REQUEST]

You are an AI LinkedIn Outreach Assistant.

Inputs:
1. USER PROFILE — sender's LinkedIn profile (experience, headline, skills, education, etc.)
2. TARGET PROFILE — recipient's LinkedIn profile (experience, headline, skills, education, etc.)
3. CONTEXT — the business or conversational goal.
4. MUTUAL CONNECTION — the LinkedIn profile of the shared connection who could make the intro.

Task:
- Generate ONE LinkedIn intro request consisting of two short parts:
  Part A: The message you would send to the mutual connection asking for an introduction. ≤150 characters.
  Part B: The short message the mutual connection could forward to the target. ≤220 characters.
- Combined total must never exceed 370 characters.

Message rules:
• Both parts must always start with: "Hi [FIRSTNAME],"
• Part A must end with sender's first name AND include a call-to-action asking for the introduction (e.g., "Could you introduce us? Thanks, Ziv").
• Part B must end with sender's first name AND include a call-to-action for connection (e.g., "Would love to connect. Thanks, Ziv").
• Use at least 1 detail from USER PROFILE and 1 from TARGET PROFILE in Part B.
• Integrate CONTEXT naturally; do not restate it literally.
• Keep it friendly, professional, approachable — avoid email or sales tone.
• No offers, links, or additional calls-to-action beyond the required ones.
• Do not phrase Part A or Part B as a question (except for the CTAs).
• Avoid generic phrases; avoid relying only on job titles or company names.
• Avoid exaggerated adjectives.
• No emojis, hashtags, line breaks, or special symbols.
• If insufficient data — still produce polite, general LinkedIn-style messages within limits with required CTAs.
• Output format:
  Part A: [intro request to mutual connection]
  Part B: [forwardable message to target]
• Output only the two message texts — no explanations, no labels, no JSON.`;
                break;
                
            default: // 'inbox_message'
                systemPrompt = `[MODE: INBOX_MESSAGE]
I send you:
1. My LinkedIn profile (USER PROFILE)
2. My Target's LinkedIn profile (TARGET PROFILE)
3. The CONTEXT (business or conversational goal)
Please build the most **personalized LinkedIn inbox message**.
**Rules:**
* Absolute maximum: **220 characters**.
* Always start with: **"Hi [TARGET_FIRSTNAME],"**
* Always end with sender's first name (e.g., "… Thanks, Ziv").
* Must reference at least **1 detail from USER PROFILE** and **1 detail from TARGET PROFILE**.
* You may use **more than one detail** from each profile if relevant and it improves personalization.
* You may use details from the TARGET PROFILE "About" section **only if they are unique, personal, or add value**; skip generic/vague phrases.
* Must end with a **clear CTA relevant to CONTEXT** (e.g., ask a question, invite to connect, suggest a quick chat).
* Integrate CONTEXT naturally — frame it around the benefit or shared value for the target.
* Focus mainly on the TARGET PROFILE — not the sender.
* Highlight relevant common ground if it exists; skip it if not useful.
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
${context}

Generate the ${messageType === 'connection_request' ? 'connection request' : messageType === 'intro_request' ? 'intro request' : 'LinkedIn inbox message'} now:`;

        console.log('[DEBUG] Final system prompt length:', systemPrompt.length);
        console.log('[DEBUG] Final user prompt length:', userPrompt.length);
        console.log('[DEBUG] Total prompt length:', systemPrompt.length + userPrompt.length);

        return {
            systemPrompt,
            userPrompt
        };
    }

    // MODIFIED: Format user profile data using ALL gemini_raw_data (NO TRUNCATION)
    formatUserProfile(profile) {
        console.log('[DEBUG] === USER PROFILE FORMATTING (FULL DATA) ===');
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
                
                // FULL About section - NO TRUNCATION
                if (profileData.about) {
                    parts.push(`About: ${profileData.about}`);
                }
                
                // FULL Experience data - ALL ENTRIES, NO TRUNCATION
                const experience = richData.data?.experience || richData.experience || profileData.experience || [];
                console.log('[DEBUG] Experience found:', Array.isArray(experience), experience.length);
                if (experience && Array.isArray(experience) && experience.length > 0) {
                    const fullExperience = experience.map(exp => {
                        const title = exp.title || exp.position || exp.role || '';
                        const company = exp.company || exp.companyName || '';
                        const duration = exp.duration || exp.dates || exp.period || '';
                        // FULL DESCRIPTION - NO TRUNCATION
                        const description = exp.description ? ` - ${exp.description}` : '';
                        return `${title} at ${company}${duration ? ` (${duration})` : ''}${description}`;
                    }).filter(exp => exp.trim() !== ' at').join('; ');
                    if (fullExperience) parts.push(`Experience: ${fullExperience}`);
                }
                
                // FULL Education data - ALL ENTRIES
                const education = richData.data?.education || richData.education || profileData.education || [];
                console.log('[DEBUG] Education found:', Array.isArray(education), education.length);
                if (education && Array.isArray(education) && education.length > 0) {
                    const fullEducation = education.map(edu => {
                        const degree = edu.degree || edu.degreeName || edu.qualification || '';
                        const field = edu.field || edu.fieldOfStudy || edu.major || '';
                        const school = edu.institution || edu.school || edu.schoolName || edu.university || '';
                        return `${degree}${field ? ` in ${field}` : ''} from ${school}`;
                    }).filter(edu => edu.trim() !== ' from').join('; ');
                    if (fullEducation) parts.push(`Education: ${fullEducation}`);
                }
                
                // ALL Skills data
                const skills = richData.data?.skills || richData.skills || profileData.skills || [];
                console.log('[DEBUG] Skills found:', Array.isArray(skills), skills.length);
                if (skills && Array.isArray(skills) && skills.length > 0) {
                    const allSkills = skills.map(skill => 
                        typeof skill === 'string' ? skill : (skill.name || skill.skill || skill.title || skill)
                    ).filter(skill => skill && typeof skill === 'string').join(', ');
                    if (allSkills) parts.push(`Skills: ${allSkills}`);
                }
                
                // ALL Awards
                const awards = richData.data?.awards || richData.awards || profileData.awards || [];
                console.log('[DEBUG] Awards found:', Array.isArray(awards), awards.length);
                if (awards && Array.isArray(awards) && awards.length > 0) {
                    const allAwards = awards.map(award => {
                        const title = award.title || award.name || '';
                        const issuer = award.issuer || award.organization || '';
                        const date = award.date || '';
                        return `${title}${issuer ? ` from ${issuer}` : ''}${date ? ` (${date})` : ''}`;
                    }).filter(award => award.trim()).join('; ');
                    if (allAwards) parts.push(`Awards: ${allAwards}`);
                }
                
                // ALL Languages
                const languages = richData.data?.languages || richData.languages || profileData.languages || [];
                if (languages && Array.isArray(languages) && languages.length > 0) {
                    const allLanguages = languages.map(lang => 
                        typeof lang === 'string' ? lang : (lang.name || lang.language || lang)
                    ).filter(lang => lang).join(', ');
                    if (allLanguages) parts.push(`Languages: ${allLanguages}`);
                }
                
                // Industries/Roles
                if (profileData.industry) {
                    parts.push(`Industry: ${profileData.industry}`);
                }
                
                // ALL Certifications
                const certifications = richData.data?.certifications || richData.certifications || profileData.certifications || [];
                if (certifications && Array.isArray(certifications) && certifications.length > 0) {
                    const allCertifications = certifications.map(cert => {
                        const name = cert.name || cert.title || cert.certification || '';
                        const issuer = cert.issuer || cert.organization || cert.authority || '';
                        const date = cert.date || cert.dateIssued || '';
                        return `${name}${issuer ? ` from ${issuer}` : ''}${date ? ` (${date})` : ''}`;
                    }).filter(cert => cert.trim()).join('; ');
                    if (allCertifications) parts.push(`Certifications: ${allCertifications}`);
                }
                
                // ALL Volunteer Experience
                const volunteer = richData.data?.volunteer || richData.volunteer || profileData.volunteer || [];
                if (volunteer && Array.isArray(volunteer) && volunteer.length > 0) {
                    const allVolunteer = volunteer.map(vol => {
                        const role = vol.role || vol.title || vol.position || '';
                        const organization = vol.organization || vol.company || '';
                        const cause = vol.cause || vol.description || '';
                        return `${role} at ${organization}${cause ? ` - ${cause}` : ''}`;
                    }).filter(vol => vol.trim() !== ' at').join('; ');
                    if (allVolunteer) parts.push(`Volunteer Experience: ${allVolunteer}`);
                }
                
                // ALL Projects
                const projects = richData.data?.projects || richData.projects || profileData.projects || [];
                if (projects && Array.isArray(projects) && projects.length > 0) {
                    const allProjects = projects.map(proj => {
                        const name = proj.name || proj.title || '';
                        const description = proj.description || proj.summary || '';
                        return `${name}${description ? ` - ${description}` : ''}`;
                    }).filter(proj => proj.trim()).join('; ');
                    if (allProjects) parts.push(`Projects: ${allProjects}`);
                }
                
                // ALL Publications
                const publications = richData.data?.publications || richData.publications || profileData.publications || [];
                if (publications && Array.isArray(publications) && publications.length > 0) {
                    const allPublications = publications.map(pub => {
                        const title = pub.title || pub.name || '';
                        const publisher = pub.publisher || pub.publication || '';
                        const date = pub.date || '';
                        return `${title}${publisher ? ` in ${publisher}` : ''}${date ? ` (${date})` : ''}`;
                    }).filter(pub => pub.trim()).join('; ');
                    if (allPublications) parts.push(`Publications: ${allPublications}`);
                }
                
                const result = parts.length > 0 ? parts.join('\n') : "Rich user profile data available but could not format.";
                console.log('[DEBUG] Formatted FULL user profile length:', result.length);
                console.log('[DEBUG] FULL user profile sections:', parts.length);
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
        
        // FULL About - NO TRUNCATION
        if (profile.about) {
            parts.push(`About: ${profile.about}`);
        }
        
        // ALL Experience - NO TRUNCATION
        if (profile.experience && Array.isArray(profile.experience)) {
            const fullExperience = profile.experience.map(exp => 
                `${exp.title || ''} at ${exp.company || ''}${exp.duration ? ` (${exp.duration})` : ''}${exp.description ? ` - ${exp.description}` : ''}`
            ).filter(exp => exp.trim() !== ' at').join('; ');
            if (fullExperience) parts.push(`Experience: ${fullExperience}`);
        }
        
        // ALL Education - NO TRUNCATION
        if (profile.education && Array.isArray(profile.education)) {
            const fullEducation = profile.education.map(edu => 
                `${edu.degree || ''} ${edu.field ? `in ${edu.field}` : ''} from ${edu.institution || ''}`
            ).filter(edu => edu.trim() !== ' from').join('; ');
            if (fullEducation) parts.push(`Education: ${fullEducation}`);
        }
        
        // ALL Skills - NO TRUNCATION
        if (profile.skills && Array.isArray(profile.skills)) {
            const allSkills = profile.skills.join(', ');
            if (allSkills) parts.push(`Skills: ${allSkills}`);
        }
        
        const result = parts.length > 0 ? parts.join('\n') : "Limited user profile information available.";
        console.log('[DEBUG] Formatted basic user profile length:', result.length);
        console.log('[DEBUG] Basic user profile sections:', parts.length);
        return result;
    }

    // MODIFIED: Format target profile data for prompt with ALL nested structure data (NO TRUNCATION)
    formatTargetProfile(profileData) {
        console.log('[DEBUG] === TARGET PROFILE FORMATTING (FULL DATA) ===');
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
            
            // FULL About section - NO TRUNCATION
            if (profileInfo.about) {
                parts.push(`About: ${profileInfo.about}`);
            }
            
            // ALL Skills from nested data structure
            const skills = dataSection.skills || profileInfo.skills || [];
            console.log('[DEBUG] Target skills found:', Array.isArray(skills), skills.length);
            if (skills && Array.isArray(skills) && skills.length > 0) {
                const allSkills = skills.map(skill => 
                    typeof skill === 'string' ? skill : (skill.name || skill.skill || skill.title || skill)
                ).filter(skill => skill && typeof skill === 'string').join(', ');
                if (allSkills) parts.push(`Skills: ${allSkills}`);
            }
            
            // ALL Awards from nested data structure
            const awards = dataSection.awards || profileInfo.awards || [];
            console.log('[DEBUG] Target awards found:', Array.isArray(awards), awards.length);
            if (awards && Array.isArray(awards) && awards.length > 0) {
                const allAwards = awards.map(award => {
                    const title = award.title || award.name || '';
                    const issuer = award.issuer || award.organization || '';
                    const date = award.date || award.year || '';
                    return `${title}${issuer ? ` from ${issuer}` : ''}${date ? ` (${date})` : ''}`;
                }).filter(award => award.trim()).join('; ');
                if (allAwards) parts.push(`Awards: ${allAwards}`);
            }
            
            // ALL Experience from nested data structure - NO TRUNCATION
            const experience = dataSection.experience || profileInfo.experience || [];
            console.log('[DEBUG] Target experience found:', Array.isArray(experience), experience.length);
            if (experience && Array.isArray(experience) && experience.length > 0) {
                const fullExperience = experience.map(exp => {
                    const title = exp.title || exp.position || '';
                    const company = exp.company || exp.companyName || '';
                    const duration = exp.duration || exp.dates || exp.period || '';
                    // FULL DESCRIPTION - NO TRUNCATION
                    const description = exp.description ? ` - ${exp.description}` : '';
                    return `${title} at ${company}${duration ? ` (${duration})` : ''}${description}`;
                }).filter(exp => exp.trim() !== ' at').join('; ');
                if (fullExperience) parts.push(`Experience: ${fullExperience}`);
            }
            
            // ALL Education from nested data structure
            const education = dataSection.education || profileInfo.education || [];
            console.log('[DEBUG] Target education found:', Array.isArray(education), education.length);
            if (education && Array.isArray(education) && education.length > 0) {
                const fullEducation = education.map(edu => {
                    const degree = edu.degree || edu.degreeName || '';
                    const field = edu.field || edu.fieldOfStudy || edu.major || '';
                    const school = edu.institution || edu.school || edu.schoolName || edu.university || '';
                    return `${degree}${field ? ` in ${field}` : ''} from ${school}`;
                }).filter(edu => edu.trim() !== ' from').join('; ');
                if (fullEducation) parts.push(`Education: ${fullEducation}`);
            }
            
            // ALL Languages from nested structure
            const languages = dataSection.languages || profileInfo.languages || [];
            if (languages && Array.isArray(languages) && languages.length > 0) {
                const allLanguages = languages.map(lang => 
                    typeof lang === 'string' ? lang : (lang.name || lang.language || lang)
                ).filter(lang => lang).join(', ');
                if (allLanguages) parts.push(`Languages: ${allLanguages}`);
            }
            
            // Industry from nested structure
            if (dataSection.industry || profileInfo.industry) {
                parts.push(`Industry: ${dataSection.industry || profileInfo.industry}`);
            }
            
            // ALL Interests
            const interests = dataSection.interests || profileInfo.interests || [];
            if (interests && Array.isArray(interests) && interests.length > 0) {
                const allInterests = interests.map(interest => 
                    typeof interest === 'string' ? interest : (interest.name || interest)
                ).filter(interest => interest).join(', ');
                if (allInterests) parts.push(`Interests: ${allInterests}`);
            }
            
            // ALL Certifications
            const certifications = dataSection.certifications || profileInfo.certifications || [];
            if (certifications && Array.isArray(certifications) && certifications.length > 0) {
                const allCertifications = certifications.map(cert => {
                    const name = cert.name || cert.title || cert.certification || '';
                    const issuer = cert.issuer || cert.organization || cert.authority || '';
                    const date = cert.date || cert.dateIssued || '';
                    return `${name}${issuer ? ` from ${issuer}` : ''}${date ? ` (${date})` : ''}`;
                }).filter(cert => cert.trim()).join('; ');
                if (allCertifications) parts.push(`Certifications: ${allCertifications}`);
            }
            
            // ALL Volunteer Experience
            const volunteer = dataSection.volunteer || profileInfo.volunteer || [];
            if (volunteer && Array.isArray(volunteer) && volunteer.length > 0) {
                const allVolunteer = volunteer.map(vol => {
                    const role = vol.role || vol.title || vol.position || '';
                    const organization = vol.organization || vol.company || '';
                    const cause = vol.cause || vol.description || '';
                    return `${role} at ${organization}${cause ? ` - ${cause}` : ''}`;
                }).filter(vol => vol.trim() !== ' at').join('; ');
                if (allVolunteer) parts.push(`Volunteer Experience: ${allVolunteer}`);
            }
            
            // ALL Projects
            const projects = dataSection.projects || profileInfo.projects || [];
            if (projects && Array.isArray(projects) && projects.length > 0) {
                const allProjects = projects.map(proj => {
                    const name = proj.name || proj.title || '';
                    const description = proj.description || proj.summary || '';
                    return `${name}${description ? ` - ${description}` : ''}`;
                }).filter(proj => proj.trim()).join('; ');
                if (allProjects) parts.push(`Projects: ${allProjects}`);
            }
            
            // ALL Publications
            const publications = dataSection.publications || profileInfo.publications || [];
            if (publications && Array.isArray(publications) && publications.length > 0) {
                const allPublications = publications.map(pub => {
                    const title = pub.title || pub.name || '';
                    const publisher = pub.publisher || pub.publication || '';
                    const date = pub.date || '';
                    return `${title}${publisher ? ` in ${publisher}` : ''}${date ? ` (${date})` : ''}`;
                }).filter(pub => pub.trim()).join('; ');
                if (allPublications) parts.push(`Publications: ${allPublications}`);
            }
            
            // ALL Activity/Posts
            const activity = dataSection.activity || profileInfo.activity || [];
            if (activity && Array.isArray(activity) && activity.length > 0) {
                const allActivity = activity.map(act => {
                    const type = act.type || '';
                    const content = act.content || act.text || act.description || '';
                    return `${type}${content ? `: ${content}` : ''}`;
                }).filter(act => act.trim()).join('; ');
                if (allActivity) parts.push(`Recent Activity: ${allActivity}`);
            }
            
            const result = parts.length > 0 ? parts.join('\n') : "Limited target profile information available.";
            console.log('[DEBUG] Formatted FULL target profile length:', result.length);
            console.log('[DEBUG] FULL target profile sections:', parts.length);
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

    // ENHANCED: Extract target profile metadata for database storage - FIXED: 40-char limit for safety
    extractTargetMetadata(profileData) {
        console.log('[TRUNCATION FIX] Running extractTargetMetadata with 40-char safety limit');
        
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
            
            // FIXED: Truncate to 40 chars for extra safety (well below 50-char limit)
            const firstName = profileInfo.firstName || profileInfo.fullName?.split(' ')[0] || profileInfo.name?.split(' ')[0] || null;
            const title = profileInfo.currentJobTitle || profileInfo.currentRole || profileInfo.headline || null;
            const company = profileInfo.currentCompany || profileInfo.current_company || null;
            
            const result = {
                target_first_name: firstName ? firstName.substring(0, 40) : null,
                target_title: title ? title.substring(0, 40) : null,
                target_company: company ? company.substring(0, 40) : null
            };
            
            console.log('[TRUNCATION FIX] Metadata extracted:', {
                firstName: firstName ? `${firstName} -> ${result.target_first_name}` : 'null',
                title: title ? `${title.substring(0, 60)}... -> ${result.target_title}` : 'null',
                company: company ? `${company.substring(0, 60)}... -> ${result.target_company}` : 'null'
            });
            
            return result;
            
        } catch (error) {
            console.error('[ERROR] Error extracting target metadata:', error);
            return {
                target_first_name: null,
                target_title: null,
                target_company: null
            };
        }
    }

    // Main function to generate LinkedIn message with comprehensive debugging + Gemini insurance
    async generateLinkedInMessage(userProfile, targetProfile, context, messageType = 'inbox_message') {
        const startTime = Date.now();
        
        try {
            console.log('[GPT] === STARTING MESSAGE GENERATION ===');
            console.log(`[GPT] Primary model: ${this.model}`);
            console.log(`[GPT] Insurance model: ${this.geminiModel}`);
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
            
            console.log('[GPT] === CALLING PRIMARY API (GPT-5) ===');
            console.log('[GPT] Final request details:');
            console.log('[GPT] - System prompt length:', systemPrompt.length);
            console.log('[GPT] - User prompt length:', userPrompt.length);
            console.log('[GPT] - Total input length:', systemPrompt.length + userPrompt.length);
            
            // Insurance policy: Try GPT-5 first, fallback to Gemini if needed
            let response;
            let modelUsed = this.model;
            let fallbackTriggered = false;
            let primaryError = null;
            
            try {
                // PRIMARY: Try GPT-5 first
                response = await axios.post(`${this.baseURL}/chat/completions`, {
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
                
                console.log('[SUCCESS] GPT-5 API call successful');
                
            } catch (error) {
                console.log('[WARNING] GPT-5 failed, activating Gemini insurance...');
                console.log('[WARNING] GPT-5 error:', error.message);
                primaryError = error.message;
                fallbackTriggered = true;
                
                try {
                    // INSURANCE: Fallback to Gemini 2.5 Pro
                    console.log('[GEMINI] Calling Gemini API as fallback...');
                    response = await this.callGeminiAPI(systemPrompt, userPrompt);
                    modelUsed = this.geminiModel;
                    console.log('[SUCCESS] Gemini insurance fallback successful');
                    
                } catch (geminiError) {
                    console.error('[ERROR] Both GPT-5 and Gemini failed');
                    console.error('[ERROR] Gemini error:', geminiError.message);
                    throw new Error(`Primary (${this.model}): ${error.message} | Insurance (${this.geminiModel}): ${geminiError.message}`);
                }
            }

            const endTime = Date.now();
            const latencyMs = endTime - startTime;

            // Extract message based on model used
            let generatedMessage;
            let tokenUsage;
            
            if (modelUsed.includes('gemini')) {
                // Gemini response structure
                console.log('[DEBUG] Processing Gemini response structure');
                generatedMessage = response.data.candidates[0].content.parts[0].text.trim();
                tokenUsage = {
                    input_tokens: response.data.usageMetadata?.promptTokenCount || 0,
                    output_tokens: response.data.usageMetadata?.candidatesTokenCount || 0,
                    total_tokens: response.data.usageMetadata?.totalTokenCount || 0
                };
            } else {
                // OpenAI response structure
                console.log('[DEBUG] Processing OpenAI response structure');
                generatedMessage = response.data.choices[0].message.content.trim();
                tokenUsage = {
                    input_tokens: response.data.usage.prompt_tokens,
                    output_tokens: response.data.usage.completion_tokens,
                    total_tokens: response.data.usage.total_tokens
                };
            }

            console.log('[SUCCESS] === MESSAGE GENERATION SUCCESSFUL ===');
            console.log(`[GPT] Model used: ${modelUsed}${fallbackTriggered ? ' (🛡️ INSURANCE ACTIVATED)' : ''}`);
            console.log(`[GPT] Latency: ${latencyMs}ms`);
            console.log(`[GPT] Token usage: ${tokenUsage.input_tokens} input, ${tokenUsage.output_tokens} output, ${tokenUsage.total_tokens} total`);
            console.log(`[GPT] Generated message: "${generatedMessage}"`);
            console.log(`[GPT] Message length: ${generatedMessage.length} characters`);
            console.log(`[GPT] Message within limit: ${generatedMessage.length <= (messageType === 'connection_request' ? 150 : messageType === 'intro_request' ? 370 : 220) ? '✅' : '❌'}`);

            // Extract target metadata
            const targetMetadata = this.extractTargetMetadata(targetProfile);

            // FINAL SUCCESS DEBUG
            console.log('[DEBUG] === GENERATION SUCCESS SUMMARY ===');
            console.log('[DEBUG] ✅ User profile processed successfully');
            console.log('[DEBUG] ✅ Target profile processed successfully'); 
            console.log('[DEBUG] ✅ Context processed successfully');
            console.log('[DEBUG] ✅ Message generated successfully');
            console.log('[DEBUG] Total tokens used:', tokenUsage.total_tokens);
            if (fallbackTriggered) {
                console.log('[DEBUG] 🛡️ Insurance policy activated - service continuity maintained');
            }

            return {
                success: true,
                message: generatedMessage,
                tokenUsage: tokenUsage,
                metadata: {
                    model_name: modelUsed,
                    primary_model: this.model,
                    fallback_triggered: fallbackTriggered,
                    primary_error: primaryError,
                    prompt_version: messageType === 'connection_request' ? 'connection_request_v3_sender_name_full_data' : 'inbox_message_target_centric_v4_natural_human_full_data',
                    latency_ms: latencyMs,
                    ...targetMetadata
                },
                rawResponse: {
                    id: modelUsed.includes('gemini') ? 'gemini-generated-' + Date.now() : response.data.id,
                    object: modelUsed.includes('gemini') ? 'gemini.generation' : response.data.object,
                    created: modelUsed.includes('gemini') ? Math.floor(Date.now() / 1000) : response.data.created,
                    model: modelUsed,
                    choices: modelUsed.includes('gemini') ? [{message: {content: generatedMessage}}] : response.data.choices,
                    usage: tokenUsage
                }
            };

        } catch (error) {
            const endTime = Date.now();
            const latencyMs = endTime - startTime;

            console.error('[ERROR] === MESSAGE GENERATION FAILED ===');
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

    // COMPLETED: Connection Request Generation (follows exact same pattern as LinkedIn message)
    async generateLinkedInConnection(userProfile, targetProfile, context) {
        console.log('[GPT] === STARTING CONNECTION REQUEST GENERATION ===');
        return await this.generateLinkedInMessage(userProfile, targetProfile, context, 'connection_request');
    }

    // NEW: Intro Request Generation (follows exact same pattern as LinkedIn message)
    async generateIntroRequest(userProfile, targetProfile, context, mutualConnectionName = null) {
        console.log('[GPT] === STARTING INTRO REQUEST GENERATION ===');
        console.log(`[GPT] Mutual connection: ${mutualConnectionName || 'Unknown'}`);
        
        // Add mutual connection info to context for better prompt building
        const enhancedContext = mutualConnectionName ? 
            `${context} [Mutual connection: ${mutualConnectionName}]` : 
            context;
        
        return await this.generateLinkedInMessage(userProfile, targetProfile, enhancedContext, 'intro_request');
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
                        return `Model not found. Please check model availability.`;
                    }
                    return 'Invalid request. Please try again.';
                case 500:
                case 502:
                case 503:
                    return 'AI service temporarily unavailable. Please try again.';
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
