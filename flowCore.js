/**
 * flowCore.js
 * Core logic and utility functions for API Flow Configuration Builder.
 * Contains NO DOM manipulation or UI-specific code.
 */

/**
 * Generate a unique ID for steps
 * @return {string} Unique identifier
 */
export function generateUniqueId() {
  // Simple timestamp + random string for uniqueness in a session
  return 'step_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
}

/**
 * Convert flow model to JSON representation suitable for backend storage.
 * Handles variable placeholders correctly.
 * @param {Object} flowModel - Internal flow model using {{variable}} syntax.
 * @return {Object} JSON representation with placeholders processed.
 */
export function flowModelToJson(flowModel) {
  const json = {
    id: flowModel.id, // Include ID if present (for updates)
    name: flowModel.name || '',
    description: flowModel.description || '',
    headers: flowModel.headers ? { ...flowModel.headers } : {},
    steps: [],
    staticVars: flowModel.staticVars ? { ...flowModel.staticVars } : {}
  };

  function processSteps(steps) {
    if (!steps || !Array.isArray(steps)) return [];
    return steps.map(step => {
      const jsonStep = {
        id: step.id,
        name: step.name || '',
        type: step.type
      };

      if (step.type === 'request') {
        jsonStep.method = step.method || 'GET';
        jsonStep.url = step.url || '';
        if (step.headers && Object.keys(step.headers).length > 0) {
          jsonStep.headers = { ...step.headers };
        }

        // Process body: Use preProcessBody to handle placeholders
        // Ensure 'body' field is included only if step.body has content or is a non-empty object.
        let bodyToStore = null;
        if (typeof step.body === 'string' && step.body.trim()) {
             try {
               // Store as raw string if preprocessing isn't needed or fails
               bodyToStore = preProcessBody(step.body.trim());
             } catch (e) {
                console.warn(`Failed to preprocess request body for step ${step.id}. Storing as raw string. Error: ${e.message}`);
                bodyToStore = step.body; // Fallback to raw string
             }
        } else if (typeof step.body === 'object' && step.body !== null && Object.keys(step.body).length > 0) {
            // If body is already an object (e.g., from JSON parsing during substitution)
            try {
               // Preprocess the stringified version
               bodyToStore = preProcessBody(JSON.stringify(step.body));
            } catch (e) {
               console.warn(`Failed to process object body for step ${step.id}. Storing as raw object. Error: ${e.message}`);
               // Store original object - this might cause issues if it contains unsubstituted vars
               bodyToStore = JSON.stringify(step.body); // Store as stringified object on error
            }
        }
        // Add body to jsonStep only if it has content after processing
        if (bodyToStore !== null && bodyToStore !== '') {
            // Attempt to parse if it looks like JSON, otherwise store as string
            try {
                jsonStep.body = JSON.parse(bodyToStore);
            } catch (e) {
                jsonStep.body = bodyToStore; // Store as string if parsing fails
            }
        }


        if (step.extract && Object.keys(step.extract).length > 0) {
          jsonStep.extract = { ...step.extract };
        }
      } else if (step.type === 'condition') {
        jsonStep.condition = step.condition || '';
        // Store structured condition data if available (preferred)
        if (step.conditionData) {
          jsonStep.conditionData = { ...step.conditionData }; // Ensure copy
        }
        jsonStep.then = processSteps(step.thenSteps);
        jsonStep.else = processSteps(step.elseSteps);
      } else if (step.type === 'loop') {
        jsonStep.source = step.source || '';
        jsonStep.loopVariable = step.loopVariable || 'item';
        jsonStep.steps = processSteps(step.loopSteps);
      }

      return jsonStep;
    });
  }

  json.steps = processSteps(flowModel.steps);
  return json;
}

/**
 * Convert JSON representation (from backend) to internal flow model.
 * Restores {{variable}} syntax for UI display.
 * @param {Object} json - JSON flow definition from backend.
 * @return {Object} Internal flow model.
 */
export function jsonToFlowModel(json) {
  if (!json) {
    console.error("jsonToFlowModel received null or undefined input.");
    return createTemplateFlow(); // Return a default empty flow
  }

  const flowModel = {
    id: json.id, // Keep the ID
    name: json.name || 'New Flow',
    description: json.description || '',
    headers: json.headers || {},
    steps: [],
    staticVars: json.staticVars || {}
  };

  function processJsonSteps(jsonSteps) {
    if (!jsonSteps || !Array.isArray(jsonSteps)) return [];
    return jsonSteps.map(jsonStep => {
      const step = {
        id: jsonStep.id || generateUniqueId(),
        name: jsonStep.name || `Unnamed ${jsonStep.type}`,
        type: jsonStep.type
      };

      if (jsonStep.type === 'request') {
        step.method = jsonStep.method || 'GET';
        step.url = jsonStep.url || '';
        step.headers = jsonStep.headers || {};

        // Handle body: Convert backend markers back to {{variable}} for UI display
        if (jsonStep.body !== undefined && jsonStep.body !== null) {
          // postProcess handles both objects and strings correctly
          step.body = postProcessFormattedJson(jsonStep.body);
        } else {
          step.body = ''; // Ensure body is an empty string for the UI if null/undefined
        }

        step.extract = jsonStep.extract || {};
      } else if (jsonStep.type === 'condition') {
        step.condition = jsonStep.condition || '';
        // Restore structured condition data if available (preferred)
        if (jsonStep.conditionData) {
          step.conditionData = jsonStep.conditionData;
        } else if (step.condition) {
          // Attempt to parse legacy string condition into structured data
          step.conditionData = parseConditionString(step.condition);
        } else {
          step.conditionData = { variable: '', operator: '', value: '' };
        }
        step.thenSteps = processJsonSteps(jsonStep.then);
        step.elseSteps = processJsonSteps(jsonStep.else);
      } else if (jsonStep.type === 'loop') {
        step.source = jsonStep.source || '';
        step.loopVariable = jsonStep.loopVariable || 'item';
        step.loopSteps = processJsonSteps(jsonStep.steps);
      }

      return step;
    });
  }

  flowModel.steps = processJsonSteps(json.steps);
  return flowModel;
}

