// ========== FILE: app.js (Updated Main Entry Point) ==========
import { logger } from './logger.js';
logger.info("FlowRunner Application: Initializing...");

// --- Core Application State and Configuration ---
import { appState, domRefs } from './state.js';
import { CURRENT_VERSION, GITHUB_RELEASES_API } from './config.js';

// --- UI & DOM Utilities ---
import { initializeDOMReferences } from './domUtils.js';
import {
    setDirty, showMessage, updateWorkspaceTitle,
    renderCurrentFlow,
    clearWorkspace,
    clearMessages,
    updateViewToggle, setupPaneResizer,
    updateDefinedVariables,
    highlightStepInList, clearListViewHighlights,
    syncPanelVisibility
} from './uiUtils.js';

// --- Application Features ---
import {
    checkForUpdate, handleToggleSidebarCollapse, handleToggleRunnerCollapse,
    manualCheckForUpdate // <-- IMPORTED manualCheckForUpdate
} from './appFeatures.js';

// --- File Operations ---
import {
    handleSelectFlow, loadFlowList, saveCurrentFlow, handleCloseFlow,
    handleCreateNewFlow, handleOpenFile, handleSaveAs, handleCancelFlow,
    confirmDiscardChanges
} from './fileOperations.js';

// --- Event Handlers (Callbacks for Components) ---
import {
    initializeEventListeners, // <-- This function now handles ALL primary button listeners
    // Callbacks below are now primarily invoked by global handlers in app.js or internal builder logic
    handleBuilderStepSelect,
    handleBuilderStepUpdate,
    handleBuilderStepEdit,
    handleBuilderRequestAddStep,
    handleBuilderEditorDirtyChange,
    handleVisualizerNodeLayoutUpdate,
    handleVisualizerNodeMove,
    // NOTE: handleToggleInfoOverlay & handleToggleVariablesPanel are still EXPORTED from eventHandlers.js
    // and are called by the consolidated listeners within initializeEventListeners
} from './eventHandlers.js';

// --- Component Classes & Dialog Initializers ---
import { FlowBuilderComponent } from './flowBuilderComponent.js';
import { FlowVisualizer } from './flowVisualizer.js';
import {
    initializeStepTypeDialogListeners,
    initializeVarDropdownListeners,
    initializeVariableInsertionListener
} from './dialogs.js';

// --- Runner and Execution Components ---
import {
    updateRunnerUI,
    handleRunnerStepStart,
    handleRunnerStepComplete,
    handleRunnerFlowComplete,
    handleRunnerFlowStopped,
    handleRunnerError,
    handleRunnerContextUpdate
} from './runnerInterface.js';
import { createFlowRunner, substituteVariablesInStep, evaluateCondition } from './executionHelpers.js';

// --- Core Logic ---
import { evaluatePath, escapeHTML } from './flowCore.js';

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    logger.info("Initializing FlowRunner (Electron Version)...");

    initializeDOMReferences();
    loadFlowList();
    initializeAppComponents();
    initializeRunner();
    initializeEventListeners(); // <-- Call the consolidated listener setup from eventHandlers.js
    setupGlobalOverlayListeners(); // For the global Info Overlay *content* listeners (inputs, adds)

    updateRunnerUI();
    updateViewToggle();
    updateWorkspaceTitle();
    setDirty(); // Initialize dirty state/UI
    loadPersistedUIStates();
    checkElectronAPI();
    checkForUpdate(); // Startup update check (silent on failure)

    // --- IPC Listeners ---
    if (window.electronAPI) {
        // Existing listener for dirty state check
        if (typeof window.electronAPI.onCheckDirtyState === 'function') {
            window.electronAPI.onCheckDirtyState(() => {
                // Combine flow dirty state, step editor dirty state, and continuous run state
                const needsUserAttention = appState.isDirty || appState.stepEditorIsDirty || appState.isContinuousRunActive;
                logger.debug('[Renderer] IPC: Received check-dirty-state, responding with (needsUserAttention):', needsUserAttention);
                if (typeof window.electronAPI.sendDirtyStateResponse === 'function') {
                    window.electronAPI.sendDirtyStateResponse(needsUserAttention);
                } else {
                    logger.error("[Renderer] IPC: sendDirtyStateResponse function not available on electronAPI.");
                }
            });
        } else {
            logger.warn("[Renderer] IPC: onCheckDirtyState function not available on electronAPI.");
        }

        // --- NEW: Listener for manual update check trigger ---
        if (typeof window.electronAPI.onManualUpdateCheckTrigger === 'function') {
             window.electronAPI.onManualUpdateCheckTrigger(() => {
                 logger.debug('[Renderer] Received trigger-manual-update-check via preload.');
                 manualCheckForUpdate(); // Call the function from appFeatures.js
             });
        } else {
            logger.warn("[Renderer] IPC: onManualUpdateCheckTrigger function not available on electronAPI.");
        }
        // --- END NEW ---

    } else {
        logger.warn("[Renderer] Electron API not detected. File operations and IPC listeners unavailable.");
        // Optionally disable file buttons if API is missing (already done in checkElectronAPI)
    }
    // --- End IPC Listeners ---

    logger.info("Initial render triggered.");
    renderCurrentFlow(); // Render initial state (likely placeholder)
});

