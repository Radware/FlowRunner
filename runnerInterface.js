// ========== FILE: runnerInterface.js ==========

import { appState, domRefs } from './state.js';
import { DEFAULT_REQUEST_DELAY } from './config.js';
import { showMessage, clearListViewHighlights, highlightStepInList, updateDefinedVariables } from './uiUtils.js';
import { findStepById, escapeHTML } from './flowCore.js'; // findStepById needed for result rendering
import { logger } from './logger.js';

function computeSearchText(stepName, output, error, extractedValues) {
    const parts = [stepName];
    if (output !== null && output !== undefined) {
        try {
            parts.push(typeof output === 'string' ? output : JSON.stringify(output));
        } catch (_) {}
    }
    if (error) {
        parts.push(typeof error === 'string' ? error : error.message || '');
    }
    if (extractedValues && Object.keys(extractedValues).length > 0) {
        for (const [name, val] of Object.entries(extractedValues)) {
            parts.push(name);
            try {
                parts.push(typeof val === 'string' ? val : JSON.stringify(val));
            } catch (_) {
                parts.push(String(val));
            }
        }
    }
    return parts.join(' ').toLowerCase();
}

function normalizeOutput(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

function toCsvValue(value) {
    const raw = normalizeOutput(value);
    if (raw === '') return '';
    const needsQuotes = /[",\n]/.test(raw);
    const escaped = raw.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
}

function buildResultsCsv(results) {
    const headers = ['stepName', 'stepId', 'status', 'error', 'output', 'extractedValues', 'extractionFailures'];
    const lines = [headers.join(',')];
    results.forEach(result => {
        const row = [
            toCsvValue(result.stepName),
            toCsvValue(result.stepId),
            toCsvValue(result.status),
            toCsvValue(result.error),
            toCsvValue(result.output),
            toCsvValue(result.extractedValues),
            toCsvValue(result.extractionFailures)
        ];
        lines.push(row.join(','));
    });
    return lines.join('\n');
}

async function exportResults(format) {
    if (!appState.executionResults || appState.executionResults.length === 0) {
        showMessage('No results to export yet.', 'warning', domRefs.runnerStatusMessages);
        return;
    }
    if (!window.electronAPI || typeof window.electronAPI.showSaveFile !== 'function' || typeof window.electronAPI.writeFile !== 'function') {
        showMessage('Export is unavailable in this environment.', 'error', domRefs.runnerStatusMessages);
        return;
    }

    const extension = format === 'csv' ? 'csv' : 'json';
    const suggestedName = `flow-results.${extension}`;
    const saveResult = await window.electronAPI.showSaveFile(suggestedName);
    if (!saveResult || !saveResult.success) {
        const errorMessage = saveResult?.error || 'Unable to open save dialog.';
        showMessage(errorMessage, 'error', domRefs.runnerStatusMessages);
        return;
    }
    if (saveResult.cancelled || !saveResult.filePath) return;

    const payload = {
        exportedAt: new Date().toISOString(),
        flowName: appState.currentFlowModel?.name || '',
        results: appState.executionResults.map(result => ({
            stepId: result.stepId,
            stepName: result.stepName,
            status: result.status,
            output: result.output,
            error: result.error,
            extractedValues: result.extractedValues,
            extractionFailures: result.extractionFailures,
            executionPath: result.executionPath
        }))
    };
    let content;
    if (format === 'csv') {
        content = buildResultsCsv(payload.results);
    } else {
        try {
            content = JSON.stringify(payload, null, 2);
        } catch (error) {
            showMessage(`Failed to serialize results: ${error.message}`, 'error', domRefs.runnerStatusMessages);
            return;
        }
    }

    const writeResult = await window.electronAPI.writeFile(saveResult.filePath, content);
    if (!writeResult || !writeResult.success) {
        const errorMessage = writeResult?.error || 'Failed to write export file.';
        showMessage(errorMessage, 'error', domRefs.runnerStatusMessages);
        return;
    }
    showMessage(`Results exported to ${writeResult.path}`, 'success', domRefs.runnerStatusMessages);
}

export async function handleExportResultsJson() {
    await exportResults('json');
}

export async function handleExportResultsCsv() {
    await exportResults('csv');
}

// --- Runner Panel Logic & Callbacks ---

export function getRequestDelay() {
    if (!domRefs.requestDelayInput) return DEFAULT_REQUEST_DELAY;
    const delayValue = parseInt(domRefs.requestDelayInput.value, 10);
    return isNaN(delayValue) || delayValue < 0 ? 0 : delayValue;
}

export function getEncodeUrlVars() {
    return !!domRefs.encodeUrlVarsCheckbox?.checked;
}

export function updateRunnerUI() {
    const flowLoaded = !!appState.currentFlowModel;
    // Check the *app's* continuous flag for disabling/enabling UI elements
    const isContinuousSessionActive = appState.isContinuousRunActive;
    // Check the *runner's* internal state for whether it's currently executing steps
    const isRunnerActuallyExecutingSteps = appState.runner?.isRunning() || false;
    const isStepping = appState.runner?.isStepping() || false;
    const hasPendingSteps = appState.runner?.hasPendingSteps?.() || false;

    // Disable Run/Step if a continuous session is marked as active in the app state,
    // OR if the runner is internally busy (isRunning or isStepping),
    // OR if no flow is loaded, OR if the app is globally loading.
    const canStartNewRun = flowLoaded && !isContinuousSessionActive && !isRunnerActuallyExecutingSteps && !isStepping && !appState.isLoading;
    if (domRefs.runFlowBtn) {
        domRefs.runFlowBtn.disabled = !canStartNewRun;
    }
    if (domRefs.stepFlowBtn) {
        domRefs.stepFlowBtn.disabled = !canStartNewRun;
    }

    // Enable Stop if a continuous session is active OR the runner is internally busy.
    const canStop = flowLoaded && (isContinuousSessionActive || isRunnerActuallyExecutingSteps || isStepping || hasPendingSteps) && !appState.isLoading;
     if(domRefs.stopFlowBtn) {
        domRefs.stopFlowBtn.disabled = !canStop;
    }

    // Disable controls if any run (continuous or single) is active or stepping or loading
    const controlsDisabled = isContinuousSessionActive || isRunnerActuallyExecutingSteps || isStepping || appState.isLoading;
    if(domRefs.requestDelayInput) {
        domRefs.requestDelayInput.disabled = controlsDisabled;
    }
    if(domRefs.encodeUrlVarsCheckbox) {
        domRefs.encodeUrlVarsCheckbox.disabled = controlsDisabled;
    }
    if(domRefs.clearResultsBtn) {
        domRefs.clearResultsBtn.disabled = controlsDisabled;
    }
    if(domRefs.continuousRunCheckbox) {
        domRefs.continuousRunCheckbox.disabled = !flowLoaded || controlsDisabled;
        // Reflect the app's state, not the runner's internal flag (which might be briefly false between iterations)
        domRefs.continuousRunCheckbox.checked = appState.isContinuousRunActive;
    }
    const hasResults = appState.executionResults.length > 0;
    const exportDisabled = controlsDisabled || !hasResults;
    if (domRefs.exportResultsJsonBtn) {
        domRefs.exportResultsJsonBtn.disabled = exportDisabled;
    }
    if (domRefs.exportResultsCsvBtn) {
        domRefs.exportResultsCsvBtn.disabled = exportDisabled;
    }
    // Hide Step Into button (not implemented)
    if(domRefs.stepIntoFlowBtn) {
        domRefs.stepIntoFlowBtn.style.display = 'none';
    }
}

export function handleDelayChange() {
    if (appState.runner) {
        appState.runner.setDelay(getRequestDelay());
    }
}

export function handleEncodeUrlVarsChange() {
    if (appState.runner) {
        appState.runner.setEncodeUrlVars(getEncodeUrlVars());
    }
}

export function handleClearResults() {
    // 1. Clear App State results array
    appState.executionResults = [];
    appState.lastRuntimeContext = null;

    // 2. Clear Results List UI
    if(domRefs.runnerResultsList) {
        domRefs.runnerResultsList.innerHTML = '<li class="no-results">Run a flow to see results here.</li>';
    }
    // 3. Clear Status Message Area
    if(domRefs.runnerStatusMessages) {
        domRefs.runnerStatusMessages.innerHTML = '';
    }
    // === WAVE3 assertions === hide/clear the test-summary panel on reset
    const testSummaryPanel = document.getElementById('runner-test-summary');
    if (testSummaryPanel) {
        testSummaryPanel.style.display = 'none';
        testSummaryPanel.innerHTML = '';
    }
    // === END WAVE3 assertions ===


    // 4. Reset Runner's internal state
    if (appState.runner) {
        // Reset runner state, passing current static vars as initial context
        // false indicates it's not specifically prepping for a continuous run, so flags are fully reset
        appState.runner.reset(appState.currentFlowModel?.staticVars || {}, false);
    }

    // 5. Clear UI Highlights
     if (appState.visualizerComponent) {
        try { appState.visualizerComponent.clearHighlights(); }
        catch(e) { logger.error("Error clearing visualizer highlights:", e); }
     }
     try { clearListViewHighlights(); }
     catch(e) { logger.error("Error clearing list view highlights:", e); }

     // 6. Update UI button states
    updateRunnerUI();
}

// --- [MODIFIED] ---
export async function handleRunFlow() {
    if (!appState.currentFlowModel || !appState.runner || appState.runner.isRunning() || appState.runner.isStepping() || appState.isContinuousRunActive) {
        if (appState.isContinuousRunActive) {
            showMessage("A continuous run is already active. Stop it before starting a new run.", "warning", domRefs.runnerStatusMessages); // Use correct container
        } else if (appState.runner?.isRunning() || appState.runner?.isStepping()) {
             showMessage("A run or step execution is already in progress.", "warning", domRefs.runnerStatusMessages); // Use correct container
        }
        return;
    }

    const isContinuousChecked = domRefs.continuousRunCheckbox.checked;

    // Clear results *before* the first run starts
    // Note: The runner will handle clearing for subsequent continuous iterations via onIterationStart callback
    handleClearResults();
    // <<< --- CHANGE HERE --- >>>
    showMessage(`Flow execution started${isContinuousChecked ? ' (Continuous)' : ''}...`, "info", domRefs.runnerStatusMessages); // Use correct container
    // <<< --- END CHANGE --- >>>

    appState.isContinuousRunActive = isContinuousChecked; // Set the app's state flag immediately
    updateRunnerUI(); // Update UI to reflect running state

    try {
        // Pass the continuous flag to the runner's run method.
        // The runner itself will now handle the looping logic internally.
        await appState.runner.run(appState.currentFlowModel, isContinuousChecked);

    } catch (error) {
        logger.error("Error starting flow execution:", error);
        // <<< --- CHANGE HERE --- >>>
        showMessage(`Error starting run: ${error.message}`, "error", domRefs.runnerStatusMessages); // Use correct container
        // <<< --- END CHANGE --- >>>

        // Ensure state is cleaned up on error
        appState.isContinuousRunActive = false;
        // Ensure runner's internal state is also reset on error
        if (appState.runner) appState.runner.stop(); // stop() also handles internal reset
        updateRunnerUI();
    }
}


export async function handleStepFlow() {
     if (!appState.currentFlowModel || !appState.runner || appState.runner.isRunning() || appState.runner.isStepping()) return;

     if (appState.runner.isStartOfFlow()) { // <-- Correctly handles clearing only on the FIRST step
         handleClearResults(); // Clear results and highlights only on the very first step
         // <<< --- CHANGE HERE --- >>>
         showMessage("Starting step-by-step execution...", "info", domRefs.runnerStatusMessages); // Use correct container
         // <<< --- END CHANGE --- >>>
     } else {
         // If not the first step, just clear previous "running" highlights before the next step
         if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights('active-step'); // Clear only active step highlight
         clearListViewHighlights(); // Clear all previous list highlights? Or maybe just running? Let's clear all for simplicity for now.
     }

     updateRunnerUI(); // Disable buttons during step
     // Message handled by onStepStart callback

     try {
         await appState.runner.step(appState.currentFlowModel);
         // Completion/message handled by callbacks
     } catch (error) {
         logger.error("Error during step execution:", error);
         // <<< --- CHANGE HERE --- >>>
         showMessage(`Error during step: ${error.message}`, "error", domRefs.runnerStatusMessages); // Use correct container
         // <<< --- END CHANGE --- >>>

         // Ensure runner state allows retry/stop
         appState.runner.stop(); // Force stop/reset on error? Or allow continuing? Stopping is safer.
         updateRunnerUI();
     }
}

// TODO: Implement Step Into
// async function handleStepIntoFlow() {
//     // ... similar logic to handleStepFlow but calls runner.stepInto() ...
// }

export function handleStopFlow() {
    const hasPendingSteps = appState.runner?.hasPendingSteps?.() || false;
    if (appState.runner && (appState.runner.isRunning() || appState.runner.isStepping() || appState.isContinuousRunActive || hasPendingSteps)) {
        // Update app state FIRST to prevent race conditions with UI updates/callbacks
        appState.isContinuousRunActive = false; // Clear the app's continuous flag immediately
        appState.runner.stop(); // This triggers internal state changes and eventually onFlowStopped
        // <<< --- CHANGE HERE --- >>>
        showMessage("Stop requested...", "warning", domRefs.runnerStatusMessages); // Use correct container
        // <<< --- END CHANGE --- >>>
        // updateRunnerUI will be called by onFlowStopped when the runner confirms it has stopped
    }
}

// --- FlowRunner Callbacks ---

export function handleRunnerStepStart(step, executionPath) {
    logger.debug(`[RUNNER CALLBACK] handleRunnerStepStart: stepId=${step.id}, name=${step.name}`);
    const resultIndex = addResultEntry(step, 'running', executionPath); // Add placeholder
    // Highlight step in the active view
    if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
        appState.visualizerComponent.highlightNode(step.id, 'active-step'); // Use 'active-step' for running in visualizer
    } else if (appState.currentView === 'list-editor') {
         highlightStepInList(step.id, 'step-running'); // Use specific class for list view
    }
    return resultIndex;
}

export function handleRunnerStepComplete(resultIndex, step, result, context, executionPath) {
    logger.debug(`[RUNNER CALLBACK] handleRunnerStepComplete: stepId=${step.id}, status=${result.status}, error=${result.error}, failures=${result.extractionFailures?.length}`);
    // Update the result entry with final status and details
    // === WAVE3 assertions === thread the per-step assertion test-summary through.
    updateResultEntry(resultIndex, result.status, result.output, result.error, result.extractionFailures || [], result.extractedValues || {}, result.assertionSummary || null);
    // Update the defined variables list based on the latest context
    updateDefinedVariables(context);

    // Update highlighting based on final status
    const highlightClass = result.status === 'success' ? 'success'
                         : result.status === 'error' ? 'error'
                         : result.status === 'skipped' ? 'skipped'
                         : 'stopped'; // Default or stopped

     if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
         appState.visualizerComponent.highlightNode(step.id, highlightClass);
         // Update visualizer node with runtime info (like status code, extraction status)
         if (step.type === 'request') {
             try {
                  appState.visualizerComponent.updateNodeRuntimeInfo(step.id, result);
             } catch (visError) {
                  logger.error(`Error calling visualizer.updateNodeRuntimeInfo for step ${step.id}:`, visError);
             }
         }
     } else if (appState.currentView === 'list-editor') {
         highlightStepInList(step.id, `step-${highlightClass}`); // Prefix class for list view
     }
     updateRunnerUI(); // Re-enable buttons if stepping completed
}

