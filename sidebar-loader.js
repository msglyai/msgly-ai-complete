/**
 * Msgly.AI Shared Sidebar Loader
 * Loads sidebar.html and connects user data from /profile API
 * Handles authentication, credit display, and mobile functionality
 */

(function() {
    'use strict';

    // Configuration
    const SIDEBAR_URL = '/sidebar.html';
    const PROFILE_API = '/profile';
    const LOGIN_URL = '/login';

    // Global variables
    let currentUserData = null;

    /**
     * Initialize the sidebar on page load
     */
    async function initSidebar() {
        try {
            // Check authentication first
            if (!checkAuthentication()) {
                return;
            }

            // Load sidebar HTML
            await loadSidebarHTML();

            // Load user profile data
            await loadUserProfile();

            // Setup event listeners
            setupEventListeners();

            // Highlight active page
            highlightActivePage();

            console.log('[SIDEBAR] Initialization complete');
        } catch (error) {
            console.error('[SIDEBAR] Initialization error:', error);
        }
    }

    /**
     * Check if user is authenticated
     */
    function checkAuthentication() {
        const token = getAuthToken();
        if (!token) {
            const currentPath = window.location.pathname;
            window.location.href = `${LOGIN_URL}?returnUrl=${currentPath}`;
            return false;
        }
        return true;
    }

    /**
     * Get auth token from localStorage
     */
    function getAuthToken() {
        return localStorage.getItem('authToken');
    }

    /**
     * Load sidebar HTML from server
     * FIXED: Now extracts and inserts backdrop element
     */
    async function loadSidebarHTML() {
        try {
            const response = await fetch(SIDEBAR_URL);
            if (!response.ok) {
                throw new Error(`Failed to load sidebar: ${response.status}`);
            }

            const html = await response.text();
            
            // Parse HTML and extract sidebar content
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Get all required elements: backdrop, toggle, and sidebar
            const backdrop = doc.querySelector('.sidebar-backdrop');
            const toggle = doc.querySelector('.sidebar-toggle');
            const sidebar = doc.querySelector('.sidebar');
            const styles = doc.querySelector('style');

            // Insert styles into page head if not already present
            if (styles && !document.querySelector('#msgly-sidebar-styles')) {
                const styleEl = document.createElement('style');
                styleEl.id = 'msgly-sidebar-styles';
                styleEl.textContent = styles.textContent;
                document.head.appendChild(styleEl);
            }

            // Insert elements into body in correct order: backdrop → sidebar → toggle
            // FIXED: Backdrop is now inserted first
            if (backdrop) {
                document.body.insertBefore(backdrop, document.body.firstChild);
                console.log('[SIDEBAR] Backdrop element inserted');
            }
            if (sidebar) {
                document.body.insertBefore(sidebar, document.body.firstChild);
                console.log('[SIDEBAR] Sidebar element inserted');
            }
            if (toggle) {
                document.body.insertBefore(toggle, document.body.firstChild);
                console.log('[SIDEBAR] Toggle button inserted');
            }

            console.log('[SIDEBAR] HTML loaded successfully');
        } catch (error) {
            console.error('[SIDEBAR] Error loading HTML:', error);
            throw error;
        }
    }

    /**
     * Load user profile from API
     */
    async function loadUserProfile() {
        try {
            const token = getAuthToken();
            if (!token) {
                redirectToLogin();
                return;
            }

            const response = await fetch(PROFILE_API, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 401) {
                localStorage.removeItem('authToken');
                redirectToLogin();
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                const user = data.data.user;
                
                // Calculate total credits (renewable + pay-as-you-go)
                const renewableCredits = parseFloat(user.renewableCredits || 0);
                const payasyougoCredits = parseFloat(user.payasyougoCredits || 0);
                const totalCredits = renewableCredits + payasyougoCredits;
                
                console.log('[SIDEBAR] Credits - Renewable:', renewableCredits.toFixed(2));
                console.log('[SIDEBAR] Credits - PayAsYouGo:', payasyougoCredits.toFixed(2));
                console.log('[SIDEBAR] Credits - Total:', totalCredits.toFixed(2));
                
                // Store user data
                currentUserData = {
                    name: user.displayName || user.email,
                    email: user.email,
                    planCode: user.planCode || user.plan_code || 'free',
                    planName: user.planName || user.plan_name || 'Free',
                    totalCredits: totalCredits,
                    renewableCredits: renewableCredits,
                    payasyougoCredits: payasyougoCredits
                };
                
                // Update sidebar display
                updateSidebarDisplay(currentUserData);
                
                console.log('[SIDEBAR] User profile loaded successfully');
            } else {
                throw new Error(data.error || 'Failed to load profile');
            }
            
        } catch (error) {
            console.error('[SIDEBAR] Error loading profile:', error);
            // Show default values on error
            showDefaultValues();
        }
    }

    /**
     * Update sidebar display with user data
     */
    function updateSidebarDisplay(userData) {
        // Update name
        const nameEl = document.getElementById('sidebarUserName');
        if (nameEl) {
            nameEl.textContent = userData.name;
        }

        // Update email
        const emailEl = document.getElementById('sidebarUserEmail');
        if (emailEl) {
            emailEl.textContent = userData.email;
        }

        // Update plan badge
        const planEl = document.getElementById('sidebarUserPlan');
        const planTextEl = document.getElementById('sidebarPlanText');
        if (planEl && planTextEl) {
            const planNames = {
                'free': 'Free',
                'silver-monthly': 'Silver',
                'silver-payasyougo': 'Silver',
                'gold-monthly': 'Gold',
                'gold-payasyougo': 'Gold',
                'platinum-monthly': 'Platinum',
                'platinum-payasyougo': 'Platinum'
            };
            planTextEl.textContent = planNames[userData.planCode] || userData.planName;
        }

        // Update credits
        updateCreditsDisplay(userData.totalCredits);
        
        // Show/hide upgrade button based on plan (only show for free users)
        const upgradeSection = document.getElementById('upgradeSection');
        if (upgradeSection) {
            if (userData.planCode === 'free') {
                upgradeSection.style.display = 'block';
                console.log('[SIDEBAR] Showing upgrade button for free user');
            } else {
                upgradeSection.style.display = 'none';
                console.log('[SIDEBAR] Hiding upgrade button for paid user:', userData.planCode);
            }
        }
        
        // Update feature badges based on plan
        updateFeatureBadges(userData.planCode);
    }

    /**
     * Update feature badges based on user plan
     * Free users: Show "Silver+" badge on Email Finder, "NEW" on Target Profiles
     * Paid users: Show "NEW" badge on both features
     */
    function updateFeatureBadges(planCode) {
        const isFreeUser = planCode === 'free';
        
        // Target Profiles - Always show "NEW" badge for all users
        const targetProfilesBadge = document.getElementById('targetProfilesBadge');
        if (targetProfilesBadge) {
            targetProfilesBadge.style.display = 'inline-block';
            console.log('[SIDEBAR] Showing NEW badge on Target Profiles');
        }
        
        // Email Finder - Show different badges based on plan
        const emailFinderNewBadge = document.getElementById('emailFinderNewBadge');
        const emailFinderPremiumBadge = document.getElementById('emailFinderPremiumBadge');
        
        if (isFreeUser) {
            // Free users: Show "Silver+" badge
            if (emailFinderNewBadge) {
                emailFinderNewBadge.style.display = 'none';
            }
            if (emailFinderPremiumBadge) {
                emailFinderPremiumBadge.style.display = 'inline-block';
                console.log('[SIDEBAR] Showing Silver+ badge on Email Finder for free user');
            }
        } else {
            // Paid users: Show "NEW" badge
            if (emailFinderNewBadge) {
                emailFinderNewBadge.style.display = 'inline-block';
                console.log('[SIDEBAR] Showing NEW badge on Email Finder for paid user');
            }
            if (emailFinderPremiumBadge) {
                emailFinderPremiumBadge.style.display = 'none';
            }
        }
    }

    /**
     * Update credits display with animation
     */
    function updateCreditsDisplay(credits) {
        const creditsValue = Math.max(0, parseFloat(credits) || 0);
        const formattedCredits = creditsValue.toFixed(2);
        
        const creditsNumberEl = document.getElementById('sidebarCreditsNumber');
        const creditsContainerEl = document.getElementById('sidebarUserCredits');
        
        if (creditsNumberEl) {
            creditsNumberEl.textContent = formattedCredits;
        }
        
        // Add update animation
        if (creditsContainerEl) {
            creditsContainerEl.classList.add('updating');
            setTimeout(() => {
                creditsContainerEl.classList.remove('updating');
            }, 600);
        }
        
        console.log('[SIDEBAR] Credits display updated:', formattedCredits);
    }

    /**
     * Show default values when profile loading fails
     */
    function showDefaultValues() {
        const nameEl = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        const planTextEl = document.getElementById('sidebarPlanText');
        
        if (nameEl) nameEl.textContent = 'User';
        if (emailEl) emailEl.textContent = 'Loading...';
        if (planTextEl) planTextEl.textContent = 'Free';
        
        updateCreditsDisplay(0);
    }

    /**
     * Redirect to login with return URL
     */
    function redirectToLogin() {
        const currentPath = window.location.pathname;
        window.location.href = `${LOGIN_URL}?returnUrl=${currentPath}`;
    }

    /**
     * Highlight active page in sidebar menu
     */
    function highlightActivePage() {
        const currentPath = window.location.pathname;
        const navItems = document.querySelectorAll('.nav-item[data-page]');
        
        navItems.forEach(item => {
            const page = item.getAttribute('data-page');
            
            // Check if current path matches this menu item
            if (
                (page === 'dashboard' && currentPath === '/dashboard') ||
                (page === 'msgly-profile' && currentPath.includes('msgly-profile')) ||
                (page === 'messages' && currentPath === '/messages') ||
                (page === 'target-profiles' && currentPath === '/target-profiles') ||
                (page === 'email-finder' && currentPath === '/email-finder')
            ) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
        
        console.log('[SIDEBAR] Active page highlighted:', currentPath);
    }

    /**
     * Setup event listeners
     * FIXED: Now properly handles backdrop element
     */
    function setupEventListeners() {
        // Logout button
        const logoutBtn = document.getElementById('sidebarLogout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function(e) {
                e.preventDefault();
                logout();
            });
        }

        // Mobile toggle button, sidebar, and backdrop
        const toggleBtn = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        
        if (toggleBtn && sidebar && backdrop) {
            console.log('[SIDEBAR] All mobile elements found successfully');
            
            // Toggle button click
            toggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleSidebarMobile();
            });

            // Backdrop click - close sidebar
            backdrop.addEventListener('click', function() {
                closeSidebarMobile();
            });

            // Close sidebar when clicking nav items on mobile
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                item.addEventListener('click', function() {
                    if (window.innerWidth <= 768) {
                        closeSidebarMobile();
                    }
                });
            });

            // Close sidebar on ESC key
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && sidebar.classList.contains('active')) {
                    closeSidebarMobile();
                }
            });
            
            console.log('[SIDEBAR] Event listeners attached successfully');
        } else {
            console.error('[SIDEBAR] Missing mobile elements:', {
                toggleBtn: !!toggleBtn,
                sidebar: !!sidebar,
                backdrop: !!backdrop
            });
        }
    }

    /**
     * Toggle sidebar on mobile
     */
    function toggleSidebarMobile() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        
        if (sidebar && backdrop) {
            const isActive = sidebar.classList.contains('active');
            
            if (isActive) {
                closeSidebarMobile();
            } else {
                openSidebarMobile();
            }
        }
    }

    /**
     * Open sidebar on mobile
     */
    function openSidebarMobile() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        
        if (sidebar && backdrop) {
            sidebar.classList.add('active');
            backdrop.classList.add('active');
            document.body.classList.add('sidebar-open');
            console.log('[SIDEBAR] Sidebar opened on mobile');
        }
    }

    /**
     * Close sidebar on mobile
     */
    function closeSidebarMobile() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        
        if (sidebar && backdrop) {
            sidebar.classList.remove('active');
            backdrop.classList.remove('active');
            document.body.classList.remove('sidebar-open');
            console.log('[SIDEBAR] Sidebar closed on mobile');
        }
    }

    /**
     * Logout function
     */
    function logout() {
        localStorage.removeItem('authToken');
        window.location.href = LOGIN_URL;
    }

    /**
     * GLOBAL FUNCTION: Refresh sidebar credits
     * Call this from any page after a credit-deducting action
     */
    window.refreshSidebarCredits = async function() {
        console.log('[SIDEBAR] Refreshing credits...');
        try {
            await loadUserProfile();
            console.log('[SIDEBAR] Credits refreshed successfully');
        } catch (error) {
            console.error('[SIDEBAR] Error refreshing credits:', error);
        }
    };

    /**
     * GLOBAL FUNCTION: Get current user data
     * Access user data from any page
     */
    window.getSidebarUserData = function() {
        return currentUserData;
    };

    /**
     * GLOBAL FUNCTION: Toggle sidebar (for custom triggers)
     */
    window.toggleSidebar = function() {
        toggleSidebarMobile();
    };

    // Initialize sidebar when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebar);
    } else {
        initSidebar();
    }

})();
