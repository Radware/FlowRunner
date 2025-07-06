# FlowRunner 

![Version](https://img.shields.io/badge/version-1.1.2-blue.svg)
<!-- Optional: Add build status/license badges here if desired -->
<!-- [![Build Status](YOUR_BUILD_BADGE_URL)](YOUR_BUILD_URL) -->

<div align="center" style="margin-bottom: 25px; margin-top: 10px;">
  <div style="display: inline-block; background: #fff; border-radius: 18px; padding: 18px 36px; box-shadow: 0 2px 8px rgba(0,0,0,0.07);">
    <img src="assets/RadwareASETeam.svg" alt="ASE Team Logo" height="100" style="display: block; margin: 0 auto;" />
  </div>
  <p style="font-size: 2.85em; color: #555; margin-top: 0px; margin-bottom: 0; font-weight: 500; letter-spacing: 0.5px;">
    
  </p>
</div>

---

## Release Notes / Changelog

### v1.1.2 (July 2025)
- **Priority One Fixes:** Resolved variable insertion issues in loops, improved full response body extraction, and fixed unsaved changes warning when deleting steps.
- **Execution Delay:** Default delay between steps is now 1000ms.

### v1.1.1 (June 2025)
- **Visual Editor Enhancements:**
  - Added minimap for better navigation of large flows.
  - Added zoom in and zoom out functionality for improved visibility.
- **Info Section Improvements:**
  - Fixed issue where global headers were not being applied to requests.
  - Added variable type selection for global variables (string, number, boolean, JSON).
- **Variable Handling:**
  - Improved URL encoding handling for variables in request URLs.
- **Response Processing:**
  - Fixed handling of 204 No Content responses.
- **Execution Results:**
  - Added extracted variable display with copy-to-clipboard functionality.
  - Added search functionality for filtering execution results.
- **Recent Flows Management:**
  - Fixed issue where selected flow would jump to top of recent flows list.
  - Added drag-and-drop functionality to reorder flows in recent list.

### v1.1.0 (May 2025)
- **Continuous Flow Runner:**
  - Added a simple "continuous run" mode that allows you to run flows repeatedly in sequence. This is not a true background runner: the main UI is not usable during continuous execution, and there is no configurable delay between full flow runs.
  - Removed references to background/parallel execution and per-run delay configuration from documentation and UI.
- **Recent Files Management:**
  - Added UI to remove recent files from the sidebar list.
  - Improved localStorage handling for recent files.
- **Validation & Error Handling:**
  - Improved error messages for file operations and network errors.
  - Enhanced feedback for invalid loop variable names and extraction errors.
- **UI/UX Improvements:**
  - Better spacing, tooltips, and keyboard shortcuts.
  - Improved overlays and handling of deeply nested steps.
  - Results panel now retains all outputs after flow finishes.
- **Testing:**
  - Expanded E2E and unit test coverage for flows, file operations, and UI.
- **Update Notification:**
  - App checks for new releases on GitHub and notifies the user if available.
  - You can also manually check for updates via **Help > Check for Updates…**, which triggers the menu item defined in [`main.js`](https://github.com/Radware/FlowRunner/blob/main/main.js#L274).

### v1.0.0 (Initial Release)
- First public release with visual flow authoring, dual views, variable management, and local file operations.

---

## Introduction

FlowRunner is a standalone desktop application, developed by the **Radware ASE Team**, designed to help you visually create, manage, run, and visualize sequences of API calls (known as "API Flows"). It runs on Windows (x64) and macOS (Apple Silicon / arm64).

Whether you need to demonstrate complex API interactions, test multi-step API processes locally, or debug intricate data flows, FlowRunner provides an intuitive interface with both list-based and node-graph views. Its real-time execution visualization helps you understand exactly what's happening step-by-step.

This tool is particularly useful for:

*   Sales Engineers and Solutions Architects demonstrating API behaviors.
*   API Testers and QA Engineers validating sequences and debugging issues.
*   Developers prototyping or understanding multi-step API integrations.

## Key Features

*   **Visual Flow Authoring:** Create flows using intuitive steps:
    *   **API Request:** Configure HTTP calls (Method, URL, Headers, JSON Body).
    *   **Condition:** Branch your flow based on data (If/Then/Else logic).
    *   **Loop:** Repeat steps for each item in an array.
*   **Dual Views:** Work the way you prefer:
    *   **List/Editor View:** A detailed list of steps with a dedicated panel for configuration and drag-and-drop reordering.
    *   **Node-Graph View:** An interactive visual graph showing the flow structure and connections. Drag nodes to arrange the layout. Use zoom controls and an optional minimap for easier navigation of large flows.
*   **Variable Management:** Handle dynamic data effectively:
    *   Define **Global Headers** and **Static Variables** for the entire flow. Variables can be typed as String, Number, Boolean, or JSON to better control how values are parsed and substituted.
    *   **Extract** data from API responses (like status code, headers, or values from the body using JSON paths) into variables.
    *   **Substitute** variables (`{{variableName}}`) into URLs, headers, request bodies, condition values, etc.
    *   Use the **`{{…}}`** helper button to easily insert defined variable names.
*   **Execution & Debugging:** Run and analyze your flows:
    *   Execute the entire flow from start to finish.
    *   Step through the flow one action at a time.
    *   Stop execution whenever needed.
    *   Configure a delay between steps during full runs for better observation.
    *   View **real-time highlighting** of the currently executing or completed step in both views.
    *   Monitor progress in the detailed **Results Panel**, showing each step's status, output, errors, and extraction warnings.
    *   Use the search box and status filter to narrow displayed results, and copy any step's output to the clipboard.
*   **Local Flow Management:** Work entirely offline:
    *   Create new flows from a template.
    *   **Save** flows to your local computer as `.flow.json` files.
    *   **Load** flows from your local files.
    *   Access **Recent Files** quickly from the sidebar and reorder them via drag-and-drop.
    *   **Clone** existing flows to create variations easily.
*   **User Interface:**
    *   Collapsible Sidebar and Runner panels to maximize workspace.
    *   Clear indication of unsaved changes, with the Save button highlighted when edits are pending.
    *   Configurable visual layout for the Node-Graph view.

## Prerequisites

*   Windows (x64) or macOS (Apple Silicon / arm64).
*   The appropriate FlowRunner installer package downloaded from the [v1.1.2 Release Page](https://github.com/Radware/FlowRunner/releases/tag/v1.1.2) (or latest release).
*   Network access is required *only* when executing flows that contain 'API Request' steps which need to reach external endpoints. Flow authoring, saving, loading, and visualization can be done offline.

## Installation

1.  **Download the Correct Installer:**
    *   Go to the [FlowRunner Releases Page](https://github.com/Radware/FlowRunner/releases) on GitHub.
    *   Find the latest release (e.g., v1.1.2).
    *   Under **Assets**:
        *   For **Windows (x64)**, download `FlowRunnerSetup-x64-win-1.1.2.zip`. Unzip the file to find the `Setup.exe`.
        *   For **macOS (Apple Silicon / arm64)**, download `FlowRunnerSetup-arm64-mac-1.1.2.dmg`.
2.  **Install on Windows:**
    *   Double-click the extracted `Setup.exe` file.
    *   The installation will proceed silently in the background (using Squirrel.Windows). It typically installs to your `AppData\Local\FlowRunner` folder.
    *   Once installed, the application should launch automatically.
    *   You can find FlowRunner in your Start Menu afterwards.
    *   *(Note: As the application is unsigned, you might see a Windows SmartScreen prompt. You may need to click "More info" and then "Run anyway".)*
3.  **Install on macOS (arm64):**
    *   Double-click the downloaded `.dmg` file to open it.
    *   Drag the `FlowRunner` application icon into your `Applications` folder.
    *   Launch FlowRunner from your Applications folder.
    *   *(Note: See macOS Troubleshooting below if you encounter issues opening the app).*

## Getting Started: Creating and Running a Simple Flow

1.  **Launch FlowRunner.**
2.  **Create a New Flow:**
    *   In the left sidebar, click the **"+ New Flow"** button.
    *   The workspace will load an empty flow titled "New Flow".
3.  **Add a Request Step:**
    *   In the "Flow Steps" panel (middle left), click the **"+ Add Step"** button at the bottom.
    *   A dialog box "Select Step Type" appears. Click on **"API Request"**.
    *   A "New Request" step appears in the list and its editor opens on the right.
4.  **Configure the Request:**
    *   In the editor panel on the right:
        *   Change the **Step Name** to something descriptive, like "Get HTTPBin IP".
        *   Ensure the **Method** is `GET`.
        *   In the **URL** field, enter: `https://httpbin.org/get`
        *   Click **"Save Step"** at the bottom of the editor panel.
5.  **Run the Flow:**
    *   In the **Runner Panel** on the far right:
    *   Click the **"▶ Run"** button.
6.  **View Results:**
    *   Observe the "Get HTTPBin IP" step briefly highlight (likely yellow/running then green/success) in the Steps list.
    *   In the **Execution Results** list (bottom right), you will see an entry for the step. It should show `SUCCESS` and contain the JSON response from `httpbin.org`.

Congratulations! You've created and run your first API flow.

## Detailed Usage

### Views

*   **List/Editor View (Default):** Shows steps sequentially. Ideal for detailed configuration via the editor panel and reordering steps using drag-and-drop (☰ handle).
*   **Node-Graph View:** Shows steps as connected nodes. Provides a better overview of the flow's structure, especially with conditions and loops. You can pan the view by dragging the background and rearrange nodes by dragging them (this updates the visual layout saved with the flow).
*   **Toggle Views:** Use the **"Visual View" / "Editor View"** button in the workspace header to switch between modes.

### Managing Flows (Local Files)

*   **New:** Click **"+ New Flow"** in the sidebar. Remember to save it!
*   **Open:** Click **"Open Flow"** in the sidebar to browse and load a `.flow.json` file from your computer. If you have unsaved changes, you'll be prompted to confirm.
*   **Save:** Click **"Save"** in the workspace header to save changes to the currently open file. This button is enabled only when there are unsaved changes (indicated by `*` in the title).
*   **Save As:** Click **"Save As..."** in the workspace header to save the current flow to a new `.flow.json` file.
*   **Recent Files:** The sidebar lists recently opened/saved files. Click an item to load it. Use the **✕** icon next to a file to remove it from the list.
*   **Clone:** To duplicate a flow, load the flow you want to clone, then use **"Save As..."** to save it under a new name. FlowRunner ensures the internal steps get new unique IDs automatically when saved as a new file.
*   **Delete:** To delete a flow, simply delete the corresponding `.flow.json` file from your computer using Finder (macOS) or File Explorer (Windows). The file will eventually disappear from the "Recent Files" list.

### Flow Configuration (Info Overlay)

Click the **"Info ▼"** button in the workspace header to open the Flow Info overlay. Here you can configure:

*   **Flow Name:** A descriptive name for your flow.
*   **Description:** Optional details about the flow's purpose.
*   **Global Headers:** Define HTTP headers (Key-Value pairs) that will be automatically added to *all* 'API Request' steps in this flow. Headers defined within individual steps will override global headers with the same key.
*   **Flow Variables:** Define static variables (Key-Value pairs) that are available throughout the flow's execution. Each variable can be typed as String, Number, Boolean, or JSON. Variable names should be valid identifiers (letters, numbers, `_`, starting with a letter or `_`). Values may contain JSON arrays or objects for loops or complex data.

Changes here mark the flow as unsaved. Close the overlay by clicking the **"Info ▲"** button again.

### Configuring Steps

1.  **Select Step:** In the List/Editor view, click on a step header in the "Flow Steps" panel.
2.  **Edit Panel:** The editor panel on the right updates to show the configuration options for the selected step type.
3.  **Configure:** Modify the fields as needed.
4.  **Save Step:** Click the **"Save Step"** button at the bottom of the editor panel to commit your changes for that specific step. This also marks the overall flow as unsaved.
5.  **Cancel:** Click **"Cancel"** to discard any changes made in the editor panel since the last save for that step.

### Unsaved Changes Tracking

FlowRunner tracks edits using two flags within `appState`:

* `isDirty` &ndash; Set when the flow structure or metadata changes and a file save is required.
* `stepEditorIsDirty` &ndash; Indicates unsaved edits in the currently open step editor.

The **Save**, **Cancel**, and **Close** buttons evaluate both flags. Save and Cancel are enabled whenever either flag is true, while Close is enabled only when both are false. Attempting to close the window also checks these flags to warn about unsaved work.

#### Step Types

*   **API Request:**
    *   **Method:** HTTP method (GET, POST, PUT, PATCH, DELETE, etc.).
    *   **URL:** The target API endpoint URL. You can use `{{variableName}}` for substitutions.
    *   **Headers Tab:** Define request-specific headers. These override Global Headers. Supports variable substitution in values.
    *   **Body Tab:** Enter the request body, typically in JSON format. Supports `{{variableName}}` substitution. Use `"{{var}}"` for string substitution, and `{{var}}` (without quotes) for number/boolean/object substitution. Use the "Format" button to prettify JSON. Validation errors appear below the textarea.
    *   **Extract Tab:** Define rules to extract data from the response into variables for later steps.
        *   **Variable Name:** The name of the variable to create/update (e.g., `authToken`, `userId`).
        *   **JSON Path:** The path to the data within the response. Examples:
            *   `.status` -> The HTTP status code (e.g., `200`).
            *   `headers.Content-Type` -> The value of the Content-Type header (case-insensitive lookup).
            *   `body.user.id` -> Value of `id` within the `user` object in the JSON body.
            *   `body.items[0].name` -> Value of `name` in the first element of the `items` array in the JSON body.
            *   `body` -> The entire response body.
              Use this to capture the full JSON object (or text) returned by that request step.
    *   **Options Tab:**
        *   **On Failure:** Choose whether the flow should `Stop` (default) or `Continue` if the request fails (network error or status code >= 300). If set to `Continue`, the step result is still logged (often as 'error' status in runner if network issue, or 'success' but with non-2xx output status), but the flow proceeds to the next step.
*   **Condition (If/Else):**
    *   **Variable:** Select the variable from the context whose value you want to check (e.g., `extractedStatusCode`, `previousStepOutput.body.isValid`).
    *   **Operator:** Choose the comparison operator (e.g., `equals`, `contains`, `greater_than`, `exists`).
    *   **Value:** Enter the value to compare against (if the operator requires it). Supports `{{variableName}}` substitution.
    *   **Preview:** Shows a human-readable version of the condition.
    *   **Then/Else Branches:** Add steps within the "Then" branch (executes if condition is true) or "Else" branch (executes if condition is false) using the `+ Add Step` buttons within the step's content area in the List view.
*   **Loop (For Each):**
    *   **Source (Array Variable):** Enter the variable name (e.g., `{{userList}}`) that holds the array you want to iterate over. This variable must exist in the context and contain an array.
    *   **Item Variable Name:** Enter the name that will hold the current item during each iteration (e.g., `item`, `user`). You can access the item's properties within the loop body using `{{item.id}}`, `{{user.name}}`, etc.
*   **Loop Body:** Add steps within the loop body using the `+ Add Step` button within the step's content area in the List view. These steps will execute once for each item in the source array.
    *   **Example:** Define a JSON variable `userList` in the Flow Info overlay:

        ```json
        [
            { "id": 1, "name": "Alice", "active": true },
            { "id": 2, "name": "Bob",   "active": false }
        ]
        ```

        Add a Loop step with **Source** `{{userList}}` and **Item Variable Name** `user`.
        Inside the loop body you can reference `{{user.name}}` or add a Condition step checking `{{user.active}}`.

### Variables

*   **Definition:** Variables are defined statically in the Flow Info overlay or dynamically via the 'Extract' tab in Request steps. Loop steps also introduce an item variable.
*   **Substitution:** Use `{{variableName}}` syntax in fields that support it (URL, Header values, Request Body, Condition Value, Loop Source). The runner replaces this with the variable's current value during execution.
*   **URL Encoding:** When using the `FlowRunner` class programmatically, pass `{ encodeUrlVars: true }` to automatically URL-encode variable values inserted into URLs. Values that already contain percent-encoded sequences, or values that start with `http://` or `https://`, are left unchanged so they are not encoded twice and base URLs remain intact. The Runner panel exposes an **Encode URL Vars** checkbox to toggle this at runtime.
*   **Extraction Paths:** Use dot notation (`object.property`) and array indexing (`array[index]`) to access values within JSON response bodies. Special paths include `.status`, `headers.Header-Name`, and `body`.
*   **Insertion Helper:** Click the **`{{…}}`** button next to an input field to open a searchable dropdown of currently defined variables. Clicking a variable name inserts `{{variableName}}` into the input field.
*   **Variables Panel:** View all variables defined by the flow structure (Static, Extract, Loop). Click **"Show/Hide Variables"** in the workspace header to toggle this panel. *Note: This panel shows where variables are defined, not their live values during execution.*

### Running Flows

*   **Run:** Executes the entire flow from the first step. Uses the configured **Delay** between steps. Highlights steps as they execute.
*   **Continuous Run:** When checked, FlowRunner restarts the flow automatically after it finishes. It waits for the configured **Delay** between runs and continues until you uncheck the box or click **"Stop"**.
*   **Step:** Executes only the *next* logical step in the flow. Allows you to inspect results and context between steps. Click "Step" repeatedly to advance through the flow.
*   **Stop:** Immediately requests the flow execution to halt. If a network request is in progress, it will attempt to abort it. The step where execution stopped will be highlighted (often orange/warning).
*   **Delay (ms):** Sets the pause duration (in milliseconds) between steps when using **Run** and between full runs when **Continuous Run** is enabled. Does not affect **"Step"** mode.
*   **Encode URL Vars:** When checked, variable values inserted into URLs are percent-encoded as needed, but full URLs (starting with `http://` or `https://`) are left untouched.
*   **Results Panel:** Shows a log of each step executed:
    *   **Step Name & Type:** Identifies the step.
    *   **Status:** `RUNNING`, `SUCCESS`, `ERROR`, `SKIPPED`, `STOPPED`.
    *   **Output:** For successful requests, shows status, headers, and body. For conditions/loops, shows relevant info (branch taken, item count).
    *   **Error:** Displays error messages if a step failed.
    *   **Extraction Warnings:** If an 'Extract' rule failed (e.g., path not found), a warning appears here for the relevant Request step.

## Configuration

FlowRunner configuration happens primarily through the user interface:

*   **Flow Settings:**
    *   **Location:** Flow Info Overlay (click "Info ▼" button).
    *   **Settings:** Flow Name, Description, Global Headers, Static Variables.
    *   **Persistence:** Saved within the `.flow.json` file for each flow.
*   **Step Settings:**
    *   **Location:** Step Editor Panel (select a step in the List/Editor view).
    *   **Settings:** Varies by step type (URL, Method, Body, Condition Logic, Loop Source, etc.).
    *   **Persistence:** Saved within the `.flow.json` file for each flow.
*   **Runner Settings:**
    *   **Location:** Runner Panel (right sidebar).
    *   **Settings:** Execution Delay (ms).
    *   **Persistence:** Delay value is not saved per-flow; it resets to the default (1000ms) when the application starts.
*   **UI State:**
    *   **Location:** Internal (`localStorage`).
    *   **Settings:** Collapsed state of the Sidebar and Runner Panel.
    *   **Persistence:** Saved automatically in your browser's local storage and restored on next launch.
*   **Visual Layout (Node-Graph):**
    *   **Location:** Node-Graph View (drag nodes to position them).
    *   **Settings:** X/Y coordinates for each node.
    *   **Persistence:** Saved within the `.flow.json` file under the `visualLayout` key when the flow is saved.

### Keyboard Shortcuts

FlowRunner supports several keyboard shortcuts to speed up common actions. A few highlights:

*   **F1** – open the Help window.
*   **Ctrl/Cmd + + / - / 0** – zoom in, zoom out, or reset the zoom level.
*   **M** – toggle the Node-Graph minimap.

See `help.html` for the full table of shortcuts.

## Troubleshooting

*   **Windows: Installer Warning:** When running `Setup.exe`, Windows SmartScreen might show a warning because the application is not code-signed. Click "More info" and then "Run anyway" to proceed with the silent installation.
*   **macOS: "FlowRunner is damaged and can't be opened. You should move it to the Trash." Error:** This error often occurs on macOS for downloaded applications that are not notarized by Apple. It's usually related to extended attributes (quarantine flags) set by the OS. To fix this:
    1.  Open the **Terminal** application (you can find it in Applications > Utilities).
    2.  Run the following command, replacing `<path/to/FlowRunner.app>` with the actual path to the FlowRunner application (usually `/Applications/FlowRunner.app` if you dragged it to the Applications folder):
        ```bash
        xattr -c /Applications/FlowRunner.app
        ```
    3.  Try opening FlowRunner again. If prompted about it being from an unidentified developer, you might need to right-click (or Control-click) the app icon and choose "Open", then confirm in the dialog box.
*   **Flow Doesn't Save / Load:**
    *   Ensure you have write/read permissions for the directory where you are saving/loading `.flow.json` files.
    *   Check if the `.flow.json` file might be corrupted (e.g., manually edited incorrectly). Try creating a new flow.
    *   Look for specific error messages shown in the UI (e.g., below the workspace content).
*   **API Request Step Fails:**
    *   Verify the **URL** is correct and accessible from your machine.
    *   Check if the correct **Method** is selected.
    *   Ensure **Headers** (Global and Step-specific) are correct (e.g., `Content-Type`, `Authorization`).
    *   Validate the **Request Body** format (use the "Format" button for JSON). Check for correct variable substitution.
    *   Examine the **Results Panel** entry for the failed step - it often contains the response status code, body, or a network error message.
    *   Check the **On Failure** setting in the step's 'Options' tab. If set to 'Stop', the flow will halt on failure.
*   **Variable Substitution (`{{var}}`) Not Working:**
    *   Double-check the variable name spelling inside the `{{ }}`.
    *   Ensure the variable is actually defined *before* the step attempting to use it (check Static Vars, or previous step Extractions/Loops). Use the **Variables Panel** ("Show/Hide Variables") to see defined variables.
    *   Remember that extraction happens *after* a Request step completes.
*   **Variable Extraction Not Working:**
    *   Verify the **JSON Path** in the 'Extract' tab is correct for the API response structure. Use online JSON path testers if needed.
    *   Check the **Results Panel** output for the request step to confirm the actual response structure.
    *   Look for **Extraction Warnings** within the successful step's results entry in the Runner Panel.
*   **Condition Step Goes Wrong Way:**
    *   Check the **Variable**, **Operator**, and **Value** in the Condition step's editor.
    *   Verify the actual value of the variable being checked by examining the output of previous steps in the **Results Panel**.
*   **Loop Step Doesn't Run / Runs Incorrectly:**
    *   Ensure the **Source** variable points to a valid array in the execution context. Check previous step outputs.
    *   Verify the **Item Variable Name** is correctly used (`{{itemName}}`) within the loop body steps.
*   **General Issues / UI Glitches:**
    *   Try restarting the packaged application.
    *   For more advanced debugging, you can open the **Developer Tools** from the **View** menu (`View > Toggle Developer Tools`). Check the **Console** tab within the Developer Tools for any error messages logged by the application.

## Development Setup

FlowRunner requires **Node.js 18 or newer**. Use the setup script (which runs `npm ci`) or run `npm ci` yourself to install dependencies:

```bash
./setup_env.sh
# or
npm ci
```

The script also downloads the Playwright browsers needed for e2e tests.

Launch the app locally with:

```bash
npm start
```

Run the unit and end-to-end tests:

```bash
npm test     # runs with NODE_ENV=test
npm run e2e  # runs with E2E=true
```

These npm scripts automatically set the required environment variables.


<div align="center" style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
  <img src="assets/Radware_logo.svg" alt="Radware Logo" height="40">
</div>
