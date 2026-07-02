// ========== FILE: executionHelpers.js (Updated) ==========
import { evaluatePath } from './flowCore.js';
import { FlowRunner } from './flowRunner.js'; // <<< ADDED IMPORT
import { logger } from './logger.js';
import { resolveSpecialVariable } from './utils.js';

// Helper function for escaping regex characters (needed for substituteVariablesInStep)
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Creates a processed version of the step data for execution, substituting variables.
 * Operates on the raw data containing ##VAR:type:name## markers for body/headers if applicable.
 * Handles string vs. unquoted substitution for markers.
 * Returns the processed step structure and a map of placeholders for unquoted values.
 * @param {Object} step - The original step object, MUST contain step.rawBodyWithMarkers if applicable.
 * @param {Object} context - The current execution context { varName: value }.
 * @return {{processedStep: Object, unquotedPlaceholders: Object}} Object containing the processed step and the map for unquoted placeholders.
 */
export function substituteVariablesInStep(step, context) {
    logger.info(`[Sub Step ${step.id}] Starting substitution for step "${step.name}"`, { originalStep: step, context });
    const unquotedPlaceholders = {}; // Map<placeholder, rawValue> - ONLY for body markers
    let placeholderCounter = 0;
    const uniquePrefix = `__FLOWRUNNER_UNQUOTED_${Date.now()}_`;

    // Recursive substitution function ONLY for data structures containing ##VAR...## BODY markers
    function substituteBodyMarkersRecursive(value) {
        if (typeof value === 'string') {
            const match = value.match(/^##VAR:(string|unquoted):([^#]+)##$/);
            if (match) {
                const [, type, name] = match;
                // console.log(`[Sub Body Marker ${step.id}] Found marker: "${value}", Type: ${type}, Name: ${name}`);
                // Use evaluateVariable (which uses evaluatePath) to get the value
                const evaluatedValue = evaluateVariable(`{{${name}}}`, context);
                // console.log(`[Sub Body Marker ${step.id}] Evaluated "{{${name}}}":`, evaluatedValue);

                if (evaluatedValue === undefined) {
                    // console.warn(`[Sub Body Marker ${step.id}] Substitution failed: Variable {{${name}}} not found in context for marker "${value}". Using null.`);
                    return null; // Return null if variable not found for marker
                }

                if (type === 'string') {
                    // console.log(`[Sub Body Marker ${step.id}] Returning string value:`, evaluatedValue);
                    return String(evaluatedValue); // Explicitly cast to string
                } else { // type === 'unquoted'
                    const placeholder = `${uniquePrefix}${placeholderCounter++}`;
                    unquotedPlaceholders[placeholder] = evaluatedValue; // Store raw value
                    // console.log(`[Sub Body Marker ${step.id}] Creating unquoted placeholder "${placeholder}" for value:`, evaluatedValue);
                    return placeholder; // Return placeholder string
                }
            }
            // If not a marker, return the string as is (no {{var}} substitution here)
            // console.log(`[Sub Body Marker ${step.id}] Returning non-marker string value: "${value}"`);
            return value;
        } else if (Array.isArray(value)) {
            // console.log(`[Sub Body Marker ${step.id}] Recursing into array...`);
            return value.map(item => substituteBodyMarkersRecursive(item));
        } else if (typeof value === 'object' && value !== null) {
            // console.log(`[Sub Body Marker ${step.id}] Recursing into object...`);
            const newObj = {};
            for (const key in value) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    newObj[key] = substituteBodyMarkersRecursive(value[key]);
                }
            }
            return newObj;
        }
        // console.log(`[Sub Body Marker ${step.id}] Returning non-string/array/object value:`, value);
        return value; // Return numbers, booleans, etc.
    } // --- End of substituteBodyMarkersRecursive ---

    // --- Start processing the step ---
    const processedStepData = { ...step }; // Shallow copy initially

    try {
        // 1. Substitute URL using standard {{variable}} syntax
        const originalUrl = step.url || '';
        // console.log(`[Sub URL ${step.id}] Attempting standard substitution for URL: "${originalUrl}"`);
        const encodeUrlVars = this instanceof FlowRunner ? this.encodeUrlVars : false;
        const runnerState = this instanceof FlowRunner ? this.state : null;
        processedStepData.url = substituteVariables(originalUrl, context, { encode: encodeUrlVars, runnerState });
        // console.log(`[Sub URL ${step.id}] Substituted URL: "${processedStepData.url}"`);


        // 2. Substitute Headers using standard {{variable}} syntax in values
        const originalHeaders = step.headers || {};
        let substitutedHeaders = {};
        // console.log(`[Sub Header ${step.id}] Attempting standard substitution for headers:`, originalHeaders);
        for (const key in originalHeaders) {
            if (Object.prototype.hasOwnProperty.call(originalHeaders, key)) {
                const originalValue = originalHeaders[key];
                // Substitute {{variables}} in the header *value* only
                if (typeof originalValue === 'string') {
                    // console.log(`[Sub Header ${step.id}] Substituting value for key "${key}": "${originalValue}"`);
                    substitutedHeaders[key] = substituteVariables(originalValue, context, { runnerState });
                    // console.log(`[Sub Header ${step.id}] Substituted value for key "${key}": "${substitutedHeaders[key]}"`);
                } else {
                    // console.log(`[Sub Header ${step.id}] Keeping non-string value for key "${key}":`, originalValue);
                    substitutedHeaders[key] = originalValue; // Keep non-strings as is
                }
            }
        }
        processedStepData.headers = substitutedHeaders;
        // console.log(`[Sub Header ${step.id}] Final substituted headers:`, processedStepData.headers);

        // 3. Substitute Body using ##VAR## markers via rawBodyWithMarkers
        processedStepData.body = null; // Initialize processed body
        if (step.type === 'request') {
            const hasRawMarkers = step.rawBodyWithMarkers !== undefined && step.rawBodyWithMarkers !== null;
            const hasBodyValue = step.body !== undefined && step.body !== null && String(step.body).trim() !== '';

            if (hasRawMarkers) {
                // console.log(`[Sub Body ${step.id}] Attempting marker substitution for body using rawBodyWithMarkers:`, step.rawBodyWithMarkers);
                // Deep copy rawBodyWithMarkers before substitution to avoid modifying the original model
                const rawBodyCopy = JSON.parse(JSON.stringify(step.rawBodyWithMarkers));
                // Use the dedicated marker substitution function
                processedStepData.body = substituteBodyMarkersRecursive(rawBodyCopy);
                // console.log(`[Sub Body ${step.id}] Final substituted body (with potential placeholders):`, processedStepData.body);
                // console.log(`[Sub Body ${step.id}] Unquoted placeholders generated:`, unquotedPlaceholders);
            } else if (hasBodyValue) {
                // Fallback: When markers are missing (undefined or null), use the textual body
                if (step.rawBodyWithMarkers === undefined) {
                    console.warn(`[Sub Body ${step.id}] Step ${step.id}: rawBodyWithMarkers is missing. Body substitution using markers will be skipped. Attempting standard substitution on step.body as fallback.`);
                }

                if (typeof step.body === 'string') {
                    // Perform standard substitution for string bodies
                    const substituted = substituteVariables(step.body, context);
                    // Try to preserve JSON semantics by parsing if possible
                    try {
                        processedStepData.body = JSON.parse(substituted);
                    } catch (parseErr) {
                        // If parsing fails, keep the substituted string
                        processedStepData.body = substituted;
                    }
                } else {
                    // Non-string body provided without markers; use as-is
                    processedStepData.body = step.body;
                }
            } else {
                // rawBodyWithMarkers is null/undefined and body is empty => no payload intended
                processedStepData.body = null;
            }
        }


        // 4. Substitute other fields using standard {{variable}} syntax
        if (processedStepData.type === 'condition' && step.conditionData?.value && typeof step.conditionData.value === 'string') {
            const originalCondValue = step.conditionData.value;
            // console.log(`[Sub Cond ${step.id}] Attempting standard substitution for condition value: "${originalCondValue}"`);
            processedStepData.conditionData = { ...step.conditionData, value: substituteVariables(originalCondValue, context, { runnerState }) };
            // console.log(`[Sub Cond ${step.id}] Substituted condition value: "${processedStepData.conditionData.value}"`);
        }
        if (processedStepData.type === 'loop' && step.source && typeof step.source === 'string') {
             const originalLoopSource = step.source;
             // console.log(`[Sub Loop ${step.id}] Attempting standard substitution for loop source: "${originalLoopSource}"`);
             processedStepData.source = substituteVariables(originalLoopSource, context, { runnerState });
             // console.log(`[Sub Loop ${step.id}] Substituted loop source: "${processedStepData.source}"`);
        }
        // Optionally substitute name - generally not needed for execution, but could be for logging
        // const originalName = step.name;
        // console.log(`[Sub Name ${step.id}] Attempting standard substitution for name: "${originalName}"`);
        // processedStepData.name = substituteVariables(originalName, context);
        // console.log(`[Sub Name ${step.id}] Substituted name: "${processedStepData.name}"`);


    } catch (error) {
        console.error(`[Sub Step ${step.id}] Error substituting variables in step ${step.id} (${step.name}):`, error);
        throw new Error(`Variable substitution failed for step ${step.id}: ${error.message}`);
    }

    // console.log(`[Sub Step ${step.id}] Substitution complete for step "${step.name}".`, { processedStep: processedStepData, unquotedPlaceholders });
    // Return the processed step data and the unquotedPlaceholders map (populated ONLY from body markers)
    return { processedStep: processedStepData, unquotedPlaceholders };
}


