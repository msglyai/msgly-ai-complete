// Msgly.AI Simple Server - Step 1: Auth + Package Selection Only
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// CORS for Chrome Extensions
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://www.linkedin.com',
            'https://linkedin.com',
            'http://localhost:3000'
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
    credentials: false
};

app.use(cors(corsOptions));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==================== SIMPLE DATABASE SETUP ====================

const initDB = async () => {
    try {
        console.log('🗃️ Creating simple database tables...');

        // Users table with package selection
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                package_type VARCHAR(50) DEFAULT 'free',
                billing_model VARCHAR(50) DEFAULT 'monthly',
                credits_remaining INTEGER DEFAULT 30,
                subscription_status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Simple user profiles table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) UNIQUE,
                linkedin_url VARCHAR(500),
                full_name VARCHAR(255),
                first_name VARCHAR(100),
                last_name VARCHAR(100),
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

        console.log('✅ Simple database tables created successfully');
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
};

// ==================== SIMPLE DATABASE FUNCTIONS ====================

const createUser = async (email, passwordHash, packageType = 'free', billingModel = 'monthly') => {
    // Set credits based on package and billing model
    const creditsMap = {
        'free': 30, // Same for both billing models
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
    res.status(200).json({
        status: 'healthy',
        version: '1.0-simple',
        timestamp: new Date().toISOString(),
        features: ['authentication', 'package-selection', 'simple-database']
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI Simple Server - Step 1',
        status: 'running',
        endpoints: [
            'POST /register',
            'POST /login', 
            'GET /profile (protected)',
            'GET /packages',
            'GET /health'
        ]
    });
});

// User Registration with Package Selection
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
        
        // Valid packages
        const validPackages = ['free', 'silver', 'gold', 'platinum'];
        if (!validPackages.includes(packageType)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid package type. Choose: free, silver, gold, or platinum'
            });
        }
        
        // Valid billing models
        const validBillingModels = ['payAsYouGo', 'monthly'];
        const finalBillingModel = billingModel || 'monthly';
        if (!validBillingModels.includes(finalBillingModel)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid billing model. Choose: payAsYouGo or monthly'
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
        const newUser = await createUser(email, passwordHash, packageType, finalBillingModel);
        
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
        
        console.log(`✅ User registered: ${newUser.email} with ${packageType} package (${finalBillingModel})`);
        
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
        
        // Get user
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
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
                    packageType: user.package_type,
                    billingModel: user.billing_model,
                    credits: user.credits_remaining,
                    subscriptionStatus: user.subscription_status
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

// Get User Profile (Protected)
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                user: {
                    id: req.user.id,
                    email: req.user.email,
                    packageType: req.user.package_type,
                    billingModel: req.user.billing_model,
                    credits: req.user.credits_remaining,
                    subscriptionStatus: req.user.subscription_status,
                    createdAt: req.user.created_at
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

// Get Available Packages (Matches your index.html pricing exactly)
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
                features: ['30 Credits per month', 'Chrome extension', 'Advanced AI analysis', 'No credit card required']
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 100,
                price: 12,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['100 Credits', 'Chrome extension', 'Advanced AI analysis', 'Credits never expire']
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 500,
                price: 35,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['500 Credits', 'Chrome extension', 'Advanced AI analysis', 'Credits never expire']
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1500,
                price: 70,
                period: '/one-time',
                billing: 'payAsYouGo',
                validity: 'Credits never expire',
                features: ['1,500 Credits', 'Chrome extension', 'Advanced AI analysis', 'Credits never expire']
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
                features: ['30 Credits per month', 'Chrome extension', 'Advanced AI analysis', 'No credit card required']
            },
            {
                id: 'silver',
                name: 'Silver',
                credits: 100,
                price: 8.60,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['100 Credits', 'Chrome extension', 'Advanced AI analysis', '7-day free trial included']
            },
            {
                id: 'gold',
                name: 'Gold',
                credits: 500,
                price: 25.20,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['500 Credits', 'Chrome extension', 'Advanced AI analysis', '7-day free trial included']
            },
            {
                id: 'platinum',
                name: 'Platinum',
                credits: 1500,
                price: 50.40,
                period: '/month',
                billing: 'monthly',
                validity: '7-day free trial included',
                features: ['1,500 Credits', 'Chrome extension', 'Advanced AI analysis', '7-day free trial included']
            }
        ]
    };
    
    res.json({
        success: true,
        data: { packages }
    });
});
// ==================== LINKEDIN EXTRACTION ENDPOINT ====================

