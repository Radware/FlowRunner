// __tests__/visualizerContract.test.js
//
// Guards the FlowVisualizer <-> app boundary described in docs/visualizer-contract.md.
//
// The app talks to the node-graph engine through a small, fixed surface:
//   - constructed as `new FlowVisualizer(mountPoint, options)`
//   - a set of public methods (CONTRACT_METHODS)
//   - a set of option callbacks the engine fires back (CONTRACT_CALLBACKS)
//
// This suite pins that surface so the engine can be swapped later without
// touching the rest of the app:
//   1. A `FakeVisualizer` double that implements exactly the contract, exercised
//      the way the app exercises it (proves the contract is sufficient + coherent).
//   2. A conformance test asserting the REAL FlowVisualizer exposes every method
//      the app depends on as a function.
//
// If you add/remove a call into `appState.visualizerComponent` anywhere in the
// app, update BOTH the arrays below AND docs/visualizer-contract.md.

import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowVisualizer } from '../flowVisualizer.js';

// --- The contract, as depended upon by the app (see docs/visualizer-contract.md) ---

// Public methods the app calls on the visualizer instance. Sourced by grepping
// every `visualizerComponent(?.).<method>` call across the renderer modules
// (app.js, uiUtils.js, eventHandlers.js, runnerInterface.js, flowBuilderComponent.js).
const CONTRACT_METHODS = [
    'render',
    'getAutoLayout',
    'focusNode',
    'highlightNode',
    'clearHighlights',
    'updateNodeRuntimeInfo',
    'showMinimap',
    'hideMinimap',
    'isMinimapVisible',
    'zoomIn',
    'zoomOut',
    'resetZoom',
    'destroy',
];

// Option callbacks the app wires in app.js -> initializeVisualizer(). All optional;
// the engine must tolerate any subset being present.
const CONTRACT_CALLBACKS = [
    'onNodeSelect',
    'onNodeLayoutUpdate',
    'onConnectionUpdate',
    'onDeleteStep',
    'onStepEdit',
    'onEditorDirtyChange',
    'onRequestAddStepAfter',
];

// --- A minimal fake/double that implements the contract ---
//
// This is the reference shape a replacement graph engine must satisfy. It records
// interactions so tests can assert the app's usage patterns are expressible.
class FakeVisualizer {
    constructor(mountPoint, options = {}) {
        if (!mountPoint) {
            throw new Error('FlowVisualizer requires a valid mount point element.');
        }
        this.mountPoint = mountPoint;
        this.options = options;

        this.rendered = null;              // last { flowModel, selectedStepId }
        this.highlights = new Map();       // stepId -> highlightType
        this.runtimeInfo = new Map();      // stepId -> result
        this.focusedStepId = null;
        this.minimapVisible = false;
        this.zoom = 1;
        this.destroyed = false;
    }

    render(flowModel, selectedStepId) {
        this.rendered = { flowModel, selectedStepId };
    }

    getAutoLayout() {
        const layout = {};
        const steps = this.rendered?.flowModel?.steps || [];
        steps.forEach((step, index) => {
            layout[step.id] = { x: index * 100, y: 0 };
        });
        return layout;
    }

    focusNode(stepId) {
        // Must no-op (not throw) for unknown ids.
        this.focusedStepId = stepId ?? null;
        return true;
    }

    highlightNode(stepId, highlightType = 'active') {
        if (stepId == null) return;
        this.highlights.set(stepId, highlightType);
    }

    // App sometimes passes an argument here (runnerInterface.js:298); it must be
    // safely ignorable. The app relies only on "highlights cleared".
    clearHighlights(_ignoredType) {
        this.highlights.clear();
    }

    updateNodeRuntimeInfo(stepId, result) {
        if (stepId == null) return;
        this.runtimeInfo.set(stepId, result);
    }

    showMinimap() {
        this.minimapVisible = true;
    }

    hideMinimap() {
        this.minimapVisible = false;
    }

    isMinimapVisible() {
        return this.minimapVisible;
    }

    zoomIn() {
        this.zoom += 0.1;
    }

    zoomOut() {
        this.zoom -= 0.1;
    }

    resetZoom() {
        this.zoom = 1;
    }

    destroy() {
        this.destroyed = true;
    }
}

