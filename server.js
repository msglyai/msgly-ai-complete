// Msgly.AI Server with Google OAuth + COMPLETE LinkedIn Profile Extraction
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const validator = require('validator');

const app = express();
const port = process.env.PORT || 3000;

// Environment variables validation
const validateEnvironment = () => {
    const required = [
        'DATABASE_URL',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'BRIGHT_DATA_API_KEY',
        'JWT_SECRET',
        'SESSION_SECRET'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:', missing);
        process.exit(1);
    }
    console.log('✅ All required environment variables are present');
};

validateEnvironment();

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY;
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_COLLECTOR_ID || 'gd_l1viktl72bvl7bjuj0';
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

// Google OAuth client
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Database connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect()
    .then(client => {
        console.log('✅ Connected to PostgreSQL database');
        client.release();
    })
    .catch(err => {
        console.error('❌ Database connection error:', err);
        process.exit(1);
    });

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: ['http://localhost:3000', 'https://api.msgly.ai', 'https://msgly.ai'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// COMPLETE: Bright Data LinkedIn Profile Extraction Functions

// Process comprehensive LinkedIn profile data
const processLinkedInDataComplete = (rawData) => {
    if (!rawData || typeof rawData !== 'object') {
        console.warn('⚠️ Invalid or empty profile data received');
        return null;
    }

    console.log('🔍 Processing comprehensive LinkedIn profile data...');
    
    // Extract and structure ALL available LinkedIn data
    const processedData = {
        // Basic Profile Information
        linkedinId: rawData.linkedin_id || rawData.id || null,
        linkedinNumId: rawData.linkedin_num_id || null,
        url: rawData.url || rawData.input_url || null,
        fullName: rawData.name || rawData.full_name || null,
        firstName: rawData.first_name || null,
        lastName: rawData.last_name || null,
        headline: rawData.headline || rawData.position || null,
        
        // Location Information
        location: rawData.location || rawData.city || null,
        city: rawData.city || null,
        state: rawData.state || null,
        country: rawData.country || null,
        countryCode: rawData.country_code || null,
        
        // Professional Information
        industry: rawData.industry || null,
        currentCompany: rawData.current_company || rawData.current_company_name || null,
        currentCompanyId: rawData.current_company_company_id || null,
        currentPosition: rawData.current_position || rawData.position || null,
        
        // About & Summary
        about: rawData.about || rawData.summary || null,
        
        // Social Metrics
        connectionsCount: rawData.connections || rawData.connections_count || null,
        followersCount: rawData.followers || rawData.followers_count || null,
        
        // Media
        profilePicture: rawData.avatar || rawData.profile_picture || rawData.image_url || null,
        bannerImage: rawData.banner_image || rawData.background_image || null,
        
        // Experience (Array of objects)
        experience: rawData.experience || rawData.work_experience || [],
        
        // Education (Array of objects)  
        education: rawData.education || rawData.educations_details || [],
        
        // Skills and Endorsements
        skills: rawData.skills || [],
        skillsWithEndorsements: rawData.skills_with_endorsements || [],
        
        // Languages
        languages: rawData.languages || [],
        
        // Additional Professional Details
        certifications: rawData.certifications || rawData.certificates || [],
        courses: rawData.courses || [],
        projects: rawData.projects || [],
        publications: rawData.publications || [],
        patents: rawData.patents || [],
        volunteerExperience: rawData.volunteer_experience || rawData.volunteering || [],
        honors: rawData.honors_and_awards || rawData.honors || [],
        organizations: rawData.organizations || [],
        
        // Recommendations
        recommendationsCount: rawData.recommendations_count || null,
        recommendationsGiven: rawData.recommendations_given || [],
        recommendationsReceived: rawData.recommendations_received || rawData.recommendations || [],
        
        // Activity and Posts
        posts: rawData.posts || rawData.recent_posts || [],
        activity: rawData.activity || rawData.recent_activity || [],
        peopleAlsoViewed: rawData.people_also_viewed || [],
        
        // Metadata
        timestamp: rawData.timestamp || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        
        // Store complete raw data for future reference
        rawData: rawData
    };

    console.log('✅ Comprehensive LinkedIn profile data processed successfully');
    console.log(`📊 Profile: ${processedData.fullName} (${processedData.headline})`);
    console.log(`🏢 Company: ${processedData.currentCompany}`);
    console.log(`📍 Location: ${processedData.location}`);
    console.log(`🔗 Connections: ${processedData.connectionsCount}`);
    
    return processedData;
};

// Save complete profile to database with all LinkedIn data
const saveCompleteProfileToDatabase = async (userId, linkedinUrl, profileData) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        console.log('💾 Saving comprehensive LinkedIn profile data to database...');

        // Update users table
        const updateUserQuery = `
            UPDATE users 
            SET 
                linkedin_url = $1,
                profile_data = $2,
                extraction_status = $3,
                error_message = NULL,
                updated_at = NOW()
            WHERE id = $4
        `;
        
        await client.query(updateUserQuery, [
            linkedinUrl,
            JSON.stringify(profileData),
            'completed',
            userId
        ]);

        // Insert/Update comprehensive profile data
        const completeProfileQuery = `
            INSERT INTO user_profiles (
                user_id, linkedin_url, linkedin_id, linkedin_num_id,
                full_name, first_name, last_name, headline,
                location, city, state, country, country_code,
                industry, current_company, current_company_id, current_position,
                about, connections_count, followers_count,
                profile_picture, banner_image,
                experience, education, skills, skills_with_endorsements,
                languages, certifications, courses, projects,
                publications, patents, volunteer_experience,
                honors_and_awards, organizations,
                recommendations_count, recommendations_given, recommendations_received,
                posts, activity, people_also_viewed,
                brightdata_data, data_extraction_status,
                extraction_completed_at, profile_analyzed,
                created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
                $41, $42, NOW(), $43, NOW(), NOW()
            )
            ON CONFLICT (user_id) 
            DO UPDATE SET
                linkedin_url = EXCLUDED.linkedin_url,
                linkedin_id = EXCLUDED.linkedin_id,
                linkedin_num_id = EXCLUDED.linkedin_num_id,
                full_name = EXCLUDED.full_name,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                headline = EXCLUDED.headline,
                location = EXCLUDED.location,
                city = EXCLUDED.city,
                state = EXCLUDED.state,
                country = EXCLUDED.country,
                country_code = EXCLUDED.country_code,
                industry = EXCLUDED.industry,
                current_company = EXCLUDED.current_company,
                current_company_id = EXCLUDED.current_company_id,
                current_position = EXCLUDED.current_position,
                about = EXCLUDED.about,
                connections_count = EXCLUDED.connections_count,
                followers_count = EXCLUDED.followers_count,
                profile_picture = EXCLUDED.profile_picture,
                banner_image = EXCLUDED.banner_image,
                experience = EXCLUDED.experience,
                education = EXCLUDED.education,
                skills = EXCLUDED.skills,
                skills_with_endorsements = EXCLUDED.skills_with_endorsements,
                languages = EXCLUDED.languages,
                certifications = EXCLUDED.certifications,
                courses = EXCLUDED.courses,
                projects = EXCLUDED.projects,
                publications = EXCLUDED.publications,
                patents = EXCLUDED.patents,
                volunteer_experience = EXCLUDED.volunteer_experience,
                honors_and_awards = EXCLUDED.honors_and_awards,
                organizations = EXCLUDED.organizations,
                recommendations_count = EXCLUDED.recommendations_count,
                recommendations_given = EXCLUDED.recommendations_given,
                recommendations_received = EXCLUDED.recommendations_received,
                posts = EXCLUDED.posts,
                activity = EXCLUDED.activity,
                people_also_viewed = EXCLUDED.people_also_viewed,
                brightdata_data = EXCLUDED.brightdata_data,
                data_extraction_status = EXCLUDED.data_extraction_status,
                extraction_completed_at = EXCLUDED.extraction_completed_at,
                extraction_error = NULL,
                profile_analyzed = EXCLUDED.profile_analyzed,
                updated_at = NOW()
        `;

        await client.query(completeProfileQuery, [
            userId,
            linkedinUrl,
            profileData.linkedinId,
            profileData.linkedinNumId,
            profileData.fullName,
            profileData.firstName,
            profileData.lastName,
            profileData.headline,
            profileData.location,
            profileData.city,
            profileData.state,
            profileData.country,
            profileData.countryCode,
            profileData.industry,
            profileData.currentCompany,
            profileData.currentCompanyId,
            profileData.currentPosition,
            profileData.about,
            profileData.connectionsCount,
            profileData.followersCount,
            profileData.profilePicture,
            profileData.bannerImage,
            JSON.stringify(profileData.experience),
            JSON.stringify(profileData.education),
            JSON.stringify(profileData.skills),
            JSON.stringify(profileData.skillsWithEndorsements),
            JSON.stringify(profileData.languages),
            JSON.stringify(profileData.certifications),
            JSON.stringify(profileData.courses),
            JSON.stringify(profileData.projects),
            JSON.stringify(profileData.publications),
            JSON.stringify(profileData.patents),
            JSON.stringify(profileData.volunteerExperience),
            JSON.stringify(profileData.honors),
            JSON.stringify(profileData.organizations),
            profileData.recommendationsCount,
            JSON.stringify(profileData.recommendationsGiven),
            JSON.stringify(profileData.recommendationsReceived),
            JSON.stringify(profileData.posts),
            JSON.stringify(profileData.activity),
            JSON.stringify(profileData.peopleAlsoViewed),
            JSON.stringify(profileData.rawData),
            'completed',
            true
        ]);

        await client.query('COMMIT');
        console.log('✅ Complete LinkedIn profile data saved to database successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Database save failed:', error);
        throw error;
    } finally {
        client.release();
    }
};

