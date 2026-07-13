# FlowRunner

![Version](https://img.shields.io/badge/version-1.5.0--beta.1-8b5cf6.svg)

<div align="center" style="margin-bottom: 25px; margin-top: 10px;">
  <div style="display: inline-block; background: #fff; border-radius: 18px; padding: 18px 36px; box-shadow: 0 2px 8px rgba(0,0,0,0.07);">
    <img src="assets/RadwareASETeam.svg" alt="ASE Team Logo" height="100" style="display: block; margin: 0 auto;" />
  </div>
</div>

**Build, run, and *show* sequences of API calls, visually.** FlowRunner is a desktop app for authoring multi-step "API Flows," watching them execute in real time, and presenting them cleanly to a room. It runs on Windows, macOS, and Linux, works fully offline, and keeps everything in plain local files. No account, no backend, no cloud.

Built by the **Radware ASE Team**.

---

## Why FlowRunner

An API story is rarely one call. It is *log in, take the token, place the order, check the balance* — a sequence where each step feeds the next. FlowRunner lets you compose that sequence visually, run it step by step or end to end, and see exactly what happened at each hop.

It was born to **demonstrate Business Logic Attack protection**: an engineer authors both a legitimate and a malicious multi-step sequence, then runs them live in front of a customer to show how the attack unfolds and how the defense responds. That heritage shapes everything, so the run reads as unmistakable **pass / fail / running** from across a lit room, and the interface stays calm enough to project.

**It fits three kinds of work:**

- **Sales Engineers and Architects** demonstrating API behavior and attack/defense scenarios, live.
- **Testers and QA** validating and debugging multi-step API processes.
- **Developers** prototyping or understanding an integration before writing code.

## Highlights

- **Visual authoring** with four step types: **Request**, **Condition** (if/then/else), **Loop** (for-each), and **Transform** (compute variables: base64, JWT, math, JSON edits).
- **Two views, one flow:** a dense **List** editor and an interactive **Visual** node graph, switch anytime.
- **Variables that flow through:** define static variables and global headers, extract values from responses by JSON path, and substitute `{{them}}` anywhere.
- **Run it your way:** whole flow, one step at a time, or continuously, with a live results feed and real-time highlighting in both views.
- **Background runs:** launch one flow or fifty into the background and keep working; monitor them all on a dedicated **Runs** page.
- **Organize at scale:** a folder-based flow manager and a searchable launcher that handles thousands of flows.
- **Interop:** import a request from **cURL** or a whole **HAR** file; copy any step back out as cURL; export results to **JSON / CSV**.
- **Present mode:** a full-screen, projector-tuned view for live demos.
- **Made to feel right:** light and dark themes, a Ctrl/Cmd+K command palette, undo/redo, and keyboard flow throughout.

## Install

Grab the build for your platform from the [Releases page](https://github.com/Radware/FlowRunner/releases/latest):

| Platform | Download | Then |
|---|---|---|
| **Windows** (x64) | `FlowRunnerSetup-x64-win-1.4.1.zip` | Unzip, run `Setup.exe`. If SmartScreen warns (the app is unsigned), choose *More info → Run anyway*. |
| **macOS** (Apple Silicon) | `FlowRunnerSetup-arm64-mac-1.4.1.dmg` | Open the DMG, drag **FlowRunner** to Applications. See macOS note below if it won't open. |
| **Linux** (x64) | `FlowRunnerSetup-x64-linux-1.4.1.AppImage` | `chmod +x` it, then run it. |

Network access is only needed while running flows that call external endpoints. Authoring, saving, loading, and visualizing all work offline.

> **macOS won't open it ("damaged / unidentified developer")?** The app isn't notarized, so macOS quarantines it. Clear the flag once:
> ```bash
> xattr -c /Applications/FlowRunner.app
> ```
> Then right-click the app → **Open** → confirm.

## Quick start: your first flow in two minutes

1. **New Flow.** In the Flows drawer on the left, click **+ New Flow**.
2. **Add a step.** Press **Tab** (or click **+ Add Step**) and choose **API Request**.
3. **Point it somewhere.** In the request bar, keep the method on `GET` and set the URL to `https://httpbin.org/get`. Give the step a name if you like.
4. **Run it.** Click the green **Run** in the top bar (or press **F5**).
5. **Read the result.** The step flashes running, then green. The **Results** tab on the right shows one line: `GET · 200 · … ms · SUCCESS`. Expand it for the full response.

That's a flow. Save it with **Ctrl/Cmd+S** and it becomes a portable `.flow.json` file you can share, version, or run headless with the FlowRunner CLI.

## A tour of the interface

FlowRunner is one window with a few fixed zones:

- **The rail** (far left): switch the Flows drawer, open the command palette, jump to **Runs**, toggle theme, and enter **Present** mode.
- **The top bar:** the flow's name and unsaved marker, save / undo / export controls, the **List / Visual** switch, an ambient engine-status dot, and the **run cluster** on the right, Step, Stop, **Background**, and the one green **Run**.
- **The Flows drawer:** your flow library. Recent files, plus folders and subfolders you arrange yourself (drag a flow onto a folder). Turn on **Select mode** here to pick several flows at once.
- **The workspace** (center): the flow itself, as either the **List** editor or the **Visual** node graph.
- **The inspector** (right): three tabs, **Results** (the run feed), **Variables** (everything defined and extracted, live), and **Config** (flow name, description, global headers, static variables). Need room? Use the expand control in its header to widen it into a work surface.
- **The Runs page:** off the rail, a full board of every background run.

## Building a flow

**Steps** are the building blocks. Add them with **Tab**, reorder by dragging the ☰ handle (List view) or the nodes themselves (Visual view), and edit a step by selecting it.

- **API Request** — method, URL, headers, and a JSON body, each accepting `{{variables}}`. The **Extract** tab pulls values out of the response; the **Options** tab holds per-step **retries** and **on-failure** behavior; **Assertions** let a step pass or fail on its own checks. A **Copy cURL** button on the request bar hands you the equivalent command (to bring one *in*, use **Import cURL** in the Flows drawer).
- **Condition** — branch the flow with if/then/else, comparing a variable against a value.
- **Loop** — repeat a set of steps for each item in an array, exposing the current item as a variable.
- **Transform** — compute or reshape variables between requests: base64 encode/decode, JWT decode, math, JSON set, and more, no scripting.

**Variables** are how steps talk to each other:

- Define **static variables** (typed String / Number / Boolean / JSON) and **global headers** in the **Config** tab.
- **Extract** from any response by path: `.status`, `headers.Content-Type`, `body.user.id`, `body.items[0].name`.
- **Substitute** with `{{name}}` in URLs, headers, bodies, and condition values. In a JSON body, `"{{v}}"` inserts a string while `{{v}}` (no quotes) inserts a number, boolean, or object. The `{{…}}` button inserts any defined name for you.
- Special values are always available: `{{RANDOM_IP}}`, `{{RANDOM_INT}}` (or bound it: `{{RANDOM_INT(1,1000)}}`), and `{{RANDOM_STRING}}` (or size it: `{{RANDOM_STRING(16)}}`).

**Import instead of typing:** paste a **cURL** command to turn it into a request step, or import a **HAR** file to bring in a whole captured session as steps.

## Running a flow

The run cluster in the top bar drives execution:

- **Run** (F5) executes the whole flow, pausing the configured **Delay** between steps so a room can follow along.
- **Step** (F10) advances exactly one step, so you can inspect variables between hops.
- **Stop** (Esc) halts immediately and aborts any in-flight request.
- **Continuous** (in the Results tab) restarts the flow after each finish until you stop it.

As it runs, the current step highlights in both views and the **Results** feed fills with one scannable line per request, name, method, HTTP code in its status color, duration, verdict, expanding on demand to the full output, extracted values, and any assertion or extraction warnings. Export the run to **JSON** or **CSV**.

### Background runs

Some flows should just keep going, a continuous demo, a soak, a background check, while you work on something else. Launch one from wherever you are:

- **The flow you're editing:** the **Background** button in the top run cluster. A quick popover confirms Continuous and Delay, then it runs from a snapshot (your unsaved edits included), and you stay in the editor.
- **Several at once:** turn on **Select mode** in the Flows drawer, tick the flows (Shift-click for a range, right-click for a menu), and run the set.
- **From a big library:** open **Runs** on the rail and click **New background run**, a searchable window that filters your recent flows instantly and, once pointed at a folder, every `.flow.json` beneath it. Tick as many as you like and launch together.
- **By keyboard:** Ctrl/Cmd+K → *Run flows in background*.

Live runs show as chips in the top bar and a badge on the rail. The **Runs** page is the full board: each run's verdict, iteration and pass/fail tallies, a streaming feed, and Stop / Remove. Runs are independent snapshots, so editing a flow never disturbs one already running.

## Present mode

Press the presentation icon on the rail (or **Ctrl/Cmd+Shift+D**) for a full-screen, projector-tuned view: bigger type, bolder run state, less chrome. Built for showing a live flow to a customer without the authoring furniture getting in the way.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Command palette | **Ctrl/Cmd + K** |
| Add a step | **Tab** (or double-click empty canvas) |
| Save / Open flow | **Ctrl/Cmd + S** / **Ctrl/Cmd + O** |
| Undo / Redo | **Ctrl/Cmd + Z** / **Ctrl/Cmd + Shift + Z** |
| Run / Step / Stop | **F5** / **F10** / **Esc** |
| Switch List / Visual | **Ctrl/Cmd + 3** |
| Config / Variables tab | **Ctrl/Cmd + 1** / **Ctrl/Cmd + 2** |
| Present mode | **Ctrl/Cmd + Shift + D** |
| Graph zoom / minimap | **Ctrl/Cmd + + / − / 0** · **M** |
| Help | **F1** |

## The flow file

A flow is a single human-readable **`.flow.json`** file: its steps, variables, headers, per-step options, and (for the graph) node positions. That makes flows easy to share, drop into version control, and run headless, the format is a shared contract with the FlowRunner CLI and the ShowRunner orchestrator. Folder organization lives in a separate workspace file, so moving or renaming a flow file never breaks it. Flows from every earlier version open unchanged.

## Troubleshooting

- **A request fails.** Open its entry in **Results**, it carries the status code, response body, or network error. Check the URL, method, headers, and body (variable substitution included), and the step's **On Failure** setting in Options.
- **`{{variable}}` isn't substituting.** Confirm the name (open the **Variables** tab to see what's actually defined) and that it's set *before* the step uses it. Extraction happens *after* a request completes.
- **Extraction returns nothing.** Verify the JSON path against the real response shown in Results; failed extractions surface as a warning on the step.
- **A Condition or Loop misbehaves.** Check the compared variable's actual value in Results; a Loop's **Source** must resolve to an array.
- **Something looks stuck.** Restart the app. For deeper digging, **View → Toggle Developer Tools** opens the console.

## Development

FlowRunner needs **Node.js 18+**.

```bash
npm ci          # install (or ./setup_env.sh, which also fetches Playwright browsers)
npm start       # run locally
npm test        # unit tests (Jest + jsdom)
npm run e2e     # end-to-end tests (Playwright + Electron)
npm run dist    # package for the current platform
```

Architecture, subsystem notes, and design decisions live in [architecture.md](architecture.md), [gotchas.md](gotchas.md), [changelog.md](changelog.md), and [masterplan.md](masterplan.md).

---

## Release history

### v1.4.1 (July 2026)
- **Calmer chrome.** Save turns brand blue (not pulsing amber) when you have changes; Run is the single accent in the run cluster; the run verdict reads once. Color now means status, action, or run, nothing decorative.
- **Roomier inspector.** An expand control in the inspector header widens it into a work surface for Variables and Config.
- **Docs rewritten** around today's interface (README + in-app Help), audited against the code.

### v1.4.0 (July 2026)
- **Background-run launcher, rebuilt to scale.** Launch flows into the background from four places, all one action: the flow you're editing (top-bar **Background** button + quick config popover), several at once via sidebar **Select mode**, a searchable **Runs-page picker** that scales to tens of thousands of flows via an optional folder scan, and the command palette. One shared launch routine and one count label across every surface.
- **Calmer chrome.** Save turns brand-blue (not pulsing amber) when dirty; Run is the single accent in the run cluster; the run verdict reads once; the inspector gained an expand/work-mode for Variables and Config.

### v1.3.0 (July 2026)
- **Complete UI overhaul ("Sentinel"):** icon rail, top run cluster with live verdict, Flows drawer, tabbed inspector (Results | Variables | Config), OKLCH light/dark themes, command palette, Present mode, first-run onboarding.
- **Background Runs page:** run flows continuously in the background with a live board of tallies and streaming feeds while you keep working.
- **Flow manager:** folders/subfolders in the drawer (sidecar workspace; flow files untouched).
- **Editor & engine:** per-step retries and assertions, Import cURL / HAR, undo/redo, fuzzy search, View-as-JSON, Tidy Up auto-layout, console-style results feed; continuous-run stop fix.

### v1.2.1 (March 2026)
- **Hotfix:** packaged builds crashed on startup because two modules were missing from the build file list. Also added HAR export and the Linux AppImage.

### v1.2.0 (August 2025)
- Stop halts step-by-step runs; Auto Arrange and step search in the graph; export results to JSON/CSV; the **Transform** step type; Copy cURL variable resolution; `RANDOM_INT` / `RANDOM_STRING`.

### v1.1.3 (July 2025)
- Fixed POST requests that could send without their body.

### v1.1.2 (July 2025)
- Loop variable-insertion fixes, better response-body extraction, unsaved-changes fix on delete; default step delay 1000ms.

### v1.1.1 (June 2025)
- Minimap and zoom for large graphs; global-header and variable-type fixes; 204 handling; extracted-variable display with copy; results search; recent-list drag-to-reorder.

### v1.1.0 (May 2025)
- Continuous-run mode, recent-files management, better validation and error messages, update notifications, expanded tests.

### v1.0.0
- First public release: visual authoring, dual views, variables, and local file operations.

---

<div align="center" style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
  <img src="assets/Radware_logo.svg" alt="Radware Logo" height="40">
</div>
