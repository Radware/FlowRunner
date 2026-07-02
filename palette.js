// ========== FILE: palette.js (WAVE2 node-features lane) ==========
//
// A reusable, dependency-free command/search palette OVERLAY.
//
// Two consumers in the app (wired in eventHandlers.js — this module knows
// nothing about them):
//   (i)  ADD-NODE search — Tab / double-click empty canvas opens a searchable
//        list of step types, each item's `action` calls back into the existing
//        add-step plumbing.
//   (ii) A global Cmd/Ctrl+K command palette for actions + navigation +
//        open-recent, with fuzzy matching.
//
// This is an OVERLAY component: it never touches flowVisualizer.js and holds no
// app state. Callers pass in the item list on every open(); each item is
// `{ id, label, hint?, action?, ...anything }`.
//
// Fuzzy matching is implemented in-house (a small subsequence scorer) rather
// than pulling in fuse.js — it keeps the CSP `script-src 'self'` story simple
// (no vendored lib) and the scoring logic unit-testable. The public surface is
// intentionally fuse-shaped enough that swapping in fuse.js later is localized
// to fuzzyFilter().
//
// Colors/spacing come from the OKLCH semantic tokens in styles.css. No
// hardcoded colors here — see the `/* === WAVE2 LANE node-features === */`
// block at the end of styles.css.

// --- Pure fuzzy-match core (unit-tested; no DOM) ---------------------------

/**
 * Score how well `query` fuzzy-matches `text`. Characters of `query` must
 * appear in `text` in order (a subsequence). Higher score = better match.
 *
 * @param {string} query
 * @param {string} text
 * @returns {{score:number, indices:number[]}|null} match info, or null if no match.
 */
export function fuzzyMatch(query, text) {
    const q = String(query ?? '').toLowerCase();
    const t = String(text ?? '').toLowerCase();

    if (q.length === 0) {
        return { score: 0, indices: [] };
    }
    if (t.length === 0) return null;

    const indices = [];
    let score = 0;
    let qi = 0;
    let prevMatchIndex = -2; // so the first match is never treated as "contiguous"

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            indices.push(ti);

            // Base reward for a matched character.
            let charScore = 10;

            // Contiguous run bonus: consecutive matches beat scattered ones.
            if (ti === prevMatchIndex + 1) {
                charScore += 15;
            }

            // Start-of-string / start-of-word bonus: matches at the beginning
            // (or right after a separator) are more meaningful.
            const prevChar = ti > 0 ? t[ti - 1] : '';
            if (ti === 0) {
                charScore += 20;
            } else if (prevChar === ' ' || prevChar === '-' || prevChar === '_' || prevChar === '/') {
                charScore += 12;
            }

            // Early-position bonus: matches nearer the front rank higher.
            charScore += Math.max(0, 8 - ti);

            score += charScore;
            prevMatchIndex = ti;
            qi++;
        }
    }

    if (qi < q.length) return null; // not all query chars consumed => no match
    return { score, indices };
}

/**
 * Filter + rank `items` against `query` using fuzzyMatch on `keyFn(item)`.
 * Empty query returns every item in input order (score 0). Ranking is stable:
 * equal scores preserve input order.
 *
 * @template T
 * @param {string} query
 * @param {T[]} items
 * @param {(item:T)=>string} keyFn
 * @returns {{item:T, match:{score:number,indices:number[]}}[]}
 */
export function fuzzyFilter(query, items, keyFn) {
    const list = Array.isArray(items) ? items : [];
    const q = String(query ?? '');

    const scored = [];
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const key = keyFn ? keyFn(item) : String(item);
        const match = fuzzyMatch(q, key);
        if (match) {
            scored.push({ item, match, _order: i });
        }
    }

    scored.sort((a, b) => {
        if (b.match.score !== a.match.score) return b.match.score - a.match.score;
        return a._order - b._order; // stable
    });

    return scored.map(({ item, match }) => ({ item, match }));
}

// --- Add-node helper -------------------------------------------------------

