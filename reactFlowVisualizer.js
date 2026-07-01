// reactFlowVisualizer.js
//
// === WAVE3 react-island ===
// Plain-JS facade for the FLAG-GATED React Flow visualizer engine.
//
// This is the app-side seam for the alternative node-graph engine. It honors the
// ENTIRE FlowVisualizer contract (docs/visualizer-contract.md: 13 core methods +
// applyLayout/undoLayout/canUndoLayout/jumpToNextError + 7 option callbacks) so
// the app can construct it identically to the default Drawflow adapter
// (flowVisualizer.js). The app selects between the two engines at construction
// via a flag; Drawflow remains the DEFAULT (see app.js -> initializeVisualizer()).
//
// The React/@xyflow code lives entirely inside a self-contained Vite island built
// to assets/visualizer-island/island.js (see visualizer-island/). This file loads
// that same-origin bundle as a <script> and delegates every contract call to the
// factory it exposes on `window.FlowRunnerReactIsland`. The app NEVER imports
// React — this class is pure ES-module JS with no build step of its own.
//
// CSP: the island is loaded as a same-origin relative <script src>, satisfying the
// packaged app's `script-src 'self'`. No inline scripts, no eval, no CDN. See
// docs/engine-decision.md.
//
// #1 RULE: assets/visualizer-island/** MUST be in package.json build.files (it is)
// or the packaged app cannot load the bundle. This module itself must also be
// listed. Both are wired in this wave.

const ISLAND_SCRIPT_URL = 'assets/visualizer-island/island.js';
const ISLAND_STYLE_URL = 'assets/visualizer-island/island.css';
const ISLAND_GLOBAL = 'FlowRunnerReactIsland';

// Module-level singleton promise so the bundle is fetched/evaluated at most once
// even if several visualizers are constructed over the app's lifetime.
let islandLoadPromise = null;

function loadIslandBundle() {
    if (islandLoadPromise) return islandLoadPromise;

    islandLoadPromise = new Promise((resolve, reject) => {
        // Already loaded (e.g. re-init after destroy): reuse the global.
        if (typeof globalThis !== 'undefined' && globalThis[ISLAND_GLOBAL]) {
            resolve(globalThis[ISLAND_GLOBAL]);
            return;
        }
        if (typeof document === 'undefined') {
            reject(new Error('ReactFlowVisualizer requires a DOM (document) to load its bundle.'));
            return;
        }

        // Inject the island stylesheet (same-origin, style-src 'self').
        if (!document.querySelector(`link[data-flowrunner-island="1"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = ISLAND_STYLE_URL;
            link.setAttribute('data-flowrunner-island', '1');
            document.head.appendChild(link);
        }

        const existing = document.querySelector('script[data-flowrunner-island="1"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(globalThis[ISLAND_GLOBAL]));
            existing.addEventListener('error', () => reject(new Error('Failed to load React Flow island bundle.')));
            return;
        }

        const script = document.createElement('script');
        script.src = ISLAND_SCRIPT_URL;
        script.setAttribute('data-flowrunner-island', '1');
        script.addEventListener('load', () => {
            const factory = globalThis[ISLAND_GLOBAL];
            if (factory && typeof factory.createReactFlowVisualizer === 'function') {
                resolve(factory);
            } else {
                reject(new Error('React Flow island loaded but did not expose createReactFlowVisualizer.'));
            }
        });
        script.addEventListener('error', () => reject(new Error('Failed to load React Flow island bundle.')));
        document.head.appendChild(script);
    });

    return islandLoadPromise;
}

/**
 * ReactFlowVisualizer — the flag-gated alternative to the Drawflow FlowVisualizer.
 *
 * Public shape is identical to flowVisualizer.js's FlowVisualizer (the contract).
 * Because the underlying island loads asynchronously, contract methods invoked
 * before the bundle is ready are QUEUED and flushed once the React root mounts.
 * This preserves the contract's "nullable / safe-to-call-early" tolerance: nothing
 * throws, and render/highlight/etc. issued during startup are applied in order.
 */
export class ReactFlowVisualizer {
    constructor(mountPoint, options = {}) {
        if (!mountPoint) {
            throw new Error('FlowVisualizer requires a valid mount point element.');
        }
        this.mountPoint = mountPoint;
        this.options = options || {};
        this._impl = null;       // the island factory's returned handle
        this._queue = [];        // { name, args } calls made before _impl exists
        this._destroyed = false;
        this._minimapVisible = false; // optimistic mirror for isMinimapVisible()

        loadIslandBundle()
            .then((factory) => {
                if (this._destroyed) return;
                this._impl = factory.createReactFlowVisualizer(this.mountPoint, this.options);
                // Flush queued calls in order.
                const queued = this._queue;
                this._queue = [];
                for (const { name, args } of queued) {
                    try {
                        this._impl[name]?.(...args);
                    } catch (err) {
                        // Never let a queued call break init.
                        // eslint-disable-next-line no-console
                        console.error(`ReactFlowVisualizer: queued ${name}() failed`, err);
                    }
                }
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.error('ReactFlowVisualizer: failed to initialize island engine.', err);
            });
    }

    // Fire-and-forget delegate: run now if ready, else queue.
    _call(name, args) {
        if (this._impl) {
            return this._impl[name]?.(...args);
        }
        this._queue.push({ name, args });
        return undefined;
    }

    // --- Contract methods (side-effecting) ---
    render(...args) { return this._call('render', args); }
    focusNode(...args) { return this._call('focusNode', args); }
    highlightNode(...args) { return this._call('highlightNode', args); }
    clearHighlights(...args) { return this._call('clearHighlights', args); }
    updateNodeRuntimeInfo(...args) { return this._call('updateNodeRuntimeInfo', args); }
    showMinimap(...args) { this._minimapVisible = true; return this._call('showMinimap', args); }
    hideMinimap(...args) { this._minimapVisible = false; return this._call('hideMinimap', args); }
    zoomIn(...args) { return this._call('zoomIn', args); }
    zoomOut(...args) { return this._call('zoomOut', args); }
    resetZoom(...args) { return this._call('resetZoom', args); }

    // --- Contract methods with return values the app reads ---
    getAutoLayout(...args) {
        return (this._impl ? this._impl.getAutoLayout?.(...args) : undefined) || {};
    }
    isMinimapVisible() {
        // Read through to the impl when available; otherwise the optimistic mirror.
        if (this._impl && typeof this._impl.isMinimapVisible === 'function') {
            return this._impl.isMinimapVisible();
        }
        return this._minimapVisible;
    }
    applyLayout(...args) {
        return (this._impl ? this._impl.applyLayout?.(...args) : undefined) || 0;
    }
    undoLayout(...args) {
        return (this._impl ? this._impl.undoLayout?.(...args) : undefined) || false;
    }
    canUndoLayout(...args) {
        return (this._impl ? this._impl.canUndoLayout?.(...args) : undefined) || false;
    }
    jumpToNextError(...args) {
        return (this._impl ? this._impl.jumpToNextError?.(...args) : undefined) ?? null;
    }

    // --- Teardown ---
    destroy() {
        this._destroyed = true;
        this._queue = [];
        try {
            this._impl?.destroy?.();
        } finally {
            this._impl = null;
        }
    }
}

export default ReactFlowVisualizer;
