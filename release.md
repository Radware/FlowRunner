# FlowRunner v1.4.0

FlowRunner v1.4.0 rebuilds background-run launching so it scales and meets you where you are. Previously the only way to start a background run was a single flow dropdown on the Runs page, which does not work when you have thousands of flows. Now there is one launch action, reachable four ways.

## Launch a background run from anywhere

- **Select many in the sidebar.** Toggle Select mode in the Flows drawer to reveal checkboxes, tick one or many flows (shift-click for a range, right-click for a menu), and a contextual bar offers "Run in background" for the whole selection.
- **Send the flow you are editing.** A quiet Background button in the top run cluster snapshots the current flow (unsaved edits included) into the background while you keep working.
- **The Runs-page picker.** "New background run" opens a searchable modal: type to filter across all your flows, tick as many as you like (your selection is kept even as you refine the search), set Continuous and Delay once, and launch them together.
- **The command palette.** Ctrl/Cmd+K includes "Run flows in background" and "Run current flow in background".

## Built to scale

- The picker searches your recent flows instantly and, once you point it at a flows folder, fuzzy-searches every `.flow.json` under it (tens of thousands supported), rendering the top matches so it stays fast.
- Every launch surface shares one launch routine and one label, so counts and behavior never disagree. Launching many at once is staggered so the live Runs board stays smooth.
- A quick Continuous / Delay popover confirms settings before launch, and remembers your last choice.

## Installation

Download the installer matching your OS:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.4.0.zip` (contains `Setup.exe`)
- **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.4.0.dmg`
- **Linux (x64):** `FlowRunnerSetup-x64-linux-1.4.0.AppImage`

Follow the same installation steps as previous versions.

## Compatibility

Flows created in earlier versions remain fully compatible with v1.4.0.

---

Thank you for using FlowRunner! Report issues or suggest features on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
