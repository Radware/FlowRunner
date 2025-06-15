// __tests__/flowBuilderComponent.test.js
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowBuilderComponent } from '../flowBuilderComponent.js';
import { domRefs, appState } from '../state.js';
import { initializeDOMReferences } from '../domUtils.js';
import { createTemplateFlow, createNewStep } from '../flowCore.js';
import { FlowRunner } from '../flowRunner.js';

// Corrected Mocking for ESM: Mock specific functions, don't spread jest.requireActual here.
// We will dynamically import the actual module if its non-mocked parts are needed.
jest.unstable_mockModule('../app.js', () => ({
    // Provide default empty/jest.fn() implementations for functions used by the component or its helpers
    // if they are not the primary focus of these tests.
    // If a function from app.js is *actually needed* by FlowBuilderComponent (and not via props/callbacks),
    // then we might need to rethink how that dependency is injected or handled.
    // For now, assuming FlowBuilderComponent mostly relies on its own logic + what's passed in.
    __esModule: true, // Important for ESM mocks
    default: {}, // if app.js has a default export
    adjustCollapsibleHeight: jest.fn(),
    initializeAppComponents: jest.fn(),
    // Add any other functions from app.js that might be directly or indirectly called
    // by FlowBuilderComponent or its internal helpers, and mock them.
    // Example: If `_updateGlobalHeadersUI` in FlowBuilderComponent called a utility from app.js:
    // someUtilityFromApp: jest.fn(),
}));


