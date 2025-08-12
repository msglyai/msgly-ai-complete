// What changed in Stage G
// Msgly.AI Server - LLM Orchestrator + Numeric Sanitization Integration
// ✅ Added LLM fallback chain and numeric sanitization support

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const axios = require('axios');
const { sendToGemini } = require('./sendToGemini (10).js');
require('dotenv').config();

// ✅ Import database functions
const {
    pool,
    initDB,
    testDatabase,
    createUser,
    createGoogleUser,
    linkGoogleAccount,
    getUserByEmail,
    getUserById,
    createOrUpdateUserProfile,
    sanitizeForJSON,
    ensureValidJSONArray,
    parseLinkedInNumber,
    processScrapedProfileData
} = require('./utils/database');

// ✅ Import utility functions
const {
    cleanLinkedInUrl,
    isValidLinkedInUrl,
    extractLinkedInUsername,
    getSetupStatusMessage,
    getStatusMessage,
    validateEnvironment,
    isValidEmail,
    isValidPassword,
    sanitizeString,
    parseNumericValue,
    formatCredits,
    generateRandomId,
    deepClone,
    formatDate,
    timeAgo,
    createLogMessage,
    logWithEmoji
} = require('./utils/helpers');

// ✅ Import authentication middleware
const {
    initAuthMiddleware,
    authenticateToken,
    requireFeatureAccess,
    requireAdmin
} = require('./middleware/auth');

// ✅ Import route initializations
const { initUserRoutes } = require('./routes/users');
const { initProfileRoutes } = require('./routes/profiles');

// ✅ Import modularized routes
const healthRoutes = require('./routes/health')(pool);
const staticRoutes = require('./routes/static');