// --- Core Component Initialization ---
export function initializeAppComponents() {
    initializeStepTypes(); // Placeholder
    initializeBuilder();
    initializeVisualizer();
    initializeDialogs();
    logger.info("Core app components initialized/re-initialized.");
}

function initializeStepTypes() {
    logger.debug("initializeStepTypes called (placeholder in app.js).");
    // Potentially load step type definitions if needed dynamically
}

function initializeBuilder() {
    if (!domRefs.flowBuilderMount) {
        logger.error("FlowBuilder mount point not found. Cannot initialize builder.");
        return;
    }
    // Variables toggle button reference is passed but its listener is handled globally now
    if (!domRefs.toggleVariablesBtn) {
         logger.warn("Variables toggle button (domRefs.toggleVariablesBtn) not found for FlowBuilderComponent constructor.");
    }
    appState.builderComponent = new FlowBuilderComponent(
        domRefs.flowBuilderMount,
        domRefs.toggleVariablesBtn, // Pass the button element itself for potential future use
        {
            // Callbacks handled by eventHandlers.js
            onStepSelect: handleBuilderStepSelect,
            onStepUpdate: handleBuilderStepUpdate, // For add/delete/move/clone *within* list view
            onStepEdit: handleBuilderStepEdit,     // When editor "Save Step" is clicked
            onRequestAddStep: handleBuilderRequestAddStep, // When list view "Add Step" is clicked
            onEditorDirtyChange: handleBuilderEditorDirtyChange, // When editor content changes

            // REMOVED: Global flow info updates are now handled directly in app.js
            // onFlowUpdate: handleBuilderFlowUpdate,
            // onHeadersUpdate: handleBuilderHeadersUpdate,
            // onFlowVarsUpdate: handleBuilderFlowVarsUpdate,
        }
    );
    logger.info("FlowBuilderComponent initialized in app.js (Overlays handled globally).");
}

function initializeVisualizer() {
    if (!domRefs.flowVisualizerMount) {
        logger.error("FlowVisualizer mount point not found. Cannot initialize visualizer.");
        return;
    }
    appState.visualizerComponent = new FlowVisualizer(
        domRefs.flowVisualizerMount,
        {
            // Callbacks handled by eventHandlers.js
            onNodeSelect: handleBuilderStepSelect,             // Selecting a node
            onNodeLayoutUpdate: handleVisualizerNodeLayoutUpdate, // Node moved/dropped
            onDeleteStep: (stepId) => handleBuilderStepUpdate({ type: 'delete', stepId }) // Delete requested from node
            // Add other callbacks like onCloneStep if needed
        }
    );
    logger.info("FlowVisualizer initialized in app.js.");
}

function initializeDialogs() {
    initializeStepTypeDialogListeners();
    initializeVarDropdownListeners();
    initializeVariableInsertionListener(); // Sets up the body listener for {{...}} buttons
    logger.info("Dialog listeners initialized via app.js wrapper.");
}

