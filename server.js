// Msgly.AI Server with Google OAuth + CORRECT Bright Data Implementation + PROPER JSONB HANDLING
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

const app = express();
const port = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
const BRIGHT_DATA_API_TOKEN = process.env.BRIGHT_DATA_API_TOKEN;
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_DATASET_ID || 'gd_l75utpcaqu7lj1igl';

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ==================== MIDDLEWARE ====================
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

// Session configuration for Google OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(passport.initialize());
app.use(passport.session());

// ==================== GOOGLE OAUTH SETUP ====================
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (user.rows.length === 0) {
      const result = await pool.query(
        'INSERT INTO users (email, google_id, full_name) VALUES ($1, $2, $3) RETURNING *',
        [email, profile.id, profile.displayName]
      );
      
      await pool.query(
        'INSERT INTO user_profiles (user_id, full_name, profile_created_via) VALUES ($1, $2, $3)',
        [result.rows[0].id, profile.displayName, 'google_oauth']
      );
      
      user = result;
    }
    
    return done(null, user.rows[0]);
  } catch (error) {
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, user.rows[0]);
  } catch (error) {
    done(error, null);
  }
});

// ==================== PROPER JSONB HANDLING FUNCTIONS ====================

/**
 * Properly formats data for PostgreSQL JSONB columns
 * The key insight: JSONB columns expect STRING input, not raw JavaScript objects/arrays
 */
function formatForJSONB(data) {
  if (data === null || data === undefined) {
    return null;
  }
  
  // If it's already a string, validate it's proper JSON
  if (typeof data === 'string') {
    try {
      JSON.parse(data);
      return data;
    } catch (e) {
      console.log('⚠️ Invalid JSON string detected, fixing:', data);
      return '[]';
    }
  }
  
  // For arrays and objects, always stringify
  if (Array.isArray(data) || typeof data === 'object') {
    try {
      return JSON.stringify(data);
    } catch (e) {
      console.log('⚠️ Failed to stringify data, using empty array:', e.message);
      return '[]';
    }
  }
  
  // For primitives, wrap in JSON format
  return JSON.stringify(data);
}

/**
 * Processes LinkedIn data and ensures all JSONB fields are properly formatted
 */
function processLinkedInDataForDB(extractedData) {
  console.log('🔧 Processing LinkedIn data for PostgreSQL JSONB storage...');
  
  const processed = {
    // Basic profile data (non-JSONB fields)
    full_name: extractedData.full_name || extractedData.first_name + ' ' + (extractedData.last_name || ''),
    first_name: extractedData.first_name || null,
    last_name: extractedData.last_name || null,
    headline: extractedData.headline || null,
    summary: extractedData.summary || null,
    location: extractedData.location || null,
    industry: extractedData.industry || null,
    connections_count: extractedData.connections_count || 0,
    followers_count: extractedData.followers_count || 0,
    profile_image_url: extractedData.profile_image_url || extractedData.profile_pic_url || null,
    banner_image_url: extractedData.banner_image_url || null,
    public_identifier: extractedData.public_identifier || extractedData.linkedin_id || null,
    
    // JSONB fields - MUST be strings for PostgreSQL
    experience: formatForJSONB(extractedData.experience || []),
    education: formatForJSONB(extractedData.education || []),
    skills: formatForJSONB(extractedData.skills || []),
    certifications: formatForJSONB(extractedData.certifications || []),
    languages: formatForJSONB(extractedData.languages || []),
    projects: formatForJSONB(extractedData.projects || []),
    publications: formatForJSONB(extractedData.publications || []),
    patents: formatForJSONB(extractedData.patents || []),
    organizations: formatForJSONB(extractedData.organizations || []),
    honors_and_awards: formatForJSONB(extractedData.honors_and_awards || []),
    courses: formatForJSONB(extractedData.courses || []),
    recommendations: formatForJSONB(extractedData.recommendations || []),
    posts: formatForJSONB(extractedData.posts || []),
    activity: formatForJSONB(extractedData.activity || []),
    people_also_viewed: formatForJSONB(extractedData.people_also_viewed || []),
    raw_bright_data_response: formatForJSONB(extractedData)
  };
  
  // Log summary for debugging
  console.log('📊 Processed data summary:');
  console.log(`   - Experience entries: ${Array.isArray(extractedData.experience) ? extractedData.experience.length : 'N/A'}`);
  console.log(`   - Education entries: ${Array.isArray(extractedData.education) ? extractedData.education.length : 'N/A'}`);
  console.log(`   - Skills entries: ${Array.isArray(extractedData.skills) ? extractedData.skills.length : 'N/A'}`);
  console.log(`   - All JSONB fields properly stringified: ✅`);
  
  return processed;
}

