// routes/health.js - Health Check and Status Routes - ENHANCED DETAILED VERSION
const express = require('express');

// Helper function to format uptime
function formatUptime(uptimeSeconds) {
    const days = Math.floor(uptimeSeconds / (24 * 60 * 60));
    const hours = Math.floor((uptimeSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((uptimeSeconds % (60 * 60)) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

// ✅ FIXED: Export function that creates router, not router directly
module.exports = (pool) => {
    const router = express.Router();

    // Comprehensive health check endpoint with detailed system metrics
    router.get('/health', async (req, res) => {
        try {
            const startTime = Date.now();
            let databaseStatus = 'not_tested';
            let databaseLatency = null;
            let databaseInfo = {};
            
            // Test database connection and get detailed info
            if (pool) {
                try {
                    const dbStart = Date.now();
                    const result = await pool.query(`
                        SELECT 
                            version() as version,
                            current_database() as database_name,
                            current_user as user,
                            inet_server_addr() as server_ip,
                            inet_server_port() as server_port,
                            pg_database_size(current_database()) as database_size,
                            (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') as table_count,
                            NOW() as server_time
                    `);
                    databaseLatency = Date.now() - dbStart;
                    databaseStatus = 'connected';
                    
                    if (result.rows[0]) {
                        const row = result.rows[0];
                        databaseInfo = {
                            version: row.version,
                            database_name: row.database_name,
                            user: row.user,
                            server_ip: row.server_ip,
                            server_port: row.server_port,
                            database_size_bytes: parseInt(row.database_size),
                            database_size_mb: Math.round(parseInt(row.database_size) / 1024 / 1024),
                            table_count: parseInt(row.table_count),
                            server_time: row.server_time,
                            latency_ms: databaseLatency
                        };
                    }
                } catch (dbError) {
                    console.error('Database health check error:', dbError);
                    databaseStatus = 'error';
                    databaseInfo = { error: dbError.message };
                }
            }
            
            // Get comprehensive system metrics
            const memoryUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            // Calculate response time
            const responseTime = Date.now() - startTime;
            
            // Comprehensive health response
            const healthData = {
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'Msgly.AI API',
                version: '2.0.9',
                environment: process.env.NODE_ENV || 'production',
                
                // System Information
                system: {
                    uptime_seconds: Math.floor(process.uptime()),
                    uptime_formatted: formatUptime(process.uptime()),
                    platform: process.platform,
                    arch: process.arch,
                    node_version: process.version,
                    pid: process.pid
                },
                
                // Performance Metrics
                performance: {
                    response_time_ms: responseTime,
                    cpu_usage: {
                        user_microseconds: cpuUsage.user,
                        system_microseconds: cpuUsage.system
                    },
                    memory: {
                        heap_used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                        heap_total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                        heap_used_percent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
                        rss_mb: Math.round(memoryUsage.rss / 1024 / 1024),
                        external_mb: Math.round(memoryUsage.external / 1024 / 1024),
                        array_buffers_mb: Math.round((memoryUsage.arrayBuffers || 0) / 1024 / 1024)
                    }
                },
                
                // Database Status
                database: {
                    status: databaseStatus,
                    ...databaseInfo
                },
                
                // Environment Variables (non-sensitive)
                environment_info: {
                    port: process.env.PORT || 3000,
                    railway_environment: process.env.RAILWAY_ENVIRONMENT || 'unknown',
                    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID || 'unknown',
                    service_id: process.env.RAILWAY_SERVICE_ID || 'unknown'
                },
                
                // Health Status Summary
                health_checks: {
                    database: databaseStatus === 'connected',
                    memory_ok: (memoryUsage.heapUsed / memoryUsage.heapTotal) < 0.9,
                    response_time_ok: responseTime < 1000
                }
            };
            
            res.status(200).json(healthData);
            
        } catch (error) {
            console.error('Health check error:', error);
            res.status(500).json({
                success: false,
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString(),
                service: 'Msgly.AI API',
                version: '2.0.9'
            });
        }
    });

    // Detailed status endpoint
    router.get('/status', async (req, res) => {
        try {
            let databaseStatus = 'not_tested';
            
            // Test database if pool provided
            if (pool) {
                try {
                    await pool.query('SELECT NOW()');
                    databaseStatus = 'connected';
                } catch (dbError) {
                    databaseStatus = 'error';
                }
            }
            
            // More detailed system status
            const status = {
                success: true,
                status: 'operational',
                timestamp: new Date().toISOString(),
                service: 'Msgly.AI API',
                version: '2.0.9',
                uptime: process.uptime(),
                environment: process.env.NODE_ENV || 'production',
                database: databaseStatus,
                memory: {
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
                }
            };

            res.status(200).json(status);
        } catch (error) {
            console.error('Status check error:', error);
            res.status(500).json({
                success: false,
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });

    // API version endpoint
    router.get('/version', (req, res) => {
        res.status(200).json({
            success: true,
            version: '2.0.9',
            service: 'Msgly.AI API',
            timestamp: new Date().toISOString()
        });
    });

    return router;
};