export function handleRunnerFlowComplete(finalContext, results) {
    // This callback is now only triggered for single runs or the VERY end of a continuous run (if it finishes naturally, which it shouldn't unless the model becomes empty/invalid).
    // It's NOT triggered between continuous iterations anymore.
    logger.debug("[RUNNER CALLBACK] handleRunnerFlowComplete triggered.");
    appState.isContinuousRunActive = false; // Ensure flag is cleared
    // <<< --- CHANGE HERE --- >>>
    showMessage("Flow execution finished.", "success", domRefs.runnerStatusMessages); // Use correct container
    // <<< --- END CHANGE --- >>>
    renderTestSummaryPanel(); // === WAVE3 assertions === show aggregate PASS/FAIL after a run
    updateRunnerUI();
    // Leave final step highlights visible
}

 export function handleRunnerFlowStopped(finalContext, results) {
    logger.debug("[RUNNER CALLBACK] handleRunnerFlowStopped triggered.");
    // This is called when stop() is invoked either by the user or internally (e.g., onFailure=stop)
    appState.isContinuousRunActive = false; // Ensure flag is cleared
    // <<< --- CHANGE HERE --- >>>
    showMessage("Flow execution stopped.", "warning", domRefs.runnerStatusMessages); // Changed message slightly, use correct container
    // <<< --- END CHANGE --- >>>

    let stoppedStepId = null;
    // Find the last step that was 'running' and mark it as 'stopped'
    for (let i = appState.executionResults.length - 1; i >= 0; i--) {
         const res = appState.executionResults[i];
         if (res.status === 'running') {
            updateResultEntry(i, 'stopped', null, 'Execution stopped'); // Update status and error message
            stoppedStepId = res.stepId;
            break;
         }
    }

    renderTestSummaryPanel(); // === WAVE3 assertions === reflect assertions evaluated before the stop

    // Update UI highlight for the stopped step, or clear if stop happened between steps
    if (stoppedStepId) {
        if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
            appState.visualizerComponent.highlightNode(stoppedStepId, 'stopped');
        } else if (appState.currentView === 'list-editor') {
             highlightStepInList(stoppedStepId, 'step-stopped');
        }
    } else {
         // Clear only active highlights if stop was between steps
         if (appState.visualizerComponent) appState.visualizerComponent.clearHighlights(); // Clear all for safety
         clearListViewHighlights();
    }

    updateRunnerUI(); // Ensure UI reflects the stopped state
}

 // --- [MODIFIED] Added clearing of continuous flag on error ---
 export function handleRunnerError(resultIndex, step, error, context, executionPath) {
    logger.error(`[RUNNER CALLBACK] handleRunnerError: stepId=${step?.id}, error=${error?.message}`, error);
    const errorMessage = error?.message || (typeof error === 'string' ? error : 'Unknown execution error');

    // Clear the continuous run flag in the app state if an error occurs during a continuous run
    if (appState.isContinuousRunActive) {
        appState.isContinuousRunActive = false;
        logger.info("[App Handler] Continuous run flag cleared due to error.");
    }

    if (resultIndex !== null && resultIndex >= 0 && resultIndex < appState.executionResults.length) {
        // Update existing entry if index provided
        updateResultEntry(resultIndex, 'error', null, errorMessage, [] , {});
        if (step) {
             if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
                 appState.visualizerComponent.highlightNode(step.id, 'error');
             } else if (appState.currentView === 'list-editor') {
                 highlightStepInList(step.id, 'step-error');
             }
        }
    } else {
        // Add a general error message if no specific step index provided
        addResultEntry(
            { name: 'Execution Error', type: 'System', id: `error-${Date.now()}` },
            'error',
            executionPath || [],
            null,
            errorMessage,
            [],
            {}
        );
         // Also highlight the step if provided
        if (step) {
             if (appState.currentView === 'node-graph' && appState.visualizerComponent) {
                 appState.visualizerComponent.highlightNode(step.id, 'error');
             } else if (appState.currentView === 'list-editor') {
                 highlightStepInList(step.id, 'step-error');
             }
        }
    }
    // <<< --- CHANGE HERE --- >>>
    showMessage(`Execution failed${step ? ` at step "${step.name}"` : ''}: ${errorMessage}`, "error", domRefs.runnerStatusMessages); // Use correct container
    // <<< --- END CHANGE --- >>>
    updateRunnerUI(); // Ensure UI reflects stopped state after error
}

