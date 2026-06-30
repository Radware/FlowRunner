# FlowRunner — Project Guide

**FlowRunner** is an Electron desktop app (built by the Radware ASE Team) for visually creating, running, and debugging sequences of API calls ("API Flows"). Three processes — **main** (`main.js`), **preload** (`preload.js`, the `electronAPI` IPC bridge), **renderer** (`app.js` + ES modules: all UI + the execution engine). Targets Windows x64, macOS arm64, Linux x64. Current version: **1.2.1**. Repo: https://github.com/Radware/FlowRunner

## The working bible — read on demand, don't load it all

Detail lives in four focused files so context stays lean. **Load the one you need for the task at hand:**

| File | Read it when… |
|---|---|
| [architecture.md](architecture.md) | You need to know where something lives or how a subsystem works — modules, IPC, flow-file format, variables, execution semantics, build/release, testing. |
| [gotchas.md](gotchas.md) | **Before touching any subsystem.** Traps and time-wasters, by blast radius. |
| [changelog.md](changelog.md) | You need the *why* behind a decision, or you just landed a change (add an entry). |
| [masterplan.md](masterplan.md) | You need the product vision, who it's for, or what's planned next. |

## Maintaining the bible (do this every session, where appropriate)

- **Did something + why?** → add a top entry to [changelog.md](changelog.md) (it's our ADR — decision + rationale, not just the diff).
- **Lost time to something non-obvious / hit a dead-end?** → log it in [gotchas.md](gotchas.md) (symptom → root cause → fix/lesson). This is the highest-value upkeep.
- **Changed a component's role, added/removed a module, changed the flow format or IPC?** → update [architecture.md](architecture.md).
- **Scope/roadmap shifted?** → update [masterplan.md](masterplan.md) (and record *why* in the changelog).

Keep all four concise and robustly clear. Prefer updating an existing entry over adding a near-duplicate.

## Non-negotiables (the two that bite hardest)

1. **`build.files` in `package.json`:** every JS module the app imports MUST be listed, or the *packaged* app crashes silently (never fails in `npm start`). The single most repeated mistake in this project — [gotchas.md](gotchas.md) #1.
2. **Version bump = 8 files in sync:** `package.json`, `config.js`, `main.js`, `help.html`, `harExporter.js`, `README.md`, `release.md`, `release-v{X.Y.Z}.md`. Nothing enforces it — [architecture.md](architecture.md) §9.

## Commands

`npm start` (dev) · `npm test` (Jest+jsdom) · `npm run e2e` (Playwright+Electron) · `npm run dist` (package current platform). Run `npm test` **and** `npm run e2e` before committing. Style: four-space indent, semicolons, ES modules.
