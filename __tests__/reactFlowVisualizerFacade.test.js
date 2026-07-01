// __tests__/reactFlowVisualizerFacade.test.js
//
// WAVE3 react-island — smoke test for the plain-JS ReactFlowVisualizer facade
// (reactFlowVisualizer.js). This does NOT boot React/@xyflow; instead it stubs the
// island's global factory (window.FlowRunnerReactIsland) so we can prove the
// facade:
//   1. loads the bundle by injecting a same-origin <script data-flowrunner-island>
//      (CSP-relevant: same-origin, no inline),
//   2. queues contract calls made before the bundle resolves and flushes them in
//      order once the island mounts,
//   3. delegates every subsequent contract call to the island handle,
//   4. tears down cleanly on destroy().
//
// The facade caches its bundle-load promise at module scope, so we install the
// stub global + intercept <script> injection BEFORE importing the module, and
// import it dynamically inside the test.

import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';

// A fake island handle recording the calls the facade delegates to it.
function makeFakeHandle() {
    const calls = [];
    const rec = (name, ret) => (...args) => { calls.push({ name, args }); return ret; };
    return {
        calls,
        render: rec('render'),
        getAutoLayout: rec('getAutoLayout', { s1: { x: 5, y: 6 } }),
        focusNode: rec('focusNode'),
        highlightNode: rec('highlightNode'),
        clearHighlights: rec('clearHighlights'),
        updateNodeRuntimeInfo: rec('updateNodeRuntimeInfo'),
        showMinimap: rec('showMinimap'),
        hideMinimap: rec('hideMinimap'),
        isMinimapVisible: rec('isMinimapVisible', true),
        zoomIn: rec('zoomIn'),
        zoomOut: rec('zoomOut'),
        resetZoom: rec('resetZoom'),
        applyLayout: rec('applyLayout', 3),
        undoLayout: rec('undoLayout', true),
        canUndoLayout: rec('canUndoLayout', true),
        jumpToNextError: rec('jumpToNextError', 'stepZ'),
        destroy: rec('destroy'),
    };
}

describe('ReactFlowVisualizer facade smoke', () => {
    let originalCreateElement;
    let scriptEl;
    let fakeHandle;
    let factory;

    beforeEach(() => {
        jest.resetModules();
        scriptEl = null;
        fakeHandle = makeFakeHandle();
        factory = {
            createReactFlowVisualizer: jest.fn(() => fakeHandle),
        };

        // Intercept only the island <script> so we can drive its onload manually;
        // let every other createElement (link, div, …) behave normally.
        originalCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation((tag) => {
            const el = originalCreateElement(tag);
            if (tag === 'script') {
                scriptEl = el;
                // When the facade appends the script, "load" it by exposing the
                // global then firing the load event on the next microtask.
                const origAdd = el.addEventListener.bind(el);
                el.addEventListener = (type, cb, ...rest) => origAdd(type, cb, ...rest);
            }
            return el;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete globalThis.FlowRunnerReactIsland;
        document.querySelectorAll('[data-flowrunner-island]').forEach((n) => n.remove());
    });

    async function loadFacade() {
        const mod = await import('../reactFlowVisualizer.js');
        return mod.ReactFlowVisualizer;
    }

    // Simulate the browser finishing the same-origin script fetch: expose global,
    // dispatch 'load'. Then let queued microtasks/promise callbacks run.
    async function resolveIsland() {
        globalThis.FlowRunnerReactIsland = factory;
        scriptEl.dispatchEvent(new Event('load'));
        // Allow the load-promise .then() (which constructs _impl + flushes) to run.
        await Promise.resolve();
        await Promise.resolve();
    }

    test('injects a same-origin island <script> tagged for CSP-friendly loading', async () => {
        const ReactFlowVisualizer = await loadFacade();
        const mount = document.createElement('div');
        const vis = new ReactFlowVisualizer(mount, {});
        expect(scriptEl).toBeTruthy();
        expect(scriptEl.getAttribute('data-flowrunner-island')).toBe('1');
        expect(scriptEl.getAttribute('src')).toBe('assets/visualizer-island/island.js');
        // Relative src => same-origin under script-src 'self' (no scheme/host).
        expect(scriptEl.getAttribute('src')).not.toMatch(/^https?:|^\/\//);
        vis.destroy();
    });

    test('queues calls made before load, then flushes them in order on mount', async () => {
        const ReactFlowVisualizer = await loadFacade();
        const mount = document.createElement('div');
        const vis = new ReactFlowVisualizer(mount, { onNodeSelect: () => {} });

        // Pre-load calls: must not throw, must be queued (handle sees nothing yet).
        vis.render({ steps: [{ id: 's1' }] }, 's1');
        vis.highlightNode('s1', 'error');
        expect(fakeHandle.calls).toHaveLength(0);

        await resolveIsland();

        // The factory was constructed with the same mount + options.
        expect(factory.createReactFlowVisualizer).toHaveBeenCalledWith(mount, { onNodeSelect: expect.any(Function) });
        // Queue flushed in order.
        expect(fakeHandle.calls.map((c) => c.name)).toEqual(['render', 'highlightNode']);
        expect(fakeHandle.calls[0].args[1]).toBe('s1');

        vis.destroy();
    });

    test('delegates post-load calls and returns the island values', async () => {
        const ReactFlowVisualizer = await loadFacade();
        const mount = document.createElement('div');
        const vis = new ReactFlowVisualizer(mount, {});
        await resolveIsland();

        expect(vis.getAutoLayout()).toEqual({ s1: { x: 5, y: 6 } });
        expect(vis.isMinimapVisible()).toBe(true);
        expect(vis.applyLayout({ a: { x: 1, y: 2 } })).toBe(3);
        expect(vis.undoLayout()).toBe(true);
        expect(vis.canUndoLayout()).toBe(true);
        expect(vis.jumpToNextError()).toBe('stepZ');

        vis.focusNode('a');
        vis.clearHighlights('active-step');
        expect(fakeHandle.calls.some((c) => c.name === 'focusNode')).toBe(true);
        expect(fakeHandle.calls.some((c) => c.name === 'clearHighlights')).toBe(true);

        vis.destroy();
    });

    test('destroy() tears down the island handle and drops the queue', async () => {
        const ReactFlowVisualizer = await loadFacade();
        const mount = document.createElement('div');
        const vis = new ReactFlowVisualizer(mount, {});
        await resolveIsland();
        vis.destroy();
        expect(fakeHandle.calls.some((c) => c.name === 'destroy')).toBe(true);
        // Post-destroy calls are inert and never reach a torn-down handle.
        const before = fakeHandle.calls.length;
        vis.render({ steps: [] }, null);
        expect(fakeHandle.calls.length).toBe(before);
    });

    test('destroy() before the island loads cancels the pending mount', async () => {
        const ReactFlowVisualizer = await loadFacade();
        const mount = document.createElement('div');
        const vis = new ReactFlowVisualizer(mount, {});
        vis.render({ steps: [] }, null); // queued
        vis.destroy();                    // cancel before load resolves
        await resolveIsland();
        // Because it was destroyed first, the factory is never constructed.
        expect(factory.createReactFlowVisualizer).not.toHaveBeenCalled();
    });
});
