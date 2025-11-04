// routes/urlMigrationRoutes.js
// URL Migration Routes - Clean LinkedIn URLs in Database
// SECURITY: Simple password authentication (CHANGE THE PASSWORD!)

const router = require('express').Router();
const path = require('path');
const { pool } = require('../utils/database');
const { cleanLinkedInUrl } = require('../utils/helpers');
const logger = require('../utils/logger');

// ==================== SIMPLE AUTH MIDDLEWARE ====================

const MIGRATION_PASSWORD = process.env.MIGRATION_PASSWORD || 'ChangeMe123!'; // ⚠️ SET IN RAILWAY ENV VARS!

function checkMigrationAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: 'Authorization required',
            needsAuth: true
        });
    }
    
    const password = authHeader.replace('Bearer ', '');
    
    if (password !== MIGRATION_PASSWORD) {
        return res.status(403).json({
            success: false,
            error: 'Invalid password'
        });
    }
    
    next();
}

// ==================== URL MIGRATION PAGE ====================

// Serve migration dashboard HTML (no auth needed to view page)
router.get('/admin/migrate-urls', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, '..', 'url-migration.html'));
    } catch (error) {
        logger.error('Error serving URL migration page:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to serve migration page'
        });
    }
});

// ==================== VERIFICATION ENDPOINT ====================