// Function to simulate LinkedIn data extraction (we'll make this real later)
const extractLinkedInData = async (linkedinUrl) => {
    console.log(`🔍 Extracting LinkedIn data from: ${linkedinUrl}`);
    
    // For now, we'll simulate the extraction with comprehensive fake data
    // Later we'll replace this with real scraping logic
    const simulatedData = {
        // Basic Profile Info
        full_name: "Ziv Shechory",
        first_name: "Ziv", 
        last_name: "Shechory",
        headline: "AI & Sales Technology Executive | Building the Future of Personalized Outreach",
        summary: "Experienced technology leader with 8+ years building AI-powered sales tools. Currently building Msgly.AI to revolutionize LinkedIn outreach with GPT-4 personalization. Previously led product teams at major tech companies.",
        current_position: "Founder & CEO",
        current_company: "Msgly.AI",
        location: "Tel Aviv, Israel",
        industry: "Software Development",
        connections_count: 847,
        followers_count: 1234,
        profile_image_url: "https://media.licdn.com/dms/image/profile-pic.jpg",
        
        // Complete Work Experience
        experience_data: [
            {
                company: "Msgly.AI",
                title: "Founder & CEO", 
                duration: "2024 - Present",
                location: "Tel Aviv, Israel",
                description: "Building AI-powered LinkedIn outreach platform using GPT-4.1. Leading product development, AI integration, and go-to-market strategy. Serving 1000+ sales professionals.",
                skills_used: ["Product Management", "AI/ML", "SaaS", "Team Leadership"]
            },
            {
                company: "TechCorp International",
                title: "Senior Product Manager",
                duration: "2021 - 2024", 
                location: "Tel Aviv, Israel",
                description: "Led product strategy for B2B sales automation platform. Increased user engagement by 340% and revenue by $2.8M annually. Managed team of 12 engineers and designers.",
                skills_used: ["Product Strategy", "B2B SaaS", "Data Analytics", "Agile"]
            },
            {
                company: "StartupXYZ",
                title: "Marketing Technology Manager",
                duration: "2019 - 2021",
                location: "Tel Aviv, Israel", 
                description: "Built marketing automation infrastructure from scratch. Implemented CRM systems, lead scoring, and email campaigns that generated $1.2M in pipeline.",
                skills_used: ["Marketing Automation", "CRM", "Lead Generation", "Analytics"]
            }
        ],
        
        // Education History
        education_data: [
            {
                school: "Tel Aviv University",
                degree: "MBA",
                field: "Business Administration & Technology Management",
                years: "2017 - 2019",
                activities: "Technology Entrepreneurship Club, Product Management Society"
            },
            {
                school: "Technion - Israel Institute of Technology", 
                degree: "B.Sc",
                field: "Computer Science",
                years: "2013 - 2017",
                activities: "Programming Competition Team, AI Research Lab Assistant"
            }
        ],
        
        // Skills & Endorsements
        skills_data: [
            {"skill": "Product Management", "endorsements": 47, "category": "Professional"},
            {"skill": "Artificial Intelligence", "endorsements": 34, "category": "Technical"},
            {"skill": "SaaS", "endorsements": 28, "category": "Professional"},
            {"skill": "JavaScript", "endorsements": 23, "category": "Technical"},
            {"skill": "Team Leadership", "endorsements": 19, "category": "Leadership"},
            {"skill": "Marketing Automation", "endorsements": 15, "category": "Professional"},
            {"skill": "Data Analytics", "endorsements": 12, "category": "Technical"},
            {"skill": "Business Strategy", "endorsements": 9, "category": "Leadership"}
        ],
        
        // Certifications
        certifications_data: [
            {
                name: "OpenAI GPT-4 Certification",
                issuer: "OpenAI",
                date: "2024",
                credential_id: "OAI-GPT4-2024-ZS"
            },
            {
                name: "Google Analytics Certified",
                issuer: "Google",
                date: "2023", 
                credential_id: "GA-CERT-2023-ZS"
            }
        ],
        
        // Languages
        languages_data: [
            {"language": "English", "proficiency": "Professional"},
            {"language": "Hebrew", "proficiency": "Native"},
            {"language": "Spanish", "proficiency": "Conversational"}
        ],
        
        // Recent Activity
        activity_data: [
            {
                type: "post",
                content: "Excited to announce Msgly.AI has reached 1000+ users! 🚀 The response to AI-powered LinkedIn outreach has been incredible. Thank you to our amazing community!",
                date: "2025-07-28",
                likes: 147,
                comments: 23,
                shares: 8
            },
            {
                type: "article", 
                title: "The Future of Sales: Why AI Personalization is the Game Changer",
                content: "In today's saturated market, generic outreach fails. Here's how AI is revolutionizing sales communications...",
                date: "2025-07-25",
                likes: 89,
                comments: 15,
                shares: 12
            },
            {
                type: "comment",
                content: "Absolutely agree! We're seeing similar trends in the Israeli tech ecosystem. AI-first approaches are becoming table stakes.",
                post_author: "Sarah Johnson",
                date: "2025-07-20",
                likes: 5
            }
        ],
        
        // AI Analysis (will be populated later by GPT)
        ai_analysis: {
            personality: {
                communication_style: "direct_professional",
                likely_interests: ["AI/ML", "SaaS", "entrepreneurship", "sales_technology"],
                career_stage: "senior_professional_founder",
                networking_approach: "value_focused_relationship_building"
            },
            message_recommendations: {
                tone: "professional_warm",
                topics: ["AI_innovation", "product_management", "startup_growth"],
                avoid: ["overly_casual", "generic_sales_pitches"]
            }
        }
    };
    
    return simulatedData;
};