// --- *** MODIFIED SECTION: initializeRunner *** ---
function initializeRunner() {
    appState.runner = createFlowRunner({
        // Runner Lifecycle Callbacks (handled by runnerInterface.js)
        onStepStart: handleRunnerStepStart,
        onStepComplete: handleRunnerStepComplete,
        onFlowComplete: handleRunnerFlowComplete,
        onFlowStopped: handleRunnerFlowStopped,
        onError: handleRunnerError,
        onContextUpdate: handleRunnerContextUpdate, // For updating variables panel

        // Utility Callbacks
        // <<< --- CHANGE HERE --- >>>
        // Log messages to the dedicated runner *status* panel, NOT the results list
        onMessage: (message, type) => showMessage(message, type, domRefs.runnerStatusMessages),
        // <<< --- END CHANGE --- >>>

        updateRunnerUICallback: updateRunnerUI, // Allow runner to request UI updates (e.g., button states)

        // Core Logic Functions Provided to Runner
        substituteVariablesFn: substituteVariablesInStep,
        evaluateConditionFn: evaluateCondition,
        evaluatePathFn: evaluatePath,
    });
    logger.info("FlowRunner engine initialized successfully");
}
// --- *** END MODIFIED SECTION *** ---

function loadPersistedUIStates() {
    try {
        const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        const runnerCollapsed = localStorage.getItem('runnerCollapsed') === 'true';
        // Sidebar state
        if (sidebarCollapsed && domRefs.sidebar) {
            appState.isSidebarCollapsed = true;
            domRefs.sidebar.classList.add('collapsed');
            if (domRefs.sidebarToggleBtn) domRefs.sidebarToggleBtn.setAttribute('aria-expanded', 'false');
        }
        // Runner state
        if (runnerCollapsed && domRefs.runnerPanel) {
            appState.isRunnerCollapsed = true;
            domRefs.runnerPanel.classList.add('collapsed');
            if (domRefs.runnerToggleBtn) domRefs.runnerToggleBtn.setAttribute('aria-expanded', 'false');
        }
    } catch (e) {
        logger.warn("Error loading persisted UI states:", e);
    }
}

function checkElectronAPI() {
    if (!window.electronAPI) {
        logger.error("Electron API unavailable - Limited functionality mode");
        showMessage("Limited functionality mode - File operations unavailable", "warning");
        if (domRefs.openFlowBtn) domRefs.openFlowBtn.disabled = true;
        if (domRefs.saveFlowBtn) domRefs.saveFlowBtn.disabled = true;
        if (domRefs.saveAsFlowBtn) domRefs.saveAsFlowBtn.disabled = true;
    }
}

// --- REMOVED initializeCoreEventListeners() FUNCTION ---
// Listeners for toggle/close buttons are now consolidated in eventHandlers.js

// --- Global Info Overlay *Content* Logic & Listeners ---
function setupGlobalOverlayListeners() {
    // Listeners for changes *within* the overlay content (inputs, adds, removes)
    domRefs.infoOverlayNameInput?.addEventListener('input', handleGlobalInfoChange);
    domRefs.infoOverlayDescTextarea?.addEventListener('input', handleGlobalInfoChange);

    domRefs.infoOverlayGlobalHeadersList?.addEventListener('input', handleGlobalHeadersChange);
    domRefs.infoOverlayGlobalHeadersList?.addEventListener('click', handleGlobalHeadersListActions);
    domRefs.infoOverlayAddGlobalHeaderBtn?.addEventListener('click', handleAddGlobalHeader);
    setupCollapsible(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent);

    domRefs.infoOverlayFlowVarsList?.addEventListener('input', handleGlobalFlowVarsChange);
    domRefs.infoOverlayFlowVarsList?.addEventListener('click', handleGlobalFlowVarsListActions);
    domRefs.infoOverlayAddFlowVarBtn?.addEventListener('click', handleAddGlobalFlowVar);
    setupCollapsible(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);

    // Note: The "Close Info" button (#actual-close-info-btn) listener is now handled
    //       in eventHandlers.js -> initializeEventListeners()
    logger.info("Global Info Overlay *content* listeners initialized.");
}

