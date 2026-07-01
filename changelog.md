# FlowRunner — Changelog / ADR

> What we shipped and **why** (decisions + rationale). This is our decision record, not just a list of features. **Add an entry at the top whenever you land a meaningful change** — record the decision and the reasoning, not only the diff. Newest first.

**Current version: 1.2.1.** A version bump touches 8 files — see [architecture.md](architecture.md) §9.

> Dating note: README labels (e.g. v1.2.0 "Aug 2025") and git commit dates diverge (the v1.2.0 bump actually landed 2026-01-13, v1.2.1 on 2026-03-23). Git dates are authoritative for when code landed.

---

## Unreleased — CI: Windows release ships the NSIS installer
- **Decision:** the Windows asset (`FlowRunnerSetup-x64-win-{VERSION}.zip`) now contains the electron-builder **NSIS installer** (`FlowRunner Setup {VERSION}.exe`) instead of the zipped `win-unpacked` portable directory. **Why:** `win.target` was already `nsis`, so the installer was being built and then discarded; shipping it gives recipients a real install experience (choose dir, Start-Menu shortcut, uninstaller) — better for handing demo builds to SEs/customers.
- **Fix:** the first CI attempt failed (`zip I/O error`, exit 15) — the zip step wrote to `../release` while two levels deep in `artifacts/windows-latest-build`; corrected to `../../release`. → [gotchas.md](gotchas.md), Build & packaging.
- Shipped as an update to the existing **v1.2.1** release (no version bump).
- **CI trigger overhaul (`build.yml`):** added `paths-ignore` (`**.md`, `docs/**`, `.vscode/**`) so docs-only pushes no longer rebuild; added `workflow_dispatch` (manual, any branch) and `pull_request` triggers so branches build on all three platforms **without publishing**; gated the `release` job to `push` on `main`/`master`. **Why:** CI previously built only on push-to-main with no way to validate a build off `main`, blocking safe testing of dependency upgrades (e.g. the Electron bump). Verified: a `push` run publishes; a `workflow_dispatch` run builds all platforms with `release` **skipped**.

---

## v1.2.1 — Packaging hotfix + Linux *(current; 2026-03-23)*
- **Hotfix:** `transformOps.js` and `harExporter.js` were imported but **missing from electron-builder `build.files`**, crashing the renderer in packaged builds (every button dead; did not reproduce in `npm start`). Fixed in two commits. → see [gotchas.md](gotchas.md) #1, the canonical lesson.
- **Added:** Linux AppImage target + automated GitHub Release.
- **Why:** v1.2.0 shipped broken on Windows/Linux because of the missing-files bug; this release exists to fix it and to bring Linux back (it was dropped from the CI matrix during the v1.1.1 electron-builder migration).

## v1.2.0 — Execution control, navigation & Transform step *(bump 2026-01-13)*
- **Transform step type** (`transformOps.js`): ordered ops (base64/JWT encode-decode, JSON set, math, type conversions) to compute/update variables.
  - **Decision:** chose a fixed transform-op catalog over a full scripting step — gives variable computation **without the security/complexity of arbitrary scripts**. (A scripting step remains a v2.0 aspiration.)
