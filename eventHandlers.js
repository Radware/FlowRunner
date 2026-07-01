// ========== FILE: eventHandlers.js (UPDATED with logging) ==========

import { appState, domRefs } from './state.js';
import {
    handleCreateNewFlow, handleOpenFile, handleFlowListActions,
    saveCurrentFlow, handleSaveAs, confirmDiscardChanges,
    handleCancelFlow, handleCloseFlow,
    getRecentFiles, handleSelectFlow
} from './fileOperations.js';
import {
    handleRunFlow,
    handleStepFlow,
    handleStopFlow,
    handleClearResults,
    handleDelayChange,
    handleEncodeUrlVarsChange,
    handleExportResultsJson,
    handleExportResultsCsv
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
    cloneStepInModel, findStepInfoRecursive, insertStepAfterInModel, moveStepToBranchStart
} from './modelUtils.js';
import { createNewStep, escapeHTML, findStepById, jsonToFlowModel } from './flowCore.js';
import { logger } from './logger.js';
// WAVE2 LANE canvas: ELK/dagre auto-layout adapter powering the "Tidy Up" button.
import { computeLayout } from './autoLayout.js';

// --- WAVE2 node-features: reusable palette overlays + View-as-JSON panel ---
import { createPalette, getStepTypeItems } from './palette.js';
import { createJsonView, flowToPrettyJson } from './jsonView.js';

// WAVE2 file-features: undo/redo (immer-patch history) + live fuzzy search.
import { undoFlow, redoFlow, canUndoFlow, canRedoFlow } from './flowHistory.js';
import { applyFileSearch, applyStepsSearch } from './uiUtils.js';

/* === WAVE3 demo-mode === presentation toggle + guided first-run onboarding. */
import { initDemoMode } from './demoMode.js';
import { maybeShowOnboarding, renderEmptyState } from './firstRun.js';

