// Msgly.AI Server with Google OAuth + FIXED Bright Data Integration
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
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// FIXED: Bright Data API configuration - CORRECTED ENDPOINTS FOR COLLECTOR/SCRAPER API
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_TOKEN || 'e5353ea11fe201c7f9797062c64b59fb87f1bfc01ad8a24dd0fc34a29ccddd23';
const COLLECTOR_ID = 'gd_l1viktl72bvl7bjuj0'; // This is your collector ID, not dataset ID

// CORS for Chrome Extensions
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://www.linkedin.com',
            'https://linkedin.com',
            'http://localhost:3000',
            'https://msgly.ai',
            'https://www.msgly.ai'
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

app.use(cors(corsOptions));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration - MUST come before passport initialization
app.use(session({
    secret: process.env.SESSION_SECRET || 'msgly-session-secret-2024',
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
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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

// Logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==================== DATABASE SETUP ====================

const initDB = async () => {
    try {
        console.log('🗃️ Creating database tables...');

        // Updated users table with Google OAuth fields
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255),
                google_id VARCHAR(255) UNIQUE,
                display_name VARCHAR(255),
                profile_picture VARCHAR(500),
                package_type VARCHAR(50) DEFAULT 'free',
                billing_model VARCHAR(50) DEFAULT 'monthly',
                credits_remaining INTEGER DEFAULT 30,
                subscription_status VARCHAR(50) DEFAULT 'active',
                linkedin_url TEXT,
                profile_data JSONB,
                extraction_status VARCHAR(20) DEFAULT 'pending',
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ENHANCED: user profiles table with ALL comprehensive LinkedIn fields
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) UNIQUE,
                linkedin_url VARCHAR(500),
                full_name VARCHAR(255),
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                headline VARCHAR(500),
                summary TEXT,
                location VARCHAR(255),
                industry VARCHAR(255),
                connections_count INTEGER,
                followers_count INTEGER,
                profile_image_url VARCHAR(500),
                banner_image_url VARCHAR(500),
                
                -- CURRENT COMPANY
                current_company VARCHAR(255),
                current_company_id VARCHAR(100),
                current_company_url VARCHAR(500),
                
                -- COMPREHENSIVE DATA (stored as JSONB for flexibility)
                experience JSONB DEFAULT '[]'::jsonb,
                education JSONB DEFAULT '[]'::jsonb,
                certifications JSONB DEFAULT '[]'::jsonb,
                skills TEXT[],
                languages JSONB DEFAULT '[]'::jsonb,
                recommendations JSONB DEFAULT '[]'::jsonb,
                recommendations_count INTEGER,
                volunteer_experience JSONB DEFAULT '[]'::jsonb,
                courses JSONB DEFAULT '[]'::jsonb,
                publications JSONB DEFAULT '[]'::jsonb,
                patents JSONB DEFAULT '[]'::jsonb,
                projects JSONB DEFAULT '[]'::jsonb,
                organizations JSONB DEFAULT '[]'::jsonb,
                honors_and_awards JSONB DEFAULT '[]'::jsonb,
                
                -- SOCIAL ACTIVITY
                posts JSONB DEFAULT '[]'::jsonb,
                activity JSONB DEFAULT '[]'::jsonb,
                people_also_viewed JSONB DEFAULT '[]'::jsonb,
                
                -- METADATA
                country_code VARCHAR(10),
                linkedin_id VARCHAR(100),
                public_identifier VARCHAR(100),
                linkedin_profile_url VARCHAR(500),
                profile_timestamp VARCHAR(50),
                
                -- EXTRACTION STATUS
                brightdata_data JSONB,
                data_extraction_status VARCHAR(50) DEFAULT 'pending',
                extraction_attempted_at TIMESTAMP,
                extraction_completed_at TIMESTAMP,
                extraction_error TEXT,
                profile_analyzed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Simple message logs
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

        // Credits transactions
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

        // Add Google OAuth columns to existing users table if they don't exist
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
                ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
                ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500),
                ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
                ADD COLUMN IF NOT EXISTS profile_data JSONB,
                ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(20) DEFAULT 'pending',
                ADD COLUMN IF NOT EXISTS error_message TEXT;
            `);
            console.log('✅ Added missing columns to users table');
        } catch (err) {
            console.log('Columns might already exist:', err.message);
        }

        // Make password_hash nullable for Google OAuth users
        try {
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);
            console.log('✅ Made password_hash nullable for Google OAuth users');
        } catch (err) {
            console.log('Password hash might already be nullable:', err.message);
        }

        // Create indexes
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
            `);
            console.log('✅ Created database indexes');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ Database tables created successfully');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== FIXED BRIGHT DATA INTEGRATION ====================

// FIXED: Trigger LinkedIn scraper using COLLECTOR API (not Dataset API)
const triggerLinkedInScraper = async (linkedinUrl) => {
    try {
        console.log(`🚀 Triggering scraper for: ${linkedinUrl}`);
        console.log(`🔑 Using Collector ID: ${COLLECTOR_ID}`);
        
        const triggerResponse = await axios.post(
            `https://api.brightdata.com/dca/trigger?collector=${COLLECTOR_ID}`,
            [
                { 
                    url: linkedinUrl,
                }
            ],
            {
                headers: {
                    'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        console.log('✅ Scraper triggered successfully:', triggerResponse.data);
        return triggerResponse.data.collection_id;
        
    } catch (error) {
        console.error('❌ Failed to trigger scraper:', error.response?.data || error.message);
        throw new Error(`Scraper trigger failed: ${error.response?.data?.message || error.message}`);
    }
};

// FIXED: Poll for scraping results using COLLECTOR API
const pollForResults = async (collectionId, maxAttempts = 15) => {
    console.log(`🔄 Starting to poll for collection: ${collectionId}`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`📊 Polling attempt ${attempt}/${maxAttempts}`);
            
            const pollResponse = await axios.get(
                `https://api.brightdata.com/dca/dataset?id=${collectionId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                    },
                    timeout: 15000
                }
            );

            const { status, data: scrapedData } = pollResponse.data;
            console.log(`📈 Status: ${status}, Data length: ${scrapedData?.length || 0}`);

            if (status === 'done' && Array.isArray(scrapedData) && scrapedData.length > 0) {
                console.log('✅ Scraping completed successfully!');
                return scrapedData[0];
            }
            
            if (status === 'failed') {
                throw new Error('Scraping job failed');
            }

            // Wait before next poll (exponential backoff)
            const waitTime = Math.min(5000 + (attempt * 1000), 15000);
            console.log(`⏱️  Waiting ${waitTime}ms before next poll...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
        } catch (error) {
            console.error(`❌ Poll attempt ${attempt} failed:`, error.message);
            
            if (attempt === maxAttempts) {
                throw new Error(`Polling failed after ${maxAttempts} attempts: ${error.message}`);
            }
        }
    }
    
    throw new Error('Scraping timeout - job did not complete in time');
};

// Process LinkedIn data with comprehensive field mapping
const processLinkedInData = (profile, originalUrl) => {
    console.log('\n🔍 Processing LinkedIn data...');
    console.log('📋 Available fields:', Object.keys(profile).join(', '));
    
    // Extract all available data with proper field mapping
    const extractedData = {
        // BASIC PROFILE INFO
        fullName: profile.name || profile.full_name || null,
        firstName: profile.first_name || null,
        lastName: profile.last_name || null,
        headline: profile.headline || profile.position || profile.current_position || 
                 (profile.current_company ? `${profile.current_company.position || 'Professional'} at ${profile.current_company.name}` : null) ||
                 (profile.about ? profile.about.substring(0, 120) + '...' : null),
        summary: profile.summary || profile.about || null,
        location: profile.location || profile.city || null,
        industry: profile.industry || null,
        connectionsCount: profile.connections_count || profile.connections || null,
        followersCount: profile.followers_count || profile.followers || null,
        profileImageUrl: profile.profile_image || profile.avatar || profile.profile_picture || null,
        bannerImageUrl: profile.banner_image || profile.background_image || null,
        
        // CURRENT COMPANY
        currentCompany: profile.current_company?.name || profile.current_company_name || null,
        currentCompanyId: profile.current_company?.company_id || profile.current_company_company_id || null,
        currentCompanyUrl: profile.current_company?.url || profile.current_company?.link || null,
        
        // PROFESSIONAL DATA
        experience: profile.experience || profile.work_experience || [],
        education: profile.education || [],
        skills: profile.skills || [],
        certifications: profile.certifications || [],
        languages: profile.languages || [],
        recommendations: profile.recommendations || [],
        recommendationsCount: profile.recommendations_count || profile.recommendations?.length || 0,
        volunteerExperience: profile.volunteer_experience || [],
        courses: profile.courses || [],
        publications: profile.publications || [],
        patents: profile.patents || [],
        projects: profile.projects || [],
        organizations: profile.organizations || [],
        honorsAndAwards: profile.honors_and_awards || profile.honors || [],
        
        // SOCIAL ACTIVITY
        posts: profile.posts || [],
        activity: profile.activity || [],
        peopleAlsoViewed: profile.people_also_viewed || profile.similar_profiles || [],
        
        // METADATA
        countryCode: profile.country_code || null,
        linkedinId: profile.linkedin_id || profile.id || profile.public_identifier || null,
        linkedinNumId: profile.linkedin_num_id || null,
        publicIdentifier: profile.public_identifier || profile.linkedin_id || null,
        linkedinUrl: profile.url || profile.linkedin_url || originalUrl,
        timestamp: profile.timestamp || new Date().toISOString(),
        
        // RAW DATA
        rawData: profile
    };

    console.log(`\n✅ Profile data processed successfully!`);
    console.log(`👤 Name: ${extractedData.fullName || 'Unknown'}`);
    console.log(`💼 Company: ${extractedData.currentCompany || 'Not specified'}`);
    console.log(`📍 Location: ${extractedData.location || 'Not specified'}`);
    console.log(`🔗 Connections: ${extractedData.connectionsCount || 0}`);
    console.log(`👥 Followers: ${extractedData.followersCount || 0}`);
    console.log(`🎓 Education: ${extractedData.education.length} items`);
    console.log(`💼 Experience: ${extractedData.experience.length} items`);
    console.log(`🏆 Honors: ${extractedData.honorsAndAwards.length} items`);
    
    return extractedData;
};

// Clean and validate LinkedIn URL
const cleanLinkedInUrl = (url) => {
    try {
        // Remove trailing slashes, query parameters, etc.
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

// Save profile data to database
const saveProfileToDatabase = async (userId, linkedinUrl, profileData) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Update user profile
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

        // Insert/update detailed profile data
        const upsertProfileQuery = `
            INSERT INTO user_profiles (
                user_id, 
                linkedin_url,
                full_name, 
                first_name,
                last_name,
                headline, 
                summary,
                location, 
                industry,
                connections_count,
                followers_count,
                profile_image_url,
                banner_image_url,
                current_company,
                current_company_id,
                current_company_url,
                experience,
                education,
                certifications,
                skills,
                languages,
                recommendations,
                recommendations_count,
                volunteer_experience,
                courses,
                publications,
                patents,
                projects,
                organizations,
                honors_and_awards,
                posts,
                activity,
                people_also_viewed,
                country_code,
                linkedin_id,
                public_identifier,
                linkedin_profile_url,
                profile_timestamp,
                brightdata_data,
                data_extraction_status,
                extraction_completed_at,
                profile_analyzed,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, NOW())
            ON CONFLICT (user_id) 
            DO UPDATE SET
                linkedin_url = EXCLUDED.linkedin_url,
                full_name = EXCLUDED.full_name,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                headline = EXCLUDED.headline,
                summary = EXCLUDED.summary,
                location = EXCLUDED.location,
                industry = EXCLUDED.industry,
                connections_count = EXCLUDED.connections_count,
                followers_count = EXCLUDED.followers_count,
                profile_image_url = EXCLUDED.profile_image_url,
                banner_image_url = EXCLUDED.banner_image_url,
                current_company = EXCLUDED.current_company,
                current_company_id = EXCLUDED.current_company_id,
                current_company_url = EXCLUDED.current_company_url,
                experience = EXCLUDED.experience,
                education = EXCLUDED.education,
                certifications = EXCLUDED.certifications,
                skills = EXCLUDED.skills,
                languages = EXCLUDED.languages,
                recommendations = EXCLUDED.recommendations,
                recommendations_count = EXCLUDED.recommendations_count,
                volunteer_experience = EXCLUDED.volunteer_experience,
                courses = EXCLUDED.courses,
                publications = EXCLUDED.publications,
                patents = EXCLUDED.patents,
                projects = EXCLUDED.projects,
                organizations = EXCLUDED.organizations,
                honors_and_awards = EXCLUDED.honors_and_awards,
                posts = EXCLUDED.posts,
                activity = EXCLUDED.activity,
                people_also_viewed = EXCLUDED.people_also_viewed,
                country_code = EXCLUDED.country_code,
                linkedin_id = EXCLUDED.linkedin_id,
                public_identifier = EXCLUDED.public_identifier,
                linkedin_profile_url = EXCLUDED.linkedin_profile_url,
                profile_timestamp = EXCLUDED.profile_timestamp,
                brightdata_data = EXCLUDED.brightdata_data,
                data_extraction_status = EXCLUDED.data_extraction_status,
                extraction_completed_at = EXCLUDED.extraction_completed_at,
                extraction_error = NULL,
                profile_analyzed = EXCLUDED.profile_analyzed,
                updated_at = NOW()
        `;

        await client.query(upsertProfileQuery, [
            userId,
            linkedinUrl,
            profileData.fullName,
            profileData.firstName,
            profileData.lastName,
            profileData.headline,
            profileData.summary,
            profileData.location,
            profileData.industry,
            profileData.connectionsCount,
            profileData.followersCount,
            profileData.profileImageUrl,
            profileData.bannerImageUrl,
            profileData.currentCompany,
            profileData.currentCompanyId,
            profileData.currentCompanyUrl,
            JSON.stringify(profileData.experience),
            JSON.stringify(profileData.education),
            JSON.stringify(profileData.certifications),
            profileData.skills,
            JSON.stringify(profileData.languages),
            JSON.stringify(profileData.recommendations),
            profileData.recommendationsCount,
            JSON.stringify(profileData.volunteerExperience),
            JSON.stringify(profileData.courses),
            JSON.stringify(profileData.publications),
            JSON.stringify(profileData.patents),
            JSON.stringify(profileData.projects),
            JSON.stringify(profileData.organizations),
            JSON.stringify(profileData.honorsAndAwards),
            JSON.stringify(profileData.posts),
            JSON.stringify(profileData.activity),
            JSON.stringify(profileData.peopleAlsoViewed),
            profileData.countryCode,
            profileData.linkedinId,
            profileData.publicIdentifier,
            profileData.linkedinUrl,
            profileData.timestamp,
            JSON.stringify(profileData.rawData),
            'completed',
            'NOW()',
            true
        ]);

        await client.query('COMMIT');
        console.log('✅ Profile data saved to database successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Database save failed:', error);
        throw error;
    } finally {
        client.release();
    }
};

// Async function to handle the extraction process
async function extractProfileAsync(userId, linkedinUrl, packageType) {
    try {
        console.log(`🚀 Starting async extraction for user ${userId}`);

        // Step 1: Trigger the scraper
        const collectionId = await triggerLinkedInScraper(linkedinUrl);
        
        // Update status
        await pool.query(
            'UPDATE users SET extraction_status = $1 WHERE id = $2',
            ['in_progress', userId]
        );

        // Step 2: Poll for results
        const profileData = await pollForResults(collectionId);
        
        if (!profileData) {
            throw new Error('No profile data returned from scraper');
        }

        // Step 3: Process the data
        const processedData = processLinkedInData(profileData, linkedinUrl);

        // Step 4: Save to database
        await saveProfileToDatabase(userId, linkedinUrl, processedData);

        console.log(`✅ Profile extraction completed successfully for user ${userId}`);

    } catch (error) {
        console.error(`❌ Async extraction failed for user ${userId}:`, error);
        
        // Update status to failed
        try {
            await pool.query(
                'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
                ['failed', error.message, userId]
            );
        } catch (dbError) {
            console.error('Failed to update error status:', dbError);
        }
    }
}

// ==================== EXISTING DATABASE FUNCTIONS ====================

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

// New function for Google users
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

// Link existing account with Google
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

const updateUserCredits = async (userId, newCredits) => {
    const result = await pool.query(
        'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [newCredits, userId]
    );
    return result.rows[0];
};

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'msgly-simple-secret-2024');
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

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        version: '2.1-brightdata-collector-api-fixed',
        timestamp: new Date().toISOString(),
        features: ['authentication', 'google-oauth', 'brightdata-collector-integration', 'comprehensive-linkedin-extraction'],
        brightdata: {
            configured: !!BRIGHT_DATA_API_KEY,
            collectorId: COLLECTOR_ID,
            endpoints: {
                trigger: 'https://api.brightdata.com/dca/trigger',
                poll: 'https://api.brightdata.com/dca/dataset'
            }
        }
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Server with Google OAuth + FIXED Bright Data',
        status: 'running',
        endpoints: [
            'POST /register',
            'POST /login', 
            'GET /auth/google',
            'GET /auth/google/callback',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'GET /profile-status (protected)',
            'GET /profile-data (protected)',
            'POST /retry-extraction (protected)',
            'GET /packages',
            'GET /health'
        ]
    });
});

