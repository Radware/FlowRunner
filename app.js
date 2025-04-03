// app.js
// Main application logic for the standalone API Flowmap Maker

import {
    flowModelToJson,
    jsonToFlowModel,
    validateFlow,
    createTemplateFlow,
    createNewStep,
    findStepById,
    cloneStep,
    escapeHTML,
    findDefinedVariables
} from './flowCore.js';

import { FlowBuilderComponent } from './flowBuilderComponent.js';
import { showStepTypeDialog, getStepTypeIcon } from './flowStepComponents.js';
import { FlowRunner } from './flowRunner.js'; // Import the new FlowRunner
import { FlowVisualizer } from './flowVisualizer.js'; // Import the new FlowVisualizer

// --- Constants ---
const API_BASE_PATH = '/api'; // TODO: Make this configurable if needed
const DEFAULT_REQUEST_DELAY = 500;

// --- Application State ---
let appState = {
    flows: [],
    currentFlowId: null,
    currentFlowModel: null,
    selectedStepId: null,
    isDirty: false,
    isLoading: false,
    runner: null, // Instance of FlowRunner
    executionResults: [], // Separate from runner internal state for UI rendering
    currentView: 'list-editor', // 'list-editor' or 'node-graph'
    builderComponent: null,
    visualizerComponent: null, // Instance of FlowVisualizer
    isInfoOverlayOpen: false,
    isVariablesPanelVisible: false,
    stepEditorIsDirty: false, // Specific flag for editor changes
};

// --- DOM Element References ---
let domRefs = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Initializing API Flowmap Maker (Enhanced)...");
    initializeDOMReferences();
    initializeEventListeners();
    initializeRunner();
    initializeVisualizer(); // Initialize visualizer instance
    loadFlowList();
    updateRunnerUI();
    updateViewToggle(); // Set initial view state
});

function initializeDOMReferences() {
    domRefs = {
        // Sidebar
        sidebar: document.getElementById('sidebar'),
        addFlowBtn: document.getElementById('add-flow-btn'),
        flowList: document.getElementById('flow-list'),

        // Workspace
        workspace: document.getElementById('workspace'),
        workspaceTitle: document.getElementById('workspace-title'),
        workspaceContent: document.getElementById('workspace-content'),
        workspacePlaceholder: document.getElementById('workspace-placeholder'),
        toggleViewBtn: document.getElementById('toggle-view-btn'), // View toggle button

        // Views within Workspace Content
        flowBuilderMount: document.getElementById('flow-builder-mount'), // List/Editor view container
        flowVisualizerMount: document.getElementById('flow-visualizer-mount'), // Node-Graph view container

        // Controls within Header
        toggleInfoBtn: document.getElementById('toggle-info-btn'),
        toggleVariablesBtn: document.getElementById('toggle-variables-btn'),

        // Panels relative to Workspace
        variablesPanel: document.getElementById('variables-panel'),
        variablesContainer: document.getElementById('variables-container'),
        infoOverlay: document.querySelector('[data-ref="infoOverlay"]'), // Specific selector used by builder

        // Messages
        builderMessages: document.getElementById('builder-messages'),

        // Runner Panel
        runnerPanel: document.getElementById('runner-panel'),
        runFlowBtn: document.getElementById('run-flow-btn'),
        stepFlowBtn: document.getElementById('step-flow-btn'),
        stepIntoFlowBtn: document.getElementById('step-into-flow-btn'), // Step Into button
        stopFlowBtn: document.getElementById('stop-flow-btn'),
        clearResultsBtn: document.getElementById('clear-results-btn'),
        requestDelayInput: document.getElementById('request-delay'),
        runnerResultsList: document.getElementById('runner-results'),
        runnerResultsContainer: document.querySelector('.runner-results-container'), // Container for messages

        // Dialogs & Overlays
        stepTypeDialog: document.getElementById('step-type-dialog'),
        varDropdown: document.getElementById('var-dropdown'),
        globalLoadingOverlay: document.getElementById('global-loading-overlay'),
    };
}

function initializeEventListeners() {
    // Sidebar
    domRefs.addFlowBtn.addEventListener('click', handleCreateNewFlow);
    domRefs.flowList.addEventListener('click', handleFlowListActions);

    // Workspace Header Controls
    domRefs.toggleViewBtn.addEventListener('click', handleToggleView);
    domRefs.toggleInfoBtn.addEventListener('click', handleToggleInfoOverlay);
    domRefs.toggleVariablesBtn.addEventListener('click', handleToggleVariablesPanel);

    // Runner
    domRefs.runFlowBtn.addEventListener('click', handleRunFlow);
    domRefs.stepFlowBtn.addEventListener('click', handleStepFlow);
    // domRefs.stepIntoFlowBtn.addEventListener('click', handleStepIntoFlow); // TODO: Implement Step Into handler
    domRefs.stopFlowBtn.addEventListener('click', handleStopFlow);
    domRefs.clearResultsBtn.addEventListener('click', handleClearResults);
    domRefs.requestDelayInput.addEventListener('change', handleDelayChange);

    // Global
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Initialize listeners for dynamic elements (dialogs, dropdowns)
    initializeStepTypeDialogListeners();
    initializeVarDropdownListeners();
    initializeVariableInsertionListener(); // Single listener for all insert buttons
}

function initializeRunner() {
    // Create the FlowRunner instance, passing callbacks to update the UI
    appState.runner = new FlowRunner({
        delay: getRequestDelay(),
        onStepStart: handleRunnerStepStart,
        onStepComplete: handleRunnerStepComplete,
        onFlowComplete: handleRunnerFlowComplete,
        onFlowStopped: handleRunnerFlowStopped,
        onMessage: (message, type) => showMessage(message, type, domRefs.runnerResultsList), // Show runner messages in its panel
        onError: handleRunnerError,
        onContextUpdate: handleRunnerContextUpdate,
        // Pass core evaluation/substitution functions needed by runner
        substituteVariablesFn: substituteVariablesInStep, // From this file (app.js)
        evaluateConditionFn: evaluateCondition, // From this file (app.js)
    });
    handleClearResults(); // Initialize runner state and UI
}

function initializeVisualizer() {
    // Create the FlowVisualizer instance
    appState.visualizerComponent = new FlowVisualizer(
        domRefs.flowVisualizerMount,
        {
            onNodeSelect: handleBuilderStepSelect, // Reuse step selection logic
            onNodeMove: handleVisualizerNodeMove, // Handle drag/drop from visualizer
            onAddStep: (parentId, branch, position) => { // Callback for add button on node
                showAppStepTypeDialog(type => {
                    if (type) {
                        const newStep = createNewStep(type);
                        const action = {
                            type: 'add',
                            step: newStep,
                            parentId: parentId,
                            branch: branch,
                            // Position hint if needed (e.g., from which port '+' was clicked)
                            // position: position
                        };
                        // If adding at top level (parentId is null)
                        if (!parentId) {
                            appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];
                            appState.currentFlowModel.steps.push(newStep);
                            appState.selectedStepId = newStep.id;
                            setDirty(true);
                            renderCurrentFlow(); // Re-render list/visualizer
                        } else {
                            // Delegate to existing add logic
                           handleBuilderStepUpdate(action);
                        }
                    }
                });
            }
        }
    );
}


// --- Loading and State Management ---

function setLoading(isLoading, scope = 'global') {
    appState.isLoading = isLoading;
    if (scope === 'global' && domRefs.globalLoadingOverlay) {
        domRefs.globalLoadingOverlay.style.display = isLoading ? 'flex' : 'none';
    }
    domRefs.addFlowBtn.disabled = isLoading;
    // Runner buttons disabled based on runner state, but also if globally loading
    updateRunnerUI(); // Reflects both global loading and runner state
}

function setDirty(isDirty) {
    // Considers both overall flow changes and uncommitted editor changes
    const needsSave = isDirty || appState.stepEditorIsDirty;
    if (appState.isDirty !== needsSave) {
        appState.isDirty = needsSave;
        updateWorkspaceTitle(); // Update title with asterisk if needed
    }
    // Save button enabling handled internally by FlowBuilderComponent/Editor
}

function handleBeforeUnload(event) {
    // Check both flags
    if (appState.isDirty || appState.stepEditorIsDirty) {
        event.preventDefault(); // Standard requirement
        event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'; // For older browsers
        return 'You have unsaved changes. Are you sure you want to leave?'; // For modern browsers
    }
}

function updateWorkspaceTitle() {
     if (appState.currentFlowModel) {
         const baseName = appState.currentFlowModel.name || 'Untitled Flow';
         const needsSave = appState.isDirty || appState.stepEditorIsDirty;
         domRefs.workspaceTitle.textContent = `${baseName}${needsSave ? ' *' : ''}`;
     } else {
         domRefs.workspaceTitle.textContent = 'Select or Create a Flow';
     }
}

