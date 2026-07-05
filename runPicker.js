// ========== FILE: runPicker.js ==========
// The Runs-page "New background run" picker: a full modal (the chosen form
// factor) that replaces the old flow dropdown. Search over the whole corpus
// (recents by default, the scanned folder once chosen), a checklist whose
// selection SURVIVES re-filtering, inline batch config, and one Start that
// funnels through the shared launch routine. Built dynamically (no index.html
// markup) and DESIGN-tokened; keyboard-first but mouse-complete.

import { escapeHTML } from './flowCore.js';
import { appState } from './state.js';
import { formatRunLabel } from './listSelection.js';
import {
    getItems, canScan, getScanRoot, setScanRoot, scanFlows, invalidateScan, RENDER_CAP,
} from './flowIndex.js';
import { launchBackgroundRuns } from './launchFlows.js';
import { showMessage } from './uiUtils.js';

let overlay = null;
let state = null; // { selected:Set, items:[], active:number, query:string }

const basename = (p) => String(p).split(/[\\/]/).pop() || String(p);

export function isRunPickerOpen() { return !!overlay; }

export function openRunPicker(preselect = []) {
    if (overlay) closeRunPicker();
    state = { selected: new Set(preselect.filter(Boolean)), items: [], active: 0, query: '' };

    overlay = document.createElement('div');
    overlay.className = 'run-picker-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'New background run');
    overlay.innerHTML = `
        <div class="run-picker" role="document">
            <header class="run-picker-head">
                <div class="run-picker-title-row">
                    <h2 class="run-picker-title">New background run</h2>
                    <button type="button" class="run-picker-folder" data-rp="folder"></button>
                </div>
                <div class="run-picker-search">
                    <svg class="icon icon-sm" aria-hidden="true"><use href="#i-search"/></svg>
                    <input type="text" class="run-picker-input" data-rp="search"
                        placeholder="Search flows to run in the background…" autocomplete="off" spellcheck="false" aria-label="Search flows">
                </div>
            </header>
            <ul class="run-picker-list" data-rp="list" role="listbox" aria-multiselectable="true"></ul>
            <div class="run-picker-note" data-rp="note" aria-live="polite"></div>
            <footer class="run-picker-foot">
                <div class="run-picker-config">
                    <label class="run-picker-check" title="Repeat each flow until you stop it">
                        <input type="checkbox" data-rp="continuous"><span>Continuous</span>
                    </label>
                    <label class="run-picker-delay" title="Delay between steps, and between iterations in Continuous mode">
                        <span>Delay</span><input type="number" data-rp="delay" value="1000" min="0" step="100"><span class="run-picker-unit">ms</span>
                    </label>
                </div>
                <div class="run-picker-actions">
                    <span class="run-picker-count" data-rp="count" hidden></span>
                    <button type="button" class="btn btn-secondary" data-rp="cancel">Cancel</button>
                    <button type="button" class="btn btn-run-go" data-rp="start" disabled>
                        <svg class="icon icon--fill icon-sm" aria-hidden="true"><use href="#i-repeat"/></svg><span data-rp="start-label">Run in background</span>
                    </button>
                </div>
            </footer>
        </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('[data-rp="search"]');
    const listEl = overlay.querySelector('[data-rp="list"]');

    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeRunPicker(); });
    overlay.querySelector('[data-rp="cancel"]').addEventListener('click', () => closeRunPicker());
    overlay.querySelector('[data-rp="start"]').addEventListener('click', () => confirmLaunch());
    overlay.querySelector('[data-rp="folder"]').addEventListener('click', () => chooseFolder());
    input.addEventListener('input', () => { state.query = input.value; refresh(); });
    input.addEventListener('keydown', onSearchKey);
    listEl.addEventListener('click', onListClick);
    document.addEventListener('keydown', onGlobalKey, true);

    renderFolderBtn();
    // Kick a lazy scan if a root is set (fills the corpus for search); recents show immediately.
    if (canScan() && getScanRoot()) scanFlows().then(() => { if (overlay && state.query) refresh(); });
    refresh();
    input.focus();
}

export function closeRunPicker() {
    if (!overlay) return;
    document.removeEventListener('keydown', onGlobalKey, true);
    overlay.remove();
    overlay = null;
    state = null;
}

function renderFolderBtn() {
    const btn = overlay.querySelector('[data-rp="folder"]');
    if (!canScan()) { btn.hidden = true; return; }
    const root = getScanRoot();
    btn.hidden = false;
    btn.innerHTML = root
        ? `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-folder"/></svg><span>${escapeHTML(basename(root))}</span>`
        : `<svg class="icon icon-sm" aria-hidden="true"><use href="#i-folder-plus"/></svg><span>Choose a flows folder</span>`;
    btn.title = root ? `Scanning ${root}. Click to change.` : 'Choose a folder to search all your flows';
}

