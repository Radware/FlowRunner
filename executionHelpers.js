// ========== FILE: executionHelpers.js (Updated) ==========
import { evaluatePath } from './flowCore.js';
import { FlowRunner } from './flowRunner.js'; // <<< ADDED IMPORT
import { logger } from './logger.js';

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
        processedStepData.url = substituteVariables(originalUrl, context, { encode: encodeUrlVars });
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
                    substitutedHeaders[key] = substituteVariables(originalValue, context);
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
        if (step.type === 'request' && step.rawBodyWithMarkers !== undefined && step.rawBodyWithMarkers !== null) {
             // console.log(`[Sub Body ${step.id}] Attempting marker substitution for body using rawBodyWithMarkers:`, step.rawBodyWithMarkers);
             // Deep copy rawBodyWithMarkers before substitution to avoid modifying the original model
             const rawBodyCopy = JSON.parse(JSON.stringify(step.rawBodyWithMarkers));
             // Use the dedicated marker substitution function
             processedStepData.body = substituteBodyMarkersRecursive(rawBodyCopy);
             // console.log(`[Sub Body ${step.id}] Final substituted body (with potential placeholders):`, processedStepData.body);
             // console.log(`[Sub Body ${step.id}] Unquoted placeholders generated:`, unquotedPlaceholders);
        } else if (step.type === 'request' && step.body){
             // Fallback: If rawBodyWithMarkers is explicitly undefined (not just null),
             // perhaps try standard substitution on step.body as a legacy behavior? Risky.
             // Only do this if rawBodyWithMarkers is strictly undefined.
             if (step.rawBodyWithMarkers === undefined) {
                 console.warn(`[Sub Body ${step.id}] Step ${step.id}: rawBodyWithMarkers is missing. Body substitution using markers will be skipped. Attempting standard substitution on step.body as fallback.`);
                 processedStepData.body = substituteVariables(step.body, context); // Substitute standard vars just in case
                 // console.log(`[Sub Body ${step.id}] Result of standard substitution on step.body:`, processedStepData.body);
             } else {
                  // rawBodyWithMarkers exists but is null, so no body content intended.
                  // console.log(`[Sub Body ${step.id}] rawBodyWithMarkers is null, processed body remains null.`);
             }
        } else {
             // console.log(`[Sub Body ${step.id}] Not a request step or no body/rawBodyWithMarkers defined. Processed body remains null.`);
        }


        // 4. Substitute other fields using standard {{variable}} syntax
        if (processedStepData.type === 'condition' && step.conditionData?.value && typeof step.conditionData.value === 'string') {
            const originalCondValue = step.conditionData.value;
            // console.log(`[Sub Cond ${step.id}] Attempting standard substitution for condition value: "${originalCondValue}"`);
            processedStepData.conditionData = { ...step.conditionData, value: substituteVariables(originalCondValue, context) };
            // console.log(`[Sub Cond ${step.id}] Substituted condition value: "${processedStepData.conditionData.value}"`);
        }
        if (processedStepData.type === 'loop' && step.source && typeof step.source === 'string') {
             const originalLoopSource = step.source;
             // console.log(`[Sub Loop ${step.id}] Attempting standard substitution for loop source: "${originalLoopSource}"`);
             processedStepData.source = substituteVariables(originalLoopSource, context);
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
 * @return {string} String with variables replaced.
 */
export function substituteVariables(text, context, opts = {}) {
    if (typeof text !== 'string') return text; // Only process strings
    const encode = opts.encode === true;

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
                console.warn(`Unknown condition operator: ${operator}`);
                throw new Error(`Unknown condition operator: ${operator}`);
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
  return new FlowRunner(options);
}
// <<< END ADDED FUNCTION AND EXPORT >>>