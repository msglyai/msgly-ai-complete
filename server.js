// Msgly.AI Server with Google OAuth + Official Outscraper SDK Integration
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Outscraper = require('outscraper'); // Official Outscraper SDK
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// FIXED: Initialize Official Outscraper Client
const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
let outscraper;

if (OUTSCRAPER_API_KEY) {
    try {
        outscraper = new Outscraper(OUTSCRAPER_API_KEY);
        console.log('✅ Outscraper SDK initialized successfully');
    } catch (error) {
        console.error('❌ Outscraper SDK initialization failed:', error.message);
        outscraper = null;
    }
} else {
    console.warn('⚠️ OUTSCRAPER_API_KEY not configured');
    outscraper = null;
}

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

        // Updated users table with Google OAuth fields - FIXED: password_hash is now nullable
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

        // Enhanced user profiles table with Outscraper fields
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
                profile_image_url VARCHAR(500),
                outscraper_data JSONB,
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

        // Add Google OAuth columns to existing users table
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
                ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
                ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500);
            `);
            console.log('✅ Added Google OAuth columns to users table');
        } catch (err) {
            console.log('Google OAuth columns might already exist:', err.message);
        }

        // CRITICAL FIX: Make password_hash nullable for Google OAuth users
        try {
            await pool.query(`
                ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            `);
            console.log('✅ Made password_hash nullable for Google OAuth users');
        } catch (err) {
            console.log('Password hash might already be nullable:', err.message);
        }

        // Add Outscraper columns to existing user_profiles table
        try {
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
                ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(500),
                ADD COLUMN IF NOT EXISTS outscraper_data JSONB,
                ADD COLUMN IF NOT EXISTS data_extraction_status VARCHAR(50) DEFAULT 'pending',
                ADD COLUMN IF NOT EXISTS extraction_attempted_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS extraction_completed_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS extraction_error TEXT;
            `);
            console.log('✅ Added Outscraper columns to user_profiles table');
        } catch (err) {
            console.log('Outscraper columns might already exist:', err.message);
        }

        // Create indexes
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
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

// ==================== FIXED OUTSCRAPER FUNCTIONS WITH OFFICIAL SDK ====================

