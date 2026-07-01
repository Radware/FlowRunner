// __tests__/flowVisualizer.test.js
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowVisualizer } from '../flowVisualizer.js';
import { createTemplateFlow, createNewStep } from '../flowCore.js';
import { handleVisualizerNodeLayoutUpdate } from '../eventHandlers.js';
import { appState } from '../state.js';

const NODE_WIDTH = 260;
const NODE_MIN_HEIGHT = 160;
const H_SPACING = 100;
const CANVAS_PADDING = 100;

const waitForVisualizerRender = async () => {
    for (let i = 0; i < 5; i++) {
        await global.flushAllRAF(5);
        jest.runAllTimers();
        await Promise.resolve();
    }
};

describe('FlowVisualizer (Drawflow)', () => {
    let container;
    let visualizer;
    let mockCallbacks;
    let mockFlow;

    beforeEach(async () => {
        jest.useFakeTimers({ now: Date.now() });

        container = document.createElement('div');
        container.id = 'visualizer-mount-point-test';
        container.style.width = '1200px';
        container.style.height = '1000px';
        Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1200 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 1000 });
        Object.defineProperty(container, 'offsetParent', { configurable: true, get: () => document.body });
        document.body.appendChild(container);

        mockCallbacks = {
            onNodeSelect: jest.fn(),
            onNodeLayoutUpdate: jest.fn(),
            onConnectionUpdate: jest.fn(),
            onAddStep: jest.fn(),
            onDeleteStep: jest.fn(),
            onCloneStep: jest.fn(),
            onRequestAddStepAfter: jest.fn(),
        };

        visualizer = new FlowVisualizer(container, mockCallbacks);

        mockFlow = createTemplateFlow();
        mockFlow.steps = [
            { ...createNewStep('request'), id: 'step1', name: 'Step 1' },
            { ...createNewStep('request'), id: 'step2', name: 'Step 2' },
        ];

        mockFlow.visualLayout = mockFlow.visualLayout || {};
        mockFlow.steps.forEach((step, index) => {
            const xPos = CANVAS_PADDING + index * (NODE_WIDTH + H_SPACING);
            const yPos = CANVAS_PADDING;
            mockFlow.visualLayout[step.id] = {
                x: xPos,
                y: yPos,
                width: NODE_WIDTH,
                height: NODE_MIN_HEIGHT,
                collapsed: false,
                ...mockFlow.visualLayout[step.id],
            };
        });
    });

    afterEach(async () => {
        if (visualizer && typeof visualizer.destroy === 'function') {
            visualizer.destroy();
        }
        if (container && container.parentNode) {
            document.body.removeChild(container);
        }
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    test('renders base drawflow structure', async () => {
        visualizer.render(createTemplateFlow(), null);
        await waitForVisualizerRender();
        expect(container.querySelector('.drawflow')).toBeTruthy();
        expect(container.querySelector('.visualizer-canvas')).toBeTruthy();
    });

    test('renders empty state correctly', async () => {
        const emptyFlow = createTemplateFlow();
        visualizer.render(emptyFlow, null);
        await waitForVisualizerRender();
        const placeholderMessage = container.querySelector('.placeholder-message');
        expect(placeholderMessage).toBeTruthy();
        expect(placeholderMessage.textContent).toContain('No steps to visualize');
    });

    test('renders nodes for simple flow', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const nodes = container.querySelectorAll('.drawflow-node.flow-node');
        expect(nodes.length).toBe(2);
        expect(nodes[0].dataset.stepId).toBe('step1');
        expect(nodes[0].querySelector('.node-name').textContent).toBe('Step 1');
        expect(nodes[1].dataset.stepId).toBe('step2');
    });

    test('renders nodes with saved layout positions', async () => {
        mockFlow.visualLayout.step1 = { x: 100, y: 200, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT };
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const node = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        expect(node.style.left).toBe('100px');
        expect(node.style.top).toBe('200px');
    });

    test('renders condition nodes with branches and connectors', async () => {
        const conditionFlow = createTemplateFlow();
        const thenStep = { ...createNewStep('request'), id: 'then1', name: 'Then 1' };
        const elseStep = { ...createNewStep('request'), id: 'else1', name: 'Else 1' };
        conditionFlow.steps = [{
            id: 'cond1',
            name: 'Cond 1',
            type: 'condition',
            conditionData: { variable: 'v', operator: 'equals', value: '1' },
            thenSteps: [thenStep],
            elseSteps: [elseStep],
        }];
        conditionFlow.visualLayout = {
            cond1: { x: 50, y: 50, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            then1: { x: 50, y: 50 + NODE_MIN_HEIGHT + H_SPACING, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            else1: { x: 50, y: 50 + (NODE_MIN_HEIGHT + H_SPACING) * 2, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
        };
        visualizer.render(conditionFlow, null);
        await waitForVisualizerRender();
        const nodes = container.querySelectorAll('.drawflow-node.flow-node');
        expect(nodes.length).toBe(3);
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(2);
    });

    test('triggers node selection callback on click', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const node = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        const clickEvent = new MouseEvent('mousedown', { bubbles: true, clientX: 12, clientY: 12 });
        node.dispatchEvent(clickEvent);
        expect(mockCallbacks.onNodeSelect).toHaveBeenCalledWith('step1');
    });

    test('updates node highlight state', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        visualizer.highlightNode('step1', 'active');
        const node = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        expect(node.classList.contains('active-step')).toBe(true);
        visualizer.clearHighlights();
        expect(node.classList.contains('active-step')).toBe(false);
    });

    test('updates runtime info display', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        visualizer.updateNodeRuntimeInfo('step1', { status: 'success', output: { status: 200 } });
        const node = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        const runtimeInfo = node.querySelector('.node-runtime-details');
        expect(runtimeInfo.textContent).toContain('Status: 200');
        expect(runtimeInfo.querySelector('.status-success')).toBeTruthy();
    });

    test('node moved event triggers layout update callback', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();

        const drawflowId = visualizer.nodeIdByStepId.get('step1');
        // A real Drawflow drag updates BOTH the data model (pos_x/pos_y) AND the
        // node element's style.left/top in lock-step (see drawflow position()).
        // The nodeMoved handler treats style.left/top as authoritative, so the
        // test must move the DOM element too — mutating the data model alone is
        // not how the interaction reaches the handler.
        const nodeData = visualizer.editor.drawflow.drawflow.Home.data[drawflowId];
        nodeData.pos_x = 300;
        nodeData.pos_y = 400;
        const nodeEl = container.querySelector(`#node-${drawflowId}`);
        nodeEl.style.left = '300px';
        nodeEl.style.top = '400px';

        visualizer.editor.dispatch('nodeMoved', drawflowId);
        expect(mockCallbacks.onNodeLayoutUpdate).toHaveBeenCalledWith('step1', 300, 400);
    });

    test('connection created forwards to connection update handler', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();

        const sourceId = visualizer.nodeIdByStepId.get('step1');
        const targetId = visualizer.nodeIdByStepId.get('step2');
        visualizer.editor.dispatch('connectionCreated', {
            output_id: sourceId,
            input_id: targetId,
            output_class: 'output_1',
            input_class: 'input_1',
        });

        expect(mockCallbacks.onConnectionUpdate).toHaveBeenCalledWith(expect.objectContaining({
            action: 'connect',
            sourceStepId: 'step1',
            targetStepId: 'step2',
            outputRole: 'main',
        }));
    });

    test('collapsed nodes hide descendants', async () => {
        const flowWithLoop = createTemplateFlow();
        const nestedStep = { ...createNewStep('request'), id: 'nested_s1' };
        const loopNodeDef = { ...createNewStep('loop'), id: 'loop_parent', loopSteps: [nestedStep] };
        flowWithLoop.steps = [loopNodeDef];
        flowWithLoop.visualLayout = {
            [loopNodeDef.id]: { x: 50, y: 50, collapsed: true, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            [nestedStep.id]: { x: 50, y: 250, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
        };
        visualizer.render(flowWithLoop, null);
        await waitForVisualizerRender();
        const loopNodeEl = container.querySelector(`.drawflow-node.flow-node[data-step-id="${loopNodeDef.id}"]`);
        expect(loopNodeEl.classList.contains('collapsed')).toBe(true);
        const childNodeEl = container.querySelector(`.drawflow-node.flow-node[data-step-id="${nestedStep.id}"]`);
        if (childNodeEl) {
            expect(childNodeEl.style.display).toBe('none');
        } else {
            expect(childNodeEl).toBeFalsy();
        }
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(0);
    });

    test('dragging a node updates flow model layout', async () => {
        appState.currentFlowModel = mockFlow;
        mockCallbacks.onNodeLayoutUpdate = (id, x, y) => {
            handleVisualizerNodeLayoutUpdate(id, x, y);
        };
        // Replace the beforeEach visualizer: destroy the old one first so its
        // modal (appended to document.body) does not leak into later tests.
        visualizer.destroy();
        visualizer = new FlowVisualizer(container, mockCallbacks);

        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();

        const drawflowId = visualizer.nodeIdByStepId.get('step1');
        // Mirror a real Drawflow drag: move both the data model and the DOM
        // element, which the nodeMoved handler reads as authoritative.
        const nodeData = visualizer.editor.drawflow.drawflow.Home.data[drawflowId];
        nodeData.pos_x = 500;
        nodeData.pos_y = 600;
        const nodeEl = container.querySelector(`#node-${drawflowId}`);
        nodeEl.style.left = '500px';
        nodeEl.style.top = '600px';

        visualizer.editor.dispatch('nodeMoved', drawflowId);

        expect(mockFlow.visualLayout.step1.x).toBe(500);
        expect(mockFlow.visualLayout.step1.y).toBe(600);
    });

    test('double-click opens node editor modal', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();

        const node = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        const dblClickEvent = new MouseEvent('dblclick', { bubbles: true });
        node.dispatchEvent(dblClickEvent);

        // Query THIS visualizer's modal. Each FlowVisualizer appends its own
        // .node-editor-modal to document.body, so a bare document.querySelector
        // can return a different visualizer's modal.
        const modal = visualizer.nodeEditorModal;
        const modalTitle = modal.querySelector('.node-editor-title');
        expect(modal.style.display).toBe('flex');
        expect(modalTitle.textContent).toContain('Step 1');
    });

    test('add step button triggers add-step callback', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();

        const node = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        // Use THIS visualizer's add button; a bare document.querySelector can
        // return the button of another visualizer's modal (see modal note above).
        const addButton = visualizer.nodeEditorModal.querySelector('.node-editor-add');
        addButton.click();

        expect(mockCallbacks.onRequestAddStepAfter).toHaveBeenCalledWith(
            'step1',
            expect.objectContaining({ onAdded: expect.any(Function) })
        );
    });
});