// What changed in Stage G — URL normalization helper
function normalizeLinkedInUrl(url = '') {
    try {
        return url.toString().toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/[?#].*$/, '')
            .replace(/\/$/, '');
    } catch { return ''; }
}

// What changed in Stage G — numeric sanitizers at server level
function toIntSafe(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    if (!s) return null;
    const km = s.match(/^([\d.,]+)\s*([KkMmBb])$/);
    if (km) {
        const num = parseFloat(km[1].replace(/,/g, ''));
        if (isNaN(num)) return null;
        const mult = { K:1e3, k:1e3, M:1e6, m:1e6, B:1e9, b:1e9 }[km[2]];
        return Math.round(num * mult);
    }
    const digits = s.replace(/[^\d-]/g, '');
    if (!digits || /^-?$/.test(digits)) return null;
    const n = parseInt(digits, 10);
    return Number.isFinite(n) ? n : null;
}

function toFloatSafe(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    if (!s) return null;
    const km = s.match(/^([\d.,]+)\s*([KkMmBb])$/);
    if (km) {
        const num = parseFloat(km[1].replace(/,/g, ''));
        if (isNaN(num)) return null;
        const mult = { K:1e3, k:1e3, M:1e6, m:1e6, B:1e9, b:1e9 }[km[2]];
        return num * mult;
    }
    const norm = s.replace(/,/g, '');
    const n = parseFloat(norm);
    return Number.isFinite(n) ? n : null;
}

// ✅ processGeminiData function for compatibility
function processGeminiData(geminiResponse, profileUrl) {
    try {
        console.log('🤖 Processing Gemini API response for profile extraction');
        
        let extractedData = {};
        
        if (geminiResponse && geminiResponse.data) {
            extractedData = geminiResponse.data;
        } else if (geminiResponse && geminiResponse.extractedData) {
            extractedData = geminiResponse.extractedData;
        } else if (geminiResponse) {
            extractedData = geminiResponse;
        }
        
        const profile = extractedData.profile || {};
        const engagement = extractedData.engagement || {};
        
        console.log('🔍 Extracted data structure check:');
        console.log(`   - Has profile object: ${!!profile}`);
        console.log(`   - Profile name: ${profile.name || 'Not found'}`);
        console.log(`   - Experience count: ${extractedData.experience?.length || 0}`);
        console.log(`   - Education count: ${extractedData.education?.length || 0}`);
        
        const processedProfile = {
            linkedinUrl: profileUrl || extractedData.linkedinUrl || extractedData.url || '',
            url: profileUrl || extractedData.url || extractedData.linkedinUrl || '',
            
            fullName: profile.name || profile.fullName || '',
            firstName: profile.firstName || (profile.name ? profile.name.split(' ')[0] : ''),
            lastName: profile.lastName || (profile.name ? profile.name.split(' ').slice(1).join(' ') : ''),
            headline: profile.headline || '',
            currentRole: profile.currentRole || '',
            about: profile.about || '',
            location: profile.location || '',
            currentCompany: profile.currentCompany || '',
            currentCompanyName: profile.currentCompany || '',
            
            connectionsCount: parseInt(profile.connectionsCount || profile.connections || 0),
            followersCount: parseInt(profile.followersCount || profile.followers || 0),
            totalLikes: parseInt(engagement.totalLikes || 0),
            totalComments: parseInt(engagement.totalComments || 0),
            totalShares: parseInt(engagement.totalShares || 0),
            averageLikes: parseFloat(engagement.averageLikes || 0),
            
            experience: Array.isArray(extractedData.experience) ? extractedData.experience : [],
            education: Array.isArray(extractedData.education) ? extractedData.education : [],
            skills: Array.isArray(extractedData.skills) ? extractedData.skills : [],
            certifications: Array.isArray(extractedData.certifications) ? extractedData.certifications : [],
            awards: Array.isArray(extractedData.awards) ? extractedData.awards : [],
            volunteer: Array.isArray(extractedData.volunteer) ? extractedData.volunteer : [],
            following: Array.isArray(extractedData.following) ? extractedData.following : [],
            activity: Array.isArray(extractedData.activity) ? extractedData.activity : [],
            
            engagementData: engagement || {},
            timestamp: new Date().toISOString(),
            dataSource: 'gemini_processing',
            hasExperience: Array.isArray(extractedData.experience) && extractedData.experience.length > 0
        };
        
        console.log('✅ Gemini data processed successfully');
        console.log(`📊 Processed data summary:`);
        console.log(`   - Full Name: ${processedProfile.fullName || 'Not available'}`);
        console.log(`   - Experience entries: ${processedProfile.experience.length}`);
        console.log(`   - Education entries: ${processedProfile.education.length}`);
        console.log(`   - Has Experience: ${processedProfile.hasExperience}`);
        
        return processedProfile;
        
    } catch (error) {
        console.error('❌ Error processing Gemini data:', error);
        
        return {
            linkedinUrl: profileUrl || '',
            url: profileUrl || '',
            fullName: '',
            headline: '',
            currentRole: '',
            about: '',
            location: '',
            currentCompany: '',
            connectionsCount: 0,
            followersCount: 0,
            experience: [],
            education: [],
            skills: [],
            certifications: [],
            awards: [],
            volunteer: [],
            following: [],
            activity: [],
            engagementData: {},
            timestamp: new Date().toISOString(),
            dataSource: 'gemini_processing_error',
            hasExperience: false
        };
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// What changed in Stage G — OpenAI API key for fallback
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Validate required environment variables for Stage G
if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is required');
    process.exit(1);
}

if (!OPENAI_API_KEY) {
    console.warn('⚠️ OPENAI_API_KEY not set - OpenAI fallback will not work');
}

// ✅ Initialize authentication middleware
initAuthMiddleware({ getUserById });

// 🔧 DUAL AUTHENTICATION HELPER FUNCTION
const authenticateDual = async (req, res, next) => {
    // First try JWT authentication
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await getUserById(decoded.userId);
            if (user) {
                req.user = user;
                req.authMethod = 'jwt';
                return next();
            }
        } catch (jwtError) {
            console.log('JWT auth failed, trying session:', jwtError.message);
        }
    }
    
    // Then try session authentication
    if (req.isAuthenticated && req.isAuthenticated()) {
        req.authMethod = 'session';
        return next();
    }
    
    // If both fail, return 401
    return res.status(401).json({
        success: false,
        error: 'Please log in to access your profile'
    });
};