function handleGlobalInfoChange() {
    if (!appState.currentFlowModel) return;
    const newName = domRefs.infoOverlayNameInput?.value ?? appState.currentFlowModel.name;
    const newDesc = domRefs.infoOverlayDescTextarea?.value ?? appState.currentFlowModel.description;
    if (appState.currentFlowModel.name !== newName || appState.currentFlowModel.description !== newDesc) {
        appState.currentFlowModel.name = newName;
        appState.currentFlowModel.description = newDesc;
        appState.isDirty = true;
        setDirty(); // Update UI based on dirty state
        updateWorkspaceTitle(); // Update title with new name and potentially '*'
    }
}

function handleGlobalHeadersChange(event) {
     if (!appState.currentFlowModel) return;
     // Check if the event target is an input within a header row
     if (event.target && (event.target.classList.contains('header-key') || event.target.classList.contains('header-value'))) {
         const newHeaders = getCurrentGlobalHeadersFromUI();
         // Only update if headers actually changed
         if (JSON.stringify(appState.currentFlowModel.headers || {}) !== JSON.stringify(newHeaders)) {
             appState.currentFlowModel.headers = newHeaders;
             appState.isDirty = true;
             setDirty();
             // Note: No need to re-render entire flow just for header changes
         }
     }
}

function handleGlobalHeadersListActions(event) {
    const removeButton = event.target.closest('.btn-remove-global-header');
    if (removeButton) {
         event.stopPropagation(); // Prevent clicks on parent elements
         const rowToRemove = removeButton.closest('.global-header-row');
         if (rowToRemove) {
            rowToRemove.remove();
            // After removing the row, update the model and check if placeholder needed
            handleGlobalHeadersChange({ target: null }); // Trigger state update using a generic event
            adjustCollapsibleHeight(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent); // Adjust height after removal
            if (domRefs.infoOverlayGlobalHeadersList && domRefs.infoOverlayGlobalHeadersList.children.length === 0) {
                 // Add placeholder if list is empty
                 domRefs.infoOverlayGlobalHeadersList.innerHTML = '<div class="global-header-row-no-items">No global headers defined</div>';
            }
         }
    }
}

function handleAddGlobalHeader() {
    _clearPlaceholder(domRefs.infoOverlayGlobalHeadersList, '.global-header-row-no-items');
    addGlobalHeaderRow('', '', domRefs.infoOverlayGlobalHeadersList); // Add an empty row
    handleGlobalHeadersChange({ target: null }); // Trigger state update (marks dirty)
}

function handleGlobalFlowVarsChange(event) {
     if (!appState.currentFlowModel) return;
     // Check if the event target is an input within a flow var row
     if (event.target && (event.target.classList.contains('flow-var-key') || event.target.classList.contains('flow-var-value'))) {
         const newVars = getCurrentFlowVarsFromUI();
         // Only update if variables actually changed
         if (JSON.stringify(appState.currentFlowModel.staticVars || {}) !== JSON.stringify(newVars)) {
             appState.currentFlowModel.staticVars = newVars;
             appState.isDirty = true;
             setDirty();
             updateDefinedVariables(); // Update the variables panel display
         }
     }
}

function handleGlobalFlowVarsListActions(event) {
    const removeButton = event.target.closest('.btn-remove-flow-var');
    if (removeButton) {
         event.stopPropagation();
         const rowToRemove = removeButton.closest('.flow-var-row');
         if (rowToRemove) {
            rowToRemove.remove();
            handleGlobalFlowVarsChange({ target: null }); // Trigger state update
            adjustCollapsibleHeight(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);
            if (domRefs.infoOverlayFlowVarsList && domRefs.infoOverlayFlowVarsList.children.length === 0) {
                 domRefs.infoOverlayFlowVarsList.innerHTML = '<div class="no-flow-vars">No flow variables defined</div>';
            }
         }
    }
}

function handleAddGlobalFlowVar() {
    _clearPlaceholder(domRefs.infoOverlayFlowVarsList, '.no-flow-vars');
    addFlowVarRow('', '', domRefs.infoOverlayFlowVarsList);
    handleGlobalFlowVarsChange({ target: null }); // Trigger state update
}

