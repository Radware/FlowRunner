// ========== FILE: aiUI.js ==========
// The AI Copilot's visible surface (beta 1.5): the rail entry + settings
// modal (opt-in, model catalog, downloads), the sparkle affordances scattered
// through the app, and the streaming answer panel.
//
// Interaction contract:
//   - EVERYTHING is opt-in. Until the user enables the copilot and a model is
//     on disk, the app shows nothing but the rail entry (html.ai-ready gates
//     every affordance via CSS).
//   - Suggestions FILL the existing editors (rows appear exactly as if typed);
//     the user reviews and presses Save Step. The copilot never saves.
//   - Prose answers stream into a dismissible panel; generation is abortable.
//   - In the browser (no electronAPI) the modal explains desktop-only and all
//     affordances stay hidden.

import { appState } from './state.js';
import { escapeHTML, findStepById } from './flowCore.js';
import { showMessage } from './uiUtils.js';
import { logger } from './logger.js';
import {
    explainResult, suggestExtractions, suggestAssertions, nlToCondition,
    suggestStepName, suggestFlowDescription, runDigest, explainFlow,
    rememberApplied, getQualityCounters,
} from './aiFeatures.js';

let aiState = null;          // last known state from main
let aiBusy = false;          // one interactive request at a time (UX guard)
let chunkSinks = new Map();  // requestId -> (text) => void
let requestCounter = 0;

const hasBridge = () => !!(window.electronAPI && window.electronAPI.ai);

// --- state sync ---------------------------------------------------------------

async function refreshAiState() {
    if (!hasBridge()) { applyReadiness(); return; }
    try {
        const res = await window.electronAPI.ai.getState();
        if (res && res.success) aiState = res.data;
    } catch (err) {
        logger.warn('[aiUI] getState failed:', err);
    }
    applyReadiness();
    renderAiModalContent();
}

function isReady() {
    if (!aiState || !aiState.enabled || !aiState.selectedModelId) return false;
    const entry = (aiState.catalog || []).find((m) => m.id === aiState.selectedModelId);
    return !!(entry && entry.downloaded);
}

function applyReadiness() {
    document.documentElement.classList.toggle('ai-ready', isReady());
    const railBtn = document.getElementById('rail-ai-btn');
    if (railBtn) railBtn.classList.toggle('active', isReady());
}

// --- init ----------------------------------------------------------------------

export function initAiUI() {
    document.getElementById('rail-ai-btn')?.addEventListener('click', openAiModal);

    if (hasBridge()) {
        window.electronAPI.ai.onStateChanged(() => refreshAiState());
        window.electronAPI.ai.onDownloadProgress(renderDownloadProgress);
        window.electronAPI.ai.onChunk(({ requestId, text }) => {
            const sink = chunkSinks.get(requestId);
            if (sink) sink(text);
        });
        refreshAiState();
    }

    // Delegated sparkle actions (affordances render with data-ai-action).
    document.addEventListener('click', onAiAction);

    // Prewarm: when a run starts and the copilot is ready, load the model in
    // the background so the first suggestion after the run is instant.
    ['run-flow-btn', 'bg-run-current-btn'].forEach((id) => {
        document.getElementById(id)?.addEventListener('click', () => {
            if (isReady() && hasBridge()) window.electronAPI.ai.prewarm().catch(() => {});
        });
    });
}

// --- settings modal --------------------------------------------------------------

function closeAiModal() { document.querySelector('.ai-modal-overlay')?.remove(); }

