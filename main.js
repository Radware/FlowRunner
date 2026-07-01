// ========== FILE: main.js (FULL, UNABRIDGED, UPDATED with IPC Handler) ==========
// Include Squirrel startup handling on Windows – if a squirrel event is detected, the app will exit
// Note: Consider using electron-squirrel-startup as a dependency instead of manual check if using Squirrel.Windows maker extensively.
// if (process.platform === 'win32' && require('electron-squirrel-startup')) {
//   // electron-squirrel-startup will handle event (create shortcuts, cleanup, etc.) and then quit
//   // No need to continue with your normal startup.
//   app.quit(); // Explicitly quit after squirrel handling
//   return;
// }

import { logger } from './logger.js';
import { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell } from 'electron'; // <= ENSURE shell is imported here
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import {
    STORE_NAME, STORE_RECENT_FILES_KEY, MAX_RECENT_FILES,
    WORKSPACE_DIR, WORKSPACE_FILE
} from './config.js';
import { parseWorkspace, serializeWorkspace } from './workspaceManager.js';

// ------------------------------------------------------------------
// Provide a CommonJS‑style `require` helper for Playwright E2E tests
// (ESM in the main process means `require` is normally undefined).
// ------------------------------------------------------------------
import { createRequire } from 'node:module';
if (process.env.E2E || process.env.NODE_ENV === 'test') {
  // `createRequire()` gives us a `require` whose resolution is
  // relative to this file; exposing it globally lets the
  // Electron‑main‑process code that Playwright executes via
  // `electronApp.evaluate()` access CommonJS modules without using
  // dynamic `import()`, which is blocked inside VM contexts.
  global.require = createRequire(import.meta.url);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow running Electron as root in headless environments
if (process.platform === 'linux' && process.getuid && process.getuid() === 0) {
    app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow; // Global reference
let helpWindow = null; // Keep track of the help window
let forceQuit = false; // Flag to bypass prompts if user confirmed quit

// ------------------------------------------------------------------
// Persistent settings + recent-files (electron-store) and the sidecar
// workspace model. `store` is created lazily on first use so importing
// this module (e.g. under Jest) never touches the filesystem.
// ------------------------------------------------------------------
let store = null;
function getStore() {
    if (!store) {
        // electron-store persists JSON under app.getPath('userData').
        store = new Store({ name: STORE_NAME });
    }
    return store;
}

/** Read the persisted recent-files list (array of absolute paths). */
function readRecentFiles() {
    const list = getStore().get(STORE_RECENT_FILES_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.filter(p => typeof p === 'string' && p.trim().length > 0);
}

/** Persist the recent-files list (already ordered, most-recent-first). */
function writeRecentFiles(list) {
    getStore().set(STORE_RECENT_FILES_KEY, Array.isArray(list) ? list : []);
    return readRecentFiles();
}

/** Add/promote a path to the top of the recent-files list, capped at MAX. */
function addRecentFilePath(filePath) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        return readRecentFiles();
    }
    const current = readRecentFiles().filter(p => p !== filePath);
    current.unshift(filePath);
    return writeRecentFiles(current.slice(0, MAX_RECENT_FILES));
}

/** Absolute path to the sidecar workspace file under the user data dir. */
function workspaceFilePath() {
    return path.join(app.getPath('userData'), WORKSPACE_DIR, WORKSPACE_FILE);
}

/** Load + normalize the sidecar workspace (empty workspace if none/corrupt). */
async function readWorkspace() {
    const target = workspaceFilePath();
    try {
        const raw = await fs.readFile(target, 'utf-8');
        return parseWorkspace(raw);
    } catch (error) {
        if (error && error.code !== 'ENOENT') {
            logger.warn(`[Workspace] Failed to read ${target}, using empty workspace:`, error.message);
        }
        return parseWorkspace(null);
    }
}

/** Persist the sidecar workspace (normalized) atomically-ish to disk. */
async function writeWorkspace(workspace) {
    const target = workspaceFilePath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, serializeWorkspace(workspace), 'utf-8');
    return parseWorkspace(workspace);
}

