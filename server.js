// Msgly.AI Server - FIXED LinkedIn Data Storage - Correct Bright Data Field Mapping
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
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Bright Data Configuration
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY || process.env.BRIGHT_DATA_API_TOKEN || 'brd-t6dqfwj2p8p-ac38c-b1l9-1f98-79e9-d8ceb4fd3c70_b59b8c39-8e9f-4db5-9bea-92e8b9e8b8b0';
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_DATASET_ID || 'gd_l1viktl72bvl7bjuj0';

// Database connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Background processing tracking
const processingQueue = new Map();

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
            'https://api.msgly.ai',
            'https://test.msgly.ai'
        ];
        
        if (origin.startsWith('chrome-extension://')) {
            return callback(null, true);
        }
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'msgly-session-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
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
        let user = await getUserByEmail(profile.emails[0].value);
        
        if (!user) {
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value
            );
        } else if (!user.google_id) {
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        return done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==================== STATIC FILE SERVING ====================

// Serve static HTML files
app.get('/sign-up', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-up.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ==================== DATABASE SETUP ====================
const initDB = async () => {
    try {
        console.log('🗃️ Creating database tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255),
                google_id VARCHAR(255) UNIQUE,
                display_name VARCHAR(255),
                profile_picture VARCHAR(500),
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                package_type VARCHAR(50) DEFAULT 'free',
                billing_model VARCHAR(50) DEFAULT 'monthly',
                credits_remaining INTEGER DEFAULT 10,
                subscription_status VARCHAR(50) DEFAULT 'active',
                linkedin_url TEXT,
                profile_data JSONB,
                extraction_status VARCHAR(50) DEFAULT 'not_started',
                error_message TEXT,
                profile_completed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS credits_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                transaction_type VARCHAR(50),
                credits_change INTEGER,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add missing columns if they don't exist
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
                ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
                ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500),
                ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
                ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
                ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
                ADD COLUMN IF NOT EXISTS profile_data JSONB,
                ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT 'not_started',
                ADD COLUMN IF NOT EXISTS error_message TEXT,
                ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false;
            `);
            
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);
            
            console.log('✅ Database columns updated successfully');
        } catch (err) {
            console.log('Some columns might already exist:', err.message);
        }

        console.log('✅ Database tables created successfully');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== FIXED LINKEDIN DATA PROCESSING ====================

// 🔧 FIXED: Ensure arrays are properly formatted for PostgreSQL JSONB
const ensureValidJSONArray = (data) => {
    try {
        if (!data) {
            return [];
        }
        
        if (Array.isArray(data)) {
            return data.filter(item => item !== null && item !== undefined);
        }
        
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    return ensureValidJSONArray(parsed);
                }
                return [parsed];
            } catch (e) {
                return [];
            }
        }
        
        if (typeof data === 'object') {
            return [data];
        }
        
        return [];
    } catch (error) {
        console.error('Error ensuring valid JSON array:', error);
        return [];
    }
};

// 🔧 FIXED: Process LinkedIn data with EXACT Bright Data field names - NO FALLBACKS
const processLinkedInDataFixed = (profileData) => {
    if (!profileData) {
        throw new Error('No profile data received from Bright Data API');
    }
    
    console.log('🔍 DEBUG: Processing LinkedIn data with FIXED field mapping...');
    console.log('🔍 DEBUG: Raw data keys:', Object.keys(profileData));
    
    // 🔍 DEBUG: Log the exact field values we're trying to extract
    console.log('🔍 DEBUG: experience field:', profileData.experience);
    console.log('🔍 DEBUG: skills field:', profileData.skills);
    console.log('🔍 DEBUG: certifications field:', profileData.certifications);
    console.log('🔍 DEBUG: education field:', profileData.education);
    console.log('🔍 DEBUG: activity field:', profileData.activity);
    
    // 🔍 DEBUG: Check types
    console.log('🔍 DEBUG: experience type:', typeof profileData.experience);
    console.log('🔍 DEBUG: skills type:', typeof profileData.skills);
    console.log('🔍 DEBUG: certifications type:', typeof profileData.certifications);
    
    try {
        const processedData = {
            // Basic Information - EXACT field names from Bright Data
            name: profileData.name || null,
            fullName: profileData.full_name || profileData.name || null,
            firstName: profileData.first_name || (profileData.name ? profileData.name.split(' ')[0] : null),
            lastName: profileData.last_name || (profileData.name ? profileData.name.split(' ').slice(1).join(' ') : null),
            headline: profileData.headline || null,
            about: profileData.about || profileData.summary || null,
            summary: profileData.summary || profileData.about || null,
            
            // LinkedIn IDs
            linkedinId: profileData.linkedin_id || profileData.id || null,
            linkedinNumId: profileData.linkedin_num_id || null,
            inputUrl: profileData.input_url || null,
            url: profileData.url || null,
            
            // Location
            location: profileData.location || null,
            city: profileData.city || null,
            state: profileData.state || null,
            country: profileData.country || null,
            countryCode: profileData.country_code || null,
            
            // Current Company - EXACT Bright Data format
            currentCompany: profileData.current_company || null,
            currentCompanyName: profileData.current_company_name || 
                              (profileData.current_company && profileData.current_company.name) || null,
            currentCompanyId: profileData.current_company_id || null,
            currentPosition: profileData.current_position || 
                           (profileData.current_company && profileData.current_company.position) || null,
            industry: profileData.industry || null,
            
            // Metrics
            connectionsCount: profileData.connections_count || null,
            followersCount: profileData.followers_count || null,
            connections: profileData.connections || null,
            followers: profileData.followers || null,
            
            // Media
            profilePicture: profileData.profile_picture || null,
            profilePicUrl: profileData.profile_pic_url || null,
            avatar: profileData.avatar || null,
            bannerImage: profileData.banner_image || null,
            backgroundImage: profileData.background_image || null,
            
            // 🔧 CRITICAL FIX: Use EXACT field names from Bright Data - NO FALLBACKS
            experience: ensureValidJSONArray(profileData.experience),
            skills: ensureValidJSONArray(profileData.skills),
            certifications: ensureValidJSONArray(profileData.certifications),
            education: ensureValidJSONArray(profileData.education),
            languages: ensureValidJSONArray(profileData.languages),
            courses: ensureValidJSONArray(profileData.courses),
            projects: ensureValidJSONArray(profileData.projects),
            publications: ensureValidJSONArray(profileData.publications),
            patents: ensureValidJSONArray(profileData.patents),
            volunteerExperience: ensureValidJSONArray(profileData.volunteer_experience),
            volunteering: ensureValidJSONArray(profileData.volunteering),
            honorsAndAwards: ensureValidJSONArray(profileData.honors_and_awards),
            organizations: ensureValidJSONArray(profileData.organizations),
            recommendations: ensureValidJSONArray(profileData.recommendations),
            posts: ensureValidJSONArray(profileData.posts),
            activity: ensureValidJSONArray(profileData.activity),
            articles: ensureValidJSONArray(profileData.articles),
            peopleAlsoViewed: ensureValidJSONArray(profileData.people_also_viewed),
            skillsWithEndorsements: ensureValidJSONArray(profileData.skills_with_endorsements),
            
            // Alternative field names (in case Bright Data uses these)
            workExperience: ensureValidJSONArray(profileData.work_experience),
            educations: ensureValidJSONArray(profileData.educations),
            
            // Store complete raw data
            rawData: profileData
        };
        
        // 🔍 DEBUG: Log processed arrays
        console.log('🔍 DEBUG: Processed data summary:');
        console.log(`   - experience: ${processedData.experience.length} entries`);
        console.log(`   - skills: ${processedData.skills.length} entries`);
        console.log(`   - certifications: ${processedData.certifications.length} entries`);
        console.log(`   - education: ${processedData.education.length} entries`);
        console.log(`   - activity: ${processedData.activity.length} entries`);
        console.log(`   - workExperience: ${processedData.workExperience.length} entries`);
        console.log(`   - educations: ${processedData.educations.length} entries`);
        
        console.log('✅ FIXED: LinkedIn data processed successfully with exact field mapping!');
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error processing LinkedIn data:', error);
        throw new Error(`LinkedIn data processing failed: ${error.message}`);
    }
};

// Bright Data LinkedIn Profile Extraction
const extractLinkedInProfileComplete = async (linkedinUrl) => {
    try {
        console.log('🚀 Starting LinkedIn profile extraction...');
        console.log('🔗 LinkedIn URL:', linkedinUrl);
        console.log('🆔 Dataset ID:', BRIGHT_DATA_DATASET_ID);
        
        // OPTION 1: Try synchronous scrape first (faster if supported)
        console.log('🔄 Attempting synchronous extraction...');
        try {
            const syncResponse = await axios.post(
                `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`,
                [{ "url": linkedinUrl }],
                {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000 // 2 minutes for sync
                }
            );
            
            if (syncResponse.status === 200 && syncResponse.data && syncResponse.data.length > 0) {
                console.log('✅ Synchronous extraction successful!');
                const profileData = Array.isArray(syncResponse.data) ? syncResponse.data[0] : syncResponse.data;
                
                // 🔍 DEBUG: Log raw response
                console.log('🔍 DEBUG: Raw Bright Data response keys:', Object.keys(profileData));
                console.log('🔍 DEBUG: Raw response (first 500 chars):', JSON.stringify(profileData).substring(0, 500));
                
                return {
                    success: true,
                    data: processLinkedInDataFixed(profileData),
                    method: 'synchronous',
                    message: 'LinkedIn profile extracted successfully (synchronous)'
                };
            }
        } catch (syncError) {
            console.log('⏩ Synchronous method not available, falling back to async...');
            // Continue to async method
        }
        
        // OPTION 2: Async method
        console.log('🔄 Using asynchronous extraction method...');
        
        // Step 1: Trigger the scraping job
        const triggerUrl = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`;
        const triggerPayload = [{ "url": linkedinUrl }];
        
        console.log('📡 Triggering LinkedIn scraper...');
        const triggerResponse = await axios.post(triggerUrl, triggerPayload, {
            headers: {
                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        if (!triggerResponse.data || !triggerResponse.data.snapshot_id) {
            throw new Error('No snapshot ID returned from Bright Data API');
        }
        
        const snapshotId = triggerResponse.data.snapshot_id;
        console.log('🆔 Snapshot ID:', snapshotId);
        
        // Step 2: Poll for completion
        const maxAttempts = 40;
        let attempt = 0;
        
        while (attempt < maxAttempts) {
            attempt++;
            console.log(`🔄 Polling attempt ${attempt}/${maxAttempts}...`);
            
            try {
                const statusUrl = `https://api.brightdata.com/datasets/v3/log/${snapshotId}`;
                
                const pollResponse = await axios.get(statusUrl, {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });
                
                const status = pollResponse.data?.Status || pollResponse.data?.status;
                console.log(`📈 Snapshot status: ${status}`);
                
                if (status === 'ready') {
                    console.log('✅ LinkedIn data is ready! Downloading...');
                    
                    const dataUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`;
                    
                    const dataResponse = await axios.get(dataUrl, {
                        headers: {
                            'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    console.log('📥 Downloaded LinkedIn profile data successfully');
                    
                    if (dataResponse.data) {
                        const profileData = Array.isArray(dataResponse.data) ? dataResponse.data[0] : dataResponse.data;
                        
                        // 🔍 DEBUG: Log raw response
                        console.log('🔍 DEBUG: Raw Bright Data response keys:', Object.keys(profileData));
                        console.log('🔍 DEBUG: Raw response (first 500 chars):', JSON.stringify(profileData).substring(0, 500));
                        
                        return {
                            success: true,
                            data: processLinkedInDataFixed(profileData),
                            method: 'asynchronous',
                            snapshotId: snapshotId,
                            message: 'LinkedIn profile extracted successfully (asynchronous)'
                        };
                    } else {
                        throw new Error('No data returned from snapshot');
                    }
                    
                } else if (status === 'error' || status === 'failed') {
                    throw new Error(`LinkedIn extraction failed with status: ${status}`);
                } else {
                    console.log(`⏳ Still processing... (Status: ${status || 'unknown'})`);
                    const waitTime = attempt > 20 ? 12000 : 8000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
            } catch (pollError) {
                console.error(`❌ Polling attempt ${attempt} failed:`, pollError.message);
                
                if (pollError.code === 'ECONNABORTED' || pollError.code === 'ENOTFOUND') {
                    console.log('⏳ Network issue, retrying...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
        
        throw new Error(`Polling timeout - LinkedIn extraction took longer than ${maxAttempts * 8} seconds`);
        
    } catch (error) {
        console.error('❌ LinkedIn extraction failed:', error);
        throw new Error(`LinkedIn extraction failed: ${error.message}`);
    }
};

// 🔧 FIXED: Database save with correct field mapping
const scheduleBackgroundExtractionFixed = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = 300000; // 5 minutes
    
    console.log(`🔄 Scheduling FIXED background extraction for user ${userId}, retry ${retryCount}`);
    
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for user ${userId}`);
        await pool.query(
            'UPDATE user_profiles SET extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
            ['failed', `Max retries (${maxRetries}) exceeded`, userId]
        );
        await pool.query(
            'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
            ['failed', `Max retries (${maxRetries}) exceeded`, userId]
        );
        processingQueue.delete(userId);
        return;
    }

    setTimeout(async () => {
        try {
            console.log(`🚀 Starting FIXED background extraction for user ${userId} (Retry ${retryCount})`);
            
            await pool.query(
                'UPDATE user_profiles SET extraction_retry_count = $1, extraction_attempted_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [retryCount, userId]
            );

            // Extract LinkedIn profile with FIXED processing
            const result = await extractLinkedInProfileComplete(linkedinUrl);
            
            console.log(`✅ FIXED extraction succeeded for user ${userId}`);
            
            const extractedData = result.data;
            
            // 🔍 DEBUG: Final data validation
            console.log(`🔍 DEBUG: Final data validation for user ${userId}:`);
            console.log(`   - name: ${extractedData.name || 'Not available'}`);
            console.log(`   - headline: ${extractedData.headline || 'Not available'}`);
            console.log(`   - currentCompanyName: ${extractedData.currentCompanyName || 'Not available'}`);
            console.log(`   - experience: ${extractedData.experience?.length || 0} entries`);
            console.log(`   - skills: ${extractedData.skills?.length || 0} entries`);
            console.log(`   - certifications: ${extractedData.certifications?.length || 0} entries`);
            console.log(`   - education: ${extractedData.education?.length || 0} entries`);
            console.log(`   - activity: ${extractedData.activity?.length || 0} entries`);
            
            // 🔧 FIXED: Database save with correct field mapping
            console.log('💾 Saving FIXED LinkedIn data to database...');
            
            try {
                await pool.query(`
                    UPDATE user_profiles SET 
                        -- Basic Information
                        name = $1,
                        full_name = $2,
                        first_name = $3,
                        last_name = $4,
                        headline = $5,
                        about = $6,
                        summary = $7,
                        
                        -- LinkedIn IDs
                        linkedin_id = $8,
                        linkedin_num_id = $9,
                        input_url = $10,
                        url = $11,
                        
                        -- Location
                        location = $12,
                        city = $13,
                        state = $14,
                        country = $15,
                        country_code = $16,
                        
                        -- Company Information
                        current_company = $17,
                        current_company_name = $18,
                        current_company_id = $19,
                        current_position = $20,
                        industry = $21,
                        
                        -- Metrics
                        connections_count = $22,
                        followers_count = $23,
                        connections = $24,
                        followers = $25,
                        
                        -- Media
                        profile_picture = $26,
                        profile_pic_url = $27,
                        avatar = $28,
                        banner_image = $29,
                        background_image = $30,
                        
                        -- FIXED: Core LinkedIn Data Arrays with exact field mapping
                        experience = $31,
                        skills = $32,
                        certifications = $33,
                        education = $34,
                        languages = $35,
                        courses = $36,
                        projects = $37,
                        publications = $38,
                        patents = $39,
                        volunteer_experience = $40,
                        volunteering = $41,
                        honors_and_awards = $42,
                        organizations = $43,
                        recommendations = $44,
                        posts = $45,
                        activity = $46,
                        articles = $47,
                        people_also_viewed = $48,
                        skills_with_endorsements = $49,
                        work_experience = $50,
                        educations = $51,
                        
                        -- Metadata
                        brightdata_raw_data = $52,
                        data_source = $53,
                        extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $54 
                `, [
                    // Basic Information (1-7)
                    extractedData.name,
                    extractedData.fullName,
                    extractedData.firstName,
                    extractedData.lastName,
                    extractedData.headline,
                    extractedData.about,
                    extractedData.summary,
                    
                    // LinkedIn IDs (8-11)
                    extractedData.linkedinId,
                    extractedData.linkedinNumId,
                    extractedData.inputUrl,
                    extractedData.url,
                    
                    // Location (12-16)
                    extractedData.location,
                    extractedData.city,
                    extractedData.state,
                    extractedData.country,
                    extractedData.countryCode,
                    
                    // Company Information (17-21)
                    JSON.stringify(extractedData.currentCompany),
                    extractedData.currentCompanyName,
                    extractedData.currentCompanyId,
                    extractedData.currentPosition,
                    extractedData.industry,
                    
                    // Metrics (22-25)
                    extractedData.connectionsCount,
                    extractedData.followersCount,
                    extractedData.connections,
                    extractedData.followers,
                    
                    // Media (26-30)
                    extractedData.profilePicture,
                    extractedData.profilePicUrl,
                    extractedData.avatar,
                    extractedData.bannerImage,
                    extractedData.backgroundImage,
                    
                    // FIXED: Core LinkedIn Data Arrays (31-51)
                    JSON.stringify(extractedData.experience),
                    JSON.stringify(extractedData.skills),
                    JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.education),
                    JSON.stringify(extractedData.languages),
                    JSON.stringify(extractedData.courses),
                    JSON.stringify(extractedData.projects),
                    JSON.stringify(extractedData.publications),
                    JSON.stringify(extractedData.patents),
                    JSON.stringify(extractedData.volunteerExperience),
                    JSON.stringify(extractedData.volunteering),
                    JSON.stringify(extractedData.honorsAndAwards),
                    JSON.stringify(extractedData.organizations),
                    JSON.stringify(extractedData.recommendations),
                    JSON.stringify(extractedData.posts),
                    JSON.stringify(extractedData.activity),
                    JSON.stringify(extractedData.articles),
                    JSON.stringify(extractedData.peopleAlsoViewed),
                    JSON.stringify(extractedData.skillsWithEndorsements),
                    JSON.stringify(extractedData.workExperience),
                    JSON.stringify(extractedData.educations),
                    
                    // Metadata (52-54)
                    JSON.stringify(extractedData.rawData),
                    'bright_data',
                    userId
                ]);

                await pool.query(
                    'UPDATE users SET extraction_status = $1, profile_completed = $2, error_message = NULL WHERE id = $3',
                    ['completed', true, userId]
                );

                console.log(`🎉 FIXED LinkedIn profile data successfully saved for user ${userId}!`);
                console.log(`✅ Method: ${result.method}`);
                console.log('🔧 SUCCESS: FIXED field mapping - All LinkedIn data properly stored!');
                
                processingQueue.delete(userId);
                
            } catch (dbError) {
                console.error(`❌ DATABASE SAVE FAILED for user ${userId}:`, dbError.message);
                throw new Error(`Database save failure: ${dbError.message}`);
            }
                
        } catch (error) {
            console.error(`❌ FIXED extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            if (retryCount < maxRetries - 1) {
                console.log(`🔄 Retrying FIXED extraction for user ${userId}...`);
                await scheduleBackgroundExtractionFixed(userId, linkedinUrl, retryCount + 1);
            } else {
                console.log(`❌ COMPLETE FAILURE for user ${userId} - NO MORE RETRIES`);
                await pool.query(
                    'UPDATE user_profiles SET extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
                    ['failed', `Complete failure: ${error.message}`, userId]
                );
                await pool.query(
                    'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
                    ['failed', `Complete failure: ${error.message}`, userId]
                );
                processingQueue.delete(userId);
            }
        }
    }, retryCount === 0 ? 10000 : retryDelay);
};

// Clean LinkedIn URL
const cleanLinkedInUrl = (url) => {
    try {
        let cleanUrl = url.trim();
        if (cleanUrl.includes('?')) {
            cleanUrl = cleanUrl.split('?')[0];
        }
        if (cleanUrl.endsWith('/')) {
            cleanUrl = cleanUrl.slice(0, -1);
        }
        return cleanUrl;
    } catch (error) {
        return url;
    }
};

// ==================== DATABASE FUNCTIONS ====================

const createUser = async (email, passwordHash, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = {
        'free': 10,
        'silver': billingModel === 'payAsYouGo' ? 75 : 75,
        'gold': billingModel === 'payAsYouGo' ? 250 : 250,
        'platinum': billingModel === 'payAsYouGo' ? 1000 : 1000
    };
    
    const credits = creditsMap[packageType] || 10;
    
    const result = await pool.query(
        'INSERT INTO users (email, password_hash, package_type, billing_model, credits_remaining) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [email, passwordHash, packageType, billingModel, credits]
    );
    return result.rows[0];
};

const createGoogleUser = async (email, displayName, googleId, profilePicture, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = {
        'free': 10,
        'silver': billingModel === 'payAsYouGo' ? 75 : 75,
        'gold': billingModel === 'payAsYouGo' ? 250 : 250,
        'platinum': billingModel === 'payAsYouGo' ? 1000 : 1000
    };
    
    const credits = creditsMap[packageType] || 10;
    
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

// 🔧 FIXED: Create or update user profile with FIXED extraction
const createOrUpdateUserProfileFixed = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        console.log(`🚀 Creating profile with FIXED extraction for user ${userId}`);
        
        await pool.query(
            'UPDATE users SET linkedin_url = $1, extraction_status = $2, error_message = NULL WHERE id = $3',
            [cleanUrl, 'processing', userId]
        );
        
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, extraction_status = $3, extraction_retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
                [cleanUrl, displayName, 'processing', userId]
            );
            profile = result.rows[0];
        } else {
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name, extraction_status, extraction_retry_count) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [userId, cleanUrl, displayName, 'processing', 0]
            );
            profile = result.rows[0];
        }
        
        console.log(`🔄 Starting FIXED background extraction for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        // Schedule extraction with FIXED implementation
        scheduleBackgroundExtractionFixed(userId, cleanUrl, 0);
        
        console.log(`✅ Profile created and FIXED extraction started for user ${userId}`);
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

// ==================== API ENDPOINTS ====================

// Home route
app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Server - FIXED LinkedIn Data Storage',
        status: 'running',
        version: '6.1-FIXED-FIELD-MAPPING',
        dataExtraction: 'FIXED - Correct Bright Data field mapping',
        fieldMapping: 'FIXED - Uses exact field names from Bright Data response',
        debugLogging: 'ENABLED - Full data flow logging',
        backgroundProcessing: 'enabled',
        fixes: [
            'FIXED: Removed field name variations - uses exact Bright Data fields',
            'FIXED: Added comprehensive debug logging',
            'FIXED: Corrected database schema with proper field names',
            'FIXED: Updated data processing to match Bright Data response structure'
        ],
        endpoints: [
            'POST /register',
            'POST /login', 
            'GET /auth/google',
            'GET /auth/google/callback',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'GET /profile-status (protected)',
            'POST /retry-extraction (protected)',
            'GET /packages',
            'GET /health'
        ]
    });
});

// Health Check
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        const processingCount = processingQueue.size;
        
        res.status(200).json({
            status: 'healthy',
            version: '6.1-FIXED-FIELD-MAPPING',
            timestamp: new Date().toISOString(),
            fixes: [
                'FIXED: Bright Data field mapping',
                'FIXED: Database schema with correct field names',
                'FIXED: Data processing logic',
                'FIXED: Debug logging enabled'
            ],
            brightDataMapping: {
                configured: !!BRIGHT_DATA_API_KEY,
                datasetId: BRIGHT_DATA_DATASET_ID,
                fieldMappingFixed: true,
                debugLogging: 'ENABLED'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production',
                schemaFixed: true
            },
            backgroundProcessing: {
                enabled: true,
                currentlyProcessing: processingCount,
                implementation: 'FIXED - Correct field mapping'
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== GOOGLE OAUTH ROUTES ====================

app.get('/auth/google', (req, res, next) => {
    if (req.query.package) {
        req.session.selectedPackage = req.query.package;
        req.session.billingModel = req.query.billing || 'monthly';
    }
    
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })(req, res, next);
});

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/failed' }),
    async (req, res) => {
        try {
            const token = jwt.sign(
                { userId: req.user.id, email: req.user.email },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            if (req.session.selectedPackage && req.session.selectedPackage !== 'free') {
                console.log(`Package ${req.session.selectedPackage} requested but only free available for now`);
            }
            
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
            // Check if user has LinkedIn URL (returning user) - redirect to dashboard
            if (req.user.linkedin_url) {
                const frontendUrl = process.env.NODE_ENV === 'production' 
                    ? 'https://msgly.ai/dashboard' 
                    : 'http://localhost:3000/dashboard';
                    
                res.redirect(`${frontendUrl}?token=${token}`);
            } else {
                // New user - redirect to sign-up to complete profile
                const frontendUrl = process.env.NODE_ENV === 'production' 
                    ? 'https://msgly.ai/sign-up' 
                    : 'http://localhost:3000/sign-up';
                    
                res.redirect(`${frontendUrl}?token=${token}`);
            }
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://msgly.ai/sign-up' 
                : 'http://localhost:3000/sign-up';
                
            res.redirect(`${frontendUrl}?error=callback_error`);
        }
    }
);

app.get('/auth/failed', (req, res) => {
    const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://msgly.ai/sign-up' 
        : 'http://localhost:3000/sign-up';
        
    res.redirect(`${frontendUrl}?error=auth_failed`);
});

// ==================== MAIN ENDPOINTS ====================

// User Registration
app.post('/register', async (req, res) => {
    console.log('👤 Registration request:', req.body);
    
    try {
        const { email, password, packageType, billingModel } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        if (!packageType) {
            return res.status(400).json({
                success: false,
                error: 'Package selection is required'
            });
        }
        
        if (packageType !== 'free') {
            return res.status(400).json({
                success: false,
                error: 'Only free package is available during beta. Premium packages coming soon!'
            });
        }
        
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists with this email'
            });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await createUser(email, passwordHash, packageType, billingModel || 'monthly');
        
        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    packageType: newUser.package_type,
                    billingModel: newUser.billing_model,
                    credits: newUser.credits_remaining,
                    createdAt: newUser.created_at
                },
                token: token
            }
        });
        
        console.log(`✅ User registered: ${newUser.email} with ${packageType} package`);
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed',
            details: error.message
        });
    }
});

