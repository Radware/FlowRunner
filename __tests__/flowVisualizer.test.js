// __tests__/flowVisualizer.test.js
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowVisualizer } from '../flowVisualizer.js';
import { createTemplateFlow, createNewStep } from '../flowCore.js';

const NODE_WIDTH = 240; // From visualizer
const NODE_MIN_HEIGHT = 160; // From visualizer
const H_SPACING = 100;
const V_SPACING = 60;
const CANVAS_PADDING = 100;

// Use global.flushAllRAF from setup.js
const waitForVisualizerRender = async () => {
    // Run flushAllRAF multiple times with Jest's timers to ensure all async operations settle.
    // Jest's fake timers and rAF mocks can sometimes require this iterative approach.
    for (let i = 0; i < 5; i++) { // Increased iterations
        await global.flushAllRAF(5); // Run rAFs scheduled in this tick
        jest.runAllTimers();      // Run any setTimeout/setInterval
        await Promise.resolve();  // Allow promise microtasks to clear
    }
};


describe('FlowVisualizer', () => {
    let container;
    let visualizer;
    let mockCallbacks;
    let mockFlow;

    beforeEach(async () => {
        jest.useFakeTimers({ now: Date.now() });

        container = document.createElement('div');
        container.id = "visualizer-mount-point-test";
        container.style.width = '1200px';
        container.style.height = '1000px';
        Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1200 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 1000 });
        Object.defineProperty(container, 'offsetParent', { configurable: true, get: () => document.body });
        document.body.appendChild(container);

        mockCallbacks = {
            onNodeSelect: jest.fn(),
            onNodeLayoutUpdate: jest.fn(),
            onAddStep: jest.fn(),
            onDeleteStep: jest.fn(),
            onCloneStep: jest.fn()
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
                x: xPos, y: yPos,
                width: NODE_WIDTH, height: NODE_MIN_HEIGHT,
                collapsed: false,
                ...mockFlow.visualLayout[step.id]
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

    test('renders basic structure correctly', async () => {
        visualizer.render(createTemplateFlow(), null);
        await waitForVisualizerRender();
        const svg = container.querySelector('.flow-connector-svg');
        const canvas = container.querySelector('.visualizer-canvas');
        expect(svg).toBeTruthy();
        expect(canvas).toBeTruthy();
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
        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(2);
        expect(nodes[0].dataset.stepId).toBe('step1');
        expect(nodes[0].querySelector('.node-name').textContent).toBe('Step 1');
        expect(nodes[1].dataset.stepId).toBe('step2');
    });

    test('renders nodes with saved layout positions', async () => {
        mockFlow.visualLayout.step1 = { x: 100, y: 200, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT };
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const node = container.querySelector('.flow-node[data-step-id="step1"]');
        expect(node.style.left).toBe('100px');
        expect(node.style.top).toBe('200px');
    });

    test('renders condition nodes with branches and connectors', async () => {
        const conditionFlow = createTemplateFlow();
        const thenStep = { ...createNewStep('request'), id: 'then1', name: 'Then 1' };
        const elseStep = { ...createNewStep('request'), id: 'else1', name: 'Else 1' };
        conditionFlow.steps = [{
            id: 'cond1', name: 'Cond 1', type: 'condition', conditionData: { variable: 'v', operator: 'equals', value: '1' },
            thenSteps: [thenStep], elseSteps: [elseStep]
        }];
        conditionFlow.visualLayout = {
            cond1: { x: 50, y: 50, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            then1: { x: 50, y: 50 + NODE_MIN_HEIGHT + V_SPACING, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            else1: { x: 50, y: 50 + (NODE_MIN_HEIGHT + V_SPACING) * 2 + V_SPACING, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
        };
        visualizer.render(conditionFlow, null);
        await waitForVisualizerRender();
        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(3);
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(2);
    });

    test('triggers node selection callback on click (not drag)', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const node = container.querySelector('.flow-node[data-step-id="step1"]');
        visualizer.isDraggingNode = false;
        visualizer.dragStartX = 10;
        visualizer.dragStartY = 10;
        const clickEvent = new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 12 });
        node.dispatchEvent(clickEvent);
        expect(mockCallbacks.onNodeSelect).toHaveBeenCalledWith('step1');
    });

    test('updates node highlight state', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        visualizer.highlightNode('step1', 'active');
        const node = container.querySelector('.flow-node[data-step-id="step1"]');
        expect(node.classList.contains('active-step')).toBe(true);
        visualizer.clearHighlights();
        expect(node.classList.contains('active-step')).toBe(false);
    });

    test('updates runtime info display', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        visualizer.updateNodeRuntimeInfo('step1', { status: 'success', output: { status: 200 } });
        const node = container.querySelector('.flow-node[data-step-id="step1"]');
        const runtimeInfo = node.querySelector('.node-runtime-details');
        expect(runtimeInfo.textContent).toContain('Status: 200');
        expect(runtimeInfo.querySelector('.status-success')).toBeTruthy();
    });

    test('handles node dragging correctly', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const node = container.querySelector('.flow-node[data-step-id="step1"]');
        const nodeHeader = node.querySelector('.node-header');
        const initialNodeData = visualizer.nodes.get('step1');
        const initialLeft = initialNodeData.x;
        const initialTop = initialNodeData.y;
        const nodeRect = node.getBoundingClientRect();
        let mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, clientX: nodeRect.left + 10, clientY: nodeRect.top + 10, button: 0 });
        nodeHeader.dispatchEvent(mouseDownEvent);
        await waitForVisualizerRender();
        expect(node.classList.contains('dragging')).toBe(true);
        let mouseMoveEvent = new MouseEvent('mousemove', { bubbles: true, clientX: nodeRect.left + 60, clientY: nodeRect.top + 60 });
        document.dispatchEvent(mouseMoveEvent);
        await waitForVisualizerRender();
        let mouseUpEvent = new MouseEvent('mouseup', { bubbles: true, clientX: nodeRect.left + 60, clientY: nodeRect.top + 60 });
        document.dispatchEvent(mouseUpEvent);
        await waitForVisualizerRender();
        expect(mockCallbacks.onNodeLayoutUpdate).toHaveBeenCalledWith('step1', expect.any(Number), expect.any(Number));
        const updatedNodeData = visualizer.nodes.get('step1');
        expect(updatedNodeData.x).not.toBe(initialLeft);
        expect(updatedNodeData.y).not.toBe(initialTop);
        expect(node.classList.contains('dragging')).toBe(false);
    });

    test('handles canvas panning correctly', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const initialScrollLeft = visualizer.mountPoint.scrollLeft;
        const initialScrollTop = visualizer.mountPoint.scrollTop;
        const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 });
        visualizer.canvas.dispatchEvent(mouseDownEvent);
        const mouseMoveEvent = new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 70 });
        document.dispatchEvent(mouseMoveEvent);
        expect(visualizer.mountPoint.style.cursor).toBe('grabbing');
        const maxLeft = Math.max(0, visualizer.mountPoint.scrollWidth - visualizer.mountPoint.clientWidth);
        const maxTop = Math.max(0, visualizer.mountPoint.scrollHeight - visualizer.mountPoint.clientHeight);
        const expectedLeft = Math.max(0, Math.min(maxLeft, initialScrollLeft - (50 - 100)));
        const expectedTop = Math.max(0, Math.min(maxTop, initialScrollTop - (70 - 100)));
        expect(visualizer.mountPoint.scrollLeft).toBe(expectedLeft);
        expect(visualizer.mountPoint.scrollTop).toBe(expectedTop);
        const mouseUpEvent = new MouseEvent('mouseup', {});
        document.dispatchEvent(mouseUpEvent);
        expect(visualizer.mountPoint.style.cursor).toBe('grab');
    });

    test('triggers onDeleteStep when delete button is clicked', async () => {
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const deleteBtn = container.querySelector('.flow-node[data-step-id="step1"] .btn-delete-node');
        deleteBtn.click();
        expect(mockCallbacks.onDeleteStep).toHaveBeenCalledWith('step1');
    });

    test('handles selection state correctly', async () => {
        visualizer.render(mockFlow, 'step1');
        await waitForVisualizerRender();
        let node1 = container.querySelector('.flow-node[data-step-id="step1"]');
        let node2 = container.querySelector('.flow-node[data-step-id="step2"]');
        expect(node1.classList.contains('selected')).toBe(true);
        expect(node2.classList.contains('selected')).toBe(false);
        visualizer.render(mockFlow, 'step2');
        await waitForVisualizerRender();
        node1 = container.querySelector('.flow-node[data-step-id="step1"]');
        node2 = container.querySelector('.flow-node[data-step-id="step2"]');
        expect(node1.classList.contains('selected')).toBe(false);
        expect(node2.classList.contains('selected')).toBe(true);
    });

    test('calculates correct connector paths for simple flow', async () => {
        mockFlow.visualLayout = {
            step1: { x: 50, y: 100, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            step2: { x: 50 + NODE_WIDTH + H_SPACING, y: 100, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT }
        };
        visualizer.render(mockFlow, null);
        await waitForVisualizerRender();
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(1);
        const connector = connectors[0];
        expect(connector.getAttribute('d')).toBeTruthy();
        expect(connector.getAttribute('marker-end')).toContain('url(#arrow');
    });

    test('renders loop nodes with nested steps and connectors', async () => {
        const loopFlow = createTemplateFlow();
        const nestedStep = {...createNewStep('request'), id: 'l_step1', name: 'Inside Loop'};
        loopFlow.steps = [{
            id: 'loop1', name: 'Loop 1', type: 'loop', source: 'data', loopVariable: 'item',
            loopSteps: [nestedStep]
        }];
        loopFlow.visualLayout = {
            loop1: { x: 50, y: 50, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            l_step1: { x: 50, y: 50 + NODE_MIN_HEIGHT + V_SPACING, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT }
        };
        visualizer.render(loopFlow, null);
        await waitForVisualizerRender();
        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(2);
        const loopNode = container.querySelector('.flow-node[data-step-id="loop1"]');
        expect(loopNode).toBeTruthy();
        const loopVariableDisplay = loopNode.querySelector('.node-content .loop-variable');
        expect(loopVariableDisplay).toBeTruthy();
        expect(loopVariableDisplay.textContent).toBe('item');
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(1);
    });

    test('handles complex nested flow structure with connectors', async () => {
        const complexFlow = createTemplateFlow();
        const thenStep = {...createNewStep('request'), id: 'then1', name: 'Then Act'};
        const elseStep = {...createNewStep('request'), id: 'else1', name: 'Else Act'};
        const condStep = {...createNewStep('condition'), id: 'cond1', name: 'Inner Cond',
            conditionData: {variable: 'outerItem', operator: 'exists'},
            thenSteps: [thenStep], elseSteps: [elseStep]
        };
        const loopStep = {...createNewStep('loop'), id: 'loop1', name: 'Outer Loop',
            source: 'items', loopVariable: 'outerItem', loopSteps: [condStep]
        };
        complexFlow.steps = [loopStep];
        complexFlow.visualLayout = {
            loop1: { x:50, y:50, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            cond1: { x:50, y: 50 + NODE_MIN_HEIGHT + V_SPACING, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            then1: { x:50, y: 50 + (NODE_MIN_HEIGHT + V_SPACING) * 2, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            else1: { x:50, y: 50 + (NODE_MIN_HEIGHT + V_SPACING) * 3, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT }
        };
        visualizer.render(complexFlow, null);
        await waitForVisualizerRender();
        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(4);
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(3);
    });

    test('handles runtime updates for loop iterations display', async () => {
        const loopFlow = createTemplateFlow();
        loopFlow.steps = [{ id: 'loop1', name: 'My Loop', type: 'loop', loopSteps: [] }];
        loopFlow.visualLayout = { loop1: { x: 50, y: 50, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT } };
        visualizer.render(loopFlow, null);
        await waitForVisualizerRender();
        visualizer.updateNodeRuntimeInfo('loop1', { status: 'running', currentIteration: 2, totalIterations: 5 });
        const loopNode = container.querySelector('.flow-node[data-step-id="loop1"]');
        const runtimeInfo = loopNode.querySelector('.node-runtime-details');
        expect(runtimeInfo.textContent).toContain('Iter: 3/5');
    });

    test('persists and toggles collapsed state of complex nodes', async () => {
        const flowWithLoop = createTemplateFlow();
        const nestedStep = {...createNewStep('request'), id: 'nested_s1'};
        const loopNodeDef = {...createNewStep('loop'), id: 'loop_parent', loopSteps: [nestedStep]};
        flowWithLoop.steps = [loopNodeDef];
        flowWithLoop.visualLayout = {
            [loopNodeDef.id]: { x: 50, y: 50, collapsed: true, width: NODE_WIDTH, height: NODE_MIN_HEIGHT },
            [nestedStep.id]: { x: 50, y: 250, collapsed: false, width: NODE_WIDTH, height: NODE_MIN_HEIGHT }
        };
        visualizer.render(flowWithLoop, null);
        await waitForVisualizerRender();
        const loopNodeEl = container.querySelector(`.flow-node[data-step-id="${loopNodeDef.id}"]`);
        expect(loopNodeEl.classList.contains('collapsed')).toBe(true);
        const childNodeEl = container.querySelector(`.flow-node[data-step-id="${nestedStep.id}"]`);
        expect(childNodeEl.style.display).toBe('none');
        let connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(0);
        const toggleBtn = loopNodeEl.querySelector('.node-collapse-toggle');
        toggleBtn.click();
        await waitForVisualizerRender();
        const nodeData = visualizer.nodes.get(loopNodeDef.id);
        expect(mockCallbacks.onNodeLayoutUpdate).toHaveBeenCalledWith(loopNodeDef.id, nodeData.x, nodeData.y, { collapsed: false });
        flowWithLoop.visualLayout[loopNodeDef.id].collapsed = false;
        visualizer.render(flowWithLoop, null);
        await waitForVisualizerRender();
        const updatedLoopNodeEl = container.querySelector(`.flow-node[data-step-id="${loopNodeDef.id}"]`);
        const updatedChildNodeEl = container.querySelector(`.flow-node[data-step-id="${nestedStep.id}"]`);
        expect(updatedLoopNodeEl.classList.contains('collapsed')).toBe(false);
        expect(updatedChildNodeEl.style.display).not.toBe('none');
        connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(1);
    });
});