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

  function makeExtractPathsExplicit(extract) {
    if (!extract) return extract;
    const explicit = {};
    for (const [varName, path] of Object.entries(extract)) {
      if (typeof path === 'string' &&
          path !== '.status' &&
          !path.startsWith('body.') &&
          !path.startsWith('headers.') &&
          path !== 'body' &&
          path !== 'headers') {
        explicit[varName] = `body.${path}`;
      } else {
        explicit[varName] = path;
      }
    }
    return explicit;
  }

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
          jsonStep.extract = makeExtractPathsExplicit(step.extract);
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
export function decodeMarkersRecursive(data) {
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

  function upgradeExtractPaths(extract) {
    if (!extract) return extract;
    const upgraded = {};
    for (const [varName, path] of Object.entries(extract)) {
      if (typeof path === 'string' &&
          path !== '.status' &&
          !path.startsWith('body.') &&
          !path.startsWith('headers.') &&
          path !== 'body' &&
          path !== 'headers') {
        upgraded[varName] = `body.${path}`;
      } else {
        upgraded[varName] = path;
      }
    }
    return upgraded;
  }

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
        step.onFailure = (jsonStep.onFailure === 'continue' || jsonStep.onFailure === 'stop') ? jsonStep.onFailure : 'stop';
        step.rawBodyWithMarkers = null;
        step.body = '';
        if (jsonStep.body !== undefined && jsonStep.body !== null) {
            try {
               step.rawBodyWithMarkers = JSON.parse(JSON.stringify(jsonStep.body));
            } catch (e) {
                console.warn(`Could not deep copy body for step ${step.id}, storing reference.`, e);
                step.rawBodyWithMarkers = jsonStep.body;
            }
            const decodedBodyForUI = decodeMarkersRecursive(step.rawBodyWithMarkers);
            if (typeof decodedBodyForUI === 'object' && decodedBodyForUI !== null) {
                 try {
                    step.body = JSON.stringify(decodedBodyForUI, null, 2);
                 }
                 catch (e) {
                     step.body = String(decodedBodyForUI);
                 }
            } else {
                step.body = String(decodedBodyForUI);
            }
        }
        // Upgrade extract paths for backward compatibility
        step.extract = upgradeExtractPaths(jsonStep.extract || {});
      } else if (jsonStep.type === 'condition') {
        step.condition = jsonStep.condition || '';
        if (jsonStep.conditionData) {
          step.conditionData = jsonStep.conditionData;
        } else if (step.condition) {
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
 * Evaluate a dotted / bracket path on a data object.
 *
 * Rules
 *   • `.status`                  → data.status  (special case)
 *   • `body.…`  / `headers.…`    → explicit roots
 *   • `body`    / `headers`      → return those whole objects
 *   • anything else (`id`, `user.name`, `arr[3].id`, …)
 *       – if the object has a `body` key → look inside `data.body`
 *       – otherwise                     → look in the object itself
 *
 * Supports array‑index syntax (`items[3].value`).
 */
/**
 * Evaluate a dotted / bracket path on a data object.
 *
 * Rules
 * ─────────────────────────────────────────────────────────────
 *   • `.status`                    → data.status   (special case)
 *   • `body`                       → data.body  ▸ if it exists, otherwise data
 *   • `body.…`                     → inside data.body ▸ if it exists, else inside data
 *   • `headers`                    → data.headers
 *   • `headers.…`                  → inside data.headers
 *   • anything else (`id`, `user.name`, `arr[2].id`, …)
 *         – if the object has a `body` key → look in data.body
 *         – otherwise                       → look in the object itself
 *
 * Array indices like `items[3].value` are supported.
 */
export function evaluatePath(data, path) {
  /* Sanity checks */
  if (data == null || typeof path !== 'string' || !path.trim()) return undefined;

  /* 1. ─ Special literal ------------------------------------ */
  if (path === '.status') {
    return Object.prototype.hasOwnProperty.call(data, 'status') ? data.status : undefined;
  }

  /* 2. ─ Explicit BODY handling ------------------------------ */
  if (path === 'body') {
    return ('body' in data) ? data.body : data;          // whole body, or the object itself
  }
  if (path.startsWith('body.')) {
    const root = ('body' in data) ? data.body : data;    // fall back when body is absent
    return walk(root, path.slice(5));                    // drop 'body.'
  }

  /* 3. ─ Explicit HEADERS handling --------------------------- */
  if (path === 'headers') {
    return data.headers;                                 // may be undefined
  }
  if (path.startsWith('headers.')) {
    return walk(data.headers, path.slice(8));            // drop 'headers.'
  }

  /* 4. ─ Implicit (no prefix) ------------------------------- */
  const implicitRoot = ('body' in data) ? data.body : data;
  return walk(implicitRoot, path);

  /* --------------------------------------------------------- */
  function walk(obj, subPath) {
    if (obj == null) return undefined;
    if (!subPath)    return obj;                         // caller asked for the whole root

    /* tokenise: items[3].value → ['items','3','value'] */
    const tokens = subPath
      .replace(/\[(\d+)\]/g, '.$1')                      // [index] → .index
      .split('.')
      .filter(Boolean);

    let cur = obj;
    for (const key of tokens) {
      if (cur == null) return undefined;
      cur = cur[key];
    }
    return cur;
  }
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
               message = `Likely syntax error near '{{' or '}}'.\n\nFor variables, use:\n  - \"key\": \"{{var}}\" for strings\n  - \"key\": {{var}} for numbers/booleans\n\nCheck for missing or extra braces, or misplaced commas.\nExample: { \"id\": {{userId}} }`;
           } else {
               const positionMatch = message.match(/at position (\d+)/);
               const position = positionMatch ? parseInt(positionMatch[1], 10) : -1;
               let context = '';
               if (position !== -1) {
                   const snippetStart = Math.max(0, position - 15);
                   const snippetEnd = Math.min(bodyText.length, position + 15);
                   context = `\nError near: ...${bodyText.substring(snippetStart, position)}[HERE]${bodyText.substring(position, snippetEnd)}...`;
               }
               message = `Invalid JSON syntax.${context}\n\nCheck for missing commas, quotes, or brackets.\nTip: Each key-value pair should be separated by a comma, and all keys must be in double quotes.\nExample: { \"name\": \"value\", \"id\": 123 }`;
           }
      } else if (message.includes('Unexpected end of JSON input')) {
          message = `Incomplete JSON.\n\nCheck for unclosed brackets or braces.\nTip: Every opening { or [ must have a matching closing } or ].`;
      } else {
           message = `JSON validation failed: ${message}\n\nTip: Ensure your JSON is properly formatted. All keys must be in double quotes, and values must be valid JSON types.`;
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
 * Returns TRUE when an extraction path string is syntactically legal.
 *
 * Accepted forms ──────────────────────────────────────────────────────────
 *   · .status                      – the special status literal
 *   · status                       – same as above
 *   · body                         – whole body
 *   · body.id                      – inside body …
 *   · body.items[0].value          – array access
 *   · headers                      – whole headers object
 *   · headers.Content‑Type         – header look‑ups
 *   · id, user.profile.name, …     – implicit root (data.body if present)
 *
 * Basically: letters, digits, _ , $ , . , [index] , 'string' , "string" and – in
 * header names – the dash (‑).  **NO white‑space, commas, parens, etc.**
 */
export function isValidExtractPath(p) {
  if (!p || typeof p !== 'string') return false;

  // one big (but still readable) regexp
  const rx = new RegExp(
    '^(' +
      '(?:\\.status|status)' +                         // .status / status
      '|body(?:\\.[a-zA-Z0-9_$\\.\\[\\]\'"\\-]+)?' +   // body or body.…
      '|headers?(?:\\.[a-zA-Z0-9_\\-]+)?' +            // headers / headers.X
      '|[a-zA-Z_$][a-zA-Z0-9_$]*(?:[\\.\\[][a-zA-Z0-9_$\'"\\]]*\\]?)*' + // id / arr[3].x
    ')$'
  );

  return rx.test(p);
}


/**
 * Validates the entire flow model for common issues.
 * Checks for required fields, undefined variable references, syntax errors, etc.
 * @param {Object} flowModel - The flow model to validate.
 * @return {{valid: boolean, errors: string[]}} Validation result.
 */
export function validateFlow(flowModel) {
  const result = { valid: true, errors: [] };
  if (!flowModel) {
    return { valid: false, errors: ['Flow model is missing. Please create or load a flow before proceeding.'] };
  }

  /* ──────────────────────────────────────────────────────────────────
   * 1. Flow‑level checks
   * ────────────────────────────────────────────────────────────────── */
  if (!flowModel.name?.trim()) {
    result.valid = false;
    result.errors.push('Flow name is required. Please enter a descriptive name for your flow.');
  }

  const initialVarNames = new Set(Object.keys(flowModel.staticVars || {}));

  /* helper – variable reference scanner */
  function checkVariableUsage(text, context, stepName, availableVars) {
    if (!text || typeof text !== 'string') return;
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const varName = match[1].trim();
      const baseName = varName.split('.')[0];          // accept slide.title, slide.foo.bar …
      if (availableVars.has(baseName)) continue;       // treat as defined if the base exists
      if (!availableVars.has(varName)) {
        result.valid = false;
        const msg = `${stepName}: ${context} references undefined variable \"{{${varName}}}\".\n\nHint: Make sure this variable is defined earlier in the flow or as a static variable.`;
        if (!result.errors.includes(msg)) result.errors.push(msg);
      }
    }
  }

  /* ──────────────────────────────────────────────────────────────────
   * 2. Step recursion
   * ────────────────────────────────────────────────────────────────── */
  function validateStepsRecursive(steps, pathPrefix = '', availableVars = new Set()) {
    if (!Array.isArray(steps)) return;

    steps.forEach((step, idx) => {
      const stepName = step.name || `Step ${idx + 1}`;
      const here     = pathPrefix ? `${pathPrefix} > ${stepName}` : stepName;
      const varsDefinedHere = new Set();

      /* — generic requirements — */
      if (!step.name?.trim()) {
        result.valid = false;
        result.errors.push(`${here}: Step name is required. Please provide a descriptive name for this step.`);
      }
      if (!step.type) {
        result.valid = false;
        result.errors.push(`${here}: Step type is missing. This usually means the step is incomplete or corrupted. Please select a valid step type.`);
        return;
      }

      /* — type‑specific validation — */
      switch (step.type) {
        /* ■■■ REQUEST ───────────────────────────────────────────── */
        case 'request': {
          /* URL */
          if (!step.url) {
            result.valid = false;
            result.errors.push(`${here}: Request URL is required. Enter a valid URL (e.g., https://api.example.com/data).`);
          } else {
            checkVariableUsage(step.url, 'URL', here, availableVars);
          }

          /* Headers */
          if (step.headers) {
            Object.entries(step.headers).forEach(([k, v]) =>
              checkVariableUsage(v, `Header \"${k}\"`, here, availableVars)
            );
          }

          /* Body */
          if (step.body && typeof step.body === 'string' && step.body.trim()) {
            const bodyCheck = validateRequestBodyJson(step.body);
            if (!bodyCheck.valid) {
              result.valid = false;
              result.errors.push(`${here}: Request body is not valid JSON.\n${bodyCheck.message || 'Check for missing commas, brackets, or quotes.'}`);
            } else {
              checkVariableUsage(step.body, 'Body', here, availableVars);
            }
          }

          /* Extraction table */
          if (step.extract) {
            Object.entries(step.extract).forEach(([varName, jsonPath]) => {
              /* variable name */
              if (!varName?.trim() || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
                result.valid = false;
                result.errors.push(`${here}: Extraction variable name \"${varName}\" is invalid.\n\nUse only letters, numbers, and underscores, and do not start with a number. Example: myVar1`);
              } else {
                varsDefinedHere.add(varName);
              }

              /* extraction path */
              if (!jsonPath?.trim()) {
                result.valid = false;
                result.errors.push(`${here}: Extraction path for \"${varName}\" is required. Enter a valid path, e.g., body.data.token or .status.`);
              } else if (!isValidExtractPath(jsonPath.trim())) {
                result.valid = false;
                result.errors.push(`${here}: Extraction path \"${jsonPath}\" for \"${varName}\" contains invalid characters.\n\nUse dot notation (body.field), array indices (body.items[0].id), or .status. No spaces or special characters allowed.`);
              }
            });
          }
          break;
        }

        /* ■■■ CONDITION ────────────────────────────────────────── */
        case 'condition': {
          const { variable, operator, value } = step.conditionData || {};
          if (!variable || !operator) {
            result.valid = false;
            result.errors.push(`${here}: Condition step is missing a variable or operator. Please select both.`);
          } else {
            checkVariableUsage(`{{${variable}}}`, 'Condition variable', here, availableVars);
            if (doesOperatorNeedValue(operator) && typeof value === 'string') {
              checkVariableUsage(value, 'Condition value', here, availableVars);
            }
          }

          /* recurse into THEN / ELSE */
          validateStepsRecursive(step.thenSteps, `${here} > Then`, new Set(availableVars));
          validateStepsRecursive(step.elseSteps, `${here} > Else`, new Set(availableVars));
          break;
        }

        /* ■■■ LOOP ─────────────────────────────────────────────── */
        case 'loop': {
          const loopVar = step.loopVariable || 'item';
          const currentPath = here;
          const currentAvailableVars = new Set(availableVars);

          /* source */
          if (!step.source) {
            result.valid = false;
            result.errors.push(`${currentPath}: Loop source variable is required. Enter a variable or path to an array (e.g., items or body.data.items).`);
          } else {
            let sourceVar = step.source.trim();
            if (sourceVar.startsWith('{{') && sourceVar.endsWith('}}')) {
              sourceVar = sourceVar.slice(2, -2).trim();
            }
            if (!sourceVar) {
              result.valid = false;
              result.errors.push(`${currentPath}: Loop source variable is required. Enter a variable or path to an array.`);
            } else if (!currentAvailableVars.has(sourceVar)) {
              result.valid = false;
              result.errors.push(`${currentPath}: Loop source references undefined variable \"{{${sourceVar}}}\".\n\nHint: Make sure this variable is defined earlier in the flow or as a static variable.`);
            }
          }

          /* loop variable */
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(loopVar)) {
            result.valid = false;
            result.errors.push(`${currentPath}: Loop variable name \"${loopVar}\" is invalid.\n\nUse only letters, numbers, and underscores, and do not start with a number. Example: item1`);
          }

          const nestedScope = new Set(currentAvailableVars);
          nestedScope.add(loopVar);
          validateStepsRecursive(step.loopSteps, `${currentPath} > Loop Body`, nestedScope);
          break;
        }

        /* ■■■ UNKNOWN ─────────────────────────────────────────── */
        default:
          result.valid = false;
          result.errors.push(`${here}: Unknown step type \"${step.type}\". This may indicate a corrupted or unsupported step. Please check your flow configuration.`);
      }

      varsDefinedHere.forEach(v => availableVars.add(v));
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

