# FlowRunner — Gotchas

> Traps, dead-ends, and things that wasted real time. Read this before touching the relevant subsystem; **add to it whenever you lose time to something non-obvious** (symptom → root cause → fix/lesson). Ordered by blast radius.

## Cross-app FlowMap contract (highest blast radius)

The `.flow.json` format is shared by **three independently-versioned apps**: FlowRunner UI (JS), **flowrunner-cli** (`/Users/taly/Development/flowrunner-cli`, Python — runs flows 24/7 in containers, *stricter* parser), and the **ShowRunner Demo-Management-Portal** (`dump/Demo-Management-Portal`, Python + React). A schema change here can silently break the production CLI. See [architecture.md](architecture.md) §4 and [masterplan.md](masterplan.md).

### 0a. Renaming/repurposing a shared field silently breaks the 24/7 CLI
- **Frozen fields — never rename or repurpose in place** (to change, add a *new* field alongside and keep reading the old one): `staticVars` (camelCase; the CLI reads *only* this — a `static_vars` rename emptied all seeded vars in a live incident, portal D-025); the condition wire keys `then`/`else` and loop wire key `steps` (the UI's internal `thenSteps`/`elseSteps`/`loopSteps` must **never** leak to disk — the CLI reads only the aliased wire keys and silently sees empty branches otherwise); `onFailure` (Pydantic-**required** on every request step in the CLI — omitting it hard-fails the whole flow); `type` (CLI discriminated union **rejects** unknown types — stricter than the UI); the `##VAR:type:name##` body markers; the `conditionData` operator vocabulary; the extract namespaces (`body.`/`headers.`/`.status`); the method allow-list.
- **Additive is safe; renames/removals are silently destructive.** The CLI ignores unknown fields (`extra='ignore'`), so new *optional* fields are safe — but no app is a pass-through (unknown fields are dropped on any round-trip through the UI or CLI). New step types / operators must land in the CLI **before** any flow uses them.

### 0b. No `schemaVersion` field exists yet
- Flow files carry no machine-readable version. Every consumer is a tolerant reader that "does something plausible" with a too-new file instead of failing loudly, so a breaking change lands silently in the 24/7 runner. Planned fix (see [masterplan.md](masterplan.md)): add an additive top-level `schemaVersion` now, give the CLI a version-gate (unknown MAJOR ⇒ reject), and make readers skip-unknown-with-warning.

### 0c. Two live cross-app bugs found (in sibling repos, tracked for the ecosystem)
- ShowRunner portal drops camelCase `visualLayout` on flow create/import (needs a `visualLayout`/`visual_layout` fallback like it already has for `staticVars`).
- flowrunner-cli silently downgrades an unknown transform `op` to `base64_decode` (should skip/fail loudly).

## Testing / workflows

### 2d. Workflow worktrees pollute `npm test` (duplicate/failing suites)
- **Symptom:** after a multi-agent `Workflow` with `isolation: 'worktree'`, `npm test` reports a huge count (e.g. 2039 tests / 100 suites) or fails on a path like `.claude/worktrees/wf_.../__tests__/...`.
- **Cause:** each worktree is a full repo checkout under `.claude/worktrees/`; jest's `testMatch` `**/__tests__/**/*.test.js` scans them as extra (often stale) suites; `testPathIgnorePatterns` only excluded `/node_modules/`.
- **Fix:** `jest.config.mjs` now also ignores `/\.claude/` and `/visualizer-island/`. Also **remove worktrees after integrating a wave** — `git worktree remove --force <path>` for each under `.claude/worktrees/`, then `git worktree prune`.

### 2e. Golden/fixture tests must use GIT-TRACKED fixtures
- A conformance test that reads a **gitignored** flow (e.g. `jwt-manipulation-attacks.flow.json`) passes on your working tree but **fails in worktrees/CI** (the file isn't checked out). Use tracked fixtures (`httpbin-flow.flow.json`, `random-ip-example.flow.json`, `__tests__/fixtures/**`).

## Build & packaging

### 1. ⚠️ Missing files in `build.files` silently break packaged builds *(the #1 recurring mistake)*
- **Symptom:** The packaged app launches but appears frozen — no buttons work (Open/Save/Run all dead). **Never reproduces in `npm start`.**
- **Root cause:** A JS module is imported by the app but not listed in `build.files` (`package.json`). The renderer can't load the module graph and dies silently — no event handlers register.
- **History:** Hit at v1.2.1 (`transformOps.js` + `harExporter.js` missing) and repeatedly during the v1.1.1 electron-forge→electron-builder migration (`logger.js`, `config.js`, `app.js`…).
- **Lesson:** **Every JS module the app imports MUST be in `build.files`. Verify in a packaged build (`npm run dist`), not just dev mode.**

### 2. Build was publishing during build / CI action drift (v1.1.1)
- Keep the dist build separate from the publish step (`--publish never`). GitHub Actions occasionally needs action-version bumps. The dist build should never auto-release.

### 2a. Release job: the zip path to `release/` must match the `cd` depth
- **Symptom:** release job fails at "Prepare release assets" — `zip I/O error: No such file or directory` / `Could not create output file (../release/…zip)`, exit 15.
- **Cause:** `mkdir -p release` makes `release/` at the repo root; the Windows step `cd`s **two** levels into `artifacts/windows-latest-build` but wrote to `../release` (one level up = `artifacts/release`, which doesn't exist). Must be `../../release`. (The old portable step `cd`'d three levels and correctly used `../../../release`.)
- **Lesson:** when editing the release-packaging step, the relative path to `release/` must track the `cd` depth. The step runs under `bash -e`, so the **first** failing command aborts it — a good place for a `ls -lh` before the zip to make failures diagnosable.

### 2b. CI trigger model — what builds vs what publishes
- `build.yml` triggers on: **push** to `main`/`master` (builds **and** publishes the release), **pull_request** to `main`/`master` (builds only), and **workflow_dispatch** (manual, any branch — builds only). All three honor `paths-ignore` (`**.md`, `docs/**`, `.vscode/**`, `schemas/**`), so docs/schema-only changes don't build.
- The `release` job is gated `if: github.event_name == 'push' && ref is main/master`, so **only a real push/merge to main publishes** — PR and manual runs never touch the live release (verified: dispatch run → `release` skipped). Build a branch without publishing: `gh workflow run "FlowRunner Build" --ref <branch>`, then `gh run download <run-id>`.
- Trap: `workflow_dispatch`/`pull_request` only work once the workflow file defining them is on the **default branch** — you can't dispatch a trigger that exists only on a feature branch.

### 2c. `npm test` was broken: vendored UMD `require()` under `"type": "module"`
- **Symptom:** every Jest suite fails to load with `Must use import to load ES Module: .../drawflow.min.js` (0 tests run). Went unnoticed because **CI never runs `npm test`** (`build.yml` runs only `npm run dist`).
- **Cause:** `__tests__/setup.js` `require()`s the vendored **UMD** `assets/vendor/drawflow/drawflow.min.js`; the root `package.json` `"type": "module"` makes Node treat that `.js` as ESM, so `require()` throws.
- **Fix:** `assets/vendor/drawflow/package.json` = `{"type": "commonjs"}` scopes only that vendored dir to CJS (the browser loads Drawflow via a `<script>` tag, so runtime is unaffected; the file isn't imported by the app).
- **Note:** fixing this unmasked **4 pre-existing failures in `flowVisualizer.test.js`** (Drawflow drag/double-click/add-step under jsdom). They pre-date the fix — treat as a known follow-up, not a regression.

### 2d. New npm renderer deps must be vendored as ESM + imported by relative path (CSP)
- **Symptom (would-be):** a renderer module `import Fuse from 'fuse.js'` (or `immer`) works in `npm start`/Jest but the **packaged** app can't resolve the bare specifier under `script-src 'self'` (no Node integration in the renderer) — silent module-graph death, dead UI (same failure mode as gotcha #1).
- **Fix (Wave 2 file-features):** vendor the library's **single-file `.mjs`** build under `assets/vendor/<lib>/` and import by **relative path** (`import Fuse from './assets/vendor/fuse/fuse.min.mjs'`). Unlike Drawflow (UMD → needs a `{"type":"commonjs"}` scoping `package.json`), these are already ESM, so no scoping file is needed. Keep the npm package in `dependencies` **only** so Jest's node_modules resolver runs the same source; the packaged app imports the vendored copy, not node_modules. Covered by the existing `assets/**/*` in `build.files` — but the JS modules that import them still need their own `build.files` entries.

### 2e. Undo/redo history: detect a "new flow" by model object identity, not a flag
- **Trap:** wiring `resetFlowHistory()` into every load/create/clone/save-as handler is high-blast-radius across lanes. Instead `flowHistory.js` watches `appState.currentFlowModel` **object identity** in `renderCurrentFlow`: loads reassign the reference (⇒ reset the stack), in-place edits keep it (⇒ snapshot). **Gotcha:** undo/redo also reassigns the reference (it writes a fresh clone), so a `suppressAutoReset` latch tells the *next* render "this is time-travel, not a new flow." That latch **must be cleared on every hard `resetFlowHistory`** or a stale suppress from an interrupted undo makes a subsequent real load fail to reset (surfaced as cross-test history leakage under the shared `appState` singleton in jsdom).

## Execution engine

### 3. `substituteVariablesInStep` depends on being called as a method
- **Trap:** It reads `this.encodeUrlVars` / `this.state` via `this instanceof FlowRunner`. Works only because the runner calls `this.substituteVariablesFn(...)` and `app.js` passes a **bare reference** (no `.bind`). If anyone wraps or binds it, URL-encoding and special-var caching for URLs silently fall back to off/null.

### 4. Duplicate / mis-cased `Content-Type` header (fixed v1.2.0)
- **Symptom:** Requests carried two Content-Type headers when a global header and a step header both set it (esp. different casing).
- **Cause:** `{...globalHeaders, ...headers}` treats `Content-Type` vs `content-type` as distinct keys.
- **Fix/now:** `mergeHeaders` canonicalizes only `content-type` → `Content-Type`; step headers override globals. **Other** headers keep original casing, so differently-cased duplicates of *other* headers can still both survive.

### 5. POST body silently empty when `rawBodyWithMarkers` is null (fixed v1.1.3)
- **Cause:** Body substitution only ran when `rawBodyWithMarkers` was a non-null object; a null marker field skipped the textual `step.body` entirely.
- **Fix/now:** Explicit `hasRawMarkers`/`hasBodyValue` checks + a string-body fallback. Body is only sent for non-GET/HEAD when non-null/undefined; `flowModelToJson` stores a body only if `step.body` is a non-empty trimmed string.

### 6. JSON body validation can throw mid-request
- After unquoted-placeholder replacement, if Content-Type includes `application/json` and the result fails `JSON.parse`, the step throws and returns `error`. An `unquoted` variable that resolves to a string (or undefined→`null`) can produce malformed JSON and abort the request.

### 7. `evaluatePath` implicit-body ambiguity
- For an unprefixed path, `evaluatePath` looks inside `data.body` if a `body` key exists, else in `data` itself. The same extract path can resolve differently depending on whether the object has a `body` property — subtle in nested/loop contexts vs raw responses.

### 8. Full-body extraction used to bloat/duplicate (fixed v1.1.2)
- Extracting `body` produced a huge value containing every response repeated. Fixed by simplifying to a single `evaluatePath(responseOutput, path)` against the full response.

### 9. Condition operator set mismatches between editor and runtime
- `evaluateCondition` (runtime) supports operators (`not_contains`, `is_null`, `is_empty`, `is_object`, `*_or_equal` aliases) that `generateConditionString`/`parseConditionString` (the structured editor) can't produce or round-trip. Hand-edited flows using these **execute** but won't display/preview correctly. Also: `exists` differs — flowCore emits `!= null` (null≈undefined) but runtime defines `exists` as `!== undefined` only, so explicit `null` is treated differently by the two layers.

### 10. Loop source: null is tolerated, non-array is fatal
- `null`/`undefined` source → empty array + warning. A non-array value (object/number) **throws and stops the flow.**

### 11. Other engine fixed-points
- Request timeout is **hardcoded 30s** (not configurable; only inter-step `delay` is). `RANDOM_*` values are cached per exact reference string per run, so the same `{{RANDOM_INT(1,10)}}` yields the same number every appearance in one run.

## State & dirty-flags

### 12. Two dirty flags — both must be checked
- `appState.isDirty` (flow structure) **and** `appState.stepEditorIsDirty` (open editor panel). `setDirty()` ORs them for the Save/Close buttons. Consequence: an unsaved open editor blocks **Close** even when the flow itself is saved. Deleting a step used to leave a phantom `stepEditorIsDirty` (fixed v1.1.2) — clear it on deletion.

### 13. Three different "is dirty?" criteria
- The OS-quit guard (`onCheckDirtyState`) reports `isDirty || stepEditorIsDirty || isContinuousRunActive`, but in-app `confirmDiscardChanges()` / `handleCancelFlow()` check only the first two (continuous-run routes through a separate `confirmStopContinuousRun`). So quitting during a continuous run prompts, but switching flows in-app does not.

### 14. `modelUtils` never sets the dirty flag
- Every mutator (add/move/delete/clone) explicitly comments "do NOT call setDirty here." **The caller must mark the flow dirty** — an easy omission when adding a new code path.

### 15. Save commits the editor by clicking its DOM button
- `saveCurrentFlow` reaches into the DOM (`querySelector('.btn-save-step')`), synthesizes a `.click()`, then re-checks `stepEditorIsDirty` to infer success. Couples file-save to exact CSS class names and to the editor's click handler running synchronously. A markup change or an async editor save silently breaks committing.

## Main process & IPC

### 16. Quit/close silently fails *open* on timeout
- `checkUnsavedChanges()` round-trips to the renderer and resolves `false` (assume clean) after a **1.5s timeout** or if `webContents.send` throws. If the renderer is busy/hung, the app discards unsaved work without prompting.

### 17. `forceQuit` is the only quit gatekeeper, across three handlers
- `window.on('close')`, `app.on('window-all-closed')`, `app.on('before-quit')` all read/mutate a module-global `forceQuit` plus an ad-hoc `app.isQuitting`. The close path sets `forceQuit = true` then re-calls `mainWindow.close()` to re-enter and pass through — a re-entrancy pattern easy to break if any branch forgets the flag.

### 18. IPC registration order is load-bearing
- IPC handlers are registered **inside `app.whenReady()` before `createWindow()`**. Several handlers early-return `{success:false}` if `mainWindow` is falsy.

### 19. preload re-implements the logger and uses a different level source
- preload can't import the ESM `logger.js`, so it duplicates the logic. Its level comes from `process.env.LOG_LEVEL`, **not** `config.js`'s `LOG_LEVEL` — the two can diverge.

### 20. `onCheckDirtyState`/trigger registrars call `removeAllListeners`
- Each enforces a single listener by wiping the channel first. Any other code registering on those channels would be silently removed. Latent now, but a footgun for future listeners.

## File operations

### 21. Variable insertion lost its target (fixed v1.1.2)
- **Symptom:** "Cannot insert variable: Target input is null" in the loop **source** field and other rebuilt editors. **Cause:** a stale reference to a target input that had been re-rendered away. **Fix:** re-find the target at insertion time + de-duplicate dropdown listeners. The captured `targetInput` can still go stale if the editor re-renders between open and insert (`dialogs.js` guards null, not staleness).

### 22. Recent-files reads have write side-effects
- `getRecentFiles()` silently rewrites localStorage when it finds corruption (non-array / invalid entries). Drag-reorder and remove paths write order directly to `RECENT_FILES_KEY` **bypassing** `addRecentFile`, so the `MAX_RECENT_FILES` cap isn't enforced on those paths.

### 23. Circular import: `app.js` ↔ `fileOperations.js`
- `fileOperations` imports `initializeAppComponents` from `app.js`; `app.js` imports many handlers back. Works under ESM live bindings but is fragile to refactors / import-order changes. (`uiUtils.js` also imports `adjustCollapsibleHeight` from `app.js`.)

## UI rendering

### 24. `handleVisualizerNodeLayoutUpdate` must NOT re-render
- A prominent code comment warns: calling `renderCurrentFlow()` here causes node "snap-back" during drag. Easy correctness trap for anyone "tidying" the handler to re-render like the others.

### 25. Duplicated row helpers across two modules
- Both `flowBuilderComponent.js` and `uiUtils.js` define `_addGlobalHeaderRow`/`_addFlowVarRow` that populate the **same** Info-Overlay elements. The builder version attaches local listeners; the uiUtils version deliberately does not (handled globally in `app.js`). Which runs depends on the render path — header/var rows can end up with or without local listeners. Keep the two in sync.

### 26. Full re-render on every change
- `flowBuilderComponent` does `innerHTML = ''` and rebuilds the whole step tree; `flowVisualizer.render` calls `editor.clear()` and rebuilds all nodes/connections (even collapsing one node triggers a full re-render). Re-binds all listeners each time — slow for large flows, and a place where freshly captured DOM refs go stale.

### 27. Drawflow is vendored and worked around heavily
- The visualizer suppresses Drawflow's native Delete/Backspace + context-menu delete, implements its own canvas panning (Drawflow's drag conflicts with node interaction), and sets `zoom_value = 0.1` before `start()`. These are load-bearing hacks against the bundled library; minimap/connector/zoom interaction is historically the most fragile area (~20 stabilization commits in v1.1.1).

### 28. Node-editor modal lives on `<body>` and leaks if `destroy()` is skipped
- It's appended to `document.body`, outside `#flow-visualizer-mount`, and only removed in `destroy()`. An error during `clearWorkspace` would leave it orphaned.

### 29. Native `alert`/`confirm` in editors
- Condition/loop save-validation and cancel/close discard prompts use blocking `alert()`/`confirm()` instead of the app's toast/dialog system — inconsistent UX and harder to test.

### 30. `clearHighlights('active-step')` ignores its argument
- `FlowVisualizer.clearHighlights()` takes no parameter and always clears **all** highlight classes; callers passing `'active-step'` wipe every status highlight, not just the active one.

## Install-time (for users / support)

- **macOS** unsigned build: "damaged" error → `xattr -c /Applications/FlowRunner.app`.
- **Windows** SmartScreen: "More info → Run anyway".
- **Linux** AppImage: `chmod +x` it; needs `--no-sandbox` when run as root.
