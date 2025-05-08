// ========== FILE: runnerInterface.js ==========

import { appState, domRefs } from './state.js';
import { DEFAULT_REQUEST_DELAY } from './config.js';
import { showMessage, clearListViewHighlights, highlightStepInList, updateDefinedVariables } from './uiUtils.js';
import { findStepById, escapeHTML } from './flowCore.js'; // findStepById needed for result rendering
import { logger } from './logger.js';

// --- Runner Panel Logic & Callbacks ---

export function getRequestDelay() {
    if (!domRefs.requestDelayInput) return DEFAULT_REQUEST_DELAY;
    const delayValue = parseInt(domRefs.requestDelayInput.value, 10);
    return isNaN(delayValue) || delayValue < 0 ? 0 : delayValue;
}

export function updateRunnerUI() {
    const flowLoaded = !!appState.currentFlowModel;
    // Check the *app's* continuous flag for disabling/enabling UI elements
    const isContinuousSessionActive = appState.isContinuousRunActive;
    // Check the *runner's* internal state for whether it's currently executing steps
    const isRunnerActuallyExecutingSteps = appState.runner?.isRunning() || false;
    const isStepping = appState.runner?.isStepping() || false;

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
    const canStop = flowLoaded && (isContinuousSessionActive || isRunnerActuallyExecutingSteps || isStepping) && !appState.isLoading;
     if(domRefs.stopFlowBtn) {
        domRefs.stopFlowBtn.disabled = !canStop;
    }

    // Disable controls if any run (continuous or single) is active or stepping or loading
    const controlsDisabled = isContinuousSessionActive || isRunnerActuallyExecutingSteps || isStepping || appState.isLoading;
    if(domRefs.requestDelayInput) {
        domRefs.requestDelayInput.disabled = controlsDisabled;
    }
    if(domRefs.clearResultsBtn) {
        domRefs.clearResultsBtn.disabled = controlsDisabled;
    }
    if(domRefs.continuousRunCheckbox) {
        domRefs.continuousRunCheckbox.disabled = !flowLoaded || controlsDisabled;
        // Reflect the app's state, not the runner's internal flag (which might be briefly false between iterations)
        domRefs.continuousRunCheckbox.checked = appState.isContinuousRunActive;
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

export function handleClearResults() {
    // 1. Clear App State results array
    appState.executionResults = [];

    // 2. Clear Results List UI
    if(domRefs.runnerResultsList) {
        domRefs.runnerResultsList.innerHTML = '<li class="no-results">Run a flow to see results here.</li>';
    }
    // 3. Clear Status Message Area
    if(domRefs.runnerStatusMessages) {
        domRefs.runnerStatusMessages.innerHTML = '';
    }


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
    if (appState.runner && (appState.runner.isRunning() || appState.runner.isStepping() || appState.isContinuousRunActive)) {
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
    updateResultEntry(resultIndex, result.status, result.output, result.error, result.extractionFailures || []);
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
        updateResultEntry(resultIndex, 'error', null, errorMessage);
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
            errorMessage
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
    // Update the variables panel based on the latest runtime context
    updateDefinedVariables(newContext);
}


// --- Runner Result Rendering ---

export function addResultEntry(step, status = 'pending', executionPath = [], output = null, error = null, extractionFailures = []) {
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
    const resultData = {
        stepId: stepId,
        stepName: step.name || 'Unnamed Step',
        status: status,
        output: output,
        error: error,
        executionPath: executionPath || [],
        extractionFailures: extractionFailures || [],
    };
    appState.executionResults.push(resultData);

    renderResultItemContent(li, resultData);

    domRefs.runnerResultsList.appendChild(li);
    if (domRefs.runnerResultsContainer) {
        if (domRefs.runnerResultsContainer.scrollHeight - domRefs.runnerResultsContainer.scrollTop <= domRefs.runnerResultsContainer.clientHeight * 1.5) {
            domRefs.runnerResultsContainer.scrollTop = domRefs.runnerResultsContainer.scrollHeight;
        }
    }

    return resultIndex;
}

export function updateResultEntry(index, status, output, error, extractionFailures = []) {
    if (index < 0 || index >= appState.executionResults.length || !domRefs.runnerResultsList) return;

    const resultData = appState.executionResults[index];
    resultData.status = status;
    resultData.output = output;
    resultData.error = error;
    resultData.extractionFailures = extractionFailures || [];

    const li = domRefs.runnerResultsList.querySelector(`li.result-item[data-result-index="${index}"]`);
    if (!li) {
         logger.warn(`[DOM UPDATE] updateResultEntry: li element not found for index ${index}`);
         return;
    }

    logger.debug(`[DOM UPDATE] updateResultEntry: Updating li index=${index} (stepId=${resultData.stepId}) to status=${status}`);
    renderResultItemContent(li, resultData);

    if (domRefs.runnerResultsContainer) {
        if (domRefs.runnerResultsContainer.scrollHeight - domRefs.runnerResultsContainer.scrollTop <= domRefs.runnerResultsContainer.clientHeight * 1.5) {
            domRefs.runnerResultsContainer.scrollTop = domRefs.runnerResultsContainer.scrollHeight;
        }
    }
}

export function renderResultItemContent(listItem, resultData) {
    const { stepName, stepId, status, output, error, extractionFailures } = resultData;
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

    listItem.className = `result-item ${statusClass}`; // Set class based on status

    listItem.innerHTML = `
        <div class="result-header">
            <span class="result-step-name" title="ID: ${escapeHTML(stepId)}">${escapeHTML(stepName)} (${escapeHTML(stepType)})</span>
            <span class="result-status">${status.toUpperCase()}</span>
        </div>
        ${errorHtml}
        ${extractionFailuresHtml}
        ${outputHtml}
    `;
}