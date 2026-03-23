# FlowRunner v1.2.1

FlowRunner v1.2.1 is a hotfix release that fixes a packaging bug preventing the application from functioning on Windows and Linux.

## Key Fix
- **Application startup on all platforms:** Fixed a packaging bug where `transformOps.js` and `harExporter.js` were missing from the build files list in `package.json`. The missing `transformOps.js` (imported by `flowCore.js`, `flowRunner.js`, and `flowStepComponents.js`) caused the renderer process to crash on startup, making all buttons (Open, Save, Run, etc.) non-functional in packaged builds.

## Installation

Download the installer matching your OS:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.2.1.zip`
- **macOS (arm64):** `FlowRunnerSetup-arm64-mac-1.2.1.dmg`
- **Linux (x64):** `FlowRunnerSetup-x64-linux-1.2.1.AppImage`

Follow the same installation steps as previous versions.

## Compatibility

Flows created in earlier versions remain fully compatible with v1.2.1.

---

Thank you for using FlowRunner! Report issues or suggest features on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
