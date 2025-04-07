// flowBuilderComponent.js
/**
 * flowBuilderComponent.js
 * Component responsible for rendering and managing the core flow builder UI
 * (Flow Info, Steps List, Step Editor Panel, Variables Panel).
 * It is independent of the modal wrapper and interacts via props/callbacks.
 */

import { findDefinedVariables, escapeHTML, createNewStep, cloneStep } from './flowCore.js';
import { renderStep, createStepEditor, showStepTypeDialog as showComponentStepTypeDialog } from './flowStepComponents.js'; // Import component's dialog

export class FlowBuilderComponent {
    /**
     * @param {HTMLElement} parentElement - The DOM element to render the main builder UI into.
     * @param {HTMLElement} variablesToggleMountPoint - The DOM element which *is* the variables toggle button (managed by wrapper).
     * @param {Object} options - Configuration options.
     * @param {Function} options.onFlowUpdate - Callback when flow metadata (name, desc) changes onFlowUpdate({ name, description }).
     * @param {Function} options.onHeadersUpdate - Callback when global headers change onHeadersUpdate(headers).
     * @param {Function} options.onFlowVarsUpdate - Callback when flow variables change onFlowVarsUpdate(staticVars).
     * @param {Function} options.onStepSelect - Callback when a step is selected onStepSelect(stepId).
     * @param {Function} options.onStepUpdate - Callback for step list changes (add, delete, move, clone) onStepUpdate(action).
     * @param {Function} options.onStepEdit - Callback when a step's properties are saved in the editor onStepEdit(updatedStepData).
     * @param {Function} options.onRequestAddStep - Callback to request adding a new top-level step onRequestAddStep().
     * @param {Function} options.onEditorDirtyChange - Callback when step editor dirty state changes onEditorDirtyChange(isDirty).
     */
    constructor(parentElement, variablesToggleMountPoint, options) {
        this.parentElement = parentElement;
        this.variablesToggleMountPoint = variablesToggleMountPoint; // Button element itself
        this.options = options;

        this.flowModel = null;
        this.selectedStepId = null;
        this.variables = {};
        // Panel visibility is managed by the wrapper (app.js) based on user clicks on toggle buttons

        this.uiRefs = {};
        // These refs to external panels are set during render()
        this.variablesPanelRef = null;
        this.variablesContainerRef = null;

        this._renderBaseLayout(); // Render the static structure
        this._bindBaseEventListeners(); // Bind listeners for base elements
    }

    _renderBaseLayout() {
        // Renders the main static HTML structure into the parentElement
        this.parentElement.innerHTML = `
            <!-- Flow Info Overlay Area -->
            <div class="flow-info-overlay" data-ref="infoOverlay">
                <div class="form-group">
                    <label for="flow-name-${Date.now()}">Flow Name</label> <!-- Unique ID -->
                    <input type="text" id="flow-name-${Date.now()}" data-ref="flowNameInput" placeholder="Enter a name for this flow">
                </div>
                <div class="form-group">
                    <label for="flow-description-${Date.now()}">Description</label> <!-- Unique ID -->
                    <textarea id="flow-description-${Date.now()}" data-ref="flowDescTextarea" rows="2" placeholder="Enter a description"></textarea>
                </div>

                <!-- GLOBAL HEADERS COLLAPSIBLE -->
                <div class="form-group global-headers-section">
                    <button class="collapsible-header" data-ref="globalHeadersToggle">
                        <span class="header-label">Global Headers</span>
                        <span class="toggle-icon">▼</span>
                    </button>
                    <div class="collapsible-content" data-ref="globalHeadersContent">
                        <div class="global-headers-list" data-ref="globalHeadersList">
                             <!-- Headers added dynamically -->
                        </div>
                        <button class="btn-add-global-header" data-ref="addGlobalHeaderBtn" style="margin-top: 10px;">+ Add Header</button>
                    </div>
                </div>

                <!-- FLOW VARIABLES COLLAPSIBLE -->
                <div class="form-group flow-variables-section">
                    <button class="collapsible-header" data-ref="flowVarsToggle">
                        <span class="header-label">Flow Variables</span>
                        <span class="toggle-icon">▼</span>
                    </button>
                    <div class="collapsible-content" data-ref="flowVarsContent">
                        <div class="flow-vars-list" data-ref="flowVarsList">
                             <!-- Variables added dynamically -->
                        </div>
                        <button class="btn-add-flow-var" data-ref="addFlowVarBtn" style="margin-top: 10px;">+ Add Variable</button>
                    </div>
                </div>
            </div>

            <!-- Main Builder Section (Steps & Editor) -->
            <div class="flow-builder-section" data-ref="builderSection">
                <div class="flow-steps-panel" data-ref="stepsPanel">
                    <h3>Flow Steps</h3>
                    <div class="flow-steps-container" data-ref="stepsContainer">
                        <!-- Steps rendered here -->
                    </div>
                    <div class="flow-steps-actions">
                        <button class="btn-add-step" data-ref="addTopLevelStepBtn">+ Add Step</button>
                    </div>
                </div>
                <div class="step-editor-panel" data-ref="editorPanel">
                    <div class="step-editor-placeholder" data-ref="editorPlaceholder">
                        <p>Select a step to edit its properties</p>
                    </div>
                    <div class="step-editor-container" data-ref="editorContainer">
                        <!-- Editor rendered here -->
                    </div>
                </div>
            </div>
        `;

        // Store references to key elements within the main builder UI
        this.parentElement.querySelectorAll('[data-ref]').forEach(el => {
            this.uiRefs[el.dataset.ref] = el;
        });

         // Note: The variables toggle button is assumed to exist in the wrapper's HTML
         // It's passed in as `variablesToggleMountPoint` but we don't render it.
         this.uiRefs.variablesToggleBtn = this.variablesToggleMountPoint;
    }

