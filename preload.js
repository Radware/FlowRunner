// preload.js
// Securely expose select Electron APIs (via IPC) to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

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
    // Example:
    // getAppVersion: () => ipcRenderer.invoke('get-app-version'),
};

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