import { createRoot } from 'react-dom/client';
import { createElement, createRef } from 'react';
import { ReactFlowVisualizerRoot } from './ReactFlowVisualizer.jsx';
import './island.css';

// islandEntry.jsx — the IIFE bundle's public surface.
//
// Vite builds this in lib/IIFE mode into assets/visualizer-island/island.js,
// assigning the module's exports to the global `FlowRunnerReactIsland` (see
// vite.config.js `lib.name`). The plain-JS facade (reactFlowVisualizer.js in the
// repo root) loads island.js as a same-origin <script>, then calls
// `window.FlowRunnerReactIsland.createReactFlowVisualizer(mount, options)`.
//
// This factory is INTERNAL to the island. The FlowVisualizer contract surface the
// app depends on lives on the facade class, which delegates here.

/**
 * Mount a React Flow island into `mountPoint` and return an imperative handle
 * exposing the full FlowVisualizer contract (docs/visualizer-contract.md).
 *
 * @param {HTMLElement} mountPoint
 * @param {object} [options] the seven contract callbacks (all optional)
 * @returns {object} an object with every contract method + a `destroy()` that
 *   unmounts the React root.
 */
export function createReactFlowVisualizer(mountPoint, options = {}) {
    if (!mountPoint) {
        throw new Error('FlowVisualizer requires a valid mount point element.');
    }
    const apiRef = createRef();
    const root = createRoot(mountPoint);
    root.render(createElement(ReactFlowVisualizerRoot, { apiRef, options }));

    // Bridge each contract method to the imperative handle. Methods are safe to
    // call before React commits (apiRef.current is null) — they no-op, matching
    // the app's "nullable at every call site" tolerance.
    const bridge = (name) => (...args) => apiRef.current?.[name]?.(...args);

    return {
        render: bridge('render'),
        getAutoLayout: (...a) => apiRef.current?.getAutoLayout?.(...a) || {},
        focusNode: bridge('focusNode'),
        highlightNode: bridge('highlightNode'),
        clearHighlights: bridge('clearHighlights'),
        updateNodeRuntimeInfo: bridge('updateNodeRuntimeInfo'),
        showMinimap: bridge('showMinimap'),
        hideMinimap: bridge('hideMinimap'),
        isMinimapVisible: (...a) => apiRef.current?.isMinimapVisible?.(...a) || false,
        zoomIn: bridge('zoomIn'),
        zoomOut: bridge('zoomOut'),
        resetZoom: bridge('resetZoom'),
        applyLayout: (...a) => apiRef.current?.applyLayout?.(...a) || 0,
        undoLayout: (...a) => apiRef.current?.undoLayout?.(...a) || false,
        canUndoLayout: (...a) => apiRef.current?.canUndoLayout?.(...a) || false,
        jumpToNextError: (...a) => apiRef.current?.jumpToNextError?.(...a) ?? null,
        destroy() {
            try {
                apiRef.current?.destroy?.();
            } finally {
                root.unmount();
            }
        },
    };
}
