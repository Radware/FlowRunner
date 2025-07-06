// flowStepComponents.js
/**
 * flowStepComponents.js
 * Renders individual flow steps for the list view and their corresponding editor forms.
 * Uses core logic from flowCore.js.
 */

import {
  // Core logic functions needed for rendering/editing steps
  extractVariableReferences,
  findDefinedVariables, // Used within editors
  getHttpMethods,
  createNewStep, // Used by Add Step buttons within steps
  cloneStep, // Used by clone button on step header
  formatJson, // Used by Request editor format button
  validateRequestBodyJson, // Used by Request editor format button
  parseConditionString, // Used by Condition editor/renderer
  generateConditionString, // Used by Condition editor
  generateConditionPreview, // Used by Condition editor/renderer
  doesOperatorNeedValue, // Used by Condition editor
  escapeHTML, // General utility
  escapeRegExp // General utility
} from './flowCore.js'; // <--- Ensure this path is correct

import { logger } from './logger.js';

/**
 * Render a flow step element for the steps list view.
 * @param {Object} step - Step data object.
 * @param {Object} options - Rendering options.
 * @param {Object} [options.variables={}] - Available variables for highlighting.
 * @param {Function} options.onSelect - Callback when step header is clicked onSelect(stepId).
 * @param {Function} options.onUpdate - Callback for step modifications (add, move, clone) onUpdate(action).
 * @param {Function} options.onDelete - Callback when delete button is clicked onDelete(stepId). // This maps to onUpdate({type: 'delete', ...}) in the builder
 * @param {string | null} options.selectedStepId - The ID of the currently selected step for highlighting.
 * @param {boolean} [options.isNested=false] - Flag indicating if the step is rendered inside a branch/loop.
 * @param {string | null} [options.parentId=null] - ID of the parent step (for nested adds/deletes).
 * @param {string | null} [options.branch=null] - Branch name ('then' or 'else') if nested in a condition.
 * @return {HTMLElement} The rendered step element.
 */
export function renderStep(step, options) {
  // ... (existing setup) ...
  const {
    variables = {},
    onSelect,
    onUpdate, // Used for add/move/clone initiated from list view item
    onDelete, // Used for the delete button on the step header
    selectedStepId,
    isNested = false,
    parentId = null, // Capture parentId passed TO this render call
    branch = null    // Capture branch passed TO this render call
  } = options || {};

  const stepEl = document.createElement('div');
  stepEl.className = `flow-step flow-step-${step.type}`;
  stepEl.dataset.stepId = step.id;

  if (selectedStepId === step.id) {
    stepEl.classList.add('selected');
  }

  // --- Create Header ---
  const header = document.createElement('div');
  header.className = 'flow-step-header';
  header.innerHTML = `
    <span class="flow-step-drag-handle" title="Drag to reorder step" tabindex="0">☰</span>
    <span class="flow-step-icon">${getStepTypeIcon(step.type)}</span>
    <div class="flow-step-title" title="${escapeHTML(step.name || 'Unnamed Step')}">${escapeHTML(step.name || 'Unnamed Step')}</div>
    <div class="flow-step-actions">
      <button class="btn-clone" title="Clone this step">⧉</button>
      <button class="btn-delete btn-delete-node" title="Delete this step">✕</button>
    </div>
  `;

  // Header click selects the step (ignore clicks on actions/handle)
  header.addEventListener('click', (e) => {
    if (!e.target.closest('.flow-step-actions, .flow-step-drag-handle')) {
       if (onSelect) onSelect(step.id);
    }
  });

  // Clone button listener
  const cloneBtn = header.querySelector('.btn-clone');
  if (cloneBtn && onUpdate) {
    cloneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const clonedStepData = cloneStep(step); // Use core function
      // Ensure clone passes correct context for insertion logic if needed
      onUpdate({
        type: 'clone',
        originalStep: step,
        newStep: clonedStepData,
        parentId: parentId, // Pass context for insertion logic
        branch: branch      // Pass context for insertion logic
      });
    });
  }

  // Delete button listener
  const deleteBtn = header.querySelector('.btn-delete-node, .btn-delete');
  if (deleteBtn && onDelete) {
     deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // The onDelete callback (mapped from onUpdate in builder) triggers the action in app.js
        onDelete(step.id); // Correct, onDelete callback handles context
     });
  }
  stepEl.appendChild(header);

  // --- Create Content Preview ---
  const content = document.createElement('div');
  content.className = 'flow-step-content';

  // --- CRITICAL: Correctly set parentId and branch for nested calls ---
  const nestedOptions = {
      ...options,
      isNested: true,
      parentId: step.id, // Current step IS the parent for nested calls
      // branch: // branch context will be set specifically inside condition/loop renderers below
  };

  switch (step.type) {
      case 'request':
          renderRequestStepContent(content, step, options.variables); // Request doesn't need nested options directly
          break;
      case 'condition':
          // Pass nestedOptions down to condition renderer
          renderConditionStepContent(content, step, options.variables, nestedOptions);
          break;
      case 'loop':
          // Pass nestedOptions down to loop renderer
          renderLoopStepContent(content, step, options.variables, nestedOptions);
          break;
      default:
          content.innerHTML = `Unknown step type: ${escapeHTML(step.type)}`;
  }
  stepEl.appendChild(content);
  setupDragAndDrop(stepEl, options); // Apply D&D to the step element
  return stepEl;
}


// --- Step Content Preview Renderers ---

function renderRequestStepContent(container, step, variables) {
  const varNames = Object.keys(variables);
  container.innerHTML = `
    <div class="request-info">
      <span class="request-method ${step.method || 'GET'}">${step.method || 'GET'}</span>
      <span class="request-url" title="${escapeHTML(step.url || '')}">${highlightVariables(step.url, varNames)}</span>
    </div>
    <div class="request-details">
      ${step.extract && Object.keys(step.extract).length > 0 ? `<div class="request-extractions"><span>Extracts:</span> ${Object.keys(step.extract).map(varName => `<span class="extraction-badge">${escapeHTML(varName)}</span>`).join('')}</div>` : ''}
      ${step.headers && Object.keys(step.headers).length > 0 ? `<div class="request-headers-badge">${Object.keys(step.headers).length} Header(s)</div>` : ''}
      ${step.body && String(step.body).trim() ? `<div class="request-body-badge">Has Body</div>` : ''}
    </div>
  `;
}

