// main.js
// Electron Main Process for FlowRunner

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs').promises; // Use promises for async file operations

let mainWindow; // Keep a global reference to the window object

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1366, // Start with a decent size
        height: 800,
        webPreferences: {
            // --- Security Best Practices ---
            nodeIntegration: false, // Disable Node.js integration in the renderer process
            contextIsolation: true, // Keep renderer context separate from Electron/Node internal APIs
            // --- Preload Script ---
            preload: path.join(__dirname, 'preload.js') // Path to your preload script
        },
        // This icon setting is ALREADY CORRECT for window icons and potentially
        // the dock icon on non-macOS platforms or after packaging on macOS.
        // Keep this as it is.
        icon: path.join(__dirname, 'assets',
            process.platform === 'darwin' ? 'icon.icns' : // Use .icns for macOS
            process.platform === 'win32' ? 'icon.ico' : // Use .ico for Windows
            'icon.png' // Use .png for Linux/fallback
        )
    });

    // Load your existing index.html file.
    mainWindow.loadFile('index.html');

    // Open the DevTools automatically for debugging during development.
    // Remove or comment this out for production builds.
    mainWindow.webContents.openDevTools();

    // Optional: Create a basic application menu (allows Copy/Paste, Quit etc.)
    const menuTemplate = [
        // ...(your existing menu template)
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            role: 'window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);


    // Emitted when the window is closed.
    mainWindow.on('closed', function () {
        // Dereference the window object
        mainWindow = null;
    });

    console.log('Main window created.');
}

// --- App Lifecycle ---

app.whenReady().then(() => {
    console.log('App ready, creating window...');
    createWindow();

    // --- >>> SET DOCK ICON FOR MACOS DEVELOPMENT <<< ---
    if (process.platform === 'darwin') { // Check if running on macOS
        const iconPath = path.join(__dirname, 'assets', 'icon.icns');
        // Check if the icon file exists before trying to set it
        fs.access(iconPath)
          .then(() => {
            app.dock.setIcon(iconPath);
            console.log(`macOS dock icon set to: ${iconPath}`);
          })
          .catch(err => {
            console.warn(`Dock icon file not found or inaccessible at ${iconPath}:`, err.message);
          });
    }
    // --- >>> END DOCK ICON SETTING <<< ---


    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            console.log('App activated, creating window...');
            createWindow();
        }
    });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') { // 'darwin' is macOS
        console.log('All windows closed, quitting app...');
        app.quit();
    }
});

// --- IPC Handlers ---
// (Keep your existing IPC handlers for dialogs and file system operations)

// Handle request to show 'Open File' dialog
ipcMain.handle('dialog:openFile', async () => {
    // ... your existing handler ...
    console.log('[IPC] Received dialog:openFile');
    if (!mainWindow) {
        console.error('[IPC] Error: Cannot show open dialog, mainWindow is null.');
        return { success: false, error: 'Main window not available' };
    }
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Open Flow File',
            filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }],
            properties: ['openFile']
        });
        if (canceled || filePaths.length === 0) {
            console.log('[IPC] Open dialog cancelled by user.');
            return { success: true, cancelled: true, filePath: null }; // Indicate cancellation clearly
        }
        console.log(`[IPC] File selected: ${filePaths[0]}`);
        return { success: true, cancelled: false, filePath: filePaths[0] }; // Return the selected file path
    } catch (error) {
        console.error('[IPC] Error showing open dialog:', error);
        return { success: false, error: error.message };
    }
});

// Handle request to show 'Save File' dialog
ipcMain.handle('dialog:saveFile', async (event, suggestedName = 'new-flow.flow.json') => {
    // ... your existing handler ...
    console.log(`[IPC] Received dialog:saveFile (suggested: ${suggestedName})`);
    if (!mainWindow) {
         console.error('[IPC] Error: Cannot show save dialog, mainWindow is null.');
        return { success: false, error: 'Main window not available' };
    }
    try {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Flow As',
            defaultPath: suggestedName,
            filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }]
        });
        if (canceled || !filePath) {
            console.log('[IPC] Save dialog cancelled by user.');
            return { success: true, cancelled: true, filePath: null }; // Indicate cancellation
        }
        console.log(`[IPC] File path chosen for save: ${filePath}`);
        return { success: true, cancelled: false, filePath: filePath };
    } catch (error) {
        console.error('[IPC] Error showing save dialog:', error);
        return { success: false, error: error.message };
    }
});

// Handle request to read file content
ipcMain.handle('fs:readFile', async (event, filePath) => {
    // ... your existing handler ...
    console.log(`[IPC] Received fs:readFile for path: ${filePath}`);
    if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Invalid file path provided', path: filePath };
    }
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        console.log(`[IPC] Successfully read file: ${filePath}`);
        return { success: true, data: data, path: filePath };
    } catch (error) {
        console.error(`[IPC] Error reading file ${filePath}:`, error);
        let userMessage = `Failed to read file: ${error.message}`;
        if (error.code === 'ENOENT') { userMessage = `File not found at path: ${filePath}`; }
        else if (error.code === 'EACCES') { userMessage = `Permission denied to read file: ${filePath}`; }
        return { success: false, error: userMessage, code: error.code, path: filePath };
    }
});

// Handle request to write file content
ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
    // ... your existing handler ...
    console.log(`[IPC] Received fs:writeFile for path: ${filePath}`);
     if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Invalid file path provided', path: filePath };
    }
    try {
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[IPC] Successfully wrote file: ${filePath}`);
        return { success: true, path: filePath };
    } catch (error) {
        console.error(`[IPC] Error writing file ${filePath}:`, error);
        let userMessage = `Failed to write file: ${error.message}`;
        if (error.code === 'EACCES') { userMessage = `Permission denied to write file: ${filePath}`; }
        else if (error.code === 'EISDIR') { userMessage = `Cannot write file, path is a directory: ${filePath}`; }
        return { success: false, error: userMessage, code: error.code, path: filePath };
    }
});

console.log('Main process IPC handlers registered.');