// messages-email-finder.js - Frontend Email Finder Integration
// Adds "Ask Email" and "Verification" columns to Messages table

(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        API_ENDPOINT: '/api/ask-email',
        COST_PER_LOOKUP: 2,
        TIMEOUT: 15000
    };
    
    // State tracking
    let isProcessing = new Set();
    
    // ==================== INITIALIZATION ====================
    
    function initEmailFinder() {
        console.log('[EMAIL_FINDER] Initializing...');
        
        // Wait for messages to be loaded
        if (typeof window.messagesData === 'undefined' || !Array.isArray(window.messagesData)) {
            setTimeout(initEmailFinder, 500);
            return;
        }
        
        // Add styles first
        addStyles();
        
        // Add columns to table
        addEmailFinderColumns();
        
        // Add to existing rows
        addEmailFinderToRows();
        
        console.log('[EMAIL_FINDER] Initialized successfully');
    }
    
    // ==================== UI CONSTRUCTION ====================
    
    function addEmailFinderColumns() {
        const headerRow = document.querySelector('.messages-table thead tr');
        if (!headerRow) return;
        
        // Find Actions column to insert before
        const actionsHeader = headerRow.querySelector('.col-actions');
        if (!actionsHeader) return;
        
        // Ask Email column
        const askEmailHeader = document.createElement('th');
        askEmailHeader.className = 'col-ask-email';
        askEmailHeader.innerHTML = '<span title="Find & verify email">Ask Email</span>';
        headerRow.insertBefore(askEmailHeader, actionsHeader);
        
        // Verification column  
        const verificationHeader = document.createElement('th');
        verificationHeader.className = 'col-verification';
        verificationHeader.innerHTML = '<span title="Email verification status">Verification</span>';
        headerRow.insertBefore(verificationHeader, actionsHeader);
        
        // Adjust existing column widths
        const messageCol = headerRow.querySelector('.col-message');
        if (messageCol) messageCol.style.width = '22%';
        
        const contextCol = headerRow.querySelector('.col-context');
        if (contextCol) contextCol.style.width = '16%';
        
        const targetCol = headerRow.querySelector('.col-target');
        if (targetCol) targetCol.style.width = '14%';
    }
    
    function addEmailFinderToRows() {
        const tableRows = document.querySelectorAll('.messages-table tbody tr');
        
        tableRows.forEach((row, index) => {
            const message = window.messagesData[index];
            if (!message || row.querySelector('.col-ask-email')) return;
            
            const actionsCell = row.querySelector('.col-actions');
            if (!actionsCell) return;
            
            // Ask Email column
            const askEmailCell = document.createElement('td');
            askEmailCell.className = 'col-ask-email';
            askEmailCell.innerHTML = createAskEmailHTML(message);
            row.insertBefore(askEmailCell, actionsCell);
            
            // Verification column
            const verificationCell = document.createElement('td'); 
            verificationCell.className = 'col-verification';
            verificationCell.innerHTML = createVerificationHTML(message);
            row.insertBefore(verificationCell, actionsCell);
        });
    }
    
    function createAskEmailHTML(message) {
        const emailFinder = message.data_json?.email_finder;
        const isVerified = emailFinder && emailFinder.status === 'verified';
        const isProcessingNow = isProcessing.has(message.id);
        
        if (isVerified) {
            return `
                <button class="ask-email-btn verified" disabled>
                    <i class="fas fa-check"></i>
                    <span>Verified</span>
                </button>
            `;
        }
        
        if (isProcessingNow) {
            return `
                <button class="ask-email-btn processing" disabled>
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>Processing...</span>
                </button>
            `;
        }
        
        return `
            <button class="ask-email-btn" onclick="window.askEmail(${message.id})">
                <i class="fas fa-envelope"></i>
                <span>Ask Email</span>
            </button>
        `;
    }
    
    function createVerificationHTML(message) {
        const emailFinder = message.data_json?.email_finder;
        
        if (!emailFinder) {
            return `
                <div class="verification-status no-attempt">
                    <span class="status-indicator">—</span>
                    <span class="status-text">No attempt</span>
                </div>
            `;
        }
        
        switch (emailFinder.status) {
            case 'verified':
                return `
                    <div class="verification-status verified">
                        <span class="status-indicator">✅</span>
                        <div class="status-content">
                            <span class="status-email">${emailFinder.email}</span>
                            <span class="status-subtitle">Verified by Snov</span>
                        </div>
                    </div>
                `;
                
            case 'not_found':
                return `
                    <div class="verification-status not-found">
                        <span class="status-indicator">❌</span>
                        <span class="status-text">Not found</span>
                    </div>
                `;
                
            default:
                return `
                    <div class="verification-status error">
                        <span class="status-indicator">⚠️</span>
                        <span class="status-text">Lookup failed</span>
                    </div>
                `;
        }
    }
    
    // ==================== CORE FUNCTIONALITY ====================
    
    async function askEmail(messageId) {
        try {
            console.log(`[EMAIL_FINDER] Starting lookup for message ${messageId}`);
            
            if (isProcessing.has(messageId)) return;
            
            // Get JWT token
            const token = localStorage.getItem('authToken');
            if (!token) {
                showToast('Please log in first', 'error');
                return;
            }
            
            // Mark as processing
            isProcessing.add(messageId);
            updateRowUI(messageId, 'processing');
            
            // Make API call to check plan and get confirmation
            const response = await fetch(CONFIG.API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    messageId: messageId,
                    checkOnly: true // First check plan and get confirmation
                })
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                // Handle plan restriction
                if (result.needsUpgrade) {
                    const upgradeConfirmed = await showUpgradeModal();
                    if (upgradeConfirmed) {
                        window.location.href = '/upgrade';
                    }
                    return;
                }
                
                throw new Error(result.error || 'API request failed');
            }
            
            // Show credit confirmation for Silver+ users
            const confirmed = await showCreditConfirmationModal(messageId);
            if (!confirmed) return;
            
            // Make actual lookup call
            const lookupResponse = await fetch(CONFIG.API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    messageId: messageId,
                    confirmed: true
                })
            });
            
            const lookupResult = await lookupResponse.json();
            
            if (!lookupResponse.ok || !lookupResult.success) {
                throw new Error(lookupResult.error || 'Lookup failed');
            }
            
            // Update UI with result
            updateRowUI(messageId, 'completed', lookupResult);
            
            // Show result toast
            showToast(
                lookupResult.status === 'verified' 
                    ? `Email verified: ${lookupResult.email} (${lookupResult.creditsUsed} credits used)`
                    : `Email not found (${lookupResult.creditsUsed} credits used)`,
                lookupResult.status === 'verified' ? 'success' : 'info'
            );
            
            // Update local data
            updateMessageData(messageId, lookupResult);
            
        } catch (error) {
            console.error('[EMAIL_FINDER] Error:', error);
            updateRowUI(messageId, 'error');
            showToast(error.message || 'Email lookup failed', 'error');
        } finally {
            isProcessing.delete(messageId);
        }
    }
    
    // ==================== UI UPDATES ====================
    
    function updateRowUI(messageId, state, result = null) {
        const message = window.messagesData.find(m => m.id === messageId);
        if (!message) return;
        
        const messageIndex = window.messagesData.indexOf(message);
        const row = document.querySelectorAll('.messages-table tbody tr')[messageIndex];
        if (!row) return;
        
        const askEmailCell = row.querySelector('.col-ask-email');
        const verificationCell = row.querySelector('.col-verification');
        
        if (state === 'completed' && result) {
            // Update message data first
            if (!message.data_json) message.data_json = {};
            message.data_json.email_finder = {
                status: result.status,
                email: result.email || null,
                verified_at: result.status === 'verified' ? new Date().toISOString() : null
            };
        }
        
        if (askEmailCell) {
            askEmailCell.innerHTML = createAskEmailHTML(message);
        }
        
        if (verificationCell) {
            verificationCell.innerHTML = createVerificationHTML(message);
        }
    }
    
    function updateMessageData(messageId, result) {
        const message = window.messagesData.find(m => m.id === messageId);
        if (!message) return;
        
        if (!message.data_json) message.data_json = {};
        message.data_json.email_finder = {
            status: result.status,
            email: result.email || null,
            verified_at: result.status === 'verified' ? new Date().toISOString() : null
        };
    }
    
    // ==================== MODALS ====================
    
    function showUpgradeModal() {
        return new Promise((resolve) => {
            const modalHTML = `
                <div id="upgradeModal" class="email-finder-modal-overlay">
                    <div class="email-finder-modal-content">
                        <div class="email-finder-modal-header">
                            <h3>🚀 Upgrade Required</h3>
                            <button class="email-finder-modal-close" onclick="closeUpgradeModal(false)">&times;</button>
                        </div>
                        <div class="email-finder-modal-body">
                            <p><strong>Email Finder is available for Silver plan and above.</strong></p>
                            <p>Unlock email finding and verification to supercharge your outreach!</p>
                            <ul class="upgrade-benefits">
                                <li>✅ Find verified email addresses</li>
                                <li>✅ Powered by Snov.io database</li>
                                <li>✅ Only pay for successful verifications</li>
                                <li>✅ Boost your connection rates</li>
                            </ul>
                        </div>
                        <div class="email-finder-modal-footer">
                            <button class="btn-cancel" onclick="closeUpgradeModal(false)">Maybe Later</button>
                            <button class="btn-upgrade" onclick="closeUpgradeModal(true)">Upgrade Now</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
            window.closeUpgradeModal = (confirmed) => {
                const modal = document.getElementById('upgradeModal');
                if (modal) modal.remove();
                delete window.closeUpgradeModal;
                resolve(confirmed);
            };
        });
    }
    
    function showCreditConfirmationModal(messageId) {
        return new Promise((resolve) => {
            const message = window.messagesData.find(m => m.id === messageId);
            const targetName = message?.targetProfile?.firstName || message?.target_name || 'this contact';
            
            const modalHTML = `
                <div id="creditConfirmModal" class="email-finder-modal-overlay">
                    <div class="email-finder-modal-content">
                        <div class="email-finder-modal-header">
                            <h3>💳 Confirm Email Lookup</h3>
                            <button class="email-finder-modal-close" onclick="closeCreditModal(false)">&times;</button>
                        </div>
                        <div class="email-finder-modal-body">
                            <div class="confirmation-info">
                                <div class="info-row">
                                    <strong>Target:</strong> ${targetName}
                                </div>
                                <div class="info-row">
                                    <strong>Cost:</strong> ${CONFIG.COST_PER_LOOKUP} credits (only if email found & verified)
                                </div>
                                <div class="info-description">
                                    This will use Snov.io to find and verify the email address. 
                                    You'll only be charged if we successfully find and verify an email.
                                </div>
                            </div>
                        </div>
                        <div class="email-finder-modal-footer">
                            <button class="btn-cancel" onclick="closeCreditModal(false)">Cancel</button>
                            <button class="btn-confirm" onclick="closeCreditModal(true)">Continue</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
            window.closeCreditModal = (confirmed) => {
                const modal = document.getElementById('creditConfirmModal');
                if (modal) modal.remove();
                delete window.closeCreditModal;
                resolve(confirmed);
            };
        });
    }
    
    // ==================== TOAST NOTIFICATIONS ====================
    
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `email-finder-toast toast-${type}`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 100);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
    
    // ==================== STYLES ====================
    
    function addStyles() {
        const styles = `
            /* Column adjustments */
            .messages-table .col-ask-email { width: 8%; }
            .messages-table .col-verification { width: 14%; }
            .messages-table .col-actions { width: 4%; }
            
            /* Ask Email Button */
            .ask-email-btn {
                display: flex;
                align-items: center;
                gap: 0.3rem;
                padding: 0.4rem 0.6rem;
                font-size: 0.7rem;
                font-weight: 600;
                border: 1px solid #8039df;
                background: white;
                color: #8039df;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.3s ease;
                white-space: nowrap;
                width: 100%;
                justify-content: center;
            }
            
            .ask-email-btn:hover:not(:disabled) {
                background: #8039df;
                color: white;
                transform: translateY(-1px);
            }
            
            .ask-email-btn.verified {
                background: #d4edda;
                color: #155724;
                border-color: #c3e6cb;
                cursor: default;
            }
            
            .ask-email-btn.processing {
                background: #fff3cd;
                color: #856404;
                border-color: #ffeaa7;
                cursor: wait;
            }
            
            /* Verification Status */
            .verification-status {
                display: flex;
                align-items: flex-start;
                gap: 0.4rem;
                font-size: 0.75rem;
                line-height: 1.3;
                padding: 0.2rem;
            }
            
            .status-indicator {
                font-size: 0.8rem;
                flex-shrink: 0;
            }
            
            .status-content {
                display: flex;
                flex-direction: column;
                gap: 0.1rem;
                min-width: 0;
            }
            
            .status-email {
                font-weight: 600;
                word-break: break-all;
                color: #28a745;
            }
            
            .status-subtitle {
                font-size: 0.65rem;
                color: #6c757d;
                font-style: italic;
            }
            
            .status-text {
                font-weight: 600;
            }
            
            .verification-status.verified {
                color: #28a745;
            }
            
            .verification-status.not-found {
                color: #dc3545;
            }
            
            .verification-status.error {
                color: #fd7e14;
            }
            
            .verification-status.no-attempt {
                color: #6c757d;
            }
            
            /* Modal Styles */
            .email-finder-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }
            
            .email-finder-modal-content {
                background: white;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                max-width: 500px;
                width: 90%;
                overflow: hidden;
            }
            
            .email-finder-modal-header {
                padding: 1.5rem;
                border-bottom: 1px solid #dee2e6;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .email-finder-modal-header h3 {
                margin: 0;
                color: #8039df;
                font-weight: 700;
            }
            
            .email-finder-modal-close {
                background: none;
                border: none;
                font-size: 1.5rem;
                color: #6c757d;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.2s ease;
            }
            
            .email-finder-modal-close:hover {
                background: #f8f9fa;
                color: #495057;
            }
            
            .email-finder-modal-body {
                padding: 1.5rem;
            }
            
            .confirmation-info {
                display: flex;
                flex-direction: column;
                gap: 1rem;
            }
            
            .info-row {
                display: flex;
                justify-content: space-between;
                padding: 0.5rem 0;
                border-bottom: 1px solid #f8f9fa;
            }
            
            .info-description {
                font-size: 0.9rem;
                color: #6c757d;
                line-height: 1.5;
            }
            
            .upgrade-benefits {
                list-style: none;
                padding: 0;
                margin: 1rem 0 0 0;
            }
            
            .upgrade-benefits li {
                padding: 0.3rem 0;
                font-size: 0.9rem;
            }
            
            .email-finder-modal-footer {
                padding: 1rem 1.5rem;
                border-top: 1px solid #dee2e6;
                display: flex;
                justify-content: flex-end;
                gap: 0.75rem;
            }
            
            .btn-cancel, .btn-confirm, .btn-upgrade {
                padding: 0.5rem 1.2rem;
                border: 1px solid;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .btn-cancel {
                background: white;
                color: #6c757d;
                border-color: #dee2e6;
            }
            
            .btn-cancel:hover {
                background: #f8f9fa;
                color: #495057;
            }
            
            .btn-confirm, .btn-upgrade {
                background: #8039df;
                color: white;
                border-color: #8039df;
            }
            
            .btn-confirm:hover, .btn-upgrade:hover {
                background: #6c2bd1;
                border-color: #6c2bd1;
                transform: translateY(-1px);
            }
            
            /* Toast Styles */
            .email-finder-toast {
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                color: white;
                font-weight: 600;
                font-size: 0.9rem;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
                z-index: 10001;
                transform: translateX(400px);
                transition: transform 0.3s ease;
                max-width: 350px;
            }
            
            .email-finder-toast.show {
                transform: translateX(0);
            }
            
            .toast-success {
                background: #28a745;
            }
            
            .toast-error {
                background: #dc3545;
            }
            
            .toast-info {
                background: #17a2b8;
            }
        `;
        
        const styleElement = document.createElement('style');
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);
    }
    
    // ==================== INITIALIZATION ====================
    
    // Expose askEmail function globally for onclick handlers
    window.askEmail = askEmail;
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initEmailFinder, 100);
        });
    } else {
        setTimeout(initEmailFinder, 100);
    }
    
})();