// Verify current state - Shows what needs to be cleaned (READ-ONLY)
router.get('/api/admin/verify-urls', checkMigrationAuth, async (req, res) => {
    try {
        logger.info('Admin URL verification request');
        
        const verification = {
            target_profiles: await verifyTableUrls('target_profiles', 'linkedin_url'),
            message_logs: await verifyTableUrls('message_logs', 'target_profile_url'),
            user_profiles: await verifyTableUrls('user_profiles', 'linkedin_url'),
            users: await verifyTableUrls('users', 'linkedin_url'),
            email_requests: await verifyTableUrls('email_requests', 'linkedin_url'),
            email_finder_searches: await verifyTableUrls('email_finder_searches', 'linkedin_url'),
            brightdata_profiles: await verifyTableUrls('brightdata_profiles', 'linkedin_url')
        };

        res.json({
            success: true,
            verification,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('URL verification error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== DRY RUN ENDPOINT ====================

// Dry run - Shows what WOULD be changed (READ-ONLY, no changes made)
router.get('/api/admin/migrate-urls-dry-run', checkMigrationAuth, async (req, res) => {
    try {
        logger.info('Admin URL migration dry-run');
        
        const dryRun = {
            target_profiles: await dryRunTableMigration('target_profiles', 'linkedin_url'),
            message_logs: await dryRunTableMigration('message_logs', 'target_profile_url'),
            user_profiles: await dryRunTableMigration('user_profiles', 'linkedin_url'),
            users: await dryRunTableMigration('users', 'linkedin_url'),
            email_requests: await dryRunTableMigration('email_requests', 'linkedin_url'),
            email_finder_searches: await dryRunTableMigration('email_finder_searches', 'linkedin_url'),
            brightdata_profiles: await dryRunTableMigration('brightdata_profiles', 'linkedin_url')
        };

        res.json({
            success: true,
            dryRun,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('URL dry-run error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== EXECUTE MIGRATION ENDPOINT ====================

// Execute migration - Actually cleans the URLs (MAKES CHANGES!)
router.post('/api/admin/migrate-urls-execute', checkMigrationAuth, async (req, res) => {
    try {
        logger.info('Admin URL migration execution');
        
        const results = {};
        const tables = [
            { name: 'target_profiles', urlColumn: 'linkedin_url', idColumn: 'id' },
            { name: 'message_logs', urlColumn: 'target_profile_url', idColumn: 'id' },
            { name: 'user_profiles', urlColumn: 'linkedin_url', idColumn: 'id' },
            { name: 'users', urlColumn: 'linkedin_url', idColumn: 'id' },
            { name: 'email_requests', urlColumn: 'linkedin_url', idColumn: 'id' },
            { name: 'email_finder_searches', urlColumn: 'linkedin_url', idColumn: 'id' },
            { name: 'brightdata_profiles', urlColumn: 'linkedin_url', idColumn: 'id' }
        ];
        
        // Process each table in its own transaction
        for (const table of tables) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                results[table.name] = await executeMigration(client, table.name, table.urlColumn, table.idColumn);
                await client.query('COMMIT');
                logger.info(`Successfully migrated ${table.name}`);
            } catch (error) {
                await client.query('ROLLBACK');
                logger.error(`Error migrating ${table.name}:`, error.message);
                results[table.name] = {
                    table: table.name,
                    error: error.message,
                    updated: 0,
                    skipped: 0,
                    errors: 1
                };
            } finally {
                client.release();
            }
        }
        
        logger.info('URL migration completed');
        
        res.json({
            success: true,
            results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('URL migration error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

async function verifyTableUrls(tableName, urlColumn) {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_rows,
                COUNT(CASE WHEN ${urlColumn} LIKE 'https://%' OR ${urlColumn} LIKE 'http://%' THEN 1 END) as with_protocol,
                COUNT(CASE WHEN ${urlColumn} LIKE '%www.%' THEN 1 END) as with_www,
                COUNT(CASE WHEN ${urlColumn} LIKE '%?%' THEN 1 END) as with_query_params,
                COUNT(CASE WHEN ${urlColumn} LIKE '%/' AND ${urlColumn} NOT LIKE '%/?%' THEN 1 END) as with_trailing_slash
            FROM ${tableName}
            WHERE ${urlColumn} IS NOT NULL
        `);
        
        const stats = result.rows[0];
        const needsCleaning = parseInt(stats.with_protocol) + parseInt(stats.with_www) + 
                             parseInt(stats.with_query_params) + parseInt(stats.with_trailing_slash);
        
        return {
            table: tableName,
            totalRows: parseInt(stats.total_rows),
            needsCleaning: needsCleaning,
            withProtocol: parseInt(stats.with_protocol),
            withWww: parseInt(stats.with_www),
            withQueryParams: parseInt(stats.with_query_params),
            withTrailingSlash: parseInt(stats.with_trailing_slash),
            status: needsCleaning > 0 ? 'needs_cleaning' : 'clean'
        };
    } catch (error) {
        logger.error(`Error verifying ${tableName}:`, error);
        return {
            table: tableName,
            error: error.message
        };
    }
}

async function dryRunTableMigration(tableName, urlColumn) {
    try {
        const result = await pool.query(`
            SELECT id, ${urlColumn} as original_url
            FROM ${tableName}
            WHERE ${urlColumn} IS NOT NULL
            AND (
                ${urlColumn} LIKE 'https://%' 
                OR ${urlColumn} LIKE 'http://%'
                OR ${urlColumn} LIKE '%www.%'
                OR ${urlColumn} LIKE '%?%'
                OR (${urlColumn} LIKE '%/' AND ${urlColumn} NOT LIKE '%/?%')
            )
            LIMIT 10
        `);
        
        const examples = result.rows.map(row => {
            const cleaned = cleanLinkedInUrl(row.original_url);
            return {
                id: row.id,
                before: row.original_url,
                after: cleaned,
                willChange: row.original_url !== cleaned
            };
        });
        
        const countResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM ${tableName}
            WHERE ${urlColumn} IS NOT NULL
            AND (
                ${urlColumn} LIKE 'https://%' 
                OR ${urlColumn} LIKE 'http://%'
                OR ${urlColumn} LIKE '%www.%'
                OR ${urlColumn} LIKE '%?%'
                OR (${urlColumn} LIKE '%/' AND ${urlColumn} NOT LIKE '%/?%')
            )
        `);
        
        return {
            table: tableName,
            willUpdate: parseInt(countResult.rows[0].count),
            examples: examples
        };
    } catch (error) {
        logger.error(`Error in dry-run for ${tableName}:`, error);
        return {
            table: tableName,
            error: error.message
        };
    }
}

async function executeMigration(client, tableName, urlColumn, idColumn) {
    try {
        // Get all rows that need cleaning
        const selectResult = await client.query(`
            SELECT ${idColumn}, ${urlColumn}
            FROM ${tableName}
            WHERE ${urlColumn} IS NOT NULL
        `);
        
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        
        // Update each row
        for (const row of selectResult.rows) {
            const cleanedUrl = cleanLinkedInUrl(row[urlColumn]);
            
            if (!cleanedUrl) {
                logger.warn(`Skipping ${tableName} id ${row[idColumn]}: cleanLinkedInUrl returned null for: ${row[urlColumn]}`);
                skipped++;
                continue;
            }
            
            if (cleanedUrl !== row[urlColumn]) {
                try {
                    await client.query(`
                        UPDATE ${tableName}
                        SET ${urlColumn} = $1
                        WHERE ${idColumn} = $2
                    `, [cleanedUrl, row[idColumn]]);
                    updated++;
                } catch (err) {
                    logger.error(`Error updating ${tableName} id ${row[idColumn]}:`, err.message);
                    errors++;
                    // Continue with next row instead of throwing
                }
            } else {
                skipped++;
            }
        }
        
        return {
            table: tableName,
            totalRows: selectResult.rows.length,
            updated: updated,
            skipped: skipped,
            errors: errors
        };
    } catch (error) {
        logger.error(`Error executing migration for ${tableName}:`, error);
        throw error;
    }
}

module.exports = router;
