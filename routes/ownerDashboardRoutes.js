// ========================================
// OWNER DASHBOARD ROUTES - CORRECTED DATA MAPPING
// ========================================
// ✅ FIXED: Message types now query message_logs.message_type (not web_generated_messages)
// ✅ FIXED: Email searches aggregate from 3 sources (email_finder_searches + target_profiles + message_logs)
// ✅ FIXED: Emails found/verified calculated from all 3 sources
// ✅ FIXED: Registration Rate → Profile Sync Rate (based on extraction_status = 'completed')

const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const logger = require('../logger');

// ========================================
// SIMPLE AUTHENTICATION MIDDLEWARE
// ========================================
const ownerAuth = (req, res, next) => {
    // Get credentials from environment variables (trim whitespace)
    const OWNER_EMAIL = process.env.OWNER_EMAIL?.trim();
    const OWNER_PASSWORD = process.env.OWNER_PASSWORD?.trim();

    // Check if owner credentials are configured
    if (!OWNER_EMAIL || !OWNER_PASSWORD) {
        logger.error('❌ Owner credentials not configured in environment variables');
        return res.status(500).json({ 
            error: 'Owner credentials not configured',
            message: 'Please set OWNER_EMAIL and OWNER_PASSWORD in Railway environment variables'
        });
    }

    // Get credentials from request (trim whitespace)
    const email = req.body.email?.trim() || req.headers['x-owner-email']?.trim();
    const password = req.body.password?.trim() || req.headers['x-owner-password']?.trim();

    // Validate credentials
    const emailMatch = email === OWNER_EMAIL;
    const passwordMatch = password === OWNER_PASSWORD;

    if (emailMatch && passwordMatch) {
        logger.info('✅ Owner authenticated successfully:', email);
        next();
    } else {
        logger.warn(`❌ Failed owner login attempt for email: ${email}`);
        
        // Debug logging (only in development)
        if (process.env.NODE_ENV !== 'production') {
            logger.debug('Auth Debug:', {
                emailMatch,
                passwordMatch,
                providedEmail: email,
                expectedEmail: OWNER_EMAIL
            });
        }
        
        return res.status(403).json({ 
            error: 'Invalid credentials',
            message: 'Email or password is incorrect'
        });
    }
};

// ========================================
// HELPER FUNCTIONS FOR ANALYTICS QUERIES
// ========================================

// Get user metrics (registrations, active users, etc.)
const getUserMetrics = async (startDate, endDate, prevStartDate, prevEndDate) => {
    try {
        // Current period metrics
        const currentMetrics = await pool.query(`
            SELECT 
                -- Total users (all time)
                (SELECT COUNT(*) FROM users) as total_users,
                
                -- New users in current period
                COUNT(CASE WHEN u.created_at BETWEEN $1 AND $2 THEN 1 END) as new_users,
                
                -- New free users
                COUNT(CASE WHEN u.created_at BETWEEN $1 AND $2 AND (u.package_type = 'free' OR u.plan_code = 'free') THEN 1 END) as new_free_users,
                
                -- New paid users (any plan except free)
                COUNT(CASE WHEN u.created_at BETWEEN $1 AND $2 AND u.package_type != 'free' AND u.plan_code != 'free' THEN 1 END) as new_paid_users,
                
                -- Active users (generated messages in period)
                COUNT(DISTINCT CASE WHEN ml.created_at BETWEEN $1 AND $2 THEN ml.user_id END) as active_users,
                
                -- Profile Sync Rate (based on extraction_status = 'completed')
                (COUNT(CASE WHEN u.extraction_status = 'completed' THEN 1 END)::float / 
                 NULLIF(COUNT(*)::float, 0) * 100) as profile_sync_rate
                
            FROM users u
            LEFT JOIN message_logs ml ON ml.user_id = u.id
        `, [startDate, endDate]);

        // Previous period metrics for comparison
        const previousMetrics = await pool.query(`
            SELECT 
                COUNT(CASE WHEN u.created_at BETWEEN $1 AND $2 THEN 1 END) as prev_new_users,
                COUNT(CASE WHEN u.created_at BETWEEN $1 AND $2 AND (u.package_type = 'free' OR u.plan_code = 'free') THEN 1 END) as prev_new_free_users,
                COUNT(CASE WHEN u.created_at BETWEEN $1 AND $2 AND u.package_type != 'free' AND u.plan_code != 'free' THEN 1 END) as prev_new_paid_users,
                COUNT(DISTINCT CASE WHEN ml.created_at BETWEEN $1 AND $2 THEN ml.user_id END) as prev_active_users
            FROM users u
            LEFT JOIN message_logs ml ON ml.user_id = u.id
        `, [prevStartDate, prevEndDate]);

        const current = currentMetrics.rows[0];
        const previous = previousMetrics.rows[0];

        // Calculate percentage changes
        const calculateChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous * 100).toFixed(1);
        };

        return {
            totalUsers: parseInt(current.total_users),
            newUsers: parseInt(current.new_users),
            newUsersChange: calculateChange(current.new_users, previous.prev_new_users),
            newFreeUsers: parseInt(current.new_free_users),
            newFreeUsersChange: calculateChange(current.new_free_users, previous.prev_new_free_users),
            newPaidUsers: parseInt(current.new_paid_users),
            newPaidUsersChange: calculateChange(current.new_paid_users, previous.prev_new_paid_users),
            activeUsers: parseInt(current.active_users),
            activeUsersChange: calculateChange(current.active_users, previous.prev_active_users),
            profileSyncRate: parseFloat(current.profile_sync_rate || 0).toFixed(1)
        };
    } catch (error) {
        logger.error('Error fetching user metrics:', error);
        throw error;
    }
};

