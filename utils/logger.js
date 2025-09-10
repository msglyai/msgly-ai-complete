// utils/logger.js - Professional Environment-Based Logger
// Provides clean production logging with full development debugging

/**
 * Professional 3-Level Logging System
 * - ERROR/WARN: Always shown (Production + Development)
 * - INFO/DEBUG: Only shown in Development (NODE_ENV !== 'production')
 */

class Logger {
    constructor() {
        this.isDevelopment = process.env.NODE_ENV !== 'production';
        this.timestamp = () => new Date().toISOString();
    }

    /**
     * ERROR - Always shown (Critical issues)
     * Use for: Database errors, API failures, authentication errors
     */
    error(message, data = null) {
        const logMessage = `[ERROR] ${message}`;
        if (data) {
            console.error(logMessage, data);
        } else {
            console.error(logMessage);
        }
    }

    /**
     * WARN - Always shown (Important warnings)
     * Use for: Low credits, deprecated features, fallback scenarios
     */
    warn(message, data = null) {
        const logMessage = `[WARN] ${message}`;
        if (data) {
            console.warn(logMessage, data);
        } else {
            console.warn(logMessage);
        }
    }

    /**
     * INFO - Development only (General information)
     * Use for: User actions, API calls, status updates
     */
    info(message, data = null) {
        if (!this.isDevelopment) return;
        
        const logMessage = `[INFO] ${message}`;
        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    /**
     * DEBUG - Development only (Detailed debugging)
     * Use for: Function entry/exit, data validation, step-by-step tracking
     */
    debug(message, data = null) {
        if (!this.isDevelopment) return;
        
        const logMessage = `[DEBUG] ${message}`;
        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    /**
     * SUCCESS - Development only (Operation completion)
     * Use for: Successful operations, completed processes
     */
    success(message, data = null) {
        if (!this.isDevelopment) return;
        
        const logMessage = `[SUCCESS] ${message}`;
        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    /**
     * TRACE - Development only (Detailed step tracking)
     * Use for: Function parameters, variable states, execution flow
     */
    trace(message, data = null) {
        if (!this.isDevelopment) return;
        
        const logMessage = `[TRACE] ${message}`;
        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    /**
     * Custom category logger for specific prefixes
     * Use for: [TARGET], [CREDIT], [GPT], [RACE], etc.
     */
    custom(category, message, data = null) {
        if (!this.isDevelopment) return;
        
        const logMessage = `[${category.toUpperCase()}] ${message}`;
        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    /**
     * Performance logging - Development only
     * Use for: Timing operations, performance measurements
     */
    perf(operation, startTime, data = null) {
        if (!this.isDevelopment) return;
        
        const duration = Date.now() - startTime;
        const logMessage = `[PERF] ${operation} completed in ${duration}ms`;
        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    /**
     * Conditional logging - Development only
     * Use for: Logging only when specific conditions are met
     */
    conditional(condition, level, message, data = null) {
        if (!this.isDevelopment || !condition) return;
        
        this[level](message, data);
    }

    /**
     * Lazy logging - Development only
     * Use for: Expensive operations that should only run if logging is enabled
     */
    lazy(level, messageFunc, dataFunc = null) {
        if (!this.isDevelopment) return;
        
        const message = typeof messageFunc === 'function' ? messageFunc() : messageFunc;
        const data = dataFunc && typeof dataFunc === 'function' ? dataFunc() : dataFunc;
        
        this[level](message, data);
    }
}

// Create singleton instance
const logger = new Logger();

// Export both the instance and the class
module.exports = logger;
module.exports.Logger = Logger;

// Export individual methods for convenience
module.exports.error = logger.error.bind(logger);
module.exports.warn = logger.warn.bind(logger);
module.exports.info = logger.info.bind(logger);
module.exports.debug = logger.debug.bind(logger);
module.exports.success = logger.success.bind(logger);
module.exports.trace = logger.trace.bind(logger);
module.exports.custom = logger.custom.bind(logger);
module.exports.perf = logger.perf.bind(logger);
module.exports.conditional = logger.conditional.bind(logger);
module.exports.lazy = logger.lazy.bind(logger);
