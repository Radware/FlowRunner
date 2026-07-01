// --- Constants ---
export const RECENT_FILES_KEY = 'flowrunnerRecentFiles';
export const MAX_RECENT_FILES = 10;
export const DEFAULT_REQUEST_DELAY = 1000; // Keep this in ms

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

// --- Logging Level Config ---
export const LOG_LEVEL = 'info'; // Possible values: 'debug', 'info', 'warn', 'error'

// --- Update Notification Config ---
export const CURRENT_VERSION = '1.2.1'; // Update as needed for your release
export const GITHUB_RELEASES_API = 'https://api.github.com/repos/Radware/FlowRunner/releases/latest';
