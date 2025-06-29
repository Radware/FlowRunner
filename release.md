# FlowRunner v1.1.1 - Enhanced Visual Editor with Minimap & Improved Variable Management

FlowRunner v1.1.1 delivers significant enhancements to the visual editing experience, introduces powerful navigation tools for large flows, and provides better variable handling capabilities. This release focuses on making complex flow creation and debugging more intuitive and efficient.

## ✨ Key New Features in v1.1.1

### 🗺️ **Minimap & Enhanced Navigation**
*   **Interactive Minimap:** Navigate large flows effortlessly with the new minimap in Node-Graph view
    *   Real-time viewport indication showing your current view area
    *   Click anywhere on the minimap to instantly jump to that location
    *   Toggle minimap visibility with the "Hide/Show Minimap" button or press `M`
    *   Minimap stays fixed during canvas panning and automatically updates during node dragging

### 🔍 **Zoom Controls & Visual Enhancements**
*   **Zoom In/Out/Reset:** Full zoom functionality for the Node-Graph view
    *   Use the `+`/`-`/`100%` buttons in the workspace header
    *   Keyboard shortcuts: `Ctrl/Cmd + +`, `Ctrl/Cmd + -`, `Ctrl/Cmd + 0`
    *   Mouse wheel zoom support (hold `Ctrl/Cmd` while scrolling)
    *   Zoom range: 50% to 200% with smooth transitions

### 📊 **Advanced Variable Type Support**
*   **Typed Global Variables:** Define variables with specific data types in the Flow Information overlay
    *   **String:** Text values (default)
    *   **Number:** Numeric values with automatic parsing
    *   **Boolean:** True/false values with smart parsing
    *   **JSON:** Complex objects and arrays with validation
*   **Improved Variable Panel:** Better display of variable origins and types
*   **Enhanced Variable Substitution:** More reliable handling of different data types in request URLs and bodies

### 🔧 **Request Processing Improvements**
*   **204 No Content Handling:** Fixed proper processing of `204 No Content` responses
*   **Global Headers Application:** Resolved issue where global headers weren't being consistently applied to all requests
*   **URL Encoding Enhancements:** Better handling of variable substitution in URLs with improved encoding logic

### 📋 **Execution Results Enhancements**
*   **Copy to Clipboard:** Click any result in the execution log to copy its content
*   **Advanced Search & Filtering:** 
    *   Search through execution results by step name, status, or content
    *   Filter results by status (Success, Error, Running, etc.)
    *   Persistent result display - all outputs remain visible after flow completion
*   **Extracted Variables Display:** Clear visibility of what variables were extracted from each request with their values

### 📁 **Flow Management Improvements**
*   **Smart Recent Files:** Fixed issue where selected flows would jump to the top of the recent files list
*   **Drag-and-Drop Reordering:** Reorganize your recent flows list by dragging items to your preferred order
*   **Improved File Persistence:** More robust handling of flow saving and loading operations

## 🛠️ Technical Improvements & Fixes

### **Enhanced Error Handling**
*   More descriptive error messages for network failures and validation issues
*   Better feedback for invalid variable names and extraction paths
*   Improved handling of edge cases in condition evaluation

### **UI/UX Polish**
*   Smoother animations and transitions throughout the interface
*   Better responsive behavior for different window sizes
*   Improved tooltip accuracy and helpfulness
*   Enhanced visual feedback for drag-and-drop operations

### **Performance & Stability**
*   Optimized rendering for large flows with many steps
*   Improved memory management during long-running flows
*   Better handling of concurrent operations

### **Testing & Quality Assurance**
*   Expanded end-to-end test coverage for visual editor interactions
*   Additional unit tests for new minimap and zoom functionality
*   Improved test reliability and debugging capabilities

## Installation Assets

Download the appropriate installer for your operating system:

*   **Windows (x64):** `FlowRunnerSetup-x64-win-1.1.1.zip` (Contains `Setup.exe`)
*   **macOS (Apple Silicon / arm64):** `FlowRunnerSetup-arm64-mac-1.1.1.dmg`

## ⚠️ Installation Notes & Troubleshooting

These builds remain unsigned. Please follow the same installation procedures as previous versions:

### **Windows Installation:**
1. Download and extract `FlowRunnerSetup-x64-win-1.1.1.zip`
2. Run `Setup.exe` 
3. If Windows SmartScreen appears, click "More info" → "Run anyway"
4. The installer runs silently and launches the app automatically

### **macOS Installation:**
1. Download `FlowRunnerSetup-arm64-mac-1.1.1.dmg`
2. Open the DMG and drag FlowRunner to Applications
3. If you see "FlowRunner is damaged" error, run in Terminal:
   ```bash
   xattr -c /Applications/FlowRunner.app
   ```
4. Right-click the app and select "Open" if needed

## 💡 New Features Usage Tips

- **Minimap:** Most useful for flows with 10+ steps. Toggle with the `M` key in Node-Graph view
- **Zoom:** Hold `Ctrl/Cmd` while using mouse wheel for quick zoom adjustments
- **Variable Types:** Use JSON type for arrays and objects that you want to loop over or extract from
- **Search Results:** Use the search box in the Runner Panel to quickly find specific step results

## 🔄 Upgrade Notes

Flows created in v1.1.0 are fully compatible with v1.1.1. The new variable typing system is optional - existing flows will continue to work exactly as before, with all variables treated as strings unless you explicitly change their types.

## 🚀 What's Next?

We're continuing to enhance FlowRunner based on your feedback. Upcoming features being considered include:

- Enhanced JSON path picker for easier extraction setup
- Environment variable management
- Additional request body formats
- "Step Into" execution mode for debugging complex conditions and loops

Thank you for using FlowRunner! Please report any issues or suggest features via our [GitHub Issues page](https://github.com/Radware/FlowRunner/issues).