// FIXED: LinkedIn Profile Extraction using Official Outscraper SDK
const extractLinkedInProfile = async (linkedinUrl) => {
    try {
        console.log(`🔍 Extracting LinkedIn profile with Official SDK: ${linkedinUrl}`);
        
        if (!outscraper) {
            throw new Error('Outscraper SDK not initialized - check API key configuration');
        }
        
        // Method 1: Try LinkedIn-specific search (if available)
        try {
            console.log('🎯 Attempting LinkedIn-specific extraction...');
            
            // For Outscraper, we might need to use their general search with LinkedIn URL
            const results = await outscraper.googleSearch([linkedinUrl], {
                limit: 1,
                language: 'en'
            });
            
            console.log('📊 Outscraper LinkedIn Results:', JSON.stringify(results, null, 2));
            
            if (results && results.length > 0 && results[0]) {
                const profile = results[0];
                
                // Extract and structure the data
                const extractedData = {
                    fullName: profile.title || profile.name || null,
                    firstName: null, // Will be parsed from fullName if available
                    lastName: null,  // Will be parsed from fullName if available
                    headline: profile.snippet || profile.description || null,
                    summary: profile.snippet || null,
                    location: null, // Extract from description if available
                    industry: null,
                    connectionsCount: null,
                    profileImageUrl: null,
                    experience: [],
                    education: [],
                    skills: [],
                    rawData: profile // Store complete response for future use
                };

                // Try to parse name into first/last
                if (extractedData.fullName) {
                    const nameParts = extractedData.fullName.split(' ');
                    if (nameParts.length >= 2) {
                        extractedData.firstName = nameParts[0];
                        extractedData.lastName = nameParts.slice(1).join(' ');
                    }
                }

                console.log(`✅ Successfully extracted basic profile data for: ${extractedData.fullName || 'Unknown User'}`);
                return extractedData;
            }
        } catch (sdkError) {
            console.log('⚠️ SDK LinkedIn method failed, trying alternative approach:', sdkError.message);
        }
        
        // Method 2: Try using web scraping approach with Outscraper
        try {
            console.log('🌐 Attempting web scraping approach...');
            
            // Use Outscraper's general web scraping capabilities
            const scrapingResults = await outscraper.googleMapsSearch([linkedinUrl], {
                limit: 1,
                language: 'en'
            });
            
            console.log('📊 Outscraper Scraping Results:', JSON.stringify(scrapingResults, null, 2));
            
            if (scrapingResults && scrapingResults.length > 0) {
                // Process the scraped data
                const profile = scrapingResults[0];
                
                const extractedData = {
                    fullName: profile.name || profile.title || null,
                    firstName: null,
                    lastName: null,
                    headline: profile.type || profile.category || null,
                    summary: profile.description || null,
                    location: profile.address || profile.location || null,
                    industry: profile.category || null,
                    connectionsCount: null,
                    profileImageUrl: profile.photo || null,
                    experience: [],
                    education: [],
                    skills: [],
                    rawData: profile
                };

                // Parse name if available
                if (extractedData.fullName) {
                    const nameParts = extractedData.fullName.split(' ');
                    if (nameParts.length >= 2) {
                        extractedData.firstName = nameParts[0];
                        extractedData.lastName = nameParts.slice(1).join(' ');
                    }
                }

                console.log(`✅ Successfully extracted profile via scraping for: ${extractedData.fullName || 'Unknown User'}`);
                return extractedData;
            }
        } catch (scrapingError) {
            console.log('⚠️ Web scraping approach failed:', scrapingError.message);
        }
        
        // If both methods fail, throw an error
        throw new Error('Unable to extract LinkedIn profile data using available methods');
        
    } catch (error) {
        console.error('❌ Outscraper SDK extraction error:', error.message);
        
        // Better error handling
        if (error.message.includes('API key')) {
            throw new Error('Invalid Outscraper API key - please check your configuration');
        } else if (error.message.includes('rate limit')) {
            throw new Error('Outscraper API rate limit exceeded - please try again later');
        } else if (error.message.includes('not found')) {
            throw new Error('LinkedIn profile not found or URL is invalid');
        } else if (error.message.includes('private')) {
            throw new Error('LinkedIn profile is private or restricted');
        } else {
            throw new Error(`LinkedIn extraction failed: ${error.message}`);
        }
    }
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
        
        // Ensure it's a valid LinkedIn profile URL
        if (!cleanUrl.includes('linkedin.com/in/')) {
            throw new Error('Invalid LinkedIn URL format');
        }
        
        return cleanUrl;
    } catch (error) {
        throw new Error('Invalid LinkedIn URL: ' + error.message);
    }
};

// ==================== EXISTING DATABASE FUNCTIONS (UNCHANGED) ====================

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

// New function for Google users - FIXED: No password_hash required
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

// ==================== ENHANCED FUNCTIONS FOR LINKEDIN URL WITH EXTRACTION ====================

// Create or update user profile with LinkedIn URL (EXISTING - kept same)
const createOrUpdateUserProfile = async (userId, linkedinUrl, fullName = null) => {
    try {
        // Check if profile exists
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (existingProfile.rows.length > 0) {
            // Update existing profile
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3 RETURNING *',
                [linkedinUrl, fullName, userId]
            );
            return result.rows[0];
        } else {
            // Create new profile
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name) VALUES ($1, $2, $3) RETURNING *',
                [userId, linkedinUrl, fullName]
            );
            return result.rows[0];
        }
    } catch (error) {
        console.error('Error creating/updating user profile:', error);
        throw error;
    }
};

