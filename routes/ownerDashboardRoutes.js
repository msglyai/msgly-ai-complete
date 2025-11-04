// routes/ownerDashboardRoutes.js
// Owner Dashboard - Comprehensive Business Analytics with Simple Auth
// SECURITY: Email + Password authentication via environment variables

const router = require('express').Router();
const path = require('path');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// ==================== SIMPLE AUTH MIDDLEWARE ====================

// Simple owner authentication middleware
const ownerAuth = (req, res, next) => {
    const OWNER_EMAIL = process.env.OWNER_EMAIL;
    const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
    
    // Check if credentials are configured
    if (!OWNER_EMAIL || !OWNER_PASSWORD) {
        logger.error('Owner credentials not configured in environment variables');
        return res.status(500).json({
            success: false,
            error: 'Owner dashboard not configured'
        });
    }
    
    // Get credentials from request
    let email, password;
    
    // Check for credentials in query params (for HTML page access)
    if (req.query.email && req.query.password) {
        email = req.query.email;
        password = req.query.password;
    }
    // Check for credentials in body (for API calls)
    else if (req.body && req.body.email && req.body.password) {
        email = req.body.email;
        password = req.body.password;
    }
    // Check for Basic Auth header
    else if (req.headers.authorization) {
        const auth = req.headers.authorization;
        if (auth.startsWith('Basic ')) {
            const credentials = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
            const [authEmail, authPassword] = credentials.split(':');
            email = authEmail;
            password = authPassword;
        }
    }
    
    // Validate credentials
    if (!email || !password) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            message: 'Please provide email and password'
        });
    }
    
    // Trim whitespace from credentials and env vars
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const trimmedOwnerEmail = OWNER_EMAIL.trim();
    const trimmedOwnerPassword = OWNER_PASSWORD.trim();
    
    // Debug logging (only in development)
    if (process.env.NODE_ENV === 'development') {
        logger.debug('Auth attempt - Email match:', trimmedEmail === trimmedOwnerEmail);
        logger.debug('Auth attempt - Password match:', trimmedPassword === trimmedOwnerPassword);
    }
    
    if (trimmedEmail !== trimmedOwnerEmail || trimmedPassword !== trimmedOwnerPassword) {
        logger.warn('Failed owner login attempt:', trimmedEmail);
        return res.status(403).json({
            success: false,
            error: 'Invalid credentials'
        });
    }
    
    logger.debug('Owner authenticated successfully:', trimmedEmail);
    next();
};

// ==================== DASHBOARD HTML ROUTE ====================

// Serve owner dashboard HTML
router.get('/owner-dashboard', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, '..', 'owner-dashboard.html'));
    } catch (error) {
        logger.error('Error serving owner dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to serve owner dashboard'
        });
    }
});

// ==================== ANALYTICS API ENDPOINTS ====================

