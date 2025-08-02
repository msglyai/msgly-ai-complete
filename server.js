// Msgly.AI Server - FIXED FIELD MAPPING - Based on Your Actual Bright Data Response
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
        console.log('🗃️ Initializing database...');

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
            
            console.log('✅ Database users table verified');
        } catch (err) {
            console.log('Some users columns might already exist:', err.message);
        }

        console.log('✅ Database initialization completed');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== FIXED BRIGHT DATA PROCESSING - EXACT FIELD NAMES ====================

// FIXED: Proper JSON sanitization for PostgreSQL JSONB
const sanitizeForJSONB = (data) => {
    if (data === null || data === undefined) {
        return null;
    }
    
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
    }
    
    if (Array.isArray(data)) {
        return data.map(item => sanitizeForJSONB(item)).filter(item => item !== null);
    }
    
    if (typeof data === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            const sanitizedValue = sanitizeForJSONB(value);
            if (sanitizedValue !== null) {
                sanitized[key] = sanitizedValue;
            }
        }
        return sanitized;
    }
    
    return data;
};

// FIXED: Ensure arrays are valid JSONB format
const ensureValidJSONBArray = (data) => {
    try {
        if (!data) return [];
        
        if (Array.isArray(data)) {
            const sanitized = data.map(item => sanitizeForJSONB(item)).filter(item => item !== null);
            JSON.parse(JSON.stringify(sanitized));
            return sanitized;
        }
        
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    return ensureValidJSONBArray(parsed);
                }
                return [parsed];
            } catch (e) {
                return [];
            }
        }
        
        if (typeof data === 'object') {
            return [sanitizeForJSONB(data)];
        }
        
        return [];
    } catch (error) {
        console.error('Error ensuring valid JSONB array:', error);
        return [];
    }
};

// FIXED: Parse LinkedIn numeric values properly
const parseLinkedInNumber = (value) => {
    if (!value) return null;
    if (typeof value === 'number') return value;
    
    try {
        const str = value.toString().toLowerCase().trim();
        
        if (str.includes('m')) {
            const num = parseFloat(str.match(/[\d.]+/)?.[0]);
            return num ? Math.round(num * 1000000) : null;
        }
        if (str.includes('k')) {
            const num = parseFloat(str.match(/[\d.]+/)?.[0]);
            return num ? Math.round(num * 1000) : null;
        }
        
        const numbers = str.match(/[\d,]+/);
        if (numbers) {
            const cleanNumber = numbers[0].replace(/,/g, '');
            return parseInt(cleanNumber, 10) || null;
        }
        
        return null;
    } catch (error) {
        console.error('Error parsing LinkedIn number:', value, error);
        return null;
    }
};

