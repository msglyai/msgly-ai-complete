// User Management Routes - STEP 2E: Extracted from server.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Router setup
const router = express.Router();

// This will be initialized when the routes are mounted
let pool, authenticateToken;
let getUserByEmail, getUserById, createUser, createOrUpdateUserProfile;
let getSetupStatusMessage;

const JWT_SECRET = process.env.JWT_SECRET || 'msgly-simple-secret-2024';

// Initialize function to inject dependencies
const initUserRoutes = (dependencies) => {
    pool = dependencies.pool;
    authenticateToken = dependencies.authenticateToken;
    getUserByEmail = dependencies.getUserByEmail;
    getUserById = dependencies.getUserById;
    createUser = dependencies.createUser;
    createOrUpdateUserProfile = dependencies.createOrUpdateUserProfile;
    getSetupStatusMessage = dependencies.getSetupStatusMessage;
};

// ==================== USER MANAGEMENT ROUTES ====================

// User Registration
router.post('/register', async (req, res) => {
    console.log('👤 Registration request:', req.body);
    
    try {
        const { email, password, packageType, billingModel } = req.body;
        
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
        
        if (packageType !== 'free') {
            return res.status(400).json({
                success: false,
                error: 'Only free package is available during beta'
            });
        }
        
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists with this email'
            });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await createUser(email, passwordHash, packageType, billingModel || 'monthly');
        
        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            JWT_SECRET,
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
        
        console.log(`✅ User registered: ${newUser.email}`);
        
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
router.post('/login', async (req, res) => {
    console.log('🔐 Login request for:', req.body.email);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                error: 'Please sign in with Google'
            });
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.display_name,
                    profilePicture: user.profile_picture,
                    packageType: user.package_type,
                    billingModel: user.billing_model,
                    credits: user.credits_remaining,
                    subscriptionStatus: user.subscription_status,
                    hasGoogleAccount: !!user.google_id
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

// ✅ FIXED: Complete registration endpoint - Sets registration_completed = true
router.post('/complete-registration', authenticateToken, async (req, res) => {
    console.log('🎯 Complete registration request for user:', req.user.id);
    
    try {
        const { linkedinUrl, packageType, termsAccepted } = req.body;
        
        // Validation
        if (!termsAccepted) {
            return res.status(400).json({
                success: false,
                error: 'You must accept the Terms of Service and Privacy Policy'
            });
        }
        
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required'
            });
        }
        
        if (!linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL'
            });
        }
        
        if (packageType && packageType !== req.user.package_type) {
            if (packageType !== 'free') {
                return res.status(400).json({
                    success: false,
                    error: 'Only free package is available during beta'
                });
            }
            
            await pool.query(
                'UPDATE users SET package_type = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [packageType, req.user.id]
            );
        }
        
        // Create profile without background extraction
        const profile = await createOrUpdateUserProfile(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        // ✅ FIXED: Set registration_completed = true instead of profile_completed
        await pool.query(
            'UPDATE users SET registration_completed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [true, req.user.id]
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Registration completed successfully! Please use the Chrome extension to complete your profile setup with enhanced data extraction.',
            data: {
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.display_name,
                    packageType: updatedUser.package_type,
                    credits: updatedUser.credits_remaining
                },
                profile: {
                    linkedinUrl: profile.linkedin_url,
                    fullName: profile.full_name,
                    extractionStatus: profile.data_extraction_status
                },
                nextSteps: {
                    message: 'Install the Chrome extension and visit your LinkedIn profile to complete setup with enhanced data extraction',
                    requiresExtension: true,
                    enhancedFeatures: 'Now extracts certifications, awards, activity, and engagement metrics'
                }
            }
        });
        
        console.log(`✅ Registration completed for user ${updatedUser.email} - Enhanced Chrome extension required!`);
        
    } catch (error) {
        console.error('❌ Complete registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration completion failed',
            details: error.message
        });
    }
});

// ✅ FIXED: Update profile endpoint - Sets registration_completed = true
router.post('/update-profile', authenticateToken, async (req, res) => {
    console.log('📝 Profile update request for user:', req.user.id);
    
    try {
        const { linkedinUrl, packageType } = req.body;
        
        if (!linkedinUrl) {
            return res.status(400).json({
                success: false,
                error: 'LinkedIn URL is required'
            });
        }
        
        if (!linkedinUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a valid LinkedIn profile URL'
            });
        }
        
        // Update package type if needed
        if (packageType && packageType !== req.user.package_type) {
            if (packageType !== 'free') {
                return res.status(400).json({
                    success: false,
                    error: 'Only free package is available during beta'
                });
            }
            
            await pool.query(
                'UPDATE users SET package_type = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [packageType, req.user.id]
            );
        }
        
        // Create profile without background extraction
        const profile = await createOrUpdateUserProfile(
            req.user.id, 
            linkedinUrl, 
            req.user.display_name
        );
        
        // ✅ FIXED: Set registration_completed = true instead of profile_completed  
        await pool.query(
            'UPDATE users SET registration_completed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [true, req.user.id]
        );
        
        const updatedUser = await getUserById(req.user.id);
        
        res.json({
            success: true,
            message: 'Profile updated successfully! Please use the Chrome extension to complete your profile setup with enhanced data extraction.',
            data: {
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.display_name,
                    packageType: updatedUser.package_type,
                    credits: updatedUser.credits_remaining
                },
                profile: {
                    linkedinUrl: profile.linkedin_url,
                    fullName: profile.full_name,
                    extractionStatus: profile.data_extraction_status
                },
                nextSteps: {
                    message: 'Install the Chrome extension and visit your LinkedIn profile to complete setup with enhanced data extraction',
                    requiresExtension: true,
                    enhancedFeatures: 'Now extracts certifications, awards, activity, and engagement metrics'
                }
            }
        });
        
        console.log(`✅ Profile updated for user ${updatedUser.email} - Enhanced Chrome extension required!`);
        
    } catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Enhanced user setup status endpoint for feature lock - WITH ESCAPED current_role
