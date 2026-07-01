/**
 * autoLayout.js — engine-agnostic auto-layout adapter for FlowRunner flow trees.
 *
 * Purpose
 * -------
 * Given a FlowRunner step tree (respecting then / else / loop nesting), compute
 * an { [stepId]: { x, y } } position map that a renderer can consume to "tidy
 * up" the flow graph. This module is intentionally decoupled from
 * flowVisualizer.js — Wave 2 wires it into a "Tidy Up" button. It does NOT
 * import or mutate any renderer state.
 *
 * Engines
 * -------
 *   - Primary:  elkjs (ELK "layered", hierarchyHandling = INCLUDE_CHILDREN,
 *               orthogonal edge routing). Runs synchronously on the main thread
 *               in Node/Jest via ELK's inlined "fake worker"; in the packaged
 *               renderer it runs the same bundled worker under CSP script-src
 *               'self' (no CDN, no external worker file). See
 *               docs/auto-layout-spike.md.
 *   - Fallback: @dagrejs/dagre (pure-JS, synchronous). Used when ELK is
 *               unavailable/throws, or when the caller explicitly requests it.
 *
 * Determinism
 * -----------
 * Both engines are deterministic for a given input here: we always feed nodes
 * and edges in a stable (document) order and pass fixed spacing options, so the
 * same tree yields byte-identical positions across runs. Coordinates are
 * normalised to top-left origin and translated so the minimum x/y is >= 0.
 *
 * Field-name robustness
 * ---------------------
 * The in-memory model uses thenSteps / elseSteps / loopSteps; the on-disk
 * .flow.json uses then / else / steps. This module accepts BOTH so it can be
 * driven from either shape without a conversion pass.
 */

const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 90;

// Spacing constants — shared by both engines so their output is comparable.
const NODE_NODE_SPACING = 40;   // gap between sibling nodes
const LAYER_SPACING = 70;       // gap between layers (ranks)

/**
 * Return the child-step arrays for a container step, tolerating both the
 * in-memory (thenSteps/elseSteps/loopSteps) and on-disk (then/else/steps)
 * field names. Order is stable: then, else, loop body.
 *
 * @param {object} step
 * @returns {Array<{ role: string, steps: Array }>}
 */
function childBranches(step) {
    if (!step || typeof step !== 'object') return [];
    const branches = [];
    if (step.type === 'condition') {
        const thenSteps = step.thenSteps || step.then || [];
        const elseSteps = step.elseSteps || step.else || [];
        branches.push({ role: 'then', steps: Array.isArray(thenSteps) ? thenSteps : [] });
        branches.push({ role: 'else', steps: Array.isArray(elseSteps) ? elseSteps : [] });
    } else if (step.type === 'loop') {
        const loopSteps = step.loopSteps || step.steps || [];
        branches.push({ role: 'loop', steps: Array.isArray(loopSteps) ? loopSteps : [] });
    }
    return branches;
}

/**
 * Depth-first flatten of a step tree into a single ordered array, descending
 * into then/else/loop children. Container steps appear before their children.
 *
 * @param {Array} steps
 * @returns {Array<object>} every step, once, in document order
 */
function flattenSteps(steps) {
    const out = [];
    const walk = (list) => {
        if (!Array.isArray(list)) return;
        for (const step of list) {
            if (!step || typeof step !== 'object' || step.id == null) continue;
            out.push(step);
            for (const branch of childBranches(step)) {
                walk(branch.steps);
            }
        }
    };
    walk(steps);
    return out;
}

/**
 * Build a normalised graph description from the step tree:
 *   nodes:    [{ id, width, height, parent }]   (parent = enclosing container id or null)
 *   edges:    [{ id, source, target }]          (sequential + container->firstChild)
 *   children: Map<parentId|null, string[]>      (ordered child ids per container)
 *
 * Edge model (kept simple + deterministic):
 *   - Sequential edges between consecutive siblings at the same level.
 *   - One edge from a container to the first step of each of its branches.
 * This mirrors the connection model flowVisualizer already uses.
 *
 * @param {Array} steps
 * @param {object} nodeSizes  optional { [stepId]: { width, height } }
 */
