// credits.js - Server-Only Credits Management System
// World-class UX/UI credits display and validation for Msgly.AI Chrome Extension

// Global credits state (client-side cache only)
let currentCreditsData = {
    remaining: 0,
    total: 0,
    plan: 'free',
    renewalDate: null,
    billingModel: 'monthly'
};

// API Configuration
const CREDITS_API_BASE = 'https://api.msgly.ai';

// Credits API Helper Functions
async function makeCreditsRequest(endpoint, options = {}) {
    // AUTH FIX
    const authToken = await getAuthToken();
    if (!authToken) throw new Error('Authentication required');

    const response = await fetch(`${CREDITS_API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            // AUTH FIX
            'Authorization': `Bearer ${authToken}`,
            ...options.headers
        }
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Authentication expired');
        }
        throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
}

// ✅ FIXED: Get Real Auth Token (from content.js global variable)
function getAuthToken() {
    // Try to get from global variable set by content.js
    if (typeof window.msglyAuthToken !== 'undefined' && window.msglyAuthToken) {
        return window.msglyAuthToken;
    }
    
    // Fallback: try other possible sources
    if (typeof authToken !== 'undefined' && authToken) {
        return authToken;
    }
    
    console.log('[Credits] ❌ Auth token not found');
    return null;
}

// 💎 **CREDITS STATUS API CALL**
async function fetchCreditsStatus() {
    try {
        console.log('[Credits] 💎 Fetching credits status...');
        
        const response = await makeCreditsRequest('/api/credits/status');
        
        if (response.success) {
            currentCreditsData = response.data;
            console.log('[Credits] ✅ Credits status loaded:', currentCreditsData);
            return response.data;
        } else {
            throw new Error(response.error || 'Failed to fetch credits');
        }
    } catch (error) {
        console.error('[Credits] ❌ Failed to fetch credits status:', error);
        throw error;
    }
}

// 🎯 **TARGET STATUS CHECK API CALL**
async function checkTargetStatus(profileUrl) {
    try {
        console.log('[Credits] 🎯 Checking target status for:', profileUrl);
        
        const normalizedUrl = normalizeLinkedInUrl(profileUrl);
        const response = await makeCreditsRequest(`/api/target/check?url=${encodeURIComponent(normalizedUrl)}`);
        
        if (response.success) {
            console.log('[Credits] ✅ Target status:', response.data.exists ? 'EXISTS' : 'NEW');
            return response.data;
        } else {
            throw new Error(response.error || 'Failed to check target status');
        }
    } catch (error) {
        console.error('[Credits] ❌ Failed to check target status:', error);
        // Return default "new" state on error to prevent blocking
        return { exists: false, isNew: true };
    }
}

// 💰 **CREDITS VALIDATION API CALL**
async function validateCreditsForAction(action) {
    try {
        console.log(`[Credits] 💰 Validating credits for action: ${action}`);
        
        const response = await makeCreditsRequest('/api/credits/validate', {
            method: 'POST',
            body: JSON.stringify({ action })
        });
        
        if (response.success) {
            console.log('[Credits] ✅ Credits validation passed');
            return response.data;
        } else {
            throw new Error(response.error || 'Credits validation failed');
        }
    } catch (error) {
        console.error('[Credits] ❌ Credits validation failed:', error);
        throw error;
    }
}

// 🏷️ **HELPER: NORMALIZE LINKEDIN URL**
function normalizeLinkedInUrl(url) {
    try {
        if (!url) return null;
        
        let normalized = url.toString()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('?')[0]
            .split('#')[0]
            .replace(/\/$/, '');
        
        // For LinkedIn profiles, ensure clean format
        if (normalized.includes('linkedin.com/in/')) {
            const match = normalized.match(/linkedin\.com\/in\/([^\/\?]+)/);
            if (match) {
                normalized = `linkedin.com/in/${match[1]}`;
            }
        }
        
        return normalized;
    } catch (error) {
        console.warn('[Credits] ⚠️ Error normalizing URL:', error);
        return null;
    }
}

// 🎨 **UI HELPER: UPDATE CREDITS DISPLAY**
function updateCreditsDisplay(creditsData) {
    if (!creditsData) return;
    
    console.log('[Credits] 🎨 Updating credits display:', creditsData);
    
    // Call UI module if available
    if (window.MsglyUI && typeof window.MsglyUI.setCreditsDisplay === 'function') {
        window.MsglyUI.setCreditsDisplay(creditsData);
    }
    
    // Update existing credits badge
    const creditsBadge = document.getElementById('msgly-header-credits');
    if (creditsBadge) {
        creditsBadge.textContent = `${creditsData.remaining} Credits`;
    }
}

// 🎯 **UI HELPER: UPDATE TARGET BORDER STATES**
function updateTargetBorderState(exists, profileUrl) {
    console.log(`[Credits] 🎯 Updating target border state: ${exists ? 'GREEN' : 'RED'}`);
    
    // Call UI module if available
    if (window.MsglyUI && typeof window.MsglyUI.setTargetProfileState === 'function') {
        window.MsglyUI.setTargetProfileState({
            exists: exists,
            url: profileUrl
        });
    }
    
    // Update target card border
    const targetCard = document.querySelector('.msgly-target-card');
    if (targetCard) {
        targetCard.classList.remove('msgly-target-exists', 'msgly-target-new');
        
        if (exists) {
            targetCard.classList.add('msgly-target-exists');
            targetCard.style.borderLeft = '4px solid var(--success-green)';
        } else {
            targetCard.classList.add('msgly-target-new');
            targetCard.style.borderLeft = '4px solid var(--error-red)';
        }
    }
    
    // Update analyze button text
    const analyzeBtn = document.getElementById('msgly-analyze-target-btn');
    if (analyzeBtn) {
        if (exists) {
            analyzeBtn.textContent = 'Already in System';
            analyzeBtn.disabled = true;
            analyzeBtn.style.opacity = '0.6';
        } else {
            analyzeBtn.textContent = 'Analyze Profile';
            analyzeBtn.disabled = false;
            analyzeBtn.style.opacity = '1';
        }
    }
}

// 🚀 **MAIN INITIALIZATION FUNCTION**
async function initializeCreditsSystem() {
    try {
        console.log('[Credits] 🚀 Initializing credits system...');
        
        // Check if we have auth token
        const authToken = getAuthToken();
        if (!authToken) {
            console.log('[Credits] ⚠️ No auth token available, skipping credits initialization');
            return;
        }
        
        // Fetch current credits status
        const creditsData = await fetchCreditsStatus();
        updateCreditsDisplay(creditsData);
        
        // Check target status if on LinkedIn profile
        if (isLinkedInProfile()) {
            const currentUrl = window.location.href;
            const targetStatus = await checkTargetStatus(currentUrl);
            updateTargetBorderState(targetStatus.exists, currentUrl);
        }
        
        console.log('[Credits] ✅ Credits system initialized successfully');
        
    } catch (error) {
        console.error('[Credits] ❌ Credits system initialization failed:', error);
        
        // Graceful degradation - show default state
        updateCreditsDisplay({
            remaining: 0,
            total: 7,
            plan: 'free',
            renewalDate: null,
            billingModel: 'monthly'
        });
    }
}

// 🔄 **URL CHANGE HANDLER**
function handleUrlChange() {
    console.log('[Credits] 🔄 URL changed, re-checking target status...');
    
    if (isLinkedInProfile()) {
        const currentUrl = window.location.href;
        checkTargetStatus(currentUrl)
            .then(targetStatus => {
                updateTargetBorderState(targetStatus.exists, currentUrl);
            })
            .catch(error => {
                console.error('[Credits] ❌ Failed to check target status on URL change:', error);
            });
    }
}

// 🎯 **HELPER: CHECK IF LINKEDIN PROFILE**
function isLinkedInProfile() {
    const url = window.location.href;
    const normalizedUrl = normalizeLinkedInUrl(url);
    return normalizedUrl && normalizedUrl.includes('linkedin.com/in/') && !normalizedUrl.includes('/edit/');
}

// 🎬 **PUBLIC API**
window.MsglyCredits = {
    // Core functions
    fetchCreditsStatus,
    checkTargetStatus,
    validateCreditsForAction,
    
    // UI helpers
    updateCreditsDisplay,
    updateTargetBorderState,
    
    // Initialization
    initialize: initializeCreditsSystem,
    handleUrlChange,
    
    // Getters
    getCurrentCredits: () => currentCreditsData,
    isLinkedInProfile,
    normalizeLinkedInUrl
};

console.log('💎 Msgly Credits System loaded and ready!');
console.log('🔗 Connected to real authentication system');
console.log('🎯 Ready for server-side credit validation');
