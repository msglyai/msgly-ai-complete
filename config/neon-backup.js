// Neon backup database configuration for file-based target profiles
const { Pool } = require('pg');

// Create connection pool for Neon backup database
const backupDB = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test connection on startup
backupDB.on('connect', () => {
    console.log('[NEON] Connected to backup database');
});

backupDB.on('error', (err) => {
    console.error('[NEON] Database error:', err);
});

// Graceful shutdown
process.on('beforeExit', () => {
    backupDB.end();
});

module.exports = { backupDB };