// FIXED: Process Bright Data Response with EXACT field names from your logs
const processBrightDataLinkedInProfileFIXED = (rawData) => {
    if (!rawData) {
        throw new Error('No data received from Bright Data API');
    }
    
    console.log('🔧 Processing with FIXED field mapping based on your actual logs...');
    console.log('📋 Raw data keys available:', Object.keys(rawData));
    
    try {
        // FIXED: Use EXACT field names that appear in your logs
        const processedData = {
            // ========== CORE IDENTIFICATION - EXACT NAMES FROM YOUR LOGS ==========
            id: rawData.id || null,                                    // From logs: 'id'
            name: rawData.name || null,                                 // From logs: 'name' (working)
            first_name: rawData.first_name || null,                     // From logs: 'first_name'
            last_name: rawData.last_name || null,                       // From logs: 'last_name'
            city: rawData.city || null,                                 // From logs: 'city' (working)
            country_code: rawData.country_code || null,                 // From logs: 'country_code' (working)
            about: rawData.about || null,                               // From logs: 'about'
            
            // ========== COMPANY FIELDS - EXACT NAMES FROM YOUR LOGS ==========
            current_company: rawData.current_company || null,           // From logs: 'current_company'
            current_company_name: rawData.current_company_name || null, // From logs: 'current_company_name' (working!)
            current_company_company_id: rawData.current_company_company_id || null, // From logs
            
            // ========== EXPERIENCE FIELD - TRY ALL POSSIBLE NAMES ==========
            experience: ensureValidJSONBArray(
                rawData.experience ||               // From logs: 'experience' 
                rawData.experiences ||              // Alternative name
                rawData.work_experience ||          // Alternative name
                rawData.jobs ||                     // Alternative name
                rawData.positions ||                // Alternative name
                []
            ),
            
            // ========== EDUCATION FIELDS - EXACT NAMES FROM YOUR LOGS ==========
            education: ensureValidJSONBArray(rawData.education || []),           // From logs: 'education' (2 entries - working!)
            educations_details: ensureValidJSONBArray(rawData.educations_details || []), // From logs: 'educations_details'
            education_details: ensureValidJSONBArray(rawData.education_details || []),   // Alternative spelling
            schools: ensureValidJSONBArray(rawData.schools || []),               // Alternative name
            
            // ========== SKILLS FIELDS - TRY ALL POSSIBLE NAMES ==========
            skills: ensureValidJSONBArray(
                rawData.skills ||                   // From logs: 'skills'
                rawData.skill_list ||               // Alternative name  
                rawData.skills_list ||              // Alternative name
                []
            ),
            skills_with_endorsements: ensureValidJSONBArray(rawData.skills_with_endorsements || []), // From logs
            endorsed_skills: ensureValidJSONBArray(rawData.endorsed_skills || []),                   // Alternative name
            
            // ========== CERTIFICATIONS - TRY ALL POSSIBLE NAMES ==========
            certifications: ensureValidJSONBArray(
                rawData.certifications ||           // From logs: 'certifications'
                rawData.certificates ||             // Alternative name
                rawData.certification_list ||       // Alternative name
                []
            ),
            
            // ========== LANGUAGES - EXACT NAME FROM YOUR LOGS ==========
            languages: ensureValidJSONBArray(rawData.languages || []),          // From logs: 'languages'
            
            // ========== RECOMMENDATIONS - EXACT NAMES FROM YOUR LOGS ==========
            recommendations_count: parseLinkedInNumber(rawData.recommendations_count), // From logs
            recommendations: ensureValidJSONBArray(rawData.recommendations || []),      // From logs: 'recommendations'
            recommendations_given: ensureValidJSONBArray(rawData.recommendations_given || []),     // From logs
            recommendations_received: ensureValidJSONBArray(rawData.recommendations_received || []), // From logs
            
            // ========== METRICS - EXACT NAMES FROM YOUR LOGS ==========
            followers: parseLinkedInNumber(rawData.followers),                   // From logs: 'followers'
            connections: parseLinkedInNumber(rawData.connections),               // From logs: 'connections'
            followers_count: parseLinkedInNumber(rawData.followers_count),       // From logs: 'followers_count'
            connections_count: parseLinkedInNumber(rawData.connections_count),   // From logs: 'connections_count'
            
            // ========== MEDIA FIELDS - EXACT NAMES FROM YOUR LOGS ==========
            avatar: rawData.avatar || null,                              // From logs: 'avatar'
            banner_image: rawData.banner_image || null,                  // From logs: 'banner_image'
            default_avatar: rawData.default_avatar || null,              // From logs: 'default_avatar'
            
            // ========== SOCIAL ACTIVITY - EXACT NAMES FROM YOUR LOGS ==========
            posts: ensureValidJSONBArray(rawData.posts || []),           // From logs: 'posts'
            activity: ensureValidJSONBArray(rawData.activity || []),     // From logs: 'activity' (14 entries - working!)
            people_also_viewed: ensureValidJSONBArray(rawData.people_also_viewed || []), // From logs
            articles: ensureValidJSONBArray(rawData.articles || []),     // From logs: 'articles'
            
            // ========== PROFESSIONAL ARRAYS - TRY ALL POSSIBLE NAMES ==========
            volunteer_experience: ensureValidJSONBArray(
                rawData.volunteer_experience ||     // Standard name
                rawData.volunteering ||             // Alternative name
                rawData.volunteer_work ||           // Alternative name
                []
            ),
            courses: ensureValidJSONBArray(rawData.courses || []),       // From logs: 'courses'
            publications: ensureValidJSONBArray(rawData.publications || []), // From logs: 'publications'
            patents: ensureValidJSONBArray(rawData.patents || []),       // From logs: 'patents'
            projects: ensureValidJSONBArray(rawData.projects || []),     // From logs: 'projects'
            organizations: ensureValidJSONBArray(rawData.organizations || []), // From logs: 'organizations'
            honors_and_awards: ensureValidJSONBArray(rawData.honors_and_awards || []), // From logs: 'honors_and_awards'
            
            // ========== ADDITIONAL FIELDS FROM YOUR LOGS ==========
            url: rawData.url || null,                                   // From logs: 'url'
            input_url: rawData.input_url || null,                       // From logs: 'input_url'
            linkedin_id: rawData.linkedin_id || null,                   // From logs: 'linkedin_id'
            linkedin_num_id: rawData.linkedin_num_id || null,           // From logs: 'linkedin_num_id'
            location: rawData.location || null,                         // From logs: 'location'
            timestamp: rawData.timestamp ? new Date(rawData.timestamp) : new Date(), // From logs: 'timestamp'
            bio_links: ensureValidJSONBArray(rawData.bio_links || []),   // From logs: 'bio_links'
            similar_profiles: ensureValidJSONBArray(rawData.similar_profiles || []), // From logs: 'similar_profiles'
            memorialized_account: rawData.memorialized_account || null, // From logs: 'memorialized_account'
            
            // ========== METADATA ==========
            dataSource: 'bright_data_fixed_mapping',
            brightdataRawData: sanitizeForJSONB(rawData)
        };
        
        console.log('✅ FIXED processing completed!');
        console.log(`📊 Field Mapping Summary:`);
        console.log(`   - Name: ${processedData.name || 'Not available'}`);
        console.log(`   - Current Company Name: ${processedData.current_company_name || 'Not available'} (FIXED)`);
        console.log(`   - Experience: ${processedData.experience.length} entries (FIXED MAPPING)`);
        console.log(`   - Education: ${processedData.education.length} entries`);
        console.log(`   - Educations Details: ${processedData.educations_details.length} entries (FIXED)`);
        console.log(`   - Skills: ${processedData.skills.length} entries (FIXED MAPPING)`);
        console.log(`   - Certifications: ${processedData.certifications.length} entries (FIXED MAPPING)`);
        console.log(`   - Projects: ${processedData.projects.length} entries`);
        console.log(`   - Activity: ${processedData.activity.length} entries`);
        console.log(`   - Posts: ${processedData.posts.length} entries`);
        console.log(`   - Languages: ${processedData.languages.length} entries`);
        
        return processedData;
        
    } catch (error) {
        console.error('❌ Error in FIXED processing:', error);
        throw new Error(`LinkedIn processing failed: ${error.message}`);
    }
};

