# FlowRunner v1.4.0

**Run any flow, from anywhere, at any scale.**

FlowRunner v1.4.0 is about one thing: getting a flow running should never make you hunt. Whether you are mid-edit, staring at a list of five flows or fifty thousand, you now start a background run in a single, obvious gesture, and keep working while it runs.

This release also lands a quiet but deliberate polish pass on the app chrome, so the whole surface reads like the instrument it is.

## Launch a background run from wherever you already are

Background runs let a flow (or many flows) execute continuously in the background while you keep authoring, watching, and presenting. In 1.4.0 there is one action, "run in the background," and it meets you in four places:

- **The flow you are editing.** A **Background** button in the top run cluster snapshots the current flow, unsaved edits and all, and launches it. A quick popover lets you confirm Continuous and Delay first. You never leave your editor.
- **The sidebar, one or many at a time.** Flip on **Select mode** to reveal checkboxes, tick the flows you want (Shift-click for a range, right-click for a menu), and run the whole set together.
- **The Runs page picker.** "New background run" opens a searchable window. Type to filter, tick as many flows as you like, and launch them at once. Your selection survives as you refine the search, so nothing gets lost.
- **The command palette.** Press Ctrl/Cmd+K and choose "Run flows in background."

Every one of those doors runs the same launch, shows the same count, and reports the same way, so they can never disagree.

## Built for thousands of flows, not dozens

The old single dropdown fell apart the moment your flow library grew. The new picker searches your recent flows instantly, and when you point it at a folder it fuzzy-searches every `.flow.json` beneath it, tens of thousands supported, showing the best matches so it stays fast even at scale. Recently and frequently run flows rise to the top automatically.

## Watch it all on the Runs page

Live runs surface as ticking chips in the top bar and a badge on the left rail. Open the **Runs** page for the full board: per-run verdicts, iteration and pass/fail tallies, a streaming request feed, and Stop or Remove on each. Start one flow, open another, launch that too, and keep editing a third. They coexist without stepping on each other.

## A calmer, sharper surface

We took a hard look at the chrome and removed the noise:

- The **Save** button no longer pulses amber forever; it turns a calm brand blue when you have changes to save.
- In the run cluster, **Run** is now the single accent control; Step, Stop, and Background sit quietly beside it until you reach for them.
- The **run verdict** (Passed, Failed, Running) reads once, boldly, instead of twice.
- The **inspector** gained an expand control, so you can give Variables and Config real room to work when you need it.

## Everything from 1.3.0, still here

The Sentinel interface, the folder-based flow manager, per-step retries and assertions, cURL and HAR import, undo/redo, the command palette, Present mode, and the light and dark themes all carry forward unchanged.

## Install

Download the build for your platform:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.4.0.zip` (contains `Setup.exe`)
- **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.4.0.dmg`
- **Linux (x64):** `FlowRunnerSetup-x64-linux-1.4.0.AppImage`

Installing over an earlier version is safe. Your flows are untouched, and files from every previous release open in v1.4.0 without changes.

---

Built by the Radware ASE Team. Questions, ideas, or a flow that misbehaved? Open an issue on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
