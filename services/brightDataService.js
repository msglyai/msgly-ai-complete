// Enhanced brightDataService.js
// Fetches all rows where `data` is NULL, calls Bright Data API,
// and maps *every* returned field into your postgres table + stores full JSON

const axios = require('axios');
const db = require('./db');
require('dotenv').config();

const BRIGHTDATA_API_URL = process.env.BRIGHTDATA_API_URL;
const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;

// Enhanced processing with comprehensive data extraction
async function processProfiles() {
  console.log('[BRIGHT_DATA] 🚀 Starting profile processing...');
  
  // 1. Get all unprocessed profiles
  const { rows } = await db.query(
    'SELECT id, linkedin_url FROM linkedin_profiles WHERE data IS NULL ORDER BY created_at DESC'
  );
  
  console.log(`[BRIGHT_DATA] 📊 Found ${rows.length} profiles to process`);
  
  for (let row of rows) {
    const { id, linkedin_url } = row;
    
    try {
      console.log(`[BRIGHT_DATA] 🔄 Processing profile ID ${id}: ${linkedin_url}`);
      
      // 2. Call Bright Data API with enhanced error handling
      const resp = await axios.get(BRIGHTDATA_API_URL, {
        params: { targetURL: linkedin_url },
        headers: { 
          Authorization: `Bearer ${BRIGHTDATA_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 second timeout
      });
      
      const profile = resp.data;
      console.log(`[BRIGHT_DATA] ✅ API response received for ID ${id}`);
      
      // 3. COMPREHENSIVE FIELD EXTRACTION
      // Based on Bright Data LinkedIn API response structure
      
      // === BASIC PROFILE INFO ===
      const fullName = profile.name || profile.full_name || null;
      const headline = profile.headline || profile.position || profile.title || null;
      const location = profile.location || profile.geo_location || null;
      const summary = profile.summary || profile.about || null;
      
      // === PROFILE IMAGES ===
      const profilePhotoUrl = profile.profilePhotoUrl || profile.avatar || profile.profile_picture || null;
      const backgroundImageUrl = profile.backgroundImageUrl || profile.banner_image || profile.background_banner || null;
      
      // === SOCIAL METRICS ===
      const connectionsCount = extractNumber(profile.connections || profile.connection_count || profile.connections_count);
      const followersCount = extractNumber(profile.followers || profile.follower_count || profile.followers_count);
      
      // === LINKEDIN IDENTIFIERS ===
      const linkedinId = profile.linkedin_id || profile.id || null;
      const profileUrl = profile.url || profile.profile_url || profile.linkedin_url || linkedin_url;
      
      // === PROFESSIONAL DATA ===
      const currentPosition = extractCurrentPosition(profile);
      const currentCompany = extractCurrentCompany(profile);
      
      // === EXPERIENCE & EDUCATION COUNTS ===
      const experienceCount = Array.isArray(profile.experience) ? profile.experience.length : 0;
      const educationCount = Array.isArray(profile.education) ? profile.education.length : 0;
      const skillsCount = Array.isArray(profile.skills) ? profile.skills.length : 0;
      const certificationsCount = Array.isArray(profile.certifications) ? profile.certifications.length : 0;
      
      // === ADDITIONAL COUNTS ===
      const recommendationsCount = profile.recommendations_count || 
                                 (Array.isArray(profile.recommendations) ? profile.recommendations.length : 0);
      const languagesCount = Array.isArray(profile.languages) ? profile.languages.length : 0;
      const publicationsCount = Array.isArray(profile.publications) ? profile.publications.length : 0;
      const projectsCount = Array.isArray(profile.projects) ? profile.projects.length : 0;
      const awardsCount = Array.isArray(profile.honors_and_awards) ? profile.honors_and_awards.length : 0;
      
      // === TIMESTAMP ===
      const lastUpdated = profile.timestamp ? new Date(profile.timestamp) : new Date();
      
      // === COMPLETENESS CALCULATION ===
      const completeness = calculateProfileCompleteness(profile);
      
      // 4. UPDATE DATABASE with comprehensive data mapping
      await db.query(
        `UPDATE linkedin_profiles
         SET 
           -- Basic Profile Info
           full_name = $1,
           headline = $2,
           location = $3,
           summary = $4,
           
           -- Profile Images
           profile_photo_url = $5,
           background_image_url = $6,
           
           -- Social Metrics
           connections_count = $7,
           followers_count = $8,
           
           -- LinkedIn Identifiers
           linkedin_id = $9,
           profile_url = $10,
           
           -- Professional Info
           current_position = $11,
           current_company = $12,
           
           -- Data Counts
           experience_count = $13,
           education_count = $14,
           skills_count = $15,
           certifications_count = $16,
           recommendations_count = $17,
           languages_count = $18,
           publications_count = $19,
           projects_count = $20,
           awards_count = $21,
           
           -- Metadata
           completeness = $22,
           last_updated = $23,
           
           -- Full JSON Data (MOST IMPORTANT - preserves everything!)
           data = $24,
           
           -- Update timestamp
           updated_at = NOW()
         WHERE id = $25`,
        [
          fullName,                // $1
          headline,                // $2
          location,                // $3
          summary,                 // $4
          profilePhotoUrl,         // $5
          backgroundImageUrl,      // $6
          connectionsCount,        // $7
          followersCount,          // $8
          linkedinId,              // $9
          profileUrl,              // $10
          currentPosition,         // $11
          currentCompany,          // $12
          experienceCount,         // $13
          educationCount,          // $14
          skillsCount,             // $15
          certificationsCount,     // $16
          recommendationsCount,    // $17
          languagesCount,          // $18
          publicationsCount,       // $19
          projectsCount,           // $20
          awardsCount,             // $21
          completeness,            // $22
          lastUpdated,             // $23
          JSON.stringify(profile), // $24 - FULL RAW JSON (everything preserved!)
          id                       // $25
        ]
      );
      
      console.log(`[BRIGHT_DATA] ✔️ Successfully processed profile ID ${id}`);
      console.log(`[BRIGHT_DATA] 📊 Profile completeness: ${completeness}%`);
      console.log(`[BRIGHT_DATA] 👤 ${fullName} - ${currentPosition} at ${currentCompany}`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (err) {
      console.error(`[BRIGHT_DATA] ❌ Error processing ID ${id}:`, err.message);
      
      // Mark as failed in database
      try {
        await db.query(
          `UPDATE linkedin_profiles 
           SET 
             data = $1,
             updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify({ error: err.message, failed_at: new Date() }), id]
        );
      } catch (dbErr) {
        console.error(`[BRIGHT_DATA] ❌ Failed to mark error for ID ${id}:`, dbErr.message);
      }
    }
  }
  
  console.log(`[BRIGHT_DATA] 🎉 Profile processing completed!`);
}

