# Sprint Status & Handoff — Roadmap + UX Overhaul

> Read this first when resuming the sprint in a new session. It records **what is done and verified**, **what is NOT done** (honestly), and **how to pick up**. The plan is [sprint-plan.md](sprint-plan.md); the rationale is [flowmap-evolution.md](flowmap-evolution.md) and [engine-decision.md](engine-decision.md).

## Where we are

- **Branch:** `sprint/roadmap-ux-overhaul` — 30 commits off `main`, **not yet merged**. Live until fully done + verified.
- **Gates:** `npm test` → **476 passing / 29 suites**. Packaged build (all 3 OSes) → **green** (incl. the React-island Vite build via the `predist` hook). Backward-compat locked by golden tests on both the JS and Python sides.
- **New deps:** `elkjs`, `@dagrejs/dagre`, `electron-store`, `fuse.js`, `immer`. **New modules:** `autoLayout.js`, `workspaceManager.js`, `palette.js`, `jsonView.js`, `flowHistory.js`, `importCurlHar.js`+`importCurlHarUI.js`, `demoMode.js`, `firstRun.js`, `reactFlowVisualizer.js`, `visualizer-island/` (Vite React app → `assets/visualizer-island/`). All in `build.files`.

## ✅ Done & verified

**Wave 1 — foundations:** OKLCH design-token layer + projector light-default theme ([design-tokens.md](design-tokens.md)); elkjs/dagre auto-layout adapter (`autoLayout.js`); `electron-store` recent-files + sidecar `.flowrunner/workspace.json` workspace model; FlowVisualizer contract-as-tested-port ([visualizer-contract.md](visualizer-contract.md)); additive optional `schemaVersion` + tolerant readers + conformance fixtures ([schema-versioning.md](schema-versioning.md)).

**Wave 2 — build-on:** one-click **Tidy Up** (elkjs, FLIP-animated, Cmd+Z undo) + **on-node error badges** + jump-to-failed; inline **Basic/Power inspector**; reusable **Tab/Cmd+K palette** + **View-as-JSON**; **Fuse.js fuzzy search** + **immer undo/redo**; request **retries/backoff** (additive `step.retries`) + zero-dep **cURL/HAR import**.

**Wave 3 — engine + features:** per-step **assertions** + pass/fail run summary (reuses `conditionData` operators; additive `step.assertions[]`); **Demo Mode** + guided first-run; `schemaVersion:"1.0"` **stamped on save** (additive, lossless); **React Flow island** (flag-gated, `@xyflow/react` via Vite, CSP-clean, behind the contract facade — Drawflow stays default).

**Cross-app (the guarantee you asked about):** an old flow runs **identically** after all of this — verified by `__tests__/goldenOldFlow.test.js` (JS) and `test_golden_old_flow.py` (CLI). **flowrunner-cli [PR #36](https://github.com/rdwr-taly/flowrunner-cli/pull/36)** adds the schemaVersion MAJOR version-gate (rejects only unknown MAJOR; absent/1.x always accepted) + `step.retries` + assertions, golden-test-first.

**Verified live in a browser preview** (Waves 1-3 UI all render): theme, import buttons, inspector Basic/Power, assertions editor, Copy cURL, step search, node graph + minimap + Tidy Up toolbar, Demo Mode, first-run onboarding, runner + results.

## ⚠️ NOT done — the next sprint's work (honest gaps)

1. **THE VISUAL OVERHAUL IS NOT ACTUALLY APPLIED — top priority.** Wave 1 only restyled *proof surfaces* (header, primary button, status pip) and explicitly deferred the full restyle; the **styles.css token migration** (legacy `--primary-color` etc. → OKLCH semantic tokens) — the half of the crashed schema-token lane that was deferred — is undone. **Result: the app still largely looks like the old basic UI.** Next sprint must (a) finish the token migration so the *whole* app is token-driven, (b) apply a bold modern redesign using the `impeccable` + `ui-ux-pro-max` skills (layout, hierarchy, spacing, motion, the projector Demo aesthetic), (c) make dark mode fully consistent. This is the headline.
2. **React Flow island renders chrome but 0 nodes** from a real flow model — `visualizer-island/src/flowModelAdapter.js` needs dogfooding against the app's actual model shape. Also: the island `<script>` URL needs **cache-busting by app version**. The mount bug (Vite `process.env`) is fixed (gotcha 2f) and it packages; keep it **off-by-default** until it renders nodes + passes an SE beta, then flip.
3. **Wave 4 (the "Later" bucket)** — subflows (pointer ref, gated on *deployed* CLI + shared fixtures), environments/secrets, one canonical schema validated by ajv+jsonschema across all 3 repos, node-graph visual language (glyph-chip node types on the new engine).
4. **Cross-repo not fully closed:** CLI PR #36 needs review+merge; the **ShowRunner portal** must also honor `step.assertions`/`step.retries` (not yet PR'd).
5. **Minor loose ends:** a Cmd+Z overlap (tidy-undo vs flow-undo, both guarded); no Settings-UI engine toggle (localStorage-only); the deferred legacy-var retirement in styles.css.
6. **Not merged to `main`** — the sprint branch hasn't shipped. Merging = a version bump (8-file sync, [architecture.md](../architecture.md) §9) + release.

## How to resume in a new session

```bash
git checkout sprint/roadmap-ux-overhaul && git pull
npm ci                 # installs elkjs/dagre/electron-store/fuse.js/immer + island build deps
npm test               # expect 476 passing
npm run build:island   # builds assets/visualizer-island/ (React island)
```
- **Preview the UI:** `.claude/launch.json` has a `flowrunner-web` config (python http.server :8899) — the renderer runs in a browser in degraded mode (no `electronAPI`; file ops disabled, everything visual works). A real Chrome (claude-in-chrome MCP) at desktop width is the better view.
- **Read:** this file, [sprint-plan.md](sprint-plan.md) (waves/ordering), [flowmap-evolution.md](flowmap-evolution.md) (proposal), [engine-decision.md](engine-decision.md) (React-Flow migration plan).
- **Suggested next sprint order:** (Wave 3.5 — the visual overhaul) finish token migration → bold redesign via impeccable/ui-ux-pro-max → Demo-mode polish → fix the island node-adapter + flip it on → then Wave 4.
