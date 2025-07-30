// Msgly.AI Server with Google OAuth + Bright Data Integration (AUTOMATIC BACKGROUND PROCESSING)
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

// Bright Data API configuration (UPDATED FROM SCRAPINGDOG)
const BRIGHT_DATA_API_TOKEN = process.env.BRIGHT_DATA_API_TOKEN || 'e5353ea11fe201c7f9797062c64b59fb87f1bfc01ad8a24dd0fc34a29ccddd23';
const BRIGHT_DATA_DATASET_ID = 'gd_l1viktl72bvl7bjuj0';
const BRIGHT_DATA_BASE_URL = 'https://api.brightdata.com/datasets/v3/trigger';

// Background processing tracking
const processingQueue = new Map(); // Track background jobs

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Enhanced user profiles table with Bright Data fields
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
                experience JSONB,
                education JSONB,
                skills TEXT[],
                connections_count INTEGER,
                followers_count INTEGER,
                profile_image_url VARCHAR(500),
                background_image_url VARCHAR(500),
                public_identifier VARCHAR(255),
                certifications JSONB,
                volunteering JSONB,
                languages JSONB,
                articles JSONB,
                brightdata_data JSONB,
                data_extraction_status VARCHAR(50) DEFAULT 'pending',
                extraction_attempted_at TIMESTAMP,
                extraction_completed_at TIMESTAMP,
                extraction_error TEXT,
                extraction_retry_count INTEGER DEFAULT 0,
                extraction_cost DECIMAL(10,4) DEFAULT 0.001,
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

        // Add missing columns if they don't exist
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
                ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
                ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500);
            `);
            
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);
            
            await pool.query(`
                ALTER TABLE user_profiles 
                ADD COLUMN IF NOT EXISTS headline VARCHAR(500),
                ADD COLUMN IF NOT EXISTS summary TEXT,
                ADD COLUMN IF NOT EXISTS location VARCHAR(255),
                ADD COLUMN IF NOT EXISTS industry VARCHAR(255),
                ADD COLUMN IF NOT EXISTS experience JSONB,
                ADD COLUMN IF NOT EXISTS education JSONB,
                ADD COLUMN IF NOT EXISTS skills TEXT[],
                ADD COLUMN IF NOT EXISTS connections_count INTEGER,
                ADD COLUMN IF NOT EXISTS followers_count INTEGER,
                ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(500),
                ADD COLUMN IF NOT EXISTS background_image_url VARCHAR(500),
                ADD COLUMN IF NOT EXISTS public_identifier VARCHAR(255),
                ADD COLUMN IF NOT EXISTS certifications JSONB,
                ADD COLUMN IF NOT EXISTS volunteering JSONB,
                ADD COLUMN IF NOT EXISTS languages JSONB,
                ADD COLUMN IF NOT EXISTS articles JSONB,
                ADD COLUMN IF NOT EXISTS brightdata_data JSONB,
                ADD COLUMN IF NOT EXISTS data_extraction_status VARCHAR(50) DEFAULT 'pending',
                ADD COLUMN IF NOT EXISTS extraction_attempted_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS extraction_completed_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS extraction_error TEXT,
                ADD COLUMN IF NOT EXISTS extraction_retry_count INTEGER DEFAULT 0,
                ADD COLUMN IF NOT EXISTS extraction_cost DECIMAL(10,4) DEFAULT 0.001;
            `);

            console.log('✅ Database columns updated successfully');
        } catch (err) {
            console.log('Some columns might already exist:', err.message);
        }

        // Create indexes
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_retry_count ON user_profiles(extraction_retry_count);
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

// ==================== AUTOMATIC BACKGROUND PROCESSING FUNCTIONS (UPDATED FOR BRIGHT DATA) ====================

// Enhanced number parsing for LinkedIn connection/follower counts
const parseLinkedInNumber = (str) => {
    if (!str) return null;
    if (typeof str === 'number') return str;
    
    try {
        const cleanStr = str.toString().toLowerCase().trim();
        
        // Handle "M" (millions) and "K" (thousands)
        if (cleanStr.includes('m')) {
            const num = parseFloat(cleanStr.match(/[\d.]+/)?.[0]);
            return num ? Math.round(num * 1000000) : null;
        }
        if (cleanStr.includes('k')) {
            const num = parseFloat(cleanStr.match(/[\d.]+/)?.[0]);
            return num ? Math.round(num * 1000) : null;
        }
        
        // Handle regular numbers with commas and plus signs
        const numbers = cleanStr.match(/[\d,]+/);
        if (numbers) {
            const cleanNumber = numbers[0].replace(/,/g, '');
            return parseInt(cleanNumber, 10) || null;
        }
        return null;
    } catch (error) {
        console.error('Error parsing LinkedIn number:', str, error);
        return null;
    }
};

// Extract LinkedIn profile with Bright Data (COMPLETELY UPDATED)
const extractLinkedInProfile = async (linkedinUrl, retryAttempt = 0) => {
    try {
        console.log(`🔍 Extracting LinkedIn profile with Bright Data: ${linkedinUrl} (Attempt ${retryAttempt + 1})`);
        
        if (!BRIGHT_DATA_API_TOKEN) {
            throw new Error('Bright Data API token not configured');
        }
        
        // Bright Data API call
        const response = await axios.post(
            `${BRIGHT_DATA_BASE_URL}?dataset_id=${BRIGHT_DATA_DATASET_ID}&include_errors=true`,
            [{ url: linkedinUrl }],
            {
                headers: {
                    'Authorization': `Bearer ${BRIGHT_DATA_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000 // 2 minutes
            }
        );

        console.log(`📊 Bright Data response status: ${response.status}`);

        if (response.status === 200 && response.data && response.data.length > 0) {
            const profile = response.data[0]; // First result from Bright Data
            
            console.log('📋 Raw profile data received from Bright Data:', Object.keys(profile));

            // Helper functions to extract and clean data (same as before)
            const extractExperience = (experienceArray) => {
                if (!Array.isArray(experienceArray)) return [];
                return experienceArray.map(exp => ({
                    position: exp.position || exp.title || exp.job_title || null,
                    company: exp.company_name || exp.company || exp.company_name || null,
                    companyUrl: exp.company_url || exp.company_linkedin_profile_url || null,
                    location: exp.location || null,
                    summary: exp.summary || exp.description || null,
                    startDate: exp.starts_at || exp.start_date || null,
                    endDate: exp.ends_at || exp.end_date || null,
                    duration: exp.duration || null,
                    current: !exp.ends_at || (exp.ends_at || '').toLowerCase().includes('present')
                }));
            };

            const extractEducation = (educationArray) => {
                if (!Array.isArray(educationArray)) return [];
                return educationArray.map(edu => ({
                    school: edu.school_name || edu.school || edu.institution || null,
                    degree: edu.degree_name || edu.degree || null,
                    fieldOfStudy: edu.field_of_study || edu.field || null,
                    startDate: edu.start_date || edu.starts_at || null,
                    endDate: edu.end_date || edu.ends_at || null,
                    description: edu.description || null
                }));
            };

            const extractSkills = (skillsArray) => {
                if (!Array.isArray(skillsArray)) return [];
                return skillsArray.map(skill => {
                    if (typeof skill === 'string') return skill;
                    return skill.name || skill.skillName || skill.skill || String(skill);
                }).filter(Boolean);
            };

            const extractCertifications = (certArray) => {
                if (!Array.isArray(certArray)) return [];
                return certArray.map(cert => ({
                    name: cert.name || cert.title || null,
                    authority: cert.authority || cert.issuer || null,
                    issueDate: cert.issue_date || cert.issued_date || null,
                    expirationDate: cert.expiration_date || null,
                    credentialId: cert.credential_id || null,
                    url: cert.url || null
                }));
            };

            // Extract comprehensive profile data (adapted for Bright Data response structure)
            const extractedData = {
                fullName: profile.name || profile.fullName || profile.full_name || null,
                firstName: profile.first_name || (profile.name ? profile.name.split(' ')[0] : null),
                lastName: profile.last_name || (profile.name ? profile.name.split(' ').slice(1).join(' ') : null),
                headline: profile.position || profile.headline || profile.description || null,
                summary: profile.about || profile.summary || null,
                location: profile.city || profile.location || profile.address || null,
                industry: profile.industry || null,
                connectionsCount: parseLinkedInNumber(profile.connections || profile.connections_count),
                followersCount: parseLinkedInNumber(profile.followers || profile.followers_count),
                profileImageUrl: profile.profile_photo || profile.profile_image || profile.avatar || null,
                backgroundImageUrl: profile.background_cover_image_url || profile.background_image || null,
                publicIdentifier: profile.id || profile.public_identifier || null,
                experience: extractExperience(profile.experience || []),
                education: extractEducation(profile.education || []),
                skills: extractSkills(profile.skills || []),
                certifications: extractCertifications(profile.certification || profile.certifications || []),
                volunteering: profile.volunteering || profile.volunteer || [],
                languages: profile.languages || [],
                articles: profile.articles || [],
                rawData: profile
            };

            console.log(`✅ Successfully extracted profile for: ${extractedData.fullName || 'Unknown'}`);
            console.log(`📊 Experience entries: ${extractedData.experience.length}`);
            console.log(`🎓 Education entries: ${extractedData.education.length}`);
            console.log(`🛠️ Skills count: ${extractedData.skills.length}`);
            console.log(`💰 Cost: $0.001 (0.1 cents)`);
            
            return {
                status: 'completed',
                data: extractedData,
                cost: 0.001
            };
        } else {
            throw new Error(`Bright Data returned empty response or invalid data`);
        }
    } catch (error) {
        console.error('❌ Bright Data extraction error:', error.message);
        if (error.response) {
            console.error('❌ Response status:', error.response.status);
            console.error('❌ Response data:', error.response.data);
        }
        throw error;
    }
};