function renderConditionStepContent(container, step, variables, options) {
    const { onUpdate, parentId, onSelect } = options; // parentId here IS the ID of the condition step itself, get onSelect too

    let conditionDisplay = 'No condition set';
    if (step.conditionData?.variable && step.conditionData.operator) {
        conditionDisplay = generateConditionPreview(step.conditionData);
    } else if (step.condition) {
        const parsed = parseConditionString(step.condition);
        conditionDisplay = parsed.preview || escapeHTML(step.condition); // Use preview or escaped original
    }

    container.innerHTML = `
        <div class="condition-expression"> <span class="condition-if">If:</span> <code class="condition-code">${conditionDisplay}</code> </div>
        <div class="condition-branches">
          <div class="branch then-branch"> <div class="branch-header">Then</div> <div class="branch-steps" data-branch-container="then"></div> <button class="btn-add-step" data-branch="then" title="Add step to 'Then'">+ Add Step</button> </div>
          <div class="branch else-branch"> <div class="branch-header">Else</div> <div class="branch-steps" data-branch-container="else"></div> <button class="btn-add-step" data-branch="else" title="Add step to 'Else'">+ Add Step</button> </div>
        </div>`;

    const thenContainer = container.querySelector('[data-branch-container="then"]');
    if (step.thenSteps?.length) {
        step.thenSteps.forEach(child => thenContainer.appendChild(
            renderStep(child, { ...options, branch: 'then' }) // Pass 'then' branch context
        ));
    } else { thenContainer.innerHTML = '<div class="empty-branch">(empty)</div>'; }

    const elseContainer = container.querySelector('[data-branch-container="else"]');
    if (step.elseSteps?.length) {
        step.elseSteps.forEach(child => elseContainer.appendChild(
             renderStep(child, { ...options, branch: 'else' }) // Pass 'else' branch context
         ));
    } else { elseContainer.innerHTML = '<div class="empty-branch">(empty)</div>'; }

    // Add Step Buttons within branches
    container.querySelectorAll('.btn-add-step').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetBranch = button.dataset.branch; // 'then' or 'else'
            if (onUpdate && parentId) { // parentId is the condition step ID
                if (typeof window.showAppStepTypeDialog === 'function') {
                   window.showAppStepTypeDialog(type => {
                       if (type) {
                           const newStep = createNewStep(type);
                           // --- Use correct parentId and targetBranch ---
                           onUpdate({ type: 'add', step: newStep, parentId: parentId, branch: targetBranch });
                       }
                   });
                } else { logger.error("App's step type dialog function not found."); }
            } else { logger.error("Cannot add nested step: Missing onUpdate or parentId (condition ID)."); }
        });
    });
}

function renderLoopStepContent(container, step, variables, options) {
   const { onUpdate, parentId, onSelect } = options; // parentId here IS the ID of the loop step itself, get onSelect too
   const varNames = Object.keys(variables);

   container.innerHTML = `
    <div class="loop-config"> <div class="loop-source-row"> <span class="loop-label">For each in:</span> <code class="loop-source">${highlightVariables(`{{${step.source}}}`, varNames)}</code> </div> <div class="loop-variable-row"> <span class="loop-label">As:</span> <code class="loop-variable">${escapeHTML(step.loopVariable || 'item')}</code> </div> </div>
    <div class="loop-body"> <div class="loop-header">Loop Body</div> <div class="loop-steps" data-loop-container="body"></div> <button class="btn-add-loop-step" title="Add step inside loop">+ Add Step</button> </div>`;
   const loopContainer = container.querySelector('[data-loop-container="body"]');
   if (step.loopSteps?.length) {
       const loopVariables = { ...variables }; // Pass down current variables
       if (step.loopVariable) { // Add loop variable to scope for children
           loopVariables[step.loopVariable] = { origin: step.name || 'Loop Step', type: 'loop', stepId: step.id };
       }
       step.loopSteps.forEach(child => loopContainer.appendChild(
           renderStep(child, { ...options, variables: loopVariables /*, branch: null */ }) // No branch for loop children
       ));
   } else { loopContainer.innerHTML = '<div class="empty-branch">(empty)</div>'; }

   // Add Step Button within loop body
   container.querySelector('.btn-add-loop-step').addEventListener('click', (e) => {
      e.stopPropagation();
      if (onUpdate && parentId) { // parentId is the loop step ID
           if (typeof window.showAppStepTypeDialog === 'function') {
              window.showAppStepTypeDialog(type => {
                  if (type) {
                     const newStep = createNewStep(type);
                     // --- Use correct parentId, branch is null for loop ---
                     onUpdate({ type: 'add', step: newStep, parentId: parentId, branch: null });
                 }
               });
           } else { logger.error("App's step type dialog function not found."); }
      } else { logger.error("Cannot add loop step: Missing onUpdate or parentId (loop ID)."); }
   });
}

// --- Drag and Drop Setup ---

