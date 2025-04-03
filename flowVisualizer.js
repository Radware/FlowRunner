// flowVisualizer.js
/**
 * flowVisualizer.js
 * Renders the flow as a dynamic, interactive node-graph using SVG for connectors.
 * Handles node dragging, panning, selection highlighting, and basic runner integration.
 */
import { escapeHTML, generateConditionPreview } from './flowCore.js'; // Import utilities from core
import { getStepTypeIcon } from './flowStepComponents.js'; // Import UI-related helper

// --- Constants for Layout ---
const NODE_WIDTH = 220;         // Default width for nodes
const NODE_MIN_HEIGHT = 80;     // Minimum height for nodes
const H_SPACING = 100;          // Horizontal spacing between parallel branches (e.g., If/Else)
const V_SPACING = 60;           // Vertical spacing between sequential nodes
const BRANCH_V_SPACING = 40;    // Extra vertical space before starting a branch
const CANVAS_PADDING = 100;     // Padding around the content in the canvas

// --- Constants for Interaction ---
const DRAG_THRESHOLD = 5;       // Pixels mouse needs to move before drag starts
const PAN_BUTTON = 0;           // Left mouse button for panning

// --- Constants for Styling & SVG ---
const CONNECTOR_CLASS = 'connector-path';
const CONNECTOR_ACTIVE_CLASS = 'active-connector';
const NODE_CLASS = 'flow-node';
const NODE_SELECTED_CLASS = 'selected';
const NODE_DRAGGING_CLASS = 'dragging';
const PLACEHOLDER_CLASS = 'drag-placeholder';
const SVG_NS = 'http://www.w3.org/2000/svg';

export class FlowVisualizer {
    /**
     * Initializes the FlowVisualizer.
     * @param {HTMLElement} mountPoint - The container element for the visualizer.
     * @param {Object} options - Callbacks and configuration.
     * @param {Function} options.onNodeSelect - Callback when a node is selected: `onNodeSelect(stepId)`
     * @param {Function} options.onNodeMove - Callback when a node is dropped: `onNodeMove(sourceStepId, targetStepId, position)` ('before' or 'after')
     * @param {Function} [options.onAddStep] - Optional callback to request adding a step: `onAddStep(parentId, branch, positionInfo)`
     * @param {Function} [options.onDeleteStep] - Optional callback to request deleting a step: `onDeleteStep(stepId)`
     * @param {Function} [options.onCloneStep] - Optional callback to request cloning a step: `onCloneStep(stepId)`
     */
    constructor(mountPoint, options = {}) {
        if (!mountPoint) {
            throw new Error("FlowVisualizer requires a valid mount point element.");
        }
        this.mountPoint = mountPoint;
        this.options = options;
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
        this.placeholderEl = null; // Visual drop indicator

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

        this.svgConnectors = document.createElementNS(SVG_NS, 'svg');
        this.svgConnectors.setAttribute('class', 'flow-connector');
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

        // Add placeholder element (initially hidden)
        this.placeholderEl = document.createElement('div');
        this.placeholderEl.className = PLACEHOLDER_CLASS;
        this.placeholderEl.style.position = 'absolute';
        this.placeholderEl.style.display = 'none';
        this.placeholderEl.style.pointerEvents = 'none';
        this.canvas.appendChild(this.placeholderEl);
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
        this.canvas.innerHTML = '';
        this.canvas.appendChild(this.placeholderEl); // Keep placeholder
        this.svgConnectors.innerHTML = ''; // Clear connectors
        this.svgConnectors.appendChild(this.defs); // Re-add defs
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
            this.canvas.innerHTML = '<div class="placeholder-message" style="position: absolute; top: 50px; left: 50px;">No steps to visualize.</div>';
            this._updateCanvasAndSvgSize(200, 200); // Set minimum size
            return;
        }

        // --- Layout Phase ---
        // Calculate positions and dimensions recursively
        const layoutResult = this._layoutSteps(this.flowModel.steps, CANVAS_PADDING, CANVAS_PADDING);

