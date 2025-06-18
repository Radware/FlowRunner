// ========== FILE: eventHandlers.js (UPDATED with logging) ==========

import { appState, domRefs } from './state.js';
import {
    handleCreateNewFlow, handleOpenFile, handleFlowListActions,
    saveCurrentFlow, handleSaveAs, confirmDiscardChanges,
    handleCancelFlow, handleCloseFlow
} from './fileOperations.js';
import {
    handleRunFlow, handleStepFlow, handleStopFlow,
    handleClearResults, handleDelayChange
} from './runnerInterface.js';
import {
    showAppStepTypeDialog, initializeStepTypeDialogListeners,
    initializeVarDropdownListeners, initializeVariableInsertionListener,
} from './dialogs.js';
import {
    handleToggleSidebarCollapse, handleToggleRunnerCollapse
} from './appFeatures.js';
import {
    renderCurrentFlow, setDirty, syncPanelVisibility, showMessage,
    updateWorkspaceTitle, updateViewToggle, updateDefinedVariables
} from './uiUtils.js';
import {
    addNestedStepToModel, deleteStepFromModel, moveStepInModel,
    cloneStepInModel, findStepInfoRecursive
} from './modelUtils.js';
import { createNewStep, escapeHTML, findStepById } from './flowCore.js';
import { logger } from './logger.js';

// --- Initialization of Listeners ---

