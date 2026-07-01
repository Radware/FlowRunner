// --- Constants ---
export const RECENT_FILES_KEY = 'flowrunnerRecentFiles';
export const MAX_RECENT_FILES = 10;
export const DEFAULT_REQUEST_DELAY = 1000; // Keep this in ms

// --- WAVE2 file-features: undo/redo history ---
// Max number of undoable flow-model edits kept in memory (immer-patch history).
// Bounds memory on long editing sessions; older edits fall off the bottom.
export const UNDO_HISTORY_LIMIT = 100;

// --- Persistence (electron-store, main process) ---
// electron-store keys for persistent app settings + the recent-files list.
// The store name/keys live here so main.js and any future consumer agree.
export const STORE_NAME = 'flowrunner-settings';
export const STORE_RECENT_FILES_KEY = 'recentFiles'; // string[] of absolute paths
export const STORE_SETTINGS_KEY = 'settings';        // free-form settings object

// --- Sidecar workspace model ---
// Organization metadata (folders/tags/category that REFERENCE flow files by
// path) is persisted OUT-OF-BAND in this sidecar so `.flow.json` stays byte-clean
// and cross-app-safe. Written under the user data directory by main.js.
export const WORKSPACE_DIR = '.flowrunner';
export const WORKSPACE_FILE = 'workspace.json';

// --- WAVE3 demo-mode: guided first-run persistence ---
// localStorage key that records whether the lightweight first-run onboarding
// coach-marks have been dismissed. Renderer-only UI preference (same class of
// persistence as sidebarCollapsed/runnerCollapsed), so it lives in localStorage
// rather than the electron-store settings blob. The value "true" means "seen";
// absence means "show onboarding on the next empty workspace".
export const FIRST_RUN_SEEN_KEY = 'flowrunnerFirstRunSeen';

// --- WAVE3 demo-mode: presentation toggle persistence ---
// localStorage key that remembers whether Demo Mode (the projector presentation
// toggle) was left on, so a presenter's setup survives an app relaunch mid-demo.
export const DEMO_MODE_KEY = 'flowrunnerDemoMode';

// --- Logging Level Config ---
export const LOG_LEVEL = 'info'; // Possible values: 'debug', 'info', 'warn', 'error'

// --- Update Notification Config ---
export const CURRENT_VERSION = '1.2.1'; // Update as needed for your release
export const GITHUB_RELEASES_API = 'https://api.github.com/repos/Radware/FlowRunner/releases/latest';
