# FlowRunner v1.3.0

FlowRunner v1.3.0 is the largest release since 1.0: a complete visual and structural overhaul of the app ("Sentinel" shell), a new Background Runs page for running flows continuously while you keep working, a folder-based flow manager, per-step retries and assertions, cURL/HAR import, undo/redo, a command palette, and dozens of fixes — including several that made core features unusable in packaged builds.

## The new shell
- **Redesigned layout:** icon rail, top app bar with a dedicated run cluster (Run / Step / Stop + live verdict), a Flows drawer, and a tabbed inspector (Results | Variables | Config). Global Headers and Flow Variables moved out of "Info" into Config, where configuration belongs.
- **Design system:** a full OKLCH token system with light (projector-tuned) and dark themes; a theme toggle lives on the rail. Run-state colors are consistent across the list view, graph view, minimap, and topbar.
- **Command palette:** Ctrl/Cmd+K for commands and recent flows; Tab (or double-click empty canvas) for a searchable add-step palette.
- **Present mode** (formerly Demo Mode, Ctrl/Cmd+Shift+D): a full-screen projector view of a live flow.
- **First-run onboarding** with dismissible coach-marks and helpful empty states.

## Background Runs (new)
- A dedicated **Runs page** on the left rail (with a live-count badge): launch one or more flows — the current one or any recent flow file — as background runs, continuously or once, and monitor them all on a live board (per-run verdict, iteration/pass/fail tallies, streaming request feed, Stop/Remove).
- Runs execute a **snapshot** of the flow, so you can keep editing (and even run flows in the foreground) while they work. Live runs also appear as ticking chips in the top bar.

## Editor & engine
- **Flow manager:** organize flows into folders and subfolders in the drawer (drag to file); folder structure lives in a sidecar workspace, never in your `.flow.json` files.
- **Per-step retries** (count + delay) and **per-step assertions** with a pass/fail run summary.
- **Import cURL** (paste a command → request step) and **Import HAR** (file → request steps); Copy cURL and Export HAR round out the interop story.
- **Undo/redo** across flow edits (Ctrl/Cmd+Z / Shift+Z); fuzzy search over recent files and steps; read-only **View-as-JSON** with diff.
- **Tidy Up** auto-layout for the graph view (ELK-powered), minimap theming, and per-node runtime instrument chips (status · duration · extracted vars).
- **Results feed redesign:** compact console-style rows (name · method · HTTP code · duration · verdict) that expand automatically only when something needs attention.
- **Engine fixes:** stopping a continuous run between iterations now completes immediately (previously it could leave the UI "running" forever); clearer failure messages; a user stop is reported as STOPPED, not FAILED.

## Fixes worth calling out
- **Import cURL was dead in packaged builds** (`window.prompt` is unsupported in Electron) — replaced with in-app dialogs.
- **Native confirm/alert dialogs could freeze the renderer** — replaced with in-app promise-based dialogs throughout.
- **Tidy Up failed in packaged builds** (bare module specifiers) — layout engines are now vendored.
- Flow format remains **fully backwards compatible**: new fields (`schemaVersion`, `step.retries`, `step.assertions`) are additive and optional; flows from earlier versions run identically.

## Installation

Download the installer matching your OS:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.3.0.zip` (contains `Setup.exe`)
- **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.3.0.dmg`
- **Linux (x64):** `FlowRunnerSetup-x64-linux-1.3.0.AppImage`

Follow the same installation steps as previous versions.

## Compatibility

Flows created in earlier versions remain fully compatible with v1.3.0.

---

Thank you for using FlowRunner! Report issues or suggest features on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
