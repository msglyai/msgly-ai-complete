// Official Bright Data LinkedIn Service - Based on luminati-io/LinkedIn-Scraper Research
// Uses the official Bright Data LinkedIn Scraper API for comprehensive data extraction

const axios = require('axios');

class BrightDataService {
    constructor() {
        this.apiKey = process.env.BRIGHT_DATA_API_KEY;
        this.datasetId = process.env.BRIGHT_DATA_DATASET_ID; // gd_l1vikt17zbv17bjuj0
        
        // Official Bright Data LinkedIn Scraper API endpoint
        this.linkedinApiUrl = 'https://api.brightdata.com/datasets/v3/trigger';
        
        console.log('[BRIGHT_DATA] 🚀 Official LinkedIn Scraper initialized');
        console.log(`[BRIGHT_DATA] 📊 Dataset ID: ${this.datasetId}`);
        console.log(`[BRIGHT_DATA] 💼 Using LinkedIn Scraper API (Official)`);
    }

    async extractLinkedInProfile(profileUrl) {
        try {
            console.log(`[BRIGHT_DATA] 🚀 Starting LinkedIn profile extraction: ${profileUrl}`);
            
            // Clean LinkedIn URL
            const cleanedUrl = this.cleanLinkedInUrl(profileUrl);
            console.log(`[BRIGHT_DATA] 🧹 URL cleaned: ${cleanedUrl}`);
            
            // Start extraction using official LinkedIn API
            const extractionResult = await this.triggerLinkedInExtraction(cleanedUrl);
            
            // For faster sign-up: Return immediately with job ID, process async
            if (extractionResult.snapshot_id) {
                console.log(`[BRIGHT_DATA] ✅ LinkedIn extraction job started: ${extractionResult.snapshot_id}`);
                
                // Start async processing (don't wait)
                this.processAsyncExtraction(extractionResult.snapshot_id).catch(error => {
                    console.error(`[BRIGHT_DATA] ❌ Async processing failed:`, error.message);
                });
                
                return {
                    success: true,
                    jobId: extractionResult.snapshot_id,
                    status: 'processing',
                    message: 'LinkedIn extraction started - will complete in background'
                };
            }
            
            throw new Error('Failed to start LinkedIn extraction');
            
        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ LinkedIn extraction failed:`, error.message);
            throw new Error(`LinkedIn extraction failed: ${error.message}`);
        }
    }

    async triggerLinkedInExtraction(profileUrl) {
        try {
            console.log(`[BRIGHT_DATA] 🔄 Triggering LinkedIn extraction via official API...`);
            
            // Official Bright Data LinkedIn Scraper API call
            // Based on luminati-io/LinkedIn-Scraper repository structure
            const response = await axios.post(
                `${this.linkedinApiUrl}?dataset_id=${this.datasetId}`,
                [{
                    url: profileUrl,
                    // Additional LinkedIn-specific parameters based on research
                    include_skills: true,
                    include_experience: true,
                    include_education: true,
                    include_certifications: true,
                    include_awards: true,
                    include_languages: true,
                    include_volunteer: true,
                    include_publications: true,
                    include_projects: true
                }],
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            console.log(`[BRIGHT_DATA] ✅ LinkedIn extraction job submitted`);
            console.log(`[BRIGHT_DATA] 📋 Snapshot ID: ${response.data.snapshot_id}`);
            
            return {
                success: true,
                snapshot_id: response.data.snapshot_id,
                status: response.data.status || 'processing'
            };

        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ LinkedIn API request failed:`, error.response?.data || error.message);
            
            if (error.response) {
                console.error(`[BRIGHT_DATA] 📊 Status: ${error.response.status}`);
                console.error(`[BRIGHT_DATA] 📋 Response:`, error.response.data);
            }
            
            throw new Error(`LinkedIn API request failed: ${error.response?.status || error.message}`);
        }
    }

    // Async processing - runs in background after sign-up completes
    async processAsyncExtraction(snapshotId) {
        try {
            console.log(`[BRIGHT_DATA] ⏳ Starting async processing for: ${snapshotId}`);
            
            // Wait for extraction completion (up to 10 minutes)
            const results = await this.waitForLinkedInResults(snapshotId, 600000);
            
            if (results && results.success) {
                console.log(`[BRIGHT_DATA] ✅ Async extraction completed successfully`);
                
                // Save to database via database service
                const DatabaseService = require('./databaseService');
                const dbService = new DatabaseService();
                
                // Find user by LinkedIn URL to save results
                await dbService.saveAsyncLinkedInProfile(snapshotId, results.data);
                
                console.log(`[BRIGHT_DATA] 💾 Async results saved to database`);
            }
            
        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ Async processing error:`, error.message);
            
            // Mark as failed in database
            try {
                const DatabaseService = require('./databaseService');
                const dbService = new DatabaseService();
                await dbService.markAsyncExtractionFailed(snapshotId, error.message);
            } catch (dbError) {
                console.error(`[BRIGHT_DATA] ❌ Failed to mark extraction as failed:`, dbError.message);
            }
        }
    }

    async waitForLinkedInResults(snapshotId, maxWaitTime = 600000) { // 10 minutes max
        const startTime = Date.now();
        const pollInterval = 15000; // 15 seconds - longer intervals for background processing
        
        console.log(`[BRIGHT_DATA] ⏳ Monitoring LinkedIn extraction: ${snapshotId}`);
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check status using official API
                const statusResponse = await axios.get(
                    `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        timeout: 30000
                    }
                );

                const status = statusResponse.data.status;
                console.log(`[BRIGHT_DATA] 📊 Status check: ${status}`);

                if (status === 'ready') {
                    // Download and process results
                    const linkedinData = await this.downloadLinkedInResults(snapshotId);
                    return {
                        success: true,
                        data: linkedinData,
                        completedAt: new Date().toISOString()
                    };
                } else if (status === 'failed') {
                    throw new Error('Bright Data LinkedIn extraction failed');
                }

                // Wait before next check
                await new Promise(resolve => setTimeout(resolve, pollInterval));

            } catch (error) {
                console.error(`[BRIGHT_DATA] ❌ Status check error:`, error.message);
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }

        throw new Error('LinkedIn extraction timeout - exceeded maximum wait time');
    }

    async downloadLinkedInResults(snapshotId) {
        try {
            console.log(`[BRIGHT_DATA] 📥 Downloading LinkedIn results: ${snapshotId}`);
            
            const response = await axios.get(
                `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    timeout: 60000
                }
            );

            const rawData = response.data;
            console.log(`[BRIGHT_DATA] ✅ LinkedIn data downloaded successfully`);
            
            // Process comprehensive LinkedIn data based on official API structure
            return this.processOfficialLinkedInData(rawData);

        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ Download failed:`, error.message);
            throw new Error(`Failed to download LinkedIn results: ${error.message}`);
        }
    }

    processOfficialLinkedInData(rawData) {
        try {
            console.log(`[BRIGHT_DATA] 🔄 Processing official LinkedIn data...`);
            
            // Handle official Bright Data LinkedIn API response format
            const profiles = Array.isArray(rawData) ? rawData : [rawData];
            const profile = profiles[0];

            if (!profile) {
                throw new Error('No LinkedIn profile data found');
            }

            // Comprehensive data extraction based on official API structure
            // Research shows format: {"name":"Richard Branson","position":"Founder at Virgin Group", "experience":[...], "education":[...], "skills":[...], "connections": 500+, ...}
            const processedData = {
                // Core Profile Information
                name: profile.name || profile.full_name || null,
                headline: profile.headline || profile.position || profile.current_position || null,
                location: profile.location || profile.geo_location || null,
                summary: profile.summary || profile.about || null,
                profileUrl: profile.url || profile.profile_url || profile.linkedin_url || null,
                linkedinId: profile.linkedin_id || profile.id || null,
                profilePicture: profile.profile_picture || profile.avatar_url || profile.photo || null,
                
                // Current Position & Company (Research highlighted these as important)
                currentPosition: profile.current_position || profile.position || profile.headline || null,
                currentCompany: profile.current_company || profile.company || null,
                
                // Comprehensive Work Experience
                experience: this.extractDetailedExperience(profile),
                
                // Education History
                education: this.extractDetailedEducation(profile),
                
                // Skills with Endorsements
                skills: this.extractDetailedSkills(profile),
                
                // Professional Credentials
                certifications: this.extractCertifications(profile),
                languages: this.extractLanguages(profile),
                awards: this.extractAwards(profile),
                
                // Publications & Projects
                publications: this.extractPublications(profile),
                projects: this.extractProjects(profile),
                
                // Volunteer Experience
                volunteerExperience: this.extractVolunteerExperience(profile),
                
                // Social Metrics
                connections: this.extractConnections(profile),
                followers: profile.followers_count || profile.followers || null,
                
                // Additional Data
                recommendations: profile.recommendations || [],
                courses: profile.courses || [],
                patents: profile.patents || [],
                testScores: profile.test_scores || [],
                
                // Metadata
                extractedAt: new Date().toISOString(),
                dataSource: 'Bright Data LinkedIn Scraper API',
                completeness: this.calculateCompleteness(profile),
                processingTime: profile.processing_time || null
            };

            console.log(`[BRIGHT_DATA] ✅ Official LinkedIn data processed`);
            console.log(`[BRIGHT_DATA] 📊 Profile completeness: ${processedData.completeness}%`);
            console.log(`[BRIGHT_DATA] 👤 Profile: ${processedData.name} - ${processedData.currentPosition}`);
            
            return processedData;

        } catch (error) {
            console.error(`[BRIGHT_DATA] ❌ Data processing error:`, error.message);
            throw new Error(`Failed to process LinkedIn data: ${error.message}`);
        }
    }

    // Enhanced extraction methods based on official API response structure
    extractDetailedExperience(profile) {
        const experience = profile.experience || profile.work_experience || profile.positions || profile.jobs || [];
        
        return experience.map(exp => ({
            title: exp.title || exp.position || exp.job_title || exp.role || null,
            company: exp.company || exp.company_name || exp.organization || null,
            companyUrl: exp.company_url || exp.company_linkedin_url || null,
            location: exp.location || exp.geo_location || null,
            startDate: exp.start_date || exp.from_date || exp.start || null,
            endDate: exp.end_date || exp.to_date || exp.end || null,
            isCurrent: exp.is_current || exp.current || (exp.end_date === null) || false,
            description: exp.description || exp.summary || exp.details || null,
            duration: exp.duration || null,
            industry: exp.industry || null,
            companySize: exp.company_size || null
        }));
    }

    extractDetailedEducation(profile) {
        const education = profile.education || profile.schools || profile.academic_background || [];
        
        return education.map(edu => ({
            school: edu.school || edu.institution || edu.university || edu.college || null,
            schoolUrl: edu.school_url || edu.institution_url || null,
            degree: edu.degree || edu.degree_name || null,
            fieldOfStudy: edu.field_of_study || edu.major || edu.subject || null,
            startDate: edu.start_date || edu.from_date || edu.start_year || null,
            endDate: edu.end_date || edu.to_date || edu.end_year || null,
            grade: edu.grade || edu.gpa || edu.score || null,
            description: edu.description || edu.activities || null,
            location: edu.location || null
        }));
    }

    extractDetailedSkills(profile) {
        const skills = profile.skills || profile.skill_list || profile.competencies || [];
        
        if (Array.isArray(skills)) {
            return skills.map(skill => ({
                name: typeof skill === 'string' ? skill : (skill.name || skill.skill_name || skill.title || null),
                endorsements: typeof skill === 'object' ? (skill.endorsements || skill.endorsement_count || 0) : 0,
                level: typeof skill === 'object' ? skill.level : null
            }));
        }
        
        return [];
    }

    extractCertifications(profile) {
        const certs = profile.certifications || profile.certificates || profile.credentials || [];
        
        return certs.map(cert => ({
            name: cert.name || cert.title || cert.certification_name || null,
            authority: cert.authority || cert.issuer || cert.organization || null,
            issueDate: cert.issue_date || cert.date_issued || null,
            expirationDate: cert.expiration_date || cert.expires || null,
            credentialId: cert.credential_id || cert.id || null,
            credentialUrl: cert.credential_url || cert.url || null
        }));
    }

    extractLanguages(profile) {
        const languages = profile.languages || profile.language_skills || [];
        
        return languages.map(lang => ({
            language: lang.language || lang.name || lang.title || null,
            proficiency: lang.proficiency || lang.level || null
        }));
    }

    extractAwards(profile) {
        const awards = profile.awards || profile.honors || profile.achievements || [];
        
        return awards.map(award => ({
            title: award.title || award.name || null,
            issuer: award.issuer || award.organization || null,
            date: award.date || award.issue_date || null,
            description: award.description || null
        }));
    }

    extractPublications(profile) {
        const publications = profile.publications || profile.papers || [];
        
        return publications.map(pub => ({
            title: pub.title || pub.name || null,
            publisher: pub.publisher || pub.publication || null,
            date: pub.date || pub.publish_date || null,
            description: pub.description || pub.summary || null,
            url: pub.url || null
        }));
    }

    extractProjects(profile) {
        const projects = profile.projects || profile.portfolio || [];
        
        return projects.map(project => ({
            title: project.title || project.name || null,
            description: project.description || project.summary || null,
            startDate: project.start_date || null,
            endDate: project.end_date || null,
            url: project.url || project.link || null,
            skills: project.skills || []
        }));
    }

    extractVolunteerExperience(profile) {
        const volunteer = profile.volunteer_experience || profile.volunteering || [];
        
        return volunteer.map(vol => ({
            role: vol.role || vol.position || vol.title || null,
            organization: vol.organization || vol.company || null,
            cause: vol.cause || vol.area || null,
            startDate: vol.start_date || null,
            endDate: vol.end_date || null,
            description: vol.description || null
        }));
    }

    extractConnections(profile) {
        // Handle various connection formats from LinkedIn API
        const connections = profile.connections || profile.connections_count || profile.connection_count || null;
        
        if (typeof connections === 'string') {
            // Handle "500+" format
            if (connections.includes('+')) {
                return parseInt(connections.replace('+', '')) || null;
            }
            return parseInt(connections) || null;
        }
        
        return connections;
    }

    calculateCompleteness(profile) {
        const requiredFields = [
            'name', 'headline', 'location', 'summary',
            'current_position', 'experience', 'education', 
            'skills', 'connections'
        ];
        
        const optionalFields = [
            'certifications', 'languages', 'awards', 'publications',
            'projects', 'volunteer_experience'
        ];
        
        const allFields = [...requiredFields, ...optionalFields];
        
        const filledFields = allFields.filter(field => {
            const value = profile[field];
            return value && value !== null && value !== '' && 
                   (Array.isArray(value) ? value.length > 0 : true);
        });
        
        return Math.round((filledFields.length / allFields.length) * 100);
    }

    cleanLinkedInUrl(url) {
        if (!url) throw new Error('LinkedIn URL is required');
        
        let cleanUrl = url.trim().replace(/\/$/, '');
        
        if (!cleanUrl.includes('linkedin.com/in/')) {
            throw new Error('Invalid LinkedIn profile URL format');
        }
        
        if (!cleanUrl.startsWith('https://')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\//, 'https://');
            if (!cleanUrl.startsWith('https://')) {
                cleanUrl = 'https://' + cleanUrl;
            }
        }
        
        return cleanUrl;
    }

    // Status and monitoring
    async getExtractionStats() {
        return {
            service: 'Official Bright Data LinkedIn Scraper',
            version: '3.0',
            apiType: 'LinkedIn Scraper API',
            configured: !!(this.apiKey && this.datasetId),
            endpoint: this.linkedinApiUrl,
            datasetId: this.datasetId,
            features: [
                'Complete Profile Extraction',
                'Async Background Processing', 
                'Official LinkedIn API',
                'Comprehensive Data Coverage'
            ]
        };
    }
}

module.exports = BrightDataService;
