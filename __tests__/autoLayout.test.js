/**
 * Unit tests for autoLayout.js — the engine-agnostic auto-layout adapter.
 *
 * Contract under test:
 *   computeLayout(steps, options) -> Promise<{ positions, engine, width, height }>
 *   where positions is a flat map { [stepId]: { x, y } } covering every step
 *   (including nested then/else/loop children), coordinates are top-left,
 *   non-negative, and the result is deterministic for a given input.
 *
 * Both engines are exercised: the ELK primary path and the @dagrejs/dagre
 * fallback (engine: 'dagre'). No wiring into flowVisualizer.js (Wave 2).
 */

import { computeLayout, flattenSteps } from '../autoLayout.js';

/** A simple linear flow (on-disk field names). */
function linearFlow() {
    return [
        { id: 'a', type: 'request', name: 'A' },
        { id: 'b', type: 'request', name: 'B' },
        { id: 'c', type: 'request', name: 'C' },
    ];
}

/** A condition with then/else branches (in-memory model field names). */
function branchedFlow() {
    return [
        { id: 'root', type: 'request', name: 'Root' },
        {
            id: 'cond',
            type: 'condition',
            name: 'Cond',
            thenSteps: [
                { id: 'then1', type: 'request', name: 'Then1' },
                { id: 'then2', type: 'request', name: 'Then2' },
            ],
            elseSteps: [{ id: 'else1', type: 'request', name: 'Else1' }],
        },
        { id: 'tail', type: 'request', name: 'Tail' },
    ];
}

/** A loop containing a nested condition (on-disk field names then/else/steps). */
function nestedLoopFlow() {
    return [
        {
            id: 'loop',
            type: 'loop',
            name: 'Loop',
            loopVariable: 'item',
            steps: [
                {
                    id: 'inner-cond',
                    type: 'condition',
                    name: 'InnerCond',
                    then: [{ id: 'inner-then', type: 'request', name: 'InnerThen' }],
                    else: [],
                },
            ],
        },
    ];
}

const ENGINES = ['elk', 'dagre'];

describe('flattenSteps', () => {
    test('collects every step id across nested then/else/loop', () => {
        const ids = flattenSteps(nestedLoopFlow()).map((s) => s.id).sort();
        expect(ids).toEqual(['inner-cond', 'inner-then', 'loop'].sort());
    });

    test('handles both model (thenSteps/elseSteps/loopSteps) and disk (then/else/steps) shapes', () => {
        const ids = flattenSteps(branchedFlow()).map((s) => s.id).sort();
        expect(ids).toEqual(['cond', 'else1', 'root', 'tail', 'then1', 'then2'].sort());
    });

    test('empty input yields empty list', () => {
        expect(flattenSteps([])).toEqual([]);
        expect(flattenSteps(null)).toEqual([]);
        expect(flattenSteps(undefined)).toEqual([]);
    });
});

describe.each(ENGINES)('computeLayout (%s engine)', (engine) => {
    test('empty flow returns empty positions', async () => {
        const { positions } = await computeLayout([], { engine });
        expect(positions).toEqual({});
    });

    test('returns a position for every step (linear)', async () => {
        const steps = linearFlow();
        const { positions } = await computeLayout(steps, { engine });
        for (const s of steps) {
            expect(positions[s.id]).toBeDefined();
            expect(typeof positions[s.id].x).toBe('number');
            expect(typeof positions[s.id].y).toBe('number');
        }
        expect(Object.keys(positions)).toHaveLength(3);
    });

    test('returns a position for every nested step (branches)', async () => {
        const steps = branchedFlow();
        const { positions } = await computeLayout(steps, { engine });
        const expected = flattenSteps(steps).map((s) => s.id).sort();
        expect(Object.keys(positions).sort()).toEqual(expected);
    });

    test('returns a position for every nested step (loop + condition)', async () => {
        const steps = nestedLoopFlow();
        const { positions } = await computeLayout(steps, { engine });
        const expected = flattenSteps(steps).map((s) => s.id).sort();
        expect(Object.keys(positions).sort()).toEqual(expected);
    });

    test('coordinates are top-left and non-negative', async () => {
        const { positions } = await computeLayout(branchedFlow(), { engine });
        for (const id of Object.keys(positions)) {
            expect(positions[id].x).toBeGreaterThanOrEqual(0);
            expect(positions[id].y).toBeGreaterThanOrEqual(0);
        }
    });

    test('flows top-to-bottom: a later sibling sits below an earlier one', async () => {
        const steps = linearFlow();
        const { positions } = await computeLayout(steps, { engine, direction: 'DOWN' });
        expect(positions.b.y).toBeGreaterThan(positions.a.y);
        expect(positions.c.y).toBeGreaterThan(positions.b.y);
    });

    test('deterministic: same input twice yields identical positions', async () => {
        const a = await computeLayout(branchedFlow(), { engine });
        const b = await computeLayout(branchedFlow(), { engine });
        expect(b.positions).toEqual(a.positions);
    });

    test('respects supplied node sizes (larger node shifts downstream layout)', async () => {
        const steps = linearFlow();
        const small = await computeLayout(steps, {
            engine,
            direction: 'DOWN',
            nodeSizes: { a: { width: 100, height: 40 } },
        });
        const large = await computeLayout(steps, {
            engine,
            direction: 'DOWN',
            nodeSizes: { a: { width: 100, height: 400 } },
        });
        // A taller first node must push node B further down.
        expect(large.positions.b.y).toBeGreaterThan(small.positions.b.y);
    });
});

describe('computeLayout engine fallback', () => {
    test('reports the engine actually used in the result', async () => {
        const elk = await computeLayout(linearFlow(), { engine: 'elk' });
        const dagre = await computeLayout(linearFlow(), { engine: 'dagre' });
        expect(elk.engine).toBe('elk');
        expect(dagre.engine).toBe('dagre');
    });

    test('unknown engine name falls back to a working engine', async () => {
        const { positions, engine } = await computeLayout(linearFlow(), { engine: 'nope' });
        expect(['elk', 'dagre']).toContain(engine);
        expect(Object.keys(positions)).toHaveLength(3);
    });
});
