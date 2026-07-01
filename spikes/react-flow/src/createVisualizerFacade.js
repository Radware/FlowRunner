import { createRoot } from 'react-dom/client';
import { createElement, createRef } from 'react';
import { ReactFlowVisualizerRoot } from './ReactFlowVisualizer.jsx';

// createReactFlowVisualizer(mountPoint, options)
//
// The plain-JS facade the app would actually construct. Its public shape is
// identical to the Drawflow FlowVisualizer (docs/visualizer-contract.md): 13
// methods, nullable, `new`-able, throws on falsy mount. This is the ONLY file
// the app-side seam touches; everything React lives behind it.
//
// Migration note: in the real app you'd export a `FlowVisualizer` class from a
// tiny wrapper that mounts the built bundle. The app's `initializeVisualizer()`
// changes by ONE import line. Nothing else in the renderer changes because this
// facade honors the contract exactly.
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
        destroy() {
            try {
                apiRef.current?.destroy?.();
            } finally {
                root.unmount();
            }
        },
    };
}