function showMessage(message, type = 'info', container = domRefs.builderMessages, title = null) {
    if (!container) return;
    const MAX_MESSAGES = 3;
    // Auto-clear oldest message if limit reached
    while (container.children.length >= MAX_MESSAGES && container.lastChild) {
        container.removeChild(container.lastChild);
    }
    const messageEl = document.createElement('div');
    messageEl.className = `flow-message ${type}`;
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    const icon = `<div class="message-icon">${icons[type] || icons.info}</div>`;
    messageEl.innerHTML = `
        ${icon}
        <div class="message-body">
            <div class="message-header">
                ${title ? `<strong>${escapeHTML(title)}</strong>` : ''}
                <button class="btn-close-message" title="Dismiss message">✕</button>
            </div>
            <div class="message-content">${escapeHTML(message)}</div>
        </div>
    `;
    const btn = messageEl.querySelector('.btn-close-message');
    let timeoutId = null;
    const dismiss = () => {
        clearTimeout(timeoutId);
        if (!messageEl?.parentNode) return; // Check if already removed
        messageEl.style.opacity = '0';
        messageEl.style.transition = 'opacity 0.3s ease';
        setTimeout(() => messageEl?.remove(), 300);
    };
    btn.addEventListener('click', dismiss);
    // Adjusted timeouts
    const timeout = type === 'error' ? 10000 : (type === 'success' ? 4000 : 5000);
    timeoutId = setTimeout(dismiss, timeout);
    container.prepend(messageEl); // Add new messages to the top
}

function clearMessages(container = domRefs.builderMessages) {
    if (container) container.innerHTML = '';
}

// --- Sidebar Logic ---

async function loadFlowList() {
    domRefs.flowList.innerHTML = '<li class="loading-flows">Loading flows...</li>';
    try {
        const response = await fetch(`${API_BASE_PATH}/flows`);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        const flows = await response.json();
        appState.flows = flows || [];
        renderFlowList();
    } catch (error) {
        console.error('Error loading flow list:', error);
        domRefs.flowList.innerHTML = `<li class="error">Error loading flows: ${escapeHTML(error.message)}</li>`;
    }
}

function renderFlowList() {
    domRefs.flowList.innerHTML = '';
    if (appState.flows.length === 0) {
        domRefs.flowList.innerHTML = '<li class="no-flows">No flows defined yet.</li>';
        return;
    }
    appState.flows.forEach(flow => {
        const li = document.createElement('li');
        li.className = 'flow-list-item';
        li.dataset.flowId = flow.id;
        if (flow.id === appState.currentFlowId) {
            li.classList.add('selected');
        }
        li.innerHTML = `
            <span class="flow-item-name">${escapeHTML(flow.name || `Flow ${flow.id}`)}</span>
            <div class="flow-item-actions">
                <button class="btn-edit" data-action="edit" title="Edit Flow">Edit</button>
                <button class="btn-clone" data-action="clone" title="Clone Flow">Clone</button>
                <button class="btn-delete" data-action="delete" title="Delete Flow">Delete</button>
            </div>
        `;
        domRefs.flowList.appendChild(li);
    });
}

function handleFlowListActions(event) {
    const targetButton = event.target.closest('button[data-action]');
    const targetListItem = event.target.closest('.flow-list-item');

    if (targetButton) {
        event.stopPropagation(); // Prevent list item click if button clicked
        const action = targetButton.dataset.action;
        const flowId = targetButton.closest('.flow-list-item')?.dataset.flowId;
        if (!flowId) return;

        switch (action) {
            case 'edit':
                handleSelectFlow(flowId);
                break;
            case 'clone':
                handleCloneFlow(flowId);
                break;
            case 'delete':
                handleDeleteFlow(flowId);
                break;
        }
    } else if (targetListItem) {
        const flowId = targetListItem.dataset.flowId;
        handleSelectFlow(flowId);
    }
}

function confirmDiscardChanges(actionAfterConfirm) {
    if (appState.isDirty || appState.stepEditorIsDirty) {
        if (!confirm("You have unsaved changes. Discard them and continue?")) {
            return false; // User canceled
        }
    }
    // Clear dirty states before proceeding
    appState.isDirty = false;
    appState.stepEditorIsDirty = false;
    // Reset editor dirty state via callback if possible (assume editor resets itself on load)
    if (appState.builderComponent && typeof appState.builderComponent.resetDirtyState === 'function') {
       // builderComponent.resetDirtyState(); // Hypothetical method
    }
    // Proceed with the action
    actionAfterConfirm();
    return true;
}

function handleSelectFlow(flowId) {
    if (appState.isLoading || appState.currentFlowId === flowId) return;

    confirmDiscardChanges(() => {
        appState.currentFlowId = flowId;
        appState.selectedStepId = null; // Reset step selection
        loadAndRenderFlow(flowId);
        renderFlowList(); // Update selection highlight
    });
}

function handleCreateNewFlow() {
    if (appState.isLoading) return;

    confirmDiscardChanges(() => {
        appState.currentFlowId = null;
        appState.selectedStepId = null;
        appState.currentFlowModel = createTemplateFlow();
        appState.isDirty = true; // New flow is dirty until saved
        appState.stepEditorIsDirty = false;
        renderCurrentFlow();
        renderFlowList();
        updateWorkspaceTitle();
        showMessage("New flow created. Edit and save.", "info");
        // Ensure controls are visible for new flow
        domRefs.toggleInfoBtn.style.display = '';
        domRefs.toggleVariablesBtn.style.display = '';
        domRefs.toggleViewBtn.style.display = ''; // Show view toggle
        // Reset runner
        handleClearResults();
    });
}

async function handleCloneFlow(flowId) {
    if (appState.isLoading) return;

    const flowToClone = appState.flows.find(f => f.id === flowId);
    if (!flowToClone) return;

    confirmDiscardChanges(async () => {
        setLoading(true, 'global');
        clearMessages();
        try {
            const response = await fetch(`${API_BASE_PATH}/flows/${flowId}`);
            if (!response.ok) throw new Error(`Failed to fetch flow data for cloning (Status: ${response.status})`);
            const flowData = await response.json();

            appState.currentFlowModel = jsonToFlowModel(flowData);
            // Ensure unique IDs in the cloned model!
            appState.currentFlowModel.steps = assignNewIdsRecursive(appState.currentFlowModel.steps);
            appState.currentFlowModel.name = `Copy of ${appState.currentFlowModel.name || 'Flow'}`;
            appState.currentFlowId = null; // New flow until saved
            appState.selectedStepId = null;
            appState.isDirty = true;
            appState.stepEditorIsDirty = false;
            renderCurrentFlow();
            renderFlowList();
            updateWorkspaceTitle();
            showMessage(`Cloned '${flowToClone.name}'. Review and save.`, "info");
            domRefs.toggleInfoBtn.style.display = '';
            domRefs.toggleVariablesBtn.style.display = '';
            domRefs.toggleViewBtn.style.display = '';
            handleClearResults(); // Reset runner for clone
        } catch (error) {
            console.error('Error cloning flow:', error);
            showMessage(`Error preparing clone: ${error.message}`, 'error');
        } finally {
            setLoading(false, 'global');
        }
    });
}

