// Msgly.AI Server with Google OAuth + Bright Data Integration (FIXED API USAGE)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const fetch = require('node-fetch');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// FIXED: Bright Data configuration using DIRECT SCRAPE API
const BRIGHT_DATA_CONFIG = {
  apiToken: process.env.BRIGHT_DATA_API_TOKEN || 'e5353ea11fe201c7f9797062c64b59fb87f1bfc01ad8a24dd0fc34a29ccddd23',
  datasetId: 'gd_l1viktl72bvl7bjuj0',
  // FIXED: Use direct scrape endpoint instead of trigger
  baseUrl: 'https://api.brightdata.com/datasets/v3/scrape',
  costPerProfile: 0.001 // $0.001 per profile
};

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        profile_picture VARCHAR(500),
        linkedin_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_profiles table with Bright Data fields
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        public_identifier VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        full_name VARCHAR(255),
        headline VARCHAR(1000),
        summary TEXT,
        location VARCHAR(255),
        profile_image_url VARCHAR(500),
        background_image_url VARCHAR(500),
        followers_count INTEGER,
        connections_count INTEGER,
        occupation VARCHAR(255),
        current_company_name VARCHAR(255),
        current_company_url VARCHAR(500),
        current_position_title VARCHAR(255),
        industry VARCHAR(255),
        experience JSONB,
        education JSONB,
        skills JSONB,
        certifications JSONB,
        languages JSONB,
        volunteering JSONB,
        accomplishments JSONB,
        recommendations JSONB,
        articles JSONB,
        courses JSONB,
        projects JSONB,
        honors_awards JSONB,
        test_scores JSONB,
        publications JSONB,
        patents JSONB,
        brightdata_data JSONB,
        extraction_status VARCHAR(50) DEFAULT 'pending',
        data_extraction_status VARCHAR(50) DEFAULT 'pending',
        extraction_retry_count INTEGER DEFAULT 0,
        extraction_cost DECIMAL(10,4) DEFAULT 0.0000,
        extraction_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const { id: googleId, emails, displayName, photos } = profile;
    const email = emails[0].value;
    const profilePicture = photos[0]?.value;

    let user = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);

    if (user.rows.length === 0) {
      const newUser = await pool.query(
        'INSERT INTO users (google_id, email, name, profile_picture) VALUES ($1, $2, $3, $4) RETURNING *',
        [googleId, email, displayName, profilePicture]
      );
      user = newUser;
    } else {
      await pool.query(
        'UPDATE users SET name = $1, profile_picture = $2, updated_at = CURRENT_TIMESTAMP WHERE google_id = $3',
        [displayName, profilePicture, googleId]
      );
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
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0]);
  } catch (error) {
    done(error, null);
  }
});