describe('FlowVisualizer contract', () => {
    describe('contract definition sanity', () => {
        test('method + callback names are unique and non-empty', () => {
            expect(new Set(CONTRACT_METHODS).size).toBe(CONTRACT_METHODS.length);
            expect(new Set(CONTRACT_CALLBACKS).size).toBe(CONTRACT_CALLBACKS.length);
            for (const name of [...CONTRACT_METHODS, ...CONTRACT_CALLBACKS]) {
                expect(typeof name).toBe('string');
                expect(name.length).toBeGreaterThan(0);
            }
        });
    });

    describe('FakeVisualizer double implements the contract', () => {
        let mount;
        let callbacks;
        let vis;

        beforeEach(() => {
            mount = document.createElement('div');
            callbacks = Object.fromEntries(
                CONTRACT_CALLBACKS.map((name) => [name, jest.fn()])
            );
            vis = new FakeVisualizer(mount, callbacks);
        });

        test('exposes every contract method as a function', () => {
            for (const method of CONTRACT_METHODS) {
                expect(typeof vis[method]).toBe('function');
            }
        });

        test('constructing with a falsy mount point throws', () => {
            expect(() => new FakeVisualizer(null, {})).toThrow();
        });

        test('constructing with no options object does not throw', () => {
            expect(() => new FakeVisualizer(mount)).not.toThrow();
        });

        test('render + getAutoLayout round-trips a flow model (uiUtils/eventHandlers usage)', () => {
            const flowModel = { steps: [{ id: 'a' }, { id: 'b' }] };
            vis.render(flowModel, 'a');
            const layout = vis.getAutoLayout?.() || {};
            expect(Object.keys(layout)).toEqual(['a', 'b']);
            expect(layout.a).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
        });

        test('highlight lifecycle matches runnerInterface usage', () => {
            vis.highlightNode('step1', 'active-step');
            vis.highlightNode('step2', 'error');
            expect(vis.highlights.get('step1')).toBe('active-step');
            expect(vis.highlights.get('step2')).toBe('error');

            // clearHighlights is called both with and without an argument.
            vis.clearHighlights('active-step');
            expect(vis.highlights.size).toBe(0);

            vis.highlightNode('step3', 'stopped');
            vis.clearHighlights();
            expect(vis.highlights.size).toBe(0);
        });

        test('highlight/focus/runtimeInfo no-op safely for unknown ids', () => {
            expect(() => vis.highlightNode(null)).not.toThrow();
            expect(() => vis.updateNodeRuntimeInfo(undefined, {})).not.toThrow();
            expect(() => vis.focusNode(undefined)).not.toThrow();
            expect(vis.highlights.size).toBe(0);
            expect(vis.runtimeInfo.size).toBe(0);
        });

        test('updateNodeRuntimeInfo stores a run result', () => {
            vis.updateNodeRuntimeInfo('step1', { status: 'success', duration: 12 });
            expect(vis.runtimeInfo.get('step1')).toEqual({ status: 'success', duration: 12 });
        });

        test('minimap visibility toggles via isMinimapVisible + show/hide (eventHandlers usage)', () => {
            expect(vis.isMinimapVisible()).toBe(false);
            const willBeVisible = !vis.isMinimapVisible();
            if (willBeVisible) vis.showMinimap(); else vis.hideMinimap();
            expect(vis.isMinimapVisible()).toBe(true);

            const willBeVisible2 = !vis.isMinimapVisible();
            if (willBeVisible2) vis.showMinimap(); else vis.hideMinimap();
            expect(vis.isMinimapVisible()).toBe(false);
        });

        test('zoom controls are callable (eventHandlers toolbar usage)', () => {
            vis.zoomIn();
            vis.zoomOut();
            vis.resetZoom();
            expect(vis.zoom).toBe(1);
        });

        test('destroy is callable and guardable via typeof check (uiUtils usage)', () => {
            expect(typeof vis.destroy).toBe('function');
            vis.destroy();
            expect(vis.destroyed).toBe(true);
        });
    });

    describe('real FlowVisualizer conforms to the contract', () => {
        let mount;

        beforeEach(() => {
            mount = document.createElement('div');
            mount.id = 'visualizer-contract-mount';
            Object.defineProperty(mount, 'clientWidth', { configurable: true, value: 1200 });
            Object.defineProperty(mount, 'clientHeight', { configurable: true, value: 1000 });
            Object.defineProperty(mount, 'offsetParent', { configurable: true, get: () => document.body });
            document.body.appendChild(mount);
        });

        afterEach(() => {
            if (mount?.parentNode) mount.parentNode.removeChild(mount);
        });

        test('constructor throws without a mount point', () => {
            expect(() => new FlowVisualizer(null)).toThrow();
        });

        test('prototype exposes every method the app depends on as a function', () => {
            for (const method of CONTRACT_METHODS) {
                expect(typeof FlowVisualizer.prototype[method]).toBe(
                    'function',
                    `FlowVisualizer is missing contract method: ${method}`
                );
            }
        });

        test('a constructed instance exposes every contract method as a function', () => {
            const callbacks = Object.fromEntries(
                CONTRACT_CALLBACKS.map((name) => [name, jest.fn()])
            );
            const vis = new FlowVisualizer(mount, callbacks);
            try {
                for (const method of CONTRACT_METHODS) {
                    expect(typeof vis[method]).toBe('function');
                }
            } finally {
                vis.destroy();
            }
        });

        test('accepts a subset of the callback options without throwing', () => {
            // The app passes exactly CONTRACT_CALLBACKS; a partial set (and none at
            // all) must also be tolerated by the engine.
            expect(() => {
                const v = new FlowVisualizer(mount, { onNodeSelect: jest.fn() });
                v.destroy();
            }).not.toThrow();
        });
    });
});
