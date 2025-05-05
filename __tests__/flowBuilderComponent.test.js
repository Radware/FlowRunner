// flowBuilderComponent.test.js
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowBuilderComponent } from '../flowBuilderComponent.js';

describe('FlowBuilderComponent', () => {
    let container;
    let variablesToggle;
    let component;

    beforeEach(() => {
        // Set up DOM elements
        container = document.createElement('div');
        variablesToggle = document.createElement('button');
        document.body.appendChild(container);
        document.body.appendChild(variablesToggle);

        // Create component instance with mock callbacks
        component = new FlowBuilderComponent(container, variablesToggle, {
            onFlowUpdate: jest.fn(),
            onHeadersUpdate: jest.fn(),
            onFlowVarsUpdate: jest.fn(),
            onStepSelect: jest.fn(),
            onStepUpdate: jest.fn(),
            onStepEdit: jest.fn(),
            onRequestAddStep: jest.fn(),
            onEditorDirtyChange: jest.fn()
        });
    });

    afterEach(() => {
        // Clean up
        document.body.removeChild(container);
        document.body.removeChild(variablesToggle);
        component.destroy();
    });

    test('renders basic structure correctly', () => {
        // Verify core elements exist
        expect(container.querySelector('.flow-info-overlay')).toBeTruthy();
        expect(container.querySelector('.flow-builder-section')).toBeTruthy();
        expect(container.querySelector('.flow-steps-panel')).toBeTruthy();
        expect(container.querySelector('.step-editor-panel')).toBeTruthy();
    });

    test('renders flow info inputs correctly', () => {
        const flowNameInput = container.querySelector('[data-ref="flowNameInput"]');
        const flowDescTextarea = container.querySelector('[data-ref="flowDescTextarea"]');
        
        expect(flowNameInput).toBeTruthy();
        expect(flowDescTextarea).toBeTruthy();
    });

    test('renders steps container correctly', () => {
        const stepsContainer = container.querySelector('[data-ref="stepsContainer"]');
        expect(stepsContainer).toBeTruthy();
        
        // Should show empty message when no steps
        expect(stepsContainer.textContent).toContain('No steps defined');
    });

    test('renders step editor placeholder correctly', () => {
        const editorPlaceholder = container.querySelector('[data-ref="editorPlaceholder"]');
        expect(editorPlaceholder).toBeTruthy();
        expect(editorPlaceholder.textContent).toContain('Select a step');
    });

    test('renders global headers section correctly', () => {
        const headersList = container.querySelector('[data-ref="globalHeadersList"]');
        expect(headersList).toBeTruthy();
        expect(headersList.textContent).toContain('No global headers');
    });

    test('renders flow variables section correctly', () => {
        const varsList = container.querySelector('[data-ref="flowVarsList"]');
        expect(varsList).toBeTruthy();
        expect(varsList.textContent).toContain('No flow variables');
    });

    test('triggers onFlowUpdate when flow info changes', () => {
        const flowNameInput = container.querySelector('[data-ref="flowNameInput"]');
        const flowDescTextarea = container.querySelector('[data-ref="flowDescTextarea"]');
        
        // Simulate user input
        flowNameInput.value = 'Test Flow';
        flowNameInput.dispatchEvent(new Event('input'));
        
        expect(component.options.onFlowUpdate).toHaveBeenCalledWith({
            name: 'Test Flow',
            description: ''
        });

        flowDescTextarea.value = 'Test Description';
        flowDescTextarea.dispatchEvent(new Event('input'));
        
        expect(component.options.onFlowUpdate).toHaveBeenCalledWith({
            name: 'Test Flow',
            description: 'Test Description'
        });
    });

    test('triggers onHeadersUpdate when global header is added', () => {
        const addHeaderBtn = container.querySelector('[data-ref="addGlobalHeaderBtn"]');
        addHeaderBtn.click();

        const headerRows = container.querySelectorAll('.global-header-row');
        expect(headerRows.length).toBe(1);

        // Simulate entering header data
        const keyInput = headerRows[0].querySelector('.header-key');
        const valueInput = headerRows[0].querySelector('.header-value');
        
        keyInput.value = 'Content-Type';
        keyInput.dispatchEvent(new Event('input'));
        valueInput.value = 'application/json';
        valueInput.dispatchEvent(new Event('input'));

        expect(component.options.onHeadersUpdate).toHaveBeenCalledWith({
            'Content-Type': 'application/json'
        });
    });

    test('triggers onFlowVarsUpdate when flow variable is added', () => {
        const addVarBtn = container.querySelector('[data-ref="addFlowVarBtn"]');
        addVarBtn.click();

        const varRows = container.querySelectorAll('.flow-var-row');
        expect(varRows.length).toBe(1);

        // Simulate entering variable data
        const keyInput = varRows[0].querySelector('.flow-var-key');
        const valueInput = varRows[0].querySelector('.flow-var-value');
        
        keyInput.value = 'apiKey';
        keyInput.dispatchEvent(new Event('input'));
        valueInput.value = '12345';
        valueInput.dispatchEvent(new Event('input'));

        expect(component.options.onFlowVarsUpdate).toHaveBeenCalledWith({
            'apiKey': '12345'
        });
    });

    test('triggers onRequestAddStep when add step button is clicked', () => {
        const addStepBtn = container.querySelector('[data-ref="addTopLevelStepBtn"]');
        addStepBtn.click();
        
        expect(component.options.onRequestAddStep).toHaveBeenCalled();
    });

    test('renders with provided flow model', () => {
        const mockFlowModel = {
            name: 'Test Flow',
            description: 'Test Description',
            headers: {
                'Content-Type': 'application/json'
            },
            staticVars: {
                'apiKey': '12345'
            },
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Test Step',
                    method: 'GET',
                    url: 'https://api.example.com'
                }
            ]
        };

        component.render(mockFlowModel, null);

        // Verify flow info is rendered
        const flowNameInput = container.querySelector('[data-ref="flowNameInput"]');
        const flowDescTextarea = container.querySelector('[data-ref="flowDescTextarea"]');
        expect(flowNameInput.value).toBe('Test Flow');
        expect(flowDescTextarea.value).toBe('Test Description');

        // Verify headers are rendered
        const headerRows = container.querySelectorAll('.global-header-row');
        expect(headerRows.length).toBe(1);
        expect(headerRows[0].querySelector('.header-key').value).toBe('Content-Type');
        expect(headerRows[0].querySelector('.header-value').value).toBe('application/json');

        // Verify variables are rendered
        const varRows = container.querySelectorAll('.flow-var-row');
        expect(varRows.length).toBe(1);
        expect(varRows[0].querySelector('.flow-var-key').value).toBe('apiKey');
        expect(varRows[0].querySelector('.flow-var-value').value).toBe('12345');

        // Verify steps are rendered
        const stepsContainer = container.querySelector('[data-ref="stepsContainer"]');
        expect(stepsContainer.querySelector('.flow-step')).toBeTruthy();
    });

    test('should display empty state message when no steps are defined', () => {
        expect(container.querySelector('.empty-flow-message').innerHTML)
            .toBe('<p>No steps defined.</p><p>Click "+ Add Step" below.</p>');
    });
});