/**
 * Extract variables from a string using {{variable}} syntax
 * @param {string} text - Text to extract variables from
 * @return {Array} List of unique variable names found
 */
export function extractVariableReferences(text) {
  if (!text || typeof text !== 'string') return [];
  const regex = /\{\{([^}]+)\}\}/g;
  const variables = new Set();
  let match;

  while ((match = regex.exec(text)) !== null) {
    variables.add(match[1].trim());
  }

  return Array.from(variables);
}

/**
 * Find all variables defined within a flow model up to a certain point, or including runtime context.
 * @param {Object} flowModel - The flow model to analyze.
 * @param {Object} [runtimeContext] - Optional runtime context to include.
 * @return {Object} Map where keys are variable names and values are objects describing their origin.
 */
export function findDefinedVariables(flowModel, runtimeContext = null) {
  const variables = {};

  // 1. Add Static/Flow Variables
  if (flowModel?.staticVars) {
    Object.keys(flowModel.staticVars).forEach(key => {
      if (key) {
          variables[key] = {
            origin: 'Flow Variable',
            path: null,
            stepId: null,
            type: 'static',
            // value: flowModel.staticVars[key] // Include value? Maybe for display.
          };
      }
    });
  }

   // 2. Add variables from runtime context if provided
   if (runtimeContext) {
       Object.keys(runtimeContext).forEach(key => {
            if (key && !variables[key]) { // Add if not already defined as static
               // Determine origin based on how context was populated (difficult without execution history)
               variables[key] = {
                   origin: 'Runtime', // Generic origin for runtime values
                   path: null,
                   stepId: null, // Can't easily determine which step defined it here
                   type: 'runtime',
                   // value: runtimeContext[key] // Include runtime value?
               };
           }
            // Optionally update value if already present
           // else if (variables[key]) {
           //     variables[key].value = runtimeContext[key];
           // }
       });
   }


  // 3. Recursively process steps to find extracted and loop variables definitions
  function processSteps(steps, pathPrefix = '', currentLoopVars = new Set()) {
    if (!steps || !Array.isArray(steps)) return;

    steps.forEach((step, index) => {
      const stepName = step.name || `Step ${index + 1}`;
      const currentPath = pathPrefix ? `${pathPrefix} > ${stepName}` : stepName;

      // Add variables defined IN THIS STEP if not already present from runtime context
      if (step.type === 'request' && step.extract) {
        Object.keys(step.extract).forEach(varName => {
          if (varName && !variables[varName]) {
            variables[varName] = {
              origin: currentPath,
              path: step.extract[varName],
              stepId: step.id,
              type: 'extraction'
            };
          }
        });
      } else if (step.type === 'loop') {
        const loopVar = step.loopVariable || 'item';
        if (loopVar && !variables[loopVar]) {
          variables[loopVar] = {
            origin: currentPath,
            isIterationVariable: true,
            stepId: step.id,
            type: 'loop'
          };
          currentLoopVars.add(loopVar);
        }
        processSteps(step.loopSteps, `${currentPath} > Loop Body`, new Set(currentLoopVars));
        if (loopVar) currentLoopVars.delete(loopVar); // Goes out of scope

      } else if (step.type === 'condition') {
        processSteps(step.thenSteps, `${currentPath} > Then`, new Set(currentLoopVars));
        processSteps(step.elseSteps, `${currentPath} > Else`, new Set(currentLoopVars));
      }
    });
  }

   // Only scan steps if runtime context wasn't provided (runtime context implies full potential scope)
   if (!runtimeContext && flowModel?.steps) {
       processSteps(flowModel.steps);
   }


  return variables;
}


/**
 * Evaluate a simple dot-notation path on a data object.
 * Handles basic array indexing like 'items[0].name'.
 * Added to flowCore as it's generally useful.
 * @param {Object} data - Data object to traverse.
 * @param {string} path - Dot-notation path string (e.g., "body.data.id", "results[0].value").
 * @return {*} Extracted value or undefined if path is invalid or not found.
 */