// CORRECT: Trigger LinkedIn scraper using DATASETS API (matches your curl command)
const triggerLinkedInScraper = async (linkedinUrl) => {
    console.log('🚀 Triggering LinkedIn scraper with Datasets API...');
    console.log(`📋 Dataset ID: ${BRIGHT_DATA_DATASET_ID}`);
    console.log(`🔗 LinkedIn URL: ${linkedinUrl}`);
    
    try {
        const triggerResponse = await axios.post(
            `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&include_errors=true`,
            [{ url: linkedinUrl }],
            {
                headers: {
                    Authorization: `Bearer ${BRIGHT_DATA_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 30000
            }
        );

        console.log('✅ LinkedIn scraper triggered successfully');
        
        return {
            success: true,
            snapshotId: triggerResponse.data.snapshot_id,
            data: triggerResponse.data
        };
        
    } catch (error) {
        console.error('❌ Failed to trigger LinkedIn scraper:', error.message);
        throw new Error(`Scraper trigger failed: ${error.message}`);
    }
};

// CORRECT: Poll for results using DATASETS API
const pollForResults = async (snapshotId, maxAttempts = 20) => {
    console.log(`🔄 Polling for results... Snapshot ID: ${snapshotId}`);
    
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        try {
            console.log(`📡 Polling attempt ${attempts + 1}/${maxAttempts}...`);
            
            const response = await axios.get(
                `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
                {
                    headers: {
                        Authorization: `Bearer ${BRIGHT_DATA_API_KEY}`
                    },
                    timeout: 30000
                }
            );

            console.log(`📊 Poll response status: ${response.data.status}`);
            
            if (response.data.status === 'ready' && response.data.data && response.data.data.length > 0) {
                console.log('✅ Profile data ready!');
                return {
                    success: true,
                    data: response.data.data[0], // First profile
                    allData: response.data.data
                };
            } else if (response.data.status === 'error') {
                console.error('❌ Scraping error:', response.data.error);
                throw new Error(`Scraping failed: ${response.data.error}`);
            }
            
            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, 8000)); // 8 seconds
            attempts++;
            
        } catch (error) {
            console.error(`❌ Polling attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            
            if (attempts >= maxAttempts) {
                throw new Error(`Polling timeout after ${maxAttempts} attempts`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 8000));
        }
    }
    
    throw new Error('Polling timeout - profile extraction took too long');
};

// COMPLETE: Extract LinkedIn profile with comprehensive data
const extractProfileAsync = async (userId, linkedinUrl) => {
    try {
        console.log('🎯 Starting comprehensive LinkedIn profile extraction...');
        
        // Update status to in_progress
        await pool.query(
            'UPDATE users SET extraction_status = $1, error_message = NULL WHERE id = $2',
            ['in_progress', userId]
        );

        // Step 1: Trigger the scraper
        const triggerResult = await triggerLinkedInScraper(linkedinUrl);
        
        if (!triggerResult.success || !triggerResult.snapshotId) {
            throw new Error('Failed to trigger LinkedIn scraper');
        }

        // Step 2: Poll for results
        const pollResult = await pollForResults(triggerResult.snapshotId);
        
        if (!pollResult.success || !pollResult.data) {
            throw new Error('Failed to retrieve profile data');
        }

        // Step 3: Process comprehensive data
        const processedProfileData = processLinkedInDataComplete(pollResult.data);
        
        if (!processedProfileData) {
            throw new Error('Failed to process profile data');
        }

        // Step 4: Save complete profile to database
        await saveCompleteProfileToDatabase(userId, linkedinUrl, processedProfileData);

        console.log('🎉 LinkedIn profile extraction completed successfully!');
        
        return {
            success: true,
            profileData: processedProfileData
        };
        
    } catch (error) {
        console.error('❌ Profile extraction failed:', error);
        
        // Update status to failed
        await pool.query(
            'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
            ['failed', error.message, userId]
        );
        
        throw error;
    }
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Existing user functions (Google OAuth, etc.)
const createUserProfile = async (email, name, googleId, profilePicture = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            'INSERT INTO users (email, name, google_id, profile_picture, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
            [email, name, googleId, profilePicture]
        );

        const user = userResult.rows[0];

        await client.query(
            'INSERT INTO user_profiles (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW())',
            [user.id]
        );

        await client.query('COMMIT');
        return user;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const updateUserProfileWithExtraction = async (userId, profileData) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Update basic user info
        await client.query(
            `UPDATE users SET 
                profile_completed = true,
                linkedin_url = $1,
                updated_at = NOW()
            WHERE id = $2`,
            [profileData.linkedinUrl, userId]
        );

        // Check if profile exists
        const existingProfile = await client.query(
            'SELECT id FROM user_profiles WHERE user_id = $1',
            [userId]
        );

        if (existingProfile.rows.length > 0) {
            // Update existing profile
            await client.query(
                `UPDATE user_profiles SET 
                    linkedin_url = $1,
                    data_extraction_status = $2,
                    profile_analyzed = $3,
                    updated_at = NOW()
                WHERE user_id = $4`,
                [profileData.linkedinUrl, 'pending', false, userId]
            );
        } else {
            // Create new profile
            await client.query(
                `INSERT INTO user_profiles (
                    user_id, linkedin_url, data_extraction_status, 
                    profile_analyzed, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, NOW(), NOW())`,
                [userId, profileData.linkedinUrl, 'pending', false]
            );
        }

        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// Routes

// Health check with comprehensive status
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: '3.0-complete-linkedin-extraction',
        timestamp: new Date().toISOString(),
        brightdata: {
            configured: !!BRIGHT_DATA_API_KEY,
            datasetId: BRIGHT_DATA_DATASET_ID,
            endpoint: 'datasets/v3/trigger (Datasets API - CORRECT)'
        },
        database: {
            connected: true,
            ssl: process.env.NODE_ENV === 'production'
        },
        authentication: {
            google: !!GOOGLE_CLIENT_ID,
            jwt: !!JWT_SECRET
        }
    });
});

// DEBUG: Test Bright Data configuration
app.get('/debug-brightdata', async (req, res) => {
    try {
        console.log('🔍 Testing Bright Data configuration...');
        
        const testResults = {
            timestamp: new Date().toISOString(),
            apiKey: BRIGHT_DATA_API_KEY ? 'Present ✅' : 'Missing ❌',
            datasetId: BRIGHT_DATA_DATASET_ID || 'Missing ❌',
            endpoint: 'https://api.brightdata.com/datasets/v3/trigger',
            tests: []
        };

        // Test 1: API connectivity
        try {
            const connectTest = await axios.get('https://api.brightdata.com', { timeout: 10000 });
            testResults.tests.push({
                name: 'API Connectivity',
                status: 'PASS ✅',
                details: 'Bright Data API is reachable'
            });
        } catch (error) {
            testResults.tests.push({
                name: 'API Connectivity',
                status: 'FAIL ❌',
                details: error.message
            });
        }

        // Test 2: Authentication
        try {
            const authTest = await axios.post(
                `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&include_errors=true`,
                [{ url: 'https://www.linkedin.com/in/test-profile/' }],
                {
                    headers: {
                        Authorization: `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );
            
            testResults.tests.push({
                name: 'Authentication & Dataset Access',
                status: 'PASS ✅',
                details: 'API key is valid and dataset is accessible',
                snapshotId: authTest.data.snapshot_id
            });
        } catch (error) {
            testResults.tests.push({
                name: 'Authentication & Dataset Access',
                status: 'FAIL ❌',
                details: error.response?.data || error.message
            });
        }

        // Test 3: Database connectivity
        try {
            await pool.query('SELECT 1');
            testResults.tests.push({
                name: 'Database Connectivity',
                status: 'PASS ✅',
                details: 'PostgreSQL database is accessible'
            });
        } catch (error) {
            testResults.tests.push({
                name: 'Database Connectivity',
                status: 'FAIL ❌',
                details: error.message
            });
        }

        res.json(testResults);
        
    } catch (error) {
        console.error('❌ Debug test failed:', error);
        res.status(500).json({
            error: 'Debug test failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Google OAuth
app.post('/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'Google token is required' });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const { sub: googleId, email, name, picture } = payload;

        let user = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);

        if (user.rows.length === 0) {
            user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            
            if (user.rows.length === 0) {
                const newUser = await createUserProfile(email, name, googleId, picture);
                user = { rows: [newUser] };
            } else {
                await pool.query(
                    'UPDATE users SET google_id = $1, profile_picture = $2 WHERE id = $3',
                    [googleId, picture, user.rows[0].id]
                );
            }
        }

        const userData = user.rows[0];
        const jwtToken = jwt.sign(
            {
                id: userData.id,
                email: userData.email,
                name: userData.name
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token: jwtToken,
            user: {
                id: userData.id,
                email: userData.email,
                name: userData.name,
                profilePicture: userData.profile_picture,
                profileCompleted: userData.profile_completed || false
            }
        });

    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// COMPLETE: Update profile with comprehensive LinkedIn extraction
app.post('/update-profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { linkedinUrl } = req.body;

        // Validate LinkedIn URL
        if (!linkedinUrl || !validator.isURL(linkedinUrl)) {
            return res.status(400).json({
                success: false,
                error: 'Valid LinkedIn URL is required'
            });
        }

        if (!linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL (linkedin.com/in/...)'
            });
        }

        console.log('🚀 Profile update request received');
        console.log(`👤 User ID: ${userId}`);
        console.log(`🔗 LinkedIn URL: ${linkedinUrl}`);

        // Update user profile immediately
        await updateUserProfileWithExtraction(userId, { linkedinUrl });

        // Start comprehensive LinkedIn extraction asynchronously
        console.log('⚡ Starting comprehensive LinkedIn profile extraction...');
        
        // Don't await - let it run in background
        extractProfileAsync(userId, linkedinUrl).catch(error => {
            console.error('Background profile extraction failed:', error);
        });

        // Return immediate success response
        res.json({
            success: true,
            message: 'Profile update initiated! LinkedIn data extraction is in progress.',
            status: 'processing',
            linkedinUrl: linkedinUrl,
            note: 'Complete profile data will be available shortly. Use /profile-status to check progress.'
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Profile update failed',
            details: error.message
        });
    }
});

