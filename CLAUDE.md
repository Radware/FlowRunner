# FlowRunner - Project Guide

## Overview

FlowRunner is an Electron desktop application for visually creating, managing, running, and debugging sequences of API calls ("API Flows"). Built by the Radware ASE Team. Targets Windows (x64), macOS (Apple Silicon/arm64), and Linux (x64).

Repository: https://github.com/Radware/FlowRunner

## Architecture

### Process Model (Electron)

- **Main process** (`main.js`): Window management, native dialogs (`dialog.showOpenDialog`, `dialog.showSaveDialog`), file system operations, IPC handler registration, application menu, and lifecycle events.
- **Preload** (`preload.js`): Bridges main and renderer via `contextBridge.exposeInMainWorld('electronAPI', ...)`. Uses `ipcRenderer.invoke()` for request/response and `ipcRenderer.send()` for one-way messages.
- **Renderer** (`app.js` + modules): All UI logic, flow authoring, execution engine. Loaded as ES modules (`"type": "module"` in package.json).

### Key Renderer Modules

| Module | Responsibility |
|---|---|
| `app.js` | Entry point; DOMContentLoaded init, component wiring, overlay logic |
| `state.js` | Centralized `appState` and `domRefs` objects |
| `eventHandlers.js` | All UI event listener registration (buttons, keyboard shortcuts) |
| `fileOperations.js` | Open/save/close/recent files; calls `electronAPI` for dialogs and fs |
| `flowCore.js` | Flow model utilities, validation, template creation, JSON conversion |
| `modelUtils.js` | Step CRUD operations on the flow model (add, delete, move, clone) |
| `executionHelpers.js` | Flow runner engine, variable substitution, condition evaluation |
| `runnerInterface.js` | Runner UI callbacks, result rendering, export to JSON/CSV |
| `flowBuilderComponent.js` | List/editor view component |
| `flowVisualizer.js` | Node-graph view component (canvas-based) |
| `uiUtils.js` | DOM helpers: `setLoading`, `setDirty`, `showMessage`, `renderCurrentFlow` |
| `domUtils.js` | `initializeDOMReferences()` — populates `domRefs` from DOM IDs |
| `harExporter.js` | Generates HAR 1.2 format from execution results |
| `appFeatures.js` | Sidebar/runner collapse, update checking |
| `dialogs.js` | Step type selection dialog, variable dropdown, variable insertion |
| `config.js` | Constants: `CURRENT_VERSION`, `GITHUB_RELEASES_API`, recent files config |
| `logger.js` | Logging utility with configurable levels |

### Data Flow for File Operations

```
User clicks "Open" button
  -> eventHandlers.js: handleOpenFile()
  -> fileOperations.js: confirmDiscardChanges(), then window.electronAPI.showOpenFile()
  -> preload.js: ipcRenderer.invoke('dialog:openFile')
  -> main.js: ipcMain.handle('dialog:openFile') -> dialog.showOpenDialog(mainWindow, ...)
  -> Returns filePath back through the chain
  -> fileOperations.js: loadAndRenderFlow(filePath)
  -> preload.js: ipcRenderer.invoke('fs:readFile', filePath)
  -> main.js: fs.readFile(filePath)
  -> Renderer parses JSON, updates appState, renders UI
```

## Version Management

**When releasing a new version, ALL of these must be updated:**

1. `package.json` — `"version"` field
2. `config.js` — `CURRENT_VERSION` constant
3. `main.js` — `appVersion` default value
4. `help.html` — Application Version display text
5. `harExporter.js` — HAR creator version
6. `README.md` — Badge, changelog, prerequisites link, installation download links
7. `release.md` — Detailed GitHub release body (used by CI workflow)
8. `release-v{X.Y.Z}.md` — Short release notes file

The CI workflow (`.github/workflows/build.yml`) reads the version from `package.json` and uses `release.md` as the GitHub release body.

## Build & Packaging

**electron-builder** config lives in `package.json` under `"build"`.

### Critical: `build.files` Array

Every JS module imported by the app MUST be listed in `build.files`. Missing files will cause the packaged app to crash silently (the renderer fails to load, no event handlers are registered, and the app appears frozen). This only manifests in packaged builds, not in `npm start`.

**Lesson learned (v1.2.1):** `harExporter.js` was added and imported in `app.js` but not added to `build.files`, breaking Windows and Linux packaged builds entirely.

### Build Targets

- macOS: DMG (`FlowRunnerSetup-arm64-mac-{VERSION}.dmg`)
- Windows: NSIS installer, zipped as portable (`FlowRunnerSetup-x64-win-{VERSION}.zip`)
- Linux: AppImage (`FlowRunnerSetup-x64-linux-{VERSION}.AppImage`)

### CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`):
- Triggers on push to `main`/`master`
- Builds on macOS, Windows, and Ubuntu matrix
- Creates GitHub Release with tag `v{VERSION}`, uploads all platform installers
- Uses `release.md` as the release body

## Development

### Prerequisites
- Node.js 18+
- `npm ci` to install dependencies

### Commands
- `npm start` — Run locally in dev mode
- `npm test` — Unit tests (Jest, jsdom)
- `npm run e2e` — End-to-end tests (Playwright + Electron)
- `npm run dist` — Build packaged app for current platform

### Code Style
- Four-space indentation
- Semicolons at end of statements
- ES modules throughout (both main and renderer)
- `contextIsolation: true`, `nodeIntegration: false` in renderer

### Testing
- Unit tests: Jest with jsdom environment
- E2E tests: Playwright with Electron support (uses `xvfb-run` on Linux)
- Before committing: run both `npm test` and `npm run e2e`

## Flow File Format

Flows are saved as `.flow.json` files. Key structure:
- `name`, `description` — Flow metadata
- `headers` — Global headers (key-value object)
- `staticVars` — Flow-level variables (key-value, typed)
- `steps[]` — Ordered array of step objects (request, condition, loop, transform)
- `visualLayout` — Node positions for graph view

## Common Pitfalls

1. **Packaged build vs dev mode**: Always verify that new files are in `build.files`. Dev mode (`npm start`) doesn't use this list.
2. **IPC registration order**: IPC handlers in `main.js` must be registered before `createWindow()` is called (they are registered inside `app.whenReady()`).
3. **Dirty state**: Two flags — `appState.isDirty` (flow structure) and `appState.stepEditorIsDirty` (editor panel). Both must be checked for save/close guards.
4. **Platform-specific code**: macOS uses sheets for dialogs and has dock icon handling. Windows/Linux use separate dialog windows. Linux AppImage needs `--no-sandbox` when running as root.