/**
 * Replace {{variable}} placeholders in a simple string. Handles nested {{}} if needed,
 * but primarily designed for top-level replacement.
 * @param {string} text - Input string.
 * @param {Object} context - Execution context.
 * @param {Object} opts - Options { encode: boolean, runnerState: Object }
 * @return {string} String with variables replaced.
 */
export function substituteVariables(text, context, opts = {}) {
    if (typeof text !== 'string') return text; // Only process strings
    const encode = opts.encode === true;
    const runnerState = opts.runnerState; // Access to runner state for special variables

    function safeEncode(value) {
        if (!encode) return value;
        if (/^https?:\/\//i.test(value)) {
            return value;
        }
        try {
            return encodeURIComponent(decodeURIComponent(value));
        } catch {
            return encodeURIComponent(value);
        }
    }

    // Regex to find {{variable.path}} placeholders
    return text.replace(/\{\{([^}]+)\}\}/g, (match, varRef) => {
        const trimmedRef = varRef.trim();
        
        const specialValue = resolveSpecialVariable(trimmedRef, runnerState);
        if (specialValue !== undefined) {
            return specialValue;
        }
        
        // Evaluate the variable reference (e.g., "variable.path")
        const evaluatedValue = evaluateVariable(match, context); // Pass the full {{var}}

        // If evaluation failed (undefined), return the original placeholder
        if (evaluatedValue === undefined) {
            // console.warn(`Substitution failed: Variable ${match} not found in context.`);
            return match;
        }

        // If value is object/array, stringify it for embedding in URL/header string etc.
        let stringValue;
        if (typeof evaluatedValue === 'object' && evaluatedValue !== null) {
            try {
                stringValue = JSON.stringify(evaluatedValue);
            } catch (e) {
                console.warn(`Substitution failed: Could not stringify object for ${match}.`, e);
                return match;
            }
        } else {
            stringValue = String(evaluatedValue);
        }

        return encode ? safeEncode(stringValue) : stringValue;
    });
}


