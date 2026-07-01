# FlowRunner — Architecture

> Role & purpose of every component. Read this when you need to know *where* something lives or *how* a subsystem works. For traps and time-wasters see [gotchas.md](gotchas.md); for why things are the way they are see [changelog.md](changelog.md).

## 1. Process model (Electron)

| Process | File | Owns |
|---|---|---|
| **Main** | `main.js` | Windows, native menu/dialogs, filesystem, IPC handlers, app lifecycle, quit guarding |
| **Preload** | `preload.js` | The *only* bridge: exposes a curated `window.electronAPI` via `contextBridge`. Renderer never touches `ipcRenderer` directly |
| **Renderer** | `app.js` + ES modules | All UI, flow authoring, the execution engine. `contextIsolation: true`, `nodeIntegration: false` |

The renderer is sandboxed — every OS operation (file dialogs, `fs`, opening links) is an IPC round-trip to main. Renderer modules load as native ES modules (`"type": "module"`).

## 2. Module reference

### 2a. Plumbing layer (bootstrap, IPC, state, files, events)

| Module | Role |
|---|---|
| `main.js` | Electron main process. Two `BrowserWindow`s (main + help), the app menu, macOS About/dock. Sole arbiter of quit/close — round-trips to the renderer to ask "are you dirty?" before allowing a close. Reads `appVersion` from `package.json` (hardcoded fallback `'1.2.1'`). |
| `preload.js` | The security bridge. Wraps `ipcRenderer.invoke/send/on` into named `electronAPI` methods. Has its own inline logger (cannot import the ESM `logger.js`); validates external-link URLs before forwarding. |
| `config.js` | Constants: `CURRENT_VERSION`, `GITHUB_RELEASES_API`, `RECENT_FILES_KEY`, `MAX_RECENT_FILES` (10), `DEFAULT_REQUEST_DELAY` (1000ms), `LOG_LEVEL`. A version-bump touchpoint. |
| `logger.js` | Four-level (`debug/info/warn/error`) console logger gated by `LOG_LEVEL`. Imported nearly everywhere (except preload). |
| `state.js` | The single source of truth: `appState` (current flow model, file path, selection, view mode, runner, component instances, panel flags, the **two dirty flags**) and `domRefs` (cached DOM elements, populated once). No setters — modules mutate these singletons directly. |
| `domUtils.js` | `initializeDOMReferences()` — populates `domRefs` from ~60 element IDs via `Object.assign` (in place, to preserve the import binding); warns loudly on missing required elements. Called once by `app.js` on `DOMContentLoaded`. |
| `fileOperations.js` | Renderer-side file lifecycle: open/save/save-as/close/cancel/clone, and the recent-files list (localStorage, drag-reorder). Translates `fs` error codes to friendly messages. Enforces discard-changes / stop-continuous-run confirmations. **Circular import with `app.js`** (imports `initializeAppComponents`). |
| `app.js` | Renderer entry point. The single `DOMContentLoaded` handler drives a fixed init order. Exports `initializeAppComponents()` (re-builds builder + visualizer + dialogs on every flow load/new/clone). Owns the global Info-Overlay logic and registers renderer-side IPC listeners. |
| `eventHandlers.js` | `initializeEventListeners()` wires every header/sidebar/runner button + the global keydown shortcuts (all with `?.` optional-chaining so a missing element degrades gracefully). Also hosts the builder/visualizer callback handlers that mutate the model and manage dirty flags. |

### 2b. Flow model & execution engine

| Module | Role |
|---|---|
| `flowCore.js` | Pure (DOM-free) core. Two-way serialization between the in-memory model (`{{var}}` placeholders) and persisted JSON (`##VAR:type:name##` markers). Full structural validation (`validateFlow`), path evaluation (`evaluatePath`), condition string ↔ structured-object conversion, step factories (`createNewStep`), deep clone, recursive `findStepById`. The central dependency. |
| `flowRunner.js` | The execution engine — a stateful `FlowRunner` class. Walks the flow tree using an explicit stack of level frames `{steps, index, context, type}`. Performs `fetch` (30s timeout + `AbortController`), branches, loops, transforms, applies inter-step delay, emits lifecycle callbacks. Does *not* itself substitute variables/evaluate conditions — those are injected functions. |
| `executionHelpers.js` | The injected "brain": `substituteVariablesInStep` (resolves `{{var}}` in URL/headers/body/condition/loop), `substituteVariables` (string-level, with special-var + URL-encode handling), `evaluateCondition` (the runtime operator set), `evaluateVariable`, and the `createFlowRunner` factory. |
| `modelUtils.js` | Step CRUD on `appState.currentFlowModel`: add/nest/insert-after/move (drag-drop, with descendant-cycle guard)/delete/clone/reassign-ids. **Never calls `setDirty` — the caller must.** |
| `transformOps.js` | Portable (browser + Node) transform-op engine. `TRANSFORM_OP_DEFS` registry: base64 encode/decode, jwt encode/decode (HMAC HS256/384/512), json_set, math_add/sub/mul/div, to_number/string/boolean, boolean_not. Resolves `{{ref}}` args via an injected `evaluatePath`. Self-contained (no imports). |
| `utils.js` | Low-level helpers: `sleep`, random generators, and `resolveSpecialVariable` — the "magic" runtime vars `RANDOM_IP`, `RANDOM_INT([min,]max)`, `RANDOM_STRING([len])`. Values are cached per-run so the same reference yields a stable value within one execution. |
| `harExporter.js` | Converts `executionResults` → HAR 1.2. Filters to request steps that produced a response. Timings stubbed (0), sizes `-1`/text-length. `creator.version` hardcoded — a version-bump touchpoint. |