// FIXED: Bright Data extraction (same as before)
const extractLinkedInProfileFromBrightData = async (linkedinUrl) => {
    try {
        console.log('🚀 Starting FIXED LinkedIn profile extraction...');
        
        // Try synchronous scrape first
        try {
            const syncResponse = await axios.post(
                `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`,
                [{ "url": linkedinUrl }],
                {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000
                }
            );
            
            if (syncResponse.status === 200 && syncResponse.data && syncResponse.data.length > 0) {
                console.log('✅ Synchronous extraction successful!');
                const profileData = Array.isArray(syncResponse.data) ? syncResponse.data[0] : syncResponse.data;
                
                return {
                    success: true,
                    data: processBrightDataLinkedInProfileFIXED(profileData),
                    method: 'synchronous'
                };
            }
        } catch (syncError) {
            console.log('⏩ Synchronous method failed, using async method...');
        }
        
        // Async method
        const triggerUrl = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`;
        const triggerResponse = await axios.post(triggerUrl, [{ "url": linkedinUrl }], {
            headers: {
                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        const snapshotId = triggerResponse.data.snapshot_id;
        console.log('🆔 Snapshot ID:', snapshotId);
        
        // Poll for completion
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
                
                if (status === 'ready') {
                    const dataUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`;
                    const dataResponse = await axios.get(dataUrl, {
                        headers: {
                            'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    if (dataResponse.data) {
                        const profileData = Array.isArray(dataResponse.data) ? dataResponse.data[0] : dataResponse.data;
                        
                        return {
                            success: true,
                            data: processBrightDataLinkedInProfileFIXED(profileData),
                            method: 'asynchronous',
                            snapshotId: snapshotId
                        };
                    }
                } else if (status === 'error' || status === 'failed') {
                    throw new Error(`LinkedIn extraction failed with status: ${status}`);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 8000));
                }
                
            } catch (pollError) {
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
        
        throw new Error(`Polling timeout`);
        
    } catch (error) {
        console.error('❌ LinkedIn extraction failed:', error);
        throw error;
    }
};

