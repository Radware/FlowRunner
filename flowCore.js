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
    staticVars: flowModel.staticVars ? { ...flowModel.staticVars } : {},
    visualLayout: flowModel.visualLayout ? { ...flowModel.visualLayout } : {} // <-- NEW: Include visual layout
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

        // --- MODIFICATION START ---
        // Include onFailure, defaulting to 'stop' if missing
        jsonStep.onFailure = step.onFailure || 'stop';
        // --- MODIFICATION END ---

        // Process body: Use preProcessBody to handle placeholders
        // Ensure 'body' field is included only if step.body has content or is a non-empty object.
        let bodyToStore = null;
        if (typeof step.body === 'string' && step.body.trim()) {
             try {
               // Preprocess the body text (which might be a stringified object or just a string)
               bodyToStore = preProcessBody(step.body.trim());
             } catch (e) {
                console.warn(`Failed to preprocess request body for step ${step.id}. Storing as potentially invalid string. Error: ${e.message}`);
                bodyToStore = step.body; // Fallback to original string - might be invalid JSON
             }
        }
        // Add body to jsonStep only if it has content after processing
        if (bodyToStore !== null && bodyToStore !== '') {
            // Attempt to parse if it looks like JSON, otherwise store as string
            try {
                // The preProcessBody should have returned a valid JSON string (with markers)
                jsonStep.body = JSON.parse(bodyToStore);
            } catch (e) {
                 // If JSON.parse fails even after preprocessing, store the (potentially invalid) result as a string.
                 // This might happen if preprocessing failed or the original was fundamentally broken.
                console.warn(`Storing potentially invalid JSON string for step ${step.id} body after parse failure: ${e.message}`);
                jsonStep.body = bodyToStore;
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
 * Recursively traverses data (object, array, string) loaded from JSON
 * and converts ##VAR:type:name## marker strings back into {{name}} placeholders for UI display.
 * NO BASE64 DECODING IS PERFORMED.
 * @param {*} data - The data structure (potentially containing markers) loaded from the file.
 * @returns {*} A new data structure with markers replaced by {{name}} placeholders.
 */
function decodeMarkersRecursive(data) {
  if (typeof data === 'string') {
    // Regex to match the entire string as ##VAR:(string|unquoted):ACTUAL_NAME##
    const markerRegex = /^##VAR:(string|unquoted):([^#]+)##$/;
    const match = data.match(markerRegex);

    if (match) {
      // *** CRITICAL: Use the captured name directly ***
      const name = match[2]; // <-- This is the ACTUAL name, not Base64
      // Return the UI placeholder format {{ACTUAL_NAME}}
      return `{{${name}}}`;
    }
    // If the string doesn't exactly match the marker format, return it unchanged.
    return data;

  } else if (Array.isArray(data)) {
    // Recursively process array elements
    return data.map(item => decodeMarkersRecursive(item));
  } else if (typeof data === 'object' && data !== null) {
    // Recursively process object values
    const newObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        newObj[key] = decodeMarkersRecursive(data[key]);
      }
    }
    return newObj;
  }
  // Return numbers, booleans, null, undefined as is
  return data;
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
    staticVars: json.staticVars || {},
    visualLayout: json.visualLayout || {} // <-- NEW: Load visual layout, default to empty object
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

        // --- MODIFICATION START ---
        // Read onFailure from JSON, default to 'stop' if missing/invalid
        step.onFailure = (jsonStep.onFailure === 'continue' || jsonStep.onFailure === 'stop') ? jsonStep.onFailure : 'stop';
        // --- MODIFICATION END ---

        // --- Ensure body processing uses the CORRECT decoder ---
        step.rawBodyWithMarkers = null; // Store the original body from JSON (object or string with markers)
        step.body = ''; // This will hold the UI-ready string (decoded and possibly stringified)
        if (jsonStep.body !== undefined && jsonStep.body !== null) {
            try {
               // Deep copy the original body (which might be object or string)
               // to preserve the ##VAR:...## markers if needed for re-saving without changes.
               step.rawBodyWithMarkers = JSON.parse(JSON.stringify(jsonStep.body));
            } catch (e) {
                // If deep copy fails (e.g., non-JSON compatible value), store original directly.
                console.warn(`Could not deep copy body for step ${step.id}, storing reference.`, e);
                step.rawBodyWithMarkers = jsonStep.body;
            }

            // *** CRITICAL: This call MUST use the updated decodeMarkersRecursive ***
            // Decode the markers in the copied body to get UI representation {{var}}
            const decodedBodyForUI = decodeMarkersRecursive(step.rawBodyWithMarkers);

            // Prepare the decoded body for display in the UI textarea
            if (typeof decodedBodyForUI === 'object' && decodedBodyForUI !== null) {
                 try {
                    // If decoded body is an object (e.g. unquoted var became `{{var}}`), stringify it nicely for the textarea
                    step.body = JSON.stringify(decodedBodyForUI, null, 2);
                 }
                 catch (e) {
                     // Fallback if stringify fails
                     console.warn(`Failed to stringify decoded body object for step ${step.id}:`, e);
                     step.body = String(decodedBodyForUI);
                 }
            } else {
                 // If decoded body is already a string (or number/boolean), use it directly
                step.body = String(decodedBodyForUI);
            }
        }
        // --- End body processing ---

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
/**
 * Evaluate a path expression on response data or general context data.
 * Handles the special path '.status' to extract the HTTP status code.
 * Handles regular paths including dot notation ('a.b') and array indexing ('a[0].c').
 * Looks for regular paths within 'body' first if applicable, then potentially root/headers.
 * @param {Object} data - Data object (e.g., runner context or step response {status, headers, body}).
 * @param {string} path - Path string (e.g., ".status", "status", "headers.Content-Type", "body.data.id", "items[0]").
 * @return {*} Extracted value or undefined if path is invalid or not found.
 */
export function evaluatePath(data, path) {
  if (data === null || data === undefined || !path || typeof path !== 'string') {
      return undefined;
  }

  // --- Step 1: Handle EXACTLY '.status' for HTTP status code ---
  if (path === '.status') {
      if (data.hasOwnProperty('status')) {
           // console.log(`[evaluatePath] Special case '.status' matched: ${data.status}`);
           return data.status;
      } else {
           // console.log(`[evaluatePath] Special case '.status' used, but data has no 'status' property.`);
           return undefined; // .status used, but no status property exists
      }
  }
  // --- If we reach here, the path is NOT exactly '.status' ---


  // --- Step 2: Handle regular path evaluation ---
  // Split the path into parts for traversal
  // Handles: status, a.b, a[0], headers.Content-Type, body.data.items[1].name
  const parts = path.match(/[^.[\]]+|\[\d+\]/g);
  if (!parts) {
      // console.log(`[evaluatePath] Invalid regular path format: ${path}`);
      return undefined; // Invalid path format
  }

  let current = data;
  let initialPartProcessed = false; // Flag to track if we've handled an initial 'headers' or 'body' part

  // console.log(`[evaluatePath] Starting regular eval. Path: ${path}, Initial Data Type: ${typeof data}`);

  // Process the first part specially to handle potential 'headers' or 'body' prefixes
  // OR if the path is just a single word like 'status' (without the leading dot).
  if (parts.length > 0) {
      const firstPart = parts[0];

      if (firstPart === 'headers' && typeof current === 'object' && current.hasOwnProperty('headers')) {
          current = current.headers;
          initialPartProcessed = true;
          // console.log(`[evaluatePath] Accessed 'headers'. New current type: ${typeof current}`);
      } else if (firstPart === 'body' && typeof current === 'object' && current.hasOwnProperty('body')) {
          current = current.body;
          initialPartProcessed = true;
          // console.log(`[evaluatePath] Accessed 'body'. New current type: ${typeof current}`);
      } else if (parts.length === 1 && firstPart === 'status' && typeof current === 'object' && current.hasOwnProperty('status')) {
          // Handle the case where the user entered 'status' (no dot) AND the root object has 'status'
          // This is different from the '.status' special case above.
          // console.log(`[evaluatePath] Direct path 'status' matched root property: ${current.status}`);
           return current.status; // Return status from root if path is just 'status'
      } else if (typeof current === 'object' && current.hasOwnProperty('body')) {
           // Default assumption: If no 'headers.' or 'body.' prefix, try accessing within 'body' first.
           // This handles paths like 'id' or 'items[0]' assuming they are inside the body.
           let tempCurrent = current.body;
            if (tempCurrent !== null && tempCurrent !== undefined && typeof tempCurrent === 'object' && tempCurrent.hasOwnProperty(firstPart)) {
               // If the first part exists directly within the body, start traversal there.
               current = tempCurrent;
               // console.log(`[evaluatePath] Defaulting to 'body' access for first part: '${firstPart}'.`);
           }
            // If not found in body, we'll try accessing from the root 'data' object below.
      }
      // If initialPartProcessed is true, we skip the first part in the main loop later.
  }


  // --- Step 3: Traverse remaining parts ---
  const startIndex = initialPartProcessed ? 1 : 0; // Start from index 1 if first part was 'headers' or 'body'

  for (let i = startIndex; i < parts.length; i++) {
      const part = parts[i];

      if (current === null || current === undefined) {
          // console.log(`[evaluatePath] Cannot traverse further at part "${part}". Current is null/undefined.`);
          return undefined;
      }

      const arrayMatch = part.match(/^\[(\d+)\]$/);
      if (arrayMatch) {
          // Array index access
          const index = parseInt(arrayMatch[1], 10);
          if (!Array.isArray(current)) {
              // console.log(`[evaluatePath] Attempted array access on non-array at part "${part}". Current:`, typeof current);
              return undefined;
          }
          if (index < 0 || index >= current.length) {
              // console.log(`[evaluatePath] Index ${index} out of bounds for part "${part}". Array length: ${current.length}`);
              return undefined;
          }
          current = current[index];
          // console.log(`[evaluatePath] Accessed array index ${index}.`);
      } else {
          // Object property access
          if (typeof current !== 'object') {
              // console.log(`[evaluatePath] Attempted property access on non-object at part "${part}". Current:`, typeof current);
              return undefined;
          }

          let found = false;
           // Handle case-insensitive header access if the parent was 'headers'
           if (initialPartProcessed && parts[0] === 'headers' && i === 1) { // Check if we are accessing a property directly under 'headers'
              for (const key in current) {
                  if (current.hasOwnProperty(key) && key.toLowerCase() === part.toLowerCase()) {
                      current = current[key];
                      found = true;
                      break;
                  }
              }
          } else {
              // Standard case-sensitive property access for body or other objects
              if (current.hasOwnProperty(part)) {
                  current = current[part];
                  found = true;
              }
          }

          if (!found) {
              // console.log(`[evaluatePath] Property "${part}" not found in current object.`);
              return undefined;
          }
          // console.log(`[evaluatePath] Accessed property "${part}".`);
      }
  }
  // console.log(`[evaluatePath] Evaluation successful for path "${path}". Final value:`, current);
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

// Helper function to escape characters for use in RegExp (if not already available)
export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * Pre-processes a JSON string containing {{variable}} placeholders.
 * Replaces placeholders with unique markers ##VAR:type:name## to allow standard JSON parsing.
 * Distinguishes between quoted ("{{var}}") and unquoted ({{var}}) placeholders.
 * DOES NOT USE BASE64. Variable names are stored directly in the marker.
 * @param {string} bodyText - The raw JSON string with placeholders.
 * @return {string} A valid JSON string with placeholders replaced by markers, or the original string on error/fallback.
 */
export function preProcessBody(bodyText) {
  if (!bodyText || typeof bodyText !== 'string' || bodyText.trim() === '') return bodyText; // Return original if empty or not a string

  const placeholders = {};
  let counter = 0;
  const placeholderPrefix = "__TEMP_VAR_PLACEHOLDER_"; // Unique temporary string

  try {
    // Pass 1: Replace QUOTED "{{var}}" with temporary placeholder
    // Matches "{{var}}" only when enclosed in double quotes.
    let tempText = bodyText.replace(/"(\{\{([^}]+)\}\})"/g, (match, fullVar, varName) => {
      const placeholder = `${placeholderPrefix}${counter++}`;
      // Store the RAW name, no encoding, mark as string type
      placeholders[placeholder] = { type: 'string', name: varName.trim() };
      // Replace with the placeholder, keeping the quotes
      return `"${placeholder}"`;
    });

    // Pass 2: Replace UNQUOTED {{var}} with temporary placeholder
    // Matches {{var}} when preceded by a colon, bracket, curly brace, comma, or start of string,
    // potentially surrounded by whitespace, and followed by whitespace, comma, closing bracket/brace, or end of string.
    // This prevents matching {{var}} inside strings like "abc{{var}}def".
    tempText = tempText.replace(/(^|[:\[{,\s])\s*(\{\{([^}]+)\}\})\s*(?=$|[,}\]])/g, (match, prefix, fullVar, varName) => {
      const placeholder = `${placeholderPrefix}${counter++}`;
       // Store the RAW name, no encoding, mark as unquoted type
      placeholders[placeholder] = { type: 'unquoted', name: varName.trim() };
      // Replace with the placeholder, adding quotes (to make it a valid JSON string temporarily)
      // The prefix ensures we keep the colon/comma etc.
      return `${prefix}"${placeholder}"`;
    });

    // Pass 3: Replace temporary placeholders with final ##VAR:type:name## markers
    let jsonStringWithMarkers = tempText;
    for (const placeholder in placeholders) {
      if (Object.prototype.hasOwnProperty.call(placeholders, placeholder)) {
          const info = placeholders[placeholder];
          // *** CRITICAL: Construct marker with RAW name ***
          // Example: ##VAR:string:myVar## or ##VAR:unquoted:count##
          const marker = `##VAR:${info.type}:${info.name}##`; // <-- NO BASE64 ENCODING HERE
          // Escape the placeholder for use in regex (it contains underscores)
          const placeholderPattern = new RegExp(`"${escapeRegExp(placeholder)}"`, 'g');
          // Replace the quoted temporary placeholder with the final marker string, ensuring it remains quoted
          jsonStringWithMarkers = jsonStringWithMarkers.replace(placeholderPattern, `"${marker}"`);
      }
    }

    // Final check: Ensure the resulting string is valid JSON
     try {
       JSON.parse(jsonStringWithMarkers);
       // If parsing succeeds, the string with markers is valid JSON
       return jsonStringWithMarkers;
     } catch (parseError) {
       // If parsing fails *after* marker insertion, something went fundamentally wrong.
       // This might happen with complex nested structures or malformed original input.
       // Fallback: Perform a simpler, less robust replacement directly on the original text.
       // This fallback might incorrectly quote numbers/booleans, but aims to preserve data.
       console.warn(`preProcessBody: Resulting string with markers is not valid JSON (${parseError.message}). Falling back to simple replacement.`);
       // Simple fallback: Treat all {{var}} as string markers.
       return bodyText.replace(/\{\{([^}]+)\}\}/g, (match, varName) => `"##VAR:string:${varName.trim()}##"`);
     }
  } catch (error) {
      // Catch any unexpected errors during the replacement process.
      console.error("Error during preProcessBody execution:", error);
      // Fallback: As above, perform a simple replacement.
      console.warn("Falling back to simple replacement due to error.");
      return bodyText.replace(/\{\{([^}]+)\}\}/g, (match, varName) => `"##VAR:string:${varName.trim()}##"`);
  }
}


