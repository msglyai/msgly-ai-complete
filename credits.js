// credits.js - Enhanced Credit Management System with Dual Credit Support
// Handles renewable + pay-as-you-go credits, holds, deductions, transactions, and validation
// FIXED: All SQL queries now handle INTEGER + DECIMAL operations properly
// ADDED: cold_email_generation operation type
// FIXED: Added file_analysis operation type for file upload functionality

const { pool } = require('./utils/database');

class CreditManager {
    constructor() {
        this.OPERATION_COSTS = {
            'target_analysis': 0.25,
            'file_analysis': 0.25,        // FIXED: Added file_analysis operation type
            'message_generation': 1.0,
            'connection_generation': 1.0,
            'cold_email_generation': 1.0  // ADDED: Cold email generation support
        };
    }

    // ENHANCED: Check if user has sufficient credits (dual system) - FIXED
    async checkCredits(userId, operationType) {
        try {
            const result = await pool.query(`
                SELECT 
                    COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                    COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits,
                    (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                FROM users 
                WHERE id = $1
            `, [userId]);

            if (result.rows.length === 0) {
                throw new Error('User not found');
            }

            const { renewable_credits, payasyougo_credits, total_credits } = result.rows[0];
            const currentCredits = parseFloat(total_credits) || 0;
            const requiredCredits = this.OPERATION_COSTS[operationType] || 0;

            console.log(`Credit check for user ${userId}:`);
            console.log(`   - Renewable: ${renewable_credits || 0}`);
            console.log(`   - Pay-as-you-go: ${payasyougo_credits || 0}`);
            console.log(`   - Total: ${currentCredits}`);
            console.log(`   - Required: ${requiredCredits}`);
            console.log(`   - Has enough: ${currentCredits >= requiredCredits}`);

            return {
                success: true,
                hasCredits: currentCredits >= requiredCredits,
                currentCredits: currentCredits,
                renewableCredits: parseFloat(renewable_credits) || 0,
                payasyougoCredits: parseFloat(payasyougo_credits) || 0,
                requiredCredits: requiredCredits,
                remaining: currentCredits - requiredCredits
            };
        } catch (error) {
            console.error('Error checking credits:', error);
            return {
                success: false,
                error: error.message,
                hasCredits: false
            };
        }
    }

