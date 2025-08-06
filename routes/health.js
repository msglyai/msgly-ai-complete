// routes/health.js - Health Check and Status Routes
const express = require('express');
const router = express.Router();

// Basic health check endpoint
router.get('/health', async (req, res) => {
    try {
        // Basic health check
        res.status(200).json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'Msgly.AI API',
            version: '2.0.9'
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
        // More detailed system status
        const status = {
            success: true,
            status: 'operational',
            timestamp: new Date().toISOString(),
            service: 'Msgly.AI API',
            version: '2.0.9',
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'production',
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

module.exports = router;
