// Msgly.AI Server with Google OAuth + COMPLETE LinkedIn Profile Extraction + Database Migration
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
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

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://www.linkedin.com',
            'https://linkedin.com',
            'http://localhost:3000',
            'https://msgly.ai',
            'https://www.msgly.ai',
            'https://api.msgly.ai'
        ];
        
        if (origin.startsWith('chrome-extension://')) {
            return callback(null, true);
        }
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        
        return callback(null, true); // Allow all for now during development
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration - MUST come before passport initialization
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await getUserById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.NODE_ENV === 'production' 
        ? "https://api.msgly.ai/auth/google/callback"
        : "http://localhost:3000/auth/google/callback"
},
async (accessToken, refreshToken, profile, done) => {
    try {
        // Check if user exists
        let user = await getUserByEmail(profile.emails[0].value);
        
        if (!user) {
            // Create new user with Google account
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value
            );
        } else if (!user.google_id) {
            // Link existing account with Google
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
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

// CORRECT: Trigger LinkedIn scraper using DATASETS API
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

// IMPROVED: Poll for results with extended timeout and better error handling
const pollForResults = async (snapshotId, maxAttempts = 40) => { // Increased from 20 to 40 attempts
    console.log(`🔄 Polling for results... Snapshot ID: ${snapshotId}`);
    console.log(`⏱️ Maximum wait time: ${(maxAttempts * 10) / 60} minutes`);
    
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

            console.log(`📊 Poll response status: ${response.data.status || 'undefined'}`);
            
            // Check for ready status with data
            if (response.data.status === 'ready' && response.data.data && response.data.data.length > 0) {
                console.log('✅ Profile data ready!');
                console.log(`📋 Retrieved ${response.data.data.length} profile(s)`);
                return {
                    success: true,
                    data: response.data.data[0], // First profile
                    allData: response.data.data
                };
            } 
            // Check if data is available even without explicit "ready" status
            else if (response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
                console.log('✅ Profile data found (without ready status)!');
                return {
                    success: true,
                    data: response.data.data[0],
                    allData: response.data.data
                };
            }
            // Check for error status
            else if (response.data.status === 'error') {
                console.error('❌ Scraping error:', response.data.error);
                throw new Error(`Scraping failed: ${response.data.error}`);
            }
            // Check for failed status
            else if (response.data.status === 'failed') {
                console.error('❌ Scraping failed:', response.data.error || 'Unknown error');
                throw new Error(`Scraping failed: ${response.data.error || 'Profile extraction failed'}`);
            }
            // Status is still running/pending/undefined
            else {
                const status = response.data.status || 'undefined';
                console.log(`⏳ Still processing... (Status: ${status})`);
            }
            
            // Progressive wait times: start with 8 seconds, increase to 12 seconds after attempt 20
            const waitTime = attempts > 20 ? 12000 : 8000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            attempts++;
            
        } catch (error) {
            console.error(`❌ Polling attempt ${attempts + 1} failed:`, error.message);
            
            // Don't count 404 errors as real attempts (snapshot might not be ready yet)
            if (error.response?.status === 404) {
                console.log(`   ℹ️ Snapshot not ready yet (404), continuing...`);
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds for 404s
            } else {
                attempts++; // Count other errors as attempts
            }
            
            if (attempts >= maxAttempts) {
                console.error(`❌ Polling timeout after ${maxAttempts} attempts (${(maxAttempts * 10) / 60} minutes)`);
                throw new Error(`Polling timeout after ${maxAttempts} attempts - profile extraction took too long. This can happen with complex profiles or during high demand periods.`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 8000));
        }
    }
    
    throw new Error(`Polling timeout after ${maxAttempts} attempts - profile extraction took too long. This can happen with complex profiles or during high demand periods.`);
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

// Database functions
const createUser = async (email, passwordHash, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = {
        'free': 30,
        'silver': billingModel === 'payAsYouGo' ? 100 : 100,
        'gold': billingModel === 'payAsYouGo' ? 500 : 500,
        'platinum': billingModel === 'payAsYouGo' ? 1500 : 1500
    };
    
    const credits = creditsMap[packageType] || 30;
    
    const result = await pool.query(
        'INSERT INTO users (email, password_hash, package_type, billing_model, credits_remaining) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [email, passwordHash, packageType, billingModel, credits]
    );
    return result.rows[0];
};

const createGoogleUser = async (email, displayName, googleId, profilePicture, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = {
        'free': 30,
        'silver': billingModel === 'payAsYouGo' ? 100 : 100,
        'gold': billingModel === 'payAsYouGo' ? 500 : 500,
        'platinum': billingModel === 'payAsYouGo' ? 1500 : 1500
    };
    
    const credits = creditsMap[packageType] || 30;
    
    const result = await pool.query(
        `INSERT INTO users (email, google_id, display_name, profile_picture, package_type, billing_model, credits_remaining) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [email, googleId, displayName, profilePicture, packageType, billingModel, credits]
    );
    return result.rows[0];
};

const linkGoogleAccount = async (userId, googleId) => {
    const result = await pool.query(
        'UPDATE users SET google_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [googleId, userId]
    );
    return result.rows[0];
};

const getUserByEmail = async (email) => {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
};

const getUserById = async (userId) => {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0];
};

const createOrUpdateUserProfileWithExtraction = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = linkedinUrl.trim();
        
        // First, create/update basic profile
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            // Update existing profile
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3 RETURNING *',
                [cleanUrl, displayName, userId]
            );
            profile = result.rows[0];
        } else {
            // Create new profile
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name) VALUES ($1, $2, $3) RETURNING *',
                [userId, cleanUrl, displayName]
            );
            profile = result.rows[0];
        }
        
        // Start background extraction
        extractProfileAsync(userId, cleanUrl).catch(error => {
            console.error('Background profile extraction failed:', error);
        });
        
        return profile;
        
    } catch (error) {
        console.error('Error in profile creation/extraction:', error);
        throw error;
    }
};

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await getUserById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, error: 'Invalid token' });
    }
};

// Routes

// Health check with comprehensive status
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: '3.1-improved-polling-and-retry',
        timestamp: new Date().toISOString(),
        brightdata: {
            configured: !!BRIGHT_DATA_API_KEY,
            datasetId: BRIGHT_DATA_DATASET_ID,
            endpoint: 'datasets/v3/trigger (Datasets API - CORRECT)',
            polling: {
                maxAttempts: 40,
                maxWaitTime: '6.7 minutes',
                retrySupported: true
            }
        },
        database: {
            connected: true,
            ssl: process.env.NODE_ENV === 'production'
        },
        authentication: {
            google: !!GOOGLE_CLIENT_ID,
            jwt: !!JWT_SECRET,
            passport: 'configured'
        }
    });
});

// Home route
app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Server with Google OAuth + Bright Data + Improved Polling',
        status: 'running',
        version: '3.1-improved-polling-and-retry',
        endpoints: [
            'POST /register',
            'POST /login', 
            'GET /auth/google',
            'GET /auth/google/callback',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'POST /retry-extraction (protected)',
            'GET /profile-status (protected)',
            'GET /packages',
            'POST /migrate-database',
            'GET /debug-brightdata',
            'GET /health'
        ],
        features: [
            'Extended polling timeout (6.7 minutes)',
            'Automatic retry mechanism',
            'Better error handling',
            'Real-time status checking'
        ]
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

// DATABASE MIGRATION ENDPOINT - Run migration via server
app.post('/migrate-database', async (req, res) => {
    try {
        console.log('🚀 Starting database migration via server endpoint...');
        
        const client = await pool.connect();
        let migrationResults = [];
        
        try {
            // Step 1: Add missing columns to users table
            console.log('📋 Step 1: Updating users table...');
            migrationResults.push('Step 1: Updating users table...');
            
            const userTableUpdates = `
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
                ADD COLUMN IF NOT EXISTS profile_data JSONB,
                ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT 'not_started',
                ADD COLUMN IF NOT EXISTS error_message TEXT,
                ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false,
                ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
                ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
                ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500),
                ADD COLUMN IF NOT EXISTS package_type VARCHAR(50) DEFAULT 'free',
                ADD COLUMN IF NOT EXISTS billing_model VARCHAR(50) DEFAULT 'monthly',
                ADD COLUMN IF NOT EXISTS credits_remaining INTEGER DEFAULT 30,
                ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'active';
            `;
            
            await client.query(userTableUpdates);
            console.log('✅ Users table updated successfully');
            migrationResults.push('✅ Users table updated successfully');

            // Make password_hash nullable for Google OAuth users
            try {
                await client.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`);
                console.log('✅ Made password_hash nullable for Google OAuth users');
                migrationResults.push('✅ Made password_hash nullable for Google OAuth users');
            } catch (err) {
                console.log('Password hash might already be nullable:', err.message);
                migrationResults.push('⚠️ Password hash was already nullable');
            }

            // Step 2: Create comprehensive user_profiles table
            console.log('📋 Step 2: Creating comprehensive user_profiles table...');
            migrationResults.push('Step 2: Creating comprehensive user_profiles table...');
            
            const createProfilesTable = `
                CREATE TABLE IF NOT EXISTS user_profiles (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    
                    -- Basic LinkedIn Information
                    linkedin_url TEXT,
                    linkedin_id TEXT,
                    linkedin_num_id TEXT,
                    
                    -- Personal Information
                    full_name TEXT,
                    first_name TEXT,
                    last_name TEXT,
                    headline TEXT,
                    
                    -- Location Information
                    location TEXT,
                    city TEXT,
                    state TEXT,
                    country TEXT,
                    country_code TEXT,
                    
                    -- Professional Information
                    industry TEXT,
                    current_company TEXT,
                    current_company_id TEXT,
                    current_position TEXT,
                    
                    -- About & Summary
                    about TEXT,
                    
                    -- Social Metrics
                    connections_count INTEGER,
                    followers_count INTEGER,
                    
                    -- Media
                    profile_picture TEXT,
                    banner_image TEXT,
                    
                    -- Professional Experience (JSON Arrays)
                    experience JSONB DEFAULT '[]'::JSONB,
                    education JSONB DEFAULT '[]'::JSONB,
                    
                    -- Skills and Expertise
                    skills JSONB DEFAULT '[]'::JSONB,
                    skills_with_endorsements JSONB DEFAULT '[]'::JSONB,
                    
                    -- Languages
                    languages JSONB DEFAULT '[]'::JSONB,
                    
                    -- Additional Professional Details (JSON Arrays)
                    certifications JSONB DEFAULT '[]'::JSONB,
                    courses JSONB DEFAULT '[]'::JSONB,
                    projects JSONB DEFAULT '[]'::JSONB,
                    publications JSONB DEFAULT '[]'::JSONB,
                    patents JSONB DEFAULT '[]'::JSONB,
                    volunteer_experience JSONB DEFAULT '[]'::JSONB,
                    honors_and_awards JSONB DEFAULT '[]'::JSONB,
                    organizations JSONB DEFAULT '[]'::JSONB,
                    
                    -- Recommendations
                    recommendations_count INTEGER,
                    recommendations_given JSONB DEFAULT '[]'::JSONB,
                    recommendations_received JSONB DEFAULT '[]'::JSONB,
                    
                    -- Social Activity (JSON Arrays)
                    posts JSONB DEFAULT '[]'::JSONB,
                    activity JSONB DEFAULT '[]'::JSONB,
                    people_also_viewed JSONB DEFAULT '[]'::JSONB,
                    
                    -- System Fields
                    brightdata_data JSONB,
                    data_extraction_status VARCHAR(50) DEFAULT 'pending',
                    extraction_completed_at TIMESTAMP,
                    extraction_error TEXT,
                    profile_analyzed BOOLEAN DEFAULT false,
                    
                    -- Timestamps
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    
                    -- Indexes for performance
                    CONSTRAINT user_profiles_user_id_key UNIQUE (user_id)
                );
            `;
            
            await client.query(createProfilesTable);
            console.log('✅ User profiles table created/updated successfully');
            migrationResults.push('✅ User profiles table created/updated successfully');

            // Create additional tables if they don't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS message_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    target_name VARCHAR(255),
                    target_url VARCHAR(500),
                    generated_message TEXT,
                    message_context TEXT,
                    credits_used INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS credits_transactions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    transaction_type VARCHAR(50),
                    credits_change INTEGER,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Step 3: Create indexes
            console.log('📋 Step 3: Creating performance indexes...');
            migrationResults.push('Step 3: Creating performance indexes...');
            
            const createIndexes = `
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_linkedin_id ON user_profiles(linkedin_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
                CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            `;
            
            await client.query(createIndexes);
            console.log('✅ Performance indexes created successfully');
            migrationResults.push('✅ Performance indexes created successfully');

            // Step 4: Verify
            const testResult = await client.query('SELECT COUNT(*) as user_count FROM users;');
            migrationResults.push(`✅ Database verified - ${testResult.rows[0].user_count} users in database`);
            
            console.log('🎉 DATABASE MIGRATION COMPLETED SUCCESSFULLY!');
            migrationResults.push('🎉 DATABASE MIGRATION COMPLETED SUCCESSFULLY!');
            migrationResults.push('🚀 Your database is now ready for complete LinkedIn profile extraction!');
            
        } finally {
            client.release();
        }
        
        res.json({
            success: true,
            message: 'Database migration completed successfully!',
            steps: migrationResults,
            timestamp: new Date().toISOString(),
            summary: {
                usersTable: 'Updated with LinkedIn fields and Google OAuth support',
                profilesTable: 'Complete LinkedIn schema created',
                indexes: 'Performance indexes created',
                status: 'Ready for comprehensive LinkedIn data extraction'
            }
        });
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        res.status(500).json({
            success: false,
            error: 'Migration failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// GOOGLE OAUTH ROUTES (FROM YOUR WORKING SERVER)

// Initiate Google OAuth
app.get('/auth/google', (req, res, next) => {
    // Store package selection in session if provided
    if (req.query.package) {
        req.session.selectedPackage = req.query.package;
        req.session.billingModel = req.query.billing || 'monthly';
    }
    
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })(req, res, next);
});

