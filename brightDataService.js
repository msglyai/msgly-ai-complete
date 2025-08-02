// Bright Data LinkedIn Profile Extraction Service
// Production-ready service for fetching LinkedIn profiles via Bright Data API

const axios = require('axios');

// Environment variables
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY;
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_DATASET_ID;

// Validate environment setup
if (!BRIGHT_DATA_API_KEY) {
    console.error('[BRIGHT_DATA] ERROR: BRIGHT_DATA_API_KEY not found in environment');
    throw new Error('BRIGHT_DATA_API_KEY environment variable is required');
}

if (!BRIGHT_DATA_DATASET_ID) {
    console.error('[BRIGHT_DATA] ERROR: BRIGHT_DATA_DATASET_ID not found in environment');
    throw new Error('BRIGHT_DATA_DATASET_ID environment variable is required');
}

console.log('[BRIGHT_DATA] Service initialized with dataset ID:', BRIGHT_DATA_DATASET_ID);

/**
 * Clean and validate LinkedIn URL
 * @param {string} profileUrl - Raw LinkedIn profile URL
 * @returns {string} - Cleaned LinkedIn URL
 */
const cleanLinkedInUrl = (profileUrl) => {
    try {
        let cleanUrl = profileUrl.trim();
        
        // Remove query parameters
        if (cleanUrl.includes('?')) {
            cleanUrl = cleanUrl.split('?')[0];
        }
        
        // Remove trailing slash
        if (cleanUrl.endsWith('/')) {
            cleanUrl = cleanUrl.slice(0, -1);
        }
        
        // Validate it's a LinkedIn profile URL
        if (!cleanUrl.includes('linkedin.com/in/')) {
            throw new Error('Invalid LinkedIn profile URL format');
        }
        
        console.log('[BRIGHT_DATA] URL cleaned:', profileUrl, '->', cleanUrl);
        return cleanUrl;
        
    } catch (error) {
        console.error('[BRIGHT_DATA] URL cleaning error:', error.message);
        throw new Error(`Invalid LinkedIn URL: ${error.message}`);
    }
};

/**
 * Process and validate Bright Data response
 * @param {Object} rawData - Raw response from Bright Data
 * @returns {Object} - Processed LinkedIn profile data
 */
const processLinkedInData = (rawData) => {
    try {
        console.log('[BRIGHT_DATA] Processing LinkedIn data...');
        console.log('[BRIGHT_DATA] Raw data keys:', Object.keys(rawData || {}));
        
        if (!rawData) {
            throw new Error('No data received from Bright Data API');
        }
        
        // Extract and structure the LinkedIn data
        const processedData = {
            // Basic Information
            fullName: rawData.name || rawData.full_name || null,
            firstName: rawData.first_name || (rawData.name ? rawData.name.split(' ')[0] : null),
            lastName: rawData.last_name || (rawData.name ? rawData.name.split(' ').slice(1).join(' ') : null),
            headline: rawData.headline || rawData.position || null,
            summary: rawData.summary || rawData.about || null,
            location: rawData.location || rawData.geo_location || null,
            industry: rawData.industry || null,
            
            // Professional Information
            currentCompany: rawData.current_company || rawData.company || null,
            currentPosition: rawData.current_position || rawData.position || null,
            
            // Social Metrics
            connectionsCount: parseLinkedInNumber(rawData.connections_count || rawData.connections),
            followersCount: parseLinkedInNumber(rawData.followers_count || rawData.followers),
            
            // Media
            profileImageUrl: rawData.profile_pic_url || rawData.profile_image || null,
            backgroundImageUrl: rawData.background_image || rawData.banner_image || null,
            
            // Complex Data Arrays
            experience: ensureArray(rawData.experience || rawData.work_experience || []),
            education: ensureArray(rawData.education || rawData.schools || []),
            skills: ensureArray(rawData.skills || rawData.skill_list || []),
            certifications: ensureArray(rawData.certifications || rawData.certificates || []),
            courses: ensureArray(rawData.courses || []),
            projects: ensureArray(rawData.projects || []),
            publications: ensureArray(rawData.publications || []),
            volunteerWork: ensureArray(rawData.volunteer_work || rawData.volunteering || []),
            honorsAwards: ensureArray(rawData.honors_and_awards || rawData.awards || []),
            languages: ensureArray(rawData.languages || []),
            activity: ensureArray(rawData.activity || rawData.recent_activity || []),
            articles: ensureArray(rawData.articles || []),
            recommendations: ensureArray(rawData.recommendations || []),
            
            // Store complete raw data for future use
            rawData: rawData
        };
        
        console.log('[BRIGHT_DATA] Data processing complete');
        console.log('[BRIGHT_DATA] Profile summary:');
        console.log(`  - Name: ${processedData.fullName || 'Not found'}`);
        console.log(`  - Headline: ${processedData.headline || 'Not found'}`);
        console.log(`  - Company: ${processedData.currentCompany || 'Not found'}`);
        console.log(`  - Experience entries: ${processedData.experience.length}`);
        console.log(`  - Education entries: ${processedData.education.length}`);
        console.log(`  - Skills: ${processedData.skills.length}`);
        console.log(`  - Connections: ${processedData.connectionsCount || 'Not found'}`);
        
        return processedData;
        
    } catch (error) {
        console.error('[BRIGHT_DATA] Data processing error:', error.message);
        throw new Error(`Data processing failed: ${error.message}`);
    }
};