/**
 * Formats a JavaScript object/array (potentially with {{var}} placeholders)
 * into a pretty-printed JSON string.
 * @param {*} data - The object/array/string to format.
 * @return {string} A formatted JSON string. Returns input as string on error.
 */
export function postProcessFormattedJson(data) {
    if (data === null || data === undefined) return '';
    if (typeof data === 'string') {
        // If it's already a string, assume it's formatted or doesn't need formatting.
        // Could attempt to parse and re-stringify, but risky.
        return data;
    }
    try {
        // Stringify the object/array with pretty printing
        return JSON.stringify(data, null, 2);
    } catch (e) {
        console.error("Error stringifying data in postProcessFormattedJson:", e);
        return String(data); // Fallback to basic string conversion
    }
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
       // 1. Validate syntax roughly, allowing for unquoted {{vars}} for now
       const validation = validateRequestBodyJson(bodyText);
       if (!validation.valid) {
           // Use the validation error directly if available
           throw new Error(validation.message || 'Invalid JSON syntax before processing.');
       }

       // 2. Pre-process to replace {{vars}} with ##VAR:...## markers
       const processedJsonString = preProcessBody(bodyText);

       // 3. Parse the marker-filled string into a JS object
       let parsedObject;
       try {
           parsedObject = JSON.parse(processedJsonString);
       } catch(e) {
           // If parsing fails even after preprocessing, the structure is likely fundamentally wrong
           console.error("JSON parsing failed even after preProcessing:", e.message, "Processed string:", processedJsonString);
           throw new Error(`JSON parsing failed after attempting to handle placeholders. Check overall structure. Original error: ${e.message}`);
       }


       // 4. Decode markers ##VAR:...## back to {{var}} within the JS object structure
       const decodedObject = decodeMarkersRecursive(parsedObject);

       // 5. Stringify the decoded object with pretty printing
       const finalFormattedJson = postProcessFormattedJson(decodedObject);

       return finalFormattedJson;
  } catch (error) {
    console.warn("JSON formatting failed:", error.message);
    // Optionally provide user feedback here, e.g., using an alert or status message
    alert(`Formatting Error: ${error.message}. Please check syntax.`);
    return bodyText; // Return original on error to avoid data loss
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
             // Validate the UI-facing body string (which should have {{vars}} correctly)
             const bodyValidation = validateRequestBodyJson(step.body);
             if (!bodyValidation.valid) {
                result.valid = false;
                result.errors.push(`${currentPath}: Body - ${bodyValidation.message || 'Invalid JSON syntax'}.`);
             } else {
                // Check variable usage in the potentially complex body string
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
               // Condition variable itself might be a placeholder e.g. {{status_code}}
               checkVariableUsage(`{{${conditionVar}}}`, 'Condition variable name', currentPath, currentAvailableVars);
                if (doesOperatorNeedValue(conditionOp) && conditionVal && typeof conditionVal === 'string') {
                   // Condition value might contain placeholders e.g. "{{expected_id}}"
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
             // Loop source must reference an existing variable
            checkVariableUsage(`{{${step.source}}}`, 'Loop source variable name', currentPath, currentAvailableVars);
          }
          if (!loopVar?.trim() || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(loopVar)) {
            result.valid = false;
            result.errors.push(`${currentPath}: Loop variable name "${loopVar}" is invalid.`);
          } else {
               const loopScopeVars = new Set(currentAvailableVars);
               loopScopeVars.add(loopVar); // Add the loop item variable to the scope
               validateStepsRecursive(step.loopSteps, `${currentPath} > Loop Body`, loopScopeVars);
          }
          break;
        default:
          result.valid = false;
          result.errors.push(`${currentPath}: Unknown step type "${step.type}".`);
      }
      // Add variables defined in this step (e.g., extractions) to the available set for subsequent steps
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
      return {
        id,
        name: 'New Request',
        type: 'request',
        method: 'GET',
        url: '',
        headers: {},
        body: '',
        rawBodyWithMarkers: null,
        extract: {},
        onFailure: 'stop' // <-- ADDED: Default onFailure behavior
      };
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
 * Also handles cloning the `rawBodyWithMarkers` field if present.
 * @param {Object} step - The step object to clone.
 * @return {Object} A new step object with unique IDs.
 */
export function cloneStep(step) {
  if (!step) return null;
  let cloned;
   try {
       // Deep clone using JSON stringify/parse - this handles most standard cases
       cloned = JSON.parse(JSON.stringify(step));
       // Note: rawBodyWithMarkers should be handled correctly by this if it was JSON-compatible
   } catch (e) {
       console.error("Failed to clone step:", e, step); return null;
   }

  // Function to recursively assign new IDs to nested steps
  function assignNewIds(steps) {
    if (!steps || !Array.isArray(steps)) return [];
    return steps.map(s => {
       // Clone the step again to ensure nested structures get unique IDs if cloned multiple times
       const newS = JSON.parse(JSON.stringify(s));
       newS.id = generateUniqueId(); // Assign a new ID

      // Recurse for nested step types
      if (newS.type === 'condition') {
        newS.thenSteps = assignNewIds(newS.thenSteps || []);
        newS.elseSteps = assignNewIds(newS.elseSteps || []);
      } else if (newS.type === 'loop') {
        newS.loopSteps = assignNewIds(newS.loopSteps || []);
      }
      // Handle other potential nested structures if added later
      return newS;
    });
  }

  cloned.id = generateUniqueId(); // Assign a new ID to the top-level cloned step

  // Assign new IDs to any nested steps within the cloned structure
  if (cloned.type === 'condition') {
      cloned.thenSteps = assignNewIds(cloned.thenSteps || []);
      cloned.elseSteps = assignNewIds(cloned.elseSteps || []);
  } else if (cloned.type === 'loop') {
      cloned.loopSteps = assignNewIds(cloned.loopSteps || []);
  }

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
  // Provide a minimal JSON structure to initialize
  return jsonToFlowModel({
    name: 'New Flow',
    description: 'A new empty flow.',
    headers: { 'Accept': 'application/json' }, // Sensible default header
    staticVars: {},
    steps: [] // Start with an empty steps array
  });
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

  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*&&\s*typeof\s+\{\{([^}]+)\}\}\.includes\s*===\s*'function'\s*&&\s*\{\{([^}]+)\}\}\.includes\(["']([^"']*)["']\)/))) return { variable: match[1].trim(), operator: 'contains', value: match[4], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'contains', value: match[4] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*&&\s*typeof\s+\{\{([^}]+)\}\}\.startsWith\s*===\s*'function'\s*&&\s*\{\{([^}]+)\}\}\.startsWith\(["']([^"']*)["']\)/))) return { variable: match[1].trim(), operator: 'starts_with', value: match[4], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'starts_with', value: match[4] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*&&\s*typeof\s+\{\{([^}]+)\}\}\.endsWith\s*===\s*'function'\s*&&\s*\{\{([^}]+)\}\}\.endsWith\(["']([^"']*)["']\)/))) return { variable: match[1].trim(), operator: 'ends_with', value: match[4], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'ends_with', value: match[4] }) };

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

  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(>=)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'greater_equals', value: match[3], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'greater_equals', value: match[3] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(<=)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'less_equals', value: match[3], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'less_equals', value: match[3] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(>)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'greater_than', value: match[3], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'greater_than', value: match[3] }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*(<)\s*([+-]?\d+(\.\d+)?)/))) return { variable: match[1].trim(), operator: 'less_than', value: match[3], preview: generateConditionPreview({ variable: match[1].trim(), operator: 'less_than', value: match[3] }) };

  // Existence (using null checks as per generateConditionString)
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*!=\s*null/))) return { variable: match[1].trim(), operator: 'exists', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'exists' }) };
  if ((match = trimmed.match(/^\{\{([^}]+)\}\}\s*==\s*null/))) return { variable: match[1].trim(), operator: 'not_exists', value: '', preview: generateConditionPreview({ variable: match[1].trim(), operator: 'not_exists' }) };

  console.warn(`Could not parse condition string: "${conditionString}" into structured data.`);
  return { ...fallback, preview: `Unparsed: ${trimmed}` }; // Return original in preview if unparsed
}


