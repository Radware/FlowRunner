# FlowRunner

**Status:** Pre-release (v0.1)

FlowRunner is a Windows desktop application designed for visually creating, managing, and executing API call sequences (API Flows). It provides an intuitive interface with both list-based and node-graph visualizations, allowing users to define complex interactions including conditional logic and loops.

Its real-time execution visualization makes it an excellent tool for:

*   Demonstrating complex API interactions.
*   Testing and debugging multi-step API processes.
*   Understanding and prototyping API integrations.

![FlowRunner Placeholder Screenshot](placeholder.png)
*(Add a screenshot or GIF here once available)*

## Key Features

*   **Visual Flow Authoring:**
    *   Create flows with Request, Condition (If/Else), and Loop (For Each) steps.
    *   Configure HTTP requests (Method, URL, Headers, Body).
    *   Define conditional logic using a structured builder.
    *   Iterate over arrays using loops.
*   **Dual Views:**
    *   **List/Editor View:** Detailed step list with configuration panels and drag-and-drop reordering.
    *   **Node-Graph View:** Interactive graph visualization of the flow structure and connections.
*   **Variable Management:**
    *   Define global headers and static variables for flows.
    *   Extract data from API responses (`status`, `headers`, `body` via JSON path) into variables.
    *   Substitute variables (`{{varName}}`) into request URLs, headers, bodies, etc.
    *   Helper dropdown for easy variable insertion.
*   **Execution & Debugging:**
    *   Run entire flows or execute step-by-step.
    *   Stop execution at any time.
    *   Configure delay between steps for visibility.
    *   Real-time highlighting of active/completed steps in both views.
    *   Detailed results panel showing status, output, and errors for each step.
*   **Flow Management:**
    *   Save, load, clone, and delete flows.
    *   Sidebar for easy access to saved flows.
    *   Unsaved change detection and confirmation.

## Target Audience

*   Sales Engineers / Solutions Architects
*   API Testers / QA Engineers
*   Developers consuming or integrating APIs

## Technology Stack

*   Frontend: HTML, CSS, JavaScript (ES Modules)
*   (Likely Packaging: Electron or Tauri for Windows distribution - TBD)

## Installation & Setup (Pre-release / Local Development)

As this is a pre-release version based on web technologies, it currently runs directly in a browser using a local web server. Packaging as a standalone Windows application (e.g., using Electron or Tauri) is planned for future releases.

**Prerequisites:**

*   [Node.js](https://nodejs.org/) and npm (or yarn) installed.
*   A simple local web server package (like `live-server`).

**Steps:**

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd flowrunner-project # Or your repository directory name
    ```

2.  **Install a local web server (if you don't have one):**
    ```bash
    npm install -g live-server
    # or: yarn global add live-server
    ```

3.  **Start the local server:**
    Navigate to the project's root directory (where `index.html` is located) in your terminal and run:
    ```bash
    live-server
    ```
    This will typically open the application automatically in your default web browser. If not, open your browser and navigate to the local address provided by `live-server` (usually `http://127.0.0.1:8080`).

4.  **(Backend API Note):** Flow saving/loading currently interacts with a backend API expected at `/api/flows`. You will need to have a compatible backend server running and accessible from the frontend for these features to work. The specifics of this backend are not included in this repository.

## Usage Guide

1.  **Launch:** Start the application using the local server method described above.
2.  **Create/Load Flow:**
    *   Click **"+ New Flow"** in the sidebar to start a new flow.
    *   Click a flow name in the sidebar to load an existing one.
3.  **Configure Flow:**
    *   Click the **"Info ▼"** button (top right of workspace) to edit the Flow Name, Description, Global Headers, and Flow Variables.
4.  **Add/Edit Steps (List/Editor View - Default):**
    *   Click **"+ Add Step"** at the bottom of the steps list to add a top-level step.
    *   Use the **"+"** buttons within Condition/Loop steps to add nested steps.
    *   Click a step header in the list to select it and open its configuration panel on the right.
    *   Modify step details (name, URL, conditions, etc.) in the editor panel.
    *   Click **"Save Step"** in the editor panel to commit changes for that step.
    *   Use the drag handle (☰) to reorder steps.
    *   Use the clone (⧉) or delete (✕) buttons on the step header.
5.  **Switch Views:**
    *   Click the **"Visual View" / "Editor View"** button in the workspace header to toggle between the List/Editor and Node-Graph views.
6.  **Visualize Flow (Node-Graph View):**
    *   View the flow structure as connected nodes.
    *   Click nodes to select them (selection highlights the node).
    *   Drag nodes to reorder them (triggers the same update as list view drag-and-drop).
    *   Pan the view by clicking and dragging the background.
7.  **Manage Variables:**
    *   Click **"Show/Hide Variables"** in the workspace header to toggle the Variables Panel at the bottom. This panel shows defined static, extracted, and loop variables.
    *   Use the **`{{…}}`** buttons next to input fields to insert variable names easily.
8.  **Execute Flow:**
    *   Use the **Runner Panel** on the right.
    *   Click **"▶ Run"** to execute the entire flow. Observe step highlighting and results appearing in the list.
    *   Click **"Step"** to execute one step at a time.
    *   Click **"⏹ Stop"** to halt execution.
    *   Adjust the **Delay** field to slow down the "Run" mode.
    *   Click **"Clear Results"** to clear the execution log.
9.  **Save Changes:**
    *   If the flow title has an asterisk (`*`), there are unsaved changes.
    *   Click the **Save Flow** button (Note: This button isn't explicitly shown in the provided HTML/CSS, assuming it might be added dynamically or is intended to be part of the flow info area/header controls) or ensure the application triggers a save via the backend API when appropriate (e.g., before closing, periodically - current code doesn't show auto-save). *Initial implementation might rely on step edits triggering flow dirty state, requiring a manual save action (button TBD).*

## Core Concepts

*   **API Flow:** A sequence of steps representing an interaction with one or more APIs.
*   **Step:** An individual action within a flow (Request, Condition, Loop).
*   **Request Step:** Executes an HTTP API call.
*   **Condition Step:** Branches the flow based on evaluating data from the context (If/Else).
*   **Loop Step:** Repeats a sequence of steps for each item in an array variable.
*   **Context:** Runtime data store holding variables (static, extracted, loop items) available for substitution and conditions.
*   **Variables:** Placeholders (`{{varName}}`) for dynamic data used in steps. Can be defined statically or extracted from responses.
*   **Execution Results:** Log of each step's execution outcome (status, output, errors).

## Development

(Currently minimal setup)

*   Ensure code adheres to standard JavaScript practices.
*   (Future: Add linting, formatting, testing configurations).

## Contributing

Contributions are welcome! Please follow standard Fork & Pull Request workflows. Discuss significant changes via Issues first. (Adjust based on project policy).

## License

(Specify License - e.g., MIT, Apache 2.0, or Proprietary)

```
MIT License

Copyright (c) [Year] [Your Name or Company]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

*(Replace `[Year]` and `[Your Name or Company]`)*