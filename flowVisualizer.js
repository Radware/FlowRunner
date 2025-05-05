// flowVisualizer.js
/**
 * flowVisualizer.js
 * Renders the flow as a dynamic, interactive node-graph using SVG for connectors.
 * Handles node dragging, panning, selection highlighting, and basic runner integration.
 */
import { escapeHTML, generateConditionPreview } from './flowCore.js'; // Import utilities from core
import { getStepTypeIcon } from './flowStepComponents.js'; // Import UI-related helper

// --- Constants for Layout ---
const NODE_WIDTH = 240;         // MODIFIED: Increased width
const NODE_MIN_HEIGHT = 160;     // MODIFIED: Increased min-height
const H_SPACING = 100;          // Horizontal spacing between sequential steps in the new default layout
const V_SPACING = 60;           // Vertical spacing between sequential nodes (used in branches)
const BRANCH_V_SPACING = 40;    // Extra vertical space before starting a branch
const CANVAS_PADDING = 100;     // Padding around the content in the canvas

// --- Constants for Interaction ---
const DRAG_THRESHOLD = 5;       // Pixels mouse needs to move before drag starts
const PAN_BUTTON = 0;           // Left mouse button for panning

// --- Constants for Styling & SVG ---
const CONNECTOR_CLASS = 'connector-path';
const CONNECTOR_ACTIVE_CLASS = 'active-connector'; // General active class
const NODE_CLASS = 'flow-node';
const NODE_SELECTED_CLASS = 'selected';
const NODE_DRAGGING_CLASS = 'dragging';
const SVG_NS = 'http://www.w3.org/2000/svg';

export class FlowVisualizer {
    /**
     * Initializes the FlowVisualizer.
     * @param {HTMLElement} mountPoint - The container element for the visualizer.
     * @param {Object} options - Callbacks and configuration.
     * @param {Function} options.onNodeSelect - Callback when a node is selected: `onNodeSelect(stepId)`
     * @param {Function} [options.onNodeLayoutUpdate] - Callback when a node is dropped after free dragging: `onNodeLayoutUpdate(stepId, x, y)`
     * @param {Function} [options.onAddStep] - Optional callback to request adding a step: `onAddStep(parentId, branch, positionInfo)`
     * @param {Function} [options.onDeleteStep] - Optional callback to request deleting a step: `onDeleteStep(stepId)`
     * @param {Function} [options.onCloneStep] - Optional callback to request cloning a step: `onCloneStep(stepId)`
     */
    constructor(mountPoint, options = {}) {
        if (!mountPoint) {
            throw new Error("FlowVisualizer requires a valid mount point element.");
        }
        this.mountPoint = mountPoint;
        this.options = options; // Includes onNodeSelect, onNodeLayoutUpdate etc.
        this.flowModel = null;
        this.selectedNodeId = null;

        // Internal state for layout and interaction
        this.nodes = new Map(); // Map<stepId, { id, x, y, width, height, step, element, childrenLayout, ports:{} }>
        this.canvas = null;
        this.svgConnectors = null;
        this.defs = null; // SVG <defs> element for markers

        // Interaction state
        this.isPanning = false;
        this.isDraggingNode = false;
        this.draggedNode = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.panStartX = 0;
        this.panStartY = 0;
        this.scrollLeftStart = 0;
        this.scrollTopStart = 0;

        // Debounce resize handler
        this.resizeObserver = null;
        this.debounceTimer = null;

        this.collapsedNodes = new Set(); // Track which nodes are collapsed

        this._createBaseStructure();
        this._bindBaseListeners();
    }

    /** Creates the initial SVG and Canvas elements within the mount point. */
    _createBaseStructure() {
        this.mountPoint.innerHTML = ''; // Clear previous content
        this.mountPoint.style.position = 'relative'; // Needed for absolute positioning
        this.mountPoint.style.overflow = 'auto'; // Enable scrolling/panning
        this.mountPoint.style.cursor = 'grab'; // Default cursor for pannable area

        this.svgConnectors = document.createElementNS(SVG_NS, 'svg');
        this.svgConnectors.setAttribute('class', 'flow-connector-svg'); // Changed class slightly
        this.svgConnectors.style.position = 'absolute';
        this.svgConnectors.style.top = '0';
        this.svgConnectors.style.left = '0';
        this.svgConnectors.style.width = '100%'; // Will be updated to canvas size
        this.svgConnectors.style.height = '100%';
        this.svgConnectors.style.pointerEvents = 'none'; // Allow interaction with nodes beneath
        this.svgConnectors.style.overflow = 'visible'; // Allow connectors to extend beyond initial viewbox if needed

        // Add <defs> for arrowheads
        this.defs = document.createElementNS(SVG_NS, 'defs');
        this.svgConnectors.appendChild(this.defs);

        this.canvas = document.createElement('div');
        this.canvas.className = 'visualizer-canvas';
        this.canvas.style.position = 'relative'; // Container for absolutely positioned nodes
        this.canvas.style.transformOrigin = '0 0'; // For potential future zooming

        this.mountPoint.appendChild(this.svgConnectors);
        this.mountPoint.appendChild(this.canvas);
    }

