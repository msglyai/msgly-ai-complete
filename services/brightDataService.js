// Complete Bright Data Service - Production Ready
// Uses your specific LinkedIn collector: hl_e6a13256

const axios = require('axios');

class BrightDataService {
    constructor() {
        this.apiKey = process.env.BRIGHT_DATA_API_KEY;
        this.datasetId = process.env.BRIGHT_DATA_DATASET_ID;
        this.collectorId = process.env.BRIGHT_DATA_COLLECTOR_ID;
        this.baseUrl = 'https://api.brightdata.com';
        
        if (!this.apiKey || !this.datasetId) {
            throw new Error('Bright Data configuration missing. Check BRIGHT_DATA_API_KEY and BRIGHT_DATA_DATASET_ID');
        }
        
        console.log('✅ Bright Data Service initialized');
        console.log('📊 Dataset ID:', this.datasetId);
        console.log('🎯 Collector ID:', this.collectorId || 'default');
    }

    // Clean and validate LinkedIn URL
    cleanLinkedInUrl(url) {
        if (!url) throw new Error('LinkedIn URL is required');
        
        let cleanedUrl = url.split('?')[0].split('#')[0];
        
        if (!cleanedUrl.includes('linkedin.com/in/')) {
            throw new Error('Invalid LinkedIn profile URL. Must be linkedin.com/in/ format');
        }
        
        if (!cleanedUrl.startsWith('https://')) {
            cleanedUrl = cleanedUrl.replace(/^(https?:\/\/)?/, 'https://');
        }
        
        cleanedUrl = cleanedUrl.replace(/\/$/, '');
        
        console.log('[BRIGHT_DATA] ✅ URL cleaned:', cleanedUrl);
        return cleanedUrl;
    }

    // Extract complete LinkedIn profile
    async extractLinkedInProfile(profileUrl) {
        try {
            const cleanedUrl = this.cleanLinkedInUrl(profileUrl);
            console.log('[BRIGHT_DATA] 🚀 Starting extraction for:', cleanedUrl);

            // Create extraction request
            const requestPayload = {
                url: cleanedUrl,
                format: 'json'
            };

            console.log('[BRIGHT_DATA] 📤 Submitting extraction job...');

            // Submit to Bright Data
            const response = await axios.post(
                `${this.baseUrl}/datasets/${this.datasetId}/trigger`,
                [requestPayload],
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const snapshotId = response.data.snapshot_id;
            console.log('[BRIGHT_DATA] ✅ Job submitted. Snapshot ID:', snapshotId);

            // Wait for results
            const extractedData = await this.waitForResults(snapshotId);
            
            console.log('[BRIGHT_DATA] 🎉 Extraction completed!');
            
            // Process and return structured data
            return this.processLinkedInData(extractedData[0], cleanedUrl);

        } catch (error) {
            console.error('[BRIGHT_DATA] ❌ Extraction failed:', error.message);
            throw new Error(`LinkedIn extraction failed: ${error.message}`);
        }
    }

    // Wait for extraction results with polling
    async waitForResults(snapshotId, maxWaitTime = 300000) {
        const pollInterval = 5000;
        const startTime = Date.now();
        
        console.log('[BRIGHT_DATA] ⏳ Waiting for results...');
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check status
                const statusResponse = await axios.get(
                    `${this.baseUrl}/datasets/${this.datasetId}/snapshots/${snapshotId}`,
                    {
                        headers: { 'Authorization': `Bearer ${this.apiKey}` }
                    }
                );

                const status = statusResponse.data.status;
                console.log('[BRIGHT_DATA] 📊 Status:', status);

                if (status === 'ready') {
                    // Get data
                    const dataResponse = await axios.get(
                        `${this.baseUrl}/datasets/${this.datasetId}/snapshots/${snapshotId}/data`,
                        {
                            headers: {
                                'Authorization': `Bearer ${this.apiKey}`,
                                'Accept': 'application/json'
                            }
                        }
                    );

                    console.log('[BRIGHT_DATA] ✅ Data retrieved');
                    return dataResponse.data;
                }

                if (status === 'failed' || status === 'error') {
                    throw new Error(`Extraction failed with status: ${status}`);
                }

                // Wait before next check
                await new Promise(resolve => setTimeout(resolve, pollInterval));

            } catch (error) {
                console.error('[BRIGHT_DATA] ⚠️ Polling error:', error.message);
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }

        throw new Error('Extraction timeout - please try again');
    }