/**
 * Evaluate a variable reference like {{varName}} or {{obj.path[0].value}} from context.
 * @param {string} varRefWithBraces - The variable reference string including braces (e.g., "{{var.path}}").
 * @param {Object} context - The current execution context.
 * @return {*} The evaluated value, or undefined if not found/error.
 */
export function evaluateVariable(varRefWithBraces, context) { // Keep this function in app.js
    if (!varRefWithBraces || typeof varRefWithBraces !== 'string') return undefined;

    const match = varRefWithBraces.match(/\{\{([^}]+)\}\}/);
    if (!match || !match[1]) return undefined;

    const path = match[1].trim();
    if (!path) return undefined;

    try {
        // *** CRITICAL CHANGE: Call the imported evaluatePath from flowCore ***
        return evaluatePath(context, path);
    } catch(e) {
        console.warn(`Error evaluating path "${path}" during substitution:`, e);
        return undefined; // Return undefined on evaluation error
    }
}

/**
 * Evaluate a structured condition using the current context.
 * @param {Object} conditionData - Structured condition { variable, operator, value }.
 * @param {Object} context - Execution context.
 * @return {boolean} Result of the condition evaluation.
 * @throws {Error} If evaluation fails.
 */
export function evaluateCondition(conditionData, context) {
    if (!conditionData) {
        throw new Error("Invalid condition: Condition data is missing.");
    }
    const { variable, operator, value: conditionValue } = conditionData;

    if (!variable) {
        throw new Error("Invalid condition data: Variable path is required.");
    }
    if (!operator) {
        throw new Error("Invalid condition data: Operator is required.");
    }

    const actualValue = evaluatePath(context, variable);
    const comparisonValue = conditionValue;

    try {
        switch (operator) {
            case 'equals': {
                if (actualValue === comparisonValue) return true;
                if (typeof actualValue !== 'object' && typeof comparisonValue !== 'object' && actualValue != null && comparisonValue != null) {
                    const numActual = Number(actualValue);
                    const numComparison = Number(comparisonValue);
                    if (!isNaN(numActual) && !isNaN(numComparison)) {
                        return numActual === numComparison;
                    }
                }
                return actualValue == comparisonValue;
            }
            case 'not_equals': {
                if (actualValue === comparisonValue) return false;
                if (typeof actualValue !== 'object' && typeof comparisonValue !== 'object' && actualValue != null && comparisonValue != null) {
                    const numActual = Number(actualValue);
                    const numComparison = Number(comparisonValue);
                    if (!isNaN(numActual) && !isNaN(numComparison)) {
                        return numActual !== numComparison;
                    }
                }
                return actualValue != comparisonValue;
            }
            case 'greater_than': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                return !isNaN(numActual) && !isNaN(numComparison) && numActual > numComparison;
            }
            case 'less_than': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                return !isNaN(numActual) && !isNaN(numComparison) && numActual < numComparison;
            }
            case 'greater_equals':
            case 'greater_than_or_equal': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                return !isNaN(numActual) && !isNaN(numComparison) && numActual >= numComparison;
            }
            case 'less_equals':
            case 'less_than_or_equal': {
                const numActual = Number(actualValue);
                const numComparison = Number(comparisonValue);
                return !isNaN(numActual) && !isNaN(numComparison) && numActual <= numComparison;
            }
            case 'contains': {
                const strActual = String(actualValue ?? '');
                const strComparison = String(comparisonValue ?? '');
                return strActual.includes(strComparison);
            }
            case 'not_contains': {
                const strActual = String(actualValue ?? '');
                const strComparison = String(comparisonValue ?? '');
                return !strActual.includes(strComparison);
            }
            case 'starts_with': {
                const strActual = String(actualValue ?? '');
                const strComparison = String(comparisonValue ?? '');
                return strActual.startsWith(strComparison);
            }
            case 'ends_with': {
                const strActual = String(actualValue ?? '');
                const strComparison = String(comparisonValue ?? '');
                return strActual.endsWith(strComparison);
            }
            case 'matches_regex': {
                try {
                    const strActual = String(actualValue ?? '');
                    const pattern = String(comparisonValue ?? '');
                    if (!pattern) return false;
                    const regexMatch = pattern.match(/^\/(.+)\/([gimyus]*)$/);
                    const finalPattern = regexMatch ? regexMatch[1] : pattern;
                    const flags = regexMatch ? regexMatch[2] : '';
                    return new RegExp(finalPattern, flags).test(strActual);
                } catch { return false; }
            }
            case 'not_matches_regex': {
                try {
                    const strActual = String(actualValue ?? '');
                    const pattern = String(comparisonValue ?? '');
                    if (!pattern) return true;
                    const regexMatch = pattern.match(/^\/(.+)\/([gimyus]*)$/);
                    const finalPattern = regexMatch ? regexMatch[1] : pattern;
                    const flags = regexMatch ? regexMatch[2] : '';
                    return !new RegExp(finalPattern, flags).test(strActual);
                } catch { return true; }
            }
            case 'exists':
                return actualValue !== undefined;
            case 'not_exists':
                return actualValue === undefined;
            case 'is_null':
                return actualValue === null;
            case 'is_not_null':
                return actualValue !== null && actualValue !== undefined;
            case 'is_empty':
                return actualValue === '' || actualValue === null || actualValue === undefined || (Array.isArray(actualValue) && actualValue.length === 0);
            case 'is_not_empty':
                return actualValue !== '' && actualValue !== null && actualValue !== undefined && (!Array.isArray(actualValue) || actualValue.length > 0);
            case 'is_number':
                return typeof actualValue === 'number' && !isNaN(actualValue);
            case 'is_text':
                return typeof actualValue === 'string';
            case 'is_boolean':
                return typeof actualValue === 'boolean';
            case 'is_array':
                return Array.isArray(actualValue);
            case 'is_object':
                return typeof actualValue === 'object' && actualValue !== null && !Array.isArray(actualValue);
            case 'is_true':
                return actualValue === true;
            case 'is_false':
                return actualValue === false;
            default:
                // Graceful degradation (tolerant reader): an unknown/newer condition
                // operator is treated as NOT MET and a machine-readable warning is
                // surfaced, instead of throwing (which would abort the whole run when a
                // newer file trips an older engine). KNOWN operators above are unchanged.
                console.warn(`[executionHelpers] CONDITION_OPERATOR_UNSUPPORTED operator=${JSON.stringify(operator)} - condition treated as false (not met), run continues.`);
                return false;
        }
    } catch (evalError) {
        console.error(`Error during condition evaluation (Operator: ${operator}, Variable Path: ${variable}):`, evalError);
        throw new Error(`Condition evaluation failed for operator \"${operator}\": ${evalError.message}`);
    }
}

