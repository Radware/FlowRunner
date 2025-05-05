// preload.js
// Securely expose select Electron APIs (via IPC) to the renderer process

const { contextBridge, ipcRenderer, shell } = require('electron'); // Added shell

console.log("Preload script executing...");

// Define the API object to expose
const electronAPI = {
    // --- File Dialogs ---
    showOpenFile: () => {
        console.log("[Preload] Invoking 'dialog:openFile'");
        return ipcRenderer.invoke('dialog:openFile');
    },
    showSaveFile: (suggestedName) => {
        console.log("[Preload] Invoking 'dialog:saveFile'");
        return ipcRenderer.invoke('dialog:saveFile', suggestedName);
    },

    // --- File System Operations ---
    readFile: (filePath) => {
        console.log("[Preload] Invoking 'fs:readFile' for:", filePath);
        return ipcRenderer.invoke('fs:readFile', filePath);
    },
    writeFile: (filePath, content) => {
        console.log("[Preload] Invoking 'fs:writeFile' for:", filePath);
        return ipcRenderer.invoke('fs:writeFile', filePath, content);
    },

    // --- Add other IPC calls here as needed ---
    // Example: Opening external links securely
    openExternalLink: (url) => {
        // Basic validation: Ensure it's an http/https URL before opening
        if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            console.log(`[Preload] Requesting to open external URL: ${url}`);
            // Use shell.openExternal for security (opens in default browser)
            // No need for IPC for this common, secure pattern.
            shell.openExternal(url);
            return true; // Indicate success
        } else {
            console.warn(`[Preload] Blocked attempt to open invalid external URL: ${url}`);
            return false; // Indicate failure/block
        }
    }

    // Example for future IPC:
    // getAppVersion: () => ipcRenderer.invoke('get-app-version'),
};

// --- MODIFICATION: Commented out the test-only bridge ---
/*
// TEST‑ONLY BRIDGE — let Playwright use Node modules from the renderer
if (process.env.NODE_ENV === 'test' || process.env.E2E) {
    console.log("[Preload] Exposing 'require' via contextBridge for testing..."); // Added log
    contextBridge.exposeInMainWorld('require', require);
}
*/
// --- END MODIFICATION ---

try {
    // Expose the API object under window.electronAPI in the renderer process
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
    console.log("Preload script exposed 'electronAPI' successfully.");
} catch (error) {
    console.error("Error exposing API in preload:", error);
}

// Test communication (optional, remove for production)
window.addEventListener('DOMContentLoaded', () => {
    console.log("Renderer DOMContentLoaded. Preload script finished.");
    // Example: Renderer could check window.electronAPI here
});