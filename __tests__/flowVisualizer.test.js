// flowVisualizer.test.js
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowVisualizer } from '../flowVisualizer.js';

describe('FlowVisualizer', () => {
    let container;
    let visualizer;
    let mockCallbacks;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);

        mockCallbacks = {
            onNodeSelect: jest.fn(),
            onNodeLayoutUpdate: jest.fn(),
            onAddStep: jest.fn(),
            onDeleteStep: jest.fn(),
            onCloneStep: jest.fn()
        };

        visualizer = new FlowVisualizer(container, mockCallbacks);
    });

    afterEach(() => {
        document.body.removeChild(container);
        visualizer.destroy();
    });

    test('renders basic structure correctly', () => {
        // Verify core elements exist
        const svg = container.querySelector('.flow-connector-svg');
        const canvas = container.querySelector('.visualizer-canvas');
        
        expect(svg).toBeTruthy();
        expect(canvas).toBeTruthy();
    });

    test('renders empty state correctly', () => {
        visualizer.render(null, null);
        
        const placeholderMessage = container.querySelector('.placeholder-message');
        expect(placeholderMessage).toBeTruthy();
        expect(placeholderMessage.textContent).toContain('No steps to visualize');
    });

    test('renders nodes for simple flow', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'First Step',
                    method: 'GET',
                    url: 'https://api.example.com'
                }
            ]
        };

        visualizer.render(mockFlow, null);

        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(1);

        const node = nodes[0];
        expect(node.querySelector('.node-name').textContent).toBe('First Step');
        expect(node.dataset.stepId).toBe('step1');
    });

    test('renders nodes with saved layout positions', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'First Step'
                }
            ],
            visualLayout: {
                step1: { x: 100, y: 200 }
            }
        };

        visualizer.render(mockFlow, null);

        const node = container.querySelector('.flow-node');
        expect(node.style.left).toBe('100px');
        expect(node.style.top).toBe('200px');
    });

    test('renders condition nodes with branches', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'cond1',
                    type: 'condition',
                    name: 'Check Status',
                    thenSteps: [
                        {
                            id: 'step1',
                            type: 'request',
                            name: 'Success Step'
                        }
                    ],
                    elseSteps: [
                        {
                            id: 'step2',
                            type: 'request',
                            name: 'Error Step'
                        }
                    ]
                }
            ]
        };

        visualizer.render(mockFlow, null);

        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(3); // Condition + 2 branch steps

        // Verify connectors are created
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(2); // Two connectors from condition to branch steps
    });

    test('triggers node selection callback', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Test Step'
                }
            ]
        };

        visualizer.render(mockFlow, null);

        const node = container.querySelector('.flow-node');
        node.click();

        expect(mockCallbacks.onNodeSelect).toHaveBeenCalledWith('step1');
    });

    test('updates node highlight state', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Test Step'
                }
            ]
        };

        visualizer.render(mockFlow, null);
        visualizer.highlightNode('step1', 'active');

        const node = container.querySelector('.flow-node');
        expect(node.classList.contains('active-step')).toBe(true);

        // Test clearing highlights
        visualizer.clearHighlights();
        expect(node.classList.contains('active-step')).toBe(false);
    });

    test('updates runtime info display', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Test Step'
                }
            ]
        };

        visualizer.render(mockFlow, null);

        visualizer.updateNodeRuntimeInfo('step1', {
            status: 'success',
            output: {
                status: 200
            }
        });

        const runtimeInfo = container.querySelector('.node-runtime-details');
        expect(runtimeInfo.textContent).toContain('200');
        expect(runtimeInfo.querySelector('.status-success')).toBeTruthy();
    });

    test('handles node dragging correctly', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Test Step'
                }
            ]
        };

        visualizer.render(mockFlow, null);
        const node = container.querySelector('.flow-node');

        // Simulate drag start
        const mouseDownEvent = new MouseEvent('mousedown', {
            bubbles: true,
            clientX: 100,
            clientY: 100
        });
        node.dispatchEvent(mouseDownEvent);
        expect(node.classList.contains('dragging')).toBe(true);

        // Simulate drag move
        const mouseMoveEvent = new MouseEvent('mousemove', {
            bubbles: true,
            clientX: 200,
            clientY: 150
        });
        document.dispatchEvent(mouseMoveEvent);

        // Check position update during drag
        expect(node.style.left).toBeDefined();
        expect(node.style.top).toBeDefined();

        // Simulate drag end
        const mouseUpEvent = new MouseEvent('mouseup', {
            bubbles: true,
            clientX: 200,
            clientY: 150
        });
        document.dispatchEvent(mouseUpEvent);

        // Verify onNodeLayoutUpdate was called with new position
        expect(mockCallbacks.onNodeLayoutUpdate).toHaveBeenCalledWith('step1', expect.any(Number), expect.any(Number));
        expect(node.classList.contains('dragging')).toBe(false);
    });

    test('handles canvas panning correctly', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Test Step'
                }
            ]
        };

        visualizer.render(mockFlow, null);
        
        // Mock scrollLeft/scrollTop since they're readonly
        Object.defineProperty(container, 'scrollLeft', {
            get: jest.fn(() => 0),
            set: jest.fn()
        });
        Object.defineProperty(container, 'scrollTop', {
            get: jest.fn(() => 0),
            set: jest.fn()
        });

        // Simulate pan start on empty area
        const mouseDownEvent = new MouseEvent('mousedown', {
            bubbles: true,
            clientX: 100,
            clientY: 100,
            button: 0 // Left mouse button
        });
        container.querySelector('.visualizer-canvas').dispatchEvent(mouseDownEvent);

        // Simulate pan move
        const mouseMoveEvent = new MouseEvent('mousemove', {
            bubbles: true,
            clientX: 50,
            clientY: 50
        });
        document.dispatchEvent(mouseMoveEvent);

        // Check cursor style during pan
        expect(container.style.cursor).toBe('grabbing');

        // Simulate pan end
        const mouseUpEvent = new MouseEvent('mouseup', {
            bubbles: true
        });
        document.dispatchEvent(mouseUpEvent);

        // Check cursor style after pan
        expect(container.style.cursor).toBe('grab');
    });

    test('triggers onDeleteStep when delete button is clicked', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Test Step'
                }
            ]
        };

        visualizer.render(mockFlow, null);

        const deleteBtn = container.querySelector('.btn-delete-node');
        deleteBtn.click();

        expect(mockCallbacks.onDeleteStep).toHaveBeenCalledWith('step1');
    });

    test('handles selection state correctly', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'Step 1'
                },
                {
                    id: 'step2',
                    type: 'request',
                    name: 'Step 2'
                }
            ]
        };

        // Initial render with step1 selected
        visualizer.render(mockFlow, 'step1');
        let nodes = container.querySelectorAll('.flow-node');
        expect(nodes[0].classList.contains('selected')).toBe(true);
        expect(nodes[1].classList.contains('selected')).toBe(false);

        // Update selection to step2
        visualizer.render(mockFlow, 'step2');
        nodes = container.querySelectorAll('.flow-node');
        expect(nodes[0].classList.contains('selected')).toBe(false);
        expect(nodes[1].classList.contains('selected')).toBe(true);
    });

    test('calculates correct connector paths', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'step1',
                    type: 'request',
                    name: 'First Step'
                },
                {
                    id: 'step2',
                    type: 'request',
                    name: 'Second Step'
                }
            ]
        };

        visualizer.render(mockFlow, null);

        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(1); // One connector between the two steps

        const connector = connectors[0];
        expect(connector.getAttribute('d')).toBeTruthy(); // Path data should be defined
        expect(connector.getAttribute('marker-end')).toContain('url(#arrow'); // Should have arrow marker
    });

    test('renders loop nodes with nested steps', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'loop1',
                    type: 'loop',
                    name: 'Process Items',
                    loopVariable: 'item',
                    source: '$.items',
                    loopSteps: [
                        {
                            id: 'step1',
                            type: 'request',
                            name: 'Process Item'
                        }
                    ]
                }
            ]
        };

        visualizer.render(mockFlow, null);

        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(2); // Loop + nested step

        // Verify loop node content
        const loopNode = nodes[0];
        expect(loopNode.querySelector('.node-name').textContent).toBe('Process Items');
        expect(loopNode.querySelector('.loop-variable').textContent).toBe('item');
        expect(loopNode.querySelector('.loop-source').textContent).toBe('$.items');

        // Verify connectors
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(1); // One connector from loop to nested step
    });

    test('handles complex nested flow structure', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'loop1',
                    type: 'loop',
                    name: 'Process Items',
                    loopSteps: [
                        {
                            id: 'cond1',
                            type: 'condition',
                            name: 'Check Item',
                            thenSteps: [
                                {
                                    id: 'step1',
                                    type: 'request',
                                    name: 'Process Valid'
                                }
                            ],
                            elseSteps: [
                                {
                                    id: 'step2',
                                    type: 'request',
                                    name: 'Handle Invalid'
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        visualizer.render(mockFlow, null);

        // Verify all nodes are rendered
        const nodes = container.querySelectorAll('.flow-node');
        expect(nodes.length).toBe(4); // Loop + Condition + 2 branch steps

        // Verify all connectors
        const connectors = container.querySelectorAll('.connector-path');
        expect(connectors.length).toBe(3); // Loop->Condition + Condition->Then + Condition->Else

        // Verify node positioning (complex nodes should stack vertically)
        const loopNode = container.querySelector('.flow-node[data-step-id="loop1"]');
        const condNode = container.querySelector('.flow-node[data-step-id="cond1"]');
        const thenNode = container.querySelector('.flow-node[data-step-id="step1"]');
        const elseNode = container.querySelector('.flow-node[data-step-id="step2"]');

        // Verify vertical arrangement
        expect(parseFloat(condNode.style.top)).toBeGreaterThan(parseFloat(loopNode.style.top));
        expect(parseFloat(thenNode.style.top)).toBeGreaterThan(parseFloat(condNode.style.top));
        expect(parseFloat(elseNode.style.top)).toBeGreaterThan(parseFloat(condNode.style.top));
    });
    
    test('handles runtime updates for loop iterations', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'loop1',
                    type: 'loop',
                    name: 'Process Items',
                    loopSteps: [
                        {
                            id: 'step1',
                            type: 'request',
                            name: 'Process Item'
                        }
                    ]
                }
            ]
        };

        visualizer.render(mockFlow, null);

        // Update with iteration info
        visualizer.updateNodeRuntimeInfo('loop1', {
            status: 'running',
            currentIteration: 2,
            totalIterations: 5,
            iterationResults: [
                { status: 'success' },
                { status: 'success' }
            ]
        });

        const loopNode = container.querySelector('.flow-node[data-step-id="loop1"]');
        const runtimeInfo = loopNode.querySelector('.node-runtime-details');
        
        expect(runtimeInfo.textContent).toContain('2/5');
        expect(runtimeInfo.querySelector('.status-running')).toBeTruthy();
    });

    test('persists collapsed state of complex nodes', () => {
        const mockFlow = {
            steps: [
                {
                    id: 'loop1',
                    type: 'loop',
                    name: 'Process Items',
                    loopSteps: [
                        {
                            id: 'step1',
                            type: 'request',
                            name: 'Process Item'
                        }
                    ],
                    visualState: {
                        collapsed: true
                    }
                }
            ]
        };

        visualizer.render(mockFlow, null);

        // Verify initial collapsed state
        const loopNode = container.querySelector('.flow-node[data-step-id="loop1"]');
        expect(loopNode.classList.contains('collapsed')).toBe(true);

        // Verify child nodes are hidden
        const childNode = container.querySelector('.flow-node[data-step-id="step1"]');
        expect(childNode.style.display).toBe('none');

        // Toggle collapsed state
        const toggleBtn = loopNode.querySelector('.node-collapse-toggle');
        toggleBtn.click();

        expect(mockCallbacks.onNodeLayoutUpdate).toHaveBeenCalledWith('loop1', expect.any(Number), expect.any(Number), {
            collapsed: false
        });
    });
});