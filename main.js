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
  // mainWindow.webContents.openDevTools();

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

  // Register IPC Handlers …
  // (Your ipcMain.handle code for dialogs and filesystem operations remains as it is.)
  ipcMain.handle('dialog:openFile', async () => { /*...*/ });
  ipcMain.handle('dialog:saveFile', async (event, suggestedName = 'new-flow.flow.json') => { /*...*/ });
  ipcMain.handle('fs:readFile', async (event, filePath) => { /*...*/ });
  ipcMain.handle('fs:writeFile', async (event, filePath, content) => { /*...*/ });

  createWindow();
  createMenu();

  // macOS: Set Dock Icon if available
  if (process.platform === 'darwin') {
    try {
      const dockIconPath = path.join(__dirname, 'assets', 'icon.icns');
      fs.accessSync(dockIconPath);
      app.dock.setIcon(dockIconPath);
      console.log(`macOS dock icon set: ${dockIconPath}`);
    } catch (err) {
      console.warn(`Could not set macOS dock icon: ${err.message}`);
    }
  }

  // Handle app activation (macOS)
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      console.log('App activated with no windows open, creating new window...');
      createWindow();
    }
  });
});

// Quit behavior for non-macOS platforms
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    console.log('All windows closed on non-macOS, quitting app.');
    app.quit();
  } else {
    console.log('All windows closed on macOS; app remains active.');
  }
});

console.log('Main process script loaded.');