// Controller for the Demo-Mode toggle, created in initializeEventListeners so
// the keyboard shortcut and the toolbar button drive the SAME state machine.
let demoModeController = null;

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
    domRefs.autoLayoutBtn?.addEventListener('click', handleAutoArrangeLayout);
    // WAVE2 LANE canvas: Tidy Up (Alt-click = tidy only the selected step) + jump-to-next-failed.
    domRefs.tidyUpBtn?.addEventListener('click', (event) => handleTidyUp({ selectionOnly: !!event.altKey }));
    domRefs.nextErrorBtn?.addEventListener('click', handleJumpToNextError);
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
    domRefs.exportResultsJsonBtn?.addEventListener('click', handleExportResultsJson);
    domRefs.exportResultsCsvBtn?.addEventListener('click', handleExportResultsCsv);
    domRefs.requestDelayInput?.addEventListener('change', handleDelayChange);
    domRefs.encodeUrlVarsCheckbox?.addEventListener('change', handleEncodeUrlVarsChange);
    // Listener for continuous run checkbox needs to be handled carefully due to state management
    domRefs.continuousRunCheckbox?.addEventListener('change', (event) => {
        // The checkbox state is now just a UI preference.
        // appState.isContinuousRunActive will be set by handleRunFlow when a continuous run *actually starts*.
        // No need to call updateRunnerUI() from here as the run button's availability isn't directly
        // tied to the checkbox's state, but rather to whether a run is *already* in progress.
        logger.info(`Continuous Run checkbox preference changed by user. User selected: ${event.target.checked}`);
    });


    // --- Pane Collapse Toggle Buttons ---
    domRefs.sidebarToggleBtn?.addEventListener('click', handleToggleSidebarCollapse);
    domRefs.runnerToggleBtn?.addEventListener('click', handleToggleRunnerCollapse);

    // --- Dialog Initializers (Listeners for dialogs themselves) ---
    initializeStepTypeDialogListeners(); // Step type selection modal
    initializeVarDropdownListeners();   // Variable dropdown itself (search, close)
    initializeVariableInsertionListener(); // Global listener for {{...}} buttons

    // --- WAVE2 node-features: command palette (Cmd/Ctrl+K) + add-node (Tab) ---
    initializePaletteShortcuts();

    /* === WAVE3 demo-mode === wire the presentation toggle + first-run coach-marks.
       Both the toolbar button and the Ctrl/Cmd+Shift+D shortcut drive the same
       controller. onChange re-fits the graph so nodes fill the enlarged viewport. */
    demoModeController = initDemoMode({
        toggleButton: domRefs.demoModeBtn,
        onChange: () => {
            // Re-fit the graph so nodes fill the resized viewport. resetZoom() is
            // a documented public method in docs/visualizer-contract.md; called
            // defensively (graph view may be inactive).
            if (appState.currentView === 'node-graph') {
                appState.visualizerComponent?.resetZoom?.();
            }
        },
    });

    /* === WAVE3 demo-mode === show the dismissible first-run onboarding once.
       No-op after the user dismisses it (persisted via localStorage). Skipped
       entirely in Demo Mode so a live presentation never gets coach-marks. */
    if (!demoModeController?.isActive?.()) {
        maybeShowOnboarding({ host: domRefs.onboardingHost });
    }

    /* === WAVE3 demo-mode === upgrade the static "no flow open" placeholder into
       a teaching empty-state that names the New/Open actions. Additive: swaps the
       inner content of the existing #workspace-placeholder, shown by uiUtils
       whenever no flow is loaded. */
    if (domRefs.workspacePlaceholder) {
        domRefs.workspacePlaceholder.replaceChildren(renderEmptyState('no-flow-open'));
    }

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

        // WAVE2 file-features: Undo / Redo over flow-model edits.
        // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z (or Ctrl+Y) = redo. Only fires when
        // focus is OUTSIDE inputs (guarded above), so native text-field undo is
        // untouched inside step editors and the search boxes.
        if (ctrlOrCmd && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            handleFlowRedoUndo('undo');
        }
        if ((ctrlOrCmd && e.key.toLowerCase() === 'z' && e.shiftKey)
            || (ctrlOrCmd && e.key.toLowerCase() === 'y')) {
            e.preventDefault();
            handleFlowRedoUndo('redo');
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

        /* === WAVE3 demo-mode === Ctrl/Cmd+Shift+D toggles the projector view.
           Shift+D avoids clashing with any bare-key shortcut and with the
           browser's Ctrl/Cmd+D (bookmark) intent. Drives the shared controller
           so the toolbar button stays in sync. */
        if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            demoModeController?.toggle();
        }

        if (e.key.toLowerCase() === 'm' && appState.currentView === 'node-graph') {
            e.preventDefault();
            domRefs.toggleMinimapBtn?.click();
        }

        // WAVE2 LANE canvas: single-key Cmd/Ctrl+Z undo for the last "Tidy Up".
        if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'z'
            && appState.currentView === 'node-graph'
            && appState.visualizerComponent?.canUndoLayout?.()) {
            e.preventDefault();
            handleUndoTidyUp();
        }
    });

    // --- WAVE2 file-features: live fuzzy-search inputs (files + steps) ---
    // 'input' fires on every keystroke and on native clear (the search "x").
    domRefs.fileSearchInput?.addEventListener('input', applyFileSearch);
    domRefs.stepsSearchInput?.addEventListener('input', applyStepsSearch);
    // Esc clears the box and restores the full list without stopping a run.
    domRefs.fileSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; applyFileSearch(); }
    });
    domRefs.stepsSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; applyStepsSearch(); }
    });

    logger.info("All core event listeners initialized.");
}

// --- WAVE2 file-features: Undo/Redo dispatch ---
// Composes with the existing dirty flags: flowHistory reconciles appState.isDirty
// against the last-saved baseline, then we re-render and refresh button states.
export function handleFlowRedoUndo(direction) {
    if (!appState.currentFlowModel) return;
    const changed = direction === 'redo' ? redoFlow() : undoFlow();
    if (!changed) return;
    renderCurrentFlow();      // re-render list/graph from the restored model
    updateDefinedVariables(); // structure may have changed
    setDirty();               // reconcile Save/Cancel/Close button enablement
    const verb = direction === 'redo' ? 'Redid' : 'Undid';
    showMessage(`${verb} last change.`, 'info');
}