/**
 * Helper function to parse LinkedIn numbers (handles K, M suffixes)
 * @param {string|number} value - Number with possible K/M suffix
 * @returns {number|null} - Parsed number or null
 */
const parseLinkedInNumber = (value) => {
    if (!value) return null;
    if (typeof value === 'number') return value;
    
    try {
        const str = value.toString().toLowerCase().trim();
        
        if (str.includes('k')) {
            const num = parseFloat(str.match(/[\d.]+/)?.[0]);
            return num ? Math.round(num * 1000) : null;
        }
        
        if (str.includes('m')) {
            const num = parseFloat(str.match(/[\d.]+/)?.[0]);
            return num ? Math.round(num * 1000000) : null;
        }
        
        const numbers = str.match(/[\d,]+/);
        if (numbers) {
            return parseInt(numbers[0].replace(/,/g, ''), 10) || null;
        }
        
        return null;
    } catch (error) {
        console.error('[BRIGHT_DATA] Number parsing error for value:', value, error);
        return null;
    }
};

/**
 * Ensure value is an array
 * @param {any} value - Value to convert to array
 * @returns {Array} - Array or empty array
 */
const ensureArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    if (value) return [value];
    return [];
};

/**
 * Main function to fetch LinkedIn profile data from Bright Data
 * @param {string} profileUrl - LinkedIn profile URL
 * @returns {Promise<Object>} - Promise resolving to processed LinkedIn data
 */