// <<< ADDED FUNCTION AND EXPORT >>>
/**
 * Factory function to create a new FlowRunner instance.
 * @param {Object} options - Options to pass to the FlowRunner constructor.
 * @returns {FlowRunner} A new instance of FlowRunner.
 */
export function createFlowRunner(options) {
  // === WAVE3 assertions ===
  // Default the assertion evaluator here (executionHelpers already imports
  // FlowRunner, so wiring it from this side avoids a flowRunner→executionHelpers
  // import cycle). Callers may still override via options.
  const withDefaults = {
    evaluateAssertionsFn: evaluateAssertions,
    ...options,
  };
  return new FlowRunner(withDefaults);
  // === END WAVE3 assertions ===
}
// <<< END ADDED FUNCTION AND EXPORT >>>


// === WAVE3 assertions ===
// Per-step assertions. ADDITIVE optional `step.assertions` = an array of
// { target, operator, value, critical? }. Evaluated against a step's result by
// REUSING evaluateCondition (the frozen conditionData operator vocabulary) and
// evaluatePath. Targets: `status`, `duration`, `headers.<name>`, `body.<path>`.
//
// Cross-app: flowrunner-cli (Python) must evaluate these with the same operator
// set (handled by the cross-repo-cli lane). Until then an older CLI IGNORES the
// field (additive, extra='ignore') — safe. Assertions NEVER change request
// execution; they only report pass/fail. A failed *critical* assertion is
// surfaced (summary.criticalFailed) so the runner can optionally stop; a plain
// failed assertion is non-blocking by default.