// AUTOMATIC BACKGROUND PROCESSING - Updated for Bright Data reliability
const scheduleBackgroundExtraction = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3; // Reduced from 5 because Bright Data is more reliable
    const retryDelay = 60000; // 1 minute instead of 3 (Bright Data is faster)
    
    console.log(`🔄 Scheduling Bright Data background extraction for user ${userId}, retry ${retryCount}`);
    
    // Check if we've exceeded max retries
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for user ${userId}`);
        await pool.query(
            'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
            ['failed', `Max retries (${maxRetries}) exceeded`, userId]
        );
        return;
    }

    // Schedule the extraction after a delay
    setTimeout(async () => {
        try {
            console.log(`🚀 Starting Bright Data background extraction for user ${userId} (Retry ${retryCount})`);
            
            // Update retry count in database
            await pool.query(
                'UPDATE user_profiles SET extraction_retry_count = $1, extraction_attempted_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [retryCount, userId]
            );

            const result = await extractLinkedInProfile(linkedinUrl, retryCount);
            
            if (result.status === 'completed') {
                // Success! Update database with complete data
                console.log(`✅ Bright Data background extraction completed for user ${userId} (Cost: $${result.cost})`);
                
                const extractedData = result.data;
                await pool.query(`
                    UPDATE user_profiles SET 
                        full_name = COALESCE($1, full_name),
                        first_name = $2,
                        last_name = $3,
                        headline = $4,
                        summary = $5,
                        location = $6,
                        industry = $7,
                        experience = $8,
                        education = $9,
                        skills = $10,
                        connections_count = $11,
                        followers_count = $12,
                        profile_image_url = $13,
                        background_image_url = $14,
                        public_identifier = $15,
                        certifications = $16,
                        volunteering = $17,
                        languages = $18,
                        articles = $19,
                        brightdata_data = $20,
                        extraction_cost = $21,
                        data_extraction_status = 'completed',
                        extraction_completed_at = CURRENT_TIMESTAMP,
                        extraction_error = NULL,
                        profile_analyzed = true,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $22 
                `, [
                    extractedData.fullName,
                    extractedData.firstName,
                    extractedData.lastName,
                    extractedData.headline,
                    extractedData.summary,
                    extractedData.location,
                    extractedData.industry,
                    JSON.stringify(extractedData.experience),
                    JSON.stringify(extractedData.education),
                    extractedData.skills,
                    extractedData.connectionsCount,
                    extractedData.followersCount,
                    extractedData.profileImageUrl,
                    extractedData.backgroundImageUrl,
                    extractedData.publicIdentifier,
                    JSON.stringify(extractedData.certifications),
                    JSON.stringify(extractedData.volunteering),
                    JSON.stringify(extractedData.languages),
                    JSON.stringify(extractedData.articles),
                    JSON.stringify(extractedData.rawData),
                    result.cost,
                    userId
                ]);

                console.log(`🎉 Profile data fully extracted and saved for user ${userId} with Bright Data`);
                
                // Remove from processing queue
                processingQueue.delete(userId);
            }
        } catch (error) {
            console.error(`❌ Bright Data background extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            // If this is not the last retry, schedule another one
            if (retryCount < maxRetries - 1) {
                await scheduleBackgroundExtraction(userId, linkedinUrl, retryCount + 1);
            } else {
                // Max retries reached, mark as failed
                await pool.query(
                    'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
                    ['failed', error.message, userId]
                );
                processingQueue.delete(userId);
            }
        }
    }, retryCount === 0 ? 5000 : retryDelay); // First retry after 5 seconds, then 1 minute
};