    _bindBaseEventListeners() {
        // Flow Info Input Listeners are bound specifically in _updateFlowInfoUI after render
        // to avoid stale closures if render is called multiple times.

        // Collapsibles
        this._setupCollapsible(this.uiRefs.globalHeadersToggle, this.uiRefs.globalHeadersContent);
        this._setupCollapsible(this.uiRefs.flowVarsToggle, this.uiRefs.flowVarsContent);

        // Add Buttons for Headers/Vars
        this.uiRefs.addGlobalHeaderBtn.addEventListener('click', () => this._addGlobalHeaderRow('', '', true)); // Trigger update on manual add
        this.uiRefs.addFlowVarBtn.addEventListener('click', () => this._addFlowVarRow('', '', true)); // Trigger update on manual add

        // Add Top-Level Step Button
        this.uiRefs.addTopLevelStepBtn.addEventListener('click', () => this.options.onRequestAddStep());

        // Variables Panel Toggle (Listener handled by wrapper - app.js)
    }

     _setupCollapsible(toggleBtn, contentEl) {
        toggleBtn.addEventListener('click', () => {
            const isActive = toggleBtn.classList.toggle('active');
            const icon = toggleBtn.querySelector('.toggle-icon');
            if (isActive) {
                contentEl.style.padding = '15px'; // Apply padding *before* measuring scrollHeight
                contentEl.style.maxHeight = contentEl.scrollHeight + 'px'; // Set max-height based on content
                if(icon) icon.textContent = '▲';
            } else {
                contentEl.style.maxHeight = '0px'; // Collapse
                // Remove padding after transition completes (or nearly)
                setTimeout(() => {
                    if (!toggleBtn.classList.contains('active')) { // Check again in case it reopened quickly
                       contentEl.style.padding = '0 15px';
                    }
                }, 300); // Match transition duration
                if(icon) icon.textContent = '▼';
            }
        });
        // Ensure initial state is correct (closed by default)
        contentEl.style.maxHeight = '0px';
        contentEl.style.padding = '0 15px'; // Initial padding state for closed
        const icon = toggleBtn.querySelector('.toggle-icon');
        if(icon) icon.textContent = '▼';
    }

    /** Public method to update the entire component UI */
    render(flowModel, selectedStepId, variablesPanelEl, variablesContainerEl) {
        this.flowModel = flowModel;
        this.selectedStepId = selectedStepId;
        this.variablesPanelRef = variablesPanelEl; // Get reference to external panel
        this.variablesContainerRef = variablesContainerEl; // Get reference to external panel's content area

        if (!this.flowModel) {
            this.uiRefs.stepsContainer.innerHTML = '<div class="empty-flow-message"><p>Loading flow...</p></div>';
            this.uiRefs.editorPlaceholder.style.display = 'flex';
            this.uiRefs.editorContainer.style.display = 'none';
            this.uiRefs.editorContainer.innerHTML = '';
            this.uiRefs.flowNameInput.value = '';
            this.uiRefs.flowDescTextarea.value = '';
            this.uiRefs.globalHeadersList.innerHTML = '<div class="no-headers-message">No global headers</div>';
            this.uiRefs.flowVarsList.innerHTML = '<div class="no-flow-vars">No flow variables</div>';
            if (this.variablesContainerRef) {
                this.variablesContainerRef.innerHTML = '<div class="no-variables-message"><p>No variables defined</p></div>';
            }
            // Clear any bound listeners on info inputs if necessary (or rebind in update)
            return;
        }

        // Update defined variables cache (used by steps list and editor)
        this.variables = findDefinedVariables(this.flowModel);

        // Update UI sections
        this._updateFlowInfoUI();
        this._updateGlobalHeadersUI();
        this._updateFlowVarsUI();
        this._updateStepsUI();
        this._updateStepEditorUI();
        this._updateVariablesPanelUI(); // Update the external variables panel content
    }