export function openAiModal() {
    closeAiModal();
    const overlay = document.createElement('div');
    overlay.className = 'ai-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'AI Copilot');
    overlay.innerHTML = `
        <div class="ai-modal" role="document">
            <header class="ai-modal-head">
                <h2 class="ai-modal-title"><svg class="icon" aria-hidden="true"><use href="#i-sparkle"/></svg> AI Copilot <span class="ai-beta-tag">beta</span></h2>
                <button type="button" class="btn btn-sm btn-ghost btn-icon" data-ai-modal="close" aria-label="Close">
                    <svg class="icon icon-sm" aria-hidden="true"><use href="#i-x"/></svg>
                </button>
            </header>
            <div class="ai-modal-body" data-ai-modal="body"></div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeAiModal(); });
    overlay.querySelector('[data-ai-modal="close"]').addEventListener('click', closeAiModal);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAiModal(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
    renderAiModalContent();
    refreshAiState();
}

function renderAiModalContent() {
    const body = document.querySelector('[data-ai-modal="body"]');
    if (!body) return;

    if (!hasBridge()) {
        body.innerHTML = `<p class="ai-modal-note">The AI Copilot runs a small model locally inside the desktop app. It is not available in the browser preview.</p>`;
        return;
    }
    if (!aiState) {
        body.innerHTML = '<p class="ai-modal-note">Loading…</p>';
        return;
    }

    const { enabled, selectedModelId, catalog = [], gpu, modelLoaded, loading } = aiState;
    body.innerHTML = `
        <label class="ai-enable-row">
            <input type="checkbox" data-ai-modal="enable" ${enabled ? 'checked' : ''}>
            <span class="ai-enable-text">
                <strong>Enable the AI Copilot</strong>
                <small>Runs a small language model on this machine. Nothing ever leaves your computer; works fully offline once a model is downloaded.</small>
            </span>
        </label>
        <div class="ai-catalog${enabled ? '' : ' disabled'}">
            ${catalog.map((m) => {
                const selected = m.id === selectedModelId;
                return `
                <div class="ai-model-card${selected ? ' selected' : ''}" data-model-id="${escapeHTML(m.id)}">
                    <label class="ai-model-pick" title="Use this model">
                        <input type="radio" name="ai-model" value="${escapeHTML(m.id)}" ${selected ? 'checked' : ''} ${enabled ? '' : 'disabled'}>
                        <span class="ai-model-name">${escapeHTML(m.label)}</span>
                    </label>
                    <p class="ai-model-detail">${escapeHTML(m.detail)}</p>
                    <div class="ai-model-meta">
                        <span>~${(m.sizeMB / 1000).toFixed(1)} GB download</span>
                        <span>${m.minRamGB} GB RAM</span>
                        <span>${escapeHTML(m.license)}</span>
                    </div>
                    <div class="ai-model-actions">
                        ${m.downloading
                            ? `<div class="ai-dl-progress" data-dl-progress><span class="ai-dl-bar" style="width:0%"></span></div>
                               <button type="button" class="btn btn-sm btn-secondary" data-ai-modal="cancel-dl" ${enabled ? '' : 'disabled'}>Cancel</button>`
                            : m.downloaded
                                ? `<span class="ai-model-ready">On this machine</span>
                                   <button type="button" class="btn btn-sm btn-ghost" data-ai-modal="delete" ${enabled ? '' : 'disabled'}>Remove</button>`
                                : `<button type="button" class="btn btn-sm btn-primary" data-ai-modal="download" ${enabled ? '' : 'disabled'}>Download</button>`}
                    </div>
                </div>`;
            }).join('')}
        </div>
        <div class="ai-modal-quality">${(() => {
            const q = getQualityCounters();
            const parts = Object.entries(q).map(([task, c]) => `${task}: ${c.calls} calls · ${c.repairs} retries · ${c.failures} failed`);
            return parts.length ? 'Suggestion quality — ' + parts.join('  |  ') : '';
        })()}</div>
        <div class="ai-modal-status">
            ${loading ? 'Loading model…'
                : modelLoaded ? `Model loaded (${escapeHTML(String(gpu || 'cpu'))})`
                : isReady() ? 'Ready. The model loads on first use and unloads after a few idle minutes.'
                : enabled ? 'Pick and download a model to finish setup.'
                : ''}
        </div>`;

    body.querySelector('[data-ai-modal="enable"]')?.addEventListener('change', async (e) => {
        await window.electronAPI.ai.setEnabled(e.target.checked);
        refreshAiState();
    });
    body.querySelectorAll('input[name="ai-model"]').forEach((radio) => {
        radio.addEventListener('change', async () => {
            await window.electronAPI.ai.selectModel(radio.value);
            refreshAiState();
        });
    });
    body.querySelectorAll('[data-ai-modal="download"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.closest('.ai-model-card').dataset.modelId;
            btn.disabled = true;
            try {
                const res = await window.electronAPI.ai.downloadModel(id);
                if (res && res.success === false) throw new Error(res.error);
                if (res?.data?.cancelled) showMessage('Download cancelled.', 'info');
                else showMessage('Model downloaded. The copilot is ready.', 'success');
            } catch (err) {
                showMessage(`Model download failed: ${err.message}`, 'error');
            }
            refreshAiState();
        });
    });
    body.querySelectorAll('[data-ai-modal="cancel-dl"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.closest('.ai-model-card').dataset.modelId;
            window.electronAPI.ai.cancelDownload(id);
        });
    });
    body.querySelectorAll('[data-ai-modal="delete"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.closest('.ai-model-card').dataset.modelId;
            await window.electronAPI.ai.deleteModel(id);
            refreshAiState();
        });
    });
}

function renderDownloadProgress({ modelId, downloadedSize, totalSize }) {
    const card = document.querySelector(`.ai-model-card[data-model-id="${CSS.escape(modelId)}"]`);
    const bar = card?.querySelector('[data-dl-progress] .ai-dl-bar');
    if (bar && totalSize > 0) bar.style.width = `${Math.min(100, (downloadedSize / totalSize) * 100).toFixed(1)}%`;
}

// --- streaming answer panel -------------------------------------------------------

function openAnswerPanel(host, title) {
    host.querySelector(':scope > .ai-answer')?.remove();
    const panel = document.createElement('div');
    panel.className = 'ai-answer';
    panel.innerHTML = `
        <div class="ai-answer-head">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#i-sparkle"/></svg>
            <span class="ai-answer-title">${escapeHTML(title)}</span>
            <button type="button" class="btn btn-sm btn-ghost btn-icon ai-answer-close" aria-label="Dismiss">
                <svg class="icon icon-sm" aria-hidden="true"><use href="#i-x"/></svg>
            </button>
        </div>
        <div class="ai-answer-text" aria-live="polite"></div>`;
    host.appendChild(panel);
    const textEl = panel.querySelector('.ai-answer-text');
    panel.querySelector('.ai-answer-close').addEventListener('click', () => {
        panel.dataset.dismissed = 'true';
        panel.remove();
    });
    return {
        panel,
        append: (chunk) => { textEl.textContent += chunk; },
        finish: () => panel.classList.add('done'),
        fail: (msg) => { textEl.textContent = msg; panel.classList.add('error'); },
    };
}

async function streamProse(host, title, run) {
    const requestId = `ai-${++requestCounter}`;
    const view = openAnswerPanel(host, title);
    chunkSinks.set(requestId, view.append);
    try {
        const res = await run(requestId);
        if (res && res.success === false) throw new Error(res.error);
        view.finish();
    } catch (err) {
        view.fail(`Couldn't generate: ${err.message}`);
    } finally {
        chunkSinks.delete(requestId);
    }
}