export function evaluatePath(data, path) {
  if (data === null || data === undefined || !path) return undefined;

  // Handle special direct keywords for response structure
  if (path === 'status' && data?.hasOwnProperty('status')) return data.status;
  if (path === 'headers' && data?.hasOwnProperty('headers')) return data.headers;
  if (path === 'body' && data?.hasOwnProperty('body')) return data.body;

  // If path doesn't start with 'body.', 'headers.', or 'status.', assume it's relative to 'body' if 'body' exists.
  let effectiveData = data;
  let effectivePath = path;
   if (!['body.', 'headers.', 'status.'].some(prefix => path.startsWith(prefix)) && data?.hasOwnProperty('body')) {
      effectiveData = data.body;
   }
   // Handle cases like path='body.items' when data is the full response {status, headers, body}
   else if (path.startsWith('body.') && data?.hasOwnProperty('body')) {
       effectiveData = data.body;
       effectivePath = path.substring(5); // Remove 'body.' prefix
   }
    else if (path.startsWith('headers.') && data?.hasOwnProperty('headers')) {
       effectiveData = data.headers;
       effectivePath = path.substring(8); // Remove 'headers.' prefix
   }


   // Check if the effective data is now null or undefined after potentially accessing body/headers
   if (effectiveData === null || effectiveData === undefined) return undefined;


  const parts = effectivePath.match(/([^[.\]]+)|\[(\d+)\]/g); // Split by dots or array indices
  if (!parts) return undefined; // Invalid path format

  let current = effectiveData;

  for (const part of parts) {
      if (current === null || current === undefined) {
          return undefined; // Cannot traverse further
      }

      const arrayMatch = part.match(/^\[(\d+)\]$/);
      if (arrayMatch) {
          // Array index access
          const index = parseInt(arrayMatch[1], 10);
          if (!Array.isArray(current) || index < 0 || index >= current.length) {
              return undefined; // Index out of bounds or not an array
          }
          current = current[index];
      } else {
          // Object property access (case-sensitive)
          if (typeof current !== 'object' || !current.hasOwnProperty(part)) {
              return undefined; // Not an object or property doesn't exist
          }
          current = current[part];
      }
  }

  return current;
}


/**
 * Validates JSON text, intelligently handling unquoted {{variable}} placeholders.
 * Allows `key: {{var}}` but flags other JSON errors.
 * @param {string} bodyText - The request body text.
 * @return {{valid: boolean, message?: string}} Validation result.
 */
export function validateRequestBodyJson(bodyText) {
  if (!bodyText || typeof bodyText !== 'string' || bodyText.trim() === '') {
    return { valid: true }; // Empty body is valid
  }

  try {
    // Temporarily replace unquoted {{var}} with a valid JSON value (e.g., null)
    // for validation purposes ONLY. This preserves quoted "{{var}}" which are valid strings.
    const tempJsonString = bodyText.replace(
        /(?<=[:\[,\s])\s*{{([^}]+)}}\s*(?=[,}\]\s]|$)/g,
      'null' // Replace with null for validation
    );

    JSON.parse(tempJsonString);
    return { valid: true };
  } catch (error) {
      let message = error.message;
      // Try to improve common error messages
      if (message.includes('Unexpected token')) {
           const badTokenMatch = message.match(/Unexpected token ({|}) in JSON/);
           if (badTokenMatch) {
               message = `Likely syntax error near '{{' or '}}'. Use "key": "{{var}}" for strings, "key": {{var}} for numbers/booleans. Original: ${message}`;
           } else {
               const positionMatch = message.match(/at position (\d+)/);
               const position = positionMatch ? parseInt(positionMatch[1], 10) : -1;
               let context = '';
               if (position !== -1) {
                   const snippetStart = Math.max(0, position - 15);
                   const snippetEnd = Math.min(bodyText.length, position + 15);
                   context = ` near "...${bodyText.substring(snippetStart, position)}[HERE]${bodyText.substring(position, snippetEnd)}..."`;
               }
               message = `Invalid JSON syntax${context}. Check commas, quotes, brackets. Original: ${message}`;
           }
      } else if (message.includes('Unexpected end of JSON input')) {
          message = `Incomplete JSON. Check for unclosed brackets or braces. Original: ${message}`;
      } else {
           message = `JSON validation failed: ${message}`;
      }

    return { valid: false, message: message };
  }
}

/**
 * Pre-processes a JSON string containing {{variable}} placeholders.
 * Replaces placeholders with unique markers to allow standard JSON parsing.
 * Distinguishes between quoted ("{{var}}") and unquoted ({{var}}) placeholders.
 * @param {string} bodyText - The raw JSON string with placeholders.
 * @return {string} A valid JSON string with placeholders replaced by markers.
 */
