// flowRunner.js
/**
 * flowRunner.js
 * Handles the execution logic for API flows, including stepping, context management, and delays.
 */

// Assuming these are passed in or globally available (better to pass in constructor)
// import { evaluatePath } from './flowCore.js'; // Needs to be defined/imported

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

        // Core logic functions provided by the main app
        this.substituteVariablesFn = options.substituteVariablesFn || ((step, context) => step); // Default pass-through
        this.evaluateConditionFn = options.evaluateConditionFn || (() => false); // Default false
        // this.evaluatePathFn = options.evaluatePathFn || evaluatePath; // Use imported or passed function

        this.reset();
    }

    reset(initialContext = {}) {
        this.state = {
            isRunning: false,
            isStepping: false, // Actively executing a single step action
            stopRequested: false,
            executionPath: [], // Stack representing current position [ { steps: [], index: 0, context: {} }, ... ]
            context: { ...initialContext }, // Runtime variables { varName: value }
            results: [], // History of step results for this run { stepId, status, output, error }
            currentResultIndex: null, // Index passed back from onStepStart for updates
        };
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

    stop() {
        if (this.state.isRunning || this.state.isStepping) {
            this.state.stopRequested = true;
            // Callbacks are triggered within the execution loop check
        }
    }

    /**
     * Executes the entire flow from the beginning.
     * @param {Object} flowModel - The flow model object.
     */
    async run(flowModel) {
        if (this.state.isRunning || this.state.isStepping) {
            throw new Error("Execution already in progress.");
        }
        if (!flowModel || !flowModel.steps) {
            throw new Error("Invalid flow model provided.");
        }

        this.reset(flowModel.staticVars || {}); // Reset with static vars
        this.state.isRunning = true;
        this.state.stopRequested = false;
        this.onContextUpdate(this.state.context); // Notify initial context

        // Initialize execution path stack
        this.state.executionPath = [{ steps: flowModel.steps, index: 0, context: this.state.context, type: 'main' }];

        await this._executeCurrentLevel();

        // Execution finished or stopped
        this.state.isRunning = false;
        this.state.isStepping = false; // Ensure stepping mode is off
        if (this.state.stopRequested) {
            this.onFlowStopped(this.state.context, this.state.results);
        } else {
            this.onFlowComplete(this.state.context, this.state.results);
        }
    }

    /**
     * Executes the next single logical step in the flow.
     * @param {Object} flowModel - The flow model object.
     */
    async step(flowModel) {
        if (this.state.isRunning || this.state.isStepping) {
             this.onMessage("Already processing a step.", "warning");
            return; // Prevent concurrent stepping
        }
         if (!flowModel || !flowModel.steps) {
            throw new Error("Invalid flow model provided.");
        }

        this.state.isStepping = true; // Indicate stepping mode active
        this.state.stopRequested = false; // Allow stopping a step sequence

        // If starting fresh, initialize
        if (this.state.executionPath.length === 0) {
            this.reset(flowModel.staticVars || {});
            this.onContextUpdate(this.state.context);
            this.state.executionPath = [{ steps: flowModel.steps, index: 0, context: this.state.context, type: 'main' }];
        }

        // Execute one step/block
        const executed = await this._executeNextStep();

        if (!executed && !this.state.stopRequested) {
             this.onMessage("End of flow reached.", "info");
             // Optionally trigger onFlowComplete when stepping reaches the end?
             // this.onFlowComplete(this.state.context, this.state.results);
        }

        this.state.isStepping = false; // Stepping complete for this action

        if (this.state.stopRequested) {
            this.onFlowStopped(this.state.context, this.state.results);
        }
    }

    // --- Internal Execution Logic ---

    /** Executes steps at the current level in the execution path stack */
    async _executeCurrentLevel() {
        while (this.state.executionPath.length > 0) {
            if (this.state.stopRequested) break;

            const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
            const steps = currentLevel.steps;
            const index = currentLevel.index;

            if (index >= steps.length) {
                // Finished steps at this level, pop from stack
                this._popExecutionLevel();
                continue; // Process the next level (or finish)
            }

            const step = steps[index];
            const context = currentLevel.context; // Context for this level

            // Execute the step
            await this._executeSingleStepLogic(step, context);

            // If stop requested during step execution, break loop
            if (this.state.stopRequested) break;

             // Increment index for the *next* iteration at this level
             currentLevel.index++;

            // Apply delay if running continuously and not the last step at this level
            if (this.state.isRunning && currentLevel.index < steps.length && this.delay > 0) {
                await this._sleep(this.delay);
            }
             // If stepping, break after one step execution
            if (!this.state.isRunning) break;
        }
    }

    /** Executes the next step based on the execution path stack (for stepping) */
    async _executeNextStep() {
         if (this.state.executionPath.length === 0 || this.state.stopRequested) {
             return false; // Nothing more to execute or stopped
         }

         const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
         const steps = currentLevel.steps;
         const index = currentLevel.index;

         if (index >= steps.length) {
             // Finished steps at this level, pop and try stepping at parent level
             this._popExecutionLevel();
             return this._executeNextStep(); // Recursive call to step at the new top level
         }

         const step = steps[index];
         const context = currentLevel.context;

         // Execute the single step logic
         await this._executeSingleStepLogic(step, context);

          // Increment index for the next step call *after* this one completes
          currentLevel.index++;

         return true; // Indicate a step was executed
    }


    /** Core logic to execute a single step, handle its type, and manage results/context */
    async _executeSingleStepLogic(step, context) {
        let result = { status: 'skipped', output: null, error: null };
        let stepContext = { ...context }; // Create context snapshot for this step
        this.state.currentResultIndex = null; // Reset result index
        let processedStep;

        try {
            // Notify start and get result index
            this.state.currentResultIndex = this.onStepStart(step, this._getCurrentPathArray());

            // Substitute variables BEFORE execution (might throw errors)
            processedStep = this.substituteVariablesFn(step, stepContext);

            switch (processedStep.type) {
                case 'request':
                    result = await this._executeRequestStep(processedStep);
                    // Update context ONLY if successful
                    if (result.status === 'success' && processedStep.extract) {
                        this._updateContextFromExtraction(processedStep.extract, result.output, stepContext);
                    }
                    break;
                case 'condition':
                    // Pass stepContext to allow condition evaluation based on current runtime values
                    result = await this._executeConditionStep(processedStep, stepContext);
                    // Condition execution manages pushing/popping its own branches
                    break;
                case 'loop':
                    // Pass stepContext for source evaluation
                    result = await this._executeLoopStep(processedStep, stepContext);
                    // Loop execution manages pushing/popping its own body
                    break;
                default:
                    throw new Error(`Unknown step type: ${processedStep.type}`);
            }

            // --- Finalize Step ---
            // If the step modified context (e.g., extraction), merge it back
            // This makes changes available to subsequent steps at the *same level*
            const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
            if (currentLevel) {
               currentLevel.context = { ...currentLevel.context, ...stepContext }; // Merge changes back
               this.onContextUpdate(currentLevel.context); // Notify UI of context change
            }


            // Store and notify completion
            this.state.results.push({ stepId: step.id, ...result });
            this.onStepComplete(this.state.currentResultIndex, step, result, currentLevel?.context || {}, this._getCurrentPathArray());

            // Handle step error affecting flow control
            if (result.status === 'error') {
                 this.onMessage(`Execution stopped due to error in step "${step.name}".`, "error");
                this.stop(); // Request stop on error
            }

        } catch (error) {
            // Catch errors during substitution or execution logic
            result = { status: 'error', output: null, error: error.message || 'Unknown execution error' };
            this.state.results.push({ stepId: step.id, ...result });

             // Notify using onError callback
             this.onError(this.state.currentResultIndex, step, error, stepContext, this._getCurrentPathArray());
            this.stop(); // Stop flow on critical/unhandled error
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

    _popExecutionLevel() {
        if (this.state.executionPath.length > 0) {
             const finishedLevel = this.state.executionPath.pop();
             // Option: Log when finishing a branch/loop?
             // this.onMessage(`Finished ${finishedLevel.type} block.`, 'info');

             // Merge context back up? Only if needed and carefully managed.
             // Generally, context flows down, not up, except for extractions within the same level.
             // const parentLevel = this.state.executionPath[this.state.executionPath.length - 1];
             // if (parentLevel && finishedLevel.context !== parentLevel.context) {
             //     // Decide on merge strategy: Overwrite parent? Selectively merge?
             //      parentLevel.context = { ...parentLevel.context, ...finishedLevel.context }; // Example: Child overwrites parent
             //      this.onContextUpdate(parentLevel.context);
             // }
        }
    }

    _getCurrentPathArray() {
        // Provides a simplified view of the stack for context (e.g., for highlighting)
        return this.state.executionPath.map(level => ({
            type: level.type,
            index: level.index,
            parentStepId: level.parentStepId,
            // Avoid including full steps/context in this lightweight path
        }));
    }


    async _executeRequestStep(step) {
        const { method, url, headers, body } = step;
        const fetchOptions = {
            method: method || 'GET',
            headers: headers || {},
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
        fetchOptions.signal = controller.signal;


        if (body && !['GET', 'HEAD'].includes(fetchOptions.method.toUpperCase())) {
            fetchOptions.headers['Content-Type'] = fetchOptions.headers['Content-Type'] || 'application/json';
            try {
                fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
            } catch (e) {
                clearTimeout(timeoutId);
                return { status: 'error', output: null, error: `Failed to stringify request body: ${e.message}` };
            }
        }

        try {
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            const responseStatus = response.status;
            const responseHeaders = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });
            let responseBody = null;
            const contentType = response.headers.get('content-type');

            try {
                 if (contentType && contentType.includes('application/json')) {
                     responseBody = await response.json();
                 } else {
                     responseBody = await response.text();
                 }
            } catch (parseError) {
                 // Handle cases where parsing fails (e.g., empty JSON response, invalid text encoding)
                 responseBody = await response.text(); // Fallback to text
                 this.onMessage(`Response body parsing failed: ${parseError.message}. Using raw text.`, 'warning');
            }


            const output = {
                status: responseStatus,
                headers: responseHeaders,
                body: responseBody,
            };

            // Treat non-2xx as technical success but functional failure (allows checking status in conditions)
            // Mark status as 'error' only for network/fetch exceptions.
            // Let the condition steps decide if a 4xx/5xx is an "error" in the flow logic.
            // if (!response.ok) {
            //     return { status: 'error', output: output, error: `Request failed with status ${responseStatus}` };
            // }
             // Return 'success' even for non-2xx, output contains the details
            return { status: 'success', output: output, error: null };

        } catch (error) {
            clearTimeout(timeoutId);
            console.error(`Fetch error for step ${step.id}:`, error);
            let errorMsg = error.message || 'Network error or invalid request';
            if (error.name === 'AbortError') {
                errorMsg = 'Request timed out (30s)';
            }
            return { status: 'error', output: null, error: errorMsg };
        }
    }

    async _executeConditionStep(step, context) {
        let conditionMet = false;
        let evalError = null;

        try {
             // Use the provided evaluation function
             conditionMet = this.evaluateConditionFn(step.conditionData, context);
        } catch (error) {
            console.error(`Error evaluating condition for step ${step.id}:`, error);
            evalError = error;
        }

        if (evalError) {
            return { status: 'error', output: { conditionMet: false, branchTaken: 'none' }, error: `Condition evaluation error: ${evalError.message}` };
        }

        // Log which branch is taken (as a separate, intermediate result?)
        const branchResultIndex = this.onStepStart({ name: `Condition Result: ${conditionMet ? 'TRUE' : 'FALSE'}`, type: 'System', id: `${step.id}-result` }, this._getCurrentPathArray());
        this.onStepComplete(branchResultIndex, { name: `Condition Result: ${conditionMet ? 'TRUE' : 'FALSE'}`, type: 'System', id: `${step.id}-result` }, { status: 'success', output: `Branch: ${conditionMet ? 'Then' : 'Else'}`, error: null }, context, this._getCurrentPathArray());


        // Push the appropriate branch onto the execution stack
        if (conditionMet) {
             this._pushExecutionLevel(step.thenSteps || [], { ...context }, 'then', step.id);
        } else {
             this._pushExecutionLevel(step.elseSteps || [], { ...context }, 'else', step.id);
        }

        // The condition step itself is 'success' if evaluation worked.
        // The actual work happens in the pushed branch level.
        return { status: 'success', output: { conditionMet: conditionMet, branchTaken: conditionMet ? 'Then' : 'Else' }, error: null };
    }

    async _executeLoopStep(step, context) {
        const sourceVarName = (step.source || '').trim();
        const loopVariable = step.loopVariable || 'item';
        let items = [];
        let evalError = null;

        try {
            // Use evaluatePath directly here (needs access to it) or pass evaluateVariable function
            // items = this.evaluatePathFn(context, sourceVarName.replace(/[{}]/g, ''));
             // Assuming substituteVariablesFn includes evaluateVariable
             items = this.substituteVariablesFn({}, context)[sourceVarName.replace(/[{}]/g, '')]; // Hacky way to call evaluate


            if (!Array.isArray(items)) {
                throw new Error(`Loop source "${step.source}" did not resolve to an array. Value: ${JSON.stringify(items)}`);
            }

            // Add Loop Start marker
             const startResultIndex = this.onStepStart({ name: `Loop Start (${items.length} items)`, type: 'System', id: `${step.id}-start` }, this._getCurrentPathArray());
             const startMsg = items.length === 0 ? `Loop source "${step.source}" is empty. Skipping.` : `Iterating over "${step.source}" as "{{${loopVariable}}}".`;
             this.onStepComplete(startResultIndex, { name: `Loop Start (${items.length} items)`, type: 'System', id: `${step.id}-start` }, { status: 'success', output: startMsg, error: null }, context, this._getCurrentPathArray());


            if (items.length > 0) {
                 // Push the loop body onto the stack, but with special context handling
                 // We need a way to iterate through items across multiple 'step' calls.
                 // Add iteration info to the execution level state.
                 const loopContextBase = { ...context };
                 this.state.executionPath.push({
                     steps: step.loopSteps || [],
                     index: 0, // Start at first step *within* the loop body
                     context: loopContextBase, // Base context for the loop level
                     type: 'loop',
                     parentStepId: step.id,
                     // Loop-specific state:
                     loopItems: items,
                     loopItemIndex: 0,
                     loopVarName: loopVariable,
                 });
                 // Prepare context for the *first* iteration immediately
                 this._prepareLoopIterationContext();

            }
            // Loop step setup is successful
             return { status: 'success', output: { itemCount: items.length }, error: null };

        } catch (error) {
             console.error(`Error evaluating loop source for step ${step.id}:`, error);
             evalError = error;
        }

         if (evalError) {
             const errResultIndex = this.onStepStart({ name: `Loop Error`, type: 'System', id: `${step.id}-error` }, this._getCurrentPathArray());
             this.onStepComplete(errResultIndex, { name: `Loop Error`, type: 'System', id: `${step.id}-error` }, { status: 'error', output: null, error: `Loop setup error: ${evalError.message}` }, context, this._getCurrentPathArray());
             return { status: 'error', output: null, error: `Loop setup error: ${evalError.message}` };
         }
         return { status: 'skipped', output: null, error: null}; // Should not be reached
    }


    _prepareLoopIterationContext() {
         const currentLevel = this.state.executionPath[this.state.executionPath.length - 1];
         if (!currentLevel || currentLevel.type !== 'loop') return;

         const { loopItems, loopItemIndex, loopVarName, context: baseContext } = currentLevel;

         if (loopItemIndex < loopItems.length) {
             const currentItem = loopItems[loopItemIndex];
             // Update context for this iteration *within the loop level*
             currentLevel.context = { ...baseContext, [loopVarName]: currentItem };
             this.onContextUpdate(currentLevel.context); // Notify UI of change

             // Add iteration marker
             const iterResultIndex = this.onStepStart({ name: `Loop Iteration ${loopItemIndex + 1}/${loopItems.length}`, type: 'System', id: `${currentLevel.parentStepId}-iter-${loopItemIndex}` }, this._getCurrentPathArray());
             let itemPreview = JSON.stringify(currentItem);
             if (itemPreview.length > 100) itemPreview = itemPreview.substring(0, 100) + '...';
             this.onStepComplete(iterResultIndex, { name: `Loop Iteration ${loopItemIndex + 1}/${loopItems.length}`, type: 'System', id: `${currentLevel.parentStepId}-iter-${loopItemIndex}` }, { status: 'success', output: `{{${loopVarName}}} = ${itemPreview}`, error: null }, currentLevel.context, this._getCurrentPathArray());

         }
    }

     // Override _popExecutionLevel to handle loop iteration logic
    _popExecutionLevel() {
        if (this.state.executionPath.length === 0) return;

        const finishedLevel = this.state.executionPath[this.state.executionPath.length - 1];

        // If the level we just finished was the body of a loop iteration
        if (finishedLevel.type === 'loop') {
            // Check if there are more items to process
             finishedLevel.loopItemIndex++; // Move to next item
            if (finishedLevel.loopItemIndex < finishedLevel.loopItems.length) {
                // Reset index to start of loop body steps for next iteration
                finishedLevel.index = 0;
                this._prepareLoopIterationContext(); // Prepare context for the new iteration
                // DO NOT POP the level, just reset its index and update context
                return; // Stay at this level
            } else {
                // All items processed, add Loop End marker and *then* pop
                const endResultIndex = this.onStepStart({ name: `Loop End`, type: 'System', id: `${finishedLevel.parentStepId}-end` }, this._getCurrentPathArray());
                this.onStepComplete(endResultIndex, { name: `Loop End`, type: 'System', id: `${finishedLevel.parentStepId}-end` }, { status: 'success', output: `Finished loop.`, error: null }, finishedLevel.context, this._getCurrentPathArray());
                // Now proceed to pop
            }
        } else if (finishedLevel.type === 'then' || finishedLevel.type === 'else') {
             // Log finishing a branch?
             // this.onMessage(`Finished ${finishedLevel.type} branch.`, 'info');
        }

        // Default pop action
        this.state.executionPath.pop();
    }



     /** Updates the runtime context based on extraction rules */
    _updateContextFromExtraction(extractConfig, responseOutput, context) {
        if (!extractConfig || !responseOutput) return;
        const evaluatePath = this.evaluatePathFn || evaluatePathLocal; // Use passed function or local fallback

        for (const varName in extractConfig) {
            const path = extractConfig[varName];
            let extractedValue;
            try {
                // Special keywords
                if (path === 'status') {
                    extractedValue = responseOutput.status;
                } else if (path === 'headers') {
                     extractedValue = responseOutput.headers;
                } else if (path === 'body') {
                     extractedValue = responseOutput.body;
                } else {
                    // Use evaluatePath for body content or other structures
                     extractedValue = evaluatePath(responseOutput.body, path); // Assume path is relative to body by default? Or require 'body.' prefix? Let's require 'body.'
                     if (extractedValue === undefined && path.startsWith('body.')) {
                        extractedValue = evaluatePath(responseOutput, path); // Try from root if body path fails? Risky. Stick to body.
                     } else if (extractedValue === undefined && !path.startsWith('body.')) {
                         extractedValue = evaluatePath(responseOutput, path); // Try path from root if no 'body.' prefix
                     }
                }

                if (extractedValue !== undefined) {
                    context[varName] = extractedValue;
                    // console.log(`Extracted "${varName}" =`, extractedValue);
                } else {
                     this.onMessage(`Extraction warning: Path "${path}" for variable "${varName}" yielded undefined.`, 'warning');
                     context[varName] = undefined; // Explicitly set to undefined if not found
                }
            } catch (e) {
                this.onMessage(`Extraction error for "${varName}" path "${path}": ${e.message}`, 'error');
                 context[varName] = undefined; // Set undefined on error
            }
        }
         this.onContextUpdate(context); // Notify after all extractions for the step are done
    }

    async _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

}