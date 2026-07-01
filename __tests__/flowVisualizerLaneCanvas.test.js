// __tests__/flowVisualizerLaneCanvas.test.js
//
// WAVE2 LANE canvas — TDD coverage for:
//   (A) "Tidy Up" layout apply/undo mapping (applyLayout / undoLayout)
//   (B) on-node error badge state + "jump to next failed step" navigation
//
// These exercise the pure state mapping added to FlowVisualizer; the DOM
// side-effects (animation class, badge markup) are asserted against the real
// jsdom render, but the load-bearing contract here is the {x,y} apply mapping
// and the error badge state machine.

import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowVisualizer } from '../flowVisualizer.js';
import { createTemplateFlow, createNewStep } from '../flowCore.js';

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

const makeFlow = () => {
    const flow = createTemplateFlow();
    flow.steps = [
        { ...createNewStep('request'), id: 'step1', name: 'Step 1' },
        { ...createNewStep('request'), id: 'step2', name: 'Step 2' },
        { ...createNewStep('request'), id: 'step3', name: 'Step 3' },
    ];
    flow.visualLayout = {};
    flow.steps.forEach((step, index) => {
        flow.visualLayout[step.id] = {
            x: CANVAS_PADDING + index * (NODE_WIDTH + H_SPACING),
            y: CANVAS_PADDING,
            width: NODE_WIDTH,
            height: NODE_MIN_HEIGHT,
            collapsed: false,
        };
    });
    return flow;
};

describe('FlowVisualizer — Tidy Up (applyLayout / undoLayout)', () => {
    let container;
    let visualizer;
    let flow;

    beforeEach(async () => {
        jest.useFakeTimers({ now: Date.now() });
        container = document.createElement('div');
        container.style.width = '1200px';
        container.style.height = '1000px';
        Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1200 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 1000 });
        Object.defineProperty(container, 'offsetParent', { configurable: true, get: () => document.body });
        document.body.appendChild(container);

        visualizer = new FlowVisualizer(container, { onNodeLayoutUpdate: jest.fn() });
        flow = makeFlow();
        visualizer.render(flow, null);
        await waitForVisualizerRender();
    });

    afterEach(() => {
        visualizer?.destroy();
        if (container?.parentNode) document.body.removeChild(container);
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    test('applyLayout writes the {x,y} map onto node data and DOM', async () => {
        const applied = visualizer.applyLayout(
            { step1: { x: 10, y: 20 }, step2: { x: 30, y: 40 }, step3: { x: 50, y: 60 } },
            { animate: false }
        );
        expect(applied).toBe(3);
        await waitForVisualizerRender();

        expect(visualizer.nodes.get('step1').x).toBe(10);
        expect(visualizer.nodes.get('step1').y).toBe(20);
        expect(visualizer.nodes.get('step3').x).toBe(50);

        const node1 = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        expect(node1.style.left).toBe('10px');
        expect(node1.style.top).toBe('20px');
    });

    test('applyLayout persists positions into flowModel.visualLayout', () => {
        visualizer.applyLayout({ step1: { x: 11, y: 22 } }, { animate: false });
        expect(flow.visualLayout.step1.x).toBe(11);
        expect(flow.visualLayout.step1.y).toBe(22);
        // Untouched entries preserved.
        expect(flow.visualLayout.step2.x).toBe(CANVAS_PADDING + (NODE_WIDTH + H_SPACING));
    });

    test('applyLayout ignores positions for unknown / stale step ids (no throw)', () => {
        expect(() =>
            visualizer.applyLayout({ ghost: { x: 5, y: 5 }, step1: { x: 7, y: 8 } }, { animate: false })
        ).not.toThrow();
        expect(visualizer.nodes.get('step1').x).toBe(7);
        expect(flow.visualLayout.ghost).toBeUndefined();
    });

    test('applyLayout with onlyStepIds preserves manually-placed (unselected) nodes', () => {
        const beforeStep2X = visualizer.nodes.get('step2').x;
        visualizer.applyLayout(
            { step1: { x: 1, y: 2 }, step2: { x: 999, y: 999 }, step3: { x: 3, y: 4 } },
            { animate: false, onlyStepIds: ['step1', 'step3'] }
        );
        // step2 not in the selection -> untouched
        expect(visualizer.nodes.get('step2').x).toBe(beforeStep2X);
        expect(flow.visualLayout.step2.x).toBe(beforeStep2X);
        // selected nodes updated
        expect(visualizer.nodes.get('step1').x).toBe(1);
        expect(visualizer.nodes.get('step3').x).toBe(3);
    });

    test('applyLayout is idempotent — applying the same map twice yields the same state', () => {
        const map = { step1: { x: 12, y: 34 }, step2: { x: 56, y: 78 }, step3: { x: 90, y: 12 } };
        visualizer.applyLayout(map, { animate: false });
        const snapshotA = ['step1', 'step2', 'step3'].map((id) => ({
            x: visualizer.nodes.get(id).x,
            y: visualizer.nodes.get(id).y,
        }));
        visualizer.applyLayout(map, { animate: false });
        const snapshotB = ['step1', 'step2', 'step3'].map((id) => ({
            x: visualizer.nodes.get(id).x,
            y: visualizer.nodes.get(id).y,
        }));
        expect(snapshotB).toEqual(snapshotA);
    });

    test('undoLayout restores the previous positions and reports availability', () => {
        expect(visualizer.canUndoLayout()).toBe(false);
        const originalX = visualizer.nodes.get('step1').x;
        const originalY = visualizer.nodes.get('step1').y;

        visualizer.applyLayout({ step1: { x: 500, y: 600 } }, { animate: false });
        expect(visualizer.canUndoLayout()).toBe(true);
        expect(visualizer.nodes.get('step1').x).toBe(500);

        const undone = visualizer.undoLayout();
        expect(undone).toBe(true);
        expect(visualizer.nodes.get('step1').x).toBe(originalX);
        expect(visualizer.nodes.get('step1').y).toBe(originalY);
        expect(flow.visualLayout.step1.x).toBe(originalX);

        // Single-level undo: nothing more to undo.
        expect(visualizer.canUndoLayout()).toBe(false);
        expect(visualizer.undoLayout()).toBe(false);
    });

    test('animated applyLayout adds a transient relayout class then settles', async () => {
        visualizer.applyLayout({ step1: { x: 200, y: 200 } }, { animate: true });
        const node1 = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        expect(node1.classList.contains('tidy-relayout')).toBe(true);
        // Position applied immediately (transition animates it visually).
        expect(node1.style.left).toBe('200px');

        // After the transition window the class is removed.
        jest.advanceTimersByTime(400);
        await waitForVisualizerRender();
        expect(node1.classList.contains('tidy-relayout')).toBe(false);
    });
});