    // ENHANCED: Create credit hold before operation (dual system aware)
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
                    renewableCredits: creditCheck.renewableCredits,
                    payasyougoCredits: creditCheck.payasyougoCredits,
                    requiredCredits: creditCheck.requiredCredits
                };
            }

            const holdId = this.generateHoldId();
            const requiredCredits = this.OPERATION_COSTS[operationType];

            // Create hold record in credits_transactions with dual credit info
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
                JSON.stringify({
                    ...operationData,
                    creditBreakdown: {
                        renewable: creditCheck.renewableCredits,
                        payasyougo: creditCheck.payasyougoCredits,
                        total: creditCheck.currentCredits
                    }
                })
            ]);

            console.log(`Credit hold created: ${holdId} for ${requiredCredits} credits`);
            console.log(`   - User has ${creditCheck.currentCredits} total credits`);
            console.log(`   - Renewable: ${creditCheck.renewableCredits}, Pay-as-you-go: ${creditCheck.payasyougoCredits}`);

            return {
                success: true,
                holdId: holdId,
                amountHeld: requiredCredits,
                currentCredits: creditCheck.currentCredits,
                renewableCredits: creditCheck.renewableCredits,
                payasyougoCredits: creditCheck.payasyougoCredits,
                remainingAfterHold: creditCheck.remaining
            };

        } catch (error) {
            console.error('Error creating credit hold:', error);
            return {
                success: false,
                error: 'Failed to create credit hold',
                details: error.message
            };
        }
    }

    // ENHANCED: Complete operation and deduct credits (dual system) - FIXED
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

                // FIXED: Add FOR UPDATE lock to prevent race conditions
                const beforeResult = await client.query(`
                    SELECT 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits,
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits,
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                    FROM users WHERE id = $1 FOR UPDATE
                `, [userId]);

                if (beforeResult.rows.length === 0) {
                    throw new Error('User not found');
                }

                const beforeCredits = beforeResult.rows[0];
                const totalAvailable = parseFloat(beforeCredits.total_credits) || 0;

                // FIXED: Check credits before attempting update
                if (totalAvailable < creditAmount) {
                    throw new Error(`Insufficient credits: need ${creditAmount}, have ${totalAvailable}`);
                }

                console.log(`Before deduction - Renewable: ${beforeCredits.renewable_credits}, Pay-as-you-go: ${beforeCredits.payasyougo_credits}`);

                // Use dual credit spending logic (pay-as-you-go first, then renewable)
                let newPayasyougo = parseFloat(beforeCredits.payasyougo_credits) || 0;
                let newRenewable = parseFloat(beforeCredits.renewable_credits) || 0;
                
                // Spend pay-as-you-go first
                if (newPayasyougo >= creditAmount) {
                    newPayasyougo = newPayasyougo - creditAmount;
                } else {
                    // Spend all pay-as-you-go, then renewable
                    const remaining = creditAmount - newPayasyougo;
                    newPayasyougo = 0;
                    newRenewable = newRenewable - remaining;
                }

                // Ensure no negative credits
                newPayasyougo = Math.max(0, newPayasyougo);
                newRenewable = Math.max(0, newRenewable);

                // FIXED: Simplified UPDATE without complex WHERE condition
                const updateResult = await client.query(`
                    UPDATE users 
                    SET 
                        renewable_credits = $1::DECIMAL(10,2),
                        payasyougo_credits = $2::DECIMAL(10,2),
                        credits_remaining = $1::DECIMAL(10,2) + $2::DECIMAL(10,2),
                        updated_at = NOW()
                    WHERE id = $3
                    RETURNING 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits, 
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                `, [newRenewable, newPayasyougo, userId]);

                // FIXED: This should never happen now since we locked the user row
                if (updateResult.rows.length === 0) {
                    throw new Error('Failed to update user credits - user may have been deleted');
                }

                const afterCredits = updateResult.rows[0];
                const newBalance = parseFloat(afterCredits.total_credits);

                console.log(`After deduction - Renewable: ${afterCredits.renewable_credits}, Pay-as-you-go: ${afterCredits.payasyougo_credits}, Total: ${newBalance}`);

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
                    JSON.stringify({
                        ...operationResult,
                        creditBreakdownBefore: {
                            renewable: beforeCredits.renewable_credits,
                            payasyougo: beforeCredits.payasyougo_credits
                        },
                        creditBreakdownAfter: {
                            renewable: afterCredits.renewable_credits,
                            payasyougo: afterCredits.payasyougo_credits,
                            total: newBalance
                        }
                    }),
                    operationResult.processingTimeMs || null,
                    holdId
                ]);

                await client.query('COMMIT');

                console.log(`Operation completed: ${holdId}, Credits deducted: ${creditAmount}, New balance: ${newBalance}`);

                return {
                    success: true,
                    creditsDeducted: creditAmount,
                    newBalance: newBalance,
                    renewableCredits: parseFloat(afterCredits.renewable_credits),
                    payasyougoCredits: parseFloat(afterCredits.payasyougo_credits),
                    transactionId: hold.id
                };

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('Error completing operation:', error);
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
                console.warn(`No hold found to release: ${holdId}`);
                return { success: true, message: 'No hold to release' };
            }

            const creditAmount = Math.abs(result.rows[0].amount);
            console.log(`Hold released: ${holdId}, Credits released: ${creditAmount}`);

            return {
                success: true,
                creditsReleased: creditAmount,
                reason: reason
            };

        } catch (error) {
            console.error('Error releasing hold:', error);
            return {
                success: false,
                error: 'Failed to release hold',
                details: error.message
            };
        }
    }

    // ENHANCED: Get current user credits (dual system) - FIXED
    async getCurrentCredits(userId) {
        try {
            const result = await pool.query(`
                SELECT 
                    COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits,
                    COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits,
                    (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits,
                    plan_code,
                    subscription_starts_at,
                    next_billing_date
                FROM users 
                WHERE id = $1
            `, [userId]);

            if (result.rows.length === 0) {
                throw new Error('User not found');
            }

            const user = result.rows[0];

            return {
                success: true,
                credits: parseFloat(user.total_credits) || 0,
                renewableCredits: parseFloat(user.renewable_credits) || 0,
                payasyougoCredits: parseFloat(user.payasyougo_credits) || 0,
                planCode: user.plan_code || 'free',
                subscriptionStartsAt: user.subscription_starts_at,
                nextBillingDate: user.next_billing_date
            };

        } catch (error) {
            console.error('Error getting current credits:', error);
            return {
                success: false,
                error: error.message,
                credits: 0,
                renewableCredits: 0,
                payasyougoCredits: 0
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
            console.error('Error getting transaction history:', error);
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
                console.log(`Cleaned up ${result.rows.length} expired holds`);
            }

            return {
                success: true,
                expiredHolds: result.rows.length
            };

        } catch (error) {
            console.error('Error cleaning up old holds:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // NEW: Add pay-as-you-go credits (for purchases) - FIXED
    async addPayAsYouGoCredits(userId, amount, purchaseData = {}) {
        try {
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');

                // Add credits to user - FIXED: Use explicit casting
                const result = await client.query(`
                    UPDATE users 
                    SET 
                        payasyougo_credits = COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) + $1::DECIMAL(10,2),
                        credits_remaining = COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) + $1::DECIMAL(10,2),
                        updated_at = NOW()
                    WHERE id = $2
                    RETURNING 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits, 
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                `, [amount, userId]);

                if (result.rows.length === 0) {
                    throw new Error('User not found');
                }

                const credits = result.rows[0];

                // Record the credit addition transaction
                await client.query(`
                    INSERT INTO credits_transactions (
                        user_id, operation_type, amount, status,
                        operation_data, operation_result, created_at, completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                `, [
                    userId,
                    'credit_purchase',
                    amount,
                    'completed',
                    JSON.stringify(purchaseData),
                    JSON.stringify({
                        creditType: 'payasyougo',
                        amountAdded: amount,
                        newBalance: parseFloat(credits.total_credits)
                    })
                ]);

                await client.query('COMMIT');

                console.log(`Added ${amount} pay-as-you-go credits to user ${userId}`);
                console.log(`   - New total: ${credits.total_credits}`);

                return {
                    success: true,
                    amountAdded: amount,
                    newBalance: parseFloat(credits.total_credits),
                    renewableCredits: parseFloat(credits.renewable_credits),
                    payasyougoCredits: parseFloat(credits.payasyougo_credits)
                };

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('Error adding pay-as-you-go credits:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // NEW: Reset renewable credits (monthly billing cycle) - FIXED
    async resetRenewableCredits(userId) {
        try {
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');

                // Get user's plan renewable credits
                const planResult = await client.query(`
                    SELECT COALESCE(p.renewable_credits, 0)::DECIMAL(10,2) as renewable_credits
                    FROM users u
                    JOIN plans p ON u.plan_code = p.plan_code
                    WHERE u.id = $1
                `, [userId]);

                if (planResult.rows.length === 0) {
                    throw new Error('User or plan not found');
                }

                const planRenewableCredits = parseFloat(planResult.rows[0].renewable_credits);

                // Reset renewable credits to plan amount, keep pay-as-you-go unchanged - FIXED
                const result = await client.query(`
                    UPDATE users 
                    SET 
                        renewable_credits = $1::DECIMAL(10,2),
                        credits_remaining = $1::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2),
                        next_billing_date = next_billing_date + INTERVAL '1 month',
                        updated_at = NOW()
                    WHERE id = $2
                    RETURNING 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits, 
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                `, [planRenewableCredits, userId]);

                const credits = result.rows[0];

                // Record the renewal transaction
                await client.query(`
                    INSERT INTO credits_transactions (
                        user_id, operation_type, amount, status,
                        operation_data, operation_result, created_at, completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                `, [
                    userId,
                    'monthly_renewal',
                    planRenewableCredits,
                    'completed',
                    JSON.stringify({ planRenewableCredits }),
                    JSON.stringify({
                        creditType: 'renewable',
                        resetTo: planRenewableCredits,
                        newBalance: parseFloat(credits.total_credits),
                        payasyougoCreditsKept: parseFloat(credits.payasyougo_credits)
                    })
                ]);

                await client.query('COMMIT');

                console.log(`Reset renewable credits for user ${userId} to ${planRenewableCredits}`);
                console.log(`   - Pay-as-you-go credits kept: ${credits.payasyougo_credits}`);
                console.log(`   - New total: ${credits.total_credits}`);

                return {
                    success: true,
                    renewableCredits: parseFloat(credits.renewable_credits),
                    payasyougoCredits: parseFloat(credits.payasyougo_credits),
                    totalCredits: parseFloat(credits.total_credits)
                };

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('Error resetting renewable credits:', error);
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

// ENHANCED: Helper functions for easy import (dual credit system aware)
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

// NEW: Helper functions for dual credit system
async function addPayAsYouGoCredits(userId, amount, purchaseData = {}) {
    return await creditManager.addPayAsYouGoCredits(userId, amount, purchaseData);
}

async function resetRenewableCredits(userId) {
    return await creditManager.resetRenewableCredits(userId);
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
    // NEW: Dual credit system functions
    addPayAsYouGoCredits,
    resetRenewableCredits,
    getOperationCost,
    isValidOperationType
};

console.log('Enhanced Credit Management System with Dual Credits loaded successfully!');// credits.js - Enhanced Credit Management System with Dual Credit Support
// Handles renewable + pay-as-you-go credits, holds, deductions, transactions, and validation
// FIXED: All SQL queries now handle INTEGER + DECIMAL operations properly
// ADDED: cold_email_generation operation type
// FIXED: Added file_analysis operation type for file upload functionality

const { pool } = require('./utils/database');

class CreditManager {
    constructor() {
        this.OPERATION_COSTS = {
            'target_analysis': 0.25,
            'file_analysis': 0.25,        // FIXED: Added file_analysis operation type
            'message_generation': 1.0,
            'connection_generation': 1.0,
            'cold_email_generation': 1.0  // ADDED: Cold email generation support
        };
    }

    // ENHANCED: Check if user has sufficient credits (dual system) - FIXED
    async checkCredits(userId, operationType) {
        try {
            const result = await pool.query(`
                SELECT 
                    COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                    COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits,
                    (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                FROM users 
                WHERE id = $1
            `, [userId]);

            if (result.rows.length === 0) {
                throw new Error('User not found');
            }

            const { renewable_credits, payasyougo_credits, total_credits } = result.rows[0];
            const currentCredits = parseFloat(total_credits) || 0;
            const requiredCredits = this.OPERATION_COSTS[operationType] || 0;

            console.log(`Credit check for user ${userId}:`);
            console.log(`   - Renewable: ${renewable_credits || 0}`);
            console.log(`   - Pay-as-you-go: ${payasyougo_credits || 0}`);
            console.log(`   - Total: ${currentCredits}`);
            console.log(`   - Required: ${requiredCredits}`);
            console.log(`   - Has enough: ${currentCredits >= requiredCredits}`);

            return {
                success: true,
                hasCredits: currentCredits >= requiredCredits,
                currentCredits: currentCredits,
                renewableCredits: parseFloat(renewable_credits) || 0,
                payasyougoCredits: parseFloat(payasyougo_credits) || 0,
                requiredCredits: requiredCredits,
                remaining: currentCredits - requiredCredits
            };
        } catch (error) {
            console.error('Error checking credits:', error);
            return {
                success: false,
                error: error.message,
                hasCredits: false
            };
        }
    }

    // ENHANCED: Create credit hold before operation (dual system aware)
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
                    renewableCredits: creditCheck.renewableCredits,
                    payasyougoCredits: creditCheck.payasyougoCredits,
                    requiredCredits: creditCheck.requiredCredits
                };
            }

            const holdId = this.generateHoldId();
            const requiredCredits = this.OPERATION_COSTS[operationType];

            // Create hold record in credits_transactions with dual credit info
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
                JSON.stringify({
                    ...operationData,
                    creditBreakdown: {
                        renewable: creditCheck.renewableCredits,
                        payasyougo: creditCheck.payasyougoCredits,
                        total: creditCheck.currentCredits
                    }
                })
            ]);

            console.log(`Credit hold created: ${holdId} for ${requiredCredits} credits`);
            console.log(`   - User has ${creditCheck.currentCredits} total credits`);
            console.log(`   - Renewable: ${creditCheck.renewableCredits}, Pay-as-you-go: ${creditCheck.payasyougoCredits}`);

            return {
                success: true,
                holdId: holdId,
                amountHeld: requiredCredits,
                currentCredits: creditCheck.currentCredits,
                renewableCredits: creditCheck.renewableCredits,
                payasyougoCredits: creditCheck.payasyougoCredits,
                remainingAfterHold: creditCheck.remaining
            };

        } catch (error) {
            console.error('Error creating credit hold:', error);
            return {
                success: false,
                error: 'Failed to create credit hold',
                details: error.message
            };
        }
    }

    // ENHANCED: Complete operation and deduct credits (dual system) - FIXED
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

                // FIXED: Add FOR UPDATE lock to prevent race conditions
                const beforeResult = await client.query(`
                    SELECT 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits,
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits,
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                    FROM users WHERE id = $1 FOR UPDATE
                `, [userId]);

                if (beforeResult.rows.length === 0) {
                    throw new Error('User not found');
                }

                const beforeCredits = beforeResult.rows[0];
                const totalAvailable = parseFloat(beforeCredits.total_credits) || 0;

                // FIXED: Check credits before attempting update
                if (totalAvailable < creditAmount) {
                    throw new Error(`Insufficient credits: need ${creditAmount}, have ${totalAvailable}`);
                }

                console.log(`Before deduction - Renewable: ${beforeCredits.renewable_credits}, Pay-as-you-go: ${beforeCredits.payasyougo_credits}`);

                // Use dual credit spending logic (pay-as-you-go first, then renewable)
                let newPayasyougo = parseFloat(beforeCredits.payasyougo_credits) || 0;
                let newRenewable = parseFloat(beforeCredits.renewable_credits) || 0;
                
                // Spend pay-as-you-go first
                if (newPayasyougo >= creditAmount) {
                    newPayasyougo = newPayasyougo - creditAmount;
                } else {
                    // Spend all pay-as-you-go, then renewable
                    const remaining = creditAmount - newPayasyougo;
                    newPayasyougo = 0;
                    newRenewable = newRenewable - remaining;
                }

                // Ensure no negative credits
                newPayasyougo = Math.max(0, newPayasyougo);
                newRenewable = Math.max(0, newRenewable);

                // FIXED: Simplified UPDATE without complex WHERE condition
                const updateResult = await client.query(`
                    UPDATE users 
                    SET 
                        renewable_credits = $1::DECIMAL(10,2),
                        payasyougo_credits = $2::DECIMAL(10,2),
                        credits_remaining = $1::DECIMAL(10,2) + $2::DECIMAL(10,2),
                        updated_at = NOW()
                    WHERE id = $3
                    RETURNING 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits, 
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                `, [newRenewable, newPayasyougo, userId]);

                // FIXED: This should never happen now since we locked the user row
                if (updateResult.rows.length === 0) {
                    throw new Error('Failed to update user credits - user may have been deleted');
                }

                const afterCredits = updateResult.rows[0];
                const newBalance = parseFloat(afterCredits.total_credits);

                console.log(`After deduction - Renewable: ${afterCredits.renewable_credits}, Pay-as-you-go: ${afterCredits.payasyougo_credits}, Total: ${newBalance}`);

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
                    JSON.stringify({
                        ...operationResult,
                        creditBreakdownBefore: {
                            renewable: beforeCredits.renewable_credits,
                            payasyougo: beforeCredits.payasyougo_credits
                        },
                        creditBreakdownAfter: {
                            renewable: afterCredits.renewable_credits,
                            payasyougo: afterCredits.payasyougo_credits,
                            total: newBalance
                        }
                    }),
                    operationResult.processingTimeMs || null,
                    holdId
                ]);

                await client.query('COMMIT');

                console.log(`Operation completed: ${holdId}, Credits deducted: ${creditAmount}, New balance: ${newBalance}`);

                return {
                    success: true,
                    creditsDeducted: creditAmount,
                    newBalance: newBalance,
                    renewableCredits: parseFloat(afterCredits.renewable_credits),
                    payasyougoCredits: parseFloat(afterCredits.payasyougo_credits),
                    transactionId: hold.id
                };

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('Error completing operation:', error);
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
                console.warn(`No hold found to release: ${holdId}`);
                return { success: true, message: 'No hold to release' };
            }

            const creditAmount = Math.abs(result.rows[0].amount);
            console.log(`Hold released: ${holdId}, Credits released: ${creditAmount}`);

            return {
                success: true,
                creditsReleased: creditAmount,
                reason: reason
            };

        } catch (error) {
            console.error('Error releasing hold:', error);
            return {
                success: false,
                error: 'Failed to release hold',
                details: error.message
            };
        }
    }

    // ENHANCED: Get current user credits (dual system) - FIXED
    async getCurrentCredits(userId) {
        try {
            const result = await pool.query(`
                SELECT 
                    COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits,
                    COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits,
                    (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits,
                    plan_code,
                    subscription_starts_at,
                    next_billing_date
                FROM users 
                WHERE id = $1
            `, [userId]);

            if (result.rows.length === 0) {
                throw new Error('User not found');
            }

            const user = result.rows[0];

            return {
                success: true,
                credits: parseFloat(user.total_credits) || 0,
                renewableCredits: parseFloat(user.renewable_credits) || 0,
                payasyougoCredits: parseFloat(user.payasyougo_credits) || 0,
                planCode: user.plan_code || 'free',
                subscriptionStartsAt: user.subscription_starts_at,
                nextBillingDate: user.next_billing_date
            };

        } catch (error) {
            console.error('Error getting current credits:', error);
            return {
                success: false,
                error: error.message,
                credits: 0,
                renewableCredits: 0,
                payasyougoCredits: 0
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
            console.error('Error getting transaction history:', error);
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
                console.log(`Cleaned up ${result.rows.length} expired holds`);
            }

            return {
                success: true,
                expiredHolds: result.rows.length
            };

        } catch (error) {
            console.error('Error cleaning up old holds:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // NEW: Add pay-as-you-go credits (for purchases) - FIXED
    async addPayAsYouGoCredits(userId, amount, purchaseData = {}) {
        try {
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');

                // Add credits to user - FIXED: Use explicit casting
                const result = await client.query(`
                    UPDATE users 
                    SET 
                        payasyougo_credits = COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) + $1::DECIMAL(10,2),
                        credits_remaining = COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) + $1::DECIMAL(10,2),
                        updated_at = NOW()
                    WHERE id = $2
                    RETURNING 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits, 
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                `, [amount, userId]);

                if (result.rows.length === 0) {
                    throw new Error('User not found');
                }

                const credits = result.rows[0];

                // Record the credit addition transaction
                await client.query(`
                    INSERT INTO credits_transactions (
                        user_id, operation_type, amount, status,
                        operation_data, operation_result, created_at, completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                `, [
                    userId,
                    'credit_purchase',
                    amount,
                    'completed',
                    JSON.stringify(purchaseData),
                    JSON.stringify({
                        creditType: 'payasyougo',
                        amountAdded: amount,
                        newBalance: parseFloat(credits.total_credits)
                    })
                ]);

                await client.query('COMMIT');

                console.log(`Added ${amount} pay-as-you-go credits to user ${userId}`);
                console.log(`   - New total: ${credits.total_credits}`);

                return {
                    success: true,
                    amountAdded: amount,
                    newBalance: parseFloat(credits.total_credits),
                    renewableCredits: parseFloat(credits.renewable_credits),
                    payasyougoCredits: parseFloat(credits.payasyougo_credits)
                };

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('Error adding pay-as-you-go credits:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // NEW: Reset renewable credits (monthly billing cycle) - FIXED
    async resetRenewableCredits(userId) {
        try {
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');

                // Get user's plan renewable credits
                const planResult = await client.query(`
                    SELECT COALESCE(p.renewable_credits, 0)::DECIMAL(10,2) as renewable_credits
                    FROM users u
                    JOIN plans p ON u.plan_code = p.plan_code
                    WHERE u.id = $1
                `, [userId]);

                if (planResult.rows.length === 0) {
                    throw new Error('User or plan not found');
                }

                const planRenewableCredits = parseFloat(planResult.rows[0].renewable_credits);

                // Reset renewable credits to plan amount, keep pay-as-you-go unchanged - FIXED
                const result = await client.query(`
                    UPDATE users 
                    SET 
                        renewable_credits = $1::DECIMAL(10,2),
                        credits_remaining = $1::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2),
                        next_billing_date = next_billing_date + INTERVAL '1 month',
                        updated_at = NOW()
                    WHERE id = $2
                    RETURNING 
                        COALESCE(renewable_credits, 0)::DECIMAL(10,2) as renewable_credits, 
                        COALESCE(payasyougo_credits, 0)::DECIMAL(10,2) as payasyougo_credits, 
                        (COALESCE(renewable_credits, 0)::DECIMAL(10,2) + COALESCE(payasyougo_credits, 0)::DECIMAL(10,2)) as total_credits
                `, [planRenewableCredits, userId]);

                const credits = result.rows[0];

                // Record the renewal transaction
                await client.query(`
                    INSERT INTO credits_transactions (
                        user_id, operation_type, amount, status,
                        operation_data, operation_result, created_at, completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                `, [
                    userId,
                    'monthly_renewal',
                    planRenewableCredits,
                    'completed',
                    JSON.stringify({ planRenewableCredits }),
                    JSON.stringify({
                        creditType: 'renewable',
                        resetTo: planRenewableCredits,
                        newBalance: parseFloat(credits.total_credits),
                        payasyougoCreditsKept: parseFloat(credits.payasyougo_credits)
                    })
                ]);

                await client.query('COMMIT');

                console.log(`Reset renewable credits for user ${userId} to ${planRenewableCredits}`);
                console.log(`   - Pay-as-you-go credits kept: ${credits.payasyougo_credits}`);
                console.log(`   - New total: ${credits.total_credits}`);

                return {
                    success: true,
                    renewableCredits: parseFloat(credits.renewable_credits),
                    payasyougoCredits: parseFloat(credits.payasyougo_credits),
                    totalCredits: parseFloat(credits.total_credits)
                };

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('Error resetting renewable credits:', error);
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

// ENHANCED: Helper functions for easy import (dual credit system aware)
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

// NEW: Helper functions for dual credit system
async function addPayAsYouGoCredits(userId, amount, purchaseData = {}) {
    return await creditManager.addPayAsYouGoCredits(userId, amount, purchaseData);
}

async function resetRenewableCredits(userId) {
    return await creditManager.resetRenewableCredits(userId);
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
    // NEW: Dual credit system functions
    addPayAsYouGoCredits,
    resetRenewableCredits,
    getOperationCost,
    isValidOperationType
};

console.log('Enhanced Credit Management System with Dual Credits loaded successfully!');