export function initializeEventListeners() {
    logger.info("Initializing core event listeners (consolidated)...");

    // --- Sidebar Actions ---
    domRefs.addFlowBtn?.addEventListener('click', handleCreateNewFlow);
    domRefs.openFlowBtn?.addEventListener('click', handleOpenFile);
    domRefs.flowList?.addEventListener('click', handleFlowListActions); // Handles recent file selection & removal

    // --- Workspace Header File Controls ---
    domRefs.saveFlowBtn?.addEventListener('click', () => saveCurrentFlow(false));
    domRefs.saveAsFlowBtn?.addEventListener('click', handleSaveAs);
    domRefs.cancelFlowBtn?.addEventListener('click', handleCancelFlow);
    domRefs.closeFlowBtn?.addEventListener('click', handleCloseFlow);

    // --- Workspace Header View/Panel Controls ---
    domRefs.toggleViewBtn?.addEventListener('click', handleToggleView); // Toggles List/Graph view

    // Info Panel Toggle Button (Main Header) - Toggles based on current state
    domRefs.toggleInfoBtn?.addEventListener('click', () => handleToggleInfoOverlay());

    // Variables Panel Toggle Button (Main Header) - Toggles based on current state
    domRefs.toggleVariablesBtn?.addEventListener('click', () => handleToggleVariablesPanel());

    // Zoom Controls
    domRefs.zoomInBtn?.addEventListener('click', () => appState.visualizerComponent?.zoomIn());
    domRefs.zoomOutBtn?.addEventListener('click', () => appState.visualizerComponent?.zoomOut());
    domRefs.zoomResetBtn?.addEventListener('click', () => appState.visualizerComponent?.resetZoom());
    domRefs.toggleMinimapBtn?.addEventListener('click', () => handleToggleMinimap());

    // Info Panel Close Button (Inside Panel) - Explicitly closes
    domRefs.actualInfoOverlayCloseBtn?.addEventListener('click', () => handleToggleInfoOverlay(false));

    // Variables Panel Close Button (Inside Panel) - Explicitly closes
    domRefs.actualVariablesPanelCloseBtn?.addEventListener('click', () => handleToggleVariablesPanel(false));

    // --- Runner Controls ---
    domRefs.runFlowBtn?.addEventListener('click', handleRunFlow);
    domRefs.stepFlowBtn?.addEventListener('click', handleStepFlow);
    domRefs.stopFlowBtn?.addEventListener('click', handleStopFlow);
    domRefs.clearResultsBtn?.addEventListener('click', handleClearResults);
    domRefs.requestDelayInput?.addEventListener('change', handleDelayChange);
    // Listener for continuous run checkbox needs to be handled carefully due to state management
    domRefs.continuousRunCheckbox?.addEventListener('change', (event) => {
        // The checkbox state is now just a UI preference.
        // appState.isContinuousRunActive will be set by handleRunFlow when a continuous run *actually starts*.
        // No need to call updateRunnerUI() from here as the run button's availability isn't directly
        // tied to the checkbox's state, but rather to whether a run is *already* in progress.
        logger.info(`Continuous Run checkbox preference changed by user. User selected: ${event.target.checked}`);
        // appState.isContinuousRunActive = event.target.checked; // <-- THIS LINE SHOULD BE REMOVED OR COMMENTED
        // updateRunnerUI(); // <-- THIS LINE SHOULD BE REMOVED OR COMMENTED
    });


    // --- Pane Collapse Toggle Buttons ---
    domRefs.sidebarToggleBtn?.addEventListener('click', handleToggleSidebarCollapse);
    domRefs.runnerToggleBtn?.addEventListener('click', handleToggleRunnerCollapse);

    // --- Dialog Initializers (Listeners for dialogs themselves) ---
    initializeStepTypeDialogListeners(); // Step type selection modal
    initializeVarDropdownListeners();   // Variable dropdown itself (search, close)
    initializeVariableInsertionListener(); // Global listener for {{...}} buttons

    // Make step type dialog function globally accessible (if needed by other components)
    window.showAppStepTypeDialog = showAppStepTypeDialog;


    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', function(e) {
        const target = e.target;
        const tag = (target?.tagName || '').toLowerCase();

        // Ignore shortcuts if focus is on an input, textarea, or contenteditable element
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
            // Allow Esc for Stop even in inputs
            if (e.key === 'Escape') {
                e.preventDefault();
                handleStopFlow();
            }
            return;
        }


        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

        // File Operations
        if (ctrlOrCmd && e.key.toLowerCase() === 's') {
            e.preventDefault();
            // Trigger save only if enabled
            if (!domRefs.saveFlowBtn?.disabled) {
                saveCurrentFlow(false);
            }
        }
        if (ctrlOrCmd && e.key.toLowerCase() === 'o') {
            e.preventDefault();
             // Trigger open only if enabled
            if (!domRefs.openFlowBtn?.disabled) {
                handleOpenFile();
            }
        }

        // Runner Controls
        if (e.key === 'F5') {
            e.preventDefault();
            // Trigger run only if enabled
            if (!domRefs.runFlowBtn?.disabled) {
                handleRunFlow();
            }
        }
        if (e.key === 'F10') {
            e.preventDefault();
            // Trigger step only if enabled
            if (!domRefs.stepFlowBtn?.disabled) {
                handleStepFlow();
            }
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            // Trigger stop only if enabled
             if (!domRefs.stopFlowBtn?.disabled) {
                 handleStopFlow();
             }
        }

        if (ctrlOrCmd && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            domRefs.zoomInBtn?.click();
        }
        if (ctrlOrCmd && (e.key === '-' || e.key === '_')) {
            e.preventDefault();
            domRefs.zoomOutBtn?.click();
        }
        if (ctrlOrCmd && e.key === '0') {
            e.preventDefault();
            domRefs.zoomResetBtn?.click();
        }

        // View/Panel Toggles
        if (ctrlOrCmd && e.key === '1') {
            e.preventDefault();
            domRefs.toggleInfoBtn?.click(); // Simulate click on the button
        }
        if (ctrlOrCmd && e.key === '2') {
            e.preventDefault();
            domRefs.toggleVariablesBtn?.click(); // Simulate click on the button
        }
        if (ctrlOrCmd && e.key === '3') {
            e.preventDefault();
            domRefs.toggleViewBtn?.click(); // Simulate click on the button
        }

        if (e.key.toLowerCase() === 'm' && appState.currentView === 'node-graph') {
            e.preventDefault();
            domRefs.toggleMinimapBtn?.click();
        }
    });

    logger.info("All core event listeners initialized.");
}

// --- View and Panel Toggles ---

export function handleToggleView() {
    if (!appState.currentFlowModel) return; // Cannot toggle view without a loaded flow
    appState.currentView = (appState.currentView === 'list-editor') ? 'node-graph' : 'list-editor';
    updateViewToggle(); // Update the toggle button text/title
    renderCurrentFlow(); // Re-render the appropriate view

    // Ensure panels are closed when switching views to avoid overlap/confusion
    if (appState.isInfoOverlayOpen) handleToggleInfoOverlay(false);
    if (appState.isVariablesPanelVisible) handleToggleVariablesPanel(false);
}