function setupDragAndDrop(stepEl, options) {
  const dragHandle = stepEl.querySelector('.flow-step-drag-handle');
  if (!dragHandle || !options.onUpdate) { // Check for onUpdate callback existence
       // If no callback, disable D&D
       if (dragHandle) dragHandle.draggable = false;
       return;
  }
  dragHandle.draggable = true;

  dragHandle.addEventListener('dragstart', (e) => {
    // Only allow drag from handle itself
    if (!e.target.classList.contains('flow-step-drag-handle')) { e.preventDefault(); return; }

    const stepId = stepEl.dataset.stepId;
    if (!stepId) return;

    e.dataTransfer.setData('text/plain', stepId);
    e.dataTransfer.effectAllowed = 'move';
    // Delay adding class slightly for better drag image capture
    setTimeout(() => stepEl.classList.add('dragging'), 0);
    document.body.classList.add('flow-step-dragging'); // Global indicator class
    e.stopPropagation();
  });

  dragHandle.addEventListener('dragend', () => {
    // Clean up styles on the dragged element and body
    stepEl.classList.remove('dragging');
    document.body.classList.remove('flow-step-dragging');
    // Ensure any leftover drop indicators are removed globally
    document.querySelectorAll('.flow-step.drop-before, .flow-step.drop-after').forEach(el => {
        el.classList.remove('drop-before', 'drop-after');
    });
  });

  // Listeners on the step element itself as a potential drop target
  stepEl.addEventListener('dragover', (e) => {
    e.preventDefault(); // Necessary to allow dropping

    const draggingEl = document.querySelector('.flow-step.dragging');
    // Prevent dropping on self or inside the content area (only allow dropping relative to the *step element itself*)
    // Also prevent dropping a parent step onto one of its descendants
    if (!draggingEl || draggingEl === stepEl || stepEl.contains(draggingEl) || e.target.closest('.flow-step-content')) {
        e.dataTransfer.dropEffect = 'none';
        stepEl.classList.remove('drop-before', 'drop-after'); // Clear indicators if invalid
        return;
    }
    e.dataTransfer.dropEffect = 'move';

    // Determine position based on vertical midpoint
    const rect = stepEl.getBoundingClientRect();
    const isBefore = e.clientY < (rect.top + rect.height / 2);
    // Apply indicator classes (only one should be active)
    // Check if already set correctly to avoid excessive toggling
    if (isBefore && !stepEl.classList.contains('drop-before')) {
       stepEl.classList.add('drop-before');
       stepEl.classList.remove('drop-after');
    } else if (!isBefore && !stepEl.classList.contains('drop-after')) {
       stepEl.classList.add('drop-after');
       stepEl.classList.remove('drop-before');
    }
  });

  stepEl.addEventListener('dragleave', (e) => {
      // Remove indicators only if leaving the element entirely
      // relatedTarget is the element the cursor is entering
      if (!stepEl.contains(e.relatedTarget)) {
        stepEl.classList.remove('drop-before', 'drop-after');
      }
  });

  stepEl.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent bubbling to parent elements

    const sourceStepId = e.dataTransfer.getData('text/plain');
    const targetStepId = stepEl.dataset.stepId;
    const draggingEl = document.querySelector('.flow-step.dragging'); // Get the element being dragged

     // --- Final Validation on Drop ---
     // Check source/target IDs and ensure not dropping on self or parent onto descendant
    if (!sourceStepId || !targetStepId || sourceStepId === targetStepId || (draggingEl && stepEl.contains(draggingEl)) ) {
         stepEl.classList.remove('drop-before', 'drop-after');
         if (draggingEl) draggingEl.classList.remove('dragging');
         return;
    }
    // Prevent dropping inside content (redundant check, but safe)
    if (e.target.closest('.flow-step-content')) {
         stepEl.classList.remove('drop-before', 'drop-after');
         if (draggingEl) draggingEl.classList.remove('dragging');
         return;
    }

    // Determine position from class (more reliable than mouse coords at drop time)
    const position = stepEl.classList.contains('drop-before') ? 'before' : 'after';
    // Clean up indicators immediately
    stepEl.classList.remove('drop-before', 'drop-after');
    if (draggingEl) draggingEl.classList.remove('dragging'); // Also remove dragging class from source

    logger.info(`Drop detected: Move ${sourceStepId} ${position} ${targetStepId}`);

    // Trigger the move action via the onUpdate callback provided in options
    try {
        options.onUpdate({ type: 'move', sourceStepId, targetStepId, position });
    } catch (updateError) {
        logger.error("Error triggering move update from drop:", updateError);
        // Optionally show message, though app.js handler should manage errors
    }
  });
}


// --- Step Editor Creation ---

/**
 * Creates the main editor form structure for a selected step.
 * Handles Save/Cancel and dirty state tracking.
 * @param {Object} step - The step data object being edited.
 * @param {Object} options - Editor options.
 * @param {Object} [options.variables={}] - Available variables map.
 * @param {Function} options.onChange - Callback triggered on Save: onChange(updatedStepData).
 * @param {Function} [options.onDirtyChange] - Callback for dirty state changes: onDirtyChange(isDirty).
 * @return {HTMLElement} The editor form element.
 */