// Main analytics endpoint - comprehensive business metrics
router.post('/api/owner/analytics', ownerAuth, async (req, res) => {
    try {
        const {
            timeRange = '7days',
            startDate,
            endDate
        } = req.body;

        logger.debug('Owner analytics request - timeRange:', timeRange);

        // Calculate date ranges
        const dateRange = calculateDateRange(timeRange, startDate, endDate);
        const previousDateRange = calculatePreviousDateRange(dateRange);

        // Get all metrics in parallel for performance
        const [
            userMetrics,
            previousUserMetrics,
            planMetrics,
            activityMetrics,
            previousActivityMetrics,
            emailMetrics,
            creditMetrics,
            contextMetrics,
            messageTypeMetrics,
            chartData
        ] = await Promise.all([
            getUserMetrics(dateRange),
            getUserMetrics(previousDateRange),
            getPlanMetrics(dateRange),
            getActivityMetrics(dateRange),
            getActivityMetrics(previousDateRange),
            getEmailMetrics(dateRange),
            getCreditMetrics(dateRange),
            getContextMetrics(dateRange),
            getMessageTypeMetrics(dateRange),
            getChartData(dateRange)
        ]);

        // Calculate changes from previous period
        const changes = {
            newUsers: calculatePercentChange(userMetrics.newUsers, previousUserMetrics.newUsers),
            newFreeUsers: calculatePercentChange(userMetrics.newFreeUsers, previousUserMetrics.newFreeUsers),
            newPaidUsers: calculatePercentChange(userMetrics.newPaidUsers, previousUserMetrics.newPaidUsers),
            profilesAnalyzed: calculatePercentChange(activityMetrics.profilesAnalyzed, previousActivityMetrics.profilesAnalyzed),
            messagesGenerated: calculatePercentChange(activityMetrics.messagesGenerated, previousActivityMetrics.messagesGenerated)
        };

        res.json({
            success: true,
            data: {
                timeRange: {
                    current: {
                        start: dateRange.start.toISOString(),
                        end: dateRange.end.toISOString()
                    },
                    previous: {
                        start: previousDateRange.start.toISOString(),
                        end: previousDateRange.end.toISOString()
                    }
                },
                users: {
                    ...userMetrics,
                    changes
                },
                plans: planMetrics,
                activity: activityMetrics,
                email: emailMetrics,
                credits: creditMetrics,
                contexts: contextMetrics,
                messageTypes: messageTypeMetrics,
                charts: chartData
            }
        });

    } catch (error) {
        logger.error('Owner analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics data',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// System health endpoint
router.post('/api/owner/health', ownerAuth, async (req, res) => {
    try {
        // Test database connection
        const dbStart = Date.now();
        await pool.query('SELECT NOW()');
        const dbResponseTime = Date.now() - dbStart;

        // Get database stats
        const dbStats = await pool.query(`
            SELECT 
                count(*) as total_connections,
                count(*) filter (where state = 'active') as active_connections,
                count(*) filter (where state = 'idle') as idle_connections
            FROM pg_stat_activity 
            WHERE datname = current_database()
        `);

        // Get table sizes
        const tableSizes = await pool.query(`
            SELECT 
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
                pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY size_bytes DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            data: {
                database: {
                    status: 'healthy',
                    responseTime: dbResponseTime,
                    connections: dbStats.rows[0],
                    topTables: tableSizes.rows
                },
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error('Health check error:', error);
        res.status(500).json({
            success: false,
            error: 'Health check failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Export data as CSV
router.post('/api/owner/export', ownerAuth, async (req, res) => {
    try {
        const {
            timeRange = '7days',
            startDate,
            endDate
        } = req.body;

        const dateRange = calculateDateRange(timeRange, startDate, endDate);
        
        // Get all users with their details
        const usersResult = await pool.query(`
            SELECT 
                u.id,
                u.email,
                u.display_name,
                u.package_type,
                u.plan_code,
                u.renewable_credits,
                u.payasyougo_credits,
                u.credits_remaining,
                u.total_context_slots,
                u.contexts_count,
                u.chargebee_subscription_id,
                u.registration_completed,
                u.created_at,
                COALESCE(ml.message_count, 0) as messages_generated,
                COALESCE(tp.profiles_analyzed, 0) as profiles_analyzed,
                COALESCE(ef.email_searches, 0) as email_searches
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) as message_count
                FROM message_logs
                GROUP BY user_id
            ) ml ON u.id = ml.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as profiles_analyzed
                FROM target_profiles
                GROUP BY user_id
            ) tp ON u.id = tp.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as email_searches
                FROM email_finder_searches
                GROUP BY user_id
            ) ef ON u.id = ef.user_id
            WHERE u.created_at BETWEEN $1 AND $2
            ORDER BY u.created_at DESC
        `, [dateRange.start, dateRange.end]);

        // Create CSV content
        const headers = [
            'ID', 'Email', 'Display Name', 'Package Type', 'Plan Code',
            'Renewable Credits', 'PAYG Credits', 'Total Credits',
            'Context Slots', 'Contexts Used', 'Chargebee Sub ID',
            'Registration Completed', 'Messages Generated', 'Profiles Analyzed',
            'Email Searches', 'Created Date'
        ];

        const rows = usersResult.rows.map(user => [
            user.id,
            user.email,
            user.display_name || '',
            user.package_type || 'free',
            user.plan_code || 'free',
            user.renewable_credits || 0,
            user.payasyougo_credits || 0,
            user.credits_remaining || 0,
            user.total_context_slots || 0,
            user.contexts_count || 0,
            user.chargebee_subscription_id || '',
            user.registration_completed ? 'Yes' : 'No',
            user.messages_generated || 0,
            user.profiles_analyzed || 0,
            user.email_searches || 0,
            new Date(user.created_at).toISOString()
        ]);

        const csvData = [headers, ...rows];
        const csvContent = csvData.map(row => 
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=msgly-owner-export-${Date.now()}.csv`);
        res.send(csvContent);

    } catch (error) {
        logger.error('Export error:', error);
        res.status(500).json({
            success: false,
            error: 'Export failed'
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

// Calculate date range based on time period
function calculateDateRange(timeRange, startDate, endDate) {
    const end = new Date();
    let start = new Date();

    if (startDate && endDate) {
        return {
            start: new Date(startDate),
            end: new Date(endDate)
        };
    }

    switch (timeRange) {
        case '24h':
            start.setHours(start.getHours() - 24);
            break;
        case '7days':
            start.setDate(start.getDate() - 7);
            break;
        case '30days':
            start.setDate(start.getDate() - 30);
            break;
        case 'thisMonth':
            start = new Date(end.getFullYear(), end.getMonth(), 1);
            break;
        case 'lastMonth':
            start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
            end = new Date(end.getFullYear(), end.getMonth(), 0);
            break;
        default:
            start.setDate(start.getDate() - 7);
    }

    return { start, end };
}

// Calculate previous period for comparison
function calculatePreviousDateRange(currentRange) {
    const duration = currentRange.end - currentRange.start;
    return {
        start: new Date(currentRange.start - duration),
        end: new Date(currentRange.start)
    };
}

// Calculate percent change
function calculatePercentChange(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
}

// Get user metrics
async function getUserMetrics(dateRange) {
    try {
        // Total users (all time up to end date)
        const totalUsersResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM users
            WHERE created_at <= $1
        `, [dateRange.end]);

        // New users in period
        const newUsersResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM users
            WHERE created_at BETWEEN $1 AND $2
        `, [dateRange.start, dateRange.end]);

        // New users breakdown by plan
        const newUsersByPlanResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE package_type = 'free' OR package_type IS NULL) as free_users,
                COUNT(*) FILTER (WHERE package_type LIKE '%-monthly' AND package_type != 'free') as paid_monthly,
                COUNT(*) FILTER (WHERE package_type LIKE '%-payasyougo') as paid_payg,
                COUNT(*) FILTER (WHERE package_type LIKE 'silver%') as silver_users,
                COUNT(*) FILTER (WHERE package_type LIKE 'gold%') as gold_users,
                COUNT(*) FILTER (WHERE package_type LIKE 'platinum%') as platinum_users
            FROM users
            WHERE created_at BETWEEN $1 AND $2
        `, [dateRange.start, dateRange.end]);

        // Registration completion rate
        const registrationStatsResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE registration_completed = true) as completed
            FROM users
            WHERE created_at BETWEEN $1 AND $2
        `, [dateRange.start, dateRange.end]);

        // Active users (generated messages in period)
        const activeUsersResult = await pool.query(`
            SELECT COUNT(DISTINCT user_id) as count
            FROM message_logs
            WHERE created_at BETWEEN $1 AND $2
        `, [dateRange.start, dateRange.end]);

        const breakdown = newUsersByPlanResult.rows[0];
        const regStats = registrationStatsResult.rows[0];

        return {
            totalUsers: parseInt(totalUsersResult.rows[0].count),
            newUsers: parseInt(newUsersResult.rows[0].count),
            newFreeUsers: parseInt(breakdown.free_users),
            newPaidMonthly: parseInt(breakdown.paid_monthly),
            newPaidPAYG: parseInt(breakdown.paid_payg),
            newSilverUsers: parseInt(breakdown.silver_users),
            newGoldUsers: parseInt(breakdown.gold_users),
            newPlatinumUsers: parseInt(breakdown.platinum_users),
            registrationTotal: parseInt(regStats.total),
            registrationCompleted: parseInt(regStats.completed),
            registrationRate: regStats.total > 0 
                ? Math.round((regStats.completed / regStats.total) * 100) 
                : 0,
            activeUsers: parseInt(activeUsersResult.rows[0].count)
        };

    } catch (error) {
        logger.error('Error getting user metrics:', error);
        throw error;
    }
}

// Get plan change metrics
async function getPlanMetrics(dateRange) {
    try {
        // Current active subscriptions by plan
        const activePlansResult = await pool.query(`
            SELECT 
                package_type,
                COUNT(*) as count
            FROM users
            WHERE package_type IS NOT NULL 
                AND package_type != 'free'
                AND subscription_status = 'active'
            GROUP BY package_type
            ORDER BY count DESC
        `);

        // Upgrades (users who changed from free to paid in period)
        const upgradesResult = await pool.query(`
            SELECT COUNT(DISTINCT user_id) as count
            FROM (
                SELECT user_id, MIN(created_at) as first_payment
                FROM message_logs
                WHERE created_at BETWEEN $1 AND $2
                GROUP BY user_id
            ) subquery
            JOIN users u ON u.id = subquery.user_id
            WHERE u.package_type != 'free' AND u.package_type IS NOT NULL
        `, [dateRange.start, dateRange.end]);

        // Cancellations scheduled in period
        const cancellationsResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM users
            WHERE cancellation_scheduled_at BETWEEN $1 AND $2
        `, [dateRange.start, dateRange.end]);

        // Downgrades to free in period
        const downgradesResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM users
            WHERE cancellation_effective_date BETWEEN $1 AND $2
                AND package_type = 'free'
        `, [dateRange.start, dateRange.end]);

        // Active Chargebee subscriptions
        const activeChargebeeResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM users
            WHERE chargebee_subscription_id IS NOT NULL
                AND subscription_status = 'active'
        `);

        return {
            activePlans: activePlansResult.rows,
            upgrades: parseInt(upgradesResult.rows[0].count),
            cancellations: parseInt(cancellationsResult.rows[0].count),
            downgrades: parseInt(downgradesResult.rows[0].count),
            activeChargebeeSubscriptions: parseInt(activeChargebeeResult.rows[0].count)
        };

    } catch (error) {
        logger.error('Error getting plan metrics:', error);
        throw error;
    }
}

// Get activity metrics
async function getActivityMetrics(dateRange) {
    try {
        // Profiles analyzed
        const profilesResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM target_profiles
            WHERE created_at BETWEEN $1 AND $2
        `, [dateRange.start, dateRange.end]);

        // Messages generated (total)
        const messagesResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM message_logs
            WHERE created_at BETWEEN $1 AND $2
        `, [dateRange.start, dateRange.end]);

        // Web generated messages by type (with error handling)
        let webMessagesResult = { rows: [] };
        try {
            webMessagesResult = await pool.query(`
                SELECT 
                    message_type,
                    COUNT(*) as count
                FROM web_generated_messages
                WHERE created_at BETWEEN $1 AND $2
                GROUP BY message_type
            `, [dateRange.start, dateRange.end]);
        } catch (error) {
            // Table might not exist yet, that's okay
            logger.warn('web_generated_messages table query failed:', error.message);
        }

        // Average tokens per message
        const tokenStatsResult = await pool.query(`
            SELECT 
                AVG(input_tokens) as avg_input,
                AVG(output_tokens) as avg_output,
                AVG(total_tokens) as avg_total,
                AVG(latency_ms) as avg_latency
            FROM message_logs
            WHERE created_at BETWEEN $1 AND $2
                AND total_tokens IS NOT NULL
        `, [dateRange.start, dateRange.end]);

        const webMessages = {};
        webMessagesResult.rows.forEach(row => {
            webMessages[row.message_type] = parseInt(row.count);
        });

        const tokenStats = tokenStatsResult.rows[0];

        return {
            profilesAnalyzed: parseInt(profilesResult.rows[0].count),
            messagesGenerated: parseInt(messagesResult.rows[0].count),
            linkedinMessages: webMessages.linkedin_message || 0,
            connectionRequests: webMessages.connection_request || 0,
            coldEmails: webMessages.cold_email || 0,
            avgInputTokens: Math.round(tokenStats.avg_input || 0),
            avgOutputTokens: Math.round(tokenStats.avg_output || 0),
            avgTotalTokens: Math.round(tokenStats.avg_total || 0),
            avgLatency: Math.round(tokenStats.avg_latency || 0)
        };

    } catch (error) {
        logger.error('Error getting activity metrics:', error);
        throw error;
    }
}

// Get email finder metrics
async function getEmailMetrics(dateRange) {
    try {
        // Email requests (with error handling)
        let emailRequestsCount = 0;
        try {
            const emailRequestsResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM email_requests
                WHERE requested_at BETWEEN $1 AND $2
            `, [dateRange.start, dateRange.end]);
            emailRequestsCount = parseInt(emailRequestsResult.rows[0].count);
        } catch (error) {
            logger.warn('email_requests table query failed:', error.message);
        }

        // Email finder searches (with error handling)
        let searchStats = { total: 0, verified: 0, invalid: 0, found: 0 };
        try {
            const emailSearchesResult = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE verification_status = 'valid') as verified,
                    COUNT(*) FILTER (WHERE verification_status = 'invalid') as invalid,
                    COUNT(*) FILTER (WHERE email IS NOT NULL) as found
                FROM email_finder_searches
                WHERE search_date BETWEEN $1 AND $2
            `, [dateRange.start, dateRange.end]);
            searchStats = emailSearchesResult.rows[0];
        } catch (error) {
            logger.warn('email_finder_searches table query failed:', error.message);
        }

        return {
            emailRequests: emailRequestsCount,
            emailSearches: parseInt(searchStats.total || 0),
            emailsFound: parseInt(searchStats.found || 0),
            emailsVerified: parseInt(searchStats.verified || 0),
            emailsInvalid: parseInt(searchStats.invalid || 0),
            verificationRate: (searchStats.found || 0) > 0
                ? Math.round(((searchStats.verified || 0) / (searchStats.found || 0)) * 100)
                : 0
        };

    } catch (error) {
        logger.error('Error getting email metrics:', error);
        // Return default values instead of throwing
        return {
            emailRequests: 0,
            emailSearches: 0,
            emailsFound: 0,
            emailsVerified: 0,
            emailsInvalid: 0,
            verificationRate: 0
        };
    }
}

// Get credit usage metrics
async function getCreditMetrics(dateRange) {
    try {
        // Total credits across all users
        const totalCreditsResult = await pool.query(`
            SELECT 
                SUM(renewable_credits) as total_renewable,
                SUM(payasyougo_credits) as total_payg,
                SUM(credits_remaining) as total_remaining
            FROM users
        `);

        // Credits used in period (from transactions)
        const creditsUsedResult = await pool.query(`
            SELECT 
                COUNT(*) as transactions,
                SUM(amount) as total_used
            FROM credits_transactions
            WHERE created_at BETWEEN $1 AND $2
                AND status = 'completed'
        `, [dateRange.start, dateRange.end]);

        // Average credits per user
        const avgCreditsResult = await pool.query(`
            SELECT AVG(credits_remaining) as avg_credits
            FROM users
        `);

        const totals = totalCreditsResult.rows[0];
        const used = creditsUsedResult.rows[0];

        return {
            totalRenewableCredits: parseInt(totals.total_renewable || 0),
            totalPAYGCredits: parseInt(totals.total_payg || 0),
            totalRemainingCredits: parseInt(totals.total_remaining || 0),
            creditsUsedInPeriod: parseFloat(used.total_used || 0),
            creditTransactions: parseInt(used.transactions || 0),
            avgCreditsPerUser: Math.round(avgCreditsResult.rows[0].avg_credits || 0)
        };

    } catch (error) {
        logger.error('Error getting credit metrics:', error);
        throw error;
    }
}

// Get context metrics
async function getContextMetrics(dateRange) {
    try {
        // Saved contexts (with error handling)
        let contextsCount = 0;
        try {
            const contextsResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM saved_contexts
                WHERE created_at BETWEEN $1 AND $2
            `, [dateRange.start, dateRange.end]);
            contextsCount = parseInt(contextsResult.rows[0].count);
        } catch (error) {
            logger.warn('saved_contexts table query failed:', error.message);
        }

        // Context addons purchased (with error handling)
        let addons = { count: 0, total_slots: 0 };
        try {
            const addonsResult = await pool.query(`
                SELECT 
                    COUNT(*) as count,
                    SUM(slots_purchased) as total_slots
                FROM user_context_addons
                WHERE purchased_at BETWEEN $1 AND $2
            `, [dateRange.start, dateRange.end]);
            addons = addonsResult.rows[0];
        } catch (error) {
            logger.warn('user_context_addons table query failed:', error.message);
        }

        // Context usage by plan (with error handling)
        let contextByPlanRows = [];
        try {
            const contextByPlanResult = await pool.query(`
                SELECT 
                    package_type,
                    AVG(contexts_count) as avg_used,
                    AVG(total_context_slots) as avg_available
                FROM users
                WHERE package_type IS NOT NULL
                GROUP BY package_type
            `);
            contextByPlanRows = contextByPlanResult.rows;
        } catch (error) {
            logger.warn('Context usage by plan query failed:', error.message);
        }

        return {
            newContextsSaved: contextsCount,
            contextAddonsPurchased: parseInt(addons.count || 0),
            totalSlotsAdded: parseInt(addons.total_slots || 0),
            contextUsageByPlan: contextByPlanRows
        };

    } catch (error) {
        logger.error('Error getting context metrics:', error);
        // Return default values instead of throwing
        return {
            newContextsSaved: 0,
            contextAddonsPurchased: 0,
            totalSlotsAdded: 0,
            contextUsageByPlan: []
        };
    }
}