describe('FlowVisualizer — on-node error badges + jump-to-next-failed', () => {
    let container;
    let visualizer;
    let flow;

    beforeEach(async () => {
        jest.useFakeTimers({ now: Date.now() });
        container = document.createElement('div');
        Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1200 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 1000 });
        Object.defineProperty(container, 'offsetParent', { configurable: true, get: () => document.body });
        document.body.appendChild(container);

        visualizer = new FlowVisualizer(container, {});
        flow = makeFlow();
        visualizer.render(flow, null);
        await waitForVisualizerRender();
    });

    afterEach(() => {
        visualizer?.destroy();
        if (container?.parentNode) document.body.removeChild(container);
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    test('setNodeError records error state and renders a badge with the token class', () => {
        visualizer.setNodeError('step2', 'Boom: 500');
        expect(visualizer.getErrorStepIds()).toEqual(['step2']);

        const node2 = container.querySelector('.drawflow-node.flow-node[data-step-id="step2"]');
        expect(node2.classList.contains('has-run-error')).toBe(true);
        const badge = node2.querySelector('.node-error-badge');
        expect(badge).toBeTruthy();
        expect(badge.getAttribute('title')).toContain('Boom: 500');
    });

    test('highlightNode(stepId, "error") surfaces the badge automatically', () => {
        visualizer.highlightNode('step3', 'error');
        expect(visualizer.getErrorStepIds()).toContain('step3');
        const node3 = container.querySelector('.drawflow-node.flow-node[data-step-id="step3"]');
        expect(node3.classList.contains('has-run-error')).toBe(true);
    });

    test('updateNodeRuntimeInfo with an error result records the error message', () => {
        visualizer.updateNodeRuntimeInfo('step1', { status: 'error', error: 'Timeout after 30s' });
        expect(visualizer.getErrorStepIds()).toContain('step1');
        expect(visualizer.getNodeError('step1')).toContain('Timeout after 30s');
    });

    test('clearNodeErrors removes all badges and error state', () => {
        visualizer.setNodeError('step1', 'e1');
        visualizer.setNodeError('step3', 'e3');
        expect(visualizer.getErrorStepIds().length).toBe(2);

        visualizer.clearNodeErrors();
        expect(visualizer.getErrorStepIds()).toEqual([]);
        const node1 = container.querySelector('.drawflow-node.flow-node[data-step-id="step1"]');
        expect(node1.classList.contains('has-run-error')).toBe(false);
        expect(node1.querySelector('.node-error-badge')).toBeFalsy();
    });

    test('clearHighlights also clears error badges (fresh run resets state)', () => {
        visualizer.setNodeError('step2', 'stale');
        visualizer.clearHighlights();
        expect(visualizer.getErrorStepIds()).toEqual([]);
    });

    test('jumpToNextError cycles through failed steps in document order', () => {
        // No errors -> null.
        expect(visualizer.jumpToNextError()).toBeNull();

        visualizer.setNodeError('step1', 'e1');
        visualizer.setNodeError('step3', 'e3');

        const first = visualizer.jumpToNextError();
        expect(first).toBe('step1');
        const second = visualizer.jumpToNextError();
        expect(second).toBe('step3');
        // Wraps back around.
        const third = visualizer.jumpToNextError();
        expect(third).toBe('step1');
    });

    test('error badge state survives a re-render (persists via records, re-applied)', async () => {
        visualizer.setNodeError('step2', 'persist me');
        visualizer.render(flow, null);
        await waitForVisualizerRender();
        const node2 = container.querySelector('.drawflow-node.flow-node[data-step-id="step2"]');
        expect(node2.classList.contains('has-run-error')).toBe(true);
        expect(visualizer.getNodeError('step2')).toBe('persist me');
    });
});
