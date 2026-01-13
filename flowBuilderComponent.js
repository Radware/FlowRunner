// flowBuilderComponent.js
/**
 * flowBuilderComponent.js
 * Component responsible for rendering and managing the core flow builder UI
 * (Flow Info, Steps List, Step Editor Panel, Variables Panel).
 * It is independent of the modal wrapper and interacts via props/callbacks.
 */

import { findDefinedVariables, escapeHTML, createNewStep, cloneStep } from './flowCore.js';
import { renderStep, createStepEditor, showStepTypeDialog as showComponentStepTypeDialog } from './flowStepComponents.js';
import { appState, domRefs } from './state.js'; // <<< ADD THIS IMPORT TO ACCESS GLOBAL DOMREFS
import { logger } from './logger.js';

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
        this.stepSearchQuery = '';
        // Panel visibility is managed by the wrapper (app.js) based on user clicks on toggle buttons

        this.uiRefs = {}; // For elements *within* the builder section
        // These refs to external panels are set during render()
        this.variablesPanelRef = null;
        this.variablesContainerRef = null;

        this._renderBaseLayout(); // Render the static structure for steps list and editor
        this._bindBaseEventListeners(); // Bind listeners for base elements
    }

    _renderBaseLayout() {
        // Renders the main static HTML structure for steps list and editor panel
        // The flow-info-overlay is now a static element in index.html
        this.parentElement.innerHTML = `
            <!-- Main Builder Section (Steps & Editor) -->
            <div class="flow-builder-section" data-ref="builderSection">
                <div class="flow-steps-panel" data-ref="stepsPanel">
                    <h3>Flow Steps</h3>
                    <div class="flow-steps-search" data-ref="stepsSearch">
                        <input type="text" data-ref="stepsSearchInput" placeholder="Search steps...">
                        <button class="btn btn-sm btn-secondary" data-ref="stepsSearchClearBtn" title="Clear search">✕</button>
                    </div>
                    <div class="flow-steps-search-results" data-ref="stepsSearchResults" style="display:none;"></div>
                    <div class="flow-steps-container" data-ref="stepsContainer">
                        <!-- Steps rendered here -->
                    </div>
                    <div class="flow-steps-actions">
                        <button class="btn-add-step" data-ref="addTopLevelStepBtn">+ Add Step</button>
                    </div>
                </div>

                <div class="pane-resizer" title="Drag to resize"></div>

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

        // Store references to key elements *within the builder section UI*
        this.parentElement.querySelectorAll('[data-ref]').forEach(el => {
            this.uiRefs[el.dataset.ref] = el;
        });

        this.uiRefs.stepsContainer.innerHTML =
          '<div class="empty-flow-message"><p>No steps defined.</p><p>Click "+ Add Step" below.</p></div>';
        
        // This helper is for placeholders WITHIN the builder's direct control, if any.
        // Placeholders for global info overlay are handled by uiUtils.js or app.js
        this._clearPlaceholder = (el, messageClass) => {
          if (!el) return;
          const msg = el.querySelector(messageClass || '.empty-flow-message'); // Default to steps container placeholder
          if (msg) msg.remove();
        };
    }

    _bindBaseEventListeners() {
        // Add Top-Level Step Button
        this.uiRefs.addTopLevelStepBtn.addEventListener('click', () => this.options.onRequestAddStep());

        const searchInput = this.uiRefs.stepsSearchInput;
        const clearBtn = this.uiRefs.stepsSearchClearBtn;
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.stepSearchQuery = searchInput.value;
                this._applyStepSearchFilter();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                }
                this.stepSearchQuery = '';
                this._applyStepSearchFilter();
                searchInput?.focus();
            });
        }
    }

    // This _setupCollapsible was for the Info Overlay when it was part of the builder.
    // The global Info Overlay's collapsibles are set up in app.js
    // This local one can be removed if not used by other parts of *this specific component*.
    // For safety, let's keep it commented out for now, but it's likely unused.
    /*
     _setupCollapsible(toggleBtn, contentEl) {
        // ... (original logic) ...
    }
    */

    /** Public method to update the entire component UI */
    render(flowModel, selectedStepId, variablesPanelEl, variablesContainerEl) {
        this.flowModel = flowModel;
        this.selectedStepId = selectedStepId;
        this.variablesPanelRef = variablesPanelEl;
        this.variablesContainerRef = variablesContainerEl;

        if (!this.flowModel) {
            this.uiRefs.stepsContainer.innerHTML = '<div class="empty-flow-message"><p>No steps defined</p></div>';
            this.uiRefs.editorPlaceholder.style.display = 'flex';
            this.uiRefs.editorContainer.style.display = 'none';
            this.uiRefs.editorContainer.innerHTML = '';

            if (this.uiRefs.stepsSearchInput) this.uiRefs.stepsSearchInput.value = '';
            this.stepSearchQuery = '';
            this._renderStepSearchResults([], '', this.uiRefs.stepsSearchResults);
            
            // Clear global info overlay as well if no flow model
            if (domRefs.infoOverlayNameInput) domRefs.infoOverlayNameInput.value = '';
            if (domRefs.infoOverlayDescTextarea) domRefs.infoOverlayDescTextarea.value = '';
            if (domRefs.infoOverlayGlobalHeadersList) domRefs.infoOverlayGlobalHeadersList.innerHTML = '<div class="global-header-row-no-items">No global headers</div>';
            if (domRefs.infoOverlayFlowVarsList) domRefs.infoOverlayFlowVarsList.innerHTML = '<div class="no-flow-vars">No flow variables</div>';

            if (this.variablesContainerRef) {
                this.variablesContainerRef.innerHTML = '<div class="no-variables-message"><p>No variables defined</p></div>';
            }
            return;
        }

        this.variables = findDefinedVariables(this.flowModel);

        // Update UI sections - these now target the global info overlay elements via domRefs
        this._updateFlowInfoUI();
        this._updateGlobalHeadersUI();
        this._updateFlowVarsUI();
        
        // Update builder-specific sections
        this._updateStepsUI();
        this._updateStepEditorUI();
        this._updateVariablesPanelUI();
    }

    // --- Private UI Update Methods ---

    _updateFlowInfoUI() {
        // Targets the global info overlay elements via domRefs
        const nameInput = domRefs.infoOverlayNameInput;
        const descTextarea = domRefs.infoOverlayDescTextarea;

        if (nameInput) nameInput.value = this.flowModel.name || '';
        if (descTextarea) descTextarea.value = this.flowModel.description || '';

        // Event listeners for name/description are set up globally in app.js,
        // so no need to re-bind them here. The onFlowUpdate callback will be triggered by app.js.
    }

     _updateGlobalHeadersUI() {
        const container = domRefs.infoOverlayGlobalHeadersList; // Target global element
        if (!container) return;
        container.innerHTML = '';
        const headers = this.flowModel.headers || {};

        if (Object.keys(headers).length === 0) {
            container.innerHTML = '<div class="global-header-row-no-items">No global headers defined</div>';
        } else {
            Object.entries(headers).forEach(([key, value]) => {
                this._addGlobalHeaderRow(key, value, false); // Add rows, listeners will be set up by this method
            });
        }
        // The "Add Header" button listener is global (in app.js).
        // Collapsible height adjustment is handled by app.js or uiUtils.js
        this._adjustCollapsibleHeight(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent);
    }

     _addGlobalHeaderRow(key, value, triggerUpdate = true) {
        // This method is responsible for creating a row in the GLOBAL info overlay
        const container = domRefs.infoOverlayGlobalHeadersList;
        if (!container) return;

        const noItemsMsg = container.querySelector('.global-header-row-no-items');
        if (noItemsMsg) noItemsMsg.remove();

        const row = document.createElement('div');
        row.className = 'global-header-row';
        const keyId = `gh-key-builder-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        const valueId = `gh-val-builder-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        row.innerHTML = `
            <input type="text" class="header-key" id="${keyId}" value="${escapeHTML(key)}" placeholder="Header Name">
            <input type="text" class="header-value" id="${valueId}" value="${escapeHTML(value)}" placeholder="Header Value">
            <button class="btn-insert-var" data-target-input="${valueId}" title="Insert Variable">{{…}}</button>
            <button class="btn-remove-global-header" title="Remove Header">✕</button>
        `;
        container.appendChild(row);

        const keyInput = row.querySelector('.header-key');
        const valueInput = row.querySelector('.header-value');
        const removeBtn = row.querySelector('.btn-remove-global-header');

        const updateCallback = () => {
            const currentHeaders = this._getCurrentGlobalHeadersFromUI();
            this.options.onHeadersUpdate?.(currentHeaders); // Call app.js handler
        };

        keyInput.addEventListener('input', updateCallback);
        valueInput.addEventListener('input', updateCallback);
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            row.remove();
            updateCallback();
            if (container.children.length === 0) {
                container.innerHTML = '<div class="global-header-row-no-items">No global headers defined</div>';
            }
            this._adjustCollapsibleHeight(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent);
        });
        
        setupVariableInsertButton(row.querySelector('.btn-insert-var'), valueInput, Object.keys(this.variables || {}));


        if (triggerUpdate) { // Usually false during initial render, true if user clicks "+"
            updateCallback();
        }
        this._adjustCollapsibleHeight(domRefs.infoOverlayGlobalHeadersToggle, domRefs.infoOverlayGlobalHeadersContent);
    }

    _getCurrentGlobalHeadersFromUI() {
        const headers = {};
        // This should read from domRefs.infoOverlayGlobalHeadersList
        domRefs.infoOverlayGlobalHeadersList?.querySelectorAll('.global-header-row').forEach(row => {
            const key = row.querySelector('.header-key')?.value.trim();
            const value = row.querySelector('.header-value')?.value;
            if (key) headers[key] = value ?? '';
        });
        return headers;
    }

     _updateFlowVarsUI() {
        const container = domRefs.infoOverlayFlowVarsList; // Target global element
        if (!container) return;
        container.innerHTML = '';
        const staticVars = this.flowModel.staticVars || {};

        if (Object.keys(staticVars).length === 0) {
            container.innerHTML = `<div class="no-flow-vars">No flow variables defined</div>`;
        } else {
            Object.entries(staticVars).forEach(([key, value]) => {
                this._addFlowVarRow(key, value, false);
            });
        }
        this._adjustCollapsibleHeight(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);
    }

     _addFlowVarRow(key, value, triggerUpdate = true) {
        const container = domRefs.infoOverlayFlowVarsList;
        if (!container) return;

        const noItemsMsg = container.querySelector('.no-flow-vars'); // Corrected class
        if (noItemsMsg) noItemsMsg.remove();

        const row = document.createElement('div');
        row.className = 'flow-var-row';
        const keyId = `fv-key-builder-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        const valueId = `fv-val-builder-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        const typeId = `fv-type-builder-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;

        let detectedType = 'string';
        if (typeof value === 'number') detectedType = 'number';
        else if (typeof value === 'boolean') detectedType = 'boolean';
        else if (typeof value === 'object' && value !== null) {
            detectedType = 'json';
            try { value = JSON.stringify(value); } catch (e) { value = String(value); }
        }

        row.innerHTML = `
            <input type="text" class="flow-var-key" id="${keyId}" value="${escapeHTML(key)}" placeholder="Variable Name">
            <input type="text" class="flow-var-value" id="${valueId}" value="${escapeHTML(value)}" placeholder="Variable Value">
            <select class="flow-var-type" id="${typeId}">
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="json">JSON</option>
            </select>
            <button class="btn-insert-var" data-target-input="${valueId}" title="Insert Variable">{{…}}</button>
            <button class="btn-remove-flow-var" title="Remove Variable">✕</button>
        `;
        row.querySelector('.flow-var-type').value = detectedType;
        container.appendChild(row);

        const keyInput = row.querySelector('.flow-var-key');
        const valueInput = row.querySelector('.flow-var-value');
        const removeBtn = row.querySelector('.btn-remove-flow-var');

        const updateCallback = () => {
            const currentVars = this._getCurrentFlowVarsFromUI();
            this.options.onFlowVarsUpdate?.(currentVars); // Call app.js handler
        };

        keyInput.addEventListener('input', updateCallback);
        valueInput.addEventListener('input', updateCallback);
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            row.remove();
            updateCallback();
            if (container.children.length === 0) {
                container.innerHTML = '<div class="no-flow-vars">No flow variables defined</div>';
            }
            this._adjustCollapsibleHeight(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);
        });
        
        setupVariableInsertButton(row.querySelector('.btn-insert-var'), valueInput, Object.keys(this.variables || {}));

        if (triggerUpdate) {
            updateCallback();
        }
        this._adjustCollapsibleHeight(domRefs.infoOverlayFlowVarsToggle, domRefs.infoOverlayFlowVarsContent);
    }

    _getCurrentFlowVarsFromUI() {
        const staticVars = {};
        domRefs.infoOverlayFlowVarsList?.querySelectorAll('.flow-var-row').forEach(row => {
            const keyInput = row.querySelector('.flow-var-key');
            const valueInput = row.querySelector('.flow-var-value');
            const typeSelect = row.querySelector('.flow-var-type');
            const key = keyInput?.value.trim();
            const rawValue = valueInput?.value;

            let value;
            switch (typeSelect?.value) {
                case 'number':
                    value = Number(rawValue);
                    if (Number.isNaN(value)) value = rawValue;
                    break;
                case 'boolean':
                    value = String(rawValue).toLowerCase() === 'true';
                    break;
                case 'json':
                    try { value = JSON.parse(rawValue); } catch (e) { value = rawValue; }
                    break;
                default:
                    value = rawValue;
            }

            if (key && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
                 staticVars[key] = value ?? '';
                 if(keyInput) keyInput.style.borderColor = '';
            } else if (key) {
                 logger.warn(`Invalid variable name ignored: ${key}`);
                 if(keyInput) keyInput.style.borderColor = 'red';
            } else {
                if(keyInput) keyInput.style.borderColor = '';
            }
        });
        return staticVars;
    }

    // This is the builder's local version, which will call the global app.js one if needed
    _adjustCollapsibleHeight(toggleBtn, contentEl) {
         // This function now needs to be robust as it's called from render.
         // It should use the same logic as the one in app.js or uiUtils.js.
         // For simplicity, let's assume the global adjustCollapsibleHeight in app.js
         // is the source of truth and this component just ensures it's called
         // if the app.js `setupGlobalOverlayListeners` didn't already cover it or if this component makes direct changes.

         // However, since the builder's `render` populates these, it should ensure they are adjusted.
         if (!toggleBtn || !contentEl) return;
         if (toggleBtn.classList.contains('active')) { // Only if open
             contentEl.style.paddingTop = '15px';
             contentEl.style.paddingBottom = '15px';
             requestAnimationFrame(() => {
                contentEl.style.maxHeight = contentEl.scrollHeight + "px";
             });
         }
    }

    _applyStepSearchFilter() {
        const container = this.uiRefs.stepsContainer;
        const resultsContainer = this.uiRefs.stepsSearchResults;
        if (!container || !this.flowModel) return;

        const query = (this.stepSearchQuery || '').trim().toLowerCase();
        const visibleIds = new Set();
        const matches = [];

        const collectSteps = (steps, trail = []) => {
            let hasAnyVisible = false;
            if (!steps || !Array.isArray(steps)) return false;
            steps.forEach(step => {
                const displayName = step.name || this._getStepTypeLabel(step.type);
                const haystack = `${displayName} ${step.type || ''}`.toLowerCase();
                const selfMatches = query ? haystack.includes(query) : true;

                const currentTrail = trail.length > 0 ? `${trail.join(' > ')} > ${displayName}` : displayName;
                let childMatches = false;

                if (step.type === 'condition') {
                    const thenTrail = `${currentTrail} > Then`;
                    const elseTrail = `${currentTrail} > Else`;
                    childMatches = collectSteps(step.thenSteps, [thenTrail]) || childMatches;
                    childMatches = collectSteps(step.elseSteps, [elseTrail]) || childMatches;
                } else if (step.type === 'loop') {
                    const loopTrail = `${currentTrail} > Loop`;
                    childMatches = collectSteps(step.loopSteps, [loopTrail]) || childMatches;
                }

                const visible = !query || selfMatches || childMatches;
                if (visible) visibleIds.add(step.id);
                if (query && selfMatches) {
                    matches.push({
                        id: step.id,
                        name: displayName,
                        type: step.type || 'unknown',
                        trail: trail.join(' > ')
                    });
                }
                hasAnyVisible = hasAnyVisible || visible;
            });
            return hasAnyVisible;
        };

        collectSteps(this.flowModel.steps || [], []);

        container.querySelectorAll('.flow-step').forEach(stepEl => {
            const stepId = stepEl.dataset.stepId;
            stepEl.style.display = visibleIds.has(stepId) ? '' : 'none';
        });

        this._renderStepSearchResults(matches, query, resultsContainer);
    }

    _renderStepSearchResults(matches, query, resultsContainer) {
        if (!resultsContainer) return;
        if (!query) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            return;
        }

        resultsContainer.style.display = 'block';
        if (!matches || matches.length === 0) {
            resultsContainer.innerHTML = '<div class="step-search-empty">No matching steps.</div>';
            return;
        }

        const maxResults = 30;
        const clipped = matches.slice(0, maxResults);
        const itemsHtml = clipped.map(match => `
            <div class="step-search-item" data-step-id="${escapeHTML(match.id)}">
                <div class="step-search-info">
                    <div class="step-search-name">${escapeHTML(match.name)}</div>
                    <div class="step-search-meta">${escapeHTML(match.type)}${match.trail ? ` - ${escapeHTML(match.trail)}` : ''}</div>
                </div>
                <div class="step-search-actions">
                    <button class="btn btn-sm btn-secondary" data-action="jump-list" title="Jump to step in list">List</button>
                    <button class="btn btn-sm btn-secondary" data-action="jump-graph" title="Jump to step in graph">Graph</button>
                </div>
            </div>
        `).join('');
        const overflowNote = matches.length > maxResults
            ? `<div class="step-search-overflow">Showing ${maxResults} of ${matches.length} matches.</div>`
            : '';
        resultsContainer.innerHTML = itemsHtml + overflowNote;

        resultsContainer.querySelectorAll('.step-search-item').forEach(item => {
            const stepId = item.dataset.stepId;
            item.querySelectorAll('button').forEach(button => {
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    const previousSelection = appState.selectedStepId;
                    this.options.onStepSelect?.(stepId);
                    if (appState.selectedStepId !== stepId && previousSelection !== stepId) {
                        return;
                    }
                    if (button.dataset.action === 'jump-graph') {
                        this._jumpToGraph(stepId);
                    } else {
                        this._scrollStepIntoView(stepId);
                    }
                });
            });
        });
    }

    _scrollStepIntoView(stepId) {
        const container = this.uiRefs.stepsContainer;
        if (!container || !stepId) return;
        const safeStepId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(stepId) : stepId;
        const target = container.querySelector(`.flow-step[data-step-id="${safeStepId}"]`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    _jumpToGraph(stepId) {
        if (appState.currentView !== 'node-graph') {
            domRefs.toggleViewBtn?.click();
        }
        requestAnimationFrame(() => {
            appState.visualizerComponent?.focusNode(stepId);
        });
    }

    _getStepTypeLabel(type) {
        switch (type) {
            case 'request': return 'API Request';
            case 'condition': return 'Condition';
            case 'loop': return 'Loop';
            case 'transform': return 'Transform';
            default: return 'Step';
        }
    }


    _updateStepsUI() {
        const container = this.uiRefs.stepsContainer;
        container.innerHTML = '';

        const steps = this.flowModel.steps || [];
        if (steps.length === 0) {
            container.innerHTML = `<div class="empty-flow-message"><p>No steps defined.</p><p>Click "+ Add Step" below.</p></div>`;
            this._renderStepSearchResults([], this.stepSearchQuery, this.uiRefs.stepsSearchResults);
            return;
        }

        const renderOptions = {
            variables: this.variables,
            selectedStepId: this.selectedStepId,
            onSelect: this.options.onStepSelect,
            onUpdate: this.options.onStepUpdate,
            onDelete: (stepId) => this.options.onStepUpdate({ type: 'delete', stepId: stepId }),
            isNested: false
        };

        steps.forEach(step => {
            container.appendChild(renderStep(step, renderOptions));
        });
        this._applyStepSearchFilter();
    }

    _updateStepEditorUI() {
        const editorContainer = this.uiRefs.editorContainer;
        const placeholder = this.uiRefs.editorPlaceholder;
        editorContainer.innerHTML = '';

        if (!this.selectedStepId) {
            placeholder.style.display = 'flex';
            editorContainer.style.display = 'none';
            return;
        }

        const selectedStepData = this._findStepByIdRecursive(this.flowModel.steps, this.selectedStepId);

        if (!selectedStepData) {
            logger.warn(`Selected step ID ${this.selectedStepId} not found in model.`);
            placeholder.style.display = 'flex';
            editorContainer.style.display = 'none';
            return;
        }

        placeholder.style.display = 'none';
        editorContainer.style.display = 'flex';

        const editorElement = createStepEditor(selectedStepData, {
            variables: this.variables,
            onChange: this.options.onStepEdit,
            onDirtyChange: this.options.onEditorDirtyChange,
            flowHeaders: this.flowModel.headers || {},
            flowVars: this.flowModel.staticVars || {},
            runtimeContext: () => appState.lastRuntimeContext
        });
        editorContainer.appendChild(editorElement);
    }

     _updateVariablesPanelUI() {
        const container = this.variablesContainerRef;
        if (!container) return;
        container.innerHTML = '';

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

     destroy() {
         this.parentElement.innerHTML = '';
         this.uiRefs = {};
         logger.info("FlowBuilderComponent destroyed.");
     }
}

function setupVariableInsertButton(button, targetInput, availableVarNames) {
    if (!button || !targetInput) return;
    button.classList.add('btn-insert-var');
    if (!targetInput.id) { targetInput.id = `target-input-${Date.now()}-${Math.random()}`; }
    button.dataset.targetInput = targetInput.id;
}
