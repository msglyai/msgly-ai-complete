// routes/urlMigrationRoutes.js - IMPROVED VERSION
// Handles duplicates BEFORE cleaning URLs

const router = require('express').Router();
const path = require('path');
const { pool } = require('../utils/database');
const { cleanLinkedInUrl } = require('../utils/helpers');
const logger = require('../utils/logger');

// Simple password auth
const MIGRATION_PASSWORD = process.env.MIGRATION_PASSWORD || 'ChangeMe123!';

function checkMigrationAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ success: false, error: 'Authorization required', needsAuth: true });
    }
    const password = authHeader.replace('Bearer ', '');
    if (password !== MIGRATION_PASSWORD) {
        return res.status(403).json({ success: false, error: 'Invalid password' });
    }
    next();
}

// Serve migration page
router.get('/admin/migrate-urls', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, '..', 'url-migration.html'));
    } catch (error) {
        logger.error('Error serving URL migration page:', error);
        res.status(500).json({ success: false, error: 'Failed to serve migration page' });
    }
});

// Verify endpoint
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

        res.json({ success: true, verification, timestamp: new Date().toISOString() });
    } catch (error) {
        logger.error('URL verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Dry run endpoint
router.get('/api/admin/migrate-urls-dry-run', checkMigrationAuth, async (req, res) => {
    try {
        logger.info('Admin URL migration dry-run');
        
        const dryRun = {
            target_profiles: await dryRunTableMigration('target_profiles', 'linkedin_url', 'user_id'),
            message_logs: await dryRunTableMigration('message_logs', 'target_profile_url', null),
            user_profiles: await dryRunTableMigration('user_profiles', 'linkedin_url', null),
            users: await dryRunTableMigration('users', 'linkedin_url', null),
            email_requests: await dryRunTableMigration('email_requests', 'linkedin_url', 'user_id'),
            email_finder_searches: await dryRunTableMigration('email_finder_searches', 'linkedin_url', 'user_id'),
            brightdata_profiles: await dryRunTableMigration('brightdata_profiles', 'linkedin_url', null)
        };

        res.json({ success: true, dryRun, timestamp: new Date().toISOString() });
    } catch (error) {
        logger.error('URL dry-run error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute migration - IMPROVED VERSION
router.post('/api/admin/migrate-urls-execute', checkMigrationAuth, async (req, res) => {
    try {
        logger.info('Admin URL migration execution - IMPROVED VERSION');
        
        const results = {};
        const tables = [
            { name: 'target_profiles', urlColumn: 'linkedin_url', idColumn: 'id', userIdColumn: 'user_id' },
            { name: 'message_logs', urlColumn: 'target_profile_url', idColumn: 'id', userIdColumn: null },
            { name: 'user_profiles', urlColumn: 'linkedin_url', idColumn: 'id', userIdColumn: null },
            { name: 'users', urlColumn: 'linkedin_url', idColumn: 'id', userIdColumn: null },
            { name: 'email_requests', urlColumn: 'linkedin_url', idColumn: 'id', userIdColumn: 'user_id' },
            { name: 'email_finder_searches', urlColumn: 'linkedin_url', idColumn: 'id', userIdColumn: 'user_id' },
            { name: 'brightdata_profiles', urlColumn: 'linkedin_url', idColumn: 'id', userIdColumn: null }
        ];
        
        // Process each table
        for (const table of tables) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                results[table.name] = await executeMigrationWithDuplicateHandling(
                    client, 
                    table.name, 
                    table.urlColumn, 
                    table.idColumn,
                    table.userIdColumn
                );
                await client.query('COMMIT');
                logger.info(`Successfully migrated ${table.name}`);
            } catch (error) {
                await client.query('ROLLBACK');
                logger.error(`Error migrating ${table.name}:`, error.message);
                results[table.name] = {
                    table: table.name,
                    error: error.message,
                    updated: 0,
                    duplicatesRemoved: 0,
                    skipped: 0,
                    errors: 1
                };
            } finally {
                client.release();
            }
        }
        
        logger.info('URL migration completed');
        res.json({ success: true, results, timestamp: new Date().toISOString() });
    } catch (error) {
        logger.error('URL migration error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// NEW: Force cleanup endpoint - Uses SQL directly for bulletproof cleaning
router.post('/api/admin/force-cleanup-target-profiles', checkMigrationAuth, async (req, res) => {
    const client = await pool.connect();
    
    try {
        logger.info('FORCE CLEANUP: Starting target_profiles cleanup');
        
        await client.query('BEGIN');
        
        // Step 1: Find duplicates
        const duplicatesQuery = `
            SELECT 
                tp1.id as keep_id,
                tp2.id as delete_id,
                tp1.user_id,
                tp1.linkedin_url as keep_url,
                tp2.linkedin_url as delete_url
            FROM target_profiles tp1
            JOIN target_profiles tp2 ON (
                tp1.user_id = tp2.user_id 
                AND tp1.id < tp2.id
                AND (
                    tp1.linkedin_url = tp2.linkedin_url
                    OR
                    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
                        tp1.linkedin_url, '^https?://(www\\.)?', ''), '\\?.*$', ''), '#.*$', ''), '/$', '')) 
                    = 
                    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
                        tp2.linkedin_url, '^https?://(www\\.)?', ''), '\\?.*$', ''), '#.*$', ''), '/$', ''))
                )
            )
        `;
        
        const duplicatesResult = await client.query(duplicatesQuery);
        logger.info(`Found ${duplicatesResult.rows.length} duplicates`);
        
        // Step 2: Delete duplicates
        let deletedCount = 0;
        if (duplicatesResult.rows.length > 0) {
            const deleteIds = duplicatesResult.rows.map(row => row.delete_id);
            const deleteQuery = `DELETE FROM target_profiles WHERE id = ANY($1)`;
            const deleteResult = await client.query(deleteQuery, [deleteIds]);
            deletedCount = deleteResult.rowCount;
            logger.info(`Deleted ${deletedCount} duplicate rows`);
        }
        
        // Step 3: Clean URLs using SQL directly
        const cleanQuery = `
            UPDATE target_profiles
            SET linkedin_url = LOWER(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(
                            REGEXP_REPLACE(
                                linkedin_url, '^https?://(www\\.)?', ''
                            ), '\\?.*$', ''
                        ), '#.*$', ''
                    ), '/$', ''
                )
            )
            WHERE linkedin_url IS NOT NULL
            AND (
                linkedin_url LIKE 'https://%' 
                OR linkedin_url LIKE 'http://%'
                OR linkedin_url LIKE '%www.%'
                OR linkedin_url LIKE '%?%'
                OR linkedin_url LIKE '%/'
            )
        `;
        
        const cleanResult = await client.query(cleanQuery);
        logger.info(`Cleaned ${cleanResult.rowCount} URLs`);
        
        // Step 4: Verify
        const verifyQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN linkedin_url LIKE 'https://%' OR linkedin_url LIKE 'http://%' THEN 1 END) as with_protocol,
                COUNT(CASE WHEN linkedin_url LIKE '%www.%' THEN 1 END) as with_www
            FROM target_profiles
            WHERE linkedin_url IS NOT NULL
        `;
        
        const verifyResult = await client.query(verifyQuery);
        const verification = verifyResult.rows[0];
        
        await client.query('COMMIT');
        
        logger.info('FORCE CLEANUP: Completed successfully');
        
        res.json({
            success: true,
            duplicatesRemoved: deletedCount,
            urlsCleaned: cleanResult.rowCount,
            verification: {
                total: parseInt(verification.total),
                stillNeedsCleaning: parseInt(verification.with_protocol) + parseInt(verification.with_www)
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('FORCE CLEANUP error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// Helper functions
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
        return { table: tableName, error: error.message };
    }
}

async function dryRunTableMigration(tableName, urlColumn, userIdColumn) {
    try {
        // Find potential duplicates
        const groupBy = userIdColumn ? `${urlColumn}, ${userIdColumn}` : urlColumn;
        const duplicatesQuery = `
            SELECT ${urlColumn}, COUNT(*) as count
            FROM ${tableName}
            WHERE ${urlColumn} IS NOT NULL
            GROUP BY ${groupBy}
            HAVING COUNT(*) > 1
        `;
        const duplicatesResult = await pool.query(duplicatesQuery);
        
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
            currentDuplicates: duplicatesResult.rows.length,
            examples: examples
        };
    } catch (error) {
        logger.error(`Error in dry-run for ${tableName}:`, error);
        return { table: tableName, error: error.message };
    }
}

async function executeMigrationWithDuplicateHandling(client, tableName, urlColumn, idColumn, userIdColumn) {
    try {
        logger.info(`Processing ${tableName} - Step 1: Remove duplicates`);
        
        // Step 1: Remove duplicates (keep oldest)
        let duplicatesRemoved = 0;
        if (userIdColumn) {
            const deleteQuery = `
                DELETE FROM ${tableName}
                WHERE ${idColumn} NOT IN (
                    SELECT MIN(${idColumn})
                    FROM ${tableName}
                    GROUP BY ${urlColumn}, ${userIdColumn}
                )
            `;
            const deleteResult = await client.query(deleteQuery);
            duplicatesRemoved = deleteResult.rowCount || 0;
            logger.info(`${tableName}: Removed ${duplicatesRemoved} duplicates`);
        }
        
        logger.info(`Processing ${tableName} - Step 2: Clean URLs`);
        
        // Step 2: Get all rows
        const selectResult = await client.query(`
            SELECT ${idColumn}, ${urlColumn}
            FROM ${tableName}
            WHERE ${urlColumn} IS NOT NULL
        `);
        
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        
        // Step 3: Update each row
        for (const row of selectResult.rows) {
            const cleanedUrl = cleanLinkedInUrl(row[urlColumn]);
            
            if (!cleanedUrl) {
                logger.warn(`Skipping ${tableName} id ${row[idColumn]}: cleanLinkedInUrl returned null`);
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
                    logger.error(`Error updating ${tableName} id ${row[idColumn]}: ${err.message}`);
                    errors++;
                }
            } else {
                skipped++;
            }
        }
        
        return {
            table: tableName,
            totalRows: selectResult.rows.length,
            duplicatesRemoved: duplicatesRemoved,
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