### 2c. UI rendering / view components

| Module | Role |
|---|---|
| `flowBuilderComponent.js` | `FlowBuilderComponent` — the List/Editor view. Owns the "Flow Steps" list + "Step Editor" panel; delegates per-step rendering to `flowStepComponents.js`; drives step search/filter with list/graph jump buttons. Communicates only via `options` callbacks (no direct model mutation). |
| `flowStepComponents.js` | The largest UI file. `renderStep` (collapsed preview card per type, drag-drop) and `createStepEditor` (the full type-specific edit form, used by *both* the builder panel and the visualizer modal). Per-type editors (request tabs: Headers/Body/Extract/Options + Copy cURL; condition builder w/ live preview; loop; transform op list). Manages a step editor's local dirty/Save/Cancel lifecycle. |
| `flowVisualizer.js` | `FlowVisualizer` — the Node-Graph view, built on the vendored **Drawflow** library (`globalThis.Drawflow`). Auto tree layout, role-colored connectors (main/then/else/loop), custom canvas pan, `<canvas>` minimap, collapse/expand subtrees, double-click → node-editor modal (reuses `createStepEditor`), runtime status painting. Persists positions to `flowModel.visualLayout`. |
| `dialogs.js` | The step-type picker (`#step-type-dialog`, exposed globally as `window.showAppStepTypeDialog`) and the variable-insertion dropdown (`#var-dropdown`). One body-level delegated click listener opens the dropdown for any `.btn-insert-var` and inserts `{{varName}}` at the caret. |
| `runnerInterface.js` | The Runner panel. Reads run options (delay, encode-URL, continuous), starts/steps/stops runs, implements the runner's callback contract to render the live results list, highlights steps in both views, exports results to JSON/CSV. |
| `uiUtils.js` | Cross-cutting UI glue. `renderCurrentFlow()` (the top-level orchestrator — picks builder vs visualizer by `appState.currentView`), `setLoading`, `setDirty` (combined dirty logic → file buttons + title), `showMessage` toasts (safe external-link routing), the Variables panel, view-toggle visibility, the pane resizer, the update-info dialog. |
| `appFeatures.js` | Sidebar/runner collapse (persisted to localStorage) and GitHub update checking (`checkForUpdate` silent on startup, `manualCheckForUpdate` interactive). `compareVersions` for dotted-version comparison. |
| `index.html` | Main-window skeleton: 3-column shell (sidebar / workspace / runner), the static mount points (`#flow-builder-mount`, `#flow-visualizer-mount`), and app-global overlays. Strict CSP (`script-src 'self'`) — which is why Drawflow is vendored locally, not from a CDN. |
| `help.html` | Standalone help window (own CSS, no JS). Informational only; its version text is a release touchpoint. |

## 3. IPC channel inventory

**`ipcMain.handle` (request/response, in `main.js`):**
| Channel | Purpose |
|---|---|
| `dialog:openFile` | Native open dialog (filter `*.flow.json`) → `{success, cancelled, filePath}` |
| `dialog:saveFile` | Native save dialog (suggested name) → `{success, cancelled, filePath}` |
| `fs:readFile` | Read UTF-8; maps ENOENT/EACCES/EISDIR/EMFILE/ENFILE to friendly errors |
| `fs:writeFile` | Write UTF-8; maps EACCES/EISDIR/ENOENT/ENOSPC/EROFS |
| `export:har` | Save dialog (`.har`/`.json`), pretty-print + write the supplied HAR |

**`ipcMain.on` / `once`:** `app:open-external-link` (validate http(s) → `shell.openExternal`), `dirty-state-response` (single-shot reply consumed by the quit guard).