    // --- Private UI Update Methods ---

    _updateFlowInfoUI() {
        const nameInput = this.uiRefs.flowNameInput;
        const descTextarea = this.uiRefs.flowDescTextarea;

        nameInput.value = this.flowModel.name || '';
        descTextarea.value = this.flowModel.description || '';

        // Remove potential old listeners before adding new ones
         const newNameInput = nameInput.cloneNode(true);
         nameInput.parentNode.replaceChild(newNameInput, nameInput);
         this.uiRefs.flowNameInput = newNameInput; // Update ref

         const newDescTextarea = descTextarea.cloneNode(true);
         descTextarea.parentNode.replaceChild(newDescTextarea, descTextarea);
         this.uiRefs.flowDescTextarea = newDescTextarea; // Update ref


        // Bind listeners to the new nodes
        this.uiRefs.flowNameInput.addEventListener('input', (e) => {
            // Don't modify this.flowModel directly here, let the callback handle it
            this.options.onFlowUpdate({ name: e.target.value, description: this.uiRefs.flowDescTextarea.value });
        });
        this.uiRefs.flowDescTextarea.addEventListener('input', (e) => {
            this.options.onFlowUpdate({ name: this.uiRefs.flowNameInput.value, description: e.target.value });
        });
    }

     _updateGlobalHeadersUI() {
        const container = this.uiRefs.globalHeadersList;
        container.innerHTML = ''; // Clear previous
        const headers = this.flowModel.headers || {};

        if (Object.keys(headers).length === 0) {
            container.innerHTML = '<div class="global-header-row-no-items">No global headers defined</div>';
        } else {
            Object.entries(headers).forEach(([key, value]) => {
                this._addGlobalHeaderRow(key, value, false); // Add rows without triggering update initially
            });
        }
         this._adjustCollapsibleHeight(this.uiRefs.globalHeadersToggle, this.uiRefs.globalHeadersContent);
    }

     _addGlobalHeaderRow(key, value, triggerUpdate = true) {
        const container = this.uiRefs.globalHeadersList;
        const noItemsMsg = container.querySelector('.global-header-row-no-items');
        if (noItemsMsg) noItemsMsg.remove();

        const row = document.createElement('div');
        row.className = 'global-header-row'; // Use specific class
        // --- REMOVED btn-insert-var button ---
        row.innerHTML = `
            <input type="text" class="header-key" value="${escapeHTML(key)}" placeholder="Header Name">
            <input type="text" class="header-value" value="${escapeHTML(value)}" placeholder="Header Value">
            <button class="btn-remove-global-header" title="Remove Header">✕</button>
        `;
        container.appendChild(row);

        // Bind listeners for this new row
        const keyInput = row.querySelector('.header-key');
        const valueInput = row.querySelector('.header-value');
        const removeBtn = row.querySelector('.btn-remove-global-header');
        // --- REMOVED insertVarBtn reference ---
        // const insertVarBtn = row.querySelector('.btn-insert-var'); // Removed


        const updateCallback = () => {
            const currentHeaders = this._getCurrentGlobalHeadersFromUI();
            this.options.onHeadersUpdate(currentHeaders); // Notify wrapper immediately
        };

        keyInput.addEventListener('input', updateCallback);
        valueInput.addEventListener('input', updateCallback);
        removeBtn.addEventListener('click', () => {
            row.remove();
            const currentHeaders = this._getCurrentGlobalHeadersFromUI();
            if (container.children.length === 0) { // Check if empty after removing
                container.innerHTML = '<div class="global-header-row-no-items">No global headers defined</div>';
            }
            this.options.onHeadersUpdate(currentHeaders); // Notify wrapper
             this._adjustCollapsibleHeight(this.uiRefs.globalHeadersToggle, this.uiRefs.globalHeadersContent); // Adjust height
        });

        // --- REMOVED setupVariableInsertButton call ---
        // setupVariableInsertButton(insertVarBtn, valueInput, Object.keys(this.variables || {})); // Removed


        if (triggerUpdate) {
            updateCallback(); // Trigger update if manually added
        }
         this._adjustCollapsibleHeight(this.uiRefs.globalHeadersToggle, this.uiRefs.globalHeadersContent); // Adjust height after add
    }

