// ========== FILE: importCurlHarUI.js ==========
// WAVE2 engine-features lane: thin renderer-side UI hook that wires the sidebar
// "Import cURL / HAR" controls to the zero-dependency parsers in
// importCurlHar.js. Kept separate from the parser so the parsing logic stays
// framework/DOM free and fully unit-tested.

import { logger } from './logger.js';
import { appState } from './state.js';
import { showMessage, renderCurrentFlow, setDirty } from './uiUtils.js';
import { parseCurl, parseHar } from './importCurlHar.js';

/**
 * Append imported request steps to the current flow model's top-level steps,
 * then refresh the UI and mark the flow dirty.
 * @param {Object[]} steps - request steps produced by parseCurl / parseHar
 * @returns {number} number of steps appended
 */
export function appendImportedSteps(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return 0;

    if (!appState.currentFlowModel) {
        showMessage('Open or create a flow before importing requests.', 'warning');
        return 0;
    }

    appState.currentFlowModel.steps = appState.currentFlowModel.steps || [];
    for (const step of steps) {
        appState.currentFlowModel.steps.push(step);
    }

    renderCurrentFlow();
    setDirty();
    showMessage(`Imported ${steps.length} request step${steps.length === 1 ? '' : 's'}.`, 'success');
    return steps.length;
}

/**
 * Prompt the user for a cURL command and import it as a request step.
 */
export function importCurlFromPrompt() {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') return;
    const input = window.prompt('Paste a cURL command to import as a request step:');
    if (input == null || !input.trim()) return;
    try {
        const step = parseCurl(input);
        appendImportedSteps([step]);
    } catch (error) {
        logger.error('[Import] cURL parse failed:', error);
        showMessage(`Could not import cURL command: ${error.message}`, 'error');
    }
}

/**
 * Import request steps from a HAR file's text contents.
 * @param {string} harText
 */
export function importHarText(harText) {
    try {
        const steps = parseHar(harText);
        if (steps.length === 0) {
            showMessage('No HTTP request entries found in HAR file.', 'warning');
            return;
        }
        appendImportedSteps(steps);
    } catch (error) {
        logger.error('[Import] HAR parse failed:', error);
        showMessage(`Could not import HAR file: ${error.message}`, 'error');
    }
}

/**
 * Wire the sidebar import button + hidden HAR file input. Safe to call when the
 * elements are absent (e.g. in tests) — it simply no-ops on missing nodes.
 */
export function initializeImportCurlHar() {
    if (typeof document === 'undefined') return;

    const curlBtn = document.getElementById('import-curl-btn');
    const harBtn = document.getElementById('import-har-btn');
    const harInput = document.getElementById('import-har-file-input');

    if (curlBtn) {
        curlBtn.addEventListener('click', () => {
            logger.debug('[Import] cURL import button clicked.');
            importCurlFromPrompt();
        });
    }

    if (harBtn && harInput) {
        harBtn.addEventListener('click', () => {
            logger.debug('[Import] HAR import button clicked.');
            harInput.click();
        });
        harInput.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                importHarText(String(reader.result || ''));
            };
            reader.onerror = () => {
                logger.error('[Import] Failed to read HAR file.');
                showMessage('Failed to read the selected HAR file.', 'error');
            };
            reader.readAsText(file);
            // Reset so selecting the same file again re-triggers change.
            event.target.value = '';
        });
    }

    if (!curlBtn && !harBtn) {
        logger.warn('[Import] Import cURL/HAR controls not found in DOM.');
    }
}
