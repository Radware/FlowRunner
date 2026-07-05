# FlowRunner v1.4.1

A polish release. Same features as v1.4.0, a calmer surface to run them on, and documentation rewritten for how the app actually works today.

## A quieter, sharper interface

The top bar was doing too much with color. v1.4.1 makes it read like the instrument it is:

- **Save** no longer pulses amber forever. It turns a calm brand blue when you have changes to save, and goes quiet when you don't. The UNSAVED marker carries the urgency.
- In the run cluster, **Run** is now the single accent control. Step, Stop, and Background sit quietly beside it until you reach for them.
- The **run verdict** (Passed, Failed, Running) reads once, boldly, instead of appearing twice.

Color now means something everywhere it appears: green for the run, blue for the primary action, and the four run-state hues reserved for status.

## A roomier inspector

The inspector on the right gained an **expand control** in its header. One click widens it into a real work surface, so editing Variables and Config no longer happens in a narrow column. Click again to return it to normal.

## Documentation that matches the app

The README and the in-app Help have been rewritten around today's interface: the rail, the Flows drawer, the tabbed inspector, the Runs page, Select mode, Present mode, and the command palette. The README now opens with a two-minute quick start and keeps version history at the end, where it belongs. Every feature claim was audited against the code.

## Everything from v1.4.0, unchanged

The multi-entry background-run launcher, the searchable picker that scales to thousands of flows, the folder-based flow manager, per-step retries and assertions, cURL and HAR import, undo/redo, Present mode, and the light and dark themes all carry forward.

## Install

Download the build for your platform:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.4.1.zip` (contains `Setup.exe`)
- **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.4.1.dmg`
- **Linux (x64):** `FlowRunnerSetup-x64-linux-1.4.1.AppImage`

Installing over an earlier version is safe, and every flow you have already made opens unchanged.

---

Built by the Radware ASE Team. Questions or ideas? Open an issue on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