    _getCurrentGlobalHeadersFromUI() {
        const headers = {};
        this.uiRefs.globalHeadersList.querySelectorAll('.global-header-row').forEach(row => {
            const key = row.querySelector('.header-key').value.trim();
            const value = row.querySelector('.header-value').value;
            if (key) headers[key] = value;
        });
        return headers;
    }

     _updateFlowVarsUI() {
        const container = this.uiRefs.flowVarsList;
        container.innerHTML = '';
        const staticVars = this.flowModel.staticVars || {};

        if (Object.keys(staticVars).length === 0) {
            container.innerHTML = `<div class="flow-var-row-no-items">No flow variables defined</div>`;
        } else {
            Object.entries(staticVars).forEach(([key, value]) => {
                this._addFlowVarRow(key, value, false);
            });
        }
         this._adjustCollapsibleHeight(this.uiRefs.flowVarsToggle, this.uiRefs.flowVarsContent);
    }

     _addFlowVarRow(key, value, triggerUpdate = true) {
        const container = this.uiRefs.flowVarsList;
        const noItemsMsg = container.querySelector('.flow-var-row-no-items');
        if (noItemsMsg) noItemsMsg.remove();

        const row = document.createElement('div');
        row.className = 'flow-var-row';
        // --- REMOVED btn-insert-var button ---
        row.innerHTML = `
            <input type="text" class="flow-var-key" value="${escapeHTML(key)}" placeholder="Variable Name">
            <input type="text" class="flow-var-value" value="${escapeHTML(value)}" placeholder="Variable Value">
            <button class="btn-remove-flow-var" title="Remove Variable">✕</button>
        `;
        container.appendChild(row);

        const keyInput = row.querySelector('.flow-var-key');
        const valueInput = row.querySelector('.flow-var-value');
        const removeBtn = row.querySelector('.btn-remove-flow-var');
        // --- REMOVED insertVarBtn reference ---
        // const insertVarBtn = row.querySelector('.btn-insert-var'); // Removed


        const updateCallback = () => {
            const currentVars = this._getCurrentFlowVarsFromUI();
            this.options.onFlowVarsUpdate(currentVars);
        };

        keyInput.addEventListener('input', updateCallback);
        valueInput.addEventListener('input', updateCallback);
        removeBtn.addEventListener('click', () => {
            row.remove();
            const currentVars = this._getCurrentFlowVarsFromUI();
            if (container.children.length === 0) {
                container.innerHTML = '<div class="flow-var-row-no-items">No flow variables defined</div>';
            }
            this.options.onFlowVarsUpdate(currentVars);
             this._adjustCollapsibleHeight(this.uiRefs.flowVarsToggle, this.uiRefs.flowVarsContent);
        });

        // --- REMOVED setupVariableInsertButton call ---
        // setupVariableInsertButton(insertVarBtn, valueInput, Object.keys(this.variables || {})); // Removed


        if (triggerUpdate) {
            updateCallback();
        }
         this._adjustCollapsibleHeight(this.uiRefs.flowVarsToggle, this.uiRefs.flowVarsContent);
    }

    _getCurrentFlowVarsFromUI() {
        const staticVars = {};
        this.uiRefs.flowVarsList.querySelectorAll('.flow-var-row').forEach(row => {
            const key = row.querySelector('.flow-var-key').value.trim();
            const value = row.querySelector('.flow-var-value').value;
            // Basic validation for variable names
            if (key && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
                 staticVars[key] = value;
            } else if (key) {
                 // Maybe add visual feedback for invalid key? For now, just ignore invalid ones.
                 console.warn(`Invalid variable name ignored: ${key}`);
            }
        });
        return staticVars;
    }

    // Helper to readjust collapsible height after dynamic content change
    _adjustCollapsibleHeight(toggleBtn, contentEl) {
         if (toggleBtn.classList.contains('active')) {
             contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
         }
    }


    _updateStepsUI() {
        const container = this.uiRefs.stepsContainer;
        container.innerHTML = ''; // Clear previous steps

        const steps = this.flowModel.steps || [];
        if (steps.length === 0) {
            container.innerHTML = `<div class="empty-flow-message"><p>No steps defined.</p><p>Click "+ Add Step" below.</p></div>`;
            return;
        }

        const renderOptions = {
            variables: this.variables,
            selectedStepId: this.selectedStepId,
            onSelect: this.options.onStepSelect,
            onUpdate: this.options.onStepUpdate, // Pass wrapper's update handler
            // Map the step component's onDelete request to the wrapper's onUpdate handler
            onDelete: (stepId) => this.options.onStepUpdate({ type: 'delete', stepId: stepId }),
            isNested: false
        };

        steps.forEach(step => {
            container.appendChild(renderStep(step, renderOptions));
        });
    }

