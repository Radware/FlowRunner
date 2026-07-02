// ========== FILE: backgroundRuns.js ==========
// Background flow runs: independent FlowRunner instances executing SNAPSHOTS of
// flows while the user keeps authoring. The foreground runner (appState.runner,
// runnerInterface.js) is completely untouched — background runs never paint the
// canvas or the list rows; their world is the Runs pane + the topbar chips.
//
// Design:
//   - Each run owns a deep snapshot of the flow model taken at launch, so later
//     edits never leak into an executing run.
//   - Results are kept per-run in a ring buffer (RESULT_BUFFER) of compact
//     entries — enough for a live feed without unbounded memory in continuous
//     mode (a demo can run for hours).
//   - All mutations dispatch 'flowrunner:bgruns-changed' on document; the UI
//     (eventHandlers/uiUtils) re-renders from getBackgroundRuns(). This module
//     stays DOM-free except for that event, so it is unit-testable under jsdom.

import { createFlowRunner, substituteVariablesInStep, evaluateCondition } from './executionHelpers.js';
import { evaluatePath } from './flowCore.js';
import { logger } from './logger.js';

const RESULT_BUFFER = 50;
const MAX_FINISHED_KEPT = 20;

const runs = new Map(); // id -> run record
let counter = 0;

function notify() {
    try {
        document.dispatchEvent(new CustomEvent('flowrunner:bgruns-changed'));
    } catch (_) { /* non-DOM environment */ }
}

function snapshotModel(model) {
    // Deep, structured-clone-safe copy; flow models are plain JSON data.
    return JSON.parse(JSON.stringify(model));
}

/** @returns {Array} run records, newest first (live runs before finished). */
export function getBackgroundRuns() {
    return [...runs.values()].sort((a, b) => {
        const liveA = a.status === 'running' ? 0 : 1;
        const liveB = b.status === 'running' ? 0 : 1;
        return liveA - liveB || b.startedAt - a.startedAt;
    });
}

export function getBackgroundRun(id) {
    return runs.get(id) || null;
}

/** True when at least one background run is executing. */
export function hasLiveBackgroundRuns() {
    return [...runs.values()].some((r) => r.status === 'running');
}

/**
 * Launch a background run over a snapshot of `model`.
 * @param {object} opts
 * @param {object} opts.model       flow model (will be snapshotted)
 * @param {string} [opts.name]      display name (defaults to the model name)
 * @param {boolean} [opts.continuous=false]
 * @param {number} [opts.delayMs=1000]  between steps AND between iterations
 * @param {boolean} [opts.encodeUrlVars=false]
 * @returns {string} run id
 */