        // --- Render Phase ---
        // Create and position node elements based on layout calculation
        this.nodes.forEach(nodeData => {
            const nodeEl = this._createNodeElement(nodeData);
            nodeData.element = nodeEl; // Store element reference
            nodeEl.style.left = `${nodeData.x}px`;
            nodeEl.style.top = `${nodeData.y}px`;
            this.canvas.appendChild(nodeEl);
            // Update height based on actual rendered content *after* appending
            nodeData.height = Math.max(NODE_MIN_HEIGHT, nodeEl.offsetHeight);
            nodeEl.style.height = `${nodeData.height}px`; // Set explicit height for stability?
        });

        // Update canvas size to fit all nodes
        this._updateCanvasAndSvgSize(layoutResult.width, layoutResult.height);

        // Render connectors now that all nodes are positioned and sized
        this._renderAllConnectors();

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
     * Recursively calculates layout information (x, y, width, height) for steps.
     * Stores results in `this.nodes` Map but does *not* create DOM elements yet.
     * @param {Array} steps - Array of step objects.
     * @param {number} startX - The starting X coordinate for this level.
     * @param {number} startY - The starting Y coordinate for this level.
     * @returns {Object} Bounding box { width, height } for the laid-out steps at this level.
     */
    _layoutSteps(steps, startX, startY) {
        let currentY = startY;
        let levelMaxX = startX + NODE_WIDTH; // Track max X extent at this level
        let totalHeight = 0;

        steps.forEach((step, index) => {
            const nodeData = {
                id: step.id,
                x: startX,
                y: currentY,
                width: NODE_WIDTH, // Assume default width initially
                height: NODE_MIN_HEIGHT, // Assume minimum height initially
                step: step,
                element: null, // Will be populated during render phase
                childrenLayout: null, // To store layout results of children
                ports: {} // Calculated later
            };

            // Calculate layout for nested structures first
            if (step.type === 'condition') {
                const thenStartY = currentY + NODE_MIN_HEIGHT + BRANCH_V_SPACING; // Estimate Y based on min height
                const elseStartX = startX + NODE_WIDTH + H_SPACING;

                const thenLayout = this._layoutSteps(step.thenSteps || [], startX, thenStartY);
                const elseLayout = this._layoutSteps(step.elseSteps || [], elseStartX, thenStartY);

                nodeData.childrenLayout = { then: thenLayout, else: elseLayout };
                nodeData.height = Math.max(NODE_MIN_HEIGHT, this._estimateNodeHeight(step)); // Update height estimate

                // Advance Y based on node height + taller branch + spacing
                currentY += nodeData.height + BRANCH_V_SPACING + Math.max(thenLayout.height, elseLayout.height);
                // Update max X reached at this level
                levelMaxX = Math.max(levelMaxX, startX + NODE_WIDTH, elseStartX + elseLayout.width);

            } else if (step.type === 'loop') {
                const loopBodyStartY = currentY + NODE_MIN_HEIGHT + BRANCH_V_SPACING;
                const loopLayout = this._layoutSteps(step.loopSteps || [], startX, loopBodyStartY);

                nodeData.childrenLayout = { loop: loopLayout };
                nodeData.height = Math.max(NODE_MIN_HEIGHT, this._estimateNodeHeight(step)); // Update height estimate

                currentY += nodeData.height + BRANCH_V_SPACING + loopLayout.height;
                levelMaxX = Math.max(levelMaxX, startX + NODE_WIDTH, startX + loopLayout.width);

            } else {
                // Simple step
                nodeData.height = Math.max(NODE_MIN_HEIGHT, this._estimateNodeHeight(step)); // Update height estimate
                currentY += nodeData.height;
                levelMaxX = Math.max(levelMaxX, startX + NODE_WIDTH);
            }

            this.nodes.set(step.id, nodeData); // Store calculated layout data

            // Add vertical spacing *after* processing the node and its children
            if (index < steps.length - 1) {
                currentY += V_SPACING;
            }
        });

        totalHeight = currentY - startY; // Total height consumed at this level

        // Calculate overall width and height for this level
        const totalWidth = levelMaxX - startX;

        return { width: Math.max(NODE_WIDTH, totalWidth), height: Math.max(0, totalHeight) };
    }