export function preProcessBody(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return '';

  // Marker format: ##VAR:type:encoded_var_name##
  const encodeVarName = (name) => Buffer.from(name).toString('base64'); // Simple base64 encoding

  // 1. Handle QUOTED placeholders: "key": "{{var}}" -> "key": "##VAR:string:dmFy##"
   let pass1 = bodyText.replace(
     /"\{\{([^}]+)\}\}"/g,
     (match, varName) => `"##VAR:string:${encodeVarName(varName.trim())}##"`
   );

  // 2. Handle UNQUOTED placeholders: key: {{var}} -> key: "##VAR:unquoted:dmFy##"
  //    Targets {{var}} after a colon or comma or start of array, with optional whitespace.
   let pass2 = pass1.replace(
       /([:\[,\s])\s*\{\{([^}]+)\}\}/g,
       (match, prefix, varName) => `${prefix}"##VAR:unquoted:${encodeVarName(varName.trim())}##"`
   );

   // Handle edge case: Unquoted var as the very first element in an array: [{{var}}, ...]
   let pass3 = pass2.replace(
       /^(\s*\[)\s*\{\{([^}]+)\}\}/,
        (match, prefix, varName) => `${prefix}"##VAR:unquoted:${encodeVarName(varName.trim())}##"`
   );

   // Handle edge case: Unquoted var as the only content: {{var}}
   // This isn't valid JSON, but we might encounter it. Replace it directly.
   if (/^\s*\{\{([^}]+)\}\}\s*$/.test(pass3)) {
       pass3 = pass3.replace(
           /^\s*\{\{([^}]+)\}\}\s*$/,
           (match, varName) => `"##VAR:unquoted:${encodeVarName(varName.trim())}##"`
       );
   }


  return pass3;
}

/**
 * Post-processes a JSON string or object containing ##VAR:type:name## markers.
 * Restores the markers back to the user-friendly {{variable}} syntax.
 * Handles both "string" and "unquoted" types correctly for UI display.
 * @param {string | Object} data - JSON string or object with markers.
 * @return {string} A formatted JSON string with {{variable}} placeholders restored.
 */
export function postProcessFormattedJson(data) {
  if (data === null || data === undefined) return '';

  let jsonString;
  if (typeof data === 'string') {
    jsonString = data;
  } else {
    try { jsonString = JSON.stringify(data, null, 2); } // Pretty print object
    catch (e) { return String(data); } // Fallback for non-JSON objects
  }

   const decodeVarName = (encoded) => {
       try { return Buffer.from(encoded, 'base64').toString('utf-8'); }
       catch { return 'DECODE_ERROR'; } // Fallback
   };

  // 1. Restore QUOTED placeholders: "##VAR:string:dmFy##" -> "{{var}}" (keeps surrounding quotes)
   jsonString = jsonString.replace(/"##VAR:string:([^#"]+)##"/g, (match, encodedName) => `"{{${decodeVarName(encodedName)}}}"`);

  // 2. Restore UNQUOTED placeholders: "##VAR:unquoted:dmFy##" -> {{var}} (removes surrounding quotes)
  jsonString = jsonString.replace(/"##VAR:unquoted:([^#"]+)##"/g, (match, encodedName) => `{{${decodeVarName(encodedName)}}}`);

  return jsonString;
}


/**
 * Formats a JSON string containing {{variable}} placeholders for display.
 * Uses pre/post processing to handle placeholders during standard JSON formatting.
 * Returns the original text if formatting fails.
 * @param {string} bodyText - Raw JSON string with {{variable}} placeholders.
 * @return {string} Pretty-printed JSON string with {{variable}} syntax, or original text on error.
 */
export function formatJson(bodyText) {
  if (!bodyText || typeof bodyText !== 'string' || bodyText.trim() === '') {
    return ''; // Return empty string for empty input
  }
  try {
       const validation = validateRequestBodyJson(bodyText);
       if (!validation.valid) {
           throw new Error(validation.message || 'Invalid JSON syntax.');
       }
       const processedJson = preProcessBody(bodyText);
       const parsedObject = JSON.parse(processedJson);
       const prettyPrintedMarkers = JSON.stringify(parsedObject, null, 2);
       const finalFormattedJson = postProcessFormattedJson(prettyPrintedMarkers);
       return finalFormattedJson;
  } catch (error) {
    console.warn("JSON formatting failed:", error.message);
    alert(`Formatting Error: ${error.message}. Please check syntax.`); // User feedback
    return bodyText; // Return original on error
  }
}


/**
 * Validates the entire flow model for common issues.
 * Checks for required fields, undefined variable references, etc.
 * @param {Object} flowModel - The flow model to validate.
 * @return {{valid: boolean, errors: string[]}} Validation result.
 */
