// ========== FILE: jsonView.js (WAVE2 node-features lane) ==========
//
// A READ-ONLY "View as JSON" panel: shows the current flow's canonical
// .flow.json and a line diff against the last-saved bytes.
//
// Editing the JSON in place is DEFERRED — round-trip safety (marker encoding in
// request bodies, extract-path normalization, additive schema evolution) has
// not been proven, and a broken round-trip could silently corrupt a shared
// .flow.json. Until then this panel is strictly read-only: no textarea, no
// contenteditable.
//
// The serialization goes through flowCore.flowModelToJson — the SAME function
// the save path uses — so "View as JSON" always shows exactly what would be
// written to disk, and the diff is a true against-last-saved diff.
//
// Colors/spacing come from the OKLCH semantic tokens in styles.css (see the
// `/* === WAVE2 LANE node-features === */` block at the end of that file).

import { flowModelToJson } from './flowCore.js';

// --- Pure helpers (unit-tested; no DOM) ------------------------------------

/**
 * Serialize a flow model to pretty-printed, canonical JSON text — identical to
 * what the save path would persist. Null/empty model yields ''.
 * @param {object|null} model
 * @returns {string}
 */
export function flowToPrettyJson(model) {
    if (!model) return '';
    try {
        return JSON.stringify(flowModelToJson(model), null, 2);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[jsonView] failed to serialize flow model:', err);
        return '';
    }
}

/**
 * Compute a line-level diff between two blocks of text using a classic LCS.
 * Returns an ordered list of `{ type, text }` where type is one of
 * 'context' (unchanged), 'add' (present only in `next`), 'remove' (present
 * only in `prev`). A changed line surfaces as a remove followed by an add.
 *
 * @param {string} prevText last-saved text ('' when never saved)
 * @param {string} nextText current text
 * @returns {{type:'context'|'add'|'remove', text:string}[]}
 */
export function computeLineDiff(prevText, nextText) {
    const a = String(prevText ?? '').split('\n');
    const b = String(nextText ?? '').split('\n');

    // Treat a truly empty baseline as zero lines (everything is an add),
    // rather than a single empty line.
    const prevLines = prevText === '' ? [] : a;
    const nextLines = nextText === '' ? [] : b;

    const n = prevLines.length;
    const m = nextLines.length;

    // LCS length table.
    const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            if (prevLines[i] === nextLines[j]) {
                lcs[i][j] = lcs[i + 1][j + 1] + 1;
            } else {
                lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
            }
        }
    }

    const out = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (prevLines[i] === nextLines[j]) {
            out.push({ type: 'context', text: prevLines[i] });
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            out.push({ type: 'remove', text: prevLines[i] });
            i++;
        } else {
            out.push({ type: 'add', text: nextLines[j] });
            j++;
        }
    }
    while (i < n) {
        out.push({ type: 'remove', text: prevLines[i] });
        i++;
    }
    while (j < m) {
        out.push({ type: 'add', text: nextLines[j] });
        j++;
    }
    return out;
}

// --- DOM panel controller --------------------------------------------------

/**
 * Create a read-only JSON view panel mounted into `mount`.
 * Returns `{ update, hasChanges, destroy }`.
 *
 * update({ model, savedJson }):
 *   - model:     the current flow model (or null to clear).
 *   - savedJson: the last-saved pretty JSON text, or null/undefined if the
 *                flow has never been saved (then the whole doc reads as added).
 *
 * @param {{mount:HTMLElement}} options
 */