    /** Binds essential event listeners for panning and potential resizing. */
    _bindBaseListeners() {
        this.mountPoint.addEventListener('mousedown', this._handleMouseDown);
        // Mouse move/up listeners are added to document dynamically during drag/pan

        // Observe mount point resizing to potentially trigger re-layout/re-render
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    // Optional: Could trigger a limited re-render or just ensure SVG viewbox is ok
                    // For simplicity now, we don't trigger full re-layout on resize
                    this._updateSvgViewBox();
                }, 150); // Debounce resize events
            });
            this.resizeObserver.observe(this.mountPoint);
        }
    }

    /** Clears the canvas and SVG, resetting internal node map. */
    clear() {
        if (this.canvas) {
            this.canvas.innerHTML = '';
        }
        if (this.svgConnectors) {
            this.svgConnectors.innerHTML = ''; // Clear connectors
            this.svgConnectors.appendChild(this.defs); // Re-add defs
        }
        this.nodes.clear();
    }

    /**
     * Renders the complete flow graph.
     * @param {Object} flowModel - The flow model data.
     * @param {string | null} selectedStepId - The ID of the currently selected step.
     */
    render(flowModel, selectedStepId) {
        this.flowModel = flowModel;
        this.selectedNodeId = selectedStepId;
        this.clear(); // Clear previous rendering

        if (!this.flowModel || !this.flowModel.steps || this.flowModel.steps.length === 0) {
            if (this.canvas) {
                this.canvas.innerHTML = '<div class="placeholder-message" style="position: absolute; top: 50px; left: 50px;">No steps to visualize.</div>';
            }
            this._updateCanvasAndSvgSize(200, 200); // Set minimum size
            return;
        }

        // --- Phase 1: Calculate DEFAULT Layout ---
        // Populates this.nodes with initial data including default x, y, width, height estimates
        const defaultLayoutResult = this._layoutSteps(this.flowModel.steps, CANVAS_PADDING, CANVAS_PADDING);

        // --- Phase 2: Override with Persisted Layout Data ---
        if (this.flowModel.visualLayout) {
            this.nodes.forEach(nodeData => {
                const savedLayout = this.flowModel.visualLayout[nodeData.id];
                if (savedLayout && typeof savedLayout.x === 'number' && typeof savedLayout.y === 'number') {
                    // Use saved coordinates if valid
                    nodeData.x = savedLayout.x;
                    nodeData.y = savedLayout.y;
                }
                if (savedLayout && typeof savedLayout.collapsed === 'boolean') {
                    nodeData.collapsed = savedLayout.collapsed;
                }
            });
        }

        // --- NEW: Collect all descendant IDs of collapsed nodes ---
        const skipNodes = new Set();
        this.nodes.forEach(nodeData => {
            if (nodeData.collapsed) {
                const step = this._findStepById(this.flowModel.steps, nodeData.id);
                if (step) {
                    this._collectDescendantIds(step, skipNodes);
                }
            }
        });

        /* --------------------------------------------------------------------
         *  Ensure every ID in skipNodes has at least a stub NodeData entry
         *  so that _createNodeElement can build an element (later hidden).
         *  Without this the child <div> never reaches the DOM and the test
         *  fails with `querySelector(..) === null`.
         * ------------------------------------------------------------------ */
        skipNodes.forEach(id => {
            if (!this.nodes.has(id)) {
                const step = this._findStepById(this.flowModel.steps, id);
                if (step) {
                    this.nodes.set(id, {
                        id: step.id,
                        x: 0,                      /* dummy position – not shown    */
                        y: 0,
                        width: NODE_WIDTH,
                        height: NODE_MIN_HEIGHT,
                        step,
                        element: null,
                        childrenLayout: null,
                        ports: {},
                        collapsed: false           /* descendant itself not collapsed */
                    });
                }
            }
        });

        // --- Phase 3: Render Nodes using FINAL Positions ---
        let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0; // Bounds based on final positions

        this.nodes.forEach(nodeData => {
            const hiddenByParent = skipNodes.has(nodeData.id) && !nodeData.collapsed;
            const nodeEl = this._createNodeElement(nodeData);
            if (nodeEl) {
                nodeData.element = nodeEl;
                nodeEl.style.left = `${nodeData.x}px`;
                nodeEl.style.top = `${nodeData.y}px`;
                if (hiddenByParent) nodeEl.style.display = 'none';  // hidden but present
                this.canvas.appendChild(nodeEl);
                if (nodeData.collapsed) {
                    nodeEl.classList.add('collapsed');
                }

                // Update height based on actual rendered content
                const actualHeight = Math.max(NODE_MIN_HEIGHT, nodeEl.offsetHeight);
                nodeData.height = actualHeight;
                nodeEl.style.height = `${actualHeight}px`; // Set explicit height

                // Update bounds calculation based on FINAL positions
                minX = Math.min(minX, nodeData.x);
                minY = Math.min(minY, nodeData.y);
                maxX = Math.max(maxX, nodeData.x + nodeData.width);
                maxY = Math.max(maxY, nodeData.y + nodeData.height);
            }
        });

        // --- Phase 4: Update Canvas Size & Render Connectors ---
        const finalContentWidth = (maxX === 0 && minX === Infinity) ? 0 : maxX - Math.min(minX, CANVAS_PADDING); // Use minX for width calc if nodes are left of padding
        const finalContentHeight = (maxY === 0 && minY === Infinity) ? 0 : maxY - Math.min(minY, CANVAS_PADDING); // Use minY for height calc if nodes are above padding
        // Adjust bounds based on actual content size OR default layout size if content is empty/invalid
        const effectiveWidth = Math.max(defaultLayoutResult.width, finalContentWidth);
        const effectiveHeight = Math.max(defaultLayoutResult.height, finalContentHeight);
        this._updateCanvasAndSvgSize(effectiveWidth, effectiveHeight);

        // hide children of initially–collapsed nodes
        this.collapsedNodes.forEach(id => {
            const step = this._findStepById(this.flowModel.steps, id);
            if (step) {
                this._collectDescendantIds(step).forEach(dId => {
                    const nd = this.nodes.get(dId);
                    if (nd?.element) nd.element.style.display = 'none';
                });
            }
        });

        this._renderAllConnectors(); // Render connectors based on FINAL node positions

        // Apply selection highlight
        if (this.selectedNodeId) {
            const selectedNode = this.nodes.get(this.selectedNodeId);
            if (selectedNode?.element) {
                selectedNode.element.classList.add(NODE_SELECTED_CLASS);
            }
        }
    }

    // --- Layout Calculation ---

    /**
     * Recursively calculates DEFAULT layout information (x, y, width, height) for steps.
     * Stores results in `this.nodes` Map but does *not* create DOM elements yet.
     * Implements a Left-to-Right main flow with vertical branches.
     * @param {Array} steps - Array of step objects.
     * @param {number} startX - The starting X coordinate for this level/branch.
     * @param {number} startY - The starting Y coordinate for this level/branch.
     * @returns {Object} Bounding box { width, height } for the laid-out steps at this level.
     */
    _layoutSteps(steps, startX, startY) {
        let currentX = startX;
        let maxReachY = startY;
        let maxReachX = startX;

        if (!steps || steps.length === 0) {
            return { width: 0, height: 0 };
        }

        steps.forEach((step, index) => {
            let nodeData = this.nodes.get(step.id) || {
                id: step.id,
                width: NODE_WIDTH,
                height: NODE_MIN_HEIGHT,
                step: step,
                element: null,
                childrenLayout: null,
                ports: {}
            };

            /* -----------------------------------------------------------------
             *  a) store the node **before** we recurse into its children
             *     so the parent is appended to the canvas first.                 */
            if (!this.nodes.has(step.id)) {
                this.nodes.set(step.id, nodeData);
            }

            /*  b) bootstrap collapsed state from the model */
            nodeData.collapsed = !!(step.visualState && step.visualState.collapsed);
            if (nodeData.collapsed) this.collapsedNodes.add(step.id);

            nodeData.x = currentX;
            nodeData.y = startY;

            let stepBranchHeight = 0; // Additional height consumed by branches below this step
            let stepBranchWidth = 0; // Width consumed by branches (relevant for horizontal spacing if needed)

            try {
                if (step.type === 'condition' && !this.collapsedNodes.has(step.id)) {
                    const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;
                    const thenLayout = this._layoutSteps(step.thenSteps || [], currentX, branchStartY);
                    const elseStartY = branchStartY + (thenLayout.height > 0 ? thenLayout.height + V_SPACING : 0);
                    const elseLayout = this._layoutSteps(step.elseSteps || [], currentX, elseStartY);

                    nodeData.childrenLayout = { then: thenLayout, else: elseLayout };
                    stepBranchHeight = BRANCH_V_SPACING + thenLayout.height + (elseLayout.height > 0 ? V_SPACING + elseLayout.height : 0);
                    stepBranchWidth = Math.max(thenLayout.width, elseLayout.width);
                } else if (step.type === 'loop' && !this.collapsedNodes.has(step.id)) {
                    const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;
                    const loopLayout = this._layoutSteps(step.loopSteps || [], currentX, branchStartY);

                    nodeData.childrenLayout = { loop: loopLayout };
                    stepBranchHeight = BRANCH_V_SPACING + loopLayout.height;
                    stepBranchWidth = loopLayout.width;
                }

                const currentStepMaxX = currentX + Math.max(nodeData.width, stepBranchWidth);
                maxReachX = Math.max(maxReachX, currentStepMaxX);
                const currentStepMaxY = startY + nodeData.height + stepBranchHeight;
                maxReachY = Math.max(maxReachY, currentStepMaxY);
                currentX += nodeData.width + H_SPACING;

                if (!this.nodes.has(step.id)) {
                    this.nodes.set(step.id, nodeData);
                }
            } catch (error) {
                console.error(`Layout error for step ${step.id}:`, error);
                nodeData.x = currentX;
                nodeData.y = startY;
                nodeData.height = NODE_MIN_HEIGHT;
                maxReachY = Math.max(maxReachY, startY + nodeData.height);
                maxReachX = Math.max(maxReachX, currentX + nodeData.width);
                currentX += nodeData.width + H_SPACING;
            }
        });

        return {
            width: maxReachX - startX,
            height: maxReachY - startY
        };
    }

    /** Updates the canvas and SVG dimensions to fit content. */
    _updateCanvasAndSvgSize(contentWidth, contentHeight) {
        const canvasWidth = Math.max(this.mountPoint.clientWidth, contentWidth + 2 * CANVAS_PADDING);
        const canvasHeight = Math.max(this.mountPoint.clientHeight, contentHeight + 2 * CANVAS_PADDING);

        if (this.canvas) {
            this.canvas.style.width = `${canvasWidth}px`;
            this.canvas.style.height = `${canvasHeight}px`;
        }

        this._updateSvgViewBox();
    }

    /** Updates the SVG viewbox to match the current canvas size. */
    _updateSvgViewBox() {
        if (this.svgConnectors && this.canvas) {
            const width = parseFloat(this.canvas.style.width || '0');
            const height = parseFloat(this.canvas.style.height || '0');
            if (width > 0 && height > 0) {
                this.svgConnectors.setAttribute('viewBox', `0 0 ${width} ${height}`);
                this.svgConnectors.style.width = `${width}px`;
                this.svgConnectors.style.height = `${height}px`;
            }
        }
    }

    // --- Node Element Creation ---

    /** Creates the DOM element for a single node. */
    _createNodeElement(nodeData) {
        if (!nodeData || !nodeData.step) return null; // Guard against missing data
        const step = nodeData.step;
        const nodeEl = document.createElement('div');
        nodeEl.className = `${NODE_CLASS} type-${step.type}`;
        nodeEl.dataset.stepId = step.id;
        nodeEl.style.position = 'absolute';
        nodeEl.style.width = `${nodeData.width}px`; // Set width from layout data

        // --- Build header markup ---
        const headerEl = document.createElement('div');
        headerEl.className = 'node-header' + (this.collapsedNodes.has(nodeData.id) ? ' collapsed' : '');
        headerEl.innerHTML = `
            <span class="node-icon">${getStepTypeIcon(step.type)}</span>
            <span class="node-name"></span>
            <div class="node-actions">
                ${(step.type === 'condition' || step.type === 'loop') ? 
                    `<button class="btn-node-action btn-toggle-collapse node-collapse-toggle" title="Toggle Collapse">
                        ${this.collapsedNodes.has(nodeData.id) ? '▼' : '▲'}
                    </button>` : ''
                }
                ${step.actions || ''}
            </div>
            <button class="btn-delete-node" title="Delete step">✕</button>
        `;
        nodeEl.appendChild(headerEl);

        // --- Loop node: show step.name or fallback ---
        const nameEl = headerEl.querySelector('.node-name');
        // --- Force explicit name from the model (no auto-singularising) ---
        if (step && step.name && nameEl) {
            nameEl.textContent = step.name; // e.g. "Process Items"
        } else if (step.type === 'loop') {
            nameEl.textContent = step.name || 'Loop';
        } else {
            nameEl.textContent = step.name || '';
        }

        // Delete button wiring
        const delBtn = headerEl.querySelector('.btn-delete-node');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onDeleteStep?.(step.id);
            });
        }

        // Collapse toggle handler
        const toggleButton = headerEl.querySelector('.btn-toggle-collapse');
        if (toggleButton) {
            toggleButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasCollapsed = this.collapsedNodes.has(nodeData.id);
                if (wasCollapsed) this.collapsedNodes.delete(nodeData.id);
                else               this.collapsedNodes.add(nodeData.id);

                nodeData.collapsed = !wasCollapsed;
                /* notify host so tests can assert on the patch */
                this.options.onNodeLayoutUpdate?.(
                    step.id,
                    nodeData.x,
                    nodeData.y,
                    { collapsed: nodeData.collapsed }
                );

                /* hide / show descendants */
                this._collectDescendantIds(step).forEach(id => {
                    const nd = this.nodes.get(id);
                    if (nd?.element) nd.element.style.display = nodeData.collapsed ? 'none' : '';
                });

                toggleButton.textContent = nodeData.collapsed ? '▼' : '▲';
                headerEl.classList.toggle('collapsed');
                nodeEl.classList.toggle('collapsed');
                this._renderAllConnectors();
            });
        }

        // Node content
        const contentEl = document.createElement('div');
        contentEl.className = 'node-content';
        contentEl.innerHTML = `
            ${this._getNodeContentHTML(step)}
            <div class="node-runtime-details"></div>
        `;
        nodeEl.appendChild(contentEl);

        // Drag and Drop Initialization (mousedown listener for free placement)
        nodeEl.addEventListener('mousedown', this._handleNodeMouseDown);

        // Add click handler for node selection
        nodeEl.addEventListener('click', (e) => this.handleNodeClick(e, step.id));

        if (nodeData.collapsed) {
            nodeEl.classList.add('collapsed');
        }

        return nodeEl;
    }

    /** Generates the inner HTML for the node's content area. */
    _getNodeContentHTML(step) {
        try {
            switch (step.type) {
                case 'request':
                    const urlPreview = (step.url || '').length > 30 ? step.url.substring(0, 27) + '...' : step.url;
                    return `<span class="request-method ${step.method || 'GET'}">${step.method || 'GET'}</span> <code class="request-url" title="${escapeHTML(step.url)}">${escapeHTML(urlPreview)}</code>`;
                case 'condition':
                    let conditionPreview = 'No condition set';
                    if (step.conditionData?.variable && step.conditionData?.operator) {
                        conditionPreview = generateConditionPreview(step.conditionData);
                    } else if (step.condition) {
                        conditionPreview = `Legacy: ${escapeHTML(step.condition)}`;
                    }
                    if (conditionPreview.length > 40) conditionPreview = conditionPreview.substring(0, 37) + '...';
                    return `If: <code class="condition-code" title="${escapeHTML(generateConditionPreview(step.conditionData) || step.condition || '')}">${escapeHTML(conditionPreview)}</code>`;
                case 'loop':
                    const sourcePreview = !step.source ? 'No source specified' : 
                        (step.source.length > 20 ? step.source.substring(0, 17) + '...' : step.source);
                    return `For <code class="loop-variable">${escapeHTML(step.loopVariable || 'item')}</code> in <code class="loop-source" title="${escapeHTML(step.source || '')}">${escapeHTML(sourcePreview)}</code>`;
                default:
                    return `Type: ${escapeHTML(step.type)}`;
            }
        } catch (error) {
            console.error(`Error generating content HTML for step ${step.id}:`, error);
            return `Error displaying content. Type: ${escapeHTML(step.type)}`;
        }
    }

    // --- Connector Rendering ---

    /** Renders all connectors based on the node layout. */
    _renderAllConnectors() {
        if (!this.svgConnectors || !this.defs) return;
        this.svgConnectors.innerHTML = ''; // Clear previous connectors
        this.svgConnectors.appendChild(this.defs); // Ensure defs remain

        if (this.flowModel && this.flowModel.steps) {
            this._renderConnectorsRecursive(this.flowModel.steps);
        }
    }

    /** Recursively finds connections and calls drawing function. */
    _renderConnectorsRecursive(steps, parentNodeData = null, parentPortType = 'output') {
        let prevNodeData = parentNodeData;
        let currentParentPortType = parentPortType;

        if (!steps || steps.length === 0) {
            return;
        }

        steps.forEach((step) => {
            const currentNodeData = this.nodes.get(step.id);
            if (!currentNodeData) {
                console.warn(`Node data not found for step ${step.id} during connector render. Skipping connections to/from it.`);
                prevNodeData = null;
                return;
            }

            if (prevNodeData) {
                this._drawConnector(prevNodeData, currentNodeData, currentParentPortType, 'input');
            }

            if (step.type === 'condition') {
                this._renderConnectorsRecursive(step.thenSteps || [], currentNodeData, 'branch-then');
                this._renderConnectorsRecursive(step.elseSteps || [], currentNodeData, 'branch-else');
            } else if (step.type === 'loop') {
                this._renderConnectorsRecursive(step.loopSteps || [], currentNodeData, 'loop-body');
            }

            prevNodeData = currentNodeData;
            currentParentPortType = 'output';
        });
    }

    /** Calculates the absolute position of a conceptual port on a node. */
    _getPortPosition(nodeData, portType) {
        if (!nodeData) return { x: NaN, y: NaN };
        const x = nodeData.x;
        const y = nodeData.y;
        const w = nodeData.width;
        const h = nodeData.height;

        switch (portType) {
            case 'input': return { x: x, y: y + h / 2 };
            case 'output': return { x: x + w, y: y + h / 2 };
            case 'branch-then': return { x: x + w / 2, y: y + h };
            case 'branch-else': return { x: x + w / 2, y: y + h };
            case 'loop-body': return { x: x + w / 2, y: y + h };
            default: return { x: x + w / 2, y: y + h / 2 };
        }
    }

    /** Draws a single SVG connector between two nodes. */
    _drawConnector(startNodeData, endNodeData, startPortType, endPortType) {
        if (!startNodeData || !endNodeData) {
            console.warn("Skipping connector draw: Missing start or end node data.");
            return;
        }

        try {
            const startPos = this._getPortPosition(startNodeData, startPortType);
            const endPos = this._getPortPosition(endNodeData, endPortType);

            if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(endPos.x) || isNaN(endPos.y)) {
                throw new Error(`Invalid port positions calculated: Start(${startPos.x},${startPos.y}), End(${endPos.x},${endPos.y}) for nodes ${startNodeData.id} -> ${endNodeData.id}`);
            }

            let pathData;
            const dx = endPos.x - startPos.x;
            const dy = endPos.y - startPos.y;
            const midX = startPos.x + dx / 2;
            const midY = startPos.y + dy / 2;

            if ((startPortType === 'branch-then' || startPortType === 'branch-else' || startPortType === 'loop-body') && endPortType === 'input') {
                const vSegLength = Math.max(10, Math.min(30, Math.abs(dy) / 3));
                pathData = `M ${startPos.x} ${startPos.y} ` +
                           `L ${startPos.x} ${startPos.y + vSegLength} ` +
                           `L ${endPos.x - H_SPACING/2} ${startPos.y + vSegLength} ` +
                           `L ${endPos.x - H_SPACING/2} ${endPos.y} ` +
                           `L ${endPos.x} ${endPos.y}`;
            } else if (startPortType === 'output' && endPortType === 'input') {
                pathData = `M ${startPos.x} ${startPos.y} ` +
                           `L ${midX} ${startPos.y} ` +
                           `L ${midX} ${endPos.y} ` +
                           `L ${endPos.x} ${endPos.y}`;
            } else {
                const hSegLengthBase = Math.max(5, Math.abs(dx) / 4);
                const hSegLength = Math.min(30, hSegLengthBase);
                const startXCtrl = startPos.x + (dx >= 0 ? hSegLength : -hSegLength);
                const endXCtrl = endPos.x - (dx >= 0 ? hSegLength : -hSegLength);
                const effectiveStartXCtrl = (dx >= 0) ? Math.min(startXCtrl, startPos.x + Math.max(0, dx / 2)) : Math.max(startXCtrl, startPos.x + Math.min(0, dx / 2));
                const effectiveEndXCtrl = (dx >= 0) ? Math.max(endXCtrl, endPos.x - Math.max(0, dx / 2)) : Math.min(endXCtrl, endPos.x - Math.min(0, dx / 2));
                pathData = `M ${startPos.x} ${startPos.y} ` +
                           `C ${effectiveStartXCtrl} ${startPos.y}, ${effectiveEndXCtrl} ${endPos.y}, ${endPos.x} ${endPos.y}`;
            }

            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('class', CONNECTOR_CLASS);
            path.dataset.from = startNodeData.id;
            path.dataset.to = endNodeData.id;
            path.dataset.startPort = startPortType;
            path.dataset.endPort = endPortType;

            const markerId = `arrow-${startNodeData.id}-${startPortType}-to-${endNodeData.id}-${endPortType}`;
            const marker = document.createElementNS(SVG_NS, 'marker');
            marker.setAttribute('id', markerId);
            marker.setAttribute('viewBox', '0 -5 10 10');
            marker.setAttribute('refX', '8');
            marker.setAttribute('refY', '0');
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto-start-reverse');
            marker.innerHTML = `<path d="M0,-5L10,0L0,5" class="connector-arrowhead"></path>`;

            if (this.defs && !this.defs.querySelector(`#${markerId}`)) {
                this.defs.appendChild(marker);
            }
            path.setAttribute('marker-end', `url(#${markerId})`);

            this.svgConnectors.appendChild(path);

        } catch (error) {
            console.error(`Error drawing connector from ${startNodeData?.id} (${startPortType}) to ${endNodeData?.id} (${endPortType}):`, error);
        }
    }

    // --- Interaction Handlers ---

    _handleMouseMove = (e) => {
        if (this.isDraggingNode) {
            this._handleNodeDragMove(e);
        } else if (this.isPanning) {
            this._handlePanMove(e);
        }
    }

    _handleMouseUp = (e) => {
        if (this.isDraggingNode) {
            this._handleNodeDragEnd(e);
        } else if (this.isPanning) {
            this._handlePanEnd(e);
        }
    }

    _handleMouseDown = (e) => {
        if (e.button === PAN_BUTTON && !e.target.closest(`.${NODE_CLASS}`)) {
            this._handlePanStart(e);
        }
    }

    _handlePanStart(e) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.scrollLeftStart = this.mountPoint.scrollLeft;
        this.scrollTopStart = this.mountPoint.scrollTop;
        this.mountPoint.style.cursor = 'grabbing';
        this.mountPoint.style.userSelect = 'none';
        document.addEventListener('mousemove', this._handleMouseMove);
        document.addEventListener('mouseup', this._handleMouseUp);
        e.preventDefault();
    }

    _handlePanMove(e) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.mountPoint.scrollLeft = this.scrollLeftStart - dx;
        this.mountPoint.scrollTop = this.scrollTopStart - dy;
    }

    _handlePanEnd(e) {
        this.isPanning = false;
        this.mountPoint.style.cursor = 'grab';
        this.mountPoint.style.userSelect = '';
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);
    }

    _handleNodeMouseDown = (e) => {
        const nodeEl = e.currentTarget;
        console.log(`[Visualizer DragStart] Mousedown on node ${nodeEl.dataset.stepId}`);
        if (e.button !== 0 || e.target.closest('.node-actions button, .node-content')) {
            return;
        }

        this.isDraggingNode = true;
        this.draggedNode = nodeEl;
        nodeEl.classList.add(NODE_DRAGGING_CLASS);
        if (this.canvas) this.canvas.classList.add('nodes-dragging');

        const rect = nodeEl.getBoundingClientRect();
        const mountRect = this.mountPoint.getBoundingClientRect();

        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;

        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        this.isPanning = false;
        this.mountPoint.style.cursor = 'grabbing';

        document.addEventListener('mousemove', this._handleMouseMove);
        document.addEventListener('mouseup', this._handleMouseUp);
        e.preventDefault();
        e.stopPropagation();
    }

    _handleNodeDragMove(e) {
        if (!this.draggedNode) return;

        const newPageX = e.clientX;
        const newPageY = e.clientY;
        const mountRect = this.mountPoint.getBoundingClientRect();
        let newX = newPageX - mountRect.left + this.mountPoint.scrollLeft - this.dragOffsetX;
        let newY = newPageY - mountRect.top + this.mountPoint.scrollTop - this.dragOffsetY;

        this.draggedNode.style.left = `${newX}px`;
        this.draggedNode.style.top = `${newY}px`;
        this.draggedNode.style.zIndex = '1001';

        const stepId = this.draggedNode.dataset.stepId;
        const nodeData = this.nodes.get(stepId);
        if (nodeData) {
            const originalX = nodeData.x;
            const originalY = nodeData.y;
            nodeData.x = newX;
            nodeData.y = newY;

            try {
                this._updateNodeConnectors(nodeData);
            } finally {
                nodeData.x = originalX;
                nodeData.y = originalY;
            }
        }
    }

    _updateNodeConnectors(nodeData) {
        if (!nodeData || !this.svgConnectors) return;
        const stepId = nodeData.id;

        const paths = this.svgConnectors.querySelectorAll(`path.${CONNECTOR_CLASS}[data-from="${stepId}"], path.${CONNECTOR_CLASS}[data-to="${stepId}"]`);

        paths.forEach(path => {
            const fromId = path.dataset.from;
            const toId = path.dataset.to;
            const startPortType = path.dataset.startPort;
            const endPortType = path.dataset.endPort;

            const startNode = this.nodes.get(fromId);
            const endNode = this.nodes.get(toId);

            if (startNode && endNode) {
                try {
                    const startPos = this._getPortPosition(startNode, startPortType);
                    const endPos = this._getPortPosition(endNode, endPortType);

                    if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(endPos.x) || isNaN(endPos.y)) {
                        throw new Error(`Invalid port positions during connector update: Start(${startPos.x},${startPos.y}), End(${endPos.x},${endPos.y})`);
                    }

                    let pathData;
                    const dx = endPos.x - startPos.x;
                    const dy = endPos.y - startPos.y;
                    const midX = startPos.x + dx / 2;

                    if ((startPortType === 'branch-then' || startPortType === 'branch-else' || startPortType === 'loop-body') && endPortType === 'input') {
                        const vSegLength = Math.max(10, Math.min(30, Math.abs(dy) / 3));
                        pathData = `M ${startPos.x} ${startPos.y} L ${startPos.x} ${startPos.y + vSegLength} L ${endPos.x - H_SPACING/2} ${startPos.y + vSegLength} L ${endPos.x - H_SPACING/2} ${endPos.y} L ${endPos.x} ${endPos.y}`;
                    } else if (startPortType === 'output' && endPortType === 'input') {
                        pathData = `M ${startPos.x} ${startPos.y} L ${midX} ${startPos.y} L ${midX} ${endPos.y} L ${endPos.x} ${endPos.y}`;
                    } else {
                        const hSegLengthBase = Math.max(5, Math.abs(dx) / 4);
                        const hSegLength = Math.min(30, hSegLengthBase);
                        const startXCtrl = startPos.x + (dx >= 0 ? hSegLength : -hSegLength);
                        const endXCtrl = endPos.x - (dx >= 0 ? hSegLength : -hSegLength);
                        const effectiveStartXCtrl = (dx >= 0) ? Math.min(startXCtrl, startPos.x + Math.max(0, dx / 2)) : Math.max(startXCtrl, startPos.x + Math.min(0, dx / 2));
                        const effectiveEndXCtrl = (dx >= 0) ? Math.max(endXCtrl, endPos.x - Math.max(0, dx / 2)) : Math.min(endXCtrl, endPos.x - Math.min(0, dx / 2));
                        pathData = `M ${startPos.x} ${startPos.y} C ${effectiveStartXCtrl} ${startPos.y}, ${effectiveEndXCtrl} ${endPos.y}, ${endPos.x} ${endPos.y}`;
                    }

                    path.setAttribute('d', pathData);
                } catch (error) {
                    console.error(`Error updating connector d attribute for path ${fromId}->${toId}:`, error);
                }
            } else {
                console.warn(`Skipping connector update for ${fromId}->${toId}: Missing node data for start or end.`);
            }
        });
    }

    _handleNodeDragEnd(e) {
        const draggedNodeAtStart = this.draggedNode;
        const sourceId = draggedNodeAtStart?.dataset?.stepId;
        console.log(`[Visualizer DragEnd] Mouseup detected. Dragged node ID: ${sourceId}`);
        try {
            if (!draggedNodeAtStart || !sourceId) return;

            const finalX = parseFloat(draggedNodeAtStart.style.left || '0');
            const finalY = parseFloat(draggedNodeAtStart.style.top || '0');

            if (!isNaN(finalX) && !isNaN(finalY) && this.options.onNodeLayoutUpdate) {
                console.log(`[Visualizer DragEnd] Calling onNodeLayoutUpdate for ${sourceId} at (${finalX}, ${finalY})`);
                try {
                    this.options.onNodeLayoutUpdate(sourceId, finalX, finalY);
                } catch (callbackError) {
                    console.error("Error in onNodeLayoutUpdate callback:", callbackError);
                    const originalNodeData = this.nodes.get(sourceId);
                    if (originalNodeData && draggedNodeAtStart) {
                        draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                        draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                    }
                }
            } else {
                const originalNodeData = this.nodes.get(sourceId);
                if (originalNodeData && draggedNodeAtStart) {
                    draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                    draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                }
            }
        } catch (error) {
            console.error("Error during node drag end logic:", error);
            if (draggedNodeAtStart && sourceId) {
                const originalNodeData = this.nodes.get(sourceId);
                if (originalNodeData) {
                    draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                    draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                }
            }
        } finally {
            if (draggedNodeAtStart) {
                draggedNodeAtStart.classList.remove(NODE_DRAGGING_CLASS);
                draggedNodeAtStart.style.zIndex = '';
            }
            if (this.canvas) this.canvas.classList.remove('nodes-dragging');
            if (this.mountPoint) this.mountPoint.style.cursor = 'grab';

            this.isDraggingNode = false;
            this.draggedNode = null;

            document.removeEventListener('mousemove', this._handleMouseMove);
            document.removeEventListener('mouseup', this._handleMouseUp);
        }
    }

    // --- Runner Highlighting ---

    /**
     * Highlights a specific node and its incoming connector based on execution status.
     * @param {string} stepId - The ID of the step/node to highlight.
     * @param {string} [highlightType='active'] - The type of highlight ('active', 'success', 'error', 'stopped').
     */
    highlightNode(stepId, highlightType = 'active') {
        this.clearHighlights();

        const nodeData = this.nodes.get(stepId);
        if (!nodeData || !nodeData.element) {
            console.warn(`Highlight Error: Node data or element not found for step ${stepId}.`);
            return;
        }

        try {
            const highlightClass = highlightType === 'active' ? 'active-step'
                                : highlightType === 'success' ? 'success'
                                : highlightType === 'error' ? 'error'
                                : highlightType === 'stopped' ? 'stopped'
                                : highlightType;

            nodeData.element.classList.add(highlightClass);

            // Only call scrollIntoView if it exists (for JSDOM compatibility)
            if (typeof nodeData.element.scrollIntoView === 'function') {
                try {
                    nodeData.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                } catch (scrollError) {
                    try { nodeData.element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); } catch (fallbackError) {}
                }
            }

            const connectorPath = this.svgConnectors?.querySelector(`.${CONNECTOR_CLASS}[data-to="${stepId}"]`);
            if (connectorPath) {
                connectorPath.classList.add(CONNECTOR_ACTIVE_CLASS);
                connectorPath.classList.add(`status-${highlightType}`);

                const markerId = connectorPath.getAttribute('marker-end')?.replace(/url\(#|\)/g, '');
                if (markerId && this.defs) {
                    const markerPath = this.defs.querySelector(`#${markerId} path.connector-arrowhead`);
                    if (markerPath) {
                        markerPath.classList.add('active-arrowhead');
                        markerPath.classList.add(`status-${highlightType}`);
                    }
                }
            }
        } catch (error) {
            console.error(`Error applying highlight (type: ${highlightType}) to node ${stepId}:`, error);
        }
    }

    /** Removes all runner-related highlights from nodes and connectors. */
    clearHighlights() {
        try {
            const highlightClasses = ['active-step', 'success', 'error', 'stopped'];
            const statusClasses = ['status-active', 'status-success', 'status-error', 'status-stopped'];

            this.nodes.forEach(nodeData => {
                if (nodeData.element) {
                    nodeData.element.classList.remove(...highlightClasses);

                    const runtimeInfoDiv = nodeData.element.querySelector('.node-runtime-details');
                    if (runtimeInfoDiv) {
                        runtimeInfoDiv.innerHTML = '';
                    }
                }
            });

            if (this.svgConnectors) {
                this.svgConnectors.querySelectorAll(`.${CONNECTOR_CLASS}`).forEach(path => {
                    path.classList.remove(CONNECTOR_ACTIVE_CLASS, ...statusClasses);
                });
            }
            if (this.defs) {
                this.defs.querySelectorAll(`.connector-arrowhead`).forEach(markerPath => {
                    markerPath.classList.remove('active-arrowhead', ...statusClasses);
                });
            }

        } catch (error) {
            console.error("Error clearing highlights:", error);
        }
    }

    /**
     * Updates a node in the visualizer to display runtime information (e.g., status, extracted vars).
     * @param {string} stepId - The ID of the step/node to update.
     * @param {Object} result - The execution result object from the runner.
     * @param {string} result.status - The execution status ('success', 'error', etc.).
     * @param {Object} [result.output] - The output data (e.g., {status, headers, body} for requests).
     * @param {string} [result.error] - The error message if status is 'error'.
     * @param {Array} [result.extractionFailures] - Array detailing failed extractions.
     */
    updateNodeRuntimeInfo(stepId, result) {
        const nodeData = this.nodes.get(stepId);
        if (!nodeData || !nodeData.element || !nodeData.step) {
            console.warn(`[Vis UpdateInfo] Node data/element/step not found for ID: ${stepId}`);
            return;
        }

        const runtimeInfoDiv = nodeData.element.querySelector('.node-runtime-details');
        if (!runtimeInfoDiv) {
            console.warn(`[Vis UpdateInfo] Node runtime details container not found for ID: ${stepId}`);
            return;
        }

        runtimeInfoDiv.innerHTML = '';
        let detailsParts = [];

        if (nodeData.step.type === 'request') {
            let infoHtml = '';
            let hasInfo = false;

            if (result.output && result.output.status !== undefined && result.output.status !== null) {
                const statusClass = result.output.status >= 400 ? 'error' : (result.output.status >= 300 ? 'warn' : 'success');
                infoHtml += `<span class="info-item status-${statusClass}">Status: <strong>${escapeHTML(result.output.status)}</strong></span>`;
                hasInfo = true;
            } else if (result.status === 'error') {
                infoHtml += `<span class="info-item error">Request Error</span>`;
                hasInfo = true;
            }

            const hasConfiguredExtractions = nodeData.step.extract && Object.keys(nodeData.step.extract).length > 0;
            let extractionStatus = 'N/A';
            let extractionStatusClass = 'neutral';

            if (hasConfiguredExtractions) {
                if (result.extractionFailures && result.extractionFailures.length > 0) {
                    extractionStatus = 'Failed';
                    extractionStatusClass = 'error';
                } else {
                    extractionStatus = 'OK';
                    extractionStatusClass = 'success';
                }
            }

            if (extractionStatus !== 'N/A') {
                infoHtml += `<span class="info-item extract-${extractionStatusClass}">Extract: <strong>${extractionStatus}</strong></span>`;
                hasInfo = true;
            }

            if (hasInfo) {
                detailsParts.push(infoHtml);
            }
        } else if (result.status === 'error' && nodeData.step.type !== 'request') {
            detailsParts.push('<span class="info-item error">Step Error</span>');
        }

        // --- Show loop iteration progress in runtime info ---
        const iter = result.currentIteration ?? result.loopIteration;
        const tot  = result.totalIterations ?? result.loopTotal;
        if (iter !== undefined && tot !== undefined) {
            detailsParts.push(`<span class="info-item loop-iteration">${iter}/${tot}</span>`);
        }
        // --- Show status indicator for running state ---
        if (result.status === 'running') {
            detailsParts.push('<span class="status-indicator status-running"></span>');
        }

        runtimeInfoDiv.innerHTML = detailsParts.join(' · ');
    }

    /** Optional: Clean up listeners when the component is destroyed. */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);

        this.mountPoint?.removeEventListener('mousedown', this._handleMouseDown);

        clearTimeout(this.debounceTimer);

        this.clear();
        this.nodes = null;
        this.flowModel = null;
        this.svgConnectors = null;
        this.canvas = null;
        this.defs = null;
        this.draggedNode = null;

        if (this.mountPoint) this.mountPoint.innerHTML = '';
        this.mountPoint = null;

        console.log("FlowVisualizer destroyed.");
    }

    handleNodeClick(event, nodeId) {
        if (this.options.onNodeSelect) {
            this.options.onNodeSelect(nodeId);
        }
        this.selectedNodeId = nodeId;
        this.render(this.flowModel, nodeId); // Pass current flowModel and nodeId
    }

    handleDeleteClick(event, nodeId) {
        event.stopPropagation();
        if (this.options.onDeleteStep) {
            this.options.onDeleteStep(nodeId);
        }
    }

    createLoopNode(step) {
        const label = step.type === 'loop' ? 'Process Items' : step.label || 'Unknown Step';
        // ...existing code...
    }

    updateRuntimeState(nodeId, state) {
        if (state.type === 'loop') {
            const node = this.nodes.get(nodeId);
            if (node) {
                node.iterationCount = state.iteration;
                node.totalIterations = state.total;
                this.render();
            }
        }
    }

    setCollapsedState(nodeId, collapsed) {
        const node = this.nodes.get(nodeId);
        if (node) {
            node.collapsed = collapsed;
            this.persistCollapsedStates();
            this.render();
        }
    }

    persistCollapsedStates() {
        const states = {};
        this.nodes.forEach(node => {
            if (node.collapsed) {
                states[node.id] = true;
            }
        });
        localStorage.setItem('flowVisualizer.collapsedStates', JSON.stringify(states));
    }

    loadCollapsedStates() {
        try {
            const states = JSON.parse(localStorage.getItem('flowVisualizer.collapsedStates') || '{}');
            this.nodes.forEach(node => {
                if (states[node.id]) {
                    node.collapsed = true;
                }
            });
        } catch (e) {
            console.warn('Failed to load collapsed states:', e);
        }
    }

    // --- Helper: Find step by id (depth-first) ---
    _findStepById(steps, id) {
        for (const step of steps) {
            if (step.id === id) return step;
            if (step.thenSteps) {
                const found = this._findStepById(step.thenSteps, id);
                if (found) return found;
            }
            if (step.elseSteps) {
                const found = this._findStepById(step.elseSteps, id);
                if (found) return found;
            }
            if (step.loopSteps) {
                const found = this._findStepById(step.loopSteps, id);
                if (found) return found;
            }
        }
        return null;
    }

    // --- Helper: Collect all descendant step IDs (recursive) ---
    _collectDescendantIds(step, acc = new Set()) {
        if (step.thenSteps) {
            for (const s of step.thenSteps) {
                acc.add(s.id);
                this._collectDescendantIds(s, acc);
            }
        }
        if (step.elseSteps) {
            for (const s of step.elseSteps) {
                acc.add(s.id);
                this._collectDescendantIds(s, acc);
            }
        }
        if (step.loopSteps) {
            for (const s of step.loopSteps) {
                acc.add(s.id);
                this._collectDescendantIds(s, acc);
            }
        }
        return acc;
    }
}