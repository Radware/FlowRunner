// ========== FILE: listSelection.js ==========
// DOM-free multi-selection model for the flow list, plus the ONE shared label
// formatter every background-run launch surface uses (sidebar action bar,
// context menu, modal picker) so the count string can never disagree between
// them. Kept free of the DOM so it is unit-testable under jsdom and reusable.
//
// The model tracks a Set of file paths and an `anchor` (the last row toggled on
// its own), which shift-range selection extends from. Callers own all DOM
// wiring and re-render; this module only answers "what is selected".

/**
 * Create a selection model. Instance-based (not a singleton) so tests are
 * isolated and a second list could reuse it later.
 * @returns {object} selection API
 */
export function createListSelection() {
    const selected = new Set();
    let anchor = null;

    return {
        /** @returns {number} count of selected paths */
        size() { return selected.size; },
        /** @returns {boolean} true when nothing is selected */
        isEmpty() { return selected.size === 0; },
        /** @param {string} path @returns {boolean} */
        has(path) { return selected.has(path); },
        /** @returns {string[]} selected paths, insertion order */
        list() { return [...selected]; },
        /** @returns {string|null} the current range anchor */
        anchor() { return anchor; },

        /**
         * Toggle one path. Becomes the new anchor when it is turned ON.
         * @param {string} path
         * @returns {boolean} the new membership state
         */
        toggle(path) {
            if (selected.has(path)) {
                selected.delete(path);
                if (anchor === path) anchor = null;
                return false;
            }
            selected.add(path);
            anchor = path;
            return true;
        },

        /**
         * Add one path (idempotent); sets the anchor.
         * @param {string} path
         */
        add(path) { selected.add(path); anchor = path; },

        /**
         * Replace the whole selection with exactly these paths. The last one
         * becomes the anchor. Used by right-click-on-unselected-row.
         * @param {string[]} paths
         */
        set(paths) {
            selected.clear();
            paths.forEach((p) => selected.add(p));
            anchor = paths.length ? paths[paths.length - 1] : null;
        },

        /**
         * Select every path in `orderedPaths` (e.g. the currently-visible rows).
         * Anchor is unchanged if still present, else the last path.
         * @param {string[]} orderedPaths
         */
        all(orderedPaths) {
            orderedPaths.forEach((p) => selected.add(p));
            if (!anchor || !selected.has(anchor)) {
                anchor = orderedPaths.length ? orderedPaths[orderedPaths.length - 1] : anchor;
            }
        },

        /**
         * Contiguous range select from the anchor (or `to` if no anchor) to
         * `to`, over the given ordered path list. Everything between is added;
         * existing selections outside the range are preserved (Finder/VS Code).
         * @param {string} to        the clicked path
         * @param {string[]} orderedPaths  flattened visible order
         */
        range(to, orderedPaths) {
            const toIdx = orderedPaths.indexOf(to);
            if (toIdx < 0) { this.toggle(to); return; }
            const fromIdx = anchor != null ? orderedPaths.indexOf(anchor) : toIdx;
            const start = fromIdx < 0 ? toIdx : fromIdx;
            const [lo, hi] = start <= toIdx ? [start, toIdx] : [toIdx, start];
            for (let i = lo; i <= hi; i++) selected.add(orderedPaths[i]);
            // Anchor stays where it was so a subsequent shift-click re-extends.
            if (anchor == null) anchor = to;
        },

        /** Empty the selection. */
        clear() { selected.clear(); anchor = null; },

        /**
         * Drop any selected paths not in `validPaths` (e.g. a file was removed).
         * @param {string[]} validPaths
         */
        retain(validPaths) {
            const keep = new Set(validPaths);
            [...selected].forEach((p) => { if (!keep.has(p)) selected.delete(p); });
            if (anchor && !keep.has(anchor)) anchor = null;
        },
    };
}

/**
 * The single background-run count label, used by EVERY launch surface so they
 * never disagree. Sentence case, verb-first, no em dashes (DESIGN copy rules).
 * @param {number} count      how many flows will launch
 * @param {object} [opts]
 * @param {boolean} [opts.compact=false]  "Run 3 in background" vs "Run 3 flows in background"
 * @returns {string}
 */
export function formatRunLabel(count, opts = {}) {
    const n = Math.max(0, count | 0);
    if (n <= 1) return 'Run in background';
    return opts.compact ? `Run ${n} in background` : `Run ${n} flows in background`;
}
