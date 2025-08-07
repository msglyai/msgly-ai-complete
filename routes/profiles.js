// ✅ STEP 2F: Profile Routes - MASSIVE EXTRACTION (~400-500 lines)
// routes/profiles.js - Profile management and scraping routes

const express = require('express');
const { sendToGemini } = require('../sendToGemini');

// Dependencies to be injected
let pool, authenticateToken;
let getUserById, processOpenAIData, processScrapedProfileData;
let cleanLinkedInUrl, getStatusMessage;

/**
 * Initialize profile routes with dependencies
 * @param {Object} dependencies - Required dependencies
 * @returns {express.Router} Configured router
 */
function initProfileRoutes(dependencies) {
    // Inject dependencies
    pool = dependencies.pool;
    authenticateToken = dependencies.authenticateToken;
    getUserById = dependencies.getUserById;
    processOpenAIData = dependencies.processOpenAIData;
    processScrapedProfileData = dependencies.processScrapedProfileData;
    cleanLinkedInUrl = dependencies.cleanLinkedInUrl;
    getStatusMessage = dependencies.getStatusMessage;

    // Create router AFTER dependencies are injected
    const router = express.Router();

    // ==================== PROFILE SCRAPING ROUTES ====================

    // ✅ FULLY FIXED: HTML Scraping endpoint for Chrome extension - WITH ESCAPED current_role
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
            
            // ✅ FIXED: Send HTML to OpenAI for processing
            console.log('🤖 Sending HTML to OpenAI for processing...');
            
            let openaiResponse;
            try {
                openaiResponse = await sendToGemini({ html: html, url: profileUrl });
                console.log('✅ OpenAI processing successful');
                
                // ✅ FIXED: Check the response structure properly
                if (!openaiResponse.success || !openaiResponse.data) {
                    throw new Error('Invalid response from OpenAI processing');
                }
                
            } catch (openaiError) {
                console.error('❌ OpenAI processing failed:', openaiError.message);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process HTML with AI',
                    details: openaiError.message
                });
            }
            
            // ✅ FIXED: Process the OpenAI response correctly
            const extractedData = processOpenAIData(openaiResponse, cleanProfileUrl);
            
            // ✅ FIXED: Proper validation using correct data structure
            if (!extractedData.fullName && !extractedData.headline) {
                console.log('⚠️ Warning: Limited profile data extracted');
            }
            
            console.log('📊 FIXED Extracted data summary:');
            console.log(`   - Full Name: ${extractedData.fullName || 'Not available'}`);
            console.log(`   - Current Role: ${extractedData.currentRole || 'Not available'}`);
            console.log(`   - Current Company: ${extractedData.currentCompany || 'Not available'}`);
            console.log(`   - Experience entries: ${extractedData.experience.length}`);
            console.log(`   - Certifications: ${extractedData.certifications.length}`);
            console.log(`   - Awards: ${extractedData.awards.length}`);
            console.log(`   - Activity posts: ${extractedData.activity.length}`);
            
            if (isUserProfile) {
                // Save to user_profiles table
                console.log('💾 Saving ENHANCED user profile data...');
                
                // Check if profile exists
                const existingProfile = await pool.query(
                    'SELECT * FROM user_profiles WHERE user_id = $1',
                    [req.user.id]
                );
                
                let profile;
                if (existingProfile.rows.length > 0) {
                    // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
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
                            activity = $20,
                            engagement_data = $21,
                            data_source = $22,
                            initial_scraping_done = $23,
                            data_extraction_status = $24,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = $25 
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
                        JSON.stringify(extractedData.experience),
                        JSON.stringify(extractedData.education),
                        JSON.stringify(extractedData.skills),
                        JSON.stringify(extractedData.certifications),
                        JSON.stringify(extractedData.awards),
                        JSON.stringify(extractedData.activity),
                        JSON.stringify(extractedData.engagementData),
                        'html_scraping_openai',
                        true, // Mark initial scraping as done
                        'completed',
                        req.user.id
                    ]);
                    
                    profile = result.rows[0];
                } else {
                    // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
                    const result = await pool.query(`
                        INSERT INTO user_profiles (
                            user_id, linkedin_url, full_name, headline, "current_role", about, location,
                            current_company, current_company_name, connections_count, followers_count,
                            total_likes, total_comments, total_shares, average_likes,
                            experience, education, skills, certifications, awards, activity, engagement_data,
                            data_source, initial_scraping_done, data_extraction_status
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
                        ) RETURNING *
                    `, [
                        req.user.id, extractedData.linkedinUrl, extractedData.fullName, extractedData.headline,
                        extractedData.currentRole, extractedData.about, extractedData.location,
                        extractedData.currentCompany, extractedData.currentCompanyName,
                        extractedData.connectionsCount, extractedData.followersCount,
                        extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                        JSON.stringify(extractedData.experience), JSON.stringify(extractedData.education),
                        JSON.stringify(extractedData.skills), JSON.stringify(extractedData.certifications),
                        JSON.stringify(extractedData.awards), JSON.stringify(extractedData.activity),
                        JSON.stringify(extractedData.engagementData),
                        'html_scraping_openai', true, 'completed'
                    ]);
                    
                    profile = result.rows[0];
                }
                
                // ✅ FIXED: Update users table with registration_completed = true
                await pool.query(
                    'UPDATE users SET linkedin_url = $1, extraction_status = $2, registration_completed = $3 WHERE id = $4',
                    [extractedData.linkedinUrl, 'completed', true, req.user.id]
                );
                
                console.log('✅ ENHANCED User profile saved successfully with all new fields');
                
                // Check if user has experience for feature unlock
                const hasExperience = extractedData.hasExperience;
                
                res.json({
                    success: true,
                    message: 'Enhanced user profile processed successfully with comprehensive data',
                    data: {
                        profile: {
                            fullName: profile.full_name,
                            headline: profile.headline,
                            currentRole: profile.current_role,  // Note: this is returned without quotes from DB
                            currentCompany: profile.current_company,
                            hasExperience: hasExperience,
                            experienceCount: extractedData.experience.length,
                            certificationsCount: extractedData.certifications.length,
                            awardsCount: extractedData.awards.length,
                            activityCount: extractedData.activity.length,
                            totalLikes: profile.total_likes,
                            totalComments: profile.total_comments,
                            followersCount: profile.followers_count
                        },
                        featureUnlocked: hasExperience,
                        enhancedData: {
                            certifications: extractedData.certifications.length > 0,
                            awards: extractedData.awards.length > 0,
                            activity: extractedData.activity.length > 0,
                            engagement: extractedData.totalLikes > 0 || extractedData.totalComments > 0
                        }
                    }
                });
                
            } else {
                // ✅ ENHANCED: Save to target_profiles table with new fields - WITH ESCAPED current_role
                console.log('💾 Saving ENHANCED target profile data...');
                
                // Check if this target profile already exists for this user
                const existingTarget = await pool.query(
                    'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
                    [req.user.id, extractedData.linkedinUrl]
                );
                
                let targetProfile;
                if (existingTarget.rows.length > 0) {
                    // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
                    const result = await pool.query(`
                        UPDATE target_profiles SET 
                            full_name = $1, headline = $2, "current_role" = $3, about = $4, location = $5,
                            current_company = $6, current_company_name = $7, connections_count = $8, followers_count = $9,
                            total_likes = $10, total_comments = $11, total_shares = $12, average_likes = $13,
                            experience = $14, education = $15, skills = $16, certifications = $17, awards = $18,
                            activity = $19, engagement_data = $20, data_source = $21,
                            scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = $22 AND linkedin_url = $23
                        RETURNING *
                    `, [
                        extractedData.fullName, extractedData.headline, extractedData.currentRole, extractedData.about, extractedData.location,
                        extractedData.currentCompany, extractedData.currentCompanyName, extractedData.connectionsCount, extractedData.followersCount,
                        extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                        JSON.stringify(extractedData.experience), JSON.stringify(extractedData.education),
                        JSON.stringify(extractedData.skills), JSON.stringify(extractedData.certifications),
                        JSON.stringify(extractedData.awards), JSON.stringify(extractedData.activity),
                        JSON.stringify(extractedData.engagementData), 'html_scraping_openai',
                        req.user.id, extractedData.linkedinUrl
                    ]);
                    
                    targetProfile = result.rows[0];
                } else {
                    // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
                    const result = await pool.query(`
                        INSERT INTO target_profiles (
                            user_id, linkedin_url, full_name, headline, "current_role", about, location,
                            current_company, current_company_name, connections_count, followers_count,
                            total_likes, total_comments, total_shares, average_likes,
                            experience, education, skills, certifications, awards, activity, engagement_data, data_source
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
                        ) RETURNING *
                    `, [
                        req.user.id, extractedData.linkedinUrl, extractedData.fullName, extractedData.headline,
                        extractedData.currentRole, extractedData.about, extractedData.location,
                        extractedData.currentCompany, extractedData.currentCompanyName, extractedData.connectionsCount, extractedData.followersCount,
                        extractedData.totalLikes, extractedData.totalComments, extractedData.totalShares, extractedData.averageLikes,
                        JSON.stringify(extractedData.experience), JSON.stringify(extractedData.education),
                        JSON.stringify(extractedData.skills), JSON.stringify(extractedData.certifications),
                        JSON.stringify(extractedData.awards), JSON.stringify(extractedData.activity),
                        JSON.stringify(extractedData.engagementData), 'html_scraping_openai'
                    ]);
                    
                    targetProfile = result.rows[0];
                }
                
                console.log('✅ ENHANCED Target profile saved successfully with comprehensive data');
                
                res.json({
                    success: true,
                    message: 'Enhanced target profile processed successfully with comprehensive data',
                    data: {
                        targetProfile: {
                            fullName: targetProfile.full_name,
                            headline: targetProfile.headline,
                            currentRole: targetProfile.current_role,  // Note: this is returned without quotes from DB
                            currentCompany: targetProfile.current_company,
                            certificationsCount: extractedData.certifications.length,
                            awardsCount: extractedData.awards.length,
                            activityCount: extractedData.activity.length,
                            totalLikes: targetProfile.total_likes,
                            totalComments: targetProfile.total_comments,
                            followersCount: targetProfile.followers_count
                        },
                        enhancedData: {
                            certifications: extractedData.certifications.length > 0,
                            awards: extractedData.awards.length > 0,
                            activity: extractedData.activity.length > 0,
                            engagement: extractedData.totalLikes > 0 || extractedData.totalComments > 0
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

    // ✅ FIXED: Get User Profile - Returns registration_completed field
    router.get('/profile', authenticateToken, async (req, res) => {
        try {
            const profileResult = await pool.query(`
                SELECT 
                    up.*,
                    u.extraction_status as user_extraction_status,
                    u.registration_completed as user_registration_completed  -- ✅ FIXED: Changed from profile_completed
                FROM user_profiles up 
                RIGHT JOIN users u ON u.id = up.user_id 
                WHERE u.id = $1
            `, [req.user.id]);
            
            const profile = profileResult.rows[0];

            let syncStatus = {
                isIncomplete: false,
                missingFields: [],
                extractionStatus: 'unknown',
                initialScrapingDone: false
            };

            if (!profile || !profile.user_id) {
                syncStatus = {
                    isIncomplete: true,
                    missingFields: ['complete_profile'],
                    extractionStatus: 'not_started',
                    initialScrapingDone: false,
                    reason: 'No profile data found'
                };
            } else {
                const extractionStatus = profile.data_extraction_status || 'not_started';
                const isProfileAnalyzed = profile.profile_analyzed || false;
                const initialScrapingDone = profile.initial_scraping_done || false;
                
                const missingFields = [];
                if (!profile.full_name) missingFields.push('full_name');
                if (!profile.headline) missingFields.push('headline');  
                if (!profile.current_company && !profile.current_position) missingFields.push('company_info');
                if (!profile.location) missingFields.push('location');
                
                const isIncomplete = (
                    !initialScrapingDone ||
                    extractionStatus !== 'completed' ||
                    !isProfileAnalyzed ||
                    missingFields.length > 0
                );
                
                syncStatus = {
                    isIncomplete: isIncomplete,
                    missingFields: missingFields,
                    extractionStatus: extractionStatus,
                    profileAnalyzed: isProfileAnalyzed,
                    initialScrapingDone: initialScrapingDone,
                    isCurrentlyProcessing: false, // No background processing
                    reason: isIncomplete ? 
                        `Initial scraping: ${initialScrapingDone}, Status: ${extractionStatus}, Missing: ${missingFields.join(', ')}` : 
                        'Profile complete and ready for target scraping'
                };
            }

            res.json({
                success: true,
                data: {
                    user: {
                        id: req.user.id,
                        email: req.user.email,
                        displayName: req.user.display_name,
                        profilePicture: req.user.profile_picture,
                        packageType: req.user.package_type,
                        billingModel: req.user.billing_model,
                        credits: req.user.credits_remaining,
                        subscriptionStatus: req.user.subscription_status,
                        hasGoogleAccount: !!req.user.google_id,
                        createdAt: req.user.created_at,
                        registrationCompleted: req.user.registration_completed  // ✅ FIXED: Changed from profile_completed
                    },
                    profile: profile && profile.user_id ? {
                        linkedinUrl: profile.linkedin_url,
                        linkedinId: profile.linkedin_id,
                        linkedinNumId: profile.linkedin_num_id,
                        inputUrl: profile.input_url,
                        url: profile.url,
                        fullName: profile.full_name,
                        firstName: profile.first_name,
                        lastName: profile.last_name,
                        headline: profile.headline,
                        currentRole: profile.current_role,  // Note: returned from DB without quotes
                        summary: profile.summary,
                        about: profile.about,
                        location: profile.location,
                        city: profile.city,
                        state: profile.state,
                        country: profile.country,
                        countryCode: profile.country_code,
                        industry: profile.industry,
                        currentCompany: profile.current_company,
                        currentCompanyName: profile.current_company_name,
                        currentCompanyId: profile.current_company_id,
                        currentPosition: profile.current_position,
                        connectionsCount: profile.connections_count,
                        followersCount: profile.followers_count,
                        connections: profile.connections,
                        followers: profile.followers,
                        // ✅ ENHANCED: New engagement fields
                        totalLikes: profile.total_likes,
                        totalComments: profile.total_comments,
                        totalShares: profile.total_shares,
                        averageLikes: profile.average_likes,
                        recommendationsCount: profile.recommendations_count,
                        profileImageUrl: profile.profile_image_url,
                        avatar: profile.avatar,
                        bannerImage: profile.banner_image,
                        backgroundImageUrl: profile.background_image_url,
                        publicIdentifier: profile.public_identifier,
                        experience: profile.experience,
                        education: profile.education,
                        educationsDetails: profile.educations_details,
                        skills: profile.skills,
                        skillsWithEndorsements: profile.skills_with_endorsements,
                        languages: profile.languages,
                        certifications: profile.certifications,
                        // ✅ ENHANCED: New fields
                        awards: profile.awards,
                        courses: profile.courses,
                        projects: profile.projects,
                        publications: profile.publications,
                        patents: profile.patents,
                        volunteerExperience: profile.volunteer_experience,
                        volunteering: profile.volunteering,
                        honorsAndAwards: profile.honors_and_awards,
                        organizations: profile.organizations,
                        recommendations: profile.recommendations,
                        recommendationsGiven: profile.recommendations_given,
                        recommendationsReceived: profile.recommendations_received,
                        posts: profile.posts,
                        activity: profile.activity,
                        articles: profile.articles,
                        peopleAlsoViewed: profile.people_also_viewed,
                        engagementData: profile.engagement_data,
                        timestamp: profile.timestamp,
                        dataSource: profile.data_source,
                        extractionStatus: profile.data_extraction_status,
                        extractionAttempted: profile.extraction_attempted_at,
                        extractionCompleted: profile.extraction_completed_at,
                        extractionError: profile.extraction_error,
                        extractionRetryCount: profile.extraction_retry_count,
                        profileAnalyzed: profile.profile_analyzed,
                        initialScrapingDone: profile.initial_scraping_done
                    } : null,
                    syncStatus: syncStatus
                }
            });
        } catch (error) {
            console.error('❌ Enhanced profile fetch error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch profile'
            });
        }
    });

    // ✅ FIXED: Check profile extraction status - Returns registration_completed
    router.get('/profile-status', authenticateToken, async (req, res) => {
        try {
            const userQuery = `
                SELECT 
                    u.extraction_status,
                    u.error_message,
                    u.registration_completed,  -- ✅ FIXED: Changed from profile_completed
                    u.linkedin_url,
                    up.data_extraction_status,
                    up.extraction_completed_at,
                    up.extraction_retry_count,
                    up.extraction_error,
                    up.initial_scraping_done
                FROM users u
                LEFT JOIN user_profiles up ON u.id = up.user_id
                WHERE u.id = $1
            `;
            
            const result = await pool.query(userQuery, [req.user.id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            const status = result.rows[0];
            
            res.json({
                extraction_status: status.extraction_status,
                registration_completed: status.registration_completed,  // ✅ FIXED: Changed from profile_completed
                linkedin_url: status.linkedin_url,
                error_message: status.error_message,
                data_extraction_status: status.data_extraction_status,
                extraction_completed_at: status.extraction_completed_at,
                extraction_retry_count: status.extraction_retry_count,
                extraction_error: status.extraction_error,
                initial_scraping_done: status.initial_scraping_done || false,
                is_currently_processing: false, // No background processing
                processing_mode: 'ENHANCED_HTML_SCRAPING',
                message: getStatusMessage(status.extraction_status, status.initial_scraping_done)
            });
            
        } catch (error) {
            console.error('Status check error:', error);
            res.status(500).json({ error: 'Status check failed' });
        }
    });

    // ✅ User profile scraping with transaction management - Enhanced - WITH ESCAPED current_role
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
            
            // Validate data completeness BEFORE database transaction
            if (!processedData.fullName && !processedData.headline && !processedData.currentCompany) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile data appears incomplete - missing name, headline, and company information'
                });
            }
            
            console.log('💾 Saving enhanced user profile data with transaction management...');
            
            // Start transaction
            await client.query('BEGIN');
            
            // Check if profile exists
            const existingProfile = await client.query(
                'SELECT * FROM user_profiles WHERE user_id = $1',
                [req.user.id]
            );
            
            let profile;
            if (existingProfile.rows.length > 0) {
                // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
                const result = await client.query(`
                    UPDATE user_profiles SET 
                        linkedin_url = $1, linkedin_id = $2, linkedin_num_id = $3, input_url = $4, url = $5,
                        full_name = $6, first_name = $7, last_name = $8, headline = $9, "current_role" = $10,
                        about = $11, summary = $12, location = $13, city = $14, state = $15, country = $16, country_code = $17,
                        industry = $18, current_company = $19, current_company_name = $20, current_position = $21,
                        connections_count = $22, followers_count = $23, connections = $24, followers = $25,
                        total_likes = $26, total_comments = $27, total_shares = $28, average_likes = $29,
                        profile_image_url = $30, avatar = $31, experience = $32, education = $33, skills = $34,
                        certifications = $35, awards = $36, activity = $37, engagement_data = $38,
                        timestamp = $39, data_source = $40, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $41 
                    RETURNING *
                `, [
                    processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                    JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                    JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                    processedData.timestamp, processedData.dataSource, req.user.id
                ]);
                
                profile = result.rows[0];
            } else {
                // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
                const result = await client.query(`
                    INSERT INTO user_profiles (
                        user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                        full_name, first_name, last_name, headline, "current_role", about, summary,
                        location, city, state, country, country_code, industry,
                        current_company, current_company_name, current_position,
                        connections_count, followers_count, connections, followers,
                        total_likes, total_comments, total_shares, average_likes,
                        profile_image_url, avatar, experience, education, skills,
                        certifications, awards, activity, engagement_data, timestamp, data_source
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40
                    ) RETURNING *
                `, [
                    req.user.id, processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                    JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                    JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                    processedData.timestamp, processedData.dataSource
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
                
                console.log(`🎉 Enhanced user profile successfully saved for user ${req.user.id} with transaction integrity!`);
                
                res.json({
                    success: true,
                    message: 'Enhanced user profile saved successfully with comprehensive data! You can now use Msgly.AI fully.',
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
                            // ✅ ENHANCED: Show new data counts
                            enhancedCounts: {
                                experience: processedData.experience.length,
                                certifications: processedData.certifications.length,
                                awards: processedData.awards.length,
                                activity: processedData.activity.length,
                                totalLikes: processedData.totalLikes,
                                totalComments: processedData.totalComments
                            }
                        },
                        user: {
                            registrationCompleted: true,  // ✅ FIXED: Changed from profileCompleted
                            extractionStatus: 'completed'
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

    // ✅ Target profile scraping with URL normalization - Enhanced - WITH ESCAPED current_role
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
            
            console.log('💾 Saving enhanced target profile data...');
            
            // Check if this target profile already exists for this user
            const existingTarget = await pool.query(
                'SELECT * FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2',
                [req.user.id, processedData.linkedinUrl]
            );
            
            let targetProfile;
            if (existingTarget.rows.length > 0) {
                // ✅ ENHANCED: Update with all new fields - WITH ESCAPED current_role
                const result = await pool.query(`
                    UPDATE target_profiles SET 
                        linkedin_id = $1, linkedin_num_id = $2, input_url = $3, url = $4,
                        full_name = $5, first_name = $6, last_name = $7, headline = $8, "current_role" = $9,
                        about = $10, summary = $11, location = $12, city = $13, state = $14, country = $15, country_code = $16,
                        industry = $17, current_company = $18, current_company_name = $19, current_position = $20,
                        connections_count = $21, followers_count = $22, connections = $23, followers = $24,
                        total_likes = $25, total_comments = $26, total_shares = $27, average_likes = $28,
                        profile_image_url = $29, avatar = $30, experience = $31, education = $32, skills = $33,
                        certifications = $34, awards = $35, activity = $36, engagement_data = $37,
                        timestamp = $38, data_source = $39,
                        scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $40 AND linkedin_url = $41
                    RETURNING *
                `, [
                    processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                    JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                    JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                    processedData.timestamp, processedData.dataSource, req.user.id, processedData.linkedinUrl
                ]);
                
                targetProfile = result.rows[0];
            } else {
                // ✅ ENHANCED: Create with all new fields - WITH ESCAPED current_role
                const result = await pool.query(`
                    INSERT INTO target_profiles (
                        user_id, linkedin_url, linkedin_id, linkedin_num_id, input_url, url,
                        full_name, first_name, last_name, headline, "current_role", about, summary,
                        location, city, state, country, country_code, industry,
                        current_company, current_company_name, current_position,
                        connections_count, followers_count, connections, followers,
                        total_likes, total_comments, total_shares, average_likes,
                        profile_image_url, avatar, experience, education, skills,
                        certifications, awards, activity, engagement_data, timestamp, data_source
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40
                    ) RETURNING *
                `, [
                    req.user.id, processedData.linkedinUrl, processedData.linkedinId, processedData.linkedinNumId, processedData.inputUrl, processedData.url,
                    processedData.fullName, processedData.firstName, processedData.lastName, processedData.headline, processedData.currentRole,
                    processedData.about, processedData.summary, processedData.location, processedData.city, processedData.state, processedData.country, processedData.countryCode,
                    processedData.industry, processedData.currentCompany, processedData.currentCompanyName, processedData.currentPosition,
                    processedData.connectionsCount, processedData.followersCount, processedData.connections, processedData.followers,
                    processedData.totalLikes, processedData.totalComments, processedData.totalShares, processedData.averageLikes,
                    processedData.profileImageUrl, processedData.avatar,
                    JSON.stringify(processedData.experience), JSON.stringify(processedData.education), JSON.stringify(processedData.skills),
                    JSON.stringify(processedData.certifications), JSON.stringify(processedData.awards), JSON.stringify(processedData.activity),
                    JSON.stringify({ totalLikes: processedData.totalLikes, totalComments: processedData.totalComments, totalShares: processedData.totalShares }),
                    processedData.timestamp, processedData.dataSource
                ]);
                
                targetProfile = result.rows[0];
            }
            
            console.log(`🎯 Enhanced target profile successfully saved for user ${req.user.id}!`);
            console.log(`   - Target: ${targetProfile.full_name || 'Unknown'}`);
            console.log(`   - Company: ${targetProfile.current_company || 'Unknown'}`);
            console.log(`   - Certifications: ${processedData.certifications.length}`);
            console.log(`   - Awards: ${processedData.awards.length}`);
            console.log(`   - Activity: ${processedData.activity.length}`);
            
            res.json({
                success: true,
                message: 'Enhanced target profile saved successfully with comprehensive data!',
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
                        // ✅ ENHANCED: Show comprehensive data counts
                        enhancedCounts: {
                            experience: processedData.experience.length,
                            certifications: processedData.certifications.length,
                            awards: processedData.awards.length,
                            activity: processedData.activity.length,
                            totalLikes: processedData.totalLikes,
                            totalComments: processedData.totalComments,
                            followersCount: processedData.followersCount
                        }
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

    // ✅ DISABLED: Retry extraction endpoint
    router.post('/retry-extraction', authenticateToken, async (req, res) => {
        res.status(410).json({
            success: false,
            error: 'Retry extraction is no longer available',
            message: 'Please use the Chrome extension to complete your profile setup by visiting your LinkedIn profile.',
            alternatives: {
                chromeExtension: 'Install the Msgly.AI Chrome extension and visit your LinkedIn profile',
                enhancedExtraction: 'The extension now extracts comprehensive data including certifications, awards, activity, and engagement metrics'
            },
            code: 'FEATURE_DISABLED'
        });
    });

    // Return the configured router
    return router;
}

// Export the initialization function
module.exports = { initProfileRoutes };
