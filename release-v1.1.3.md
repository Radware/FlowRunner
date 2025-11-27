# FlowRunner v1.1.3

FlowRunner v1.1.3 is a focused hotfix release that ensures POST requests always include their configured bodies, even when `rawBodyWithMarkers` is null in the flow model.

## 🔧 Key Fix
- **POST body delivery:** Fixed a runner substitution gap that could send POST requests without a body if the step's `rawBodyWithMarkers` field was null. Bodies now send reliably without requiring a flow reload.

## 📦 Installation

Download the installer matching your OS:

- **Windows (x64)**: `FlowRunnerSetup-x64-win-1.1.3.zip`
- **macOS (arm64)**: `FlowRunnerSetup-arm64-mac-1.1.3.dmg`

Follow the same installation steps as previous versions.

## 🔄 Compatibility

Flows created in earlier versions remain fully compatible with v1.1.3.

---

Thank you for using FlowRunner! Report issues or suggest features on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).
