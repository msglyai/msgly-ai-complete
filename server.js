// What changed in Stage G
// Added numeric sanitization helpers + wired llmOrchestrator + processProfileWithLLM integration
// Msgly.AI Server - Complete with Traffic Light System Integrated

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

// âœ… FIXED: Import sendToGemini from correct path (project root)
const { sendToGemini } = require('./sendToGemini');
require('dotenv').config();

// âœ… FEATURE FLAG: Disable Target processing
const ENABLE_TARGET = false; // Set to false to quarantine Target routes

// âœ… STEP 2A: Import all database functions from utils/database.js
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
    processScrapedProfileData,
    processGeminiData  // âœ… Import processGeminiData for User processing
} = require('./utils/database');

// âœ… STAGE G: Import LLM orchestrator
const { processProfileWithLLM } = require('./utils/llmOrchestrator');

// âœ… STEP 2B: Import all utility functions from utils/helpers.js
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

// âœ… STEP 2D: Import authentication middleware
const {
    initAuthMiddleware,
    authenticateToken,
    requireFeatureAccess,
    requireAdmin
} = require('./middleware/auth');

// âœ… STEP 2E: Import user routes initialization function
const { initUserRoutes } = require('./routes/users');

// âœ… STEP 2F: Import JWT-only profile & API routes initialization function
const { initProfileRoutes } = require('./routes/profiles');

// âœ… STEP 2C: Import modularized routes
const healthRoutes = require('./routes/health')(pool);
const staticRoutes = require('./routes/static');

// What changed in Stage G â€“ numeric sanitizers
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

// What changed in Stage G
function normalizeLinkedInUrl(url = '') {
  try {
    return url.toString().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/$/, '');
  } catch { return ''; }
}