// Helper to recursively assign new IDs (useful for cloning)
function assignNewIdsRecursive(steps) {
    if (!steps || !Array.isArray(steps)) return [];
    return steps.map(step => {
        const newStep = { ...step, id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}` };
        if (newStep.type === 'condition') {
            newStep.thenSteps = assignNewIdsRecursive(newStep.thenSteps);
            newStep.elseSteps = assignNewIdsRecursive(newStep.elseSteps);
        } else if (newStep.type === 'loop') {
            newStep.loopSteps = assignNewIdsRecursive(newStep.loopSteps);
        }
        return newStep;
    });
}

async function handleDeleteFlow(flowId) {
    if (appState.isLoading) return;

    const flowToDelete = appState.flows.find(f => f.id === flowId);
    if (!flowToDelete) return;

    if (confirm(`Are you sure you want to delete "${escapeHTML(flowToDelete.name)}"? This cannot be undone.`)) {
        setLoading(true, 'global');
        clearMessages();
        try {
            const response = await fetch(`${API_BASE_PATH}/flows/${flowId}`, { method: 'DELETE' });
            if (!response.ok && response.status !== 204) {
                let errorMsg = `HTTP error ${response.status}`;
                 try { const errData = await response.json(); errorMsg = errData.message || errorMsg; } catch(e){}
                throw new Error(errorMsg);
            }

            showMessage(`Flow "${flowToDelete.name}" deleted successfully.`, 'success');
            if (appState.currentFlowId === flowId) {
                clearWorkspace(); // Clear workspace if current flow deleted
            }
            await loadFlowList(); // Reload list

        } catch (error) {
            console.error(`Error deleting flow ${flowId}:`, error);
            showMessage(`Error deleting flow: ${error.message}`, 'error');
        } finally {
            setLoading(false, 'global');
        }
    }
}


// --- Workspace Logic ---

async function loadAndRenderFlow(flowId) {
    setLoading(true, 'global');
    clearWorkspace(false); // Clear views but keep titles etc.
    clearMessages();
    try {
        const response = await fetch(`${API_BASE_PATH}/flows/${flowId}`);
        if (!response.ok) {
            throw new Error(`Failed to load flow (Status: ${response.status})`);
        }
        const flowData = await response.json();
        appState.currentFlowModel = jsonToFlowModel(flowData);
        appState.isDirty = false;
        appState.stepEditorIsDirty = false;
        renderCurrentFlow(); // Render the currently active view
        updateWorkspaceTitle();
        // Show controls now that flow is loaded
        domRefs.toggleInfoBtn.style.display = '';
        domRefs.toggleVariablesBtn.style.display = '';
        domRefs.toggleViewBtn.style.display = '';
    } catch (error) {
        console.error(`Error loading flow ${flowId}:`, error);
        showMessage(`Error loading flow: ${error.message}`, 'error');
        clearWorkspace(true); // Clear fully on error
    } finally {
        setLoading(false, 'global');
        updateRunnerUI(); // Update runner buttons based on loaded flow
        handleClearResults(); // Clear results when loading new flow
    }
}

/** Renders the currentFlowModel using the active view (List/Editor or Node-Graph) */
function renderCurrentFlow() {
    if (!appState.currentFlowModel) {
        clearWorkspace();
        return;
    }

    // Update defined variables (needed by both views/editors)
    updateDefinedVariables();

    // Hide placeholder, ensure mount points are visible/hidden correctly
    domRefs.workspacePlaceholder.style.display = 'none';
    domRefs.flowBuilderMount.classList.toggle('active', appState.currentView === 'list-editor');
    domRefs.flowVisualizerMount.classList.toggle('active', appState.currentView === 'node-graph');
    domRefs.toggleInfoBtn.style.display = ''; // Ensure controls are visible
    domRefs.toggleVariablesBtn.style.display = '';
    domRefs.toggleViewBtn.style.display = ''; // Ensure view toggle is visible

    // Render the List/Editor View (FlowBuilderComponent)
    if (appState.currentView === 'list-editor') {
        if (!appState.builderComponent) {
            appState.builderComponent = new FlowBuilderComponent(
                domRefs.flowBuilderMount,
                // Pass the element where the builder should render its variable toggle button
                domRefs.toggleVariablesBtn.parentNode, // Assuming it's in workspace-controls
                {
                    onFlowUpdate: handleBuilderFlowUpdate,
                    onHeadersUpdate: handleBuilderHeadersUpdate,
                    onFlowVarsUpdate: handleBuilderFlowVarsUpdate,
                    onStepSelect: handleBuilderStepSelect,
                    onStepUpdate: handleBuilderStepUpdate,
                    onStepEdit: handleBuilderStepEdit,
                    onRequestAddStep: handleBuilderRequestAddStep,
                    onEditorDirtyChange: handleBuilderEditorDirtyChange,
                }
            );
        }
        // Pass panel elements for builder to manage content visibility
        appState.builderComponent.render(
            appState.currentFlowModel,
            appState.selectedStepId,
            domRefs.variablesPanel,
            domRefs.variablesContainer
        );
        // Sync builder's internal state (like panel visibility) back to app state/buttons if necessary
        // syncBuilderState(); // Helper function if needed
    } else if (appState.currentView === 'node-graph') {
        // Render the Node-Graph View (FlowVisualizer)
        if (appState.visualizerComponent) {
            appState.visualizerComponent.render(appState.currentFlowModel, appState.selectedStepId);
        } else {
            console.error("Visualizer component not initialized!");
        }
        // Update variables panel content (visualizer doesn't manage it directly)
        _updateVariablesPanelUI();
    }

    // Sync overlay/panel visibility state that's managed by app.js or builder
    syncPanelVisibility();
}

function clearWorkspace(fullClear = true) {
    // Clear both view containers
    if (appState.builderComponent) {
        appState.builderComponent.destroy(); // Add destroy method if needed
        appState.builderComponent = null;
    }
    if (appState.visualizerComponent) {
        appState.visualizerComponent.clear();
    }
    domRefs.flowBuilderMount.innerHTML = '';
    domRefs.flowVisualizerMount.innerHTML = '';
    domRefs.flowBuilderMount.classList.remove('active');
    domRefs.flowVisualizerMount.classList.remove('active');

    domRefs.workspacePlaceholder.style.display = 'flex';
    domRefs.toggleInfoBtn.style.display = 'none';
    domRefs.toggleVariablesBtn.style.display = 'none';
    domRefs.toggleViewBtn.style.display = 'none'; // Hide view toggle

    // Close panels managed by app.js/builder
    domRefs.variablesPanel.classList.remove('visible');
    domRefs.infoOverlay.classList.remove('open');
    appState.isInfoOverlayOpen = false;
    appState.isVariablesPanelVisible = false;
    syncPanelVisibility(); // Update buttons

    if (fullClear) {
        appState.currentFlowId = null;
        appState.currentFlowModel = null;
        appState.selectedStepId = null;
        appState.isDirty = false;
        appState.stepEditorIsDirty = false;
        updateWorkspaceTitle();
        clearMessages();
        handleClearResults(); // Clear runner
        updateRunnerUI();
        appState.currentView = 'list-editor'; // Reset to default view
        updateViewToggle();
    }
}

function updateDefinedVariables() {
     if (appState.currentFlowModel) {
         appState.definedVariables = findDefinedVariables(appState.currentFlowModel);
     } else {
         appState.definedVariables = {};
     }
     // Update variable panel UI regardless of which view is active
     _updateVariablesPanelUI();
}

function _updateVariablesPanelUI() {
    // Renders the variables table into the panel's container
    const container = domRefs.variablesContainer;
    if (!container) return;
    container.innerHTML = '';

    const variables = appState.definedVariables || {};

    if (Object.keys(variables).length === 0) {
        container.innerHTML = `
            <div class="no-variables-message">
                <p>No variables defined or extracted yet.</p>
            </div>
        `;
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
    const sortedVarNames = Object.keys(variables).sort();
    sortedVarNames.forEach(name => {
        const info = variables[name];
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="var-name">${escapeHTML(name)}</td>
            <td class="var-origin">${escapeHTML(info.origin || 'N/A')}</td>
            <td class="var-path">
                ${escapeHTML(
                    info.type === 'static' ? 'Static Value' :
                    info.type === 'loop' ? `Loop Item (from ${info.origin})` :
                    info.type === 'extraction' ? (info.path || 'N/A') :
                    'Unknown'
                )}
            </td>
        `;
        tbody.appendChild(row);
    });
    container.appendChild(table);
}


// --- Workspace View Toggling ---

function handleToggleView() {
    if (appState.currentView === 'list-editor') {
        appState.currentView = 'node-graph';
    } else {
        appState.currentView = 'list-editor';
    }
    updateViewToggle();
    renderCurrentFlow(); // Re-render the workspace with the new view
}

function updateViewToggle() {
    if (!appState.currentFlowModel) {
        domRefs.toggleViewBtn.style.display = 'none';
        return;
    }
    domRefs.toggleViewBtn.style.display = ''; // Ensure visible if flow loaded
    if (appState.currentView === 'list-editor') {
        domRefs.toggleViewBtn.textContent = 'Visual View';
        domRefs.toggleViewBtn.title = 'Switch to Node-Graph View';
        // Ensure builder controls are visible if needed
        domRefs.toggleInfoBtn.style.display = '';
        domRefs.toggleVariablesBtn.style.display = '';
    } else {
        domRefs.toggleViewBtn.textContent = 'Editor View';
        domRefs.toggleViewBtn.title = 'Switch to List/Editor View';
        // Hide builder-specific controls in visual view? Maybe not necessary.
         // domRefs.toggleInfoBtn.style.display = 'none';
         // domRefs.toggleVariablesBtn.style.display = 'none';
    }
}


// --- Saving Flow ---

