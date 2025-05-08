// ========== FILE: appFeatures.js (FULL, UNABRIDGED, UPDATED) ==========
import { appState, domRefs } from './state.js';
import { GITHUB_RELEASES_API, CURRENT_VERSION } from './config.js';
// Import the specific dialog function and message function
import { showMessage, showUpdateInfoDialog } from './uiUtils.js';
import { escapeHTML } from './flowCore.js'; // Import escapeHTML
import { logger } from './logger.js';

/**
 * Toggles the collapsed state of the left sidebar.
 */
export function handleToggleSidebarCollapse() {
    if (!domRefs.sidebar || !domRefs.sidebarToggleBtn) return;

    appState.isSidebarCollapsed = !appState.isSidebarCollapsed;
    domRefs.sidebar.classList.toggle('collapsed', appState.isSidebarCollapsed);

    try { localStorage.setItem('sidebarCollapsed', appState.isSidebarCollapsed); } catch (e) { logger.warn("Could not persist sidebar state:", e); }

    logger.info(`Sidebar collapsed state: ${appState.isSidebarCollapsed}`);
}

/**
 * Toggles the collapsed state of the right runner panel.
 */
export function handleToggleRunnerCollapse() {
    if (!domRefs.runnerPanel || !domRefs.runnerToggleBtn) return;

    appState.isRunnerCollapsed = !appState.isRunnerCollapsed;
    domRefs.runnerPanel.classList.toggle('collapsed', appState.isRunnerCollapsed);

    try { localStorage.setItem('runnerCollapsed', appState.isRunnerCollapsed); } catch (e) { logger.warn("Could not persist runner state:", e); }

    logger.info(`Runner collapsed state: ${appState.isRunnerCollapsed}`);
}

// --- Update Notification on App Open ---
export async function checkForUpdate() {
    try {
        logger.info("[Update Check - Startup] Checking for updates...");
        const response = await fetch(GITHUB_RELEASES_API, {
             headers: { 'Accept': 'application/vnd.github.v3+json' },
             cache: 'no-cache' // Try to avoid caching issues
        });

        // --- IMPORTANT: Handle non-OK responses silently ---
        if (!response.ok) {
            logger.warn(`[Update Check - Startup] GitHub response not OK: ${response.status}`);
            return; // Do nothing visible to the user
        }

        const data = await response.json();
        const latestTag = data.tag_name?.replace(/^v/, ''); // Remove leading 'v' if present
        const releaseUrl = data.html_url; // Get the URL to the release page

        if (!latestTag) {
            logger.warn("[Update Check - Startup] Could not find tag_name in response.");
            return; // Do nothing visible
        }
        if (!releaseUrl) {
             logger.warn("[Update Check - Startup] Could not find html_url in response.");
             // Decide if we should still show the message without a link, or just return. Let's return.
             return;
        }

        logger.info(`[Update Check - Startup] Current: ${CURRENT_VERSION}, Latest: ${latestTag}`);
        if (compareVersions(latestTag, CURRENT_VERSION) > 0) {
            logger.info("[Update Check - Startup] Newer version found!");
            // --- MODIFICATION: Use allowHTML ---
            // Use escapeHTML for dynamic parts, but allow the <a> tag itself
            const messageHTML = `A newer version (${escapeHTML(latestTag)}) is available. <a href="${escapeHTML(releaseUrl)}" target="_blank">View Release</a>`;
            showMessage(
                messageHTML,
                'info',
                domRefs.builderMessages, // Show in the main message area
                'Update Available',
                true // Allow HTML rendering for the link
            );
        } else {
            logger.info("[Update Check - Startup] Already on latest version or newer.");
        }
    } catch (e) {
        // --- IMPORTANT: Catch *all* errors silently for startup check ---
        logger.warn("[Update Check - Startup] Failed:", e);
        // Do nothing visible to the user
    }
}

// --- NEW: Manual Update Check Function ---
export async function manualCheckForUpdate() {
    try {
        showUpdateInfoDialog("Checking for Updates...", "Contacting GitHub...", false); // Show initial dialog
        logger.info("[Update Check - Manual] Checking for updates...");

        const response = await fetch(GITHUB_RELEASES_API, {
             headers: { 'Accept': 'application/vnd.github.v3+json' },
             cache: 'no-cache'
        });

        if (!response.ok) {
             // --- Handle non-OK responses by showing an error in the dialog ---
            logger.error(`[Update Check - Manual] GitHub response not OK: ${response.status}`);
            showUpdateInfoDialog('Update Check Failed', `Could not check for updates. GitHub returned status: ${response.status} ${response.statusText}`, false);
            return;
        }

        const data = await response.json();
        const latestTag = data.tag_name?.replace(/^v/, '');
        const releaseUrl = data.html_url;

        if (!latestTag) {
            logger.error("[Update Check - Manual] Could not find tag_name in response.");
            showUpdateInfoDialog('Update Check Error', 'Could not determine the latest version from GitHub response.', false);
            return;
        }
        if (!releaseUrl) {
             logger.warn("[Update Check - Manual] Could not find html_url in response.");
             // Show message but indicate link is missing
              if (compareVersions(latestTag, CURRENT_VERSION) > 0) {
                   showUpdateInfoDialog('Update Available', `A newer version (${escapeHTML(latestTag)}) is available, but the download link could not be retrieved. Please check the GitHub repository manually.`, false);
              } else {
                   showUpdateInfoDialog('Up to Date', `You are running the latest version (v${CURRENT_VERSION}). (Could not verify release link).`, false);
              }
             return;
        }

        logger.info(`[Update Check - Manual] Current: ${CURRENT_VERSION}, Latest: ${latestTag}`);
        if (compareVersions(latestTag, CURRENT_VERSION) > 0) {
            logger.info("[Update Check - Manual] Newer version found!");
            // Use escapeHTML for dynamic parts, but allow the <a> tag itself
            const messageHTML = `A newer version (v${escapeHTML(latestTag)}) is available.\n\n<a href="${escapeHTML(releaseUrl)}" target="_blank" class="btn btn-primary" style="margin-top: 10px;">View Release on GitHub</a>`;
            showUpdateInfoDialog('Update Available', messageHTML, true); // Allow HTML for the button/link
        } else {
            logger.info("[Update Check - Manual] Already on latest version.");
            showUpdateInfoDialog('Up to Date', `You are running the latest version (v${CURRENT_VERSION}).`, false);
        }
    } catch (e) {
        // --- Catch errors and show them in the dialog ---
        logger.error("[Update Check - Manual] Failed:", e);
        showUpdateInfoDialog('Update Check Error', `Could not check for updates. Error: ${e.message}`, false);
    }
}


// --- Version Comparison (Keep as is) ---
export function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}