// FIXED: LinkedIn extraction using Bright Data DIRECT SCRAPE API
async function extractLinkedInProfile(linkedinUrl, userId) {
  try {
    console.log(`🔄 Starting LinkedIn extraction for user ${userId}...`);
    
    // Update status to processing
    await pool.query(
      'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = NULL WHERE user_id = $2',
      ['processing', userId]
    );

    // FIXED: Use direct scrape endpoint that returns data immediately
    const response = await fetch(BRIGHT_DATA_CONFIG.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHT_DATA_CONFIG.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{
        url: linkedinUrl
      }]),
      // Add query parameters for dataset ID
      ...(() => {
        const url = new URL(BRIGHT_DATA_CONFIG.baseUrl);
        url.searchParams.append('dataset_id', BRIGHT_DATA_CONFIG.datasetId);
        url.searchParams.append('format', 'json');
        return { url: url.toString() };
      })()
    });

    console.log(`📊 Bright Data response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bright Data API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ Received data from Bright Data:`, JSON.stringify(data).substring(0, 200) + '...');

    // FIXED: Handle direct response (not snapshot ID)
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('Bright Data returned empty data array');
    }

    const profileData = data[0]; // Get first profile from response

    if (!profileData || Object.keys(profileData).length === 0) {
      throw new Error('Profile data is empty or invalid');
    }

    // Extract relevant fields from Bright Data response
    const extractedData = {
      public_identifier: profileData.public_identifier || profileData.profile_id,
      first_name: profileData.first_name,
      last_name: profileData.last_name,
      full_name: profileData.full_name || `${profileData.first_name || ''} ${profileData.last_name || ''}`.trim(),
      headline: profileData.headline,
      summary: profileData.summary || profileData.about,
      location: profileData.location || profileData.geographic_area,
      profile_image_url: profileData.profile_image_url || profileData.profile_pic_url,
      background_image_url: profileData.background_image_url,
      followers_count: profileData.followers_count || profileData.follower_count,
      connections_count: profileData.connections_count || profileData.connection_count,
      occupation: profileData.occupation,
      current_company_name: profileData.current_company_name || profileData.company_name,
      current_company_url: profileData.current_company_url || profileData.company_url,
      current_position_title: profileData.current_position_title || profileData.current_position,
      industry: profileData.industry,
      experience: profileData.experience || profileData.experiences,
      education: profileData.education || profileData.educations,
      skills: profileData.skills,
      certifications: profileData.certifications,
      languages: profileData.languages,
      volunteering: profileData.volunteering || profileData.volunteer_experiences,
      accomplishments: profileData.accomplishments,
      recommendations: profileData.recommendations,
      articles: profileData.articles,
      courses: profileData.courses,
      projects: profileData.projects,
      honors_awards: profileData.honors_awards || profileData.honors,
      test_scores: profileData.test_scores,
      publications: profileData.publications,
      patents: profileData.patents,
      brightdata_data: profileData // Store complete raw data
    };

    // Update database with extracted data
    const updateQuery = `
      UPDATE user_profiles SET
        public_identifier = $1, first_name = $2, last_name = $3, full_name = $4,
        headline = $5, summary = $6, location = $7, profile_image_url = $8,
        background_image_url = $9, followers_count = $10, connections_count = $11,
        occupation = $12, current_company_name = $13, current_company_url = $14,
        current_position_title = $15, industry = $16, experience = $17, education = $18,
        skills = $19, certifications = $20, languages = $21, volunteering = $22,
        accomplishments = $23, recommendations = $24, articles = $25, courses = $26,
        projects = $27, honors_awards = $28, test_scores = $29, publications = $30,
        patents = $31, brightdata_data = $32, data_extraction_status = $33,
        extraction_cost = $34, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $35
    `;

    await pool.query(updateQuery, [
      extractedData.public_identifier, extractedData.first_name, extractedData.last_name,
      extractedData.full_name, extractedData.headline, extractedData.summary,
      extractedData.location, extractedData.profile_image_url, extractedData.background_image_url,
      extractedData.followers_count, extractedData.connections_count, extractedData.occupation,
      extractedData.current_company_name, extractedData.current_company_url,
      extractedData.current_position_title, extractedData.industry,
      JSON.stringify(extractedData.experience), JSON.stringify(extractedData.education),
      JSON.stringify(extractedData.skills), JSON.stringify(extractedData.certifications),
      JSON.stringify(extractedData.languages), JSON.stringify(extractedData.volunteering),
      JSON.stringify(extractedData.accomplishments), JSON.stringify(extractedData.recommendations),
      JSON.stringify(extractedData.articles), JSON.stringify(extractedData.courses),
      JSON.stringify(extractedData.projects), JSON.stringify(extractedData.honors_awards),
      JSON.stringify(extractedData.test_scores), JSON.stringify(extractedData.publications),
      JSON.stringify(extractedData.patents), JSON.stringify(extractedData.brightdata_data),
      'completed', BRIGHT_DATA_CONFIG.costPerProfile, userId
    ]);

    console.log(`🎉 Successfully extracted LinkedIn data for user ${userId}`);
    console.log(`💰 Cost: $${BRIGHT_DATA_CONFIG.costPerProfile}`);
    
    return extractedData;

  } catch (error) {
    console.error(`❌ LinkedIn extraction failed for user ${userId}:`, error.message);
    
    await pool.query(
      'UPDATE user_profiles SET data_extraction_status = $1, extraction_error = $2, extraction_retry_count = extraction_retry_count + 1 WHERE user_id = $3',
      ['failed', error.message, userId]
    );
    
    throw error;
  }
}

// Background process to extract LinkedIn data
async function processLinkedInExtractions() {
  try {
    const result = await pool.query(`
      SELECT u.id as user_id, u.linkedin_url, up.extraction_retry_count
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.linkedin_url IS NOT NULL 
      AND (up.data_extraction_status IS NULL OR up.data_extraction_status = 'pending' OR up.data_extraction_status = 'failed')
      AND (up.extraction_retry_count IS NULL OR up.extraction_retry_count < 3)
      ORDER BY u.created_at ASC
      LIMIT 5
    `);

    if (result.rows.length > 0) {
      console.log(`🔄 Processing ${result.rows.length} LinkedIn extractions...`);
      
      for (const row of result.rows) {
        try {
          await extractLinkedInProfile(row.linkedin_url, row.user_id);
          // Add small delay between extractions to be respectful
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`❌ Failed to extract for user ${row.user_id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error in background processing:', error);
  }
}

// Authentication routes
app.get('/auth/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard`);
  }
);

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// User routes
app.get('/api/user', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profileResult = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [req.user.id]);
    
    res.json({
      user: userResult.rows[0],
      profile: profileResult.rows[0] || null
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/user/linkedin', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { linkedinUrl } = req.body;
    if (!linkedinUrl) {
      return res.status(400).json({ error: 'LinkedIn URL is required' });
    }

    // Update user's LinkedIn URL
    await pool.query(
      'UPDATE users SET linkedin_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [linkedinUrl, req.user.id]
    );

    // Create or update user profile entry
    await pool.query(`
      INSERT INTO user_profiles (user_id, extraction_status, data_extraction_status)
      VALUES ($1, 'pending', 'pending')
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        extraction_status = 'pending',
        data_extraction_status = 'pending',
        extraction_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    `, [req.user.id]);

    // FIXED: Trigger immediate extraction (no background delay)
    try {
      await extractLinkedInProfile(linkedinUrl, req.user.id);
      res.json({ 
        message: 'LinkedIn URL updated and data extracted successfully',
        status: 'completed'
      });
    } catch (extractionError) {
      res.json({ 
        message: 'LinkedIn URL updated but extraction failed', 
        status: 'failed',
        error: extractionError.message
      });
    }

  } catch (error) {
    console.error('Error updating LinkedIn URL:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`💰 Bright Data cost per profile: $${BRIGHT_DATA_CONFIG.costPerProfile}`);
    });

    // REMOVED: Background processing (now extracts immediately)
    // Start background processing for LinkedIn extractions
    // setInterval(processLinkedInExtractions, 30000); // Check every 30 seconds
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