async function saveCurrentFlow() {
    if (!appState.currentFlowModel || appState.isLoading) return false;

    // Commit step editor changes if dirty
     if (appState.stepEditorIsDirty && appState.builderComponent) {
         // Find the active save button within the builder's editor panel
         const saveBtn = domRefs.flowBuilderMount.querySelector('.step-editor-actions .btn-save-step');
         if (saveBtn && !saveBtn.disabled) {
             console.log("Attempting programmatic save of step editor...");
             saveBtn.click(); // Trigger the editor's save action
             // Note: This relies on the click handler completing synchronously
             // or the onStepEdit callback updating the model before validation.
             // A small delay might be needed in complex cases, but avoid if possible.
              // await sleep(50); // Use cautiously, indicates potential race condition
         } else {
             console.warn("Step editor is dirty, but save button not found or disabled.");
              // Optionally prevent saving the flow if editor changes can't be committed
              // showMessage("Cannot save flow: Unsaved changes in the step editor could not be committed.", "error");
              // return false;
         }
         // Assume the click/callback resets this flag
         appState.stepEditorIsDirty = false;
     }

    clearMessages();
    const validation = validateFlow(appState.currentFlowModel);
    if (!validation.valid) {
        showValidationErrors(validation.errors);
        return false;
    }

    setLoading(true, 'global');
    let savedSuccessfully = false;
    try {
        const flowJson = flowModelToJson(appState.currentFlowModel);
        const isCreating = !appState.currentFlowId;
        const url = isCreating
            ? `${API_BASE_PATH}/flows`
            : `${API_BASE_PATH}/flows/${appState.currentFlowId}`;
        const method = isCreating ? 'POST' : 'PUT';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(flowJson)
        });

        if (!response.ok) {
             let errorMsg = `HTTP error ${response.status}`;
             try { const errData = await response.json(); errorMsg = errData.message || errorMsg; } catch(e){}
            throw new Error(errorMsg);
        }

        const savedFlowData = await response.json();
        savedSuccessfully = true;
        showMessage('Flow saved successfully!', 'success');

        const wasCreating = isCreating;

        // Update state with saved data
        appState.currentFlowId = savedFlowData.id;
        appState.currentFlowModel.id = savedFlowData.id; // Update model ID
        appState.isDirty = false;
        appState.stepEditorIsDirty = false; // Reset editor dirty state

        updateWorkspaceTitle(); // Remove asterisk
        await loadFlowList(); // Refresh sidebar list

        if (wasCreating) {
            renderFlowList(); // Re-render to apply selection class immediately
        }

    } catch (error) {
        console.error('Save error:', error);
        showMessage(`Save Failed: ${error.message}`, 'error');
    } finally {
        setLoading(false, 'global');
    }
    return savedSuccessfully;
}

function showValidationErrors(errors) {
     if (!errors || !errors.length) return;
     // Show in the builder message area
     const container = domRefs.builderMessages;
     if (!container) return;

     // Clear previous validation errors first
     container.querySelectorAll('.validation-errors-message').forEach(el => el.remove());

     const messageEl = document.createElement('div');
     messageEl.className = 'flow-message error validation-errors-message'; // Add specific class
     const errorListHtml = errors.map(error => `<li>${escapeHTML(error)}</li>`).join('');
     const icon = '<div class="message-icon">❌</div>';
     messageEl.innerHTML = `
          ${icon}
          <div class="message-body">
             <div class="message-header">
                 <strong>Validation Failed</strong>
                 <button class="btn-close-message" title="Dismiss message">✕</button>
             </div>
             <ul class="validation-errors">${errorListHtml}</ul>
         </div>
     `;
     const btn = messageEl.querySelector('.btn-close-message');
     let timeoutId = null;
     const dismiss = () => {
         clearTimeout(timeoutId);
         if (!messageEl?.parentNode) return;
         messageEl.style.opacity = '0';
         messageEl.style.transition = 'opacity 0.3s ease';
         setTimeout(() => messageEl?.remove(), 300);
     };
     btn.addEventListener('click', dismiss);
     timeoutId = setTimeout(dismiss, 15000);
     container.prepend(messageEl);
 }

// --- FlowBuilderComponent & Visualizer Callback Handlers ---

function handleBuilderFlowUpdate({ name, description }) {
    if (appState.currentFlowModel) {
        const changed = appState.currentFlowModel.name !== name || appState.currentFlowModel.description !== description;
        appState.currentFlowModel.name = name;
        appState.currentFlowModel.description = description;
        if (changed) setDirty(true);
        updateWorkspaceTitle(); // Update title immediately
    }
}

function handleBuilderHeadersUpdate(headers) {
    if (appState.currentFlowModel) {
        if (JSON.stringify(appState.currentFlowModel.headers || {}) !== JSON.stringify(headers || {})) {
            appState.currentFlowModel.headers = headers;
            setDirty(true);
        }
    }
}

function handleBuilderFlowVarsUpdate(staticVars) {
     if (appState.currentFlowModel) {
        if (JSON.stringify(appState.currentFlowModel.staticVars || {}) !== JSON.stringify(staticVars || {})) {
            appState.currentFlowModel.staticVars = staticVars;
            setDirty(true);
            updateDefinedVariables(); // Update variables cache and panel UI
            // Re-render only if needed (e.g., visualizer depends on vars display?) - currently no need.
            // renderCurrentFlow();
        }
    }
}

function handleBuilderStepSelect(stepId) {
    if (appState.selectedStepId === stepId) return; // Ignore clicks on already selected step

    // Check for unsaved changes in the *current* editor before switching
     if (appState.stepEditorIsDirty) {
         if (!confirm("You have unsaved changes in the current step editor. Discard changes and switch step?")) {
             // User canceled, prevent the state change
             return;
         }
         appState.stepEditorIsDirty = false; // Changes discarded
     }

    appState.selectedStepId = stepId;
    // Re-render the current view to reflect selection
    // Builder handles showing editor, Visualizer handles highlighting node
    renderCurrentFlow();
}

function handleBuilderStepEdit(updatedStepData) {
    // Called when the *step editor* is saved (via its internal Save button)
    if (!appState.currentFlowModel || !updatedStepData || !updatedStepData.id) return;

    let foundAndUpdated = false;
    const updateRecursively = (steps) => {
        if (!steps || !Array.isArray(steps)) return steps;
        return steps.map(step => {
            if (step.id === updatedStepData.id) {
                foundAndUpdated = true;
                // Return a *new* object to ensure change detection
                return { ...updatedStepData };
            }
            // Recursively update nested steps
            if (step.type === 'condition') {
                 const newThen = updateRecursively(step.thenSteps);
                 const newElse = updateRecursively(step.elseSteps);
                 if (newThen !== step.thenSteps || newElse !== step.elseSteps) {
                     return { ...step, thenSteps: newThen, elseSteps: newElse };
                 }
            } else if (step.type === 'loop') {
                 const newLoop = updateRecursively(step.loopSteps);
                 if (newLoop !== step.loopSteps) {
                     return { ...step, loopSteps: newLoop };
                 }
            }
            return step;
        });
    };

    const originalStepsJson = JSON.stringify(appState.currentFlowModel.steps);
    const newSteps = updateRecursively(appState.currentFlowModel.steps);

    if (foundAndUpdated) {
        if (JSON.stringify(newSteps) !== originalStepsJson) {
             appState.currentFlowModel.steps = newSteps;
             setDirty(true); // Mark overall flow as dirty
             // Re-render the current view to reflect changes in list/visualizer
             renderCurrentFlow();
        }
        // Editor is no longer dirty after its save action
        appState.stepEditorIsDirty = false;
        setDirty(appState.isDirty); // Recalculate overall dirty state
    } else {
        console.warn(`Could not find step with ID ${updatedStepData.id} to apply edits.`);
        // Keep editor dirty? Or assume save failed and reset? For safety, keep it dirty.
        appState.stepEditorIsDirty = true;
        setDirty(true);
    }
}

// Handles structural changes: add, move, delete, clone from builder OR visualizer
function handleBuilderStepUpdate(action) {
     if (!appState.currentFlowModel) return;

     let modelChanged = false;
     let newSelectedStepId = appState.selectedStepId;

     appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];

     switch (action.type) {
         case 'add': // Add step within condition/loop or visually
             modelChanged = addNestedStepToModel(action.step, action.parentId, action.branch);
             if (modelChanged) {
                 newSelectedStepId = action.step.id; // Select the newly added step
                 showMessage(`Step "${action.step.name}" added.`, 'success');
             }
             break;
         case 'move': // Move step in list or visualizer
             // Confirmation/validation should happen within moveStepInModel if needed
             modelChanged = moveStepInModel(action.sourceStepId, action.targetStepId, action.position);
             if (modelChanged) {
                 newSelectedStepId = action.sourceStepId; // Keep selection on the moved step
                 // Don't show message for every drag, can be noisy
             }
             break;
         case 'delete':
             const stepToDelete = findStepById(appState.currentFlowModel.steps, action.stepId);
             const stepName = stepToDelete ? stepToDelete.name : `step ${action.stepId}`;
             // Add confirmation here for safety, regardless of source
             if (confirm(`Are you sure you want to delete step "${escapeHTML(stepName)}"? This includes any nested steps.`)) {
                 modelChanged = deleteStepFromModel(action.stepId);
                 if (modelChanged) {
                     if (appState.selectedStepId === action.stepId) {
                         newSelectedStepId = null; // Deselect if deleted step was selected
                     }
                     showMessage(`Step "${stepName}" deleted.`, 'success');
                 }
             }
             break;
         case 'clone': // Clone step from list/visualizer
              // Confirmation before cloning? Maybe not needed.
              modelChanged = cloneStepInModel(action.originalStep, action.newStep);
              if (modelChanged) {
                  newSelectedStepId = action.newStep.id; // Select the clone
                  showMessage(`Step "${action.originalStep.name}" cloned.`, 'success');
              }
             break;
         default:
             console.warn("Unknown step update action received:", action.type);
     }

     if (modelChanged) {
         setDirty(true);
         appState.selectedStepId = newSelectedStepId;
         updateDefinedVariables(); // Recalculate variables after structural change
         renderCurrentFlow(); // Re-render the current view
     }
}