export function handleToggleInfoOverlay(forceState = null) {
    const infoOverlay = domRefs.infoOverlay;
    if (!infoOverlay) {
        logger.warn("Info overlay element not found, cannot toggle.");
        return;
    }

    const willBeOpen = forceState ?? !appState.isInfoOverlayOpen;

    // Close variables panel if info overlay is opening
    if (willBeOpen && appState.isVariablesPanelVisible) {
        handleToggleVariablesPanel(false); // Call the toggle function to ensure proper state update
    }

    appState.isInfoOverlayOpen = willBeOpen;
    infoOverlay.classList.toggle('open', willBeOpen);

    // No need to update button state here - syncPanelVisibility does it
    syncPanelVisibility(); // Sync button states and potentially other UI elements
}

export function handleToggleVariablesPanel(forceState = null) {
    const variablesPanel = domRefs.variablesPanel;
    if (!variablesPanel) {
        logger.warn("Variables panel element not found, cannot toggle.");
        return;
    }

    const willBeVisible = forceState ?? !appState.isVariablesPanelVisible;

    // Close info overlay if variables panel is opening
    if (willBeVisible && appState.isInfoOverlayOpen) {
        handleToggleInfoOverlay(false); // Call the toggle function
    }

    appState.isVariablesPanelVisible = willBeVisible;
    variablesPanel.classList.toggle('visible', willBeVisible);

    // No need to update button state here - syncPanelVisibility does it
    syncPanelVisibility(); // Sync button states and potentially other UI elements
}

export function handleToggleMinimap(forceState = null) {
    if (!appState.visualizerComponent) return;
    const willBeVisible = forceState ?? !appState.visualizerComponent.isMinimapVisible();
    if (willBeVisible) {
        appState.visualizerComponent.showMinimap();
    } else {
        appState.visualizerComponent.hideMinimap();
    }
    syncPanelVisibility();
}


// --- Callbacks for Global Overlay (Name, Desc, Headers, Vars) ---
// These functions are now called directly from app.js listeners for the global overlay content changes.
// They update the central appState.currentFlowModel and trigger necessary UI updates.

export function handleBuilderFlowUpdate({ name, description }) { // Called by app.js global handlers
    if (appState.currentFlowModel) {
        const nameChanged = appState.currentFlowModel.name !== name;
        const descriptionChanged = appState.currentFlowModel.description !== description;

        if (nameChanged || descriptionChanged) {
             if(nameChanged) appState.currentFlowModel.name = name;
             if(descriptionChanged) appState.currentFlowModel.description = description;
             appState.isDirty = true;
             setDirty(); // Update dirty state and button enablement
             updateWorkspaceTitle(); // Reflect new name/dirty state in title
        }
    }
}

export function handleBuilderHeadersUpdate(headers) { // Called by app.js global handlers
    if (appState.currentFlowModel) {
        const currentHeaders = appState.currentFlowModel.headers || {};
        const newHeaders = headers || {};
        // Check if headers actually changed before marking dirty
        if (JSON.stringify(currentHeaders) !== JSON.stringify(newHeaders)) {
            appState.currentFlowModel.headers = newHeaders;
            appState.isDirty = true;
            setDirty();
        }
    }
}

export function handleBuilderFlowVarsUpdate(staticVars) { // Called by app.js global handlers
     if (appState.currentFlowModel) {
        const currentVars = appState.currentFlowModel.staticVars || {};
        const newVars = staticVars || {};
        // Check if variables actually changed
        if (JSON.stringify(currentVars) !== JSON.stringify(newVars)) {
            appState.currentFlowModel.staticVars = newVars;
            appState.isDirty = true;
            setDirty();
            updateDefinedVariables(); // Update the Variables panel display
        }
    }
}


// --- Component Callbacks (FlowBuilderComponent, FlowVisualizer) ---

export function handleBuilderStepSelect(stepId) {
    if (appState.selectedStepId === stepId) return; // No action if already selected

    // Check for unsaved changes in the *currently open* editor before switching
    if (appState.stepEditorIsDirty) {
         if (!confirm("You have unsaved changes in the current step editor. Discard changes and select the new step?")) {
             // User cancelled, do not proceed with selection change
             // Optionally, re-highlight the original step if UI deselects on click attempt
             renderCurrentFlow(); // Re-render to ensure selection remains correct
             return;
         }
         logger.info("Discarding step editor changes due to step selection change.");
         appState.stepEditorIsDirty = false; // Mark editor as clean since changes are discarded
         // setDirty() will be called later to update overall state if needed
    }

    appState.selectedStepId = stepId;
    logger.info("Step selected:", stepId);
    renderCurrentFlow(); // Re-render to show new selection and potentially load editor
    setDirty(); // Update overall dirty state/buttons (editor is now clean)
}

