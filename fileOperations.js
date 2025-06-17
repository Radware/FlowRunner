import { RECENT_FILES_KEY, MAX_RECENT_FILES } from './config.js';
import { appState, domRefs } from './state.js';
import {
    setLoading, setDirty, showMessage, clearMessages,
    updateWorkspaceTitle, renderCurrentFlow, clearWorkspace,
    updateViewToggle, setupPaneResizer
} from './uiUtils.js';
import { handleClearResults, updateRunnerUI, handleStopFlow } from './runnerInterface.js';
import {
    flowModelToJson, jsonToFlowModel, validateFlow, createTemplateFlow,
    escapeHTML, findStepById
} from './flowCore.js';
import { assignNewIdsRecursive } from './modelUtils.js';
import { showValidationErrors } from './uiUtils.js';
import { initializeAppComponents } from './app.js'; // <-- ADDED IMPORT
import { logger } from './logger.js'; // <-- ADDED IMPORT


// Simple path shim for display purposes
const path = {
    basename: (p) => p.split(/[\\/]/).pop() || p
};


// --- Recent Files Helpers ---

// --- NEW HELPER FUNCTION ---
/**
 * Adds a file path to the recent files list in localStorage.
 * @param {string} filePath
 * @param {boolean} [moveToTop=true] - If true the file is moved to the top of the list.
 */
export function addRecentFile(filePath, moveToTop = true) {
    if (!filePath) return;
    try {
        let recentFiles = getRecentFiles();
        const existingIndex = recentFiles.indexOf(filePath);

        if (existingIndex !== -1) {
            if (moveToTop) {
                recentFiles.splice(existingIndex, 1);
                recentFiles.unshift(filePath);
            }
        } else {
            if (moveToTop) {
                recentFiles.unshift(filePath);
            } else {
                recentFiles.push(filePath);
            }
        }

        if (recentFiles.length > MAX_RECENT_FILES) {
            recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
        }

        localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentFiles));
        renderFlowList(recentFiles);
    } catch (error) {
        logger.error("Error updating recent files in localStorage:", error);
    }
}

// --- NEW HELPER FUNCTION ---
// --- SUGGESTED MODIFICATION for NEW VERSION's getRecentFiles ---
export function getRecentFiles() {
    try {
        const stored = localStorage.getItem(RECENT_FILES_KEY);
        logger.debug("Raw stored recent files:", stored);

        if (!stored) {
            logger.debug("No stored recent files found");
            return [];
        }

        let parsed;
        try {
            parsed = JSON.parse(stored);
        } catch (parseError) {
            logger.error("Error parsing recent files from localStorage:", parseError, "Stored data:", stored);
            // Corrupted JSON, consider removing or trying to salvage, but for now, just return empty.
            // localStorage.removeItem(RECENT_FILES_KEY); // Avoid automatic removal for now
            return [];
        }
        logger.info("Parsed recent files:", parsed);

        if (!Array.isArray(parsed)) {
            logger.warn("Stored recent files is not an array, resetting to empty. Original data:", parsed);
            localStorage.setItem(RECENT_FILES_KEY, '[]'); // Reset if not an array
            return [];
        }

        const validFiles = parsed.filter(path => typeof path === 'string' && path.trim().length > 0);

        if (validFiles.length !== parsed.length) {
            logger.warn("Filtered out invalid entries from recent files. Saving cleaned list.");
            localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(validFiles));
        }

        return validFiles;
    } catch (error) { // This outer catch is for unexpected errors beyond parsing
        logger.error("Unexpected error reading recent files from localStorage:", error);
        // Do NOT remove the key here, as it might be a temporary issue.
        return [];
    }
}

function getAfterElement(container, y) {
    const items = [...container.querySelectorAll('.recent-file-item:not(.dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    items.forEach(item => {
        const box = item.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            closest = { offset, element: item };
        }
    });
    return closest.element;
}

// --- Sidebar Logic (Recent Files) ---