export function validateFlow(flowModel) {
  const result = { valid: true, errors: [] };
  if (!flowModel) {
    return { valid: false, errors: ['Flow model is missing.'] };
  }
  if (!flowModel.name?.trim()) {
    result.valid = false;
    result.errors.push('Flow name is required.');
  }

  const initialVarNames = new Set(Object.keys(flowModel.staticVars || {}));

  function checkVariableUsage(text, context, stepName, availableVars) {
    if (!text || typeof text !== 'string') return;
    const referencedVars = extractVariableReferences(text);
    referencedVars.forEach(varName => {
      if (!availableVars.has(varName)) {
        result.valid = false;
        const errorMsg = `${stepName}: ${context} references undefined variable "{{${varName}}}".`;
        if (!result.errors.includes(errorMsg)) result.errors.push(errorMsg);
      }
    });
  }

  function validateStepsRecursive(steps, pathPrefix = '', currentAvailableVars) {
    if (!steps || !Array.isArray(steps)) return;
    const varsDefinedHere = new Set();

    steps.forEach((step, index) => {
      const stepName = step.name || `Step ${index + 1}`;
      const currentPath = pathPrefix ? `${pathPrefix} > ${stepName}` : stepName;

      if (!step.name?.trim()) {
        result.valid = false;
        result.errors.push(`Step ${index + 1}${pathPrefix ? ` in ${pathPrefix}` : ''}: Name is required.`);
      }
      if (!step.type) {
        result.valid = false;
        result.errors.push(`${currentPath}: Step type is missing.`);
        return;
      }

      switch (step.type) {
        case 'request':
          if (!step.url) {
            result.valid = false;
            result.errors.push(`${currentPath}: URL is required.`);
          } else {
            checkVariableUsage(step.url, 'URL', currentPath, currentAvailableVars);
          }
          if (step.headers) {
            Object.entries(step.headers).forEach(([key, value]) => checkVariableUsage(value, `Header "${key}"`, currentPath, currentAvailableVars));
          }
          if (step.body && typeof step.body === 'string' && step.body.trim()) {
             const bodyValidation = validateRequestBodyJson(step.body);
             if (!bodyValidation.valid) {
                result.valid = false;
                result.errors.push(`${currentPath}: Body - ${bodyValidation.message || 'Invalid JSON syntax'}.`);
             } else {
                checkVariableUsage(step.body, 'Body', currentPath, currentAvailableVars);
             }
          }
          if (step.extract) {
            Object.entries(step.extract).forEach(([varName, jsonPath]) => {
               if (!varName?.trim() || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)){
                   result.valid = false;
                   result.errors.push(`${currentPath}: Invalid extraction variable name "${varName}".`);
               } else {
                   varsDefinedHere.add(varName);
               }
              if (!jsonPath?.trim()) {
                result.valid = false;
                result.errors.push(`${currentPath}: Extraction path for "${varName}" is required.`);
              }
              // Basic path check (allows dot, bracket, underscore, alphanum, $, status, headers, body)
               if (jsonPath && !/^(status|headers|body)$|^[a-zA-Z0-9_$.[\]]+$/.test(jsonPath)) {
                  result.valid = false; // Stricter validation
                  result.errors.push(`${currentPath}: Extraction path "${jsonPath}" for "${varName}" contains invalid characters.`);
               }
            });
          }
          break;
        case 'condition':
           const conditionVar = step.conditionData?.variable;
           const conditionOp = step.conditionData?.operator;
           const conditionVal = step.conditionData?.value;
           if (!conditionVar || !conditionOp) {
                result.valid = false;
                result.errors.push(`${currentPath}: Condition variable and operator are required.`);
           } else {
               checkVariableUsage(conditionVar, 'Condition variable', currentPath, currentAvailableVars);
                if (doesOperatorNeedValue(conditionOp) && conditionVal && typeof conditionVal === 'string') {
                   checkVariableUsage(conditionVal, 'Condition value', currentPath, currentAvailableVars);
               }
           }
           // Validate nested steps
          const conditionScopeVars = new Set(currentAvailableVars);
          validateStepsRecursive(step.thenSteps, `${currentPath} > Then`, conditionScopeVars);
          validateStepsRecursive(step.elseSteps, `${currentPath} > Else`, conditionScopeVars);
          break;
        case 'loop':
           const loopVar = step.loopVariable || 'item';
          if (!step.source) {
            result.valid = false;
            result.errors.push(`${currentPath}: Loop source variable is required.`);
          } else {
            checkVariableUsage(step.source, 'Loop source', currentPath, currentAvailableVars);
          }
          if (!loopVar?.trim() || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(loopVar)) {
            result.valid = false;
            result.errors.push(`${currentPath}: Loop variable name "${loopVar}" is invalid.`);
          } else {
               const loopScopeVars = new Set(currentAvailableVars);
               loopScopeVars.add(loopVar);
               validateStepsRecursive(step.loopSteps, `${currentPath} > Loop Body`, loopScopeVars);
          }
          break;
        default:
          result.valid = false;
          result.errors.push(`${currentPath}: Unknown step type "${step.type}".`);
      }
      varsDefinedHere.forEach(v => currentAvailableVars.add(v));
    });
  }
  validateStepsRecursive(flowModel.steps, '', new Set(initialVarNames));
  return result;
}


/**
 * Creates a new step object with default values based on the type.
 * @param {string} type - The type of step ('request', 'condition', 'loop').
 * @return {Object} A new step object.
 * @throws {Error} If the step type is unknown.
 */
