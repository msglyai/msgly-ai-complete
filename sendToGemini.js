const axios = require('axios');

async function sendToGemini(inputData) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        
        console.log('🤖 Sending LinkedIn data to Gemini for processing...');
        
        // ✅ NEW: Detect input type (HTML from Chrome extension vs JSON from Bright Data)
        const isHtmlInput = inputData && typeof inputData === 'object' && inputData.html && typeof inputData.html === 'string';
        const isJsonInput = !isHtmlInput;
        
        console.log(`📊 Input type: ${isHtmlInput ? 'HTML from Chrome Extension' : 'JSON from Bright Data'}`);
        
        let prompt, content;
        
        if (isHtmlInput) {
            // ✅ NEW: HTML Processing for Chrome Extension
            console.log(`📄 Processing HTML content (${inputData.html.length} characters)...`);
            
            content = inputData.html;
            prompt = `You will receive LinkedIn profile HTML from a Chrome extension. Extract ALL available profile information and return ONLY a clean JSON with these fields:

{
  "linkedinId": "string or null",
  "linkedinNumId": "number or null", 
  "inputUrl": "string or null",
  "url": "string or null",
  "fullName": "string or null",
  "firstName": "string or null",
  "lastName": "string or null", 
  "headline": "string or null",
  "about": "string or null",
  "summary": "string or null",
  "location": "string or null",
  "city": "string or null",
  "state": "string or null",
  "country": "string or null",
  "countryCode": "string or null",
  "industry": "string or null",
  "currentCompany": "string or null",
  "currentCompanyName": "string or null",
  "currentCompanyId": "string or null",
  "currentCompanyCompanyId": "string or null",
  "currentPosition": "string or null",
  "connectionsCount": "number or null",
  "followersCount": "number or null", 
  "connections": "number or null",
  "followers": "number or null",
  "recommendationsCount": "number or null",
  "profileImageUrl": "string or null",
  "avatar": "string or null",
  "bannerImage": "string or null",
  "backgroundImageUrl": "string or null",
  "publicIdentifier": "string or null",
  "experience": [],
  "education": [], 
  "educationsDetails": [],
  "skills": [],
  "skillsWithEndorsements": [],
  "languages": [],
  "certifications": [],
  "courses": [],
  "projects": [], 
  "publications": [],
  "patents": [],
  "volunteerExperience": [],
  "volunteering": [],
  "honorsAndAwards": [],
  "organizations": [],
  "recommendations": [],
  "recommendationsGiven": [],
  "recommendationsReceived": [], 
  "posts": [],
  "activity": [],
  "articles": [],
  "peopleAlsoViewed": [],
  "timestamp": "current timestamp",
  "dataSource": "html_scraping"
}

CRITICAL INSTRUCTIONS:
1. Extract REAL data from the HTML - don't make up information
2. Pay special attention to the Experience section - this is CRITICAL for feature unlock
3. For experience array, include objects like: {"title": "Job Title", "company": "Company Name", "location": "Location", "duration": "Duration", "description": "Description", "current": true/false}
4. For education array, include: {"school": "School Name", "degree": "Degree", "field": "Field of Study", "startYear": "Year", "endYear": "Year"}
5. For skills array, include: {"name": "Skill Name", "endorsements": number}
6. Convert follower/connection counts: "500+" → 500, "1K" → 1000, "2.5M" → 2500000
7. If a field is not found in HTML, use null (not empty string)
8. Return ONLY the JSON object, no explanations or markdown formatting

HTML CONTENT TO PROCESS:`;

        } else {
            // ✅ EXISTING: JSON Processing for Bright Data (your original code)
            console.log('📄 Processing Bright Data JSON response...');
            
            content = JSON.stringify(inputData);
            prompt = `You will receive a LinkedIn profile JSON from Bright Data. Return a clean JSON with the following fields only:

{
  "linkedinId": "string or null",
  "linkedinNumId": "number or null", 
  "inputUrl": "string or null",
  "url": "string or null",
  "fullName": "string or null",
  "firstName": "string or null",
  "lastName": "string or null", 
  "headline": "string or null",
  "about": "string or null",
  "summary": "string or null",
  "location": "string or null",
  "city": "string or null",
  "state": "string or null",
  "country": "string or null",
  "countryCode": "string or null",
  "industry": "string or null",
  "currentCompany": "string or null",
  "currentCompanyName": "string or null",
  "currentCompanyId": "string or null",
  "currentCompanyCompanyId": "string or null",
  "currentPosition": "string or null",
  "connectionsCount": "number or null",
  "followersCount": "number or null", 
  "connections": "number or null",
  "followers": "number or null",
  "recommendationsCount": "number or null",
  "profileImageUrl": "string or null",
  "avatar": "string or null",
  "bannerImage": "string or null",
  "backgroundImageUrl": "string or null",
  "publicIdentifier": "string or null",
  "experience": "array of objects with job history",
  "education": "array of objects with education history", 
  "educationsDetails": "array of objects with detailed education",
  "skills": "array of objects with skills",
  "skillsWithEndorsements": "array of objects with endorsed skills",
  "languages": "array of objects with languages",
  "certifications": "array of objects with certifications",
  "courses": "array of objects with courses",
  "projects": "array of objects with projects", 
  "publications": "array of objects with publications",
  "patents": "array of objects with patents",
  "volunteerExperience": "array of objects with volunteer work",
  "volunteering": "array of objects with volunteering",
  "honorsAndAwards": "array of objects with honors and awards",
  "organizations": "array of objects with organizations",
  "recommendations": "array of objects with recommendations",
  "recommendationsGiven": "array of objects with given recommendations",
  "recommendationsReceived": "array of objects with received recommendations", 
  "posts": "array of objects with posts",
  "activity": "array of objects with activity",
  "articles": "array of objects with articles",
  "peopleAlsoViewed": "array of objects with people also viewed",
  "timestamp": "current timestamp",
  "dataSource": "bright_data"
}

Map the input data to these fields as accurately as possible. For arrays, ensure they are properly formatted JSON arrays. For numbers, parse strings like "1,234" to 1234, "1.2K" to 1200, "2.5M" to 2500000. No explanation, just return the clean JSON.`;
        }

        // ✅ ENHANCED: Prepare request with content handling
        const parts = [{ text: prompt }];
        
        // Add content based on type
        if (isHtmlInput) {
            // For HTML, truncate if too large (Gemini has limits)
            const truncatedHtml = content.length > 100000 ? content.substring(0, 100000) + '...[TRUNCATED]' : content;
            parts.push({ text: truncatedHtml });
        } else {
            // For JSON, use as-is
            parts.push({ text: content });
        }

        // ✅ FIXED: Updated to use Gemini 2.0 Flash (your existing model)
        console.log('🚀 Sending request to Gemini 2.0 Flash...');
        
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
            {
                contents: [{ parts: parts }]
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 120000 // ✅ KEPT: Your 2-minute timeout
            }
        );

        if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response structure from Gemini API');
        }

        const geminiText = response.data.candidates[0].content.parts[0].text;
        console.log('🤖 Received response from Gemini');
        
        // ✅ ENHANCED: Better text cleaning for both HTML and JSON responses
        let cleanedText = geminiText.trim();
        
        // Remove markdown code blocks if present
        cleanedText = cleanedText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        
        // Remove any leading/trailing text that isn't JSON
        const jsonStart = cleanedText.indexOf('{');
        const jsonEnd = cleanedText.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanedText = cleanedText.substring(jsonStart, jsonEnd + 1);
        }
        
        let processedData;
        try {
            processedData = JSON.parse(cleanedText);
        } catch (parseError) {
            console.error('❌ Failed to parse Gemini JSON response:', parseError);
            console.error('Raw response (first 500 chars):', cleanedText.substring(0, 500));
            throw new Error('Failed to parse Gemini response as JSON');
        }

        // ✅ ENHANCED: Add metadata based on input type
        processedData.timestamp = new Date();
        processedData.dataSource = isHtmlInput ? 'html_scraping_via_gemini' : 'bright_data_via_gemini';

        // ✅ CRITICAL: Ensure arrays are properly formatted
        const arrayFields = [
            'experience', 'education', 'educationsDetails', 'skills', 'skillsWithEndorsements',
            'languages', 'certifications', 'courses', 'projects', 'publications', 'patents',
            'volunteerExperience', 'volunteering', 'honorsAndAwards', 'organizations',
            'recommendations', 'recommendationsGiven', 'recommendationsReceived',
            'posts', 'activity', 'articles', 'peopleAlsoViewed'
        ];

        arrayFields.forEach(field => {
            if (!Array.isArray(processedData[field])) {
                processedData[field] = [];
            }
        });

        console.log('✅ Gemini processing completed successfully');
        console.log(`📊 Processed data summary:`);
        console.log(`   - Input Type: ${isHtmlInput ? 'HTML' : 'JSON'}`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Headline: ${processedData.headline || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - Experience entries: ${processedData.experience?.length || 0}`);
        console.log(`   - Education entries: ${processedData.education?.length || 0}`);
        console.log(`   - Skills: ${processedData.skills?.length || 0}`);
        
        // ✅ CRITICAL: Log if experience is missing (needed for feature unlock)
        if (!processedData.experience || processedData.experience.length === 0) {
            console.warn('⚠️ WARNING: No experience data extracted - this may block feature unlock');
        }

        return processedData;

    } catch (error) {
        console.error('❌ Gemini processing failed:', error.message);
        
        // ✅ ENHANCED: Better error logging for debugging (your existing code)
        if (error.response) {
            console.error('❌ Gemini API response error:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        
        // ✅ NEW: Add specific error context
        if (error.code === 'ECONNABORTED') {
            throw new Error('Gemini processing timeout - try again');
        }
        
        throw new Error(`Gemini processing failed: ${error.message}`);
    }
}

module.exports = { sendToGemini };