// Get activity metrics (profiles analyzed, messages generated)
const getActivityMetrics = async (startDate, endDate, prevStartDate, prevEndDate) => {
    try {
        // Current period activity
        const currentActivity = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM target_profiles WHERE created_at BETWEEN $1 AND $2) as profiles_analyzed,
                (SELECT COUNT(*) FROM message_logs WHERE created_at BETWEEN $1 AND $2) as messages_generated
        `, [startDate, endDate]);

        // Previous period activity
        const previousActivity = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM target_profiles WHERE created_at BETWEEN $1 AND $2) as prev_profiles,
                (SELECT COUNT(*) FROM message_logs WHERE created_at BETWEEN $1 AND $2) as prev_messages
        `, [prevStartDate, prevEndDate]);

        const current = currentActivity.rows[0];
        const previous = previousActivity.rows[0];

        const calculateChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous * 100).toFixed(1);
        };

        return {
            profilesAnalyzed: parseInt(current.profiles_analyzed),
            profilesAnalyzedChange: calculateChange(current.profiles_analyzed, previous.prev_profiles),
            messagesGenerated: parseInt(current.messages_generated),
            messagesGeneratedChange: calculateChange(current.messages_generated, previous.prev_messages)
        };
    } catch (error) {
        logger.error('Error fetching activity metrics:', error);
        throw error;
    }
};

