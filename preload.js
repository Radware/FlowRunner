// ========== FILE: preload.js (FULL, UNABRIDGED, Using IPC for External Link) ==========
// Securely expose select Electron APIs (via IPC) to the renderer process

// Only import modules needed for bridging and sending/receiving IPC messages directly in preload
const { contextBridge, ipcRenderer } = require('electron');

// We no longer need 'shell' here, it will be used in main.js

// Add a minimal logger for preload (no import, just a local object)
const logLevel = (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) || 'info';
const levels = ['debug', 'info', 'warn', 'error'];
function shouldLog(level) { return levels.indexOf(level) >= levels.indexOf(logLevel); }
const logger = {
  debug: (...args) => shouldLog('debug') && console.debug('[DEBUG]', ...args),
  info:  (...args) => shouldLog('info')  && console.info('[INFO]', ...args),
  warn:  (...args) => shouldLog('warn')  && console.warn('[WARN]', ...args),
  error: (...args) => shouldLog('error') && console.error('[ERROR]', ...args),
};

logger.info("Preload script executing...");

// Define the API object to expose via contextBridge
const electronAPI = {
    // --- File Dialogs ---
    // Invokes the main process handler to show the system's open file dialog
    showOpenFile: () => {
        logger.debug("[Preload] Invoking 'dialog:openFile'");
        // 'invoke' is for two-way communication (request/response)
        return ipcRenderer.invoke('dialog:openFile');
    },
    // Invokes the main process handler to show the system's save file dialog
    showSaveFile: (suggestedName) => {
        logger.debug("[Preload] Invoking 'dialog:saveFile'");
        return ipcRenderer.invoke('dialog:saveFile', suggestedName);
    },

    // --- File System Operations ---
    // Invokes the main process handler to read a file's content
    readFile: (filePath) => {
        logger.debug("[Preload] Invoking 'fs:readFile' for:", filePath);
        return ipcRenderer.invoke('fs:readFile', filePath);
    },
    // Invokes the main process handler to write content to a file
    writeFile: (filePath, content) => {
        logger.debug("[Preload] Invoking 'fs:writeFile' for:", filePath);
        return ipcRenderer.invoke('fs:writeFile', filePath, content);
    },

    // --- Dirty State Communication ---
    // Sets up a listener for messages from the main process asking for the dirty state
    onCheckDirtyState: (callback) => {
        logger.debug("[Preload] Setting up dirty state check listener");
        // Ensure only one listener is active for this event
        ipcRenderer.removeAllListeners('check-dirty-state');
        // When the main process sends 'check-dirty-state', execute the provided renderer callback
        ipcRenderer.on('check-dirty-state', (event) => callback());
    },
    // Allows the renderer process to send its current dirty state back to the main process
    sendDirtyStateResponse: (isDirty) => {
        logger.debug("[Preload] Sending dirty state response:", isDirty);
        // 'send' is for one-way communication (renderer -> main)
        ipcRenderer.send('dirty-state-response', isDirty);
    },

    // --- Update Check Communication ---
    // Sets up a listener for messages from the main process triggering a manual update check
    onManualUpdateCheckTrigger: (callback) => {
        logger.debug("[Preload] Setting up manual update check trigger listener");
        ipcRenderer.removeAllListeners('trigger-manual-update-check');
        // When the main process sends 'trigger-manual-update-check', execute the renderer callback
        ipcRenderer.on('trigger-manual-update-check', (event, ...args) => callback(...args));
    },

    // --- External Links (NOW USES IPC) ---
    // This function is called by the renderer (uiUtils.js)
    // It sends a message to the main process, asking *it* to open the link.
    triggerOpenExternalLink: (url) => {
        logger.debug(`[Preload] Requesting main process to open external link via IPC: ${url}`);
        // Perform basic URL validation before sending the IPC message
        if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            // Send a one-way message ('send') to the main process on the 'app:open-external-link' channel
            // The main process must have an ipcMain.on('app:open-external-link', ...) listener
            ipcRenderer.send('app:open-external-link', url);
            // Return true to the renderer to indicate the message was successfully sent from preload
            return true;
        } else {
            // Log a warning if the URL format is not as expected
            logger.warn(`[Preload] Invalid URL format, not sending IPC for: ${url}`);
            // Return false to the renderer to indicate the request was not sent due to invalid format
            return false;
        }
    }
    // Example for future IPC:
    // getAppVersion: () => ipcRenderer.invoke('get-app-version'),
};

// --- Expose the defined API to the Renderer process ---
try {
    // Use contextBridge for security - makes 'electronAPI' available on window in the renderer,
    // but only exposes the functions defined above, not the full ipcRenderer or other node modules.
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
    logger.info("Preload script exposed 'electronAPI' successfully.");
} catch (error) {
    // Log any errors that occur during the exposure process
    logger.error("Error exposing API in preload:", error);
}

// --- Optional: Log when the renderer's DOM is ready ---
// This helps confirm the preload script ran before the main renderer script (app.js)
window.addEventListener('DOMContentLoaded', () => {
    logger.info("Renderer DOMContentLoaded. Preload script finished.");
    // You could add checks here like: console.log('Is electronAPI available on DOMContentLoaded?', !!window.electronAPI);
});