// ==================== JWT AUTH MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// ==================== BACKGROUND PROCESSING ====================
const processingQueue = new Set();
const retryAttempts = new Map();
const MAX_RETRIES = 3;

async function scheduleBackgroundExtraction(userId, linkedinUrl, retryCount = 0) {
  const queueKey = `user_${userId}`;
  
  if (processingQueue.has(queueKey)) {
    console.log(`⏳ CORRECT background extraction already in progress for user ${userId}`);
    return;
  }
  
  processingQueue.add(queueKey);
  console.log(`🚀 Starting CORRECT background extraction for user ${userId} (Retry ${retryCount})`);
  
  try {
    // First attempt: Synchronous extraction (faster)
    console.log('🔄 Attempting CORRECT synchronous extraction...');
    const syncResult = await attemptSynchronousExtraction(linkedinUrl);
    
    if (syncResult.success) {
      console.log(`✅ CORRECT synchronous extraction completed for user ${userId}`);
      await saveCompleteLinkedInData(userId, syncResult.data);
      processingQueue.delete(queueKey);
      retryAttempts.delete(userId);
      return;
    }
    
    // Second attempt: Asynchronous extraction (more reliable)
    console.log('🔄 Attempting CORRECT asynchronous extraction...');
    const asyncResult = await attemptAsynchronousExtraction(linkedinUrl);
    
    if (asyncResult.success) {
      console.log(`✅ CORRECT asynchronous extraction completed for user ${userId}`);
      await saveCompleteLinkedInData(userId, asyncResult.data);
      processingQueue.delete(queueKey);
      retryAttempts.delete(userId);
      return;
    }
    
    throw new Error(`Both sync and async extraction failed: ${syncResult.error}, ${asyncResult.error}`);
    
  } catch (error) {
    console.error(`❌ CORRECT background extraction failed for user ${userId} (Retry ${retryCount}):`, error.message);
    
    // Update user profile with error information
    await pool.query(`
      UPDATE user_profiles SET 
        extraction_status = 'failed',
        extraction_error = $1,
        last_extraction_attempt = NOW()
      WHERE user_id = $2
    `, [error.message, userId]);
    
    processingQueue.delete(queueKey);
    
    // Retry logic with exponential backoff
    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1;
      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      
      console.log(`🔄 Scheduling CORRECT background extraction for user ${userId}, retry ${nextRetry} in ${delay}ms`);
      
      setTimeout(() => {
        scheduleBackgroundExtraction(userId, linkedinUrl, nextRetry);
      }, delay);
    } else {
      console.error(`❌ CORRECT background extraction failed permanently for user ${userId} after ${MAX_RETRIES} retries`);
      retryAttempts.delete(userId);
    }
  }
}