// Handles drag/drop move specifically from the visualizer
function handleVisualizerNodeMove(sourceStepId, targetStepId, position) {
    if (!appState.currentFlowModel || !sourceStepId || !targetStepId) return;
    console.log(`Visualizer move requested: ${sourceStepId} ${position} ${targetStepId}`);

    // Translate visual position ('before'/'after' relative to target node)
    // into the model update action.
    // This reuses the logic already used by the list view's drag-and-drop.
    handleBuilderStepUpdate({
        type: 'move',
        sourceStepId: sourceStepId,
        targetStepId: targetStepId,
        position: position, // 'before' or 'after'
    });
}


function handleBuilderRequestAddStep() {
    // Called when the top-level "+ Add Step" button in the builder list view is clicked
    showAppStepTypeDialog(type => {
        if (type) {
            const newStep = createNewStep(type);
            appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];
            appState.currentFlowModel.steps.push(newStep);
            appState.selectedStepId = newStep.id; // Select the new step
            setDirty(true);
            renderCurrentFlow(); // Re-render to show the new step
        }
    });
}

function handleBuilderEditorDirtyChange(isEditorDirty) {
    // Called by builder when the step editor's dirty state changes
    if (appState.stepEditorIsDirty !== isEditorDirty) {
         appState.stepEditorIsDirty = isEditorDirty;
         setDirty(appState.isDirty || isEditorDirty); // Update overall dirty state potentially
    }
}


// --- Model Manipulation Helpers ---

function addNestedStepToModel(stepData, parentId, branch) {
    if (!parentId || !stepData) return false;
    const parentStep = findStepById(appState.currentFlowModel.steps, parentId);
    if (!parentStep) return false;

    let added = false;
    if (parentStep.type === 'condition') {
        if (branch === 'then') {
            parentStep.thenSteps = parentStep.thenSteps || [];
            parentStep.thenSteps.push(stepData);
            added = true;
        } else if (branch === 'else') {
            parentStep.elseSteps = parentStep.elseSteps || [];
            parentStep.elseSteps.push(stepData);
            added = true;
        }
    } else if (parentStep.type === 'loop') {
        parentStep.loopSteps = parentStep.loopSteps || [];
        parentStep.loopSteps.push(stepData);
        added = true;
    } else {
        console.warn(`Cannot add nested step to parent of type ${parentStep.type}`);
        return false;
    }
    return added;
}

// Finds step info including the parent array and index (crucial for modification)
function findStepInfoRecursive(steps, idToFind, currentParentSteps = null, path = []) {
    if (!steps) return null;
    const parentArray = currentParentSteps || appState.currentFlowModel.steps; // Default to top-level

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const currentPath = [...path, { steps: parentArray, index: i, stepId: step.id }]; // Store path info

        if (step.id === idToFind) {
            return { step: step, parentSteps: parentArray, index: i, path: currentPath };
        }

        let found = null;
        if (step.type === 'condition') {
            found = findStepInfoRecursive(step.thenSteps, idToFind, step.thenSteps, [...currentPath, { stepId: step.id, branch: 'then' }]);
            if (found) return found;
            found = findStepInfoRecursive(step.elseSteps, idToFind, step.elseSteps, [...currentPath, { stepId: step.id, branch: 'else' }]);
            if (found) return found;
        } else if (step.type === 'loop') {
            found = findStepInfoRecursive(step.loopSteps, idToFind, step.loopSteps, [...currentPath, { stepId: step.id, branch: 'loop' }]);
            if (found) return found;
        }
    }
    return null;
}

function moveStepInModel(sourceId, targetId, position) {
    const sourceInfo = findStepInfoRecursive(appState.currentFlowModel.steps, sourceId);
    let targetInfo = findStepInfoRecursive(appState.currentFlowModel.steps, targetId);

    if (!sourceInfo || !targetInfo) {
        console.error("Move failed: Could not find source or target step info.");
        return false;
    }

    // Prevent dropping a parent into its own child branch/loop (complex check)
    let tempTarget = targetInfo.step;
    while (tempTarget) {
         const targetParentInfo = findStepInfoRecursive(appState.currentFlowModel.steps, tempTarget.id);
         if (!targetParentInfo || targetParentInfo.path.length === 0) break; // Reached top or error
         const parentStepId = targetParentInfo.path[targetParentInfo.path.length - 2]?.stepId; // ID of the step containing the target
         if (parentStepId === sourceId) {
             showMessage("Cannot move a step into itself or its children.", "warning");
             return false;
         }
         // Move up the hierarchy
         if (parentStepId) {
             tempTarget = findStepById(appState.currentFlowModel.steps, parentStepId);
         } else {
             break; // Reached top level
         }
    }

    // --- Perform the move ---
    // 1. Remove source step
    const [sourceStep] = sourceInfo.parentSteps.splice(sourceInfo.index, 1);
    if (!sourceStep) return false;

    // 2. Find target index AGAIN (indices might have shifted after removal)
    //    Important: Must search from the root again.
    targetInfo = findStepInfoRecursive(appState.currentFlowModel.steps, targetId);
    if (!targetInfo) {
        // If target disappeared (e.g., it was the item just after source),
        // revert by adding source back to its original position.
        console.warn("Move failed: Target info became invalid after source removal. Reverting.");
        sourceInfo.parentSteps.splice(sourceInfo.index, 0, sourceStep);
        return false;
    }

    // 3. Calculate insertion index within the target's parent array
    //    Note: targetInfo.index is the index of the *target* step itself.
    const insertIndex = position === 'before' ? targetInfo.index : targetInfo.index + 1;

    // 4. Insert source step into the target's parent array at the calculated index
    targetInfo.parentSteps.splice(insertIndex, 0, sourceStep);

    return true;
}


function deleteStepFromModel(stepId) {
    let deleted = false;
    const deleteRecursively = (steps) => {
        if (!steps || !Array.isArray(steps)) return []; // Return empty array if null/undefined
        const filteredSteps = [];
        for (const step of steps) {
            if (step.id === stepId) {
                deleted = true;
                continue; // Skip this step
            }
            if (step.type === 'condition') {
                // Create new object only if children change
                const newThen = deleteRecursively(step.thenSteps);
                const newElse = deleteRecursively(step.elseSteps);
                if (newThen !== step.thenSteps || newElse !== step.elseSteps) {
                    filteredSteps.push({ ...step, thenSteps: newThen, elseSteps: newElse });
                } else {
                    filteredSteps.push(step);
                }
            } else if (step.type === 'loop') {
                const newLoopSteps = deleteRecursively(step.loopSteps);
                if (newLoopSteps !== step.loopSteps) {
                     filteredSteps.push({ ...step, loopSteps: newLoopSteps });
                } else {
                    filteredSteps.push(step);
                }
            } else {
                 filteredSteps.push(step); // Keep non-container steps
            }
        }
        // Return the original array if no changes were made at this level
        // Check based on length and content (simple check)
         if (filteredSteps.length === steps.length && filteredSteps.every((s, i) => s === steps[i])) {
            return steps;
         }
         return filteredSteps;
    };

    const originalStepsJson = JSON.stringify(appState.currentFlowModel.steps);
    appState.currentFlowModel.steps = deleteRecursively(appState.currentFlowModel.steps);

    if (!deleted) {
        console.warn(`Delete step: Step with ID ${stepId} not found.`);
        return false; // Indicate no change
    }
    // Return true if deleted or structure changed (JSON compare is expensive, rely on flag)
    return true;
}

function cloneStepInModel(originalStepRef, newStepData) {
     if (!originalStepRef || !newStepData) return false;

     let inserted = false;
     const findAndInsertAfter = (steps) => {
         if (!steps || !Array.isArray(steps) || inserted) return steps;
         const resultSteps = [];
         for (let i = 0; i < steps.length; i++) {
             const currentStep = steps[i];
             resultSteps.push(currentStep);

             if (currentStep.id === originalStepRef.id) {
                 resultSteps.push(newStepData); // Insert clone after original
                 inserted = true;
             } else if (currentStep.type === 'condition') {
                 // Recurse - important to reassign potentially modified arrays
                 currentStep.thenSteps = findAndInsertAfter(currentStep.thenSteps);
                 currentStep.elseSteps = findAndInsertAfter(currentStep.elseSteps);
             } else if (currentStep.type === 'loop') {
                 currentStep.loopSteps = findAndInsertAfter(currentStep.loopSteps);
             }
         }
         return resultSteps;
     };

     appState.currentFlowModel.steps = findAndInsertAfter(appState.currentFlowModel.steps);

     if (!inserted) {
         console.warn(`Clone step: Original step ID ${originalStepRef.id} not found.`);
     }
     return inserted;
}


// --- Workspace UI Controls ---

