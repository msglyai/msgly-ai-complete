// routes/adminRoutes.js
// Admin Dashboard Routes - Analytics and Management
// SECURITY: Uses existing requireAdmin middleware from auth.js

const router = require('express').Router();
const path = require('path'); // FIXED: Added missing path import
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { pool } = require('../utils/database');
const logger = require('../utils/logger');

// Server startup time for uptime calculation
const serverStartTime = Date.now();

// ==================== ADMIN DASHBOARD ROUTES ====================

// Serve admin dashboard HTML
router.get('/admin-dashboard', authenticateToken, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'admin-dashboard.html'));
});

// ==================== ADMIN API ENDPOINTS ====================

// Main analytics endpoint
router.get('/api/admin/analytics', authenticateToken, requireAdmin, async (req, res) => {
    try {
        logger.debug('Admin analytics request from:', req.user.email);
        
        const {
            timeRange = '7days',
            userType = 'all',
            startDate,
            endDate
        } = req.query;

        // Calculate date range
        const dateRange = calculateDateRange(timeRange, startDate, endDate);
        const previousDateRange = calculatePreviousDateRange(dateRange);

        // Get current period stats
        const currentStats = await getAnalyticsStats(dateRange, userType);
        
        // Get previous period stats for comparison
        const previousStats = await getAnalyticsStats(previousDateRange, userType);
        
        // Calculate changes
        const changes = calculateChanges(currentStats, previousStats);
        
        // Get chart data
        const chartData = await getChartData(dateRange, userType);
        
        // Get recent users
        const recentUsers = await getRecentUsers(dateRange, userType);

        res.json({
            success: true,
            data: {
                stats: {
                    ...currentStats,
                    changes
                },
                charts: chartData,
                recentUsers,
                filters: {
                    timeRange,
                    userType,
                    dateRange: {
                        start: dateRange.start.toISOString(),
                        end: dateRange.end.toISOString()
                    }
                }
            }
        });

    } catch (error) {
        logger.error('Admin analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics data',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// System health endpoint
router.get('/api/admin/health', authenticateToken, requireAdmin, async (req, res) => {
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

        // Calculate uptime
        const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

        res.json({
            success: true,
            data: {
                database: {
                    status: 'healthy',
                    responseTime: dbResponseTime,
                    connections: dbStats.rows[0]
                },
                uptime: uptimeSeconds,
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

// Export analytics data as CSV
router.get('/api/admin/export', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            timeRange = '7days',
            userType = 'all',
            startDate,
            endDate
        } = req.query;

        const dateRange = calculateDateRange(timeRange, startDate, endDate);
        const stats = await getAnalyticsStats(dateRange, userType);

        // Create CSV content
        const csvData = [
            ['Metric', 'Value', 'Period', 'Export Date'],
            ['Total Users', stats.totalUsers, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['New Users', stats.newUsers, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['Paid Users', stats.paidUsers, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['Completed Profiles', stats.completedProfiles, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['Messages Generated', stats.messagesGenerated, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['Profiles Analyzed', stats.profilesAnalyzed, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['Credits Used', stats.creditsUsed, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['Error Count', stats.errorCount, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()],
            ['Total Requests', stats.totalRequests, `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`, new Date().toISOString()]
        ];

        const csvContent = csvData.map(row => row.join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=msgly-analytics-${timeRange}-${Date.now()}.csv`);
        res.send(csvContent);

    } catch (error) {
        logger.error('Export error:', error);
        res.status(500).json({
            success: false,
            error: 'Export failed'
        });
    }
});

// Export users data as CSV
router.get('/api/admin/export-users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            timeRange = '7days',
            userType = 'all',
            startDate,
            endDate
        } = req.query;

        const dateRange = calculateDateRange(timeRange, startDate, endDate);
        const users = await getDetailedUsers(dateRange, userType);

        // Create CSV headers
        const headers = [
            'ID', 'Email', 'Display Name', 'Subscription Plan', 'Credits Remaining',
            'Registration Completed', 'Profile Completed', 'Messages Generated',
            'Profiles Analyzed', 'Is Admin', 'Created Date', 'Last Login'
        ];

        // Create CSV rows
        const rows = users.map(user => [
            user.id,
            user.email,
            user.display_name || '',
            user.subscription_plan || 'free',
            user.credits_remaining || 0,
            user.registration_completed ? 'Yes' : 'No',
            user.profile_completed ? 'Yes' : 'No',
            user.message_count || 0,
            user.profile_analysis_count || 0,
            user.is_admin ? 'Yes' : 'No',
            user.created_at ? new Date(user.created_at).toISOString() : '',
            user.last_login || ''
        ]);

        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=msgly-users-${timeRange}-${Date.now()}.csv`);
        res.send(csvContent);

    } catch (error) {
        logger.error('Users export error:', error);
        res.status(500).json({
            success: false,
            error: 'Users export failed'
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

// Calculate date range based on filter
function calculateDateRange(timeRange, startDate, endDate) {
    const now = new Date();
    let start, end = new Date(now);

    switch (timeRange) {
        case 'today':
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case '7days':
            start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '30days':
            start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case '90days':
            start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
        case 'custom':
            if (startDate && endDate) {
                start = new Date(startDate);
                end = new Date(endDate);
                end.setHours(23, 59, 59, 999); // Include full end date
            } else {
                // Fallback to 7 days if custom dates not provided
                start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            }
            break;
        default:
            start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    return { start, end };
}

// Calculate previous period for comparison
function calculatePreviousDateRange(currentRange) {
    const duration = currentRange.end.getTime() - currentRange.start.getTime();
    return {
        start: new Date(currentRange.start.getTime() - duration),
        end: new Date(currentRange.start.getTime())
    };
}

// Get main analytics statistics
async function getAnalyticsStats(dateRange, userType) {
    try {
        // Build user type filter
        let userTypeFilter = '';
        if (userType === 'free') {
            userTypeFilter = "AND (u.subscription_plan IS NULL OR u.subscription_plan = 'free')";
        } else if (userType === 'paid') {
            userTypeFilter = "AND u.subscription_plan IS NOT NULL AND u.subscription_plan != 'free'";
        } else if (userType === 'admin') {
            userTypeFilter = "AND u.is_admin = true";
        }

        // Total users (all time)
        const totalUsersResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM users u 
            WHERE 1=1 ${userTypeFilter}
        `);

        // New users in period
        const newUsersResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM users u 
            WHERE u.created_at BETWEEN $1 AND $2 ${userTypeFilter}
        `, [dateRange.start, dateRange.end]);

        // Paid users (all time)
        const paidUsersResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM users u 
            WHERE u.subscription_plan IS NOT NULL 
            AND u.subscription_plan != 'free' 
            ${userType === 'all' ? '' : userTypeFilter}
        `);

        // Profile completion stats
        const profileStatsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(up.user_id) as users_with_profiles,
                COUNT(CASE WHEN up.registration_completed = true THEN 1 END) as completed_profiles
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE 1=1 ${userTypeFilter}
        `);

        // Messages generated in period
        const messagesResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM message_logs ml
            JOIN users u ON ml.user_id = u.id
            WHERE ml.created_at BETWEEN $1 AND $2 ${userTypeFilter}
        `, [dateRange.start, dateRange.end]);

        // Target profiles analyzed in period
        const profilesResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM target_profiles tp
            WHERE tp.created_at BETWEEN $1 AND $2
        `);

        // Credits used in period
        const creditsResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_credits_used
            FROM credits_transactions ct
            JOIN users u ON ct.user_id = u.id
            WHERE ct.transaction_type = 'debit' 
            AND ct.created_at BETWEEN $1 AND $2 ${userTypeFilter}
        `, [dateRange.start, dateRange.end]);

        // Error tracking (approximate from failed message generations)
        const errorsResult = await pool.query(`
            SELECT COUNT(*) as error_count
            FROM message_logs ml
            JOIN users u ON ml.user_id = u.id
            WHERE ml.created_at BETWEEN $1 AND $2 
            AND (ml.generated_message IS NULL OR ml.generated_message = '') ${userTypeFilter}
        `, [dateRange.start, dateRange.end]);

        // Total requests (messages + profiles in period)
        const totalRequestsResult = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM message_logs ml JOIN users u ON ml.user_id = u.id WHERE ml.created_at BETWEEN $1 AND $2 ${userTypeFilter}) +
                (SELECT COUNT(*) FROM target_profiles WHERE created_at BETWEEN $1 AND $2) as total_requests
        `, [dateRange.start, dateRange.end]);

        return {
            totalUsers: parseInt(totalUsersResult.rows[0].count),
            newUsers: parseInt(newUsersResult.rows[0].count),
            paidUsers: parseInt(paidUsersResult.rows[0].count),
            completedProfiles: parseInt(profileStatsResult.rows[0].completed_profiles),
            messagesGenerated: parseInt(messagesResult.rows[0].count),
            profilesAnalyzed: parseInt(profilesResult.rows[0].count),
            creditsUsed: parseInt(creditsResult.rows[0].total_credits_used || 0),
            errorCount: parseInt(errorsResult.rows[0].error_count),
            totalRequests: parseInt(totalRequestsResult.rows[0].total_requests)
        };

    } catch (error) {
        logger.error('Error getting analytics stats:', error);
        throw error;
    }
}

// Calculate percentage changes between periods
function calculateChanges(current, previous) {
    const calculatePercentChange = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
    };

    return {
        totalUsers: calculatePercentChange(current.totalUsers, previous.totalUsers),
        newUsers: calculatePercentChange(current.newUsers, previous.newUsers),
        paidUsers: calculatePercentChange(current.paidUsers, previous.paidUsers),
        messagesGenerated: calculatePercentChange(current.messagesGenerated, previous.messagesGenerated),
        profilesAnalyzed: calculatePercentChange(current.profilesAnalyzed, previous.profilesAnalyzed),
        creditsUsed: calculatePercentChange(current.creditsUsed, previous.creditsUsed),
        errorRate: calculatePercentChange(
            current.totalRequests > 0 ? (current.errorCount / current.totalRequests) * 100 : 0,
            previous.totalRequests > 0 ? (previous.errorCount / previous.totalRequests) * 100 : 0
        )
    };
}

// Get chart data for visualization
async function getChartData(dateRange, userType) {
    try {
        // Build user type filter
        let userTypeFilter = '';
        if (userType === 'free') {
            userTypeFilter = "AND (u.subscription_plan IS NULL OR u.subscription_plan = 'free')";
        } else if (userType === 'paid') {
            userTypeFilter = "AND u.subscription_plan IS NOT NULL AND u.subscription_plan != 'free'";
        } else if (userType === 'admin') {
            userTypeFilter = "AND u.is_admin = true";
        }

        // Generate date labels for the period
        const days = Math.ceil((dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24));
        const labels = [];
        const userGrowthData = { newUsers: [], totalUsers: [] };
        const activityData = { messages: [], profiles: [] };

        // For each day in the range, get data
        for (let i = 0; i < days; i++) {
            const currentDate = new Date(dateRange.start.getTime() + i * 24 * 60 * 60 * 1000);
            const nextDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
            
            labels.push(currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

            // New users for this day
            const newUsersResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM users u 
                WHERE u.created_at BETWEEN $1 AND $2 ${userTypeFilter}
            `, [currentDate, nextDate]);

            // Total users up to this day
            const totalUsersResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM users u 
                WHERE u.created_at <= $1 ${userTypeFilter}
            `, [nextDate]);

            // Messages for this day
            const messagesResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM message_logs ml
                JOIN users u ON ml.user_id = u.id
                WHERE ml.created_at BETWEEN $1 AND $2 ${userTypeFilter}
            `, [currentDate, nextDate]);

            // Profiles analyzed for this day
            const profilesResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM target_profiles tp
                WHERE tp.created_at BETWEEN $1 AND $2
            `, [currentDate, nextDate]);

            userGrowthData.newUsers.push(parseInt(newUsersResult.rows[0].count));
            userGrowthData.totalUsers.push(parseInt(totalUsersResult.rows[0].count));
            activityData.messages.push(parseInt(messagesResult.rows[0].count));
            activityData.profiles.push(parseInt(profilesResult.rows[0].count));
        }

        // User distribution (current totals)
        const distributionResult = await pool.query(`
            SELECT 
                COUNT(CASE WHEN (subscription_plan IS NULL OR subscription_plan = 'free') AND is_admin = false THEN 1 END) as free_users,
                COUNT(CASE WHEN subscription_plan IS NOT NULL AND subscription_plan != 'free' AND is_admin = false THEN 1 END) as paid_users,
                COUNT(CASE WHEN is_admin = true THEN 1 END) as admin_users
            FROM users
        `);

        return {
            userGrowth: {
                labels,
                newUsers: userGrowthData.newUsers,
                totalUsers: userGrowthData.totalUsers
            },
            userDistribution: {
                free: parseInt(distributionResult.rows[0].free_users),
                paid: parseInt(distributionResult.rows[0].paid_users),
                admin: parseInt(distributionResult.rows[0].admin_users)
            },
            activity: {
                labels,
                messages: activityData.messages,
                profiles: activityData.profiles
            }
        };

    } catch (error) {
        logger.error('Error getting chart data:', error);
        throw error;
    }
}

// Get recent users for table display
async function getRecentUsers(dateRange, userType, limit = 20) {
    try {
        // Build user type filter
        let userTypeFilter = '';
        if (userType === 'free') {
            userTypeFilter = "AND (u.subscription_plan IS NULL OR u.subscription_plan = 'free')";
        } else if (userType === 'paid') {
            userTypeFilter = "AND u.subscription_plan IS NOT NULL AND u.subscription_plan != 'free'";
        } else if (userType === 'admin') {
            userTypeFilter = "AND u.is_admin = true";
        }

        const result = await pool.query(`
            SELECT 
                u.id,
                u.email,
                u.display_name,
                u.subscription_plan,
                u.credits_remaining,
                u.registration_completed,
                u.is_admin,
                u.created_at,
                up.full_name IS NOT NULL as profile_completed,
                COALESCE(ml.message_count, 0) as message_count
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as message_count
                FROM message_logs
                GROUP BY user_id
            ) ml ON u.id = ml.user_id
            WHERE u.created_at BETWEEN $1 AND $2 ${userTypeFilter}
            ORDER BY u.created_at DESC
            LIMIT $3
        `, [dateRange.start, dateRange.end, limit]);

        return result.rows;

    } catch (error) {
        logger.error('Error getting recent users:', error);
        throw error;
    }
}

// Get detailed users for export
async function getDetailedUsers(dateRange, userType) {
    try {
        // Build user type filter
        let userTypeFilter = '';
        if (userType === 'free') {
            userTypeFilter = "AND (u.subscription_plan IS NULL OR u.subscription_plan = 'free')";
        } else if (userType === 'paid') {
            userTypeFilter = "AND u.subscription_plan IS NOT NULL AND u.subscription_plan != 'free'";
        } else if (userType === 'admin') {
            userTypeFilter = "AND u.is_admin = true";
        }

        const result = await pool.query(`
            SELECT 
                u.id,
                u.email,
                u.display_name,
                u.subscription_plan,
                u.credits_remaining,
                u.registration_completed,
                u.is_admin,
                u.created_at,
                u.last_login,
                up.full_name IS NOT NULL as profile_completed,
                COALESCE(ml.message_count, 0) as message_count,
                COALESCE(tl.profile_analysis_count, 0) as profile_analysis_count
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as message_count
                FROM message_logs
                GROUP BY user_id
            ) ml ON u.id = ml.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as profile_analysis_count
                FROM target_profiles
                GROUP BY user_id
            ) tl ON u.id = tl.user_id
            WHERE u.created_at BETWEEN $1 AND $2 ${userTypeFilter}
            ORDER BY u.created_at DESC
        `, [dateRange.start, dateRange.end]);

        return result.rows;

    } catch (error) {
        logger.error('Error getting detailed users:', error);
        throw error;
    }
}

module.exports = router;