function buildGraph(steps, nodeSizes) {
    const nodes = [];
    const edges = [];
    const sizes = nodeSizes || {};
    let edgeSeq = 0;

    const sizeFor = (id) => {
        const s = sizes[id] || {};
        const width = Number.isFinite(s.width) ? s.width : DEFAULT_NODE_WIDTH;
        const height = Number.isFinite(s.height) ? s.height : DEFAULT_NODE_HEIGHT;
        return { width, height };
    };

    const walk = (list, parentId) => {
        if (!Array.isArray(list)) return;
        let prevSiblingId = null;
        for (const step of list) {
            if (!step || typeof step !== 'object' || step.id == null) continue;
            const id = String(step.id);
            const { width, height } = sizeFor(id);
            nodes.push({ id, width, height, parent: parentId });

            // Sequential edge between consecutive siblings.
            if (prevSiblingId != null) {
                edges.push({ id: `e${edgeSeq++}`, source: prevSiblingId, target: id });
            }
            prevSiblingId = id;

            // Container -> first child of each branch.
            for (const branch of childBranches(step)) {
                if (branch.steps.length > 0) {
                    const firstChild = branch.steps.find(
                        (c) => c && typeof c === 'object' && c.id != null,
                    );
                    if (firstChild) {
                        edges.push({
                            id: `e${edgeSeq++}`,
                            source: id,
                            target: String(firstChild.id),
                        });
                    }
                }
                walk(branch.steps, id);
            }
        }
    };

    walk(steps, null);
    return { nodes, edges };
}

/**
 * Translate a position map so that the minimum x and y become 0 (top-left).
 * @param {object} positions { [id]: { x, y } }
 */
function normaliseOrigin(positions) {
    const ids = Object.keys(positions);
    if (ids.length === 0) return positions;
    let minX = Infinity;
    let minY = Infinity;
    for (const id of ids) {
        if (positions[id].x < minX) minX = positions[id].x;
        if (positions[id].y < minY) minY = positions[id].y;
    }
    if (!Number.isFinite(minX)) minX = 0;
    if (!Number.isFinite(minY)) minY = 0;
    for (const id of ids) {
        positions[id] = {
            x: Math.round(positions[id].x - minX),
            y: Math.round(positions[id].y - minY),
        };
    }
    return positions;
}

const ELK_DIRECTION = { DOWN: 'DOWN', UP: 'UP', RIGHT: 'RIGHT', LEFT: 'LEFT' };

/**
 * Lazily import elkjs' bundled build. The bundled build inlines the ELK worker
 * and provides a synchronous "fake worker" fallback, so it needs no external
 * worker URL — this is what keeps it CSP-clean in the packaged renderer.
 */
async function loadElk() {
    const mod = await import('elkjs/lib/elk.bundled.js');
    return mod.default || mod;
}

/**
 * Lazily import @dagrejs/dagre and normalise its default/namespace interop.
 */
async function loadDagre() {
    const mod = await import('@dagrejs/dagre');
    const dagre = mod.default || mod;
    // Some interop shapes nest the API one level deeper.
    if (dagre && !dagre.graphlib && dagre.default) return dagre.default;
    return dagre;
}

/**
 * Compute positions with ELK (layered, INCLUDE_CHILDREN, orthogonal routing).
 * @returns {Promise<object>} { [id]: { x, y } } in top-left coordinates
 */