export function startBackgroundRun({ model, name, continuous = false, delayMs = 1000, encodeUrlVars = false }) {
    const id = `bg-${++counter}-${Math.random().toString(36).slice(2, 7)}`;
    const snapshot = snapshotModel(model);

    const run = {
        id,
        name: name || snapshot.name || 'Untitled flow',
        stepCount: (snapshot.steps || []).length,
        continuous,
        delayMs,
        status: 'running',            // running | passed | failed | stopped
        iterations: 0,                // completed iterations
        currentIteration: 1,          // 1-based; we are in iteration 1 from launch
        _iterationOpen: true,         // true while an iteration is executing (unclosed)
        passes: 0,
        fails: 0,
        startedAt: Date.now(),
        endedAt: null,
        lastError: null,
        results: [],                  // ring buffer of compact step results
        _iterationHadError: false,
        runner: null,
    };

    const pushResult = (entry) => {
        run.results.push(entry);
        if (run.results.length > RESULT_BUFFER) run.results.shift();
    };

    // Iterations are closed EAGERLY on the engine's onIterationComplete (fired
    // before the between-iterations delay) — closing lazily on the NEXT
    // onIterationStart would lose the final completed iteration from the
    // tallies whenever the user stops during the wait window (the common case
    // for short flows).
    const closeIteration = () => {
        if (!run._iterationOpen) return;
        run._iterationOpen = false;
        run.iterations += 1;
        if (run._iterationHadError) run.fails += 1; else run.passes += 1;
        run._iterationHadError = false;
    };

    run.runner = createFlowRunner({
        delay: delayMs,
        encodeUrlVars,
        substituteVariablesFn: substituteVariablesInStep,
        evaluateConditionFn: evaluateCondition,
        evaluatePathFn: evaluatePath,
        onStepStart: () => run.results.length, // engine expects a result index; unused here
        onStepComplete: (resultIndex, step, result) => {
            if (result.status === 'error') run._iterationHadError = true;
            pushResult({
                at: Date.now(),
                iteration: run.currentIteration,
                stepName: step?.name || 'Step',
                method: step?.method || null,
                status: result.status,
                httpStatus: result.output?.status ?? null,
                duration: result.output?.duration ?? null,
                error: result.error ? String(result.error) : null,
            });
            notify();
        },
        onError: (resultIndex, step, error) => {
            run._iterationHadError = true;
            run.lastError = String(error?.message || error || 'Step failed');
            notify();
        },
        onIterationStart: () => {
            // Subsequent-iteration start (the engine skips this for iteration 1).
            run.currentIteration += 1;
            run._iterationOpen = true;
            notify();
        },
        onIterationComplete: () => {
            closeIteration();
            notify();
        },
        onFlowComplete: () => {
            // Single runs never see onIterationComplete; close the run here.
            closeIteration();
            run.status = run.fails > 0 ? 'failed' : 'passed';
            run.endedAt = Date.now();
            pruneFinished();
            notify();
        },
        onFlowStopped: () => {
            // A USER-requested stop aborts any in-flight (still-open) iteration;
            // that abort is not a failure. Only count the partial iteration when
            // the flow stopped itself (onFailure=stop after a real error).
            if (run._iterationOpen && run._iterationHadError && !run._stopRequested) {
                run.iterations += 1;
                run.fails += 1;
            }
            run._iterationOpen = false;
            run._iterationHadError = false;
            // A user-requested stop is not an error: the aborted request would
            // otherwise leave a scary "…failed…" line on a healthy run's card.
            if (run._stopRequested) run.lastError = null;
            run.status = run._stopRequested ? 'stopped' : (run.fails > 0 ? 'failed' : 'stopped');
            run.endedAt = Date.now();
            pruneFinished();
            notify();
        },
        onMessage: (message, type) => {
            if (type === 'error') run.lastError = String(message);
        },
        onContextUpdate: () => {},
        updateRunnerUICallback: () => {},
    });

    runs.set(id, run);
    notify();

    Promise.resolve(run.runner.run(snapshot, continuous)).catch((err) => {
        logger.error(`[bgRuns] Background run ${id} crashed:`, err);
        run.status = 'failed';
        run.lastError = String(err?.message || err);
        run.endedAt = Date.now();
        notify();
    });

    logger.info(`[bgRuns] Started background run ${id} ("${run.name}") continuous=${continuous}`);
    return id;
}

/** Request a background run to stop (graceful; engine aborts in-flight fetch). */
export function stopBackgroundRun(id) {
    const run = runs.get(id);
    if (!run || run.status !== 'running') return false;
    run._stopRequested = true;
    try { run.runner.stop(); } catch (err) { logger.warn(`[bgRuns] stop(${id}) failed:`, err); }
    return true;
}

/** Remove a finished run from the list (stops it first if needed). */
export function removeBackgroundRun(id) {
    const run = runs.get(id);
    if (!run) return false;
    if (run.status === 'running') {
        try { run.runner.stop(); } catch (_) { /* best effort */ }
    }
    runs.delete(id);
    notify();
    return true;
}

/** Stop everything (app teardown / tests). */
export function stopAllBackgroundRuns() {
    runs.forEach((run) => {
        if (run.status === 'running') {
            try { run.runner.stop(); } catch (_) { /* best effort */ }
        }
    });
}

function pruneFinished() {
    const finished = [...runs.values()].filter((r) => r.status !== 'running')
        .sort((a, b) => b.endedAt - a.endedAt);
    finished.slice(MAX_FINISHED_KEPT).forEach((r) => runs.delete(r.id));
}
