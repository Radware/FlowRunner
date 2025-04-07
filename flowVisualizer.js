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
// const PLACEHOLDER_CLASS = 'drag-placeholder'; // <-- REMOVED
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
        // this.placeholderEl = null; // <-- REMOVED Visual drop indicator

        // Debounce resize handler
        this.resizeObserver = null;
        this.debounceTimer = null;

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

        // REMOVED placeholder element creation
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
            // REMOVED: re-appending placeholder
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

        // Reset nodes map before layout
        this.nodes.clear();

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
                    // console.log(`[Layout] Using persisted position for ${nodeData.id}:`, savedLayout);
                } else {
                    // console.log(`[Layout] Using default position for ${nodeData.id}:`, {x: nodeData.x, y: nodeData.y});
                }
            });
        }

        // --- Phase 3: Render Nodes using FINAL Positions ---
        let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0; // Bounds based on final positions

        this.nodes.forEach(nodeData => {
            const nodeEl = this._createNodeElement(nodeData);
            if (nodeEl) {
                nodeData.element = nodeEl;
                nodeEl.style.left = `${nodeData.x}px`;
                nodeEl.style.top = `${nodeData.y}px`;
                this.canvas.appendChild(nodeEl);

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
        let maxReachY = startY; // Track the maximum Y extent of this level and its children
        let maxReachX = startX; // Track the maximum X extent at this level

        if (!steps || steps.length === 0) {
            return { width: 0, height: 0 };
        }

        steps.forEach((step, index) => {
            // Ensure nodeData is created even if it exists from a previous partial layout attempt
            let nodeData = this.nodes.get(step.id);
            if (!nodeData) {
                nodeData = {
                    id: step.id,
                    width: NODE_WIDTH,
                    height: NODE_MIN_HEIGHT, // Initial estimate
                    step: step,
                    element: null,
                    childrenLayout: null,
                    ports: {}
                };
                this.nodes.set(step.id, nodeData);
            }

            // Set DEFAULT position
            nodeData.x = currentX;
            nodeData.y = startY;
            nodeData.height = Math.max(NODE_MIN_HEIGHT, this._estimateNodeHeight(step)); // Use estimated height for layout

            let stepBranchHeight = 0; // Additional height consumed by branches below this step
            let stepBranchWidth = 0; // Width consumed by branches (relevant for horizontal spacing if needed)

            try {
                if (step.type === 'condition') {
                    const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;
                    // Layout 'Then' branch directly below
                    const thenLayout = this._layoutSteps(step.thenSteps || [], currentX, branchStartY);
                    // Layout 'Else' branch directly below 'Then' branch (if 'Then' exists)
                    const elseStartY = branchStartY + (thenLayout.height > 0 ? thenLayout.height + V_SPACING : 0);
                    const elseLayout = this._layoutSteps(step.elseSteps || [], currentX, elseStartY);

                    nodeData.childrenLayout = { then: thenLayout, else: elseLayout };
                    stepBranchHeight = BRANCH_V_SPACING + thenLayout.height + (elseLayout.height > 0 ? V_SPACING + elseLayout.height : 0);
                    // Width is the max of the node itself or its branches
                    stepBranchWidth = Math.max(thenLayout.width, elseLayout.width);

                } else if (step.type === 'loop') {
                    const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;
                    const loopLayout = this._layoutSteps(step.loopSteps || [], currentX, branchStartY);

                    nodeData.childrenLayout = { loop: loopLayout };
                    stepBranchHeight = BRANCH_V_SPACING + loopLayout.height;
                    stepBranchWidth = loopLayout.width;
                }

                // Max X reached by this step (including potential branches)
                const currentStepMaxX = currentX + Math.max(nodeData.width, stepBranchWidth);
                maxReachX = Math.max(maxReachX, currentStepMaxX);

                // Max Y reached by this step (including potential branches)
                const currentStepMaxY = startY + nodeData.height + stepBranchHeight;
                maxReachY = Math.max(maxReachY, currentStepMaxY);

                // Advance currentX for the *next* step in this sequence
                currentX += nodeData.width + H_SPACING;

            } catch (layoutError) {
                console.error(`Error during default layout calculation for step ${step.id}:`, layoutError);
                // Place minimally and advance
                nodeData.x = currentX;
                nodeData.y = startY;
                nodeData.height = NODE_MIN_HEIGHT;
                maxReachY = Math.max(maxReachY, startY + nodeData.height);
                maxReachX = Math.max(maxReachX, currentX + nodeData.width);
                currentX += nodeData.width + H_SPACING;
            }
        });

        // Calculate overall width and height for this level
        const totalWidth = maxReachX - startX;
        const totalHeight = maxReachY - startY;

        return { width: Math.max(0, totalWidth), height: Math.max(0, totalHeight) };
    }


    /** Estimates node height based on content - used during layout before rendering. */
    _estimateNodeHeight(step) {
        // Very rough estimation, real height determined after rendering content
        let estimatedHeight = NODE_MIN_HEIGHT;
        // Add estimates for lines of text in content preview
        if (step.type === 'request') estimatedHeight += 15; // URL line
        if (step.type === 'condition') estimatedHeight += 15; // Condition line
        if (step.type === 'loop') estimatedHeight += 30; // Two lines for loop config
        // Add more based on complexity if needed
        return estimatedHeight;
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
        // Height will be set after rendering and measurement

        // Optional action buttons (Example: Delete)
        let actionsHTML = '';
        if (this.options.onDeleteStep) {
            actionsHTML += `<button class="btn-node-action btn-delete-node" title="Delete Step">✕</button>`;
        }
        // Add more actions (clone, add) here if needed, attaching listeners below

        nodeEl.innerHTML = `
            <div class="node-header">
                <span class="node-icon">${getStepTypeIcon(step.type)}</span>
                <span class="node-name">${escapeHTML(step.name)}</span>
                <div class="node-actions">${actionsHTML}</div>
            </div>
            <div class="node-content">
                ${this._getNodeContentHTML(step)}
                <!-- NEW: Container for runtime details -->
                <div class="node-runtime-details"></div>
                 <!-- END NEW -->
            </div>
            <!-- Ports are conceptual for connector calculation, not rendered explicitly unless needed -->
        `;

        // --- Attach Listeners ---

        // Node Selection (existing)
        nodeEl.addEventListener('click', (e) => {
            // Ignore clicks on action buttons within the node
            if (!e.target.closest('.node-actions button')) {
                if (this.options.onNodeSelect) {
                    this.options.onNodeSelect(step.id);
                }
                e.stopPropagation(); // Prevent triggering mount point mousedown (pan)
            }
        });

        // Action Buttons Listeners (existing)
        const deleteBtn = nodeEl.querySelector('.btn-delete-node');
        if (deleteBtn && this.options.onDeleteStep) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent node selection
                this.options.onDeleteStep(step.id);
            });
        }
        // Add listeners for other action buttons (clone, add) similarly

        // Drag and Drop Initialization (mousedown listener for free placement)
        nodeEl.addEventListener('mousedown', this._handleNodeMouseDown); // <-- NEW LISTENER

        return nodeEl;
    }

    /** Generates the inner HTML for the node's content area. */
    _getNodeContentHTML(step) {
        // Generate simplified content preview for the node
        try {
            switch (step.type) {
                case 'request':
                    const urlPreview = (step.url || '').length > 30 ? step.url.substring(0, 27) + '...' : step.url;
                    return `<span class="request-method ${step.method || 'GET'}">${step.method || 'GET'}</span> <code class="request-url" title="${escapeHTML(step.url)}">${escapeHTML(urlPreview)}</code>`;
                case 'condition':
                    let conditionPreview = 'No condition set';
                    // Prefer conditionData if available
                    if (step.conditionData?.variable && step.conditionData?.operator) {
                        conditionPreview = generateConditionPreview(step.conditionData);
                    } else if (step.condition) {
                        conditionPreview = `Legacy: ${escapeHTML(step.condition)}`; // Indicate legacy and escape
                    }
                    if (conditionPreview.length > 40) conditionPreview = conditionPreview.substring(0, 37) + '...';
                    return `If: <code class="condition-code" title="${escapeHTML(generateConditionPreview(step.conditionData) || step.condition || '')}">${escapeHTML(conditionPreview)}</code>`;
                case 'loop':
                    const sourcePreview = (step.source || '').length > 20 ? step.source.substring(0, 17) + '...' : step.source;
                    return `For <code class="loop-variable">${escapeHTML(step.loopVariable || 'item')}</code> in <code class="loop-source" title="${escapeHTML(step.source)}">${escapeHTML(sourcePreview)}</code>`;
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

        // Check if flowModel and steps exist before trying to render
        if (this.flowModel && this.flowModel.steps) {
            this._renderConnectorsRecursive(this.flowModel.steps);
        }
    }

    /** Recursively finds connections and calls drawing function. */
    _renderConnectorsRecursive(steps, parentNodeData = null, parentPortType = 'output') {
        let prevNodeData = parentNodeData;
        let currentParentPortType = parentPortType;

        // Handle empty steps array gracefully
        if (!steps || steps.length === 0) {
            return;
        }

        steps.forEach((step) => {
            const currentNodeData = this.nodes.get(step.id);
            // --- Add Check ---
            if (!currentNodeData) {
                console.warn(`Node data not found for step ${step.id} during connector render. Skipping connections to/from it.`);
                // Continue processing next steps in the level, but skip connections for this missing node
                prevNodeData = null; // Can't connect from a missing node
                return; // Skip connection drawing and recursion for this step
            }

            // Connect from previous node (or parent's branch port) to current node's input
            if (prevNodeData) {
                this._drawConnector(prevNodeData, currentNodeData, currentParentPortType, 'input');
            }

            // Recurse for children, specifying the correct output port from the current node
            if (step.type === 'condition') {
                this._renderConnectorsRecursive(step.thenSteps || [], currentNodeData, 'branch-then');
                this._renderConnectorsRecursive(step.elseSteps || [], currentNodeData, 'branch-else');
            } else if (step.type === 'loop') {
                this._renderConnectorsRecursive(step.loopSteps || [], currentNodeData, 'loop-body');
            }

            // Current node becomes the previous node for the next step *at this level*
            prevNodeData = currentNodeData;
            currentParentPortType = 'output'; // Subsequent steps connect from standard output
        });
    }


    /** Calculates the absolute position of a conceptual port on a node. */
    _getPortPosition(nodeData, portType) {
        if (!nodeData) return { x: NaN, y: NaN }; // Handle missing node data case
        const x = nodeData.x;
        const y = nodeData.y;
        const w = nodeData.width;
        const h = nodeData.height;

        // Ports centered vertically on sides, horizontally on top/bottom
        // Adjusting based on new default layout (L->R main, Vertical branches)
        switch (portType) {
            case 'input': return { x: x, y: y + h / 2 }; // Input on the left
            case 'output': return { x: x + w, y: y + h / 2 }; // Output on the right (for next sequential step)
            case 'branch-then': return { x: x + w / 2, y: y + h }; // Then branch starts from bottom-center
            case 'branch-else': return { x: x + w / 2, y: y + h }; // Else branch also starts from bottom-center (distinguished by target)
            case 'loop-body': return { x: x + w / 2, y: y + h }; // Loop body starts from bottom-center
            default: return { x: x + w / 2, y: y + h / 2 }; // Fallback to center
        }
    }

    /** Draws a single SVG connector between two nodes. */
     _drawConnector(startNodeData, endNodeData, startPortType, endPortType) {
         // --- Add checks for valid node data ---
        if (!startNodeData || !endNodeData) {
             console.warn("Skipping connector draw: Missing start or end node data.");
             return;
        }

        try { // Wrap path calculation and SVG creation
            const startPos = this._getPortPosition(startNodeData, startPortType);
            const endPos = this._getPortPosition(endNodeData, endPortType);

            // Ensure positions are valid numbers
            if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(endPos.x) || isNaN(endPos.y)) {
                throw new Error(`Invalid port positions calculated: Start(${startPos.x},${startPos.y}), End(${endPos.x},${endPos.y}) for nodes ${startNodeData.id} -> ${endNodeData.id}`);
            }

            // --- Path Calculation (Orthogonal - Adjust for LTR flow) ---
            let pathData;
            const dx = endPos.x - startPos.x;
            const dy = endPos.y - startPos.y;
            const midX = startPos.x + dx / 2;
            const midY = startPos.y + dy / 2;

            // Simple L-shape for vertical branches (start bottom, end left)
            if ((startPortType === 'branch-then' || startPortType === 'branch-else' || startPortType === 'loop-body') && endPortType === 'input') {
                 const vSegLength = Math.max(10, Math.min(30, Math.abs(dy) / 3));
                 pathData = `M ${startPos.x} ${startPos.y} ` +
                            `L ${startPos.x} ${startPos.y + vSegLength} ` +
                            `L ${endPos.x - H_SPACING/2} ${startPos.y + vSegLength} ` + // Intermediate horizontal point
                            `L ${endPos.x - H_SPACING/2} ${endPos.y} ` +
                            `L ${endPos.x} ${endPos.y}`;
            // Simple L-shape for horizontal connections (start right, end left)
            } else if (startPortType === 'output' && endPortType === 'input') {
                 pathData = `M ${startPos.x} ${startPos.y} ` +
                            `L ${midX} ${startPos.y} ` +
                            `L ${midX} ${endPos.y} ` +
                            `L ${endPos.x} ${endPos.y}`;
            } else { // Default smooth curve (fallback, may need adjustments)
                const hSegLengthBase = Math.max(5, Math.abs(dx) / 4);
                const hSegLength = Math.min(30, hSegLengthBase); // Increased minimum curve length
                const startXCtrl = startPos.x + (dx >= 0 ? hSegLength : -hSegLength);
                const endXCtrl = endPos.x - (dx >= 0 ? hSegLength : -hSegLength);

                const effectiveStartXCtrl = (dx >= 0) ? Math.min(startXCtrl, startPos.x + Math.max(0, dx / 2)) : Math.max(startXCtrl, startPos.x + Math.min(0, dx / 2));
                const effectiveEndXCtrl = (dx >= 0) ? Math.max(endXCtrl, endPos.x - Math.max(0, dx / 2)) : Math.min(endXCtrl, endPos.x - Math.min(0, dx / 2));

                 pathData = `M ${startPos.x} ${startPos.y} ` +
                            `C ${effectiveStartXCtrl} ${startPos.y}, ${effectiveEndXCtrl} ${endPos.y}, ${endPos.x} ${endPos.y}`;
            }


            // --- Create SVG Path Element ---
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('class', CONNECTOR_CLASS);
            path.dataset.from = startNodeData.id;
            path.dataset.to = endNodeData.id;
            path.dataset.startPort = startPortType;
            path.dataset.endPort = endPortType;
            // Rely on CSS for styling

            // --- Add Arrowhead ---
            const markerId = `arrow-${startNodeData.id}-${startPortType}-to-${endNodeData.id}-${endPortType}`;
            const marker = document.createElementNS(SVG_NS, 'marker');
            marker.setAttribute('id', markerId);
            marker.setAttribute('viewBox', '0 -5 10 10');
            marker.setAttribute('refX', '8'); // Adjust position relative to line end
            marker.setAttribute('refY', '0');
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto-start-reverse'); // Orient arrow correctly
            marker.innerHTML = `<path d="M0,-5L10,0L0,5" class="connector-arrowhead"></path>`; // Add class for easier styling

            // Ensure marker definition is added only once per ID
            if (this.defs && !this.defs.querySelector(`#${markerId}`)) {
                this.defs.appendChild(marker); // Add marker definition
            }
            path.setAttribute('marker-end', `url(#${markerId})`); // Reference the marker

            this.svgConnectors.appendChild(path);

        } catch (error) {
             console.error(`Error drawing connector from ${startNodeData?.id} (${startPortType}) to ${endNodeData?.id} (${endPortType}):`, error);
             // Avoid crashing the rendering process
        }
    }

    // --- Interaction Handlers ---

    // Bound to document during drag/pan
    _handleMouseMove = (e) => {
        if (this.isDraggingNode) {
            this._handleNodeDragMove(e);
        } else if (this.isPanning) {
            this._handlePanMove(e);
        }
    }

    // Bound to document during drag/pan
    _handleMouseUp = (e) => {
        if (this.isDraggingNode) {
            this._handleNodeDragEnd(e);
        } else if (this.isPanning) {
            this._handlePanEnd(e);
        }
    }

    // Listener for the mount point or nodes
    _handleMouseDown = (e) => {
        // Node drag is initiated by the node's specific mousedown handler (_handleNodeMouseDown)
        // This handler checks for background clicks to initiate panning
        if (e.button === PAN_BUTTON && !e.target.closest(`.${NODE_CLASS}`)) {
            this._handlePanStart(e);
        }
    }

    // --- Panning Logic ---
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
        // Calculate distance moved
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        // Update scroll position
        this.mountPoint.scrollLeft = this.scrollLeftStart - dx;
        this.mountPoint.scrollTop = this.scrollTopStart - dy;
    }

    _handlePanEnd(e) {
        this.isPanning = false;
        this.mountPoint.style.cursor = 'grab'; // Reset cursor
        this.mountPoint.style.userSelect = '';
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);
    }

    // --- Node Dragging Logic ---

    // Instance method bound to 'this', attached to nodes in _createNodeElement
    _handleNodeMouseDown = (e) => {
        const nodeEl = e.currentTarget; // The node element the listener is attached to
        // Only drag with left button and if target is the node or header (allow dragging by header)
        // Prevent dragging if clicking on action buttons or content directly
        if (e.button !== 0 || e.target.closest('.node-actions button, .node-content')) {
            return;
        }

        this.isDraggingNode = true;
        this.draggedNode = nodeEl;
        nodeEl.classList.add(NODE_DRAGGING_CLASS);
        if (this.canvas) this.canvas.classList.add('nodes-dragging'); // Global class for potential styling

        const rect = nodeEl.getBoundingClientRect();
        const mountRect = this.mountPoint.getBoundingClientRect();

        // Calculate offset from mouse cursor to node's top-left corner
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;

        // Record starting mouse position relative to the document
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        // Prevent panning while dragging node
        this.isPanning = false;
        this.mountPoint.style.cursor = 'grabbing';

        // REMOVED: Placeholder size setup

        document.addEventListener('mousemove', this._handleMouseMove);
        document.addEventListener('mouseup', this._handleMouseUp);
        e.preventDefault();
        e.stopPropagation(); // Prevent panning start
    }

    // [Modified Code]
    _handleNodeDragMove(e) {
        if (!this.draggedNode) return;

        // --- Existing position calculation ---
        const newPageX = e.clientX;
        const newPageY = e.clientY;
        const mountRect = this.mountPoint.getBoundingClientRect();
        let newX = newPageX - mountRect.left + this.mountPoint.scrollLeft - this.dragOffsetX;
        let newY = newPageY - mountRect.top + this.mountPoint.scrollTop - this.dragOffsetY;

        // --- Update visual position ---
        this.draggedNode.style.left = `${newX}px`;
        this.draggedNode.style.top = `${newY}px`;
        this.draggedNode.style.zIndex = '1001';

        // --- NEW: Update connectors in real-time ---
        const stepId = this.draggedNode.dataset.stepId;
        const nodeData = this.nodes.get(stepId);
        if (nodeData) {
            // Temporarily update nodeData's position for calculation purposes
            // This doesn't change the underlying model, just the visual reference for connectors
            const originalX = nodeData.x;
            const originalY = nodeData.y;
            nodeData.x = newX;
            nodeData.y = newY;

            try {
                 this._updateNodeConnectors(nodeData); // Update connectors connected to this node
            } finally {
                 // Restore original position in nodeData after calculation
                 // The actual model update happens on drag end via callback
                 nodeData.x = originalX;
                 nodeData.y = originalY;
            }
        }
        // --- END NEW ---

        // --- REMOVED: Drop Target and Placeholder Logic ---
        // this._updateDropPlaceholder(e.clientX, e.clientY);
    }

    // [New Code] - Helper function for updating specific node connectors
    /**
     * Finds and redraws SVG connectors attached to a specific node.
     * Uses the current x/y coordinates stored in the nodeData object.
     * @param {Object} nodeData - The data object for the node whose connectors need updating.
     */
    _updateNodeConnectors(nodeData) {
        if (!nodeData || !this.svgConnectors) return;
        const stepId = nodeData.id;

        // Find all paths connected TO or FROM this node
        const paths = this.svgConnectors.querySelectorAll(`path.${CONNECTOR_CLASS}[data-from="${stepId}"], path.${CONNECTOR_CLASS}[data-to="${stepId}"]`);

        paths.forEach(path => {
            const fromId = path.dataset.from;
            const toId = path.dataset.to;
            const startPortType = path.dataset.startPort;
            const endPortType = path.dataset.endPort;

            const startNode = this.nodes.get(fromId);
            const endNode = this.nodes.get(toId);

            // Ensure both connected nodes exist before attempting to redraw
            if (startNode && endNode) {
                try {
                    const startPos = this._getPortPosition(startNode, startPortType);
                    const endPos = this._getPortPosition(endNode, endPortType);

                    if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(endPos.x) || isNaN(endPos.y)) {
                       throw new Error(`Invalid port positions during connector update: Start(${startPos.x},${startPos.y}), End(${endPos.x},${endPos.y})`);
                    }

                    // --- Recalculate pathData (same logic as _drawConnector) ---
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

                    // Update the path's 'd' attribute
                    path.setAttribute('d', pathData);
                } catch (error) {
                    console.error(`Error updating connector d attribute for path ${fromId}->${toId}:`, error);
                }
            } else {
                 console.warn(`Skipping connector update for ${fromId}->${toId}: Missing node data for start or end.`);
            }
        });
    }


    /** Finds the closest valid drop target and positions the placeholder. */
    // --- REMOVED FUNCTION ---
    // _updateDropPlaceholder(clientX, clientY) { ... }


     // Helper to find step by ID within the visualizer's current flow model
     _findStepByIdRecursive(steps, id) {
         if (!steps || !Array.isArray(steps)) return null;
         for (const step of steps) {
             if (step.id === id) return step;
             let found = null;
             if (step.type === 'condition') {
                 found = this._findStepByIdRecursive(step.thenSteps, id) || this._findStepByIdRecursive(step.elseSteps, id);
             } else if (step.type === 'loop') {
                 found = this._findStepByIdRecursive(step.loopSteps, id);
             }
             if (found) return found;
         }
         return null;
     }


    _handleNodeDragEnd(e) {
        const draggedNodeAtStart = this.draggedNode; // Capture reference before cleanup
        const sourceId = draggedNodeAtStart?.dataset?.stepId;

        // --- Use finally block for guaranteed cleanup ---
        try {
            if (!draggedNodeAtStart || !sourceId) return;

            // --- NEW: Capture final position and update model ---
            // Calculate final position relative to the canvas origin
            // parseFloat can handle 'px' suffix
            const finalX = parseFloat(draggedNodeAtStart.style.left || '0');
            const finalY = parseFloat(draggedNodeAtStart.style.top || '0');

            if (!isNaN(finalX) && !isNaN(finalY) && this.options.onNodeLayoutUpdate) {
                console.log(`Visualizer Drag End: Update layout for ${sourceId} to (${finalX}, ${finalY})`);
                try {
                    // Call the callback to update the model's visualLayout
                    this.options.onNodeLayoutUpdate(sourceId, finalX, finalY);
                    // The visual update will happen when the parent calls render() again after model update.
                    // The node is already visually at finalX, finalY.
                } catch (callbackError) {
                    console.error("Error in onNodeLayoutUpdate callback:", callbackError);
                    // Optionally, try to revert visual position if callback fails, although re-render is better
                    const originalNodeData = this.nodes.get(sourceId);
                     if (originalNodeData && draggedNodeAtStart) {
                         draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                         draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                     }
                }
            } else {
                 // If no callback or coords are invalid, snap back visually immediately
                 const originalNodeData = this.nodes.get(sourceId);
                 if (originalNodeData && draggedNodeAtStart) {
                     draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                     draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                 }
            }
            // --- END NEW ---

            // --- REMOVED: Logic related to placeholder and onNodeMove ---

        } catch (error) {
             console.error("Error during node drag end logic:", error);
             // Attempt to restore visual state if possible
             if (draggedNodeAtStart && sourceId) {
                 const originalNodeData = this.nodes.get(sourceId);
                 if (originalNodeData) {
                     draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                     draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                 }
             }
        } finally {
             // --- Guaranteed Cleanup (Remove placeholder logic) ---
             if (draggedNodeAtStart) {
                 draggedNodeAtStart.classList.remove(NODE_DRAGGING_CLASS);
                 draggedNodeAtStart.style.zIndex = '';
             }
             if (this.canvas) this.canvas.classList.remove('nodes-dragging');
             if (this.mountPoint) this.mountPoint.style.cursor = 'grab';
             // REMOVED: Placeholder cleanup - no placeholder used for free drag

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
    highlightNode(stepId, highlightType = 'active') { // Changed default class name for clarity
        this.clearHighlights(); // Clear previous highlights first

        const nodeData = this.nodes.get(stepId);
        // --- Add Checks ---
        if (!nodeData || !nodeData.element) {
            console.warn(`Highlight Error: Node data or element not found for step ${stepId}.`);
            return;
        }

        try { // Wrap DOM manipulation
            // Map simple status to CSS class (adjust mapping as needed in your CSS)
             const highlightClass = highlightType === 'active' ? 'active-step' // Currently executing
                                 : highlightType === 'success' ? 'success'    // Completed successfully
                                 : highlightType === 'error' ? 'error'      // Completed with error
                                 : highlightType === 'stopped' ? 'stopped'    // Execution stopped here
                                 : highlightType; // Allow passing other specific classes directly


            nodeData.element.classList.add(highlightClass);

            // --- Scroll into view with error handling ---
            try {
                nodeData.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            } catch (scrollError) {
                console.warn(`Failed to scroll node ${stepId} into view smoothly:`, scrollError);
                 // Fallback to non-smooth scroll
                 try { nodeData.element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); } catch (fallbackError) {
                     console.warn(`Failed to scroll node ${stepId} into view (fallback):`, fallbackError);
                 }
            }


            // Highlight incoming connector path and arrowhead
            const connectorPath = this.svgConnectors?.querySelector(`.${CONNECTOR_CLASS}[data-to="${stepId}"]`);
            if (connectorPath) {
                connectorPath.classList.add(CONNECTOR_ACTIVE_CLASS); // General active state
                connectorPath.classList.add(`status-${highlightType}`); // Add status-specific class for distinct styling

                const markerId = connectorPath.getAttribute('marker-end')?.replace(/url\(#|\)/g, '');
                if (markerId && this.defs) {
                     // Use querySelector on defs for potentially better performance and target the specific path
                    const markerPath = this.defs.querySelector(`#${markerId} path.connector-arrowhead`);
                    if (markerPath) {
                        markerPath.classList.add('active-arrowhead'); // General active state
                        markerPath.classList.add(`status-${highlightType}`); // Add status-specific class
                    } else {
                         console.warn(`Highlight Error: Marker arrowhead path not found within marker ID ${markerId}.`);
                    }
                } else if (markerId) {
                     console.warn(`Highlight Error: SVG <defs> element not found while looking for marker ${markerId}.`);
                }
            } else {
                 // This might be the first step in the flow, which has no incoming connector.
                 // console.log(`Highlight Info: No incoming connector found for step ${stepId} (possibly the first step).`);
            }
        } catch (error) {
             console.error(`Error applying highlight (type: ${highlightType}) to node ${stepId}:`, error);
        }
    }


    // [Modified Code] - Clear runtime info div in clearHighlights
    /** Removes all runner-related highlights from nodes and connectors. */
    clearHighlights() {
        try {
            const highlightClasses = ['active-step', 'success', 'error', 'stopped'];
            const statusClasses = ['status-active', 'status-success', 'status-error', 'status-stopped'];

            this.nodes.forEach(nodeData => {
                if (nodeData.element) {
                    // Remove status highlight classes
                    nodeData.element.classList.remove(...highlightClasses);

                    // --- MODIFICATION START: Clear runtime info display ---
                    const runtimeInfoDiv = nodeData.element.querySelector('.node-runtime-details');
                    if (runtimeInfoDiv) {
                        runtimeInfoDiv.innerHTML = ''; // Clear content
                    }
                    // --- MODIFICATION END ---
                }
            });

            // --- Connector clearing logic remains the same ---
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


    // [Modified Code] - Renamed and enhanced updateNodeRuntimeInfo
    /**
     * Updates a node in the visualizer to display runtime information (e.g., status, extracted vars).
     * @param {string} stepId - The ID of the step/node to update.
     * @param {Object} result - The execution result object from the runner.
     * @param {string} result.status - The execution status ('success', 'error', etc.).
     * @param {Object} [result.output] - The output data (e.g., {status, headers, body} for requests).
     * @param {string} [result.error] - The error message if status is 'error'.
     * @param {Array} [result.extractionFailures] - Array detailing failed extractions.
     */
    updateNodeRuntimeInfo(stepId, result) { // <-- Renamed parameter for clarity, added extractionFailures to comment
        const nodeData = this.nodes.get(stepId);
        if (!nodeData || !nodeData.element || !nodeData.step) {
            console.warn(`[Vis UpdateInfo] Node data/element/step not found for ID: ${stepId}`);
            return;
        }

        // --- MODIFICATION: Find the specific details container ---
        const runtimeInfoDiv = nodeData.element.querySelector('.node-runtime-details');
        if (!runtimeInfoDiv) {
            console.warn(`[Vis UpdateInfo] Node runtime details container not found for ID: ${stepId}`);
            return; // Should exist if _createNodeElement was modified correctly
        }
        // --- END MODIFICATION ---

        // Clear previous runtime info
        runtimeInfoDiv.innerHTML = '';

        // Only display for Request steps for now
        if (nodeData.step.type === 'request') {
            let infoHtml = '';
            let hasInfo = false; // Track if any info was added

            // 1. Display HTTP Status Code
            if (result.output && result.output.status !== undefined && result.output.status !== null) {
                const statusClass = result.output.status >= 400 ? 'error' : (result.output.status >= 300 ? 'warn' : 'success');
                infoHtml += `<span class="info-item status-${statusClass}">Status: <strong>${escapeHTML(result.output.status)}</strong></span>`;
                hasInfo = true;
            } else if (result.status === 'error') {
                // Show generic error if request failed without specific status (e.g., network error)
                 infoHtml += `<span class="info-item error">Request Error</span>`;
                 hasInfo = true;
            }

             // 2. Display Extraction Status Indicator
             const hasConfiguredExtractions = nodeData.step.extract && Object.keys(nodeData.step.extract).length > 0;
             let extractionStatus = 'N/A';
             let extractionStatusClass = 'neutral';

             if (hasConfiguredExtractions) {
                 if (result.extractionFailures && result.extractionFailures.length > 0) {
                     extractionStatus = 'Failed';
                     extractionStatusClass = 'error';
                 } else {
                     // Considered OK if configured and no failures reported (even if runner doesn't explicitly return success)
                     extractionStatus = 'OK';
                     extractionStatusClass = 'success';
                 }
             }

            // Only display extraction status if extractions were configured or if there was a failure (unlikely without config)
             if (extractionStatus !== 'N/A') {
                 infoHtml += `<span class="info-item extract-${extractionStatusClass}">Extract: <strong>${extractionStatus}</strong></span>`;
                 hasInfo = true;
             }

            // Only update innerHTML if there's something to display
            if (hasInfo) {
                 runtimeInfoDiv.innerHTML = infoHtml;
            }

        } else if (result.status === 'error' && nodeData.step.type !== 'request') {
             // Optionally display general errors for non-request steps
             runtimeInfoDiv.innerHTML = `<span class="info-item error">Step Error</span>`;
        }

        // --- Optional: Adjust node height (might cause reflows) ---
        // Maybe better handled with CSS min-height and overflow properties on node-content
        // const currentHeight = nodeData.element.offsetHeight;
        // if (currentHeight > nodeData.height) {
        //     nodeData.height = currentHeight;
        //     nodeData.element.style.height = `${currentHeight}px`;
        //     // If height changes, connectors need update
        //     // this._updateNodeConnectors(nodeData); // Update connectors if height changes
        // }
    }


     /** Optional: Clean up listeners when the component is destroyed. */
     destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        // Remove document listeners just in case they are lingering from an interrupted drag/pan
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);

        // Remove mount point listener
        this.mountPoint?.removeEventListener('mousedown', this._handleMouseDown);

        // Clear intervals/timeouts
        clearTimeout(this.debounceTimer);

        // Clear internal references
        this.clear(); // Clear nodes map and DOM content
        this.nodes = null;
        this.flowModel = null;
        this.svgConnectors = null;
        this.canvas = null;
        this.defs = null;
        // this.placeholderEl = null; // <-- REMOVED
        this.draggedNode = null;

        // Clear mount point content finally
        if (this.mountPoint) this.mountPoint.innerHTML = '';
        this.mountPoint = null;

        console.log("FlowVisualizer destroyed.");
    }
}