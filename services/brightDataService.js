// Fixed Bright Data Service - Correct API Endpoint Format
// Uses official Bright Data API v3 endpoint with proper authentication

const axios = require('axios');

class BrightDataService {
    constructor() {
        this.apiKey = process.env.BRIGHT_DATA_API_KEY;
        this.datasetId = process.env.BRIGHT_DATA_DATASET_ID; // gd_l1vikt17zbv17bjuj0
        this.collectorId = process.env.BRIGHT_DATA_COLLECTOR_ID; // hl_e6a13256
        
        // Correct Bright Data API v3 endpoint
        this.apiUrl = 'https://api.brightdata.com/datasets/v3/trigger';
        
        console.log('[BRIGHT_DATA] 🚀 Service initialized');
        console.log(`[BRIGHT_DATA] 📊 Dataset ID: ${this.datasetId}`);
        console.log(`[BRIGHT_DATA] 🎯 Collector ID: ${this.collectorId}`);
    }

    async extractLinkedInProfile(profileUrl) {
        try {
            console.log(`[BRIGHT_DATA] 🚀 Starting extraction for: ${profileUrl}`);
            
            // Clean and validate LinkedIn URL
            const cleanedUrl = this.cleanLinkedInUrl(profileUrl);
            console.log(`[BRIGHT_DATA] 🧹 URL cleaned: ${cleanedUrl}`);
            
            // Start extraction using correct Bright Data API v3 format
            const extractionResult = await this.triggerExtraction(cleanedUrl);
            
            // Wait for extraction completion
            const finalData = await this.waitForResults(extractionResult.snapshot_id);
            
            console.log(`[BRIGHT_DATA] ✅ Extraction completed successfully`);
            return finalData;
            
        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ Extraction failed:`, error.message);
            throw new Error(`LinkedIn extraction failed: ${error.message}`);
        }
    }

    async triggerExtraction(profileUrl) {
        try {
            console.log(`[BRIGHT_DATA] 🔄 Submitting extraction job...`);
            
            // Correct API call format according to Bright Data docs
            const response = await axios.post(
                `${this.apiUrl}?dataset_id=${this.datasetId}`,
                [{ url: profileUrl }], // Array format as required by API
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`, // Correct Bearer format
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            console.log(`[BRIGHT_DATA] ✅ Job submitted successfully`);
            console.log(`[BRIGHT_DATA] 📋 Snapshot ID: ${response.data.snapshot_id}`);
            
            return {
                success: true,
                snapshot_id: response.data.snapshot_id,
                status: response.data.status
            };

        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ API request failed:`, error.response?.data || error.message);
            
            // Enhanced error logging for debugging
            if (error.response) {
                console.error(`[BRIGHT_DATA] 📊 Status Code: ${error.response.status}`);
                console.error(`[BRIGHT_DATA] 📋 Response Data:`, error.response.data);
                console.error(`[BRIGHT_DATA] 🔑 Request URL: ${this.apiUrl}?dataset_id=${this.datasetId}`);
            }
            
            throw new Error(`Request failed with status code ${error.response?.status || 'unknown'}`);
        }
    }

    async waitForResults(snapshotId, maxWaitTime = 300000) { // 5 minutes max
        const startTime = Date.now();
        const pollInterval = 10000; // 10 seconds
        
        console.log(`[BRIGHT_DATA] ⏳ Waiting for extraction completion...`);
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check snapshot status
                const statusResponse = await axios.get(
                    `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        timeout: 15000
                    }
                );

                const status = statusResponse.data.status;
                console.log(`[BRIGHT_DATA] 📊 Status: ${status}`);

