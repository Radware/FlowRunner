// __tests__/undoManager.test.js
// TDD spec for the immer-patch-based undo/redo history used to make
// flow-model edits reversible (Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z).

import { createHistory } from '../undoManager.js';

const baseFlow = () => ({
    name: 'Flow A',
    description: '',
    steps: [
        { id: 's1', name: 'Step 1', type: 'request' },
        { id: 's2', name: 'Step 2', type: 'request' }
    ]
});

describe('createHistory — construction', () => {
    test('starts with the initial state present and no undo/redo available', () => {
        const h = createHistory(baseFlow());
        expect(h.getPresent()).toEqual(baseFlow());
        expect(h.canUndo()).toBe(false);
        expect(h.canRedo()).toBe(false);
    });

    test('present is a deep copy — mutating the source does not leak in', () => {
        const src = baseFlow();
        const h = createHistory(src);
        src.name = 'mutated externally';
        expect(h.getPresent().name).toBe('Flow A');
    });
});

describe('record — capturing a mutation', () => {
    test('records a change via a recipe and advances the present', () => {
        const h = createHistory(baseFlow());
        h.record((draft) => { draft.name = 'Renamed'; });
        expect(h.getPresent().name).toBe('Renamed');
        expect(h.canUndo()).toBe(true);
        expect(h.canRedo()).toBe(false);
    });

    test('a no-op recipe does not create a history entry', () => {
        const h = createHistory(baseFlow());
        h.record(() => { /* touch nothing */ });
        expect(h.canUndo()).toBe(false);
    });

    test('a recipe that assigns an identical value creates no entry', () => {
        const h = createHistory(baseFlow());
        h.record((draft) => { draft.name = 'Flow A'; });
        expect(h.canUndo()).toBe(false);
    });

    test('does not mutate the previous present (structural sharing / immutability)', () => {
        const h = createHistory(baseFlow());
        const before = h.getPresent();
        h.record((draft) => { draft.steps.push({ id: 's3', name: 'Step 3', type: 'request' }); });
        expect(before.steps).toHaveLength(2);
        expect(h.getPresent().steps).toHaveLength(3);
    });

    test('returns the frozen present so callers cannot corrupt history', () => {
        const h = createHistory(baseFlow());
        const p = h.record((draft) => { draft.name = 'Renamed'; });
        expect(() => { p.name = 'boom'; }).toThrow();
    });
});

describe('undo / redo', () => {
    test('undo reverts to the prior state', () => {
        const h = createHistory(baseFlow());
        h.record((d) => { d.name = 'Renamed'; });
        const undone = h.undo();
        expect(undone.name).toBe('Flow A');
        expect(h.getPresent().name).toBe('Flow A');
        expect(h.canUndo()).toBe(false);
        expect(h.canRedo()).toBe(true);
    });

    test('redo re-applies an undone change', () => {
        const h = createHistory(baseFlow());
        h.record((d) => { d.name = 'Renamed'; });
        h.undo();
        const redone = h.redo();
        expect(redone.name).toBe('Renamed');
        expect(h.getPresent().name).toBe('Renamed');
        expect(h.canRedo()).toBe(false);
    });

    test('undo at the beginning returns the present unchanged', () => {
        const h = createHistory(baseFlow());
        expect(h.undo()).toEqual(baseFlow());
        expect(h.canUndo()).toBe(false);
    });

    test('redo at the tip returns the present unchanged', () => {
        const h = createHistory(baseFlow());
        h.record((d) => { d.name = 'B'; });
        expect(h.redo().name).toBe('B');
    });

    test('multi-step undo/redo walks the full stack', () => {
        const h = createHistory(baseFlow());
        h.record((d) => { d.name = 'B'; });
        h.record((d) => { d.name = 'C'; });
        h.record((d) => { d.name = 'D'; });
        expect(h.getPresent().name).toBe('D');
        expect(h.undo().name).toBe('C');
        expect(h.undo().name).toBe('B');
        expect(h.undo().name).toBe('Flow A');
        expect(h.redo().name).toBe('B');
        expect(h.redo().name).toBe('C');
        expect(h.redo().name).toBe('D');
    });

    test('nested-branch edits (then/else steps) undo correctly', () => {
        const model = {
            name: 'cond',
            steps: [{ id: 'c1', type: 'condition', then: [], else: [] }]
        };
        const h = createHistory(model);
        h.record((d) => { d.steps[0].then.push({ id: 't1', type: 'request' }); });
        expect(h.getPresent().steps[0].then).toHaveLength(1);
        h.undo();
        expect(h.getPresent().steps[0].then).toHaveLength(0);
        h.redo();
        expect(h.getPresent().steps[0].then).toHaveLength(1);
    });

    test('recording after an undo truncates the redo branch', () => {
        const h = createHistory(baseFlow());
        h.record((d) => { d.name = 'B'; });
        h.record((d) => { d.name = 'C'; });
        h.undo(); // present = B
        h.record((d) => { d.name = 'X'; }); // new branch from B
        expect(h.getPresent().name).toBe('X');
        expect(h.canRedo()).toBe(false);
        expect(h.undo().name).toBe('B');
    });
});

describe('reset / clear', () => {
    test('reset replaces the baseline and clears history', () => {
        const h = createHistory(baseFlow());
        h.record((d) => { d.name = 'B'; });
        const fresh = { name: 'Loaded Flow', steps: [] };
        h.reset(fresh);
        expect(h.getPresent()).toEqual(fresh);
        expect(h.canUndo()).toBe(false);
        expect(h.canRedo()).toBe(false);
    });

    test('clear wipes history but keeps the present', () => {
        const h = createHistory(baseFlow());
        h.record((d) => { d.name = 'B'; });
        h.clear();
        expect(h.getPresent().name).toBe('B');
        expect(h.canUndo()).toBe(false);
    });
});

describe('depth cap', () => {
    test('history is bounded by the configured limit', () => {
        const h = createHistory(baseFlow(), { limit: 3 });
        for (let i = 0; i < 10; i++) {
            h.record((d) => { d.name = `n${i}`; });
        }
        let steps = 0;
        while (h.canUndo()) { h.undo(); steps++; if (steps > 50) break; }
        expect(steps).toBe(3);
    });
});