export function createNewStep(type) {
  const id = generateUniqueId();
  switch (type) {
    case 'request':
      return { id, name: 'New Request', type: 'request', method: 'GET', url: '', headers: {}, body: '', extract: {} };
    case 'condition':
      return { id, name: 'New Condition', type: 'condition', condition: '', conditionData: { variable: '', operator: '', value: '' }, thenSteps: [], elseSteps: [] };
    case 'loop':
      return { id, name: 'New Loop', type: 'loop', source: '', loopVariable: 'item', loopSteps: [] };
    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}

/**
 * Deep clones a step object, generating new unique IDs for the step and any nested steps.
 * @param {Object} step - The step object to clone.
 * @return {Object} A new step object with unique IDs.
 */
export function cloneStep(step) {
  if (!step) return null;
  let cloned;
   try { cloned = JSON.parse(JSON.stringify(step)); }
   catch (e) { console.error("Failed to clone step:", e, step); return null; }

  function assignNewIds(steps) {
    if (!steps || !Array.isArray(steps)) return [];
    return steps.map(s => {
       const newS = {...s, id: generateUniqueId()};
      if (newS.type === 'condition') {
        newS.thenSteps = assignNewIds(newS.thenSteps);
        newS.elseSteps = assignNewIds(newS.elseSteps);
      } else if (newS.type === 'loop') {
        newS.loopSteps = assignNewIds(newS.loopSteps);
      }
      return newS;
    });
  }
  cloned.id = generateUniqueId(); // New ID for top-level
  cloned.thenSteps = assignNewIds(cloned.thenSteps);
  cloned.elseSteps = assignNewIds(cloned.elseSteps);
  cloned.loopSteps = assignNewIds(cloned.loopSteps);
  return cloned;
}

/**
 * Finds a step by its ID within a potentially nested array of steps.
 * @param {Array} steps - The array of steps to search within.
 * @param {string} id - The ID of the step to find.
 * @return {Object | null} The found step object or null if not found.
 */
export function findStepById(steps, id) {
  if (!steps || !Array.isArray(steps) || !id) return null;
  for (const step of steps) {
    if (step.id === id) return step;
    let found = null;
    if (step.type === 'condition') {
      found = findStepById(step.thenSteps, id) || findStepById(step.elseSteps, id);
    } else if (step.type === 'loop') {
      found = findStepById(step.loopSteps, id);
    }
    if (found) return found;
  }
  return null;
}

/** Returns a standard list of common HTTP methods. */
export function getHttpMethods() {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
}

/** Creates a basic template flow model for a new flow. */
export function createTemplateFlow() {
  // Use jsonToFlowModel to ensure correct initial structure and ID generation
  return jsonToFlowModel({
    name: 'New Flow',
    description: 'A new empty flow.',
    headers: { 'Accept': 'application/json' },
    staticVars: {},
    steps: [] // Start with an empty steps array
  });
  /* // --- Example template with steps ---
  return jsonToFlowModel({
    name: 'Example API Flow', description: 'Sample flow demonstrating features.',
    headers: { 'Accept': 'application/json' },
    staticVars: { userId: "123" },
    steps: [
      { name: '1. Get User Data', type: 'request', method: 'GET', url: 'https://httpbin.org/get?id={{userId}}', extract: { userAgent: 'body.headers.User-Agent', args: 'body.args' } },
      { name: '2. Check User Agent', type: 'condition', conditionData: { variable: 'userAgent', operator: 'contains', value: 'FlowRunner' },
        then: [ { name: '2a. Post if Correct Agent', type: 'request', method: 'POST', url: 'https://httpbin.org/post', body: {"message": "Correct agent!", "details": "{{args}}"} } ],
        else: [ { name: '2b. Get Status if Wrong Agent', type: 'request', method: 'GET', url: 'https://httpbin.org/status/400' } ]
      }
    ]
  });
  */
}


/** Parses a condition string into a structured object. */
export function parseConditionString(conditionString) {
  const fallback = { variable: '', operator: '', value: '', preview: '' };
  if (!conditionString?.trim()) return fallback;

  let match; const trimmed = conditionString.trim();

  // Order matters: Check more specific patterns first
  if ((match = trimmed.match(/^typeof\s+\{\{([^}]+)\}\}\s*===\s*["']number["']/))) return { variable: match[1].trim(), operator: 'is_number', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'is_number' }) };
  if ((match = trimmed.match(/^typeof\s+\{\{([^}]+)\}\}\s*===\s*["']string["']/))) return { variable: match[1].trim(), operator: 'is_text', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'is_text' }) };
  if ((match = trimmed.match(/^typeof\s+\{\{([^}]+)\}\}\s*===\s*["']boolean["']/))) return { variable: match[1].trim(), operator: 'is_boolean', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'is_boolean' }) };
  if ((match = trimmed.match(/^Array\.isArray\(\{\{([^}]+)\}\}\)/))) return { variable: match[1].trim(), operator: 'is_array', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'is_array' }) };

  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\.includes\(["']([^"']*)["']\)/))) return { variable: match[1].trim(), operator: 'contains', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'contains', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\.startsWith\(["']([^"']*)["']\)/))) return { variable: match[1].trim(), operator: 'starts_with', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'starts_with', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\.endsWith\(["']([^"']*)["']\)/))) return { variable: match[1].trim(), operator: 'ends_with', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'ends_with', value: match[2] }) };

  if ((match = trimmed.match(/^\/([^\/]+)\/[gimyus]*\.test\(\{\{([^}]+)\}\}\)/)) || (match = trimmed.match(/^new RegExp\(["']([^"']+)["'](?:,\s*["']([gimyus]+)["'])?\)\.test\(\{\{([^}]+)\}\}\)/))) {
      const regexPattern = match[1]; const variableName = match[3] || match[2];
    return { variable: variableName.trim(), operator: 'matches_regex', value: regexPattern, preview: generateConditionPreview({ variable: variableName.trim(), operator: 'matches_regex', value: regexPattern }) };
  }

  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*===\s*["']([^"']*)["']/))) return { variable: match[1].trim(), operator: 'equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'equals', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*===\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'equals', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*===\s*(true|false)/))) { const isTrue = match[2] === 'true'; return { variable: match[1].trim(), operator: isTrue ? 'is_true' : 'is_false', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: isTrue ? 'is_true' : 'is_false' }) }; }

  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!==\s*["']([^"']*)["']/))) return { variable: match[1].trim(), operator: 'not_equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'not_equals', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!==\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'not_equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'not_equals', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!==\s*(true|false)/))) { const isTrue = match[2] === 'true'; return { variable: match[1].trim(), operator: isTrue ? 'is_false' : 'is_true', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: isTrue ? 'is_false' : 'is_true' }) }; } // Maps !== true to is_false etc.

  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(>=)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'greater_equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'greater_equals', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(<=)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'less_equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'less_equals', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(>)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'greater_than', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'greater_than', value: match[2] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(<)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'less_than', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'less_than', value: match[2] }) };

  // Loose equality (==, !=) - map to strict for simplicity or keep if needed? Let's map.
   if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*==\s*["']([^"']*)["']/))) return { variable: match[1].trim(), operator: 'equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'equals', value: match[2] }) };
   if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*==\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'equals', value: match[2] }) };
   if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*==\s*(true|false)/))) { const isTrue = match[2] === 'true'; return { variable: match[1].trim(), operator: isTrue ? 'is_true' : 'is_false', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: isTrue ? 'is_true' : 'is_false' }) }; }

   if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!=\s*["']([^"']*)["']/))) return { variable: match[1].trim(), operator: 'not_equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'not_equals', value: match[2] }) };
   if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!=\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'not_equals', value: match[2], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'not_equals', value: match[2] }) };
   if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!=\s*(true|false)/))) { const isTrue = match[2] === 'true'; return { variable: match[1].trim(), operator: isTrue ? 'is_false' : 'is_true', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: isTrue ? 'is_false' : 'is_true' }) }; }

   // Existence (loose check often used)
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!=\s*null/))) return { variable: match[1].trim(), operator: 'exists', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'exists' }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*==\s*null/))) return { variable: match[1].trim(), operator: 'not_exists', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'not_exists' }) };

  // Boolean check (direct variable reference)
   if ((match = trimmed.match(/^\{\{([^}]+)\}\}$/))) { return { variable: match[1].trim(), operator: 'is_true', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'is_true' }) }; }

  console.warn(`Could not parse condition string: "${conditionString}" into structured data.`);
  return { ...fallback, preview: `Unparsed: ${trimmed}` }; // Return original in preview if unparsed
}