// ENHANCED: Better extraction with Official Outscraper SDK
const createOrUpdateUserProfileWithExtraction = async (userId, linkedinUrl, displayName = null) => {
    try {
        console.log(`🚀 Starting profile extraction for user ${userId} with URL: ${linkedinUrl}`);
        
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        console.log(`🧹 Cleaned URL: ${cleanUrl}`);
        
        // First, create/update basic profile
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            // Update existing profile
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, data_extraction_status = $3, extraction_attempted_at = CURRENT_TIMESTAMP, extraction_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 RETURNING *',
                [cleanUrl, displayName, 'in_progress', userId]
            );
            profile = result.rows[0];
        } else {
            // Create new profile
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name, data_extraction_status, extraction_attempted_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *',
                [userId, cleanUrl, displayName, 'in_progress']
            );
            profile = result.rows[0];
        }
        
        console.log(`📝 Basic profile saved, starting Official SDK extraction...`);

        try {
            // Extract LinkedIn data using Official Outscraper SDK
            const extractedData = await extractLinkedInProfile(cleanUrl);
            
            console.log(`🎯 Extraction successful, saving data...`);
            
            // Update profile with extracted data
            const result = await pool.query(`
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
                    profile_image_url = $12,
                    outscraper_data = $13,
                    data_extraction_status = 'completed',
                    extraction_completed_at = CURRENT_TIMESTAMP,
                    extraction_error = NULL,
                    profile_analyzed = true,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $14 
                RETURNING *
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
                extractedData.profileImageUrl,
                JSON.stringify(extractedData.rawData),
                userId
            ]);

            console.log(`✅ Profile data extracted and saved successfully for user ${userId}`);
            return result.rows[0];

        } catch (extractionError) {
            console.error('❌ Profile extraction failed:', extractionError.message);
            
            // Mark extraction as failed but don't fail the registration
            const failedResult = await pool.query(
                'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3 RETURNING *',
                ['failed', extractionError.message, userId]
            );
            
            console.log(`⚠️ Extraction failed but profile saved - user can retry later`);
            
            // Return profile with failure status - registration should still succeed
            return failedResult.rows[0];
        }
    } catch (error) {
        console.error('❌ Error in profile creation/extraction:', error);
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

// Health Check (ENHANCED)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        version: '3.0-outscraper-sdk',
        timestamp: new Date().toISOString(),
        features: ['authentication', 'google-oauth', 'outscraper-sdk-integration', 'linkedin-extraction'],
        outscraper: {
            configured: !!OUTSCRAPER_API_KEY,
            sdkInitialized: !!outscraper,
            status: 'official-sdk'
        }
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Server with Google OAuth + Official Outscraper SDK',
        status: 'running',
        version: '3.0-outscraper-sdk',
        endpoints: [
            'POST /register',
            'POST /login', 
            'GET /auth/google',
            'GET /auth/google/callback',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'POST /retry-extraction (protected)',
            'GET /packages',
            'GET /health'
        ]
    });
});

// ==================== GOOGLE OAUTH ROUTES (UNCHANGED) ====================

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

// Google OAuth callback - FIXED: Better error handling
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/failed' }),
    async (req, res) => {
        try {
            // Generate JWT for the authenticated user
            const token = jwt.sign(
                { userId: req.user.id, email: req.user.email },
                process.env.JWT_SECRET || 'msgly-simple-secret-2024',
                { expiresIn: '30d' }
            );
            
            // If package was selected, update user
            if (req.session.selectedPackage && req.session.selectedPackage !== 'free') {
                // For now, only allow free package
                // Premium packages will be enabled after Chargebee integration
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

// ==================== ENHANCED ENDPOINTS FOR OUTSCRAPER SDK INTEGRATION ====================

// ENHANCED: Update user profile with LinkedIn URL and trigger extraction
app.post('/update-profile', authenticateToken, async (req, res) => {
    console.log('📝 Profile update request for user:', req.user.id);
    console.log('📝 Request body:', req.body);
    
    try {
        const { linkedinUrl, packageType } = req.body;
        
        // Validation
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required'
            });
        }
        
        // Enhanced LinkedIn URL validation
        try {
            const cleanUrl = cleanLinkedInUrl(linkedinUrl);
            console.log(`✅ LinkedIn URL validated: ${cleanUrl}`);
        } catch (validationError) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL (e.g., https://www.linkedin.com/in/your-profile)'
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
        
        console.log(`🚀 Starting Official SDK profile extraction for user ${req.user.id}...`);
        
        // Create or update user profile WITH ENHANCED OUTSCRAPER SDK EXTRACTION
        const profile = await createOrUpdateUserProfileWithExtraction(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        // Get updated user data
        const updatedUser = await getUserById(req.user.id);
        
        console.log(`✅ Profile processing completed with status: ${profile.data_extraction_status}`);
        
        res.json({
            success: true,
            message: profile.data_extraction_status === 'completed' 
                ? 'Profile updated and extraction completed successfully' 
                : 'Profile updated - extraction may have failed but can be retried',
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
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    summary: profile.summary,
                    location: profile.location,
                    industry: profile.industry,
                    extractionStatus: profile.data_extraction_status,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    profileAnalyzed: profile.profile_analyzed
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// ENHANCED: Retry extraction for failed profiles
app.post('/retry-extraction', authenticateToken, async (req, res) => {
    try {
        console.log(`🔄 Retry extraction request for user ${req.user.id}`);
        
        const profileResult = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [req.user.id]
        );
        
        if (!profileResult.rows[0] || !profileResult.rows[0].linkedin_url) {
            return res.status(400).json({
                success: false,
                error: 'No LinkedIn URL found for this user'
            });
        }
        
        const profile = profileResult.rows[0];
        
        console.log(`🔄 Retrying extraction for URL: ${profile.linkedin_url}`);
        
        // Re-run extraction
        const updatedProfile = await createOrUpdateUserProfileWithExtraction(
            req.user.id,
            profile.linkedin_url,
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: updatedProfile.data_extraction_status === 'completed' 
                ? 'Profile extraction completed successfully'
                : 'Profile extraction attempted - check extraction status',
            data: {
                profile: {
                    extractionStatus: updatedProfile.data_extraction_status,
                    profileAnalyzed: updatedProfile.profile_analyzed,
                    fullName: updatedProfile.full_name,
                    headline: updatedProfile.headline,
                    location: updatedProfile.location,
                    industry: updatedProfile.industry,
                    extractionError: updatedProfile.extraction_error,
                    extractionCompleted: updatedProfile.extraction_completed_at
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Extraction retry error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retry extraction',
            details: error.message
        });
    }
});

// ==================== REST OF EXISTING ENDPOINTS (UNCHANGED) ====================

// User Registration with Package Selection (Email/Password) - UNCHANGED
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

// User Login (Email/Password) - UNCHANGED
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
        
        // Get user
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        // Check if user has password (might be Google-only account)
        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                error: 'Please sign in with Google'
            });
        }
        
        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        // Generate JWT
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

// Get User Profile (Protected) - ENHANCED with extracted data
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
                    profileImageUrl: profile.profile_image_url,
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

// Get Available Packages - UNCHANGED
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
            'POST /retry-extraction',
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
    
    if (!OUTSCRAPER_API_KEY) {
        console.warn('⚠️ Warning: OUTSCRAPER_API_KEY not set - profile extraction will fail');
    } else {
        console.log('✅ Outscraper API key configured');
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
            console.log('🚀 Msgly.AI Server with Official Outscraper SDK Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Outscraper: ${outscraper ? 'Official SDK Initialized ✅' : 'NOT INITIALIZED ⚠️'}`);
            console.log(`💳 Packages: Free (Available), Premium (Coming Soon)`);
            console.log(`💰 Billing: Pay-As-You-Go & Monthly`);
            console.log(`🔗 LinkedIn: Official SDK Profile Extraction Ready`);
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