async function chooseFolder() {
    if (!window.electronAPI || typeof window.electronAPI.chooseDirectory !== 'function') return;
    try {
        const res = await window.electronAPI.chooseDirectory();
        if (res && res.success && !res.cancelled && res.path) {
            setScanRoot(res.path);
            invalidateScan();
            renderFolderBtn();
            const note = overlay.querySelector('[data-rp="note"]');
            note.textContent = 'Scanning folder…';
            await scanFlows(true);
            refresh();
        }
    } catch (err) {
        showMessage('Could not open that folder.', 'error');
    }
}

function refresh() {
    const res = getItems(state.query);
    state.items = res.items;
    if (state.active >= state.items.length) state.active = Math.max(0, state.items.length - 1);
    renderList();
    renderNote(res);
    renderFooter();
}

function renderList() {
    const listEl = overlay.querySelector('[data-rp="list"]');
    const openPath = appState.currentFilePath;
    if (!state.items.length) {
        listEl.innerHTML = `<li class="run-picker-empty">${
            state.query ? 'No flows match. Clear the search or choose a different folder.'
                        : 'No recent flows yet. Search, or choose a flows folder to find them all.'
        }</li>`;
        return;
    }
    listEl.innerHTML = state.items.map((it, i) => {
        const checked = state.selected.has(it.path);
        return `<li class="run-picker-row${checked ? ' checked' : ''}${i === state.active ? ' active' : ''}"
                data-path="${escapeHTML(it.path)}" data-i="${i}" role="option" aria-selected="${checked}">
            <span class="run-picker-box" aria-hidden="true">${checked ? '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-check"/></svg>' : ''}</span>
            <span class="run-picker-name">${escapeHTML(it.label)}</span>
            ${it.path === openPath ? '<span class="run-picker-openflag">open</span>' : ''}
            <span class="run-picker-hint" title="${escapeHTML(it.path)}">${escapeHTML(it.hint || '')}</span>
        </li>`;
    }).join('');
}

function renderNote(res) {
    const note = overlay.querySelector('[data-rp="note"]');
    const parts = [];
    if (res.scanning) parts.push('Scanning folder…');
    if (res.capped) parts.push(`Showing ${RENDER_CAP} of ${res.total} matches. Refine your search.`);
    const hiddenSelected = [...state.selected].filter((p) => !state.items.some((it) => it.path === p)).length;
    if (hiddenSelected) parts.push(`+${hiddenSelected} selected not shown`);
    if (res.truncated) parts.push('Folder is large; results were capped.');
    note.textContent = parts.join('  ·  ');
    note.hidden = !parts.length;
}

function renderFooter() {
    const n = state.selected.size;
    const start = overlay.querySelector('[data-rp="start"]');
    const label = overlay.querySelector('[data-rp="start-label"]');
    const count = overlay.querySelector('[data-rp="count"]');
    const effective = n > 0 ? n : 0;
    label.textContent = formatRunLabel(effective || 1, { compact: true });
    // With no explicit checks, Start launches the active row (single). Disabled only if the list is empty.
    start.disabled = state.items.length === 0 && n === 0;
    count.hidden = n === 0;
    count.textContent = `${n} selected`;
}

function setActive(i) {
    if (!state.items.length) return;
    state.active = (i + state.items.length) % state.items.length;
    renderList();
    const row = overlay.querySelector(`.run-picker-row[data-i="${state.active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
}

function toggleAt(i) {
    const it = state.items[i];
    if (!it) return;
    if (state.selected.has(it.path)) state.selected.delete(it.path);
    else state.selected.add(it.path);
    refresh();
}

function onListClick(e) {
    const row = e.target.closest('.run-picker-row');
    if (!row) return;
    toggleAt(Number(row.dataset.i));
}

function onSearchKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(state.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === ' ' && state.query === '') { /* allow space in a non-empty query; toggle only when nothing typed */ e.preventDefault(); toggleAt(state.active); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllVisible(); }
    else if (e.key === 'Enter') { e.preventDefault(); confirmLaunch(); }
}

function onGlobalKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRunPicker(); }
}

function selectAllVisible() {
    state.items.forEach((it) => state.selected.add(it.path));
    refresh();
}

function readConfig() {
    return {
        continuous: !!overlay.querySelector('[data-rp="continuous"]').checked,
        delayMs: Math.max(0, Number(overlay.querySelector('[data-rp="delay"]').value) || 0),
    };
}

function confirmLaunch() {
    let paths = [...state.selected];
    if (!paths.length) {
        const it = state.items[state.active];
        if (it) paths = [it.path]; // no explicit checks: launch the highlighted row
    }
    if (!paths.length) return;
    const cfg = readConfig();
    closeRunPicker();
    launchBackgroundRuns(paths, cfg);
}