export function handleRunnerContextUpdate(newContext) {
    appState.lastRuntimeContext = newContext || null;
    // Update the variables panel based on the latest runtime context
    updateDefinedVariables(newContext);
}


// === WAVE3 assertions ===
/**
 * Render the aggregate PASS/FAIL test-summary panel from the current run's
 * results. Aggregates every step's `assertionSummary`. Hidden entirely when the
 * run defined no assertions, so flows without assertions look unchanged.
 * Purely presentational — reads appState.executionResults, never mutates it.
 */
export function renderTestSummaryPanel() {
    const panel = document.getElementById('runner-test-summary');
    if (!panel) return;

    const results = Array.isArray(appState.executionResults) ? appState.executionResults : [];
    let total = 0;
    let passed = 0;
    let failed = 0;
    let criticalFailed = false;
    let stepsWithAssertions = 0;

    for (const r of results) {
        const s = r && r.assertionSummary;
        if (!s || !s.total) continue;
        stepsWithAssertions++;
        total += s.total;
        passed += s.passed;
        failed += s.failed;
        if (s.criticalFailed) criticalFailed = true;
    }

    if (total === 0) {
        // No assertions this run — keep the panel out of the way.
        panel.style.display = 'none';
        panel.innerHTML = '';
        return;
    }

    const allPassed = failed === 0;
    const stateClass = allPassed ? 'summary-pass' : (criticalFailed ? 'summary-critical' : 'summary-fail');
    const verdict = allPassed ? 'PASS' : 'FAIL';
    panel.className = `runner-test-summary ${stateClass}`;
    panel.style.display = '';
    panel.innerHTML = `
        <div class="test-summary-verdict">${escapeHTML(verdict)}</div>
        <div class="test-summary-counts">
            <span class="test-summary-count pass"><strong>${passed}</strong> passed</span>
            <span class="test-summary-count fail"><strong>${failed}</strong> failed</span>
            <span class="test-summary-count total">${total} assertion${total === 1 ? '' : 's'} across ${stepsWithAssertions} step${stepsWithAssertions === 1 ? '' : 's'}</span>
            ${criticalFailed ? '<span class="test-summary-count critical">critical failure</span>' : ''}
        </div>
    `;
}
// === END WAVE3 assertions ===