// --- affordance actions -------------------------------------------------------------

function setActionBusy(btn, busy) {
    if (!btn) return;
    btn.classList.toggle('ai-working', busy);
    btn.disabled = busy;
}

async function onAiAction(e) {
    const btn = e.target.closest('[data-ai-action]');
    if (!btn) return;
    const action = btn.dataset.aiAction;
    if (!isReady()) { openAiModal(); return; }
    if (aiBusy) { showMessage('The copilot is already working on something.', 'info'); return; }

    aiBusy = true;
    setActionBusy(btn, true);
    try {
        if (action === 'explain-result') await actionExplainResult(btn);
        else if (action === 'run-digest') await actionRunDigest(btn);
        else if (action === 'suggest-extract') await actionSuggest(btn, 'extract');
        else if (action === 'suggest-assert') await actionSuggest(btn, 'assert');
        else if (action === 'nl-condition') await actionNlCondition(btn);
        else if (action === 'name-step') await actionNameStep(btn);
        else if (action === 'describe-flow') await actionDescribeFlow(btn);
    } catch (err) {
        logger.warn('[aiUI] action failed:', err);
        showMessage(`AI Copilot: ${err.message}`, 'warning');
    } finally {
        aiBusy = false;
        setActionBusy(btn, false);
    }
}

