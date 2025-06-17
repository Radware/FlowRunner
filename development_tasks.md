# FlowRunner Development Tasks & Checklist

This document breaks down the features and improvements planned in the roadmap into trackable tasks. Mark items with `[x]` when completed.

## Automated Testing Tasks (Starting v1.1, Ongoing)

*   **Framework Setup:**
    *   [x] Research and select appropriate testing frameworks (e.g., Jest/Vitest for unit/integration, Playwright/Spectron for E2E).
    *   [x] Configure the chosen frameworks within the project structure.
    *   [x] Set up scripts in `package.json` to run tests.
*   **Core Logic Tests (`flowCore.js`):**
    *   [x] Write unit tests for `generateUniqueId`.
    *   [x] Write unit tests for `flowModelToJson` and `jsonToFlowModel` (including marker handling and visualLayout).
    *   [x] Write unit tests for `extractVariableReferences`.
    *   [x] Write unit tests for `findDefinedVariables` (static, extract, loop scopes).
    *   [x] Write unit tests for `evaluatePath` (various path types, edge cases, `.status`, headers, body).
    *   [x] Write unit tests for `validateFlow` (covering different step types and error conditions).
    *   [x] Write unit tests for `validateRequestBodyJson` and `formatJson` (with/without placeholders).
    *   [x] Write unit tests for `preProcessBody` and `decodeMarkersRecursive`.
    *   [x] Write unit tests for `createNewStep`, `cloneStep`, `findStepById`.
    *   [x] Write unit tests for condition helpers (`parseConditionString`, `generateConditionString`, `generateConditionPreview`, `doesOperatorNeedValue`).
*   **Execution Engine Tests (`flowRunner.js`):**
    *   [x] Write unit/integration tests for state management (`isRunning`, `isStepping`, `stopRequested`, `reset`).
    *   [x] Test sequential step execution path.
    *   [x] Test Condition step execution (both branches).
    *   [x] Test Loop step execution (empty array, single item, multiple items, context scoping).
    *   [x] Test context updates via extraction (`_updateContextFromExtraction`).
    *   [x] Test variable substitution (`substituteVariablesFn` integration).
    *   [x] Test condition evaluation (`evaluateConditionFn` integration).
    *   [x] Test `onFailure` logic ('stop' vs 'continue') for Request steps (status code and network errors).
    *   [x] Test `Stop` functionality during run and step modes (including fetch abort).
    *   [x] Test execution delay mechanism.
    *   [x] Test reporting of extraction failures.
*   **Component Tests (Basic):**
    *   [x] Write basic rendering tests for `flowBuilderComponent` (ensure main elements exist).
    *   [x] Write basic rendering tests for `flowVisualizer` (ensure canvas/svg exist).
    *   [x] (Stretch) Add interaction tests for simple component actions if framework allows without full E2E.
*   **IPC & File I/O Tests:**
    *   [x] Write integration tests mocking renderer calls to main process handlers (`dialog:openFile`, `dialog:saveFile`, `fs:readFile`, `fs:writeFile`).
    *   [x] Test error handling paths for file operations (permissions, not found).
*   **E2E Workflow Tests:**
    *   [x] Implement E2E test: Launch App -> Open Simple Request Flow -> Run Flow -> Check Results Panel for Success/Output. (Active test in simple-request-flow.e2e.test.js)
    *   [x] Implement E2E test: Open Flow -> Drag/Drop Step in List View -> Save -> Reload -> Verify Order. (Active test in ui-interactions.e2e.test.js)
    *   [x] Implement E2E test: Run Complex Flow & Verify Key Results. (Active test in flow-execution.e2e.test.js)
    *   [x] Implement E2E test: Step Through Flow & Verify Key Results. (Active test in flow-execution.e2e.test.js)



---

## v1.1.1 Tasks: Quality, Testing & Refinement

*   **Recent Files Management:**
    *   [x] Design UI interaction for removing a recent file (e.g., 'X' button, right-click context menu).
    *   [x] Implement the UI element in `app.js`'s `renderFlowList`.
    *   [x] Add event listener in `app.js` (`handleFlowListActions`) to detect removal request.
    *   [x] Implement logic to remove the specified filePath from `localStorage` (`RECENT_FILES_KEY`).
    *   [x] Re-render the recent files list after removal.
*   **Validation & Error Handling:**
    *   [x] Review `validateFlow` messages in `flowCore.js` and make them more user-friendly.
    *   [x] Enhance `validateRequestBodyJson` error messages in `flowCore.js` to include context/hints.
    *   [x] Add visual feedback (e.g., red border) and clear error message display for invalid loop variable names in `flowStepComponents.js` (`createLoopEditor`).
    *   [x] Update `main.js` IPC handlers (`fs:readFile`, `fs:writeFile`) to return more specific user-facing error messages based on error codes (ENOENT, EACCES, etc.).
    *   [x] Update `app.js` file handling (`handleOpenFile`, `saveCurrentFlow`) to display these enhanced file I/O errors using `showMessage`.
    *   [x] Update `flowRunner.js` (`_executeRequestStep`) to provide clearer messages for common network errors (DNS lookup, connection refused, timeout) in the results panel via `onMessage`.