// Helper function to ask renderer if there are unsaved changes
async function checkUnsavedChanges() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.info('[Main checkUnsavedChanges] No main window or destroyed, assuming no unsaved changes.');
    return false;
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn('[Main checkUnsavedChanges] Timeout waiting for dirty-state-response.');
      ipcMain.removeListener('dirty-state-response', specificHandler); // Clean up listener
      resolve(false); // Assume not dirty or error on timeout
    }, 1500); // 1.5 second timeout

    const specificHandler = (event, isDirty) => {
      clearTimeout(timeout);
      logger.info('[Main] Received dirty-state-response from renderer:', isDirty);
      resolve(isDirty);
    };
    // Use once for a single response per request
    ipcMain.once('dirty-state-response', specificHandler);

    logger.info('[Main] Sending check-dirty-state to renderer');
    try {
      mainWindow.webContents.send('check-dirty-state');
    } catch (error) {
      logger.error('[Main checkUnsavedChanges] Error sending check-dirty-state to renderer:', error);
      clearTimeout(timeout);
      ipcMain.removeListener('dirty-state-response', specificHandler);
      resolve(false); // Assume not dirty if renderer is gone
    }
  });
}

// --- Application Information ---
const appName = 'FlowRunner';
// Try reading version from package.json
let appVersion = '1.2.1'; // Default version (Ensure this matches your actual package.json)
try {
    const packageJsonPath = path.join(__dirname, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    appVersion = packageJson.version || appVersion;
} catch (err) {
    logger.warn("Could not read version from package.json:", err.message);
}

const appDeveloper = 'Radware ASE Team';
const appCopyright = `Copyright © ${new Date().getFullYear()} Radware.`;
const appWebsite = 'https://github.com/Radware/FlowRunner';
const appReadmeLink = `${appWebsite}/blob/main/README.md`; // Link directly to README
const appDescription = `Developed and maintained by ${appDeveloper}.`;

// --- Function to Create Main Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
      width: 1366,
      height: 800,
      webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js') // Ensure this path is correct
      },
      icon: path.join(__dirname, 'assets',
          process.platform === 'darwin' ? 'icon.icns' :
          process.platform === 'win32' ? 'icon.ico' :
          'icon.png'
      ),
      title: appName
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment to automatically open DevTools

  mainWindow.on('close', async (event) => {
    logger.info(`[Main window.on('close')] Triggered. forceQuit: ${forceQuit}`);
    if (forceQuit) {
      logger.info('[Main window.on(close)] forceQuit is true, allowing window to close.');
      return; // Let the window close normally
    }

    event.preventDefault(); // Crucial: Prevent immediate close

    const isDirty = await checkUnsavedChanges();
    if (isDirty) {
      logger.info('[Main window.on(close)] Unsaved changes detected.');
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Discard Changes & Close Window'],
        defaultId: 0,
        cancelId: 0,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Do you want to close this window?',
        detail: 'Any unsaved changes will be lost if you close.'
      });

      if (response === 1) { // User chose "Discard Changes & Close Window"
        logger.info('[Main window.on(close)] User chose to discard and close window.');
        forceQuit = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        }
      } else {
        logger.info('[Main window.on(close)] User chose to cancel window close.');
        forceQuit = false;
      }
    } else {
      logger.info('[Main window.on(close)] No unsaved changes, proceeding to close/quit.');
      forceQuit = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
      }
    }
  });

  mainWindow.on('closed', function () {
      logger.info('[Main window.on(closed)] Window is now closed.');
      mainWindow = null;
  });

  logger.info('Main window created and loaded index.html.');
}