// --- Helper Functions for Global Info Overlay (Getters, Adders) ---
function getCurrentGlobalHeadersFromUI() {
    const headers = {};
    domRefs.infoOverlayGlobalHeadersList?.querySelectorAll('.global-header-row').forEach(row => {
        const keyInput = row.querySelector('.header-key');
        const valueInput = row.querySelector('.header-value');
        const key = keyInput?.value.trim();
        const value = valueInput?.value; // Allow empty values
        if (key) { // Only add if key is not empty
            headers[key] = value ?? '';
        }
    });
    return headers;
}

function addGlobalHeaderRow(key, value, container) { // `container` is passed from handleAddGlobalHeader
    if (!container) return;
    _clearPlaceholder(container, '.global-header-row-no-items'); // Clear placeholder if present

    const row = document.createElement('div');
    row.className = 'global-header-row';
    // Generate unique IDs for label association (optional but good practice)
    const keyId = `gh-key-global-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const valueId = `gh-val-global-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    row.innerHTML = `
        <input type="text" class="header-key" id="${keyId}" value="${escapeHTML(key)}" placeholder="Header Name">
        <input type="text" class="header-value" id="${valueId}" value="${escapeHTML(value)}" placeholder="Header Value">
        <button class="btn-insert-var" data-target-input="${valueId}" title="Insert Variable">{{…}}</button>
        <button class="btn-remove-global-header" title="Remove Header">✕</button>
    `;
    container.appendChild(row);
    adjustCollapsibleHeight(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent); // Adjust height after adding row
    // Note: Input and remove button listeners are attached globally or by the calling function (handleGlobalHeadersListActions)
}

function getCurrentFlowVarsFromUI() {
    const staticVars = {};
     domRefs.infoOverlayFlowVarsList?.querySelectorAll('.flow-var-row').forEach(row => {
         const keyInput = row.querySelector('.flow-var-key');
         const valueInput = row.querySelector('.flow-var-value');
         const typeSelect = row.querySelector('.flow-var-type');
         const key = keyInput?.value.trim();
         const rawValue = valueInput?.value; // Allow empty values

         let value;
         switch (typeSelect?.value) {
              case 'number':
                  value = Number(rawValue);
                  if (Number.isNaN(value)) value = rawValue;
                  break;
              case 'boolean':
                  value = String(rawValue).toLowerCase() === 'true';
                  break;
              case 'json':
                  try { value = JSON.parse(rawValue); } catch (e) { value = rawValue; }
                  break;
              default:
                  value = rawValue;
         }

         if (key && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) { // Validate variable name format
              staticVars[key] = value ?? '';
              if(keyInput) keyInput.style.borderColor = ''; // Reset border if valid
         } else if (key) {
              // Invalid key name, provide visual feedback but don't add to model
              logger.warn(`Invalid flow variable name ignored: ${key}`);
              if(keyInput) keyInput.style.borderColor = 'red';
         } else {
             // Key is empty, reset border
             if(keyInput) keyInput.style.borderColor = '';
         }
     });
    return staticVars;
}

