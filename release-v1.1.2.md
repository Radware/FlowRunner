# FlowRunner v1.1.2 

FlowRunner v1.1.2 focuses on quality and usability improvements. It fixes several issues from the previous release and updates the default delay between steps to 1000 ms. This version builds upon the visual and variable enhancements introduced in v1.1.1.

## 🔧 Key Fixes
- **Variable insertion reliability** – “Add Variable” now correctly locates its target input, allowing variables to be added inside loop sources and other editors without errors.
- **Full body extraction** – Use `body` in the Extract tab to capture an entire response object in a single variable.
- **Step deletion dirty state** – Deleting a step no longer leaves unsaved changes warnings; loop editors now validate and mark dirty correctly.
- **Default delay update** – New flows start with a 1000 ms delay between steps for smoother demos.

## ✨ Features from v1.1.1

- Interactive minimap and full zoom controls for large flows
- Typed global variables with improved substitution and display
- Numerous enhancements to request processing, execution results, and flow management

## 📦 Installation

Download the installer matching your OS:

- **Windows (x64)**: `FlowRunnerSetup-x64-win-1.1.2.zip`
- **macOS (arm64)**: `FlowRunnerSetup-arm64-mac-1.1.2.dmg`

Follow the same installation steps as previous versions.

## 🔄 Compatibility

Flows created in v1.1.0 and v1.1.1 remain fully compatible with v1.1.2.

---

Thank you for using FlowRunner! Report issues or suggest features on the [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).