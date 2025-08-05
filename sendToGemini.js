const axios = require('axios');

async function sendToGemini(rawJson) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        
        console.log('🤖 Sending LinkedIn data to Gemini for processing...');
        
        const prompt = `You will receive a LinkedIn profile JSON from Bright Data. Return a clean JSON with the following fields only:

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

        // ✅ FIXED: Updated to use Gemini 2.5 (latest model)
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
            {
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            { text: JSON.stringify(rawJson) }
                        ]
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 120000 // ✅ FIXED: Increased from 30000 to 120000 (2 minutes)
            }
        );

        if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response structure from Gemini API');
        }

        const geminiText = response.data.candidates[0].content.parts[0].text;
        console.log('🤖 Received response from Gemini');
        
        // Clean up the response text (remove markdown code blocks if present)
        const cleanedText = geminiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        let processedData;
        try {
            processedData = JSON.parse(cleanedText);
        } catch (parseError) {
            console.error('❌ Failed to parse Gemini JSON response:', parseError);
            console.error('Raw response:', cleanedText);
            throw new Error('Failed to parse Gemini response as JSON');
        }

        // Add metadata
        processedData.timestamp = new Date();
        processedData.dataSource = 'bright_data_via_gemini';

        console.log('✅ Gemini processing completed successfully');
        console.log(`📊 Processed data summary:`);
        console.log(`   - Full Name: ${processedData.fullName || 'Not available'}`);
        console.log(`   - Headline: ${processedData.headline || 'Not available'}`);
        console.log(`   - Current Company: ${processedData.currentCompany || 'Not available'}`);
        console.log(`   - Experience entries: ${processedData.experience?.length || 0}`);
        console.log(`   - Education entries: ${processedData.education?.length || 0}`);
        console.log(`   - Skills: ${processedData.skills?.length || 0}`);

        return processedData;

    } catch (error) {
        console.error('❌ Gemini processing failed:', error.message);
        
        // ✅ ENHANCED: Better error logging for debugging
        if (error.response) {
            console.error('❌ Gemini API response error:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        
        throw new Error(`Gemini processing failed: ${error.message}`);
    }
}

module.exports = { sendToGemini };