*   **UI/UX Tweaks:**
    *   [ ] Review and adjust UI element spacing/alignment.
    *   [ ] Check button styles and alignment, especially in headers and editor actions.
    *   [ ] Ensure all interactive elements have informative `title` attributes (tooltips).
    *   [ ] Implement text-overflow ellipsis and tooltips for potentially long names/URLs in `flowStepComponents.js` (`renderRequestStepContent`, etc.) and `flowVisualizer.js` (`_getNodeContentHTML`).
    *   [ ] Fix info and show variable buttons: address delay in opening/closing and overlay misplacement, especially when window is small or buttons wrap to a second row.
    *   [ ] Retain full output/results in the right pane while running flows; ensure all requests are visible after flow finishes, not just the last few.
    *   [ ] Improve visual handling of very nested steps: allow the step pane to expand as needed for deep nesting.
*   **Performance:**
    *   [ ] (If needed) Use browser/Electron dev tools profiler to analyze performance when loading/rendering/running large flows (e.g., 50+ steps).
    *   [ ] (If needed) Optimize rendering loops, event listeners, or data processing based on profiling results.
*   **Keyboard Shortcuts:**
    *   [ ] Implement Save (Ctrl/Cmd+S).
    *   [ ] Implement Open (Ctrl/Cmd+O).
    *   [ ] Implement Run (e.g., F5).
    *   [ ] Implement Step (e.g., F10).
    *   [ ] Implement Stop (e.g., Esc).
    *   [ ] Implement View/Panel Toggles (e.g., Ctrl/Cmd+1/2/3...).
*   **Update Notification:**
    *   [ ] On application open, check GitHub for a newer release than the current version.
    *   [ ] If GitHub is unreachable, do nothing (no popup).
    *   [ ] If a newer version is found, alert the user with a link to the release page (e.g., https://github.com/Radware/FlowRunner/releases/tag/v1.0.0).
*   **Background/Continuous Flow Runner:**
    *   [ ] Add a new pane or UI option to run a flow continuously in the background, independent of the main UI runner.
    *   [ ] Show a clear indicator that a background flow is running and its status.
    *   [ ] Support ms delay between requests and an additional delay between full flow runs.
    *   [ ] Ensure the user can still run flows in the main UI while a background flow is running.
    *   [ ] Design and implement UI/UX for managing and monitoring background runs.

---

## v1.2.0 Tasks: Core Execution & Visualization Enhancements

*   **Graph View Enhancements:**
    *   [ ] Implement zoom transformation logic in `flowVisualizer.js`.
    *   [ ] Add Zoom In/Out/Reset buttons to UI.
    *   [ ] Implement zoom event listeners (mouse wheel, buttons).
    *   [ ] Create Minimap UI component.
    *   [ ] Implement rendering logic for Minimap content.
    *   [ ] Implement viewport representation on Minimap.
    *   [ ] Implement navigation via Minimap interaction.
*   **"Step Into" Execution:**
    *   [ ] Add `stepInto` method logic to `flowRunner.js`.
    *   [ ] Implement `handleStepIntoFlow` in `app.js`.
    *   [ ] Add "Step Into" button to `index.html`.
    *   [ ] Implement `peekNextStepType()` (or similar) in `flowRunner.js` for button state.
    *   [ ] Update `updateRunnerUI` in `app.js` to use runner state for "Step Into" button enablement.
*   **Enhanced Request Body Support:**
    *   [ ] Add Body Type selector (JSON, x-www-form-urlencoded) to Request editor UI.
    *   [ ] Store `bodyType` in step model.
    *   [ ] Update save/load logic (`flowModelToJson`/`jsonToFlowModel`) for `bodyType`.
    *   [ ] Update `_executeRequestStep` in `flowRunner.js` to handle `x-www-form-urlencoded` formatting and `Content-Type`.
    *   [ ] Adjust/disable body validation for non-JSON types.
*   **Environment Variables (Basic):**
    *   [ ] Design and Implement UI for managing environment sets.
    *   [ ] Decide and implement persistence (global `localStorage`/settings file recommended).
    *   [ ] Update `app.js` state for environments.
    *   [ ] Modify `flowRunner.js` context initialization.
    *   [ ] Update substitution logic for `{{env.varName}}`.
    *   [ ] Update variable insertion helper.
    *   [ ] Update Variables Panel display.
*   **Visual JSON Path Picker (Basic):**
    *   [ ] Add "Pick Path" button to Extract editor tab.
    *   [ ] Implement logic to retrieve last response body.
    *   [ ] Create modal/panel to display JSON structure interactively.
    *   [ ] Implement path generation based on UI clicks.
    *   [ ] Populate Path input field with generated path.
*   **Runner Results Search/Filter:**
    *   [ ] Add Search input / Filter dropdown to Runner Panel UI.
    *   [ ] Add event listeners in `app.js`.
    *   [ ] Implement filtering logic on the results list display.
*   **Continued Testing:**
    *   [ ] Write new unit/integration/E2E tests covering all features added in v1.2.0.
    *   [ ] Ensure existing tests pass (regression testing).