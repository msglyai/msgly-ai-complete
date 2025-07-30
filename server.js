// Msgly.AI Server with Google OAuth + Fixed ScrapingDog LinkedIn Integration
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://apis.google.com"],
            connectSrc: ["'self'", "https://accounts.google.com", "https://www.googleapis.com"],
            frameSrc: ["https://accounts.google.com"],
        },
    },
}));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ScrapingDog API configuration (FIXED)
const SCRAPINGDOG_API_KEY = process.env.SCRAPINGDOG_API_KEY;
const SCRAPINGDOG_BASE_URL = 'https://api.scrapingdog.com/linkedin';

// Database configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Google OAuth configuration
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

// Middleware to authenticate JWT tokens
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Helper function to validate LinkedIn URL
const isValidLinkedInUrl = (url) => {
    try {
        const linkedinUrl = new URL(url);
        return linkedinUrl.hostname === 'www.linkedin.com' && 
               linkedinUrl.pathname.startsWith('/in/');
    } catch {
        return false;
    }
};

// FIXED LinkedIn extraction function with proper ScrapingDog implementation
const extractLinkedInProfile = async (linkedinUrl) => {
    try {
        console.log(`🔍 Extracting LinkedIn profile: ${linkedinUrl}`);
        
        if (!SCRAPINGDOG_API_KEY) {
            throw new Error('ScrapingDog API key not configured');
        }
        
        // Extract username from LinkedIn URL
        const url = new URL(linkedinUrl);
        const pathname = url.pathname;
        const match = pathname.match(/\/in\/([^\/\?]+)/);
        
        if (!match) {
            throw new Error('Invalid LinkedIn URL format');
        }
        
        const username = match[1];
        console.log(`👤 Extracted username: ${username}`);
        
        // First attempt - normal request
        console.log('🔄 Attempting normal extraction...');
        let response = await axios.get(SCRAPINGDOG_BASE_URL, {
            params: {
                api_key: SCRAPINGDOG_API_KEY,
                type: 'profile',
                linkId: username
            },
            timeout: 45000
        });

        // Handle 202 status (processing) - wait and retry
        if (response.status === 202) {
            console.log('⏳ Profile is being processed by ScrapingDog, waiting 3 minutes...');
            await new Promise(resolve => setTimeout(resolve, 180000)); // 3 minutes
            
            response = await axios.get(SCRAPINGDOG_BASE_URL, {
                params: {
                    api_key: SCRAPINGDOG_API_KEY,
                    type: 'profile',
                    linkId: username
                },
                timeout: 45000
            });
        }

        // If still failing, try with private parameter
        if (response.status !== 200 || !response.data) {
            console.log('🔄 Attempting with private parameter...');
            response = await axios.get(SCRAPINGDOG_BASE_URL, {
                params: {
                    api_key: SCRAPINGDOG_API_KEY,
                    type: 'profile',
                    linkId: username,
                    private: 'true'
                },
                timeout: 45000
            });

            // Handle 202 with private parameter
            if (response.status === 202) {
                console.log('⏳ Private extraction is being processed, waiting 3 minutes...');
                await new Promise(resolve => setTimeout(resolve, 180000)); // 3 minutes
                
                response = await axios.get(SCRAPINGDOG_BASE_URL, {
                    params: {
                        api_key: SCRAPINGDOG_API_KEY,
                        type: 'profile',
                        linkId: username,
                        private: 'true'
                    },
                    timeout: 45000
                });
            }
        }

        if (response.data && response.status === 200) {
            // Handle both array and object responses
            let profile = response.data;
            if (Array.isArray(profile) && profile.length > 0) {
                profile = profile[0];
            }
            
            // Extract and structure the data
            const extractedData = {
                fullName: profile.name || profile.full_name || null,
                firstName: profile.first_name || (profile.name ? profile.name.split(' ')[0] : null),
                lastName: profile.last_name || (profile.name ? profile.name.split(' ').slice(1).join(' ') : null),
                headline: profile.headline || profile.description || null,
                summary: profile.summary || profile.about || null,
                location: profile.location || profile.address || null,
                industry: profile.industry || null,
                connectionsCount: profile.connections || profile.connections_count || null,
                profileImageUrl: profile.profile_image || profile.avatar || null,
                experience: profile.experience || [],
                education: profile.education || [],
                skills: profile.skills || [],
                rawData: profile
            };

            console.log(`✅ Successfully extracted profile for: ${extractedData.fullName || 'Unknown'}`);
            return extractedData;
        } else {
            throw new Error(`ScrapingDog returned status ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ ScrapingDog extraction error:', error.message);
        if (error.response) {
            console.error('❌ Response status:', error.response.status);
            console.error('❌ Response data:', error.response.data);
        }
        throw error;
    }
};

// Create or update user profile with LinkedIn extraction
const createOrUpdateUserProfileWithExtraction = async (userData) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log(`🔄 Creating/updating profile for user: ${userData.email}`);

        // Check if user already exists
        const existingUserResult = await client.query(
            'SELECT * FROM user_profiles WHERE email = $1',
            [userData.email]
        );

        let userId;
        let extractedData = null;
        let extractionError = null;

        // Attempt LinkedIn extraction if URL provided
        if (userData.linkedinUrl) {
            try {
                console.log(`🔍 Starting LinkedIn extraction for: ${userData.linkedinUrl}`);
                extractedData = await extractLinkedInProfile(userData.linkedinUrl);
                console.log(`✅ LinkedIn extraction successful for: ${userData.email}`);
            } catch (error) {
                console.error(`❌ LinkedIn extraction failed for ${userData.email}:`, error.message);
                extractionError = error.message;
            }
        }

        if (existingUserResult.rows.length > 0) {
            // Update existing user
            userId = existingUserResult.rows[0].id;
            
            const updateQuery = `
                UPDATE user_profiles 
                SET 
                    google_id = $2,
                    name = $3,
                    email = $4,
                    linkedin_url = $5,
                    package_type = $6,
                    registration_completed = $7,
                    updated_at = CURRENT_TIMESTAMP,
                    extraction_attempted_at = CURRENT_TIMESTAMP,
                    extraction_completed_at = $8,
                    extraction_error = $9,
                    scrapingdog_data = $10,
                    extracted_name = $11,
                    extracted_headline = $12,
                    extracted_summary = $13,
                    extracted_location = $14,
                    extracted_industry = $15
                WHERE id = $1
                RETURNING *
            `;
            
            const result = await client.query(updateQuery, [
                userId,
                userData.googleId,
                userData.name,
                userData.email,
                userData.linkedinUrl,
                userData.packageType,
                userData.registrationCompleted,
                extractedData ? 'CURRENT_TIMESTAMP' : null,
                extractionError,
                extractedData ? JSON.stringify(extractedData) : null,
                extractedData?.fullName,
                extractedData?.headline,
                extractedData?.summary,
                extractedData?.location,
                extractedData?.industry
            ]);
            
            console.log(`✅ Updated existing user profile: ${userData.email}`);
            return result.rows[0];
        } else {
            // Create new user
            const insertQuery = `
                INSERT INTO user_profiles (
                    google_id, name, email, linkedin_url, package_type, 
                    registration_completed, extraction_attempted_at, 
                    extraction_completed_at, extraction_error, scrapingdog_data,
                    extracted_name, extracted_headline, extracted_summary, 
                    extracted_location, extracted_industry
                ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING *
            `;
            
            const result = await client.query(insertQuery, [
                userData.googleId,
                userData.name,
                userData.email,
                userData.linkedinUrl,
                userData.packageType,
                userData.registrationCompleted,
                extractedData ? 'CURRENT_TIMESTAMP' : null,
                extractionError,
                extractedData ? JSON.stringify(extractedData) : null,
                extractedData?.fullName,
                extractedData?.headline,
                extractedData?.summary,
                extractedData?.location,
                extractedData?.industry
            ]);
            
            console.log(`✅ Created new user profile: ${userData.email}`);
            await client.query('COMMIT');
            return result.rows[0];
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Database error in createOrUpdateUserProfileWithExtraction:', error);
        throw error;
    } finally {
        client.release();
    }
};

// Routes

// Serve the sign-up page
app.get('/sign-up', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-up.html'));
});

// Serve other static pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Google OAuth verification endpoint
app.post('/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        console.log('🔐 Verifying Google token...');
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        console.log('✅ Google token verified for:', payload.email);

        // Generate JWT token
        const jwtToken = jwt.sign(
            { 
                userId: payload.sub,
                email: payload.email,
                name: payload.name 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            user: {
                id: payload.sub,
                name: payload.name,
                email: payload.email,
                picture: payload.picture
            },
            token: jwtToken
        });
    } catch (error) {
        console.error('❌ Google authentication error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Complete registration endpoint
app.post('/api/complete-registration', authenticateToken, async (req, res) => {
    try {
        const { 
            packageType, 
            linkedinUrl, 
            termsAccepted, 
            googleId, 
            name, 
            email 
        } = req.body;

        console.log(`🚀 Starting registration completion for: ${email}`);

        // Validation
        if (!termsAccepted) {
            return res.status(400).json({ error: 'Terms must be accepted' });
        }

        if (!packageType || !['free', 'premium'].includes(packageType)) {
            return res.status(400).json({ error: 'Valid package type required' });
        }

        if (linkedinUrl && !isValidLinkedInUrl(linkedinUrl)) {
            return res.status(400).json({ error: 'Invalid LinkedIn URL format' });
        }

        // Create/update user profile with LinkedIn extraction
        const userData = {
            googleId: googleId || req.user.userId,
            name: name || req.user.name,
            email: email || req.user.email,
            linkedinUrl,
            packageType,
            registrationCompleted: true
        };

        console.log(`📝 Processing registration for: ${userData.email}`);
        const userProfile = await createOrUpdateUserProfileWithExtraction(userData);

        // Response with extraction results
        const response = {
            success: true,
            message: 'Registration completed successfully',
            user: {
                id: userProfile.id,
                name: userProfile.name,
                email: userProfile.email,
                packageType: userProfile.package_type,
                linkedinUrl: userProfile.linkedin_url,
                registrationCompleted: userProfile.registration_completed
            }
        };

        // Add extraction results if available
        if (userProfile.scrapingdog_data) {
            try {
                const extractedData = JSON.parse(userProfile.scrapingdog_data);
                response.linkedinData = {
                    fullName: extractedData.fullName,
                    headline: extractedData.headline,
                    location: extractedData.location,
                    industry: extractedData.industry,
                    summary: extractedData.summary ? extractedData.summary.substring(0, 200) + '...' : null
                };
                response.message += ' with LinkedIn profile extracted successfully';
            } catch (parseError) {
                console.error('❌ Error parsing LinkedIn data:', parseError);
            }
        } else if (userProfile.extraction_error) {
            response.linkedinData = null;
            response.extractionError = userProfile.extraction_error;
            response.message += ' (LinkedIn extraction failed)';
        }

        console.log(`✅ Registration completed for: ${userData.email}`);
        res.json(response);

    } catch (error) {
        console.error('❌ Registration completion error:', error);
        res.status(500).json({ 
            error: 'Registration failed', 
            details: error.message 
        });
    }
});

// Get user profile endpoint
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM user_profiles WHERE email = $1',
            [req.user.email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        const profile = result.rows[0];
        res.json({
            success: true,
            profile: {
                id: profile.id,
                name: profile.name,
                email: profile.email,
                linkedinUrl: profile.linkedin_url,
                packageType: profile.package_type,
                registrationCompleted: profile.registration_completed,
                createdAt: profile.created_at,
                updatedAt: profile.updated_at,
                extractedData: profile.scrapingdog_data ? JSON.parse(profile.scrapingdog_data) : null,
                extractionError: profile.extraction_error
            }
        });
    } catch (error) {
        console.error('❌ Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Health Check (ENHANCED)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        version: '4.0-scrapingdog-fixed',
        timestamp: new Date().toISOString(),
        features: ['authentication', 'google-oauth', 'scrapingdog-integration', 'linkedin-extraction'],
        scrapingdog: {
            configured: !!SCRAPINGDOG_API_KEY,
            apiUrl: SCRAPINGDOG_BASE_URL,
            status: 'active'
        }
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Server Error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Database initialization
const initializeDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                id SERIAL PRIMARY KEY,
                google_id VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                linkedin_url VARCHAR(500),
                package_type VARCHAR(50) NOT NULL DEFAULT 'free',
                registration_completed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                extraction_attempted_at TIMESTAMP,
                extraction_completed_at TIMESTAMP,
                extraction_error TEXT,
                scrapingdog_data JSONB,
                extracted_name VARCHAR(255),
                extracted_headline TEXT,
                extracted_summary TEXT,
                extracted_location VARCHAR(255),
                extracted_industry VARCHAR(255)
            )
        `);
        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
    }
};

// Server startup
const startServer = async () => {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log('\n🚀 Msgly.AI Server Status:');
            console.log(`   📡 Server running on port ${PORT}`);
            console.log(`   🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`   🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`   🗄️  Database: ${process.env.DATABASE_URL ? 'Connected ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`   🔍 ScrapingDog: ${SCRAPINGDOG_API_KEY ? 'Configured ✅' : 'NOT CONFIGURED ⚠️'}`);
            console.log(`   🔑 JWT Secret: ${JWT_SECRET !== 'fallback-secret-key' ? 'Configured ✅' : 'Using fallback ⚠️'}`);
            console.log('\n✅ All systems ready!');
        });
    } catch (error) {
        console.error('❌ Server startup error:', error);
        process.exit(1);
    }

    // Environment validation
    if (!process.env.GOOGLE_CLIENT_ID) {
        console.warn('⚠️ Warning: GOOGLE_CLIENT_ID not set - OAuth will fail');
    }
    if (!process.env.DATABASE_URL) {
        console.warn('⚠️ Warning: DATABASE_URL not set - database operations will fail');
    }
    if (!SCRAPINGDOG_API_KEY) {
        console.warn('⚠️ Warning: SCRAPINGDOG_API_KEY not set - profile extraction will fail');
    }
};

startServer();