- **HAR export** of results (`harExporter.js`). *(This is the file that wasn't added to `build.files` → forced v1.2.1.)*
- **Navigation/UX:** Auto-Arrange layout; step search with jump-to-list/graph; export results to **JSON/CSV**; Copy cURL (resolves static/runtime/random vars, leaves unknown placeholders readable).
- **Special vars** `RANDOM_INT` and `RANDOM_STRING` (earlier in the cycle: `RANDOM_IP` for random public IPs in headers).
- **Header merging** to dedupe Content-Type — **decision:** normalize the key to canonical `Content-Type` and let step headers override globals (→ [gotchas.md](gotchas.md) #4).
- **Fixes:** Stop now halts step-by-step runs and clears the queued steps; corrected Prev/Next label for the last node; insert-variable button no longer overflows.

## v1.1.3 — POST body hotfix *(2025-11-27)*
- **Fix:** POST requests went out **empty** when `rawBodyWithMarkers` was null but a textual `step.body` existed. Added explicit `hasRawMarkers`/`hasBodyValue` checks + string-body fallback (→ [gotchas.md](gotchas.md) #5).

## v1.1.2 — Usability fixes & default delay *(2025-07-06)*
Each fix had a concrete reported-bug rationale:
- Variable insertion re-finds its target input so "Add Variable" works inside loop-source and other rebuilt editors (fixes "Target input is null") (→ [gotchas.md](gotchas.md) #21).
- Full-body extraction via `body` now captures one whole response object instead of bloating/duplicating.
- Step-deletion no longer leaves a phantom "unsaved changes" warning; loop editor dirty/validation corrected.
- **Default inter-step delay raised to 1000ms** (`DEFAULT_REQUEST_DELAY`) — **why:** smoother demos/observation.

## v1.1.1 — Visual editor & variable enhancements *(2025-06)*
Largest release by commit count (a long string of `codex/*` PRs). Highlights:
- **Graph view:** zoom controls, interactive minimap (viewport + pan/click), Manhattan/orthogonal connector routing, orphan-connector cleanup, zoom-aware node dragging. *(This area needed ~20 stabilization commits — historically the most fragile.)*
- **Variables:** typed global variables (String/Number/Boolean/JSON) with validation; opt-in URL-encoding for variables in URLs (skips absolute URLs to avoid mangling — → [gotchas.md](gotchas.md), encoding).
- **Results panel:** search/filter; extracted-variable display with copy-to-clipboard.
- **Recent flows:** selection no longer jumps to top; drag-and-drop reorder added.
- **Fixes:** global headers were never actually applied to requests (now merged in); 204 No Content handled; info-overlay text-wrap; visual-layout saved correctly.
- **Build decision:** migrated **electron-forge → electron-builder** + GitHub Actions CI matrix. **This migration is the root of the recurring `build.files` problem.** Ubuntu was temporarily dropped from the matrix here (returned in v1.2.1). Build changed to not publish during build, to avoid accidental releases.

## v1.1.0 — Quality, testing & continuous run *(2025-05)*
- **Refactor:** introduced `state.js` and `uiUtils.js` (centralized state + UI utilities).
- **Testing foundation:** Jest + jsdom and Playwright E2E.
- **Continuous run** mode — **decision:** deliberately scoped down from the roadmap's "background/parallel runner" to a simple "run repeatedly in sequence." The main UI is **not** usable during continuous execution and there's no configurable inter-run delay. Docs/UI references to background/parallel execution were removed to avoid over-promising.
- **Update check** — **decision:** non-intrusive; if GitHub is unreachable, do nothing (no popup). Also available manually via Help → Check for Updates. There is no in-app auto-download — it always links to the GitHub release.
- Also: recent-files removal UI, better validation/error messages, keyboard shortcuts.

## v1.0.0 — Initial release *(2025-04)*
- First public release: visual flow authoring (Request/Condition/Loop), dual views (List/Editor + Node-Graph), variable management (static vars, global headers, extraction, `{{var}}` substitution), local `.flow.json` files, recent-files, run/step/stop engine with real-time highlighting.
- **Decisions:**
  - Built on **Electron** for a self-contained, offline, backend-free desktop tool.
  - Targeted **Windows x64 + macOS arm64** at launch (Linux deferred to v1.2.1).
  - **Primary internal motivation:** help Radware SEs/Architects **demonstrate Business Logic Attack Protection** by authoring and visually presenting both legitimate and malicious API sequences (see [masterplan.md](masterplan.md)).
  - Late hardening: tightened CSP (`script-src 'self'`, hence vendored Drawflow), `shell` support in preload, package restructured for builds.
