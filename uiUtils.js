// ========== FILE: uiUtils.js (REVISED - Using IPC for External Links) ==========

import { appState, domRefs } from './state.js';
import { escapeHTML, findDefinedVariables, findStepById, generateConditionPreview } from './flowCore.js';
import { updateRunnerUI } from './runnerInterface.js';
// --- Import Event Handlers needed for direct binding on global elements ---
import { handleBuilderFlowUpdate, handleBuilderHeadersUpdate, handleBuilderFlowVarsUpdate } from './eventHandlers.js';
// Import adjustCollapsibleHeight from app.js (assuming it's exported there)
import { adjustCollapsibleHeight as appAdjustCollapsibleHeight } from './app.js';
import { logger } from './logger.js';

// Simple path shim for display purposes
const path = {
    basename: (p) => p.split(/[\\/]/).pop() || p
};

// --- Helper Function to Safely Open External Links (Uses IPC via Preload) ---
function openExternalLink(url) {
    logger.info(`[uiUtils] Attempting to trigger external link via preload: ${url}`);

    // Check if the NEW preload function exists
    if (window.electronAPI && typeof window.electronAPI.triggerOpenExternalLink === 'function') {
        try {
            // Call the preload function that sends the IPC message to main.js
            const sent = window.electronAPI.triggerOpenExternalLink(url);

            // Check the return value from preload (basic validation check)
            if (!sent) {
                // This means preload's basic validation failed (e.g., invalid URL format)
                logger.error(`[uiUtils] preload triggerOpenExternalLink returned false (invalid URL?): ${url}`);
                showMessage("Could not open link. Invalid URL format?", "error", domRefs.builderMessages);
            } else {
                // Message was successfully sent to main process via preload.
                // The main process will handle the actual opening using shell.openExternal.
                logger.info(`[uiUtils] IPC message sent to main process for: ${url}`);
            }
        } catch (error) {
            // Catch errors calling the preload function itself (e.g., if context bridge failed)
            logger.error(`[uiUtils] Error calling electronAPI.triggerOpenExternalLink:`, error);
            showMessage(`Error trying to open link: ${error.message}`, "error", domRefs.builderMessages);
        }
    } else {
        // Preload function or the main electronAPI object is missing
        logger.error("[uiUtils] Cannot open external link: electronAPI.triggerOpenExternalLink not available.");
        showMessage("Could not open link. Functionality unavailable.", "error", domRefs.builderMessages);
    }
}

export function setLoading(isLoading, scope = 'global') {
    appState.isLoading = isLoading;
    if (scope === 'global' && domRefs.globalLoadingOverlay) {
        domRefs.globalLoadingOverlay.style.display = isLoading ? 'flex' : 'none';
    }
    // Also update button states based on loading status
    if (domRefs.addFlowBtn) domRefs.addFlowBtn.disabled = isLoading;
    if (domRefs.openFlowBtn) domRefs.openFlowBtn.disabled = isLoading;

    // Update save/save-as based on loading AND dirty state
    setDirty(); // Let setDirty handle the logic based on isLoading and other states

    // Update runner buttons based on loading state
    updateRunnerUI();
}

export function setDirty() {
    const flowIsLoaded = !!appState.currentFlowModel;
    // Combine both dirty flags for overall "needs save" state
    const isAppDirty = appState.isDirty || appState.stepEditorIsDirty;
    const appIsLoading = appState.isLoading;
    const hasFilePath = !!appState.currentFilePath;
    // Check if there are any steps at all
    const hasSteps = flowIsLoaded && !!appState.currentFlowModel.steps?.length;

    updateWorkspaceTitle();

    // --- Save Button Logic ---
    // Enabled if: Flow loaded AND has a path AND is dirty AND has steps AND not loading
    if (domRefs.saveFlowBtn) {
        const canSave = flowIsLoaded && hasFilePath && isAppDirty && hasSteps && !appIsLoading;
        domRefs.saveFlowBtn.disabled = !canSave;
        domRefs.saveFlowBtn.classList.toggle('needs-save', canSave); // Visual indicator
    }

    // --- Save As Button Logic ---
    // Enabled if: Flow loaded AND has steps AND not loading
    if (domRefs.saveAsFlowBtn) {
        const canSaveAs = flowIsLoaded && hasSteps && !appIsLoading;
        domRefs.saveAsFlowBtn.disabled = !canSaveAs;
    }

    // --- Cancel Button Logic ---
    // Enabled if: Flow loaded AND is dirty AND not loading
    if (domRefs.cancelFlowBtn) {
        const canCancel = flowIsLoaded && isAppDirty && !appIsLoading;
        domRefs.cancelFlowBtn.disabled = !canCancel;
    }

    // --- Close Button Logic ---
    // Enabled if: Flow loaded AND NOT dirty AND not loading
    if (domRefs.closeFlowBtn) {
        const canClose = flowIsLoaded && !isAppDirty && !appIsLoading;
        domRefs.closeFlowBtn.disabled = !canClose;
    }

    // Notify main process if dirty state changes (optional, if needed elsewhere)
    // if (window.electronAPI && typeof window.electronAPI.notifyDirtyStateChanged === 'function') {
    //     window.electronAPI.notifyDirtyStateChanged(isAppDirty);
    // }
}