// âœ… USER PROFILE HANDLER: Restored exact User flow that was working before
async function handleUserProfile(req, res) {
    try {
        console.log('ðŸ”µ === USER PROFILE PROCESSING ===');
        console.log(`ðŸ‘¤ User ID: ${req.user.id}`);
        console.log(`ðŸ”— URL: ${req.body.profileUrl}`);
        
        const { html, profileUrl } = req.body;
        const userId = req.user.id;
        
        if (!html || !profileUrl) {
            return res.status(400).json({
                success: false,
                error: 'HTML content and profileUrl are required for user profile processing'
            });
        }
        
        // Clean and validate LinkedIn URL
        const cleanProfileUrl = cleanLinkedInUrl(profileUrl);
        
        console.log('ðŸ¤– Processing HTML with Gemini for USER profile...');
        
        // Process HTML with Gemini
        const geminiResult = await sendToGemini({
            html: html,
            url: cleanProfileUrl,
            isUserProfile: true
        });
        
        if (!geminiResult.success) {
            console.error('âŒ Gemini processing failed for USER profile:', geminiResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process profile data with Gemini'
            });
        }
        
        console.log('âœ… Gemini processing successful for USER profile');
        
        // Process Gemini data for USER profile
        const processedProfile = processGeminiData(geminiResult, cleanProfileUrl);
        
        // Save to user_profiles table only
        const savedProfile = await createOrUpdateUserProfile(userId, cleanProfileUrl, processedProfile.fullName);
        
        // Update user_profiles with processed data (âœ… FIXED: Escape current_role reserved word)
        await pool.query(`
            UPDATE user_profiles SET 
                full_name = $1,
                headline = $2,
                "current_role" = $3,
                about = $4,
                location = $5,
                current_company = $6,
                connections_count = $7,
                followers_count = $8,
                experience = $9,
                education = $10,
                skills = $11,
                certifications = $12,
                awards = $13,
                volunteer_experience = $14,
                activity = $15,
                engagement_data = $16,
                data_extraction_status = 'completed',
                initial_scraping_done = true,
                profile_analyzed = true,
                extraction_completed_at = NOW(),
                updated_at = NOW()
            WHERE user_id = $17
        `, [
            processedProfile.fullName,
            processedProfile.headline,
            processedProfile.currentRole,
            processedProfile.about,
            processedProfile.location,
            processedProfile.currentCompany,
            processedProfile.connectionsCount,
            processedProfile.followersCount,
            JSON.stringify(processedProfile.experience),
            JSON.stringify(processedProfile.education),
            JSON.stringify(processedProfile.skills),
            JSON.stringify(processedProfile.certifications),
            JSON.stringify(processedProfile.awards),
            JSON.stringify(processedProfile.volunteerExperience),
            JSON.stringify(processedProfile.activity),
            JSON.stringify(processedProfile.engagementData),
            userId
        ]);
        
        console.log('âœ… USER profile saved to user_profiles table successfully');
        
        res.json({
            success: true,
            message: 'User profile processed and saved successfully',
            data: {
                fullName: processedProfile.fullName,
                headline: processedProfile.headline,
                currentRole: processedProfile.currentRole,
                experienceCount: processedProfile.experience?.length || 0,
                educationCount: processedProfile.education?.length || 0,
                hasExperience: processedProfile.hasExperience
            }
        });
        
    } catch (error) {
        console.error('âŒ USER profile processing error:', error);
        
        res.status(500).json({
            success: false,
            error: 'User profile processing failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// âœ… TARGET PROFILE HANDLER: Updated with UPSERT pattern and no credit charging
async function handleAnalyzeTarget(req, res) {
    try {
        console.log('ðŸŽ¯ Target profile analysis request received');
        console.log(`ðŸ‘¤ User ID: ${req.user.id}`);
        
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
        console.log(`ðŸ”— Original URL: ${profileUrl}`);
        console.log(`ðŸ”— Normalized URL: ${normalizedUrlFinal}`);
        
        // A.2 Dedupe before heavy work
        const { rows: existing } = await pool.query(
            'SELECT id FROM target_profiles WHERE user_id = $1 AND normalized_url = $2 LIMIT 1',
            [userId, normalizedUrlFinal]
        );
        
        if (existing.length) {
            console.log(`âš ï¸ Target already exists for user ${userId} + URL ${normalizedUrlFinal}`);
            return res.status(200).json({
                success: true,
                alreadyExists: true,
                message: 'Target already exists for this user+URL'
            });
        }
        
        console.log('âœ… Target is new, processing...');
        
        // Process HTML with Gemini for TARGET profile
        console.log('ðŸ¤– Processing HTML with Gemini for TARGET profile...');
        
        const geminiResult = await sendToGemini({
            html: html,
            url: profileUrl,
            isUserProfile: false
        });
        
        if (!geminiResult.success) {
            console.error('âŒ Gemini processing failed for TARGET profile:', geminiResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process profile data with Gemini'
            });
        }
        
        console.log('âœ… Gemini processing successful for TARGET profile');
        
        // Process Gemini data for TARGET profile
        const processedProfile = processGeminiData(geminiResult, profileUrl);
        
        // âœ… NEW: UPSERT pattern with column count guard
        console.log('ðŸ’¾ Inserting/updating target profile using UPSERT pattern...');
        
        // âœ… NEW: Pre-query guard for column count mismatch
        const expectedColumns = [
            'user_id', 'normalized_url', 'data_json', 'raw_html', 'token_usage', 
            'artifacts', 'updated_at'
        ];
        const values = [
            userId,
            normalizedUrlFinal, 
            processedProfile,
            html,
            geminiResult.metadata?.tokenUsage || {},
            {},
            new Date()
        ];
        
        if (expectedColumns.length !== values.length) {
            console.error('âŒ Column count mismatch!');
            console.error(`Expected columns (${expectedColumns.length}):`, expectedColumns);
            console.error(`Provided values (${values.length}):`, values.map((v, i) => `${i}: ${typeof v}`));
            return res.status(500).json({
                success: false,
                error: `Column count mismatch: expected ${expectedColumns.length}, got ${values.length}`,
                details: 'INSERT has more target columns than expressions'
            });
        }
        
        // âœ… NEW: UPSERT with conflict resolution
        const upsertQuery = `
            INSERT INTO target_profiles ( 
                user_id, normalized_url, data_json, raw_html, token_usage, artifacts, updated_at 
            ) VALUES ( 
                $1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, NOW() 
            ) 
            ON CONFLICT (user_id, normalized_url) 
            DO UPDATE SET 
                data_json = EXCLUDED.data_json, 
                raw_html = EXCLUDED.raw_html, 
                token_usage = EXCLUDED.token_usage, 
                artifacts = EXCLUDED.artifacts, 
                updated_at = NOW()
        `;
        
        let inserted;
        try {
            const { rows } = await pool.query(upsertQuery, [
                userId,
                normalizedUrlFinal,
                JSON.stringify(processedProfile),
                html,
                JSON.stringify(geminiResult.metadata?.tokenUsage || {}),
                JSON.stringify({})
            ]);
            
            console.log(`âœ… Target profile upserted successfully for user ${userId}`);
            
        } catch (e) {
            console.error('âŒ Database upsert failed:', e);
            throw e;
        }
        
        // A.4 Response (no credit charging)
        console.log('ðŸ“¤ Returning success response...');
        
        return res.status(200).json({
            success: true,
            data: processedProfile,
            storage: {
                raw_html_saved: true,
                parsed_json_saved: true
            },
            processing: {
                provider: 'gemini',
                model: 'gemini-pro',
                token_usage: geminiResult.metadata?.tokenUsage || {}
            },
            alreadyExists: false,
            message: 'Target profile analyzed successfully - no credits charged'
        });
        
    } catch (error) {
        console.error('âŒ Target profile analysis error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Target profile analysis failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// âœ… STEP 2D: Initialize authentication middleware with database functions
initAuthMiddleware({ getUserById });

// ðŸ”§ DUAL AUTHENTICATION HELPER FUNCTION
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

// âœ… STEP 2E: Initialize user routes with dependencies and get router
const userRoutes = initUserRoutes({
    pool,
    authenticateToken,
    getUserByEmail,
    getUserById,
    createUser,
    createOrUpdateUserProfile,
    getSetupStatusMessage
});

// âœ… STEP 2F: Initialize JWT-only profile & API routes with dependencies + STAGE G orchestrator
const profileRoutes = initProfileRoutes({
    pool,
    authenticateToken,
    getUserById,
    processGeminiData,
    processScrapedProfileData,
    cleanLinkedInUrl,
    getStatusMessage,
    sendToGemini,
    // âœ… STAGE G: Add orchestrator and numeric helpers
    processProfileWithLLM,
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

// âœ… MIDDLEWARE SETUP - PROPERLY POSITIONED
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

// âœ… STEP 2C: Mount static routes FIRST (before other routes)
app.use('/', staticRoutes);

// âœ… MODULARIZATION: Mount health routes
app.use('/', healthRoutes);

// âœ… STEP 2E: Mount user routes
app.use('/', userRoutes);

// âœ… STEP 2F: Mount JWT-only profile & API routes with STAGE G orchestrator
app.use('/', profileRoutes);

// ==================== CHROME EXTENSION AUTH ENDPOINT ====================

app.post('/auth/chrome-extension', async (req, res) => {
    console.log('ðŸ” Chrome Extension Auth Request:', {
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
        console.log('ðŸ” Verifying Google token...');
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
        console.log('âœ… Google user verified:', {
            email: googleUser.email,
            name: googleUser.name,
            verified: googleUser.verified_email
        });
        
        // Find or create user
        let user = await getUserByEmail(googleUser.email);
        let isNewUser = false;
        
        if (!user) {
            console.log('ðŸ‘¤ Creating new user...');
            user = await createGoogleUser(
                googleUser.email,
                googleUser.name,
                googleUser.id,
                googleUser.picture
            );
            isNewUser = true;
        } else if (!user.google_id) {
            console.log('ðŸ”— Linking Google account to existing user...');
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
        
        console.log('âœ… Chrome extension authentication successful');
        
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
        console.error('âŒ Chrome extension auth error:', error);
        
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

// ==================== FIXED /scrape-html ROUTE WITH PROPER ROUTING ====================

// âœ… REQUIRED LOGGING AND ROUTING: Lock /scrape-html to User handler
app.post('/scrape-html', authenticateToken, (req, res) => {
    // âœ… REQUIRED LOGGING: Route entry
    console.log('ðŸ” route=/scrape-html');
    console.log(`ðŸ” isUserProfile=${req.body.isUserProfile}`);
    
    // âœ… HARD GUARD: Check isUserProfile at the very top
    if (req.body.isUserProfile === true) {
        console.log('ðŸ” selectedHandler=USER');
        console.log('ðŸ”µ USER handler start');
        console.log(`ðŸ” userId=${req.user.id}`);
        console.log(`ðŸ” truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        // Route to User handler
        return handleUserProfile(req, res);
    } else {
        console.log('ðŸ” selectedHandler=TARGET');
        console.log('ðŸŽ¯ TARGET handler start');
        console.log(`ðŸ” userId=${req.user.id}`);
        console.log(`ðŸ” truncated linkedinUrl=${req.body.profileUrl?.substring(0, 50)}...`);
        
        // Route to Target handler
        return handleAnalyzeTarget(req, res);
    }
});

// ==================== SESSION-DEPENDENT ROUTES (STAY IN SERVER.JS) ====================

// âœ… KEPT IN SERVER: Google OAuth Routes (Session creation/management)
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
            
            console.log(`ðŸ” OAuth callback - User: ${req.user.email}`);
            console.log(`   - Is new user: ${req.user.isNewUser || false}`);
            console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
            console.log(`   - Registration completed: ${req.user.registration_completed || false}`);
            console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
            console.log(`   - Needs onboarding: ${needsOnboarding}`);
            
            if (needsOnboarding) {
                console.log(`âž¡ï¸ Redirecting to sign-up for onboarding`);
                res.redirect(`/sign-up?token=${token}`);
            } else {
                console.log(`âž¡ï¸ Redirecting to dashboard`);
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

// ðŸš¦ TRAFFIC LIGHT STATUS ENDPOINT - NEW ENDPOINT FOR DASHBOARD
app.get('/traffic-light-status', authenticateDual, async (req, res) => {
    try {
        console.log(`ðŸš¦ Traffic light status request from user ${req.user.id} using ${req.authMethod} auth`);

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

        // ðŸš¦ DETERMINE TRAFFIC LIGHT STATUS
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

        console.log(`ðŸš¦ User ${req.user.id} Traffic Light Status: ${trafficLightStatus}`);
        console.log(`   - Registration Complete: ${isRegistrationComplete}`);
        console.log(`   - Initial Scraping Done: ${isInitialScrapingDone}`);
        console.log(`   - Extraction Status: ${extractionStatus}`);
        console.log(`   - Has Experience: ${hasExperience}`);

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
        console.error('âŒ Traffic light status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check traffic light status'
        });
    }
});

// ðŸ”§ FIXED: Get User Profile - REMOVED DUPLICATE RESPONSE FIELDS
app.get('/profile', authenticateDual, async (req, res) => {
    try {
        console.log(`ðŸ” Profile request from user ${req.user.id} using ${req.authMethod} auth`);

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
                    linkedinId: profile.linkedin_id,
                    linkedinNumId: profile.linkedin_num_id,
                    inputUrl: profile.input_url,
                    url: profile.url,
                    fullName: profile.full_name,
                    firstName: profile.first_name,
                    lastName: profile.last_name,
                    headline: profile.headline,
                    currentRole: profile.current_role,
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
                    totalLikes: profile.total_likes,
                    totalComments: profile.total_comments,
                    totalShares: profile.total_shares,
                    averageLikes: profile.average_likes,
                    recommendationsCount: profile.recommendations_count,
                    publicIdentifier: profile.public_identifier,
                    experience: profile.experience,
                    education: profile.education,
                    skills: profile.skills,
                    skillsWithEndorsements: profile.skills_with_endorsements,
                    languages: profile.languages,
                    certifications: profile.certifications,
                    awards: profile.awards,
                    courses: profile.courses,
                    projects: profile.projects,
                    publications: profile.publications,
                    patents: profile.patents,
                    volunteerExperience: profile.volunteer_experience,
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
                    initialScrapingDone: profile.initial_scraping_done,
                    extractionAttempted: profile.extraction_attempted_at,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    extractionRetryCount: profile.extraction_retry_count,
                    profileAnalyzed: profile.profile_analyzed
                } : null,
                syncStatus: syncStatus
            }
        });
    } catch (error) {
        console.error('âŒ Enhanced profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// ðŸ”§ FIXED: Check profile extraction status - DUAL Authentication Support (Session OR JWT)
app.get('/profile-status', authenticateDual, async (req, res) => {
    try {
        console.log(`ðŸ” Profile status request from user ${req.user.id} using ${req.authMethod} auth`);

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
            processing_mode: 'ENHANCED_HTML_SCRAPING_WITH_LLM_ORCHESTRATOR',
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
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'LLM Orchestrator with fallback chain', 'Numeric sanitization', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 30,
                price: 17,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['30 Credits', 'Enhanced Chrome extension', 'LLM Orchestrator with Gemini + OpenAI fallback', 'Numeric sanitization', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 100,
                price: 39,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['100 Credits', 'Enhanced Chrome extension', 'LLM Orchestrator with Gemini + OpenAI fallback', 'Numeric sanitization', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 250,
                price: 78,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['250 Credits', 'Enhanced Chrome extension', 'LLM Orchestrator with Gemini + OpenAI fallback', 'Numeric sanitization', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
                available: false,
                comingSoon: true
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
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'LLM Orchestrator with fallback chain', 'Numeric sanitization', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'No credit card required'],
                available: true
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 30,
                price: 13.90,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['30 Credits', 'Enhanced Chrome extension', 'LLM Orchestrator with Gemini + OpenAI fallback', 'Numeric sanitization', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 100,
                price: 32,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['100 Credits', 'Enhanced Chrome extension', 'LLM Orchestrator with Gemini + OpenAI fallback', 'Numeric sanitization', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
                available: false,
                comingSoon: true
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 250,
                price: 63.87,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['250 Credits', 'Enhanced Chrome extension', 'LLM Orchestrator with Gemini + OpenAI fallback', 'Numeric sanitization', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
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

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('âŒ Unhandled Error:', error);
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
        method: req.method,
        availableRoutes: [
            'GET /',
            'GET /sign-up',
            'GET /login', 
            'GET /dashboard',
            'GET /health',
            'POST /register',
            'POST /login',
            'GET /auth/google',
            'GET /auth/google/callback',
            'POST /auth/chrome-extension',
            'POST /complete-registration',
            'POST /update-profile',
            'GET /profile',
            'GET /profile-status',
            'GET /traffic-light-status',
            'POST /profile/user',
            'POST /scrape-html (Target ingestion now behaves like User)',
            'GET /user/setup-status',
            'GET /user/initial-scraping-status',
            'GET /user/stats',
            'PUT /user/settings',
            'POST /generate-message',
            'GET /message-history',
            'GET /credits-history',
            'POST /retry-extraction',
            'GET /packages'
        ]
    });
});

// ==================== SERVER STARTUP ====================

const startServer = async () => {
    try {
        validateEnvironment();
        
        const dbOk = await testDatabase();
        if (!dbOk) {
            console.error('âŒ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('ðŸš€ Msgly.AI Server - TARGET INGESTION LIKE USER + "SEE MORE" EXPANSION!');
            console.log(`ðŸ” Port: ${PORT}`);
            console.log(`ðŸ—ƒï¸ Database: Enhanced PostgreSQL with UPSERT pattern`);
            console.log(`ðŸ” Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`ðŸš¦ TRAFFIC LIGHT SYSTEM ACTIVE`);
            console.log(`âœ… TARGET INGESTION IMPROVEMENTS:`);
            console.log(`   ðŸ”„ UPSERT pattern: ON CONFLICT (user_id, normalized_url) DO UPDATE`);
            console.log(`   ðŸ›¡ï¸ Column count guard prevents INSERT mismatch errors`);
            console.log(`   ðŸ’° No credit charging on Analyze`);
            console.log(`   ðŸ—„ï¸ Database schema changes via startup guard (no migrations)`);
            console.log(`âœ… "SEE MORE" EXPANSION:`);
            console.log(`   ðŸ“‹ Experience section: max 2 clicks with DOM change detection`);
            console.log(`   ðŸ† Honors & Awards section: max 2 clicks with DOM change detection`);
            console.log(`   â±ï¸ Randomized delays and proper waiting for content load`);
            console.log(`   ðŸ” Called before HTML capture in both User & Target flows`);
            console.log(`âœ… READY FOR PRODUCTION!`);
        });
        
    } catch (error) {
        console.error('âŒ Startup failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('ðŸ›‘ Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('ðŸ›‘ Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