// ✅ FIXED: Get message type metrics from message_logs.message_type
const getMessageTypeMetrics = async (startDate, endDate) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(CASE WHEN message_type = 'linkedin_message' THEN 1 END) as linkedin_messages,
                COUNT(CASE WHEN message_type = 'connection_request' THEN 1 END) as connection_requests,
                COUNT(CASE WHEN message_type = 'cold_email' THEN 1 END) as cold_emails
            FROM message_logs
            WHERE created_at BETWEEN $1 AND $2
        `, [startDate, endDate]);

        return {
            linkedinMessages: parseInt(result.rows[0].linkedin_messages || 0),
            connectionRequests: parseInt(result.rows[0].connection_requests || 0),
            coldEmails: parseInt(result.rows[0].cold_emails || 0)
        };
    } catch (error) {
        logger.warn('⚠️  Error fetching message type metrics (message_type column may not exist yet):', error.message);
        return {
            linkedinMessages: 0,
            connectionRequests: 0,
            coldEmails: 0
        };
    }
};

// ✅ FIXED: Get email metrics from ALL 3 sources
const getEmailMetrics = async (startDate, endDate) => {
    try {
        // Count email searches from all 3 sources
        const searchesResult = await pool.query(`
            SELECT 
                -- Email finder searches (standalone page)
                (SELECT COUNT(*) FROM email_finder_searches WHERE search_date BETWEEN $1 AND $2) as finder_searches,
                
                -- Profile analysis with email
                (SELECT COUNT(*) FROM target_profiles WHERE email_found IS NOT NULL AND created_at BETWEEN $1 AND $2) as profile_emails,
                
                -- Message generation with email
                (SELECT COUNT(*) FROM message_logs WHERE email_found IS NOT NULL AND created_at BETWEEN $1 AND $2) as message_emails
        `, [startDate, endDate]);

        // Count emails found from all 3 sources
        const foundResult = await pool.query(`
            SELECT 
                -- Emails from finder
                (SELECT COUNT(*) FROM email_finder_searches WHERE email IS NOT NULL AND search_date BETWEEN $1 AND $2) as finder_found,
                
                -- Emails from profiles
                (SELECT COUNT(*) FROM target_profiles WHERE email_found IS NOT NULL AND email_found != '' AND created_at BETWEEN $1 AND $2) as profile_found,
                
                -- Emails from messages
                (SELECT COUNT(*) FROM message_logs WHERE email_found IS NOT NULL AND email_found != '' AND created_at BETWEEN $1 AND $2) as message_found
        `, [startDate, endDate]);

        // Count verified emails from all 3 sources
        const verifiedResult = await pool.query(`
            SELECT 
                -- Verified from finder
                (SELECT COUNT(*) FROM email_finder_searches WHERE verification_status = 'valid' AND search_date BETWEEN $1 AND $2) as finder_verified,
                
                -- Verified from profiles
                (SELECT COUNT(*) FROM target_profiles WHERE email_status = 'verified' AND created_at BETWEEN $1 AND $2) as profile_verified,
                
                -- Verified from messages
                (SELECT COUNT(*) FROM message_logs WHERE email_status = 'verified' AND created_at BETWEEN $1 AND $2) as message_verified
        `, [startDate, endDate]);

        const searches = searchesResult.rows[0];
        const found = foundResult.rows[0];
        const verified = verifiedResult.rows[0];

        // Aggregate totals from all sources
        const totalSearches = parseInt(searches.finder_searches || 0) + parseInt(searches.profile_emails || 0) + parseInt(searches.message_emails || 0);
        const totalFound = parseInt(found.finder_found || 0) + parseInt(found.profile_found || 0) + parseInt(found.message_found || 0);
        const totalVerified = parseInt(verified.finder_verified || 0) + parseInt(verified.profile_verified || 0) + parseInt(verified.message_verified || 0);

        // Calculate verification rate
        const verificationRate = totalFound > 0 ? ((totalVerified / totalFound) * 100).toFixed(1) : 0;

        return {
            emailSearches: totalSearches,
            emailsFound: totalFound,
            emailsVerified: totalVerified,
            verificationRate: parseFloat(verificationRate)
        };
    } catch (error) {
        logger.warn('⚠️  Error fetching email metrics (tables may not exist yet):', error.message);
        return {
            emailSearches: 0,
            emailsFound: 0,
            emailsVerified: 0,
            verificationRate: 0
        };
    }
};

// Get subscription/plan metrics
const getSubscriptionMetrics = async (startDate, endDate) => {
    try {
        const result = await pool.query(`
            SELECT 
                -- Plan upgrades (users who changed from free to paid in period)
                COUNT(CASE WHEN u.plan_code != 'free' AND u.package_type != 'free' AND u.updated_at BETWEEN $1 AND $2 THEN 1 END) as plan_upgrades,
                
                -- Cancellations (scheduled in period)
                COUNT(CASE WHEN u.cancellation_scheduled_at BETWEEN $1 AND $2 THEN 1 END) as cancellations,
                
                -- Active subscriptions (all Chargebee subscriptions)
                COUNT(CASE WHEN u.chargebee_subscription_id IS NOT NULL AND u.subscription_status = 'active' THEN 1 END) as active_subscriptions
            FROM users u
        `, [startDate, endDate]);

        return {
            planUpgrades: parseInt(result.rows[0].plan_upgrades || 0),
            cancellations: parseInt(result.rows[0].cancellations || 0),
            activeSubscriptions: parseInt(result.rows[0].active_subscriptions || 0)
        };
    } catch (error) {
        logger.error('Error fetching subscription metrics:', error);
        throw error;
    }
};

// Get credit usage metrics
const getCreditMetrics = async (startDate, endDate) => {
    try {
        const result = await pool.query(`
            SELECT 
                SUM(renewable_credits) as total_renewable,
                SUM(payasyougo_credits) as total_payasyougo,
                SUM(renewable_credits + payasyougo_credits) as total_credits,
                COUNT(*) as user_count
            FROM users
        `);

        // Get credits used in period
        const usedResult = await pool.query(`
            SELECT 
                SUM(credits_used) as credits_used
            FROM message_logs
            WHERE created_at BETWEEN $1 AND $2
        `, [startDate, endDate]);

        const credits = result.rows[0];
        const used = usedResult.rows[0];

        const avgPerUser = credits.user_count > 0 ? (parseFloat(credits.total_credits || 0) / credits.user_count).toFixed(2) : 0;

        return {
            totalRenewable: parseInt(credits.total_renewable || 0),
            totalPayAsYouGo: parseInt(credits.total_payasyougo || 0),
            totalCredits: parseInt(credits.total_credits || 0),
            creditsUsed: parseInt(used.credits_used || 0),
            averagePerUser: parseFloat(avgPerUser)
        };
    } catch (error) {
        logger.error('Error fetching credit metrics:', error);
        throw error;
    }
};

// Get context management metrics
const getContextMetrics = async (startDate, endDate) => {
    try {
        // Try to get context metrics (tables may not exist)
        const contextsResult = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM saved_contexts WHERE created_at BETWEEN $1 AND $2) as new_contexts
        `, [startDate, endDate]).catch(() => ({ rows: [{ new_contexts: 0 }] }));

        const addonsResult = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM user_context_addons WHERE created_at BETWEEN $1 AND $2) as addons_purchased,
                (SELECT SUM(slots_purchased) FROM user_context_addons WHERE created_at BETWEEN $1 AND $2) as extra_slots
        `, [startDate, endDate]).catch(() => ({ rows: [{ addons_purchased: 0, extra_slots: 0 }] }));

        const contexts = contextsResult.rows[0];
        const addons = addonsResult.rows[0];

        return {
            newContexts: parseInt(contexts.new_contexts || 0),
            addonsPurchased: parseInt(addons.addons_purchased || 0),
            extraSlots: parseInt(addons.extra_slots || 0)
        };
    } catch (error) {
        logger.warn('⚠️  Error fetching context metrics (tables may not exist yet):', error.message);
        return {
            newContexts: 0,
            addonsPurchased: 0,
            extraSlots: 0
        };
    }
};

// Get performance metrics (tokens, latency)
const getPerformanceMetrics = async (startDate, endDate) => {
    try {
        const result = await pool.query(`
            SELECT 
                AVG(input_tokens) as avg_input_tokens,
                AVG(output_tokens) as avg_output_tokens,
                AVG(total_tokens) as avg_total_tokens,
                AVG(latency_ms) as avg_latency
            FROM message_logs
            WHERE created_at BETWEEN $1 AND $2
            AND input_tokens IS NOT NULL
        `, [startDate, endDate]);

        const metrics = result.rows[0];

        return {
            avgInputTokens: parseInt(metrics.avg_input_tokens || 0),
            avgOutputTokens: parseInt(metrics.avg_output_tokens || 0),
            avgTotalTokens: parseInt(metrics.avg_total_tokens || 0),
            avgLatency: parseInt(metrics.avg_latency || 0)
        };
    } catch (error) {
        logger.error('Error fetching performance metrics:', error);
        throw error;
    }
};

// Get user breakdown by plan
const getUserBreakdown = async () => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(CASE WHEN plan_code = 'silver-monthly' OR package_type = 'silver-monthly' THEN 1 END) as silver_users,
                COUNT(CASE WHEN plan_code = 'gold-monthly' OR package_type = 'gold-monthly' THEN 1 END) as gold_users,
                COUNT(CASE WHEN plan_code = 'platinum-monthly' OR package_type = 'platinum-monthly' THEN 1 END) as platinum_users,
                COUNT(CASE WHEN (plan_code LIKE '%-monthly' OR package_type LIKE '%-monthly') AND plan_code != 'free' THEN 1 END) as monthly_subscribers,
                COUNT(CASE WHEN plan_code LIKE '%-payasyougo' OR package_type LIKE '%-payasyougo' THEN 1 END) as payasyougo_users
            FROM users
        `);

        return result.rows[0];
    } catch (error) {
        logger.error('Error fetching user breakdown:', error);
        throw error;
    }
};