// --- Runner Result Rendering ---

export function addResultEntry(step, status = 'pending', executionPath = [], output = null, error = null, extractionFailures = [], extractedValues = {}) {
    if (!domRefs.runnerResultsList) return -1;

    const noResultsLi = domRefs.runnerResultsList.querySelector('.no-results');
    if (noResultsLi) noResultsLi.remove();

    const li = document.createElement('li');
    li.className = 'result-item';
    const stepId = step.id || `exec-${Date.now()}`;
    const resultIndex = appState.executionResults.length;
    li.dataset.stepId = stepId;
    li.dataset.resultIndex = resultIndex;

    logger.debug(`[DOM UPDATE] addResultEntry: Adding li for stepId=${stepId}, status=${status}, index=${resultIndex}`);
    const searchText = computeSearchText(step.name || 'Unnamed Step', output, error, extractedValues);
    const resultData = {
        stepId: stepId,
        stepName: step.name || 'Unnamed Step',
        status: status,
        output: output,
        error: error,
        executionPath: executionPath || [],
        extractionFailures: extractionFailures || [],
        extractedValues: extractedValues || {},
        assertionSummary: null, // === WAVE3 assertions === populated on step complete
        searchText: searchText,
    };
    appState.executionResults.push(resultData);

    li.dataset.status = status;
    li.dataset.searchText = searchText;

    renderResultItemContent(li, resultData);

    domRefs.runnerResultsList.appendChild(li);
    if (domRefs.runnerResultsContainer) {
        if (domRefs.runnerResultsContainer.scrollHeight - domRefs.runnerResultsContainer.scrollTop <= domRefs.runnerResultsContainer.clientHeight * 1.5) {
            domRefs.runnerResultsContainer.scrollTop = domRefs.runnerResultsContainer.scrollHeight;
        }
    }

    return resultIndex;
}