export function handleBuilderStepEdit(updatedStepData) {
    // This is called when the "Save Step" button within the editor panel is clicked
    if (!appState.currentFlowModel || !updatedStepData || !updatedStepData.id) return;

    let foundAndUpdated = false;
    let modelChanged = false;

    // Recursive function to find and update the step in the nested structure
    const updateRecursively = (steps) => {
        if (!steps || !Array.isArray(steps)) return steps;
        return steps.map(step => {
            if (step.id === updatedStepData.id) {
                foundAndUpdated = true;
                // Check if data actually changed before setting modelChanged
                if (JSON.stringify(step) !== JSON.stringify(updatedStepData)) {
                    modelChanged = true;
                }
                return { ...updatedStepData }; // Return the completely updated step data
            }
            // Recurse into children
            let newThen = step.thenSteps;
            let newElse = step.elseSteps;
            let newLoop = step.loopSteps;
            let childrenChanged = false;

            if (step.type === 'condition') {
                 newThen = updateRecursively(step.thenSteps);
                 newElse = updateRecursively(step.elseSteps);
                 if (newThen !== step.thenSteps || newElse !== step.elseSteps) childrenChanged = true;
            } else if (step.type === 'loop') {
                 newLoop = updateRecursively(step.loopSteps);
                 if (newLoop !== step.loopSteps) childrenChanged = true;
            }
            // If children changed, return a new step object with updated children
            return childrenChanged ? { ...step, thenSteps: newThen || [], elseSteps: newElse || [], loopSteps: newLoop || [] } : step;
        });
    };

    const originalStepsJson = JSON.stringify(appState.currentFlowModel.steps); // Snapshot before update
    const newSteps = updateRecursively(appState.currentFlowModel.steps);

    if (foundAndUpdated) {
        appState.currentFlowModel.steps = newSteps; // Update the model with potentially modified steps array

        if (modelChanged) {
             appState.isDirty = true; // Mark flow as dirty because step content changed
             logger.debug(`Step ${updatedStepData.id} saved with changes.`);
        } else {
            logger.debug(`Step ${updatedStepData.id} saved, but no effective changes detected in step data.`);
             // If only the editor was dirty but no actual data changed, the flow might not be dirty
             // But usually, if the editor was dirty, some change was made.
        }

        appState.stepEditorIsDirty = false; // Editor changes are now saved (committed)
        setDirty(); // Update UI buttons based on new appState.isDirty and appState.stepEditorIsDirty
        renderCurrentFlow(); // Re-render to reflect any changes in the list/graph view preview
        updateDefinedVariables(); // Update variable list if step change affected definitions (e.g., extract)

    } else {
        logger.warn(`Could not find step with ID ${updatedStepData.id} to apply edits.`);
         // Should not happen if the editor was open for this step, but handle defensively
         appState.stepEditorIsDirty = false; // Reset editor dirty state anyway
         setDirty();
    }
}

