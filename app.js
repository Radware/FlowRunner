// --- MODIFIED: Import core functions ---
import {
    flowModelToJson,
    jsonToFlowModel,
    validateFlow,
    createTemplateFlow, // Keep this
    createNewStep,
    findStepById,
    cloneStep, // Keep this for in-memory clone
    escapeHTML,
    findDefinedVariables,
    evaluatePath // <-- ADD evaluatePath to imports
} from './flowCore.js';

import { FlowBuilderComponent } from './flowBuilderComponent.js';
import { showStepTypeDialog, getStepTypeIcon } from './flowStepComponents.js';
import { FlowRunner } from './flowRunner.js';
import { FlowVisualizer } from './flowVisualizer.js';

// --- Constants ---
const RECENT_FILES_KEY = 'flowrunnerRecentFiles';
const MAX_RECENT_FILES = 10;
const DEFAULT_REQUEST_DELAY = 500; // Keep this

// Import path module for basename in updateWorkspaceTitle
// Note: This won't work directly in the browser renderer without nodeIntegration:true,
// but since we are in Electron, we can expose path functions via preload if needed,
// or perform path manipulation in main process/IPC calls.
// For simplicity here, let's assume a simple string split works for display purposes.
// A better way would be IPC: `window.electronAPI.getPathBasename(filePath)`
const path = {
    basename: (p) => p.split(/[\\/]/).pop() || p
};

// --- Application State ---
let appState = {
    // flows: [], // Remove: No longer loading a list of all flows in memory from API
    currentFilePath: null, // --- NEW: Track path of the currently open file
    currentFlowModel: null,
    selectedStepId: null,
    isDirty: false, // Represents changes to flow structure, metadata, or step *content* after editor save
    stepEditorIsDirty: false, // Represents unsaved changes *within* the currently open step editor
    isLoading: false,
    runner: null,
    executionResults: [],
    currentView: 'list-editor',
    builderComponent: null,
    visualizerComponent: null,
    isInfoOverlayOpen: false,
    isVariablesPanelVisible: false,
    // stepEditorIsDirty: false, // Moved from builder, managed by app -- Now defined above
    definedVariables: {}, // Moved from builder, managed by app
    // NEW State Variables for Pane Collapse
    isSidebarCollapsed: false,
    isRunnerCollapsed: false,
};

// --- DOM Element References ---
let domRefs = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Initializing API Flowmap Maker (Electron Version)...");
    initializeDOMReferences();
    initializeEventListeners();
    initializeRunner(); // Initialize runner early
    initializeVisualizer(); // Initialize visualizer early
    loadFlowList(); // Load recent files list
    updateRunnerUI(); // Set initial runner button states
    updateViewToggle(); // Set initial view toggle state
    updateWorkspaceTitle(); // Set initial title

    // --- NEW: Load persisted collapse states ---
    try {
        const storedSidebarState = localStorage.getItem('sidebarCollapsed');
        if (storedSidebarState !== null) {
            appState.isSidebarCollapsed = storedSidebarState === 'true';
            domRefs.sidebar?.classList.toggle('collapsed', appState.isSidebarCollapsed);
            // Button appearance handled by CSS
        }
        const storedRunnerState = localStorage.getItem('runnerCollapsed');
        if (storedRunnerState !== null) {
            appState.isRunnerCollapsed = storedRunnerState === 'true';
            domRefs.runnerPanel?.classList.toggle('collapsed', appState.isRunnerCollapsed);
            // Button appearance handled by CSS
        }
    } catch (e) {
        console.warn("Could not load persisted pane states:", e);
    }
    // --- End NEW ---

    // Check if electronAPI is exposed
    if (!window.electronAPI) {
        console.error("FATAL: Electron API not exposed! Check preload script.");
        showMessage("Error: Application cannot access local files. Please restart.", "error", document.body, "Initialization Error");
        // Disable file operations if API is missing
        if (domRefs.addFlowBtn) domRefs.addFlowBtn.disabled = true;
        if (domRefs.openFlowBtn) domRefs.openFlowBtn.disabled = true;
        if (domRefs.saveFlowBtn) domRefs.saveFlowBtn.disabled = true;
        if (domRefs.saveAsFlowBtn) domRefs.saveAsFlowBtn.disabled = true;
    } else {
         console.log("Electron API detected successfully.");
    }
});

// --- [Modified Code] --- in initializeDOMReferences()
function initializeDOMReferences() {
    domRefs = {
        // Sidebar
        sidebar: document.getElementById('sidebar'), // Reference to the aside element
        sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'), // NEW
        addFlowBtn: document.getElementById('add-flow-btn'), // Now just "New"
        openFlowBtn: document.getElementById('open-flow-btn'), // ** NEW HYPOTHETICAL BUTTON **
        flowList: document.getElementById('flow-list'), // Now shows recent files

        // Workspace
        workspace: document.getElementById('workspace'),
        workspaceTitle: document.getElementById('workspace-title'),
        workspaceContent: document.getElementById('workspace-content'),
        workspacePlaceholder: document.getElementById('workspace-placeholder'),
        toggleViewBtn: document.getElementById('toggle-view-btn'),

        // Views within Workspace Content
        flowBuilderMount: document.getElementById('flow-builder-mount'),
        flowVisualizerMount: document.getElementById('flow-visualizer-mount'),

        // Controls within Header
        saveFlowBtn: document.getElementById('save-flow-btn'), // ** NEW HYPOTHETICAL BUTTON **
        saveAsFlowBtn: document.getElementById('save-as-flow-btn'), // ** NEW HYPOTHETICAL BUTTON **
        toggleInfoBtn: document.getElementById('toggle-info-btn'),
        toggleVariablesBtn: document.getElementById('toggle-variables-btn'),

        // Panels relative to Workspace
        variablesPanel: document.getElementById('variables-panel'),
        variablesContainer: document.getElementById('variables-container'),
        infoOverlay: document.querySelector('[data-ref="infoOverlay"]'), // Used by builder

        // Messages
        builderMessages: document.getElementById('builder-messages'),

        // Runner Panel
        runnerPanel: document.getElementById('runner-panel'), // Reference to the aside element
        runnerToggleBtn: document.getElementById('runner-toggle-btn'), // NEW
        runFlowBtn: document.getElementById('run-flow-btn'),
        stepFlowBtn: document.getElementById('step-flow-btn'),
        stepIntoFlowBtn: document.getElementById('step-into-flow-btn'),
        stopFlowBtn: document.getElementById('stop-flow-btn'),
        clearResultsBtn: document.getElementById('clear-results-btn'),
        requestDelayInput: document.getElementById('request-delay'),
        runnerResultsList: document.getElementById('runner-results'),
        runnerResultsContainer: document.querySelector('.runner-results-container'),

        // Dialogs & Overlays
        stepTypeDialog: document.getElementById('step-type-dialog'),
        varDropdown: document.getElementById('var-dropdown'),
        globalLoadingOverlay: document.getElementById('global-loading-overlay'),
    };
    // Check for new elements
    if (!domRefs.sidebarToggleBtn) console.warn("Required button #sidebar-toggle-btn not found in HTML.");
    if (!domRefs.runnerToggleBtn) console.warn("Required button #runner-toggle-btn not found in HTML.");
    if (!domRefs.sidebar) console.warn("Required element #sidebar not found in HTML.");
    if (!domRefs.runnerPanel) console.warn("Required element #runner-panel not found in HTML.");

    // Check for optional buttons
    if (!domRefs.openFlowBtn) console.warn("Optional button #open-flow-btn not found in HTML.");
    if (!domRefs.saveFlowBtn) console.warn("Optional button #save-flow-btn not found in HTML.");
    if (!domRefs.saveAsFlowBtn) console.warn("Optional button #save-as-flow-btn not found in HTML.");
}

// --- [Modified Code] --- in initializeEventListeners()
function initializeEventListeners() {
    // Sidebar
    domRefs.addFlowBtn?.addEventListener('click', handleCreateNewFlow);
    domRefs.openFlowBtn?.addEventListener('click', handleOpenFile); // --- NEW EVENT LISTENER ---
    domRefs.flowList?.addEventListener('click', handleFlowListActions); // Now handles recent file clicks

    // Workspace Header Controls
    domRefs.saveFlowBtn?.addEventListener('click', () => saveCurrentFlow(false)); // --- NEW EVENT LISTENER --- Use wrapper to pass false
    domRefs.saveAsFlowBtn?.addEventListener('click', handleSaveAs); // --- NEW EVENT LISTENER ---
    domRefs.toggleViewBtn?.addEventListener('click', handleToggleView);
    domRefs.toggleInfoBtn?.addEventListener('click', handleToggleInfoOverlay);
    domRefs.toggleVariablesBtn?.addEventListener('click', handleToggleVariablesPanel);

    // Runner
    domRefs.runFlowBtn?.addEventListener('click', handleRunFlow);
    domRefs.stepFlowBtn?.addEventListener('click', handleStepFlow);
    // domRefs.stepIntoFlowBtn.addEventListener('click', handleStepIntoFlow); // Keep commented or implement
    domRefs.stopFlowBtn?.addEventListener('click', handleStopFlow);
    domRefs.clearResultsBtn?.addEventListener('click', handleClearResults);
    domRefs.requestDelayInput?.addEventListener('change', handleDelayChange);

    // NEW: Pane Collapse Toggle Buttons
    domRefs.sidebarToggleBtn?.addEventListener('click', handleToggleSidebarCollapse);
    domRefs.runnerToggleBtn?.addEventListener('click', handleToggleRunnerCollapse);

    // Global
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Initialize listeners for dynamic elements
    initializeStepTypeDialogListeners();
    initializeVarDropdownListeners();
    initializeVariableInsertionListener();

    // Expose step type dialog function globally for components
    window.showAppStepTypeDialog = showAppStepTypeDialog;
}

// --- [New Code] --- Add new handler functions in app.js
/**
 * Toggles the collapsed state of the left sidebar.
 */
function handleToggleSidebarCollapse() {
    if (!domRefs.sidebar || !domRefs.sidebarToggleBtn) return;

    appState.isSidebarCollapsed = !appState.isSidebarCollapsed;
    domRefs.sidebar.classList.toggle('collapsed', appState.isSidebarCollapsed);

    // Update button icon via CSS :before selector, no JS needed for icon change
    // Optional: Store state in localStorage for persistence across sessions
    try { localStorage.setItem('sidebarCollapsed', appState.isSidebarCollapsed); } catch (e) { console.warn("Could not persist sidebar state:", e); }

    console.log(`Sidebar collapsed state: ${appState.isSidebarCollapsed}`);
}

/**
 * Toggles the collapsed state of the right runner panel.
 */
function handleToggleRunnerCollapse() {
    if (!domRefs.runnerPanel || !domRefs.runnerToggleBtn) return;

    appState.isRunnerCollapsed = !appState.isRunnerCollapsed;
    domRefs.runnerPanel.classList.toggle('collapsed', appState.isRunnerCollapsed);

    // Update button icon via CSS :before selector, no JS needed for icon change
    // Optional: Store state in localStorage
    try { localStorage.setItem('runnerCollapsed', appState.isRunnerCollapsed); } catch (e) { console.warn("Could not persist runner state:", e); }

    console.log(`Runner collapsed state: ${appState.isRunnerCollapsed}`);
}

// --- Recent Files Helpers ---

// --- NEW HELPER FUNCTION ---
/** Adds a file path to the recent files list in localStorage. */
function addRecentFile(filePath) {
    if (!filePath) return;
    try {
        let recentFiles = getRecentFiles();
        // Remove existing entry if present, to move it to the top
        recentFiles = recentFiles.filter(p => p !== filePath);
        // Add to the beginning
        recentFiles.unshift(filePath);
        // Limit the list size
        if (recentFiles.length > MAX_RECENT_FILES) {
            recentFiles.pop();
        }
        localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentFiles));
        // Refresh the sidebar list
        renderFlowList(recentFiles);
    } catch (error) {
        console.error("Error updating recent files in localStorage:", error);
    }
}