    // Process raw LinkedIn data into structured format
    processLinkedInData(rawData, originalUrl) {
        console.log('[BRIGHT_DATA] 🔧 Processing LinkedIn data...');
        
        if (!rawData) {
            console.warn('[BRIGHT_DATA] ⚠️ No data received');
            return this.createEmptyProfile(originalUrl);
        }

        console.log('[BRIGHT_DATA] 📋 Raw data fields:', Object.keys(rawData));

        const profile = {
            // Basic Information
            profile_url: originalUrl,
            name: this.extractField(rawData, ['name', 'full_name', 'display_name']),
            headline: this.extractField(rawData, ['headline', 'title', 'professional_headline']),
            summary: this.extractField(rawData, ['summary', 'about', 'description']),
            location: this.extractField(rawData, ['location', 'geo_location', 'city']),
            
            // Profile Media
            profile_picture: this.extractField(rawData, ['profile_picture', 'avatar_url', 'photo']),
            background_image: this.extractField(rawData, ['background_image', 'cover_photo']),
            
            // Current Position (HIGH PRIORITY!)
            current_position: this.extractField(rawData, ['current_position', 'position', 'current_title', 'job_title']),
            current_company: this.extractField(rawData, ['current_company', 'company', 'current_employer', 'employer']),
            current_company_url: this.extractField(rawData, ['current_company_url', 'company_url']),
            
            // Metrics
            connections_count: this.parseNumber(rawData.connections || rawData.connections_count || rawData.connection_count),
            followers_count: this.parseNumber(rawData.followers || rawData.followers_count || rawData.follower_count),
            
            // Professional Data
            experience: this.normalizeArray(rawData.experience || rawData.work_experience || rawData.positions, this.normalizeExperience),
            education: this.normalizeArray(rawData.education || rawData.education_history || rawData.schools, this.normalizeEducation),
            skills: this.normalizeArray(rawData.skills || rawData.skill_list || rawData.competencies, this.normalizeSkills),
            certifications: this.normalizeArray(rawData.certifications || rawData.certificates, this.normalizeCertifications),
            honors_awards: this.normalizeArray(rawData.honors_awards || rawData.awards || rawData.achievements, this.normalizeAwards),
            publications: this.normalizeArray(rawData.publications || rawData.papers, this.normalizePublications),
            projects: this.normalizeArray(rawData.projects || rawData.portfolio, this.normalizeProjects),
            volunteer_experience: this.normalizeArray(rawData.volunteer_experience || rawData.volunteering, this.normalizeVolunteer),
            languages: this.normalizeArray(rawData.languages || rawData.language_skills, this.normalizeLanguages),
            courses: this.normalizeArray(rawData.courses || rawData.training, this.normalizeCourses),
            
            // Recommendations
            recommendations_received: rawData.recommendations_received || [],
            recommendations_given: rawData.recommendations_given || [],
            
            // Metadata
            extraction_timestamp: new Date().toISOString(),
            data_completeness: this.calculateCompleteness(rawData),
            raw_data_summary: {
                total_fields: Object.keys(rawData).length,
                available_fields: Object.keys(rawData).slice(0, 15),
                has_experience: !!(rawData.experience || rawData.work_experience),
                has_education: !!(rawData.education || rawData.education_history),
                has_skills: !!(rawData.skills || rawData.skill_list)
            }
        };

        console.log('[BRIGHT_DATA] 📊 Extraction Summary:');
        console.log('  👤 Name:', profile.name || 'Not found');
        console.log('  💼 Position:', profile.current_position || 'Not found');
        console.log('  🏢 Company:', profile.current_company || 'Not found');
        console.log('  📈 Experience:', profile.experience.length, 'entries');
        console.log('  🎓 Education:', profile.education.length, 'entries');
        console.log('  🛠️ Skills:', profile.skills.length, 'items');
        console.log('  🏆 Certifications:', profile.certifications.length, 'items');
        console.log('  🌟 Awards:', profile.honors_awards.length, 'items');

        return profile;
    }

    // Helper methods
    extractField(data, possibleKeys) {
        for (const key of possibleKeys) {
            if (data[key] && typeof data[key] === 'string' && data[key].trim()) {
                return data[key].trim();
            }
        }
        return null;
    }