async function layoutWithElk(graph, direction) {
    const ELK = await loadElk();
    const elk = new ELK();

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    // Group nodes by parent so we can express hierarchy to ELK.
    const childrenOf = new Map();
    childrenOf.set(null, []);
    for (const n of graph.nodes) {
        const key = n.parent == null ? null : n.parent;
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key).push(n.id);
    }

    const layoutOptions = {
        'elk.algorithm': 'layered',
        'elk.direction': ELK_DIRECTION[direction] || 'DOWN',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_SPACING),
        'elk.spacing.nodeNode': String(NODE_NODE_SPACING),
    };

    const buildElkNode = (id) => {
        const meta = nodeById.get(id);
        const node = { id, width: meta.width, height: meta.height };
        const kids = childrenOf.get(id) || [];
        if (kids.length > 0) {
            node.children = kids.map(buildElkNode);
        }
        return node;
    };

    const rootChildren = (childrenOf.get(null) || []).map(buildElkNode);
    const elkGraph = {
        id: 'root',
        layoutOptions,
        children: rootChildren,
        edges: graph.edges.map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
        })),
    };

    const laidOut = await elk.layout(elkGraph);

    // ELK reports child coordinates relative to their parent; accumulate the
    // absolute position by summing ancestor offsets during a recursive walk.
    const positions = {};
    const collect = (node, offsetX, offsetY) => {
        if (!node.children) return;
        for (const child of node.children) {
            const absX = offsetX + (child.x || 0);
            const absY = offsetY + (child.y || 0);
            positions[child.id] = { x: absX, y: absY };
            collect(child, absX, absY);
        }
    };
    collect(laidOut, 0, 0);
    return normaliseOrigin(positions);
}

/**
 * Compute positions with @dagrejs/dagre (compound graph for nesting). Dagre
 * reports node CENTERS, so we convert to top-left by subtracting half the size.
 * @returns {Promise<object>} { [id]: { x, y } } in top-left coordinates
 */
async function layoutWithDagre(graph, direction) {
    const dagre = await loadDagre();
    const rankdir = direction === 'RIGHT' || direction === 'LEFT' ? 'LR' : 'TB';

    const g = new dagre.graphlib.Graph({ compound: true, directed: true });
    g.setGraph({
        rankdir,
        nodesep: NODE_NODE_SPACING,
        ranksep: LAYER_SPACING,
        marginx: 0,
        marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const n of graph.nodes) {
        g.setNode(n.id, { width: n.width, height: n.height });
    }
    // Establish compound parent relationships after all nodes exist.
    for (const n of graph.nodes) {
        if (n.parent != null) {
            g.setParent(n.id, String(n.parent));
        }
    }
    for (const e of graph.edges) {
        g.setEdge(e.source, e.target);
    }

    dagre.layout(g);

    const positions = {};
    for (const n of graph.nodes) {
        const laid = g.node(n.id);
        if (!laid) continue;
        // Convert center -> top-left.
        positions[n.id] = {
            x: laid.x - n.width / 2,
            y: laid.y - n.height / 2,
        };
    }
    return normaliseOrigin(positions);
}

/**
 * Compute an auto-layout for a FlowRunner step tree.
 *
 * @param {Array} steps           the flow step tree (then/else/loop nesting).
 * @param {object} [options]
 * @param {'elk'|'dagre'} [options.engine='elk']  preferred engine; falls back
 *                                                 to the other on failure.
 * @param {object} [options.nodeSizes]  { [stepId]: { width, height } } overrides.
 * @param {'DOWN'|'UP'|'RIGHT'|'LEFT'} [options.direction='DOWN']  flow direction.
 * @returns {Promise<{ positions: object, engine: string }>}
 *          positions is { [stepId]: { x, y } } (top-left, origin-normalised).
 */
async function computeLayout(steps, options = {}) {
    const direction = options.direction || 'DOWN';
    const graph = buildGraph(steps, options.nodeSizes);

    if (graph.nodes.length === 0) {
        return { positions: {}, engine: options.engine === 'dagre' ? 'dagre' : 'elk' };
    }

    const preferred = options.engine === 'dagre' ? 'dagre' : 'elk';
    const order = preferred === 'dagre' ? ['dagre', 'elk'] : ['elk', 'dagre'];

    let lastError = null;
    for (const engine of order) {
        try {
            const positions =
                engine === 'elk'
                    ? await layoutWithElk(graph, direction)
                    : await layoutWithDagre(graph, direction);
            return { positions, engine };
        } catch (err) {
            lastError = err;
            // Try the next engine in the fallback chain.
        }
    }
    throw lastError || new Error('autoLayout: no layout engine succeeded');
}

export { computeLayout, flattenSteps, buildGraph, childBranches };
export default computeLayout;