const STEP_TYPE_ITEMS = [
    { type: 'request', label: 'API Request', hint: 'Call an external API endpoint' },
    { type: 'transform', label: 'Transform', hint: 'Modify or compute variables' },
    { type: 'condition', label: 'Condition (If/Else)', hint: 'Branch based on data' },
    { type: 'loop', label: 'Loop (For Each)', hint: 'Repeat steps for items in a list' },
];

/**
 * The four step types as palette items. Consumers add an `action` (or use the
 * palette's `onSelect`) to wire selection into the add-step plumbing.
 * @returns {{id:string,type:string,label:string,hint:string}[]}
 */
export function getStepTypeItems() {
    return STEP_TYPE_ITEMS.map((t) => ({ id: `step-type-${t.type}`, ...t }));
}

// --- DOM overlay controller ------------------------------------------------

/**
 * Build a small text node with fuzzy-matched characters wrapped in <mark>.
 * @param {string} label
 * @param {number[]} indices
 * @returns {DocumentFragment}
 */
function highlightLabel(label, indices) {
    const frag = document.createDocumentFragment();
    const set = new Set(indices || []);
    let run = '';
    let runIsMatch = false;

    const flush = () => {
        if (!run) return;
        if (runIsMatch) {
            const mark = document.createElement('mark');
            mark.className = 'palette-match';
            mark.textContent = run;
            frag.appendChild(mark);
        } else {
            frag.appendChild(document.createTextNode(run));
        }
        run = '';
    };

    for (let i = 0; i < label.length; i++) {
        const isMatch = set.has(i);
        if (isMatch !== runIsMatch && run) flush();
        runIsMatch = isMatch;
        run += label[i];
    }
    flush();
    return frag;
}

/**
 * Create a reusable palette overlay mounted into `mount` (defaults to
 * document.body). Returns a controller: `{ open, close, isOpen, destroy }`.
 *
 * open(config):
 *   - items:       array of `{ id, label, hint?, action? }`
 *   - placeholder: search input placeholder (optional)
 *   - onSelect:    (item) => void — called on activation (in addition to any
 *                  item.action). Return not used.
 *   - emptyText:   message shown when nothing matches (optional)
 *
 * @param {{mount?:HTMLElement}} [ctorOptions]
 */