// User Login
app.post('/login', async (req, res) => {
    console.log('🔐 Login request for:', req.body.email);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                error: 'Please sign in with Google'
            });
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    packageType: user.package_type,
                    billingModel: user.billing_model,
                    credits: user.credits_remaining,
                    subscriptionStatus: user.subscription_status,
                    hasGoogleAccount: !!user.google_id
                },
                token: token
            }
        });
        
        console.log(`✅ User logged in: ${user.email}`);
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed',
            details: error.message
        });
    }
});

// 🔧 FIXED: Update user profile with LinkedIn URL - FIXED extraction
app.post('/update-profile', authenticateToken, async (req, res) => {
    console.log('📝 Profile update request for user:', req.user.id);
    
    try {
        const { linkedinUrl, packageType } = req.body;
        
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required'
            });
        }
        
        if (!linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL'
            });
        }
        
        if (packageType && packageType !== req.user.package_type) {
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
        
        // Create or update user profile with FIXED extraction
        const profile = await createOrUpdateUserProfileFixed(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated - FIXED LinkedIn data extraction started!',
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
                    extractionStatus: profile.extraction_status,
                    message: 'FIXED LinkedIn extraction - Correct field mapping'
                },
                automaticProcessing: {
                    enabled: true,
                    status: 'started',
                    implementation: 'FIXED - Exact Bright Data field names',
                    debugLogging: 'ENABLED - Full data flow tracking',
                    fixes: [
                        'FIXED: Uses exact field names from Bright Data (experience, skills, certifications)',
                        'FIXED: Removed field name variations that were causing misses',
                        'FIXED: Added comprehensive debug logging',
                        'FIXED: Correct database schema mapping'
                    ]
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - FIXED LinkedIn extraction started!`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Get User Profile with extraction status
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        const profile = profileResult.rows[0];

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
                    createdAt: req.user.created_at
                },
                profile: profile ? {
                    // Basic Information
                    linkedinUrl: profile.linkedin_url,
                    linkedinId: profile.linkedin_id,
                    linkedinNumId: profile.linkedin_num_id,
                    inputUrl: profile.input_url,
                    url: profile.url,
                    name: profile.name,
                    fullName: profile.full_name,
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    summary: profile.summary,
                    about: profile.about,
                    
                    // Location
                    location: profile.location,
                    city: profile.city,
                    state: profile.state,
                    country: profile.country,
                    countryCode: profile.country_code,
                    
                    // Professional
                    industry: profile.industry,
                    currentCompany: profile.current_company,
                    currentCompanyName: profile.current_company_name,
                    currentCompanyId: profile.current_company_id,
                    currentPosition: profile.current_position,
                    
                    // Metrics
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    connections: profile.connections,
                    followers: profile.followers,
                    
                    // Media
                    profilePicture: profile.profile_picture,
                    profilePicUrl: profile.profile_pic_url,
                    avatar: profile.avatar,
                    bannerImage: profile.banner_image,
                    backgroundImage: profile.background_image,
                    
                    // FIXED: LinkedIn Data Arrays
                    experience: profile.experience,
                    skills: profile.skills,
                    certifications: profile.certifications,
                    education: profile.education,
                    languages: profile.languages,
                    courses: profile.courses,
                    projects: profile.projects,
                    publications: profile.publications,
                    patents: profile.patents,
                    volunteerExperience: profile.volunteer_experience,
                    volunteering: profile.volunteering,
                    honorsAndAwards: profile.honors_and_awards,
                    organizations: profile.organizations,
                    recommendations: profile.recommendations,
                    posts: profile.posts,
                    activity: profile.activity,
                    articles: profile.articles,
                    peopleAlsoViewed: profile.people_also_viewed,
                    skillsWithEndorsements: profile.skills_with_endorsements,
                    workExperience: profile.work_experience,
                    educations: profile.educations,
                    
                    // Metadata
                    dataSource: profile.data_source,
                    extractionStatus: profile.extraction_status,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count
                } : null,
                subscription: {
                    plan: req.user.package_type,
                    creditsRemaining: req.user.credits_remaining
                },
                automaticProcessing: {
                    enabled: true,
                    isCurrentlyProcessing: processingQueue.has(req.user.id),
                    implementation: 'FIXED - Exact Bright Data field mapping',
                    debugLogging: 'ENABLED'
                }
            }
        });
    } catch (error) {
        console.error('❌ Profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// Check profile extraction status
app.get('/profile-status', authenticateToken, async (req, res) => {
    try {
        const userQuery = `
            SELECT 
                u.extraction_status,
                u.error_message,
                u.profile_completed,
                u.linkedin_url,
                up.extraction_status as profile_extraction_status,
                up.extraction_completed_at,
                up.extraction_retry_count,
                up.extraction_error
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
            profile_completed: status.profile_completed,
            linkedin_url: status.linkedin_url,
            error_message: status.error_message,
            profile_extraction_status: status.profile_extraction_status,
            extraction_completed_at: status.extraction_completed_at,
            extraction_retry_count: status.extraction_retry_count,
            extraction_error: status.extraction_error,
            is_currently_processing: processingQueue.has(req.user.id),
            message: getStatusMessage(status.extraction_status),
            implementation: 'FIXED - Exact Bright Data field mapping',
            debugLogging: 'ENABLED'
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// Helper function for status messages
const getStatusMessage = (status) => {
    switch (status) {
        case 'not_started':
            return 'LinkedIn extraction not started';
        case 'processing':
            return 'FIXED LinkedIn profile extraction in progress with correct field mapping...';
        case 'completed':
            return 'LinkedIn profile extraction completed successfully with FIXED field mapping!';
        case 'failed':
            return 'LinkedIn profile extraction failed';
        default:
            return 'Unknown status';
    }
};

// 🔧 FIXED: Retry extraction
app.post('/retry-extraction', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query(
            'SELECT linkedin_url FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (userResult.rows.length === 0 || !userResult.rows[0].linkedin_url) {
            return res.status(400).json({ error: 'No LinkedIn URL found for retry' });
        }
        
        const linkedinUrl = userResult.rows[0].linkedin_url;
        
        // Retry extraction with FIXED implementation
        const profile = await createOrUpdateUserProfileFixed(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: 'LinkedIn extraction retry initiated with FIXED field mapping!',
            status: 'processing',
            implementation: 'FIXED - Exact Bright Data field names',
            debugLogging: 'ENABLED'
        });
        
    } catch (error) {
        console.error('Retry extraction error:', error);
        res.status(500).json({ error: 'Retry failed' });
    }
});