// Function to store LinkedIn data in database
const storeLinkedInProfile = async (userId, linkedinUrl, profileData) => {
    try {
        // Check if profile already exists
        const existingProfile = await pool.query(
            'SELECT id FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (existingProfile.rows.length > 0) {
            // Update existing profile
            const result = await pool.query(`
                UPDATE user_profiles SET 
                    linkedin_url = $2,
                    full_name = $3,
                    first_name = $4,
                    last_name = $5,
                    headline = $6,
                    summary = $7,
                    current_position = $8,
                    current_company = $9,
                    location = $10,
                    industry = $11,
                    connections_count = $12,
                    followers_count = $13,
                    profile_image_url = $14,
                    experience_data = $15,
                    education_data = $16,
                    skills_data = $17,
                    certifications_data = $18,
                    languages_data = $19,
                    activity_data = $20,
                    ai_analysis = $21,
                    extraction_date = CURRENT_TIMESTAMP,
                    extraction_status = 'completed',
                    profile_analyzed = TRUE,
                    raw_linkedin_data = $22,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                RETURNING *
            `, [
                userId, linkedinUrl, profileData.full_name, profileData.first_name, profileData.last_name,
                profileData.headline, profileData.summary, profileData.current_position, profileData.current_company,
                profileData.location, profileData.industry, profileData.connections_count, profileData.followers_count,
                profileData.profile_image_url, JSON.stringify(profileData.experience_data), JSON.stringify(profileData.education_data),
                JSON.stringify(profileData.skills_data), JSON.stringify(profileData.certifications_data), JSON.stringify(profileData.languages_data),
                JSON.stringify(profileData.activity_data), JSON.stringify(profileData.ai_analysis), JSON.stringify(profileData)
            ]);
            return result.rows[0];
        } else {
            // Create new profile
            const result = await pool.query(`
                INSERT INTO user_profiles (
                    user_id, linkedin_url, full_name, first_name, last_name, headline, summary,
                    current_position, current_company, location, industry, connections_count, followers_count,
                    profile_image_url, experience_data, education_data, skills_data, certifications_data,
                    languages_data, activity_data, ai_analysis, extraction_date, extraction_status,
                    profile_analyzed, raw_linkedin_data
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                    CURRENT_TIMESTAMP, 'completed', TRUE, $22
                ) RETURNING *
            `, [
                userId, linkedinUrl, profileData.full_name, profileData.first_name, profileData.last_name,
                profileData.headline, profileData.summary, profileData.current_position, profileData.current_company,
                profileData.location, profileData.industry, profileData.connections_count, profileData.followers_count,
                profileData.profile_image_url, JSON.stringify(profileData.experience_data), JSON.stringify(profileData.education_data),
                JSON.stringify(profileData.skills_data), JSON.stringify(profileData.certifications_data), JSON.stringify(profileData.languages_data),
                JSON.stringify(profileData.activity_data), JSON.stringify(profileData.ai_analysis), JSON.stringify(profileData)
            ]);
            return result.rows[0];
        }
    } catch (error) {
        console.error('❌ Error storing LinkedIn profile:', error);
        throw error;
    }
};