export function createJsonView(options = {}) {
    const mount = options.mount;
    if (!mount) throw new Error('createJsonView requires a mount element');

    let panelEl = null;
    let bodyEl = null;
    let toggleEl = null;
    let statusEl = null;

    let currentText = '';
    let currentSaved = null;
    let currentDiff = [];
    let changed = false;
    let mode = 'diff'; // 'diff' | 'raw'
    let hasModel = false;

    let toggleHandler = null;

    function ensureDom() {
        if (panelEl) return;

        panelEl = document.createElement('div');
        panelEl.className = 'jsonview-panel';

        const header = document.createElement('div');
        header.className = 'jsonview-header';

        const title = document.createElement('h4');
        title.className = 'jsonview-title';
        title.textContent = 'Flow JSON';
        header.appendChild(title);

        statusEl = document.createElement('span');
        statusEl.className = 'jsonview-status';
        header.appendChild(statusEl);

        toggleEl = document.createElement('button');
        toggleEl.type = 'button';
        toggleEl.className = 'jsonview-mode-toggle btn btn-sm btn-secondary';
        toggleEl.textContent = 'Show Full JSON';
        toggleHandler = () => {
            mode = mode === 'diff' ? 'raw' : 'diff';
            toggleEl.textContent = mode === 'diff' ? 'Show Full JSON' : 'Show Diff';
            render();
        };
        toggleEl.addEventListener('click', toggleHandler);
        header.appendChild(toggleEl);

        bodyEl = document.createElement('div');
        bodyEl.className = 'jsonview-body';

        panelEl.appendChild(header);
        panelEl.appendChild(bodyEl);
        mount.appendChild(panelEl);
    }

    function render() {
        ensureDom();
        bodyEl.innerHTML = '';

        if (!hasModel) {
            statusEl.textContent = '';
            statusEl.className = 'jsonview-status';
            toggleEl.style.display = 'none';
            const empty = document.createElement('div');
            empty.className = 'jsonview-empty';
            empty.textContent = 'No flow loaded.';
            bodyEl.appendChild(empty);
            return;
        }

        toggleEl.style.display = '';

        if (changed) {
            statusEl.textContent = currentSaved === null
                ? 'Unsaved (new flow)'
                : 'Unsaved changes';
            statusEl.className = 'jsonview-status changed';
        } else {
            statusEl.textContent = 'Saved';
            statusEl.className = 'jsonview-status saved';
        }

        if (mode === 'raw') {
            renderRaw();
        } else {
            renderDiff();
        }
    }

    function renderRaw() {
        const pre = document.createElement('pre');
        pre.className = 'jsonview-raw';
        const code = document.createElement('code');
        code.textContent = currentText;
        pre.appendChild(code);
        bodyEl.appendChild(pre);
    }

    function renderDiff() {
        const pre = document.createElement('pre');
        pre.className = 'jsonview-diff';

        for (const line of currentDiff) {
            const row = document.createElement('div');
            row.className = `jsonview-line ${line.type}`;

            const gutter = document.createElement('span');
            gutter.className = 'jsonview-gutter';
            gutter.textContent = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';

            const text = document.createElement('span');
            text.className = 'jsonview-text';
            // Preserve empty lines' height.
            text.textContent = line.text.length ? line.text : '​';

            row.appendChild(gutter);
            row.appendChild(text);
            pre.appendChild(row);
        }
        bodyEl.appendChild(pre);
    }

    return {
        update({ model, savedJson } = {}) {
            hasModel = !!model;
            currentText = model ? flowToPrettyJson(model) : '';
            currentSaved = savedJson == null ? null : String(savedJson);

            if (!hasModel) {
                changed = false;
                currentDiff = [];
                render();
                return;
            }

            const baseline = currentSaved === null ? '' : currentSaved;
            currentDiff = computeLineDiff(baseline, currentText);
            if (currentSaved === null) {
                // Never saved: the whole document is new/changed.
                changed = currentText.length > 0;
            } else {
                changed = currentDiff.some((d) => d.type !== 'context');
            }
            render();
        },

        hasChanges() {
            return changed;
        },

        destroy() {
            if (toggleEl && toggleHandler) {
                toggleEl.removeEventListener('click', toggleHandler);
            }
            if (panelEl && panelEl.parentNode) {
                panelEl.parentNode.removeChild(panelEl);
            }
            panelEl = null;
            bodyEl = null;
            toggleEl = null;
            statusEl = null;
        },
    };
}