// Google OAuth routes (unchanged)
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
                process.env.JWT_SECRET || 'msgly-simple-secret-2024',
                { expiresIn: '30d' }
            );
            
            if (req.session.selectedPackage && req.session.selectedPackage !== 'free') {
                console.log(`Package ${req.session.selectedPackage} requested but only free available for now`);
            }
            
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
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

app.get('/auth/failed', (req, res) => {
    const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://msgly.ai/sign-up' 
        : 'http://localhost:3000/sign-up';
        
    res.redirect(`${frontendUrl}?error=auth_failed`);
});

// FIXED: Update user profile with LinkedIn URL and trigger extraction
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
        
        if (!linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL'
            });
        }
        
        // Update user package if provided and different
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
        
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        // Update user status to pending
        await pool.query(
            'UPDATE users SET extraction_status = $1, linkedin_url = $2, error_message = NULL WHERE id = $3',
            ['pending', cleanUrl, req.user.id]
        );

        // Start the extraction process (async - don't wait for it)
        extractProfileAsync(req.user.id, cleanUrl, packageType);

        // Return immediate response
        res.json({
            success: true,
            message: 'Profile extraction started',
            data: {
                status: 'pending',
                linkedinUrl: cleanUrl,
                packageType: packageType,
                profile: {
                    extractionStatus: 'pending'
                }
            }
        });
        
        console.log(`✅ Profile extraction started for user ${req.user.email} with LinkedIn: ${cleanUrl}`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        
        // Update status to failed
        try {
            await pool.query(
                'UPDATE users SET extraction_status = $1, error_message = $2 WHERE id = $3',
                ['failed', error.message, req.user.id]
            );
        } catch (dbError) {
            console.error('Failed to update error status:', dbError);
        }

        res.status(500).json({
            success: false,
            error: error.message || 'Profile extraction failed'
        });
    }
});