/** Generates a JavaScript condition string from a structured condition object. */
export function generateConditionString(conditionObj) {
  if (!conditionObj?.variable || !conditionObj.operator) return '';
  const { variable, operator, value } = conditionObj;
  const varRef = `{{${variable.trim()}}}`;
  // Function to safely quote strings for inclusion in the JS code
  const safeQuote = (str) => `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  // Function to ensure numbers are treated as numbers
  const sanitizeNumber = (numStr) => String(Number(numStr) || 0); // Coerce to number, default to 0 if NaN
  // Function to sanitize regex patterns for safe inclusion in RegExp constructor
  const sanitizeRegex = (pattern) => String(pattern).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  switch (operator) {
    case 'equals':
      // Check if the value looks like a number or boolean, otherwise quote it
      return `${varRef} === ${/^[+-]?\d+(\.\d+)?$/.test(value) || value === 'true' || value === 'false' ? value : safeQuote(value)}`;
    case 'not_equals':
      return `${varRef} !== ${/^[+-]?\d+(\.\d+)?$/.test(value) || value === 'true' || value === 'false' ? value : safeQuote(value)}`;
    case 'greater_than':
      return `${varRef} > ${sanitizeNumber(value)}`;
    case 'less_than':
      return `${varRef} < ${sanitizeNumber(value)}`;
    case 'greater_equals':
      return `${varRef} >= ${sanitizeNumber(value)}`;
    case 'less_equals':
      return `${varRef} <= ${sanitizeNumber(value)}`;
    // Add checks for existence and type before calling string methods
    case 'contains':
      return `${varRef} && typeof ${varRef}.includes === 'function' && ${varRef}.includes(${safeQuote(value)})`;
    case 'starts_with':
      return `${varRef} && typeof ${varRef}.startsWith === 'function' && ${varRef}.startsWith(${safeQuote(value)})`;
    case 'ends_with':
      return `${varRef} && typeof ${varRef}.endsWith === 'function' && ${varRef}.endsWith(${safeQuote(value)})`;
    case 'matches_regex':
      // Use RegExp constructor for safety with dynamic patterns
      return `new RegExp(${safeQuote(sanitizeRegex(value))}).test(${varRef})`;
    case 'exists':
      return `${varRef} != null`; // Checks for not null and not undefined
    case 'not_exists':
      return `${varRef} == null`; // Checks for null or undefined
    case 'is_number':
      return `typeof ${varRef} === "number" && !isNaN(${varRef})`; // Exclude NaN
    case 'is_text':
      return `typeof ${varRef} === "string"`;
    case 'is_boolean':
      return `typeof ${varRef} === "boolean"`;
    case 'is_array':
      return `Array.isArray(${varRef})`;
    case 'is_true':
      return `${varRef} === true`;
    case 'is_false':
      return `${varRef} === false`;
    default:
      console.warn(`Unsupported operator in generateConditionString: ${operator}`);
      return '';
  }
}


/** Generates a human-readable description of the condition. */
export function generateConditionPreview(conditionObj) {
if (!conditionObj?.variable || !conditionObj.operator) return 'Invalid condition';
const { variable, operator, value } = conditionObj;
const displayValue = (val) => {
    const stringVal = String(val);
    if (stringVal === '' && !doesOperatorNeedValue(operator)) return ''; // No value shown if not needed
    // Quote strings unless they are exactly 'true' or 'false' or look like numbers
    if (!/^[+-]?\d+(\.\d+)?$/.test(stringVal) && stringVal !== 'true' && stringVal !== 'false') {
        return `"${stringVal}"`; // Quote other strings
    }
    return stringVal; // Return numbers, true, false as is
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
    case 'is_text': return `${variable} is text (string)`;
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