// ✅ Initialize routes with dependencies
const userRoutes = initUserRoutes({
    pool,
    authenticateToken,
    getUserByEmail,
    getUserById,
    createUser,
    createOrUpdateUserProfile,
    getSetupStatusMessage
});

// ✅ Initialize profile routes with orchestrator dependencies
const profileRoutes = initProfileRoutes({
    pool,
    authenticateToken,
    getUserById,
    processGeminiData,
    processScrapedProfileData,
    cleanLinkedInUrl,
    getStatusMessage,
    sendToGemini,
    // Stage G additions
    toIntSafe,
    toFloatSafe
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

// ✅ MIDDLEWARE SETUP
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
        let isNewUser = false;
        
        if (!user) {
            user = await createGoogleUser(
                profile.emails[0].value,
                profile.displayName,
                profile.id,
                profile.photos[0]?.value
            );
            isNewUser = true;
        } else if (!user.google_id) {
            await linkGoogleAccount(user.id, profile.id);
            user = await getUserById(user.id);
        }
        
        user.isNewUser = isNewUser;
        
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

// ✅ Mount routes
app.use('/', staticRoutes);
app.use('/', healthRoutes);
app.use('/', userRoutes);
app.use('/', profileRoutes);

// ==================== CHROME EXTENSION AUTH ENDPOINT ====================

app.post('/auth/chrome-extension', async (req, res) => {
    console.log('🔐 Chrome Extension Auth Request:', {
        hasGoogleToken: !!req.body.googleAccessToken,
        clientType: req.body.clientType,
        extensionId: req.body.extensionId
    });
    
    try {
        const { googleAccessToken, clientType, extensionId } = req.body;
        
        if (!googleAccessToken) {
            return res.status(400).json({
                success: false,
                error: 'Google access token is required'
            });
        }
        
        if (clientType !== 'chrome_extension') {
            return res.status(400).json({
                success: false,
                error: 'Invalid client type'
            });
        }
        
        // Verify Google token and get user info
        console.log('🔍 Verifying Google token...');
        const googleResponse = await axios.get(
            `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${googleAccessToken}`
        );
        
        if (!googleResponse.data || !googleResponse.data.email) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Google token'
            });
        }
        
        const googleUser = googleResponse.data;
        console.log('✅ Google user verified:', {
            email: googleUser.email,
            name: googleUser.name,
            verified: googleUser.verified_email
        });
        
        // Find or create user
        let user = await getUserByEmail(googleUser.email);
        let isNewUser = false;
        
        if (!user) {
            console.log('👤 Creating new user...');
            user = await createGoogleUser(
                googleUser.email,
                googleUser.name,
                googleUser.id,
                googleUser.picture
            );
            isNewUser = true;
        } else if (!user.google_id) {
            console.log('🔗 Linking Google account to existing user...');
            await linkGoogleAccount(user.id, googleUser.id);
            user = await getUserById(user.id);
        }
        
        user.isNewUser = isNewUser;
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log('✅ Chrome extension authentication successful');
        
        res.json({
            success: true,
            message: 'Authentication successful',
            data: {
                token: token,
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    packageType: user.package_type,
                    credits: user.credits_remaining || 10,
                    linkedinUrl: user.linkedin_url,
                    registrationCompleted: user.registration_completed
                },
                isNewUser: isNewUser
            }
        });
        
    } catch (error) {
        console.error('❌ Chrome extension auth error:', error);
        
        if (error.response && error.response.status === 401) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Google token'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Authentication failed',
            details: error.message
        });
    }
});

// ==================== TARGET PROFILE HANDLER WITH ORCHESTRATOR ====================