// FIXED: Database save with correct field mapping
const saveLinkedInProfileToDatabaseFIXED = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3;
    
    console.log(`🔄 FIXED: Starting LinkedIn profile save for user ${userId}, retry ${retryCount}`);
    
    setTimeout(async () => {
        try {
            console.log(`🚀 FIXED: Starting LinkedIn extraction for user ${userId}`);
            
            // Extract with FIXED processing
            const result = await extractLinkedInProfileFromBrightData(linkedinUrl);
            const extractedData = result.data;
            
            console.log(`✅ FIXED: Extraction succeeded for user ${userId}`);
            
            // FIXED: Save with proper field mapping
            console.log('💾 FIXED: Saving LinkedIn data with correct field names...');
            
            try {
                // Check which columns actually exist in the database
                const tableInfo = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'user_profiles'
                `);
                
                const availableColumns = tableInfo.rows.map(row => row.column_name);
                console.log('📋 Available database columns:', availableColumns);
                
                // Build dynamic update query based on available columns and extracted data
                const updates = [];
                const values = [];
                let paramIndex = 1;
                
                // Map extracted data to database columns dynamically
                Object.keys(extractedData).forEach(key => {
                    if (availableColumns.includes(key) && extractedData[key] !== undefined) {
                        if (Array.isArray(extractedData[key])) {
                            updates.push(`${key} = $${paramIndex}`);
                            values.push(JSON.stringify(extractedData[key]));
                        } else {
                            updates.push(`${key} = $${paramIndex}`);
                            values.push(extractedData[key]);
                        }
                        paramIndex++;
                    }
                });
                
                // Add standard fields
                updates.push(`brightdata_raw_data = $${paramIndex++}`);
                updates.push(`data_source = $${paramIndex++}`);
                updates.push(`extraction_status = $${paramIndex++}`);
                updates.push(`extraction_completed_at = CURRENT_TIMESTAMP`);
                updates.push(`updated_at = CURRENT_TIMESTAMP`);
                
                values.push(JSON.stringify(extractedData.brightdataRawData));
                values.push(extractedData.dataSource);
                values.push('completed');
                values.push(userId);
                
                const updateQuery = `
                    UPDATE user_profiles SET 
                        ${updates.join(', ')}
                    WHERE user_id = $${paramIndex}
                `;
                
                console.log(`📝 FIXED: Updating ${updates.length} fields for user ${userId}`);
                
                await pool.query(updateQuery, values);
                
                // Update user status
                await pool.query(
                    'UPDATE users SET extraction_status = $1, profile_completed = $2, error_message = NULL WHERE id = $3',
                    ['completed', true, userId]
                );

                console.log(`🎉 FIXED: LinkedIn profile data successfully saved for user ${userId}!`);
                console.log(`✅ Method: ${result.method}`);
                console.log('🏆 SUCCESS: FIXED field mapping should capture all available data!');
                
                processingQueue.delete(userId);
                
            } catch (dbError) {
                console.error(`❌ FIXED: Database save failed for user ${userId}:`, dbError.message);
                
                // Fallback: save just the raw data
                try {
                    await pool.query(`
                        UPDATE user_profiles SET 
                            brightdata_raw_data = $1,
                            data_source = $2,
                            extraction_status = $3,
                            extraction_completed_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = $4
                    `, [
                        JSON.stringify(extractedData.brightdataRawData),
                        'bright_data_fixed_mapping_fallback',
                        'completed_raw_data_only',
                        userId
                    ]);
                    
                    console.log(`✅ FIXED: Saved raw data as fallback for user ${userId}`);
                } catch (fallbackError) {
                    console.error(`❌ FIXED: Even fallback save failed:`, fallbackError.message);
                }
            }
                
        } catch (error) {
            console.error(`❌ FIXED: Extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            if (retryCount < maxRetries - 1) {
                console.log(`🔄 FIXED: Retrying extraction for user ${userId}...`);
                await saveLinkedInProfileToDatabaseFIXED(userId, linkedinUrl, retryCount + 1);
            } else {
                console.log(`❌ FIXED: Final failure for user ${userId}`);
                await pool.query(
                    'UPDATE user_profiles SET extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
                    ['failed', `FIXED mapping failed: ${error.message}`, userId]
                );
                processingQueue.delete(userId);
            }
        }
    }, retryCount === 0 ? 10000 : 300000);
};

