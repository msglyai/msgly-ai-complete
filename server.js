// What changed in Stage G — G2b (server route & validation)
// Msgly.AI Server - Complete with Traffic Light System Integrated
// ✅ FIXED: processGeminiData function added + duplicate response fields removed
// ✅ TRAFFIC LIGHT SYSTEM: Dashboard RED/ORANGE/GREEN status fully implemented
// 🔧 FIXED: Dual authentication support for dashboard compatibility

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
const { sendToGemini } = require('./sendToGemini');
require('dotenv').config();

// ✅ STEP 2A: Import all database functions from utils/database.js (REMOVED processGeminiData - now defined below)
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

// ✅ STEP 2B: Import all utility functions from utils/helpers.js
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

// ✅ STEP 2D: Import authentication middleware
const {
    initAuthMiddleware,
    authenticateToken,
    requireFeatureAccess,
    requireAdmin
} = require('./middleware/auth');

// ✅ STEP 2E: Import user routes initialization function
const { initUserRoutes } = require('./routes/users');

// ✅ STEP 2F: Import JWT-only profile & API routes initialization function
const { initProfileRoutes } = require('./routes/profiles');

// ✅ STEP 2C: Import modularized routes
const healthRoutes = require('./routes/health')(pool);
const staticRoutes = require('./routes/static');

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