export function createStepEditor(step, options) {
  // --- CRITICAL: Check if step data is valid ---
  if (!step || !step.id || !step.type) {
      logger.error("Cannot create step editor: Invalid step data provided.", step);
      const errorEl = document.createElement('div');
      errorEl.className = 'step-editor error-message';
      errorEl.textContent = "Error: Could not load editor for this step. Step data is missing or invalid.";
      return errorEl;
  }

  const { variables = {}, onChange, onDirtyChange } = options || {};

  let localStep; // Local copy for editing
  let originalStep; // Store for cancellation
  try {
       localStep = JSON.parse(JSON.stringify(step));
       originalStep = JSON.parse(JSON.stringify(step)); // Keep clean copy for revert
   } catch (e) {
       logger.error("Failed to clone step for editing:", e);
       const errorEl = document.createElement('div'); errorEl.textContent="Error initializing editor state."; return errorEl;
   }
  let isDirty = false;

  // --- Dirty State Management ---
  function setDirtyState(dirty) {
      if (isDirty === dirty) return; // No change
      isDirty = dirty;
      if (saveBtn) saveBtn.disabled = !isDirty; // Update save button state (check if saveBtn exists)
      if (typeof onDirtyChange === 'function') {
          try { onDirtyChange(isDirty); } // Notify parent component
          catch (callbackError) { logger.error("Error in onDirtyChange callback:", callbackError); }
      }
  }

  // --- Create Editor Structure (remains same) ---
  const editorEl = document.createElement('div');
  editorEl.className = 'step-editor';
  editorEl.innerHTML = `
    <div class="step-editor-content">
      <div class="editor-header"> <h3>Edit: ${getStepTypeLabel(localStep.type)} Step</h3> </div>
      <div class="form-group"> <label for="step-editor-name-${localStep.id}">Step Name</label> <input type="text" id="step-editor-name-${localStep.id}" value="${escapeHTML(localStep.name || '')}" placeholder="Enter a descriptive name"> </div>
      <div class="step-save-message" style="display: none; color: green; margin: 0.5rem 0; font-weight: bold;"> Step changes saved! </div>
      <div class="editor-type-content"> <!-- Type-specific fields go here --> </div>
    </div>
    <div class="step-editor-actions"> <button class="btn-save-step" title="Save changes to this step" disabled>Save Step</button> <button class="btn-cancel-step" title="Discard changes and revert">Cancel</button> </div>
  `;

  // --- Get References (remains same) ---
  const nameInput = editorEl.querySelector(`#step-editor-name-${localStep.id}`);
  const typeContentContainer = editorEl.querySelector('.editor-type-content');
  const saveMessageEl = editorEl.querySelector('.step-save-message');
  const saveBtn = editorEl.querySelector('.btn-save-step');
  const cancelBtn = editorEl.querySelector('.btn-cancel-step');

  // --- Populate Type-Specific Editor ---
  // Pass setDirtyState down
  const editorOptions = { variables, localStep, setDirtyState };
  try { // Wrap sub-editor creation
       switch (localStep.type) {
          case 'request': createRequestEditor(typeContentContainer, editorOptions); break;
          case 'condition': createConditionEditor(typeContentContainer, editorOptions); break;
          case 'loop': createLoopEditor(typeContentContainer, editorOptions); break;
          default: typeContentContainer.textContent = `Editor not available for type: ${localStep.type}`;
       }
  } catch (subEditorError) {
       logger.error(`Error creating editor for type ${localStep.type}:`, subEditorError);
       typeContentContainer.innerHTML = `<p style="color: red;">Error loading ${localStep.type} editor fields.</p>`;
       // Disable save button if sub-editor failed
       if (saveBtn) saveBtn.disabled = true;
       setDirtyState(false); // Not technically dirty if fields failed to load
  }

  // --- Event Listeners ---
  nameInput.addEventListener('input', () => {
    localStep.name = nameInput.value;
    setDirtyState(true); // Mark dirty on name change
  });

  // Save Button
  saveBtn.addEventListener('click', () => {
      if (!isDirty) return; // Do nothing if not dirty

      // Perform pre-save logic and validation (moved from createStepEditor main body)
       if (localStep.type === 'condition') {
           if (localStep.conditionData?.variable && localStep.conditionData?.operator) {
               localStep.condition = generateConditionString(localStep.conditionData);
           } else {
                // Validation: Condition requires variable and operator
                alert("Condition Error: Please select both a variable and an operator.");
                const varSelect = editorEl.querySelector(`#cond-var-${localStep.id}`);
                if (varSelect?.value === '') varSelect.focus();
                else editorEl.querySelector(`#cond-op-${localStep.id}`)?.focus();
                return; // Prevent saving invalid state
           }
       }
      if (localStep.type === 'loop') {
          const loopVar = localStep.loopVariable?.trim();
          if (!loopVar || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(loopVar)) {
              alert("Loop Error: Invalid 'Item Variable Name'. Please use a valid JavaScript variable name.");
              const varInput = editorEl.querySelector(`#loop-variable-${localStep.id}`);
              if (varInput) { varInput.focus(); varInput.style.borderColor = 'red'; }
              return; // Prevent saving invalid state
          }
          let sourceVar = localStep.source?.trim();
          // Accept either {{var}} or raw var, but always store as raw var
          if (sourceVar && sourceVar.startsWith('{{') && sourceVar.endsWith('}}')) {
              sourceVar = sourceVar.slice(2, -2).trim();
          }
          localStep.source = sourceVar;
          if (!sourceVar) {
              alert("Loop Error: 'Source' must be a variable reference like {{arrayVariable}}.");
              const sourceInput = editorEl.querySelector(`#loop-source-${localStep.id}`);
              if (sourceInput) sourceInput.focus();
              return;
          }
      }
       // Add more validation for Request step if needed (e.g., URL format)

      // If validation passes, call parent's onChange with the updated local step data
      if (onChange) {
          try { onChange(localStep); } // Pass the modified localStep
          catch (callbackError) { logger.error("Error in editor save onChange callback:", callbackError); }
      }
      if (saveMessageEl) { // Check element exists
           saveMessageEl.style.display = 'block';
           setTimeout(() => { if (saveMessageEl) saveMessageEl.style.display = 'none'; }, 2500);
      }
      setDirtyState(false); // Reset dirty state after successful save
  });

  // Cancel Button
  cancelBtn.addEventListener('click', () => {
      if (isDirty && !confirm("Discard unsaved changes to this step?")) {
          return; // User canceled the discard action
      }

      // If discarding or wasn't dirty, reset state and UI
      isDirty = false; // Reset local dirty flag first

      // --- CRITICAL: Reset localStep object to original state ---
      try { localStep = JSON.parse(JSON.stringify(originalStep)); }
      catch(e) { logger.error("Failed to revert localStep on cancel:", e); /* Handle error */ return; }

      // Reset the UI by re-rendering the editor with original data
      nameInput.value = localStep.name || ''; // Reset name input
      typeContentContainer.innerHTML = ''; // Clear current specific fields

       // Re-create sub-editor with original data and pass the *same* setDirtyState function
       const revertOptions = { variables, localStep, setDirtyState };
      try {
           switch (localStep.type) {
              case 'request': createRequestEditor(typeContentContainer, revertOptions); break;
              case 'condition': createConditionEditor(typeContentContainer, revertOptions); break;
              case 'loop': createLoopEditor(typeContentContainer, revertOptions); break;
              default: typeContentContainer.textContent = `Editor not available for type: ${localStep.type}`;
           }
      } catch (revertError) {
           logger.error(`Error reverting editor for type ${localStep.type}:`, revertError);
           typeContentContainer.innerHTML = `<p style="color: red;">Error reverting editor fields.</p>`;
      }

      // Ensure save button is disabled and notify parent that state is clean
       if (saveBtn) saveBtn.disabled = true;
       if (typeof onDirtyChange === 'function') {
            try { onDirtyChange(false); }
            catch (callbackError) { logger.error("Error in onDirtyChange callback during cancel:", callbackError); }
       }

       // Note: We do NOT call onChange(originalStep) here anymore. The editor simply resets itself.
       // The parent (app.js) already knows the original state and doesn't need explicit notification of cancellation *unless*
       // the cancellation implies a change in the overall flow's dirty state (which setDirtyState(false) handles via onDirtyChange).
  });

  return editorEl;
}


