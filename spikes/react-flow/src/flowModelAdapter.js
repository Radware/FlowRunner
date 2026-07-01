// flowModelAdapter.js
//
// Translates FlowRunner's flow model (the nested step tree from a .flow.json,
// see httpbin-flow.flow.json) into React Flow `nodes` + `edges` arrays.
//
// This is the single most important artifact of the spike: it measures the real
// migration cost of the tree->graph mapping. The current Drawflow adapter
// (flowVisualizer.js) does this same walk with editor.addNode / addConnection;
// here we do it declaratively.
//
// Frozen .flow.json fields consumed (must stay additive-only per the cross-app
// contract): type, then/else/steps, conditionData, onFailure, loopVariable/source.

const ROLE_COLORS = {
    // Mirrors flowVisualizer.js ROLE_COLORS but expressed as CSS custom-property
    // references so the island consumes the Wave-1 OKLCH tokens instead of hexes.
    main: 'var(--border, #64748b)',
    then: 'var(--run-success, #10b981)',
    else: 'var(--run-error, #ef4444)',
    loop: 'var(--accent, #6366f1)',
};

// Which source handles each step type exposes. Matches _getPortCounts +
// _getOutputRole in flowVisualizer.js exactly.
function sourceRolesFor(type) {
    if (type === 'condition') return ['then', 'else'];
    if (type === 'loop') return ['loop'];
    return ['main'];
}

function conditionPreview(step) {
    const cd = step.conditionData;
    if (cd && cd.variable && cd.operator) {
        const val = cd.value !== undefined ? ` ${cd.value}` : '';
        return `${cd.variable} ${cd.operator}${val}`;
    }
    if (step.condition) return `Legacy: ${step.condition}`;
    return 'No condition set';
}

function contentFor(step) {
    switch (step.type) {
        case 'request':
            return { kind: 'request', method: step.method || 'GET', url: step.url || '' };
        case 'condition':
            return { kind: 'condition', text: conditionPreview(step) };
        case 'loop':
            return {
                kind: 'loop',
                variable: step.loopVariable || 'item',
                source: step.source || 'No source',
            };
        case 'transform':
            return { kind: 'transform', opCount: Array.isArray(step.ops) ? step.ops.length : 0 };
        default:
            return { kind: 'other', text: `Type: ${step.type}` };
    }
}

// Accepts BOTH shapes the app uses:
//   on-disk .flow.json:  then / else / steps
//   in-memory model:     thenSteps / elseSteps / loopSteps
function childBranches(step) {
    return {
        then: step.then || step.thenSteps || [],
        else: step.else || step.elseSteps || [],
        loop: step.steps || step.loopSteps || [],
    };
}

/**
 * @param {object} flowModel  a parsed .flow.json (or in-memory model) with `.steps`
 * @param {object} [positions] optional { [stepId]: {x,y} } from autoLayout.js
 * @returns {{ nodes: Array, edges: Array }} React Flow inputs
 */
export function flowModelToReactFlow(flowModel, positions = {}) {
    const nodes = [];
    const edges = [];

    // We track the previous sibling per branch so we can draw the sequential
    // "main" edges (step N -> step N+1) exactly like the linear runner order.
    function walk(steps, parentId, parentRole) {
        let prevId = null;
        steps.forEach((step) => {
            const pos = positions[step.id] || { x: 0, y: 0 };
            nodes.push({
                id: step.id,
                type: 'flowStep',
                position: { x: pos.x, y: pos.y },
                data: {
                    label: step.name || step.id,
                    stepType: step.type,
                    content: contentFor(step),
                    sourceRoles: sourceRolesFor(step.type),
                    onFailure: step.onFailure || null,
                },
            });

            // Edge from the branch owner (condition/loop) into this branch's first
            // step, coloured by role. Subsequent steps chain via 'main'.
            if (prevId === null && parentId) {
                edges.push(makeEdge(parentId, step.id, parentRole));
            } else if (prevId !== null) {
                edges.push(makeEdge(prevId, step.id, 'main'));
            }
            prevId = step.id;

            const branches = childBranches(step);
            if (step.type === 'condition') {
                walk(branches.then, step.id, 'then');
                walk(branches.else, step.id, 'else');
            } else if (step.type === 'loop') {
                walk(branches.loop, step.id, 'loop');
            }
        });
    }

    function makeEdge(source, target, role) {
        return {
            id: `${source}__${role}__${target}`,
            source,
            target,
            sourceHandle: role,
            type: 'smoothstep',
            style: { stroke: ROLE_COLORS[role] || ROLE_COLORS.main, strokeWidth: 2 },
            label: role === 'main' ? undefined : role,
        };
    }

    walk(flowModel.steps || [], null, null);
    return { nodes, edges };
}

// Count steps (including nested) — used by the spike UI to report graph size.
export function countSteps(flowModel) {
    let n = 0;
    (function walk(steps) {
        (steps || []).forEach((s) => {
            n += 1;
            const b = childBranches(s);
            walk(b.then);
            walk(b.else);
            walk(b.loop);
        });
    })(flowModel.steps || []);
    return n;
}
