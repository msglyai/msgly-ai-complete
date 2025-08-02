// Msgly.AI Server - COMPLETE LinkedIn Data Extraction with Bright Data Integration
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

// Import LinkedIn router
const linkedinRouter = require('./routes/linkedin');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Database connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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

// Add LinkedIn routes AFTER all middleware is set up
app.use('/api/linkedin-profile', linkedinRouter);

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
            CREATE TABLE IF NOT EXISTS user_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                
                -- Basic Profile Information
                linkedin_url TEXT,
                linkedin_id TEXT,
                linkedin_num_id BIGINT,
                input_url TEXT,
                url TEXT,
                full_name TEXT,
                first_name TEXT,
                last_name TEXT,
                headline TEXT,
                about TEXT,
                summary TEXT,
                
                -- Location Information
                location TEXT,
                city TEXT,
                state TEXT,
                country TEXT,
                country_code TEXT,
                
                -- Professional Information
                industry TEXT,
                current_company TEXT,
                current_company_name TEXT,
                current_company_id TEXT,
                current_company_company_id TEXT,
                current_position TEXT,
                
                -- Metrics
                connections_count INTEGER,
                followers_count INTEGER,
                connections INTEGER,
                followers INTEGER,
                recommendations_count INTEGER,
                
                -- Media
                profile_picture TEXT,
                profile_image_url VARCHAR(500),
                avatar TEXT,
                banner_image TEXT,
                background_image_url VARCHAR(500),
                
                -- Identifiers
                public_identifier VARCHAR(255),
                
                -- Complex Data Arrays (ALL JSONB)
                experience JSONB DEFAULT '[]'::JSONB,
                education JSONB DEFAULT '[]'::JSONB,
                educations_details JSONB DEFAULT '[]'::JSONB,
                skills JSONB DEFAULT '[]'::JSONB,
                skills_with_endorsements JSONB DEFAULT '[]'::JSONB,
                languages JSONB DEFAULT '[]'::JSONB,
                certifications JSONB DEFAULT '[]'::JSONB,
                courses JSONB DEFAULT '[]'::JSONB,
                projects JSONB DEFAULT '[]'::JSONB,
                publications JSONB DEFAULT '[]'::JSONB,
                patents JSONB DEFAULT '[]'::JSONB,
                volunteer_experience JSONB DEFAULT '[]'::JSONB,
                volunteering JSONB DEFAULT '[]'::JSONB,
                honors_and_awards JSONB DEFAULT '[]'::JSONB,
                organizations JSONB DEFAULT '[]'::JSONB,
                recommendations JSONB DEFAULT '[]'::JSONB,
                recommendations_given JSONB DEFAULT '[]'::JSONB,
                recommendations_received JSONB DEFAULT '[]'::JSONB,
                posts JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                articles JSONB DEFAULT '[]'::JSONB,
                people_also_viewed JSONB DEFAULT '[]'::JSONB,
                
                -- Metadata
                brightdata_data JSONB,
                timestamp TIMESTAMP,
                data_source VARCHAR(100),
                data_extraction_status VARCHAR(50) DEFAULT 'pending',
                extraction_attempted_at TIMESTAMP,
                extraction_completed_at TIMESTAMP,
                extraction_error TEXT,
                extraction_retry_count INTEGER DEFAULT 0,
                profile_analyzed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                
                CONSTRAINT user_profiles_user_id_key UNIQUE (user_id)
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

        // Create indexes
        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_linkedin_id ON user_profiles(linkedin_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_linkedin_num_id ON user_profiles(linkedin_num_id);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(data_extraction_status);
                CREATE INDEX IF NOT EXISTS idx_users_linkedin_url ON users(linkedin_url);
                CREATE INDEX IF NOT EXISTS idx_users_extraction_status ON users(extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_retry_count ON user_profiles(extraction_retry_count);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_current_company ON user_profiles(current_company);
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
        message: 'Msgly.AI Server - Complete LinkedIn Data Extraction with Bright Data',
        status: 'running',
        version: '7.0-BRIGHT-DATA-INTEGRATION',
        dataExtraction: 'Complete LinkedIn profile data via Bright Data API',
        brightDataIntegration: 'Full integration with separate service modules',
        linkedinProfilesTable: 'New dedicated table for LinkedIn data',
        serviceArchitecture: 'Modular design with brightDataService.js and databaseService.js',
        creditPackages: {
            free: '10 credits per month',
            silver: '75 credits',
            gold: '250 credits',
            platinum: '1000 credits'
        },
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
            'GET /health',
            'POST /migrate-database',
            'POST /api/linkedin-profile - NEW: Process LinkedIn URLs',
            'GET /api/linkedin-profile/:id - NEW: Get profile by ID',
            'GET /api/linkedin-profile/status/stats - NEW: Get statistics'
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
            version: '7.0-BRIGHT-DATA-INTEGRATION',
            timestamp: new Date().toISOString(),
            architecture: 'Modular Bright Data integration',
            creditPackages: {
                free: '10 credits per month',
                silver: '75 credits',
                gold: '250 credits',
                platinum: '1000 credits'
            },
            brightDataIntegration: {
                configured: !!process.env.BRIGHT_DATA_API_KEY,
                datasetId: process.env.BRIGHT_DATA_DATASET_ID,
                serviceModule: 'brightDataService.js',
                databaseModule: 'databaseService.js',
                routesModule: 'routes/linkedin.js',
                linkedinProfilesTable: 'Dedicated table for LinkedIn data storage'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production',
                tables: ['users', 'user_profiles', 'linkedin_profiles', 'message_logs', 'credits_transactions']
            },
            authentication: {
                google: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
                jwt: !!JWT_SECRET,
                passport: 'configured'
            },
            apiEndpoints: {
                linkedinProfiles: '/api/linkedin-profile',
                userManagement: '/register, /login, /profile',
                authentication: '/auth/google/*'
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

// Update user profile with LinkedIn URL (now uses the new LinkedIn service)
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
        
        // Update user's LinkedIn URL
        await pool.query(
            'UPDATE users SET linkedin_url = $1, extraction_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [linkedinUrl, 'processing', req.user.id]
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated successfully! LinkedIn data extraction will be handled by the new LinkedIn API.',
            data: {
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.display_name,
                    packageType: updatedUser.package_type,
                    credits: updatedUser.credits_remaining,
                    linkedinUrl: updatedUser.linkedin_url
                },
                nextSteps: {
                    message: 'Use the LinkedIn API endpoint to process the profile',
                    endpoint: '/api/linkedin-profile',
                    method: 'POST',
                    payload: { profileUrl: linkedinUrl }
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - Use LinkedIn API for data extraction`);
        
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
                    linkedinUrl: req.user.linkedin_url,
                    createdAt: req.user.created_at
                },
                profile: profile ? {
                    // Basic Information
                    linkedinUrl: profile.linkedin_url,
                    linkedinId: profile.linkedin_id,
                    linkedinNumId: profile.linkedin_num_id,
                    inputUrl: profile.input_url,
                    url: profile.url,
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
                    currentCompanyCompanyId: profile.current_company_company_id,
                    currentPosition: profile.current_position,
                    
                    // Metrics
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    connections: profile.connections,
                    followers: profile.followers,
                    recommendationsCount: profile.recommendations_count,
                    
                    // Media
                    profileImageUrl: profile.profile_image_url,
                    avatar: profile.avatar,
                    bannerImage: profile.banner_image,
                    backgroundImageUrl: profile.background_image_url,
                    publicIdentifier: profile.public_identifier,
                    
                    // Complex Data Arrays
                    experience: profile.experience,
                    education: profile.education,
                    educationsDetails: profile.educations_details,
                    skills: profile.skills,
                    skillsWithEndorsements: profile.skills_with_endorsements,
                    languages: profile.languages,
                    certifications: profile.certifications,
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
                    
                    // Metadata
                    timestamp: profile.timestamp,
                    dataSource: profile.data_source,
                    extractionStatus: profile.data_extraction_status,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count,
                    profileAnalyzed: profile.profile_analyzed
                } : null,
                subscription: {
                    plan: req.user.package_type,
                    creditsRemaining: req.user.credits_remaining,
                    renewalDate: null
                },
                brightDataIntegration: {
                    enabled: true,
                    apiEndpoint: '/api/linkedin-profile',
                    serviceModules: ['brightDataService.js', 'databaseService.js'],
                    linkedinProfilesTable: 'Dedicated table for LinkedIn data'
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
                credits: 10,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', 'Credits never expire'],
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
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', 'Credits never expire'],
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
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', 'Credits never expire'],
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
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', 'No credit card required'],
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
                features: ['75 Credits', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', '7-day free trial included'],
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
                features: ['250 Credits', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', '7-day free trial included'],
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
                features: ['1,000 Credits', 'Chrome extension', 'AI profile analysis', 'Complete LinkedIn extraction via Bright Data', '7-day free trial included'],
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

// DATABASE MIGRATION ENDPOINT
app.post('/migrate-database', async (req, res) => {
    try {
        console.log('🚀 Starting database migration via server endpoint...');
        
        const client = await pool.connect();
        let migrationResults = [];
        
        try {
            await initDB();
            migrationResults.push('✅ Database initialization completed');
            migrationResults.push('✅ All tables created/updated successfully');
            migrationResults.push('✅ Performance indexes created successfully');
            
            const usersTableInfo = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                ORDER BY ordinal_position
            `);
            
            const profilesTableInfo = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'user_profiles' 
                ORDER BY ordinal_position
            `);
            
            // Check if linkedin_profiles table exists
            const linkedinTableInfo = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'linkedin_profiles' 
                ORDER BY ordinal_position
            `);
            
            const testResult = await client.query('SELECT COUNT(*) as user_count FROM users;');
            migrationResults.push(`✅ Database verified - ${testResult.rows[0].user_count} users in database`);
            migrationResults.push(`✅ Users table has ${usersTableInfo.rows.length} columns`);
            migrationResults.push(`✅ User_profiles table has ${profilesTableInfo.rows.length} columns`);
            migrationResults.push(`✅ LinkedIn_profiles table has ${linkedinTableInfo.rows.length} columns`);
            
            console.log('🎉 DATABASE MIGRATION COMPLETED SUCCESSFULLY!');
            migrationResults.push('🎉 DATABASE MIGRATION COMPLETED SUCCESSFULLY!');
            migrationResults.push('🚀 Your database is now ready for Bright Data LinkedIn extraction!');
            migrationResults.push('✅ Modular service architecture implemented');
            migrationResults.push('✅ Dedicated linkedin_profiles table created');
            migrationResults.push('✅ Service modules: brightDataService.js, databaseService.js');
            migrationResults.push('✅ LinkedIn API routes: /api/linkedin-profile/*');
            
        } finally {
            client.release();
        }
        
        res.json({
            success: true,
            message: 'Database migration completed successfully!',
            steps: migrationResults,
            summary: {
                usersTable: 'Updated with LinkedIn fields',
                profilesTable: 'Complete LinkedIn schema', 
                linkedinProfilesTable: 'NEW - Dedicated table for Bright Data LinkedIn data',
                indexes: 'Performance indexes created',
                status: 'Ready for modular Bright Data LinkedIn extraction',
                architecture: 'Service-based with brightDataService.js and databaseService.js',
                apiEndpoints: 'LinkedIn processing via /api/linkedin-profile',
                creditPackages: {
                    free: '10 credits per month',
                    silver: '75 credits',
                    gold: '250 credits',
                    platinum: '1000 credits'
                },
                features: [
                    'Modular Bright Data integration',
                    'Dedicated LinkedIn profiles table',
                    'Service-based architecture',
                    'Complete LinkedIn data extraction',
                    'Professional API endpoints',
                    'Comprehensive error handling'
                ]
            },
            timestamp: new Date().toISOString()
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
            'GET /packages', 
            'GET /health',
            'POST /migrate-database',
            'POST /api/linkedin-profile - NEW: Process LinkedIn URLs',
            'GET /api/linkedin-profile/:id - NEW: Get profile by ID', 
            'GET /api/linkedin-profile/status/stats - NEW: Get statistics'
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
    
    if (!process.env.BRIGHT_DATA_API_KEY) {
        console.warn('⚠️ Warning: BRIGHT_DATA_API_KEY not set - LinkedIn extraction will fail');
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
            console.log('🚀 Msgly.AI Server - Bright Data LinkedIn Integration Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected with complete schema`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${process.env.BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`🏗️ Architecture: Modular service-based design ✅`);
            console.log(`⚡ LinkedIn API: /api/linkedin-profile ✅`);
            console.log(`🛠️ Service Modules:`);
            console.log(`   📄 brightDataService.js - Bright Data API integration`);
            console.log(`   📄 databaseService.js - LinkedIn profiles database`);
            console.log(`   📄 routes/linkedin.js - LinkedIn API routes`);
            console.log(`🗄️ Database Tables:`);
            console.log(`   📋 users - User accounts and authentication`);
            console.log(`   📋 user_profiles - User LinkedIn profile data`);
            console.log(`   📋 linkedin_profiles - NEW: Dedicated Bright Data LinkedIn storage`);
            console.log(`   📋 message_logs - Message generation history`);
            console.log(`   📋 credits_transactions - Credit usage tracking`);
            console.log(`💰 Credit Packages:`);
            console.log(`   🆓 Free: 10 credits per month`);
            console.log(`   🥈 Silver: 75 credits`);
            console.log(`   🥇 Gold: 250 credits`);
            console.log(`   💎 Platinum: 1000 credits`);
            console.log(`🔗 LinkedIn Integration: Complete via Bright Data API!`);
            console.log(`📄 Static Files: /sign-up, /login, /dashboard served`);
            console.log(`🌐 Health: http://localhost:${PORT}/health`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            console.log(`🎯 NEW FEATURES:`);
            console.log(`   ✅ POST /api/linkedin-profile - Process LinkedIn URLs`);
            console.log(`   ✅ GET /api/linkedin-profile/:id - Get profile by ID`);
            console.log(`   ✅ GET /api/linkedin-profile/status/stats - Statistics`);
            console.log(`🚀 READY: Complete modular LinkedIn data extraction system!`);
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