    /** Estimates node height based on content - used during layout before rendering. */
    _estimateNodeHeight(step) {
        // Very rough estimation, real height determined after rendering content
        let estimatedHeight = NODE_MIN_HEIGHT;
        // Add estimates for lines of text in content preview
        if (step.type === 'request') estimatedHeight += 15; // URL line
        if (step.type === 'condition') estimatedHeight += 15; // Condition line
        if (step.type === 'loop') estimatedHeight += 30; // Two lines for loop config
        return estimatedHeight;
    }

    /** Updates the canvas and SVG dimensions to fit content. */
    _updateCanvasAndSvgSize(contentWidth, contentHeight) {
        const canvasWidth = Math.max(this.mountPoint.clientWidth, contentWidth + 2 * CANVAS_PADDING);
        const canvasHeight = Math.max(this.mountPoint.clientHeight, contentHeight + 2 * CANVAS_PADDING);

        this.canvas.style.width = `${canvasWidth}px`;
        this.canvas.style.height = `${canvasHeight}px`;

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
        const step = nodeData.step;
        const nodeEl = document.createElement('div');
        nodeEl.className = `${NODE_CLASS} type-${step.type}`;
        nodeEl.dataset.stepId = step.id;
        nodeEl.style.position = 'absolute';
        nodeEl.style.width = `${nodeData.width}px`; // Set width from layout data
        // Height will be set after rendering

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
            </div>
            <!-- Ports are conceptual for connector calculation, not rendered explicitly unless needed -->
        `;

        // --- Attach Listeners ---

        // Node Selection
        nodeEl.addEventListener('click', (e) => {
            // Ignore clicks on action buttons within the node
            if (!e.target.closest('.node-actions button')) {
                if (this.options.onNodeSelect) {
                    this.options.onNodeSelect(step.id);
                }
                e.stopPropagation(); // Prevent triggering mount point mousedown (pan)
            }
        });

        // Action Buttons Listeners
        const deleteBtn = nodeEl.querySelector('.btn-delete-node');
        if (deleteBtn && this.options.onDeleteStep) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent node selection
                this.options.onDeleteStep(step.id);
            });
        }
        // Add listeners for other action buttons (clone, add) similarly

        // Drag and Drop Initialization (mousedown listener)
        nodeEl.addEventListener('mousedown', this._handleNodeMouseDown);

        return nodeEl;
    }

    /** Generates the inner HTML for the node's content area. */
    _getNodeContentHTML(step) {
        // Generate simplified content preview for the node
        switch (step.type) {
            case 'request':
                const urlPreview = (step.url || '').length > 30 ? step.url.substring(0, 27) + '...' : step.url;
                return `<span class="request-method ${step.method || 'GET'}">${step.method || 'GET'}</span> <code class="request-url" title="${escapeHTML(step.url)}">${escapeHTML(urlPreview)}</code>`;
            case 'condition':
                let conditionPreview = 'No condition set';
                if (step.conditionData?.variable && step.conditionData?.operator) {
                    conditionPreview = generateConditionPreview(step.conditionData);
                } else if (step.condition) {
                    conditionPreview = `Legacy: ${step.condition}`; // Indicate legacy
                }
                if (conditionPreview.length > 40) conditionPreview = conditionPreview.substring(0, 37) + '...';
                return `If: <code class="condition-code" title="${escapeHTML(generateConditionPreview(step.conditionData))}">${escapeHTML(conditionPreview)}</code>`;
            case 'loop':
                const sourcePreview = (step.source || '').length > 20 ? step.source.substring(0, 17) + '...' : step.source;
                return `For <code class="loop-variable">${escapeHTML(step.loopVariable || 'item')}</code> in <code class="loop-source" title="${escapeHTML(step.source)}">${escapeHTML(sourcePreview)}</code>`;
            default:
                return `Type: ${escapeHTML(step.type)}`;
        }
    }

    // --- Connector Rendering ---

    /** Renders all connectors based on the node layout. */
    _renderAllConnectors() {
        this.svgConnectors.innerHTML = ''; // Clear previous connectors
        this.svgConnectors.appendChild(this.defs); // Ensure defs remain

        this._renderConnectorsRecursive(this.flowModel.steps);
    }

    /** Recursively finds connections and calls drawing function. */
    _renderConnectorsRecursive(steps, parentNodeData = null, parentPortType = 'output') {
        let prevNodeData = parentNodeData;
        let currentParentPortType = parentPortType;

        steps.forEach((step) => {
            const currentNodeData = this.nodes.get(step.id);
            if (!currentNodeData) {
                console.warn(`Node data not found for step ${step.id} during connector render.`);
                return;
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
        const x = nodeData.x;
        const y = nodeData.y;
        const w = nodeData.width;
        const h = nodeData.height;

        // Ports centered vertically on sides, horizontally on top/bottom
        switch (portType) {
            case 'input': return { x: x, y: y + h / 2 };
            case 'output': return { x: x + w, y: y + h / 2 };
            case 'branch-then': return { x: x + w * 0.33, y: y + h }; // Then branch starts from bottom-left area
            case 'branch-else': return { x: x + w * 0.66, y: y + h }; // Else branch starts from bottom-right area
            case 'loop-body': return { x: x + w / 2, y: y + h }; // Loop body starts from bottom-center
            default: return { x: x + w / 2, y: y + h / 2 }; // Fallback to center
        }
    }

    /** Draws a single SVG connector between two nodes. */
    _drawConnector(startNodeData, endNodeData, startPortType, endPortType) {
        const startPos = this._getPortPosition(startNodeData, startPortType);
        const endPos = this._getPortPosition(endNodeData, endPortType);

        // --- Calculate Path Data (Curved or Orthogonal) ---
        let pathData;
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;

        // Simple Orthogonal Routing (Vertical-Horizontal-Vertical)
        const midY = startPos.y + dy / 2;
        // Add slight horizontal segment near start/end for better arrow appearance
        const hSegLength = Math.min(20, Math.abs(dx) / 3);
        const startXCtrl = startPos.x + (dx > 0 ? hSegLength : -hSegLength);
        const endXCtrl = endPos.x - (dx > 0 ? hSegLength : -hSegLength);

        pathData = `M ${startPos.x} ${startPos.y} ` + // Start point
                   `L ${startXCtrl} ${startPos.y} ` + // Initial horizontal segment
                   `L ${startXCtrl} ${midY} ` +      // Vertical down/up to midpoint Y
                   `L ${endXCtrl} ${midY} ` +        // Horizontal across
                   `L ${endXCtrl} ${endPos.y} ` +    // Vertical down/up to end Y
                   `L ${endPos.x} ${endPos.y}`;       // Final segment to end point


        // --- Create SVG Path Element ---
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('class', CONNECTOR_CLASS);
        path.dataset.from = startNodeData.id;
        path.dataset.to = endNodeData.id;
        path.style.stroke = '#adb5bd'; // Default color (Tailwind gray-400 approx)
        path.style.strokeWidth = '2';
        path.style.fill = 'none';

        // --- Add Arrowhead ---
        const markerId = `arrow-${startNodeData.id}-${endNodeData.id}`;
        const marker = document.createElementNS(SVG_NS, 'marker');
        marker.setAttribute('id', markerId);
        marker.setAttribute('viewBox', '0 -5 10 10');
        marker.setAttribute('refX', '8'); // Adjust position relative to line end
        marker.setAttribute('refY', '0');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse'); // Orient arrow correctly
        marker.innerHTML = `<path d="M0,-5L10,0L0,5" fill="#adb5bd" class="connector-arrowhead"></path>`;

        this.defs.appendChild(marker); // Add marker definition
        path.setAttribute('marker-end', `url(#${markerId})`); // Reference the marker

        this.svgConnectors.appendChild(path);
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
        if (e.button !== 0 || e.target.closest('.node-actions button, .node-content')) {
            return;
        }

        this.isDraggingNode = true;
        this.draggedNode = nodeEl;
        nodeEl.classList.add(NODE_DRAGGING_CLASS);
        this.canvas.classList.add('nodes-dragging'); // Global class for potential styling

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

        // Setup placeholder size
        this.placeholderEl.style.width = `${nodeEl.offsetWidth}px`;
        this.placeholderEl.style.height = `${nodeEl.offsetHeight}px`;
        this.placeholderEl.style.display = 'none'; // Initially hidden

        document.addEventListener('mousemove', this._handleMouseMove);
        document.addEventListener('mouseup', this._handleMouseUp);
        e.preventDefault();
        e.stopPropagation(); // Prevent panning start
    }

    _handleNodeDragMove(e) {
        if (!this.draggedNode) return;

        // Calculate new raw position based on mouse movement relative to document
        const newPageX = e.clientX;
        const newPageY = e.clientY;

        // Convert page coordinates to coordinates relative to the scrolled canvas
        const mountRect = this.mountPoint.getBoundingClientRect();
        let newX = newPageX - mountRect.left + this.mountPoint.scrollLeft - this.dragOffsetX;
        let newY = newPageY - mountRect.top + this.mountPoint.scrollTop - this.dragOffsetY;

        // Clamp position within canvas bounds (optional)
        // newX = Math.max(0, Math.min(newX, this.canvas.offsetWidth - this.draggedNode.offsetWidth));
        // newY = Math.max(0, Math.min(newY, this.canvas.offsetHeight - this.draggedNode.offsetHeight));

        // Update the dragged node's visual position
        this.draggedNode.style.left = `${newX}px`;
        this.draggedNode.style.top = `${newY}px`;
        this.draggedNode.style.zIndex = '1001'; // Ensure dragged node is on top

        // --- Drop Target and Placeholder Logic ---
        this._updateDropPlaceholder(e.clientX, e.clientY);

        // Update connectors dynamically (optional, can be expensive)
        // this._updateConnectorsForNode(this.draggedNode.dataset.stepId);
    }

    /** Finds the closest valid drop target and positions the placeholder. */
    _updateDropPlaceholder(clientX, clientY) {
        let closestNodeData = null;
        let closestDistance = Infinity;
        let dropPosition = 'after'; // 'before' or 'after' target

        const draggedNodeId = this.draggedNode.dataset.stepId;

        // Iterate over node data, not elements, for position info
        this.nodes.forEach(nodeData => {
            if (nodeData.id === draggedNodeId) return; // Skip self

            // Calculate center of the potential target node relative to viewport
            const nodeRect = nodeData.element.getBoundingClientRect();
            const nodeCenterX = nodeRect.left + nodeRect.width / 2;
            const nodeCenterY = nodeRect.top + nodeRect.height / 2;

            // Distance from mouse cursor to target node center
            const dist = Math.sqrt(Math.pow(clientX - nodeCenterX, 2) + Math.pow(clientY - nodeCenterY, 2));

            // Basic proximity check + check if it's a valid sibling (in the same container/level - harder to check simply)
            // For now, just use proximity and vertical position
            if (dist < closestDistance && dist < 200) { // Check within a radius
                // TODO: Add check to prevent dropping parent into child
                closestNodeData = nodeData;
                closestDistance = dist;
                // Determine before/after based on vertical position relative to target's midpoint
                dropPosition = clientY < (nodeRect.top + nodeRect.height / 2) ? 'before' : 'after';
            }
        });

        // Show and position placeholder if a target is found
        if (closestNodeData) {
            this.placeholderEl.style.display = 'block';
            let placeholderY;
            // Calculate placeholder Y position relative to target node
            if (dropPosition === 'before') {
                placeholderY = closestNodeData.y - (V_SPACING / 2) - parseFloat(this.placeholderEl.style.height) / 2;
            } else {
                placeholderY = closestNodeData.y + closestNodeData.height + (V_SPACING / 2) - parseFloat(this.placeholderEl.style.height) / 2;
            }
            // Position placeholder horizontally aligned with target
            this.placeholderEl.style.left = `${closestNodeData.x}px`;
            this.placeholderEl.style.top = `${Math.max(0, placeholderY)}px`; // Ensure not negative
            this.placeholderEl.dataset.targetId = closestNodeData.id; // Store target ID
            this.placeholderEl.dataset.position = dropPosition; // Store position
        } else {
            this.placeholderEl.style.display = 'none'; // Hide if no target
            this.placeholderEl.dataset.targetId = '';
            this.placeholderEl.dataset.position = '';
        }
    }

    _handleNodeDragEnd(e) {
        if (!this.draggedNode) return;

        // Reset styles
        this.draggedNode.classList.remove(NODE_DRAGGING_CLASS);
        this.draggedNode.style.zIndex = '';
        this.canvas.classList.remove('nodes-dragging');
        this.mountPoint.style.cursor = 'grab';

        // Check if dropped on a valid target (using placeholder state)
        const targetId = this.placeholderEl.dataset.targetId;
        const position = this.placeholderEl.dataset.position;

        if (targetId && position && this.options.onNodeMove) {
            const sourceId = this.draggedNode.dataset.stepId;
            // Check target is not the source itself
            if (sourceId !== targetId) {
                // Call the callback to update the model
                this.options.onNodeMove(sourceId, targetId, position);
                // The visual update will happen when the parent calls render() again.
            } else {
                 // Snap back if dropped on self (handled by re-render implicitly if model doesn't change)
            }
        } else {
            // No valid drop target, snap back visually (or wait for re-render if model didn't change)
            const originalNodeData = this.nodes.get(this.draggedNode.dataset.stepId);
            if (originalNodeData) {
                this.draggedNode.style.left = `${originalNodeData.x}px`;
                this.draggedNode.style.top = `${originalNodeData.y}px`;
            }
        }

        // Clean up drag state and listeners
        this.isDraggingNode = false;
        this.draggedNode = null;
        this.placeholderEl.style.display = 'none'; // Hide placeholder
        this.placeholderEl.dataset.targetId = '';
        this.placeholderEl.dataset.position = '';
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);
    }

