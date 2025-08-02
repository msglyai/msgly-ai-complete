// Msgly.AI Server - RAILWAY READY VERSION - Comprehensive Debug
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
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables with fallbacks for Railway
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Bright Data Configuration - ADD YOUR ACTUAL VALUES HERE FOR RAILWAY
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY || 
                            process.env.BRIGHT_DATA_API_TOKEN || 
                            'brd-t6dqfwj2p8p-ac38c-b1l9-1f98-79e9-d8ceb4fd3c70_b59b8c39-8e9f-4db5-9bea-92e8b9e8b8b0';
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_DATASET_ID || 'gd_l1viktl72bvl7bjuj0';

// Validate critical environment variables
const validateCriticalEnvVars = () => {
    console.log('🔍 Checking environment variables...');
    
    if (!DATABASE_URL) {
        console.error('❌ DATABASE_URL is required');
        process.exit(1);
    }
    
    // Google OAuth is optional for now
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.warn('⚠️ Google OAuth not configured - some features will be disabled');
    }
    
    if (!BRIGHT_DATA_API_KEY) {
        console.warn('⚠️ BRIGHT_DATA_API_KEY not set - using fallback value');
    }
    
    console.log('✅ Environment validation completed');
};

// Database connection with better error handling
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
        
        if (origin && origin.startsWith('chrome-extension://')) {
            return callback(null, true);
        }
        
        if (origin && allowedOrigins.indexOf(origin) !== -1) {
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

// Passport initialization - only if Google OAuth is configured
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

// Google OAuth Strategy - only if configured
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
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
} else {
    console.warn('⚠️ Google OAuth not configured - skipping strategy setup');
}

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
                
                -- Basic LinkedIn Information
                linkedin_url TEXT,
                linkedin_id TEXT,
                linkedin_num_id BIGINT,
                input_url TEXT,
                url TEXT,
                name TEXT,
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
                
                -- Current Company Information
                current_company JSONB,
                current_company_name TEXT,
                current_company_id TEXT,
                current_position TEXT,
                industry TEXT,
                
                -- Metrics
                connections_count INTEGER,
                followers_count INTEGER,
                connections INTEGER,
                followers INTEGER,
                
                -- Media
                profile_picture TEXT,
                profile_pic_url TEXT,
                avatar TEXT,
                banner_image TEXT,
                background_image TEXT,
                
                -- Core LinkedIn Data Arrays (EXACTLY as returned by Bright Data)
                experience JSONB DEFAULT '[]'::JSONB,
                skills JSONB DEFAULT '[]'::JSONB,
                certifications JSONB DEFAULT '[]'::JSONB,
                education JSONB DEFAULT '[]'::JSONB,
                languages JSONB DEFAULT '[]'::JSONB,
                courses JSONB DEFAULT '[]'::JSONB,
                projects JSONB DEFAULT '[]'::JSONB,
                publications JSONB DEFAULT '[]'::JSONB,
                patents JSONB DEFAULT '[]'::JSONB,
                volunteer_experience JSONB DEFAULT '[]'::JSONB,
                volunteering JSONB DEFAULT '[]'::JSONB,
                honors_and_awards JSONB DEFAULT '[]'::JSONB,
                organizations JSONB DEFAULT '[]'::JSONB,
                recommendations JSONB DEFAULT '[]'::JSONB,
                posts JSONB DEFAULT '[]'::JSONB,
                activity JSONB DEFAULT '[]'::JSONB,
                articles JSONB DEFAULT '[]'::JSONB,
                
                -- Additional Bright Data specific fields
                people_also_viewed JSONB DEFAULT '[]'::JSONB,
                skills_with_endorsements JSONB DEFAULT '[]'::JSONB,
                work_experience JSONB DEFAULT '[]'::JSONB,
                educations JSONB DEFAULT '[]'::JSONB,
                
                -- Metadata
                brightdata_raw_data JSONB,
                data_source VARCHAR(100) DEFAULT 'bright_data',
                extraction_status VARCHAR(50) DEFAULT 'pending',
                extraction_attempted_at TIMESTAMP,
                extraction_completed_at TIMESTAMP,
                extraction_error TEXT,
                extraction_retry_count INTEGER DEFAULT 0,
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
                CREATE INDEX IF NOT EXISTS idx_user_profiles_extraction_status ON user_profiles(extraction_status);
                CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);
            `);
            console.log('✅ Database indexes created');
        } catch (err) {
            console.log('Indexes might already exist:', err.message);
        }

        console.log('✅ Database tables created successfully');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== COMPREHENSIVE DEBUG LINKEDIN DATA PROCESSING ====================

// 🔍 COMPREHENSIVE DEBUG: Save raw response to file for analysis
const saveRawResponseToFile = (profileData, userId) => {
    try {
        const fileName = `raw_response_user_${userId}_${Date.now()}.json`;
        const filePath = path.join(__dirname, fileName);
        fs.writeFileSync(filePath, JSON.stringify(profileData, null, 2));
        console.log(`🔍 COMPREHENSIVE DEBUG: Raw response saved to ${fileName}`);
        return fileName;
    } catch (error) {
        console.error('🔍 COMPREHENSIVE DEBUG: Failed to save raw response:', error);
        return null;
    }
};

// 🔍 COMPREHENSIVE DEBUG: Deep data structure analysis
const analyzeDataStructure = (data, path = 'root') => {
    console.log(`🔍 COMPREHENSIVE DEBUG: Analyzing data structure at path: ${path}`);
    
    if (data === null || data === undefined) {
        console.log(`🔍 COMPREHENSIVE DEBUG: ${path} = null/undefined`);
        return;
    }
    
    console.log(`🔍 COMPREHENSIVE DEBUG: ${path} type: ${typeof data}`);
    console.log(`🔍 COMPREHENSIVE DEBUG: ${path} is array: ${Array.isArray(data)}`);
    
    if (typeof data === 'object' && !Array.isArray(data)) {
        const keys = Object.keys(data);
        console.log(`🔍 COMPREHENSIVE DEBUG: ${path} object keys (${keys.length}):`, keys);
        
        // Show first few characters of each key's value
        keys.forEach(key => {
            const value = data[key];
            if (value === null || value === undefined) {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${path}.${key} = null/undefined`);
            } else if (typeof value === 'string') {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${path}.${key} = "${value.substring(0, 100)}${value.length > 100 ? '...' : ''}"`);
            } else if (Array.isArray(value)) {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${path}.${key} = array with ${value.length} elements`);
                if (value.length > 0) {
                    console.log(`🔍 COMPREHENSIVE DEBUG: ${path}.${key}[0] type:`, typeof value[0]);
                }
            } else if (typeof value === 'object') {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${path}.${key} = object with keys:`, Object.keys(value));
            } else {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${path}.${key} = ${value} (${typeof value})`);
            }
        });
    } else if (Array.isArray(data)) {
        console.log(`🔍 COMPREHENSIVE DEBUG: ${path} array length: ${data.length}`);
        if (data.length > 0) {
            console.log(`🔍 COMPREHENSIVE DEBUG: ${path}[0] type:`, typeof data[0]);
            if (typeof data[0] === 'object') {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${path}[0] keys:`, Object.keys(data[0]));
            }
        }
    } else {
        console.log(`🔍 COMPREHENSIVE DEBUG: ${path} value: ${data}`);
    }
};

// 🔍 COMPREHENSIVE DEBUG: Search for fields in nested structures
const searchForFieldsInData = (data, targetFields, path = 'root') => {
    const results = {};
    
    const search = (obj, currentPath) => {
        if (obj === null || obj === undefined || typeof obj !== 'object') {
            return;
        }
        
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                search(item, `${currentPath}[${index}]`);
            });
        } else {
            Object.keys(obj).forEach(key => {
                const fullPath = `${currentPath}.${key}`;
                
                // Check if this key matches any target field
                if (targetFields.includes(key.toLowerCase())) {
                    if (!results[key]) results[key] = [];
                    results[key].push({
                        path: fullPath,
                        value: obj[key],
                        type: typeof obj[key],
                        isArray: Array.isArray(obj[key]),
                        length: Array.isArray(obj[key]) ? obj[key].length : null
                    });
                }
                
                // Recursively search in nested objects
                if (typeof obj[key] === 'object') {
                    search(obj[key], fullPath);
                }
            });
        }
    };
    
    search(data, path);
    return results;
};

// 🔍 COMPREHENSIVE DEBUG: Ensure arrays are properly formatted for PostgreSQL JSONB
const ensureValidJSONArrayDebug = (data, fieldName) => {
    console.log(`🔍 COMPREHENSIVE DEBUG: Processing field '${fieldName}'`);
    console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} input:`, data);
    console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} type:`, typeof data);
    console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} is array:`, Array.isArray(data));
    
    try {
        if (!data) {
            console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} is falsy, returning empty array`);
            return [];
        }
        
        if (Array.isArray(data)) {
            const filtered = data.filter(item => item !== null && item !== undefined);
            console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} filtered array length: ${filtered.length}`);
            console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} first item:`, filtered[0]);
            return filtered;
        }
        
        if (typeof data === 'string') {
            console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} is string, attempting to parse`);
            try {
                const parsed = JSON.parse(data);
                console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} parsed successfully:`, parsed);
                if (Array.isArray(parsed)) {
                    return ensureValidJSONArrayDebug(parsed, fieldName);
                }
                return [parsed];
            } catch (e) {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} JSON parse failed:`, e.message);
                return [];
            }
        }
        
        if (typeof data === 'object') {
            console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} is object, wrapping in array`);
            return [data];
        }
        
        console.log(`🔍 COMPREHENSIVE DEBUG: ${fieldName} unexpected type, returning empty array`);
        return [];
    } catch (error) {
        console.error(`🔍 COMPREHENSIVE DEBUG: Error processing ${fieldName}:`, error);
        return [];
    }
};

// 🔍 COMPREHENSIVE DEBUG: Process LinkedIn data with complete analysis
const processLinkedInDataComprehensiveDebug = (profileData, userId) => {
    if (!profileData) {
        throw new Error('No profile data received from Bright Data API');
    }
    
    console.log('🔍 COMPREHENSIVE DEBUG: =================================================');
    console.log('🔍 COMPREHENSIVE DEBUG: STARTING COMPREHENSIVE LINKEDIN DATA ANALYSIS');
    console.log('🔍 COMPREHENSIVE DEBUG: =================================================');
    
    // Save raw response to file
    const fileName = saveRawResponseToFile(profileData, userId);
    
    // Analyze top-level structure
    console.log('🔍 COMPREHENSIVE DEBUG: TOP-LEVEL DATA STRUCTURE:');
    analyzeDataStructure(profileData);
    
    // Search for target fields
    console.log('🔍 COMPREHENSIVE DEBUG: SEARCHING FOR TARGET FIELDS:');
    const targetFields = ['experience', 'skills', 'certifications', 'education', 'activity'];
    const searchResults = searchForFieldsInData(profileData, targetFields);
    
    console.log('🔍 COMPREHENSIVE DEBUG: SEARCH RESULTS:');
    Object.keys(searchResults).forEach(field => {
        console.log(`🔍 COMPREHENSIVE DEBUG: Found '${field}' at:`, searchResults[field]);
    });
    
    // Analyze specific field paths
    console.log('🔍 COMPREHENSIVE DEBUG: SPECIFIC FIELD ANALYSIS:');
    targetFields.forEach(field => {
        console.log(`🔍 COMPREHENSIVE DEBUG: Analyzing field '${field}':`);
        
        // Direct access
        const directValue = profileData[field];
        console.log(`🔍 COMPREHENSIVE DEBUG: profileData.${field}:`, directValue);
        console.log(`🔍 COMPREHENSIVE DEBUG: profileData.${field} type:`, typeof directValue);
        console.log(`🔍 COMPREHENSIVE DEBUG: profileData.${field} is array:`, Array.isArray(directValue));
        
        // Check common variations
        const variations = [
            field,
            `${field}_details`,
            `${field}_list`,
            `${field}s`,
            `work_${field}`,
            `professional_${field}`,
            `user_${field}`
        ];
        
        variations.forEach(variation => {
            if (profileData[variation] !== undefined) {
                console.log(`🔍 COMPREHENSIVE DEBUG: Found variation '${variation}':`, profileData[variation]);
            }
        });
    });
    
    // Check if data is nested in a sub-object
    console.log('🔍 COMPREHENSIVE DEBUG: CHECKING FOR NESTED DATA:');
    const commonContainers = ['data', 'profile', 'user', 'person', 'details', 'info'];
    commonContainers.forEach(container => {
        if (profileData[container] && typeof profileData[container] === 'object') {
            console.log(`🔍 COMPREHENSIVE DEBUG: Found container '${container}':`, Object.keys(profileData[container]));
            targetFields.forEach(field => {
                if (profileData[container][field] !== undefined) {
                    console.log(`🔍 COMPREHENSIVE DEBUG: Found '${field}' in '${container}':`, profileData[container][field]);
                }
            });
        }
    });
    
    // Process the data with debug logging
    try {
        const processedData = {
            // Basic Information
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
            
            // Current Company
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
            
            // 🔍 COMPREHENSIVE DEBUG: Process critical fields with debugging
            experience: ensureValidJSONArrayDebug(profileData.experience, 'experience'),
            skills: ensureValidJSONArrayDebug(profileData.skills, 'skills'),
            certifications: ensureValidJSONArrayDebug(profileData.certifications, 'certifications'),
            education: ensureValidJSONArrayDebug(profileData.education, 'education'),
            languages: ensureValidJSONArrayDebug(profileData.languages, 'languages'),
            courses: ensureValidJSONArrayDebug(profileData.courses, 'courses'),
            projects: ensureValidJSONArrayDebug(profileData.projects, 'projects'),
            publications: ensureValidJSONArrayDebug(profileData.publications, 'publications'),
            patents: ensureValidJSONArrayDebug(profileData.patents, 'patents'),
            volunteerExperience: ensureValidJSONArrayDebug(profileData.volunteer_experience, 'volunteer_experience'),
            volunteering: ensureValidJSONArrayDebug(profileData.volunteering, 'volunteering'),
            honorsAndAwards: ensureValidJSONArrayDebug(profileData.honors_and_awards, 'honors_and_awards'),
            organizations: ensureValidJSONArrayDebug(profileData.organizations, 'organizations'),
            recommendations: ensureValidJSONArrayDebug(profileData.recommendations, 'recommendations'),
            posts: ensureValidJSONArrayDebug(profileData.posts, 'posts'),
            activity: ensureValidJSONArrayDebug(profileData.activity, 'activity'),
            articles: ensureValidJSONArrayDebug(profileData.articles, 'articles'),
            peopleAlsoViewed: ensureValidJSONArrayDebug(profileData.people_also_viewed, 'people_also_viewed'),
            skillsWithEndorsements: ensureValidJSONArrayDebug(profileData.skills_with_endorsements, 'skills_with_endorsements'),
            
            // Alternative field names
            workExperience: ensureValidJSONArrayDebug(profileData.work_experience, 'work_experience'),
            educations: ensureValidJSONArrayDebug(profileData.educations, 'educations'),
            
            // Store complete raw data
            rawData: profileData
        };
        
        // Final processed data summary with comprehensive details
        console.log('🔍 COMPREHENSIVE DEBUG: FINAL PROCESSED DATA SUMMARY:');
        console.log(`🔍 COMPREHENSIVE DEBUG: - name: ${processedData.name || 'Not available'}`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - headline: ${processedData.headline || 'Not available'}`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - currentCompanyName: ${processedData.currentCompanyName || 'Not available'}`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - experience: ${processedData.experience?.length || 0} entries`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - skills: ${processedData.skills?.length || 0} entries`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - certifications: ${processedData.certifications?.length || 0} entries`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - education: ${processedData.education?.length || 0} entries`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - activity: ${processedData.activity?.length || 0} entries`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - workExperience: ${processedData.workExperience?.length || 0} entries`);
        console.log(`🔍 COMPREHENSIVE DEBUG: - educations: ${processedData.educations?.length || 0} entries`);
        
        // Show sample data for non-empty arrays
        ['experience', 'skills', 'certifications', 'education', 'activity'].forEach(field => {
            if (processedData[field] && processedData[field].length > 0) {
                console.log(`🔍 COMPREHENSIVE DEBUG: ${field} sample data:`, processedData[field][0]);
            }
        });
        
        console.log('🔍 COMPREHENSIVE DEBUG: =================================================');
        console.log('🔍 COMPREHENSIVE DEBUG: COMPREHENSIVE ANALYSIS COMPLETED');
        console.log('🔍 COMPREHENSIVE DEBUG: =================================================');
        
        if (fileName) {
            console.log(`🔍 COMPREHENSIVE DEBUG: Full raw response saved to file: ${fileName}`);
        }
        
        return processedData;
        
    } catch (error) {
        console.error('🔍 COMPREHENSIVE DEBUG: Error processing LinkedIn data:', error);
        throw new Error(`LinkedIn data processing failed: ${error.message}`);
    }
};

// Bright Data LinkedIn Profile Extraction with comprehensive debugging
const extractLinkedInProfileComprehensiveDebug = async (linkedinUrl, userId) => {
    try {
        console.log('🚀 Starting comprehensive debug LinkedIn profile extraction...');
        console.log('🔗 LinkedIn URL:', linkedinUrl);
        console.log('🆔 Dataset ID:', BRIGHT_DATA_DATASET_ID);
        console.log('👤 User ID:', userId);
        
        // OPTION 1: Try synchronous scrape first
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
                    timeout: 120000
                }
            );
            
            if (syncResponse.status === 200 && syncResponse.data && syncResponse.data.length > 0) {
                console.log('✅ Synchronous extraction successful!');
                const profileData = Array.isArray(syncResponse.data) ? syncResponse.data[0] : syncResponse.data;
                
                console.log('🔍 COMPREHENSIVE DEBUG: Raw Bright Data response received');
                console.log('🔍 COMPREHENSIVE DEBUG: Response status:', syncResponse.status);
                console.log('🔍 COMPREHENSIVE DEBUG: Response data type:', typeof syncResponse.data);
                console.log('🔍 COMPREHENSIVE DEBUG: Response is array:', Array.isArray(syncResponse.data));
                console.log('🔍 COMPREHENSIVE DEBUG: Response length:', syncResponse.data.length);
                
                return {
                    success: true,
                    data: processLinkedInDataComprehensiveDebug(profileData, userId),
                    method: 'synchronous',
                    message: 'LinkedIn profile extracted successfully (synchronous)'
                };
            }
        } catch (syncError) {
            console.log('⏩ Synchronous method not available, falling back to async...');
        }
        
        // OPTION 2: Async method
        console.log('🔄 Using asynchronous extraction method...');
        
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
                        
                        console.log('🔍 COMPREHENSIVE DEBUG: Raw Bright Data response received (async)');
                        console.log('🔍 COMPREHENSIVE DEBUG: Response status:', dataResponse.status);
                        console.log('🔍 COMPREHENSIVE DEBUG: Response data type:', typeof dataResponse.data);
                        console.log('🔍 COMPREHENSIVE DEBUG: Response is array:', Array.isArray(dataResponse.data));
                        
                        return {
                            success: true,
                            data: processLinkedInDataComprehensiveDebug(profileData, userId),
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
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
        
        throw new Error(`Polling timeout - LinkedIn extraction took longer than ${maxAttempts * 8} seconds`);
        
    } catch (error) {
        console.error('❌ LinkedIn extraction failed:', error);
        throw new Error(`LinkedIn extraction failed: ${error.message}`);
    }
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

// COMPREHENSIVE DEBUG: Background extraction with enhanced debugging
const scheduleBackgroundExtractionComprehensiveDebug = async (userId, linkedinUrl, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = 300000;
    
    console.log(`🔄 Scheduling COMPREHENSIVE DEBUG background extraction for user ${userId}, retry ${retryCount}`);
    
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
            console.log(`🚀 Starting COMPREHENSIVE DEBUG background extraction for user ${userId} (Retry ${retryCount})`);
            
            await pool.query(
                'UPDATE user_profiles SET extraction_retry_count = $1, extraction_attempted_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [retryCount, userId]
            );

            // Extract with comprehensive debugging
            const result = await extractLinkedInProfileComprehensiveDebug(linkedinUrl, userId);
            
            console.log(`✅ COMPREHENSIVE DEBUG extraction succeeded for user ${userId}`);
            
            const extractedData = result.data;
            
            // Database save implementation
            console.log('💾 Saving COMPREHENSIVE DEBUG LinkedIn data to database...');
            
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
                        
                        -- COMPREHENSIVE DEBUG: Core LinkedIn Data Arrays
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
                    
                    // COMPREHENSIVE DEBUG: Core LinkedIn Data Arrays (31-51)
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

                console.log(`🎉 COMPREHENSIVE DEBUG LinkedIn profile data successfully saved for user ${userId}!`);
                console.log(`✅ Method: ${result.method}`);
                console.log('🔍 SUCCESS: COMPREHENSIVE DEBUG analysis completed!');
                
                processingQueue.delete(userId);
                
            } catch (dbError) {
                console.error(`❌ DATABASE SAVE FAILED for user ${userId}:`, dbError.message);
                throw new Error(`Database save failure: ${dbError.message}`);
            }
                
        } catch (error) {
            console.error(`❌ COMPREHENSIVE DEBUG extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
            
            if (retryCount < maxRetries - 1) {
                console.log(`🔄 Retrying COMPREHENSIVE DEBUG extraction for user ${userId}...`);
                await scheduleBackgroundExtractionComprehensiveDebug(userId, linkedinUrl, retryCount + 1);
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

// Create profile with comprehensive debugging
const createOrUpdateUserProfileComprehensiveDebug = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        console.log(`🚀 Creating profile with COMPREHENSIVE DEBUG extraction for user ${userId}`);
        
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
        
        console.log(`🔄 Starting COMPREHENSIVE DEBUG background extraction for user ${userId}`);
        processingQueue.set(userId, { status: 'processing', startTime: Date.now() });
        
        scheduleBackgroundExtractionComprehensiveDebug(userId, cleanUrl, 0);
        
        console.log(`✅ Profile created and COMPREHENSIVE DEBUG extraction started for user ${userId}`);
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
        message: 'Msgly.AI Server - RAILWAY READY VERSION - COMPREHENSIVE DEBUG',
        status: 'running',
        version: '6.3-RAILWAY-READY-DEBUG',
        environment: process.env.NODE_ENV || 'development',
        debugging: {
            enabled: true,
            features: [
                'Complete raw response logging',
                'Data structure analysis',
                'Field search in nested objects',
                'Raw response file saving',
                'Comprehensive field debugging',
                'Step-by-step processing logs'
            ]
        },
        railwayReady: {
            environmentHandling: 'Improved with fallbacks',
            googleOAuth: GOOGLE_CLIENT_ID ? 'Configured' : 'Not configured',
            brightData: BRIGHT_DATA_API_KEY ? 'Configured' : 'Using fallback',
            database: DATABASE_URL ? 'Configured' : 'Not configured'
        },
        endpoints: [
            'GET / (this page)',
            'GET /health',
            'POST /register',
            'POST /login', 
            'GET /auth/google (if configured)',
            'GET /auth/google/callback (if configured)',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'GET /profile-status (protected)',
            'POST /retry-extraction (protected)',
            'GET /packages'
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
            version: '6.3-RAILWAY-READY-DEBUG',
            timestamp: new Date().toISOString(),
            environment: {
                NODE_ENV: process.env.NODE_ENV || 'development',
                PORT: PORT,
                hasDatabase: !!DATABASE_URL,
                hasGoogleAuth: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
                hasBrightData: !!BRIGHT_DATA_API_KEY
            },
            debugging: {
                enabled: true,
                rawResponseSaving: true,
                dataStructureAnalysis: true,
                fieldSearching: true,
                comprehensiveLogging: true
            },
            brightDataMapping: {
                configured: !!BRIGHT_DATA_API_KEY,
                datasetId: BRIGHT_DATA_DATASET_ID,
                debugMode: 'COMPREHENSIVE'
            },
            database: {
                connected: true,
                ssl: process.env.NODE_ENV === 'production'
            },
            backgroundProcessing: {
                enabled: true,
                currentlyProcessing: processingCount,
                implementation: 'COMPREHENSIVE DEBUG'
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

// Google OAuth routes - only if configured
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
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
                
                if (req.user.linkedin_url) {
                    const frontendUrl = process.env.NODE_ENV === 'production' 
                        ? 'https://msgly.ai/dashboard' 
                        : 'http://localhost:3000/dashboard';
                        
                    res.redirect(`${frontendUrl}?token=${token}`);
                } else {
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
} else {
    // Provide disabled endpoints for Google OAuth
    app.get('/auth/google', (req, res) => {
        res.status(501).json({
            error: 'Google OAuth not configured',
            message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables in Railway'
        });
    });
}

// Registration endpoint
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

// Login endpoint
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

// COMPREHENSIVE DEBUG: Update profile endpoint
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
        
        // Create profile with comprehensive debugging
        const profile = await createOrUpdateUserProfileComprehensiveDebug(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated - COMPREHENSIVE DEBUG LinkedIn extraction started!',
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
                    message: 'COMPREHENSIVE DEBUG - Full data analysis enabled'
                },
                comprehensiveDebugging: {
                    enabled: true,
                    features: [
                        'Raw response saving to file',
                        'Complete data structure analysis',
                        'Field searching in nested objects',
                        'Comprehensive processing logs',
                        'Step-by-step debugging',
                        'Alternative field detection'
                    ]
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - COMPREHENSIVE DEBUG extraction started!`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Get User Profile
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
                    linkedinUrl: profile.linkedin_url,
                    linkedinId: profile.linkedin_id,
                    name: profile.name,
                    fullName: profile.full_name,
                    headline: profile.headline,
                    currentCompanyName: profile.current_company_name,
                    experience: profile.experience,
                    skills: profile.skills,
                    certifications: profile.certifications,
                    education: profile.education,
                    activity: profile.activity,
                    extractionStatus: profile.extraction_status,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error
                } : null,
                automaticProcessing: {
                    enabled: true,
                    isCurrentlyProcessing: processingQueue.has(req.user.id),
                    implementation: 'COMPREHENSIVE DEBUG'
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

// Profile status endpoint
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
            implementation: 'COMPREHENSIVE DEBUG',
            debugLogging: 'ENABLED'
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

// Retry extraction endpoint
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
        
        // Retry extraction with comprehensive debugging
        const profile = await createOrUpdateUserProfileComprehensiveDebug(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: 'LinkedIn extraction retry initiated with COMPREHENSIVE DEBUG!',
            status: 'processing',
            implementation: 'COMPREHENSIVE DEBUG',
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
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'COMPREHENSIVE DEBUG extraction', 'No credit card required'],
                available: true
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
                features: ['10 Credits per month', 'Chrome extension', 'AI profile analysis', 'COMPREHENSIVE DEBUG extraction', 'No credit card required'],
                available: true
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
            'GET / (info)',
            'GET /health',
            'POST /register',
            'POST /login',
            'GET /auth/google (if configured)',
            'GET /profile (protected)',
            'POST /update-profile (protected)',
            'GET /profile-status (protected)',
            'POST /retry-extraction (protected)',
            'GET /packages'
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

const startServer = async () => {
    try {
        validateCriticalEnvVars();
        
        console.log('✅ Environment validation completed');
        
        const dbOk = await testDatabase();
        if (!dbOk) {
            console.error('❌ Cannot start server without database');
            process.exit(1);
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Msgly.AI Server - RAILWAY READY VERSION - COMPREHENSIVE DEBUG Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🗃️ Database: ${DATABASE_URL ? 'Connected ✅' : 'NOT CONFIGURED ❌'}`);
            console.log(`🔐 Google Auth: ${(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) ? 'Configured ✅' : 'Not configured ⚠️'}`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'Using fallback ⚠️'}`);
            console.log(`🔍 COMPREHENSIVE DEBUG MODE ENABLED:`);
            console.log(`   🔍 Raw response file saving`);
            console.log(`   🔍 Complete data structure analysis`);
            console.log(`   🔍 Field searching in nested objects`);
            console.log(`   🔍 Comprehensive processing logs`);
            console.log(`   🔍 Step-by-step debugging`);
            console.log(`   🔍 Alternative field detection`);
            console.log(`🔬 This version will reveal exactly what's in the Bright Data response!`);
            console.log(`⏰ Started: ${new Date().toISOString()}`);
            
            if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
                console.log('⚠️ To enable Google OAuth on Railway, set these environment variables:');
                console.log('   - GOOGLE_CLIENT_ID');
                console.log('   - GOOGLE_CLIENT_SECRET');
            }
        });
        
    } catch (error) {
        console.error('❌ Startup failed:', error);
        process.exit(1);
    }
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

startServer();

module.exports = app;