export function createPalette(ctorOptions = {}) {
    const mount = ctorOptions.mount || document.body;

    let overlayEl = null;
    let inputEl = null;
    let listEl = null;
    let emptyEl = null;

    let allItems = [];
    let filtered = []; // [{item, match}]
    let activeIndex = 0;
    let open = false;

    let currentOnSelect = null;
    let currentEmptyText = 'No matches';

    let keydownHandler = null;

    function ensureDom() {
        if (overlayEl) return;

        overlayEl = document.createElement('div');
        overlayEl.className = 'palette-overlay';
        overlayEl.setAttribute('role', 'dialog');
        overlayEl.setAttribute('aria-modal', 'true');

        const panel = document.createElement('div');
        panel.className = 'palette-panel';

        const searchWrap = document.createElement('div');
        searchWrap.className = 'palette-search-wrap';

        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'palette-search';
        inputEl.setAttribute('autocomplete', 'off');
        inputEl.setAttribute('spellcheck', 'false');
        inputEl.setAttribute('aria-label', 'Search');
        searchWrap.appendChild(inputEl);

        listEl = document.createElement('ul');
        listEl.className = 'palette-list';
        listEl.setAttribute('role', 'listbox');

        emptyEl = document.createElement('div');
        emptyEl.className = 'palette-empty';
        emptyEl.style.display = 'none';

        panel.appendChild(searchWrap);
        panel.appendChild(listEl);
        panel.appendChild(emptyEl);
        overlayEl.appendChild(panel);

        // Backdrop click (outside the panel) closes.
        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) close();
        });

        inputEl.addEventListener('input', () => {
            applyFilter();
        });

        keydownHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveActive(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveActive(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                activateActive();
            }
        };
        inputEl.addEventListener('keydown', keydownHandler);

        mount.appendChild(overlayEl);
    }

    function applyFilter() {
        const query = inputEl ? inputEl.value : '';
        filtered = fuzzyFilter(query, allItems, (it) => it.label ?? '');
        activeIndex = 0;
        renderList();
    }

    function renderList() {
        if (!listEl) return;
        listEl.innerHTML = '';

        if (filtered.length === 0) {
            emptyEl.textContent = currentEmptyText;
            emptyEl.style.display = '';
            return;
        }
        emptyEl.style.display = 'none';

        filtered.forEach((entry, idx) => {
            const li = document.createElement('li');
            li.className = 'palette-item';
            li.setAttribute('role', 'option');
            li.dataset.index = String(idx);
            if (idx === activeIndex) {
                li.classList.add('active');
                li.setAttribute('aria-selected', 'true');
            }

            const labelEl = document.createElement('span');
            labelEl.className = 'palette-item-label';
            labelEl.appendChild(
                highlightLabel(entry.item.label ?? '', entry.match?.indices)
            );
            li.appendChild(labelEl);

            if (entry.item.hint) {
                const hintEl = document.createElement('span');
                hintEl.className = 'palette-item-hint';
                hintEl.textContent = entry.item.hint;
                li.appendChild(hintEl);
            }

            li.addEventListener('mousemove', () => {
                if (activeIndex !== idx) {
                    activeIndex = idx;
                    updateActiveClasses();
                }
            });
            li.addEventListener('click', () => {
                activeIndex = idx;
                activateActive();
            });

            listEl.appendChild(li);
        });
    }

    function updateActiveClasses() {
        if (!listEl) return;
        const rows = listEl.querySelectorAll('.palette-item');
        rows.forEach((row, idx) => {
            const isActive = idx === activeIndex;
            row.classList.toggle('active', isActive);
            if (isActive) {
                row.setAttribute('aria-selected', 'true');
                if (typeof row.scrollIntoView === 'function') {
                    row.scrollIntoView({ block: 'nearest' });
                }
            } else {
                row.removeAttribute('aria-selected');
            }
        });
    }

    function moveActive(delta) {
        if (filtered.length === 0) return;
        activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
        updateActiveClasses();
    }

    function activateActive() {
        const entry = filtered[activeIndex];
        if (!entry) return;
        const item = entry.item;
        // Close first so re-entrant opens (e.g. add-step dialogs) work cleanly.
        close();
        try {
            if (typeof item.action === 'function') item.action(item);
            if (typeof currentOnSelect === 'function') currentOnSelect(item);
        } catch (err) {
            // Never let a consumer callback error tear down the palette state.
            // eslint-disable-next-line no-console
            console.error('[palette] item action failed:', err);
        }
    }

    return {
        open(config = {}) {
            ensureDom();
            allItems = Array.isArray(config.items) ? config.items : [];
            currentOnSelect = typeof config.onSelect === 'function' ? config.onSelect : null;
            currentEmptyText = config.emptyText || 'No matches';

            inputEl.value = '';
            inputEl.setAttribute(
                'placeholder',
                config.placeholder || 'Type a command or search…'
            );

            overlayEl.classList.add('open');
            open = true;
            applyFilter();

            // Focus the search box (guard for jsdom where focus is a no-op).
            if (typeof inputEl.focus === 'function') {
                try { inputEl.focus(); } catch (_) { /* ignore */ }
            }
        },

        close() {
            close();
        },

        isOpen() {
            return open;
        },

        destroy() {
            close();
            if (inputEl && keydownHandler) {
                inputEl.removeEventListener('keydown', keydownHandler);
            }
            if (overlayEl && overlayEl.parentNode) {
                overlayEl.parentNode.removeChild(overlayEl);
            }
            overlayEl = null;
            inputEl = null;
            listEl = null;
            emptyEl = null;
            allItems = [];
            filtered = [];
        },
    };

    function close() {
        if (overlayEl) overlayEl.classList.remove('open');
        open = false;
    }
}
