// ========== FILE: fuzzySearch.js (WAVE2 file-features lane) ==========
//
// Fuse.js-backed fuzzy search for the sidebar: filter the recent-files list and
// the flow's steps as the user types. Typo-tolerant, ranked by relevance.
//
// This is a THIN, PURE wrapper over Fuse.js:
//   - searchFiles(query, paths)  -> string[]  (subset of paths, ranked)
//   - searchSteps(query, steps)  -> object[]  (flattened matching steps, ranked)
//   - filterList(query, items, {keys}) -> generic object-list helper
//
// It owns no app state and touches no DOM, so it is unit-testable under
// Jest+jsdom and reusable from any renderer module. Rendering lives in
// uiUtils.js / fileOperations.js; this file only decides *what* matches.
//
// CSP: Fuse is imported from a vendored ESM build under assets/vendor/ so the
// packaged renderer (script-src 'self') can load it without a bare specifier.
//
// Empty/whitespace queries short-circuit to "everything, in original order" so
// clearing the search box always restores the full, unranked list.

import Fuse from './assets/vendor/fuse/fuse.min.mjs';

// Fuse tuning shared across searches. `threshold` 0.4 is forgiving enough for
// typos without matching noise; `ignoreLocation` lets a match anywhere in the
// string count (paths are long, so location-weighting would hurt).
const BASE_OPTIONS = {
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: false,
    shouldSort: true,
    minMatchCharLength: 1
};

function isBlank(query) {
    return typeof query !== 'string' || query.trim().length === 0;
}

/** Extract the trailing filename from a path (handles both slash styles). */
function basename(p) {
    return String(p).split(/[\\/]/).pop() || String(p);
}

/**
 * Fuzzy-filter a list of file paths. Matches on both the full path and the bare
 * filename so `login` finds `.../login-flow.flow.json`. Empty query returns the
 * list unchanged (original order preserved).
 *
 * @param {string} query
 * @param {string[]} paths
 * @returns {string[]} subset of `paths`, ranked most-relevant first
 */
export function searchFiles(query, paths) {
    const list = Array.isArray(paths) ? paths : [];
    if (isBlank(query)) return list.slice();
    if (list.length === 0) return [];

    // Wrap each path so Fuse can weight basename vs. full path separately.
    const records = list.map((path) => ({ path, name: basename(path) }));
    const fuse = new Fuse(records, {
        ...BASE_OPTIONS,
        keys: [
            { name: 'name', weight: 0.7 },
            { name: 'path', weight: 0.3 }
        ]
    });
    return fuse.search(query.trim()).map((r) => r.item.path);
}

/**
 * Recursively flatten a step tree (then/else/loopSteps/steps) into a flat array,
 * preserving document order. Used so nested steps are searchable too.
 * @param {object[]} steps
 * @returns {object[]}
 */
export function flattenSteps(steps) {
    const out = [];
    const walk = (list) => {
        if (!Array.isArray(list)) return;
        for (const step of list) {
            if (!step || typeof step !== 'object') continue;
            out.push(step);
            // Cover every nesting shape the flow model uses. `then`/`else` are
            // frozen condition fields; `loopSteps`/`steps`/`branches` cover loop
            // and future container shapes without renaming anything.
            walk(step.then);
            walk(step.else);
            walk(step.loopSteps);
            walk(step.steps);
            walk(step.branches);
        }
    };
    walk(steps);
    return out;
}

/**
 * Fuzzy-filter steps (including nested ones) by name/type/url. Empty query
 * returns the flattened list unchanged.
 *
 * @param {string} query
 * @param {object[]} steps  the flow model's top-level steps
 * @returns {object[]} matching step objects, ranked most-relevant first
 */
export function searchSteps(query, steps) {
    const flat = flattenSteps(steps);
    if (isBlank(query)) return flat;
    if (flat.length === 0) return [];

    const fuse = new Fuse(flat, {
        ...BASE_OPTIONS,
        keys: [
            { name: 'name', weight: 0.6 },
            { name: 'url', weight: 0.25 },
            { name: 'type', weight: 0.15 }
        ]
    });
    return fuse.search(query.trim()).map((r) => r.item);
}

/**
 * Generic fuzzy filter over an array of objects by the given keys. Empty query
 * returns the list unchanged.
 *
 * @param {string} query
 * @param {object[]} items
 * @param {{keys: (string|object)[], threshold?: number}} opts
 * @returns {object[]}
 */
export function filterList(query, items, opts = {}) {
    const list = Array.isArray(items) ? items : [];
    if (isBlank(query)) return list.slice();
    if (list.length === 0) return [];

    const keys = Array.isArray(opts.keys) ? opts.keys : [];
    const fuse = new Fuse(list, {
        ...BASE_OPTIONS,
        ...(typeof opts.threshold === 'number' ? { threshold: opts.threshold } : {}),
        keys
    });
    return fuse.search(query.trim()).map((r) => r.item);
}