/**
 * Build the subject object that assertion targets are evaluated against.
 * Mirrors the request `output` shape ({ status, headers, body }) plus `duration`
 * so a target like `body.items[0].id` resolves through the same evaluatePath
 * used for extraction and conditions.
 * @param {Object|null} output - The request step output ({ status, headers, body }).
 * @param {number} [durationMs] - Measured request duration in milliseconds.
 * @return {{status:*, headers:Object, body:*, duration:number|undefined}}
 */
export function buildAssertionSubject(output, durationMs) {
    const safeOutput = (output && typeof output === 'object') ? output : {};
    return {
        status: safeOutput.status,
        headers: (safeOutput.headers && typeof safeOutput.headers === 'object') ? safeOutput.headers : {},
        body: safeOutput.body !== undefined ? safeOutput.body : null,
        duration: durationMs,
    };
}

/**
 * Resolve an assertion `target` to the { subject, path } pair that evaluatePath
 * (and therefore evaluateCondition) resolves UNAMBIGUOUSLY.
 *
 * evaluatePath has body-aware semantics: a prefix-less path (e.g. `status`) is
 * looked up INSIDE `data.body` when a `body` key exists. The full assertion
 * subject always carries a `body` key, so bare top-level targets like `status`
 * and `duration` would wrongly dive into the body. We therefore evaluate those
 * against a body-less mini-subject where a prefix-less path resolves at the top
 * level. `headers.*` and `body.*` carry explicit prefixes evaluatePath handles
 * directly, so they use the full subject unchanged.
 * @param {string} target - assertion target string.
 * @param {Object} fullSubject - buildAssertionSubject output.
 * @return {{subject: Object, path: string}}
 */