router.get('/user/setup-status', authenticateToken, async (req, res) => {
    try {
        console.log(`🔍 Checking enhanced setup status for user ${req.user.id}`);
        
        const result = await pool.query(`
            SELECT 
                up.initial_scraping_done,
                up.linkedin_url as profile_linkedin_url,
                up.data_extraction_status,
                up.experience,
                up.full_name,
                up.headline,
                up."current_role",  -- ✅ FIXED: Escaped reserved word in query
                up.current_company,
                up.certifications,
                up.awards,
                up.activity,
                up.total_likes,
                up.total_comments,
                u.linkedin_url as user_linkedin_url,
                u.registration_completed,  -- ✅ FIXED: Get registration_completed field
                COALESCE(up.linkedin_url, u.linkedin_url) as linkedin_url
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        let setupStatus = 'not_started';
        let userLinkedInUrl = null;
        let hasExperience = false;
        let isComplete = false;
        let enhancedData = {};
        let registrationCompleted = false;
        
        if (result.rows.length > 0) {
            const data = result.rows[0];
            const initialScrapingDone = data.initial_scraping_done || false;
            const extractionStatus = data.data_extraction_status || 'not_started';
            userLinkedInUrl = data.linkedin_url;
            registrationCompleted = data.registration_completed || false;  // ✅ FIXED: Get registration_completed
            
            // Check if user has experience
            if (data.experience && Array.isArray(data.experience)) {
                hasExperience = data.experience.length > 0;
            }
            
            // ✅ ENHANCED: Check for additional data
            enhancedData = {
                certificationsCount: data.certifications ? data.certifications.length : 0,
                awardsCount: data.awards ? data.awards.length : 0,
                activityCount: data.activity ? data.activity.length : 0,
                totalLikes: data.total_likes || 0,
                totalComments: data.total_comments || 0,
                hasEngagement: (data.total_likes || 0) > 0 || (data.total_comments || 0) > 0
            };
            
            // ✅ FIXED: Determine setup status based on registration_completed
            if (!registrationCompleted) {
                setupStatus = 'registration_incomplete';
            } else if (!initialScrapingDone || extractionStatus !== 'completed') {
                setupStatus = 'profile_sync_needed';
            } else if (!hasExperience) {
                setupStatus = 'incomplete_experience';
            } else {
                setupStatus = 'completed';
                isComplete = true;
            }
            
            console.log(`📊 Enhanced setup status for user ${req.user.id}:`);
            console.log(`   - Registration completed: ${registrationCompleted}`);  // ✅ FIXED
            console.log(`   - Initial scraping done: ${initialScrapingDone}`);
            console.log(`   - Extraction status: ${extractionStatus}`);
            console.log(`   - Has experience: ${hasExperience}`);
            console.log(`   - Certifications: ${enhancedData.certificationsCount}`);
            console.log(`   - Awards: ${enhancedData.awardsCount}`);
            console.log(`   - Activity: ${enhancedData.activityCount}`);
            console.log(`   - Engagement: ${enhancedData.hasEngagement}`);
            console.log(`   - Setup status: ${setupStatus}`);
        }
        
        res.json({
            success: true,
            data: {
                setupStatus: setupStatus,
                isComplete: isComplete,
                userLinkedInUrl: userLinkedInUrl,
                hasExperience: hasExperience,
                registrationCompleted: registrationCompleted,  // ✅ FIXED: Include registration_completed
                requiresAction: !isComplete,
                message: getSetupStatusMessage(setupStatus),
                enhancedData: enhancedData
            }
        });
        
    } catch (error) {
        console.error('❌ Error checking enhanced setup status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check setup status',
            details: error.message
        });
    }
});

// ✅ Check initial scraping status - No background processing references
router.get('/user/initial-scraping-status', authenticateToken, async (req, res) => {
    try {
        console.log(`🔍 Checking initial scraping status for user ${req.user.id}`);
        
        const result = await pool.query(`
            SELECT 
                up.initial_scraping_done,
                up.linkedin_url as profile_linkedin_url,
                up.data_extraction_status,
                u.linkedin_url as user_linkedin_url,
                COALESCE(up.linkedin_url, u.linkedin_url) as linkedin_url
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id 
            WHERE u.id = $1
        `, [req.user.id]);
        
        let initialScrapingDone = false;
        let userLinkedInUrl = null;
        let extractionStatus = 'not_started';
        
        if (result.rows.length > 0) {
            const data = result.rows[0];
            initialScrapingDone = data.initial_scraping_done || false;
            userLinkedInUrl = data.linkedin_url || data.user_linkedin_url || data.profile_linkedin_url;
            extractionStatus = data.data_extraction_status || 'not_started';
            
            console.log(`📊 Initial scraping data for user ${req.user.id}:`);
            console.log(`   - Profile linkedin_url: ${data.profile_linkedin_url || 'null'}`);
            console.log(`   - User linkedin_url: ${data.user_linkedin_url || 'null'}`);
            console.log(`   - Final linkedin_url: ${userLinkedInUrl || 'null'}`);
        }
        
        console.log(`📊 Initial scraping status for user ${req.user.id}:`);
        console.log(`   - Initial scraping done: ${initialScrapingDone}`);
        console.log(`   - User LinkedIn URL: ${userLinkedInUrl || 'Not set'}`);
        console.log(`   - Extraction status: ${extractionStatus}`);
        
        res.json({
            success: true,
            data: {
                initialScrapingDone: initialScrapingDone,
                userLinkedInUrl: userLinkedInUrl,
                extractionStatus: extractionStatus,
                isCurrentlyProcessing: false, // No background processing
                user: {
                    id: req.user.id,
                    email: req.user.email,
                    linkedinUrl: userLinkedInUrl
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error checking initial scraping status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check initial scraping status',
            details: error.message
        });
    }
});

// ✅ Get user statistics
router.get('/user/stats', authenticateToken, async (req, res) => {
    try {
        console.log(`📊 Fetching statistics for user ${req.user.id}`);
        
        // Get profile completion status
        const profileResult = await pool.query(`
            SELECT 
                initial_scraping_done,
                data_extraction_status,
                experience,
                certifications,
                awards,
                activity
            FROM user_profiles 
            WHERE user_id = $1
        `, [req.user.id]);
        
        // Get target profiles count
        const targetCountResult = await pool.query(
            'SELECT COUNT(*) FROM target_profiles WHERE user_id = $1',
            [req.user.id]
        );
        
        // Get messages count
        const messageCountResult = await pool.query(
            'SELECT COUNT(*) FROM message_logs WHERE user_id = $1',
            [req.user.id]
        );
        
        // Get recent activity
        const recentActivityResult = await pool.query(`
            SELECT 'message' as type, target_name as name, created_at
            FROM message_logs 
            WHERE user_id = $1 
            UNION ALL
            SELECT 'target_profile' as type, full_name as name, scraped_at as created_at
            FROM target_profiles 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 10
        `, [req.user.id]);
        
        const profile = profileResult.rows[0];
        const stats = {
            profileComplete: profile ? profile.initial_scraping_done : false,
            extractionStatus: profile ? profile.data_extraction_status : 'not_started',
            experienceCount: profile && profile.experience ? profile.experience.length : 0,
            certificationsCount: profile && profile.certifications ? profile.certifications.length : 0,
            awardsCount: profile && profile.awards ? profile.awards.length : 0,
            activityCount: profile && profile.activity ? profile.activity.length : 0,
            targetProfilesCount: parseInt(targetCountResult.rows[0].count),
            messagesGenerated: parseInt(messageCountResult.rows[0].count),
            creditsRemaining: req.user.credits_remaining,
            packageType: req.user.package_type,
            recentActivity: recentActivityResult.rows.map(activity => ({
                type: activity.type,
                name: activity.name,
                createdAt: activity.created_at
            }))
        };
        
        console.log(`✅ Statistics compiled for user ${req.user.id}`);
        
        res.json({
            success: true,
            data: { stats }
        });
        
    } catch (error) {
        console.error('❌ Error fetching user statistics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user statistics',
            details: error.message
        });
    }
});

// ✅ Update user settings
router.put('/user/settings', authenticateToken, async (req, res) => {
    try {
        const { displayName, packageType } = req.body;
        
        console.log(`⚙️ Updating settings for user ${req.user.id}`);
        
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (displayName !== undefined) {
            updates.push(`display_name = $${paramIndex++}`);
            values.push(displayName);
        }
        
        if (packageType !== undefined) {
            if (packageType !== 'free') {
                return res.status(400).json({
                    success: false,
                    error: 'Only free package is available during beta'
                });
            }
            updates.push(`package_type = $${paramIndex++}`);
            values.push(packageType);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid updates provided'
            });
        }
        
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(req.user.id);
        
        const query = `
            UPDATE users 
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        const updatedUser = result.rows[0];
        
        console.log(`✅ Settings updated for user ${req.user.id}`);
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            data: {
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.display_name,
                    packageType: updatedUser.package_type,
                    credits: updatedUser.credits_remaining,
                    updatedAt: updatedUser.updated_at
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error updating user settings:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update settings',
            details: error.message
        });
    }
});

// Export router and initialization function
module.exports = {
    router,
    initUserRoutes
};