export function handleBuilderStepUpdate(action) {
     // Handles actions like add, delete, move, clone originating from UI interactions (list view or visualizer)
     if (!appState.currentFlowModel) return;

     let modelChanged = false;
     let newSelectedStepId = appState.selectedStepId;
     let errorMessage = null;

     // Ensure steps array exists
     appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];

     try {
         switch (action.type) {
             case 'add': // Add a new step
                 if (!action.step) {
                     errorMessage = "Add action missing step data."; break;
                 }
                 if (!action.parentId) { // Add to top level
                     appState.currentFlowModel.steps.push(action.step);
                     modelChanged = true;
                 } else { // Add nested step
                     modelChanged = addNestedStepToModel(action.step, action.parentId, action.branch);
                 }
                 if (modelChanged) {
                     newSelectedStepId = action.step.id; // Select the newly added step
                     showMessage(`Step "${escapeHTML(action.step.name)}" added.`, 'success');
                 } else {
                      errorMessage = `Failed to add step "${escapeHTML(action.step.name)}". Parent or branch invalid?`;
                 }
                 break;

             case 'move': // Move an existing step (drag/drop)
                 if (!action.sourceStepId || !action.targetStepId || !action.position) {
                     errorMessage = "Move action missing required IDs or position."; break;
                 }
                 modelChanged = moveStepInModel(action.sourceStepId, action.targetStepId, action.position);
                 if (modelChanged) {
                     newSelectedStepId = action.sourceStepId; // Keep the moved step selected
                     // moveStepInModel shows its own messages on success/error
                 } else {
                      // moveStepInModel handles its own error message display
                      errorMessage = null;
                 }
                 break;

             case 'delete': // Delete a step
                 if (!action.stepId) {
                      errorMessage = "Delete action missing step ID."; break;
                 }
                 const stepToDeleteInfo = findStepInfoRecursive(appState.currentFlowModel.steps, action.stepId);
                 const stepName = stepToDeleteInfo ? stepToDeleteInfo.step.name : `step ${action.stepId}`;

                 if (confirm(`Are you sure you want to delete step "${escapeHTML(stepName)}"? This cannot be undone and includes any nested steps.`)) {
                     modelChanged = deleteStepFromModel(action.stepId);
                     if (modelChanged) {
                         if (appState.selectedStepId === action.stepId) newSelectedStepId = null; // Deselect if deleted
                         showMessage(`Step "${escapeHTML(stepName)}" deleted.`, 'success');
                     } else {
                          errorMessage = `Failed to delete step "${escapeHTML(stepName)}". Step not found?`;
                     }
                 } else {
                     modelChanged = false; // User cancelled deletion
                 }
                 break;

             case 'clone': // Clone a step
                  if (!action.originalStep || !action.newStep) {
                      errorMessage = "Clone action missing required step data."; break;
                  }
                  // cloneStepInModel handles finding the original and inserting the new one after it
                  modelChanged = cloneStepInModel(action.originalStep, action.newStep);
                  if (modelChanged) {
                      newSelectedStepId = action.newStep.id; // Select the newly cloned step
                      showMessage(`Step "${escapeHTML(action.originalStep.name)}" cloned.`, 'success');
                  } else {
                       errorMessage = `Failed to clone step "${escapeHTML(action.originalStep.name)}". Original not found?`;
                  }
                 break;

             default:
                 logger.warn("Unknown step update action received:", action.type);
         }
     } catch (error) {
          logger.error(`Error processing step update action (${action.type}):`, error);
          errorMessage = `An unexpected error occurred during the ${action.type} operation: ${error.message}`;
          modelChanged = false; // Ensure model isn't marked dirty on unexpected error
     }

     // If the model was successfully changed by the action
     if (modelChanged) {
         appState.isDirty = true; // Mark flow as dirty
         appState.selectedStepId = newSelectedStepId; // Update selection if needed
         setDirty(); // Update UI button states
         updateDefinedVariables(); // Update variables panel if structure changed
         renderCurrentFlow(); // Re-render the view to reflect the change
     } else if (errorMessage) {
         // Show error message if the action failed predictably
         showMessage(errorMessage, 'error');
     }
}

// --- Visualizer Specific Callbacks ---

export function handleVisualizerNodeMove(sourceId, targetId, position) {
    // DEPRECATED / REDUNDANT if visualizer drag/drop only updates layout
    // If the visualizer drag/drop were intended to change logical order (like list view),
    // this would be called. Currently, visualizer drag/drop seems to only update XY coords.
    logger.warn("handleVisualizerNodeMove called - This implies logical reordering from graph view, which is currently not the primary interaction model. Check if intended.");
    // if (!appState.currentFlowModel || !sourceId || !targetId) return;
    // console.log(`Visualizer logical move requested: ${sourceId} ${position} ${targetId}`);
    // handleBuilderStepUpdate({
    //     type: 'move',
    //     sourceStepId: sourceId,
    //     targetStepId: targetId,
    //     position: position,
    // });
}