// --- Type-Specific Editor Creation Functions ---

// --- [Modified Code] --- in createRequestEditor
function createRequestEditor(container, options) {
    const { localStep, variables, setDirtyState } = options; // Get setDirtyState callback
    const availableVarNames = Object.keys(variables);

    // --- MODIFICATION START: Add onFailure HTML ---
    container.innerHTML = `
        <div class="form-group"> <label for="request-method-${localStep.id}">Method</label> <select id="request-method-${localStep.id}">${getHttpMethods().map(m => `<option value="${m}" ${localStep.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select> </div>
        <div class="form-group"> <label for="request-url-${localStep.id}">URL</label> <div class="input-with-vars"> <input type="text" id="request-url-${localStep.id}" value="${escapeHTML(localStep.url || '')}" placeholder="e.g., https://api.example.com/users/{{userId}}"> <button class="btn-insert-var" data-target-input="request-url-${localStep.id}">{{…}}</button> </div> </div>

        <div class="form-tabs">
            <div class="tab-buttons">
                 <button class="tab-button active" data-tab="headers">Headers (${Object.keys(localStep.headers || {}).length})</button>
                 <button class="tab-button" data-tab="body">Body</button>
                 <button class="tab-button" data-tab="extract">Extract (${Object.keys(localStep.extract || {}).length})</button>
                 <button class="tab-button" data-tab="options">Options</button> <!-- Optional: New tab for options like onFailure -->
            </div>

            <div class="tab-content active" id="tab-headers-${localStep.id}">
                <div class="headers-editor"><div class="headers-list"></div><button class="btn-add-header" style="margin-top:10px;">+ Add Header</button></div>
            </div>
            <div class="tab-content" id="tab-body-${localStep.id}">
                <div class="form-group"><label for="request-body-${localStep.id}">Request Body (JSON)</label><textarea id="request-body-${localStep.id}" rows="10" placeholder='e.g.,\n{\n "key": "value",\n "id": {{var}}\n}'>${escapeHTML(localStep.body || '')}</textarea><div class="form-hint">Use "{{var}}" for strings, {{var}} for numbers/booleans.</div><div class="body-actions"><button class="btn-format-json">Format</button><button class="btn-insert-var" data-target-input="request-body-${localStep.id}">Insert Var</button></div><div class="json-validation-error" style="color:red;margin-top:5px;font-size:0.9em;display:none;"></div></div>
            </div>
            <div class="tab-content" id="tab-extract-${localStep.id}">
                <div class="extract-editor"><div class="extracts-list"></div><button class="btn-add-extract" style="margin-top:10px;">+ Add Extraction</button><p class="form-hint">Extract values via dot notation (<code>body.data.token</code>), array index (<code>body.items[0].id</code>), or keywords (<code>.status</code>, <code>headers.Content-Type</code>, <code>body</code>).</p></div>
            </div>
             <div class="tab-content" id="tab-options-${localStep.id}">
                 <div class="form-group">
                    <label for="request-onfailure-${localStep.id}">On Failure (Network Error or Non-2xx Status)</label>
                    <select id="request-onfailure-${localStep.id}">
                        <option value="stop" ${!localStep.onFailure || localStep.onFailure === 'stop' ? 'selected' : ''}>Stop Flow Execution</option>
                        <option value="continue" ${localStep.onFailure === 'continue' ? 'selected' : ''}>Continue Flow Execution</option>
                    </select>
                    <p class="form-hint">Choose behavior when a request fails (network error or status >= 300). 'Stop' halts the entire flow. 'Continue' logs the result and proceeds.</p>
                </div>
            </div>
        </div>`;
    // --- MODIFICATION END ---

    const methodSelect = container.querySelector(`#request-method-${localStep.id}`);
    const urlInput = container.querySelector(`#request-url-${localStep.id}`);
    const bodyTextarea = container.querySelector(`#request-body-${localStep.id}`);
    const formatBtn = container.querySelector('.btn-format-json');
    const bodyError = container.querySelector('.json-validation-error');
    const headersTabBtn = container.querySelector('[data-tab="headers"]');
    const extractTabBtn = container.querySelector('[data-tab="extract"]');
    // --- MODIFICATION START: Get onFailure select ---
    const onFailureSelect = container.querySelector(`#request-onfailure-${localStep.id}`);
    // --- MODIFICATION END ---

    // --- Existing listeners + NEW onFailure listener ---
    methodSelect.addEventListener('change', () => { localStep.method = methodSelect.value; setDirtyState(true); });
    urlInput.addEventListener('input', () => { localStep.url = urlInput.value; setDirtyState(true); });
    bodyTextarea.addEventListener('input', () => { localStep.body = bodyTextarea.value; bodyError.style.display = 'none'; setDirtyState(true); });
    // --- MODIFICATION START: Add listener for onFailure ---
    onFailureSelect.addEventListener('change', () => {
        localStep.onFailure = onFailureSelect.value;
        setDirtyState(true); // Mark dirty when failure behavior changes
    });
    // --- MODIFICATION END ---

    // ... (rest of formatBtn listener, setupHeadersEditor, setupExtractEditor, tab switching, etc. remain the same) ...
     // Setup sub-editors - they call onChange which MUST call setDirtyState(true)
    setupHeadersEditor(container.querySelector('.headers-editor'), localStep.headers || {}, availableVarNames, (hdrs) => {
        localStep.headers = hdrs;
        headersTabBtn.textContent = `Headers (${Object.keys(hdrs).length})`;
        setDirtyState(true); // Ensure sub-editor changes mark dirty
    });
    setupExtractEditor(container.querySelector('.extract-editor'), localStep.extract || {}, (exts) => {
        localStep.extract = exts;
        extractTabBtn.textContent = `Extract (${Object.keys(exts).length})`;
        setDirtyState(true); // Ensure sub-editor changes mark dirty
    });

    // Tab switching logic
    container.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.tab-button, .tab-content').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
            container.querySelector(`#tab-${btn.dataset.tab}-${localStep.id}`).classList.add('active');
        });
    });

    // Add tooltips to tab buttons in editors
    container.querySelectorAll('.tab-button').forEach(btn => {
      if (btn.dataset.tab === 'headers') btn.title = 'Edit request headers';
      else if (btn.dataset.tab === 'body') btn.title = 'Edit request body';
      else if (btn.dataset.tab === 'extract') btn.title = 'Extract variables from response';
      else if (btn.dataset.tab === 'options') btn.title = 'Request options and error handling';
    });

    // Setup variable insert buttons (delegated to app.js listener)
    container.querySelectorAll('.btn-insert-var').forEach(btn => {
         const targetInput = container.querySelector(`#${btn.dataset.targetInput}`);
         if (targetInput) setupVariableInsertButton(btn, targetInput, availableVarNames);
    });
}