// --- MODIFIED FUNCTION ---
export function loadFlowList() {
    // Load and render the recent files list from localStorage
    if (!domRefs.flowList) {
        logger.error("Cannot load flow list: DOM element not found");
        return;
    }

    logger.debug("Loading recent files list...");
    try {
        domRefs.flowList.innerHTML = '<li class="loading-flows">Loading recent files...</li>';
        const recentFiles = getRecentFiles();
        logger.debug("Retrieved recent files:", recentFiles);
        renderFlowList(recentFiles);
    } catch (error) {
        logger.debug("Error loading recent files:", error);
        domRefs.flowList.innerHTML = '<li class="error-flows">Error loading recent files.</li>';
    }
}

// --- MODIFIED FUNCTION ---
export function renderFlowList(recentFiles) {
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
            <div class="flow-item-content">
                <span class="flow-item-name">${escapeHTML(getFileName(filePath))}</span>
                <button class="btn-remove-recent-file"
                        data-action="remove-recent"
                        title="Remove from recent list"
                        aria-label="Remove ${escapeHTML(getFileName(filePath))} from recent list">
                    ✕
                </button>
            </div>
        `;

        // click the row to open the flow
        li.addEventListener('click', (e) => {
            // Only trigger if the click wasn't on the remove button
            if (!e.target.closest('.btn-remove-recent-file')) {
                handleFlowListActions({ target: li });
            }
        });

        // --- Drag handlers ---
        li.draggable = true;
        li.addEventListener('dragstart', () => {
            li.classList.add('dragging');
        });
        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
            const order = [...domRefs.flowList.querySelectorAll('.recent-file-item')].map(el => el.dataset.filePath);
            localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(order));
            renderFlowList(order);
        });

        domRefs.flowList.appendChild(li);
    });

    domRefs.flowList.ondragover = (e) => {
        e.preventDefault();
        const dragging = domRefs.flowList.querySelector('.recent-file-item.dragging');
        if (!dragging) return;
        const afterEl = getAfterElement(domRefs.flowList, e.clientY);
        if (afterEl == null) {
            domRefs.flowList.appendChild(dragging);
        } else {
            domRefs.flowList.insertBefore(dragging, afterEl);
        }
    };
}

// --- MODIFIED FUNCTION ---
export async function handleFlowListActions(event) {
    // First check if we clicked a remove button
    const removeButton = event.target.closest('.btn-remove-recent-file');
    if (removeButton) {
        event.stopPropagation(); // Prevent opening the flow
        const listItem = removeButton.closest('.recent-file-item');
        if (listItem) {
            const filePathToRemove = listItem.dataset.filePath;
            if (filePathToRemove) {
                logger.debug("Remove from recents:", filePathToRemove);
                let currentRecent = getRecentFiles();
                currentRecent = currentRecent.filter(p => p !== filePathToRemove);
                localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(currentRecent));
                renderFlowList(currentRecent);

                // If we're removing the currently open flow, clear the current path but don't clear workspace
                if (filePathToRemove === appState.currentFilePath) {
                    appState.currentFilePath = null;
                    updateWorkspaceTitle(); // Update title to reflect no current file
                }
                return;
            }
        }
    }

    // Handle flow selection (if we didn't click a remove button)
    const targetListItem = event.target.closest('.recent-file-item');
    if (targetListItem) {
        const filePath = targetListItem.dataset.filePath;
        if (filePath && filePath !== appState.currentFilePath) {
            if (!await confirmStopContinuousRun(`Selecting a new flow`)) {
                return;
            }
            logger.debug(`Recent file selected: ${filePath}`);
            handleSelectFlow(filePath);
        }
    }
}

// --- [Modified Code] in app.js ---
export function confirmDiscardChanges() {
    if (appState.isDirty || appState.stepEditorIsDirty) {
        if (!confirm("You have unsaved changes. Discard them and continue?")) {
            return false; // User canceled
        }
    }
    // User confirmed discard OR no changes existed
    logger.info("Discarding or confirming no unsaved changes.");
    appState.isDirty = false;
    appState.stepEditorIsDirty = false;

    // updateWorkspaceTitle(); // updateWorkspaceTitle is called by setDirty
    setDirty(); // Pass false was removed, setDirty will re-evaluate based on new appState flags
    return true;
}

// --- MODIFIED FUNCTION ---
export async function handleSelectFlow(filePath) {
    // Loads a flow from the given file path
    if (appState.isLoading || !filePath) return;

    logger.debug(`Attempting to load flow from: ${filePath}`);

    if (!await confirmStopContinuousRun(`Loading flow "${path.basename(filePath)}"`)) {
        return;
    }

    if (!confirmDiscardChanges()) {
        return; // User cancelled discarding changes
    }

    // Proceed with loading
    appState.selectedStepId = null; // Reset step selection
    // Do not reorder recent list when selecting from the sidebar
    loadAndRenderFlow(filePath, false);

    // Update selection highlight in the recent files list (done within loadAndRenderFlow via addRecentFile)
    // renderFlowList(getRecentFiles()); // This is redundant if loadAndRenderFlow calls addRecentFile
}

// --- NEW EVENT LISTENER ---
export async function handleOpenFile() {
    // Triggered by the "Open Flow" button
    if (appState.isLoading) return;
    if (!await confirmStopContinuousRun(`Opening a new file`)) {
        return;
    }
    if (!confirmDiscardChanges()) {
        return; // User cancelled discarding changes
    }

    logger.info("Requesting open file dialog...");
    setLoading(true, 'global');
    clearMessages();

    try {
        if (!window.electronAPI) throw new Error("Electron API not available.");
        const result = await window.electronAPI.showOpenFile();

        if (result && result.success && !result.cancelled && result.filePath) {
            logger.info("File selected:", result.filePath);
            // Load and render the selected file
            await loadAndRenderFlow(result.filePath);
            // Selection highlight updated within loadAndRenderFlow -> addRecentFile
        } else if (result && result.success && result.cancelled) {
            logger.info("Open file dialog cancelled.");
        } else if (result && !result.success && result.error) {
            let userMsg = result.error;
            if (result.code === 'ENOENT') userMsg = 'File not found. Please check the path.';
            else if (result.code === 'EACCES') userMsg = 'Permission denied. You do not have access to this file.';
            else if (result.code === 'EISDIR') userMsg = 'Cannot open: Path is a directory.';
            else if (result.code === 'EPERM') userMsg = 'Operation not permitted. Check your permissions.';
            else if (result.code === 'EMFILE') userMsg = 'Too many files open. Please close some files and try again.';
            showMessage(`Error opening file: ${userMsg}`, 'error');
            clearWorkspace(true);
            initializeAppComponents(); // <-- MODIFIED: Call initializeAppComponents
            return;
        } else {
            logger.warn("Unexpected response from showOpenFile:", result);
            throw new Error('Received unexpected response when trying to open file.');
        }
    } catch (error) {
        logger.error('Error opening file:', error);
        showMessage(`Error opening file: ${error.message}`, 'error');
        // Don't clear workspace on cancel, only on error
        if (error.message !== 'Open file dialog cancelled.') {
            clearWorkspace(true); // Clear workspace on actual error
            initializeAppComponents(); // <-- MODIFIED: Call initializeAppComponents
        }
    } finally {
        setLoading(false, 'global');
    }
}


// --- MODIFIED FUNCTION ---
export async function handleCreateNewFlow() {
    if (appState.isLoading) return;

    if (!await confirmStopContinuousRun(`Creating a new flow`)) {
        return;
    }

    if (!confirmDiscardChanges()) {
        return; // User cancelled discarding changes
    }

    logger.info("Creating new flow...");
    clearWorkspace(false); // Clear workspace but keep titles etc. temporarily
    initializeAppComponents(); // <-- MODIFIED: Call initializeAppComponents
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
export async function handleCloneFlow() {
    // Clones the *current* flow in memory, marks as dirty, clears file path
    if (appState.isLoading || !appState.currentFlowModel) {
        showMessage("No flow loaded to clone.", "warning");
        return;
    }

    // No need to confirm discard for cloning, as we're cloning the current state.
    // If the current state IS dirty, the clone will also be dirty, which is correct.

    logger.info("Cloning current flow in memory...");
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

        initializeAppComponents(); // <-- MODIFIED: Call initializeAppComponents
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
        logger.error('Error cloning flow:', error);
        showMessage(`Error preparing clone: ${error.message}`, 'error');
    } finally {
        setLoading(false, 'global');
    }
}

// --- MODIFIED FUNCTION ---
// Functionality removed as file deletion is handled by the OS.
export function handleDeleteFlow( /* flowId */ ) {
    // This function is no longer needed for local file management.
    // Deletion is handled by the user through the operating system's file explorer.
    // Associated UI buttons should be removed from the flow list item rendering.
    logger.warn("handleDeleteFlow function called, but file deletion should be handled via OS.");
    showMessage("To delete a flow, please remove the corresponding '.flow.json' file using your file explorer.", "info");
}


// --- MODIFIED FUNCTION ---
export async function loadAndRenderFlow(filePath, moveToTop = true) {
    // Core function to load data from a file path and update the UI
    if (!filePath) {
        logger.warn("loadAndRenderFlow called with no filePath.");
        return false;
    }
    setLoading(true, 'global');
    clearWorkspace(false); // Clear views but keep titles etc.
    clearMessages();
    let success = false;

    try {
         if (!window.electronAPI) throw new Error("Electron API not available.");
        logger.info(`Reading file via IPC: ${filePath}`);
        const result = await window.electronAPI.readFile(filePath);

        if (result && result.success) {
            logger.info(`File read success: ${filePath}`);
            const flowDataJson = result.data;
            try {
                // Attempt to parse the JSON content
                const flowData = JSON.parse(flowDataJson);
                appState.currentFlowModel = jsonToFlowModel(flowData); // Convert to internal model
                appState.currentFilePath = filePath; // Store the path of the loaded file
                appState.stepEditorIsDirty = false; // Reset editor dirty state on load
                appState.isDirty = false; // Not dirty initially

                initializeAppComponents(); // <-- MODIFIED: Call initializeAppComponents
                renderCurrentFlow(); // Render the currently active view
                updateWorkspaceTitle(); // Reflects new flow name and path
                addRecentFile(filePath, moveToTop); // Add successfully loaded file to recents

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
                 logger.error(`Error parsing JSON from file ${filePath}:`, parseError);
                 throw new Error(`File is not valid JSON: ${parseError.message}`);
            }
        } else if (result && !result.success && result.error) {
            let userMsg = result.error;
            if (result.code === 'ENOENT') userMsg = 'File not found. Please check the path.';
            else if (result.code === 'EACCES') userMsg = 'Permission denied. You do not have access to this file.';
            else if (result.code === 'EISDIR') userMsg = 'Cannot open: Path is a directory.';
            else if (result.code === 'EPERM') userMsg = 'Operation not permitted. Check your permissions.';
            else if (result.code === 'EMFILE') userMsg = 'Too many files open. Please close some files and try again.';
            showMessage(`Error opening file: ${userMsg}`, 'error');
            clearWorkspace(true);
            initializeAppComponents(); // <-- MODIFIED: Call initializeAppComponents
            return false;
        } else {
            logger.warn("Unexpected response from readFile IPC:", result);
            throw new Error('Unexpected response when trying to read file.');
        }

    } catch (error) {
        logger.error(`Error loading flow from ${filePath}:`, error);
        showMessage(`Error loading flow: ${error.message}`, 'error');
        clearWorkspace(true); // Clear fully on error
        initializeAppComponents(); // <-- MODIFIED: Call initializeAppComponents
        appState.currentFilePath = null; // Clear path on error
        updateWorkspaceTitle(); // Reset title
        success = false;
    } finally {
        setLoading(false, 'global');
    }
    return success;
}


// --- Saving Flow (Local Files) ---

// --- [Modified Code] in app.js ---
export async function saveCurrentFlow(forceSaveAs = false) {
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
         logger.info("Step editor is dirty. Attempting programmatic commit before flow save...");
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
                  logger.info("Step editor changes committed successfully.");

              } else if (saveBtn?.disabled) {
                   throw new Error("Unsaved changes in the step editor could not be committed (Save button is disabled). Please review the step configuration.");
              } else {
                   logger.warn("Step editor is dirty, but save button not found. Cannot commit changes.");
                   // This indicates a potential UI structure issue or the editor wasn't rendered correctly.
                   throw new Error("Unsaved changes in the step editor could not be committed (UI Error).");
              }
         } catch (commitError) {
              logger.error("Error committing step editor changes:", commitError);
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
            logger.info("Requesting save file dialog (Save As)...");
            let suggestedName = (appState.currentFlowModel.name || 'untitled').replace(/[/\\?%*:|"<>]/g, '_');
            if (!suggestedName.toLowerCase().endsWith('.flow.json')) {
                suggestedName += '.flow.json';
            }

            const result = await window.electronAPI.showSaveFile(suggestedName);

            if (result?.success && !result.cancelled && result.filePath) {
                targetFilePath = result.filePath;
                if (!targetFilePath.toLowerCase().endsWith('.flow.json')) {
                    targetFilePath += '.flow.json';
                    logger.info(`Appended extension, final path: ${targetFilePath}`);
                } else { logger.info("Save As path selected:", targetFilePath); }
            } else if (result?.success && result.cancelled) {
                 logger.info("Save As dialog cancelled.");
                 throw new Error("Save cancelled by user."); // Graceful exit
            } else {
                throw new Error(result?.error || 'Failed to show save dialog.');
            }
        }

        // --- Serialize and Write ---
        logger.info(`Saving flow to: ${targetFilePath}`);
        // Use null replacer, 2 spaces for pretty printing
        const flowJsonString = JSON.stringify(flowModelToJson(appState.currentFlowModel), null, 2);

        const writeResult = await window.electronAPI.writeFile(targetFilePath, flowJsonString);

        if (writeResult?.success) {
            logger.info(`[SAVE SUCCESS] File write successful to ${targetFilePath}. Resetting dirty state...`);
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
            logger.info("[SAVE SUCCESS] Calling setDirty(false) to update button state.");
            setDirty(false); // Ensure save buttons are disabled

        } else if (writeResult && !writeResult.success && writeResult.error) {
            let userMsg = writeResult.error;
            if (writeResult.code === 'ENOENT') userMsg = 'File path does not exist. Please choose a valid location.';
            else if (writeResult.code === 'EACCES') userMsg = 'Permission denied. You do not have access to write to this file.';
            else if (writeResult.code === 'EISDIR') userMsg = 'Cannot write: Path is a directory.';
            else if (writeResult.code === 'EPERM') userMsg = 'Operation not permitted. Check your permissions.';
            else if (writeResult.code === 'EMFILE') userMsg = 'Too many files open. Please close some files and try again.';
            showMessage(`Error saving file: ${userMsg}`, 'error');
            setLoading(false, 'global');
            return false;
        } else {
            throw new Error(writeResult?.error || 'Failed to write file via IPC.');
        }

    } catch (error) {
        logger.error('[SAVE FAILURE] Save error occurred:', error);
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
export async function handleSaveAs() {
    // Simply calls saveCurrentFlow forcing the Save As dialog
    await saveCurrentFlow(true);
}

export async function handleCloseFlow() {
    if (!await confirmStopContinuousRun(`Closing the current flow`)) {
        return;
    }

    if (!appState.currentFlowModel) {
        // console.log("Close Flow: No flow loaded."); // Covered by disabled state generally
        showMessage("No flow is currently loaded to close.", "info");
        return;
    }

    // confirmDiscardChanges will prompt if dirty.
    // It also resets dirty flags and calls setDirty() if the user proceeds.
    if (!confirmDiscardChanges()) {
        return; // User chose not to discard changes (and thus not to close)
    }

    // If confirmDiscardChanges returned true, it means either:
    // 1. Flow wasn't dirty.
    // 2. Flow was dirty, user confirmed discard, and dirty flags are now false.
    // In both cases, we can proceed to close.

    logger.info("Closing current flow. Clearing workspace.");
    setLoading(true, 'global');
    showMessage("Closing flow...", "info", domRefs.builderMessages);

    try {
        clearWorkspace(true); // Full clear of model, path, selected step, dirty flags, etc.
        // CRITICAL: initializeAppComponents must be called AFTER clearWorkspace
        // if clearWorkspace nullifies component instances (which it does).
        initializeAppComponents();

        // UI updates after clearing
        updateWorkspaceTitle(); // Should reflect no flow loaded
        renderFlowList(getRecentFiles()); // Update recent list (no selection or reflect last state)
        updateViewToggle(); // Hide view toggle
        handleClearResults(); // Clear runner state as well
        updateRunnerUI(); // Update runner buttons (should be disabled)

        showMessage("Flow closed.", "success", domRefs.builderMessages);
    } catch (error) {
        logger.error("Error during close flow operation:", error);
        showMessage(`Error closing flow: ${error.message}`, "error", domRefs.builderMessages);
    } finally {
        setLoading(false, 'global');
        // setDirty() was already called by confirmDiscardChanges if proceed, or by clearWorkspace.
        // Call it one more time to ensure all states are synced after potential errors or full clear.
        setDirty();
    }
}

export async function handleCancelFlow() {
    if (!await confirmStopContinuousRun(`Cancelling changes`)) {
        return;
    }

    if (!appState.currentFlowModel) {
        showMessage("No flow is currently loaded to cancel.", "info");
        return;
    }

    if (appState.isDirty || appState.stepEditorIsDirty) {
        if (!confirm("You have unsaved changes. Are you sure you want to cancel and revert them?")) {
            return; // User chose not to discard changes
        }
    }

    setLoading(true, 'global');
    showMessage("Reverting changes...", "info", domRefs.builderMessages);

    try {
        if (appState.currentFilePath) {
            // Revert to the saved version by reloading the file
            logger.info(`Cancelling changes, reverting to saved file: ${appState.currentFilePath}`);
            const success = await loadAndRenderFlow(appState.currentFilePath, false);
            if (success) {
                showMessage("Changes reverted to last saved version.", "success", domRefs.builderMessages);
            } else {
                // loadAndRenderFlow would have shown an error, but we can add a general one here
                showMessage("Failed to revert flow to saved version. The flow might be in an inconsistent state. Workspace will be cleared.", "error", domRefs.builderMessages);
                // Attempt to clear to a known good state if reload fails
                clearWorkspace(true);
                initializeAppComponents(); // Critical after clearWorkspace
                updateWorkspaceTitle();
                renderFlowList(getRecentFiles()); // << Ensure recent files list is updated
                updateViewToggle();           // << Ensure view toggle is updated
                handleClearResults();         // << Ensure runner is cleared
                updateRunnerUI();             // << Ensure runner UI is updated
            }
        } else {
            // This was a new, unsaved flow. "Cancelling" it means clearing and starting with a fresh template.
            logger.info("Cancelling new, unsaved flow. Resetting to a new template flow.");
            clearWorkspace(true); // Full clear of model, path, selected step, dirty flags
            initializeAppComponents(); // Re-initialize UI components after clearing them

            appState.currentFlowModel = createTemplateFlow(); // Get a fresh template
            appState.currentFilePath = null;
            appState.selectedStepId = null;
            appState.isDirty = false; // A "cancelled" new flow is considered clean
            appState.stepEditorIsDirty = false;

            renderCurrentFlow(); // Render the new empty flow
            updateWorkspaceTitle();
            showMessage("New flow changes discarded. Workspace reset.", "info", domRefs.builderMessages);
            handleClearResults(); // Also clear runner for the "new" flow state
            updateRunnerUI();
        }
    } catch (error) {
        logger.error("Error during cancel flow operation:", error);
        showMessage(`Error cancelling flow: ${error.message}`, "error", domRefs.builderMessages);
    } finally {
        setLoading(false, 'global');
        setDirty(); // Update all button states based on the new (likely clean) state
    }
}

// --- NEW HELPER: Confirm stopping continuous run ---
async function confirmStopContinuousRun(actionDescription = "This action") {
    if (appState.isContinuousRunActive) {
        if (confirm(`${actionDescription} will stop the currently running continuous flow. Continue?`)) {
            handleStopFlow(); // Stop the continuous flow
            return true; // User confirmed
        } else {
            return false; // User cancelled
        }
    }
    return true; // Not active, so proceed
}