describe('FlowBuilderComponent', () => {
    let componentInstance;
    let parentElement;
    let mockVariablesPanelEl;
    let mockVariablesContainerEl;
    let mockOptions;
    // let appModule; // We might not need to import the actual app.js for these component tests

    beforeEach(async () => { // Make beforeEach async
        // appModule = await import('../app.js'); // Only if you need to access non-mocked parts of app.js

        parentElement = document.createElement('div');
        parentElement.id = 'flow-builder-mount';
        document.body.appendChild(parentElement);

        document.body.innerHTML += `
            <div class="flow-info-overlay" data-ref="infoOverlay">
                <input type="text" id="global-flow-name" data-ref="flowNameInput">
                <textarea id="global-flow-description" data-ref="flowDescTextarea"></textarea>
                <button class="collapsible-header" data-ref="globalHeadersToggle"><span class="toggle-icon">▼</span></button>
                <div class="collapsible-content" data-ref="globalHeadersContent"><div class="global-headers-list" data-ref="globalHeadersList"></div></div>
                <button class="btn-add-global-header" data-ref="addGlobalHeaderBtn"></button>
                <button class="collapsible-header" data-ref="flowVarsToggle"><span class="toggle-icon">▼</span></button>
                <div class="collapsible-content" data-ref="flowVarsContent"><div class="flow-vars-list" data-ref="flowVarsList"></div></div>
                <button class="btn-add-flow-var" data-ref="addFlowVarBtn"></button>
                <button id="actual-close-info-btn"></button>
            </div>
            <div class="variables-panel" data-ref="variablesPanel">
                 <div class="variables-container" data-ref="variablesContainer"></div>
                 <button id="actual-close-variables-btn"></button>
            </div>
            <button id="toggle-variables-btn"></button>
            <button id="sidebar-toggle-btn"></button>
            <aside id="sidebar"></aside>
            <button id="runner-toggle-btn"></button>
            <aside id="runner-panel"></aside>
            <div id="workspace-title"></div>
            <div id="workspace-placeholder"></div>
            <button id="toggle-view-btn"></button>
            <button id="toggle-info-btn"><span class="toggle-icon">▼</span><span class="btn-text">Info</span></button>
            <div id="flow-visualizer-mount"></div>
            <div id="builder-messages"></div>
            <div id="runner-status-messages"></div>
            <div id="step-type-dialog" style="display:none;"><button class="step-type-close"></button><div class="step-type-option" data-type="request"></div><div class="request-icon"></div><div class="condition-icon"></div><div class="loop-icon"></div></div>
            <div id="var-dropdown" style="display:none;"><input class="var-search"/><div class="var-list"></div><button class="var-close"></button><div class="no-results-msg"></div></div>
            <div id="global-loading-overlay"></div>
            <div id="flow-list"></div>
            <button id="add-flow-btn"></button>
            <button id="open-flow-btn"></button>
            <button id="save-flow-btn"></button>
            <button id="save-as-flow-btn"></button>
            <button id="cancel-flow-btn"></button>
            <button id="close-flow-btn"></button>
            <input id="continuous-run-checkbox" type="checkbox">
            <button id="run-flow-btn"></button>
            <button id="step-flow-btn"></button>
            <button id="stop-flow-btn"></button>
            <button id="clear-results-btn"></button>
            <input id="request-delay">
            <div id="runner-results"></div>
            <div class="runner-results-container"></div>

        `;

        initializeDOMReferences();

        mockVariablesPanelEl = domRefs.variablesPanel;
        mockVariablesContainerEl = domRefs.variablesContainer;

        global.window.showAppStepTypeDialog = jest.fn((callback) => {
            // Simulate user selecting 'request' type for tests needing a new step
            if (typeof callback === 'function') callback('request');
        });


        appState.currentFlowModel = createTemplateFlow();
        appState.selectedStepId = null;
        appState.definedVariables = {};


        mockOptions = {
            onStepSelect: jest.fn(),
            onStepUpdate: jest.fn(),
            onStepEdit: jest.fn(),
            onRequestAddStep: jest.fn(),
            onEditorDirtyChange: jest.fn(),
        };

        const variablesToggleBtn = document.getElementById('toggle-variables-btn');
        componentInstance = new FlowBuilderComponent(parentElement, variablesToggleBtn, mockOptions);
        // Initial render to set up internal uiRefs of the component
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);

    });

    afterEach(() => {
        if (componentInstance && typeof componentInstance.destroy === 'function') {
             componentInstance.destroy();
        }
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('renders its own basic structure correctly', () => {
        expect(parentElement.querySelector('.flow-builder-section')).toBeTruthy();
        expect(parentElement.querySelector('.flow-steps-panel')).toBeTruthy();
        expect(parentElement.querySelector('.step-editor-panel')).toBeTruthy();
    });

    test('renders steps container correctly when no steps', () => {
        // appState.currentFlowModel is already an empty flow from beforeEach
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);
        const stepsContainer = parentElement.querySelector('[data-ref="stepsContainer"]');
        expect(stepsContainer).toBeTruthy();
        expect(stepsContainer.textContent).toContain('No steps defined');
    });

    test('renders step editor placeholder correctly initially', () => {
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);
        const editorPlaceholder = parentElement.querySelector('[data-ref="editorPlaceholder"]');
        expect(editorPlaceholder).toBeTruthy();
        expect(editorPlaceholder.style.display).toBe('flex');
        expect(editorPlaceholder.textContent).toContain('Select a step to edit');
    });

    test('populates global flow info inputs on render', () => {
        appState.currentFlowModel.name = 'My Test Flow';
        appState.currentFlowModel.description = 'A description for the test.';
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);

        expect(domRefs.infoOverlayNameInput.value).toBe('My Test Flow');
        expect(domRefs.infoOverlayDescTextarea.value).toBe('A description for the test.');
    });

    test('populates global headers section on render', () => {
        appState.currentFlowModel.headers = { 'X-Test-Header': 'TestValue' };
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);

        const headersList = domRefs.infoOverlayGlobalHeadersList;
        expect(headersList.querySelector('.global-header-row')).toBeTruthy();
        expect(headersList.querySelector('.header-key').value).toBe('X-Test-Header');
        expect(headersList.querySelector('.header-value').value).toBe('TestValue');
    });

    test('populates global flow variables section on render', () => {
        appState.currentFlowModel.staticVars = { 'testVar': 'varValue' };
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);

        const varsList = domRefs.infoOverlayFlowVarsList;
        expect(varsList.querySelector('.flow-var-row')).toBeTruthy();
        expect(varsList.querySelector('.flow-var-key').value).toBe('testVar');
        expect(varsList.querySelector('.flow-var-value').value).toBe('varValue');
    });

    test('triggers onRequestAddStep when its own add step button is clicked', () => {
        // componentInstance is already rendered in beforeEach
        const addStepBtn = parentElement.querySelector('[data-ref="addTopLevelStepBtn"]');
        expect(addStepBtn).toBeTruthy();
        addStepBtn.click();
        expect(mockOptions.onRequestAddStep).toHaveBeenCalled();
    });

    test('renders steps from flow model', () => {
        appState.currentFlowModel.steps = [
            { id: 'step1', type: 'request', name: 'Test Step 1', method: 'GET', url: 'https://api.example.com', onFailure: 'stop' }
        ];
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);
        const stepsContainer = parentElement.querySelector('[data-ref="stepsContainer"]');
        expect(stepsContainer.querySelector('.flow-step[data-step-id="step1"]')).toBeTruthy();
        expect(stepsContainer.textContent).not.toContain('No steps defined');
    });

    test('renders step editor when a step is selected', () => {
        const stepId = 's1';
        appState.currentFlowModel.steps = [
             { id: stepId, name: 'Test Request', type: 'request', method: 'GET', url: 'http://example.com', onFailure: 'stop' }
        ];
        // No need to set appState.selectedStepId, pass it directly to render
        componentInstance.render(appState.currentFlowModel, stepId, mockVariablesPanelEl, mockVariablesContainerEl);

        const editorContainer = parentElement.querySelector('[data-ref="editorContainer"]');
        const editorPlaceholder = parentElement.querySelector('[data-ref="editorPlaceholder"]');

        expect(editorPlaceholder.style.display).toBe('none');
        expect(editorContainer.style.display).toBe('flex');
        expect(editorContainer.querySelector('.step-editor')).toBeTruthy();
        expect(editorContainer.querySelector(`#step-editor-name-${stepId}`).value).toBe('Test Request');
    });

    test('calls onEditorDirtyChange when an internal editor field marks dirty (e.g., name input)', () => {
        const stepId = 's1';
        appState.currentFlowModel.steps = [
             { id: stepId, name: 'Test Edit', type: 'request', method: 'GET', url: '', onFailure: 'stop' }
        ];
        componentInstance.render(appState.currentFlowModel, stepId, mockVariablesPanelEl, mockVariablesContainerEl);

        const nameInput = parentElement.querySelector(`#step-editor-name-${stepId}`);
        nameInput.value = 'New Name';
        nameInput.dispatchEvent(new Event('input'));

        expect(mockOptions.onEditorDirtyChange).toHaveBeenCalledWith(true);
    });

     test('calls onStepEdit when Save Step button is clicked in the editor', () => {
        const stepId = 's1';
        const initialStep = { id: stepId, name: 'Original Name', type: 'request', method: 'GET', url: 'http://original.com', onFailure: 'stop', headers:{}, body:'', extract: {} };
        appState.currentFlowModel.steps = [initialStep];
        
        componentInstance.render(appState.currentFlowModel, stepId, mockVariablesPanelEl, mockVariablesContainerEl);

        const nameInput = parentElement.querySelector(`#step-editor-name-${stepId}`);
        nameInput.value = 'Updated Name';
        nameInput.dispatchEvent(new Event('input')); 

        const saveBtn = parentElement.querySelector('.btn-save-step');
        expect(saveBtn).not.toBeNull();
        saveBtn.click();

        expect(mockOptions.onStepEdit).toHaveBeenCalledWith(
            expect.objectContaining({
                id: stepId,
                name: 'Updated Name',
                type: 'request',
                method: 'GET',
                url: 'http://original.com', 
                onFailure: 'stop'
            })
        );
        expect(mockOptions.onEditorDirtyChange).toHaveBeenLastCalledWith(false); 
    });

    test('populates and updates variables panel UI', () => {
        appState.currentFlowModel.staticVars = { staticV: "val1" };
        appState.currentFlowModel.steps = [
            { id: 's1', type: 'request', name: 'Req1', extract: { extractedV: 'body.data' }, onFailure: 'stop' }
        ];
        // The component's render calls findDefinedVariables internally, which updates appState.definedVariables,
        // and then _updateVariablesPanelUI uses appState.definedVariables.
        componentInstance.render(appState.currentFlowModel, null, mockVariablesPanelEl, mockVariablesContainerEl);
        
        const varNameCells = mockVariablesContainerEl.querySelectorAll('.var-name');
        const varNames = Array.from(varNameCells).map(cell => cell.textContent);
        
        expect(varNames).toContain('staticV');
        expect(varNames).toContain('extractedV');
    });

    test('stores JSON variable values as objects', () => {
        componentInstance._addFlowVarRow('arr', '[1,2]', false);
        const row = domRefs.infoOverlayFlowVarsList.lastElementChild;
        row.querySelector('.flow-var-type').value = 'json';
        const vars = componentInstance._getCurrentFlowVarsFromUI();
        expect(vars).toEqual({ arr: [1, 2] });
    });

    test('JSON array variable drives loop iterations', async () => {
        jest.useFakeTimers({ now: Date.now() });
        componentInstance._addFlowVarRow('arr', '[1,2,3]', false);
        domRefs.infoOverlayFlowVarsList.lastElementChild.querySelector('.flow-var-type').value = 'json';
        const flow = createTemplateFlow();
        flow.staticVars = { arr: [1, 2, 3] };
        flow.steps = [{
            ...createNewStep('loop'),
            id: 'l1',
            source: 'arr',
            loopSteps: [{ ...createNewStep('request'), id: 'r1' }]
        }];
        const executed = [];
        const runner = new FlowRunner({
            evaluatePathFn: (ctx, path) => ctx[path],
            onStepStart: s => { if (s.id === 'r1') executed.push(s.id); return 0; },
            onStepComplete: () => {},
            onContextUpdate: () => {},
            delay: 0,
        });
        await runner.run(flow);
        const processAsyncOps = async (count = 1) => {
            for (let i = 0; i < count; i++) {
                if (jest.getTimerCount() > 0) jest.runAllTimers();
                await Promise.resolve();
                await Promise.resolve();
            }
        };
        await processAsyncOps(2 + (3 * 2));
        expect(executed.length).toBe(3);
        jest.useRealTimers();
    });
});