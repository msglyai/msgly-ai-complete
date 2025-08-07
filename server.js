// Msgly.AI Server - Complete with Traffic Light System Integrated
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

// ✅ STEP 2A: Import all database functions from utils/database.js
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
    processGeminiData,        // ✅ UPDATED: processOpenAIData → processGeminiData
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
    processGeminiData,        // ✅ UPDATED: processOpenAIData → processGeminiData
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

// 🔧 FIXED: Get User Profile - DUAL Authentication Support (Session OR JWT) with Traffic Light Data
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
                    connections: profile.connections,
                    followers: profile.followers,
                    totalLikes: profile.total_likes,
                    totalComments: profile.total_comments,
                    totalShares: profile.total_shares,
                    averageLikes: profile.average_likes,
                    recommendationsCount: profile.recommendations_count,
                    profileImageUrl: profile.profile_image_url,
                    avatar: profile.avatar,
                    bannerImage: profile.banner_image,
                    backgroundImageUrl: profile.background_image_url,
                    publicIdentifier: profile.public_identifier,
                    experience: profile.experience,
                    education: profile.education,
                    educationsDetails: profile.educations_details,
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
            'GET /traffic-light-status', // ✅ NEW: Traffic light endpoint
            'POST /profile/user',
            'POST /profile/target',
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
            console.log('🚀 Msgly.AI Server - COMPLETE WITH TRAFFIC LIGHT SYSTEM!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Enhanced PostgreSQL with traffic light fields`);
            console.log(`🔐 Auth: DUAL AUTHENTICATION - Session (Web) + JWT (Extension/API)`);
            console.log(`🚦 TRAFFIC LIGHT SYSTEM ACTIVE:`);
            console.log(`   🔴 RED: registration_completed = true + initial_scraping_done = false`);
            console.log(`   🟠 ORANGE: registration + scraping done + extraction != completed`);
            console.log(`   🟢 GREEN: registration + scraping + extraction completed + has experience`);
            console.log(`📊 NEW ENDPOINTS:`);
            console.log(`   ✅ GET /traffic-light-status - Dashboard traffic light API`);
            console.log(`   ✅ Enhanced /profile - With traffic light data`);
            console.log(`   ✅ Enhanced /profile-status - With traffic light compatibility`);
            console.log(`🎯 DASHBOARD COMPATIBILITY:`);
            console.log(`   📱 Dashboard: JWT + Session auth supported`);
            console.log(`   🔌 Extension: JWT authentication`);
            console.log(`   🔗 API: JWT authentication`);
            console.log(`🏆 TRAFFIC LIGHT SYSTEM READY FOR DASHBOARD!`);
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