// Status check endpoint
app.get('/profile-status', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    try {
        const result = await pool.query(
            'SELECT extraction_status, error_message, linkedin_url FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const { extraction_status, error_message, linkedin_url } = result.rows[0];

        res.json({
            success: true,
            data: {
                status: extraction_status,
                linkedinUrl: linkedin_url,
                errorMessage: error_message
            }
        });

    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check status'
        });
    }
});

// Get profile data endpoint
app.get('/profile-data', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    try {
        const result = await pool.query(`
            SELECT lp.*, u.linkedin_url, u.extraction_status 
            FROM user_profiles lp 
            JOIN users u ON lp.user_id = u.id 
            WHERE u.id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Profile data fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile data'
        });
    }
});

// Other endpoints (register, login, profile, packages) - unchanged from your original
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
            process.env.JWT_SECRET || 'msgly-simple-secret-2024',
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
            process.env.JWT_SECRET || 'msgly-simple-secret-2024',
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
                    createdAt: req.user.created_at,
                    extractionStatus: req.user.extraction_status,
                    linkedinUrl: req.user.linkedin_url,
                    errorMessage: req.user.error_message
                },
                profile: profile ? {
                    linkedinUrl: profile.linkedin_url,
                    fullName: profile.full_name,
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    summary: profile.summary,
                    location: profile.location,
                    industry: profile.industry,
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    profileImageUrl: profile.profile_image_url,
                    bannerImageUrl: profile.banner_image_url,
                    currentCompany: profile.current_company,
                    currentCompanyId: profile.current_company_id,
                    currentCompanyUrl: profile.current_company_url,
                    experience: profile.experience,
                    education: profile.education,
                    certifications: profile.certifications,
                    skills: profile.skills,
                    languages: profile.languages,
                    recommendations: profile.recommendations,
                    recommendationsCount: profile.recommendations_count,
                    volunteerExperience: profile.volunteer_experience,
                    courses: profile.courses,
                    publications: profile.publications,
                    patents: profile.patents,
                    projects: profile.projects,
                    organizations: profile.organizations,
                    honorsAndAwards: profile.honors_and_awards,
                    posts: profile.posts,
                    activity: profile.activity,
                    peopleAlsoViewed: profile.people_also_viewed,
                    countryCode: profile.country_code,
                    linkedinId: profile.linkedin_id,
                    publicIdentifier: profile.public_identifier,
                    linkedinProfileUrl: profile.linkedin_profile_url,
                    profileTimestamp: profile.profile_timestamp,
                    extractionStatus: profile.data_extraction_status,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    profileAnalyzed: profile.profile_analyzed
                } : null
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
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 500,
                price: 35,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['500 Credits', 'Chrome extension', 'AI profile analysis', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1500,
                price: 70,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['1,500 Credits', 'Chrome extension', 'AI profile analysis', 'Credits never expire'],
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
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 100,
                price: 8.60,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['100 Credits', 'Chrome extension', 'AI profile analysis', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 500,
                price: 25.20,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['500 Credits', 'Chrome extension', 'AI profile analysis', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1500,
                price: 50.40,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['1,500 Credits', 'Chrome extension', 'AI profile analysis', '7-day free trial included'],
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

// Error handling
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        availableRoutes: [
            'POST /register', 
            'POST /login', 
            'GET /auth/google',
            'GET /profile', 
            'POST /update-profile',
            'GET /profile-status',
            'GET /profile-data',
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
        console.warn('⚠️ Warning: BRIGHT_DATA_API_TOKEN not set - profile extraction will fail');
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
            console.log('🚀 Msgly.AI Server with FIXED Bright Data Integration Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`🔧 API: FIXED - Using Collector API (DCA)`);
            console.log(`📊 Collector ID: ${COLLECTOR_ID}`);
            console.log(`🔗 Trigger: https://api.brightdata.com/dca/trigger`);
            console.log(`📋 Poll: https://api.brightdata.com/dca/dataset`);
            console.log(`🌐 Health: http://localhost:${PORT}/health`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
        });
        
    } catch (error) {
        console.error('❌ Startup failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
