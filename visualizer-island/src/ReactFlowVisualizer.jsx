import { useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    MiniMap,
    useReactFlow,
    applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import FlowStepNode from './FlowStepNode.jsx';
import { flowModelToReactFlow } from './flowModelAdapter.js';

// ReactFlowVisualizerRoot — the React island that renders the flow graph.
//
// This implements the docs/visualizer-contract.md surface (17 methods + 7
// callbacks) on top of React Flow. The app never imports React: it talks to the
// plain-JS ReactFlowVisualizer facade (reactFlowVisualizer.js in the repo root),
// which loads the built island bundle and drives this component via an imperative
// handle exposed through `apiRef`.

const nodeTypes = { flowStep: FlowStepNode };

const HIGHLIGHT_CLASS = {
    'active-step': 'run-running',
    error: 'run-error',
    stopped: 'run-skipped',
};

function InnerGraph({ apiRef, options }) {
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [minimapVisible, setMinimapVisible] = useState(false);
    const rf = useReactFlow();
    const modelRef = useRef(null);
    // One-level layout-undo snapshot: { [stepId]: {x,y} } captured before the
    // most recent applyLayout, mirroring flowVisualizer.js's Tidy-Up undo.
    const layoutUndoRef = useRef(null);
    // Nodes currently flagged as errored (for jumpToNextError round-robin).
    const errorOrderRef = useRef([]);
    const errorCursorRef = useRef(0);

    const onNodesChange = useCallback((changes) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
        // Position changes -> onNodeLayoutUpdate callback (contract).
        changes
            .filter((c) => c.type === 'position' && c.dragging === false)
            .forEach((c) => options.onNodeLayoutUpdate?.({ id: c.id, position: c.position }));
    }, [options]);

    // Snapshot current node positions -> { [id]: {x,y} }.
    const snapshotPositions = useCallback((ids) => {
        const out = {};
        rf.getNodes().forEach((nd) => {
            if (!ids || ids.includes(nd.id)) {
                out[nd.id] = { x: nd.position.x, y: nd.position.y };
            }
        });
        return out;
    }, [rf]);

    // Expose the full contract surface to the outer facade via a ref.
    useImperativeHandle(apiRef, () => ({
        // 1. render(flowModel, selectedStepId)
        render(flowModel, selectedStepId) {
            modelRef.current = flowModel;
            const { nodes: n, edges: e } = flowModelToReactFlow(
                flowModel,
                flowModel.visualLayout || {},
            );
            const decorated = n.map((node) => ({
                ...node,
                selected: node.id === selectedStepId,
                data: {
                    ...node.data,
                    onDeleteStep: options.onDeleteStep,
                    onRequestAddStepAfter: options.onRequestAddStepAfter,
                },
            }));
            setNodes(decorated);
            setEdges(e);
            // A fresh render invalidates any layout-undo snapshot.
            layoutUndoRef.current = null;
        },
        // 2. getAutoLayout() -> { [stepId]: {x,y} }
        getAutoLayout() {
            return snapshotPositions(null);
        },
        // 3. focusNode(stepId)
        focusNode(stepId) {
            const nd = rf.getNode(stepId);
            if (!nd) return; // null-safe per contract
            rf.setCenter(nd.position.x, nd.position.y, { zoom: 1.2, duration: 300 });
        },
        // 4. highlightNode(stepId, type)
        highlightNode(stepId, type) {
            if (stepId == null) return;
            if (type === 'error' && !errorOrderRef.current.includes(stepId)) {
                errorOrderRef.current.push(stepId);
            }
            setNodes((nds) =>
                nds.map((nd) =>
                    nd.id === stepId
                        ? { ...nd, className: HIGHLIGHT_CLASS[type] || 'run-highlight' }
                        : nd,
                ),
            );
        },
        // 5. clearHighlights(_ignored)
        clearHighlights() {
            errorOrderRef.current = [];
            errorCursorRef.current = 0;
            setNodes((nds) => nds.map((nd) => ({ ...nd, className: undefined })));
        },
        // 6. updateNodeRuntimeInfo(stepId, result)
        updateNodeRuntimeInfo(stepId, result) {
            if (stepId == null) return;
            setNodes((nds) =>
                nds.map((nd) =>
                    nd.id === stepId
                        ? { ...nd, data: { ...nd.data, runtime: result } }
                        : nd,
                ),
            );
        },
        // 7-9. minimap
        showMinimap() { setMinimapVisible(true); },
        hideMinimap() { setMinimapVisible(false); },
        isMinimapVisible() { return minimapVisible; },
        // 10-12. zoom (native React Flow instance methods)
        zoomIn() { rf.zoomIn(); },
        zoomOut() { rf.zoomOut(); },
        resetZoom() { rf.fitView({ duration: 200 }); },
        // 13. destroy() — unmount handled by the facade; nothing to leak here.
        destroy() { setNodes([]); setEdges([]); },

        // 14. applyLayout(positions, { animate?, onlyStepIds? }) -> number moved.
        //     Snapshots pre-apply positions for one-level undo; onlyStepIds
        //     restricts the move so manually-placed nodes are preserved. Ignores
        //     unknown/stale ids. Returns node count moved.
        applyLayout(positions, opts = {}) {
            if (!positions || typeof positions !== 'object') return 0;
            const onlyStepIds = opts.onlyStepIds || null;
            const current = rf.getNodes();
            const currentIds = new Set(current.map((n) => n.id));
            const targetIds = Object.keys(positions).filter(
                (id) => currentIds.has(id) && (!onlyStepIds || onlyStepIds.includes(id)),
            );
            if (targetIds.length === 0) return 0;
            // Snapshot only the nodes we are about to move, for undo.
            layoutUndoRef.current = snapshotPositions(targetIds);
            const targetSet = new Set(targetIds);
            setNodes((nds) =>
                nds.map((nd) =>
                    targetSet.has(nd.id)
                        ? { ...nd, position: { x: positions[nd.id].x, y: positions[nd.id].y } }
                        : nd,
                ),
            );
            return targetIds.length;
        },
        // 15. undoLayout() -> boolean. Reverts the most recent applyLayout.
        undoLayout() {
            const snap = layoutUndoRef.current;
            if (!snap) return false;
            const ids = new Set(Object.keys(snap));
            setNodes((nds) =>
                nds.map((nd) =>
                    ids.has(nd.id)
                        ? { ...nd, position: { x: snap[nd.id].x, y: snap[nd.id].y } }
                        : nd,
                ),
            );
            layoutUndoRef.current = null;
            return true;
        },
        // 16. canUndoLayout() -> boolean.
        canUndoLayout() {
            return !!layoutUndoRef.current;
        },
        // 17. jumpToNextError() -> stepId | null. Cycles through errored nodes in
        //     the order they were flagged.
        jumpToNextError() {
            const errors = errorOrderRef.current;
            if (!errors.length) return null;
            const idx = errorCursorRef.current % errors.length;
            errorCursorRef.current = (errorCursorRef.current + 1) % errors.length;
            const stepId = errors[idx];
            const nd = rf.getNode(stepId);
            if (nd) rf.setCenter(nd.position.x, nd.position.y, { zoom: 1.2, duration: 300 });
            return stepId;
        },
    }), [rf, options, minimapVisible, snapshotPositions]);

    const onNodeClick = useCallback(
        (_e, node) => options.onNodeSelect?.(node.id),
        [options],
    );
    const onConnect = useCallback(
        (params) => options.onConnectionUpdate?.(params),
        [options],
    );

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onConnect={onConnect}
            fitView
            proOptions={{ hideAttribution: true }}
        >
            <Background />
            <Controls />
            {minimapVisible ? <MiniMap pannable zoomable /> : null}
        </ReactFlow>
    );
}

export function ReactFlowVisualizerRoot({ apiRef, options }) {
    return (
        <ReactFlowProvider>
            <InnerGraph apiRef={apiRef} options={options} />
        </ReactFlowProvider>
    );
}
