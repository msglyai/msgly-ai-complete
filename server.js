// Msgly.AI Server with Google OAuth + Bright Data Integration
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

// FIXED: Bright Data API configuration (using synchronous API)
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_TOKEN || 'e5353ea11fe201c7f9797062c64b59fb87f1bfc01ad8a24dd0fc34a29ccddd23';
const BRIGHT_DATA_SCRAPE_URL = 'https://api.brightdata.com/datasets/v3/scrape';
const BRIGHT_DATA_TRIGGER_URL = 'https://api.brightdata.com/datasets/v3/trigger';
const BRIGHT_DATA_DATASET_ID = 'gd_l1viktl72bvl7bjuj0';

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
                experience JSONB,
                education JSONB,
                certifications JSONB,
                skills TEXT[],
                languages JSONB,
                recommendations JSONB,
                recommendations_count INTEGER,
                volunteer_experience JSONB,
                courses JSONB,
                publications JSONB,
                patents JSONB,
                projects JSONB,
                organizations JSONB,
                honors_and_awards JSONB,
                
                -- SOCIAL ACTIVITY
                posts JSONB,
                activity JSONB,
                people_also_viewed JSONB,
                
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

        // ENHANCED: Add ALL comprehensive Bright Data columns to existing user_profiles table
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
                ADD COLUMN IF NOT EXISTS followers_count INTEGER,
                ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(500),
                ADD COLUMN IF NOT EXISTS banner_image_url VARCHAR(500),
                ADD COLUMN IF NOT EXISTS current_company VARCHAR(255),
                ADD COLUMN IF NOT EXISTS current_company_id VARCHAR(100),
                ADD COLUMN IF NOT EXISTS current_company_url VARCHAR(500),
                ADD COLUMN IF NOT EXISTS certifications JSONB,
                ADD COLUMN IF NOT EXISTS languages JSONB,
                ADD COLUMN IF NOT EXISTS recommendations JSONB,
                ADD COLUMN IF NOT EXISTS recommendations_count INTEGER,
                ADD COLUMN IF NOT EXISTS volunteer_experience JSONB,
                ADD COLUMN IF NOT EXISTS courses JSONB,
                ADD COLUMN IF NOT EXISTS publications JSONB,
                ADD COLUMN IF NOT EXISTS patents JSONB,
                ADD COLUMN IF NOT EXISTS projects JSONB,
                ADD COLUMN IF NOT EXISTS organizations JSONB,
                ADD COLUMN IF NOT EXISTS honors_and_awards JSONB,
                ADD COLUMN IF NOT EXISTS posts JSONB,
                ADD COLUMN IF NOT EXISTS activity JSONB,
                ADD COLUMN IF NOT EXISTS people_also_viewed JSONB,
                ADD COLUMN IF NOT EXISTS country_code VARCHAR(10),
                ADD COLUMN IF NOT EXISTS linkedin_id VARCHAR(100),
                ADD COLUMN IF NOT EXISTS public_identifier VARCHAR(100),
                ADD COLUMN IF NOT EXISTS linkedin_profile_url VARCHAR(500),
                ADD COLUMN IF NOT EXISTS profile_timestamp VARCHAR(50),
                ADD COLUMN IF NOT EXISTS brightdata_data JSONB,
                ADD COLUMN IF NOT EXISTS data_extraction_status VARCHAR(50) DEFAULT 'pending',
                ADD COLUMN IF NOT EXISTS extraction_attempted_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS extraction_completed_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS extraction_error TEXT;
            `);
            console.log('✅ Added comprehensive Bright Data columns to user_profiles table');
        } catch (err) {
            console.log('Comprehensive Bright Data columns might already exist:', err.message);
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

// ==================== BRIGHT DATA FUNCTIONS (FIXED - CORRECT API USAGE) ====================

const extractLinkedInProfile = async (linkedinUrl) => {
    try {
        console.log(`🔍 Extracting LinkedIn profile with Bright Data: ${linkedinUrl}`);
        
        if (!BRIGHT_DATA_API_KEY) {
            throw new Error('Bright Data API key not configured');
        }
        
        // FIXED: Use synchronous API for immediate response
        const scrapeResponse = await axios.post(
            `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`,
            [{ url: linkedinUrl }],
            {
                headers: {
                    'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000 // 60 seconds timeout
            }
        );

        console.log(`📡 Bright Data API Response Status: ${scrapeResponse.status}`);
        console.log(`📊 Response data type: ${typeof scrapeResponse.data}, length: ${scrapeResponse.data?.length || 'N/A'}`);
        if (scrapeResponse.data) {
            console.log('📄 Response preview:', JSON.stringify(scrapeResponse.data).substring(0, 500) + '...');
        }

        // Check if we got immediate data (status 200)
        if (scrapeResponse.status === 200 && scrapeResponse.data && scrapeResponse.data.length > 0) {
            console.log(`📊 Bright Data returned ${scrapeResponse.data.length} profile(s)`);
            console.log('🔍 Full response structure:', JSON.stringify(scrapeResponse.data, null, 2));
            
            const profile = scrapeResponse.data[0];
            
            // Extract and structure the data
            const extractedData = {
                fullName: profile.name || profile.full_name || null,
                firstName: profile.first_name || null,
                lastName: profile.last_name || null,
                headline: profile.headline || null,
                summary: profile.summary || profile.about || null,
                location: profile.location || null,
                industry: profile.industry || null,
                connectionsCount: profile.connections_count || profile.connections || null,
                profileImageUrl: profile.profile_picture || profile.photo_url || profile.avatar || null,
                experience: profile.experience || [],
                education: profile.education || [],
                skills: profile.skills || [],
                rawData: profile // Store complete response for future use
            };

            console.log(`✅ Successfully extracted profile for: ${extractedData.fullName || 'Unknown'}`);
            return extractedData;
        }
        
        // If we get HTTP 202, it means the request is still processing
        if (scrapeResponse.status === 202) {
            console.log('⏳ Request is still processing (HTTP 202), trying fallback approach...');
            
            // Fallback: Use async trigger approach
            const triggerResponse = await axios.post(
                `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`,
                [{ url: linkedinUrl }],
                {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            if (!triggerResponse.data || !triggerResponse.data.snapshot_id) {
                throw new Error('No snapshot ID returned from Bright Data trigger');
            }

            const snapshotId = triggerResponse.data.snapshot_id;
            console.log(`📷 Fallback: Snapshot ID received: ${snapshotId}`);

            // Poll for completion (maximum 2 minutes for fallback)
            const maxAttempts = 12; // 12 attempts * 10 seconds = 2 minutes
            let attempt = 0;
            
            while (attempt < maxAttempts) {
                attempt++;
                console.log(`⏳ Fallback polling attempt ${attempt}/${maxAttempts} for snapshot ${snapshotId}`);
                
                // Wait 10 seconds between polls
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                try {
                    // Download the results directly
                    const downloadResponse = await axios.get(
                        `https://api.brightdata.com/datasets/snapshots/${snapshotId}/download`,
                        {
                            headers: {
                                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`
                            },
                            timeout: 30000
                        }
                    );

                    if (downloadResponse.data && downloadResponse.data.length > 0) {
                        console.log(`📊 Fallback: Downloaded ${downloadResponse.data.length} profile(s)`);
                        console.log('🔍 Fallback full response:', JSON.stringify(downloadResponse.data, null, 2));
                        
                        const profile = downloadResponse.data[0];
                        
                        // COMPREHENSIVE: Extract EVERY possible field from Bright Data response
                        const extractedData = {
                            // BASIC PROFILE INFO
                            fullName: profile.name || null,
                            firstName: profile.first_name || (profile.name ? profile.name.split(' ')[0] : null),
                            lastName: profile.last_name || (profile.name ? profile.name.split(' ').slice(1).join(' ') : null),
                            headline: profile.position || profile.headline || null,
                            summary: profile.about || profile.summary || null,
                            location: profile.city || profile.location || null,
                            industry: profile.industry || null,
                            connectionsCount: profile.connections || profile.connections_count || null,
                            followersCount: profile.followers || profile.followers_count || null,
                            profileImageUrl: profile.avatar || profile.profile_picture || profile.photo_url || profile.image || null,
                            bannerImageUrl: profile.banner_image || profile.background_image || null,
                            
                            // CURRENT COMPANY INFO
                            currentCompany: profile.current_company || profile.current_company_name || null,
                            currentCompanyId: profile.current_company_company_id || profile.current_company_id || null,
                            currentCompanyUrl: profile.current_company_url || null,
                            
                            // COMPREHENSIVE EXPERIENCE - Extract ALL job history
                            experience: (() => {
                                const exp = profile.experience || profile.positions || [];
                                if (Array.isArray(exp)) {
                                    return exp.map(job => ({
                                        title: job.title || job.position || job.job_title || null,
                                        company: job.company || job.company_name || null,
                                        companyId: job.company_id || null,
                                        companyUrl: job.company_url || job.company_link || null,
                                        location: job.location || null,
                                        duration: job.duration || job.period || null,
                                        startDate: job.start_date || job.started_on || null,
                                        endDate: job.end_date || job.ended_on || null,
                                        description: job.description || job.summary || null,
                                        isCurrent: job.is_current || job.current || false
                                    }));
                                }
                                return exp ? [exp] : [];
                            })(),
                            
                            // COMPREHENSIVE EDUCATION - Extract ALL education history
                            education: (() => {
                                const edu = profile.education || profile.educations_details || profile.schools || [];
                                if (Array.isArray(edu)) {
                                    return edu.map(school => ({
                                        school: school.school || school.institution || school.university || null,
                                        degree: school.degree || school.degree_name || null,
                                        fieldOfStudy: school.field_of_study || school.field || school.major || null,
                                        startYear: school.start_year || school.from_year || null,
                                        endYear: school.end_year || school.to_year || null,
                                        grade: school.grade || school.gpa || null,
                                        activities: school.activities || null,
                                        description: school.description || null
                                    }));
                                }
                                return edu ? [edu] : [];
                            })(),
                            
                            // CERTIFICATIONS
                            certifications: (() => {
                                const certs = profile.certifications || profile.certificates || [];
                                if (Array.isArray(certs)) {
                                    return certs.map(cert => ({
                                        name: cert.name || cert.title || null,
                                        authority: cert.authority || cert.issuer || cert.organization || null,
                                        licenseNumber: cert.license_number || cert.credential_id || null,
                                        startDate: cert.start_date || cert.issued_on || null,
                                        endDate: cert.end_date || cert.expires_on || null,
                                        url: cert.url || cert.credential_url || null
                                    }));
                                }
                                return certs ? [certs] : [];
                            })(),
                            
                            // SKILLS - Handle both array and string formats
                            skills: (() => {
                                if (Array.isArray(profile.skills)) {
                                    return profile.skills.map(skill => typeof skill === 'string' ? skill : skill.name || skill.skill || skill);
                                }
                                if (typeof profile.skills === 'string') {
                                    return profile.skills.split(',').map(s => s.trim());
                                }
                                return profile.skills ? [profile.skills] : [];
                            })(),
                            
                            // LANGUAGES
                            languages: (() => {
                                const langs = profile.languages || [];
                                if (Array.isArray(langs)) {
                                    return langs.map(lang => ({
                                        name: lang.name || lang.language || lang,
                                        proficiency: lang.proficiency || lang.level || null
                                    }));
                                }
                                return langs ? [langs] : [];
                            })(),
                            
                            // RECOMMENDATIONS
                            recommendations: profile.recommendations || [],
                            recommendationsCount: profile.recommendations_count || null,
                            
                            // VOLUNTEER EXPERIENCE
                            volunteerExperience: (() => {
                                const volunteer = profile.volunteer_experience || profile.volunteer || [];
                                if (Array.isArray(volunteer)) {
                                    return volunteer.map(vol => ({
                                        role: vol.role || vol.position || null,
                                        organization: vol.organization || vol.company || null,
                                        cause: vol.cause || null,
                                        startDate: vol.start_date || null,
                                        endDate: vol.end_date || null,
                                        description: vol.description || null
                                    }));
                                }
                                return volunteer ? [volunteer] : [];
                            })(),
                            
                            // COURSES
                            courses: (() => {
                                const courses = profile.courses || [];
                                if (Array.isArray(courses)) {
                                    return courses.map(course => ({
                                        name: course.name || course.title || null,
                                        number: course.number || null,
                                        year: course.year || null
                                    }));
                                }
                                return courses ? [courses] : [];
                            })(),
                            
                            // PUBLICATIONS
                            publications: (() => {
                                const pubs = profile.publications || [];
                                if (Array.isArray(pubs)) {
                                    return pubs.map(pub => ({
                                        title: pub.title || pub.name || null,
                                        publisher: pub.publisher || null,
                                        publishedDate: pub.published_date || pub.date || null,
                                        url: pub.url || null,
                                        description: pub.description || null
                                    }));
                                }
                                return pubs ? [pubs] : [];
                            })(),
                            
                            // PATENTS
                            patents: (() => {
                                const patents = profile.patents || [];
                                if (Array.isArray(patents)) {
                                    return patents.map(patent => ({
                                        title: patent.title || patent.name || null,
                                        issuer: patent.issuer || null,
                                        patentNumber: patent.patent_number || patent.number || null,
                                        issuedDate: patent.issued_date || patent.date || null,
                                        url: patent.url || null,
                                        description: patent.description || null
                                    }));
                                }
                                return patents ? [patents] : [];
                            })(),
                            
                            // PROJECTS
                            projects: (() => {
                                const projects = profile.projects || [];
                                if (Array.isArray(projects)) {
                                    return projects.map(project => ({
                                        name: project.name || project.title || null,
                                        startDate: project.start_date || null,
                                        endDate: project.end_date || null,
                                        url: project.url || null,
                                        description: project.description || null
                                    }));
                                }
                                return projects ? [projects] : [];
                            })(),
                            
                            // ORGANIZATIONS
                            organizations: (() => {
                                const orgs = profile.organizations || [];
                                if (Array.isArray(orgs)) {
                                    return orgs.map(org => ({
                                        name: org.name || null,
                                        position: org.position || org.role || null,
                                        startDate: org.start_date || null,
                                        endDate: org.end_date || null,
                                        description: org.description || null
                                    }));
                                }
                                return orgs ? [orgs] : [];
                            })(),
                            
                            // HONORS & AWARDS
                            honorsAndAwards: (() => {
                                const awards = profile.honors_and_awards || profile.awards || profile.honors || [];
                                if (Array.isArray(awards)) {
                                    return awards.map(award => ({
                                        title: award.title || award.name || null,
                                        issuer: award.issuer || award.organization || null,
                                        issuedDate: award.issued_date || award.date || null,
                                        description: award.description || null
                                    }));
                                }
                                return awards ? [awards] : [];
                            })(),
                            
                            // SOCIAL ACTIVITY
                            posts: profile.posts || [],
                            activity: profile.activity || [],
                            peopleAlsoViewed: profile.people_also_viewed || [],
                            
                            // METADATA
                            countryCode: profile.country_code || null,
                            linkedinId: profile.id || profile.linkedin_id || profile.linkedin_num_id || null,
                            publicIdentifier: profile.public_identifier || null,
                            linkedinUrl: profile.url || profile.input_url || null,
                            timestamp: profile.timestamp || null,
                            
                            // RAW DATA for debugging
                            rawData: profile
                        };

                        console.log('🔍 Raw profile data:', JSON.stringify(profile, null, 2));
                        console.log('✅ Comprehensive extracted data:', JSON.stringify({
                            ...extractedData,
                            rawData: '[HIDDEN FOR BREVITY]' // Don't log raw data twice
                        }, null, 2));

                        console.log(`✅ Fallback: Successfully extracted profile for: ${extractedData.fullName || 'Unknown'}`);
                        return extractedData;
                    }
                    
                } catch (downloadError) {
                    console.log(`⚠️ Fallback download attempt ${attempt} failed: ${downloadError.message}`);
                    if (attempt === maxAttempts) {
                        throw new Error(`Fallback failed after ${maxAttempts} attempts: ${downloadError.message}`);
                    }
                }
            }
            
            throw new Error(`Fallback extraction timed out after ${maxAttempts * 10} seconds`);
        }
        
        // If we get here, something unexpected happened
        throw new Error(`Unexpected response from Bright Data: Status ${scrapeResponse.status}`);
        
    } catch (error) {
        console.error('❌ Bright Data extraction error:', error.message);
        throw error;
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
        return cleanUrl;
    } catch (error) {
        return url;
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

// ==================== NEW FUNCTIONS FOR LINKEDIN URL WITH EXTRACTION ====================

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

// CHANGED: Enhanced function to create/update profile with Bright Data extraction (instead of Outscraper)
const createOrUpdateUserProfileWithExtraction = async (userId, linkedinUrl, displayName = null) => {
    try {
        const cleanUrl = cleanLinkedInUrl(linkedinUrl);
        
        // First, create/update basic profile
        const existingProfile = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        let profile;
        if (existingProfile.rows.length > 0) {
            // Update existing profile
            const result = await pool.query(
                'UPDATE user_profiles SET linkedin_url = $1, full_name = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3 RETURNING *',
                [cleanUrl, displayName, userId]
            );
            profile = result.rows[0];
        } else {
            // Create new profile
            const result = await pool.query(
                'INSERT INTO user_profiles (user_id, linkedin_url, full_name) VALUES ($1, $2, $3) RETURNING *',
                [userId, cleanUrl, displayName]
            );
            profile = result.rows[0];
        }
        
        // Mark extraction as attempted
        await pool.query(
            'UPDATE user_profiles SET data_extraction_status = $1, extraction_attempted_at = CURRENT_TIMESTAMP, extraction_error = NULL WHERE user_id = $2',
            ['in_progress', userId]
        );

        try {
            // Extract LinkedIn data using Bright Data
            const extractedData = await extractLinkedInProfile(cleanUrl);
            
            // CHANGED: Update profile with extracted data (brightdata_data instead of outscraper_data)
            console.log('💾 Saving extracted data to database...');
            console.log('📝 Database update values:', {
                fullName: extractedData.fullName,
                firstName: extractedData.firstName,
                lastName: extractedData.lastName,
                headline: extractedData.headline,
                summary: extractedData.summary,
                location: extractedData.location,
                industry: extractedData.industry,
                connectionsCount: extractedData.connectionsCount,
                profileImageUrl: extractedData.profileImageUrl,
                experienceCount: extractedData.experience?.length || 0,
                educationCount: extractedData.education?.length || 0,
                skillsCount: extractedData.skills?.length || 0
            });
            
            const result = await pool.query(`
                UPDATE user_profiles SET 
                    full_name = COALESCE($1, full_name),
                    first_name = $2,
                    last_name = $3,
                    headline = $4,
                    summary = $5,
                    location = $6,
                    industry = $7,
                    connections_count = $8,
                    followers_count = $9,
                    profile_image_url = $10,
                    banner_image_url = $11,
                    current_company = $12,
                    current_company_id = $13,
                    current_company_url = $14,
                    experience = $15,
                    education = $16,
                    certifications = $17,
                    skills = $18,
                    languages = $19,
                    recommendations = $20,
                    recommendations_count = $21,
                    volunteer_experience = $22,
                    courses = $23,
                    publications = $24,
                    patents = $25,
                    projects = $26,
                    organizations = $27,
                    honors_and_awards = $28,
                    posts = $29,
                    activity = $30,
                    people_also_viewed = $31,
                    country_code = $32,
                    linkedin_id = $33,
                    public_identifier = $34,
                    linkedin_profile_url = $35,
                    profile_timestamp = $36,
                    brightdata_data = $37,
                    data_extraction_status = 'completed',
                    extraction_completed_at = CURRENT_TIMESTAMP,
                    extraction_error = NULL,
                    profile_analyzed = true,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $38 
                RETURNING *
            `, [
                // Basic info
                extractedData.fullName,
                extractedData.firstName,
                extractedData.lastName,
                extractedData.headline,
                extractedData.summary,
                extractedData.location,
                extractedData.industry,
                extractedData.connectionsCount,
                extractedData.followersCount,
                extractedData.profileImageUrl,
                extractedData.bannerImageUrl,
                
                // Current company
                extractedData.currentCompany,
                extractedData.currentCompanyId,
                extractedData.currentCompanyUrl,
                
                // Professional info (as JSONB)
                JSON.stringify(extractedData.experience),
                JSON.stringify(extractedData.education),
                JSON.stringify(extractedData.certifications),
                extractedData.skills, // Array of strings
                JSON.stringify(extractedData.languages),
                JSON.stringify(extractedData.recommendations),
                extractedData.recommendationsCount,
                JSON.stringify(extractedData.volunteerExperience),
                JSON.stringify(extractedData.courses),
                JSON.stringify(extractedData.publications),
                JSON.stringify(extractedData.patents),
                JSON.stringify(extractedData.projects),
                JSON.stringify(extractedData.organizations),
                JSON.stringify(extractedData.honorsAndAwards),
                
                // Social activity
                JSON.stringify(extractedData.posts),
                JSON.stringify(extractedData.activity),
                JSON.stringify(extractedData.peopleAlsoViewed),
                
                // Metadata
                extractedData.countryCode,
                extractedData.linkedinId,
                extractedData.publicIdentifier,
                extractedData.linkedinUrl,
                extractedData.timestamp,
                
                // Raw data
                JSON.stringify(extractedData.rawData),
                
                // User ID
                userId
            ]);

            console.log(`✅ COMPREHENSIVE profile data extracted and saved for user ${userId}`);
            console.log(`📊 Final extraction summary:`, {
                name: result.rows[0]?.full_name || 'Unknown',
                company: result.rows[0]?.current_company || 'Not specified',
                location: result.rows[0]?.location || 'Not specified',
                connections: result.rows[0]?.connections_count || 0,
                experience: result.rows[0]?.experience ? JSON.parse(result.rows[0].experience).length : 0,
                education: result.rows[0]?.education ? JSON.parse(result.rows[0].education).length : 0,
                certifications: result.rows[0]?.certifications ? JSON.parse(result.rows[0].certifications).length : 0,
                skills: result.rows[0]?.skills ? result.rows[0].skills.length : 0,
                status: result.rows[0]?.data_extraction_status
            });
            return result.rows[0];

        } catch (extractionError) {
            console.error('❌ Profile extraction failed:', extractionError.message);
            
            // Mark extraction as failed but don't fail the registration
            await pool.query(
                'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
                ['failed', extractionError.message, userId]
            );
            
            // Return basic profile - registration should still succeed
            return profile;
        }
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

// COMPREHENSIVE: Health Check (BRIGHT DATA WITH ALL FIELD EXTRACTION)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        version: '2.0-brightdata-comprehensive',
        timestamp: new Date().toISOString(),
        features: ['authentication', 'google-oauth', 'brightdata-integration', 'comprehensive-linkedin-extraction'],
        brightdata: {
            configured: !!BRIGHT_DATA_API_KEY,
            datasetId: BRIGHT_DATA_DATASET_ID,
            syncApi: BRIGHT_DATA_SCRAPE_URL,
            asyncApi: BRIGHT_DATA_TRIGGER_URL
        },
        dataExtraction: {
            basicProfile: ['name', 'headline', 'summary', 'location', 'industry', 'connections', 'followers'],
            professionalData: ['experience', 'education', 'certifications', 'skills', 'languages'],
            additionalData: ['recommendations', 'volunteer_experience', 'courses', 'publications', 'patents', 'projects', 'organizations', 'honors_and_awards'],
            socialActivity: ['posts', 'activity', 'people_also_viewed'],
            metadata: ['linkedin_id', 'country_code', 'public_identifier', 'timestamp']
        }
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Server with Google OAuth + Bright Data',
        status: 'running',
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

// ==================== NEW ENDPOINTS FOR BRIGHT DATA INTEGRATION ====================

// CHANGED: Update user profile with LinkedIn URL and trigger extraction (ENHANCED FOR BRIGHT DATA)
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
        
        // CHANGED: Create or update user profile WITH BRIGHT DATA EXTRACTION
        const profile = await createOrUpdateUserProfileWithExtraction(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        // Get updated user data
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated and extraction initiated',
            data: {
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.display_name,
                    packageType: updatedUser.package_type,
                    credits: updatedUser.credits_remaining
                },
                profile: {
                    // BASIC INFO
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
                    currentCompany: profile.current_company,
                    
                    // COMPREHENSIVE DATA COUNTS (for UI display)
                    experienceCount: profile.experience ? (Array.isArray(profile.experience) ? profile.experience.length : 1) : 0,
                    educationCount: profile.education ? (Array.isArray(profile.education) ? profile.education.length : 1) : 0,
                    certificationsCount: profile.certifications ? (Array.isArray(profile.certifications) ? profile.certifications.length : 1) : 0,
                    skillsCount: profile.skills ? profile.skills.length : 0,
                    languagesCount: profile.languages ? (Array.isArray(profile.languages) ? profile.languages.length : 1) : 0,
                    publicationsCount: profile.publications ? (Array.isArray(profile.publications) ? profile.publications.length : 1) : 0,
                    projectsCount: profile.projects ? (Array.isArray(profile.projects) ? profile.projects.length : 1) : 0,
                    
                    // EXTRACTION STATUS
                    extractionStatus: profile.data_extraction_status,
                    extractionCompleted: profile.extraction_completed_at,
                    extractionError: profile.extraction_error,
                    profileAnalyzed: profile.profile_analyzed
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} with LinkedIn: ${linkedinUrl} (Status: ${profile.data_extraction_status})`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Retry extraction for failed profiles (NEW)
app.post('/retry-extraction', authenticateToken, async (req, res) => {
    try {
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
        
        // Re-run extraction
        const updatedProfile = await createOrUpdateUserProfileWithExtraction(
            req.user.id,
            profile.linkedin_url,
            req.user.display_name
        );
        
        res.json({
            success: true,
            message: 'Profile extraction retried',
            data: {
                profile: {
                    extractionStatus: updatedProfile.data_extraction_status,
                    profileAnalyzed: updatedProfile.profile_analyzed,
                    fullName: updatedProfile.full_name,
                    headline: updatedProfile.headline,
                    extractionError: updatedProfile.extraction_error
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

// ==================== EXISTING ENDPOINTS (UNCHANGED BUT ENHANCED) ====================

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
                    // BASIC INFO
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
                    
                    // CURRENT COMPANY
                    currentCompany: profile.current_company,
                    currentCompanyId: profile.current_company_id,
                    currentCompanyUrl: profile.current_company_url,
                    
                    // COMPREHENSIVE PROFESSIONAL DATA
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
                    
                    // SOCIAL ACTIVITY
                    posts: profile.posts,
                    activity: profile.activity,
                    peopleAlsoViewed: profile.people_also_viewed,
                    
                    // METADATA
                    countryCode: profile.country_code,
                    linkedinId: profile.linkedin_id,
                    publicIdentifier: profile.public_identifier,
                    linkedinProfileUrl: profile.linkedin_profile_url,
                    profileTimestamp: profile.profile_timestamp,
                    
                    // EXTRACTION STATUS
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
            console.log('🚀 Msgly.AI Server with COMPREHENSIVE Bright Data Integration Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected`);
            console.log(`🔐 Auth: JWT + Google OAuth Ready`);
            console.log(`🔍 Bright Data: ${BRIGHT_DATA_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`⚡ API: Synchronous (immediate response) + Async fallback`);
            console.log(`💳 Packages: Free (Available), Premium (Coming Soon)`);
            console.log(`💰 Billing: Pay-As-You-Go & Monthly`);
            console.log(`🔗 LinkedIn Extraction: COMPREHENSIVE (All Fields)`);
            console.log(`📊 Data Captured: Profile, Experience, Education, Certifications, Skills, Languages, etc.`);
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