**`webContents.send` (main → renderer):** `check-dirty-state`, `trigger-manual-update-check`, `trigger-har-export`.

**`electronAPI` methods (preload):** `showOpenFile`, `showSaveFile(name)`, `readFile(path)`, `writeFile(path, content)`, `onCheckDirtyState(cb)`, `sendDirtyStateResponse(bool)`, `onManualUpdateCheckTrigger(cb)`, `onHARExportTrigger(cb)`, `exportHAR(data)`, `triggerOpenExternalLink(url)`. The three `on*` registrars each call `removeAllListeners` first to enforce a single listener.

## 4. Flow file format (`.flow.json`)

Produced by `flowCore.flowModelToJson`, consumed by `jsonToFlowModel`.

**Top level:** `id?`, `name` (required), `description`, `headers` (global `{key: value}`, applied to every request), `staticVars` (`{key: value}`, seed the runtime context), `steps[]`, `visualLayout` (node positions, opaque to the engine).

**Four step types** (`request`, `condition`, `loop`, `transform`):

- **request** — `method`, `url`, `headers?`, `onFailure` (`stop`|`continue`, default `stop`), `body?` (real JSON containing `##VAR:string:name##` / `##VAR:unquoted:name##` markers — *not* `{{var}}` in the persisted file), `extract?` (`{varName: "body.path"}`; bare `foo` is normalized to `body.foo`). The in-memory model also carries `rawBodyWithMarkers` (marker object) and `body` (a `{{var}}` UI string).
- **condition** — `conditionData` (structured `{variable, operator, value}`, the runtime source of truth), `condition` (a derived JS-like string), `then`/`else` step arrays (internally `thenSteps`/`elseSteps`).
- **loop** — `source` (must resolve to an array), `loopVariable` (default `item`), `steps` (body, internally `loopSteps`).
- **transform** — `ops[]`: each `{op, set, args[], options{}}` writes its result into the variable named by `set`. Op names/args enumerated in `TRANSFORM_OP_DEFS`.

## 5. Variables: substitution & extraction

**Syntax:** `{{var}}`, `{{var.path}}`, `{{arr[0].field}}`. All resolution routes through `flowCore.evaluatePath`.

**Where substitution runs** (`substituteVariablesInStep`): URL (optionally URL-encoded), header *values* (not keys), body (marker-based on `rawBodyWithMarkers`: string markers → quoted, unquoted markers → injected unquoted into the final JSON), condition value, loop source.

**Scoping:** `staticVars` seed the root context → request `extract` writes runtime vars visible to later steps → loop `loopVariable` is set per-iteration on the loop level's (shallow-copied) context.

**Special vars** (`resolveSpecialVariable`, checked before normal lookup): `RANDOM_IP` (one public IPv4 per run), `RANDOM_INT([min,]max)`, `RANDOM_STRING([len])` — cached per exact reference string within a run.

**Extraction** (`_updateContextFromExtraction`): supports `.status`/`$status`, `$headers`, `$body`, `$header.<name>` (case-insensitive), and standard `evaluatePath` paths against the full `{status, headers, body}` response. Missing paths set the var to `undefined` and are recorded as failures (do not by themselves stop the flow).

**URL-encoding** (`safeEncode`, only when the per-field encode option is on): values matching `^https?://` are left untouched; otherwise `encodeURIComponent(decodeURIComponent(v))` to avoid double-encoding. Only URL substitution encodes.

## 6. Execution semantics

- **Stack model:** `state.executionPath` is a stack of level frames `{steps, index, context, type}` (`type`: main/then/else/loop). `_executeCurrentLevel` loops until the stack empties; the index-increment logic accounts for steps that push (condition/loop) or pop (loop end) a level.
- **Delays:** `this.delay` (default 1000ms) applies between steps in a full run (not single-step) and between loop iterations. `_sleep` is stop-aware.
- **Condition:** evaluates `conditionData` → pushes `thenSteps` (TRUE) or `elseSteps` (FALSE); emits a system marker.
- **Loop:** resolves `source` to an array (null/undefined → empty array + warning; non-array → error that stops the flow). `_popExecutionLevel` re-runs the body per item, applying a per-iteration delay; emits Loop Start/Iteration/End markers.
- **Error/stop:** a **request** step error stops the flow only if `onFailure: stop` (default). A **non-request** step error always stops. Any uncaught exception is recorded and triggers `stop()`. `stop()` sets `stopRequested`, clears continuous timers, aborts the in-flight `fetch`. Requests also hard-timeout at 30s.
- **Modes:** full run, single-step, and continuous (reschedules `run()` after `delay` until stopped). Results: each step pushes `{stepId, status, output, error, ...}`; lifecycle callbacks feed the UI.