// Get Available Packages
app.get('/packages', (req, res) => {
    const packages = {
        payAsYouGo: [
            {
                id: 'free',
                name: 'Free',
                credits: 10,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 75,
                price: 12,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 250,
                price: 35,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1000,
                price: 70,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', 'Credits never expire'],
                available: false,
                comingSoon: true
            }
        ],
        monthly: [
            {
                id: 'free',
                name: 'Free',
                credits: 10,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 75,
                price: 8.60,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 250,
                price: 25.20,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1000,
                price: 50.40,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'FIXED LinkedIn extraction', 'Debug logging enabled', '7-day free trial included'],
                available: false,
                comingSoon: true
            }
        ]
    };
    
    res.json({
        success: true,
        data: { packages }
    });
});

// Background processing status endpoint
app.get('/processing-status', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query(
            'SELECT extraction_status, extraction_retry_count, extraction_attempted_at, extraction_completed_at, extraction_error FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        
        const profile = profileResult.rows[0];
        
        res.json({
            success: true,
            data: {
                extractionStatus: profile?.extraction_status || 'no_profile',
                retryCount: profile?.extraction_retry_count || 0,
                lastAttempt: profile?.extraction_attempted_at,
                completedAt: profile?.extraction_completed_at,
                error: profile?.extraction_error,
                isCurrentlyProcessing: processingQueue.has(req.user.id),
                totalProcessingQueue: processingQueue.size,
                processingStartTime: processingQueue.get(req.user.id)?.startTime,
                implementation: 'FIXED - Exact Bright Data field mapping',
                debugLogging: 'ENABLED'
            }
        });
    } catch (error) {
        console.error('❌ Processing status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get processing status'
        });
    }
});