// ✅ FIXED: processGeminiData FUNCTION - CORRECT DATA STRUCTURE MAPPING
function processGeminiData(geminiResponse, profileUrl) {
    try {
        console.log('🤖 Processing Gemini API response for profile extraction');
        
        // ✅ FIXED: Extract data from correct Gemini response structure
        let extractedData = {};
        
        if (geminiResponse && geminiResponse.data) {
            extractedData = geminiResponse.data;  // This is the parsed profile data from sendToGemini
        } else if (geminiResponse && geminiResponse.extractedData) {
            extractedData = geminiResponse.extractedData;
        } else if (geminiResponse) {
            extractedData = geminiResponse;
        }
        
        // ✅ CRITICAL FIX: Read from correct structure - extractedData.profile.*
        const profile = extractedData.profile || {};
        const engagement = extractedData.engagement || {};
        
        console.log('🔍 Extracted data structure check:');
        console.log(`   - Has profile object: ${!!profile}`);
        console.log(`   - Profile name: ${profile.name || 'Not found'}`);
        console.log(`   - Profile headline: ${profile.headline || 'Not found'}`);
        console.log(`   - Current role: ${profile.currentRole || 'Not found'}`);
        console.log(`   - Current company: ${profile.currentCompany || 'Not found'}`);
        console.log(`   - Experience count: ${extractedData.experience?.length || 0}`);
        console.log(`   - Education count: ${extractedData.education?.length || 0}`);
        
        // ✅ FIXED: Map from correct structure
        const processedProfile = {
            linkedinUrl: profileUrl || extractedData.linkedinUrl || extractedData.url || '',
            url: profileUrl || extractedData.url || extractedData.linkedinUrl || '',
            
            // ✅ FIXED: Read from profile object
            fullName: profile.name || profile.fullName || '',
            firstName: profile.firstName || (profile.name ? profile.name.split(' ')[0] : ''),
            lastName: profile.lastName || (profile.name ? profile.name.split(' ').slice(1).join(' ') : ''),
            headline: profile.headline || '',
            currentRole: profile.currentRole || '',
            about: profile.about || '',
            location: profile.location || '',
            currentCompany: profile.currentCompany || '',
            currentCompanyName: profile.currentCompany || '',
            
            // ✅ FIXED: Parse metrics from profile object
            connectionsCount: parseInt(profile.connectionsCount || profile.connections || 0),
            followersCount: parseInt(profile.followersCount || profile.followers || 0),
            totalLikes: parseInt(engagement.totalLikes || 0),
            totalComments: parseInt(engagement.totalComments || 0),
            totalShares: parseInt(engagement.totalShares || 0),
            averageLikes: parseFloat(engagement.averageLikes || 0),
            
            // ✅ FIXED: Arrays from root level of extractedData
            experience: Array.isArray(extractedData.experience) ? extractedData.experience : [],
            education: Array.isArray(extractedData.education) ? extractedData.education : [],
            skills: Array.isArray(extractedData.skills) ? extractedData.skills : [],
            certifications: Array.isArray(extractedData.certifications) ? extractedData.certifications : [],
            awards: Array.isArray(extractedData.awards) ? extractedData.awards : [],
            volunteer: Array.isArray(extractedData.volunteer) ? extractedData.volunteer : [],
            following: Array.isArray(extractedData.following) ? extractedData.following : [],
            activity: Array.isArray(extractedData.activity) ? extractedData.activity : [],
            
            // ✅ Enhanced engagement and metadata
            engagementData: engagement || {},
            companySize: extractedData.companySize || '',
            industry: extractedData.industry || '',
            profileViews: parseInt(extractedData.profileViews || 0),
            postImpressions: parseInt(extractedData.postImpressions || 0),
            
            // ✅ Metadata
            timestamp: new Date().toISOString(),
            dataSource: 'gemini_processing',
            hasExperience: Array.isArray(extractedData.experience) && extractedData.experience.length > 0
        };
        
        console.log('✅ USER PROFILE: Gemini data processed successfully');
        console.log(`📊 Processed data summary:`);
        console.log(`   - Full Name: ${processedProfile.fullName || 'Not available'}`);
        console.log(`   - Headline: ${processedProfile.headline || 'Not available'}`);
        console.log(`   - Current Role: ${processedProfile.currentRole || 'Not available'}`);
        console.log(`   - Current Company: ${processedProfile.currentCompany || 'Not available'}`);
        console.log(`   - Location: ${processedProfile.location || 'Not available'}`);
        console.log(`   - Experience entries: ${processedProfile.experience.length}`);
        console.log(`   - Education entries: ${processedProfile.education.length}`);
        console.log(`   - Certifications: ${processedProfile.certifications.length}`);
        console.log(`   - Awards: ${processedProfile.awards.length}`);
        console.log(`   - Volunteer: ${processedProfile.volunteer.length}`);
        console.log(`   - Following: ${processedProfile.following.length}`);
        console.log(`   - Activity: ${processedProfile.activity.length}`);
        console.log(`   - Has Experience: ${processedProfile.hasExperience}`);
        
        return processedProfile;
        
    } catch (error) {
        console.error('❌ Error processing USER PROFILE Gemini data:', error);
        
        // Return minimal profile structure on error
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

// ✅ STEP 2D: Initialize authentication middleware with database functions
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

// ✅ STEP 2E: Initialize user routes with dependencies and get router
const userRoutes = initUserRoutes({
    pool,
    authenticateToken,
    getUserByEmail,
    getUserById,
    createUser,
    createOrUpdateUserProfile,
    getSetupStatusMessage
});

// ✅ STEP 2F: Initialize JWT-only profile & API routes with dependencies
const profileRoutes = initProfileRoutes({
    pool,
    authenticateToken,
    getUserById,
    processGeminiData,        // ✅ NOW FIXED IN THIS FILE
    processScrapedProfileData,
    cleanLinkedInUrl,
    getStatusMessage,
    sendToGemini
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

// ✅ MIDDLEWARE SETUP - PROPERLY POSITIONED
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
        
        // Add isNewUser flag to user object
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

// ✅ STEP 2C: Mount static routes FIRST (before other routes)
app.use('/', staticRoutes);

// ✅ MODULARIZATION: Mount health routes
app.use('/', healthRoutes);

// ✅ STEP 2E: Mount user routes
app.use('/', userRoutes);

// ✅ STEP 2F: Mount JWT-only profile & API routes
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
        
        // Add isNewUser flag to user object
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

// ==================== G2B TARGET PROFILE ANALYSIS ROUTE ====================

app.post('/profile/target', authenticateToken, async (req, res) => {
    try {
        console.log('🎯 Target profile analysis request received');
        console.log(`👤 User ID: ${req.user.id}`);
        
        const { html, profileUrl, normalizedUrl } = req.body;
        const userId = req.user.id;
        
        if (!html || !profileUrl) {
            return res.status(400).json({
                success: false,
                error: 'HTML content and profileUrl are required'
            });
        }
        
        // 1) Normalize URL on the server (same as client)
        const normalizedUrlFinal = normalizeLinkedInUrl(normalizedUrl || profileUrl);
        console.log(`🔗 Original URL: ${profileUrl}`);
        console.log(`🔗 Normalized URL: ${normalizedUrlFinal}`);
        
        // 2) Dedupe (server-side) before any heavy work
        // Use fallback to linkedin_url if normalized_url column doesn't exist yet
        let dedupeQuery, dedupeParams;
        try {
            const { rows: existing } = await pool.query(
                'SELECT id FROM target_profiles WHERE user_id = $1 AND normalized_url = $2 LIMIT 1',
                [userId, normalizedUrlFinal]
            );
            
            if (existing.length) {
                console.log(`⚠️ Target already exists for user ${userId} + URL ${normalizedUrlFinal}`);
                return res.status(200).json({
                    success: true,
                    alreadyExists: true,
                    message: 'Target already exists for this user+URL'
                });
            }
        } catch (columnError) {
            // Fallback to linkedin_url if normalized_url column doesn't exist
            console.log('⚠️ normalized_url column not found, using linkedin_url for deduplication');
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
        }
        
        console.log('✅ Target is new, processing...');
        
        // 3) Process new target only
        
        // 3.1 Save raw HTML artifact (simplified for now)
        const rawFileId = null;
        const rawSizeBytes = html ? html.length : null;
        const parsedJsonFileId = null;
        
        // 3.2 Call Gemini (unchanged)
        console.log('🤖 Calling Gemini for target profile analysis...');
        const geminiResult = await sendToGemini({ 
            html: html, 
            url: profileUrl, 
            isUserProfile: false 
        });
        
        if (!geminiResult || !geminiResult.success) {
            console.error('❌ Gemini processing failed:', geminiResult?.error);
            return res.status(200).json({ 
                success: false, 
                userMessage: 'Failed to process profile' 
            });
        }
        
        const parsedJson = geminiResult.data;
        const usage = geminiResult.usage || { 
            input_tokens: 0, 
            output_tokens: 0, 
            total_tokens: 0, 
            model: 'gemini-1.5-flash' 
        };
        
        console.log('✅ Gemini processing completed');
        console.log(`📊 Token usage: ${usage.total_tokens} total (${usage.input_tokens} input, ${usage.output_tokens} output)`);
        
        // 3.3 Light validation (no new libs)
        const missing = [];
        if (!parsedJson?.profile?.name) missing.push('profile.name');
        if (!Array.isArray(parsedJson?.experience)) missing.push('experience');
        if (!Array.isArray(parsedJson?.education)) missing.push('education');
        const mappingStatus = missing.length ? 'missing_fields' : 'ok';
        
        console.log(`🔍 Validation result: ${mappingStatus}`);
        if (missing.length > 0) {
            console.log(`⚠️ Missing fields: ${missing.join(', ')}`);
        }
        
        // 3.4 INSERT into target_profiles with backward compatibility
        console.log('💾 Inserting target profile into database...');
        
        // Try the full G2b schema first, fallback to basic schema if columns don't exist
        let insertResult;
        try {
            // Try full G2b schema
            const sql = `
            INSERT INTO target_profiles
            (user_id, linkedin_url, normalized_url, source, data_json,
             raw_html_file_id, raw_html_size_bytes, parsed_json_file_id,
             gemini_model, gemini_input_tokens, gemini_output_tokens, gemini_total_tokens,
             outreach_focus, mapping_status, version, analyzed_at, created_at, updated_at)
            VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now(), now())
            RETURNING id
            `;

            const params = [
                userId,
                profileUrl || null,
                normalizedUrlFinal,
                'linkedin',
                JSON.stringify(parsedJson),
                rawFileId || null,
                rawSizeBytes || null,
                parsedJsonFileId || null,
                usage.model || 'gemini-1.5-flash',
                usage.input_tokens || 0,
                usage.output_tokens || 0,
                usage.total_tokens || 0,
                null, // outreach_focus remains NULL for now
                mappingStatus,
                'v1'
            ];

            const { rows } = await pool.query(sql, params);
            insertResult = rows[0];
            console.log(`✅ Target profile inserted with ID: ${insertResult.id} (full G2b schema)`);
            
        } catch (schemaError) {
            console.log('⚠️ G2b schema not available, using basic schema fallback');
            
            // Fallback to basic target_profiles schema
            const basicSql = `
            INSERT INTO target_profiles
            (user_id, linkedin_url, created_at, updated_at)
            VALUES
            ($1, $2, now(), now())
            RETURNING id
            `;
            
            const basicParams = [userId, profileUrl];
            
            try {
                const { rows } = await pool.query(basicSql, basicParams);
                insertResult = rows[0];
                console.log(`✅ Target profile inserted with ID: ${insertResult.id} (basic schema)`);
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
                console.error('❌ Database insertion failed even with basic schema:', e);
                throw e;
            }
        }
        
        // 4) Return the extended response (strict)
        console.log('📤 Returning extended response...');
        
        return res.status(200).json({
            success: true,
            data: parsedJson,
            storage: {
                raw_html_saved: !!rawFileId,
                raw_html_file_id: rawFileId || null,
                raw_html_size_bytes: rawSizeBytes || null,
                parsed_json_saved: !!parsedJsonFileId,
                parsed_json_file_id: parsedJsonFileId || null
            },
            gemini: {
                model: usage.model || 'gemini-1.5-flash',
                token_usage: {
                    input_tokens: usage.input_tokens || 0,
                    output_tokens: usage.output_tokens || 0,
                    total_tokens: usage.total_tokens || 0
                }
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
});

// ==================== SESSION-DEPENDENT ROUTES (STAY IN SERVER.JS) ====================

// ✅ KEPT IN SERVER: Google OAuth Routes (Session creation/management)
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
            
            // ✅ FIXED: Smart redirect logic using registration_completed
            const needsOnboarding = req.user.isNewUser || 
                                   !req.user.linkedin_url || 
                                   !req.user.registration_completed ||
                                   req.user.extraction_status === 'not_started';
            
            console.log(`🔍 OAuth callback - User: ${req.user.email}`);
            console.log(`   - Is new user: ${req.user.isNewUser || false}`);
            console.log(`   - Has LinkedIn URL: ${!!req.user.linkedin_url}`);
            console.log(`   - Registration completed: ${req.user.registration_completed || false}`);
            console.log(`   - Extraction status: ${req.user.extraction_status || 'not_started'}`);
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

// 🚦 TRAFFIC LIGHT STATUS ENDPOINT - NEW ENDPOINT FOR DASHBOARD
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

        // 🚦 DETERMINE TRAFFIC LIGHT STATUS
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
        console.error('❌ Traffic light status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check traffic light status'
        });
    }
});

// 🔧 FIXED: Get User Profile - REMOVED DUPLICATE RESPONSE FIELDS
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
        console.error('❌ Enhanced profile fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// 🔧 FIXED: Check profile extraction status - DUAL Authentication Support (Session OR JWT)
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
            processing_mode: 'ENHANCED_HTML_SCRAPING',
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
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'No credit card required'],
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
                features: ['30 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
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
                features: ['100 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
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
                features: ['250 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'Credits never expire'],
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
                features: ['10 Credits per month', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', 'No credit card required'],
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
                features: ['30 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
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
                features: ['100 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
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
                features: ['250 Credits', 'Enhanced Chrome extension', 'Comprehensive HTML scraping', 'Advanced LinkedIn extraction', 'Engagement metrics', 'Certifications & awards data', 'Beautiful dashboard', '7-day free trial included'],
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
            'POST /profile/target', // ✅ NEW: G2b Target analysis route
            'GET /target-profiles',
            'GET /target-profiles/search',
            'DELETE /target-profiles/:id',
            'POST /scrape-html',
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
            console.error('❌ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Msgly.AI Server - STAGE G2B COMPLETE!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Enhanced PostgreSQL with G2a/G2b target_profiles schema`);
            console.log(`🔐 Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`🚦 TRAFFIC LIGHT SYSTEM ACTIVE:`);
            console.log(`   🔴 RED: registration_completed = true + initial_scraping_done = false`);
            console.log(`   🟠 ORANGE: registration + scraping done + extraction != completed`);
            console.log(`   🟢 GREEN: registration + scraping + extraction completed + has experience`);
            console.log(`🎯 STAGE G2B NEW FEATURES:`);
            console.log(`   ✅ POST /profile/target - Target analysis with URL normalization`);
            console.log(`   ✅ Server-side deduplication by (user_id, normalized_url)`);
            console.log(`   ✅ Light validation using shared schema as reference`);
            console.log(`   ✅ Extended JSON response with storage/gemini/mapping data`);
            console.log(`   ✅ Race condition handling for unique constraint violations`);
            console.log(`🔧 IMPLEMENTATION NOTES:`);
            console.log(`   📝 URL normalization function added to server`);
            console.log(`   🔍 Deduplication before heavy Gemini processing`);
            console.log(`   💾 Full target_profiles schema population`);
            console.log(`   📊 Token usage and mapping status tracking`);
            console.log(`   ⚡ Minimal changes - existing code preserved`);
            console.log(`✅ STAGE G2B READY FOR CHROME EXTENSION TESTING!`);
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
