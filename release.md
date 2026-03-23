# FlowRunner v1.2.1 - Hotfix: Packaging Bug on Windows & Linux

FlowRunner v1.2.1 fixes a critical packaging issue that broke the application on Windows and Linux. The HAR exporter module (`harExporter.js`), introduced in v1.2.0, was not included in the build files list, causing the renderer to crash on startup and leaving all UI buttons non-functional.

## Key Fix
- **Application startup on Windows and Linux:** Added the missing `harExporter.js` to the electron-builder file list in `package.json`. Without this file, the `app.js` import failed at load time, preventing all event listeners from being registered.

## Installation Assets

Download the appropriate installer for your operating system:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.2.1.zip` (Contains `Setup.exe`)
- **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.2.1.dmg`
- **Linux (x64):** `FlowRunnerSetup-x64-linux-1.2.1.AppImage`

## Installation Notes & Troubleshooting

These builds remain unsigned. Please follow the same installation procedures as previous versions:

### Windows Installation
1. Download and extract `FlowRunnerSetup-x64-win-1.2.1.zip`
2. Run `Setup.exe`
3. If Windows SmartScreen appears, click "More info" then "Run anyway"
4. The installer runs silently and launches the app automatically

### macOS Installation
1. Download `FlowRunnerSetup-arm64-mac-1.2.1.dmg`
2. Open the DMG and drag FlowRunner to Applications
3. If you see "FlowRunner is damaged" error, run in Terminal:
   ```bash
   xattr -c /Applications/FlowRunner.app
   ```
4. Right-click the app and select "Open" if needed

### Linux Installation
1. Download `FlowRunnerSetup-x64-linux-1.2.1.AppImage`
2. Make the file executable: `chmod +x FlowRunnerSetup-x64-linux-1.2.1.AppImage`
3. Run the AppImage directly

## Upgrade Notes

Flows created in earlier versions remain fully compatible with v1.2.1.

Thank you for using FlowRunner! Report issues or suggest features on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