function createConditionEditor(container, options) {
    const { localStep, variables, setDirtyState } = options; // Get setDirtyState
    const availableVarNames = Object.keys(variables);

    // (Ensure conditionData structure - same as before)
     if (!localStep.conditionData?.variable || !localStep.conditionData.operator) {
        const parsed = parseConditionString(localStep.condition || '');
        if (parsed.variable && parsed.operator) localStep.conditionData = parsed;
    }
    localStep.conditionData = { variable: '', operator: '', value: '', preview: '', ...(localStep.conditionData || {}) };
    if (localStep.conditionData.variable && localStep.conditionData.operator) {
         localStep.conditionData.preview = generateConditionPreview(localStep.conditionData);
    } else {
        localStep.conditionData.preview = 'Select variable and operator';
    }

    // --- PATCH: Add Path input after Variable select ---
    const pathValue = localStep.conditionData.variable.split('.').slice(1).join('.') || '';
    container.innerHTML = `
        <div class="form-group"><label>Condition Logic</label><div class="condition-builder">
        <div class="condition-row">
            <div class="condition-item"><label for="cond-var-${localStep.id}">Variable</label><select id="cond-var-${localStep.id}"><option value="">-- Select --</option>${availableVarNames.sort().map(v => `<option value="${escapeHTML(v)}" ${localStep.conditionData.variable.split('.')[0] === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}</select></div>
            <div class="condition-item"><label for="cond-path-${localStep.id}">Path</label><input type="text" id="cond-path-${localStep.id}" value="${escapeHTML(pathValue)}" placeholder="e.g. title"></div>
            <div class="condition-item"><label for="cond-op-${localStep.id}">Operator</label><select id="cond-op-${localStep.id}"> <option value="">-- Select --</option> <optgroup label="Comparison"><option value="equals">equals</option><option value="not_equals">not equals</option><option value="greater_than">&gt; (number)</option><option value="less_than">&lt; (number)</option><option value="greater_equals">&gt;= (number)</option><option value="less_equals">&lt;= (number)</option></optgroup> <optgroup label="Text"><option value="contains">contains</option><option value="starts_with">starts with</option><option value="ends_with">ends with</option><option value="matches_regex">matches regex</option></optgroup> <optgroup label="Existence"><option value="exists">exists</option><option value="not_exists">does not exist</option></optgroup> <optgroup label="Type"><option value="is_number">is number</option><option value="is_text">is text</option><option value="is_boolean">is boolean</option><option value="is_array">is array</option></optgroup> <optgroup label="Boolean"><option value="is_true">is true</option><option value="is_false">is false</option></optgroup> </select></div>
            <div class="condition-item" id="cond-val-cont-${localStep.id}"><label for="cond-val-${localStep.id}">Value</label><div class="input-with-vars"><input type="text" id="cond-val-${localStep.id}" value="${escapeHTML(localStep.conditionData.value)}" placeholder="Enter value"><button class="btn-insert-var" data-target-input="cond-val-${localStep.id}">{{…}}</button></div></div>
        </div>
        <div class="condition-preview"><label>Preview:</label><pre id="cond-preview-${localStep.id}">${escapeHTML(localStep.conditionData.preview)}</pre></div>
        </div></div>
        <div class="branches-info"><div class="branch-info then-info"><h4>Then</h4><p>${(localStep.thenSteps?.length || 0)} step(s)</p></div><div class="branch-info else-info"><h4>Else</h4><p>${(localStep.elseSteps?.length || 0)} step(s)</p></div></div>`;
    // --- End innerHTML ---

    const varSelect = container.querySelector(`#cond-var-${localStep.id}`);
    const pathInput = container.querySelector(`#cond-path-${localStep.id}`);
    const opSelect = container.querySelector(`#cond-op-${localStep.id}`);
    const valInput = container.querySelector(`#cond-val-${localStep.id}`);
    const valContainer = container.querySelector(`#cond-val-cont-${localStep.id}`);
    const previewEl = container.querySelector(`#cond-preview-${localStep.id}`);

    if (localStep.conditionData.operator) opSelect.value = localStep.conditionData.operator;

    function updateState() {
        const needsValue = doesOperatorNeedValue(opSelect.value);
        valContainer.style.display = needsValue ? '' : 'none';
        const base   = varSelect.value;
        const sub    = pathInput.value.trim();
        const full   = sub ? `${base}.${sub}` : base;
        localStep.conditionData = {
          variable: full,
          operator: opSelect.value,
          value   : needsValue ? valInput.value : ''
        };
        localStep.conditionData.preview = generateConditionPreview(localStep.conditionData);
        previewEl.textContent = escapeHTML(localStep.conditionData.preview);
        // Don't call setDirtyState here directly, let the event listeners do it
    }

    // --- MODIFICATION START: Add immediate dirty listeners ---
    varSelect.addEventListener('change', () => { updateState(); setDirtyState(true); });
    pathInput.addEventListener('input', () => { updateState(); setDirtyState(true); });
    opSelect.addEventListener('change', () => { updateState(); setDirtyState(true); });
    valInput.addEventListener('input', () => { updateState(); setDirtyState(true); }); // Use 'input' for value field
    // --- MODIFICATION END ---

    updateState(); // Initial setup (doesn't mark dirty)
     // Setup insert button (delegated)
    setupVariableInsertButton(container.querySelector(`#cond-val-cont-${localStep.id} .btn-insert-var`), valInput, availableVarNames);
}

