// routes/health.js - Health Check and Status Routes - FIXED EXPORT
const express = require('express');

// ✅ FIXED: Export function that creates router, not router directly
module.exports = (pool) => {
    const router = express.Router();

    // Basic health check endpoint
    router.get('/health', async (req, res) => {
        try {
            // Test database connection if pool provided
            if (pool) {
                await pool.query('SELECT NOW()');
            }
            
            // Basic health check
            res.status(200).json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'Msgly.AI API',
                version: '2.0.9',
                database: pool ? 'connected' : 'not_tested'
            });
        } catch (error) {
            console.error('Health check error:', error);
            res.status(500).json({
                success: false,
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
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