function handleToggleInfoOverlay() {
    // The builder manages the overlay visibility internally now
    // We just need to reflect the state on the app's button
    if (appState.builderComponent) {
       appState.isInfoOverlayOpen = appState.builderComponent.toggleInfoOverlay();
       syncPanelVisibility();
    } else {
         // If builder isn't active (e.g., visual view), toggle manually
         appState.isInfoOverlayOpen = !domRefs.infoOverlay.classList.contains('open');
         domRefs.infoOverlay.classList.toggle('open', appState.isInfoOverlayOpen);
         syncPanelVisibility();
    }
}

function handleToggleVariablesPanel() {
     if (domRefs.variablesPanel) {
         appState.isVariablesPanelVisible = !domRefs.variablesPanel.classList.contains('visible');
         domRefs.variablesPanel.classList.toggle('visible', appState.isVariablesPanelVisible);
         syncPanelVisibility();
     }
}

function syncPanelVisibility() {
     // Sync Info Button Text
     domRefs.toggleInfoBtn.textContent = appState.isInfoOverlayOpen ? 'Info ▲' : 'Info ▼';

     // Sync Variables Button Text/Icon
     const varBtn = domRefs.toggleVariablesBtn;
     // Assuming structure: <button><span class="toggle-icon"></span><span class="btn-text"></span></button>
     const icon = varBtn.querySelector('.toggle-icon') || varBtn; // Fallback
     const textSpan = varBtn.querySelector('.btn-text') || varBtn;
     if(icon) icon.textContent = appState.isVariablesPanelVisible ? '▼' : '▲';
     if(textSpan) textSpan.textContent = appState.isVariablesPanelVisible ? ' Hide Variables' : ' Show Variables';
}


// --- Runner Panel Logic & Callbacks ---

function getRequestDelay() {
    const delayValue = parseInt(domRefs.requestDelayInput.value, 10);
    return isNaN(delayValue) || delayValue < 0 ? 0 : delayValue;
}

function updateRunnerUI() {
    const flowLoaded = !!appState.currentFlowModel;
    const isRunning = appState.runner?.isRunning() || false;
    const isStepping = appState.runner?.isStepping() || false; // Check if runner is in stepping mode
    const canStepInto = appState.runner?.canStepInto() || false; // Check if current step allows step-into

    domRefs.runFlowBtn.disabled = !flowLoaded || isRunning || isStepping || appState.isLoading;
    domRefs.stepFlowBtn.disabled = !flowLoaded || isRunning || isStepping || appState.isLoading;
    // domRefs.stepIntoFlowBtn.disabled = !flowLoaded || isRunning || isStepping || !canStepInto || appState.isLoading;
    domRefs.stepIntoFlowBtn.style.display = 'none'; // Hide until properly implemented
    domRefs.stopFlowBtn.disabled = (!isRunning && !isStepping) || appState.isLoading;
    domRefs.requestDelayInput.disabled = isRunning || isStepping || appState.isLoading;
    domRefs.clearResultsBtn.disabled = isRunning || isStepping || appState.isLoading;
}

function handleDelayChange() {
    if (appState.runner) {
        appState.runner.setDelay(getRequestDelay());
    }
}

function handleClearResults() {
    appState.executionResults = [];
    domRefs.runnerResultsList.innerHTML = '<li class="no-results">Run a flow to see results here.</li>';
    if (appState.runner) {
        // Reset runner state, including context based on current flow's static vars
        appState.runner.reset(appState.currentFlowModel?.staticVars || {});
    }
     // Clear visualizer/list highlights
     if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights();
     // TODO: Add clearing for list view highlights if implemented separately
    updateRunnerUI();
}

async function handleRunFlow() {
    if (!appState.currentFlowModel || !appState.runner || appState.runner.isRunning() || appState.runner.isStepping()) return;

    handleClearResults(); // Clear previous results and reset runner state
    updateRunnerUI();
    showMessage("Flow execution started...", "info", domRefs.runnerResultsList);

    try {
        // Start execution via the runner instance
        await appState.runner.run(appState.currentFlowModel);
        // Flow completion/stop message handled by callbacks
    } catch (error) {
        // Catch errors initiating the run (e.g., invalid flow model passed)
        console.error("Error starting flow execution:", error);
        showMessage(`Error starting run: ${error.message}`, "error", domRefs.runnerResultsList);
        // Ensure runner state is reset if start failed
        appState.runner.stop(); // Force stop/reset state
        updateRunnerUI();
    }
}

async function handleStepFlow() {
     if (!appState.currentFlowModel || !appState.runner || appState.runner.isRunning() || appState.runner.isStepping()) return;

     if (appState.runner.isStartOfFlow()) {
         handleClearResults(); // Clear results only on the very first step
     }

     updateRunnerUI(); // Disable buttons during step
     // Message handled by onStepStart callback

     try {
         await appState.runner.step(appState.currentFlowModel);
         // Completion/message handled by callbacks
     } catch (error) {
         console.error("Error during step execution:", error);
         showMessage(`Error during step: ${error.message}`, "error", domRefs.runnerResultsList);
         // Ensure runner state allows retry/stop
         appState.runner.stop(); // Force stop/reset on error? Or allow continuing? Stopping is safer.
         updateRunnerUI();
     }
}

// TODO: Implement Step Into
// async function handleStepIntoFlow() {
//     // ... similar logic to handleStepFlow but calls runner.stepInto() ...
// }

function handleStopFlow() {
    if (appState.runner && (appState.runner.isRunning() || appState.runner.isStepping())) {
        appState.runner.stop();
        showMessage("Stop requested...", "warning", domRefs.runnerResultsList);
        updateRunnerUI(); // Update button states immediately
    }
}

// --- FlowRunner Callbacks ---

function handleRunnerStepStart(step, executionPath) {
    // Update UI to show step is running
    const resultIndex = addResultEntry(step, 'running', executionPath); // Add placeholder
    // Highlight step in the active view
    if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
        appState.visualizerComponent.highlightNode(step.id, 'active-step');
    }
    // TODO: Highlight in list view if active
    showMessage(`Executing step: ${step.name}...`, 'info', domRefs.runnerResultsList);
    return resultIndex; // Return index for updating later
}

function handleRunnerStepComplete(resultIndex, step, result, context, executionPath) {
    // Update result entry
    updateResultEntry(resultIndex, result.status, result.output, result.error);
    // Update variable panel UI (context may have changed)
    appState.definedVariables = findDefinedVariables(appState.currentFlowModel, context); // Pass runtime context
    _updateVariablesPanelUI();
    // Update highlighting (remove active, maybe add success/error class?)
     if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
         appState.visualizerComponent.highlightNode(step.id, result.status); // Use status for class
     }
     // TODO: Highlight in list view
     updateRunnerUI(); // Re-enable buttons if stepping
}

function handleRunnerFlowComplete(finalContext, results) {
    showMessage("Flow execution finished.", "success", domRefs.runnerResultsList);
    updateRunnerUI();
     // Optionally clear active highlights
     if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights();
}

function handleRunnerFlowStopped(finalContext, results) {
    showMessage("Flow execution stopped by user.", "warning", domRefs.runnerResultsList);
    updateRunnerUI();
     // Update the last 'running' step to 'stopped' or 'error' if applicable
    const lastResultIndex = appState.executionResults.length - 1;
    if (lastResultIndex >= 0 && appState.executionResults[lastResultIndex].status === 'running') {
        const lastStep = findStepById(appState.currentFlowModel?.steps || [], appState.executionResults[lastResultIndex].stepId);
        updateResultEntry(lastResultIndex, 'stopped', null, 'Execution stopped by user');
         if (appState.visualizerComponent && lastStep) appState.visualizerComponent.highlightNode(lastStep.id, 'stopped');
    } else {
         // Or just clear all highlights if stop was between steps
         if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights();
    }
}

function handleRunnerError(resultIndex, step, error, context, executionPath) {
    console.error(`Runner Error during step ${step?.id} (${step?.name}):`, error);
    // If resultIndex is valid, update the specific entry
    if (resultIndex !== null && resultIndex >= 0) {
        updateResultEntry(resultIndex, 'error', null, error.message || 'Unknown execution error');
    } else {
        // Otherwise, add a general error message to the log
        addResultEntry({ name: 'Execution Error', type: 'System' }, 'error', null, error.message || 'Unknown execution error');
    }
    showMessage(`Execution failed at step "${step?.name || 'Unknown'}": ${error.message}`, "error", domRefs.runnerResultsList);
    // Update highlighting
     if (step && appState.currentView === 'node-graph' && appState.visualizerComponent) {
         appState.visualizerComponent.highlightNode(step.id, 'error');
     }
    updateRunnerUI(); // Ensure UI reflects stopped state
}

function handleRunnerContextUpdate(newContext) {
    // Update the variables panel based on the latest runtime context
    // This is useful for seeing variable changes during execution, but findDefinedVariables
    // currently only shows definition points. We need a way to show *runtime* values.
    // For now, just re-render the definition list (which might not change mid-run).
    // A better approach would be to have a separate "Runtime Variables" panel.
    appState.definedVariables = findDefinedVariables(appState.currentFlowModel, newContext); // Pass runtime context
    _updateVariablesPanelUI();
}