function createLoopEditor(container, options) {
    const { localStep, variables, setDirtyState } = options; // Get setDirtyState
    const availableVarNames = Object.keys(variables);

    // --- Existing innerHTML setup ---
     container.innerHTML = `
        <div class="form-group"> <label for="loop-source-${localStep.id}">Source (Array Variable)</label> <div class="input-with-vars"> <input type="text" id="loop-source-${localStep.id}" value="${escapeHTML(localStep.source || '')}" placeholder="e.g., {{apiResponse.items}}"> <button class="btn-insert-var" data-target-input="loop-source-${localStep.id}">{{…}}</button> </div> <p class="form-hint">Variable like <code>{{varName}}</code> resolving to an array.</p> </div>
        <div class="form-group"> <label for="loop-variable-${localStep.id}">Item Variable Name</label> <input type="text" id="loop-variable-${localStep.id}" value="${escapeHTML(localStep.loopVariable || 'item')}" placeholder="e.g., item"> <p class="form-hint">Name for each item (e.g., {{item}}).</p> <div class="loop-var-validation-error" style="color:red;margin-top:5px;font-size:0.9em;display:none;"></div> </div>
        <div class="loop-steps-info"><h4>Loop Body</h4><p>${(localStep.loopSteps?.length || 0)} step(s)</p></div>`;
    // --- End innerHTML ---

    const sourceInput = container.querySelector(`#loop-source-${localStep.id}`);
    const varInput = container.querySelector(`#loop-variable-${localStep.id}`);
    const varError = container.querySelector('.loop-var-validation-error');

    // --- MODIFICATION START: Validation helper & listeners ---
    function validateVarInput(name) {
        if (!name) {
            varError.textContent = 'Item variable name is required.';
            varError.style.display = 'block';
            varInput.style.borderColor = 'red';
        } else if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
            varError.textContent = 'Invalid name. Use only letters, numbers, _ or $. Cannot start with a number. Example: item1';
            varError.style.display = 'block';
            varInput.style.borderColor = 'red';
        } else {
            varError.style.display = 'none';
            varInput.style.borderColor = '';
        }
    }

    varInput.addEventListener('input', () => {
        const name = varInput.value.trim();
        localStep.loopVariable = name;
        validateVarInput(name);
        setDirtyState(true); /* Immediate dirty */
    });
    // Initial validation without triggering dirty state
    validateVarInput(varInput.value.trim());

    sourceInput.addEventListener('input', () => { localStep.source = sourceInput.value; setDirtyState(true); /* Immediate dirty */ });
    // --- MODIFICATION END ---

     // Setup insert button (delegated)
    setupVariableInsertButton(container.querySelector(`#loop-source-${localStep.id}`).closest('.input-with-vars').querySelector('.btn-insert-var'), sourceInput, availableVarNames);
}


// ----- KeyValue Editor Helpers -----

function setupKeyValueEditor(editorContainer, initialItems, availableVarNames, onChange, config) {
    // ... (get listContainer, addButton, currentItems) ...
    const listContainer = editorContainer.querySelector(config.listSelector);
    const addButton = editorContainer.querySelector(config.addBtnSelector);
    let currentItems = { ...(initialItems || {}) };

    function renderAndBind() {
        listContainer.innerHTML = renderKeyValueList(currentItems, config);
        bindRowListeners();
        // ... (no items msg logic) ...
        const noItemsMsg = listContainer.querySelector(`.${config.itemClass}-no-items`);
        if (noItemsMsg && Object.keys(currentItems).length > 0) noItemsMsg.remove();
        else if (!noItemsMsg && Object.keys(currentItems).length === 0 && config.noItemsMsg) listContainer.innerHTML = `<div class="${config.itemClass}-no-items">${config.noItemsMsg}</div>`;

    }

    function bindRowListeners() {
        listContainer.querySelectorAll(`.${config.itemClass}`).forEach(row => {
            row.addEventListener('input', (e) => {
                 // Update model on input in either key or value field
                 if (e.target.matches(`.${config.keyClass}, .${config.valueClass}`)) {
                     // --- MODIFICATION START: Ensure dirty state is set ---
                     // Call updateModelFromView, which will call onChange, which SHOULD call setDirtyState(true) in the parent editor.
                     // If there's any doubt, add a direct call here, but it should be handled by the onChange chain.
                     // Example Direct Call (if needed):
                     // if (typeof options.setDirtyState === 'function') { options.setDirtyState(true); }
                     updateModelFromView();
                     // --- MODIFICATION END ---
                 }
             });
             row.addEventListener('click', (e) => {
                 if (e.target.matches(`.${config.removeBtnClass}`)) {
                     row.remove(); updateModelFromView(); // Update model after removing row
                     // Re-render only if list becomes empty to show the message
                     if (Object.keys(currentItems).length === 0) renderAndBind();
                 }
                 // Variable insert button handled globally
             });
             if (config.includeVarInsert) {
                  const insertBtn = row.querySelector('.btn-insert-var');
                  const valueInput = row.querySelector(`.${config.valueClass}`);
                  if (insertBtn && valueInput) setupVariableInsertButton(insertBtn, valueInput, availableVarNames);
             }
        });
    }

    function updateModelFromView() {
        // ... (logic to build newItems from UI) ...
        const newItems = {};
        listContainer.querySelectorAll(`.${config.itemClass}`).forEach(row => {
            try { // Add try-catch around DOM access
                const keyInput = row.querySelector(`.${config.keyClass}`);
                const valueInput = row.querySelector(`.${config.valueClass}`);
                // --- Add checks ---
                if (!keyInput || !valueInput) {
                    logger.warn("KeyValueEditor: Skipping row due to missing input elements.");
                    return;
                }
                const key = keyInput.value.trim();
                // Only add if key is not empty
                if (key) {
                     newItems[key] = valueInput.value;
                } else if (valueInput.value.trim()) {
                     // Optional: Warn if value exists but key is empty?
                     // console.warn(`KeyValueEditor: Ignoring item with value but empty key: "${valueInput.value}"`);
                }
            } catch (error) {
                logger.error("Error processing key-value row:", error, row);
            }
        });
        // Only update if the object actually changed (shallow compare for simple cases)
        // Compare stringified versions as a simple way to detect changes in keys or values
        if (JSON.stringify(currentItems) !== JSON.stringify(newItems)) {
             currentItems = newItems;
             // --- CRITICAL: onChange MUST trigger setDirtyState(true) in its implementation ---
             // (e.g., in createRequestEditor's setupHeadersEditor/setupExtractEditor callbacks)
             onChange(currentItems);
        }
    }

    addButton.addEventListener('click', () => {
        // ... (add new row logic) ...
        const tempKey = `new_item_${Date.now()}`; // Create a temporary unique key
        currentItems[tempKey] = ''; // Add placeholder item to model
        renderAndBind(); // Re-render the list

        // Find the newly added row and focus its key input
        const newRow = Array.from(listContainer.querySelectorAll(`.${config.itemClass}`)).find(r => r.querySelector(`.${config.keyClass}`).value === tempKey);
        if (newRow) {
             const keyInput = newRow.querySelector(`.${config.keyClass}`);
             keyInput.value = ''; // Clear the temporary key
             keyInput.focus(); // Focus for immediate editing
         }
        // --- CRITICAL: Adding a row inherently makes it dirty ---
        // Trigger onChange because items have changed (even if temporarily named)
        onChange(currentItems); // This call MUST trigger setDirtyState(true)
        // Consider if onChange should only be called *after* the user modifies the new row.
        // The current approach marks dirty immediately on add.
    });
    renderAndBind(); // Initial render
}