    parseNumber(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const num = parseInt(value.replace(/[^\d]/g, ''));
            return isNaN(num) ? 0 : num;
        }
        return 0;
    }

    normalizeArray(arr, normalizeFunc) {
        if (!Array.isArray(arr)) return [];
        return arr.map(item => normalizeFunc.call(this, item)).filter(item => item);
    }

    normalizeExperience(exp) {
        if (!exp || typeof exp !== 'object') return null;
        return {
            title: exp.title || exp.position || exp.role || exp.job_title,
            company: exp.company || exp.company_name || exp.employer,
            company_url: exp.company_url || exp.company_linkedin_url,
            location: exp.location,
            duration: exp.duration || this.formatDuration(exp.start_date, exp.end_date),
            start_date: exp.start_date || exp.from || exp.started,
            end_date: exp.end_date || exp.to || exp.ended || (exp.current ? 'Present' : null),
            description: exp.description || exp.summary,
            is_current: exp.current || exp.is_current || false
        };
    }

    normalizeEducation(edu) {
        if (!edu || typeof edu !== 'object') return null;
        return {
            school: edu.school || edu.institution || edu.university || edu.college,
            degree: edu.degree || edu.degree_name || edu.qualification,
            field_of_study: edu.field_of_study || edu.major || edu.subject,
            start_year: edu.start_year || edu.from,
            end_year: edu.end_year || edu.to || edu.graduation_year,
            grade: edu.grade || edu.gpa,
            description: edu.description
        };
    }

    normalizeSkills(skill) {
        if (!skill) return null;
        if (typeof skill === 'string') {
            return { name: skill, endorsements: 0 };
        }
        return {
            name: skill.name || skill.skill || skill.title,
            endorsements: skill.endorsements || skill.endorsement_count || 0,
            proficiency: skill.proficiency || skill.level
        };
    }

    normalizeCertifications(cert) {
        if (!cert || typeof cert !== 'object') return null;
        return {
            name: cert.name || cert.title || cert.certification,
            issuer: cert.issuer || cert.organization || cert.authority,
            issue_date: cert.issue_date || cert.date_earned,
            expiry_date: cert.expiry_date || cert.expires,
            credential_id: cert.credential_id || cert.id,
            url: cert.url || cert.verification_url
        };
    }

    normalizeAwards(award) {
        if (!award || typeof award !== 'object') return null;
        return {
            title: award.title || award.name || award.award,
            issuer: award.issuer || award.organization || award.authority,
            date: award.date || award.year,
            description: award.description
        };
    }

    normalizePublications(pub) {
        if (!pub || typeof pub !== 'object') return null;
        return {
            title: pub.title || pub.name,
            publisher: pub.publisher || pub.journal,
            date: pub.date || pub.published || pub.year,
            url: pub.url || pub.link,
            description: pub.description || pub.abstract
        };
    }

    normalizeProjects(project) {
        if (!project || typeof project !== 'object') return null;
        return {
            name: project.name || project.title,
            description: project.description || project.summary,
            start_date: project.start_date || project.from,
            end_date: project.end_date || project.to,
            url: project.url || project.link,
            skills: Array.isArray(project.skills) ? project.skills : []
        };
    }

    normalizeVolunteer(vol) {
        if (!vol || typeof vol !== 'object') return null;
        return {
            organization: vol.organization || vol.company,
            role: vol.role || vol.position || vol.title,
            cause: vol.cause || vol.area,
            start_date: vol.start_date || vol.from,
            end_date: vol.end_date || vol.to,
            description: vol.description
        };
    }

    normalizeLanguages(lang) {
        if (!lang) return null;
        if (typeof lang === 'string') {
            return { language: lang, proficiency: null };
        }
        return {
            language: lang.language || lang.name,
            proficiency: lang.proficiency || lang.level
        };
    }

    normalizeCourses(course) {
        if (!course || typeof course !== 'object') return null;
        return {
            name: course.name || course.title,
            institution: course.institution || course.provider,
            completion_date: course.completion_date || course.completed,
            description: course.description
        };
    }

    formatDuration(startDate, endDate) {
        if (!startDate) return null;
        if (!endDate || endDate === 'Present') {
            return `${startDate} - Present`;
        }
        return `${startDate} - ${endDate}`;
    }

    calculateCompleteness(data) {
        const fields = ['name', 'headline', 'current_position', 'current_company', 'experience', 'education', 'skills'];
        let completed = 0;
        
        fields.forEach(field => {
            if (data[field]) {
                if (Array.isArray(data[field])) {
                    if (data[field].length > 0) completed++;
                } else if (data[field] !== '') {
                    completed++;
                }
            }
        });
        
        return Math.round((completed / fields.length) * 100);
    }

    createEmptyProfile(url) {
        return {
            profile_url: url,
            name: null,
            headline: null,
            summary: null,
            location: null,
            current_position: null,
            current_company: null,
            current_company_url: null,
            connections_count: 0,
            followers_count: 0,
            experience: [],
            education: [],
            skills: [],
            certifications: [],
            honors_awards: [],
            publications: [],
            projects: [],
            volunteer_experience: [],
            languages: [],
            courses: [],
            recommendations_received: [],
            recommendations_given: [],
            extraction_timestamp: new Date().toISOString(),
            data_completeness: 0,
            raw_data_summary: { total_fields: 0, available_fields: [] }
        };
    }

    // Get service statistics
    async getStats() {
        return {
            service_status: 'operational',
            bright_data_configured: !!this.apiKey,
            dataset_id: this.datasetId,
            collector_id: this.collectorId,
            features: ['Complete Profile Extraction', 'Auto Retry', 'Data Normalization']
        };
    }
}

module.exports = BrightDataService;