// --- Function to Create/Show Help Window ---
function createHelpWindow() {
    if (helpWindow && !helpWindow.isDestroyed()) {
        helpWindow.focus();
        return;
    }

    helpWindow = new BrowserWindow({
        width: 900,
        height: 750,
        title: `${appName} Help (v${appVersion})`,
        parent: mainWindow, // Optional: Make it a child window
        modal: false,      // Not modal, allow interaction with main window
        resizable: true,
        minimizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true, // Keep true for security best practices
            // No preload needed for static help page
        },
        icon: path.join(__dirname, 'assets',
            process.platform === 'darwin' ? 'icon.icns' :
            process.platform === 'win32' ? 'icon.ico' :
            'icon.png'
        ),
    });

    helpWindow.loadFile(path.join(__dirname, 'help.html')); // Load the help file

    // Remove the default menu bar for the help window
    helpWindow.setMenuBarVisibility(false);

    helpWindow.on('closed', () => {
        helpWindow = null; // Dereference the window object
    });

    // Open external links from help page in default browser
    helpWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Ensure only safe protocols are opened externally
        if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
            shell.openExternal(url);
        }
        return { action: 'deny' }; // Prevent Electron from creating new windows for links
    });
}

// --- Create Application Menu Function ---
function createMenu() {
  const menuTemplate = [
    // macOS App Menu
    ...(process.platform === 'darwin' ? [{
      label: appName,
      submenu: [
        { role: 'about' }, // Uses app.setAboutPanelOptions
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // File Menu
    {
      label: 'File',
      submenu: [
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit Menu (Standard)
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ...(process.platform === 'darwin'
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }])
      ]
    },
    // View Menu (Standard)
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window Menu (Standard)
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        ...(process.platform === 'darwin' ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }] : [{ role: 'close' }])
      ]
    },
    // Help Menu
    {
      role: 'help',
      submenu: [
        {
          label: 'View Help',
          accelerator: 'F1',
          click: () => { createHelpWindow(); }
        },
        {
          label: 'Check for Updates...',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              logger.info('[Main] Triggering manual update check via IPC.');
              mainWindow.webContents.send('trigger-manual-update-check');
            } else {
                logger.info('[Main] Cannot check for updates, main window not available.');
                 dialog.showMessageBox(null, {
                    type: 'info',
                    title: 'Check for Updates',
                    message: 'Please open the main application window before checking for updates.',
                    buttons: ['OK']
                });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Export HAR File...',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              logger.info('[Main] Triggering HAR export via IPC.');
              mainWindow.webContents.send('trigger-har-export');
            } else {
                logger.info('[Main] Cannot export HAR, main window not available.');
                 dialog.showMessageBox(null, {
                    type: 'info',
                    title: 'Export HAR File',
                    message: 'Please open the main application window before exporting HAR file.',
                    buttons: ['OK']
                });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Learn More (GitHub)',
          click: async () => {
            await shell.openExternal(appWebsite);
          }
        },
        // Conditionally add the 'About' item for non-macOS platforms
        ...(process.platform !== 'darwin' ? [
          { type: 'separator' },
          {
            label: 'About ' + appName,
            click: () => {
              const iconPath = path.join(__dirname, 'assets', 'icon.png');
              let iconImage = null;
              try {
                iconImage = nativeImage.createFromPath(iconPath);
                if (!iconImage.isEmpty()) {
                  iconImage = iconImage.resize({ width: 64, height: 64 });
                } else { iconImage = null; console.warn("About dialog icon is empty or could not be loaded:", iconPath); }
              } catch (err) { iconImage = null; console.warn("Could not load icon for About dialog:", err.message); }

              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'About ' + appName,
                message: `${appName} - Version ${appVersion}`,
                detail: `${appDescription}\n${appCopyright}\n\nFor more details, visit:\n${appWebsite}`,
                buttons: ['OK', 'Visit Website'],
                defaultId: 0,
                cancelId: 0,
                ...(iconImage && { icon: iconImage })
              }).then(result => {
                if (result.response === 1) {
                  shell.openExternal(appWebsite);
                }
              }).catch(err => console.error("Error showing/handling About dialog:", err));
            }
          }
        ] : [])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// --- App Lifecycle Events ---