                if (status === 'ready') {
                    // Download the results
                    return await this.downloadResults(snapshotId);
                } else if (status === 'failed') {
                    throw new Error('Bright Data extraction failed');
                }

                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, pollInterval));

            } catch (error) {
                console.error(`[BRIGHT_DATA] ❌ Error checking status:`, error.message);
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }

        throw new Error('Extraction timeout - taking longer than expected');
    }

    async downloadResults(snapshotId) {
        try {
            console.log(`[BRIGHT_DATA] 📥 Downloading extraction results...`);
            
            const response = await axios.get(
                `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    timeout: 30000
                }
            );

            const data = response.data;
            console.log(`[BRIGHT_DATA] ✅ Results downloaded successfully`);
            
            // Process and normalize the LinkedIn data
            return this.processLinkedInData(data);

        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ Failed to download results:`, error.message);
            throw new Error(`Failed to download results: ${error.message}`);
        }
    }

    processLinkedInData(rawData) {
        try {
            console.log(`[BRIGHT_DATA] 🔄 Processing LinkedIn profile data...`);
            
            // Handle array or single object response
            const profiles = Array.isArray(rawData) ? rawData : [rawData];
            const profile = profiles[0];

            if (!profile) {
                throw new Error('No profile data found in response');
            }

            // Enhanced data extraction with fallback logic
            const processedData = {
                // Basic Information
                name: profile.name || profile.full_name || null,
                headline: profile.headline || profile.title || profile.current_position || null,
                location: profile.location || profile.geo_location || null,
                summary: profile.summary || profile.about || null,
                profileUrl: profile.url || profile.profile_url || null,
                linkedinId: profile.linkedin_id || profile.id || null,
                profilePicture: profile.profile_picture || profile.avatar_url || null,
                
                // Current Position & Company
                currentPosition: profile.current_position || profile.headline || null,
                currentCompany: profile.current_company || null,
                
                // Experience
                experience: this.extractExperience(profile),
                
                // Education
                education: this.extractEducation(profile),
                
                // Skills
                skills: this.extractSkills(profile),
                
                // Additional Information
                certifications: profile.certifications || [],
                languages: profile.languages || [],
                awards: profile.awards || profile.honors || [],
                publications: profile.publications || [],
                projects: profile.projects || [],
                volunteerExperience: profile.volunteer_experience || [],
                
                // Social Metrics
                connections: profile.connections_count || profile.connections || null,
                followers: profile.followers_count || profile.followers || null,
                
                // Metadata
                extractedAt: new Date().toISOString(),
                completeness: this.calculateCompleteness(profile)
            };

            console.log(`[BRIGHT_DATA] ✅ Data processing completed`);
            console.log(`[BRIGHT_DATA] 📊 Profile completeness: ${processedData.completeness}%`);
            
            return processedData;

        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ Error processing data:`, error.message);
            throw new Error(`Failed to process LinkedIn data: ${error.message}`);
        }
    }

    extractExperience(profile) {
        const experience = profile.experience || profile.work_experience || profile.positions || [];
        
        return experience.map(exp => ({
            title: exp.title || exp.position || exp.job_title || null,
            company: exp.company || exp.company_name || null,
            location: exp.location || null,
            startDate: exp.start_date || exp.from_date || null,
            endDate: exp.end_date || exp.to_date || null,
            isCurrent: exp.is_current || exp.current || false,
            description: exp.description || exp.summary || null,
            duration: exp.duration || null
        }));
    }

    extractEducation(profile) {
        const education = profile.education || profile.schools || [];
        
        return education.map(edu => ({
            school: edu.school || edu.institution || edu.university || null,
            degree: edu.degree || edu.field_of_study || null,
            fieldOfStudy: edu.field_of_study || edu.major || null,
            startDate: edu.start_date || edu.from_date || null,
            endDate: edu.end_date || edu.to_date || null,
            grade: edu.grade || edu.gpa || null,
            description: edu.description || null
        }));
    }

    extractSkills(profile) {
        const skills = profile.skills || profile.skill_list || [];
        
        if (Array.isArray(skills)) {
            return skills.map(skill => ({
                name: typeof skill === 'string' ? skill : skill.name || skill.skill_name || null,
                endorsements: typeof skill === 'object' ? skill.endorsements || 0 : 0
            }));
        }
        
        return [];
    }

    calculateCompleteness(profile) {
        const fields = [
            'name', 'headline', 'location', 'summary',
            'current_position', 'experience', 'education', 
            'skills', 'connections'
        ];
        
        const filledFields = fields.filter(field => {
            const value = profile[field];
            return value && value !== null && value !== '' && 
                   (Array.isArray(value) ? value.length > 0 : true);
        });
        
        return Math.round((filledFields.length / fields.length) * 100);
    }

    cleanLinkedInUrl(url) {
        if (!url) throw new Error('LinkedIn URL is required');
        
        // Remove trailing slashes and clean URL
        let cleanUrl = url.trim().replace(/\/$/, '');
        
        // Ensure it's a valid LinkedIn profile URL
        if (!cleanUrl.includes('linkedin.com/in/')) {
            throw new Error('Invalid LinkedIn profile URL format');
        }
        
        // Convert to standard format
        if (!cleanUrl.startsWith('https://')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\//, 'https://');
            if (!cleanUrl.startsWith('https://')) {
                cleanUrl = 'https://' + cleanUrl;
            }
        }
        
        return cleanUrl;
    }

    // Status and monitoring methods
    async getExtractionStats() {
        return {
            service: 'BrightData LinkedIn Extractor',
            version: '2.0',
            configured: !!(this.apiKey && this.datasetId),
            endpoint: this.apiUrl,
            datasetId: this.datasetId,
            collectorId: this.collectorId
        };
    }
}

module.exports = BrightDataService;