export function updateResultEntry(index, status, output, error, extractionFailures = [], extractedValues = {}, assertionSummary = null) {
    if (index < 0 || index >= appState.executionResults.length || !domRefs.runnerResultsList) return;

    const resultData = appState.executionResults[index];
    resultData.status = status;
    resultData.output = output;
    resultData.error = error;
    resultData.extractionFailures = extractionFailures || [];
    resultData.extractedValues = extractedValues || {};
    // === WAVE3 assertions === keep the per-step test-summary on the result row.
    resultData.assertionSummary = assertionSummary || null;
    resultData.searchText = computeSearchText(resultData.stepName, output, error, extractedValues);

    const li = domRefs.runnerResultsList.querySelector(`li.result-item[data-result-index="${index}"]`);
    if (!li) {
         logger.warn(`[DOM UPDATE] updateResultEntry: li element not found for index ${index}`);
         return;
    }

    li.dataset.status = status;
    li.dataset.searchText = resultData.searchText;

    logger.debug(`[DOM UPDATE] updateResultEntry: Updating li index=${index} (stepId=${resultData.stepId}) to status=${status}`);
    renderResultItemContent(li, resultData);

    if (domRefs.runnerResultsContainer) {
        if (domRefs.runnerResultsContainer.scrollHeight - domRefs.runnerResultsContainer.scrollTop <= domRefs.runnerResultsContainer.clientHeight * 1.5) {
            domRefs.runnerResultsContainer.scrollTop = domRefs.runnerResultsContainer.scrollHeight;
        }
    }
}

