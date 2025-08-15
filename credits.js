// credits.js - Credit Management System
// Complete credit hold, deduction, and transaction system

const { pool } = require('./database');

// Credit holds in memory (prevent double-spending during processing)
const creditHolds = new Map();

// ==================== CREDIT HOLD SYSTEM ====================

const createCreditHold = async (userId, amount, operation) => {
    try {
        console.log(`💳 Creating credit hold: ${amount} credits for user ${userId} (${operation})`);
        
        // Check if user has sufficient credits
        const userResult = await pool.query(
            'SELECT credits_remaining, package_type, billing_model FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const user = userResult.rows[0];
        const availableCredits = user.credits_remaining;
        
        // Check existing holds for this user
        const existingHold = creditHolds.get(userId);
        const heldCredits = existingHold ? existingHold.amount : 0;
        const effectiveAvailable = availableCredits - heldCredits;
        
        if (effectiveAvailable < amount) {
            console.log(`❌ Insufficient credits: User ${userId} has ${availableCredits}, holds ${heldCredits}, needs ${amount}`);
            return {
                success: false,
                error: 'INSUFFICIENT_CREDITS',
                availableCredits,
                heldCredits,
                requiredCredits: amount
            };
        }
        
        // Create hold
        const holdId = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        creditHolds.set(userId, {
            holdId,
            amount,
            operation,
            timestamp: new Date(),
            userId
        });
        
        console.log(`✅ Credit hold created: ${holdId} for ${amount} credits`);
        return {
            success: true,
            holdId,
            amount,
            remainingCredits: effectiveAvailable - amount
        };
        
    } catch (error) {
        console.error('❌ Error creating credit hold:', error);
        throw error;
    }
};

const releaseCreditHold = (userId) => {
    try {
        const hold = creditHolds.get(userId);
        if (hold) {
            creditHolds.delete(userId);
            console.log(`🔓 Credit hold released for user ${userId}: ${hold.amount} credits`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Error releasing credit hold:', error);
        return false;
    }
};

// ==================== CREDIT DEDUCTION SYSTEM ====================

const deductCredits = async (userId, amount, operation, metadata = {}) => {
    try {
        console.log(`💰 Deducting ${amount} credits from user ${userId} for ${operation}`);
        
        // Start transaction
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get current user credits
            const userResult = await client.query(
                'SELECT credits_remaining, package_type, billing_model FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const user = userResult.rows[0];
            const currentCredits = user.credits_remaining;
            
            if (currentCredits < amount) {
                await client.query('ROLLBACK');
                console.log(`❌ Insufficient credits for deduction: User ${userId} has ${currentCredits}, needs ${amount}`);
                return {
                    success: false,
                    error: 'INSUFFICIENT_CREDITS',
                    currentCredits,
                    requiredCredits: amount
                };
            }
            
            const newCreditBalance = currentCredits - amount;
            
            // Update user credits
            await client.query(
                'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newCreditBalance, userId]
            );
            
            // Log transaction
            await client.query(`
                INSERT INTO credits_transactions 
                (user_id, transaction_type, credits_change, description, metadata) 
                VALUES ($1, $2, $3, $4, $5)
            `, [
                userId,
                'deduction',
                -amount,
                `Credit deduction: ${operation}`,
                JSON.stringify({
                    operation,
                    oldBalance: currentCredits,
                    newBalance: newCreditBalance,
                    ...metadata
                })
            ]);
            
            await client.query('COMMIT');
            
            // Release hold if exists
            releaseCreditHold(userId);
            
            console.log(`✅ Credits deducted successfully: User ${userId} now has ${newCreditBalance} credits`);
            return {
                success: true,
                newBalance: newCreditBalance,
                deductedAmount: amount,
                operation
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Error deducting credits:', error);
        throw error;
    }
};

// ==================== CREDIT CHECKING ====================

const checkCredits = async (userId, requiredAmount) => {
    try {
        const userResult = await pool.query(
            'SELECT credits_remaining, package_type, billing_model FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return {
                success: false,
                error: 'USER_NOT_FOUND'
            };
        }
        
        const user = userResult.rows[0];
        const availableCredits = user.credits_remaining;
        
        // Check for existing holds
        const existingHold = creditHolds.get(userId);
        const heldCredits = existingHold ? existingHold.amount : 0;
        const effectiveAvailable = availableCredits - heldCredits;
        
        return {
            success: true,
            availableCredits,
            heldCredits,
            effectiveAvailable,
            hasEnoughCredits: effectiveAvailable >= requiredAmount,
            packageType: user.package_type,
            billingModel: user.billing_model
        };
        
    } catch (error) {
        console.error('❌ Error checking credits:', error);
        throw error;
    }
};

// ==================== CREDIT BALANCE ====================

const getCreditBalance = async (userId) => {
    try {
        const userResult = await pool.query(
            'SELECT credits_remaining, package_type, billing_model FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return null;
        }
        
        const user = userResult.rows[0];
        const existingHold = creditHolds.get(userId);
        
        return {
            total: user.credits_remaining,
            held: existingHold ? existingHold.amount : 0,
            available: user.credits_remaining - (existingHold ? existingHold.amount : 0),
            packageType: user.package_type,
            billingModel: user.billing_model
        };
        
    } catch (error) {
        console.error('❌ Error getting credit balance:', error);
        throw error;
    }
};

// ==================== CREDIT HISTORY ====================

const getCreditHistory = async (userId, limit = 20) => {
    try {
        const result = await pool.query(`
            SELECT 
                transaction_type,
                credits_change,
                description,
                metadata,
                created_at
            FROM credits_transactions 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT $2
        `, [userId, limit]);
        
        return result.rows.map(row => ({
            type: row.transaction_type,
            amount: row.credits_change,
            description: row.description,
            metadata: row.metadata,
            timestamp: row.created_at
        }));
        
    } catch (error) {
        console.error('❌ Error getting credit history:', error);
        throw error;
    }
};

// ==================== FREE PLAN CREDIT RESET ====================

const resetFreeCredits = async (userId) => {
    try {
        console.log(`🔄 Checking free credit reset for user ${userId}`);
        
        const userResult = await pool.query(
            'SELECT credits_remaining, package_type, billing_model FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0 || userResult.rows[0].package_type !== 'free') {
            return { success: false, reason: 'Not a free user' };
        }
        
        const user = userResult.rows[0];
        const currentCredits = user.credits_remaining;
        
        // Free users: only reset if below 7 credits (max 7 cap)
        if (currentCredits >= 7) {
            console.log(`✅ Free user ${userId} already has ${currentCredits} credits (7+ cap)`);
            return { 
                success: true, 
                reason: 'Already at maximum free credits',
                currentCredits,
                newCredits: currentCredits
            };
        }
        
        // Reset to 7 credits
        await pool.query(
            'UPDATE users SET credits_remaining = 7, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [userId]
        );
        
        // Log transaction
        await pool.query(`
            INSERT INTO credits_transactions 
            (user_id, transaction_type, credits_change, description, metadata) 
            VALUES ($1, $2, $3, $4, $5)
        `, [
            userId,
            'reset',
            7 - currentCredits,
            'Monthly free credit reset',
            JSON.stringify({
                operation: 'free_reset',
                oldBalance: currentCredits,
                newBalance: 7,
                resetType: 'monthly'
            })
        ]);
        
        console.log(`✅ Free credits reset: User ${userId} from ${currentCredits} to 7 credits`);
        return {
            success: true,
            reason: 'Credits reset to 7',
            currentCredits,
            newCredits: 7,
            added: 7 - currentCredits
        };
        
    } catch (error) {
        console.error('❌ Error resetting free credits:', error);
        throw error;
    }
};

// ==================== CLEANUP ====================

// Cleanup expired holds (run periodically)
const cleanupExpiredHolds = () => {
    const now = new Date();
    const expiryTime = 60 * 60 * 1000; // 1 hour
    
    for (const [userId, hold] of creditHolds.entries()) {
        if (now - hold.timestamp > expiryTime) {
            creditHolds.delete(userId);
            console.log(`🧹 Cleaned up expired hold for user ${userId}: ${hold.amount} credits`);
        }
    }
};

// Run cleanup every 30 minutes
setInterval(cleanupExpiredHolds, 30 * 60 * 1000);

// ==================== EXPORTS ====================

module.exports = {
    // Credit holds
    createCreditHold,
    releaseCreditHold,
    
    // Credit operations
    deductCredits,
    checkCredits,
    getCreditBalance,
    getCreditHistory,
    
    // Free plan management
    resetFreeCredits,
    
    // Cleanup
    cleanupExpiredHolds
};