// --- Runner Result Rendering (in app.js for DOM access) ---

function addResultEntry(step, status = 'pending', executionPath = []) {
    const noResultsLi = domRefs.runnerResultsList.querySelector('.no-results');
    if (noResultsLi) noResultsLi.remove();

    const li = document.createElement('li');
    li.className = 'result-item';
    li.dataset.stepId = step.id || `exec-${Date.now()}`;
    const resultIndex = appState.executionResults.length; // Use appState's array
    li.dataset.resultIndex = resultIndex;

    const statusClass = status === 'success' ? 'success' : (status === 'error' ? 'error' : (status === 'running' ? 'running' : (status === 'stopped' ? 'warning' : 'skipped')));

    li.innerHTML = `
        <div class="result-header">
            <span class="result-step-name">${escapeHTML(step.name || 'Unnamed Step')} (${step.type || '??'})</span>
            <span class="result-status ${statusClass}">${status.toUpperCase()}</span>
        </div>
        <!-- Details/Body/Error added by updateResultEntry -->
    `;

    domRefs.runnerResultsList.appendChild(li);
    // Scroll only if the panel is not already scrolled by the user
    if (domRefs.runnerResultsList.scrollHeight - domRefs.runnerResultsList.scrollTop <= domRefs.runnerResultsList.clientHeight + 50) {
       domRefs.runnerResultsList.scrollTop = domRefs.runnerResultsList.scrollHeight;
    }


    // Store lightweight result object in appState for tracking
    appState.executionResults.push({
        stepId: step.id,
        stepName: step.name,
        status: status,
        output: null, // Populated by update
        error: null,  // Populated by update
        executionPath: executionPath, // Store path for potential context
    });
    return resultIndex;
}

function updateResultEntry(index, status, output, error) {
    if (index < 0 || index >= appState.executionResults.length) return; // Invalid index

    const resultData = appState.executionResults[index];
    resultData.status = status;
    resultData.output = output;
    resultData.error = error;

    const li = domRefs.runnerResultsList.querySelector(`[data-result-index="${index}"]`);
    if (!li) return;

    const statusSpan = li.querySelector('.result-status');
    let bodyDiv = li.querySelector('.result-body');
    let errorDiv = li.querySelector('.result-error');

    const statusClass = status === 'success' ? 'success' : (status === 'error' ? 'error' : (status === 'running' ? 'running' : (status === 'stopped' ? 'warning' : 'skipped')));

    if (statusSpan) {
        statusSpan.className = `result-status ${statusClass}`;
        statusSpan.textContent = status.toUpperCase();
    }

    // Add/Update/Remove Output Body
    if (output) {
        const outputString = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
        const bodyContent = `<pre>${escapeHTML(outputString)}</pre>`;
        if (!bodyDiv) {
            bodyDiv = document.createElement('div');
            bodyDiv.className = 'result-body';
            li.appendChild(bodyDiv);
        }
        bodyDiv.innerHTML = bodyContent;
    } else if (bodyDiv) {
        bodyDiv.remove();
    }

    // Add/Update/Remove Error Message
    if (error) {
        const errorContent = `<strong>Error:</strong> ${escapeHTML(typeof error === 'string' ? error : error.message || 'Unknown Error')}`;
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'result-error';
            // Insert error after header, before body
            li.insertBefore(errorDiv, li.querySelector('.result-body') || null);
        }
        errorDiv.innerHTML = errorContent;
    } else if (errorDiv) {
        errorDiv.remove();
    }

    // Scroll logic (same as addResultEntry)
    if (domRefs.runnerResultsList.scrollHeight - domRefs.runnerResultsList.scrollTop <= domRefs.runnerResultsList.clientHeight + 50) {
        domRefs.runnerResultsList.scrollTop = domRefs.runnerResultsList.scrollHeight;
    }
}


// --- Utilities / Shared Logic ---

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Step Type Dialog (Managed by App) ---

let stepTypeDialogCallback = null;

function initializeStepTypeDialogListeners() {
    // Using the dialog provided in index.html
    if (!domRefs.stepTypeDialog) return;
    const closeButton = domRefs.stepTypeDialog.querySelector('.step-type-close');
    closeButton?.addEventListener('click', () => hideAppStepTypeDialog(null));

    domRefs.stepTypeDialog.querySelectorAll('.step-type-option').forEach(option => {
        option.addEventListener('click', () => {
            const type = option.dataset.type;
            hideAppStepTypeDialog(type);
        });
    });
    domRefs.stepTypeDialog.addEventListener('click', (e) => {
        if (e.target === domRefs.stepTypeDialog) hideAppStepTypeDialog(null);
    });
}

function showAppStepTypeDialog(onSelect) {
    stepTypeDialogCallback = onSelect;
    if (domRefs.stepTypeDialog) {
        // Populate icons dynamically
        domRefs.stepTypeDialog.querySelector('.request-icon').innerHTML = getStepTypeIcon('request');
        domRefs.stepTypeDialog.querySelector('.condition-icon').innerHTML = getStepTypeIcon('condition');
        domRefs.stepTypeDialog.querySelector('.loop-icon').innerHTML = getStepTypeIcon('loop');
        domRefs.stepTypeDialog.style.display = 'flex';
    }
}

function hideAppStepTypeDialog(selectedType) {
    if (domRefs.stepTypeDialog) domRefs.stepTypeDialog.style.display = 'none';
    if (stepTypeDialogCallback) {
        stepTypeDialogCallback(selectedType);
        stepTypeDialogCallback = null; // Reset callback
    }
}


// --- Variable Dropdown (Managed by App) ---
let currentVarDropdown = { button: null, targetInput: null, handler: null };

function initializeVarDropdownListeners() {
    // Listener for the dropdown itself
    if (!domRefs.varDropdown) return;
    const searchInput = domRefs.varDropdown.querySelector('.var-search');
    const varList = domRefs.varDropdown.querySelector('.var-list');
    const closeBtn = domRefs.varDropdown.querySelector('.var-close');
    const noResultsMsg = domRefs.varDropdown.querySelector('.no-results-msg');

    searchInput.addEventListener('input', () => {
        const filter = searchInput.value.toLowerCase();
        let hasVisibleItems = false;
        varList.querySelectorAll('.var-item').forEach(item => {
            const varName = item.dataset.var.toLowerCase();
            const isVisible = varName.includes(filter);
            item.style.display = isVisible ? '' : 'none';
            if (isVisible) hasVisibleItems = true;
        });
        noResultsMsg.style.display = hasVisibleItems ? 'none' : 'block';
    });
    closeBtn.addEventListener('click', () => hideVarDropdown());
    varList.addEventListener('click', (e) => {
        if (e.target.classList.contains('var-item')) {
            insertVariableIntoInput(e.target.dataset.var);
            hideVarDropdown();
        }
    });
}

// Event listener for variable insert buttons using delegation
function initializeVariableInsertionListener() {
    document.body.addEventListener('click', (event) => {
        const insertButton = event.target.closest('.btn-insert-var');
        if (insertButton) {
            // Find the associated input/textarea based on data-target-input or siblings/parents
            let targetInput = null;
            const targetId = insertButton.dataset.targetInput;
            if (targetId) {
                // Search within the current editor context or globally? Assume global for simplicity.
                targetInput = document.getElementById(targetId);
            } else {
                // Fallback: search within common parents
                 const inputContainer = insertButton.closest('.input-with-vars, .header-row, .global-header-row, .flow-var-row');
                 if (inputContainer) {
                     targetInput = inputContainer.querySelector('input[type="text"], textarea');
                 }
            }

            if (targetInput) {
                const currentVars = appState.definedVariables || {}; // Use cached variables
                const varNames = Object.keys(currentVars);
                showVarDropdown(insertButton, targetInput, varNames);
            } else {
                console.warn("Could not find target input for variable insertion button.", insertButton);
            }
        }
    });
}


function showVarDropdown(button, targetInput, availableVarNames) {
    hideVarDropdown(); // Hide any existing dropdown

    if (!availableVarNames || availableVarNames.length === 0) {
        showMessage("No variables available to insert.", "info");
        return;
    }

    currentVarDropdown = { button, targetInput };
    const varList = domRefs.varDropdown.querySelector('.var-list');
    const searchInput = domRefs.varDropdown.querySelector('.var-search');
    const noResultsMsg = domRefs.varDropdown.querySelector('.no-results-msg');

    varList.innerHTML = availableVarNames.sort()
        .map(varName => `<div class="var-item" data-var="${escapeHTML(varName)}">${escapeHTML(varName)}</div>`)
        .join('');
    searchInput.value = '';
    noResultsMsg.style.display = 'none';
    varList.querySelectorAll('.var-item').forEach(item => item.style.display = '');

    const rect = button.getBoundingClientRect();
    domRefs.varDropdown.style.top = `${rect.bottom + window.scrollY + 2}px`;
    domRefs.varDropdown.style.left = `${rect.left + window.scrollX}px`;
    domRefs.varDropdown.style.display = 'block';

    setTimeout(() => searchInput.focus(), 50);

    currentVarDropdown.handler = (event) => {
        if (!domRefs.varDropdown.contains(event.target) && event.target !== button) {
            hideVarDropdown();
        }
    };
    setTimeout(() => document.addEventListener('click', currentVarDropdown.handler, true), 0);
}