    // --- Runner Highlighting ---

    /**
     * Highlights a specific node and its incoming connector.
     * @param {string} stepId - The ID of the step/node to highlight.
     * @param {string} [highlightClass='active-step'] - The CSS class to apply (e.g., 'active-step', 'success', 'error').
     */
    highlightNode(stepId, highlightClass = 'active-step') {
        this.clearHighlights(); // Clear previous highlights first

        const nodeData = this.nodes.get(stepId);
        if (nodeData?.element) {
            nodeData.element.classList.add(highlightClass);
            // Scroll node into view smoothly if it's outside the viewport
            nodeData.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

            // Highlight incoming connector path and arrowhead
            const connectorPath = this.svgConnectors.querySelector(`.${CONNECTOR_CLASS}[data-to="${stepId}"]`);
            if (connectorPath) {
                connectorPath.classList.add(CONNECTOR_ACTIVE_CLASS); // Style with CSS
                // Find the associated marker and style its path element
                const markerId = connectorPath.getAttribute('marker-end')?.replace(/url\(#|\)/g, '');
                if (markerId) {
                    const markerPath = this.defs.querySelector(`#${markerId} path`);
                    if (markerPath) {
                         // TODO: Apply specific styling to marker based on highlightClass - needs CSS rules
                         // Example: markerPath.style.fill = 'orange';
                         markerPath.classList.add('active-arrowhead'); // Add class for CSS styling
                    }
                }
            }
        }
    }

    /** Removes all runner-related highlights from nodes and connectors. */
    clearHighlights() {
        // Remove classes from all node elements
        this.nodes.forEach(nodeData => {
            if (nodeData.element) {
                nodeData.element.classList.remove('active-step', 'success', 'error', 'stopped'); // Add more as needed
            }
        });

        // Remove classes from all connector paths and marker paths
        this.svgConnectors.querySelectorAll(`.${CONNECTOR_ACTIVE_CLASS}`).forEach(path => {
            path.classList.remove(CONNECTOR_ACTIVE_CLASS);
        });
         this.defs.querySelectorAll(`.active-arrowhead`).forEach(markerPath => {
            markerPath.classList.remove('active-arrowhead');
        });
    }

     /** Optional: Clean up listeners when the component is destroyed. */
     destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        // Remove document listeners just in case they are lingering
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);
        // Clear intervals/timeouts
        clearTimeout(this.debounceTimer);
        // Clear content
        this.mountPoint.innerHTML = '';
        console.log("FlowVisualizer destroyed.");
    }
}