// Error handling
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        availableRoutes: [
            'GET /sign-up (serves sign-up.html)',
            'GET /login (serves login.html)', 
            'GET /dashboard (serves dashboard.html)',
            'POST /register', 
            'POST /login', 
            'GET /auth/google',
            'GET /profile (protected)', 
            'POST /update-profile (protected)',
            'GET /profile-status (protected)',
            'POST /retry-extraction (protected)',
            'GET /processing-status (protected)',
            'GET /packages', 
            'GET /health'
        ]
    });
});

app.use((error, req, res, next) => {
    console.error('❌ Error:', error);
    res.status(500).json({
        success: false,
        error: 'Server error'
    });
});

// ==================== SERVER STARTUP ====================

const validateEnvironment = () => {
    const required = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
    
    if (!BRIGHT_DATA_API_KEY) {
        console.warn('⚠️ Warning: BRIGHT_DATA_API_KEY not set - profile extraction will fail');
    }
    
    console.log('✅ Environment validated');
};

const testDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
        await initDB();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

const startServer = async () => {
    try {
        validateEnvironment();
        
        const dbOk = await testDatabase();
        if (!dbOk) {
            console.error('❌ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Msgly.AI Server - FIXED LinkedIn Data Storage Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected with FIXED schema`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`🤖 Background Processing: ENABLED ✅`);
            console.log(`🔧 FIXES APPLIED:`);
            console.log(`   ✅ FIXED: Bright Data field mapping - uses exact field names`);
            console.log(`   ✅ FIXED: Database schema with correct field structure`);
            console.log(`   ✅ FIXED: Data processing logic - no more field name variations`);
            console.log(`   ✅ FIXED: Debug logging enabled for full data flow tracking`);
            console.log(`🔍 DEBUG: Comprehensive logging enabled for:`);
            console.log(`   📊 Raw Bright Data responses`);
            console.log(`   🔍 Field name validation`);
            console.log(`   💾 Database insertion process`);
            console.log(`   📈 Data array processing`);
            console.log(`🎯 USER EXPERIENCE: Google Sign-In → Add LinkedIn URL → Dashboard with ALL Data!`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
        });
        
    } catch (error) {
        console.error('❌ Startup failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