// Helper function to extract numbers from various formats
function extractNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Handle "500+", "1,234", etc.
    const cleaned = value.replace(/[^\d]/g, '');
    return cleaned ? parseInt(cleaned) : null;
  }
  return null;
}

// Extract current position from experience data
function extractCurrentPosition(profile) {
  // Try multiple possible locations for current position
  if (profile.current_position) return profile.current_position;
  if (profile.headline && !profile.headline.includes('at')) return profile.headline;
  
  // Look in experience array for current position
  if (Array.isArray(profile.experience) && profile.experience.length > 0) {
    const currentJob = profile.experience.find(exp => 
      exp.is_current || exp.current || 
      !exp.end_date || exp.end_date === null ||
      exp.end_date === 'Present'
    );
    
    if (currentJob) {
      return currentJob.title || currentJob.position || currentJob.job_title || null;
    }
    
    // Fallback to first experience entry
    return profile.experience[0].title || profile.experience[0].position || null;
  }
  
  return null;
}

// Extract current company from experience data
function extractCurrentCompany(profile) {
  // Try multiple possible locations for current company
  if (profile.current_company) return profile.current_company;
  
  // Look in experience array for current company
  if (Array.isArray(profile.experience) && profile.experience.length > 0) {
    const currentJob = profile.experience.find(exp => 
      exp.is_current || exp.current || 
      !exp.end_date || exp.end_date === null ||
      exp.end_date === 'Present'
    );
    
    if (currentJob) {
      return currentJob.company || currentJob.company_name || currentJob.organization || null;
    }
    
    // Fallback to first experience entry
    return profile.experience[0].company || profile.experience[0].company_name || null;
  }
  
  return null;
}

// Calculate profile completeness percentage
function calculateProfileCompleteness(profile) {
  const requiredFields = [
    'name', 'headline', 'location', 'summary'
  ];
  
  const optionalFields = [
    'experience', 'education', 'skills', 'certifications',
    'languages', 'recommendations', 'publications', 'projects',
    'honors_and_awards', 'volunteer_experience'
  ];
  
  const allFields = [...requiredFields, ...optionalFields];
  
  let score = 0;
  
  allFields.forEach(field => {
    const value = profile[field];
    if (value && value !== null && value !== '') {
      if (Array.isArray(value)) {
        score += value.length > 0 ? 1 : 0;
      } else {
        score += 1;
      }
    }
  });
  
  return Math.round((score / allFields.length) * 100);
}

// Manual processing function (can be called directly)
async function processSpecificProfile(profileId) {
  console.log(`[BRIGHT_DATA] 🎯 Processing specific profile ID: ${profileId}`);
  
  const { rows } = await db.query(
    'SELECT id, linkedin_url FROM linkedin_profiles WHERE id = $1',
    [profileId]
  );
  
  if (rows.length === 0) {
    console.error(`[BRIGHT_DATA] ❌ Profile ID ${profileId} not found`);
    return;
  }
  
  // Process just this one profile
  await processProfiles();
}

// Export functions
module.exports = {
  processProfiles,
  processSpecificProfile
};

// Run if called directly
if (require.main === module) {
  processProfiles().catch(console.error);
}