/** Exposed for tests / callers that want to know if undo/redo is available. */
export function flowUndoRedoAvailability() {
    return { canUndo: canUndoFlow(), canRedo: canRedoFlow() };
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

export function handleAutoArrangeLayout() {
    if (!appState.currentFlowModel || !appState.visualizerComponent) return;
    const layout = appState.visualizerComponent.getAutoLayout?.() || {};
    const layoutEntries = Object.entries(layout);
    if (layoutEntries.length === 0) {
        showMessage('No steps available to arrange.', 'warning');
        return;
    }

    appState.currentFlowModel.visualLayout = layout;
    appState.isDirty = true;
    setDirty();
    renderCurrentFlow();

    const firstStepId = appState.currentFlowModel.steps?.[0]?.id;
    if (firstStepId) {
        requestAnimationFrame(() => {
            appState.visualizerComponent?.focusNode(firstStepId);
        });
    }
}

// ================= WAVE2 LANE canvas: "Tidy Up" + error navigation =================

/**
 * Read the real rendered node bounding boxes so the auto-layout respects the
 * actual card sizes (per the auto-layout spike handoff notes). Falls back to
 * the visualizer defaults for any node that isn't measurable yet.
 */
function collectNodeSizes(visualizer) {
    const sizes = {};
    if (!visualizer?.nodes) return sizes;
    visualizer.nodes.forEach((nodeData, stepId) => {
        const el = nodeData?.element;
        const width = el?.offsetWidth || nodeData?.width;
        const height = el?.offsetHeight || nodeData?.height;
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            sizes[stepId] = { width, height };
        }
    });
    return sizes;
}

/**
 * "Tidy Up": run the ELK/dagre adapter and apply the resulting {x,y} to the
 * graph, animating the relayout and persisting into visualLayout. Honours a
 * Tidy-all vs Tidy-selection distinction so manually-placed nodes can be kept:
 * with `selectionOnly` and a selected step, only that step (and its subtree if
 * it is a container) is repositioned. The move is undoable with a single
 * Cmd/Ctrl+Z (applyLayout snapshots the pre-tidy positions).
 *
 * @param {{ selectionOnly?: boolean }} [options]
 */
export async function handleTidyUp({ selectionOnly = false } = {}) {
    const visualizer = appState.visualizerComponent;
    if (!appState.currentFlowModel || !visualizer) return;

    const steps = appState.currentFlowModel.steps || [];
    if (steps.length === 0) {
        showMessage('No steps available to tidy.', 'warning');
        return;
    }

    let onlyStepIds = null;
    if (selectionOnly) {
        const selectedId = appState.selectedStepId;
        if (!selectedId) {
            showMessage('Select a step first to tidy just that part of the flow.', 'warning');
            return;
        }
        // Tidy-selection: only the selected step (and its descendants, if any).
        onlyStepIds = [selectedId];
        const collect = visualizer.nodes; // rendered nodes only
        const info = findStepInfoRecursive(steps, selectedId);
        const selectedStep = info?.step;
        if (selectedStep) {
            const gatherDescendants = (branchArrays) => {
                branchArrays.forEach((arr) => {
                    (arr || []).forEach((child) => {
                        if (child?.id && collect.has(child.id)) onlyStepIds.push(child.id);
                        gatherDescendants([
                            child?.thenSteps, child?.elseSteps, child?.loopSteps,
                        ]);
                    });
                });
            };
            gatherDescendants([
                selectedStep.thenSteps, selectedStep.elseSteps, selectedStep.loopSteps,
            ]);
        }
    }

    try {
        const nodeSizes = collectNodeSizes(visualizer);
        const { positions } = await computeLayout(steps, { nodeSizes, direction: 'DOWN' });
        if (!positions || Object.keys(positions).length === 0) {
            showMessage('Auto-layout produced no positions.', 'warning');
            return;
        }

        const applied = visualizer.applyLayout(positions, { animate: true, onlyStepIds });
        if (applied > 0) {
            appState.isDirty = true;
            setDirty();
            showMessage(
                selectionOnly ? 'Tidied the selected step.' : 'Tidied up the flow. Press Cmd/Ctrl+Z to undo.',
                'success',
            );
        }
    } catch (err) {
        logger.error('[HANDLER handleTidyUp] Auto-layout failed:', err);
        showMessage('Could not compute an auto-layout.', 'error');
    }
}

