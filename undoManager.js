// ========== FILE: undoManager.js (WAVE2 file-features lane) ==========
//
// Immer-patch-based undo/redo history for the FlowRunner flow model.
//
// WHY immer patches (the "zundo" pattern): flow-model edits are deep, nested
// mutations (steps, headers, staticVars, then/else branches). Snapshotting the
// whole model on every keystroke would be wasteful and error-prone. Instead we
// record each edit as an immer patch pair (forward `patches` + inverse
// `inversePatches`). Undo applies the inverse; redo re-applies the forward set.
// Structural sharing keeps memory small and guarantees the previous present is
// never mutated in place.
//
// The history is a linear stack with a movable cursor:
//   - record() truncates any redo branch (classic undo semantics) and pushes a
//     new patch pair, unless the recipe produced no change (no-op is ignored).
//   - undo()/redo() move the cursor and return the new present.
//   - reset() rebases the baseline (used when a NEW flow is loaded) and clears
//     history so you cannot undo across an open/close boundary.
//
// This module owns NO app state and touches NO DOM — it is a pure data layer so
// it can be unit-tested under Jest+jsdom and driven from eventHandlers.js. The
// caller is responsible for wiring the returned present back into
// appState.currentFlowModel and flipping the dirty flags (see eventHandlers.js).
//
// CSP: immer is imported from a vendored ESM build under assets/vendor/ so the
// packaged renderer (script-src 'self') can load it without a bare specifier.

import {
    produceWithPatches,
    applyPatches,
    enablePatches,
    freeze
} from './assets/vendor/immer/immer.production.mjs';

// Patch tracking is opt-in in immer; enable it once at module load.
enablePatches();

const DEFAULT_LIMIT = 100;

// Deep-copy + deep-freeze a plain JSON-ish state so the present is decoupled
// from (and cannot mutate) the caller's source object. `structuredClone` is
// available in Electron's renderer and modern Node/jsdom; JSON round-trip is a
// defensive fallback. The flow model is JSON-serializable by contract.
function snapshot(state) {
    const src = state == null ? {} : state;
    let copy;
    if (typeof structuredClone === 'function') {
        copy = structuredClone(src);
    } else {
        copy = JSON.parse(JSON.stringify(src));
    }
    return freeze(copy, true);
}

/**
 * Create an undo/redo history seeded with an initial state.
 *
 * @param {object} initialState  the starting flow model (deep-copied + frozen)
 * @param {{limit?:number}} [opts]  max number of undoable entries (default 100)
 * @returns {{
 *   getPresent: () => object,
 *   record: (recipe: (draft:object)=>void) => object,
 *   undo: () => object,
 *   redo: () => object,
 *   canUndo: () => boolean,
 *   canRedo: () => boolean,
 *   reset: (nextState: object) => object,
 *   clear: () => void
 * }}
 */
export function createHistory(initialState, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;

    // Decouple + freeze the present from the caller's mutable source object.
    let present = snapshot(initialState);

    // Parallel arrays of patch pairs. `cursor` is the number of applied entries;
    // entries [0, cursor) are "done", entries [cursor, length) are "redoable".
    let patches = [];        // forward patches per entry
    let inverse = [];        // inverse patches per entry
    let cursor = 0;

    function getPresent() {
        return present;
    }

    function canUndo() {
        return cursor > 0;
    }

    function canRedo() {
        return cursor < patches.length;
    }

    function record(recipe) {
        if (typeof recipe !== 'function') {
            throw new Error('record(recipe) requires a function');
        }
        const [next, forward, back] = produceWithPatches(present, recipe);

        // No-op recipes (or writes that assign identical values) produce an
        // empty patch set — do not pollute the history with them.
        if (!forward || forward.length === 0) {
            return present;
        }

        // Truncate any redo branch: recording after an undo forks history.
        if (cursor < patches.length) {
            patches = patches.slice(0, cursor);
            inverse = inverse.slice(0, cursor);
        }

        patches.push(forward);
        inverse.push(back);
        cursor = patches.length;

        // Enforce the depth cap by dropping the oldest entry.
        if (patches.length > limit) {
            patches.shift();
            inverse.shift();
            cursor = patches.length;
        }

        present = next;
        return present;
    }

    function undo() {
        if (!canUndo()) return present;
        cursor -= 1;
        present = freeze(applyPatches(present, inverse[cursor]), true);
        return present;
    }

    function redo() {
        if (!canRedo()) return present;
        present = freeze(applyPatches(present, patches[cursor]), true);
        cursor += 1;
        return present;
    }

    function clear() {
        patches = [];
        inverse = [];
        cursor = 0;
    }

    function reset(nextState) {
        present = snapshot(nextState);
        clear();
        return present;
    }

    return { getPresent, record, undo, redo, canUndo, canRedo, reset, clear };
}