function renderKeyValueList(items, config) {
  if (!items || Object.keys(items).length === 0) {
       return config.noItemsMsg ? `<div class="${config.itemClass}-no-items">${config.noItemsMsg}</div>` : '';
   }
  return Object.entries(items).map(([key, value]) =>
      `<div class="${config.itemClass}">
        <input type="text" class="${config.keyClass}" value="${escapeHTML(key)}" placeholder="${config.keyPlaceholder || 'Name'}">
        <input type="text" class="${config.valueClass}" value="${escapeHTML(value)}" placeholder="${config.valuePlaceholder || 'Value'}">
        ${config.includeVarInsert ? `<button class="btn-insert-var" title="Insert Variable">{{…}}</button>` : ''}
        <button class="${config.removeBtnClass}" title="Remove Item">✕</button>
      </div>`
    ).join('');
}

function setupHeadersEditor(container, initialHeaders, availableVarNames, onChange) {
    setupKeyValueEditor(container, initialHeaders, availableVarNames, onChange, { listSelector: '.headers-list', addBtnSelector: '.btn-add-header', itemClass: 'header-row', keyClass: 'header-key', valueClass: 'header-value', removeBtnClass: 'btn-remove-header', noItemsMsg: 'No headers defined', keyPlaceholder: 'Header Name', valuePlaceholder: 'Header Value', includeVarInsert: true });
}
function setupExtractEditor(container, initialExtracts, onChange) {
    // Extracts don't need availableVarNames for insertion
    setupKeyValueEditor(container, initialExtracts, [], onChange, { listSelector: '.extracts-list', addBtnSelector: '.btn-add-extract', itemClass: 'extract-row', keyClass: 'extract-var-name', valueClass: 'extract-path', removeBtnClass: 'btn-remove-extract', noItemsMsg: 'No extractions defined', keyPlaceholder: 'Variable Name', valuePlaceholder: 'JSON Path (e.g., body.id)', includeVarInsert: false });
}


// ----- Utility Helpers -----

/**
 * Sets up a variable insert button to work with the global dropdown mechanism.
 * @param {HTMLElement} button - The button element.
 * @param {HTMLElement} targetInput - The input/textarea to insert into.
 */
function setupVariableInsertButton(button, targetInput, availableVarNames) {
    // Ensure button has the right class for the global listener
    button.classList.add('btn-insert-var');
    // Ensure target input has an ID so the global listener can find it
    if (!targetInput.id) {
        targetInput.id = `target-input-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    }
    // Link button to target input ID via data attribute
    button.dataset.targetInput = targetInput.id;
}


/**
 * Displays the application's step type selection dialog.
 * This function now relies on a globally exposed function from app.js.
 * @param {Function} onSelect - Callback function (type) => {} triggered when a type is chosen.
 */
export function showStepTypeDialog(onSelect) {
    if (typeof window.showAppStepTypeDialog === 'function') {
        window.showAppStepTypeDialog(onSelect); // Call the function exposed by app.js
    } else {
        logger.error("App's step type dialog function (window.showAppStepTypeDialog) not found.");
        alert("Error: Cannot open step type selector.");
        // Fallback or alternative behavior if needed
    }
}

function highlightVariables(text, availableVarNames) {
  if (!text || typeof text !== 'string') return escapeHTML(text);
  return escapeHTML(text).replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const trimmed   = varName.trim();
    const baseName  = trimmed.split('.')[0]; // take “slide” from “slide.title”
    const isValid   = availableVarNames.includes(baseName);
    const className = `var-ref ${isValid ? 'valid' : 'invalid'}`;
    const title = isValid ? `Variable "${trimmed}"` : `Variable "${trimmed}" (Undefined)`;
    return `<span class="${className}" title="${escapeHTML(title)}">${match}</span>`;
  });
}

export function getStepTypeIcon(type) {
  switch (type) {
    case 'request': return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';
    case 'condition': return '<svg viewBox="0 0 24 24" fill="currentColor"><path transform="translate(12,12) scale(1.4) translate(-12,-12)"d="M7 10l5-5 5 5h-3v4h3l-5 5-5-5h3v-4H7z"/></svg>';
    case 'loop': return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/></svg>';
    default: return '';
  }
}

function getStepTypeLabel(type) {
  switch (type) {
    case 'request': return 'API Request';
    case 'condition': return 'Condition';
    case 'loop': return 'Loop';
    default: return 'Step';
  }
}