function addFlowVarRow(key, value, container) { // `container` is passed from handleAddGlobalFlowVar
     if (!container) return;
    _clearPlaceholder(container, '.no-flow-vars'); // Clear placeholder

    const row = document.createElement('div');
    row.className = 'flow-var-row';
    const keyId = `fv-key-global-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const valueId = `fv-val-global-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const typeId = `fv-type-global-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    let detectedType = 'string';
    if (typeof value === 'number') detectedType = 'number';
    else if (typeof value === 'boolean') detectedType = 'boolean';
    else if (typeof value === 'object' && value !== null) {
        detectedType = 'json';
        try { value = JSON.stringify(value); } catch (e) { value = String(value); }
    }

    row.innerHTML = `
        <input type="text" class="flow-var-key" id="${keyId}" value="${escapeHTML(key)}" placeholder="Variable Name (letters, numbers, _)">
        <input type="text" class="flow-var-value" id="${valueId}" value="${escapeHTML(value)}" placeholder="Variable Value">
        <select class="flow-var-type" id="${typeId}">
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="json">JSON</option>
        </select>
        <button class="btn-insert-var" data-target-input="${valueId}" title="Insert Variable">{{…}}</button>
        <button class="btn-remove-flow-var" title="Remove Variable">✕</button>
    `;
    row.querySelector('.flow-var-type').value = detectedType;
    container.appendChild(row);
    adjustCollapsibleHeight(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);
}

// Helper to clear placeholder messages from lists
function _clearPlaceholder(container, selector) {
    if (!container) return;
    const placeholder = container.querySelector(selector);
    if (placeholder) {
        placeholder.remove();
    }
}

// --- Collapsible Section Logic ---
// Helper to set up a collapsible section (moved from builder component)
export function setupCollapsible(toggleBtn, contentEl) {
    if (!toggleBtn || !contentEl) {
        // logger.warn("setupCollapsible: Missing toggle button or content element.");
        return;
    }
    // Avoid re-initializing if already done
    if (toggleBtn.dataset.collapsibleInit === 'true') return;
    toggleBtn.dataset.collapsibleInit = 'true';

    toggleBtn.addEventListener('click', () => {
        const isActive = contentEl.classList.toggle('active'); // Toggle content visibility class
        toggleBtn.classList.toggle('active', isActive);      // Sync button state class

        if (isActive) {
            // Opening: Set padding *before* getting scrollHeight for accurate measurement
            contentEl.style.paddingTop = '15px';
            contentEl.style.paddingBottom = '15px';
            requestAnimationFrame(() => { // Ensure padding is applied before measuring
                contentEl.style.maxHeight = contentEl.scrollHeight + "px";
            });
        } else {
            // Closing: Set maxHeight to 0 first
            contentEl.style.maxHeight = '0px';
            // Remove padding *after* transition completes (avoids jump)
            setTimeout(() => {
                // Double check it's still closed before removing padding
                if (!contentEl.classList.contains('active')) {
                    contentEl.style.paddingTop = '0';
                    contentEl.style.paddingBottom = '0';
                }
            }, 300); // Match transition duration
        }

        // Update icon (assuming it exists within the button)
        const icon = toggleBtn.querySelector('.toggle-icon');
        if (icon) icon.textContent = isActive ? '▲' : '▼';
    });

    // Initial state styling (if not initially active)
    if (!contentEl.classList.contains('active')) {
        contentEl.style.maxHeight = '0px';
        contentEl.style.paddingTop = '0';
        contentEl.style.paddingBottom = '0';
        const icon = toggleBtn.querySelector('.toggle-icon');
        if (icon) icon.textContent = '▼';
    } else {
        // If initially active (e.g., from saved state or default), ensure it's styled correctly
        contentEl.style.paddingTop = '15px';
        contentEl.style.paddingBottom = '15px';
        requestAnimationFrame(() => { // Measure after initial styles
            contentEl.style.maxHeight = contentEl.scrollHeight + "px";
        });
        const icon = toggleBtn.querySelector('.toggle-icon');
        if (icon) icon.textContent = '▲';
    }
}

// Helper to readjust collapsible height when content changes (e.g., add/remove item)
export function adjustCollapsibleHeight(toggleBtn, contentEl) {
     if (!toggleBtn || !contentEl) return;
     // Only adjust if the section is currently active/open
     if (toggleBtn.classList.contains('active')) {
         // Ensure padding is set correctly before measuring scrollHeight
         contentEl.style.paddingTop = '15px';
         contentEl.style.paddingBottom = '15px';
         requestAnimationFrame(() => { // Use rAF to ensure styles are applied before measuring
            const currentScrollHeight = contentEl.scrollHeight;
            contentEl.style.maxHeight = currentScrollHeight + "px";
         });
     }
}

// --- REMOVED setupPanelListeners and its helpers ---
// Listeners for panel close buttons are now handled in eventHandlers.js

// --- End of Global Info Overlay Logic ---

logger.info("FlowRunner Application: Initialization complete");