app.whenReady().then(async () => {
  logger.info('App ready, setting About panel and creating window...');

  // Configure macOS Standard About Panel
  if (process.platform === 'darwin') {
      const iconPath = path.join(__dirname, 'assets', 'icon.icns');
      try {
          await fs.access(iconPath);
          app.setAboutPanelOptions({
              applicationName: appName,
              applicationVersion: appVersion,
              version: appVersion,
              copyright: `${appCopyright}\n${appDescription}`,
              website: appWebsite,
              iconPath: iconPath
          });
          logger.info("macOS About Panel options set.");
      } catch (err) {
          logger.warn("Could not set macOS About Panel icon, file might be missing:", err.message);
          app.setAboutPanelOptions({
              applicationName: appName,
              applicationVersion: appVersion,
              version: appVersion,
              copyright: `${appCopyright}\n${appDescription}`,
              website: appWebsite
          });
      }
  }

  // --- Register IPC Handlers ---

  // Handle request for open file dialog
  ipcMain.handle('dialog:openFile', async () => {
      logger.info("[IPC Main] Handling 'dialog:openFile'. mainWindow valid?", !!mainWindow);
      if (!mainWindow) {
          logger.error("[IPC Main] Error: Main window not available for dialog:openFile");
          return { success: false, error: 'Main window not available' };
      }
      try {
          logger.debug("[IPC Main] Calling dialog.showOpenDialog...");
          const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Open Flow File',
              filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }],
              properties: ['openFile']
          });
          logger.debug("[IPC Main] dialog.showOpenDialog result:", JSON.stringify(result));

          if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
              logger.info("[IPC Main] Dialog cancelled or no file selected.");
              return { success: true, cancelled: true, filePath: null };
          }
          logger.info("[IPC Main] File selected:", result.filePaths[0]);
          return { success: true, cancelled: false, filePath: result.filePaths[0] };
      } catch (error) {
          logger.error('[IPC Main] Error in dialog:openFile handler:', error);
          return { success: false, error: error.message || 'Unknown dialog error' };
      }
  });

  // Handle request for save file dialog
  ipcMain.handle('dialog:saveFile', async (event, suggestedName = 'new-flow.flow.json') => {
      logger.info("[IPC Main] Handling 'dialog:saveFile'. mainWindow valid?", !!mainWindow);
      if (!mainWindow) {
          logger.error("[IPC Main] Error: Main window not available for dialog:saveFile");
          return { success: false, error: 'Main window not available' };
      }
      try {
          logger.debug("[IPC Main] Calling dialog.showSaveDialog...");
          const result = await dialog.showSaveDialog(mainWindow, {
              title: 'Save Flow As',
              defaultPath: suggestedName,
              filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }]
          });
          logger.debug("[IPC Main] dialog.showSaveDialog result:", JSON.stringify(result));

          if (!result || result.canceled || !result.filePath) {
              logger.info("[IPC Main] Save dialog cancelled or no file path returned.");
              return { success: true, cancelled: true, filePath: null };
          }
          logger.info("[IPC Main] Save path selected:", result.filePath);
          return { success: true, cancelled: false, filePath: result.filePath };
      } catch (error) {
          logger.error('[IPC Main] Error in dialog:saveFile handler:', error);
          return { success: false, error: error.message || 'Unknown dialog error' };
      }
  });

  // Handle request to read a file
  ipcMain.handle('fs:readFile', async (event, filePath) => {
      logger.info("[IPC Main] Handling 'fs:readFile' for:", filePath);
      if (!filePath || typeof filePath !== 'string') {
          logger.error("[IPC Main] Invalid file path provided to fs:readFile:", filePath);
          return { success: false, error: 'Invalid file path provided. Please select a valid file.', path: filePath };
      }
      try {
          logger.debug("[IPC Main] Calling fs.readFile...");
          const data = await fs.readFile(filePath, 'utf-8');
          logger.info("[IPC Main] fs:readFile success for:", filePath);
          return { success: true, data: data, path: filePath };
      } catch (error) {
          let userMessage = `Failed to read file: ${error.message}`;
          // Provide more user-friendly messages based on error codes
          if (error.code === 'ENOENT') userMessage = `File not found at path: ${filePath}.`;
          else if (error.code === 'EACCES') userMessage = `Permission denied to read file: ${filePath}.`;
          else if (error.code === 'EISDIR') userMessage = `Cannot open file: ${filePath} is a directory.`;
          else if (error.code === 'EMFILE' || error.code === 'ENFILE') userMessage = `Too many files open.`;
          logger.error(`[IPC Main] Error reading file ${filePath}:`, error);
          return { success: false, error: userMessage, code: error.code, path: filePath };
      }
  });

  // Handle request to write a file
  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
      logger.info("[IPC Main] Handling 'fs:writeFile' for:", filePath);
      if (!filePath || typeof filePath !== 'string') {
          logger.error("[IPC Main] Invalid file path provided to fs:writeFile:", filePath);
          return { success: false, error: 'Invalid file path provided.', path: filePath };
      }
      try {
          logger.debug("[IPC Main] Calling fs.writeFile...");
          await fs.writeFile(filePath, content, 'utf-8');
          logger.info("[IPC Main] fs:writeFile success for:", filePath);
          return { success: true, path: filePath };
      } catch (error) {
          let userMessage = `Failed to write file: ${error.message}`;
          // Provide more user-friendly messages based on error codes
          if (error.code === 'EACCES') userMessage = `Permission denied to write file: ${filePath}.`;
          else if (error.code === 'EISDIR') userMessage = `Cannot write file: ${filePath} is a directory.`;
          else if (error.code === 'ENOENT') userMessage = `File path not found or invalid: ${filePath}.`;
          else if (error.code === 'ENOSPC') userMessage = `No space left on device.`;
          else if (error.code === 'EROFS') userMessage = `Cannot write file: The destination is read-only.`;
          logger.error(`[IPC Main] Error writing file ${filePath}:`, error);
          return { success: false, error: userMessage, code: error.code, path: filePath };
      }
  });

  // --- Recent Files (persisted via electron-store) ---

  // Return the persisted recent-files list.
  ipcMain.handle('store:getRecentFiles', async () => {
      try {
          return { success: true, recentFiles: readRecentFiles() };
      } catch (error) {
          logger.error('[IPC Main] Error in store:getRecentFiles:', error);
          return { success: false, error: error.message, recentFiles: [] };
      }
  });

  // Add/promote a path to the top of the recent-files list.
  ipcMain.handle('store:addRecentFile', async (event, filePath) => {
      try {
          return { success: true, recentFiles: addRecentFilePath(filePath) };
      } catch (error) {
          logger.error('[IPC Main] Error in store:addRecentFile:', error);
          return { success: false, error: error.message, recentFiles: readRecentFiles() };
      }
  });

  // Remove a single path from the recent-files list.
  ipcMain.handle('store:removeRecentFile', async (event, filePath) => {
      try {
          const next = readRecentFiles().filter(p => p !== filePath);
          return { success: true, recentFiles: writeRecentFiles(next) };
      } catch (error) {
          logger.error('[IPC Main] Error in store:removeRecentFile:', error);
          return { success: false, error: error.message, recentFiles: readRecentFiles() };
      }
  });

  // Replace the recent-files list wholesale (e.g. after a drag-reorder).
  ipcMain.handle('store:setRecentFiles', async (event, list) => {
      try {
          const clean = Array.isArray(list)
              ? list.filter(p => typeof p === 'string' && p.trim().length > 0).slice(0, MAX_RECENT_FILES)
              : [];
          return { success: true, recentFiles: writeRecentFiles(clean) };
      } catch (error) {
          logger.error('[IPC Main] Error in store:setRecentFiles:', error);
          return { success: false, error: error.message, recentFiles: readRecentFiles() };
      }
  });

  // Clear the recent-files list.
  ipcMain.handle('store:clearRecentFiles', async () => {
      try {
          return { success: true, recentFiles: writeRecentFiles([]) };
      } catch (error) {
          logger.error('[IPC Main] Error in store:clearRecentFiles:', error);
          return { success: false, error: error.message, recentFiles: readRecentFiles() };
      }
  });

  // --- Sidecar Workspace (folders/tags/category referencing flows by path) ---

  // Load the sidecar workspace model.
  ipcMain.handle('workspace:load', async () => {
      try {
          return { success: true, workspace: await readWorkspace() };
      } catch (error) {
          logger.error('[IPC Main] Error in workspace:load:', error);
          return { success: false, error: error.message, workspace: parseWorkspace(null) };
      }
  });

  // Persist the sidecar workspace model. The renderer owns the mutations
  // (via workspaceManager.js) and sends the full workspace object to save.
  ipcMain.handle('workspace:save', async (event, workspace) => {
      try {
          return { success: true, workspace: await writeWorkspace(workspace) };
      } catch (error) {
          logger.error('[IPC Main] Error in workspace:save:', error);
          return { success: false, error: error.message };
      }
  });

  // +++ IPC LISTENER FOR OPENING EXTERNAL LINKS +++
  ipcMain.on('app:open-external-link', (event, urlToOpen) => {
      logger.info(`[IPC Main] Received 'app:open-external-link' request for: ${urlToOpen}`);
      // Validate the URL format for security before opening
      if (typeof urlToOpen === 'string' && (urlToOpen.startsWith('http:') || urlToOpen.startsWith('https://'))) {
          try {
              // Use the shell module imported in the main process
              shell.openExternal(urlToOpen);
              logger.info(`[IPC Main] shell.openExternal called successfully for: ${urlToOpen}`);
              // Note: shell.openExternal is async but we don't typically wait for it here.
              // We don't send a response back for this simple action.
          } catch (error) {
              logger.error(`[IPC Main] Error calling shell.openExternal for ${urlToOpen}:`, error);
              // Optionally, send an error message back to the renderer if needed
              // mainWindow?.webContents.send('app:open-external-error', urlToOpen, error.message);
          }
      } else {
          logger.warn(`[IPC Main] Blocked attempt to open invalid external URL via IPC: ${urlToOpen}`);
          // Optionally send feedback
          // mainWindow?.webContents.send('app:open-external-error', urlToOpen, 'Invalid URL format');
      }
  });
  // +++ END IPC LISTENER +++

  // Handle request to export HAR file
  ipcMain.handle('export:har', async (event, harData) => {
      logger.info("[IPC Main] Handling 'export:har'");
      if (!mainWindow) {
          logger.error("[IPC Main] Error: Main window not available for export:har");
          return { success: false, error: 'Main window not available' };
      }
      try {
          // Generate suggested filename with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
          const suggestedName = `flow-export-${timestamp}.har`;

          logger.debug("[IPC Main] Calling dialog.showSaveDialog for HAR export...");
          const result = await dialog.showSaveDialog(mainWindow, {
              title: 'Export HAR File',
              defaultPath: suggestedName,
              filters: [
                  { name: 'HAR Files', extensions: ['har'] },
                  { name: 'JSON Files', extensions: ['json'] },
                  { name: 'All Files', extensions: ['*'] }
              ]
          });

          if (!result || result.canceled || !result.filePath) {
              logger.info("[IPC Main] HAR export dialog cancelled.");
              return { success: true, cancelled: true };
          }

          const filePath = result.filePath;
          logger.info("[IPC Main] Exporting HAR to:", filePath);

          // Write HAR data with pretty printing
          const harContent = JSON.stringify(harData, null, 2);
          await fs.writeFile(filePath, harContent, 'utf-8');

          logger.info("[IPC Main] HAR export successful");
          return { success: true, cancelled: false, filePath: filePath };
      } catch (error) {
          logger.error('[IPC Main] Error in export:har handler:', error);
          return { success: false, error: error.message || 'Failed to export HAR file' };
      }
  });

  // --- Create the main window and menu ---
  createWindow();
  createMenu();

  // --- Set Dock Icon (macOS Production/Packaged App) ---
  if (process.platform === 'darwin' && !process.env.ELECTRON_DEV) {
      (async () => {
          try {
              const dockIconPath = path.join(app.getAppPath(), '..', 'assets', 'icon.icns');
              await fs.access(dockIconPath);
              app.dock.setIcon(dockIconPath);
              logger.info(`macOS production dock icon set: ${dockIconPath}`);
          } catch (err) {
              logger.warn(`Could not set macOS production dock icon: ${err.message}`);
              try {
                   const fallbackIconPath = path.join(__dirname, 'assets', 'icon.icns');
                   await fs.access(fallbackIconPath);
                   app.dock.setIcon(fallbackIconPath);
                   logger.info(`macOS production dock icon set (fallback): ${fallbackIconPath}`);
              } catch (fallbackErr) {
                  logger.warn(`Could not set macOS production dock icon (fallback): ${fallbackErr.message}`);
              }
          }
      })();
  }

  // --- Handle Activation (macOS) ---
  app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) {
          logger.info('App activated with no windows open, creating new window...');
          createWindow();
      } else if (mainWindow && !mainWindow.isVisible()) {
          mainWindow.show();
      } else if (mainWindow) {
          mainWindow.focus();
      }
  });
});