// Get daily trend data for charts
const getDailyTrends = async (startDate, endDate) => {
    try {
        const result = await pool.query(`
            WITH date_series AS (
                SELECT generate_series(
                    DATE($1),
                    DATE($2),
                    '1 day'::interval
                )::date as day
            )
            SELECT 
                ds.day,
                COUNT(DISTINCT u.id) as new_users,
                COUNT(DISTINCT ml.id) as messages_generated,
                COUNT(DISTINCT tp.id) as profiles_analyzed
            FROM date_series ds
            LEFT JOIN users u ON DATE(u.created_at) = ds.day
            LEFT JOIN message_logs ml ON DATE(ml.created_at) = ds.day
            LEFT JOIN target_profiles tp ON DATE(tp.created_at) = ds.day
            GROUP BY ds.day
            ORDER BY ds.day
        `, [startDate, endDate]);

        return result.rows;
    } catch (error) {
        logger.error('Error fetching daily trends:', error);
        throw error;
    }
};

// ========================================
// ROUTES
// ========================================

// Health check endpoint (requires auth)
router.post('/api/owner/health', ownerAuth, (req, res) => {
    logger.info('✅ Owner health check passed');
    res.json({ status: 'ok', message: 'Owner authenticated' });
});

// Main analytics endpoint
router.post('/api/owner/analytics', ownerAuth, async (req, res) => {
    try {
        const { period = '30d' } = req.body;

        // Calculate date ranges based on period
        const now = new Date();
        let startDate, endDate, prevStartDate, prevEndDate;

        switch (period) {
            case '24h':
                endDate = now;
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                prevEndDate = startDate;
                prevStartDate = new Date(prevEndDate.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                endDate = now;
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                prevEndDate = startDate;
                prevStartDate = new Date(prevEndDate.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'this_month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = now;
                prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
                break;
            case 'last_month':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
                prevStartDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
                prevEndDate = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
                break;
            default: // 30d
                endDate = now;
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                prevEndDate = startDate;
                prevStartDate = new Date(prevEndDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        logger.info(`📊 Fetching owner analytics for period: ${period}`);

        // Fetch all metrics in parallel for better performance
        const [
            userMetrics,
            activityMetrics,
            messageTypeMetrics,
            emailMetrics,
            subscriptionMetrics,
            creditMetrics,
            contextMetrics,
            performanceMetrics,
            userBreakdown,
            dailyTrends
        ] = await Promise.all([
            getUserMetrics(startDate, endDate, prevStartDate, prevEndDate),
            getActivityMetrics(startDate, endDate, prevStartDate, prevEndDate),
            getMessageTypeMetrics(startDate, endDate),
            getEmailMetrics(startDate, endDate),
            getSubscriptionMetrics(startDate, endDate),
            getCreditMetrics(startDate, endDate),
            getContextMetrics(startDate, endDate),
            getPerformanceMetrics(startDate, endDate),
            getUserBreakdown(),
            getDailyTrends(startDate, endDate)
        ]);

        // Combine all metrics
        const analytics = {
            period,
            dateRange: {
                start: startDate,
                end: endDate
            },
            metrics: {
                ...userMetrics,
                ...activityMetrics,
                ...messageTypeMetrics,
                ...emailMetrics,
                ...subscriptionMetrics,
                ...creditMetrics,
                ...contextMetrics,
                ...performanceMetrics
            },
            breakdown: userBreakdown,
            trends: dailyTrends
        };

        logger.info('✅ Owner analytics fetched successfully');
        res.json(analytics);

    } catch (error) {
        logger.error('❌ Error fetching owner analytics:', error);
        res.status(500).json({ 
            error: 'Failed to fetch analytics',
            message: error.message 
        });
    }
});

// CSV export endpoint
router.post('/api/owner/export', ownerAuth, async (req, res) => {
    try {
        const { period = '30d' } = req.body;

        // Get all analytics data
        const now = new Date();
        let startDate, endDate, prevStartDate, prevEndDate;

        // Same date calculation as analytics endpoint
        switch (period) {
            case '24h':
                endDate = now;
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                prevEndDate = startDate;
                prevStartDate = new Date(prevEndDate.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                endDate = now;
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                prevEndDate = startDate;
                prevStartDate = new Date(prevEndDate.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'this_month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = now;
                prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
                break;
            case 'last_month':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
                prevStartDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
                prevEndDate = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
                break;
            default: // 30d
                endDate = now;
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                prevEndDate = startDate;
                prevStartDate = new Date(prevEndDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        const [
            userMetrics,
            activityMetrics,
            messageTypeMetrics,
            emailMetrics,
            subscriptionMetrics,
            creditMetrics,
            contextMetrics,
            performanceMetrics,
            userBreakdown
        ] = await Promise.all([
            getUserMetrics(startDate, endDate, prevStartDate, prevEndDate),
            getActivityMetrics(startDate, endDate, prevStartDate, prevEndDate),
            getMessageTypeMetrics(startDate, endDate),
            getEmailMetrics(startDate, endDate),
            getSubscriptionMetrics(startDate, endDate),
            getCreditMetrics(startDate, endDate),
            getContextMetrics(startDate, endDate),
            getPerformanceMetrics(startDate, endDate),
            getUserBreakdown()
        ]);

        // Create CSV content
        const csv = [
            ['Msgly.AI Owner Dashboard Export'],
            ['Period', period],
            ['Generated', new Date().toISOString()],
            [''],
            ['Metric', 'Value', 'Change %'],
            ['Total Users', userMetrics.totalUsers, ''],
            ['New Users', userMetrics.newUsers, userMetrics.newUsersChange],
            ['New Free Users', userMetrics.newFreeUsers, userMetrics.newFreeUsersChange],
            ['New Paid Users', userMetrics.newPaidUsers, userMetrics.newPaidUsersChange],
            ['Active Users', userMetrics.activeUsers, userMetrics.activeUsersChange],
            ['Profile Sync Rate', `${userMetrics.profileSyncRate}%`, ''],
            ['Profiles Analyzed', activityMetrics.profilesAnalyzed, activityMetrics.profilesAnalyzedChange],
            ['Messages Generated', activityMetrics.messagesGenerated, activityMetrics.messagesGeneratedChange],
            ['LinkedIn Messages', messageTypeMetrics.linkedinMessages, ''],
            ['Connection Requests', messageTypeMetrics.connectionRequests, ''],
            ['Cold Emails', messageTypeMetrics.coldEmails, ''],
            ['Email Searches', emailMetrics.emailSearches, ''],
            ['Emails Found', emailMetrics.emailsFound, ''],
            ['Verification Rate', `${emailMetrics.verificationRate}%`, ''],
            ['Plan Upgrades', subscriptionMetrics.planUpgrades, ''],
            ['Cancellations', subscriptionMetrics.cancellations, ''],
            ['Total Credits', creditMetrics.totalCredits, ''],
            ['Credits Used', creditMetrics.creditsUsed, ''],
            [''],
            ['User Breakdown'],
            ['Silver Users', userBreakdown.silver_users],
            ['Gold Users', userBreakdown.gold_users],
            ['Platinum Users', userBreakdown.platinum_users],
            ['Monthly Subscribers', userBreakdown.monthly_subscribers],
            ['Pay-as-you-go Users', userBreakdown.payasyougo_users]
        ];

        const csvContent = csv.map(row => row.join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="msgly-dashboard-${period}-${Date.now()}.csv"`);
        res.send(csvContent);

        logger.info('✅ CSV export generated successfully');

    } catch (error) {
        logger.error('❌ Error generating CSV export:', error);
        res.status(500).json({ 
            error: 'Failed to generate CSV',
            message: error.message 
        });
    }
});

// Serve owner dashboard HTML
router.get('/owner-dashboard', (req, res) => {
    res.sendFile('owner-dashboard.html', { root: '.' });
});

module.exports = router;