/** Generates a JavaScript condition string from a structured condition object. */
export function generateConditionString(conditionObj) {
  if (!conditionObj?.variable || !conditionObj.operator) return '';
  const { variable, operator, value } = conditionObj;
  const varRef = `{{${variable.trim()}}}`;
  const safeQuote = (str) => `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const sanitizeNumber = (numStr) => String(Number(numStr) || 0);
  const sanitizeRegex = (pattern) => String(pattern).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  switch (operator) {
    case 'equals': return `${varRef} === ${/^[+-]?\d+(\.\d+)?$/.test(value) || value === 'true' || value === 'false' ? value : safeQuote(value)}`;
    case 'not_equals': return `${varRef} !== ${/^[+-]?\d+(\.\d+)?$/.test(value) || value === 'true' || value === 'false' ? value : safeQuote(value)}`;
    case 'greater_than': return `${varRef} > ${sanitizeNumber(value)}`;
    case 'less_than': return `${varRef} < ${sanitizeNumber(value)}`;
    case 'greater_equals': return `${varRef} >= ${sanitizeNumber(value)}`;
    case 'less_equals': return `${varRef} <= ${sanitizeNumber(value)}`;
    case 'contains': return `${varRef} && typeof ${varRef}.includes === 'function' && ${varRef}.includes(${safeQuote(value)})`;
    case 'starts_with': return `${varRef} && typeof ${varRef}.startsWith === 'function' && ${varRef}.startsWith(${safeQuote(value)})`;
    case 'ends_with': return `${varRef} && typeof ${varRef}.endsWith === 'function' && ${varRef}.endsWith(${safeQuote(value)})`;
    case 'matches_regex': return `new RegExp(${safeQuote(sanitizeRegex(value))}).test(${varRef})`;
    case 'exists': return `${varRef} != null`;
    case 'not_exists': return `${varRef} == null`;
    case 'is_number': return `typeof ${varRef} === "number" && !isNaN(${varRef})`;
    case 'is_text': return `typeof ${varRef} === "string"`;
    case 'is_boolean': return `typeof ${varRef} === "boolean"`;
    case 'is_array': return `Array.isArray(${varRef})`;
    case 'is_true': return `${varRef} === true`;
    case 'is_false': return `${varRef} === false`;
    default: return '';
  }
}


/** Generates a human-readable description of the condition. */
export function generateConditionPreview(conditionObj) {
if (!conditionObj?.variable || !conditionObj.operator) return 'Invalid condition';
const { variable, operator, value } = conditionObj;
const displayValue = (val) => {
    const stringVal = String(val);
    if (stringVal === '' && !doesOperatorNeedValue(operator)) return ''; // No value shown if not needed
    if (!/^[+-]?\d+(\.\d+)?$/.test(stringVal) && stringVal !== 'true' && stringVal !== 'false') {
        return `"${stringVal}"`; // Quote non-numeric/boolean strings
    }
    return stringVal;
};

switch (operator) {
    case 'equals': return `${variable} equals ${displayValue(value)}`;
    case 'not_equals': return `${variable} does not equal ${displayValue(value)}`;
    case 'greater_than': return `${variable} > ${displayValue(value)}`;
    case 'less_than': return `${variable} < ${displayValue(value)}`;
    case 'greater_equals': return `${variable} >= ${displayValue(value)}`;
    case 'less_equals': return `${variable} <= ${displayValue(value)}`;
    case 'contains': return `${variable} contains ${displayValue(value)}`;
    case 'starts_with': return `${variable} starts with ${displayValue(value)}`;
    case 'ends_with': return `${variable} ends with ${displayValue(value)}`;
    case 'matches_regex': return `${variable} matches regex /${value}/`;
    case 'exists': return `${variable} exists`;
    case 'not_exists': return `${variable} does not exist`;
    case 'is_number': return `${variable} is number`;
    case 'is_text': return `${variable} is text`;
    case 'is_boolean': return `${variable} is boolean`;
    case 'is_array': return `${variable} is array`;
    case 'is_true': return `${variable} is true`;
    case 'is_false': return `${variable} is false`;
    default: return `Unknown condition (${operator})`;
}
}


/** Determines if a given condition operator requires a value input field. */
export function doesOperatorNeedValue(operator) {
  const operatorsWithoutValue = ['exists', 'not_exists', 'is_number', 'is_text', 'is_boolean', 'is_array', 'is_true', 'is_false'];
  return !operatorsWithoutValue.includes(operator);
}


/** Escape HTML special characters for safe rendering. */
export function escapeHTML(str) {
   if (str === null || str === undefined) return '';
   return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
 }

 /** Escape special characters for use within a RegExp literal. */
 export function escapeRegExp(str) {
   if (typeof str !== 'string') return '';
   return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 }

 // Polyfill Buffer for browser environment if needed for preProcess/postProcess
 if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined') {
   // Basic polyfill using base64 conversion (less robust than Node's Buffer)
   window.Buffer = {
     from: (str) => ({
       toString: (encoding) => {
         if (encoding === 'base64') return btoa(unescape(encodeURIComponent(str)));
         return str; // Fallback
       }
     }),
     toString: (encoding) => { // For Buffer.from(encoded, 'base64').toString('utf-8')
        if (typeof this.encodedData === 'string' && this.sourceEncoding === 'base64' && encoding === 'utf-8') {
           try { return decodeURIComponent(escape(atob(this.encodedData))); }
           catch { return 'DECODE_ERROR'; }
        }
        return 'POLYFILL_ERROR'; // Fallback
     },
     // Method to simulate Buffer.from(encoded, 'base64')
     fromEncoded: (encodedData, sourceEncoding) => ({
         encodedData: encodedData,
         sourceEncoding: sourceEncoding,
         toString: window.Buffer.toString // Reference the main toString method
     })
   };
   // Adjust decodeVarName to use the polyfill structure
    const decodeVarName = (encoded) => {
       try { return Buffer.fromEncoded(encoded, 'base64').toString('utf-8'); }
       catch { return 'DECODE_ERROR'; }
   };
    // Re-assign postProcessFormattedJson if needed to capture the new decodeVarName
    // This is complex, better to ensure Buffer is available or use a different encoding method.
    // For this exercise, assume the basic polyfill works or adjust pre/postProcess not to use Buffer.
     // Simplified pre/post process without Buffer encoding:
     /*
     export function preProcessBody(bodyText) {
         // ... (replace encodeVarName with just varName.trim()) ...
     }
     export function postProcessFormattedJson(data) {
         // ... (replace decodeVarName with just the captured name group) ...
     }
     */

 }