// Check profile extraction status
app.get('/profile-status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const result = await pool.query(
            'SELECT extraction_status, error_message, updated_at FROM users WHERE id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = result.rows[0];
        
        res.json({
            status: user.extraction_status || 'not_started',
            error: user.error_message,
            lastUpdated: user.updated_at
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Failed to check status' });
    }
});

// Get user profile (including LinkedIn data)
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const userResult = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
        );
        
        const profileResult = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = userResult.rows[0];
        const profile = profileResult.rows[0] || {};
        
        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                profilePicture: user.profile_picture,
                profileCompleted: user.profile_completed,
                linkedinUrl: user.linkedin_url,
                extractionStatus: user.extraction_status
            },
            profile: {
                ...profile,
                // Parse JSON fields
                experience: profile.experience ? JSON.parse(profile.experience) : [],
                education: profile.education ? JSON.parse(profile.education) : [],
                skills: profile.skills ? JSON.parse(profile.skills) : [],
                languages: profile.languages ? JSON.parse(profile.languages) : []
            }
        });
        
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Get packages
app.get('/packages', (req, res) => {
    const packages = [
        {
            id: 1,
            name: 'Basic',
            price: 29,
            features: ['Profile Analysis', '5 Companies Match', 'Basic Support']
        },
        {
            id: 2,
            name: 'Professional',
            price: 79,
            features: ['Advanced Analysis', '20 Companies Match', 'Priority Support', 'Market Insights']
        },
        {
            id: 3,
            name: 'Enterprise',
            price: 149,
            features: ['Complete Analysis', 'Unlimited Matches', '24/7 Support', 'Custom Reports', 'API Access']
        }
    ];
    
    res.json({ packages });
});

// Error handling
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
    console.log(`\n🚀 Msgly.AI Server running on port ${port}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
    console.log(`🔧 API: COMPLETE - Using Datasets API (v3)`);
    console.log(`📊 Dataset ID: ${BRIGHT_DATA_DATASET_ID}`);
    console.log(`📡 Health check: /health`);
    console.log(`🔍 Debug endpoint: /debug-brightdata`);
    console.log(`💾 Complete LinkedIn data extraction enabled ✅`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');  
    process.exit(0);
});
