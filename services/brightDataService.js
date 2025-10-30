// brightDataService.js - BrightData LinkedIn Profile Scraper
// Handles LinkedIn profile analysis via BrightData API with polling mechanism

const axios = require('axios');

const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const BRIGHTDATA_DATASET_ID = process.env.BRIGHTDATA_DATASET_ID || 'gd_lxdzkukqm5zf99fbf';

// Maximum polling attempts (5 minutes with 5-second intervals)
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 5000;

/**
 * Trigger BrightData LinkedIn profile scrape
 * @param {string} linkedinUrl - LinkedIn profile URL
 * @returns {Promise<string>} - Snapshot ID for polling
 */
const triggerProfileScrape = async (linkedinUrl) => {
    try {
        console.log(`[BRIGHTDATA] Triggering scrape for: ${linkedinUrl}`);
        
        const response = await axios.post(
            `https://api.brightdata.com/datasets/v3/trigger`,
            [{
                url: linkedinUrl,
                dataset_id: BRIGHTDATA_DATASET_ID
            }],
            {
                params: {
                    dataset_id: BRIGHTDATA_DATASET_ID,
                    include_errors: true,
                    type: 'discover_new',
                    discover_by: 'url'
                },
                headers: {
                    'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const snapshotId = response.data?.snapshot_id;
        
        if (!snapshotId) {
            throw new Error('No snapshot_id returned from BrightData trigger API');
        }
        
        console.log(`[BRIGHTDATA] Scrape triggered. Snapshot ID: ${snapshotId}`);
        return snapshotId;
        
    } catch (error) {
        console.error('[BRIGHTDATA] Error triggering scrape:', error.response?.data || error.message);
        throw new Error(`Failed to trigger BrightData scrape: ${error.message}`);
    }
};

/**
 * Poll BrightData for profile data
 * @param {string} snapshotId - Snapshot ID from trigger
 * @returns {Promise<object>} - Profile data
 */
const pollForProfileData = async (snapshotId) => {
    try {
        console.log(`[BRIGHTDATA] Polling for snapshot: ${snapshotId}`);
        
        for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
            console.log(`[BRIGHTDATA] Poll attempt ${attempt}/${MAX_POLL_ATTEMPTS}`);
            
            const response = await axios.get(
                `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`,
                {
                    params: {
                        format: 'json'
                    },
                    headers: {
                        'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}`
                    }
                }
            );
            
            const status = response.data?.status;
            
            if (status === 'ready') {
                console.log(`[BRIGHTDATA] ✅ Data ready for snapshot: ${snapshotId}`);
                const profileData = response.data?.data || response.data;
                return profileData;
            }
            
            if (status === 'failed' || status === 'error') {
                throw new Error(`BrightData scrape failed with status: ${status}`);
            }
            
            // Status is 'running' or 'pending' - wait and retry
            console.log(`[BRIGHTDATA] Status: ${status}. Waiting ${POLL_INTERVAL_MS}ms...`);
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        
        throw new Error(`Polling timeout: Profile data not ready after ${MAX_POLL_ATTEMPTS} attempts`);
        
    } catch (error) {
        console.error('[BRIGHTDATA] Error polling for data:', error.response?.data || error.message);
        throw new Error(`Failed to poll BrightData: ${error.message}`);
    }
};

/**
 * Get LinkedIn profile data via BrightData (trigger + poll)
 * @param {string} linkedinUrl - LinkedIn profile URL
 * @returns {Promise<object>} - Complete profile data
 */
const getLinkedInProfile = async (linkedinUrl) => {
    try {
        // Step 1: Trigger scrape
        const snapshotId = await triggerProfileScrape(linkedinUrl);
        
        // Step 2: Poll for results
        const profileData = await pollForProfileData(snapshotId);
        
        return {
            snapshotId,
            profileData
        };
        
    } catch (error) {
        console.error('[BRIGHTDATA] Error in getLinkedInProfile:', error.message);
        throw error;
    }
};

/**
 * Format BrightData profile for GPT consumption
 * @param {object} brightDataProfile - Raw profile from BrightData
 * @returns {object} - Formatted profile
 */
const formatProfileForGPT = (brightDataProfile) => {
    try {
        // Handle array response (BrightData returns array)
        const profile = Array.isArray(brightDataProfile) ? brightDataProfile[0] : brightDataProfile;
        
        if (!profile) {
            throw new Error('Empty profile data received from BrightData');
        }
        
        return {
            fullName: profile.name || profile.full_name || 'Unknown',
            headline: profile.headline || profile.title || '',
            about: profile.about || profile.summary || '',
            location: profile.location || '',
            currentPosition: profile.current_company || profile.company || '',
            experience: profile.experiences || profile.experience || [],
            education: profile.education || [],
            skills: profile.skills || [],
            connections: profile.connections || profile.connection_count || 0,
            profileUrl: profile.url || profile.linkedin_url || '',
            
            // Additional fields that might be useful
            industry: profile.industry || '',
            languages: profile.languages || [],
            certifications: profile.certifications || [],
            volunteer: profile.volunteer || []
        };
        
    } catch (error) {
        console.error('[BRIGHTDATA] Error formatting profile:', error.message);
        throw new Error(`Failed to format profile data: ${error.message}`);
    }
};

module.exports = {
    getLinkedInProfile,
    formatProfileForGPT,
    triggerProfileScrape,
    pollForProfileData
};
