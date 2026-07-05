// ========== FILE: launchFlows.js ==========
// The ONE shared background-run launch routine. Every entry point funnels
// through it (sidebar action bar + context menu, topbar send-current popover,
// the Runs-page modal picker) so behavior, feedback, and frecency accounting
// are identical no matter where the user launched from.
//
// Rules baked in here:
//   - The currently-open flow launches from its LIVE model (unsaved edits
//     included); every other flow is read fresh from disk.
//   - Step-less flows are skipped, not launched, and summarized.
//   - Launches are staggered ~30ms so the 250ms bgruns render coalescer is not
//     stampeded when many start at once.
//   - Per-flow read failures are collected, never thrown, so one bad file does
//     not abort a batch.

import { startBackgroundRun } from './backgroundRuns.js';
import { appState } from './state.js';
import { readFlowModelFromPath } from './fileOperations.js';
import { showMessage } from './uiUtils.js';
import { bumpFrecency } from './flowIndex.js';
import { logger } from './logger.js';

const STAGGER_MS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const basename = (p) => String(p).split(/[\\/]/).pop() || String(p);

function stepCount(model) { return ((model && model.steps) || []).length; }

async function resolveModel(path) {
    if (path && path === appState.currentFilePath && appState.currentFlowModel) {
        return appState.currentFlowModel; // honor live, unsaved edits for the open flow
    }
    return readFlowModelFromPath(path);
}

/**
 * Launch one or more flow FILES in the background.
 * @param {string[]} paths
 * @param {object} [opts]
 * @param {boolean} [opts.continuous=false]
 * @param {number}  [opts.delayMs=1000]
 * @param {boolean} [opts.encodeUrlVars=false]
 * @returns {Promise<{started:number, skipped:number, failed:number}>}
 */
export async function launchBackgroundRuns(paths, opts = {}) {
    const { continuous = false, delayMs = 1000, encodeUrlVars = false } = opts;
    const list = [...new Set((paths || []).filter(Boolean))];
    let started = 0;
    const skipped = [];
    const failed = [];

    for (let i = 0; i < list.length; i++) {
        const path = list[i];
        try {
            const model = await resolveModel(path);
            if (!model) { failed.push(basename(path)); continue; }
            if (stepCount(model) === 0) { skipped.push(model.name || basename(path)); continue; }
            startBackgroundRun({
                model,
                name: model.name || basename(path),
                continuous, delayMs, encodeUrlVars,
            });
            bumpFrecency(path);
            started += 1;
            if (i < list.length - 1) await sleep(STAGGER_MS);
        } catch (err) {
            logger.warn(`[launchFlows] could not launch ${path}:`, err);
            failed.push(basename(path));
        }
    }

    reportBatch({ started, skipped, failed, continuous, single: list.length === 1 });
    return { started, skipped: skipped.length, failed: failed.length };
}

/**
 * Launch the flow currently open in the editor from its LIVE model (unsaved
 * edits included). Used by the topbar send-current control.
 * @param {object} [opts] same shape as launchBackgroundRuns
 * @returns {boolean} whether it started
 */
export function launchCurrentFlow(opts = {}) {
    const { continuous = false, delayMs = 1000, encodeUrlVars = false } = opts;
    const model = appState.currentFlowModel;
    if (!model) { showMessage('Open a flow first to run it in the background.', 'warning'); return false; }
    if (stepCount(model) === 0) { showMessage('This flow has no steps to run.', 'warning'); return false; }
    startBackgroundRun({
        model,
        name: model.name || basename(appState.currentFilePath || 'Untitled flow'),
        continuous, delayMs, encodeUrlVars,
    });
    if (appState.currentFilePath) bumpFrecency(appState.currentFilePath);
    reportBatch({ started: 1, skipped: [], failed: [], continuous, single: true });
    return true;
}

function reportBatch({ started, skipped, failed, continuous, single }) {
    const cont = continuous ? ' (continuous)' : '';
    if (started === 0) {
        if (skipped.length) showMessage(`No runs started. ${skipped.length} flow${skipped.length === 1 ? '' : 's'} had no steps.`, 'warning');
        else if (failed.length) showMessage(`Could not start any runs. ${failed.length} flow${failed.length === 1 ? '' : 's'} could not be read.`, 'error');
        return;
    }

    let msg = single || started === 1
        ? `Background run started${cont}. Watch it in Runs, on the left rail.`
        : `Started ${started} background runs${cont}. Watch them in Runs, on the left rail.`;
    const notes = [];
    if (skipped.length) notes.push(`${skipped.length} skipped (no steps)`);
    if (failed.length) notes.push(`${failed.length} could not be read`);
    if (notes.length) msg += ` ${notes.join(', ')}.`;
    showMessage(msg, failed.length ? 'warning' : 'success');
}