// Clean and validate LinkedIn URL
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

const updateUserCredits = async (userId, newCredits) => {
    const result = await pool.query(
        'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [newCredits, userId]
    );
    return result.rows[0];
};

// Create or update user profile with AUTOMATIC background extraction
const createOrUpdateUserProfileWithAutoExtraction = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        console.log(`🚀 Creating profile with automatic Bright Data extraction for user ${userId}`);
        
        // First, create/update basic profile
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            // Update existing profile
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, data_extraction_status = $3, extraction_retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
                [cleanUrl, displayName, 'processing', userId]
            );
            profile = result.rows[0];
        } else {
            // Create new profile
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name, data_extraction_status, extraction_retry_count) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [userId, cleanUrl, displayName, 'processing', 0]
            );
            profile = result.rows[0];
        }
        
        // Start AUTOMATIC background extraction process with Bright Data
        console.log(`🔄 Starting automatic Bright Data background extraction for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        // Schedule the first extraction attempt (immediate)
        scheduleBackgroundExtraction(userId, cleanUrl, 0);
        
        console.log(`✅ Profile created and automatic Bright Data background extraction started for user ${userId}`);
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
    const processingCount = processingQueue.size;
    res.status(200).json({
        status: 'healthy',
        version: '6.0-bright-data-automatic-processing',
        timestamp: new Date().toISOString(),
        features: ['authentication', 'google-oauth', 'bright-data-integration', 'automatic-background-extraction'],
        brightData: {
            configured: !!BRIGHT_DATA_API_TOKEN,
            apiUrl: BRIGHT_DATA_BASE_URL,
            datasetId: BRIGHT_DATA_DATASET_ID,
            costPerProfile: '$0.001',
            status: 'active'
        },
        backgroundProcessing: {
            enabled: true,
            currentlyProcessing: processingCount,
            processingUsers: Array.from(processingQueue.keys())
        }
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Server with Automatic Background LinkedIn Processing (Bright Data)',
        status: 'running',
        version: '6.0-bright-data',
        backgroundProcessing: 'enabled',
        costPerProfile: '$0.001',
        endpoints: [
            'POST /register',
            'POST /login', 
            'GET /auth/google',
            'GET /auth/google/callback',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'GET /packages',
            'GET /health'
        ]
    });
});

// ==================== GOOGLE OAUTH ROUTES ====================

// Initiate Google OAuth
app.get('/auth/google', (req, res, next) => {
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

// Auth failed route
app.get('/auth/failed', (req, res) => {
    const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://msgly.ai/sign-up' 
        : 'http://localhost:3000/sign-up';
        
    res.redirect(`${frontendUrl}?error=auth_failed`);
});

// ==================== MAIN ENDPOINTS ====================

// User Registration with AUTOMATIC LinkedIn Processing
app.post('/register', async (req, res) => {
    console.log('👤 Registration request:', req.body);
    
    try {
        const { email, password, packageType, billingModel } = req.body;
        
        // Validation
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
        
        // For now, only allow free package
        if (packageType !== 'free') {
            return res.status(400).json({
                success: false,
                error: 'Only free package is available during beta. Premium packages coming soon!'
            });
        }
        
        // Check if user exists
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists with this email'
            });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Create user
        const newUser = await createUser(email, passwordHash, packageType, billingModel || 'monthly');
        
        // Generate JWT
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

// Update user profile with LinkedIn URL - AUTOMATIC PROCESSING
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
        
        // Create or update user profile with AUTOMATIC background extraction using Bright Data
        const profile = await createOrUpdateUserProfileWithAutoExtraction(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        // Get updated user data
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated and automatic LinkedIn extraction started with Bright Data',
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
                    extractionStatus: profile.data_extraction_status,
                    message: 'LinkedIn data extraction is happening automatically in the background with Bright Data'
                },
                automaticProcessing: {
                    enabled: true,
                    status: 'started',
                    provider: 'Bright Data',
                    costPerProfile: '$0.001',
                    expectedCompletionTime: '30 seconds - 2 minutes',
                    message: 'No user action required - data will appear automatically'
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} with automatic Bright Data extraction started`);
        
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
        // Get user's LinkedIn profile if it exists
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
                    linkedinUrl: profile.linkedin_url,
                    fullName: profile.full_name,
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    summary: profile.summary,
                    location: profile.location,
                    industry: profile.industry,
                    experience: profile.experience,
                    education: profile.education,
                    skills: profile.skills,
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    profileImageUrl: profile.profile_image_url,
                    backgroundImageUrl: profile.background_image_url,
                    publicIdentifier: profile.public_identifier,
                    certifications: profile.certifications,
                    volunteering: profile.volunteering,
                    languages: profile.languages,
                    articles: profile.articles,
                    extractionStatus: profile.data_extraction_status,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count,
                    extractionCost: profile.extraction_cost,
                    profileAnalyzed: profile.profile_analyzed
                } : null,
                automaticProcessing: {
                    enabled: true,
                    provider: 'Bright Data',
                    costPerProfile: '$0.001',
                    isCurrentlyProcessing: processingQueue.has(req.user.id),
                    queuePosition: processingQueue.has(req.user.id) ? 
                        Array.from(processingQueue.keys()).indexOf(req.user.id) + 1 : null
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
                features: ['30 Credits per month', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', 'No credit card required'],
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
                features: ['100 Credits', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', 'Credits never expire'],
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
                features: ['500 Credits', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', 'Credits never expire'],
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
                features: ['1,500 Credits', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', 'Credits never expire'],
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
                features: ['30 Credits per month', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', 'No credit card required'],
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
                features: ['100 Credits', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', '7-day free trial included'],
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
                features: ['500 Credits', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', '7-day free trial included'],
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
                features: ['1,500 Credits', 'Chrome extension', 'AI profile analysis', 'Automatic LinkedIn extraction with Bright Data', '7-day free trial included'],
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

// Background processing status endpoint (optional - for debugging)
app.get('/processing-status', authenticateToken, async (req, res) => {
    try {
        const profileResult = await pool.query(
            'SELECT data_extraction_status, extraction_retry_count, extraction_attempted_at, extraction_completed_at, extraction_error, extraction_cost FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        
        const profile = profileResult.rows[0];
        
        res.json({
            success: true,
            data: {
                extractionStatus: profile?.data_extraction_status || 'no_profile',
                retryCount: profile?.extraction_retry_count || 0,
                lastAttempt: profile?.extraction_attempted_at,
                completedAt: profile?.extraction_completed_at,
                error: profile?.extraction_error,
                cost: profile?.extraction_cost || 0.001,
                isCurrentlyProcessing: processingQueue.has(req.user.id),
                totalProcessingQueue: processingQueue.size,
                processingStartTime: processingQueue.get(req.user.id)?.startTime,
                provider: 'Bright Data'
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

// Simple error handling
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        availableRoutes: [
            'POST /register', 
            'POST /login', 
            'GET /auth/google',
            'GET /profile', 
            'POST /update-profile',
            'GET /processing-status',
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
    
    if (!BRIGHT_DATA_API_TOKEN) {
        console.warn('⚠️ Warning: BRIGHT_DATA_API_TOKEN not set - using default token');
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
            console.log('🚀 Msgly.AI Server with AUTOMATIC Background Processing Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_TOKEN ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`💰 Cost Per Profile: $0.001 (0.1 cents!) ✅`);
            console.log(`🤖 Background Processing: ENABLED ✅`);
            console.log(`⚡ Automatic Extraction: ACTIVE ✅`);
            console.log(`💳 Packages: Free (Available), Premium (Coming Soon)`);
            console.log(`💰 Billing: Pay-As-You-Go & Monthly`);
            console.log(`🔗 LinkedIn: Automatic Complete Profile Extraction with Bright Data`);
            console.log(`🌐 Health: http://localhost:${PORT}/health`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            console.log(`🎯 USER EXPERIENCE: Register → Use App → Data Appears Automatically (Ultra Cheap!)!`);
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
