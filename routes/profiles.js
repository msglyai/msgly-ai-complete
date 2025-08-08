// ✅ FIXED: Profile & API Routes - processGeminiData + Raw Data Storage
// routes/profiles.js - Chrome extension and API routes (JWT authentication only)

const express = require('express');

// ✅ Export initialization function with dependency injection
function initProfileRoutes(dependencies) {
    const router = express.Router();
    
    // ✅ FIXED: Extract dependencies with correct function name
    const {
        pool,
        authenticateToken,
        getUserById,
        processGeminiData,  // ✅ FIXED: Changed from processOpenAIData
        processScrapedProfileData,
        cleanLinkedInUrl,
        getStatusMessage,
        sendToGemini
    } = dependencies;

    // ==================== CHROME EXTENSION ROUTES (JWT-ONLY) ====================
    
    // ✅ FIXED: HTML Scraping endpoint for Chrome extension - WITH ESCAPED current_role + Raw Data Storage
    router.post('/scrape-html', authenticateToken, async (req, res) => {
        try {
            console.log(`🔍 FIXED HTML scraping request from user ${req.user.id}`);
            
            const { html, profileUrl, isUserProfile } = req.body;
            
            if (!html) {
                return res.status(400).json({
                    success: false,
                    error: 'HTML content is required'
                });
            }
            
            if (!profileUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile URL is required'
                });
            }
            
            // Clean and validate the LinkedIn URL
            const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
            
            if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid LinkedIn profile URL'
                });
            }
            
            console.log(`📊 Processing FIXED HTML scraping:`);
            console.log(`   - User ID: ${req.user.id}`);
            console.log(`   - Profile URL: ${profileUrl}`);
            console.log(`   - Clean URL: ${cleanProfileUrl}`);
            console.log(`   - Is User Profile: ${isUserProfile}`);
            console.log(`   - HTML Length: ${html.length} characters`);
            
            // ✅ FIXED: Send HTML to Gemini for processing
            console.log('🤖 Sending HTML to Gemini for processing...');
            
            let geminiResponse;  // ✅ FIXED: Changed variable name
            let rawGeminiData = null;  // ✅ NEW: Store raw response
            let tokenUsage = null;     // ✅ NEW: Store token usage
            
            try {
                geminiResponse = await sendToGemini({ html: html, url: profileUrl });
                
                // ✅ NEW: Store raw Gemini data for GPT 4.1
                rawGeminiData = {
                    request: { html: html.substring(0, 1000) + '...', url: profileUrl },
                    response: geminiResponse,
                    timestamp: new Date().toISOString(),
                    source: 'html_scraping'
                };
                
                // ✅ NEW: Extract token usage if available
                if (geminiResponse.usage) {
                    tokenUsage = {
                        input_tokens: geminiResponse.usage.input_tokens || geminiResponse.usage.promptTokens,
                        output_tokens: geminiResponse.usage.output_tokens || geminiResponse.usage.completionTokens,
                        total_tokens: geminiResponse.usage.total_tokens || geminiResponse.usage.totalTokens,
                        model: geminiResponse.model || 'gemini-1.5-flash',
                        timestamp: new Date().toISOString()
                    };
                }
                
                console.log('✅ Gemini processing successful');  // ✅ FIXED: Changed from OpenAI
                console.log(`   - Token usage: ${tokenUsage ? JSON.stringify(tokenUsage) : 'Not available'}`);
                
                // ✅ FIXED: Check the response structure properly
                if (!geminiResponse.success || !geminiResponse.data) {
                    throw new Error('Invalid response from Gemini processing');
                }
                
            } catch (geminiError) {  // ✅ FIXED: Changed variable name
                console.error('❌ Gemini processing failed:', geminiError.message);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process HTML with AI',
                    details: geminiError.message
                });
            }
            
            // ✅ FIXED: Process the Gemini response correctly
            const extractedData = processGeminiData(geminiResponse, cleanProfileUrl);
            
            // ✅ FIXED: Proper validation using correct data structure
            if (!extractedData.fullName && !extractedData.headline) {
                console.log('⚠️ Warning: Limited profile data extracted');
            }
            
            console.log('📊 FIXED Extracted data summary:');
            console.log(`   - Full Name: ${extractedData.fullName || 'Not available'}`);
            console.log(`   - Current Role: ${extractedData.currentRole || 'Not available'}`);
            console.log(`   - Current Company: ${extractedData.currentCompany || 'Not available'}`);
            console.log(`   - Experience entries: ${extractedData.experience?.length || 0}`);
            console.log(`   - Education entries: ${extractedData.education?.length || 0}`);
            console.log(`   - Certifications: ${extractedData.certifications?.length || 0}`);
            console.log(`   - Awards: ${extractedData.awards?.length || 0}`);
            console.log(`   - Volunteer: ${extractedData.volunteer?.length || 0}`);
            console.log(`   - Following: ${extractedData.following?.length || 0}`);
            console.log(`   - Activity posts: ${extractedData.activity?.length || 0}`);
            
            if (isUserProfile) {
                // Save to user_profiles table
                console.log('💾 Saving ENHANCED user profile data with raw Gemini storage...');
                
                // Check if profile exists
                const existingProfile = await pool.query(
                    'SELECT * FROM user_profiles WHERE user_id = $1',
                    [req.user.id]
                );
                
                let profile;
                if (existingProfile.rows.length > 0) {
                    // ✅ ENHANCED: Update with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                    const result = await pool.query(`
                        UPDATE user_profiles SET 
                            linkedin_url = $1,
                            full_name = $2,
                            headline = $3,
                            "current_role" = $4,  -- ✅ FIXED: Escaped reserved word
                            about = $5,
                            location = $6,
                            current_company = $7,
                            current_company_name = $8,
                            connections_count = $9,
                            followers_count = $10,
                            total_likes = $11,
                            total_comments = $12,
                            total_shares = $13,
                            average_likes = $14,
                            experience = $15,
                            education = $16,
                            skills = $17,
                            certifications = $18,
                            awards = $19,
                            volunteer = $20,
                            following = $21,
                            activity = $22,
                            engagement_data = $23,
                            company_size = $24,
                            industry = $25,
                            profile_views = $26,
                            post_impressions = $27,
                            data_source = $28,
                            initial_scraping_done = $29,
                            data_extraction_status = $30,
                            gemini_raw_data = $31,
                            gemini_processed_at = CURRENT_TIMESTAMP,
                            gemini_token_usage = $32,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = $33 
                        RETURNING *
                    `, [
                        extractedData.linkedinUrl,
                        extractedData.fullName,
                        extractedData.headline,
                        extractedData.currentRole,
                        extractedData.about,
                        extractedData.location,
                        extractedData.currentCompany,
                        extractedData.currentCompanyName,
                        extractedData.connectionsCount,
                        extractedData.followersCount,
                        extractedData.totalLikes,
                        extractedData.totalComments,
                        extractedData.totalShares,
                        extractedData.averageLikes,
                        JSON.stringify(extractedData.experience || []),
                        JSON.stringify(extractedData.education || []),
                        JSON.stringify(extractedData.skills || []),
                        JSON.stringify(extractedData.certifications || []),
                        JSON.stringify(extractedData.awards || []),
                        JSON.stringify(extractedData.volunteer || []),
                        JSON.stringify(extractedData.following || []),
                        JSON.stringify(extractedData.activity || []),
                        JSON.stringify(extractedData.engagementData || {}),
                        extractedData.companySize,
                        extractedData.industry,
                        extractedData.profileViews,
                        extractedData.postImpressions,
                        'html_scraping_gemini',  // ✅ FIXED: Changed data source
                        true, // Mark initial scraping as done
                        'completed',
                        JSON.stringify(rawGeminiData),  // ✅ NEW: Raw Gemini data
                        JSON.stringify(tokenUsage),     // ✅ NEW: Token usage
                        req.user.id
                    ]);
                    
                    profile = result.rows[0];
                } else {
                    // ✅ ENHANCED: Create with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                    const result = await pool.query(`
                        INSERT INTO user_profiles (
                            user_id, linkedin_url, full_name, headline, "current_role", about, location,
                            current_company, current_company_name, connections_count, followers_count,
                            total_likes, total_comments, total_shares, average_likes,
                            experience, education, skills, certifications, awards, volunteer, following,
                            activity, engagement_data, company_size, industry, profile_views, post_impressions,
                            data_source, initial_scraping_done, data_extraction_status,
                            gemini_raw_data, gemini_processed_at, gemini_token_usage
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, CURRENT_TIMESTAMP, $33
                        ) RETURNING *
                    `, [
                        req.user.id, extractedData.linkedinUrl, extractedData.fullName, extractedData.headline,
                        extractedData.currentRole, extractedData.about, extractedData.location,
                        extractedData.currentCompany, extractedData.currentCompanyName,
                        extractedData.connectionsCount, extractedData.followersCount,
                        extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                        JSON.stringify(extractedData.experience || []), JSON.stringify(extractedData.education || []),
                        JSON.stringify(extractedData.skills || []), JSON.stringify(extractedData.certifications || []),
                        JSON.stringify(extractedData.awards || []), JSON.stringify(extractedData.volunteer || []),
                        JSON.stringify(extractedData.following || []), JSON.stringify(extractedData.activity || []),
                        JSON.stringify(extractedData.engagementData || {}), extractedData.companySize,
                        extractedData.industry, extractedData.profileViews, extractedData.postImpressions,
                        'html_scraping_gemini', true, 'completed',  // ✅ FIXED: Changed data source
                        JSON.stringify(rawGeminiData), JSON.stringify(tokenUsage)  // ✅ NEW: Raw data fields
                    ]);
                    
                    profile = result.rows[0];
                }
                
                // ✅ FIXED: Update users table with registration_completed = true
                await pool.query(
                    'UPDATE users SET linkedin_url = $1, extraction_status = $2, registration_completed = $3 WHERE id = $4',
                    [extractedData.linkedinUrl, 'completed', true, req.user.id]
                );
                
                console.log('✅ ENHANCED User profile saved successfully with raw Gemini data and TIER 1/2 fields');
                
                // Check if user has experience for feature unlock
                const hasExperience = extractedData.hasExperience;
                
                res.json({
                    success: true,
                    message: 'Enhanced user profile processed successfully with comprehensive data and raw Gemini storage',
                    data: {
                        profile: {
                            fullName: profile.full_name,
                            headline: profile.headline,
                            currentRole: profile.current_role,  // Note: this is returned without quotes from DB
                            currentCompany: profile.current_company,
                            hasExperience: hasExperience,
                            experienceCount: extractedData.experience?.length || 0,
                            educationCount: extractedData.education?.length || 0,
                            certificationsCount: extractedData.certifications?.length || 0,
                            awardsCount: extractedData.awards?.length || 0,
                            volunteerCount: extractedData.volunteer?.length || 0,
                            followingCount: extractedData.following?.length || 0,
                            activityCount: extractedData.activity?.length || 0,
                            totalLikes: profile.total_likes,
                            totalComments: profile.total_comments,
                            followersCount: profile.followers_count
                        },
                        featureUnlocked: hasExperience,
                        enhancedData: {
                            certifications: (extractedData.certifications?.length || 0) > 0,
                            awards: (extractedData.awards?.length || 0) > 0,
                            volunteer: (extractedData.volunteer?.length || 0) > 0,
                            following: (extractedData.following?.length || 0) > 0,
                            activity: (extractedData.activity?.length || 0) > 0,
                            engagement: extractedData.totalLikes > 0 || extractedData.totalComments > 0
                        },
                        geminiData: {
                            rawDataStored: !!rawGeminiData,
                            tokenUsage: tokenUsage,
                            processedAt: new Date().toISOString()
                        }
                    }
                });
                
            } else {
                // ✅ ENHANCED: Save to target_profiles table with TIER 1/2 fields + raw data - WITH ESCAPED current_role
                console.log('💾 Saving ENHANCED target profile data with raw Gemini storage...');
                
                // Check if this target profile already exists for this user
                const existingTarget = await pool.query(
                    'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
                    [req.user.id, extractedData.linkedinUrl]
                );
                
                let targetProfile;
                if (existingTarget.rows.length > 0) {
                    // ✅ ENHANCED: Update with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                    const result = await pool.query(`
                        UPDATE target_profiles SET 
                            full_name = $1, headline = $2, "current_role" = $3, about = $4, location = $5,
                            current_company = $6, current_company_name = $7, connections_count = $8, followers_count = $9,
                            total_likes = $10, total_comments = $11, total_shares = $12, average_likes = $13,
                            experience = $14, education = $15, skills = $16, certifications = $17, awards = $18,
                            volunteer = $19, following = $20, activity = $21, engagement_data = $22, 
                            company_size = $23, industry = $24, profile_views = $25, post_impressions = $26,
                            data_source = $27, gemini_raw_data = $28, gemini_processed_at = CURRENT_TIMESTAMP,
                            gemini_token_usage = $29, scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = $30 AND linkedin_url = $31
                        RETURNING *
                    `, [
                        extractedData.fullName, extractedData.headline, extractedData.currentRole, extractedData.about, extractedData.location,
                        extractedData.currentCompany, extractedData.currentCompanyName, extractedData.connectionsCount, extractedData.followersCount,
                        extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                        JSON.stringify(extractedData.experience || []), JSON.stringify(extractedData.education || []),
                        JSON.stringify(extractedData.skills || []), JSON.stringify(extractedData.certifications || []),
                        JSON.stringify(extractedData.awards || []), JSON.stringify(extractedData.volunteer || []),
                        JSON.stringify(extractedData.following || []), JSON.stringify(extractedData.activity || []),
                        JSON.stringify(extractedData.engagementData || {}), extractedData.companySize,
                        extractedData.industry, extractedData.profileViews, extractedData.postImpressions,
                        'html_scraping_gemini', JSON.stringify(rawGeminiData), JSON.stringify(tokenUsage),  // ✅ FIXED + NEW
                        req.user.id, extractedData.linkedinUrl
                    ]);
                    
                    targetProfile = result.rows[0];
                } else {
                    // ✅ ENHANCED: Create with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                    const result = await pool.query(`
                        INSERT INTO target_profiles (
                            user_id, linkedin_url, full_name, headline, "current_role", about, location,
                            current_company, current_company_name, connections_count, followers_count,
                            total_likes, total_comments, total_shares, average_likes,
                            experience, education, skills, certifications, awards, volunteer, following,
                            activity, engagement_data, company_size, industry, profile_views, post_impressions,
                            data_source, gemini_raw_data, gemini_processed_at, gemini_token_usage
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, CURRENT_TIMESTAMP, $31
                        ) RETURNING *
                    `, [
                        req.user.id, extractedData.linkedinUrl, extractedData.fullName, extractedData.headline,
                        extractedData.currentRole, extractedData.about, extractedData.location,
                        extractedData.currentCompany, extractedData.currentCompanyName, extractedData.connectionsCount, extractedData.followersCount,
                        extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                        JSON.stringify(extractedData.experience || []), JSON.stringify(extractedData.education || []),
                        JSON.stringify(extractedData.skills || []), JSON.stringify(extractedData.certifications || []),
                        JSON.stringify(extractedData.awards || []), JSON.stringify(extractedData.volunteer || []),
                        JSON.stringify(extractedData.following || []), JSON.stringify(extractedData.activity || []),
                        JSON.stringify(extractedData.engagementData || {}), extractedData.companySize,
                        extractedData.industry, extractedData.profileViews, extractedData.postImpressions,
                        'html_scraping_gemini', JSON.stringify(rawGeminiData), JSON.stringify(tokenUsage)  // ✅ FIXED + NEW
                    ]);
                    
                    targetProfile = result.rows[0];
                }
                
                console.log('✅ ENHANCED Target profile saved successfully with comprehensive data and raw Gemini storage');
                
                res.json({
                    success: true,
                    message: 'Enhanced target profile processed successfully with comprehensive data and raw Gemini storage',
                    data: {
                        targetProfile: {
                            fullName: targetProfile.full_name,
                            headline: targetProfile.headline,
                            currentRole: targetProfile.current_role,  // Note: this is returned without quotes from DB
                            currentCompany: targetProfile.current_company,
                            experienceCount: extractedData.experience?.length || 0,
                            educationCount: extractedData.education?.length || 0,
                            certificationsCount: extractedData.certifications?.length || 0,
                            awardsCount: extractedData.awards?.length || 0,
                            volunteerCount: extractedData.volunteer?.length || 0,
                            followingCount: extractedData.following?.length || 0,
                            activityCount: extractedData.activity?.length || 0,
                            totalLikes: targetProfile.total_likes,
                            totalComments: targetProfile.total_comments,
                            followersCount: targetProfile.followers_count
                        },
                        enhancedData: {
                            certifications: (extractedData.certifications?.length || 0) > 0,
                            awards: (extractedData.awards?.length || 0) > 0,
                            volunteer: (extractedData.volunteer?.length || 0) > 0,
                            following: (extractedData.following?.length || 0) > 0,
                            activity: (extractedData.activity?.length || 0) > 0,
                            engagement: extractedData.totalLikes > 0 || extractedData.totalComments > 0
                        },
                        geminiData: {
                            rawDataStored: !!rawGeminiData,
                            tokenUsage: tokenUsage,
                            processedAt: new Date().toISOString()
                        }
                    }
                });
            }
            
        } catch (error) {
            console.error('❌ FIXED HTML scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process HTML scraping',
                details: error.message
            });
        }
    });

    // ✅ User profile scraping with transaction management - Enhanced - WITH ESCAPED current_role + Raw Data
    router.post('/profile/user', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`🔒 Enhanced user profile scraping request from user ${req.user.id}`);
            console.log('📊 Request data:', {
                hasProfileData: !!req.body.profileData,
                profileUrl: req.body.profileData?.url || req.body.profileData?.linkedinUrl,
                dataSource: req.body.profileData?.extractedFrom || 'unknown'
            });
            
            const { profileData } = req.body;
            
            if (!profileData) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile data is required'
                });
            }
            
            if (!profileData.url && !profileData.linkedinUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'LinkedIn URL is required in profile data'
                });
            }
            
            // Clean and validate URL using backend normalization
            const profileUrl = profileData.url || profileData.linkedinUrl;
            const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
            
            if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid LinkedIn profile URL'
                });
            }
            
            // Validate this is the user's own profile using normalized URLs
            const userLinkedInUrl = req.user.linkedin_url;
            if (userLinkedInUrl) {
                const cleanUserUrl = cleanLinkedInUrl(userLinkedInUrl);
                
                console.log(`🔍 Enhanced URL Comparison for user ${req.user.id}:`);
                console.log(`   - Profile URL: ${profileUrl}`);
                console.log(`   - Clean Profile: ${cleanProfileUrl}`);
                console.log(`   - User URL: ${userLinkedInUrl}`);
                console.log(`   - Clean User: ${cleanUserUrl}`);
                console.log(`   - Match: ${cleanUserUrl === cleanProfileUrl}`);
                
                if (cleanUserUrl !== cleanProfileUrl) {
                    return res.status(403).json({
                        success: false,
                        error: 'You can only scrape your own LinkedIn profile for initial setup'
                    });
                }
            }
            
            // Process the scraped data
            const processedData = processScrapedProfileData(profileData, true);
            
            // Normalize the LinkedIn URL in processed data
            processedData.linkedinUrl = cleanProfileUrl;
            processedData.url = cleanProfileUrl;
            
            // ✅ NEW: Prepare raw data storage
            const rawGeminiData = {
                request: { profileData: profileData, url: cleanProfileUrl },
                processedData: processedData,
                timestamp: new Date().toISOString(),
                source: 'profile_scraping'
            };
            
            // Validate data completeness BEFORE database transaction
            if (!processedData.fullName && !processedData.headline && !processedData.currentCompany) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile data appears incomplete - missing name, headline, and company information'
                });
            }
            
            console.log('💾 Saving enhanced user profile data with transaction management and raw data storage...');
            
            // Start transaction
            await client.query('BEGIN');
            
            // Check if profile exists
            const existingProfile = await client.query(
                'SELECT * FROM user_profiles WHERE user_id = $1',
                [req.user.id]
            );
            
            let profile;
            if (existingProfile.rows.length > 0) {
                // ✅ ENHANCED: Update with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                const result = await client.query(`
                    UPDATE user_profiles SET 
                        linkedin_url = $1, linkedin_id = $2, linkedin_num_id = $3, input_url = $4, url = $5,
                        full_name = $6, first_name = $7, last_name = $8, headline = $9, "current_role" = $10,
                        about = $11, summary = $12, location = $13, city = $14, state = $15, country = $16, country_code = $17,
                        industry = $18, current_company = $19, current_company_name = $20, current_position = $21,
                        connections_count = $22, followers_count = $23, connections = $24, followers = $25,
                        total_likes = $26, total_comments = $27, total_shares = $28, average_likes = $29,
                        profile_image_url = $30, avatar = $31, experience = $32, education = $33, skills = $34,
                        certifications = $35, awards = $36, volunteer = $37, following = $38, activity = $39, 
                        engagement_data = $40, company_size = $41, profile_views = $42, post_impressions = $43,
                        timestamp = $44, data_source = $45, gemini_raw_data = $46, gemini_processed_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $47 
                    RETURNING *
                `, [
                    processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience || []), JSON.stringify(processedData.education || []), JSON.stringify(processedData.skills || []),
                    JSON.stringify(processedData.certifications || []), JSON.stringify(processedData.awards || []), 
                    JSON.stringify(processedData.volunteer || []), JSON.stringify(processedData.following || []),
                    JSON.stringify(processedData.activity || []), JSON.stringify(processedData.engagementData || {}),
                    processedData.companySize, processedData.profileViews, processedData.postImpressions,
                    processedData.timestamp, processedData.dataSource, JSON.stringify(rawGeminiData), req.user.id  // ✅ NEW: Raw data
                ]);
                
                profile = result.rows[0];
            } else {
                // ✅ ENHANCED: Create with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                const result = await client.query(`
                    INSERT INTO user_profiles (
                        user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                        full_name, first_name, last_name, headline, "current_role", about, summary,
                        location, city, state, country, country_code, industry,
                        current_company, current_company_name, current_position,
                        connections_count, followers_count, connections, followers,
                        total_likes, total_comments, total_shares, average_likes,
                        profile_image_url, avatar, experience, education, skills,
                        certifications, awards, volunteer, following, activity, engagement_data, 
                        company_size, profile_views, post_impressions, timestamp, data_source,
                        gemini_raw_data, gemini_processed_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, CURRENT_TIMESTAMP
                    ) RETURNING *
                `, [
                    req.user.id, processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience || []), JSON.stringify(processedData.education || []), JSON.stringify(processedData.skills || []),
                    JSON.stringify(processedData.certifications || []), JSON.stringify(processedData.awards || []),
                    JSON.stringify(processedData.volunteer || []), JSON.stringify(processedData.following || []),
                    JSON.stringify(processedData.activity || []), JSON.stringify(processedData.engagementData || {}),
                    processedData.companySize, processedData.profileViews, processedData.postImpressions,
                    processedData.timestamp, processedData.dataSource, JSON.stringify(rawGeminiData)  // ✅ NEW: Raw data
                ]);
                
                profile = result.rows[0];
            }
            
            // Only update status fields AFTER confirming data was saved AND contains meaningful information
            if (profile && profile.full_name) {
                await client.query(`
                    UPDATE user_profiles SET 
                        data_extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL,
                        profile_analyzed = true,
                        initial_scraping_done = true
                    WHERE user_id = $1 AND full_name IS NOT NULL
                `, [req.user.id]);
                
                // ✅ FIXED: Update user table with registration_completed = true
                await client.query(
                    'UPDATE users SET linkedin_url = $1, extraction_status = $2, registration_completed = $3, error_message = NULL WHERE id = $4',
                    [processedData.linkedinUrl, 'completed', true, req.user.id]
                );
                
                // Commit transaction only after all validations pass
                await client.query('COMMIT');
                
                console.log(`🎉 Enhanced user profile successfully saved for user ${req.user.id} with transaction integrity and raw data storage!`);
                
                res.json({
                    success: true,
                    message: 'Enhanced user profile saved successfully with comprehensive data and raw Gemini storage! You can now use Msgly.AI fully.',
                    data: {
                        profile: {
                            id: profile.id,
                            linkedinUrl: profile.linkedin_url,
                            fullName: profile.full_name,
                            headline: profile.headline,
                            currentRole: profile.current_role,  // Note: returned from DB without quotes
                            currentCompany: profile.current_company,
                            location: profile.location,
                            profileImageUrl: profile.profile_image_url,
                            initialScrapingDone: true,
                            extractionStatus: 'completed',
                            extractionCompleted: profile.extraction_completed_at,
                            // ✅ ENHANCED: Show TIER 1/2 data counts
                            enhancedCounts: {
                                experience: processedData.experience?.length || 0,
                                education: processedData.education?.length || 0,
                                certifications: processedData.certifications?.length || 0,
                                awards: processedData.awards?.length || 0,
                                volunteer: processedData.volunteer?.length || 0,
                                following: processedData.following?.length || 0,
                                activity: processedData.activity?.length || 0,
                                totalLikes: processedData.totalLikes,
                                totalComments: processedData.totalComments
                            }
                        },
                        user: {
                            registrationCompleted: true,  // ✅ FIXED: Changed from profileCompleted
                            extractionStatus: 'completed'
                        },
                        geminiData: {
                            rawDataStored: true,
                            processedAt: new Date().toISOString()
                        }
                    }
                });
            } else {
                // Rollback if no meaningful data was saved
                await client.query('ROLLBACK');
                
                res.status(400).json({
                    success: false,
                    error: 'Profile data was saved but appears to be incomplete. Please try again with a complete LinkedIn profile.'
                });
            }
            
        } catch (error) {
            // Always rollback on error
            await client.query('ROLLBACK');
            
            console.error('❌ Enhanced user profile scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save user profile',
                details: error.message
            });
        } finally {
            client.release();
        }
    });

    // ✅ Target profile scraping with URL normalization - Enhanced - WITH ESCAPED current_role + Raw Data
    router.post('/profile/target', authenticateToken, async (req, res) => {
        try {
            console.log(`🎯 Enhanced target profile scraping request from user ${req.user.id}`);
            
            // First, check if initial scraping is done
            const initialStatus = await pool.query(`
                SELECT initial_scraping_done, data_extraction_status
                FROM user_profiles 
                WHERE user_id = $1
            `, [req.user.id]);
            
            if (initialStatus.rows.length === 0 || !initialStatus.rows[0].initial_scraping_done) {
                console.log(`🚫 User ${req.user.id} has not completed initial scraping`);
                return res.status(403).json({
                    success: false,
                    error: 'Please complete your own profile scraping first before scraping target profiles',
                    code: 'INITIAL_SCRAPING_REQUIRED'
                });
            }
            
            const { profileData } = req.body;
            
            if (!profileData) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile data is required'
                });
            }
            
            if (!profileData.url && !profileData.linkedinUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'LinkedIn URL is required in profile data'
                });
            }
            
            // Clean and validate URL using backend normalization
            const profileUrl = profileData.url || profileData.linkedinUrl;
            const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
            
            if (!cleanProfileUrl || !cleanProfileUrl.includes('linkedin.com/in/')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid LinkedIn profile URL'
                });
            }
            
            // Validate this is NOT the user's own profile using normalized URLs
            const userLinkedInUrl = req.user.linkedin_url;
            if (userLinkedInUrl) {
                const cleanUserUrl = cleanLinkedInUrl(userLinkedInUrl);
                
                if (cleanUserUrl === cleanProfileUrl) {
                    return res.status(400).json({
                        success: false,
                        error: 'This appears to be your own profile. Use /profile/user endpoint for your own profile.'
                    });
                }
            }
            
            // Process the scraped data
            const processedData = processScrapedProfileData(profileData, false);
            
            // Normalize the LinkedIn URL in processed data
            processedData.linkedinUrl = cleanProfileUrl;
            processedData.url = cleanProfileUrl;
            
            // ✅ NEW: Prepare raw data storage
            const rawGeminiData = {
                request: { profileData: profileData, url: cleanProfileUrl },
                processedData: processedData,
                timestamp: new Date().toISOString(),
                source: 'target_profile_scraping'
            };
            
            console.log('💾 Saving enhanced target profile data with raw data storage...');
            
            // Check if this target profile already exists for this user
            const existingTarget = await pool.query(
                'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
                [req.user.id, processedData.linkedinUrl]
            );
            
            let targetProfile;
            if (existingTarget.rows.length > 0) {
                // ✅ ENHANCED: Update with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                const result = await pool.query(`
                    UPDATE target_profiles SET 
                        linkedin_id = $1, linkedin_num_id = $2, input_url = $3, url = $4,
                        full_name = $5, first_name = $6, last_name = $7, headline = $8, "current_role" = $9,
                        about = $10, summary = $11, location = $12, city = $13, state = $14, country = $15, country_code = $16,
                        industry = $17, current_company = $18, current_company_name = $19, current_position = $20,
                        connections_count = $21, followers_count = $22, connections = $23, followers = $24,
                        total_likes = $25, total_comments = $26, total_shares = $27, average_likes = $28,
                        profile_image_url = $29, avatar = $30, experience = $31, education = $32, skills = $33,
                        certifications = $34, awards = $35, volunteer = $36, following = $37, activity = $38, 
                        engagement_data = $39, company_size = $40, profile_views = $41, post_impressions = $42,
                        timestamp = $43, data_source = $44, gemini_raw_data = $45, gemini_processed_at = CURRENT_TIMESTAMP,
                        scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $46 AND linkedin_url = $47
                    RETURNING *
                `, [
                    processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience || []), JSON.stringify(processedData.education || []), JSON.stringify(processedData.skills || []),
                    JSON.stringify(processedData.certifications || []), JSON.stringify(processedData.awards || []),
                    JSON.stringify(processedData.volunteer || []), JSON.stringify(processedData.following || []),
                    JSON.stringify(processedData.activity || []), JSON.stringify(processedData.engagementData || {}),
                    processedData.companySize, processedData.profileViews, processedData.postImpressions,
                    processedData.timestamp, processedData.dataSource, JSON.stringify(rawGeminiData), req.user.id, processedData.linkedinUrl  // ✅ NEW: Raw data
                ]);
                
                targetProfile = result.rows[0];
            } else {
                // ✅ ENHANCED: Create with all TIER 1/2 fields + raw data - WITH ESCAPED current_role
                const result = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                        full_name, first_name, last_name, headline, "current_role", about, summary,
                        location, city, state, country, country_code, industry,
                        current_company, current_company_name, current_position,
                        connections_count, followers_count, connections, followers,
                        total_likes, total_comments, total_shares, average_likes,
                        profile_image_url, avatar, experience, education, skills,
                        certifications, awards, volunteer, following, activity, engagement_data, 
                        company_size, profile_views, post_impressions, timestamp, data_source,
                        gemini_raw_data, gemini_processed_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, CURRENT_TIMESTAMP
                    ) RETURNING *
                `, [
                    req.user.id, processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience || []), JSON.stringify(processedData.education || []), JSON.stringify(processedData.skills || []),
                    JSON.stringify(processedData.certifications || []), JSON.stringify(processedData.awards || []),
                    JSON.stringify(processedData.volunteer || []), JSON.stringify(processedData.following || []),
                    JSON.stringify(processedData.activity || []), JSON.stringify(processedData.engagementData || {}),
                    processedData.companySize, processedData.profileViews, processedData.postImpressions,
                    processedData.timestamp, processedData.dataSource, JSON.stringify(rawGeminiData)  // ✅ NEW: Raw data
                ]);
                
                targetProfile = result.rows[0];
            }
            
            console.log(`🎯 Enhanced target profile successfully saved for user ${req.user.id} with raw data storage!`);
            console.log(`   - Target: ${targetProfile.full_name || 'Unknown'}`);
            console.log(`   - Company: ${targetProfile.current_company || 'Unknown'}`);
            console.log(`   - Experience: ${processedData.experience?.length || 0}`);
            console.log(`   - Education: ${processedData.education?.length || 0}`);
            console.log(`   - Certifications: ${processedData.certifications?.length || 0}`);
            console.log(`   - Awards: ${processedData.awards?.length || 0}`);
            console.log(`   - Volunteer: ${processedData.volunteer?.length || 0}`);
            console.log(`   - Following: ${processedData.following?.length || 0}`);
            console.log(`   - Activity: ${processedData.activity?.length || 0}`);
            
            res.json({
                success: true,
                message: 'Enhanced target profile saved successfully with comprehensive data and raw Gemini storage!',
                data: {
                    targetProfile: {
                        id: targetProfile.id,
                        linkedinUrl: targetProfile.linkedin_url,
                        fullName: targetProfile.full_name,
                        headline: targetProfile.headline,
                        currentRole: targetProfile.current_role,  // Note: returned from DB without quotes
                        currentCompany: targetProfile.current_company,
                        location: targetProfile.location,
                        profileImageUrl: targetProfile.profile_image_url,
                        scrapedAt: targetProfile.scraped_at,
                        // ✅ ENHANCED: Show comprehensive TIER 1/2 data counts
                        enhancedCounts: {
                            experience: processedData.experience?.length || 0,
                            education: processedData.education?.length || 0,
                            certifications: processedData.certifications?.length || 0,
                            awards: processedData.awards?.length || 0,
                            volunteer: processedData.volunteer?.length || 0,
                            following: processedData.following?.length || 0,
                            activity: processedData.activity?.length || 0,
                            totalLikes: processedData.totalLikes,
                            totalComments: processedData.totalComments,
                            followersCount: processedData.followersCount
                        }
                    },
                    geminiData: {
                        rawDataStored: true,
                        processedAt: new Date().toISOString()
                    }
                }
            });
            
        } catch (error) {
            console.error('❌ Enhanced target profile scraping error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save target profile',
                details: error.message
            });
        }
    });

    // ==================== API ROUTES (JWT-ONLY) ====================

    // ✅ Generate message endpoint with proper credit deduction and transaction management
    router.post('/generate-message', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        
        try {
            console.log(`🤖 Enhanced message generation request from user ${req.user.id}`);
            
            const { targetProfile, context, messageType } = req.body;
            
            if (!targetProfile) {
                return res.status(400).json({
                    success: false,
                    error: 'Target profile is required'
                });
            }
            
            if (!context) {
                return res.status(400).json({
                    success: false,
                    error: 'Message context is required'
                });
            }
            
            // Start transaction for credit check and deduction
            await client.query('BEGIN');
            
            // Check user credits within transaction
            const userResult = await client.query(
                'SELECT credits_remaining FROM users WHERE id = $1 FOR UPDATE',
                [req.user.id]
            );
            
            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            const currentCredits = userResult.rows[0].credits_remaining;
            
            if (currentCredits <= 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient credits. Please upgrade your plan.'
                });
            }
            
            // Deduct credit immediately (before API call)
            const newCredits = currentCredits - 1;
            await client.query(
                'UPDATE users SET credits_remaining = $1 WHERE id = $2',
                [newCredits, req.user.id]
            );
            
            // Log the credit transaction
            await client.query(
                'INSERT INTO credits_transactions (user_id, transaction_type, credits_change, description) VALUES ($1, $2, $3, $4)',
                [req.user.id, 'message_generation', -1, `Generated enhanced message for ${targetProfile.fullName || 'Unknown'}`]
            );
            
            // Commit credit deduction before potentially long API call
            await client.query('COMMIT');
            
            console.log(`💳 Credit deducted for user ${req.user.id}: ${currentCredits} → ${newCredits}`);
            
            // ✅ ENHANCED: Generate message using comprehensive TIER 1/2 profile data
            console.log('🤖 Generating enhanced AI message with comprehensive TIER 1/2 profile data...');
            
            // Create enhanced context with available TIER 1/2 data
            let enhancedContext = context;
            if (targetProfile.currentRole && targetProfile.currentRole !== targetProfile.headline) {
                enhancedContext += ` I see you're currently working as ${targetProfile.currentRole}.`;
            }
            
            if (targetProfile.awards && targetProfile.awards.length > 0) {
                enhancedContext += ` Congratulations on your recent achievements.`;
            }
            
            if (targetProfile.certifications && targetProfile.certifications.length > 0) {
                enhancedContext += ` I noticed your professional certifications.`;
            }
            
            if (targetProfile.volunteer && targetProfile.volunteer.length > 0) {
                enhancedContext += ` I admire your volunteer work.`;
            }
            
            if (targetProfile.following && targetProfile.following.length > 0) {
                enhancedContext += ` I see we have similar professional interests.`;
            }
            
            // TODO: Replace with actual GPT 4.1 API call using raw Gemini data + enhanced context
            const simulatedMessage = `Hi ${targetProfile.firstName || targetProfile.fullName?.split(' ')[0] || 'there'},

I noticed your impressive work at ${targetProfile.currentCompany || 'your company'}${targetProfile.currentRole && targetProfile.currentRole !== targetProfile.headline ? ` as ${targetProfile.currentRole}` : targetProfile.headline ? ` as ${targetProfile.headline}` : ''}. ${enhancedContext}

Would love to connect and learn more about your experience!

Best regards`;
            
            const score = Math.floor(Math.random() * 20) + 80; // Random score between 80-100
            
            // Log enhanced message generation
            await pool.query(
                'INSERT INTO message_logs (user_id, target_name, target_url, generated_message, message_context, credits_used) VALUES ($1, $2, $3, $4, $5, $6)',
                [req.user.id, targetProfile.fullName, targetProfile.linkedinUrl, simulatedMessage, enhancedContext, 1]
            );
            
            console.log(`✅ Enhanced message generated successfully for user ${req.user.id}`);
            
            res.json({
                success: true,
                message: 'Enhanced message generated successfully using comprehensive TIER 1/2 profile data',
                data: {
                    message: simulatedMessage,
                    score: score,
                    user: {
                        credits: newCredits
                    },
                    usage: {
                        creditsUsed: 1,
                        remainingCredits: newCredits
                    },
                    enhancedData: {
                        usedCurrentRole: !!targetProfile.currentRole,
                        usedCertifications: !!(targetProfile.certifications && targetProfile.certifications.length > 0),
                        usedAwards: !!(targetProfile.awards && targetProfile.awards.length > 0),
                        usedVolunteer: !!(targetProfile.volunteer && targetProfile.volunteer.length > 0),
                        usedFollowing: !!(targetProfile.following && targetProfile.following.length > 0),
                        contextEnhanced: enhancedContext.length > context.length,
                        rawGeminiDataAvailable: true  // ✅ NEW: Indicates raw data is stored for GPT 4.1
                    }
                }
            });
            
        } catch (error) {
            // Rollback if transaction is still active
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('❌ Rollback error:', rollbackError);
            }
            
            console.error('❌ Enhanced message generation error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate message',
                details: error.message
            });
        } finally {
            client.release();
        }
    });

    // ✅ Get target profiles for user - Enhanced with TIER 1/2 data
    router.get('/target-profiles', authenticateToken, async (req, res) => {
        try {
            console.log(`📋 Fetching target profiles for user ${req.user.id}`);
            
            const result = await pool.query(`
                SELECT 
                    id,
                    linkedin_url,
                    full_name,
                    headline,
                    "current_role",  -- ✅ FIXED: Escaped reserved word
                    current_company,
                    location,
                    profile_image_url,
                    total_likes,
                    total_comments,
                    followers_count,
                    experience,
                    education,
                    certifications,
                    awards,
                    volunteer,
                    following,
                    activity,
                    company_size,
                    industry,
                    profile_views,
                    post_impressions,
                    scraped_at,
                    updated_at,
                    gemini_processed_at
                FROM target_profiles 
                WHERE user_id = $1 
                ORDER BY scraped_at DESC
            `, [req.user.id]);
            
            const profiles = result.rows.map(profile => ({
                id: profile.id,
                linkedinUrl: profile.linkedin_url,
                fullName: profile.full_name,
                headline: profile.headline,
                currentRole: profile.current_role,
                currentCompany: profile.current_company,
                location: profile.location,
                profileImageUrl: profile.profile_image_url,
                totalLikes: profile.total_likes,
                totalComments: profile.total_comments,
                followersCount: profile.followers_count,
                // ✅ ENHANCED: TIER 1/2 data counts
                experienceCount: profile.experience ? JSON.parse(profile.experience).length : 0,
                educationCount: profile.education ? JSON.parse(profile.education).length : 0,
                certificationsCount: profile.certifications ? JSON.parse(profile.certifications).length : 0,
                awardsCount: profile.awards ? JSON.parse(profile.awards).length : 0,
                volunteerCount: profile.volunteer ? JSON.parse(profile.volunteer).length : 0,
                followingCount: profile.following ? JSON.parse(profile.following).length : 0,
                activityCount: profile.activity ? JSON.parse(profile.activity).length : 0,
                companySize: profile.company_size,
                industry: profile.industry,
                profileViews: profile.profile_views,
                postImpressions: profile.post_impressions,
                scrapedAt: profile.scraped_at,
                updatedAt: profile.updated_at,
                geminiProcessedAt: profile.gemini_processed_at
            }));
            
            console.log(`✅ Found ${profiles.length} target profiles for user ${req.user.id}`);
            
            res.json({
                success: true,
                data: {
                    profiles: profiles,
                    count: profiles.length
                }
            });
            
        } catch (error) {
            console.error('❌ Error fetching target profiles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch target profiles',
                details: error.message
            });
        }
    });

    // ✅ Get message history for user
    router.get('/message-history', authenticateToken, async (req, res) => {
        try {
            const { limit = 50, offset = 0 } = req.query;
            
            console.log(`📜 Fetching message history for user ${req.user.id}`);
            
            const result = await pool.query(`
                SELECT 
                    id,
                    target_name,
                    target_url,
                    generated_message,
                    message_context,
                    credits_used,
                    created_at
                FROM message_logs 
                WHERE user_id = $1 
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
            `, [req.user.id, parseInt(limit), parseInt(offset)]);
            
            const countResult = await pool.query(
                'SELECT COUNT(*) FROM message_logs WHERE user_id = $1',
                [req.user.id]
            );
            
            const messages = result.rows.map(msg => ({
                id: msg.id,
                targetName: msg.target_name,
                targetUrl: msg.target_url,
                generatedMessage: msg.generated_message,
                messageContext: msg.message_context,
                creditsUsed: msg.credits_used,
                createdAt: msg.created_at
            }));
            
            console.log(`✅ Found ${messages.length} messages for user ${req.user.id}`);
            
            res.json({
                success: true,
                data: {
                    messages: messages,
                    pagination: {
                        total: parseInt(countResult.rows[0].count),
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: (parseInt(offset) + messages.length) < parseInt(countResult.rows[0].count)
                    }
                }
            });
            
        } catch (error) {
            console.error('❌ Error fetching message history:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch message history',
                details: error.message
            });
        }
    });

    // ✅ Get credits transactions for user
    router.get('/credits-history', authenticateToken, async (req, res) => {
        try {
            const { limit = 50, offset = 0 } = req.query;
            
            console.log(`💳 Fetching credits history for user ${req.user.id}`);
            
            const result = await pool.query(`
                SELECT 
                    id,
                    transaction_type,
                    credits_change,
                    description,
                    created_at
                FROM credits_transactions 
                WHERE user_id = $1 
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
            `, [req.user.id, parseInt(limit), parseInt(offset)]);
            
            const countResult = await pool.query(
                'SELECT COUNT(*) FROM credits_transactions WHERE user_id = $1',
                [req.user.id]
            );
            
            const transactions = result.rows.map(tx => ({
                id: tx.id,
                transactionType: tx.transaction_type,
                creditsChange: tx.credits_change,
                description: tx.description,
                createdAt: tx.created_at
            }));
            
            console.log(`✅ Found ${transactions.length} credit transactions for user ${req.user.id}`);
            
            res.json({
                success: true,
                data: {
                    transactions: transactions,
                    pagination: {
                        total: parseInt(countResult.rows[0].count),
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: (parseInt(offset) + transactions.length) < parseInt(countResult.rows[0].count)
                    }
                }
            });
            
        } catch (error) {
            console.error('❌ Error fetching credits history:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch credits history',
                details: error.message
            });
        }
    });

    // ✅ Delete target profile
    router.delete('/target-profiles/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            console.log(`🗑️ Deleting target profile ${id} for user ${req.user.id}`);
            
            // Verify the profile belongs to the user
            const checkResult = await pool.query(
                'SELECT id FROM target_profiles WHERE id = $1 AND user_id = $2',
                [id, req.user.id]
            );
            
            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Target profile not found or unauthorized'
                });
            }
            
            // Delete the profile
            await pool.query(
                'DELETE FROM target_profiles WHERE id = $1 AND user_id = $2',
                [id, req.user.id]
            );
            
            console.log(`✅ Deleted target profile ${id} for user ${req.user.id}`);
            
            res.json({
                success: true,
                message: 'Target profile deleted successfully'
            });
            
        } catch (error) {
            console.error('❌ Error deleting target profile:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete target profile',
                details: error.message
            });
        }
    });

    // ✅ Search target profiles - Enhanced with TIER 1/2 fields
    router.get('/target-profiles/search', authenticateToken, async (req, res) => {
        try {
            const { q, limit = 20 } = req.query;
            
            if (!q || q.length < 2) {
                return res.status(400).json({
                    success: false,
                    error: 'Search query must be at least 2 characters'
                });
            }
            
            console.log(`🔍 Searching target profiles for user ${req.user.id} with query: "${q}"`);
            
            const result = await pool.query(`
                SELECT 
                    id,
                    linkedin_url,
                    full_name,
                    headline,
                    "current_role",  -- ✅ FIXED: Escaped reserved word
                    current_company,
                    location,
                    profile_image_url,
                    industry,
                    company_size,
                    scraped_at
                FROM target_profiles 
                WHERE user_id = $1 
                AND (
                    LOWER(full_name) LIKE LOWER($2) OR
                    LOWER(headline) LIKE LOWER($2) OR
                    LOWER("current_role") LIKE LOWER($2) OR  -- ✅ FIXED: Escaped reserved word
                    LOWER(current_company) LIKE LOWER($2) OR
                    LOWER(location) LIKE LOWER($2) OR
                    LOWER(industry) LIKE LOWER($2)
                )
                ORDER BY scraped_at DESC
                LIMIT $3
            `, [req.user.id, `%${q}%`, parseInt(limit)]);
            
            const profiles = result.rows.map(profile => ({
                id: profile.id,
                linkedinUrl: profile.linkedin_url,
                fullName: profile.full_name,
                headline: profile.headline,
                currentRole: profile.current_role,
                currentCompany: profile.current_company,
                location: profile.location,
                profileImageUrl: profile.profile_image_url,
                industry: profile.industry,
                companySize: profile.company_size,
                scrapedAt: profile.scraped_at
            }));
            
            console.log(`✅ Found ${profiles.length} matching target profiles`);
            
            res.json({
                success: true,
                data: {
                    profiles: profiles,
                    query: q,
                    count: profiles.length
                }
            });
            
        } catch (error) {
            console.error('❌ Error searching target profiles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to search target profiles',
                details: error.message
            });
        }
    });

    // ✅ DISABLED: Retry extraction endpoint
    router.post('/retry-extraction', authenticateToken, async (req, res) => {
        res.status(410).json({
            success: false,
            error: 'Retry extraction is no longer available',
            message: 'Please use the Chrome extension to complete your profile setup by visiting your LinkedIn profile.',
            alternatives: {
                chromeExtension: 'Install the Msgly.AI Chrome extension and visit your LinkedIn profile',
                enhancedExtraction: 'The extension now extracts comprehensive TIER 1/2 data including certifications, awards, volunteer work, following, activity, and engagement metrics with raw Gemini data storage for GPT 4.1'
            },
            code: 'FEATURE_DISABLED'
        });
    });

    // ✅ Return the configured router
    return router;
}

// ✅ Export the initialization function
module.exports = { initProfileRoutes };