export function renderResultItemContent(listItem, resultData) {
    const { stepName, stepId, status, output, error, extractionFailures, extractedValues, assertionSummary } = resultData;
    const stepType = findStepById(appState.currentFlowModel?.steps, stepId)?.type || 'System'; // Default to System if step not found

    const statusClass = status === 'success' ? 'success'
                      : status === 'error' ? 'error'
                      : status === 'running' ? 'running'
                      : status === 'stopped' ? 'warning' // Use warning style for stopped
                      : 'skipped'; // Default/skipped

    let outputHtml = '';
    if (output !== null && output !== undefined) {
        try {
            const outputString = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
            outputHtml = `<div class="result-body"><pre>${escapeHTML(outputString)}</pre></div>`;
        } catch (e) {
            outputHtml = `<div class="result-body"><pre>[Error formatting output: ${escapeHTML(e.message)}]</pre></div>`;
        }
    }

    let errorHtml = '';
    if (error) {
        const errorMessage = escapeHTML(typeof error === 'string' ? error : error.message || 'Unknown Error');
        errorHtml = `<div class="result-error"><strong>Error:</strong> ${errorMessage}</div>`;
    }

    let extractionFailuresHtml = '';
    if (extractionFailures && extractionFailures.length > 0) {
        const failureItems = extractionFailures.map(fail =>
            `<li><code>${escapeHTML(fail.varName)}</code> from path <code>${escapeHTML(fail.path || 'N/A')}</code> (${escapeHTML(fail.reason || 'Not found')})</li>`
        ).join('');
        extractionFailuresHtml = `
            <div class="result-extraction-failures warning">
                <strong>Extraction Warnings:</strong>
                <ul>${failureItems}</ul>
            </div>
        `;
    }

    let extractedValuesHtml = '';
    if (extractedValues && Object.keys(extractedValues).length > 0) {
        const valueItems = Object.entries(extractedValues).map(([name, val]) => {
            let valString;
            try {
                valString = typeof val === 'string' ? val : JSON.stringify(val);
            } catch (e) {
                valString = String(val);
            }
            const escapedVal = escapeHTML(valString);
            return `<li><div><code>${escapeHTML(name)}</code>: <span class="extracted-value">${escapedVal}</span></div><button class="copy-btn btn btn-sm" data-copy-value="${escapedVal}" title="Copy value" aria-label="Copy value">Copy</button></li>`;

        }).join('');
        extractedValuesHtml = `
            <div class="result-extracted-values">
                <strong>Extracted Values:</strong>
                <ul>${valueItems}</ul>
            </div>
        `;
    }

    // === WAVE3 assertions === per-step assertion results (PASS/FAIL rows + a header badge).
    let assertionsHtml = '';
    let headerBadgeHtml = '';
    if (assertionSummary && assertionSummary.total > 0) {
        const s = assertionSummary;
        const badgeClass = s.allPassed ? 'assert-pass' : (s.criticalFailed ? 'assert-critical' : 'assert-fail');
        const badgeText = s.allPassed ? `✓ ${s.passed}/${s.total}` : `✗ ${s.passed}/${s.total}`;
        headerBadgeHtml = `<span class="result-assert-badge ${badgeClass}" title="${s.passed} of ${s.total} assertions passed">${escapeHTML(badgeText)}</span>`;
        const rows = (s.results || []).map(r => {
            const rowClass = r.passed ? 'assert-pass' : 'assert-fail';
            const mark = r.passed ? '✓' : '✗';
            let actualStr;
            try { actualStr = typeof r.actual === 'object' ? JSON.stringify(r.actual) : String(r.actual); }
            catch (_) { actualStr = String(r.actual); }
            const critTag = r.critical ? '<span class="assert-crit-tag" title="Critical: a failure stops the flow">critical</span>' : '';
            const actualHtml = r.passed ? '' : `<span class="assert-actual" title="Actual value">got ${escapeHTML(actualStr)}</span>`;
            return `<li class="assert-row ${rowClass}"><span class="assert-mark">${mark}</span><code class="assert-label">${escapeHTML(r.label)}</code>${critTag}${actualHtml}</li>`;
        }).join('');
        assertionsHtml = `
            <div class="result-assertions ${s.allPassed ? 'all-pass' : 'has-fail'}">
                <strong>Assertions: ${s.passed}/${s.total} passed${s.allPassed ? '' : (s.criticalFailed ? ' (critical failed)' : '')}</strong>
                <ul>${rows}</ul>
            </div>
        `;
    }
    // === END WAVE3 assertions ===

    listItem.className = `result-item ${statusClass}`; // Set class based on status

    listItem.innerHTML = `
        <div class="result-header">
            <span class="result-step-name" title="ID: ${escapeHTML(stepId)}">${escapeHTML(stepName)} (${escapeHTML(stepType)})</span>
            <span class="result-header-right">${headerBadgeHtml}<span class="result-status">${status.toUpperCase()}</span></span>
        </div>
        ${errorHtml}
        ${assertionsHtml}
        ${extractionFailuresHtml}
        ${extractedValuesHtml}
        ${outputHtml}
    `;

    if (outputHtml) {
        const resultBody = listItem.querySelector('.result-body');
        if (resultBody) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn btn btn-sm';
            copyBtn.textContent = 'Copy';
            copyBtn.title = 'Copy raw output';
            copyBtn.setAttribute('aria-label', 'Copy raw output');
            copyBtn.addEventListener('click', () => {
                try {
                    const raw = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
                    navigator.clipboard.writeText(raw);
                } catch (err) {
                    logger.error('Failed to copy output:', err);
                }
            });
            resultBody.appendChild(copyBtn);
        }
    }

    const valueCopyBtns = listItem.querySelectorAll('.result-extracted-values .copy-btn');
    valueCopyBtns.forEach(btn => {
        const val = btn.getAttribute('data-copy-value') || '';
        btn.addEventListener('click', () => {
            try {
                navigator.clipboard.writeText(val);
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1000);
            } catch (err) {
                logger.error('Failed to copy extracted value:', err);
            }
        });
    });
}