// --- NEW HELPER FUNCTION ---
/** Retrieves the list of recent file paths from localStorage. */
function getRecentFiles() {
    try {
        const stored = localStorage.getItem(RECENT_FILES_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error("Error reading recent files from localStorage:", error);
        // Optionally clear corrupted data
        // localStorage.removeItem(RECENT_FILES_KEY);
        return [];
    }
}

// --- Loading and State Management ---

function setLoading(isLoading, scope = 'global') {
    appState.isLoading = isLoading;
    if (scope === 'global' && domRefs.globalLoadingOverlay) {
        domRefs.globalLoadingOverlay.style.display = isLoading ? 'flex' : 'none';
    }
    // Disable file buttons while loading
    if (domRefs.addFlowBtn) domRefs.addFlowBtn.disabled = isLoading;
    if (domRefs.openFlowBtn) domRefs.openFlowBtn.disabled = isLoading;

    // Save buttons also depend on dirty state, handled in setDirty
    const needsSave = appState.isDirty || appState.stepEditorIsDirty;
    if (domRefs.saveFlowBtn) domRefs.saveFlowBtn.disabled = isLoading || !needsSave || !appState.currentFlowModel;
    if (domRefs.saveAsFlowBtn) domRefs.saveAsFlowBtn.disabled = isLoading || !appState.currentFlowModel;

    updateRunnerUI(); // Reflects both global loading and runner state
}


// --- [Modified Code] in app.js ---
function setDirty(dirtyFlagFromSource) {
    // Note: The `dirtyFlagFromSource` parameter is often misleading here.
    // We should always recalculate the `needsSave` state based on the *current*
    // `appState.isDirty` and `appState.stepEditorIsDirty`.
    // `appState.isDirty` reflects structural/saved-editor changes.
    // `appState.stepEditorIsDirty` reflects unsaved changes in the *current* editor instance.

    // Recalculate overall dirty state
    const needsSave = appState.isDirty || appState.stepEditorIsDirty;

    // Update title only if the *calculated* overall dirty state changes its representation
    const titleElement = domRefs.workspaceTitle;
    const hasAsterisk = titleElement?.textContent?.includes(' *') ?? false;

    if (needsSave !== hasAsterisk) {
        // Update title immediately if state mismatches the visual indicator
        updateWorkspaceTitle();
    }

    // --- Update Button States based on the calculated `needsSave` ---
    const canSave = needsSave && !!appState.currentFlowModel && !appState.isLoading;
    const canSaveAs = !!appState.currentFlowModel && !appState.isLoading; // Can always save-as if a model exists

    if (domRefs.saveFlowBtn) {
        domRefs.saveFlowBtn.disabled = !canSave;
        // Optional: Add visual cue like subtle pulse if changes need saving
        domRefs.saveFlowBtn.classList.toggle('needs-save', canSave);
    }
    if (domRefs.saveAsFlowBtn) {
        domRefs.saveAsFlowBtn.disabled = !canSaveAs;
    }

    // Log state changes for debugging
    // console.log(`setDirty called: isDirty=${appState.isDirty}, stepEditorIsDirty=${appState.stepEditorIsDirty}, needsSave=${needsSave}, saveBtnDisabled=${!canSave}`);
}


function handleBeforeUnload(event) {
    if (appState.isDirty || appState.stepEditorIsDirty) {
        event.preventDefault(); // Standard requirement
        event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'; // For older browsers
        return 'You have unsaved changes. Are you sure you want to leave?'; // For modern browsers
    }
}

// --- MODIFIED FUNCTION ---
function updateWorkspaceTitle() {
    let title = 'FlowRunner'; // Default app title
    let workspaceHeader = 'Select or Create a Flow'; // Default workspace header

    if (appState.currentFlowModel) {
        const baseName = appState.currentFlowModel.name || 'Untitled Flow';
        // Extract filename from path if available
        const fileName = appState.currentFilePath ? path.basename(appState.currentFilePath) : baseName;
        const needsSave = appState.isDirty || appState.stepEditorIsDirty; // Check combined state
        title = `${fileName}${needsSave ? ' *' : ''} - FlowRunner`;
        workspaceHeader = `${baseName}${needsSave ? ' *' : ''}`;
    }

    if (domRefs.workspaceTitle) {
        domRefs.workspaceTitle.textContent = workspaceHeader;
    }
    // Update the main window title bar
    document.title = title;
}


function showMessage(message, type = 'info', container = domRefs.builderMessages, title = null) {
    // (Keep existing showMessage implementation)
    if (!container) return;
    const MAX_MESSAGES = 3;
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
    const timeout = type === 'error' ? 10000 : (type === 'success' ? 4000 : 5000);
    timeoutId = setTimeout(dismiss, timeout);
    container.prepend(messageEl); // Add new messages to the top
}

function clearMessages(container = domRefs.builderMessages) {
    if (container) container.innerHTML = '';
}

// --- Sidebar Logic (Recent Files) ---

// --- MODIFIED FUNCTION ---
function loadFlowList() {
    // Load and render the recent files list from localStorage
    if (!domRefs.flowList) return;
    domRefs.flowList.innerHTML = '<li class="loading-flows">Loading recent files...</li>';
    const recentFiles = getRecentFiles();
    renderFlowList(recentFiles);
}

// --- MODIFIED FUNCTION ---
function renderFlowList(recentFiles) {
    if (!domRefs.flowList) return;
    domRefs.flowList.innerHTML = ''; // Clear previous list

    if (!recentFiles || recentFiles.length === 0) {
        domRefs.flowList.innerHTML = '<li class="no-flows">No recent files.</li>';
        return;
    }

    // Helper to get just the filename from a path
    const getFileName = (filePath) => path.basename(filePath);

    recentFiles.forEach(filePath => {
        const li = document.createElement('li');
        li.className = 'flow-list-item recent-file-item';
        li.dataset.filePath = filePath; // Store the full path
        li.title = filePath; // Show full path on hover

        if (filePath === appState.currentFilePath) {
            li.classList.add('selected');
        }

        li.innerHTML = `
            <span class="flow-item-name">${escapeHTML(getFileName(filePath))}</span>
            <div class="flow-item-actions">
                 <!-- Add actions like 'Remove from Recents' if needed later -->
                 <!-- <button class="btn-remove-recent" data-action="remove-recent" title="Remove from Recent List">✕</button> -->
            </div>
        `;
        domRefs.flowList.appendChild(li);
    });
}

// --- MODIFIED FUNCTION ---
function handleFlowListActions(event) {
    // Handles clicks on the recent files list
    const targetListItem = event.target.closest('.recent-file-item');

    if (targetListItem) {
        const filePath = targetListItem.dataset.filePath;
        if (filePath && filePath !== appState.currentFilePath) {
            console.log(`Recent file selected: ${filePath}`);
            handleSelectFlow(filePath); // Load the selected file path
        }
    }
    // Handle other actions like 'remove-recent' if buttons are added later
    /*
    const targetButton = event.target.closest('button[data-action="remove-recent"]');
    if (targetButton) {
        event.stopPropagation();
        const filePathToRemove = targetButton.closest('.recent-file-item')?.dataset.filePath;
        if (filePathToRemove) {
            // Implement removeRecentFile(filePathToRemove)
            // And re-render the list
            console.log("Remove from recents:", filePathToRemove);
             let currentRecent = getRecentFiles();
             currentRecent = currentRecent.filter(p => p !== filePathToRemove);
             localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(currentRecent));
             renderFlowList(currentRecent);
        }
    }
    */
}

// --- [Modified Code] in app.js ---
function confirmDiscardChanges() {
    // --- CRITICAL: Check both dirty flags ---
    if (appState.isDirty || appState.stepEditorIsDirty) {
        if (!confirm("You have unsaved changes. Discard them and continue?")) {
            return false; // User canceled
        }
    }
    // User confirmed discard OR no changes existed
    console.log("Discarding or confirming no unsaved changes.");
    // Reset dirty states if confirmed or no changes needed discarding
    appState.isDirty = false;
    appState.stepEditorIsDirty = false;

    updateWorkspaceTitle(); // Update title immediately
    // Ensure save buttons reflect the now clean state
    setDirty(false); // Pass false to force update based on new clean state

    return true; // Confirmed or no changes
}

// --- MODIFIED FUNCTION ---
function handleSelectFlow(filePath) {
    // Loads a flow from the given file path
    if (appState.isLoading || !filePath) return;

    console.log(`Attempting to load flow from: ${filePath}`);

    if (!confirmDiscardChanges()) {
        return; // User cancelled discarding changes
    }

    // Proceed with loading
    appState.selectedStepId = null; // Reset step selection
    loadAndRenderFlow(filePath); // Call the refactored loading function

    // Update selection highlight in the recent files list (done within loadAndRenderFlow via addRecentFile)
    // renderFlowList(getRecentFiles()); // This is redundant if loadAndRenderFlow calls addRecentFile
}

// --- NEW EVENT LISTENER ---
async function handleOpenFile() {
    // Triggered by the "Open Flow" button
    if (appState.isLoading) return;
    if (!confirmDiscardChanges()) {
        return; // User cancelled discarding changes
    }

    console.log("Requesting open file dialog...");
    setLoading(true, 'global');
    clearMessages();

    try {
        if (!window.electronAPI) throw new Error("Electron API not available.");
        const result = await window.electronAPI.showOpenFile();

        if (result && result.success && !result.cancelled && result.filePath) {
            console.log("File selected:", result.filePath);
            // Load and render the selected file
            await loadAndRenderFlow(result.filePath);
            // Selection highlight updated within loadAndRenderFlow -> addRecentFile
        } else if (result && result.success && result.cancelled) {
            console.log("Open file dialog cancelled.");
        } else if (result && !result.success) {
             throw new Error(result.error || 'Failed to show open dialog.');
        } else {
            console.warn("Unexpected response from showOpenFile:", result);
             throw new Error('Received unexpected response when trying to open file.');
        }
    } catch (error) {
        console.error('Error opening file:', error);
        showMessage(`Error opening file: ${error.message}`, 'error');
        // Don't clear workspace on cancel, only on error
        if (error.message !== 'Open file dialog cancelled.') {
            clearWorkspace(true); // Clear workspace on actual error
        }
    } finally {
        setLoading(false, 'global');
    }
}


// --- MODIFIED FUNCTION ---
function handleCreateNewFlow() {
    if (appState.isLoading) return;

    if (!confirmDiscardChanges()) {
        return; // User cancelled discarding changes
    }

    console.log("Creating new flow...");
    clearWorkspace(false); // Clear workspace but keep titles etc. temporarily
    appState.currentFilePath = null; // No file path for new flow
    appState.selectedStepId = null;
    appState.currentFlowModel = createTemplateFlow();
    appState.stepEditorIsDirty = false; // Editor starts clean
    appState.isDirty = true; // New flow is dirty until saved

    renderCurrentFlow(); // Render the empty flow
    renderFlowList(getRecentFiles()); // Update recent list selection (none selected)
    updateWorkspaceTitle(); // Reflects new flow name and dirty state
    showMessage("New flow created. Edit and save.", "info");

    // Ensure controls are visible for the new flow
    if(domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
    if(domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
    if(domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = '';
    // Set dirty state which enables/disables save buttons
    setDirty(true); // Explicitly call setDirty to update buttons based on new state

    // Reset runner
    handleClearResults(); // <-- CORRECT: Clears results when creating a new flow
    updateRunnerUI();
}

// --- MODIFIED FUNCTION ---
async function handleCloneFlow() {
    // Clones the *current* flow in memory, marks as dirty, clears file path
    if (appState.isLoading || !appState.currentFlowModel) {
        showMessage("No flow loaded to clone.", "warning");
        return;
    }

    // No need to confirm discard for cloning, as we're cloning the current state.
    // If the current state IS dirty, the clone will also be dirty, which is correct.

    console.log("Cloning current flow in memory...");
    setLoading(true, 'global');
    clearMessages();

    try {
        // Deep clone the current model in memory using serialization
        const clonedModel = jsonToFlowModel(flowModelToJson(appState.currentFlowModel)); // Ensures clean copy

        // Ensure unique IDs in the cloned model!
        clonedModel.steps = assignNewIdsRecursive(clonedModel.steps);
        clonedModel.name = `Copy of ${clonedModel.name || 'Untitled Flow'}`;
        clonedModel.id = null; // Cloned flow doesn't have a persistent ID until saved

        // Update app state for the clone
        appState.currentFlowModel = clonedModel;
        appState.currentFilePath = null; // Clone needs to be saved to a new file
        appState.selectedStepId = null; // Reset selection
        appState.stepEditorIsDirty = false; // Editor starts clean for the clone
        appState.isDirty = true; // Clone is immediately dirty

        renderCurrentFlow(); // Render the cloned flow
        renderFlowList(getRecentFiles()); // Update recent list highlighting (no path = no highlight)
        updateWorkspaceTitle(); // Reflect clone name and dirty state
        showMessage(`Cloned flow "${appState.currentFlowModel.name}". Review and save as new file.`, "info");

        // Ensure controls are visible
        if(domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
        if(domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
        if(domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = '';
         // Set dirty state which enables/disables save buttons
        setDirty(true); // Explicitly call setDirty to update buttons based on new state

        handleClearResults(); // <-- CORRECT: Reset runner for the clone
        updateRunnerUI(); // Update runner based on cloned state
    } catch (error) {
        console.error('Error cloning flow:', error);
        showMessage(`Error preparing clone: ${error.message}`, 'error');
    } finally {
        setLoading(false, 'global');
    }
}

// Helper remains the same
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

// --- MODIFIED FUNCTION ---
// Functionality removed as file deletion is handled by the OS.
function handleDeleteFlow( /* flowId */ ) {
    // This function is no longer needed for local file management.
    // Deletion is handled by the user through the operating system's file explorer.
    // Associated UI buttons should be removed from the flow list item rendering.
    console.warn("handleDeleteFlow function called, but file deletion should be handled via OS.");
    showMessage("To delete a flow, please remove the corresponding '.flow.json' file using your file explorer.", "info");
}


// --- Workspace Logic ---

// --- MODIFIED FUNCTION ---
async function loadAndRenderFlow(filePath) {
    // Core function to load data from a file path and update the UI
    if (!filePath) {
        console.warn("loadAndRenderFlow called with no filePath.");
        return false;
    }
    setLoading(true, 'global');
    clearWorkspace(false); // Clear views but keep titles etc.
    clearMessages();
    let success = false;

    try {
         if (!window.electronAPI) throw new Error("Electron API not available.");
        console.log(`Reading file via IPC: ${filePath}`);
        const result = await window.electronAPI.readFile(filePath);

        if (result && result.success) {
            console.log(`File read success: ${filePath}`);
            const flowDataJson = result.data;
            try {
                // Attempt to parse the JSON content
                const flowData = JSON.parse(flowDataJson);
                appState.currentFlowModel = jsonToFlowModel(flowData); // Convert to internal model
                appState.currentFilePath = filePath; // Store the path of the loaded file
                appState.stepEditorIsDirty = false; // Reset editor dirty state on load
                appState.isDirty = false; // Not dirty initially

                renderCurrentFlow(); // Render the currently active view
                updateWorkspaceTitle(); // Reflects new flow name and path
                addRecentFile(filePath); // Add successfully loaded file to recents

                // Show controls now that flow is loaded
                if(domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
                if(domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
                if(domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = '';
                // Set dirty state which enables/disables save buttons
                setDirty(false); // Ensure buttons reflect clean state

                handleClearResults(); // <-- CORRECT: Clears results when a new flow is loaded
                updateRunnerUI(); // Update runner buttons based on loaded flow
                success = true;

            } catch (parseError) {
                 console.error(`Error parsing JSON from file ${filePath}:`, parseError);
                 throw new Error(`File is not valid JSON: ${parseError.message}`);
            }
        } else if (result && !result.success) {
             console.error(`Failed to read file via IPC: ${filePath}`, result.error);
             throw new Error(result.error || 'Failed to read file.');
        } else {
            console.warn("Unexpected response from readFile IPC:", result);
            throw new Error('Unexpected response when trying to read file.');
        }

    } catch (error) {
        console.error(`Error loading flow from ${filePath}:`, error);
        showMessage(`Error loading flow: ${error.message}`, 'error');
        clearWorkspace(true); // Clear fully on error
        appState.currentFilePath = null; // Clear path on error
        updateWorkspaceTitle(); // Reset title
        success = false;
    } finally {
        setLoading(false, 'global');
    }
    return success;
}

// renderCurrentFlow, updateDefinedVariables, _updateVariablesPanelUI, handleToggleView, updateViewToggle remain largely the same
// Ensure _updateVariablesPanelUI and updateDefinedVariables are called appropriately

function renderCurrentFlow() {
    if (!appState.currentFlowModel) {
        clearWorkspace(true); // Full clear if no model
        return;
    }
    updateDefinedVariables(); // Update defined variables cache

    if(domRefs.workspacePlaceholder) domRefs.workspacePlaceholder.style.display = 'none';
    if(domRefs.flowBuilderMount) domRefs.flowBuilderMount.classList.toggle('active', appState.currentView === 'list-editor');
    if(domRefs.flowVisualizerMount) domRefs.flowVisualizerMount.classList.toggle('active', appState.currentView === 'node-graph');
    if(domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
    if(domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
    if(domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = '';

    if (appState.currentView === 'list-editor') {
        if (!appState.builderComponent) {
            appState.builderComponent = new FlowBuilderComponent(
                domRefs.flowBuilderMount,
                domRefs.toggleVariablesBtn?.parentNode, // Pass parent of toggle button
                {
                    onFlowUpdate: handleBuilderFlowUpdate,
                    onHeadersUpdate: handleBuilderHeadersUpdate,
                    onFlowVarsUpdate: handleBuilderFlowVarsUpdate,
                    onStepSelect: handleBuilderStepSelect,
                    onStepUpdate: handleBuilderStepUpdate, // For structural changes (add, move, delete, clone)
                    onStepEdit: handleBuilderStepEdit, // For saving editor content
                    onRequestAddStep: handleBuilderRequestAddStep, // For top-level add button
                    onEditorDirtyChange: handleBuilderEditorDirtyChange, // Notify app of editor dirty status
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
    } else if (appState.currentView === 'node-graph') {
        // Render the Node-Graph View (FlowVisualizer)
        if (appState.visualizerComponent) {
            appState.visualizerComponent.render(appState.currentFlowModel, appState.selectedStepId);
        } else {
            console.error("Visualizer component not initialized!");
             // Attempt re-initialization if needed
             initializeVisualizer();
             if (appState.visualizerComponent) {
                appState.visualizerComponent.render(appState.currentFlowModel, appState.selectedStepId);
             }
        }
        // Update variables panel content (visualizer doesn't manage it directly)
        _updateVariablesPanelUI();
    }

    // Sync overlay/panel visibility state that's managed by app.js or builder
    syncPanelVisibility();
    // Update save button states after render might change dirty status indirectly
    setDirty(); // Call setDirty without args to re-evaluate based on current appState flags
}

// --- [Modified Code] in app.js ---
function clearWorkspace(fullClear = true) {
    // --- Component Cleanup ---
    if (appState.builderComponent) {
        try { // Add try-catch for safety
             if (typeof appState.builderComponent.destroy === 'function') {
                appState.builderComponent.destroy();
             }
             appState.builderComponent = null; // Nullify reference
        } catch (error) { console.error("Error destroying builder component:", error); }
    }
    if (appState.visualizerComponent) {
         try { // Add try-catch for safety
             if (typeof appState.visualizerComponent.clear === 'function') {
                 appState.visualizerComponent.clear(); // Prefer clear if exists
             } else if (typeof appState.visualizerComponent.destroy === 'function') {
                 appState.visualizerComponent.destroy();
                 // Only nullify if destroy completely removes it and requires re-init
                 // appState.visualizerComponent = null;
             } else {
                 // Fallback: manually clear its mount point if no clear/destroy
                 if (domRefs.flowVisualizerMount) domRefs.flowVisualizerMount.innerHTML = '';
             }
        } catch (error) { console.error("Error clearing/destroying visualizer component:", error); }
    }
   // ... (rest of DOM clearing and state reset remains same) ...

    // --- DOM Clearing ---
    if (domRefs.flowBuilderMount) {
        domRefs.flowBuilderMount.innerHTML = '';
        domRefs.flowBuilderMount.classList.remove('active');
    }
    // Don't clear innerHTML if visualizer instance persists and handles its own clearing, unless destroy failed above
    if (domRefs.flowVisualizerMount) {
        // domRefs.flowVisualizerMount.innerHTML = ''; // Only if visualizer failed to clear/destroy
        domRefs.flowVisualizerMount.classList.remove('active');
    }

    // --- UI Reset ---
    if (domRefs.workspacePlaceholder) domRefs.workspacePlaceholder.style.display = 'flex';
    if (domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = 'none';
    if (domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = 'none';
    if (domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = 'none';
    // Disable save buttons explicitly
    if (domRefs.saveFlowBtn) {
        domRefs.saveFlowBtn.disabled = true;
        domRefs.saveFlowBtn.classList.remove('needs-save');
    }
    if (domRefs.saveAsFlowBtn) domRefs.saveAsFlowBtn.disabled = true;

    if (domRefs.variablesPanel) domRefs.variablesPanel.classList.remove('visible');
    // Try to find info overlay robustly
    const infoOverlay = document.querySelector('[data-ref="infoOverlay"]');
    if (infoOverlay) infoOverlay.classList.remove('open');

    appState.isInfoOverlayOpen = false;
    appState.isVariablesPanelVisible = false;
    syncPanelVisibility(); // Update button text/icons

    // --- State Reset (if full clear requested) ---
    if (fullClear) {
       appState.currentFilePath = null; // Clear path
       appState.currentFlowModel = null;
       appState.selectedStepId = null;
       appState.isDirty = false;
       appState.stepEditorIsDirty = false;
       updateWorkspaceTitle(); // Reset title
       clearMessages(); // Clear any leftover messages
       handleClearResults(); // Clear runner results and state
       updateRunnerUI(); // Update runner button states
       appState.currentView = 'list-editor'; // Reset view to default
       updateViewToggle(); // Ensure toggle button reflects default state

        // Re-initialize visualizer instance if it was nullified or doesn't exist
        // It's generally better to keep the instance and use clear(), but if destroy was needed:
        // if (!appState.visualizerComponent && domRefs.flowVisualizerMount) {
        //     console.log("Re-initializing visualizer after full clear.");
        //     initializeVisualizer();
        // }
   }
   // Always ensure save buttons reflect the potentially cleaned state
   setDirty();
}


function updateDefinedVariables(runtimeContext = null) { // Accept optional runtime context
     if (appState.currentFlowModel) {
         // Pass runtime context to potentially find more dynamic variables (like loop items)
         appState.definedVariables = findDefinedVariables(appState.currentFlowModel, runtimeContext);
     } else {
         appState.definedVariables = {};
     }
     // Update variable panel UI regardless of which view is active
     _updateVariablesPanelUI();
     // Update variable dropdown if visible
     // TODO: Add logic to refresh dropdown content if open
}

// --- [Modified Code] in app.js ---
function _updateVariablesPanelUI() {
    const container = domRefs.variablesContainer;
    if (!container) return;
    container.innerHTML = ''; // Clear previous content

    // --- Check if data is available ---
    const variables = appState.definedVariables;
    if (!variables) { // Check for null/undefined
        container.innerHTML = `<div class="no-variables-message"><p>Variable information unavailable.</p></div>`;
        return;
    }
    if (Object.keys(variables).length === 0) {
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
    if (!appState.currentFlowModel || !domRefs.toggleViewBtn) {
        if(domRefs.toggleViewBtn) domRefs.toggleViewBtn.style.display = 'none';
        return;
    }
    domRefs.toggleViewBtn.style.display = ''; // Ensure visible if flow loaded
    if (appState.currentView === 'list-editor') {
        domRefs.toggleViewBtn.textContent = 'Visual View';
        domRefs.toggleViewBtn.title = 'Switch to Node-Graph View';
        // Ensure builder controls are visible if needed
        if(domRefs.toggleInfoBtn) domRefs.toggleInfoBtn.style.display = '';
        if(domRefs.toggleVariablesBtn) domRefs.toggleVariablesBtn.style.display = '';
    } else {
        domRefs.toggleViewBtn.textContent = 'Editor View';
        domRefs.toggleViewBtn.title = 'Switch to List/Editor View';
        // Hide builder-specific controls in visual view? Maybe not necessary.
         // domRefs.toggleInfoBtn.style.display = 'none';
         // domRefs.toggleVariablesBtn.style.display = 'none';
    }
}



// --- Saving Flow (Local Files) ---

// --- [Modified Code] in app.js ---
async function saveCurrentFlow(forceSaveAs = false) {
    if (!appState.currentFlowModel || appState.isLoading) {
        showMessage("No flow loaded or currently busy.", "warning");
        return false;
    }
    if (!window.electronAPI) {
        showMessage("Error: Cannot save file. Electron API not available.", "error");
        return false;
    }

    let editorCommitted = true; // Assume true unless proven otherwise
    // --- CRITICAL: Commit step editor changes if dirty ---
    if (appState.stepEditorIsDirty && appState.builderComponent && appState.currentView === 'list-editor') {
         console.log("Step editor is dirty. Attempting programmatic commit before flow save...");
         // We need to access the editor's save button, ideally via the builder component instance
         // Or by querying the DOM (less ideal but might be necessary)
         try {
              const editorMount = domRefs.flowBuilderMount?.querySelector('.step-editor-panel .step-editor'); // More specific search
              const saveBtn = editorMount?.querySelector('.step-editor-actions .btn-save-step');
              if (saveBtn && !saveBtn.disabled) {
                  saveBtn.click(); // Trigger the editor's save action

                  // --- VERIFICATION: Check if the editor is still dirty after the click ---
                  // The click should synchronously trigger handleBuilderStepEdit, which sets stepEditorIsDirty = false.
                  // If it's still true, the save likely failed validation or encountered an error.
                  if (appState.stepEditorIsDirty) {
                       // The editor's internal save logic might have failed (e.g., validation).
                       // The editor itself should show the specific error.
                       throw new Error("Unsaved changes in the step editor could not be committed. Please check the editor for errors.");
                  }
                  console.log("Step editor changes committed successfully.");

              } else if (saveBtn?.disabled) {
                   throw new Error("Unsaved changes in the step editor could not be committed (Save button is disabled). Please review the step configuration.");
              } else {
                   console.warn("Step editor is dirty, but save button not found. Cannot commit changes.");
                   // This indicates a potential UI structure issue or the editor wasn't rendered correctly.
                   throw new Error("Unsaved changes in the step editor could not be committed (UI Error).");
              }
         } catch (commitError) {
              console.error("Error committing step editor changes:", commitError);
              showMessage(`Cannot save flow: ${commitError.message}`, "error");
              editorCommitted = false;
              return false; // Prevent saving the flow if editor changes can't be committed.
         }
    }

    // --- Proceed with Flow Save only if editor committed successfully ---
    if (!editorCommitted) return false;

    clearMessages();
    const validation = validateFlow(appState.currentFlowModel);
    if (!validation.valid) {
        showValidationErrors(validation.errors);
        showMessage("Flow validation failed. Please fix the errors before saving.", "warning");
        return false;
    }

    setLoading(true, 'global');
    let savedSuccessfully = false;
    let targetFilePath = appState.currentFilePath;

    try {
        // --- Determine Save Path (forceSaveAs logic remains) ---
        if (!targetFilePath || forceSaveAs) {
            console.log("Requesting save file dialog (Save As)...");
            let suggestedName = (appState.currentFlowModel.name || 'untitled').replace(/[/\\?%*:|"<>]/g, '_');
            if (!suggestedName.toLowerCase().endsWith('.flow.json')) {
                suggestedName += '.flow.json';
            }

            const result = await window.electronAPI.showSaveFile(suggestedName);

            if (result?.success && !result.cancelled && result.filePath) {
                targetFilePath = result.filePath;
                if (!targetFilePath.toLowerCase().endsWith('.flow.json')) {
                    targetFilePath += '.flow.json';
                    console.log(`Appended extension, final path: ${targetFilePath}`);
                } else { console.log("Save As path selected:", targetFilePath); }
            } else if (result?.success && result.cancelled) {
                 console.log("Save As dialog cancelled.");
                 throw new Error("Save cancelled by user."); // Graceful exit
            } else {
                throw new Error(result?.error || 'Failed to show save dialog.');
            }
        }

        // --- Serialize and Write ---
        console.log(`Saving flow to: ${targetFilePath}`);
        // Use null replacer, 2 spaces for pretty printing
        const flowJsonString = JSON.stringify(flowModelToJson(appState.currentFlowModel), null, 2);

        const writeResult = await window.electronAPI.writeFile(targetFilePath, flowJsonString);

        if (writeResult?.success) {
            console.log("File write successful.");
            savedSuccessfully = true;
            showMessage(`Flow saved successfully to ${path.basename(targetFilePath)}!`, 'success');

            // Update state after successful save
            const previousFilePath = appState.currentFilePath;
            appState.currentFilePath = targetFilePath;
            appState.isDirty = false; // Reset flow dirty flag
            // stepEditorIsDirty should already be false from commit step, ensure it is.
            appState.stepEditorIsDirty = false;

            updateWorkspaceTitle(); // Update title (removes asterisk, shows new filename if Save As)
            addRecentFile(targetFilePath); // Update recent files list
            // If saved to a new file via Save As, update list selection highlights
            if (forceSaveAs || previousFilePath !== targetFilePath) {
                 renderFlowList(getRecentFiles());
            }
            setDirty(false); // Ensure save buttons are disabled

        } else {
            throw new Error(writeResult?.error || 'Failed to write file via IPC.');
        }

    } catch (error) {
        console.error('Save error:', error);
         if (error.message !== "Save cancelled by user.") {
             showMessage(`Save Failed: ${error.message}`, 'error');
         }
        savedSuccessfully = false;
        // DO NOT reset dirty flags if save failed
    } finally {
        setLoading(false, 'global');
         // Ensure buttons reflect current dirty state (might still be dirty if save failed)
         setDirty(); // Re-evaluate based on current appState flags
    }
    return savedSuccessfully;
}

// --- NEW EVENT LISTENER ---
async function handleSaveAs() {
    // Simply calls saveCurrentFlow forcing the Save As dialog
    await saveCurrentFlow(true);
}


// showValidationErrors remains the same
function showValidationErrors(errors) {
     if (!errors || !errors.length) return;
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

// --- Component Callbacks & Model Helpers ---
// handleBuilderFlowUpdate, handleBuilderHeadersUpdate, handleBuilderFlowVarsUpdate,
// handleBuilderStepEdit, handleVisualizerNodeMove, handleBuilderRequestAddStep, handleBuilderEditorDirtyChange,
// addNestedStepToModel, deleteStepFromModel, cloneStepInModel
// MOST REMAIN THE SAME LOGICALLY, but they now correctly set the appState.isDirty flag via setDirty()
// which is crucial for local saving. Ensure `setDirty(true)` is called in relevant places.
// findStepInfoRecursive, moveStepInModel, handleBuilderStepUpdate, handleBuilderStepSelect are explicitly replaced.

// Example modification within a callback:
function handleBuilderFlowUpdate({ name, description }) {
    if (appState.currentFlowModel) {
        const nameChanged = appState.currentFlowModel.name !== name;
        const descriptionChanged = appState.currentFlowModel.description !== description;

        if (nameChanged || descriptionChanged) { // --- MODIFIED: Check both ---
             if(nameChanged) appState.currentFlowModel.name = name;
             if(descriptionChanged) appState.currentFlowModel.description = description;
             appState.isDirty = true; // Mark flow as dirty due to metadata change
             setDirty(); // Update buttons/title based on new state
             updateWorkspaceTitle(); // Update title immediately
        }
    }
}
function handleBuilderHeadersUpdate(headers) {
    if (appState.currentFlowModel) {
        // Ensure comparison handles null/undefined consistently
        const currentHeaders = appState.currentFlowModel.headers || {};
        const newHeaders = headers || {};
        if (JSON.stringify(currentHeaders) !== JSON.stringify(newHeaders)) {
            appState.currentFlowModel.headers = newHeaders;
            appState.isDirty = true; // Mark flow as dirty due to header change
            setDirty(); // Update buttons/title based on new state
        }
    }
}
function handleBuilderFlowVarsUpdate(staticVars) {
     if (appState.currentFlowModel) {
        // Ensure comparison handles null/undefined consistently
        const currentVars = appState.currentFlowModel.staticVars || {};
        const newVars = staticVars || {};
        if (JSON.stringify(currentVars) !== JSON.stringify(newVars)) {
            appState.currentFlowModel.staticVars = newVars;
            appState.isDirty = true; // Mark flow as dirty due to static var change
            setDirty(); // Update buttons/title based on new state
            updateDefinedVariables();
        }
    }
}

// --- [Modified Code] in app.js ---
function handleBuilderStepSelect(stepId) {
    if (appState.selectedStepId === stepId) return; // Ignore clicks on already selected step

    // --- CRITICAL: Check for unsaved changes in the *current* editor before switching ---
     if (appState.stepEditorIsDirty) {
         if (!confirm("You have unsaved changes in the current step editor. Discard changes and select the new step?")) {
             // User canceled, prevent the state change and re-render
             // This ensures the builder component doesn't visually switch selection if the state change was prevented.
             // It might be necessary if the component tries to optimistically update UI on click.
             // renderCurrentFlow(); // Optional: Force re-render to ensure UI matches state
             return;
         }
         // User confirmed discard, reset the flag before switching
         console.log("Discarding step editor changes due to step selection change.");
         appState.stepEditorIsDirty = false;
         setDirty(); // Recalculate overall dirty (might become clean if only editor was dirty)
     }

    appState.selectedStepId = stepId;
    console.log("Step selected:", stepId);
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
                 // Only create new step object if children actually changed
                 if (newThen !== step.thenSteps || newElse !== step.elseSteps) {
                     return { ...step, thenSteps: newThen, elseSteps: newElse };
                 }
            } else if (step.type === 'loop') {
                 const newLoop = updateRecursively(step.loopSteps);
                 if (newLoop !== step.loopSteps) {
                     return { ...step, loopSteps: newLoop };
                 }
            }
            return step; // Return original step object if no changes within it
        });
    };

    const originalStepsJson = JSON.stringify(appState.currentFlowModel.steps);
    const newSteps = updateRecursively(appState.currentFlowModel.steps);

    if (foundAndUpdated) {
        // Check if the overall steps array actually changed
        if (JSON.stringify(newSteps) !== originalStepsJson) {
             appState.currentFlowModel.steps = newSteps;
             appState.isDirty = true; // Mark overall flow as dirty because a step was modified
        }
        // Editor is no longer dirty after its save action completed successfully
        appState.stepEditorIsDirty = false;
        setDirty(); // Recalculate overall dirty state and update UI
        renderCurrentFlow(); // Re-render the current view to reflect changes in list/visualizer
    } else {
        console.warn(`Could not find step with ID ${updatedStepData.id} to apply edits.`);
        // If step not found, editor state remains unchanged (likely still dirty)
        // No need to call setDirty here as it didn't change from true.
    }
}

// --- [Modified Code] in app.js ---
function handleBuilderStepUpdate(action) {
     if (!appState.currentFlowModel) return;

     let modelChanged = false;
     let newSelectedStepId = appState.selectedStepId;
     let errorMessage = null; // Track potential errors

     appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];

     try { // Wrap the core logic
         switch (action.type) {
             case 'add': // Add step within condition/loop or visually
                 modelChanged = addNestedStepToModel(action.step, action.parentId, action.branch);
                 if (modelChanged) {
                     newSelectedStepId = action.step.id; // Select the newly added step
                     showMessage(`Step "${action.step.name}" added.`, 'success');
                 } else {
                      errorMessage = `Failed to add step "${action.step.name}". Parent or branch invalid?`;
                 }
                 break;
             case 'move': // Move step in list or visualizer
                 modelChanged = moveStepInModel(action.sourceStepId, action.targetStepId, action.position);
                 if (modelChanged) {
                     newSelectedStepId = action.sourceStepId; // Keep selection on the moved step
                     // Don't show message for every drag, can be noisy
                 } else {
                      // moveStepInModel shows its own error message via showMessage
                      errorMessage = null; // Prevent duplicate message
                 }
                 break;
             case 'delete':
                 const stepToDelete = findStepById(appState.currentFlowModel.steps, action.stepId);
                 const stepName = stepToDelete ? stepToDelete.name : `step ${action.stepId}`;
                 // --- CRITICAL: Add confirmation before deletion ---
                 if (confirm(`Are you sure you want to delete step "${escapeHTML(stepName)}"? This cannot be undone and includes any nested steps.`)) {
                     modelChanged = deleteStepFromModel(action.stepId);
                     if (modelChanged) {
                         if (appState.selectedStepId === action.stepId) {
                             newSelectedStepId = null; // Deselect if deleted step was selected
                         }
                         showMessage(`Step "${stepName}" deleted.`, 'success');
                     } else {
                          errorMessage = `Failed to delete step "${stepName}". Step not found?`;
                     }
                 } else {
                     // User cancelled deletion
                     modelChanged = false;
                 }
                 break;
             case 'clone': // Clone step from list/visualizer
                  if (!action.originalStep || !action.newStep) {
                      errorMessage = "Clone action missing required step data.";
                      break;
                  }
                  modelChanged = cloneStepInModel(action.originalStep, action.newStep);
                  if (modelChanged) {
                      newSelectedStepId = action.newStep.id; // Select the clone
                      showMessage(`Step "${action.originalStep.name}" cloned.`, 'success');
                  } else {
                       errorMessage = `Failed to clone step "${action.originalStep.name}". Original not found?`;
                  }
                 break;
             default:
                 console.warn("Unknown step update action received:", action.type);
         }
     } catch (error) {
          console.error(`Error processing step update action (${action.type}):`, error);
          errorMessage = `An unexpected error occurred during the ${action.type} operation: ${error.message}`;
          modelChanged = false; // Ensure model isn't considered changed on error
     }


     if (modelChanged) {
         appState.isDirty = true; // Mark flow as dirty on successful structural changes
         setDirty(); // Update buttons/title
         appState.selectedStepId = newSelectedStepId;
         updateDefinedVariables(); // Recalculate variables after structural change
         renderCurrentFlow(); // Re-render the current view
     } else if (errorMessage) {
         showMessage(errorMessage, 'error'); // Show error if model didn't change due to error
         // Optionally re-render to reset potential intermediate UI states (e.g., drag placeholder)
         // renderCurrentFlow();
     } else {
          // Model didn't change (e.g., cancelled delete, duplicate move), no need to re-render unless UI state needs reset
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

// --- [New Code] in app.js ---
/**
 * Handles the node position update callback from the FlowVisualizer.
 * Updates the flow model's visualLayout and marks the flow as dirty.
 * @param {string} stepId - The ID of the node that was moved.
 * @param {number} x - The final X coordinate relative to the canvas.
 * @param {number} y - The final Y coordinate relative to the canvas.
 */
function handleVisualizerNodeLayoutUpdate(stepId, x, y) {
    if (!appState.currentFlowModel || !stepId) return;

    appState.currentFlowModel.visualLayout = appState.currentFlowModel.visualLayout || {};
    const currentPos = appState.currentFlowModel.visualLayout[stepId];

    // Update only if position actually changed to avoid unnecessary dirty state/renders
    if (!currentPos || currentPos.x !== x || currentPos.y !== y) {
        console.log(`[App] Updating visual layout for ${stepId}:`, { x, y });
        appState.currentFlowModel.visualLayout[stepId] = { x, y };
        appState.isDirty = true; // Mark flow as dirty due to layout change
        setDirty(); // Update buttons/title

        // Optional: Trigger a limited re-render if possible, otherwise full re-render
        // Full re-render ensures connectors update immediately based on the new position in the model.
        // The visual node itself is already in place from the drag.
        // renderCurrentFlow(); // Uncomment if connector updates are desired immediately, accepting potential flicker.
        // If renderCurrentFlow IS called, ensure the visualizer's render logic correctly uses
        // the updated visualLayout from the model passed to it.
    }
}


function handleBuilderRequestAddStep() {
    // Called when the top-level "+ Add Step" button in the builder list view is clicked
    showAppStepTypeDialog(type => {
        if (type) {
            const newStep = createNewStep(type);
            appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];
            appState.currentFlowModel.steps.push(newStep);
            appState.selectedStepId = newStep.id; // Select the new step
            appState.isDirty = true; // Mark flow as dirty due to structure change
            setDirty(); // Update buttons/title
            renderCurrentFlow(); // Re-render to show the new step
        }
    });
}

function handleBuilderEditorDirtyChange(isEditorDirty) {
    // Called by builder when the step editor's dirty state changes
    if (appState.stepEditorIsDirty !== isEditorDirty) {
         appState.stepEditorIsDirty = isEditorDirty;
         setDirty(); // Recalculate overall dirty state and update UI
    }
}

// --- Model Manipulation Helpers (Implementations remain the same logic) ---

function addNestedStepToModel(stepData, parentId, branch) {
    if (!parentId || !stepData) return false;
    const parentStep = findStepById(appState.currentFlowModel?.steps, parentId); // Use optional chaining
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
    // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
    return added;
}

// --- [Modified Code] in app.js ---
// Finds step info including the parent array and index (crucial for modification)
function findStepInfoRecursive(steps, idToFind, currentParentSteps = null, path = []) {
    // Ensure appState.currentFlowModel exists before accessing steps
    const rootSteps = appState.currentFlowModel?.steps;
    if (!steps || !rootSteps) return null; // Check model exists

    const parentArray = currentParentSteps || rootSteps; // Default to top-level

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        // Store path info: parent array ref, index in parent, step id, and optionally branch info if applicable
        const currentPathSegment = { parentSteps: parentArray, index: i, stepId: step.id };
        const currentFullPath = [...path, currentPathSegment];

        if (step.id === idToFind) {
            return { step: step, parentSteps: parentArray, index: i, path: currentFullPath };
        }

        let found = null;
        if (step.type === 'condition') {
            // Add branch info to path for children
            found = findStepInfoRecursive(step.thenSteps, idToFind, step.thenSteps, [...currentFullPath, { stepId: step.id, branch: 'then' }]);
            if (found) return found;
            found = findStepInfoRecursive(step.elseSteps, idToFind, step.elseSteps, [...currentFullPath, { stepId: step.id, branch: 'else' }]);
            if (found) return found;
        } else if (step.type === 'loop') {
            // Add loop info to path for children
            found = findStepInfoRecursive(step.loopSteps, idToFind, step.loopSteps, [...currentFullPath, { stepId: step.id, branch: 'loop' }]);
            if (found) return found;
        }
    }
    return null;
}

// --- [Modified Code] in app.js ---
function moveStepInModel(sourceId, targetId, position) {
    if (!appState.currentFlowModel?.steps) return false; // Ensure model and steps exist

    try { // Add error handling block
        const sourceInfo = findStepInfoRecursive(appState.currentFlowModel.steps, sourceId);
        const targetInfo = findStepInfoRecursive(appState.currentFlowModel.steps, targetId);

        // --- Validation ---
        if (!sourceInfo) {
            throw new Error(`Move failed: Source step (ID: ${sourceId}) not found.`);
        }
        if (!targetInfo) {
             throw new Error(`Move failed: Target step (ID: ${targetId}) not found.`);
        }
        if (sourceId === targetId) {
            console.warn("Move ignored: Source and target are the same.");
            return false; // Cannot move onto itself
        }

        // --- Edge Case: Prevent dropping a parent into its own child branch/loop ---
        // Check if the target's path contains the source step's ID
        let isTargetInChildren = false;
        // Iterate through the path segments leading to the target. Each segment includes the stepId of its container.
        for (const pathSegment of targetInfo.path) {
            // Check if the container step's ID matches the source ID (excluding the target step itself)
             if (pathSegment.stepId === sourceId && targetInfo.step.id !== sourceId) { // If the source is one of the containers for the target
                isTargetInChildren = true;
                break;
            }
        }
        if (isTargetInChildren) {
            throw new Error("Invalid move: Cannot move a step into itself or one of its children.");
        }

        // --- Perform the move ---
        // 1. Remove source step
        const [sourceStep] = sourceInfo.parentSteps.splice(sourceInfo.index, 1);
        if (!sourceStep) {
             // This should be unlikely if sourceInfo was valid, but check for safety
            throw new Error("Move failed: Could not splice source step after finding it.");
        }

        // 2. Find target index AGAIN (indices might have shifted after removal)
        //    Important: Must search from the root again using the *same targetId*.
        const newTargetInfo = findStepInfoRecursive(appState.currentFlowModel.steps, targetId);

        if (!newTargetInfo) {
            // This can happen if the target was immediately after the source in the same array.
            // We need to figure out the correct insertion point based on the original target's parent.
            console.warn("Move adjustment: Target info shifted after source removal.");

            // Insert into the original target's parent array (targetInfo.parentSteps refers to the correct array *after* source splice).
            // If position was 'before' the target, insert at source's original index.
            // If position was 'after' the target, insert at source's original index (effect is still after the item that *was* before target).
            // This logic assumes drop target remains valid even if its index shifts.
            // The correct index in the original parent *after* removing source is just sourceInfo.index.
            const insertIndex = sourceInfo.index;
            targetInfo.parentSteps.splice(insertIndex, 0, sourceStep); // Use original target parent ref
            console.log(`Inserting ${sourceStep.id} into original parent at index ${insertIndex} (adjusted)`);

        } else {
             // Target still exists and was found again. Use its new info.
            // 3. Calculate insertion index within the target's NEW parent array
             const insertIndex = position === 'before' ? newTargetInfo.index : newTargetInfo.index + 1;

            // 4. Insert source step into the target's NEW parent array at the calculated index
            newTargetInfo.parentSteps.splice(insertIndex, 0, sourceStep);
            console.log(`Inserting ${sourceStep.id} into new target parent at index ${insertIndex}`);
        }

        // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
        return true;

    } catch (error) {
        console.error('Error moving step in model:', error);
        showMessage(`Error moving step: ${error.message}`, 'error'); // Show user-facing error
        // Consider reverting UI or model state if partial changes occurred, but complex.
        // For now, log and show message. Re-rendering might fix UI inconsistency.
        return false;
    }
}


function deleteStepFromModel(stepId) {
    if (!appState.currentFlowModel?.steps) return false; // Ensure model and steps exist

    let deleted = false;
    const deleteRecursively = (steps) => {
        if (!steps || !Array.isArray(steps)) return null; // Return null for empty/invalid

        const filteredSteps = [];
        let changed = false; // Track changes at this level

        for (const step of steps) {
            if (step.id === stepId) {
                deleted = true;
                changed = true; // Mark change as we are skipping this step
                continue; // Skip this step
            }

            let currentStep = step; // Start with the original step
            if (step.type === 'condition') {
                const originalThen = step.thenSteps;
                const originalElse = step.elseSteps;
                const newThen = deleteRecursively(step.thenSteps);
                const newElse = deleteRecursively(step.elseSteps);
                // Create new step object only if children changed
                if (newThen !== originalThen || newElse !== originalElse) {
                    currentStep = { ...step, thenSteps: newThen || [], elseSteps: newElse || [] }; // Ensure arrays if null
                    changed = true; // Mark change as children were modified
                }
            } else if (step.type === 'loop') {
                 const originalLoop = step.loopSteps;
                 const newLoopSteps = deleteRecursively(step.loopSteps);
                 if (newLoopSteps !== originalLoop) {
                     currentStep = { ...step, loopSteps: newLoopSteps || [] }; // Ensure array if null
                     changed = true; // Mark change as children were modified
                 }
            }
             filteredSteps.push(currentStep); // Add the (potentially updated) step
        }

        // Return the original array if no changes were made at this level
         return changed ? filteredSteps : steps;
    };

    const originalSteps = appState.currentFlowModel.steps;
    const newSteps = deleteRecursively(originalSteps);

    // Update the model only if changes occurred
    if (newSteps !== originalSteps) {
         appState.currentFlowModel.steps = newSteps || []; // Ensure steps array exists even if all deleted
    }

    if (!deleted) {
        console.warn(`Delete step: Step with ID ${stepId} not found.`);
    }
    // Return true if the step was found and deleted
    // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
    return deleted;
}

function cloneStepInModel(originalStepRef, newStepData) {
     if (!originalStepRef || !newStepData || !appState.currentFlowModel?.steps) return false;

     let inserted = false;
     const findAndInsertAfter = (steps) => {
         if (!steps || !Array.isArray(steps) || inserted) return steps; // Stop recursing if already inserted

         const resultSteps = [];
         let changed = false; // Track changes at this level

         for (let i = 0; i < steps.length; i++) {
             let currentStep = steps[i];
             resultSteps.push(currentStep); // Add original step first

             if (currentStep.id === originalStepRef.id) {
                 resultSteps.push(newStepData); // Insert clone immediately after original
                 inserted = true;
                 changed = true; // Mark change as we inserted
             } else if (!inserted) { // Only recurse if not yet inserted
                 if (currentStep.type === 'condition') {
                     const originalThen = currentStep.thenSteps;
                     const originalElse = currentStep.elseSteps;
                     const newThen = findAndInsertAfter(originalThen);
                     // Stop recursing into else if already inserted in then
                     const newElse = inserted ? originalElse : findAndInsertAfter(originalElse);
                     if (newThen !== originalThen || newElse !== originalElse) {
                          // Recreate step object if children changed
                          currentStep = { ...currentStep, thenSteps: newThen || [], elseSteps: newElse || [] }; // Ensure arrays
                          // Update the step in resultSteps array *in place* (it was already pushed)
                          resultSteps[resultSteps.length - 1] = currentStep;
                          changed = true;
                     }
                 } else if (currentStep.type === 'loop') {
                      const originalLoop = currentStep.loopSteps;
                      const newLoopSteps = findAndInsertAfter(originalLoop);
                      if (newLoopSteps !== originalLoop) {
                          currentStep = { ...currentStep, loopSteps: newLoopSteps || [] }; // Ensure array
                           resultSteps[resultSteps.length - 1] = currentStep;
                          changed = true;
                      }
                 }
             }
         }
         return changed ? resultSteps : steps; // Return new array only if changed
     };

     const originalSteps = appState.currentFlowModel.steps;
     const newSteps = findAndInsertAfter(originalSteps);

     if (newSteps !== originalSteps) {
        appState.currentFlowModel.steps = newSteps;
     }

     if (!inserted) {
         console.warn(`Clone step: Original step ID ${originalStepRef.id} not found.`);
     }
     // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
     return inserted;
}


// --- Workspace UI Controls ---

// --- [Modified Code] --- in handleToggleInfoOverlay
function handleToggleInfoOverlay() {
    // The builder manages the overlay visibility internally, BUT we need to enforce exclusivity here.
    // Get the potential state *before* toggling.
    let willBeOpen = !appState.isInfoOverlayOpen;

    // If we are attempting to OPEN the info overlay, CLOSE the variables panel first.
    if (willBeOpen && appState.isVariablesPanelVisible) {
        console.log("Closing variables panel due to info overlay opening.");
        if (domRefs.variablesPanel) domRefs.variablesPanel.classList.remove('visible');
        appState.isVariablesPanelVisible = false;
        // No need to call syncPanelVisibility yet, it will be called after info toggle.
    }

    // Now, toggle the info overlay (either via builder or manually)
    if (appState.builderComponent && appState.currentView === 'list-editor') {
       // Assuming builderComponent.toggleInfoOverlay(state) sets the state and returns it
       // If it only toggles, we might need to manage the state manually after calling toggle()
       // Let's assume it accepts the desired state for now.
        try {
            // Check if the method exists before calling
            if (typeof appState.builderComponent.toggleInfoOverlay === 'function') {
                appState.isInfoOverlayOpen = appState.builderComponent.toggleInfoOverlay(willBeOpen); // Pass desired state
            } else {
                 console.warn("Builder component does not have a toggleInfoOverlay method. Falling back to manual DOM toggle.");
                 // Fallback to manual toggle if builder doesn't manage it or method unavailable
                 const infoOverlay = document.querySelector('[data-ref="infoOverlay"]');
                 if (infoOverlay) {
                     infoOverlay.classList.toggle('open', willBeOpen);
                     appState.isInfoOverlayOpen = willBeOpen;
                 }
            }
        } catch (error) {
             console.error("Error calling builderComponent.toggleInfoOverlay:", error);
             // Fallback to manual toggle on error
             const infoOverlay = document.querySelector('[data-ref="infoOverlay"]');
             if (infoOverlay) {
                 infoOverlay.classList.toggle('open', willBeOpen);
                 appState.isInfoOverlayOpen = willBeOpen;
             }
        }
    } else {
        // Manual toggle if builder isn't active or doesn't manage it
        const infoOverlay = document.querySelector('[data-ref="infoOverlay"]');
        if (infoOverlay) {
            infoOverlay.classList.toggle('open', willBeOpen);
            appState.isInfoOverlayOpen = willBeOpen;
        }
    }
    // Sync button states *after* both panels have potentially changed
    syncPanelVisibility();
}

// --- [Modified Code] --- in handleToggleVariablesPanel
function handleToggleVariablesPanel() {
     if (!domRefs.variablesPanel) return;

     // Determine the state we are moving TO
     const willBeVisible = !domRefs.variablesPanel.classList.contains('visible');

     // If we are attempting to OPEN the variables panel, CLOSE the info overlay first.
     if (willBeVisible && appState.isInfoOverlayOpen) {
         console.log("Closing info overlay due to variables panel opening.");
         let closedInfo = false;
          if (appState.builderComponent && appState.currentView === 'list-editor') {
             // Attempt to close via builder component
             // Assuming toggleInfoOverlay(false) forces close and returns false
             try {
                 if (typeof appState.builderComponent.toggleInfoOverlay === 'function') {
                     appState.isInfoOverlayOpen = appState.builderComponent.toggleInfoOverlay(false); // Request close
                     closedInfo = !appState.isInfoOverlayOpen;
                 } else {
                      console.warn("Builder component does not have a toggleInfoOverlay method. Falling back to manual DOM toggle.");
                      // Fallback to manual DOM manipulation if builder method isn't ideal/available
                      const infoOverlay = document.querySelector('[data-ref="infoOverlay"]');
                      if (infoOverlay) {
                          infoOverlay.classList.remove('open');
                          appState.isInfoOverlayOpen = false;
                          closedInfo = true;
                      }
                 }
             } catch (error) {
                  console.error("Error calling builderComponent.toggleInfoOverlay:", error);
                  // Fallback to manual DOM manipulation on error
                  const infoOverlay = document.querySelector('[data-ref="infoOverlay"]');
                  if (infoOverlay) {
                      infoOverlay.classList.remove('open');
                      appState.isInfoOverlayOpen = false;
                      closedInfo = true;
                  }
             }
          } else {
              // Manual close if builder isn't active/managing
              const infoOverlay = document.querySelector('[data-ref="infoOverlay"]');
              if (infoOverlay) {
                  infoOverlay.classList.remove('open');
                  appState.isInfoOverlayOpen = false;
                  closedInfo = true;
              }
          }
          if (!closedInfo) { console.warn("Could not ensure info overlay was closed."); }
     }

     // Now toggle the variables panel state
     appState.isVariablesPanelVisible = willBeVisible;
     domRefs.variablesPanel.classList.toggle('visible', appState.isVariablesPanelVisible);

     // Sync button states *after* both panels have potentially changed
     syncPanelVisibility();
}

// --- [Modified Code] --- in syncPanelVisibility
function syncPanelVisibility() {
     // Sync Info Button Text/State
     if(domRefs.toggleInfoBtn) {
        domRefs.toggleInfoBtn.textContent = appState.isInfoOverlayOpen ? 'Info ▲' : 'Info ▼';
        // Optional: Add an 'active' class if open
        domRefs.toggleInfoBtn.classList.toggle('active', appState.isInfoOverlayOpen);
     }

     // Sync Variables Button Text/Icon/State
     const varBtn = domRefs.toggleVariablesBtn;
     if(varBtn) {
         const icon = varBtn.querySelector('.toggle-icon');
         const textSpan = varBtn.querySelector('.btn-text');
         // Update Icon
         if(icon) icon.textContent = appState.isVariablesPanelVisible ? '▲' : '▼'; // Note: Icon points UP when panel is VISIBLE (like closing it)
         // Update Text
         if(textSpan) textSpan.textContent = appState.isVariablesPanelVisible ? ' Hide Variables' : ' Show Variables';
          // Fallback if spans don't exist
         else {
             // Construct text content manually if spans are missing
             varBtn.textContent = ''; // Clear existing
             const iconNode = document.createTextNode(appState.isVariablesPanelVisible ? '▲' : '▼');
             const textNode = document.createTextNode(appState.isVariablesPanelVisible ? ' Hide Variables' : ' Show Variables');
             varBtn.appendChild(iconNode);
             varBtn.appendChild(document.createTextNode(' ')); // Add space
             varBtn.appendChild(textNode);
         }
          // Optional: Add an 'active' class if open
         varBtn.classList.toggle('active', appState.isVariablesPanelVisible);
     }
}


// --- Runner Panel Logic & Callbacks ---
// getRequestDelay, updateRunnerUI, handleDelayChange,
// handleStepFlow, handleStopFlow,
// ALL REMAIN THE SAME LOGICALLY.
// Callbacks (handleRunnerStepStart, etc.) are modified below for highlighting.
// handleRunFlow is modified below

function getRequestDelay() {
    if (!domRefs.requestDelayInput) return DEFAULT_REQUEST_DELAY;
    const delayValue = parseInt(domRefs.requestDelayInput.value, 10);
    return isNaN(delayValue) || delayValue < 0 ? 0 : delayValue;
}

function updateRunnerUI() {
    const flowLoaded = !!appState.currentFlowModel;
    const isRunning = appState.runner?.isRunning() || false;
    const isStepping = appState.runner?.isStepping() || false; // Check if runner is in stepping mode
    // const canStepInto = appState.runner?.canStepInto() || false; // Check if current step allows step-into

    if(domRefs.runFlowBtn) domRefs.runFlowBtn.disabled = !flowLoaded || isRunning || isStepping || appState.isLoading;
    if(domRefs.stepFlowBtn) domRefs.stepFlowBtn.disabled = !flowLoaded || isRunning || isStepping || appState.isLoading;
    if(domRefs.stepIntoFlowBtn) {
        // domRefs.stepIntoFlowBtn.disabled = !flowLoaded || isRunning || isStepping || !canStepInto || appState.isLoading;
        domRefs.stepIntoFlowBtn.style.display = 'none'; // Hide until properly implemented
    }
    if(domRefs.stopFlowBtn) domRefs.stopFlowBtn.disabled = (!isRunning && !isStepping) || appState.isLoading;
    if(domRefs.requestDelayInput) domRefs.requestDelayInput.disabled = isRunning || isStepping || appState.isLoading;
    if(domRefs.clearResultsBtn) domRefs.clearResultsBtn.disabled = isRunning || isStepping || appState.isLoading;
}

function handleDelayChange() {
    if (appState.runner) {
        appState.runner.setDelay(getRequestDelay());
    }
}

// --- [New Code] Helper function in app.js ---
function clearListViewHighlights() {
    // ... implementation remains the same ...
    if (!domRefs.flowBuilderMount) return;
    try {
        domRefs.flowBuilderMount.querySelectorAll('.flow-step.step-running, .flow-step.step-success, .flow-step.step-error, .flow-step.step-stopped, .flow-step.step-skipped')
            .forEach(el => {
                el.classList.remove('step-running', 'step-success', 'step-error', 'step-stopped', 'step-skipped');
            });
    } catch (error) {
        console.error("Error clearing list view highlights:", error);
    }
}

// --- [New Code] Helper function in app.js ---
function highlightStepInList(stepId, statusClass) {
    // --- MODIFICATION START: Check for system IDs ---
    // Checks if the ID contains common patterns for system-generated results/markers
    // Regex looks for common suffixes like -result, -start, -end, or -iter- followed by digits at the end.
    if (!stepId || /-(result|start|end|iter-\d+)$/i.test(stepId)) { // Added case-insensitive flag 'i' just in case
        // Optional: Log that highlighting is being skipped for a system step
        // console.log(`[Highlight List] Skipping system step ID: ${stepId}`);
        return; // Don't try to highlight system steps in the list view DOM
    }
    // --- MODIFICATION END ---

    // Original checks for required elements and class
    if (!domRefs.flowBuilderMount || !statusClass) return;

    try {
        // Find the specific step element using the data-step-id attribute
        // Ensure attribute selector value is properly quoted if needed, though usually not necessary for simple IDs.
        const stepElement = domRefs.flowBuilderMount.querySelector(`.flow-step[data-step-id="${stepId}"]`);

        if (stepElement) {
            // Remove other potential status classes first to ensure only one is active
            stepElement.classList.remove('step-running', 'step-success', 'step-error', 'step-stopped', 'step-skipped');
            // Add the new status class
            stepElement.classList.add(statusClass);

            // --- Scrolling into view ---
            try {
                // Attempt smooth scroll first
                stepElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            } catch (scrollError) {
                // Fallback to instant scroll if smooth scroll fails or is not supported
                // console.warn(`Smooth scroll failed for step ${stepId}, using instant scroll. Error:`, scrollError);
                 try {
                    stepElement.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
                 } catch (fallbackScrollError) {
                     // Log if even instant scroll fails (less likely)
                     console.error(`Instant scroll fallback also failed for step ${stepId}:`, fallbackScrollError);
                 }
            }
        } else {
             // Log a warning if a non-system step ID wasn't found in the DOM
             console.warn(`[Highlight List] Step element not found in DOM for ID: ${stepId}`);
        }
    } catch (error) {
        // Catch any unexpected errors during DOM manipulation
        console.error(`Error highlighting step ${stepId} in list view:`, error);
    }
}

// --- [Modified Code] in app.js ---
function handleClearResults() {
    appState.executionResults = [];
    if(domRefs.runnerResultsList) domRefs.runnerResultsList.innerHTML = '<li class="no-results">Run a flow to see results here.</li>';
    if (appState.runner) {
        // Reset runner state, passing current static vars as initial context
        appState.runner.reset(appState.currentFlowModel?.staticVars || {});
    }
     // --- Clear visualizer/list highlights ---
     if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights();
     clearListViewHighlights(); // --- ADDED ---
    updateRunnerUI();
}

// --- [Modified Code] in app.js ---
async function handleRunFlow() {
    if (!appState.currentFlowModel || !appState.runner || appState.runner.isRunning() || appState.runner.isStepping()) return;

    // handleClearResults(); // <-- REMOVED: Do not clear results automatically on every run. Clear only on context change or explicit button press.
    // Clear highlights from previous runs before starting a new one
    if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights();
    clearListViewHighlights();

    updateRunnerUI(); // Disable buttons
    showMessage("Flow execution started...", "info", domRefs.runnerResultsList); // <-- Indicate start in results panel

    try {
        // Runner reset now happens internally within run or via handleClearResults when context changes.
        // It should use the flow's static vars as initial context.
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

// --- [No Code Change Required - Verification] in app.js ---
// Logic in handleStepFlow already correctly implements Feature 1 requirement
async function handleStepFlow() {
     if (!appState.currentFlowModel || !appState.runner || appState.runner.isRunning() || appState.runner.isStepping()) return;

     if (appState.runner.isStartOfFlow()) { // <-- This condition correctly handles clearing only on the FIRST step
         handleClearResults(); // Clear results and highlights only on the very first step
         showMessage("Starting step-by-step execution...", "info", domRefs.runnerResultsList);
     } else {
         // If not the first step, just clear previous "running" highlights before the next step
         if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights('active-step'); // Clear only active step highlight
         clearListViewHighlights(); // Clear all previous list highlights? Or maybe just running? Let's clear all for simplicity for now.
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

// --- [Modified Code] in app.js ---
function handleRunnerStepStart(step, executionPath) {
    const resultIndex = addResultEntry(step, 'running', executionPath); // Add placeholder
    // Highlight step in the active view
    if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
        appState.visualizerComponent.highlightNode(step.id, 'active-step'); // Use 'active-step' for running in visualizer
    } else if (appState.currentView === 'list-editor') {
         highlightStepInList(step.id, 'step-running'); // --- UPDATED ---
    }
    return resultIndex;
}

// --- [Modified Code] in app.js ---
function handleRunnerStepComplete(resultIndex, step, result, context, executionPath) {
    // --- MODIFICATION START: Pass extraction failures ---
    updateResultEntry(resultIndex, result.status, result.output, result.error, result.extractionFailures || []);
    // --- MODIFICATION END ---
    updateDefinedVariables(context); // Pass runtime context for dynamic variable finding
    // _updateVariablesPanelUI(); // Update UI based on possibly changed variables - Called within updateDefinedVariables

    // Update highlighting based on final status
    const highlightClass = result.status === 'success' ? 'success'
                         : result.status === 'error' ? 'error'
                         : result.status === 'skipped' ? 'skipped'
                         : 'stopped'; // Map status to class

     if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
         appState.visualizerComponent.highlightNode(step.id, highlightClass); // Use status for visualizer class

         // Call visualizer to update runtime info (passing full result object)
         if (step.type === 'request') {
             try {
                  // Pass the full result, which now includes extractionFailures
                  appState.visualizerComponent.updateNodeRuntimeInfo(step.id, result);
             } catch (visError) {
                  console.error(`Error calling visualizer.updateNodeRuntimeInfo for step ${step.id}:`, visError);
             }
         }

     } else if (appState.currentView === 'list-editor') {
         highlightStepInList(step.id, `step-${highlightClass}`);
     }
     updateRunnerUI(); // Re-enable buttons if stepping
}

function handleRunnerFlowComplete(finalContext, results) {
    showMessage("Flow execution finished.", "success", domRefs.runnerResultsList);
    updateRunnerUI();
     // Optionally clear active highlights or leave final states shown
     // if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights('active-step'); // Clear only running highlight
     // clearListViewHighlights(); // Maybe not? Leave final states shown.
}

 // --- [Modified Code] in app.js ---
function handleRunnerFlowStopped(finalContext, results) {
    showMessage("Flow execution stopped by user.", "warning", domRefs.runnerResultsList);
    updateRunnerUI();

    const lastResultIndex = appState.executionResults.length - 1;
    let stoppedStepId = null;

    // Find the last step that was 'running' and mark it as 'stopped'
    for (let i = appState.executionResults.length - 1; i >= 0; i--) {
         const res = appState.executionResults[i];
         if (res.status === 'running') {
            updateResultEntry(i, 'stopped', null, 'Execution stopped by user');
            stoppedStepId = res.stepId;
            break; // Stop after marking the first running step found
         }
    }

    if (stoppedStepId) {
        // Update UI for the specific stopped step
        if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
            appState.visualizerComponent.highlightNode(stoppedStepId, 'stopped');
        } else if (appState.currentView === 'list-editor') {
             highlightStepInList(stoppedStepId, 'step-stopped'); // --- UPDATED ---
        }
    } else {
         // Or just clear active highlights if stop was between steps or no step was running
         if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights(); // Clear all highlights
         clearListViewHighlights(); // --- UPDATED ---
    }
}

 // --- [Modified Code] in app.js ---
 function handleRunnerError(resultIndex, step, error, context, executionPath) {
    console.error(`Runner Error during step ${step?.id} (${step?.name}):`, error);
    const errorMessage = error?.message || (typeof error === 'string' ? error : 'Unknown execution error');

    if (resultIndex !== null && resultIndex >= 0 && resultIndex < appState.executionResults.length) {
        // If an index was provided (error happened during step completion), update existing entry
        updateResultEntry(resultIndex, 'error', null, errorMessage);
        if (step) {
             if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
                 appState.visualizerComponent.highlightNode(step.id, 'error');
             } else if (appState.currentView === 'list-editor') {
                 highlightStepInList(step.id, 'step-error'); // --- UPDATED ---
             }
        }
    } else {
        // Otherwise, add a general error message to the log if no specific step index provided
        // This usually means an error before step start or after step complete
        addResultEntry(
            { name: 'Execution Error', type: 'System', id: `error-${Date.now()}` }, // Provide dummy step info
            'error',
            executionPath || [],
            null, // No output
            errorMessage // Error message
        );
         // Also highlight the step if provided, even if index was null
        if (step) {
             if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
                 appState.visualizerComponent.highlightNode(step.id, 'error');
             } else if (appState.currentView === 'list-editor') {
                 highlightStepInList(step.id, 'step-error');
             }
        }
    }

    showMessage(`Execution failed${step ? ` at step "${step.name}"` : ''}: ${errorMessage}`, "error", domRefs.runnerResultsList);
    updateRunnerUI(); // Ensure UI reflects stopped state
}

function handleRunnerContextUpdate(newContext) {
    // Update the variables panel based on the latest runtime context
    // NOTE: This still only shows variable DEFINITIONS, not their runtime values.
    // A separate "Runtime Context" view would be needed to show live values.
    updateDefinedVariables(newContext); // Pass runtime context
    // _updateVariablesPanelUI is called within updateDefinedVariables
}


// --- Runner Result Rendering (in app.js for DOM access) ---

// [Modified Code] - Add extractionFailures to stored data
function addResultEntry(step, status = 'pending', executionPath = [], output = null, error = null, extractionFailures = []) { // <-- Add extractionFailures parameter
    if (!domRefs.runnerResultsList) return -1; // Exit if list doesn't exist

    const noResultsLi = domRefs.runnerResultsList.querySelector('.no-results');
    if (noResultsLi) noResultsLi.remove();

    const li = document.createElement('li');
    li.className = 'result-item';
    const stepId = step.id || `exec-${Date.now()}`;
    li.dataset.stepId = stepId;
    const resultIndex = appState.executionResults.length; // Get index *before* pushing
    li.dataset.resultIndex = resultIndex;

    // Store lightweight result object in appState for tracking
    const resultData = {
        stepId: stepId,
        stepName: step.name || 'Unnamed Step',
        status: status,
        output: output,
        error: error,
        executionPath: executionPath || [],
        extractionFailures: extractionFailures || [], // <-- Store failures
    };
    appState.executionResults.push(resultData);

    // Render the list item content using the stored data
    renderResultItemContent(li, resultData);

    domRefs.runnerResultsList.appendChild(li);
    // Scroll only if the panel is not already scrolled significantly by the user
    // Check if near the bottom (within ~1.5 times its own height from bottom)
    if (domRefs.runnerResultsContainer) { // Use container for scroll checks
        if (domRefs.runnerResultsContainer.scrollHeight - domRefs.runnerResultsContainer.scrollTop <= domRefs.runnerResultsContainer.clientHeight * 1.5) {
            domRefs.runnerResultsContainer.scrollTop = domRefs.runnerResultsContainer.scrollHeight;
        }
    }


    return resultIndex;
}

// [Modified Code] - Update stored data with extractionFailures
function updateResultEntry(index, status, output, error, extractionFailures = []) { // <-- Add extractionFailures parameter
    if (index < 0 || index >= appState.executionResults.length || !domRefs.runnerResultsList) return; // Invalid index or list missing

    const resultData = appState.executionResults[index];
    resultData.status = status;
    resultData.output = output;
    resultData.error = error;
    resultData.extractionFailures = extractionFailures || []; // <-- Store failures

    const li = domRefs.runnerResultsList.querySelector(`li.result-item[data-result-index="${index}"]`);
    if (!li) return; // List item not found

    // Re-render the content
    renderResultItemContent(li, resultData);

    // Scroll logic (same as addResultEntry, check container)
    if (domRefs.runnerResultsContainer) { // Use container for scroll checks
        if (domRefs.runnerResultsContainer.scrollHeight - domRefs.runnerResultsContainer.scrollTop <= domRefs.runnerResultsContainer.clientHeight * 1.5) {
            domRefs.runnerResultsContainer.scrollTop = domRefs.runnerResultsContainer.scrollHeight;
        }
    }
}


// [Modified Code] - Render extraction failures in results panel
// Helper to render the innerHTML of a result list item
function renderResultItemContent(listItem, resultData) {
    const { stepName, stepId, status, output, error, extractionFailures } = resultData; // <-- Get extractionFailures
    // Attempt to get step type. Use optional chaining for safety.
    const stepType = findStepById(appState.currentFlowModel?.steps, stepId)?.type || '??';

    // --- Status class remains based ONLY on execution status (success/error/skipped/etc.) ---
    const statusClass = status === 'success' ? 'success'
                      : status === 'error' ? 'error'
                      : status === 'running' ? 'running'
                      : status === 'stopped' ? 'warning' // Use warning style for stopped
                      : 'skipped'; // Default/skipped

    let outputHtml = '';
    if (output !== null && output !== undefined) { // Check explicitly for null/undefined
        try {
            // Attempt pretty print JSON, fallback to string
            const outputString = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
            outputHtml = `<div class="result-body"><pre>${escapeHTML(outputString)}</pre></div>`;
        } catch (e) {
             outputHtml = `<div class="result-body"><pre>[Error formatting output: ${escapeHTML(e.message)}]</pre></div>`;
        }
    }

    let errorHtml = '';
    if (error) {
        const errorMessage = escapeHTML(typeof error === 'string' ? error : error.message || 'Unknown Error');
        errorHtml = `<div class="result-error"><strong>Error:</strong> ${errorMessage}</div>`;
    }

    // --- NEW: Render Extraction Failures ---
    let extractionFailuresHtml = '';
    if (extractionFailures && extractionFailures.length > 0) {
        const failureItems = extractionFailures.map(fail =>
            `<li><code>${escapeHTML(fail.varName)}</code> from path <code>${escapeHTML(fail.path || 'N/A')}</code> (${escapeHTML(fail.reason || 'Not found')})</li>`
        ).join('');
        // Use 'warning' class for visual distinction
        extractionFailuresHtml = `
            <div class="result-extraction-failures warning">
                <strong>Extraction Warnings:</strong>
                <ul>${failureItems}</ul>
            </div>
        `;
    }
    // --- END NEW ---

    // Update the list item's class list to reflect the *current* status
    listItem.classList.remove('success', 'error', 'running', 'warning', 'skipped');
    listItem.classList.add(statusClass);

    listItem.innerHTML = `
        <div class="result-header">
            <span class="result-step-name">${escapeHTML(stepName)} (${escapeHTML(stepType)})</span>
            <span class="result-status">${status.toUpperCase()}</span>
        </div>
        ${errorHtml}
        ${extractionFailuresHtml} <!-- Append extraction failures -->
        ${outputHtml} <!-- Output often comes last -->
    `;
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
    // Close if clicking backdrop
    domRefs.stepTypeDialog.addEventListener('click', (e) => {
        if (e.target === domRefs.stepTypeDialog) hideAppStepTypeDialog(null);
    });
}

function showAppStepTypeDialog(onSelect) {
    stepTypeDialogCallback = onSelect;
    if (domRefs.stepTypeDialog) {
        try {
            // Populate icons dynamically
            domRefs.stepTypeDialog.querySelector('.request-icon').innerHTML = getStepTypeIcon('request');
            domRefs.stepTypeDialog.querySelector('.condition-icon').innerHTML = getStepTypeIcon('condition');
            domRefs.stepTypeDialog.querySelector('.loop-icon').innerHTML = getStepTypeIcon('loop');
            domRefs.stepTypeDialog.style.display = 'flex';
        } catch (error) {
            console.error("Error setting up step type dialog:", error);
        }
    } else {
        console.error("Step type dialog element not found.");
    }
}

function hideAppStepTypeDialog(selectedType) {
    if (domRefs.stepTypeDialog) domRefs.stepTypeDialog.style.display = 'none';
    if (stepTypeDialogCallback) {
        try {
            stepTypeDialogCallback(selectedType);
        } catch (error) {
            console.error("Error in step type dialog callback:", error);
        } finally {
             stepTypeDialogCallback = null; // Reset callback regardless of error
        }
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

    searchInput?.addEventListener('input', () => {
        const filter = searchInput.value.toLowerCase();
        let hasVisibleItems = false;
        varList?.querySelectorAll('.var-item').forEach(item => {
            const varName = item.dataset.var?.toLowerCase() || '';
            const isVisible = varName.includes(filter);
            item.style.display = isVisible ? '' : 'none';
            if (isVisible) hasVisibleItems = true;
        });
        if (noResultsMsg) noResultsMsg.style.display = hasVisibleItems ? 'none' : 'block';
    });
    closeBtn?.addEventListener('click', () => hideVarDropdown());
    varList?.addEventListener('click', (e) => {
        const varItem = e.target.closest('.var-item');
        if (varItem && varItem.dataset.var) {
            insertVariableIntoInput(varItem.dataset.var);
            hideVarDropdown();
        }
    });
}

// --- [Modified Code] in app.js ---
function initializeVariableInsertionListener() {
    document.body.addEventListener('click', (event) => {
        const insertButton = event.target.closest('.btn-insert-var');
        if (insertButton) {
            let targetInput = null;
            const targetId = insertButton.dataset.targetInput;

            try { // Add try-catch for DOM operations
                if (targetId) {
                    // Search within common parent containers first, then globally
                    targetInput = insertButton.closest('.step-editor, .flow-info-overlay, .key-value-editor')
                                     ?.querySelector(`#${targetId}`)
                                     || document.getElementById(targetId);
                } else {
                    // Fallback: More robust search for sibling/cousin input/textarea
                     const inputContainer = insertButton.closest('.input-with-vars, .header-row, .global-header-row, .flow-var-row, .key-value-row'); // Added common classes
                     if (inputContainer) {
                         targetInput = inputContainer.querySelector('input[type="text"], input:not([type]), textarea');
                     } else {
                         // Try finding adjacent input/textarea if button is directly next to it
                         targetInput = insertButton.previousElementSibling;
                         if (!targetInput || (targetInput.tagName !== 'INPUT' && targetInput.tagName !== 'TEXTAREA')) {
                            // If previous sibling isn't it, check parent's direct children
                            targetInput = insertButton.parentElement?.querySelector('input[type="text"], input:not([type]), textarea');
                         }
                     }
                }

                if (targetInput && (targetInput.tagName === 'INPUT' || targetInput.tagName === 'TEXTAREA')) {
                    // Use cached defined variables
                    const currentVars = appState.definedVariables || {}; // Use cached variables
                    const varNames = Object.keys(currentVars);
                    showVarDropdown(insertButton, targetInput, varNames);
                } else {
                    console.warn("Could not find target input/textarea for variable insertion button.", insertButton);
                    showMessage("Could not find the target field for variable insertion.", "warning");
                }
            } catch (error) {
                console.error("Error finding target input for variable insertion:", error);
                showMessage("Error preparing variable insertion.", "error");
            }
        }
    });
}

// --- [Modified Code] in app.js ---
function showVarDropdown(button, targetInput, availableVarNames) {
    hideVarDropdown(); // Hide any existing dropdown

    if (!domRefs.varDropdown) {
         console.error("Variable dropdown element not found.");
         return;
    }

    if (!availableVarNames || availableVarNames.length === 0) {
        showMessage("No variables defined or extracted yet to insert.", "info");
        return;
    }

    currentVarDropdown = { button, targetInput };
    const varList = domRefs.varDropdown.querySelector('.var-list');
    const searchInput = domRefs.varDropdown.querySelector('.var-search');
    const noResultsMsg = domRefs.varDropdown.querySelector('.no-results-msg');

    if (!varList || !searchInput || !noResultsMsg) {
        console.error("Variable dropdown is missing required elements (list, search, no-results).");
        return;
    }

    try { // Add try-catch for DOM updates
        varList.innerHTML = availableVarNames.sort()
            .map(varName => `<div class="var-item" data-var="${escapeHTML(varName)}" title="Insert {{${escapeHTML(varName)}}}">${escapeHTML(varName)}</div>`)
            .join('');
        searchInput.value = '';
        noResultsMsg.style.display = 'none';
        varList.querySelectorAll('.var-item').forEach(item => item.style.display = ''); // Ensure all are visible

        // --- Improved Positioning ---
        const rect = button.getBoundingClientRect();
        domRefs.varDropdown.style.display = 'block'; // Make visible before measuring
        const dropdownHeight = domRefs.varDropdown.offsetHeight;
        const dropdownWidth = domRefs.varDropdown.offsetWidth;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let topPos = rect.bottom + window.scrollY + 2;
        // Check if dropdown goes below viewport
        if (topPos + dropdownHeight > viewportHeight + window.scrollY) {
            topPos = rect.top + window.scrollY - dropdownHeight - 2; // Position above button
        }
         // Ensure top position isn't negative
         if (topPos < window.scrollY) {
             topPos = window.scrollY + 5;
         }

        let leftPos = rect.left + window.scrollX;
        // Check if dropdown goes off-screen right
        if (leftPos + dropdownWidth > viewportWidth + window.scrollX) {
            leftPos = viewportWidth + window.scrollX - dropdownWidth - 10; // Adjust left
        }
        // Ensure left position isn't negative
        if (leftPos < window.scrollX) {
            leftPos = window.scrollX + 10;
        }

        domRefs.varDropdown.style.top = `${topPos}px`;
        domRefs.varDropdown.style.left = `${leftPos}px`;

        setTimeout(() => searchInput.focus(), 50); // Focus after display

        // Click-outside handler (remains same)
        currentVarDropdown.handler = (event) => {
             // Check if the click is outside the dropdown AND outside the button that opened it
             if (domRefs.varDropdown && !domRefs.varDropdown.contains(event.target) && event.target !== button && !button.contains(event.target)) {
                 hideVarDropdown();
             }
        };
        // Use setTimeout 0 to attach the listener after the current event loop cycle (which handles the button click)
        setTimeout(() => document.addEventListener('click', currentVarDropdown.handler, { capture: true }), 0); // Attach listener

    } catch (error) {
        console.error("Error populating or positioning variable dropdown:", error);
        showMessage("Error showing variable list.", "error");
        hideVarDropdown(); // Ensure it's hidden on error
    }
}

function hideVarDropdown() {
    if (domRefs.varDropdown) domRefs.varDropdown.style.display = 'none';
    if (currentVarDropdown.handler) {
        // Clean up listener
        document.removeEventListener('click', currentVarDropdown.handler, { capture: true });
    }
    currentVarDropdown = { button: null, targetInput: null, handler: null };
}

// --- [Modified Code] in app.js ---
function insertVariableIntoInput(varName) {
    const targetInput = currentVarDropdown.targetInput;
    // --- CRITICAL: Add checks ---
    if (!targetInput) {
        console.error("Cannot insert variable: Target input is null or undefined.");
        showMessage("Insertion target lost.", "error");
        return;
    }
     if (typeof targetInput.value === 'undefined' || targetInput.selectionStart === null || targetInput.selectionEnd === null) {
        console.error("Cannot insert variable: Target input is not a valid text input/textarea or selection is not available.", targetInput);
         showMessage("Cannot insert into target field.", "error");
        return;
    }
    if (targetInput.readOnly || targetInput.disabled) {
        console.warn("Cannot insert variable: Target input is read-only or disabled.");
        showMessage("Cannot insert into read-only field.", "warning");
        return;
    }

    try { // Wrap DOM manipulation
        const textToInsert = `{{${varName}}}`;
        const currentVal = targetInput.value;
        const selectionStart = targetInput.selectionStart;
        const selectionEnd = targetInput.selectionEnd;

        // Insert text, replacing selection if any
        targetInput.value = currentVal.substring(0, selectionStart) + textToInsert + currentVal.substring(selectionEnd);

        // Update cursor position to end of inserted text
        const newCursorPos = selectionStart + textToInsert.length;
        targetInput.selectionStart = newCursorPos;
        targetInput.selectionEnd = newCursorPos;

        // Trigger input event for frameworks/listeners and focus
        targetInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetInput.focus();

        // Trigger change event as well, sometimes needed
        targetInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

         // --- CRITICAL: Mark editor dirty if appropriate ---
         // Check if the target input is within the step editor managed by the builder component
         const editorPanel = targetInput.closest('.step-editor-panel .step-editor');
         if (appState.builderComponent && editorPanel) {
              // Directly mark editor as dirty
              handleBuilderEditorDirtyChange(true);
         } else {
              // Check if input is part of flow info overlay (headers, static vars)
               const infoOverlay = targetInput.closest('.flow-info-overlay');
               if (infoOverlay) {
                   // These changes directly modify the flow model via their own input listeners,
                   // which already call setDirty(true) via the appState.isDirty flag. No extra call needed here.
                   // We just rely on the existing 'input' or 'change' event listeners on those fields.
               }
         }
    } catch (error) {
         console.error("Error inserting variable text:", error);
         showMessage("Failed to insert variable text.", "error");
    }
}


// --- Execution Logic Helpers (needed by runner, defined here for context access) ---
// Note: These are passed to FlowRunner instance during initialization.

// [Modified Code] - app.js

/**
 * Creates a processed version of the step data for execution, substituting variables.
 * Operates on the raw data containing ##VAR:type:name## markers for body/headers if applicable.
 * Handles string vs. unquoted substitution for markers.
 * Returns the processed step structure and a map of placeholders for unquoted values.
 * @param {Object} step - The original step object, MUST contain step.rawBodyWithMarkers if applicable.
 * @param {Object} context - The current execution context { varName: value }.
 * @return {{processedStep: Object, unquotedPlaceholders: Object}} Object containing the processed step and the map for unquoted placeholders.
 */
function substituteVariablesInStep(step, context) {
    console.log(`[Sub Step ${step.id}] Starting substitution for step "${step.name}"`, { originalStep: step, context });
    const unquotedPlaceholders = {}; // Map<placeholder, rawValue> - ONLY for body markers
    let placeholderCounter = 0;
    const uniquePrefix = `__FLOWRUNNER_UNQUOTED_${Date.now()}_`;

    // Recursive substitution function ONLY for data structures containing ##VAR...## BODY markers
    function substituteBodyMarkersRecursive(value) {
        if (typeof value === 'string') {
            const match = value.match(/^##VAR:(string|unquoted):([^#]+)##$/);
            if (match) {
                const [, type, name] = match;
                // console.log(`[Sub Body Marker ${step.id}] Found marker: "${value}", Type: ${type}, Name: ${name}`);
                // Use evaluateVariable (which uses evaluatePath) to get the value
                const evaluatedValue = evaluateVariable(`{{${name}}}`, context);
                // console.log(`[Sub Body Marker ${step.id}] Evaluated "{{${name}}}":`, evaluatedValue);

                if (evaluatedValue === undefined) {
                    // console.warn(`[Sub Body Marker ${step.id}] Substitution failed: Variable {{${name}}} not found in context for marker "${value}". Using null.`);
                    return null; // Return null if variable not found for marker
                }

                if (type === 'string') {
                    // console.log(`[Sub Body Marker ${step.id}] Returning string value:`, evaluatedValue);
                    return evaluatedValue; // Return evaluated value directly
                } else { // type === 'unquoted'
                    const placeholder = `${uniquePrefix}${placeholderCounter++}`;
                    unquotedPlaceholders[placeholder] = evaluatedValue; // Store raw value
                    // console.log(`[Sub Body Marker ${step.id}] Creating unquoted placeholder "${placeholder}" for value:`, evaluatedValue);
                    return placeholder; // Return placeholder string
                }
            }
            // If not a marker, return the string as is (no {{var}} substitution here)
            // console.log(`[Sub Body Marker ${step.id}] Returning non-marker string value: "${value}"`);
            return value;
        } else if (Array.isArray(value)) {
            // console.log(`[Sub Body Marker ${step.id}] Recursing into array...`);
            return value.map(item => substituteBodyMarkersRecursive(item));
        } else if (typeof value === 'object' && value !== null) {
            // console.log(`[Sub Body Marker ${step.id}] Recursing into object...`);
            const newObj = {};
            for (const key in value) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    newObj[key] = substituteBodyMarkersRecursive(value[key]);
                }
            }
            return newObj;
        }
        // console.log(`[Sub Body Marker ${step.id}] Returning non-string/array/object value:`, value);
        return value; // Return numbers, booleans, etc.
    } // --- End of substituteBodyMarkersRecursive ---

    // --- Start processing the step ---
    const processedStepData = { ...step }; // Shallow copy initially

    try {
        // 1. Substitute URL using standard {{variable}} syntax
        const originalUrl = step.url || '';
        // console.log(`[Sub URL ${step.id}] Attempting standard substitution for URL: "${originalUrl}"`);
        processedStepData.url = substituteVariables(originalUrl, context);
        // console.log(`[Sub URL ${step.id}] Substituted URL: "${processedStepData.url}"`);


        // 2. Substitute Headers using standard {{variable}} syntax in values
        const originalHeaders = step.headers || {};
        let substitutedHeaders = {};
        // console.log(`[Sub Header ${step.id}] Attempting standard substitution for headers:`, originalHeaders);
        for (const key in originalHeaders) {
            if (Object.prototype.hasOwnProperty.call(originalHeaders, key)) {
                const originalValue = originalHeaders[key];
                // Substitute {{variables}} in the header *value* only
                if (typeof originalValue === 'string') {
                    // console.log(`[Sub Header ${step.id}] Substituting value for key "${key}": "${originalValue}"`);
                    substitutedHeaders[key] = substituteVariables(originalValue, context);
                    // console.log(`[Sub Header ${step.id}] Substituted value for key "${key}": "${substitutedHeaders[key]}"`);
                } else {
                    // console.log(`[Sub Header ${step.id}] Keeping non-string value for key "${key}":`, originalValue);
                    substitutedHeaders[key] = originalValue; // Keep non-strings as is
                }
            }
        }
        processedStepData.headers = substitutedHeaders;
        // console.log(`[Sub Header ${step.id}] Final substituted headers:`, processedStepData.headers);

        // 3. Substitute Body using ##VAR## markers via rawBodyWithMarkers
        processedStepData.body = null; // Initialize processed body
        if (step.type === 'request' && step.rawBodyWithMarkers !== undefined && step.rawBodyWithMarkers !== null) {
             // console.log(`[Sub Body ${step.id}] Attempting marker substitution for body using rawBodyWithMarkers:`, step.rawBodyWithMarkers);
             // Deep copy rawBodyWithMarkers before substitution to avoid modifying the original model
             const rawBodyCopy = JSON.parse(JSON.stringify(step.rawBodyWithMarkers));
             // Use the dedicated marker substitution function
             processedStepData.body = substituteBodyMarkersRecursive(rawBodyCopy);
             // console.log(`[Sub Body ${step.id}] Final substituted body (with potential placeholders):`, processedStepData.body);
             // console.log(`[Sub Body ${step.id}] Unquoted placeholders generated:`, unquotedPlaceholders);
        } else if (step.type === 'request' && step.body){
             // Fallback: If rawBodyWithMarkers is explicitly undefined (not just null),
             // perhaps try standard substitution on step.body as a legacy behavior? Risky.
             // Only do this if rawBodyWithMarkers is strictly undefined.
             if (step.rawBodyWithMarkers === undefined) {
                 console.warn(`[Sub Body ${step.id}] Step ${step.id}: rawBodyWithMarkers is missing. Body substitution using markers will be skipped. Attempting standard substitution on step.body as fallback.`);
                 processedStepData.body = substituteVariables(step.body, context); // Substitute standard vars just in case
                 // console.log(`[Sub Body ${step.id}] Result of standard substitution on step.body:`, processedStepData.body);
             } else {
                  // rawBodyWithMarkers exists but is null, so no body content intended.
                  // console.log(`[Sub Body ${step.id}] rawBodyWithMarkers is null, processed body remains null.`);
             }
        } else {
             // console.log(`[Sub Body ${step.id}] Not a request step or no body/rawBodyWithMarkers defined. Processed body remains null.`);
        }


        // 4. Substitute other fields using standard {{variable}} syntax
        if (processedStepData.type === 'condition' && step.conditionData?.value && typeof step.conditionData.value === 'string') {
            const originalCondValue = step.conditionData.value;
            // console.log(`[Sub Cond ${step.id}] Attempting standard substitution for condition value: "${originalCondValue}"`);
            processedStepData.conditionData = { ...step.conditionData, value: substituteVariables(originalCondValue, context) };
            // console.log(`[Sub Cond ${step.id}] Substituted condition value: "${processedStepData.conditionData.value}"`);
        }
        if (processedStepData.type === 'loop' && step.source && typeof step.source === 'string') {
             const originalLoopSource = step.source;
             // console.log(`[Sub Loop ${step.id}] Attempting standard substitution for loop source: "${originalLoopSource}"`);
             processedStepData.source = substituteVariables(originalLoopSource, context);
             // console.log(`[Sub Loop ${step.id}] Substituted loop source: "${processedStepData.source}"`);
        }
        // Optionally substitute name - generally not needed for execution, but could be for logging
        // const originalName = step.name;
        // console.log(`[Sub Name ${step.id}] Attempting standard substitution for name: "${originalName}"`);
        // processedStepData.name = substituteVariables(originalName, context);
        // console.log(`[Sub Name ${step.id}] Substituted name: "${processedStepData.name}"`);


    } catch (error) {
        console.error(`[Sub Step ${step.id}] Error substituting variables in step ${step.id} (${step.name}):`, error);
        throw new Error(`Variable substitution failed for step ${step.id}: ${error.message}`);
    }

    // console.log(`[Sub Step ${step.id}] Substitution complete for step "${step.name}".`, { processedStep: processedStepData, unquotedPlaceholders });
    // Return the processed step data and the unquotedPlaceholders map (populated ONLY from body markers)
    return { processedStep: processedStepData, unquotedPlaceholders };
}


/**
 * Replace {{variable}} placeholders in a simple string. Handles nested {{}} if needed,
 * but primarily designed for top-level replacement.
 * @param {string} text - Input string.
 * @param {Object} context - Execution context.
 * @return {string} String with variables replaced.
 */
function substituteVariables(text, context) {
    if (typeof text !== 'string') return text; // Only process strings

    // Regex to find {{variable.path}} placeholders
    return text.replace(/\{\{([^}]+)\}\}/g, (match, varRef) => {
        // Evaluate the variable reference (e.g., "variable.path")
        const evaluatedValue = evaluateVariable(match, context); // Pass the full {{var}}

        // If evaluation failed (undefined), return the original placeholder
        if (evaluatedValue === undefined) {
            // console.warn(`Substitution failed: Variable ${match} not found in context.`);
            return match;
        }

        // If value is object/array, stringify it for embedding in URL/header string etc.
        if (typeof evaluatedValue === 'object' && evaluatedValue !== null) {
            try {
                // Avoid circular references during stringification for safety
                // This simple approach works for basic cases.
                // For complex objects, a library might be needed.
                return JSON.stringify(evaluatedValue);
            } catch (e) {
                console.warn(`Substitution failed: Could not stringify object for ${match}.`, e);
                return match; // Fallback to original placeholder on stringify error
            }
        }

        // Convert other types (number, boolean) to string
        return String(evaluatedValue);
    });
}


/**
 * Evaluate a variable reference like {{varName}} or {{obj.path[0].value}} from context.
 * @param {string} varRefWithBraces - The variable reference string including braces (e.g., "{{var.path}}").
 * @param {Object} context - The current execution context.
 * @return {*} The evaluated value, or undefined if not found/error.
 */
function evaluateVariable(varRefWithBraces, context) { // Keep this function in app.js
    if (!varRefWithBraces || typeof varRefWithBraces !== 'string') return undefined;

    const match = varRefWithBraces.match(/\{\{([^}]+)\}\}/);
    if (!match || !match[1]) return undefined;

    const path = match[1].trim();
    if (!path) return undefined;

    try {
        // *** CRITICAL CHANGE: Call the imported evaluatePath from flowCore ***
        return evaluatePath(context, path);
    } catch(e) {
        console.warn(`Error evaluating path "${path}" during substitution:`, e);
        return undefined; // Return undefined on evaluation error
    }
}

// Local implementation of evaluatePath (should ideally be in flowCore.js or a utility module)
// Removed as we are importing evaluatePath from flowCore.js now.


/**
 * Evaluate a structured condition using the current context.
 * @param {Object} conditionData - Structured condition { variable, operator, value }.
 * @param {Object} context - Execution context.
 * @return {boolean} Result of the condition evaluation.
 * @throws {Error} If evaluation fails.
 */
function evaluateCondition(conditionData, context) {
    if (!conditionData) {
        throw new Error("Invalid condition: Condition data is missing.");
    }
    const { variable, operator, value: conditionValue } = conditionData;

    if (!variable) {
        // Only 'exists' and 'not_exists' can potentially operate without a variable path specified?
        // Let's assume variable is always required for now.
        throw new Error("Invalid condition data: Variable path is required.");
    }
    if (!operator) {
         throw new Error("Invalid condition data: Operator is required.");
    }
    // Allow 'exists' and 'not_exists' operators without a comparison 'value'
    if (!(operator === 'exists' || operator === 'not_exists' || operator === 'is_null' || operator === 'is_not_null' || operator === 'is_empty' || operator === 'is_not_empty' || operator === 'is_true' || operator === 'is_false') && conditionValue === undefined) {
        console.warn(`[Evaluate Condition] Operator '${operator}' typically requires a comparison value, but none was provided. Evaluation might be unexpected.`);
        // Proceed, but behavior depends on switch case logic for undefined comparison value.
    }


    // Evaluate the variable part from context using the variable path
    // This 'actualValue' could be a string, number (like status code), boolean, object, array, null, or undefined.
    const actualValue = evaluatePath(context, variable); // Use imported evaluatePath

    // The conditionValue might have already been substituted if it was like {{anotherVar}}
    // Or it could be a literal value (string, number, boolean from the UI).
    const comparisonValue = conditionValue;

    // console.log(`[Evaluate Condition] Step: ${conditionData.stepId || 'N/A'}, VarPath: '${variable}', Operator: '${operator}', ComparisonVal: '${comparisonValue}' (Type: ${typeof comparisonValue}), ActualVal: '${actualValue}' (Type: ${typeof actualValue})`);

    try {
        switch (operator) {
            // --- Equality Operators (Modified for Robustness) ---
            case 'equals': {
                // 1. Strict comparison first
                if (actualValue === comparisonValue) return true;
                // 2. If strict fails, try numeric comparison (handles number vs string like 200 vs "200")
                // Avoid coercion if one is clearly not number-like (e.g., object, undefined)
                if (typeof actualValue !== 'object' && typeof comparisonValue !== 'object' && actualValue != null && comparisonValue != null) {
                    const numActual = Number(actualValue);
                    const numComparison = Number(comparisonValue);
                    // Only compare numerically if both are valid numbers (not NaN)
                    if (!isNaN(numActual) && !isNaN(numComparison) && numActual === numComparison) {
                        return true;
                    }
                }
                // 3. If both strict and numeric fail, it's false
                return false;
            }
            case 'not_equals': {
                // Implement as the logical inverse of the robust 'equals' logic above
                let isEqual = false;
                if (actualValue === comparisonValue) {
                    isEqual = true;
                } else {
                     if (typeof actualValue !== 'object' && typeof comparisonValue !== 'object' && actualValue != null && comparisonValue != null) {
                        const numActual = Number(actualValue);
                        const numComparison = Number(comparisonValue);
                        if (!isNaN(numActual) && !isNaN(numComparison) && numActual === numComparison) {
                             isEqual = true;
                        }
                    }
                }
                // Return the inverse of the final equality result
                return !isEqual;
            }

            // --- Numeric Comparison Operators (Modified for Robustness) ---
            case 'greater_than': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                // Return true ONLY if both are valid numbers and the condition holds
                return !isNaN(numActual) && !isNaN(numComparison) && numActual > numComparison;
            }
            case 'less_than': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                return !isNaN(numActual) && !isNaN(numComparison) && numActual < numComparison;
            }
            case 'greater_equals': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                return !isNaN(numActual) && !isNaN(numComparison) && numActual >= numComparison;
            }
            case 'less_equals': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                return !isNaN(numActual) && !isNaN(numComparison) && numActual <= numComparison;
            }

            // --- String Operators (Modified for Robustness) ---
            case 'contains': {
                // Ensure actualValue is treated as string for contains check
                const strActual = String(actualValue ?? ''); // Use empty string for null/undefined
                const strComparison = String(comparisonValue ?? ''); // Use empty string for null/undefined comparison value too
                return strActual.includes(strComparison);
            }
            case 'not_contains': {
                 const strActual = String(actualValue ?? '');
                 const strComparison = String(comparisonValue ?? '');
                 return !strActual.includes(strComparison);
            }
            case 'starts_with': {
                const strActual = String(actualValue ?? '');
                const strComparison = String(comparisonValue ?? '');
                return strActual.startsWith(strComparison);
            }
            case 'ends_with': {
                const strActual = String(actualValue ?? '');
                const strComparison = String(comparisonValue ?? '');
                return strActual.endsWith(strComparison);
            }
            case 'matches_regex': {
                 try {
                     const strActual = String(actualValue ?? '');
                     const pattern = String(comparisonValue ?? '');
                     if (!pattern) return false; // Need a pattern
                     // Add flags from comparisonValue if specified (e.g. "/pattern/i")
                     const regexMatch = pattern.match(/^\/(.+)\/([gimyus]*)$/);
                     const finalPattern = regexMatch ? regexMatch[1] : pattern;
                     const flags = regexMatch ? regexMatch[2] : '';
                     return new RegExp(finalPattern, flags).test(strActual);
                 } catch { return false; } // Invalid regex pattern provided
             }
            case 'not_matches_regex': {
                 try {
                     const strActual = String(actualValue ?? '');
                     const pattern = String(comparisonValue ?? '');
                     if (!pattern) return true; // No pattern means nothing matches -> true? Or false? Let's return true (doesn't match empty pattern).
                     const regexMatch = pattern.match(/^\/(.+)\/([gimyus]*)$/);
                     const finalPattern = regexMatch ? regexMatch[1] : pattern;
                     const flags = regexMatch ? regexMatch[2] : '';
                     return !new RegExp(finalPattern, flags).test(strActual);
                 } catch { return true; } // Invalid regex doesn't match -> true
             }

            // --- Existence/Type Operators (Modified for Clarity) ---
            case 'exists':
                // Checks if the path resolved to a value other than undefined
                return actualValue !== undefined;
            case 'not_exists':
                // Checks if the path resolved to undefined
                return actualValue === undefined;
             case 'is_null':
                 return actualValue === null;
             case 'is_not_null':
                 // Explicitly check for not null AND not undefined
                 return actualValue !== null && actualValue !== undefined;
            case 'is_empty': // Check for empty string, empty array, or null/undefined
                 return actualValue === '' || actualValue === null || actualValue === undefined || (Array.isArray(actualValue) && actualValue.length === 0);
            case 'is_not_empty': // Check for non-empty string or non-empty array (and not null/undefined)
                 return actualValue !== '' && actualValue !== null && actualValue !== undefined && (!Array.isArray(actualValue) || actualValue.length > 0);
            case 'is_number':
                // Checks if typeof is number AND it's not NaN
                return typeof actualValue === 'number' && !isNaN(actualValue);
            case 'is_text': // Checks if it's specifically a string
                return typeof actualValue === 'string';
            case 'is_boolean':
                return typeof actualValue === 'boolean';
            case 'is_array':
                return Array.isArray(actualValue);
            case 'is_object': // Check for plain objects (not arrays, not null)
                 return typeof actualValue === 'object' && actualValue !== null && !Array.isArray(actualValue);
            case 'is_true': // Strict check for boolean true
                return actualValue === true;
            case 'is_false': // Strict check for boolean false
                return actualValue === false;

            default:
                 console.warn(`Unknown condition operator: ${operator}`);
                 throw new Error(`Unknown condition operator: ${operator}`); // Throw error for unknown operator
        }
    } catch (evalError) {
        console.error(`Error during condition evaluation (Operator: ${operator}, Variable Path: ${variable}):`, evalError);
        // Rethrow specific error for condition failure
        throw new Error(`Condition evaluation failed for operator "${operator}": ${evalError.message}`);
    }
}


// --- Final checks ---
// --- [Modified Code] in app.js ---
function initializeVisualizer() {
    if (!domRefs.flowVisualizerMount) {
        console.error("Cannot initialize visualizer: Mount point not found.");
        return;
    }
    // Avoid re-creating if instance already exists
    if (!appState.visualizerComponent) {
        appState.visualizerComponent = new FlowVisualizer(
            domRefs.flowVisualizerMount,
            {
                onNodeSelect: handleBuilderStepSelect,
                onNodeMove: handleVisualizerNodeMove, // Keep for logical reordering if needed later, separate from layout drag
                onNodeLayoutUpdate: handleVisualizerNodeLayoutUpdate, // <-- NEW: Handle free-drag position updates
                onAddStep: (parentId, branch, position) => {
                    showAppStepTypeDialog(type => {
                        if (type) {
                            const newStep = createNewStep(type);
                            const action = {
                                type: 'add',
                                step: newStep,
                                parentId: parentId,
                                branch: branch,
                                // position: position // Position hint if needed
                            };
                            // If adding at top level (parentId is null - from a general '+' maybe?)
                            if (!parentId) {
                                appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];
                                appState.currentFlowModel.steps.push(newStep);
                                appState.selectedStepId = newStep.id;
                                appState.isDirty = true; // Mark flow dirty
                                setDirty(); // Update UI
                                renderCurrentFlow(); // Re-render list/visualizer
                            } else {
                                // Delegate to existing add logic used by builder
                               handleBuilderStepUpdate(action); // This will call setDirty and render
                            }
                        }
                    });
                }
                // Add other callbacks like onDeleteStep, onCloneStep if needed
            }
        );
    } else {
        // If instance exists, maybe ensure it's attached or cleared if needed?
        // Handled within clearWorkspace and renderCurrentFlow generally.
    }
}

// [Modified Code] - Pass updateRunnerUI callback to FlowRunner constructor
// Initialize runner instance
function initializeRunner() {
    // Avoid re-creating if instance already exists
    if (!appState.runner) {
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
            evaluatePathFn: evaluatePath, // From flowCore via import
            // --- NEW: Pass the UI update function ---
            updateRunnerUICallback: updateRunnerUI
            // --- END NEW ---
        });
        handleClearResults(); // Initialize runner state and UI
    }
}