// LinkedIn Extraction API Endpoint
app.post('/extract-linkedin', authenticateToken, async (req, res) => {
    console.log('🔍 LinkedIn extraction request from user:', req.user.id);
    
    try {
        const { linkedinUrl } = req.body;
        
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
                error: 'Please provide a valid LinkedIn profile URL (e.g., https://linkedin.com/in/username)'
            });
        }
        
        // Extract LinkedIn data
        const profileData = await extractLinkedInData(linkedinUrl);
        
        // Store in database
        const savedProfile = await storeLinkedInProfile(req.user.id, linkedinUrl, profileData);
        
        // Return success with preview of extracted data
        res.json({
            success: true,
            message: 'LinkedIn profile extracted and analyzed successfully!',
            data: {
                profile: {
                    id: savedProfile.id,
                    full_name: profileData.full_name,
                    headline: profileData.headline,
                    current_position: profileData.current_position,
                    current_company: profileData.current_company,
                    location: profileData.location,
                    connections_count: profileData.connections_count,
                    total_experience_jobs: profileData.experience_data.length,
                    total_education_entries: profileData.education_data.length,
                    total_skills: profileData.skills_data.length,
                    total_certifications: profileData.certifications_data.length,
                    recent_activity_count: profileData.activity_data.length,
                    extraction_date: savedProfile.extraction_date,
                    ai_analysis_ready: true
                }
            }
        });
        
        console.log(`✅ LinkedIn profile extracted for user ${req.user.id}: ${profileData.full_name}`);
        
    } catch (error) {
        console.error('❌ LinkedIn extraction error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to extract LinkedIn profile',
            details: error.message
        });
    }
});
// Simple error handling
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        availableRoutes: ['POST /register', 'POST /login', 'GET /profile', 'GET /packages', 'GET /health']
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
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL environment variable is required');
        process.exit(1);
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
            console.log('🚀 Msgly.AI Simple Server Started!');
            console.log(`📍 Port: ${PORT}`);
            console.log(`🗃️ Database: Connected`);
            console.log(`🔐 Auth: JWT Ready`);
            console.log(`💳 Packages: Free, Silver, Gold, Platinum`);
            console.log(`💰 Billing: Pay-As-You-Go & Monthly`);
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