// --- Quit Behavior (Platform Specific) ---
app.on('window-all-closed', function () {
  logger.info(`[Main app.on('window-all-closed')] Triggered. forceQuit: ${forceQuit}`);
  if (process.platform !== 'darwin' || forceQuit) {
      logger.info('All windows closed, quitting app (non-macOS or forceQuit=true).');
      app.quit();
  } else {
      logger.info('All windows closed on macOS; app remains active (forceQuit=false).');
      if (!app.isQuitting) {
        forceQuit = false;
      }
  }
});

app.on('before-quit', async (event) => {
  logger.info(`[Main app.on('before-quit')] Triggered. forceQuit: ${forceQuit}`);
  if (forceQuit) {
      logger.info('[Main before-quit] Force quitting enabled, proceeding to quit.');
      app.isQuitting = true;
      return;
  }

  logger.info('[Main before-quit] Intercepted quit, checking for unsaved changes.');
  event.preventDefault();
  app.isQuitting = false;

  const isDirty = await checkUnsavedChanges();
  if (isDirty) {
      logger.info('[Main before-quit] Unsaved changes detected.');
      const windowToShowDialog = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      const { response } = await dialog.showMessageBox(windowToShowDialog, {
          type: 'warning',
          buttons: ['Cancel', 'Discard Changes & Quit'],
          defaultId: 0,
          cancelId: 0,
          title: 'Unsaved Changes',
          message: 'You have unsaved changes. Are you sure you want to quit?',
          detail: 'Any unsaved changes will be lost.'
      });

      if (response === 1) {
          logger.info('[Main before-quit] User chose to discard and quit.');
          forceQuit = true;
          app.isQuitting = true;
          app.quit();
      } else {
          logger.info('[Main before-quit] User chose to cancel quit.');
          forceQuit = false;
          app.isQuitting = false;
      }
  } else {
      logger.info('[Main before-quit] No unsaved changes, proceeding to quit.');
      forceQuit = true;
      app.isQuitting = true;
      app.quit();
  }
});

logger.info('Main process script loaded.');