/** Revert the last "Tidy Up" in a single keystroke (Cmd/Ctrl+Z). */
export function handleUndoTidyUp() {
    const visualizer = appState.visualizerComponent;
    if (!visualizer?.canUndoLayout?.()) return;
    const undone = visualizer.undoLayout();
    if (undone) {
        appState.isDirty = true;
        setDirty();
        showMessage('Reverted the last Tidy Up.', 'info');
    }
}

/** Jump the viewport to the next failed step, cycling in document order. */
export function handleJumpToNextError() {
    const visualizer = appState.visualizerComponent;
    if (!visualizer?.jumpToNextError) return;
    const stepId = visualizer.jumpToNextError();
    if (!stepId) {
        showMessage('No failed steps to jump to.', 'info');
    }
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

export function handleVisualizerConnectionUpdate({ action, sourceStepId, targetStepId, outputRole }) {
    if (!appState.currentFlowModel || !sourceStepId || !targetStepId) {
        logger.warn('[HANDLER handleVisualizerConnectionUpdate] Missing flow model or step IDs.');
        return false;
    }

    if (action === 'disconnect') {
        showMessage('Disconnecting nodes is not supported yet.', 'warning');
        renderCurrentFlow();
        return false;
    }

    let modelChanged = false;
    if (outputRole === 'main') {
        modelChanged = moveStepInModel(targetStepId, sourceStepId, 'after');
    } else if (outputRole === 'then' || outputRole === 'else' || outputRole === 'loop') {
        modelChanged = moveStepToBranchStart(targetStepId, sourceStepId, outputRole);
    }

    if (modelChanged) {
        appState.isDirty = true;
        setDirty();
        renderCurrentFlow();
        return true;
    }

    renderCurrentFlow();
    return false;
}


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

export function handleBuilderRequestAddStepAfter(stepId, options = {}) {
    if (!appState.currentFlowModel || !stepId) return;

    showAppStepTypeDialog((type) => {
        if (!type) return;

        const newStep = createNewStep(type);
        const inserted = insertStepAfterInModel(stepId, newStep);
        if (!inserted) {
            showMessage('Failed to add step after the selected node.', 'error');
            return;
        }

        const stepLabel = newStep.name || 'New Step';
        appState.isDirty = true;
        appState.selectedStepId = stepId;
        setDirty();
        updateDefinedVariables();
        renderCurrentFlow();
        showMessage(`Step "${escapeHTML(stepLabel)}" added.`, 'success');

        if (typeof options.onAdded === 'function') {
            options.onAdded(newStep.id);
        }
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


// ================================================================
// WAVE2 node-features: command/search palette + add-node overlays
// ================================================================
//
// Two consumers of the reusable palette (palette.js):
//   - Cmd/Ctrl+K  → global command palette (actions + navigation + open-recent)
//   - Tab / dblclick empty canvas → add-node search (pre-wired to add-step)
//
// The palette instance is created lazily on first use and mounted into
// #palette-host (falls back to <body>). All wiring here is ADDITIVE.

let paletteInstance = null;

function getPalette() {
    if (!paletteInstance) {
        const host = document.getElementById('palette-host') || document.body;
        paletteInstance = createPalette({ mount: host });
    }
    return paletteInstance;
}

/**
 * Build the list of command-palette items from the app's current state.
 * Only enabled/relevant actions are included so the palette never offers a
 * no-op. Navigation + open-recent round out the list.
 */
function buildCommandItems() {
    const items = [];
    const hasFlow = !!appState.currentFlowModel;

    const push = (label, action, hint) => items.push({ id: label, label, action, hint });

    // --- File actions ---
    push('New Flow', () => handleCreateNewFlow(), 'Create a new flow');
    push('Open Flow…', () => handleOpenFile(), 'Open a .flow.json file');
    if (hasFlow && domRefs.saveFlowBtn && !domRefs.saveFlowBtn.disabled) {
        push('Save Flow', () => saveCurrentFlow(false), 'Ctrl/Cmd+S');
    }
    if (hasFlow && domRefs.saveAsFlowBtn && !domRefs.saveAsFlowBtn.disabled) {
        push('Save Flow As…', () => handleSaveAs(), 'Save to a new file');
    }
    if (hasFlow && domRefs.closeFlowBtn && !domRefs.closeFlowBtn.disabled) {
        push('Close Flow', () => handleCloseFlow(), 'Close the current flow');
    }

    // --- Editing ---
    if (hasFlow) {
        push('Add Step…', () => handleBuilderRequestAddStep(), 'Insert a new step');
    }

    // --- Inspect ---
    if (hasFlow) {
        push('Toggle View as JSON', () => { toggleJsonView(); }, 'Read-only flow JSON + diff');
    }

    // --- Navigation / view ---
    if (hasFlow) {
        push('Toggle View (List / Graph)', () => domRefs.toggleViewBtn?.click(), 'Ctrl/Cmd+3');
        push('Toggle Flow Info', () => domRefs.toggleInfoBtn?.click(), 'Ctrl/Cmd+1');
        push('Toggle Variables', () => domRefs.toggleVariablesBtn?.click(), 'Ctrl/Cmd+2');
    }
    if (appState.currentView === 'node-graph') {
        push('Auto Arrange Nodes', () => domRefs.autoLayoutBtn?.click(), 'Layout the graph');
        push('Toggle Minimap', () => domRefs.toggleMinimapBtn?.click(), 'Show/hide minimap');
    }

    // --- Runner ---
    if (hasFlow && domRefs.runFlowBtn && !domRefs.runFlowBtn.disabled) {
        push('Run Flow', () => handleRunFlow(), 'F5');
    }

    // --- Open recent ---
    let recent = [];
    try {
        recent = getRecentFiles() || [];
    } catch (err) {
        logger.warn('[palette] failed to read recent files:', err);
    }
    recent.slice(0, 12).forEach((entry) => {
        const filePath = typeof entry === 'string' ? entry : (entry?.path || entry?.filePath);
        if (!filePath) return;
        const base = filePath.split(/[\\/]/).pop() || filePath;
        const label = (typeof entry === 'object' && entry?.name) ? entry.name : base;
        push(`Open Recent: ${label}`, () => handleSelectFlow(filePath), base);
    });

    return items;
}

/**
 * Open the global command palette (Cmd/Ctrl+K).
 */
export function openCommandPalette() {
    const palette = getPalette();
    palette.open({
        items: buildCommandItems(),
        placeholder: 'Type a command or search recent flows…',
        emptyText: 'No matching commands',
    });
}

/**
 * Open the add-node search palette, pre-wired to the existing add-step
 * plumbing. If `afterStepId` is provided the new step is inserted after it;
 * otherwise it is appended at the top level.
 *
 * @param {string|null} [afterStepId]
 */
export function openAddNodePalette(afterStepId = null) {
    if (!appState.currentFlowModel) return;
    const palette = getPalette();
    const items = getStepTypeItems();
    palette.open({
        items,
        placeholder: 'Search step types…',
        emptyText: 'No matching step type',
        onSelect: (item) => {
            if (!item || !item.type) return;
            const newStep = createNewStep(item.type);

            if (afterStepId) {
                // Insert directly after the selected step. We call the model
                // helper (rather than handleBuilderRequestAddStepAfter, which
                // re-opens the step-type modal) because the palette already
                // chose the type.
                const inserted = insertStepAfterInModel(afterStepId, newStep);
                if (!inserted) {
                    showMessage('Failed to add step after the selected node.', 'error');
                    return;
                }
                appState.isDirty = true;
                appState.selectedStepId = newStep.id;
                setDirty();
                updateDefinedVariables();
                renderCurrentFlow();
                showMessage(`Step "${escapeHTML(newStep.name || 'New Step')}" added.`, 'success');
            } else {
                // Top-level add: reuse the central step-update handler.
                handleBuilderStepUpdate({
                    type: 'add',
                    step: newStep,
                    parentId: null,
                    branch: null,
                });
            }
        },
    });
}

/**
 * Install the Cmd/Ctrl+K (command palette) and Tab (add-node) shortcuts, plus
 * a double-click-on-empty-canvas trigger for the add-node palette. All handlers
 * are additive and defer to the palette overlay, which owns its own Escape /
 * Enter / arrow handling once open.
 */
export function initializePaletteShortcuts() {
    document.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

        // Cmd/Ctrl+K → command palette (works even from inputs).
        if (ctrlOrCmd && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (paletteInstance && paletteInstance.isOpen()) {
                paletteInstance.close();
            } else {
                openCommandPalette();
            }
            return;
        }

        // Tab → add-node search. Only when a flow is open, the palette is not
        // already up, and focus is NOT inside a text field (so Tab keeps its
        // normal focus-navigation role in forms/editors).
        if (e.key === 'Tab' && !ctrlOrCmd && !e.altKey) {
            const target = e.target;
            const tag = (target?.tagName || '').toLowerCase();
            const inField = tag === 'input' || tag === 'textarea'
                || tag === 'select' || target?.isContentEditable;
            if (!inField && appState.currentFlowModel
                && !(paletteInstance && paletteInstance.isOpen())) {
                e.preventDefault();
                openAddNodePalette(appState.selectedStepId || null);
            }
        }
    });

    // Double-click an empty area of the visualizer canvas → add-node palette.
    const visualizerMount = domRefs.flowVisualizerMount
        || document.getElementById('flow-visualizer-mount');
    if (visualizerMount) {
        visualizerMount.addEventListener('dblclick', (e) => {
            // Only treat clicks on empty canvas (not on a node) as "add here".
            if (e.target.closest && e.target.closest('.flow-node')) return;
            if (!appState.currentFlowModel) return;
            openAddNodePalette(appState.selectedStepId || null);
        });
    }

    logger.info('[palette] command/add-node palette shortcuts initialized.');
}


// ================================================================
// WAVE2 node-features: read-only View-as-JSON panel (jsonView.js)
// ================================================================
//
// A read-only panel that shows the current flow's canonical .flow.json and a
// line diff against the last-saved bytes on disk. Editing is deferred until
// round-trip safety is proven. The panel mounts into #json-view-mount and is
// toggled via the command palette ("Toggle View as JSON").

let jsonViewInstance = null;
let jsonViewVisible = false;

function getJsonView() {
    if (!jsonViewInstance) {
        const mount = document.getElementById('json-view-mount');
        if (!mount) {
            logger.warn('[jsonView] #json-view-mount not found; cannot create panel.');
            return null;
        }
        jsonViewInstance = createJsonView({ mount });
    }
    return jsonViewInstance;
}

/**
 * Read the last-saved bytes for the current flow and normalize them through the
 * same serialization the panel uses, so cosmetic formatting never shows as a
 * diff. Returns the normalized pretty JSON string, or null when the flow has
 * never been saved (or the file can't be read).
 */
async function readSavedFlowJson() {
    const filePath = appState.currentFilePath;
    if (!filePath || !window.electronAPI || typeof window.electronAPI.readFile !== 'function') {
        return null;
    }
    try {
        const result = await window.electronAPI.readFile(filePath);
        if (!result || !result.success || typeof result.data !== 'string') return null;
        const parsed = JSON.parse(result.data);
        // Normalize via the internal model so the baseline matches what the
        // current model would serialize to.
        return flowToPrettyJson(jsonToFlowModel(parsed));
    } catch (err) {
        logger.warn('[jsonView] failed to read/normalize last-saved flow:', err);
        return null;
    }
}

/**
 * Refresh the JSON view panel from the current model + last-saved bytes.
 */
export async function refreshJsonView() {
    if (!jsonViewVisible) return;
    const view = getJsonView();
    if (!view) return;
    const savedJson = await readSavedFlowJson();
    view.update({ model: appState.currentFlowModel, savedJson });
}

/**
 * Show/hide the read-only View-as-JSON panel.
 * @param {boolean|null} [forceState]
 */
export async function toggleJsonView(forceState = null) {
    const mount = document.getElementById('json-view-mount');
    if (!mount) return;

    const willShow = forceState ?? !jsonViewVisible;
    jsonViewVisible = willShow;
    mount.style.display = willShow ? '' : 'none';

    if (willShow) {
        await refreshJsonView();
    }
}