// --- UPDATED: handleVisualizerNodeLayoutUpdate with Logging ---
export function handleVisualizerNodeLayoutUpdate(stepId, x, y, options = {}) {
    // Called when a node is dropped in the visualizer after free dragging OR collapsed state changes
    // +++ ADD DETAILED LOGGING +++
    logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Received update for step ${stepId} at (${x}, ${y}), options:`, JSON.stringify(options));
    // +++ END LOGGING +++

    if (!appState.currentFlowModel || !stepId) {
        logger.warn(`[HANDLER handleVisualizerNodeLayoutUpdate] Aborted: No current flow model or stepId missing.`);
        return;
    }

    // Ensure the visualLayout object exists
    appState.currentFlowModel.visualLayout = appState.currentFlowModel.visualLayout || {};

    const currentLayout = appState.currentFlowModel.visualLayout[stepId] || {};
    // +++ ADD LOGGING +++
    logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Current stored layout for ${stepId}: x=${currentLayout.x}, y=${currentLayout.y}, collapsed=${currentLayout.collapsed}`);
    // +++ END LOGGING +++

    let layoutChanged = false;
    let positionChanged = false;
    let collapseChanged = false;

    // Check if position actually changed significantly
    if (typeof x === 'number' && typeof y === 'number') {
        // Use 0 as default for comparison if currentLayout doesn't have x/y yet
        const currentX = currentLayout.x ?? 0;
        const currentY = currentLayout.y ?? 0;
        const dx = Math.abs(currentX - x);
        const dy = Math.abs(currentY - y);
        // Use a small tolerance for floating point comparisons
        positionChanged = dx > 0.1 || dy > 0.1;
        if(positionChanged) {
            logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Position change detected for ${stepId}. dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}`);
        }
    }

    // Check if collapse state changed
    if (options.collapsed !== undefined && currentLayout.collapsed !== options.collapsed) {
        collapseChanged = true;
        logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Collapse state change detected for ${stepId}. New state: ${options.collapsed}`);
    }

    // Proceed only if position or collapse state actually changed
    if (positionChanged || collapseChanged) {
        logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Applying layout changes for ${stepId}.`);

        // Create a new layout object by merging current and new properties
        const newLayout = {
            ...currentLayout,
            ...(positionChanged && { x, y }),
            ...(collapseChanged && { collapsed: options.collapsed })
        };

        // Update the model
        appState.currentFlowModel.visualLayout[stepId] = newLayout;
         // +++ ADD LOGGING +++
        logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Updated appState.currentFlowModel.visualLayout[${stepId}] to:`, JSON.stringify(newLayout));
         // +++ END LOGGING +++

        // Mark the flow as dirty
        appState.isDirty = true;
         // +++ ADD LOGGING +++
        logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Set appState.isDirty = true.`);
         // +++ END LOGGING +++

        // Update UI elements reflecting the dirty state (like Save button)
        setDirty();
         // +++ ADD LOGGING +++
        logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] Called setDirty().`);
         // +++ END LOGGING +++

        layoutChanged = true; // Indicate that a change was made

        // --- CRITICAL ---
        // DO NOT CALL renderCurrentFlow() or visualizer.render() here.
        // The visualizer instance handles the visual move internally during drag.
        // This callback's role is to update the central *data model* and the *dirty state*.
        // Triggering a full re-render from here based on potentially not-yet-fully-synced state
        // is a primary cause of snap-back issues.
        // --- END CRITICAL ---

    } else {
        logger.debug(`[HANDLER handleVisualizerNodeLayoutUpdate] No significant layout change detected for ${stepId}. No model update or dirty state change.`);
    }
}
// --- END UPDATED handleVisualizerNodeLayoutUpdate ---


// --- Other Builder Callbacks ---

export function handleBuilderRequestAddStep() {
    // Called when the main "+ Add Step" button at the bottom of the list view is clicked
    if (!appState.currentFlowModel) return;
    // Show the step type selection dialog
    showAppStepTypeDialog(type => {
        if (type) {
            const newStep = createNewStep(type);
            // Trigger the 'add' action at the top level
            handleBuilderStepUpdate({
                type: 'add',
                step: newStep,
                parentId: null, // No parent for top-level add
                branch: null    // No branch for top-level add
            });
        }
        // If type is null, the user cancelled the dialog, do nothing.
    });
}

export function handleBuilderEditorDirtyChange(isEditorDirty) {
    // Called by the step editor component when its internal state changes (before saving)
    if (appState.stepEditorIsDirty !== isEditorDirty) {
        appState.stepEditorIsDirty = isEditorDirty;
        // Update overall dirty state (which affects Save/Cancel buttons)
        setDirty();
    }
}