export function updateWorkspaceTitle() {
    let title = 'FlowRunner';
    let workspaceHeader = 'Select or Create a Flow';

    if (appState.currentFlowModel) {
        const baseName = appState.currentFlowModel.name || 'Untitled Flow';
        // Use file basename if path exists, otherwise use flow name
        const displayFileName = appState.currentFilePath ? path.basename(appState.currentFilePath) : baseName;
        const needsSave = appState.isDirty || appState.stepEditorIsDirty;

        // Title bar shows filename (or flow name) + dirty indicator
        title = `${displayFileName}${needsSave ? ' *' : ''} - FlowRunner`;
        // Workspace header shows flow name + dirty indicator
        workspaceHeader = `${baseName}${needsSave ? ' *' : ''}`;
    }

    // Update DOM elements if they exist
    if (domRefs.workspaceTitle) {
        domRefs.workspaceTitle.textContent = workspaceHeader;
    }
    document.title = title;
}

export function showMessage(message, type = 'info', container = domRefs.builderMessages, title = null, allowHTML = false) {
    if (!container) return;
    const MAX_MESSAGES = 3; // Keep max messages for the main area
    // For runner status, don't limit aggressively, maybe keep last 5?
    const limit = container === domRefs.runnerStatusMessages ? 5 : MAX_MESSAGES;
    while (container.children.length >= limit && container.lastChild) {
        container.removeChild(container.lastChild);
    }

    const messageEl = document.createElement('div');
    messageEl.className = `flow-message ${type}`;
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    const iconHtml = `<div class="message-icon">${icons[type] || icons.info}</div>`;
    const contentContainer = document.createElement('div'); // Container for content
    contentContainer.className = 'message-content';

    // Set content and attach listeners if HTML is allowed
    if (allowHTML) {
        contentContainer.innerHTML = message; // Set raw HTML
        // --- Add click listener for links within allowed HTML ---
        contentContainer.querySelectorAll('a[href^="http"]').forEach(link => {
            // Line 143 in original error trace likely points here or inside the listener
            link.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent default navigation within Electron window
                logger.info(`[showMessage] HTML Link clicked: ${link.href}`);
                // --- THIS CALL MUST BE CORRECT ---
                openExternalLink(link.href); // Call the updated helper function
            });
        });
    } else {
        contentContainer.textContent = message; // Use textContent to escape HTML by default
    }

    messageEl.innerHTML = `
        ${iconHtml}
        <div class="message-body">
            <div class="message-header">
                ${title ? `<strong>${escapeHTML(title)}</strong>` : ''}
                <button class="btn-close-message" title="Dismiss message">✕</button>
            </div>
            <!-- Content will be appended below -->
        </div>
    `;
    // Append the content element we created and potentially attached listeners to
    messageEl.querySelector('.message-body').appendChild(contentContainer);


    const btn = messageEl.querySelector('.btn-close-message');
    let timeoutId = null;
    const dismiss = () => {
        clearTimeout(timeoutId);
        if (!messageEl?.parentNode) return;
        messageEl.style.opacity = '0';
        messageEl.style.transition = 'opacity 0.3s ease';
        setTimeout(() => messageEl?.remove(), 300);
    };
    btn?.addEventListener('click', dismiss);
    // Adjust timeout based on container
    const isRunnerStatus = container === domRefs.runnerStatusMessages;
    const timeoutDuration = type === 'error' ? (isRunnerStatus ? 8000 : 10000) : (type === 'success' ? (isRunnerStatus ? 3000 : 4000) : (isRunnerStatus ? 4000 : 5000));
    timeoutId = setTimeout(dismiss, timeoutDuration);

    // Prepend for main messages, append for runner status for chronological order?
    if (container === domRefs.runnerStatusMessages) {
         container.appendChild(messageEl);
         container.scrollTop = container.scrollHeight; // Auto-scroll runner status
    } else {
        container.prepend(messageEl);
    }
}


export function clearMessages(container = domRefs.builderMessages) {
    if (container) container.innerHTML = '';
    // Clear runner status messages as well if clearing main messages
    if (container === domRefs.builderMessages && domRefs.runnerStatusMessages) {
        domRefs.runnerStatusMessages.innerHTML = '';
    }
}