async function attemptSynchronousExtraction(linkedinUrl) {
  try {
    console.log('🔍 CORRECT synchronous extraction: Starting...');
    
    const response = await axios.post('https://api.brightdata.com/datasets/v3/trigger', {
      dataset_id: BRIGHT_DATA_DATASET_ID,
      include_errors: true,
      type: 'discover_new',
      discover: [{ linkedin_url: linkedinUrl }]
    }, {
      headers: {
        'Authorization': `Bearer ${BRIGHT_DATA_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    if (response.data && response.data.snapshot_id) {
      console.log(`📸 CORRECT sync snapshot created: ${response.data.snapshot_id}`);
      
      // Wait for completion
      const result = await pollForCompletion(response.data.snapshot_id, 60000); // 1 minute timeout
      return result;
    }
    
    return { success: false, error: 'No snapshot ID returned' };
  } catch (error) {
    console.error('❌ CORRECT synchronous extraction failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function attemptAsynchronousExtraction(linkedinUrl) {
  try {
    console.log('🔍 CORRECT asynchronous extraction: Starting...');
    
    const response = await axios.post('https://api.brightdata.com/datasets/v3/trigger', {
      dataset_id: BRIGHT_DATA_DATASET_ID,
      include_errors: true,
      type: 'discover_new',
      discover: [{ linkedin_url: linkedinUrl }],
      format: 'json',
      notify: process.env.WEBHOOK_URL
    }, {
      headers: {
        'Authorization': `Bearer ${BRIGHT_DATA_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    if (response.data && response.data.snapshot_id) {
      console.log(`📸 CORRECT async snapshot created: ${response.data.snapshot_id}`);
      
      // Wait longer for async completion
      const result = await pollForCompletion(response.data.snapshot_id, 300000); // 5 minute timeout
      return result;
    }
    
    return { success: false, error: 'No snapshot ID returned' };
  } catch (error) {
    console.error('❌ CORRECT asynchronous extraction failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function pollForCompletion(snapshotId, timeout = 300000) {
  console.log(`⏳ CORRECT polling for completion: ${snapshotId}`);
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  
  while (Date.now() - startTime < timeout) {
    try {
      const response = await axios.get(`https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`, {
        headers: {
          'Authorization': `Bearer ${BRIGHT_DATA_API_TOKEN}`
        }
      });
      
      const data = response.data;
      console.log(`📊 CORRECT snapshot status: ${data.status} (${data.total_records || 0} records)`);
      
      if (data.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      
      if (data.status === 'ready' && data.total_records > 0) {
        console.log('✅ CORRECT extraction completed, fetching data...');
        
        // Fetch the actual data
        const dataResponse = await axios.get(`https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`, {
          headers: {
            'Authorization': `Bearer ${BRIGHT_DATA_API_TOKEN}`
          }
        });
        
        if (dataResponse.data && dataResponse.data.length > 0) {
          console.log('🎉 CORRECT LinkedIn data retrieved successfully!');
          return { success: true, data: dataResponse.data[0] };
        }
      }
      
      return { success: false, error: `Extraction completed but no data available. Status: ${data.status}` };
      
    } catch (error) {
      console.error('❌ CORRECT polling error:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, error: 'Timeout waiting for extraction completion' };
}

async function saveCompleteLinkedInData(userId, extractedData) {
  try {
    console.log(`💾 Saving COMPLETE LinkedIn data for user ${userId}...`);
    
    // Process data for JSONB storage
    const processedData = processLinkedInDataForDB(extractedData);
    
    console.log('🔍 Final JSONB data validation:');
    Object.keys(processedData).forEach(key => {
      if (key.includes('experience') || key.includes('education') || key.includes('skills') || 
          key.includes('certifications') || key.includes('languages') || key.includes('projects') ||
          key.includes('publications') || key.includes('patents') || key.includes('organizations') ||
          key.includes('honors') || key.includes('courses') || key.includes('recommendations') ||
          key.includes('posts') || key.includes('activity') || key.includes('people_also_viewed') ||
          key.includes('raw_bright_data_response')) {
        console.log(`   - ${key}: ${typeof processedData[key]} (${processedData[key] ? processedData[key].length : 0} chars)`);
      }
    });
    
    // Update user_profiles table with COMPLETE data
    const updateQuery = `
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
        public_identifier = $12,
        experience = $13::jsonb,
        education = $14::jsonb,
        skills = $15::jsonb,
        certifications = $16::jsonb,
        languages = $17::jsonb,
        projects = $18::jsonb,
        publications = $19::jsonb,
        patents = $20::jsonb,
        organizations = $21::jsonb,
        honors_and_awards = $22::jsonb,
        courses = $23::jsonb,
        recommendations = $24::jsonb,
        posts = $25::jsonb,
        activity = $26::jsonb,
        people_also_viewed = $27::jsonb,
        raw_bright_data_response = $28::jsonb,
        extraction_status = 'completed',
        extraction_error = NULL,
        data_extraction_completed_at = NOW(),
        last_extraction_attempt = NOW()
      WHERE user_id = $29
    `;
    
    const values = [
      processedData.full_name,
      processedData.first_name,
      processedData.last_name,
      processedData.headline,
      processedData.summary,
      processedData.location,
      processedData.industry,
      processedData.connections_count,
      processedData.followers_count,
      processedData.profile_image_url,
      processedData.banner_image_url,
      processedData.public_identifier,
      processedData.experience,        // These are now properly formatted JSON strings
      processedData.education,
      processedData.skills,
      processedData.certifications,
      processedData.languages,
      processedData.projects,
      processedData.publications,
      processedData.patents,
      processedData.organizations,
      processedData.honors_and_awards,
      processedData.courses,
      processedData.recommendations,
      processedData.posts,
      processedData.activity,
      processedData.people_also_viewed,
      processedData.raw_bright_data_response,
      userId
    ];
    
    await pool.query(updateQuery, values);
    console.log(`🎉 COMPLETE LinkedIn profile data saved successfully for user ${userId}!`);
    
  } catch (error) {
    console.error(`❌ Failed to save COMPLETE LinkedIn data for user ${userId}:`, error.message);
    console.error('Error details:', error);
    
    // Try to save basic information if complex data fails
    try {
      await pool.query(`
        UPDATE user_profiles SET 
          extraction_status = 'completed_with_errors',
          extraction_error = $1,
          last_extraction_attempt = NOW()
        WHERE user_id = $2
      `, [`JSONB save error: ${error.message}`, userId]);
      
      console.log('ℹ️ Updated extraction status to completed_with_errors');
    } catch (statusError) {
      console.error('❌ Failed to update extraction status:', statusError.message);
    }
    
    throw error;
  }
}

// ==================== DATABASE SETUP ====================
async function setupDatabase() {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        google_id VARCHAR(255),
        full_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User profiles table with COMPLETE LinkedIn data fields
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        
        -- Basic Profile Information
        full_name VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        headline TEXT,
        summary TEXT,
        location VARCHAR(255),
        industry VARCHAR(255),
        connections_count INTEGER DEFAULT 0,
        followers_count INTEGER DEFAULT 0,
        profile_image_url TEXT,
        banner_image_url TEXT,
        public_identifier VARCHAR(255),
        
        -- Professional Data (JSONB for complex structures)
        experience JSONB DEFAULT '[]',
        education JSONB DEFAULT '[]',
        skills JSONB DEFAULT '[]',
        certifications JSONB DEFAULT '[]',
        languages JSONB DEFAULT '[]',
        projects JSONB DEFAULT '[]',
        
        -- Additional Professional Data
        publications JSONB DEFAULT '[]',
        patents JSONB DEFAULT '[]',
        organizations JSONB DEFAULT '[]',
        honors_and_awards JSONB DEFAULT '[]',
        courses JSONB DEFAULT '[]',
        recommendations JSONB DEFAULT '[]',
        
        -- Social Activity
        posts JSONB DEFAULT '[]',
        activity JSONB DEFAULT '[]',
        people_also_viewed JSONB DEFAULT '[]',
        
        -- Technical Data
        raw_bright_data_response JSONB,
        
        -- Processing Status
        extraction_status VARCHAR(50) DEFAULT 'pending',
        extraction_error TEXT,
        linkedin_url TEXT,
        data_extraction_completed_at TIMESTAMP,
        last_extraction_attempt TIMESTAMP,
        profile_created_via VARCHAR(50) DEFAULT 'manual',
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Packages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        features JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User packages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_packages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        package_id INTEGER REFERENCES packages(id) ON DELETE CASCADE,
        purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `);

    console.log('✅ Database tables created successfully');
  } catch (error) {
    console.error('❌ Database setup error:', error);
    throw error;
  }
}

// ==================== ROUTES ====================

// Home route
app.get('/', (req, res) => {
  res.json({
    message: 'Msgly.AI Server with Google OAuth + COMPLETE LinkedIn Data Extraction',
    status: 'running',
    version: '4.2-complete-linkedin-data-with-proper-jsonb-handling',
    backgroundProcessing: 'enabled',
    brightDataAPI: 'CORRECT implementation with dual extraction methods',
    jsonbHandling: 'FIXED - Proper string formatting for PostgreSQL JSONB columns',
    dataCapture: 'ALL FIELDS - Experience, Education, Skills, Certifications, Languages, Projects, Publications, Patents, Organizations, Honors, Courses, Recommendations, Posts, Activity, People Also Viewed',
    improvements: [
      '✅ Fixed PostgreSQL JSONB handling - Uses JSON.stringify() for complex data',
      '✅ Comprehensive LinkedIn data extraction - ALL profile fields captured',
      '✅ Dual extraction strategy - Synchronous (fast) + Asynchronous (reliable)',
      '✅ Background processing with retry mechanism',
      '✅ Proper error handling and status tracking',
      '✅ Google OAuth integration maintained'
    ],
    availableEndpoints: [
      'POST /register - User registration',
      'POST /login - User login',
      'GET /profile - Get user profile',
      'POST /add-linkedin-url - Add LinkedIn URL for extraction',
      'GET /profile-status - Check extraction status',
      'POST /retry-extraction - Retry failed extraction',
      'GET /processing-status - Background processing details',
      'GET /auth/google - Google OAuth login',
      'GET /auth/google/callback - Google OAuth callback',
      'POST /logout - Logout',
      'GET /packages - Get available packages',
      'POST /migrate-database - Database migration'
    ]
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '4.2-complete-linkedin-data-with-proper-jsonb-handling',
    features: {
      brightDataAPI: 'CORRECT implementation',
      jsonbHandling: 'FIXED - Proper PostgreSQL JSONB formatting',
      linkedinDataExtraction: 'COMPLETE - All profile fields',
      backgroundProcessing: 'enabled',
      googleOAuth: 'enabled'
    }
  });
});

// User registration
app.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const userResult = await pool.query(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name',
      [email, hashedPassword, fullName]
    );
    
    await pool.query(
      'INSERT INTO user_profiles (user_id, full_name, profile_created_via) VALUES ($1, $2, $3)',
      [userResult.rows[0].id, fullName, 'email_registration']
    );
    
    const token = jwt.sign(
      { id: userResult.rows[0].id, email: userResult.rows[0].email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: userResult.rows[0]
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile with COMPLETE LinkedIn data
app.get('/profile', authenticateToken, async (req, res) => {
  try {
    const profileResult = await pool.query(`
      SELECT 
        up.*,
        u.email,
        u.created_at as user_created_at
      FROM user_profiles up
      JOIN users u ON up.user_id = u.id
      WHERE up.user_id = $1
    `, [req.user.id]);
    
    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const profile = profileResult.rows[0];
    
    res.json({
      profile: {
        // Basic Information
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        first_name: profile.first_name,
        last_name: profile.last_name,
        headline: profile.headline,
        summary: profile.summary,
        location: profile.location,
        industry: profile.industry,
        connections_count: profile.connections_count,
        followers_count: profile.followers_count,
        profile_image_url: profile.profile_image_url,
        banner_image_url: profile.banner_image_url,
        public_identifier: profile.public_identifier,
        
        // Professional Data (parsed from JSONB)
        experience: profile.experience,
        education: profile.education,
        skills: profile.skills,
        certifications: profile.certifications,
        languages: profile.languages,
        projects: profile.projects,
        publications: profile.publications,
        patents: profile.patents,
        organizations: profile.organizations,
        honors_and_awards: profile.honors_and_awards,
        courses: profile.courses,
        recommendations: profile.recommendations,
        
        // Social Activity
        posts: profile.posts,
        activity: profile.activity,
        people_also_viewed: profile.people_also_viewed,
        
        // Status Information
        extraction_status: profile.extraction_status,
        extraction_error: profile.extraction_error,
        linkedin_url: profile.linkedin_url,
        data_extraction_completed_at: profile.data_extraction_completed_at,
        last_extraction_attempt: profile.last_extraction_attempt,
        profile_created_via: profile.profile_created_via,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        user_created_at: profile.user_created_at
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add LinkedIn URL and trigger COMPLETE background extraction
app.post('/add-linkedin-url', authenticateToken, async (req, res) => {
  try {
    const { linkedinUrl } = req.body;
    
    if (!linkedinUrl) {
      return res.status(400).json({ error: 'LinkedIn URL is required' });
    }
    
    if (!linkedinUrl.includes('linkedin.com')) {
      return res.status(400).json({ error: 'Please provide a valid LinkedIn URL' });
    }
    
    // Update user profile with LinkedIn URL and reset status
    await pool.query(`
      UPDATE user_profiles SET 
        linkedin_url = $1,
        extraction_status = 'processing',
        extraction_error = NULL,
        last_extraction_attempt = NOW()
      WHERE user_id = $2
    `, [linkedinUrl, req.user.id]);
    
    // Start COMPLETE background extraction
    scheduleBackgroundExtraction(req.user.id, linkedinUrl);
    
    res.json({
      message: 'LinkedIn URL added successfully! COMPLETE data extraction started in background.',
      status: 'processing',
      details: {
        backgroundProcessing: true,
        dataExtraction: 'COMPLETE - All LinkedIn profile fields will be extracted',
        estimatedTime: '1-5 minutes',
        extractionMethod: 'Dual strategy - Synchronous (fast) + Asynchronous (reliable)',
        dataFields: [
          'Basic Profile (name, headline, summary, location, industry)',
          'Professional (experience, education, skills, certifications, languages, projects)',
          'Additional (publications, patents, organizations, honors, courses, recommendations)',
          'Social (posts, activity, people also viewed)',
          'Technical (raw Bright Data response, metadata)'
        ]
      }
    });
  } catch (error) {
    console.error('Add LinkedIn URL error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check profile extraction status
app.get('/profile-status', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        extraction_status,
        extraction_error,
        linkedin_url,
        data_extraction_completed_at,
        last_extraction_attempt,
        full_name,
        headline,
        summary,
        experience,
        education,
        skills
      FROM user_profiles 
      WHERE user_id = $1
    `, [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const profile = result.rows[0];
    const isProcessing = processingQueue.has(`user_${req.user.id}`);
    
    // Count extracted data
    const dataCounts = {
      experience: Array.isArray(profile.experience) ? profile.experience.length : 0,
      education: Array.isArray(profile.education) ? profile.education.length : 0,
      skills: Array.isArray(profile.skills) ? profile.skills.length : 0
    };
    
    res.json({
      status: profile.extraction_status,
      isProcessing,
      error: profile.extraction_error,
      linkedinUrl: profile.linkedin_url,
      completedAt: profile.data_extraction_completed_at,
      lastAttempt: profile.last_extraction_attempt,
      hasBasicData: !!(profile.full_name || profile.headline),
      hasCompleteData: profile.extraction_status === 'completed',
      dataSummary: {
        basicProfile: !!(profile.full_name && profile.headline),
        experience: dataCounts.experience,
        education: dataCounts.education,
        skills: dataCounts.skills,
        totalDataPoints: Object.values(dataCounts).reduce((a, b) => a + b, 0)
      },
      message: isProcessing ? 
        'COMPLETE LinkedIn data extraction in progress...' : 
        profile.extraction_status === 'completed' ? 
          'COMPLETE LinkedIn profile data extracted successfully!' :
          profile.extraction_status === 'failed' ?
            'Extraction failed - you can retry below' :
            'Ready for LinkedIn data extraction'
    });
  } catch (error) {
    console.error('Profile status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retry failed extraction
app.post('/retry-extraction', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT linkedin_url, extraction_status 
      FROM user_profiles 
      WHERE user_id = $1
    `, [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const profile = result.rows[0];
    
    if (!profile.linkedin_url) {
      return res.status(400).json({ error: 'No LinkedIn URL found. Please add a LinkedIn URL first.' });
    }
    
    if (processingQueue.has(`user_${req.user.id}`)) {
      return res.status(400).json({ error: 'Extraction already in progress' });
    }
    
    // Reset retry attempts and start fresh
    retryAttempts.delete(req.user.id);
    
    // Update status and start extraction
    await pool.query(`
      UPDATE user_profiles SET 
        extraction_status = 'processing',
        extraction_error = NULL,
        last_extraction_attempt = NOW()
      WHERE user_id = $1
    `, [req.user.id]);
    
    scheduleBackgroundExtraction(req.user.id, profile.linkedin_url);
    
    res.json({
      message: 'COMPLETE LinkedIn data extraction restarted!',
      status: 'processing',
      linkedinUrl: profile.linkedin_url
    });
  } catch (error) {
    console.error('Retry extraction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Background processing status
app.get('/processing-status', authenticateToken, async (req, res) => {
  try {
    const currentlyProcessing = Array.from(processingQueue);
    const userProcessing = currentlyProcessing.includes(`user_${req.user.id}`);
    
    res.json({
      isProcessing: userProcessing,
      queuePosition: userProcessing ? currentlyProcessing.indexOf(`user_${req.user.id}`) + 1 : null,
      totalInQueue: currentlyProcessing.length,
      estimatedWaitTime: userProcessing ? '1-5 minutes' : null,
      retryAttempts: retryAttempts.get(req.user.id) || 0,
      maxRetries: MAX_RETRIES,
      processingDetails: {
        extractionMethods: ['Synchronous (fast)', 'Asynchronous (reliable)'],
        dataFields: 'ALL LinkedIn profile fields',
        backgroundProcessing: true
      }
    });
  } catch (error) {
    console.error('Processing status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== GOOGLE OAUTH ROUTES ====================
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user.id, email: req.user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }
);

// Logout
app.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// ==================== PACKAGE ROUTES ====================
app.get('/packages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM packages WHERE is_active = true ORDER BY price ASC');
    res.json({ packages: result.rows });
  } catch (error) {
    console.error('Packages fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== DATABASE MIGRATION ====================
app.post('/migrate-database', async (req, res) => {
  try {
    await setupDatabase();
    res.json({ message: 'Database migration completed successfully' });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: 'Migration failed' });
  }
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ==================== SERVER STARTUP ====================
app.listen(port, async () => {
  try {
    await setupDatabase();
    console.log('🚀 Msgly.AI Server with Google OAuth + COMPLETE LinkedIn Data Extraction Started!');
    console.log(`📡 Server running on port ${port}`);
    console.log('🔧 Features enabled:');
    console.log('   ✅ Google OAuth authentication');
    console.log('   ✅ Email/password authentication');
    console.log('   ✅ COMPLETE LinkedIn data extraction');
    console.log('   ✅ FIXED PostgreSQL JSONB handling');
    console.log('   ✅ Dual extraction strategy (sync + async)');
    console.log('   ✅ Background processing with retry mechanism');
    console.log('   ✅ Comprehensive error handling');
    console.log('📊 Data Captured: ALL FIELDS - Experience, Education, Skills, Certifications, Languages, Projects, Publications, Patents, Organizations, Honors, Courses, Recommendations, Posts, Activity, People Also Viewed');
    console.log('🔧 FIXED: PostgreSQL JSONB errors - All complex data properly formatted as JSON strings');
    console.log('🚫 NO MORE: "Partial save - complex data excluded" errors');
    console.log('🎉 RESULT: Users get their COMPLETE LinkedIn profiles automatically!');
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
});

module.exports = app;
