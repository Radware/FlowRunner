// main.js
// Electron Main Process for FlowRunner

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs').promises; // Use promises for async file operations

let mainWindow; // Keep a global reference to the window object

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1366, // From user input
        height: 800, // From user input
        webPreferences: {
            // --- Security Best Practices ---
            nodeIntegration: false, // Disable Node.js integration in the renderer process
            contextIsolation: true, // Keep renderer context separate from Electron/Node internal APIs (default: true)
            // --- Preload Script ---
            preload: path.join(__dirname, 'preload.js') // Path to your preload script (user specified)
        },
        // Set Window Icon (used by OS for window decoration, taskbar, etc.)
        // Electron Forge's packagerConfig.icon is used for the final app icon.
        icon: path.join(__dirname, 'assets',
            process.platform === 'darwin' ? 'icon.icns' : // Use .icns for macOS
            process.platform === 'win32' ? 'icon.ico' : // Use .ico for Windows
            'icon.png' // Use .png for Linux/fallback
        ),
        title: 'FlowRunner' // Initial window title, though index.html's <title> usually takes precedence
    });

    // Load your existing index.html file.
    mainWindow.loadFile('index.html'); // From user input

    // Open the DevTools automatically for debugging during development.
    // Remove or comment this out for production builds.
    // mainWindow.webContents.openDevTools();

    // --- Application Menu ---
    const menuTemplate = [
        // { role: 'appMenu' } on macOS adds standard About, Hide, Quit etc.
        ...(process.platform === 'darwin' ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
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
        // { role: 'fileMenu' }
        {
          label: 'File',
          submenu: [
            // Add relevant file operations if needed (e.g., New, Open, Save)
            // These would trigger IPC calls to your app.js logic
            // Example: { label: 'New Flow', click: () => mainWindow.webContents.send('menu-action', 'new-flow') },
            // { label: 'Open Flow...', click: () => mainWindow.webContents.send('menu-action', 'open-flow') },
            // { label: 'Save Flow', click: () => mainWindow.webContents.send('menu-action', 'save-flow') },
            // { label: 'Save Flow As...', click: () => mainWindow.webContents.send('menu-action', 'save-flow-as') },
            // { type: 'separator' },
            process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
          ]
        },
        // { role: 'editMenu' }
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            ...(process.platform === 'darwin' ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [
                  { role: 'startSpeaking' },
                  { role: 'stopSpeaking' }
                ]
              }
            ] : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' }
            ])
          ]
        },
        // { role: 'viewMenu' }
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
        // { role: 'windowMenu' }
        {
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            ...(process.platform === 'darwin' ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ] : [
              { role: 'close' }
            ])
          ]
        },
        {
          role: 'help',
          submenu: [
            {
              label: 'Learn More', // Example custom help item
              click: async () => {
                const { shell } = require('electron');
                // Replace with your actual help/documentation link
                await shell.openExternal('https://github.com/Radware/FlowRunner#readme');
              }
            }
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

    console.log('Main window created and loaded index.html.');
}

// --- App Lifecycle Events ---

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    console.log('App ready, registering IPC handlers and creating window...');

    // --- Register IPC Handlers ---
    // Handle request to show 'Open File' dialog
    ipcMain.handle('dialog:openFile', async () => {
        console.log('[IPC Main] Received dialog:openFile');
        if (!mainWindow) {
            console.error('[IPC Main] Error: Cannot show open dialog, mainWindow is null.');
            return { success: false, error: 'Main window not available' };
        }
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                title: 'Open Flow File',
                filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }],
                properties: ['openFile']
            });
            if (canceled || filePaths.length === 0) {
                console.log('[IPC Main] Open dialog cancelled by user.');
                return { success: true, cancelled: true, filePath: null }; // Indicate cancellation clearly
            }
            console.log(`[IPC Main] File selected: ${filePaths[0]}`);
            return { success: true, cancelled: false, filePath: filePaths[0] }; // Return the selected file path
        } catch (error) {
            console.error('[IPC Main] Error showing open dialog:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle request to show 'Save File' dialog
    ipcMain.handle('dialog:saveFile', async (event, suggestedName = 'new-flow.flow.json') => {
        console.log(`[IPC Main] Received dialog:saveFile (suggested: ${suggestedName})`);
        if (!mainWindow) {
             console.error('[IPC Main] Error: Cannot show save dialog, mainWindow is null.');
            return { success: false, error: 'Main window not available' };
        }
        try {
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                title: 'Save Flow As',
                defaultPath: suggestedName,
                filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }]
            });
            if (canceled || !filePath) {
                console.log('[IPC Main] Save dialog cancelled by user.');
                return { success: true, cancelled: true, filePath: null }; // Indicate cancellation
            }
            console.log(`[IPC Main] File path chosen for save: ${filePath}`);
            return { success: true, cancelled: false, filePath: filePath };
        } catch (error) {
            console.error('[IPC Main] Error showing save dialog:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle request to read file content
    ipcMain.handle('fs:readFile', async (event, filePath) => {
        console.log(`[IPC Main] Received fs:readFile for path: ${filePath}`);
        if (!filePath || typeof filePath !== 'string') {
            return { success: false, error: 'Invalid file path provided', path: filePath };
        }
        try {
            // Basic path validation (optional, could be stricter)
            // IMPORTANT: Avoid accessing paths outside expected directories in real apps
            const data = await fs.readFile(filePath, 'utf-8');
            console.log(`[IPC Main] Successfully read file: ${filePath}`);
            return { success: true, data: data, path: filePath };
        } catch (error) {
            console.error(`[IPC Main] Error reading file ${filePath}:`, error);
            let userMessage = `Failed to read file: ${error.message}`;
            if (error.code === 'ENOENT') { userMessage = `File not found at path: ${filePath}`; }
            else if (error.code === 'EACCES') { userMessage = `Permission denied to read file: ${filePath}`; }
            return { success: false, error: userMessage, code: error.code, path: filePath };
        }
    });

    // Handle request to write file content
    ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
        console.log(`[IPC Main] Received fs:writeFile for path: ${filePath}`);
         if (!filePath || typeof filePath !== 'string') {
            return { success: false, error: 'Invalid file path provided', path: filePath };
        }
        // IMPORTANT: Add validation here to ensure filePath is in an expected/allowed location
        // Example: Check if it's within app data or user documents, not system directories.
        try {
            await fs.writeFile(filePath, content, 'utf-8');
            console.log(`[IPC Main] Successfully wrote file: ${filePath}`);
            return { success: true, path: filePath };
        } catch (error) {
            console.error(`[IPC Main] Error writing file ${filePath}:`, error);
            let userMessage = `Failed to write file: ${error.message}`;
            if (error.code === 'EACCES') { userMessage = `Permission denied to write file: ${filePath}`; }
            else if (error.code === 'EISDIR') { userMessage = `Cannot write file, path is a directory: ${filePath}`; }
            return { success: false, error: userMessage, code: error.code, path: filePath };
        }
    });

    // --- Create the main window ---
    createWindow();

    // --- Set Dock Icon (macOS Development) ---
    // This helps during `npm start` on macOS. Packaged app uses packagerConfig icon.
    if (process.platform === 'darwin') {
        try {
            const iconPath = path.join(__dirname, 'assets', 'icon.icns');
            // Use synchronous access check here as it's during startup
            fs.accessSync(iconPath);
            app.dock.setIcon(iconPath);
            console.log(`macOS dock icon set for dev: ${iconPath}`);
          } catch (err) {
            console.warn(`Could not set macOS dev dock icon (assets/icon.icns not found or inaccessible): ${err.message}`);
          }
    }

    // --- Handle Activation (macOS) ---
    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            console.log('App activated with no windows open, creating window...');
            createWindow();
        }
    });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') { // 'darwin' is macOS
        console.log('All windows closed, quitting app...');
        app.quit();
    } else {
        console.log('All windows closed on macOS, app remains active.');
    }
});

// In this file you can include the rest of your app's specific main process
// logic. You can also put them in separate files and require them here.
console.log('Main process script loaded.');