function latestResultForStep(stepId) {
    const results = appState.executionResults || [];
    for (let i = results.length - 1; i >= 0; i--) {
        if (results[i].stepId === stepId) return results[i];
    }
    return null;
}

async function actionExplainResult(btn) {
    const item = btn.closest('.result-item');
    const stepId = item?.dataset.stepId;
    const index = Number(item?.dataset.resultIndex);
    const results = appState.executionResults || [];
    const result = Number.isFinite(index) && results[index] ? results[index]
        : (stepId ? latestResultForStep(stepId) : null);
    if (!result) throw new Error('No result data for this step.');
    const step = (stepId && appState.currentFlowModel)
        ? findStepById(appState.currentFlowModel.steps, stepId) || { type: 'request', name: result.stepName }
        : { type: 'request', name: result.stepName };
    const host = item.querySelector('.result-detail') || item;
    await streamProse(host, 'What happened', (requestId) => explainResult(step, result, requestId));
}

/** Palette command: narrated flow walkthrough streamed over the results pane. */
export async function streamFlowExplanation(host) {
    if (!appState.currentFlowModel) { showMessage('Open a flow first.', 'warning'); return; }
    if (aiBusy) { showMessage('The copilot is already working on something.', 'info'); return; }
    aiBusy = true;
    try {
        await streamProse(host, 'Flow walkthrough', (requestId) => explainFlow(appState.currentFlowModel, requestId));
        host.prepend(host.querySelector(':scope > .ai-answer'));
    } finally { aiBusy = false; }
}

async function actionRunDigest(btn) {
    const host = document.querySelector('.runner-results-container');
    if (!host) return;
    await streamProse(host, 'Run summary', (requestId) => runDigest(requestId));
    host.prepend(host.querySelector(':scope > .ai-answer'));
}

