// ========== FILE: flowHistory.js (WAVE2 file-features lane) ==========
//
// App-level glue between the pure `undoManager` history and FlowRunner's live
// `appState.currentFlowModel`. This is the ONE place that knows about appState,
// re-rendering, and the dirty flags, so `undoManager.js` can stay pure/testable.
//
// MODEL OF OPERATION
//   - resetFlowHistory(model): called whenever a flow is loaded/created/closed.
//     Rebases the baseline and clears the stack so you cannot undo across an
//     open/close boundary.
//   - snapshotFlowHistory(): records the CURRENT appState.currentFlowModel as a
//     new history entry. Callers invoke this right after they mutate the model
//     (i.e. wherever they already set appState.isDirty = true). Because the
//     underlying history ignores no-op patch sets, redundant calls are cheap and
//     harmless — so it is safe to snapshot generously.
//   - undoFlow()/redoFlow(): move the cursor, write the restored model back into
//     appState, re-render, and reconcile the dirty flag.
//
// COMPOSING WITH DIRTY STATE
//   The baseline captured by resetFlowHistory corresponds to the last *saved*
//   (or freshly loaded) model. When undo/redo lands the model back on that
//   baseline we clear appState.isDirty; otherwise we mark it dirty. This keeps
//   Save/Cancel button enablement (driven by setDirty) correct after time-travel
//   without fighting the existing per-edit dirty writes.
//
// The history stores a deep-frozen snapshot; we hand appState a mutable deep
// clone so downstream editors can keep mutating in place as they do today.

import { appState } from './state.js';
import { createHistory } from './undoManager.js';
import { UNDO_HISTORY_LIMIT } from './config.js';
import { logger } from './logger.js';

let history = null;
// Snapshot of the model as-of the last reset (i.e. last saved/loaded state),
// used to decide whether the app is "dirty" after an undo/redo.
let baselineJSON = null;
// The model OBJECT REFERENCE the history is currently built around. Loads /
// creates / clones / save-as all REASSIGN appState.currentFlowModel to a fresh
// object, whereas in-place edits mutate the same object. We use identity to
// auto-detect a "new flow" boundary from renderCurrentFlow without threading a
// reset call through every file-lifecycle handler.
let trackedModelRef = null;
// Set true by undo/redo so the ensuing renderCurrentFlow (which reassigns
// currentFlowModel to a fresh clone) is NOT mistaken for a new-flow load.
let suppressAutoReset = false;

function deepClone(obj) {
    if (obj == null) return obj;
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

/**
 * (Re)initialize the undo history around a model. Pass the model that is now
 * considered the clean baseline (freshly loaded/saved). Pass null when a flow is
 * closed to tear the history down.
 * @param {object|null} model
 */
export function resetFlowHistory(model) {
    // A hard reset always clears the undo/redo suppression latch: any pending
    // suppress from an interrupted undo/redo is void once we rebase.
    suppressAutoReset = false;
    if (!model) {
        history = null;
        baselineJSON = null;
        trackedModelRef = null;
        return;
    }
    const snapshot = deepClone(model);
    if (history) {
        history.reset(snapshot);
    } else {
        history = createHistory(snapshot, { limit: UNDO_HISTORY_LIMIT });
    }
    baselineJSON = JSON.stringify(snapshot);
    trackedModelRef = model;
}

/**
 * Called from renderCurrentFlow on every render. Detects a NEW flow (the model
 * object reference changed for a reason other than an undo/redo) and rebases the
 * history around it. In-place edits keep the same reference and are ignored here
 * (they are captured via snapshotFlowHistory at the edit sites).
 */
export function syncFlowHistoryOnRender() {
    const model = appState.currentFlowModel;

    if (!model) {
        // Flow closed.
        history = null;
        baselineJSON = null;
        trackedModelRef = null;
        return;
    }

    if (suppressAutoReset) {
        // This render is the direct result of an undo/redo; adopt the (new
        // clone) reference without wiping the stack.
        suppressAutoReset = false;
        trackedModelRef = model;
        return;
    }

    if (model !== trackedModelRef || !history) {
        // A different model object => a fresh load/create/clone/save-as.
        resetFlowHistory(model);
        return;
    }

    // Same model object, in-place mutation (or a no-op view toggle): capture the
    // current state. The underlying history ignores empty patch sets, so renders
    // that did NOT change the model add nothing to the stack.
    snapshotFlowHistory();
}

/**
 * Rebase the "clean" baseline to the current model without clearing the undo
 * stack. Call this after a successful Save so that a subsequent undo/redo that
 * returns to the just-saved state reports the app as clean.
 */
export function markFlowHistorySaved() {
    if (!appState.currentFlowModel) return;
    baselineJSON = JSON.stringify(appState.currentFlowModel);
}

/**
 * Record the current appState.currentFlowModel as a history entry. No-ops when
 * there is no history or no model, and (via the underlying manager) when the
 * model is unchanged since the last entry.
 */
export function snapshotFlowHistory() {
    if (!history || !appState.currentFlowModel) return;
    try {
        // Cheap guard: if nothing changed vs. the current history present, do
        // not even run a recipe (avoids spurious remove+add patch churn).
        const currentJSON = JSON.stringify(appState.currentFlowModel);
        if (currentJSON === JSON.stringify(history.getPresent())) return;

        const current = deepClone(appState.currentFlowModel);
        history.record((draft) => {
            // Reconcile the draft toward `current`: delete keys that vanished,
            // then (re)assign the rest. Immer only emits patches for values that
            // actually differ, so identical fields stay untouched.
            for (const k of Object.keys(draft)) {
                if (!(k in current)) delete draft[k];
            }
            for (const k of Object.keys(current)) {
                draft[k] = current[k];
            }
        });
    } catch (err) {
        logger.warn('[flowHistory] snapshot failed:', err);
    }
}

export function canUndoFlow() {
    return !!history && history.canUndo();
}

export function canRedoFlow() {
    return !!history && history.canRedo();
}

function applyPresent(present) {
    // Hand appState a mutable deep clone of the frozen history snapshot so the
    // existing in-place editors keep working.
    appState.currentFlowModel = deepClone(present);
    // The next renderCurrentFlow must NOT treat this reassignment as a new flow.
    suppressAutoReset = true;
    trackedModelRef = appState.currentFlowModel;
    // Selection may point at a step that no longer exists after undo/redo.
    if (appState.selectedStepId) {
        const stillExists = JSON.stringify(present).includes(`"${appState.selectedStepId}"`);
        if (!stillExists) appState.selectedStepId = null;
    }
    // Reconcile dirty state against the clean baseline.
    appState.isDirty = JSON.stringify(present) !== baselineJSON;
    appState.stepEditorIsDirty = false;
}

/**
 * Undo the last recorded change. Returns true if the model changed.
 * The caller (eventHandlers) is responsible for re-rendering.
 */
export function undoFlow() {
    if (!canUndoFlow()) return false;
    const present = history.undo();
    applyPresent(present);
    return true;
}

/**
 * Redo the last undone change. Returns true if the model changed.
 */
export function redoFlow() {
    if (!canRedoFlow()) return false;
    const present = history.redo();
    applyPresent(present);
    return true;
}