export function renderCurrentFlow() {
    if (!appState.currentFlowModel) {
        clearWorkspace(true); // Full clear if no model
        return;
    }

    // Ensure elements dependent on a flow are visible
    if (domRefs.workspacePlaceholder) domRefs.workspacePlaceholder.style.display = 'none';
    if (domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
    if (domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
    if (domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = '';

    // Set active view
    if (domRefs.flowBuilderMount) domRefs.flowBuilderMount.classList.toggle('active', appState.currentView === 'list-editor');
    if (domRefs.flowVisualizerMount) domRefs.flowVisualizerMount.classList.toggle('active', appState.currentView === 'node-graph');

    // Populate global info overlay (values only)
    _populateGlobalInfoOverlay();

    // Update defined variables list based on current model structure
    updateDefinedVariables(); // Uses findDefinedVariables on the model

    // Render the active component (Builder or Visualizer)
    if (appState.currentView === 'list-editor') {
        if (appState.builderComponent) {
            appState.builderComponent.render(
                appState.currentFlowModel,
                appState.selectedStepId,
                domRefs.variablesPanel,      // Pass panel reference
                domRefs.variablesContainer   // Pass content container reference
            );
            setupPaneResizer(); // Ensure resizer is set up for builder view
        } else {
            logger.error("FlowBuilderComponent not initialized!");
            if (domRefs.flowBuilderMount) domRefs.flowBuilderMount.innerHTML = '<p style="color:red; padding:20px;">Error: Builder Component not loaded.</p>';
        }
    } else if (appState.currentView === 'node-graph') {
        if (appState.visualizerComponent) {
            appState.visualizerComponent.render(appState.currentFlowModel, appState.selectedStepId);
        } else {
            logger.error("Visualizer component not initialized!");
            if (domRefs.flowVisualizerMount) domRefs.flowVisualizerMount.innerHTML = '<p style="color:red; padding:20px;">Error: Visualizer Component not loaded.</p>';
        }
    }

    // Sync visibility of toggle buttons and panels
    syncPanelVisibility();

    // Update button states based on dirty status, etc.
    setDirty();
}

// Helper to Populate Global Info Overlay (values only, listeners are in app.js)
function _populateGlobalInfoOverlay() {
    const model = appState.currentFlowModel;
    if (!model || !domRefs.infoOverlay) return;

    // Populate Name and Description
    if (domRefs.infoOverlayNameInput) {
        domRefs.infoOverlayNameInput.value = model.name || '';
    }
    if (domRefs.infoOverlayDescTextarea) {
        domRefs.infoOverlayDescTextarea.value = model.description || '';
    }

    // Populate Headers and Variables sections
    _renderGlobalHeadersUI();
    _renderGlobalFlowVarsUI();

    // Adjust height of collapsibles if they are open and content might have changed
    // Use the imported function safely
    if (domRefs.infoOverlayGlobalHeadersToggle?.classList.contains('active')) {
        if (typeof appAdjustCollapsibleHeight === 'function') {
            appAdjustCollapsibleHeight(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent);
        }
    }
    if (domRefs.infoOverlayFlowVarsToggle?.classList.contains('active')) {
         if (typeof appAdjustCollapsibleHeight === 'function') {
             appAdjustCollapsibleHeight(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);
         }
    }
    // Note: The initial setup of collapsible listeners is done in app.js `setupGlobalOverlayListeners`
}

// Helper to Render Global Headers UI (populates list with existing items)
function _renderGlobalHeadersUI() {
    const container = domRefs.infoOverlayGlobalHeadersList;
    if (!container) return;

    container.innerHTML = ''; // Clear previous
    const headers = appState.currentFlowModel?.headers || {};
    const hasHeaders = Object.keys(headers).length > 0;

    if (!hasHeaders) {
        container.innerHTML = '<div class="global-header-row-no-items">No global headers defined</div>';
    } else {
        Object.entries(headers).forEach(([key, value]) => {
            _addGlobalHeaderRow(key, value, false); // Add rows without triggering top-level update
        });
    }
    // The "Add Header" button listener is set up in app.js
}

// Helper to Add a Global Header Row (for initial population from model)
// Note: Event listeners for inputs/remove are now handled globally in app.js
function _addGlobalHeaderRow(key, value, triggerUpdate = true) {
    const container = domRefs.infoOverlayGlobalHeadersList;
    if (!container) return;

    _clearPlaceholder(container, '.global-header-row-no-items'); // Clear placeholder if present

    const row = document.createElement('div');
    row.className = 'global-header-row';
    const keyId = `gh-key-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const valueId = `gh-val-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    row.innerHTML = `
        <input type="text" class="header-key" id="${keyId}" value="${escapeHTML(key)}" placeholder="Header Name">
        <input type="text" class="header-value" id="${valueId}" value="${escapeHTML(value)}" placeholder="Header Value">
        <button class="btn-insert-var" data-target-input="${valueId}" title="Insert Variable">{{…}}</button>
        <button class="btn-remove-global-header" title="Remove Header">✕</button>
    `;
    container.appendChild(row);

    // Removed local event listeners - handled globally in app.js

    if (triggerUpdate) { // Should usually be false for initial population
         handleBuilderHeadersUpdate(_getCurrentGlobalHeadersFromUI());
    }
    // Adjust height only if needed (e.g., if called by add button)
    if (triggerUpdate && typeof appAdjustCollapsibleHeight === 'function') {
         appAdjustCollapsibleHeight(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent);
    }
}

// Helper to Get Global Headers from UI
function _getCurrentGlobalHeadersFromUI() {
    const headers = {};
    domRefs.infoOverlayGlobalHeadersList?.querySelectorAll('.global-header-row').forEach(row => {
        const key = row.querySelector('.header-key')?.value.trim();
        const value = row.querySelector('.header-value')?.value || '';
        if (key) headers[key] = value;
    });
    return headers;
}

// Helper to Render Global Flow Vars UI
function _renderGlobalFlowVarsUI() {
    const container = domRefs.infoOverlayFlowVarsList;
    if (!container) return;

    container.innerHTML = ''; // Clear previous
    const staticVars = appState.currentFlowModel?.staticVars || {};
    const hasVars = Object.keys(staticVars).length > 0;

    if (!hasVars) {
        container.innerHTML = '<div class="no-flow-vars">No flow variables defined</div>';
    } else {
        Object.entries(staticVars).forEach(([key, value]) => {
            _addFlowVarRow(key, value, false);
        });
    }
    // "Add Variable" button listener is in app.js
}

// Helper to Add a Flow Var Row
// Note: Event listeners for inputs/remove are now handled globally in app.js
function _addFlowVarRow(key, value, triggerUpdate = true) {
    const container = domRefs.infoOverlayFlowVarsList;
    if (!container) return;

    _clearPlaceholder(container, '.no-flow-vars');

    const row = document.createElement('div');
    row.className = 'flow-var-row';
    const keyId = `fv-key-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const valueId = `fv-val-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const typeId = `fv-type-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

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

    // Removed local event listeners - handled globally in app.js

    if (triggerUpdate) { // Should usually be false for initial population
        handleBuilderFlowVarsUpdate(_getCurrentFlowVarsFromUI());
    }
     // Adjust height only if needed (e.g., if called by add button)
     if (triggerUpdate && typeof appAdjustCollapsibleHeight === 'function') {
         appAdjustCollapsibleHeight(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);
     }
}

// Helper to Get Flow Vars from UI
function _getCurrentFlowVarsFromUI() {
    const staticVars = {};
    domRefs.infoOverlayFlowVarsList?.querySelectorAll('.flow-var-row').forEach(row => {
        const keyInput = row.querySelector('.flow-var-key');
        const valueInput = row.querySelector('.flow-var-value');
        const typeSelect = row.querySelector('.flow-var-type');
        const key = keyInput?.value.trim();
        const rawValue = valueInput?.value || '';

        let value;
        switch (typeSelect?.value) {
            case 'number':
                value = Number(rawValue);
                if (Number.isNaN(value)) value = rawValue;
                break;
            case 'boolean':
                value = rawValue.toLowerCase() === 'true';
                break;
            case 'json':
                try { value = JSON.parse(rawValue); } catch (e) { value = rawValue; }
                break;
            default:
                value = rawValue;
        }

        if (key && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
             staticVars[key] = value;
             if(keyInput) keyInput.style.borderColor = '';
        } else if (key) {
             logger.warn(`Invalid flow variable name ignored: ${key}`);
             if(keyInput) keyInput.style.borderColor = 'red';
        } else {
            if(keyInput) keyInput.style.borderColor = '';
        }
    });
    return staticVars;
}

// Helper to clear placeholder messages
function _clearPlaceholder(container, selector) {
    if (!container) return;
    const placeholder = container.querySelector(selector);
    if (placeholder) {
        placeholder.remove();
    }
}

export function clearWorkspace(fullClear = true) {
    // Destroy components if they exist
    if (appState.builderComponent) {
        try {
             if (typeof appState.builderComponent.destroy === 'function') {
                appState.builderComponent.destroy();
             }
             appState.builderComponent = null;
        } catch (error) { logger.error("Error destroying builder component:", error); }
    }
    if (appState.visualizerComponent) {
         try {
            if (typeof appState.visualizerComponent.destroy === 'function') {
                appState.visualizerComponent.destroy();
            }
            appState.visualizerComponent = null;
        } catch (error) { logger.error("Error clearing/destroying visualizer component:", error); }
    }

    // Clear DOM mounts
    if (domRefs.flowBuilderMount) {
        domRefs.flowBuilderMount.innerHTML = '';
        domRefs.flowBuilderMount.classList.remove('active');
    }
    if (domRefs.flowVisualizerMount) {
        domRefs.flowVisualizerMount.innerHTML = '';
        domRefs.flowVisualizerMount.classList.remove('active');
    }

    // Reset and hide overlays/panels
    if (domRefs.infoOverlay) {
        domRefs.infoOverlay.classList.remove('open');
        if(domRefs.infoOverlayNameInput) domRefs.infoOverlayNameInput.value = '';
        if(domRefs.infoOverlayDescTextarea) domRefs.infoOverlayDescTextarea.value = '';
        if(domRefs.infoOverlayGlobalHeadersList) domRefs.infoOverlayGlobalHeadersList.innerHTML = '<div class="global-header-row-no-items">No global headers defined</div>';
        if(domRefs.infoOverlayFlowVarsList) domRefs.infoOverlayFlowVarsList.innerHTML = '<div class="no-flow-vars">No flow variables defined</div>';

        // Reset collapsibles within info overlay
        domRefs.infoOverlay.querySelectorAll('.collapsible-header.active').forEach(h => h.classList.remove('active'));
        domRefs.infoOverlay.querySelectorAll('.collapsible-content').forEach(c => {
             c.classList.remove('active'); // Also remove active class from content
             c.style.maxHeight = '0px';
             c.style.paddingTop = '0';
             c.style.paddingBottom = '0';
        });
        domRefs.infoOverlay.querySelectorAll('.toggle-icon').forEach(i => i.textContent = '▼');
    }
    if (domRefs.variablesPanel) domRefs.variablesPanel.classList.remove('visible');

    // Show placeholder message
    if (domRefs.workspacePlaceholder) domRefs.workspacePlaceholder.style.display = 'flex';

    // Hide view-specific controls
    if (domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = 'none';
    if (domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = 'none';
    if (domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = 'none';

    // Disable file controls
    if (domRefs.saveFlowBtn) {
        domRefs.saveFlowBtn.disabled = true;
        domRefs.saveFlowBtn.classList.remove('needs-save');
    }
    if (domRefs.saveAsFlowBtn) domRefs.saveAsFlowBtn.disabled = true;
    if (domRefs.cancelFlowBtn) domRefs.cancelFlowBtn.disabled = true;
    if (domRefs.closeFlowBtn) domRefs.closeFlowBtn.disabled = true;

    // Update panel visibility state
    appState.isInfoOverlayOpen = false;
    appState.isVariablesPanelVisible = false;
    syncPanelVisibility();

    if (fullClear) {
       // Reset core app state related to the loaded flow
       appState.currentFilePath = null;
       appState.currentFlowModel = null;
       appState.selectedStepId = null;
       appState.isDirty = false;
       appState.stepEditorIsDirty = false;
       appState.definedVariables = {};
       updateWorkspaceTitle(); // Update title to default
       clearMessages(); // Clear any lingering messages
       appState.currentView = 'list-editor'; // Reset to default view
       updateViewToggle(); // Update toggle button appearance
       _updateVariablesPanelUI(); // Clear variables panel content
   }
   setDirty(); // Ensure all buttons reflect the final (likely clean/disabled) state
}

/**
 * Updates the appState.definedVariables by analyzing the current flow model.
 * If runtimeContext is provided, it merges runtime variable information.
 * Then, calls _updateVariablesPanelUI to refresh the display.
 * @param {Object | null} runtimeContext Optional runtime context from the FlowRunner.
 */
export function updateDefinedVariables(runtimeContext = null) {
     if (appState.currentFlowModel) {
         // Use the findDefinedVariables function, passing the runtime context if available
         appState.definedVariables = findDefinedVariables(appState.currentFlowModel, runtimeContext);
     } else {
         appState.definedVariables = {}; // Clear if no flow model
     }
     _updateVariablesPanelUI(); // Refresh the panel display
}

/** Updates the variables panel UI based on the current appState.definedVariables */
export function _updateVariablesPanelUI() { // Keep as internal helper
    const container = domRefs.variablesContainer;
    if (!container) return;
    container.innerHTML = ''; // Clear previous content

    const variables = appState.definedVariables;

    if (!variables || Object.keys(variables).length === 0) {
        container.innerHTML = `<div class="no-variables-message"><p>No variables defined or extracted yet.</p></div>`;
        return;
    }

    const table = document.createElement('table');
    table.className = 'variables-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Variable Name</th>
                <th>Origin</th>
                <th>Details</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    if (!tbody) return; // Should not happen, but safety check

    const sortedVarNames = Object.keys(variables).sort();
    sortedVarNames.forEach(name => {
        const info = variables[name] || {}; // Handle potentially missing info gracefully
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="var-name">${escapeHTML(name)}</td>
            <td class="var-origin">${escapeHTML(info.origin || 'N/A')}</td>
            <td class="var-path">
                ${escapeHTML(
                    info.type === 'static' ? 'Static Value' :
                    info.type === 'loop' ? `Loop Item (from ${info.origin || 'Loop'})` :
                    info.type === 'extraction' ? (info.path || 'N/A') :
                    info.type === 'runtime' ? 'Runtime Value' :
                    'Unknown'
                )}
            </td>
        `;
        tbody.appendChild(row);
    });
    container.appendChild(table);
}

export function updateViewToggle() {
    if (!appState.currentFlowModel || !domRefs.toggleViewBtn) {
        if(domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = 'none';
        if(domRefs.zoomInBtn) domRefs.zoomInBtn.style.display = 'none';
        if(domRefs.zoomOutBtn) domRefs.zoomOutBtn.style.display = 'none';
        return;
    }
    domRefs.toggleViewBtn.style.display = ''; // Ensure button is visible if flow loaded
    if(domRefs.zoomInBtn) domRefs.zoomInBtn.style.display = appState.currentView === 'node-graph' ? '' : 'none';
    if(domRefs.zoomOutBtn) domRefs.zoomOutBtn.style.display = appState.currentView === 'node-graph' ? '' : 'none';
    if (appState.currentView === 'list-editor') {
        domRefs.toggleViewBtn.textContent = 'Visual View';
        domRefs.toggleViewBtn.title = 'Switch to Node-Graph View (Ctrl+3)';
        // Ensure Info/Vars buttons are potentially visible in list view
        if(domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
        if(domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
    } else { // Node-graph view
        domRefs.toggleViewBtn.textContent = 'Editor View';
        domRefs.toggleViewBtn.title = 'Switch to List/Editor View (Ctrl+3)';
        // Ensure Info/Vars buttons are potentially visible in graph view
        if(domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
        if(domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
    }
}

/** Syncs the visibility and state of Info/Variables panels and their toggle buttons */
export function syncPanelVisibility() {
    const toggleInfoBtn = domRefs.toggleInfoBtn;
    const toggleVariablesBtn = domRefs.toggleVariablesBtn;

    // --- Update Info Panel Toggle Button ---
    if (toggleInfoBtn) {
        const infoIconEl = toggleInfoBtn.querySelector('.toggle-icon');
        if (infoIconEl) infoIconEl.textContent = appState.isInfoOverlayOpen ? '▲' : '▼'; // Up when open, Down when closed
        toggleInfoBtn.classList.toggle('active', appState.isInfoOverlayOpen); // 'active' class when panel is open
        // Update button text based on state
        toggleInfoBtn.querySelector('.btn-text').textContent = appState.isInfoOverlayOpen ? 'Hide Info' : 'Info';
    }

    // --- Update Variables Panel Toggle Button ---
    if (toggleVariablesBtn) {
        const varIconEl = toggleVariablesBtn.querySelector('.toggle-icon');
        if (varIconEl) varIconEl.textContent = appState.isVariablesPanelVisible ? '▲' : '▼'; // Up when visible, Down when hidden
        toggleVariablesBtn.classList.toggle('active', appState.isVariablesPanelVisible); // 'active' class when panel is visible
        // Update button text based on state
        toggleVariablesBtn.querySelector('.btn-text').textContent = appState.isVariablesPanelVisible ? 'Hide Variables' : 'Show Variables';
    }

    // Show/hide the toggle buttons themselves based on whether a flow is loaded
    const shouldShowButtons = !!appState.currentFlowModel;
    if (toggleInfoBtn) toggleInfoBtn.style.display = shouldShowButtons ? '' : 'none';
    if (toggleVariablesBtn) toggleVariablesBtn.style.display = shouldShowButtons ? '' : 'none';
}

/** Clears all runtime-related status classes from steps in the list view */
export function clearListViewHighlights() {
    if (!domRefs.flowBuilderMount) return;
    try {
        // Define all possible status classes used for highlighting
        const statusClasses = ['step-running', 'step-success', 'step-error', 'step-stopped', 'step-skipped'];
        domRefs.flowBuilderMount.querySelectorAll('.flow-step')
            .forEach(el => {
                el.classList.remove(...statusClasses);
            });
    } catch (error) {
        logger.error("Error clearing list view highlights:", error);
    }
}

/**
 * Highlights a specific step in the list view with a given status class.
 * Removes previous status classes before adding the new one.
 * @param {string} stepId The ID of the step to highlight.
 * @param {string} statusClass The CSS class representing the status (e.g., 'step-running', 'step-success').
 */
export function highlightStepInList(stepId, statusClass) {
    // Ignore system steps that don't have a corresponding list item
    if (!stepId || /-(result|start|end|iter-\d+|error)$/i.test(stepId)) {
        return;
    }
    if (!domRefs.flowBuilderMount || !statusClass) return;
    try {
        const stepElement = domRefs.flowBuilderMount.querySelector(`.flow-step[data-step-id="${stepId}"]`);
        if (stepElement) {
            // Remove all potential previous status classes first
            clearListViewHighlights(); // Clear all highlights first to ensure clean state
            stepElement.classList.add(statusClass); // Add the new status class

            // Scroll into view logic
            try {
                const rect = stepElement.getBoundingClientRect();
                // Check if the flow builder mount point exists and has getBoundingClientRect
                const containerRect = domRefs.flowBuilderMount?.getBoundingClientRect();
                if (containerRect) {
                    const isInView = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
                    if (!isInView && typeof stepElement.scrollIntoView === 'function') {
                        // Try smooth scroll first, fallback to auto
                        try { stepElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); }
                        catch(smoothScrollError) { stepElement.scrollIntoView({ block: 'nearest' }); }
                    }
                } else if (typeof stepElement.scrollIntoView === 'function') {
                    // Fallback if container rect fails for some reason
                    stepElement.scrollIntoView({ block: 'nearest' });
                }
            } catch (scrollError) {
                 logger.warn(`ScrollIntoView failed for step ${stepId}:`, scrollError);
            }
        } else {
             logger.warn(`[Highlight List] Step element not found in DOM for ID: ${stepId}`);
        }
    } catch (error) {
        logger.error(`Error highlighting step ${stepId} in list view:`, error);
    }
}

/** Displays flow validation errors in the message area */
 export function showValidationErrors(errors) {
     if (!errors || !errors.length) return;
     const container = domRefs.builderMessages;
     if (!container) return;

     // Remove previous validation messages to prevent duplicates
     container.querySelectorAll('.validation-errors-message').forEach(el => el.remove());

     const messageEl = document.createElement('div');
     messageEl.className = 'flow-message error validation-errors-message'; // Specific class for validation

     // Create a list of errors
     const errorListHtml = errors.map(error => `<li>${escapeHTML(error)}</li>`).join('');
     const iconHtml = '<div class="message-icon">❌</div>'; // Error icon

     messageEl.innerHTML = `
          ${iconHtml}
          <div class="message-body">
             <div class="message-header">
                 <strong>Validation Failed</strong>
                 <button class="btn-close-message" title="Dismiss message">✕</button>
             </div>
             <ul class="validation-errors">${errorListHtml}</ul>
         </div>
     `;

     // Add dismiss functionality
     const btn = messageEl.querySelector('.btn-close-message');
     let timeoutId = null;
     const dismiss = () => {
         clearTimeout(timeoutId);
         if (!messageEl?.parentNode) return;
         messageEl.style.opacity = '0';
         messageEl.style.transition = 'opacity 0.3s ease';
         setTimeout(() => messageEl?.remove(), 300);
     };
     btn?.addEventListener('click', dismiss);

     // Make validation errors persist longer
     timeoutId = setTimeout(dismiss, 15000); // 15 seconds

     container.prepend(messageEl); // Add to the top
 }

/** Sets up the resizer between the steps list and editor panels */
export function setupPaneResizer () {
    const section = document.querySelector('#flow-builder-mount .flow-builder-section');
    if (!section) {
        logger.warn("Pane Resizer: Could not find .flow-builder-section");
        return;
    }
    const resizer = section.querySelector('.pane-resizer');
    const stepsPanel = section.querySelector('.flow-steps-panel');
    if (!resizer || !stepsPanel) {
        logger.warn("Pane Resizer: Could not find .pane-resizer or .flow-steps-panel");
        return;
    }

    // Avoid re-initializing
    if (resizer.dataset.init === '1') return;
    resizer.dataset.init = '1';

    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
    const getAxisVar = () => isMobile() ? '--steps-height' : '--steps-width';
    const getLsKey = () => isMobile() ? 'stepsPanelHeight' : 'stepsPanelWidth';
    const clampSize = (value) => Math.max(160, Math.min(value, window.innerWidth * 0.8, window.innerHeight * 0.8)); // Min 160px, Max 80%

    // Apply saved size on init
    const savedSize = parseFloat(localStorage.getItem(getLsKey()));
    if (Number.isFinite(savedSize)) {
        section.style.setProperty(getAxisVar(), `${clampSize(savedSize)}px`);
    }

    let startPointerPos, startPanelDim;

    const onPointerMove = (event) => {
        if (startPointerPos === undefined) return;
        const currentPointerPos = isMobile() ? event.clientY : event.clientX;
        const delta = currentPointerPos - startPointerPos;
        const newDim = clampSize(startPanelDim + delta);
        section.style.setProperty(getAxisVar(), `${newDim}px`);
    };

    const onPointerUp = (event) => {
        if (startPointerPos === undefined) return;
        resizer.releasePointerCapture(event.pointerId);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);

        // Save the final dimension
        const currentPanelDim = parseFloat(getComputedStyle(section).getPropertyValue(getAxisVar()));
        if (Number.isFinite(currentPanelDim)) {
            localStorage.setItem(getLsKey(), currentPanelDim);
        }

        startPointerPos = undefined;
        startPanelDim = undefined;
        document.body.style.userSelect = ''; // Re-enable text selection
    };

    resizer.addEventListener('pointerdown', (event) => {
        event.preventDefault(); // Prevent text selection during drag
        document.body.style.userSelect = 'none'; // Prevent text selection globally

        startPointerPos = isMobile() ? event.clientY : event.clientX;
        startPanelDim = isMobile() ? stepsPanel.offsetHeight : stepsPanel.offsetWidth;

        resizer.setPointerCapture(event.pointerId); // Capture pointer events
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
    });

    // Double-click to reset
    resizer.addEventListener('dblclick', () => {
        section.style.removeProperty('--steps-width');
        section.style.removeProperty('--steps-height');
        localStorage.removeItem('stepsPanelWidth'); // Remove both keys for safety
        localStorage.removeItem('stepsPanelHeight');
    });

    // Handle orientation change (mobile/desktop switch)
    let currentMobileState = isMobile();
    window.addEventListener('resize', () => {
        const newMobileState = isMobile();
        if (newMobileState !== currentMobileState) {
            logger.info(`Orientation changed: ${currentMobileState ? 'Mobile -> Desktop' : 'Desktop -> Mobile'}`);
            currentMobileState = newMobileState;

            // Re-apply correct dimension from localStorage or reset if none
            const sizeToApply = parseFloat(localStorage.getItem(getLsKey()));
            if (Number.isFinite(sizeToApply)) {
                section.style.setProperty(getAxisVar(), `${clampSize(sizeToApply)}px`);
            } else {
                // Reset both if no specific size saved for the new orientation
                section.style.removeProperty('--steps-width');
                section.style.removeProperty('--steps-height');
            }
        }
    });
    logger.info("Pane resizer setup complete.");
}

// --- NEW: Update Info Dialog Functions ---

export function showUpdateInfoDialog(title, message, allowHTML = false) {
    const dialog = document.getElementById('update-info-dialog');
    const titleEl = dialog?.querySelector('.update-info-title');
    const messageEl = dialog?.querySelector('.update-info-message');
    const closeBtn = dialog?.querySelector('.update-info-close');

    if (!dialog || !titleEl || !messageEl || !closeBtn) {
        logger.error("Update info dialog elements not found.");
        showMessage("Could not display update information.", "error"); // Fallback message
        return;
    }

    titleEl.textContent = title;

    // Clear previous content and listeners from message area
    messageEl.innerHTML = '';

    if (allowHTML) {
        messageEl.innerHTML = message; // Set raw HTML
        // Add click listener for links within allowed HTML
        messageEl.querySelectorAll('a[href^="http"]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent default navigation
                logger.info(`[showUpdateInfoDialog] Link clicked: ${link.href}`);
                openExternalLink(link.href); // Use helper function
            });
        });
    } else {
        messageEl.textContent = message; // Use textContent to escape HTML by default
    }

    // --- Simplified Listener Handling ---
    // Remove previous listeners first
    const currentBackdropListener = dialog._backdropListener;
    if (currentBackdropListener) {
        dialog.removeEventListener('click', currentBackdropListener);
    }
    const currentCloseBtnListener = closeBtn._closeListener;
     if (currentCloseBtnListener) {
        closeBtn.removeEventListener('click', currentCloseBtnListener);
    }

    // Define new listeners
    const newBackdropListener = (e) => {
        if (e.target === dialog) { // Check if the click is directly on the backdrop
            hideUpdateInfoDialog();
        }
    };
    const newCloseBtnListener = hideUpdateInfoDialog;

    // Attach new listeners
    dialog.addEventListener('click', newBackdropListener);
    closeBtn.addEventListener('click', newCloseBtnListener);

    // Store references for potential removal later (though hide should handle it)
    dialog._backdropListener = newBackdropListener;
    closeBtn._closeListener = newCloseBtnListener;
    // --- End Simplified Listener Handling ---


    dialog.style.display = 'flex'; // Show the dialog
    // Focus the close button for accessibility
    closeBtn.focus();
}

export function hideUpdateInfoDialog() {
    const dialog = document.getElementById('update-info-dialog');
    if (dialog) {
        dialog.style.display = 'none';
        // Optionally remove listeners if needed, although hiding should suffice
        // const closeBtn = dialog.querySelector('.update-info-close');
        // if (dialog._backdropListener) dialog.removeEventListener('click', dialog._backdropListener);
        // if (closeBtn && closeBtn._closeListener) closeBtn.removeEventListener('click', closeBtn._closeListener);
        // delete dialog._backdropListener;
        // if (closeBtn) delete closeBtn._closeListener;
    }
}