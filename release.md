# FlowRunner v1.2.0 - Visual Navigation and Execution Exports

FlowRunner v1.2.0 delivers smoother execution control, stronger navigation for large flows, and better sharing of execution output. It adds Auto Arrange for the Node-Graph view, step search with jump, JSON/CSV export for results, and improved cURL generation that resolves variables when possible.

## Key Additions
- Auto Arrange layout for the Node-Graph view.
- Step search with jump to list or graph focus.
- Export execution results to JSON or CSV.
- Copy cURL resolves static variables, runtime values (when available), and special random variables; unresolved placeholders remain readable.
- New special variables: `{{RANDOM_INT(1,1000)}}` and `{{RANDOM_STRING(16)}}`.

## Fixes
- Stop now works during step-by-step runs and clears queued steps.
- Corrected the Previous/Next label in the step editor when there is no next node.
- Widened the Insert Variable button to prevent text overflow.

## Installation Assets

Download the appropriate installer for your operating system:

- **Windows (x64):** `FlowRunnerSetup-x64-win-1.2.0.zip` (Contains `Setup.exe`)
- **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.2.0.dmg`

## Installation Notes & Troubleshooting

These builds remain unsigned. Please follow the same installation procedures as previous versions:

### Windows Installation
1. Download and extract `FlowRunnerSetup-x64-win-1.2.0.zip`
2. Run `Setup.exe`
3. If Windows SmartScreen appears, click "More info" then "Run anyway"
4. The installer runs silently and launches the app automatically

### macOS Installation
1. Download `FlowRunnerSetup-arm64-mac-1.2.0.dmg`
2. Open the DMG and drag FlowRunner to Applications
3. If you see "FlowRunner is damaged" error, run in Terminal:
   ```bash
   xattr -c /Applications/FlowRunner.app
   ```
4. Right-click the app and select "Open" if needed

## Upgrade Notes

Flows created in earlier versions remain fully compatible with v1.2.0.

Thank you for using FlowRunner! Report issues or suggest features on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