const handleAnalyzeTarget = async (req, res) => {
    try {
        console.log('🎯 Target profile analysis request received (Stage G with orchestrator)');
        console.log(`👤 User ID: ${req.user.id}`);
        
        const { html, profileUrl, normalizedUrl } = req.body;
        const userId = req.user.id;
        
        if (!html || !profileUrl) {
            return res.status(400).json({
                success: false,
                error: 'HTML content and profileUrl are required'
            });
        }
        
        // A.1 Normalize URL (server)
        const normalizedUrlFinal = normalizeLinkedInUrl(normalizedUrl || profileUrl);
        console.log(`🔗 Original URL: ${profileUrl}`);
        console.log(`🔗 Normalized URL: ${normalizedUrlFinal}`);
        
        // A.2 Dedupe before heavy work
        const { rows: existing } = await pool.query(
            'SELECT id FROM target_profiles WHERE user_id = $1 AND linkedin_url = $2 LIMIT 1',
            [userId, profileUrl]
        );
        
        if (existing.length) {
            console.log(`⚠️ Target already exists for user ${userId} + URL ${profileUrl}`);
            return res.status(200).json({
                success: true,
                alreadyExists: true,
                message: 'Target already exists for this user+URL'
            });
        }
        
        console.log('✅ Target is new, processing with LLM orchestrator...');
        
        // A.3 Process new target with orchestrator
        const { processProfileWithLLM } = require('./utils/llmOrchestrator');
        
        console.log('🤖 Calling LLM orchestrator for target profile analysis...');
        const result = await processProfileWithLLM({ 
            html: html, 
            url: profileUrl, 
            isUserProfile: false 
        });
        
        if (!result || !result.success) {
            console.error('❌ LLM orchestrator processing failed:', result?.error);
            return res.status(200).json({ 
                success: false, 
                userMessage: result?.userMessage || 'Failed to process profile',
                transient: result?.transient || false
            });
        }
        
        const parsedJson = result.data;
        const usage = result.usage || { 
            input_tokens: 0, 
            output_tokens: 0, 
            total_tokens: 0, 
            model: result.model || 'unknown'
        };
        
        console.log('✅ LLM orchestrator processing completed');
        console.log(`📊 Provider: ${result.provider}, Model: ${result.model}`);
        console.log(`📊 Token usage: ${usage.total_tokens} total (${usage.input_tokens} input, ${usage.output_tokens} output)`);
        
        // Stage G: Apply numeric sanitization
        const p = parsedJson; // final JSON from orchestrator
        const numeric = {
            followers_count: toIntSafe(p?.profile?.followersCount),
            connections_count: toIntSafe(p?.profile?.connectionsCount),
            total_likes: toIntSafe(p?.engagement?.totalLikes),
            total_comments: toIntSafe(p?.engagement?.totalComments),
            total_shares: toIntSafe(p?.engagement?.totalShares),
            average_likes: toFloatSafe(p?.engagement?.averageLikes)
        };
        
        console.log('[DB-INSERT] numeric sanitized for target:', numeric);
        
        // Light validation (no new libs)
        const missing = [];
        if (!parsedJson?.profile?.name) missing.push('profile.name');
        if (!Array.isArray(parsedJson?.experience)) missing.push('experience');
        if (!Array.isArray(parsedJson?.education)) missing.push('education');
        const mappingStatus = missing.length ? 'missing_fields' : 'ok';
        
        console.log(`🔍 Validation result: ${mappingStatus}`);
        if (missing.length > 0) {
            console.log(`⚠️ Missing fields: ${missing.join(', ')}`);
        }
        
        // Insert to target_profiles (JSON-FIRST with orchestrator data)
        console.log('💾 Inserting target profile into database (JSON-first with orchestrator)...');
        
        const sql = `
        INSERT INTO target_profiles
        (user_id, linkedin_url, url, full_name, first_name, last_name, headline, "current_role",
         about, location, current_company, current_company_name, 
         connections_count, followers_count, total_likes, total_comments, total_shares, average_likes,
         experience, education, skills, certifications, awards, volunteer_experience, activity, engagement_data,
         data_json, ai_provider, ai_model, gemini_input_tokens, gemini_output_tokens, gemini_total_tokens,
         created_at, updated_at)
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, now(), now())
        RETURNING id
        `;

        const params = [
            userId,
            profileUrl,
            profileUrl,
            parsedJson?.profile?.name || '',
            parsedJson?.profile?.firstName || '',
            parsedJson?.profile?.lastName || '',
            parsedJson?.profile?.headline || '',
            parsedJson?.profile?.currentRole || '',
            parsedJson?.profile?.about || '',
            parsedJson?.profile?.location || '',
            parsedJson?.profile?.currentCompany || '',
            parsedJson?.profile?.currentCompany || '',
            numeric.connections_count,
            numeric.followers_count,
            numeric.total_likes,
            numeric.total_comments,
            numeric.total_shares,
            numeric.average_likes,
            JSON.stringify(parsedJson?.experience || []),
            JSON.stringify(parsedJson?.education || []),
            JSON.stringify(parsedJson?.skills || []),
            JSON.stringify(parsedJson?.certifications || []),
            JSON.stringify(parsedJson?.awards || []),
            JSON.stringify(parsedJson?.volunteer || []),
            JSON.stringify(parsedJson?.activity || []),
            JSON.stringify(parsedJson?.engagement || {}),
            JSON.stringify(parsedJson),  // Full orchestrator JSON
            result.provider || 'unknown',
            result.model || 'unknown',
            usage.input_tokens || 0,
            usage.output_tokens || 0,
            usage.total_tokens || 0
        ];

        let inserted;
        try {
            const { rows } = await pool.query(sql, params);
            inserted = rows[0];
            console.log(`✅ Target profile inserted with ID: ${inserted.id} (LLM orchestrator: ${result.provider}/${result.model})`);
        } catch (e) {
            // Handle unique violation due to race (Postgres code 23505)
            if (e && e.code === '23505') {
                console.log('⚠️ Race condition detected - target already exists');
                return res.status(200).json({ 
                    success: true, 
                    alreadyExists: true, 
                    message: 'Target already exists' 
                });
            }
            console.error('❌ Database insertion failed:', e);
            throw e;
        }
        
        // A.4 Response (Stage G extended)
        console.log('📤 Returning extended response with orchestrator data...');
        
        return res.status(200).json({
            success: true,
            data: parsedJson,
            orchestrator: {
                provider: result.provider,
                model: result.model,
                token_usage: {
                    input_tokens: usage.input_tokens || 0,
                    output_tokens: usage.output_tokens || 0,
                    total_tokens: usage.total_tokens || 0
                }
            },
            sanitization: {
                followersCount: numeric.followers_count,
                connectionsCount: numeric.connections_count,
                totalLikes: numeric.total_likes,
                totalComments: numeric.total_comments,
                totalShares: numeric.total_shares,
                averageLikes: numeric.average_likes
            },
            mapping: {
                schema_version: 'v1',
                valid: mappingStatus === 'ok',
                missing_fields: missing,
                extra_fields: []
            },
            alreadyExists: false
        });
        
    } catch (error) {
        console.error('❌ Target profile analysis error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Target profile analysis failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// What changed in Stage G — route with orchestrator support
console.log('Routes mounted: POST /scrape-html (orchestrator) | POST /profile/target (orchestrator)');
app.post('/scrape-html', authenticateToken, handleAnalyzeTarget);
app.post('/profile/target', authenticateToken, handleAnalyzeTarget);

// ==================== SESSION-DEPENDENT ROUTES ====================

// ✅ Google OAuth Routes
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
    passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
    async (req, res) => {
        try {
            const token = jwt.sign(
                { userId: req.user.id, email: req.user.email },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            req.session.selectedPackage = null;
            req.session.billingModel = null;
            
            const needsOnboarding = req.user.isNewUser || 
                                   !req.user.linkedin_url || 
                                   !req.user.registration_completed ||
                                   req.user.extraction_status === 'not_started';
            
            console.log(`🔍 OAuth callback - User: ${req.user.email}`);
            console.log(`   - Needs onboarding: ${needsOnboarding}`);
            
            if (needsOnboarding) {
                console.log(`➡️ Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
                console.log(`➡️ Redirecting to dashboard`);
                res.redirect(`/dashboard?token=${token}`);
            }
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            res.redirect(`/login?error=callback_error`);
        }
    }
);

app.get('/auth/failed', (req, res) => {
    res.redirect(`/login?error=auth_failed`);
});

// 🚦 TRAFFIC LIGHT STATUS ENDPOINT
app.get('/traffic-light-status', authenticateDual, async (req, res) => {
    try {
        console.log(`🚦 Traffic light status request from user ${req.user.id} using ${req.authMethod} auth`);

        const profileResult = await pool.query(`
            SELECT 
                u.registration_completed,
                u.linkedin_url,
                up.initial_scraping_done,
                up.data_extraction_status,
                up.profile_analyzed,
                up.extraction_completed_at,
                up.experience,
                up.full_name,
                up.headline,
                up.current_company,
                up.current_company_name
            FROM users u 
            LEFT JOIN user_profiles up ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        const data = profileResult.rows[0];
        
        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'User profile not found'
            });
        }

        const isRegistrationComplete = data.registration_completed || false;
        const isInitialScrapingDone = data.initial_scraping_done || false;
        const extractionStatus = data.data_extraction_status || 'pending';
        const hasExperience = data.experience && Array.isArray(data.experience) && data.experience.length > 0;

        let trafficLightStatus;
        let statusMessage;
        let actionRequired;

        if (isRegistrationComplete && isInitialScrapingDone && extractionStatus === 'completed' && hasExperience) {
            trafficLightStatus = 'GREEN';
            statusMessage = 'Profile fully synced and ready! You can now use all features.';
            actionRequired = null;
        } else if (isRegistrationComplete && isInitialScrapingDone) {
            trafficLightStatus = 'ORANGE';
            statusMessage = 'We\'re analyzing your profile data. This usually takes a few minutes.';
            actionRequired = 'WAIT_FOR_ANALYSIS';
        } else if (isRegistrationComplete) {
            trafficLightStatus = 'RED';
            statusMessage = 'Please visit your own LinkedIn profile with the Msgly.AI Chrome extension installed and active.';
            actionRequired = 'VISIT_LINKEDIN_PROFILE';
        } else {
            trafficLightStatus = 'RED';
            statusMessage = 'Please complete your registration by providing your LinkedIn URL.';
            actionRequired = 'COMPLETE_REGISTRATION';
        }

        console.log(`🚦 User ${req.user.id} Traffic Light Status: ${trafficLightStatus}`);

        res.json({
            success: true,
            data: {
                trafficLightStatus: trafficLightStatus,
                statusMessage: statusMessage,
                actionRequired: actionRequired,
                details: {
                    registrationCompleted: isRegistrationComplete,
                    initialScrapingDone: isInitialScrapingDone,
                    extractionStatus: extractionStatus,
                    hasExperience: hasExperience,
                    experienceCount: hasExperience ? data.experience.length : 0,
                    profileAnalyzed: data.profile_analyzed || false,
                    extractionCompletedAt: data.extraction_completed_at,
                    hasLinkedInUrl: !!data.linkedin_url,
                    hasBasicProfile: !!(data.full_name && data.headline),
                    hasCompanyInfo: !!(data.current_company || data.current_company_name)
                },
                debugInfo: {
                    userId: req.user.id,
                    authMethod: req.authMethod,
                    timestamp: new Date().toISOString()
                }
            }
        });

    } catch (error) {
        console.error('❌ Traffic light status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check traffic light status'
        });
    }
});

// ✅ Get User Profile
app.get('/profile', authenticateDual, async (req, res) => {
    try {
        console.log(`🔍 Profile request from user ${req.user.id} using ${req.authMethod} auth`);

        const profileResult = await pool.query(`
            SELECT 
                up.*,
                u.extraction_status as user_extraction_status,
                u.registration_completed as user_registration_completed
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
                isCurrentlyProcessing: false,
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
                    registrationCompleted: req.user.registration_completed,
                    authMethod: req.authMethod
                },
                profile: profile && profile.user_id ? {
                    linkedinUrl: profile.linkedin_url,
                    fullName: profile.full_name,
                    headline: profile.headline,
                    currentRole: profile.current_role,
                    currentCompany: profile.current_company,
                    location: profile.location,
                    connectionsCount: profile.connections_count,
                    followersCount: profile.followers_count,
                    totalLikes: profile.total_likes,
                    totalComments: profile.total_comments,
                    totalShares: profile.total_shares,
                    averageLikes: profile.average_likes,
                    experience: profile.experience,
                    education: profile.education,
                    skills: profile.skills,
                    certifications: profile.certifications,
                    awards: profile.awards,
                    activity: profile.activity,
                    extractionStatus: profile.data_extraction_status,
                    initialScrapingDone: profile.initial_scraping_done,
                    extractionCompleted: profile.extraction_completed_at,
                    profileAnalyzed: profile.profile_analyzed,
                    aiProvider: profile.ai_provider,
                    aiModel: profile.ai_model
                } : null,
                syncStatus: syncStatus
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

// ✅ Check profile extraction status
app.get('/profile-status', authenticateDual, async (req, res) => {
    try {
        console.log(`🔍 Profile status request from user ${req.user.id} using ${req.authMethod} auth`);

        const userQuery = `
            SELECT 
                u.extraction_status,
                u.error_message,
                u.registration_completed,
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
            registration_completed: status.registration_completed,
            linkedin_url: status.linkedin_url,
            error_message: status.error_message,
            data_extraction_status: status.data_extraction_status,
            extraction_completed_at: status.extraction_completed_at,
            extraction_retry_count: status.extraction_retry_count,
            extraction_error: status.extraction_error,
            initial_scraping_done: status.initial_scraping_done || false,
            is_currently_processing: false,
            processing_mode: 'LLM_ORCHESTRATOR_STAGE_G',
            message: getStatusMessage(status.extraction_status, status.initial_scraping_done)
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// ==================== REMAINING API ENDPOINTS ====================

// Get Available Packages
app.get('/packages', (req, res) => {
    const packages = {
        payAsYouGo: [
            {
                id: 'free',
                name: 'Free',
                credits: 7,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'LLM orchestrator (Gemini + OpenAI fallback)', 'Numeric sanitization', 'Comprehensive LinkedIn extraction', 'Beautiful dashboard', 'No credit card required'],
                available: true
            }
        ],
        monthly: [
            {
                id: 'free',
                name: 'Free',
                credits: 7,
                price: 0,
                period: '/forever',
                billing: 'monthly',
                validity: '10 free profiles forever',
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'LLM orchestrator (Gemini + OpenAI fallback)', 'Numeric sanitization', 'Comprehensive LinkedIn extraction', 'Beautiful dashboard', 'No credit card required'],
                available: true
            }
        ]
    };
    
    res.json({
        success: true,
        data: { packages }
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled Error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.path,
        method: req.method
    });
});

// ==================== SERVER STARTUP ====================

const startServer = async () => {
    try {
        validateEnvironment();
        
        const dbOk = await testDatabase();
        if (!dbOk) {
            console.error('❌ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Msgly.AI Server - STAGE G COMPLETE!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Enhanced PostgreSQL with numeric sanitization`);
            console.log(`🔐 Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`🤖 STAGE G LLM ORCHESTRATOR:`);
            console.log(`   🥇 Primary: Gemini 1.5 Flash`);
            console.log(`   🥈 Fallback #1: GPT-5 nano`);
            console.log(`   🥉 Fallback #2: GPT-5 mini`);
            console.log(`   ✅ Transient error handling with structured failures`);
            console.log(`   ✅ Validity checks (Tier-1 data: profile.name + experience/education)`);
            console.log(`🔢 NUMERIC SANITIZATION:`);
            console.log(`   ✅ "16,706" → 16706, "500+" → 500, "1.6K" → 1600, "2M" → 2000000`);
            console.log(`   ✅ Invalid values → NULL before DB insert`);
            console.log(`   ✅ Applied to User Profile and Target Profile flows`);
            console.log(`💾 JSON-FIRST STORAGE:`);
            console.log(`   ✅ Full AI output saved to data_json + token usage + provider/model`);
            console.log(`   ✅ Sanitized numeric columns (if they exist) for queries`);
            console.log(`   ✅ Artifacts and metadata preserved`);
            console.log(`🔧 MINIMAL CHANGES:`);
            console.log(`   ✅ No new libraries added`);
            console.log(`   ✅ Existing endpoints preserved`);
            console.log(`   ✅ Auth and scraping style unchanged`);
            console.log(`   ✅ Extension compatibility maintained`);
            console.log(`✅ STAGE G READY FOR PRODUCTION!`);
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