function hideVarDropdown() {
    if (domRefs.varDropdown) domRefs.varDropdown.style.display = 'none';
    if (currentVarDropdown.handler) {
        document.removeEventListener('click', currentVarDropdown.handler, true);
    }
    currentVarDropdown = { button: null, targetInput: null, handler: null };
}

function insertVariableIntoInput(varName) {
    const targetInput = currentVarDropdown.targetInput;
    if (!targetInput) return;

    const textToInsert = `{{${varName}}}`;
    const currentVal = targetInput.value;
    const selectionStart = targetInput.selectionStart;
    const selectionEnd = targetInput.selectionEnd;

    targetInput.value = currentVal.substring(0, selectionStart) + textToInsert + currentVal.substring(selectionEnd);
    const newCursorPos = selectionStart + textToInsert.length;
    targetInput.selectionStart = newCursorPos;
    targetInput.selectionEnd = newCursorPos;

    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.focus();
}


// --- Execution Logic Helpers (needed by runner, defined here for context access) ---
// Note: These are passed to FlowRunner instance during initialization.

/**
 * Creates a processed version of the step with variables substituted using the current runtime context.
 * This function needs access to the `evaluateVariable` function (defined below or imported).
 * @param {Object} step - The original step object.
 * @param {Object} context - The current execution context { varName: value }.
 * @return {Object} A new step object with substituted values.
 */
 function substituteVariablesInStep(step, context) {
    const processed = { ...step }; // Shallow copy

    function substitute(value) {
        // Handles strings, objects, arrays
        if (typeof value === 'string') {
            return substituteVariables(value, context); // Handles {{var}} in strings
        } else if (Array.isArray(value)) {
            return value.map(item => substitute(item));
        } else if (typeof value === 'object' && value !== null) {
            const newObj = {};
            for (const key in value) {
                // Substitute in values, not keys
                newObj[key] = substitute(value[key]);
            }
            return newObj;
        }
        return value; // Return numbers, booleans, null as is
    }

    if (processed.type === 'request') {
        processed.url = substituteVariables(step.url, context); // URL is always string
        processed.headers = substitute(step.headers); // Substitute in header values
        processed.body = substitute(step.body); // Substitute recursively in body
    } else if (processed.type === 'condition') {
        // Substitute in conditionData.value if it's a variable reference
         if (processed.conditionData?.value && typeof processed.conditionData.value === 'string' && processed.conditionData.value.startsWith('{{') && processed.conditionData.value.endsWith('}}')) {
              processed.conditionData = { ...processed.conditionData, value: evaluateVariable(processed.conditionData.value, context) };
         }
        // The variable itself (conditionData.variable) is evaluated just before comparison
    } else if (processed.type === 'loop') {
        // Source is evaluated just before loop starts
    }
    // processed.name = substituteVariables(step.name, context); // Optionally substitute in name

    return processed;
}

/**
 * Replace {{variable}} placeholders in a simple string.
 * @param {string} text - Input string.
 * @param {Object} context - Execution context.
 * @return {string} String with variables replaced.
 */
function substituteVariables(text, context) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
        const value = evaluateVariable(match, context);
        // If value is object/array, stringify it for embedding in URL/header string etc.
        if (typeof value === 'object' && value !== null) {
            try { return JSON.stringify(value); } catch { return match; } // Fallback
        }
        return value !== undefined && value !== null ? String(value) : match; // Fallback
    });
}


/**
 * Evaluate a variable reference like {{varName}} or {{obj.path[0].value}} from context.
 * @param {string} varRef - The variable reference string (e.g., "{{var.path}}").
 * @param {Object} context - The current execution context.
 * @return {*} The evaluated value, or undefined if not found/error.
 */
function evaluateVariable(varRef, context) {
    if (!varRef || typeof varRef !== 'string') return undefined;
    const match = varRef.match(/\{\{([^}]+)\}\}/);
    if (!match) return undefined;

    const path = match[1].trim();
    // Use flowCore's evaluatePath function for robust evaluation
    try {
        // Need evaluatePath from flowCore.js, import it if not already.
        // Assuming evaluatePath is globally available or imported correctly.
        // It seems `evaluatePath` is NOT imported in the provided flowCore.js,
        // so we need a local implementation or add it to flowCore.js and import it.
        // Let's add a basic implementation here for now.
        return evaluatePathLocal(context, path);
    } catch(e) {
        console.warn(`Error evaluating path "${path}":`, e);
        return undefined;
    }
}

// Local implementation of evaluatePath (should ideally be in flowCore.js)
function evaluatePathLocal(data, path) {
     if (data === null || data === undefined || !path) return undefined;
     const parts = path.match(/([^[.\]]+)|\[(\d+)\]/g);
     if (!parts) return undefined;
     let current = data;
     for (const part of parts) {
         if (current === null || current === undefined) return undefined;
         const arrayMatch = part.match(/^\[(\d+)\]$/);
         if (arrayMatch) {
             const index = parseInt(arrayMatch[1], 10);
             if (!Array.isArray(current) || index < 0 || index >= current.length) return undefined;
             current = current[index];
         } else {
             // Handle direct property access, case-sensitive
             if (typeof current !== 'object' || !current.hasOwnProperty(part)) {
                 // Special case: if path is 'body' and current has 'body', return it directly
                 if (part === 'body' && current.hasOwnProperty('body')) {
                     current = current.body;
                 } else if (part === 'status' && current.hasOwnProperty('status')) {
                     current = current.status;
                 } else if (part === 'headers' && current.hasOwnProperty('headers')) {
                     current = current.headers;
                 }
                 else {
                    return undefined;
                 }
             } else {
                current = current[part];
             }

         }
     }
     return current;
}


/**
 * Evaluate a structured condition using the current context.
 * @param {Object} conditionData - Structured condition { variable, operator, value }.
 * @param {Object} context - Execution context.
 * @return {boolean} Result of the condition evaluation.
 * @throws {Error} If evaluation fails.
 */
function evaluateCondition(conditionData, context) {
    const { variable, operator, value: conditionValue } = conditionData;
    if (!variable || !operator) {
        throw new Error("Invalid condition data: Variable and operator are required.");
    }

    // Evaluate the variable part from context
    const actualValue = evaluateVariable(`{{${variable}}}`, context);

    // Note: conditionValue might already be substituted if it was a variable ref itself
    const comparisonValue = conditionValue;

    // Perform comparison based on operator
    const numActual = Number(actualValue);
    const numComparison = Number(comparisonValue);
    const strActual = String(actualValue ?? ''); // Use empty string for null/undefined in string ops

    try {
        switch (operator) {
            case 'equals': return actualValue == comparisonValue; // Loose equality for flexibility
            case 'not_equals': return actualValue != comparisonValue;
            case 'greater_than': return !isNaN(numActual) && !isNaN(numComparison) && numActual > numComparison;
            case 'less_than': return !isNaN(numActual) && !isNaN(numComparison) && numActual < numComparison;
            case 'greater_equals': return !isNaN(numActual) && !isNaN(numComparison) && numActual >= numComparison;
            case 'less_equals': return !isNaN(numActual) && !isNaN(numComparison) && numActual <= numComparison;
            case 'contains': return typeof actualValue === 'string' && strActual.includes(String(comparisonValue ?? ''));
            case 'starts_with': return typeof actualValue === 'string' && strActual.startsWith(String(comparisonValue ?? ''));
            case 'ends_with': return typeof actualValue === 'string' && strActual.endsWith(String(comparisonValue ?? ''));
            case 'matches_regex':
                 try { return new RegExp(String(comparisonValue)).test(strActual); }
                 catch { return false; } // Invalid regex pattern
            case 'exists': return actualValue !== undefined && actualValue !== null;
            case 'not_exists': return actualValue === undefined || actualValue === null;
            case 'is_number': return typeof actualValue === 'number' && !isNaN(actualValue);
            case 'is_text': return typeof actualValue === 'string';
            case 'is_boolean': return typeof actualValue === 'boolean';
            case 'is_array': return Array.isArray(actualValue);
            case 'is_true': return actualValue === true;
            case 'is_false': return actualValue === false;
            default:
                 console.warn(`Unknown condition operator: ${operator}`);
                 return false;
        }
    } catch (evalError) {
        console.error(`Error during condition evaluation (Op: ${operator}, Var: ${variable}):`, evalError);
        throw new Error(`Condition evaluation failed: ${evalError.message}`);
    }
}