    _updateStepEditorUI() {
        const editorContainer = this.uiRefs.editorContainer;
        const placeholder = this.uiRefs.editorPlaceholder;

        editorContainer.innerHTML = ''; // Clear previous editor

        if (!this.selectedStepId) {
            placeholder.style.display = 'flex';
            editorContainer.style.display = 'none';
            return;
        }

        const selectedStepData = this._findStepByIdRecursive(this.flowModel.steps, this.selectedStepId);

        if (!selectedStepData) {
            console.warn(`Selected step ID ${this.selectedStepId} not found in model.`);
            placeholder.style.display = 'flex';
            editorContainer.style.display = 'none';
            // Optionally notify parent to clear selection if step data is missing
            // this.options.onStepSelect(null);
            return;
        }

        placeholder.style.display = 'none';
        editorContainer.style.display = 'flex'; // Use flex for editor structure

        // Create and append the editor, passing the onEditorDirtyChange callback
        const editorElement = createStepEditor(selectedStepData, {
            variables: this.variables,
            onChange: this.options.onStepEdit, // Callback when editor saves/cancels
            onDirtyChange: this.options.onEditorDirtyChange // Callback for editor dirty status change
        });
        editorContainer.appendChild(editorElement);
    }

     _updateVariablesPanelUI() {
        // This method populates the content of the variables panel passed from the wrapper
        const container = this.variablesContainerRef;
        if (!container) return; // Do nothing if the container wasn't provided
        container.innerHTML = ''; // Clear previous content

        if (Object.keys(this.variables).length === 0) {
            container.innerHTML = `<div class="no-variables-message"><p>No variables defined or extracted yet.</p></div>`;
            return;
        }

        const table = document.createElement('table');
        table.className = 'variables-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Variable Name</th>
                    <th>Origin</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        const sortedVarNames = Object.keys(this.variables).sort();
        sortedVarNames.forEach(name => {
            const info = this.variables[name];
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="var-name">${escapeHTML(name)}</td>
                <td class="var-origin">${escapeHTML(info.origin || 'N/A')}</td>
                <td class="var-path">
                    ${escapeHTML(
                        info.type === 'static' ? 'Static Value' :
                        info.type === 'loop' ? `Loop Item (from ${info.origin})` :
                        info.type === 'extraction' ? (info.path || 'N/A') :
                        'Unknown'
                    )}
                </td>
            `;
            tbody.appendChild(row);
        });
        container.appendChild(table);
    }

    // Helper to find step recursively within the component's flowModel cache
    _findStepByIdRecursive(steps, id) {
        if (!steps || !Array.isArray(steps)) return null;
        for (const step of steps) {
            if (step.id === id) return step;
            let found = null;
            if (step.type === 'condition') {
                found = this._findStepByIdRecursive(step.thenSteps, id) || this._findStepByIdRecursive(step.elseSteps, id);
            } else if (step.type === 'loop') {
                found = this._findStepByIdRecursive(step.loopSteps, id);
            }
            if (found) return found;
        }
        return null;
    }

    // --- Public methods to control parts of the UI if needed ---
    toggleInfoOverlay(forceState) {
         const overlay = this.uiRefs.infoOverlay;
         let isOpen;
         if (typeof forceState === 'boolean') {
             isOpen = forceState;
         } else {
             isOpen = !overlay.classList.contains('open');
         }
         overlay.classList.toggle('open', isOpen);
         // Return the state so the wrapper can update its button text
         return isOpen;
    }

     // Optional: Cleanup method
     destroy() {
         // Remove specific listeners if needed, though removing innerHTML usually suffices
         this.parentElement.innerHTML = '';
         this.uiRefs = {};
         console.log("FlowBuilderComponent destroyed.");
     }
}

// Helper function (could be in flowStepComponents or here)
// Sets up variable insertion using the external dropdown mechanism
function setupVariableInsertButton(button, targetInput, availableVarNames) {
  if (!button || !targetInput) return;
  // The actual showing/handling of the dropdown is managed by app.js listener
  // This function might just ensure the button has the right class or data attributes if needed.
  button.classList.add('btn-insert-var'); // Ensure class is present
  // Optionally store target input reference if needed by the global listener logic
   if (!targetInput.id) { targetInput.id = `target-input-${Date.now()}-${Math.random()}`; } // Ensure target has ID
   button.dataset.targetInput = targetInput.id; // Link button to target ID
}