// Database functions (same as before)
const createUser = async (email, passwordHash, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = { 'free': 10, 'silver': 75, 'gold': 250, 'platinum': 1000 };
    const credits = creditsMap[packageType] || 10;
    
    const result = await pool.query(
        'INSERT INTO users (email, password_hash, package_type, billing_model, credits_remaining) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [email, passwordHash, packageType, billingModel, credits]
    );
    return result.rows[0];
};

const createGoogleUser = async (email, displayName, googleId, profilePicture, packageType = 'free', billingModel = 'monthly') => {
    const creditsMap = { 'free': 10, 'silver': 75, 'gold': 250, 'platinum': 1000 };
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

// FIXED: Create or update user profile
const createOrUpdateUserProfileFIXED = async (userId, linkedinUrl, displayName = null) => {
    try {
        console.log(`🚀 FIXED: Creating profile for user ${userId}`);
        
        await pool.query(
            'UPDATE users SET linkedin_url = $1, extraction_status = $2, error_message = NULL WHERE id = $3',
            [linkedinUrl, 'processing', userId]
        );
        
        const existingProfile = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
        
        let profile;
        if (existingProfile.rows.length > 0) {
            const result = await pool.query(
                'UPDATE user_profiles SET input_url = $1, name = $2, extraction_status = $3, extraction_retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
                [linkedinUrl, displayName, 'processing', userId]
            );
            profile = result.rows[0];
        } else {
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, input_url, name, extraction_status, extraction_retry_count) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [userId, linkedinUrl, displayName, 'processing', 0]
            );
            profile = result.rows[0];
        }
        
        console.log(`🔄 FIXED: Starting background extraction for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        // Schedule FIXED extraction
        saveLinkedInProfileToDatabaseFIXED(userId, linkedinUrl, 0);
        
        return profile;
        
    } catch (error) {
        console.error('FIXED: Profile creation/extraction error:', error);
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
        message: 'Msgly.AI Server - FIXED FIELD MAPPING - Based on Actual Bright Data Response',
        status: 'running',
        version: '8.0-FIXED-MAPPING',
        fix: 'Uses exact field names from your actual Bright Data response logs',
        improvements: [
            'FIXED: Uses exact field names that appear in your logs',
            'FIXED: Handles experience, education, skills, certifications properly', 
            'FIXED: Maps current_company_name (which was working)',
            'FIXED: Maps activity (which had 14 entries)',
            'FIXED: Dynamic database save based on available columns',
            'FIXED: Multiple fallback field names for each data type'
        ]
    });
});

// Health Check
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        res.status(200).json({
            status: 'healthy',
            version: '8.0-FIXED-MAPPING',
            fix: 'Field mapping corrected based on actual Bright Data logs',
            brightData: !!BRIGHT_DATA_API_KEY
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Google OAuth routes (same as before)
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
            
            const frontendUrl = process.env.NODE_ENV === 'production' 
                ? 'https://msgly.ai/dashboard' 
                : 'http://localhost:3000/dashboard';
                
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

app.get('/auth/failed', (req, res) => {
    const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://msgly.ai/sign-up' 
        : 'http://localhost:3000/sign-up';
        
    res.redirect(`${frontendUrl}?error=auth_failed`);
});

// Main endpoints (registration, login same as before)
app.post('/register', async (req, res) => {
    try {
        const { email, password, packageType, billingModel } = req.body;
        
        if (!email || !password || !packageType) {
            return res.status(400).json({
                success: false,
                error: 'Email, password and package are required'
            });
        }
        
        if (packageType !== 'free') {
            return res.status(400).json({
                success: false,
                error: 'Only free package is available during beta'
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
                    credits: newUser.credits_remaining
                },
                token: token
            }
        });
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed'
        });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        const user = await getUserByEmail(email);
        if (!user || !user.password_hash) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
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
                    packageType: user.package_type,
                    credits: user.credits_remaining
                },
                token: token
            }
        });
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed'
        });
    }
});

// FIXED: Update user profile endpoint
app.post('/update-profile', authenticateToken, async (req, res) => {
    console.log('📝 FIXED: Profile update request for user:', req.user.id);
    
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
        
        // FIXED: Create or update user profile
        const profile = await createOrUpdateUserProfileFIXED(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: 'FIXED Profile extraction started - field mapping corrected!',
            data: {
                profile: {
                    linkedinUrl: profile.input_url,
                    fullName: profile.name,
                    extractionStatus: profile.extraction_status
                },
                fixes: [
                    'FIXED: Uses exact field names from your Bright Data logs',
                    'FIXED: Maps experience, education, skills, certifications properly',
                    'FIXED: Maps current_company_name (which was working)',
                    'FIXED: Maps activity (which had 14 entries)',
                    'FIXED: Dynamic database save based on available columns',
                    'FIXED: Multiple fallback field names for robust mapping'
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ FIXED: Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile'
        });
    }
});

// Get User Profile 
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [req.user.id]);
        const profile = profileResult.rows[0];

        res.json({
            success: true,
            data: {
                user: {
                    id: req.user.id,
                    email: req.user.email,
                    displayName: req.user.display_name,
                    packageType: req.user.package_type,
                    credits: req.user.credits_remaining
                },
                profile: profile ? {
                    // Return all available fields
                    ...profile,
                    extractionStatus: profile.extraction_status,
                    message: 'FIXED field mapping applied'
                } : null
            }
        });
    } catch (error) {
        console.error('❌ FIXED: Profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// Status and retry endpoints (similar to before)
app.get('/profile-status', authenticateToken, async (req, res) => {
    try {
        const userQuery = `
            SELECT 
                u.extraction_status,
                u.error_message,
                up.extraction_status as profile_extraction_status,
                up.extraction_completed_at,
                up.extraction_error
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.id = $1
        `;
        
        const result = await pool.query(userQuery, [req.user.id]);
        const status = result.rows[0];
        
        res.json({
            extraction_status: status.extraction_status,
            profile_extraction_status: status.profile_extraction_status,
            extraction_completed_at: status.extraction_completed_at,
            extraction_error: status.extraction_error,
            is_currently_processing: processingQueue.has(req.user.id),
            message: 'FIXED field mapping applied'
        });
        
    } catch (error) {
        console.error('FIXED Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

app.post('/retry-extraction', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT linkedin_url FROM users WHERE id = $1', [req.user.id]);
        
        if (userResult.rows.length === 0 || !userResult.rows[0].linkedin_url) {
            return res.status(400).json({ error: 'No LinkedIn URL found for retry' });
        }
        
        const linkedinUrl = userResult.rows[0].linkedin_url;
        
        // FIXED: Retry with corrected field mapping
        await createOrUpdateUserProfileFIXED(req.user.id, linkedinUrl, req.user.display_name);
        
        res.json({
            success: true,
            message: 'FIXED extraction retry initiated!',
            status: 'processing'
        });
        
    } catch (error) {
        console.error('FIXED Retry extraction error:', error);
        res.status(500).json({ error: 'Retry failed' });
    }
});

// Error handling
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found'
    });
});

app.use((error, req, res, next) => {
    console.error('❌ Error:', error);
    res.status(500).json({
        success: false,
        error: 'Server error'
    });
});

// Server startup
const validateEnvironment = () => {
    const required = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
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
            console.log('🚀 Msgly.AI Server - FIXED FIELD MAPPING Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🔧 Fix Applied: Field mapping corrected based on actual Bright Data response`);
            console.log(`✅ FIXES:`);
            console.log(`   ✓ Uses exact field names from your logs`);
            console.log(`   ✓ Fixed experience, education, skills, certifications mapping`);
            console.log(`   ✓ Maps current_company_name (which was working)`);
            console.log(`   ✓ Maps activity (which had 14 entries)`);
            console.log(`   ✓ Dynamic database save based on available columns`);
            console.log(`   ✓ Multiple fallback field names for robust mapping`);
            console.log(`🎯 RESULT: Should now capture ALL available data from Bright Data!`);
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