## 7. UI layout & view modes

**Layout map:** sidebar (`#sidebar`, recent flows — populated by `fileOperations`, collapse by `appFeatures`) · workspace header (file/view controls — `uiUtils`) · Flow Info Overlay (`.flow-info-overlay`, populated by `flowBuilderComponent` + `uiUtils`, listeners in `app.js`) · Variables panel (`uiUtils`) · `#flow-builder-mount` (List/Editor) · `#flow-visualizer-mount` (Node-Graph) · runner panel (`runnerInterface`) · global overlays `#step-type-dialog` / `#var-dropdown` / `#global-loading-overlay` / `#update-info-dialog` · node-editor modal (appended to `<body>` by the visualizer).

**Two views**, tracked by `appState.currentView` (`'list-editor'` | `'node-graph'`). Both mounts exist in the DOM; `renderCurrentFlow` toggles the `active` class so only one shows. Toggle via `#toggle-view-btn` (Ctrl+3). Both are **stateless re-renders from the single `appState.currentFlowModel`** — neither view mutates the model directly (they raise callbacks → `app.js`/`eventHandlers`/`modelUtils` apply changes → re-render), so the two views can never drift. The same `createStepEditor` form is reused by both (builder panel vs visualizer double-click modal). There is no incremental diffing — every change does a full re-render (see [gotchas.md](gotchas.md)).

## 8. Canonical data flow (open a file)

```
Open button → eventHandlers.handleOpenFile() → fileOperations: confirmDiscardChanges()
  → electronAPI.showOpenFile() → ipc 'dialog:openFile' → main: dialog.showOpenDialog
  → filePath back → fileOperations.loadAndRenderFlow(filePath)
  → electronAPI.readFile() → ipc 'fs:readFile' → main: fs.readFile
  → renderer: JSON.parse → jsonToFlowModel → initializeAppComponents → renderCurrentFlow → addRecentFile
```

## 9. Build, packaging & release

- **electron-builder** config lives in `package.json` under `"build"`. Run `npm run dist` to build for the current platform.
- **CRITICAL — `build.files`:** every JS module imported by the app MUST be listed here, or the packaged app crashes silently (renderer fails to load, app looks frozen). Only manifests in packaged builds, never in `npm start`. This is the project's single most repeated mistake — see [gotchas.md](gotchas.md) #1.
- **Targets:** macOS DMG (`FlowRunnerSetup-arm64-mac-{VERSION}.dmg`), Windows **NSIS installer** zipped (`FlowRunner Setup {VERSION}.exe` inside `FlowRunnerSetup-x64-win-{VERSION}.zip`; `win.target: nsis`), Linux AppImage (`-x64-linux-`).
- **CI** (`.github/workflows/build.yml`): macOS + Windows + Ubuntu matrix. Triggers — **push** to `main`/`master` (build **+ publish**), **pull_request** and **workflow_dispatch** (build only, no publish); all honor `paths-ignore` (`**.md`, `docs/**`, `.vscode/**`). The `release` job is gated to push-on-`main`/`master` and creates/updates the GitHub Release tagged `v{VERSION}` from `release.md`. Build a branch without publishing: `gh workflow run "FlowRunner Build" --ref <branch>` → `gh run download <run-id>`.
- **Version bump = update ALL 8 places:** `package.json` · `config.js` (`CURRENT_VERSION`) · `main.js` (`appVersion` fallback) · `help.html` · `harExporter.js` (HAR creator) · `README.md` (badge/changelog/links) · `release.md` (CI release body) · `release-v{X.Y.Z}.md`. Nothing enforces agreement — hand-sync carefully.

## 10. Development & testing

- **Prereqs:** Node 18+, `npm ci`. First E2E run: `npx playwright install --with-deps`.
- **Commands:** `npm start` (dev) · `npm test` (Jest + jsdom) · `npm run e2e` (Playwright + Electron, `xvfb-run` on Linux) · `npm run dist` (package). Run both `npm test` and `npm run e2e` before committing.
- **Style:** four-space indent, semicolons, ES modules throughout.
- **Test coverage today:** Jest unit tests for `flowCore` (id gen, model↔JSON, variable extraction, `evaluatePath`, `validateFlow`, body JSON validation, marker pre/decode, step CRUD, condition helpers) and `flowRunner` (state, sequential/condition/loop execution, extraction, substitution, onFailure stop/continue, Stop+fetch-abort, delay); component render tests; IPC/file-I/O integration tests; E2E flows (simple-request, ui-interactions drag/drop, complex flow-execution, step-through). Manual regression cases for v1.2.0 features are listed in [masterplan.md](masterplan.md).
