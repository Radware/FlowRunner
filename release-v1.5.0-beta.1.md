# FlowRunner v1.5.0-beta.1 — AI Copilot (Beta)

The first beta of the 1.5 line. FlowRunner gains an **AI copilot that runs entirely on your machine**: no cloud, no API keys, no account, and nothing you send it ever leaves your laptop. It is off by default, one click to enable, and every suggestion it makes lands in a normal editor for you to review. The model never saves anything.

## An assistant that lives on your machine

Enable it from the ✨ button in the rail. FlowRunner downloads the model you pick into its own app-data folder and runs it locally with llama.cpp. Three models are on the menu, all Apache 2.0 licensed:

- **Gemma 4 E2B** (default) — ~3.1 GB download, wants 8 GB RAM. The balanced all-rounder.
- **Qwen 3 4B Instruct** — ~2.5 GB, 8 GB RAM. The cleanest structured output for its size.
- **Gemma 4 E4B** — ~5 GB, 16 GB RAM. Best quality, for machines with headroom.

After the download, everything works offline. The model loads on first use and quietly unloads after five minutes idle.

## What it can do

- **Suggest extractions** from the response a step actually returned — one click fills the extraction row.
- **Suggest assertions** the same way, grounded in the real response body.
- **Turn plain English into a condition** ("the transfer was forbidden" binds to the actual 403 from your last run).
- **Draft a request step from a sentence** (command palette): describe the call, get a complete unsaved step to review.
- **Explain this flow** (command palette): a narrated walkthrough of the open flow, streamed into the results pane.

It also learns your taste locally: suggestions you accept are remembered per API host and steer the next one. Clicking Run pre-warms the model during the run, so the first suggestion afterward is instant. A quality panel in the AI settings shows how often generations succeed, retry, or fail on your machine.

## Read before installing (beta notes)

- **These builds are unsigned.** Windows SmartScreen will warn: choose *More info → Run anyway*. On macOS, if the first launch is blocked, allow it under *System Settings → Privacy & Security → "Open Anyway"* (recent macOS no longer honors right-click → Open). If your IT policy blocks unsigned installers, ask them to allowlist this build; signing is planned for the stable release.
- **Windows runs the model on CPU in this beta.** Generations work but take noticeably longer than on macOS, where Apple Silicon's GPU is used. GPU builds for Windows come later.
- The AI is **opt-in**. Until you enable it, nothing is downloaded and FlowRunner behaves exactly like 1.4.1.
- This is a **pre-release**: it is not marked "latest" on GitHub, the in-app update check will never ask a stable install to "upgrade" to it, and beta installs will be notified when 1.5.0 stable ships.
- Found something odd? That is what a beta is for — please [open an issue](https://github.com/Radware/FlowRunner/issues).

## Everything from v1.4.1, unchanged

The Runs page, background runs, the flow manager, per-step retries and assertions, cURL and HAR import, undo/redo, Present mode, and the light and dark themes all carry forward. Installing the beta replaces an existing FlowRunner install, and every flow you have already made opens unchanged.

## Install

Download the build for your platform:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.5.0-beta.1.zip` (contains `Setup.exe`)
- **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.5.0-beta.1.dmg`
- **Linux (x64):** `FlowRunnerSetup-x64-linux-1.5.0-beta.1.AppImage`

---

Built by the Radware ASE Team. Questions or ideas? Open an issue on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
