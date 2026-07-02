import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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

// ReactFlowVisualizer — the CONTRACT SHIM.
//
// This proves the docs/visualizer-contract.md surface (13 methods + 7 callbacks)
// maps cleanly onto React Flow. The app talks to a plain-JS facade
// (createReactFlowVisualizer below) whose shape is byte-for-byte the Drawflow
// adapter's public API; internally the facade drives this React island.
//
// The app NEVER imports React. The seam is: `new FlowVisualizer(mount, options)`
// returns the facade; the facade mounts this component.

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

    const onNodesChange = useCallback((changes) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
        // Position changes -> onNodeLayoutUpdate callback (contract).
        changes
            .filter((c) => c.type === 'position' && c.dragging === false)
            .forEach((c) => options.onNodeLayoutUpdate?.({ id: c.id, position: c.position }));
    }, [options]);

    // Expose the 13 contract methods to the outer facade via a ref.
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
                data: { ...node.data, onDeleteStep: options.onDeleteStep },
            }));
            setNodes(decorated);
            setEdges(e);
        },
        // 2. getAutoLayout() -> { [stepId]: {x,y} }
        getAutoLayout() {
            const out = {};
            rf.getNodes().forEach((nd) => {
                out[nd.id] = { x: nd.position.x, y: nd.position.y };
            });
            return out;
        },
        // 3. focusNode(stepId)
        focusNode(stepId) {
            const nd = rf.getNode(stepId);
            if (!nd) return; // null-safe per contract
            rf.setCenter(nd.position.x, nd.position.y, { zoom: 1.2, duration: 300 });
        },
        // 4. highlightNode(stepId, type)
        highlightNode(stepId, type) {
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
            setNodes((nds) => nds.map((nd) => ({ ...nd, className: undefined })));
        },
        // 6. updateNodeRuntimeInfo(stepId, result)
        updateNodeRuntimeInfo(stepId, result) {
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
    }), [rf, options, minimapVisible]);

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