// Get message type breakdown
async function getMessageTypeMetrics(dateRange) {
    try {
        const result = await pool.query(`
            SELECT 
                message_type,
                COUNT(*) as count,
                AVG(CASE WHEN credits_used IS NOT NULL THEN credits_used ELSE 1 END) as avg_credits
            FROM web_generated_messages
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY message_type
            ORDER BY count DESC
        `, [dateRange.start, dateRange.end]);

        return result.rows.map(row => ({
            type: row.message_type,
            count: parseInt(row.count),
            avgCredits: parseFloat(row.avg_credits).toFixed(2)
        }));

    } catch (error) {
        logger.warn('Error getting message type metrics (table may not exist):', error.message);
        // Return empty array if table doesn't exist
        return [];
    }
}

// Get chart data for visualization
async function getChartData(dateRange) {
    try {
        // Calculate number of days in range
        const days = Math.ceil((dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24));
        const labels = [];
        const newUsersData = [];
        const messagesData = [];
        const profilesData = [];
        const emailSearchesData = [];

        // Get daily data
        for (let i = 0; i < days; i++) {
            const currentDate = new Date(dateRange.start.getTime() + i * 24 * 60 * 60 * 1000);
            const nextDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
            
            labels.push(currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

            // New users
            const usersResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM users
                WHERE created_at BETWEEN $1 AND $2
            `, [currentDate, nextDate]);

            // Messages
            const messagesResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM message_logs
                WHERE created_at BETWEEN $1 AND $2
            `, [currentDate, nextDate]);

            // Profiles
            const profilesResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM target_profiles
                WHERE created_at BETWEEN $1 AND $2
            `, [currentDate, nextDate]);

            // Email searches
            const emailsResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM email_finder_searches
                WHERE search_date BETWEEN $1 AND $2
            `, [currentDate, nextDate]);

            newUsersData.push(parseInt(usersResult.rows[0].count));
            messagesData.push(parseInt(messagesResult.rows[0].count));
            profilesData.push(parseInt(profilesResult.rows[0].count));
            emailSearchesData.push(parseInt(emailsResult.rows[0].count));
        }

        // Plan distribution (pie chart)
        const planDistributionResult = await pool.query(`
            SELECT 
                CASE 
                    WHEN package_type = 'free' OR package_type IS NULL THEN 'Free'
                    WHEN package_type LIKE 'silver%' THEN 'Silver'
                    WHEN package_type LIKE 'gold%' THEN 'Gold'
                    WHEN package_type LIKE 'platinum%' THEN 'Platinum'
                    ELSE 'Other'
                END as plan_category,
                COUNT(*) as count
            FROM users
            GROUP BY plan_category
            ORDER BY count DESC
        `);

        return {
            dailyActivity: {
                labels,
                newUsers: newUsersData,
                messages: messagesData,
                profiles: profilesData,
                emailSearches: emailSearchesData
            },
            planDistribution: planDistributionResult.rows.map(row => ({
                label: row.plan_category,
                value: parseInt(row.count)
            }))
        };

    } catch (error) {
        logger.error('Error getting chart data:', error);
        throw error;
    }
}

module.exports = router;
