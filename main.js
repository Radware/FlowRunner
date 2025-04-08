// main.js
// Include Squirrel startup handling on Windows – if a squirrel event is detected, the app will exit
if (process.platform === 'win32' && require('electron-squirrel-startup')) {
  // electron-squirrel-startup will handle event (create shortcuts, cleanup, etc.) and then quit
  // No need to continue with your normal startup.
  return;
}

const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs').promises;

let mainWindow; // Global reference

// --- Application Information ---
const appName = 'FlowRunner';
const appVersion = '1.0.0';
const appDeveloper = 'Radware ASE Team';
const appCopyright = `Copyright © ${new Date().getFullYear()} Radware.`;
const appWebsite = 'https://github.com/Radware/FlowRunner';
const appDescription = `Developed and maintained by ${appDeveloper}.`;

// --- Function to Create Main Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
      width: 1366,
      height: 800,
      webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
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

  mainWindow.on('closed', function () {
      console.log('Main window closed, dereferencing.');
      mainWindow = null;
  });

  console.log('Main window created and loaded index.html.');
}

// --- Create Application Menu Function ---
function createMenu() {
  const menuTemplate = [
    // macOS App Menu
    ...(process.platform === 'darwin' ? [{
      label: appName,
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
    // Help Menu (with About for Windows/Linux)
    {
      role: 'help',
      submenu: [
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
              detail: `${appDescription}\n${appCopyright}\n\n${appWebsite}`,
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
        },
        { type: 'separator' },
        {
          label: 'Learn More (GitHub)',
          click: async () => {
            await shell.openExternal(appWebsite);
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// --- App Lifecycle Events ---
app.whenReady().then(() => {
  console.log('App ready, setting About panel and creating window...');

  // --- Configure macOS Standard About Panel ---
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  app.setAboutPanelOptions({
    applicationName: appName,
    applicationVersion: appVersion,
    version: appVersion,
    copyright: `${appCopyright}\n${appDescription}`,
    website: appWebsite,
    iconPath: iconPath
  });

  // --- Register IPC Handlers ---

  // --- dialog:openFile Handler (with Debugging) ---
  ipcMain.handle('dialog:openFile', async () => {
      console.log("[IPC Main] Handling 'dialog:openFile'. mainWindow valid?", !!mainWindow);
      if (!mainWindow) {
          console.error("[IPC Main] Error: Main window not available for dialog:openFile");
          return { success: false, error: 'Main window not available' };
      }
      try {
          console.log("[IPC Main] Calling dialog.showOpenDialog...");
          const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Open Flow File',
              filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }],
              properties: ['openFile']
          });
          console.log("[IPC Main] dialog.showOpenDialog result:", JSON.stringify(result)); // Log the raw result

          // Deconstruct AFTER logging
          // Guard against result being undefined or missing properties
          if (!result) {
             console.error("[IPC Main] dialog.showOpenDialog returned undefined or null.");
             return { success: false, error: 'Dialog failed to return a result.' };
          }
          const { canceled, filePaths } = result;

          if (canceled || !filePaths || filePaths.length === 0) {
              console.log("[IPC Main] Dialog cancelled or no file selected.");
              return { success: true, cancelled: true, filePath: null };
          }
          console.log("[IPC Main] File selected:", filePaths[0]);
          return { success: true, cancelled: false, filePath: filePaths[0] };
      } catch (error) {
          console.error('[IPC Main] Error in dialog:openFile handler:', error);
          return { success: false, error: error.message || 'Unknown dialog error' };
      }
  });

  // --- dialog:saveFile Handler (with Debugging) ---
  ipcMain.handle('dialog:saveFile', async (event, suggestedName = 'new-flow.flow.json') => {
      console.log("[IPC Main] Handling 'dialog:saveFile'. mainWindow valid?", !!mainWindow);
      if (!mainWindow) {
          console.error("[IPC Main] Error: Main window not available for dialog:saveFile");
          return { success: false, error: 'Main window not available' };
      }
      try {
          console.log("[IPC Main] Calling dialog.showSaveDialog...");
          const result = await dialog.showSaveDialog(mainWindow, {
              title: 'Save Flow As',
              defaultPath: suggestedName,
              filters: [{ name: 'Flow Files', extensions: ['flow.json'] }, { name: 'All Files', extensions: ['*'] }]
          });
          console.log("[IPC Main] dialog.showSaveDialog result:", JSON.stringify(result)); // Log the raw result

          // Deconstruct AFTER logging
          // Guard against result being undefined or missing properties
          if (!result) {
             console.error("[IPC Main] dialog.showSaveDialog returned undefined or null.");
             return { success: false, error: 'Dialog failed to return a result.' };
          }
          const { canceled, filePath } = result;

          if (canceled || !filePath) {
              console.log("[IPC Main] Save dialog cancelled or no file path returned.");
              return { success: true, cancelled: true, filePath: null };
          }
          console.log("[IPC Main] Save path selected:", filePath);
          return { success: true, cancelled: false, filePath: filePath };
      } catch (error) {
          console.error('[IPC Main] Error in dialog:saveFile handler:', error);
          return { success: false, error: error.message || 'Unknown dialog error' };
      }
  });

  // --- fs:readFile Handler (with Debugging) ---
  ipcMain.handle('fs:readFile', async (event, filePath) => {
      console.log("[IPC Main] Handling 'fs:readFile' for:", filePath);
      if (!filePath || typeof filePath !== 'string') {
          console.error("[IPC Main] Invalid file path provided to fs:readFile:", filePath);
          return { success: false, error: 'Invalid file path provided', path: filePath };
      }
      try {
          console.log("[IPC Main] Calling fs.readFile...");
          const data = await fs.readFile(filePath, 'utf-8');
          console.log("[IPC Main] fs:readFile success for:", filePath);
          return { success: true, data: data, path: filePath };
      } catch (error) {
          let userMessage = `Failed to read file: ${error.message}`;
          if (error.code === 'ENOENT') { userMessage = `File not found at path: ${filePath}`; }
          else if (error.code === 'EACCES') { userMessage = `Permission denied to read file: ${filePath}`; }
          console.error(`[IPC Main] Error reading file ${filePath}:`, error);
          return { success: false, error: userMessage, code: error.code, path: filePath };
      }
  });

  // --- fs:writeFile Handler (with Debugging) ---
  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
      console.log("[IPC Main] Handling 'fs:writeFile' for:", filePath);
      if (!filePath || typeof filePath !== 'string') {
          console.error("[IPC Main] Invalid file path provided to fs:writeFile:", filePath);
          return { success: false, error: 'Invalid file path provided', path: filePath };
      }
      try {
          console.log("[IPC Main] Calling fs.writeFile...");
          await fs.writeFile(filePath, content, 'utf-8');
          console.log("[IPC Main] fs:writeFile success for:", filePath);
          return { success: true, path: filePath };
      } catch (error) {
          let userMessage = `Failed to write file: ${error.message}`;
          if (error.code === 'EACCES') { userMessage = `Permission denied to write file: ${filePath}`; }
          else if (error.code === 'EISDIR') { userMessage = `Cannot write file, path is a directory: ${filePath}`; }
          console.error(`[IPC Main] Error writing file ${filePath}:`, error);
          return { success: false, error: userMessage, code: error.code, path: filePath };
      }
  });

  // --- Create the main window and menu ---
  createWindow();
  createMenu();

  // --- Set Dock Icon (macOS Development) ---
  if (process.platform === 'darwin') {
      try {
          const dockIconPath = path.join(__dirname, 'assets', 'icon.icns');
          fs.accessSync(dockIconPath); // Check if file exists and is accessible
          app.dock.setIcon(dockIconPath);
          console.log(`macOS dock icon set: ${dockIconPath}`);
        } catch (err) {
          console.warn(`Could not set macOS dock icon: ${err.message}`);
        }
  }

  // --- Handle Activation (macOS) ---
  app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) {
          console.log('App activated with no windows open, creating new window...');
          createWindow();
      }
  });
});

// --- Quit Behavior (Platform Specific) ---
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
      console.log('All windows closed on non-macOS, quitting app.');
      app.quit();
  } else {
      console.log('All windows closed on macOS; app remains active.');
  }
});

console.log('Main process script loaded.');