const fetchLinkedInProfile = async (profileUrl) => {
    console.log(`[BRIGHT_DATA] Fetching profile for ${profileUrl}`);
    console.log(`[BRIGHT_DATA] Using dataset ID: ${BRIGHT_DATA_DATASET_ID}`);
    
    try {
        // Clean the URL
        const cleanUrl = cleanLinkedInUrl(profileUrl);
        
        // Try synchronous extraction first (faster when available)
        console.log('[BRIGHT_DATA] Attempting synchronous extraction...');
        try {
            const syncResponse = await axios.post(
                `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`,
                [{ "url": cleanUrl }],
                {
                    headers: {
                        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 90000 // 90 seconds for sync
                }
            );
            
            if (syncResponse.status === 200 && syncResponse.data && syncResponse.data.length > 0) {
                console.log('[BRIGHT_DATA] Synchronous extraction successful!');
                const profileData = Array.isArray(syncResponse.data) ? syncResponse.data[0] : syncResponse.data;
                console.log(`[BRIGHT_DATA] Fetched JSON keys: ${Object.keys(profileData || {})}`);
                
                return {
                    success: true,
                    data: processLinkedInData(profileData),
                    method: 'synchronous',
                    snapshotId: null
                };
            }
        } catch (syncError) {
            console.log('[BRIGHT_DATA] Synchronous extraction not available, using asynchronous method...');
        }
        
        // Asynchronous extraction with polling
        console.log('[BRIGHT_DATA] Starting asynchronous extraction...');
        
        // Step 1: Trigger extraction job
        const triggerResponse = await axios.post(
            `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BRIGHT_DATA_DATASET_ID}&format=json`,
            [{ "url": cleanUrl }],
            {
                headers: {
                    'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        
        if (!triggerResponse.data?.snapshot_id) {
            throw new Error('No snapshot ID returned from Bright Data trigger');
        }
        
        const snapshotId = triggerResponse.data.snapshot_id;
        console.log(`[BRIGHT_DATA] Extraction job triggered, snapshot ID: ${snapshotId}`);
        
        // Step 2: Poll for completion
        const maxPolls = 30; // 6-7 minutes max
        let pollCount = 0;
        
        while (pollCount < maxPolls) {
            pollCount++;
            console.log(`[BRIGHT_DATA] Polling attempt ${pollCount}/${maxPolls}...`);
            
            try {
                await new Promise(resolve => setTimeout(resolve, 12000)); // Wait 12 seconds between polls
                
                const statusResponse = await axios.get(
                    `https://api.brightdata.com/datasets/v3/log/${snapshotId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`
                        },
                        timeout: 15000
                    }
                );
                
                const status = statusResponse.data?.Status || statusResponse.data?.status;
                console.log(`[BRIGHT_DATA] Job status: ${status}`);
                
                if (status === 'ready') {
                    console.log('[BRIGHT_DATA] Extraction completed! Downloading data...');
                    
                    // Step 3: Get the data
                    const dataResponse = await axios.get(
                        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`,
                        {
                            headers: {
                                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`
                            },
                            timeout: 30000
                        }
                    );
                    
                    if (dataResponse.data) {
                        const profileData = Array.isArray(dataResponse.data) ? dataResponse.data[0] : dataResponse.data;
                        console.log(`[BRIGHT_DATA] Fetched JSON keys: ${Object.keys(profileData || {})}`);
                        
                        return {
                            success: true,
                            data: processLinkedInData(profileData),
                            method: 'asynchronous',
                            snapshotId: snapshotId
                        };
                    } else {
                        throw new Error('No data in completed snapshot');
                    }
                    
                } else if (status === 'error' || status === 'failed') {
                    throw new Error(`Bright Data extraction failed with status: ${status}`);
                }
                
                // Continue polling...
                
            } catch (pollError) {
                console.error(`[BRIGHT_DATA] Polling error on attempt ${pollCount}:`, pollError.message);
                
                if (pollError.response?.status === 404) {
                    console.log('[BRIGHT_DATA] Snapshot not found yet, continuing to poll...');
                    continue;
                }
                
                // For other errors, continue polling unless we've exhausted attempts
                if (pollCount >= maxPolls - 2) {
                    throw pollError;
                }
            }
        }
        
        throw new Error(`Extraction timeout after ${maxPolls * 12} seconds of polling`);
        
    } catch (error) {
        console.error('[BRIGHT_DATA] Fetch error:', error.message);
        console.error('[BRIGHT_DATA] Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        
        throw new Error(`Bright Data fetch failed: ${error.message}`);
    }
};

// For standalone testing (run with: node brightDataService.js "linkedin-url")
if (require.main === module) {
    const testUrl = process.argv[2];
    if (!testUrl) {
        console.log('Usage: node brightDataService.js "https://www.linkedin.com/in/example"');
        process.exit(1);
    }
    
    console.log('[BRIGHT_DATA] Testing with URL:', testUrl);
    
    fetchLinkedInProfile(testUrl)
        .then(result => {
            console.log('[BRIGHT_DATA] Test successful!');
            console.log('[BRIGHT_DATA] Result:', JSON.stringify(result, null, 2));
        })
        .catch(error => {
            console.error('[BRIGHT_DATA] Test failed:', error.message);
            process.exit(1);
        });
}

module.exports = {
    fetchLinkedInProfile
};