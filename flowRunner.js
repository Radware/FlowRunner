// flowRunner.js
/**
 * flowRunner.js
 * Handles the execution logic for API flows, including stepping, context management, and delays.
 */

// Assuming these are passed in or globally available (better to pass in constructor)
// import { evaluatePath } from './flowCore.js'; // Needs to be defined/imported

import { logger } from './logger.js';

// Helper function for escaping regex characters
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class FlowRunner {
    constructor(options = {}) {
        this.delay = options.delay ?? 500; // Delay between steps in ms
        this.onStepStart = options.onStepStart || (() => {}); // (step, executionPath) => resultIndex
        this.onStepComplete = options.onStepComplete || (() => {}); // (resultIndex, step, result, context, executionPath) => {}
        this.onFlowComplete = options.onFlowComplete || (() => {}); // (finalContext, results) => {}
        this.onFlowStopped = options.onFlowStopped || (() => {}); // (finalContext, results) => {}
        this.onMessage = options.onMessage || (() => {}); // (message, type) => {}
        this.onError = options.onError || (() => {}); // (resultIndex, step, error, context, executionPath) => {}
        this.onContextUpdate = options.onContextUpdate || (() => {}); // (context) => {}
        this.onIterationStart = options.onIterationStart || (() => {}); // NEW: Called at the start of each continuous run iteration
        this.updateRunnerUICallback = options.updateRunnerUICallback || (() => {}); // Callback to request UI update
        this.encodeUrlVars = options.encodeUrlVars ?? false; // Whether to URL-encode substituted variables in URLs

        // Core logic functions provided by the main app
        this.substituteVariablesFn = options.substituteVariablesFn || ((step, context) => ({ processedStep: step, unquotedPlaceholders: {} })); // Default pass-through, MUST now return { processedStep, unquotedPlaceholders }
        this.evaluateConditionFn = options.evaluateConditionFn || (() => false); // Default false
        this.evaluatePathFn = options.evaluatePathFn; // Use imported or passed function (required for extraction)

        // --- NEW for Continuous Run ---
        this.isContinuousModeActive = false;
        this.continuousRunTimeoutId = null;
        this.currentFlowModelForContinuousRun = null;
        this.flowModelForNextContinuousRun = null; // NEW: Store next iteration's flow model
        // --- END NEW ---

        // Global headers to be applied to all request steps
        this.globalHeaders = {};

        this.reset();
    }

    // [Modified Code] - Add currentFetchController to state and handle continuous run
    reset(initialContext = {}, isPreparingForContinuousRun = false) {
        // Check and abort any lingering fetch request
        if (this.state?.currentFetchController) {
            logger.info("[FlowRunner] Aborting lingering fetch request during reset");
            try {
                this.state.currentFetchController.abort();
            } catch (e) {
                logger.error("[FlowRunner] Error aborting fetch controller during reset:", e);
            }
        }

        // Clear global headers on reset
        this.globalHeaders = {};

        this.state = {
            isRunning: false,
            isStepping: false,
            stopRequested: false,
            executionPath: [],
            context: { ...initialContext },
            results: [],
            currentResultIndex: null,
            currentFetchController: null
        };

        // Only clear continuous run state if not preparing for next iteration
        if (!isPreparingForContinuousRun) {
            logger.debug("[FlowRunner] Full reset: Clearing continuous run state");
            this.isContinuousModeActive = false;
            if (this.continuousRunTimeoutId) {
                clearTimeout(this.continuousRunTimeoutId);
                this.continuousRunTimeoutId = null;
            }
            this.currentFlowModelForContinuousRun = null;
        } else {
            logger.debug("[FlowRunner] Partial reset: Preparing for next continuous iteration");
        }
    }

    isRunning() {
        return this.state.isRunning;
    }

    isStepping() {
        return this.state.isStepping;
    }

    isStartOfFlow() {
        return this.state.executionPath.length === 0 || (this.state.executionPath.length === 1 && this.state.executionPath[0].index === 0);
    }

    canStepInto() {
        // TODO: Implement logic to check if the *next* step is a condition/loop
        return false; // Placeholder
    }

    setDelay(delayMs) {
        this.delay = Math.max(0, delayMs);
    }

    setEncodeUrlVars(flag) {
        this.encodeUrlVars = !!flag;
    }

    // [Modified Code] - Abort fetch controller on stop
    stop() {
        if (this.state.isRunning || this.state.isStepping || this.isContinuousModeActive) {
            logger.info("[FlowRunner] Stop requested.");
            this.state.stopRequested = true;

            // Clean up continuous run state
            this.isContinuousModeActive = false;
            if (this.continuousRunTimeoutId) {
                logger.info("[FlowRunner] Clearing continuous run timeout");
                clearTimeout(this.continuousRunTimeoutId);
                this.continuousRunTimeoutId = null;
            }
            this.currentFlowModelForContinuousRun = null;

            // Abort any ongoing fetch request
            if (this.state.currentFetchController) {
                logger.info("[FlowRunner] Aborting active fetch request due to stop()");
                try {
                    this.state.currentFetchController.abort();
                } catch (e) {
                    logger.error("[FlowRunner] Error aborting fetch controller:", e);
                }
            }
        }
    }

    /**
     * Executes the entire flow from the beginning.
     * @param {Object} flowModel - The flow model object.
     * @param {boolean} isContinuousInvocation - Whether this is a subsequent iteration of a continuous run.
     */
    async run(flowModel, isContinuousInvocation = false) {
        if (this.state.isRunning || this.state.isStepping) {
            if (this.isContinuousModeActive && isContinuousInvocation) {
                logger.warn("[FlowRunner] Continuous run attempted to start while already running. Aborting this invocation.");
                return;
            }
            throw new Error("Execution already in progress.");
        }

        if (!flowModel || !flowModel.steps) {
            throw new Error("Invalid flow model provided.");
        }

        this.globalHeaders = flowModel.headers || {};

        // If this is the first continuous invocation, store the model and activate continuous mode
        if (!this.currentFlowModelForContinuousRun && isContinuousInvocation) {
            logger.debug("[FlowRunner] Starting new continuous run series");
            this.currentFlowModelForContinuousRun = flowModel;
            this.isContinuousModeActive = true;
        }

        // If this is a subsequent continuous iteration
        if (this.isContinuousModeActive && isContinuousInvocation) {
            logger.debug("[FlowRunner] Processing subsequent continuous iteration");
            await this.onIterationStart();
        }

        // Initialize state for this run
        this.state.isRunning = true;
        this.state.stopRequested = false;

        // Initialize context, carefully handling continuous mode
        if (!isContinuousInvocation || this.state.executionPath.length === 0) {
            const staticVars = flowModel.staticVars || {};
            this.state.context = { ...staticVars };
        }
        this.onContextUpdate(this.state.context);

        // Initialize execution path stack
        this.state.executionPath = [{ 
            steps: flowModel.steps, 
            index: 0, 
            context: this.state.context, 
            type: 'main' 
        }];

        // Execute the flow
        await this._executeCurrentLevel();

        // Handle continuous mode scheduling or completion
        if (this.isContinuousModeActive && !this.state.stopRequested && this.currentFlowModelForContinuousRun) {
            logger.info("[FlowRunner] Scheduling next continuous iteration");
            this.onMessage("Continuous run: Iteration complete. Scheduling next run...", "info");
            this.state.isRunning = false;
            this.updateRunnerUICallback?.();

            // Schedule next iteration
            this.continuousRunTimeoutId = setTimeout(async () => {
                if (this.isContinuousModeActive && !this.state.stopRequested && this.currentFlowModelForContinuousRun) {
                    logger.info("[FlowRunner] Starting next continuous iteration");
                    this.reset(this.currentFlowModelForContinuousRun.staticVars || {}, true);
                    await this.run(this.currentFlowModelForContinuousRun, true);
                } else {
                    logger.info("[FlowRunner] Continuous mode was cancelled during delay");
                    this.isContinuousModeActive = false;
                    this.currentFlowModelForContinuousRun = null;
                    this.state.isRunning = false;
                    this.updateRunnerUICallback?.();
                    this.onFlowStopped(this.state.context, this.state.results);
                }
            }, this.delay);
        } else {
            // Handle normal completion or stop
            const wasContinuousAndStopped = this.isContinuousModeActive && this.state.stopRequested;
            this.isContinuousModeActive = false;
            this.currentFlowModelForContinuousRun = null;
            this.state.isRunning = false;
            this.state.isStepping = false;

            if (this.state.stopRequested || wasContinuousAndStopped) {
                this.onFlowStopped(this.state.context, this.state.results);
            } else {
                this.onFlowComplete(this.state.context, this.state.results);
            }
        }
    }

    // [Modified Code] - Fix isStepping flag management in step() method
    /**
     * Executes the next single logical step in the flow.
     * @param {Object} flowModel - The flow model object.
     */
    async step(flowModel) {
        if (this.state.isRunning || this.state.isStepping || this.isContinuousModeActive) {
            this.onMessage("Cannot step: An execution or continuous run is active.", "warning");
            return;
        }
        if (!flowModel || !flowModel.steps) {
            throw new Error("Invalid flow model provided.");
        }

        this.state.stopRequested = false;

        // (re)initialise execution stack on first ever step
        if (this.state.executionPath.length === 0) {
            this.reset(flowModel.staticVars || {});
            this.onContextUpdate(this.state.context);
            this._pushExecutionLevel(flowModel.steps, this.state.context, 'root');
            // reset() cleared the flag – set it after reset/initial-push
            this.state.isStepping = true;
            this.updateRunnerUICallback?.();
        }

        try {
            await this._executeNextStep();
            if (this.state.executionPath.length === 0 && !this.state.stopRequested) {
                this.onFlowComplete(this.state.context, this.state.results);
            }
        } catch (error) {
            logger.error("[FlowRunner step] Error during step execution:", error);
        } finally {
            this.state.isStepping = false;
            this.updateRunnerUICallback?.();
        }
    }

    // --- Internal Execution Logic ---

    /** Executes steps at the current level in the execution path stack */
    async _executeCurrentLevel() {
        try {
            while (this.state.executionPath.length > 0) {
                if (this.state.stopRequested) {
                    logger.info("[FlowRunner] Stop request detected in _executeCurrentLevel loop.");
                    break;
                }

                const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
                const steps = currentLevel.steps;
                const currentIndex = currentLevel.index;

                if (currentIndex >= steps.length) {
                    await this._popExecutionLevel();
                    
                    // Check if stop was requested during pop/loop iteration
                    if (this.state.stopRequested) {
                        logger.info("[FlowRunner] Stop request detected after popping/loop iteration in _executeCurrentLevel.");
                        break;
                    }
                    continue;
                }

                // --- Check stopRequested *before* executing the specific step ---
                if (this.state.stopRequested) {
                    logger.info("[FlowRunner] Stop request detected before executing step in _executeCurrentLevel.");
                    break;
                }
                // --- End Modification ---

                const step = steps[currentIndex];
                const context = currentLevel.context; // Context for this level

                // Execute the step
                await this._executeSingleStepLogic(step, context);

                // If stop requested during step execution, break loop
                if (this.state.stopRequested) {
                    logger.info("[FlowRunner] Stop request detected after executing step in _executeCurrentLevel.");
                    break;
                }

                // --- FIX START: Increment index of the correct level AFTER step execution ---
                const levelAfterExecution = this.state.executionPath.length > 0 ? this.state.executionPath[this.state.executionPath.length - 1] : null;

                // If the stack is empty after execution (shouldn't happen mid-loop but safety check)
                if (!levelAfterExecution) continue;

                // Determine which level's index needs incrementing.
                // This handles cases where the step execution pushed a new level (e.g., Condition, Loop start)
                // or popped a level (e.g., Loop end).
                let levelToIncrement = null;
                if (levelAfterExecution === currentLevel) {
                    // No stack change relevant to this level (or the executed level was popped and this is the new top).
                    // Increment the current top level's index.
                    levelToIncrement = levelAfterExecution;
                } else {
                    // Stack changed. If a new level was pushed, we need to increment the level *below* the new top,
                    // provided it matches the level we started with.
                    const levelBelowTop = this.state.executionPath.length > 1 ? this.state.executionPath[this.state.executionPath.length - 2] : null;
                    if (levelBelowTop === currentLevel) {
                        // A new level was pushed by the step we just executed (e.g., Condition branch, Loop start).
                        // Increment the index of the level that contained the step (currentLevel).
                        levelToIncrement = levelBelowTop; // which is currentLevel
                    }
                    // If the level we executed was popped (e.g., loop finished), levelToIncrement remains null.
                    // The loop will handle the new top level correctly in the next iteration.
                }

                // Increment the index of the identified level if found AND if its index matches the one we executed.
                // This prevents double-incrementing if the index was already updated internally (e.g., loop iteration reset).
                if (levelToIncrement && levelToIncrement.index === currentIndex) {
                    levelToIncrement.index++;
                    // console.log(`[FlowRunner _executeCurrentLevel] Incremented index for level containing step "${step.name}" (ID: ${step.id}) to ${levelToIncrement.index}`);
                } else if (levelToIncrement && levelToIncrement.index !== currentIndex) {
                    // This might indicate the index was already advanced internally (e.g., loop iteration reset). Log for safety.
                    logger.warn(`[FlowRunner _executeCurrentLevel] Index mismatch when trying to increment level for step ${step.id}. Expected index ${currentIndex}, found ${levelToIncrement.index}. No increment performed.`);
                } else if (!levelToIncrement && levelAfterExecution !== currentLevel) {
                    // This likely means the level was popped (e.g. loop/branch finished). No increment needed here.
                    // console.log(`[FlowRunner _executeCurrentLevel] Level for step ${step.id} was popped. No index increment needed at this stage.`);
                }
                // --- FIX END ---


                // Apply delay if running continuously and not the last step at this level
                // Check the index of the level *just processed* (levelToIncrement might be null if popped)
                // We need to check the index of the level whose step *was* just run.
                const levelToCheckForDelay = levelToIncrement || currentLevel; // Use the level whose index might have just been incremented, or the original if popped
                if (this.state.isRunning && levelToCheckForDelay && levelToCheckForDelay.index < levelToCheckForDelay.steps.length && this.delay > 0) {
                    // Check if the level still exists on the stack before potentially delaying based on its state
                    const levelStillExists = this.state.executionPath.some(l => l === levelToCheckForDelay);
                    if (levelStillExists) {
                        await this._sleep(this.delay); // _sleep now checks stopRequested internally
                    }
                }
            }
        } catch (error) {
            logger.error("[FlowRunner] Error in _executeCurrentLevel:", error);
            throw error;
        }
    }


    /** Executes the next step based on the execution path stack (for stepping) */
    async _executeNextStep() {
        if (this.state.stopRequested) {
            logger.info("[FlowRunner] Stop request detected at start of _executeNextStep.");
            return false;
        }

        if (this.state.executionPath.length === 0) return false;

        const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
        const steps = currentLevel.steps;
        const currentIndex = currentLevel.index;

        if (currentIndex >= steps.length) {
            await this._popExecutionLevel();
            
            if (this.state.stopRequested) {
                logger.info("[FlowRunner] Stop request detected after popping level in _executeNextStep.");
                return false;
            }
            
            if (this.state.executionPath.length === 0) return false;
            return this._executeNextStep();
        }

        const step = steps[currentIndex];
        const context = currentLevel.context;

        await this._executeSingleStepLogic(step, context);

        const levelAfterStepExecution = this.state.executionPath[this.state.executionPath.length - 1];
        if (levelAfterStepExecution === currentLevel && !this.state.stopRequested) {
            currentLevel.index++;
        }

        return true;
    }


    /** Core logic to execute a single step, handle its type, and manage results/context */
    async _executeSingleStepLogic(step, context) {
        let result = { status: 'skipped', output: null, error: null, extractionFailures: [] };
        let stepContext = { ...context };
        this.state.currentResultIndex = null;
        let processedStepResult;
        let processedStep;
        let unquotedPlaceholders = {};

        try {
            this.state.currentResultIndex = this.onStepStart(step, this._getCurrentPathArray());
            processedStepResult = this.substituteVariablesFn(step, stepContext);
            processedStep = processedStepResult.processedStep;
            unquotedPlaceholders = processedStepResult.unquotedPlaceholders || {};

            switch (processedStep.type) {
                case 'request':
                    result = await this._executeRequestStep(processedStep, unquotedPlaceholders);
                    if (result.status === 'success' && processedStep.extract) {
                        const { failures, extractedValues } = this._updateContextFromExtraction(processedStep.extract, result.output, stepContext);
                        result.extractionFailures = failures;
                        result.extractedValues = extractedValues;
                    }
                    break;
                case 'condition':
                    result = await this._executeConditionStep(processedStep, stepContext);
                    break;
                case 'loop':
                    result = await this._executeLoopStep(processedStep, stepContext);
                    break;
                default:
                    throw new Error(`Unknown step type: ${processedStep.type}`);
            }

            // Never overwrite the freshly-created context of a loop level when
            // the step we just ran *is* that loop node
            const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
            if (step.type !== 'loop' && currentLevel && currentLevel.context !== stepContext) {
                currentLevel.context = stepContext;
                this.onContextUpdate(currentLevel.context);
            }

            this.state.results.push({ stepId: step.id, ...result });
            this.onStepComplete(this.state.currentResultIndex, step, result, currentLevel?.context || stepContext, this._getCurrentPathArray());

            if (result.status === 'error') {
                if (step.type === 'request' && (!step.onFailure || step.onFailure === 'stop')) {
                    const errorReason = result.error || 'Request failed';
                    logger.warn(`[FlowRunner] Request Step \"${step.name}\" (ID: ${step.id}) failed and onFailure=stop. Requesting stop. Reason: ${errorReason}`);
                    this.onMessage(`Execution stopped: Request step "${step.name}" failed (onFailure=stop).`, "error");
                    this.stop();
                } else if (step.type !== 'request') {
                    const errorReason = result.error || 'Step failed';
                    logger.warn(`[FlowRunner] Non-Request Step \"${step.name}\" (ID: ${step.id}) failed. Requesting stop. Reason: ${errorReason}`);
                    this.onMessage(`Execution stopped due to error in step "${step.name}".`, "error");
                    this.stop();
                }
            }
        } catch (error) {
            result = { status: 'error', output: null, error: error.message || 'Unknown execution error', extractionFailures: [] };
            this.state.results.push({ stepId: step.id, ...result });
            this.onError(this.state.currentResultIndex, step, error, stepContext, this._getCurrentPathArray());
            logger.error(`[FlowRunner] Uncaught error during execution of step \"${step.name}\" (ID: ${step.id}). Requesting stop. Error:`, error);
            this.onMessage(`Execution stopped due to critical error in step "${step.name}": ${error.message}`, "error");
            this.stop();
        }
    }


    _pushExecutionLevel(steps, context, type, parentStepId = null) {
        if (steps && steps.length > 0) {
            this.state.executionPath.push({ steps, index: 0, context, type, parentStepId });
        } else {
            // If pushing an empty level, log it as skipped?
            this.onMessage(`Skipping empty branch/loop body (${type}).`, 'info');
        }
    }

    // Override _popExecutionLevel to handle loop iteration logic
    async _popExecutionLevel() {
        if (this.state.executionPath.length === 0) return;

        const finishedLevel = this.state.executionPath[this.state.executionPath.length - 1];

        // If the level we just finished was the body of a loop iteration
        if (finishedLevel.type === 'loop') {
            // Check if there are more items to process
            finishedLevel.loopItemIndex++; // Move to next item
            if (finishedLevel.loopItemIndex < finishedLevel.loopItems.length) {
                // Add delay between iterations in Run mode
                if (this.state.isRunning && this.delay > 0) {
                    await this._sleep(this.delay);
                    // Check if stop was requested during the sleep
                    if (this.state.stopRequested) {
                        logger.info("[FlowRunner Loop Delay] Stop request detected after delay in _popExecutionLevel.");
                        this.state.executionPath.pop();
                        return;
                    }
                }
                // Reset index to start of loop body steps for next iteration
                finishedLevel.index = 0;
                this._prepareLoopIterationContext(); // Prepare context for the new iteration
                // DO NOT POP the level, just reset its index and update context
                return; // Stay at this level
            } else {
                // All items processed, add Loop End marker and *then* pop
                const endResultIndex = this.onStepStart({ name: `Loop End`, type: 'System', id: `${finishedLevel.parentStepId}-end` }, this._getCurrentPathArray());
                // Use the context *before* popping the loop level
                const finalLoopContext = finishedLevel.context;
                this.onStepComplete(endResultIndex, { name: `Loop End`, type: 'System', id: `${finishedLevel.parentStepId}-end` }, { status: 'success', output: `Finished loop.`, error: null }, finalLoopContext, this._getCurrentPathArray());
            }
        } else if (finishedLevel.type === 'then' || finishedLevel.type === 'else') {
            // Log finishing a branch?
            // this.onMessage(`Finished ${finishedLevel.type} branch.`, 'info');
        }

        // Default pop action
        this.state.executionPath.pop();

        // After popping, potentially update context if needed (careful!)
        // Generally, context flows down, but maybe needed for some scenarios.
        // Example: If a loop modified a variable that existed *before* the loop started.
        const newCurrentLevel = this.state.executionPath[this.state.executionPath.length - 1];
        if (newCurrentLevel) {
            // Merge changes from the finished level's context back to the parent?
            // This requires careful thought. Let's assume context propagation is primarily downwards
            // and via extractions within the same level for now. If merging up is needed,
            // it would happen here, comparing finishedLevel.context with newCurrentLevel.context.
            // e.g., newCurrentLevel.context = { ...newCurrentLevel.context, ...selectivelyMergedData };
            // this.onContextUpdate(newCurrentLevel.context);
        }
    }

    _getCurrentPathArray() {
        // Provides a simplified view of the stack for context (e.g., for highlighting)
        return this.state.executionPath.map(level => ({
            type: level.type,
            index: level.index,
            parentStepId: level.parentStepId,
            // Add loop info if applicable
            ...(level.type === 'loop' && {
                loopItemIndex: level.loopItemIndex,
                loopItemCount: level.loopItems?.length ?? 0,
                loopVarName: level.loopVarName
            })
            // Avoid including full steps/context in this lightweight path
        }));
    }

    // --- Step Execution Implementations ---

    // --- [Modified Code] --- Store and clear AbortController in request step
    async _executeRequestStep(step, unquotedPlaceholders) {
        const { method, url, headers, body, onFailure } = step; // Destructure onFailure
        const effectiveOnFailure = onFailure || 'stop'; // Default to 'stop' if missing

        // --- MODIFICATION START: Use and manage AbortController ---
        const controller = new AbortController();
        this.state.currentFetchController = controller; // Store the controller
        // --- MODIFICATION END ---

        // Initialize timeoutId here so it's accessible in finally
        let timeoutId = null;

        const fetchOptions = {
            method: method || 'GET',
            headers: { ...this.globalHeaders, ...(headers || {}) },
            signal: controller.signal, // Use the controller's signal
        };

        // --- Body processing logic remains the same ---
        if (body !== null && body !== undefined && !['GET', 'HEAD'].includes(fetchOptions.method.toUpperCase())) {
            // Determine Content-Type. Default to JSON, but allow overrides.
            // Look for Content-Type in headers (case-insensitive).
            let contentType = 'application/json'; // Default
            for (const key in fetchOptions.headers) {
                if (key.toLowerCase() === 'content-type') {
                    contentType = fetchOptions.headers[key];
                    break;
                }
            }
            fetchOptions.headers['Content-Type'] = contentType; // Ensure it's set

            try {
                // Step 1: Stringify the processed body (placeholders are currently quoted strings)
                let bodyString = JSON.stringify(body);

                // Step 2: Replace placeholders with raw, unquoted values
                if (unquotedPlaceholders && Object.keys(unquotedPlaceholders).length > 0) {
                    for (const placeholder in unquotedPlaceholders) {
                        if (Object.prototype.hasOwnProperty.call(unquotedPlaceholders, placeholder)) {
                            const rawValue = unquotedPlaceholders[placeholder];
                            let replacementValueString;

                            // Determine the correct string representation for the raw value FOR REPLACEMENT
                            if (typeof rawValue === 'string') {
                                replacementValueString = rawValue;
                            } else if (typeof rawValue === 'number' && !isNaN(rawValue)) {
                                replacementValueString = String(rawValue);
                            } else if (typeof rawValue === 'boolean') {
                                replacementValueString = String(rawValue);
                            } else if (rawValue === null) {
                                replacementValueString = 'null';
                            } else {
                                console.warn(`Unsupported type (${typeof rawValue}) for unquoted variable placeholder "${placeholder}". Attempting JSON stringification for replacement.`);
                                replacementValueString = JSON.stringify(rawValue); // Fallback: stringify the complex type. This WILL be quoted.
                            }

                            // Create a regex to find the *quoted* placeholder string in the JSON string.
                            const quotedPlaceholderPattern = new RegExp(`"${escapeRegExp(placeholder)}"`, 'g');

                            // Replace the quoted placeholder with the unquoted string representation.
                            bodyString = bodyString.replace(quotedPlaceholderPattern, replacementValueString);
                        }
                    }
                }
                // Assign the final, processed string to the fetch options body
                fetchOptions.body = bodyString;

                // Optional: Validate if the final bodyString is valid JSON if content-type is application/json
                if (contentType.includes('application/json')) {
                    try {
                        JSON.parse(bodyString);
                    } catch (jsonError) {
                        console.warn(`Resulting request body for step ${step.id} is not valid JSON after unquoted replacements: ${jsonError.message}`);
                        // Let's throw an error here to prevent sending invalid JSON.
                        throw new Error(`Resulting request body is not valid JSON after unquoted replacements: ${jsonError.message}. Body: ${bodyString.substring(0, 200)}...`);
                    }
                }

            } catch (e) {
                // clearTimeout(timeoutId); // Timeout not set yet, but clear just in case? Moved to finally.
                // --- MODIFICATION START: Clear controller on early exit ---
                this.state.currentFetchController = null;
                // --- MODIFICATION END ---
                logger.error(`Error preparing request body for step ${step.id}:`, e);
                // This is a preparation error, should always result in 'error' status for the step
                return { status: 'error', output: null, error: `Failed to process request body: ${e.message}` };
            }
        } else if (body !== null && body !== undefined && typeof body !== 'string' && !['GET', 'HEAD'].includes(fetchOptions.method.toUpperCase())) {
            // If body is not null/undefined but also not a string after substitution
            logger.warn(`Request body for step ${step.id} is not a string or object/array after substitution. Type: ${typeof body}. Sending as string.`);
            fetchOptions.body = String(body);
            // If content-type wasn't set, maybe set to text/plain?
            if (!fetchOptions.headers['Content-Type']) {
                fetchOptions.headers['Content-Type'] = 'text/plain';
            }
        } else if (body !== null && body !== undefined && typeof body === 'string' && !['GET', 'HEAD'].includes(fetchOptions.method.toUpperCase())) {
            // If the body was already a string (e.g. XML, plain text), just use it
            if (!fetchOptions.headers['Content-Type']) {
                fetchOptions.headers['Content-Type'] = 'text/plain'; // Sensible default? Or derive?
            }
            fetchOptions.body = body;
        }
        // --- End body processing logic ---


        try {
            // Set timeout *before* fetch call
            timeoutId = setTimeout(() => {
                logger.warn(`[FlowRunner] Request timeout triggered for step ${step.id}. Aborting.`);
                controller.abort();
            }, 30000); // 30s timeout

            const response = await fetch(url, fetchOptions);
            // clearTimeout(timeoutId); // Clear normal completion timeout -> Moved to finally block
            const responseStatus = response.status;
            const responseHeaders = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });
            let responseBody = null;

            if (responseStatus !== 204) {
                const respContentType = response.headers.get('content-type');
                try {
                    if (respContentType && respContentType.includes('application/json')) {
                        responseBody = await response.json();
                    } else {
                        responseBody = await response.text();
                    }
                } catch (parseError) {
                    try {
                        responseBody = await response.text();
                    } catch (textError) {
                        responseBody = "[Failed to retrieve response body]";
                        this.onMessage(`Response body parsing failed and text fallback failed: ${textError.message}`, 'error');
                    }
                    this.onMessage(`Response body parsing failed: ${parseError.message}. Using raw text fallback.`, 'warning');
                }
            }

            // --- MODIFICATION START: Implement onFailure logic for HTTP status (remains the same logic) ---
            const output = { status: responseStatus, headers: responseHeaders, body: responseBody };

            if (response.ok) { // Status 200-299
                return { status: 'success', output: output, error: null };
            } else { // Status < 200 or >= 300
                if (effectiveOnFailure === 'continue') {
                    // Continue flow, report step as success, but output contains non-2xx status
                    this.onMessage(`Request step "${step.name}" received non-2xx status ${responseStatus}, continuing flow.`, 'warning');
                    // Return 'success' so extraction can happen and flow continues based on _executeSingleStepLogic check
                    return { status: 'success', output: output, error: null };
                } else { // 'stop' (default)
                    // Stop flow, report step as error
                    this.onMessage(`Request step "${step.name}" failed with status ${responseStatus}, stopping flow.`, 'error');
                    // Return 'error' status - _executeSingleStepLogic will see this and trigger stop()
                    return { status: 'error', output: output, error: `Request failed with status ${responseStatus}` };
                }
            }
            // --- MODIFICATION END ---

        } catch (error) { // Catch network errors, timeouts, ABORTS etc.
            // clearTimeout(timeoutId); // Clear error/abort timeout -> Moved to finally block
            logger.error(`Fetch error for step ${step.id}:`, error);
            let errorMsg = error.message || 'Network error or invalid request';

            // --- MODIFICATION START: Specific message for user abort ---
            if (error.name === 'AbortError') {
                // Check if it was aborted by the timeout or by user stop()
                if (this.state.stopRequested && this.state.currentFetchController === controller) { // Ensure this abort corresponds to the *current* stop request
                    errorMsg = 'Request aborted by user.';
                    this.onMessage(`Request step "${step.name}" was aborted by user.`, 'warning');
                } else {
                    errorMsg = 'Request timed out (30s)';
                    this.onMessage(`Request step "${step.name}" timed out after 30 seconds.`, 'error');
                }
            } else if (errorMsg.match(/ENOTFOUND|DNS|getaddrinfo|Failed to fetch|Name or service not known|Could not resolve host/i)) {
                errorMsg = 'Network error: Could not resolve host or DNS lookup failed.';
                this.onMessage(`Request step "${step.name}": Could not resolve host or DNS lookup failed.\n\nCheck the URL and your network connection.`, 'error');
            } else if (errorMsg.match(/ECONNREFUSED|connection refused|ECONNRESET|Connection refused/i)) {
                errorMsg = 'Network error: Connection refused by server.';
                this.onMessage(`Request step "${step.name}": Connection refused by server.\n\nCheck if the server is running and reachable.`, 'error');
            } else if (errorMsg.match(/timeout|timed out|ETIMEDOUT/i)) {
                errorMsg = 'Network error: Connection timed out.';
                this.onMessage(`Request step "${step.name}": Connection timed out.\n\nCheck your network connection and server status.`, 'error');
            } else if (errorMsg.match(/NetworkError|network error|TypeError: Failed to fetch/i)) {
                errorMsg = 'Network error: Failed to connect.';
                this.onMessage(`Request step "${step.name}": Failed to connect.\n\nCheck your network connection and the request URL.`, 'error');
            }
            // --- MODIFICATION END ---

            // --- MODIFICATION START: Implement onFailure logic for fetch errors (remains the same logic) ---
            if (effectiveOnFailure === 'continue') {
                // Continue flow, report step as error (since the request fundamentally failed)
                this.onMessage(`Request step "${step.name}" encountered network/fetch error, continuing flow. Error: ${errorMsg}`, 'warning');
                // Return 'error' status, but _executeSingleStepLogic checks onFailure === 'continue' and won't stop the flow
                return { status: 'error', output: null, error: errorMsg };
            } else { // 'stop' (default)
                // Stop flow, report step as error
                this.onMessage(`Request step "${step.name}" failed with network/fetch error, stopping flow. Error: ${errorMsg}`, 'error');
                // Return 'error' status - _executeSingleStepLogic will see this and trigger stop()
                return { status: 'error', output: null, error: errorMsg };
            }
            // --- MODIFICATION END ---
        } finally {
            // --- MODIFICATION START: Always clear the controller and timeout ---
            clearTimeout(timeoutId); // Ensure timeout is cleared regardless of outcome
            if (this.state.currentFetchController === controller) {
                this.state.currentFetchController = null; // Clear the stored controller only if it's the one we created
            }
            // --- MODIFICATION END ---
        }
    } // --- End of _executeRequestStep ---

    async _executeConditionStep(step, context) {
        let conditionMet = false;
        let evalError = null;

        try {
            // Use the provided evaluation function
            conditionMet = this.evaluateConditionFn(step.conditionData, context);
        } catch (error) {
            logger.error(`Error evaluating condition for step ${step.id}:`, error);
            evalError = error;
            conditionMet = false; // Ensure condition is false on error
        }

        // Log condition evaluation result (success or error) as part of the condition step itself
        let resultStatus = evalError ? 'error' : 'success';
        let resultOutput = { conditionMet: conditionMet, branchTaken: 'none' }; // Default to none
        let resultError = evalError ? `Condition evaluation error: ${evalError.message}` : null;

        // If evaluation didn't error out, determine branch and push
        if (!evalError) {
            resultOutput.branchTaken = conditionMet ? 'Then' : 'Else';
            // Add a system message for clarity
            const branchResultIndex = this.onStepStart({ name: `Condition Result: ${conditionMet ? 'TRUE' : 'FALSE'}`, type: 'System', id: `${step.id}-result` }, this._getCurrentPathArray());
            this.onStepComplete(branchResultIndex, { name: `Condition Result: ${conditionMet ? 'TRUE' : 'FALSE'}`, type: 'System', id: `${step.id}-result` }, { status: 'success', output: `Branch: ${resultOutput.branchTaken}`, error: null }, context, this._getCurrentPathArray());

            // Push the appropriate branch onto the execution stack
            if (conditionMet) {
                this._pushExecutionLevel(step.thenSteps || [], { ...context }, 'then', step.id);
            } else {
                this._pushExecutionLevel(step.elseSteps || [], { ...context }, 'else', step.id);
            }
        } else {
            // If evaluation itself errored, log that
            const errorResultIndex = this.onStepStart({ name: `Condition Error`, type: 'System', id: `${step.id}-error` }, this._getCurrentPathArray());
            this.onStepComplete(errorResultIndex, { name: `Condition Error`, type: 'System', id: `${step.id}-error` }, { status: 'error', output: null, error: resultError }, context, this._getCurrentPathArray());
        }


        // The condition step itself is 'success' if evaluation worked, 'error' otherwise.
        // The actual work happens in the pushed branch level (or not, if error).
        // _executeSingleStepLogic will handle stopping if resultStatus is 'error'
        return { status: resultStatus, output: resultOutput, error: resultError };
    }

    async _executeLoopStep(step, context) {
        const sourceVarName = (step.source || '').trim();
        const loopVariable = step.loopVariable || 'item';
        let items = [];
        let evalError = null;

        if (!this.evaluatePathFn) {
            return { status: 'error', output: null, error: 'Loop step requires evaluatePathFn to be configured in FlowRunner.' };
        }

        try {
            // Evaluate the source path to get the array
            if (!sourceVarName) {
                throw new Error(`Loop source cannot be empty.`);
            }
            // Need to evaluate the source path like {{ contextVar.array }}
            // substituteVariablesFn might handle this if configured, but direct evaluation is cleaner here.
            const sourcePath = sourceVarName.startsWith('{{') && sourceVarName.endsWith('}}')
                ? sourceVarName.slice(2, -2).trim()
                : sourceVarName; // Allow direct context keys or paths

            items = this.evaluatePathFn(context, sourcePath);

            if (items === undefined || items === null) {
                this.onMessage(`Loop source "${step.source}" resolved to null or undefined. Treating as empty array.`, 'warning');
                items = []; // Treat null/undefined as empty for looping
            } else if (!Array.isArray(items)) {
                throw new Error(`Loop source "${step.source}" did not resolve to an array. Resolved value type: ${typeof items}, value: ${JSON.stringify(items).substring(0,100)}...`);
            }

            // Add Loop Start marker
            const startResultIndex = this.onStepStart({ name: `Loop Start (${items.length} items)`, type: 'System', id: `${step.id}-start` }, this._getCurrentPathArray());
            const startMsg = items.length === 0 ? `Loop source "${step.source}" is empty. Skipping body.` : `Iterating over "${step.source}" (${items.length} items) as "{{${loopVariable}}}".`;
            this.onStepComplete(startResultIndex, { name: `Loop Start (${items.length} items)`, type: 'System', id: `${step.id}-start` }, { status: 'success', output: startMsg, error: null }, context, this._getCurrentPathArray());


            if (items.length > 0) {
                // Push the loop body onto the stack, but with special context handling
                const loopContextBase = { ...context }; // Capture context *before* the loop starts modifying it per iteration
                this.state.executionPath.push({
                    steps: step.loopSteps || [],
                    index: 0, // Start at first step *within* the loop body
                    context: loopContextBase, // Base context for the loop level (will be updated per iteration)
                    type: 'loop',
                    parentStepId: step.id,
                    // Loop-specific state:
                    loopItems: items,
                    loopItemIndex: 0, // Start with the first item
                    loopVarName: loopVariable,
                });
                // Prepare context for the *first* iteration immediately
                this._prepareLoopIterationContext();

            }
            // Loop step setup is successful (even if 0 items)
            return { status: 'success', output: { itemCount: items.length }, error: null };

        } catch (error) {
            logger.error(`Error evaluating loop source for step ${step.id}:`, error);
            evalError = error;
        }

        if (evalError) {
            const errResultIndex = this.onStepStart({ name: `Loop Error`, type: 'System', id: `${step.id}-error` }, this._getCurrentPathArray());
            this.onStepComplete(errResultIndex, { name: `Loop Error`, type: 'System', id: `${step.id}-error` }, { status: 'error', output: null, error: `Loop setup error: ${evalError.message}` }, context, this._getCurrentPathArray());
            // _executeSingleStepLogic will handle stopping due to 'error' status
            return { status: 'error', output: null, error: `Loop setup error: ${evalError.message}` };
        }
        // Should not be reached if error handling is correct
        return { status: 'skipped', output: { itemCount: 0 }, error: 'Unexpected state in loop setup' };
    }


    _prepareLoopIterationContext() {
        const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
        if (!currentLevel || currentLevel.type !== 'loop') return;

        const { loopItems, loopItemIndex, loopVarName } = currentLevel;

        if (loopItemIndex < loopItems.length) {
            const currentItem = loopItems[loopItemIndex];
            
            // Set the loop variable for this iteration
            currentLevel.context[loopVarName] = currentItem;

            // Notify UI of context change for this specific level/iteration
            this.onContextUpdate(currentLevel.context);

            // Add iteration marker
            const iterResultIndex = this.onStepStart({ 
                name: `Loop Iteration ${loopItemIndex + 1}/${loopItems.length}`, 
                type: 'System', 
                id: `${currentLevel.parentStepId}-iter-${loopItemIndex}` 
            }, this._getCurrentPathArray());

            let itemPreview = "[Complex Object/Array]";
            try {
                if (currentItem === null) itemPreview = 'null';
                else if (typeof currentItem === 'object') itemPreview = JSON.stringify(currentItem);
                else itemPreview = String(currentItem);

                if (itemPreview.length > 100) itemPreview = itemPreview.substring(0, 100) + '...';
            } catch (e) {
                itemPreview = "[Preview Error]";
            }

            this.onStepComplete(
                iterResultIndex,
                { 
                    name: `Loop Iteration ${loopItemIndex + 1}/${loopItems.length}`, 
                    type: 'System', 
                    id: `${currentLevel.parentStepId}-iter-${loopItemIndex}` 
                },
                { 
                    status: 'success', 
                    output: `{{${loopVarName}}} = ${itemPreview}`, 
                    error: null 
                },
                currentLevel.context,
                this._getCurrentPathArray()
            );
        } else {
            this.onMessage(`Warning: _prepareLoopIterationContext called with invalid index ${loopItemIndex}`, 'warning');
        }
    }


    /**
     * Updates the runtime context based on extraction rules.
     * Returns an array of failed extractions.
     * @param {Object} extractConfig - { varName: pathString, ... }
     * @param {Object} responseOutput - { status, headers, body }
     * @param {Object} context - The context object to modify directly.
     * @returns {Array<Object>} An array of objects detailing failed extractions, e.g., [{ varName: 'user', path: 'body.data.user.id', reason: '...' }]
     */
    _updateContextFromExtraction(extractConfig, responseOutput, context) {
        const failures = [];
        const extractedValues = {};
        if (!extractConfig || !responseOutput) return { failures, extractedValues };

        const evaluatePath = this.evaluatePathFn;
        if (typeof evaluatePath !== 'function') {
            // --- MODIFICATION: No global message, log error ---
            // this.onMessage(`Extraction failed: evaluatePath function is not available.`, 'error');
            logger.error("FlowRunner: this.evaluatePathFn is missing or not a function during extraction.");
            return { failures, extractedValues };
        }

        logger.info("[Extraction] Attempting extractions. Config:", extractConfig, "Response Output:", responseOutput);
        let contextChanged = false;

        for (const varName in extractConfig) {
            const path = extractConfig[varName];
            let extractedValue = undefined;
            let extractionError = null; // <-- Track specific error for this extraction

            logger.info(`[Extraction] Processing rule: Variable="${varName}", Path="${path}"`);

            try {
                if (!varName || typeof varName !== 'string') {
                    extractionError = `Invalid variable name "${varName}"`;
                    logger.warn(`[Extraction] ${extractionError}`);
                    // Don't add to failures, just skip? Or add? Let's add for visibility.
                    failures.push({ varName: varName || 'INVALID', path: path || 'N/A', reason: extractionError });
                    continue;
                }
                if (path === undefined || path === null || typeof path !== 'string') {
                    extractionError = `Path is missing or invalid`;
                    logger.warn(`[Extraction] ${extractionError} for variable "${varName}"`);
                    // --- MODIFICATION: Set context var to undefined and add failure ---
                    if (context.hasOwnProperty(varName)) {
                        context[varName] = undefined;
                        contextChanged = true;
                    }
                    failures.push({ varName: varName, path: path || 'N/A', reason: extractionError });
                    continue;
                }

                // --- Path evaluation logic (remains largely the same, added logging/path extraction) ---
                if (path === '.status') {
                    extractedValue = responseOutput.hasOwnProperty('status') ? responseOutput.status : undefined;
                    logger.info(`[Extraction] Path ".status" evaluated to:`, extractedValue);
                } else if (path === '$status') { // Legacy/alternative keyword check
                    extractedValue = responseOutput.status;
                    logger.info(`[Extraction] Path "$status" evaluated to:`, extractedValue);
                } else if (path === '$headers') {
                    extractedValue = responseOutput.headers;
                    logger.info(`[Extraction] Path "$headers" evaluated.`);
                } else if (path === '$body') {
                    extractedValue = responseOutput.body;
                    logger.info(`[Extraction] Path "$body" evaluated.`);
                } else if (path.startsWith('$header.')) {
                    const headerName = path.substring('$header.'.length).toLowerCase();
                    extractedValue = undefined; // Default if not found
                    if (responseOutput.headers) {
                        for (const key in responseOutput.headers) {
                            if (key.toLowerCase() === headerName) {
                                extractedValue = responseOutput.headers[key];
                                break;
                            }
                        }
                    }
                    logger.info(`[Extraction] Path "${path}" evaluated to:`, extractedValue);
                } else {
                    // Standard path evaluation (Assume body first, then try response if prefixed)
                    let valueFromBody = undefined;
                    let valueFromResponse = undefined;
                    try {
                        valueFromBody = evaluatePath(responseOutput.body, path);
                        logger.info(`[Extraction] Path "${path}" on BODY evaluated to:`, valueFromBody);
                    } catch (evalError) {
                        // --- MODIFICATION: Capture eval error for failure reason ---
                        extractionError = `Path evaluation error on body: ${evalError.message}`;
                        logger.warn(`[Extraction] Path "${path}" on BODY failed: ${evalError.message}`);
                        valueFromBody = undefined;
                        // --- END MODIFICATION ---
                    }

                    if (valueFromBody !== undefined) {
                        extractedValue = valueFromBody;
                    }
                    else if (path.startsWith('response.')) { // Only try response if explicitly prefixed AND body yielded undefined
                        try {
                            const responsePath = path.substring('response.'.length);
                            valueFromResponse = evaluatePath(responseOutput, responsePath);
                            logger.info(`[Extraction] Path "${path}" on RESPONSE evaluated to:`, valueFromResponse);
                            if (valueFromResponse !== undefined) extractedValue = valueFromResponse;
                        } catch (evalError) {
                            // --- MODIFICATION: Capture eval error for failure reason ---
                            extractionError = `Path evaluation error on response: ${evalError.message}`;
                            logger.warn(`[Extraction] Path "${path}" on RESPONSE failed: ${evalError.message}`);
                            valueFromResponse = undefined; // Ensure undefined on error
                            // --- END MODIFICATION ---
                        }
                    }
                }
                // --- End path evaluation logic ---

                if (extractedValue === undefined) {
                    // --- MODIFICATION: Don't message, add to failures. Use captured error if available. ---
                    if (!extractionError) { // Only set this reason if no eval error occurred
                        extractionError = `Path "${path}" yielded no value (undefined)`;
                    }
                    logger.warn(`[Extraction] FAILURE: ${extractionError} for variable "${varName}".`);
                    failures.push({ varName: varName, path: path, reason: extractionError });
                    // --- END MODIFICATION ---
                }

                // Store the extracted value (or undefined if not found/error)
                const oldValue = context[varName];
                if (oldValue !== extractedValue) { // Update context if value changed (including becoming undefined)
                    context[varName] = extractedValue;
                    contextChanged = true;
                    if (extractedValue !== undefined) {
                        logger.info(`[Extraction] SUCCESS: Stored context["${varName}"] =`, extractedValue);
                    } else {
                        logger.info(`[Extraction] INFO: Set context["${varName}"] to undefined.`);
                    }
                } else {
                    logger.info(`[Extraction] INFO: Value for context["${varName}"] is unchanged (${typeof extractedValue}).`);
                }

            } catch (e) {
                extractionError = `Unexpected extraction error: ${e.message}`;
                logger.error(`[Extraction] UNEXPECTED ERROR for "${varName}" path "${path}":`, e);
                // --- MODIFICATION: Don't message, add to failures, set context var to undefined ---
                failures.push({ varName: varName, path: path, reason: extractionError });
                if (context[varName] !== undefined) {
                    context[varName] = undefined;
                    contextChanged = true;
                }
                // --- END MODIFICATION ---
            }
            extractedValues[varName] = extractedValue;
        }
        // Notify context update *once* after all extractions for the step are done, only if changed
        if (contextChanged) {
            this.onContextUpdate(context);
        }

        return { failures, extractedValues };
    }


    async _sleep(ms) {
        return new Promise((resolve) => {
            let timeoutId = null;
            const checkStop = () => {
                if (this.state.stopRequested) {
                    // console.log("[FlowRunner] Sleep interrupted by stop request.");
                    if (timeoutId !== null) clearTimeout(timeoutId);
                    resolve(); // Resolve early if stopped
                    return true; // Indicate stop was checked and handled
                }
                return false; // Indicate stop not requested
            };

            // Check immediately before setting timeout
            if (checkStop()) return;

            timeoutId = setTimeout(() => {
                // Double-check before resolving naturally
                if (!checkStop()) {
                    resolve();
                }
            }, ms);
        });
    }


} // --- End of FlowRunner class ---