const extractLinkedInProfile = async (linkedinUrl) => {
    try {
        console.log(`🔍 Extracting LinkedIn profile: ${linkedinUrl}`);
        
        if (!SCRAPINGDOG_API_KEY) {
            throw new Error('ScrapingDog API key not configured');
        }
        
        // Extract username from LinkedIn URL
        const url = new URL(linkedinUrl);
        const pathname = url.pathname;
        const match = pathname.match(/\/in\/([^\/\?]+)/);
        
        if (!match) {
            throw new Error('Invalid LinkedIn URL format');
        }
        
        const username = match[1];
        console.log(`👤 Extracted username: ${username}`);
        
        // First attempt - try without private parameter
        console.log('🔄 Attempting profile extraction (attempt 1/2)...');
        let response = await axios.get(SCRAPINGDOG_BASE_URL, {
            params: {
                api_key: SCRAPINGDOG_API_KEY,
                type: 'profile',
                linkId: username
            },
            timeout: 60000 // 60 second timeout
        });

        // Handle status code 202 (profile being processed)
        if (response.status === 202) {
            console.log('⏳ Profile is being processed by ScrapingDog (202). Waiting 3 minutes...');
            // Wait 3 minutes for processing
            await new Promise(resolve => setTimeout(resolve, 180000));
            
            // Retry the request
            console.log('🔄 Retrying after processing delay...');
            response = await axios.get(SCRAPINGDOG_BASE_URL, {
                params: {
                    api_key: SCRAPINGDOG_API_KEY,
                    type: 'profile',
                    linkId: username
                },
                timeout: 60000
            });
        }

        // If still not successful, try with private=true parameter
        if (response.status !== 200 || !response.data) {
            console.log('🔄 Attempting with private=true parameter (attempt 2/2)...');
            response = await axios.get(SCRAPINGDOG_BASE_URL, {
                params: {
                    api_key: SCRAPINGDOG_API_KEY,
                    type: 'profile',
                    linkId: username,
                    private: 'true'
                },
                timeout: 60000
            });
            
            // Handle status code 202 for private request
            if (response.status === 202) {
                console.log('⏳ Private profile is being processed by ScrapingDog (202). Waiting 3 minutes...');
                await new Promise(resolve => setTimeout(resolve, 180000));
                
                // Retry the private request
                console.log('🔄 Retrying private request after processing delay...');
                response = await axios.get(SCRAPINGDOG_BASE_URL, {
                    params: {
                        api_key: SCRAPINGDOG_API_KEY,
                        type: 'profile',
                        linkId: username,
                        private: 'true'
                    },
                    timeout: 60000
                });
            }
        }

        if (response.status === 200 && response.data) {
            const profile = response.data;
            
            // Handle array response (ScrapingDog sometimes returns an array)
            const profileData = Array.isArray(profile) ? profile[0] : profile;
            
            if (!profileData) {
                throw new Error('No profile data in ScrapingDog response');
            }
            
            // Extract and structure the data according to ScrapingDog's format
            const extractedData = {
                fullName: profileData.fullName || profileData.full_name || profileData.name || null,
                firstName: profileData.first_name || profileData.fullName?.split(' ')[0] || null,
                lastName: profileData.last_name || profileData.fullName?.split(' ').slice(1).join(' ') || null,
                headline: profileData.headline || profileData.description || null,
                summary: profileData.summary || profileData.about || null,
                location: profileData.location || profileData.address || null,
                industry: profileData.industry || null,
                connectionsCount: profileData.connections || profileData.connections_count || null,
                profileImageUrl: profileData.profile_photo || profileData.profile_image || profileData.avatar || null,
                experience: profileData.experience || [],
                education: profileData.education || [],
                skills: profileData.skills || [],
                rawData: profileData // Store complete response for future use
            };

            console.log(`✅ Successfully extracted profile for: ${extractedData.fullName || 'Unknown'}`);
            console.log(`📊 Profile data: ${JSON.stringify(extractedData, null, 2).substring(0, 500)}...`);
            return extractedData;
        } else if (response.status === 202) {
            throw new Error('Profile is still being processed by ScrapingDog. Please try again in a few minutes.');
        } else {
            throw new Error(`ScrapingDog API returned status ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ ScrapingDog extraction error:', error.message);
        
        // Handle specific error cases
        if (error.response) {
            const status = error.response.status;
            const message = error.response.data?.message || error.response.statusText;
            
            if (status === 401) {
                throw new Error('ScrapingDog API key is invalid or expired');
            } else if (status === 403) {
                throw new Error('ScrapingDog API access forbidden - check your plan limits or credits');
            } else if (status === 404) {
                throw new Error('LinkedIn profile not found or username is incorrect');
            } else if (status === 429) {
                throw new Error('ScrapingDog rate limit exceeded - please try again later');
            } else if (status === 500) {
                throw new Error('ScrapingDog service temporarily unavailable');
            } else {
                throw new Error(`ScrapingDog API error: ${status} - ${message}`);
            }
        } else if (error.code === 'ECONNABORTED') {
            throw new Error('Request timeout - LinkedIn extraction took too long');
        } else {
            throw new Error(`Network error: ${error.message}`);
        }
    }
};
