// credits.js - Complete Credit Management System
// Handles credit holds, deductions, transactions, and validation

const { pool } = require('./utils/database');

class CreditManager {
    constructor() {
        this.OPERATION_COSTS = {
            'target_analysis': 0.25,
            'message_generation': 1.0,
            'connection_generation': 1.0
        };
    }

    // Check if user has sufficient credits
    async checkCredits(userId, operationType) {
        try {
            const result = await pool.query(
                'SELECT credits_remaining FROM users WHERE id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                throw new Error('User not found');
            }

            const currentCredits = parseFloat(result.rows[0].credits_remaining) || 0;
            const requiredCredits = this.OPERATION_COSTS[operationType] || 0;

            return {
                success: true,
                hasCredits: currentCredits >= requiredCredits,
                currentCredits: currentCredits,
                requiredCredits: requiredCredits,
                remaining: currentCredits - requiredCredits
            };
        } catch (error) {
            console.error('❌ Error checking credits:', error);
            return {
                success: false,
                error: error.message,
                hasCredits: false
            };
        }
    }

    // Create credit hold before operation
    async createHold(userId, operationType, operationData = {}) {
        try {
            const creditCheck = await this.checkCredits(userId, operationType);
            
            if (!creditCheck.success) {
                return {
                    success: false,
                    error: creditCheck.error
                };
            }

            if (!creditCheck.hasCredits) {
                return {
                    success: false,
                    error: 'insufficient_credits',
                    userMessage: `Insufficient credits. Required: ${creditCheck.requiredCredits}, Available: ${creditCheck.currentCredits}`,
                    currentCredits: creditCheck.currentCredits,
                    requiredCredits: creditCheck.requiredCredits
                };
            }

            const holdId = this.generateHoldId();
            const requiredCredits = this.OPERATION_COSTS[operationType];

            // Create hold record in credits_transactions
            await pool.query(`
                INSERT INTO credits_transactions (
                    user_id, operation_type, amount, status, 
                    hold_id, operation_data, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [
                userId,
                operationType,
                -requiredCredits,
                'held',
                holdId,
                JSON.stringify(operationData)
            ]);

            console.log(`✅ Credit hold created: ${holdId} for ${requiredCredits} credits`);

            return {
                success: true,
                holdId: holdId,
                amountHeld: requiredCredits,
                currentCredits: creditCheck.currentCredits,
                remainingAfterHold: creditCheck.remaining
            };

        } catch (error) {
            console.error('❌ Error creating credit hold:', error);
            return {
                success: false,
                error: 'Failed to create credit hold',
                details: error.message
            };
        }
    }

    // Complete operation and deduct credits
    async completeOperation(userId, holdId, operationResult = {}) {
        try {
            // Start transaction
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');

                // Get hold information
                const holdResult = await client.query(`
                    SELECT * FROM credits_transactions 
                    WHERE user_id = $1 AND hold_id = $2 AND status = 'held'
                `, [userId, holdId]);

                if (holdResult.rows.length === 0) {
                    throw new Error('Hold not found or already processed');
                }

                const hold = holdResult.rows[0];
                const creditAmount = Math.abs(hold.amount);

                // Deduct credits from user
                const updateResult = await client.query(`
                    UPDATE users 
                    SET credits_remaining = credits_remaining - $1, updated_at = NOW()
                    WHERE id = $2 AND credits_remaining >= $1
                    RETURNING credits_remaining
                `, [creditAmount, userId]);

                if (updateResult.rows.length === 0) {
                    throw new Error('Insufficient credits or user not found');
                }

                const newBalance = parseFloat(updateResult.rows[0].credits_remaining);

                // Update hold to completed transaction
                await client.query(`
                    UPDATE credits_transactions 
                    SET 
                        status = 'completed',
                        completed_at = NOW(),
                        operation_result = $1,
                        processing_time_ms = $2
                    WHERE hold_id = $3
                `, [
                    JSON.stringify(operationResult),
                    operationResult.processingTimeMs || null,
                    holdId
                ]);

                await client.query('COMMIT');

                console.log(`✅ Operation completed: ${holdId}, Credits deducted: ${creditAmount}, New balance: ${newBalance}`);

                return {
                    success: true,
                    creditsDeducted: creditAmount,
                    newBalance: newBalance,
                    transactionId: hold.id
                };

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('❌ Error completing operation:', error);
            return {
                success: false,
                error: 'Failed to complete operation',
                details: error.message
            };
        }
    }

    // Release hold without deducting credits (for failed operations)
    async releaseHold(userId, holdId, reason = 'operation_failed') {
        try {
            const result = await pool.query(`
                UPDATE credits_transactions 
                SET 
                    status = 'released',
                    completed_at = NOW(),
                    operation_result = $1
                WHERE user_id = $2 AND hold_id = $3 AND status = 'held'
                RETURNING amount
            `, [
                JSON.stringify({ reason: reason }),
                userId,
                holdId
            ]);

            if (result.rows.length === 0) {
                console.warn(`⚠️ No hold found to release: ${holdId}`);
                return { success: true, message: 'No hold to release' };
            }

            const creditAmount = Math.abs(result.rows[0].amount);
            console.log(`✅ Hold released: ${holdId}, Credits released: ${creditAmount}`);

            return {
                success: true,
                creditsReleased: creditAmount,
                reason: reason
            };

        } catch (error) {
            console.error('❌ Error releasing hold:', error);
            return {
                success: false,
                error: 'Failed to release hold',
                details: error.message
            };
        }
    }

    // Get current user credits
    async getCurrentCredits(userId) {
        try {
            const result = await pool.query(
                'SELECT credits_remaining FROM users WHERE id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                throw new Error('User not found');
            }

            return {
                success: true,
                credits: parseFloat(result.rows[0].credits_remaining) || 0
            };

        } catch (error) {
            console.error('❌ Error getting current credits:', error);
            return {
                success: false,
                error: error.message,
                credits: 0
            };
        }
    }

    // Get user transaction history
    async getTransactionHistory(userId, limit = 50) {
        try {
            const result = await pool.query(`
                SELECT 
                    id, operation_type, amount, status, hold_id,
                    operation_data, operation_result, processing_time_ms,
                    created_at, completed_at
                FROM credits_transactions 
                WHERE user_id = $1 
                ORDER BY created_at DESC 
                LIMIT $2
            `, [userId, limit]);

            return {
                success: true,
                transactions: result.rows.map(row => ({
                    id: row.id,
                    operationType: row.operation_type,
                    amount: parseFloat(row.amount),
                    status: row.status,
                    holdId: row.hold_id,
                    operationData: row.operation_data,
                    operationResult: row.operation_result,
                    processingTimeMs: row.processing_time_ms,
                    createdAt: row.created_at,
                    completedAt: row.completed_at
                }))
            };

        } catch (error) {
            console.error('❌ Error getting transaction history:', error);
            return {
                success: false,
                error: error.message,
                transactions: []
            };
        }
    }

    // Clean up old holds (older than 1 hour)
    async cleanupOldHolds() {
        try {
            const result = await pool.query(`
                UPDATE credits_transactions 
                SET 
                    status = 'expired',
                    completed_at = NOW(),
                    operation_result = '{"reason": "hold_expired"}'
                WHERE status = 'held' 
                AND created_at < NOW() - INTERVAL '1 hour'
                RETURNING hold_id
            `);

            if (result.rows.length > 0) {
                console.log(`🧹 Cleaned up ${result.rows.length} expired holds`);
            }

            return {
                success: true,
                expiredHolds: result.rows.length
            };

        } catch (error) {
            console.error('❌ Error cleaning up old holds:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Generate unique hold ID
    generateHoldId() {
        return 'hold_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Validate operation type
    isValidOperationType(operationType) {
        return Object.keys(this.OPERATION_COSTS).includes(operationType);
    }

    // Get operation cost
    getOperationCost(operationType) {
        return this.OPERATION_COSTS[operationType] || 0;
    }
}

// Create singleton instance
const creditManager = new CreditManager();

// Helper functions for easy import
async function createCreditHold(userId, operationType, operationData = {}) {
    return await creditManager.createHold(userId, operationType, operationData);
}

async function completeOperation(userId, holdId, operationResult = {}) {
    return await creditManager.completeOperation(userId, holdId, operationResult);
}

async function releaseCreditHold(userId, holdId, reason = 'operation_failed') {
    return await creditManager.releaseHold(userId, holdId, reason);
}

async function checkUserCredits(userId, operationType) {
    return await creditManager.checkCredits(userId, operationType);
}

async function getCurrentCredits(userId) {
    return await creditManager.getCurrentCredits(userId);
}

async function getTransactionHistory(userId, limit = 50) {
    return await creditManager.getTransactionHistory(userId, limit);
}

async function cleanupExpiredHolds() {
    return await creditManager.cleanupOldHolds();
}

function getOperationCost(operationType) {
    return creditManager.getOperationCost(operationType);
}

function isValidOperationType(operationType) {
    return creditManager.isValidOperationType(operationType);
}

// Export everything
module.exports = {
    CreditManager,
    creditManager,
    createCreditHold,
    completeOperation,
    releaseCreditHold,
    checkUserCredits,
    getCurrentCredits,
    getTransactionHistory,
    cleanupExpiredHolds,
    getOperationCost,
    isValidOperationType
};

console.log('💳 Credit Management System loaded successfully!');
