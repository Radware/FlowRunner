// __tests__/flowHistory.test.js
// Integration spec for the app-level undo/redo glue that binds the pure
// undoManager to appState.currentFlowModel + dirty flags.

import { appState } from '../state.js';
import {
    resetFlowHistory,
    syncFlowHistoryOnRender,
    snapshotFlowHistory,
    undoFlow,
    redoFlow,
    canUndoFlow,
    canRedoFlow,
    markFlowHistorySaved
} from '../flowHistory.js';

function loadFlow(model) {
    // Simulate the file-lifecycle: assign a fresh model object then render.
    appState.currentFlowModel = model;
    appState.isDirty = false;
    appState.stepEditorIsDirty = false;
    appState.selectedStepId = null;
    syncFlowHistoryOnRender(); // resets history around the new object
}

beforeEach(() => {
    appState.currentFlowModel = null;
    appState.selectedStepId = null;
    appState.isDirty = false;
    appState.stepEditorIsDirty = false;
    resetFlowHistory(null); // tear down any prior history
});

describe('new-flow detection via render', () => {
    test('loading a flow seeds history with nothing to undo', () => {
        loadFlow({ name: 'A', steps: [] });
        expect(canUndoFlow()).toBe(false);
        expect(canRedoFlow()).toBe(false);
    });

    test('loading a DIFFERENT flow object clears the previous stack', () => {
        loadFlow({ name: 'A', steps: [] });
        appState.currentFlowModel.name = 'A edited';
        snapshotFlowHistory();
        expect(canUndoFlow()).toBe(true);

        loadFlow({ name: 'B', steps: [] }); // new object reference
        expect(canUndoFlow()).toBe(false);
    });
});

describe('snapshot + undo/redo of in-place edits', () => {
    test('an edit becomes undoable and undo restores the prior model', () => {
        loadFlow({ name: 'A', steps: [{ id: 's1', name: 'One', type: 'request' }] });

        appState.currentFlowModel.name = 'A renamed';
        appState.isDirty = true;
        snapshotFlowHistory();
        expect(canUndoFlow()).toBe(true);

        const changed = undoFlow();
        expect(changed).toBe(true);
        expect(appState.currentFlowModel.name).toBe('A');
        // Back to the loaded baseline -> not dirty.
        expect(appState.isDirty).toBe(false);
        expect(canRedoFlow()).toBe(true);
    });

    test('redo re-applies the undone edit and marks dirty again', () => {
        loadFlow({ name: 'A', steps: [] });
        appState.currentFlowModel.name = 'A2';
        snapshotFlowHistory();
        undoFlow();
        const changed = redoFlow();
        expect(changed).toBe(true);
        expect(appState.currentFlowModel.name).toBe('A2');
        expect(appState.isDirty).toBe(true);
    });

    test('structural edit (add nested step) undoes cleanly', () => {
        loadFlow({
            name: 'cond',
            steps: [{ id: 'c1', type: 'condition', then: [], else: [] }]
        });
        appState.currentFlowModel.steps[0].then.push({ id: 't1', type: 'request', name: 'X' });
        snapshotFlowHistory();
        expect(appState.currentFlowModel.steps[0].then).toHaveLength(1);

        undoFlow();
        expect(appState.currentFlowModel.steps[0].then).toHaveLength(0);
        redoFlow();
        expect(appState.currentFlowModel.steps[0].then).toHaveLength(1);
    });

    test('undo drops a selection that points at a now-removed step', () => {
        loadFlow({ name: 'A', steps: [{ id: 's1', type: 'request' }] });
        appState.currentFlowModel.steps.push({ id: 's2', type: 'request' });
        snapshotFlowHistory();
        appState.selectedStepId = 's2';

        undoFlow(); // s2 no longer exists
        expect(appState.selectedStepId).toBeNull();
    });
});

describe('no-op renders do not pollute history', () => {
    test('re-rendering without a model change adds nothing', () => {
        loadFlow({ name: 'A', steps: [] });
        // Simulate a view toggle: render again, same object, no change.
        syncFlowHistoryOnRender();
        syncFlowHistoryOnRender();
        expect(canUndoFlow()).toBe(false);
    });
});

describe('save rebases the clean baseline', () => {
    test('undo back to a saved state reports not-dirty', () => {
        loadFlow({ name: 'A', steps: [] });
        appState.currentFlowModel.name = 'B';
        snapshotFlowHistory();
        // Pretend the user saved at "B".
        markFlowHistorySaved();
        appState.isDirty = false;

        appState.currentFlowModel.name = 'C';
        snapshotFlowHistory();
        undoFlow(); // back to B (the saved state)
        expect(appState.currentFlowModel.name).toBe('B');
        expect(appState.isDirty).toBe(false);
    });
});