/** Fill the extract/assertion editors by driving the EXISTING add-row UI. */
async function actionSuggest(btn, kind) {
    const editor = btn.closest('.step-editor');
    const nameInput = editor?.querySelector('[id^="step-editor-name-"]');
    const stepId = nameInput ? nameInput.id.replace('step-editor-name-', '') : null;
    if (!stepId) throw new Error('Open a request step first.');
    const step = appState.currentFlowModel ? findStepById(appState.currentFlowModel.steps, stepId) : null;
    const result = latestResultForStep(stepId);
    if (!step || !result || !result.output) {
        throw new Error('Run the flow first so the copilot can see this step\'s real response.');
    }

    if (kind === 'extract') {
        const known = Object.keys(appState.definedVariables || {});
        const suggestions = await suggestExtractions(step, result, known);
        const list = editor.querySelector('.extracts-list');
        const addBtn = editor.querySelector('.btn-add-extract');
        suggestions.forEach(({ variable, path }) => {
            addBtn.click();
            const rows = list.querySelectorAll('.extract-row');
            const row = rows[rows.length - 1];
            const keyEl = row.querySelector('.extract-var-name');
            const valEl = row.querySelector('.extract-path');
            keyEl.value = variable; keyEl.dispatchEvent(new Event('input', { bubbles: true }));
            valEl.value = path; valEl.dispatchEvent(new Event('input', { bubbles: true }));
            row.classList.add('ai-suggested');
        });
        rememberApplied('extractions', step.url, suggestions);
        showMessage(`Suggested ${suggestions.length} extraction${suggestions.length === 1 ? '' : 's'} — review and Save Step.`, 'success');
    } else {
        const suggestions = await suggestAssertions(step, result);
        const container = editor.querySelector('.assertions-editor');
        const addBtn = container.querySelector('.btn-add-assertion');
        suggestions.forEach(({ target, operator, value }) => {
            addBtn.click();
            const rows = container.querySelectorAll('.assertion-row');
            const row = rows[rows.length - 1];
            const t = row.querySelector('.assertion-target');
            const o = row.querySelector('.assertion-operator');
            const v = row.querySelector('.assertion-value');
            t.value = target; t.dispatchEvent(new Event('input', { bubbles: true }));
            o.value = operator; o.dispatchEvent(new Event('change', { bubbles: true }));
            if (v) { v.value = value; v.dispatchEvent(new Event('input', { bubbles: true })); }
            row.classList.add('ai-suggested');
        });
        rememberApplied('assertions', step.url, suggestions.map(({ target, operator, value }) => ({ path: target, operator, value })));
        showMessage(`Suggested ${suggestions.length} assertion${suggestions.length === 1 ? '' : 's'} — review and Save Step.`, 'success');
    }
}

async function actionNlCondition(btn) {
    const editor = btn.closest('.step-editor');
    const input = editor?.querySelector('.ai-nl-condition-input');
    const text = input?.value.trim();
    if (!text) { input?.focus(); throw new Error('Describe the condition first (e.g. "status is 200 and…" ).'); }
    const nameInput = editor.querySelector('[id^="step-editor-name-"]');
    const stepId = nameInput ? nameInput.id.replace('step-editor-name-', '') : null;
    const known = Object.keys(appState.definedVariables || {});
    const { variable, operator, value } = await nlToCondition(text, known, appState.lastRuntimeContext || null);

    const base = variable.split(/[.[]/)[0];
    const rest = variable.slice(base.length).replace(/^\./, '');
    const varSelect = editor.querySelector(`#cond-var-${stepId}`);
    const pathInput = editor.querySelector(`#cond-path-${stepId}`);
    const opSelect = editor.querySelector(`#cond-op-${stepId}`);
    const valInput = editor.querySelector(`#cond-val-${stepId}`);
    if (!varSelect || !opSelect) throw new Error('Condition editor not found.');
    varSelect.value = base; varSelect.dispatchEvent(new Event('change', { bubbles: true }));
    if (pathInput) { pathInput.value = rest; pathInput.dispatchEvent(new Event('input', { bubbles: true })); }
    opSelect.value = operator; opSelect.dispatchEvent(new Event('change', { bubbles: true }));
    if (valInput) { valInput.value = value; valInput.dispatchEvent(new Event('input', { bubbles: true })); }
    showMessage('Condition filled in — review and Save Step.', 'success');
}

async function actionNameStep(btn) {
    const editor = btn.closest('.step-editor');
    const nameInput = editor?.querySelector('[id^="step-editor-name-"]');
    const stepId = nameInput ? nameInput.id.replace('step-editor-name-', '') : null;
    const step = stepId && appState.currentFlowModel ? findStepById(appState.currentFlowModel.steps, stepId) : null;
    if (!nameInput) throw new Error('Open a step first.');
    const name = await suggestStepName(step || { type: 'request', name: nameInput.value });
    nameInput.value = name;
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.focus();
}

async function actionDescribeFlow(btn) {
    if (!appState.currentFlowModel) throw new Error('Open a flow first.');
    const textarea = document.getElementById('global-flow-description');
    if (!textarea) throw new Error('Description field not found.');
    const description = await suggestFlowDescription(appState.currentFlowModel);
    textarea.value = description;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
}