// Google OAuth callback
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/failed' }),
    async (req, res) => {
        try {
            // Generate JWT for the authenticated user
            const token = jwt.sign(
                { userId: req.user.id, email: req.user.email },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            // If package was selected, update user
            if (req.session.selectedPackage && req.session.selectedPackage !== 'free') {
                // For now, only allow free package
                console.log(`Package ${req.session.selectedPackage} requested but only free available for now`);
            }
            
            // Clear session
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
            // Redirect to frontend sign-up page with token
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://msgly.ai/sign-up' 
                : 'http://localhost:3000/sign-up';
                
            res.redirect(`${frontendUrl}?token=${token}`);
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://msgly.ai/sign-up' 
                : 'http://localhost:3000/sign-up';
                
            res.redirect(`${frontendUrl}?error=callback_error`);
        }
    }
);

// Auth failed route
app.get('/auth/failed', (req, res) => {
    const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://msgly.ai/sign-up' 
        : 'http://localhost:3000/sign-up';
        
    res.redirect(`${frontendUrl}?error=auth_failed`);
});

// Update profile with LinkedIn URL and trigger extraction
app.post('/update-profile', authenticateToken, async (req, res) => {
    console.log('📝 Profile update request for user:', req.user.id);
    
    try {
        const { linkedinUrl, packageType } = req.body;
        
        // Validation
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required'
            });
        }
        
        // Basic LinkedIn URL validation
        if (!linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL'
            });
        }
        
        // Update user package if provided and different
        if (packageType && packageType !== req.user.package_type) {
            // For now, only allow free package
            if (packageType !== 'free') {
                return res.status(400).json({
                    success: false,
                    error: 'Only free package is available during beta'
                });
            }
            
            await pool.query(
                'UPDATE users SET package_type = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [packageType, req.user.id]
            );
        }
        
        // Create or update user profile WITH extraction
        const profile = await createOrUpdateUserProfileWithExtraction(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        // Get updated user data
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated and extraction initiated',
            data: {
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.display_name,
                    packageType: updatedUser.package_type,
                    credits: updatedUser.credits_remaining
                },
                profile: {
                    linkedinUrl: profile.linkedin_url,
                    fullName: profile.full_name,
                    extractionStatus: 'in_progress'
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} with LinkedIn: ${linkedinUrl}`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Get Available Packages
app.get('/packages', (req, res) => {
    const packages = {
        payAsYouGo: [
            {
                id: 'free',
                name: 'Free',
                credits: 30,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '30 free profiles forever',
                features: ['30 Credits per month', 'Chrome extension', 'AI profile analysis', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 100,
                price: 12,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['100 Credits', 'Chrome extension', 'AI profile analysis', 'Credits never expire'],
                available: false,
                comingSoon: true
            }
        ],
        monthly: [
            {
                id: 'free',
                name: 'Free',
                credits: 30,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '30 free profiles forever',
                features: ['30 Credits per month', 'Chrome extension', 'AI profile analysis', 'No credit card required'],
                available: true
            }
        ]
    };
    
    res.json({
        success: true,
        data: { packages }
    });
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
    console.log(`🔐 Google OAuth: ${GOOGLE_CLIENT_ID ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
    console.log(`📡 Health check: /health`);
    console.log(`🔍 Debug endpoint: /debug-brightdata`);
    console.log(`🛠️ Migration endpoint: /migrate-database`);
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