function resolveAssertionTarget(target, fullSubject) {
    if (target === 'status') {
        return { subject: { status: fullSubject.status, duration: fullSubject.duration }, path: 'status' };
    }
    if (target === 'duration') {
        return { subject: { status: fullSubject.status, duration: fullSubject.duration }, path: 'duration' };
    }
    // headers.* and body.* (and any explicit-prefixed path) evaluate against the
    // full subject; evaluatePath's prefix branches resolve them correctly.
    return { subject: fullSubject, path: target };
}

/**
 * Human-readable one-line label for an assertion (used by the test-summary UI).
 * Pure string building — no evaluation.
 */
function assertionLabel(target, operator, value) {
    const op = String(operator || '').replace(/_/g, ' ');
    let val = value;
    try {
        val = typeof value === 'object' ? JSON.stringify(value) : String(value);
    } catch { val = String(value); }
    return `${target} ${op} ${val}`.trim();
}

/**
 * Evaluate a step's assertions against its result.
 * Pure and side-effect free — does NOT mutate the step or the result.
 * @param {Array} assertions - step.assertions (may be undefined/malformed — tolerated).
 * @param {Object|null} output - The step's request output ({ status, headers, body }).
 * @param {number} [durationMs] - Measured request duration in ms (for `duration` target).
 * @return {{total:number, passed:number, failed:number, allPassed:boolean,
 *           criticalFailed:boolean, results:Array}} Test summary.
 */
export function evaluateAssertions(assertions, output, durationMs) {
    const summary = {
        total: 0,
        passed: 0,
        failed: 0,
        allPassed: true,
        criticalFailed: false,
        results: [],
    };

    if (!Array.isArray(assertions) || assertions.length === 0) {
        return summary;
    }

    const subject = buildAssertionSubject(output, durationMs);

    for (const assertion of assertions) {
        // Tolerate malformed entries (null, primitives, missing target/operator).
        if (!assertion || typeof assertion !== 'object') continue;
        const target = typeof assertion.target === 'string' ? assertion.target.trim() : '';
        const operator = typeof assertion.operator === 'string' ? assertion.operator.trim() : '';
        if (!target || !operator) continue;

        summary.total++;

        const { subject: targetSubject, path: targetPath } = resolveAssertionTarget(target, subject);

        // Resolve the actual value the assertion targets, for reporting.
        let actual;
        try {
            actual = evaluatePath(targetSubject, targetPath);
        } catch {
            actual = undefined;
        }

        // Reuse the frozen conditionData operator vocabulary. evaluateCondition
        // itself uses evaluatePath against the subject, so `status`, `duration`,
        // `headers.X`, `body.path` all resolve consistently. Unknown/newer
        // operators degrade to `false` (not-met) inside evaluateCondition rather
        // than throwing — a failed assertion, never an aborted run.
        let passed = false;
        try {
            passed = evaluateCondition(
                { variable: targetPath, operator, value: assertion.value },
                targetSubject
            );
        } catch (err) {
            // evaluateCondition can throw on a genuine evaluation error (e.g. a
            // broken regex path). Treat as a failed assertion, never rethrow.
            logger.warn(`[assertions] evaluation error for "${assertionLabel(target, operator, assertion.value)}": ${err?.message}`);
            passed = false;
        }

        const critical = assertion.critical === true;
        if (passed) {
            summary.passed++;
        } else {
            summary.failed++;
            summary.allPassed = false;
            if (critical) summary.criticalFailed = true;
        }

        summary.results.push({
            target,
            operator,
            value: assertion.value,
            critical,
            actual,
            passed,
            label: assertionLabel(target, operator, assertion.value),
        });
    }

    return summary;
}
// === END WAVE3 assertions ===
