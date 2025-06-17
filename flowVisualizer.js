// ========== FILE: flowVisualizer.js (FULL, UNABRIDGED, UPDATED with logging) ==========
/**
 * flowVisualizer.js
 * Renders the flow as a dynamic, interactive node-graph using SVG for connectors.
 * Handles node dragging, panning, selection highlighting, and basic runner integration.
 */
import { escapeHTML, generateConditionPreview } from './flowCore.js'; // Import utilities from core
import { getStepTypeIcon } from './flowStepComponents.js'; // Import UI-related helper
import { logger } from './logger.js';

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
const CONNECTOR_COLOURS = {
    'branch-then': '#10b981',
    'branch-else': '#ef4444',
    'loop-body': '#6366f1'
};
const NODE_CLASS = 'flow-node';
const NODE_SELECTED_CLASS = 'selected';
const NODE_DRAGGING_CLASS = 'dragging';
const SVG_NS = 'http://www.w3.org/2000/svg';

export class FlowVisualizer {
    // --- Minimap update throttle ---------------------------------
    _scheduleMinimapRefresh = () => {
        if (this._minimapNeedsRefresh) return;          // already scheduled
        this._minimapNeedsRefresh = true;
        requestAnimationFrame(() => {
            this._minimapNeedsRefresh = false;
            this._updateMinimap();                      // existing heavy call
        });
    };
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

        // Zoom state
        this.zoomLevel = 1;
        this.minZoom = 0.5;
        this.maxZoom = 2;
        this.pinchStartDistance = null;

        // Minimap
        this.minimapContainer = null;
        this.minimapContent = null;
        this.minimapViewport = null;
        this.minimapScale = 0.15;
        this.minimapVisible = false;
        this.isMinimapDragging = false;
        this._handleScroll = () => this._updateMinimapViewport();
        this._minimapFrame = null;
        this._minimapNeedsRefresh = false;

        // Debounce resize handler
        this.resizeObserver = null;
        this.debounceTimer = null;

        this.collapsedNodes = new Set(); // Track which nodes are collapsed

        this._createBaseStructure();
        this._bindBaseListeners();
        this._applyZoom();
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
        this.svgConnectors.style.transformOrigin = '0 0';

        // Add <defs> for arrowheads
        this.defs = document.createElementNS(SVG_NS, 'defs');
        this.svgConnectors.appendChild(this.defs);

        this.canvas = document.createElement('div');
        this.canvas.className = 'visualizer-canvas';
        this.canvas.style.position = 'relative'; // Container for absolutely positioned nodes
        this.canvas.style.transformOrigin = '0 0'; // For potential future zooming

        this.mountPoint.appendChild(this.svgConnectors);
        this.mountPoint.appendChild(this.canvas);

        this.minimapContainer = document.createElement('div');
        this.minimapContainer.className = 'visualizer-minimap';
        this.minimapContainer.style.display = 'none';

        this.minimapContent = document.createElement('div');
        this.minimapContent.className = 'minimap-content';
        this.minimapContent.style.transformOrigin = '0 0';
        this.minimapContent.style.pointerEvents = 'none';
        this.minimapContainer.appendChild(this.minimapContent);

        this.minimapViewport = document.createElement('div');
        this.minimapViewport.className = 'minimap-viewport';
        this.minimapViewport.style.position = 'absolute';
        this.minimapViewport.style.border = '1px solid red';
        this.minimapViewport.style.pointerEvents = 'none';
        this.minimapContainer.appendChild(this.minimapViewport);

        if (this.mountPoint.parentElement) {
            this.mountPoint.parentElement.appendChild(this.minimapContainer);
        } else {
            this.mountPoint.appendChild(this.minimapContainer);
        }
    }

    /** Binds essential event listeners for panning and potential resizing. */
    _bindBaseListeners() {
        this.mountPoint.addEventListener('pointerdown', this._handlePanStart);
        this.mountPoint.addEventListener('wheel', this._handleWheel, { passive: false });
        this.mountPoint.addEventListener('touchstart', this._handleTouchStart, { passive: false });
        this.mountPoint.addEventListener('touchmove', this._handleTouchMove, { passive: false });
        this.mountPoint.addEventListener('touchend', this._handleTouchEnd);
        this.mountPoint.addEventListener('scroll', this._handleScroll);
        this.minimapContainer.addEventListener('mousedown', this._handleMinimapMouseDown);
        this.minimapContainer.addEventListener('dblclick', this._handleMinimapDoubleClick);
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
                    // --- ADDED: Update collapsedNodes set based on loaded state ---
                    if (nodeData.collapsed) {
                        this.collapsedNodes.add(nodeData.id);
                    } else {
                         this.collapsedNodes.delete(nodeData.id);
                    }
                    // --- END ADDED ---
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
            // Check if this node is a child of a collapsed node and isn't the collapsed node itself
            const isChildOfCollapsed = skipNodes.has(nodeData.id) && !nodeData.collapsed;
            const nodeEl = this._createNodeElement(nodeData); // Create element regardless

            if (nodeEl) {
                nodeData.element = nodeEl;
                nodeEl.style.left = `${nodeData.x}px`;
                nodeEl.style.top = `${nodeData.y}px`;

                // Hide the element if it's a child of a collapsed node
                if (isChildOfCollapsed) {
                    nodeEl.style.display = 'none';
                }

                // Apply collapsed class if the node *itself* is collapsed
                if (nodeData.collapsed) {
                     nodeEl.classList.add('collapsed');
                }

                this.canvas.appendChild(nodeEl);

                // Update height based on actual rendered content (do this after appending)
                 // Use requestAnimationFrame to ensure styles are applied before measuring offsetHeight
                requestAnimationFrame(() => {
                     const actualHeight = Math.max(NODE_MIN_HEIGHT, nodeEl.offsetHeight);
                     nodeData.height = actualHeight;
                     nodeEl.style.height = `${actualHeight}px`; // Set explicit height

                     // Update bounds calculation (only if not hidden)
                     if (!isChildOfCollapsed) {
                          minX = Math.min(minX, nodeData.x);
                          minY = Math.min(minY, nodeData.y);
                          maxX = Math.max(maxX, nodeData.x + nodeData.width);
                          maxY = Math.max(maxY, nodeData.y + nodeData.height);
                     }

                     // Defer canvas size update and connector rendering until after heights are measured
                     this._finalizeRender(defaultLayoutResult, minX, minY, maxX, maxY);
                });
            }
        });

        // Initial render might have no nodes, handle this case
         if (this.nodes.size === 0) {
             this._finalizeRender(defaultLayoutResult, minX, minY, maxX, maxY);
         }
    }

    // --- NEW Helper Function to finalize rendering after potential async height updates ---
    _finalizeRender(defaultLayoutResult, minX, minY, maxX, maxY) {
        // Calculate final bounds based on possibly updated node dimensions
        let finalContentWidth = 0;
        let finalContentHeight = 0;
        let finalMinX = Infinity;
        let finalMinY = Infinity;
        let finalMaxX = 0;
        let finalMaxY = 0;

        this.nodes.forEach(nodeData => {
             // Only consider nodes that are not hidden by a collapsed parent
             const isHidden = nodeData.element?.style.display === 'none';
            if (!isHidden && nodeData.element) {
                 finalMinX = Math.min(finalMinX, nodeData.x);
                 finalMinY = Math.min(finalMinY, nodeData.y);
                 finalMaxX = Math.max(finalMaxX, nodeData.x + nodeData.width);
                 finalMaxY = Math.max(finalMaxY, nodeData.y + nodeData.height);
            }
        });

        // Calculate width/height based on final bounds
        finalContentWidth = (finalMaxX === 0 && finalMinX === Infinity) ? 0 : finalMaxX - Math.min(finalMinX, CANVAS_PADDING);
        finalContentHeight = (finalMaxY === 0 && finalMinY === Infinity) ? 0 : finalMaxY - Math.min(finalMinY, CANVAS_PADDING);

        const effectiveWidth = Math.max(defaultLayoutResult.width, finalContentWidth);
        const effectiveHeight = Math.max(defaultLayoutResult.height, finalContentHeight);
        this._updateCanvasAndSvgSize(effectiveWidth, effectiveHeight);

        this._renderAllConnectors(); // Render connectors based on FINAL node positions
        this._updateMinimap();

        // Apply selection highlight
        if (this.selectedNodeId) {
            const selectedNode = this.nodes.get(this.selectedNodeId);
            if (selectedNode?.element) {
                selectedNode.element.classList.add(NODE_SELECTED_CLASS);
            }
        }
    }
    // --- END NEW Helper ---

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
        let currentLevelMaxStepHeight = 0; // Track max height at this level

        if (!steps || steps.length === 0) {
            return { width: 0, height: 0 };
        }

        steps.forEach((step, index) => {
            let nodeData = this.nodes.get(step.id) || {
                id: step.id,
                width: NODE_WIDTH,
                height: NODE_MIN_HEIGHT, // Use min height initially
                step: step,
                element: null,
                childrenLayout: null,
                ports: {}
            };

             // Store the node data if not already present
            if (!this.nodes.has(step.id)) {
                this.nodes.set(step.id, nodeData);
            }

             // --- Assign initial layout position BEFORE recursion ---
             nodeData.x = currentX;
             nodeData.y = startY;
             currentLevelMaxStepHeight = Math.max(currentLevelMaxStepHeight, nodeData.height);

            // --- Recurse for children and calculate their layout bounds ---
            let stepBranchHeight = 0; // Additional vertical space consumed by branches below this step
            let stepBranchWidth = 0; // Width consumed by branches

            try {
                 // Bootstrap collapsed state from model if not already set by user interaction
                if (nodeData.collapsed === undefined) { // Check if undefined
                     nodeData.collapsed = !!(this.flowModel.visualLayout?.[step.id]?.collapsed);
                     if (nodeData.collapsed) this.collapsedNodes.add(step.id);
                }

                if (step.type === 'condition' && !this.collapsedNodes.has(step.id)) {
                     const branchStartX = currentX; // Branches start below parent
                     const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;

                     const thenLayout = this._layoutSteps(step.thenSteps || [], branchStartX, branchStartY);
                     const elseStartY = branchStartY + (thenLayout.height > 0 ? thenLayout.height + V_SPACING : 0);
                     const elseLayout = this._layoutSteps(step.elseSteps || [], branchStartX, elseStartY);

                     nodeData.childrenLayout = { then: thenLayout, else: elseLayout };
                     stepBranchHeight = BRANCH_V_SPACING + thenLayout.height + (thenLayout.height > 0 && elseLayout.height > 0 ? V_SPACING : 0) + elseLayout.height;
                     stepBranchWidth = Math.max(thenLayout.width, elseLayout.width); // Width is max of branches

                } else if (step.type === 'loop' && !this.collapsedNodes.has(step.id)) {
                    const branchStartX = currentX; // Loop body starts below parent
                    const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;
                    const loopLayout = this._layoutSteps(step.loopSteps || [], branchStartX, branchStartY);

                    nodeData.childrenLayout = { loop: loopLayout };
                    stepBranchHeight = BRANCH_V_SPACING + loopLayout.height;
                    stepBranchWidth = loopLayout.width; // Width is determined by loop body
                }
                 // --- Update overall bounds based on this step and its branches ---
                 const currentStepReachX = currentX + Math.max(nodeData.width, stepBranchWidth);
                 const currentStepReachY = startY + nodeData.height + stepBranchHeight;
                 maxReachX = Math.max(maxReachX, currentStepReachX);
                 maxReachY = Math.max(maxReachY, currentStepReachY);

                 // Move to the next horizontal position for the *next* step at *this* level
                 currentX += nodeData.width + H_SPACING;


            } catch (error) {
                logger.error(`Layout error for step ${step.id}:`, error);
                 // Fallback layout on error
                 nodeData.x = currentX;
                 nodeData.y = startY;
                 nodeData.height = NODE_MIN_HEIGHT; // Reset height
                 maxReachY = Math.max(maxReachY, startY + nodeData.height);
                 maxReachX = Math.max(maxReachX, currentX + nodeData.width);
                 currentX += nodeData.width + H_SPACING; // Still advance X
            }

            // Update the nodeData in the map (redundant if already set, but safe)
            this.nodes.set(step.id, nodeData);
        });


        // --- Calculate final bounds for THIS level ---
        // Width is the total horizontal distance covered.
        // Height is the total vertical distance from startY to the maximum Y reached by any node or branch at this level.
        const finalWidth = maxReachX - startX;
        const finalHeight = maxReachY - startY;

        return {
            width: finalWidth,
            height: finalHeight
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
        this._updateMinimap();
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

    setZoom(level) {
        this.zoomLevel = Math.min(this.maxZoom, Math.max(this.minZoom, level));
        this._applyZoom();
        this._updateMinimapViewport();
    }

    zoomIn() {
        this.setZoom(this.zoomLevel + 0.1);
    }

    zoomOut() {
        this.setZoom(this.zoomLevel - 0.1);
    }

    resetZoom() {
        this.setZoom(1);
    }

    _applyZoom() {
        const scale = `scale(${this.zoomLevel})`;
        if (this.canvas) this.canvas.style.transform = scale;
        if (this.svgConnectors) this.svgConnectors.style.transform = scale;
    }

    _applyScroll(left, top) {
        const canvasW = parseFloat(this.canvas?.style.width || this.canvas?.offsetWidth || '0');
        const canvasH = parseFloat(this.canvas?.style.height || this.canvas?.offsetHeight || '0');
        const scrollMaxLeft = this.mountPoint.scrollWidth - this.mountPoint.clientWidth;
        const scrollMaxTop = this.mountPoint.scrollHeight - this.mountPoint.clientHeight;
        const maxLeft = Math.max(0, scrollMaxLeft, canvasW - this.mountPoint.clientWidth);
        const maxTop = Math.max(0, scrollMaxTop, canvasH - this.mountPoint.clientHeight);
        this.mountPoint.scrollLeft = Math.max(0, Math.min(maxLeft, left));
        this.mountPoint.scrollTop = Math.max(0, Math.min(maxTop, top));
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
        // Check collapsed state using the internal set for initial render
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
             // Use arrow function to bind 'this' if handleDeleteClick isn't already bound
             delBtn.addEventListener('click', (e) => this.handleDeleteClick(e, step.id));
        }

        // Collapse toggle handler
        const toggleButton = headerEl.querySelector('.btn-toggle-collapse');
        if (toggleButton) {
            toggleButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasCollapsed = this.collapsedNodes.has(nodeData.id);
                if (wasCollapsed) this.collapsedNodes.delete(nodeData.id);
                else               this.collapsedNodes.add(nodeData.id);

                nodeData.collapsed = !wasCollapsed; // Update internal node data

                // --- Notify host of the collapse state change ---
                this.options.onNodeLayoutUpdate?.(
                    step.id,
                    nodeData.x, // Use current position
                    nodeData.y,
                    { collapsed: nodeData.collapsed } // Pass the new state
                );

                /* hide / show descendants */
                this._collectDescendantIds(step).forEach(id => {
                    const nd = this.nodes.get(id);
                    if (nd?.element) nd.element.style.display = nodeData.collapsed ? 'none' : '';
                });

                // Update button text and element classes
                toggleButton.textContent = nodeData.collapsed ? '▼' : '▲';
                headerEl.classList.toggle('collapsed', nodeData.collapsed);
                nodeEl.classList.toggle('collapsed', nodeData.collapsed);
                // Redraw connectors after hiding/showing descendants
                this._renderAllConnectors();
            });
        }

        // Add or improve tooltips for node actions in the visualizer
        // Only set title, do not redeclare delBtn
        if (delBtn) delBtn.title = 'Delete this step';
        const collapseBtn = headerEl.querySelector('.btn-toggle-collapse');
        if (collapseBtn) collapseBtn.title = 'Expand/collapse this node';
        // Add tooltip to node drag handle if present
        const dragHandle = headerEl.querySelector('.node-drag-handle');
        if (dragHandle) dragHandle.title = 'Drag to move node';

        // Node content
        const contentEl = document.createElement('div');
        contentEl.className = 'node-content';
        contentEl.innerHTML = `
            ${this._getNodeContentHTML(step)}
            <div class="node-runtime-details"></div>
        `;
        nodeEl.appendChild(contentEl);

        // Drag and Drop Initialization (mousedown listener for free placement)
        nodeEl.addEventListener('mousedown', this._handleNodeMouseDown); // Use bound reference

        // Add click handler for node selection
        nodeEl.addEventListener('click', (e) => this.handleNodeClick(e, step.id)); // Use bound reference

        // Apply collapsed class initially if needed (redundant with header class setting, but safe)
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
            logger.error(`Error generating content HTML for step ${step.id}:`, error);
            return `Error displaying content. Type: ${escapeHTML(step.type)}`;
        }
    }

    // --- Connector Rendering ---

    /** Renders all connectors based on the node layout. */
    _renderAllConnectors() {
        if (!this.svgConnectors || !this.defs) return;
        Array.from(this.svgConnectors.querySelectorAll('path.' + CONNECTOR_CLASS))
            .forEach(p => {
                const fromId = p.dataset.from, toId = p.dataset.to;
                if (!this.nodes.get(fromId)?.element ||
                    !this.nodes.get(toId)?.element ||
                    this.nodes.get(fromId).element.style.display === 'none' ||
                    this.nodes.get(toId).element.style.display === 'none') {
                    p.remove();
                }
            });
        // Store existing defs content temporarily
        const defsContent = this.defs.innerHTML;
        this.svgConnectors.innerHTML = ''; // Clear previous connectors AND defs
        // Recreate defs and restore content
        this.defs = document.createElementNS(SVG_NS, 'defs');
        this.defs.innerHTML = defsContent;
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
            // --- Skip hidden nodes (children of collapsed) ---
            if (!currentNodeData || currentNodeData.element?.style.display === 'none') {
                // Do not draw connections to/from this node, and DO NOT update prevNodeData
                // The next visible node will connect from the *last visible* parent/previous node.
                return;
            }

            if (prevNodeData) {
                this._drawConnector(prevNodeData, currentNodeData, currentParentPortType, 'input');
            }

            // Only recurse if the current node is NOT collapsed
            if (!this.collapsedNodes.has(step.id)) {
                if (step.type === 'condition') {
                    this._renderConnectorsRecursive(step.thenSteps || [], currentNodeData, 'branch-then');
                    this._renderConnectorsRecursive(step.elseSteps || [], currentNodeData, 'branch-else');
                } else if (step.type === 'loop') {
                    this._renderConnectorsRecursive(step.loopSteps || [], currentNodeData, 'loop-body');
                }
            }

            // Update prevNodeData ONLY if the current node was visible and processed
            prevNodeData = currentNodeData;
            currentParentPortType = 'output'; // Next connection originates from standard output
        });
    }


    /** Calculates the absolute position of a conceptual port on a node. */
    _getPortPosition(nodeData, portType) {
        if (!nodeData) return { x: NaN, y: NaN };
        const zoom = this.zoomLevel || 1;

        let x, y;
        // If this node is currently being dragged, use its style position for accurate connector drawing during drag
        if (this.isDraggingNode && this.draggedNode && this.draggedNode.dataset.stepId === nodeData.id) {
            x = parseFloat(this.draggedNode.style.left || '0') * (1/zoom);
            y = parseFloat(this.draggedNode.style.top  || '0') * (1/zoom);
        } else {
            // Otherwise, use the stored layout coordinates
            x = nodeData.x;
            y = nodeData.y;
        }

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

    _buildOrthogonalPath({ x: xs, y: ys }, { x: xe, y: ye }) {
        const m = 16;
        const vertical = Math.abs(ys - ye) > Math.abs(xs - xe);
        const pts = [];
        pts.push([xs, ys]);
        if (vertical) {
            const midY = ys + (ys < ye ? m : -m);
            pts.push([xs, midY], [xe, midY]);
        } else {
            const midX = xs + (xs < xe ? m : -m);
            pts.push([midX, ys], [midX, ye]);
        }
        pts.push([xe, ye]);
        return 'M ' + pts.map(p => p.join(' ')).join(' L ');
    }

    /** Draws a single SVG connector between two nodes using orthogonal paths. */
    _drawConnector(startNodeData, endNodeData, startPortType, endPortType) {
        if (!startNodeData || !endNodeData) {
            logger.warn("Skipping connector draw: Missing start or end node data.");
            return;
        }
        // Check if either node is hidden
        if (startNodeData.element?.style.display === 'none' || endNodeData.element?.style.display === 'none') {
            return; // Skip drawing if connected to a hidden node
        }

        try {
            const startPos = this._getPortPosition(startNodeData, startPortType);
            const endPos = this._getPortPosition(endNodeData, endPortType);

            if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(endPos.x) || isNaN(endPos.y)) {
                throw new Error(`Invalid port positions calculated: Start(${startPos.x},${startPos.y}), End(${endPos.x},${endPos.y}) for nodes ${startNodeData.id} -> ${endNodeData.id}`);
            }

            const pathData = this._buildOrthogonalPath(startPos, endPos);
            const stroke = CONNECTOR_COLOURS[startPortType] || 'var(--border-color-dark)';


            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('class', CONNECTOR_CLASS);
            path.setAttribute('stroke', stroke);
            path.dataset.from = startNodeData.id;
            path.dataset.to = endNodeData.id;
            path.dataset.startPort = startPortType;
            path.dataset.endPort = endPortType;

            const markerId = `arrow-${startNodeData.id}-${startPortType}-to-${endNodeData.id}-${endPortType}`.replace(/[^a-zA-Z0-9-_]/g, '_');
            const marker = document.createElementNS(SVG_NS, 'marker');
            marker.setAttribute('id', markerId);
            marker.setAttribute('viewBox', '0 -5 10 10');
            marker.setAttribute('refX', '8');
            marker.setAttribute('refY', '0');
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto-start-reverse');
            const arrowPath = document.createElementNS(SVG_NS, 'path');
            arrowPath.setAttribute('d', 'M0,-5L10,0L0,5');
            arrowPath.setAttribute('class', 'connector-arrowhead');
            arrowPath.setAttribute('fill', stroke);
            marker.appendChild(arrowPath);

            // Only add marker definition if it doesn't exist already
            if (this.defs && !this.defs.querySelector(`#${markerId}`)) {
                this.defs.appendChild(marker);
            }
            path.setAttribute('marker-end', `url(#${markerId})`);

            this.svgConnectors.appendChild(path);

        } catch (error) {
            logger.error(`Error drawing connector from ${startNodeData?.id} (${startPortType}) to ${endNodeData?.id} (${endPortType}):`, error);
        }
    }


    // --- Interaction Handlers ---

    // Bound arrow functions to handle 'this' context automatically
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

    _handleWheel = (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const delta = e.deltaY;
        this.setZoom(this.zoomLevel - delta / 500);
    }
    // --- End Bound Handlers ---

    _handlePanStart = (e) => {
        if (e.button !== PAN_BUTTON || (e.target !== this.mountPoint && e.target !== this.canvas)) {
            return;
        }

        e.preventDefault();
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.scrollLeftStart = this.mountPoint.scrollLeft;
        this.scrollTopStart = this.mountPoint.scrollTop;
        this.mountPoint.style.cursor = 'grabbing';
        this.mountPoint.style.userSelect = 'none'; // Prevent text selection during pan
        document.addEventListener('pointermove', this._handlePanMove);
        document.addEventListener('pointerup', this._handlePanEnd);
    }

    _handlePanMove = (e) => {
        if (!this.isPanning) return;
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this._applyScroll(this.scrollLeftStart - dx, this.scrollTopStart - dy);
        this._updateMinimapViewport();
    }

    _handlePanEnd = (e) => {
        this.isPanning = false;
        this.mountPoint.style.cursor = 'grab';
        this.mountPoint.style.userSelect = ''; // Re-enable text selection
        document.removeEventListener('pointermove', this._handlePanMove);
        document.removeEventListener('pointerup', this._handlePanEnd);
    }

    _handleNodeMouseDown = (e) => { // Arrow function binds 'this'
        const nodeEl = e.currentTarget;
        logger.debug(`[Visualizer DragStart] Mousedown on node ${nodeEl.dataset.stepId}`);
        // Allow drag only from header, not content or specific action buttons
        if (e.button !== 0 || !e.target.closest('.node-header') || e.target.closest('button')) {
            return;
        }

        this.isDraggingNode = true;
        this.draggedNode = nodeEl;
        nodeEl.classList.add(NODE_DRAGGING_CLASS);
        if (this.canvas) this.canvas.classList.add('nodes-dragging'); // Add class to canvas

        const rect = nodeEl.getBoundingClientRect();
        const mountRect = this.mountPoint.getBoundingClientRect();

        // Calculate offset relative to the node's top-left corner
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;

        this.dragStartX = e.clientX; // Store initial mouse position
        this.dragStartY = e.clientY;

        this.isPanning = false; // Prevent panning during node drag
        this.mountPoint.style.cursor = 'grabbing'; // Change cursor for mount point

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

        // Calculate new position relative to the canvas, considering scroll and drag offset
        const zoom = this.zoomLevel || 1;
        let newX = (newPageX - mountRect.left + this.mountPoint.scrollLeft - this.dragOffsetX) / zoom;
        let newY = (newPageY - mountRect.top  + this.mountPoint.scrollTop  - this.dragOffsetY) / zoom;
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);

        // Directly update style, remove internal data update
        this.draggedNode.style.left = `${newX}px`;
        this.draggedNode.style.top = `${newY}px`;
        this.draggedNode.style.zIndex = '1001'; // Keep on top while dragging

        const stepId = this.draggedNode.dataset.stepId;
        const nodeData = this.nodes.get(stepId);

        if (nodeData) {
            // Update connectors based on the current visual position (using the modified _getPortPosition)
            this._updateNodeConnectors(nodeData);

            // NEW – keep minimap in-sync while dragging
            if (this.minimapVisible) this._scheduleMinimapRefresh();
        }
    }

    /** Updates connectors attached to a specific node, using orthogonal path logic */
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

                    const pathData = this._buildOrthogonalPath(startPos, endPos);
                    const stroke = CONNECTOR_COLOURS[startPortType] || 'var(--border-color-dark)';

                    path.setAttribute('d', pathData);
                    path.setAttribute('stroke', stroke);
                } catch (error) {
                    logger.error(`Error updating connector d attribute for path ${fromId}->${toId}:`, error);
                }
            } else {
                logger.warn(`Skipping connector update for ${fromId}->${toId}: Missing node data for start or end.`);
            }
            if (!startNode?.element || startNode.element.style.display === 'none' ||
                !endNode?.element   || endNode.element.style.display === 'none') {
                path.remove();
            }
        });
    }


    // --- UPDATED: _handleNodeDragEnd with Logging ---
     _handleNodeDragEnd(e) {
        const draggedNodeAtStart = this.draggedNode; // Store ref before potential reset
        const sourceId = draggedNodeAtStart?.dataset?.stepId;
        logger.debug(`[Visualizer DragEnd] Mouseup detected. Dragged node ID: ${sourceId}`);

        // Capture final position from style
        const finalX = parseFloat(draggedNodeAtStart?.style?.left || '0');
        const finalY = parseFloat(draggedNodeAtStart?.style?.top || '0');
         // +++ ADD LOGGING +++
        logger.debug(`[Visualizer DragEnd] Calculated final position from style: (${finalX}, ${finalY})`);
        // +++ END LOGGING +++


        try {
            if (!draggedNodeAtStart || !sourceId) {
                logger.warn("[Visualizer DragEnd] No valid node was being dragged.");
                return;
            }

            // --- Check if position is valid AND callback exists ---
            if (!isNaN(finalX) && !isNaN(finalY) && this.options.onNodeLayoutUpdate) {
                 // +++ ADD LOGGING +++
                logger.debug(`[Visualizer DragEnd] BEFORE calling onNodeLayoutUpdate for ${sourceId} with: x=${finalX}, y=${finalY}`);
                // +++ END LOGGING +++
                try {
                    // Call the callback to update the application state (model)
                    this.options.onNodeLayoutUpdate(sourceId, finalX, finalY);
                    // +++ ADD LOGGING +++
                    logger.debug(`[Visualizer DragEnd] AFTER calling onNodeLayoutUpdate successfully for ${sourceId}.`);
                    // +++ END LOGGING +++


                    // Update the visualizer's internal state as well AFTER successful callback
                    const nodeData = this.nodes.get(sourceId);
                    if (nodeData) {
                        nodeData.x = finalX;
                        nodeData.y = finalY;
                        logger.debug(`[Visualizer DragEnd] Updated internal nodeData for ${sourceId} to (${finalX}, ${finalY})`);
                    } else {
                         logger.warn(`[Visualizer DragEnd] Could not find internal nodeData for ${sourceId} to update its position.`);
                    }

                } catch (callbackError) {
                    logger.error("Error in onNodeLayoutUpdate callback:", callbackError);
                    // Revert visual position if callback failed
                    const originalNodeData = this.nodes.get(sourceId);
                    if (originalNodeData && draggedNodeAtStart) {
                        draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                        draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                         // Also redraw connectors based on reverted position
                         this._updateNodeConnectors(originalNodeData);
                    }
                }
            } else {
                 // If callback doesn't exist or position is invalid, revert visual position
                 logger.warn("[Visualizer DragEnd] Invalid position or no layout update callback. Reverting visual position.");
                 const originalNodeData = this.nodes.get(sourceId);
                 if (originalNodeData && draggedNodeAtStart) {
                     draggedNodeAtStart.style.left = `${originalNodeData.x}px`;
                     draggedNodeAtStart.style.top = `${originalNodeData.y}px`;
                     // Also redraw connectors based on reverted position
                     this._updateNodeConnectors(originalNodeData);
                 }
            }
        } catch (error) {
            logger.error("Error during node drag end logic:", error);
             // General error handling: attempt to revert visual position
             if (draggedNodeAtStart && sourceId) {
                 const originalNodeData = this.nodes.get(sourceId);
                 if (originalNodeData) {
                     draggedNodeAtStart.style.left = `${originalNodeData.x}`;
                     draggedNodeAtStart.style.top = `${originalNodeData.y}`;
                      this._updateNodeConnectors(originalNodeData);
                 }
             }
        } finally {
             // Cleanup
            if (draggedNodeAtStart) {
                draggedNodeAtStart.classList.remove(NODE_DRAGGING_CLASS);
                draggedNodeAtStart.style.zIndex = ''; // Reset z-index
            }
            if (this.canvas) this.canvas.classList.remove('nodes-dragging');
            if (this.mountPoint) this.mountPoint.style.cursor = 'grab';

            this.isDraggingNode = false;
            this.draggedNode = null;

            document.removeEventListener('mousemove', this._handleMouseMove);
            document.removeEventListener('mouseup', this._handleMouseUp);
             // +++ ADD LOGGING +++
             logger.debug("[Visualizer DragEnd] Cleanup complete.");
             // +++ END LOGGING +++

            // Final refresh to lock-in the new coordinates
            if (this.minimapVisible) this._updateMinimap();
        }
    }
    // --- END UPDATED _handleNodeDragEnd ---

    // --- Runner Highlighting ---

    /**
     * Highlights a specific node and its incoming connector based on execution status.
     * @param {string} stepId - The ID of the step/node to highlight.
     * @param {string} [highlightType='active'] - The type of highlight ('active', 'success', 'error', 'stopped').
     */
    highlightNode(stepId, highlightType = 'active') {
        this.clearHighlights(); // Clear previous before applying new

        const nodeData = this.nodes.get(stepId);
        if (!nodeData || !nodeData.element) {
            logger.warn(`Highlight Error: Node data or element not found for step ${stepId}.`);
            return;
        }

        try {
             // Determine the CSS class based on highlightType
             const highlightClass = highlightType === 'active' ? 'active-step'
                                 : highlightType === 'success' ? 'success'
                                 : highlightType === 'error' ? 'error'
                                 : highlightType === 'stopped' ? 'stopped'
                                 : highlightType; // Allow passing custom class names directly

             // Add class to the node element
             nodeData.element.classList.add(highlightClass);

            // Scroll node into view if necessary
            if (typeof nodeData.element.scrollIntoView === 'function') {
                try {
                    nodeData.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                } catch (scrollError) {
                     // Fallback for browsers that don't support smooth scrolling well with options
                     try { nodeData.element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); }
                     catch (fallbackError) { logger.warn("ScrollIntoView failed:", fallbackError); }
                }
            }

            // Highlight the incoming connector path and arrowhead
            const connectorPath = this.svgConnectors?.querySelector(`.${CONNECTOR_CLASS}[data-to="${stepId}"]`);
            if (connectorPath) {
                 const statusClass = `status-${highlightType}`; // Map highlightType to status- class
                 connectorPath.classList.add(CONNECTOR_ACTIVE_CLASS); // General active state
                 connectorPath.classList.add(statusClass); // Specific status state

                 // Highlight the arrowhead via its marker definition
                 const markerId = connectorPath.getAttribute('marker-end')?.replace(/url\(#|\)/g, '');
                 if (markerId && this.defs) {
                     const markerPath = this.defs.querySelector(`#${markerId} path.connector-arrowhead`);
                     if (markerPath) {
                         markerPath.classList.add('active-arrowhead');
                         markerPath.classList.add(statusClass);
                     }
                 }
            }
        } catch (error) {
            logger.error(`Error applying highlight (type: ${highlightType}) to node ${stepId}:`, error);
        }
    }


    /** Removes all runner-related highlights from nodes and connectors. */
    clearHighlights() {
        try {
            const highlightClasses = ['active-step', 'success', 'error', 'stopped'];
            const statusClasses = ['status-active', 'status-success', 'status-error', 'status-stopped'];

            // Clear node highlights and runtime info
            this.nodes.forEach(nodeData => {
                if (nodeData.element) {
                    nodeData.element.classList.remove(...highlightClasses);
                    const runtimeInfoDiv = nodeData.element.querySelector('.node-runtime-details');
                    if (runtimeInfoDiv) {
                        runtimeInfoDiv.innerHTML = ''; // Clear runtime info display
                    }
                }
            });

            // Clear connector path highlights
            if (this.svgConnectors) {
                this.svgConnectors.querySelectorAll(`.${CONNECTOR_CLASS}`).forEach(path => {
                    path.classList.remove(CONNECTOR_ACTIVE_CLASS, ...statusClasses);
                });
            }
            // Clear connector arrowhead highlights
            if (this.defs) {
                this.defs.querySelectorAll(`.connector-arrowhead`).forEach(markerPath => {
                    markerPath.classList.remove('active-arrowhead', ...statusClasses);
                });
            }

        } catch (error) {
            logger.error("Error clearing highlights:", error);
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
            logger.warn(`[Vis UpdateInfo] Node data/element/step not found for ID: ${stepId}`);
            return;
        }

        const runtimeInfoDiv = nodeData.element.querySelector('.node-runtime-details');
        if (!runtimeInfoDiv) {
            logger.warn(`[Vis UpdateInfo] Node runtime details container not found for ID: ${stepId}`);
            return;
        }

        runtimeInfoDiv.innerHTML = ''; // Clear previous info
        let detailsParts = []; // Array to hold HTML parts

        // --- Specific Info for Request Steps ---
        if (nodeData.step.type === 'request') {
            let requestInfoHtml = '';
            let hasRequestInfo = false;

            // Display HTTP Status Code
            if (result.output && result.output.status !== undefined && result.output.status !== null) {
                const statusClass = result.output.status >= 400 ? 'error' : (result.output.status >= 300 ? 'warn' : 'success');
                requestInfoHtml += `<span class="info-item status-${statusClass}">Status: <strong>${escapeHTML(result.output.status)}</strong></span>`;
                hasRequestInfo = true;
            } else if (result.status === 'error') { // Display general error if no output status
                 requestInfoHtml += `<span class="info-item error">Request Error</span>`;
                 hasRequestInfo = true;
            }

            // Display Extraction Status
            const hasConfiguredExtractions = nodeData.step.extract && Object.keys(nodeData.step.extract).length > 0;
            let extractionStatus = 'N/A'; // Not Applicable if no extractions configured
            let extractionStatusClass = 'neutral';

            if (hasConfiguredExtractions) {
                if (result.status === 'success' || (result.status === 'error' && nodeData.step.onFailure === 'continue')) {
                     // Show extraction status only if the request completed (even if non-2xx but continuing)
                    if (result.extractionFailures && result.extractionFailures.length > 0) {
                        extractionStatus = 'Failed';
                        extractionStatusClass = 'error';
                    } else {
                        extractionStatus = 'OK';
                        extractionStatusClass = 'success';
                    }
                } else {
                     extractionStatus = 'Skipped'; // Skipped if request errored and stopped
                     extractionStatusClass = 'neutral';
                }
            }

            // Add extraction status if applicable
            if (extractionStatus !== 'N/A') {
                requestInfoHtml += `<span class="info-item extract-${extractionStatusClass}">Extract: <strong>${extractionStatus}</strong></span>`;
                hasRequestInfo = true;
            }

            if (hasRequestInfo) {
                detailsParts.push(requestInfoHtml);
            }
        }
        // --- General Error Info for Non-Request Steps ---
        else if (result.status === 'error') {
            detailsParts.push('<span class="info-item error">Step Error</span>');
        }

        // --- Loop Iteration Info (if applicable, based on custom result properties) ---
        // Check for properties potentially added by a custom onStepComplete handler
        const iter = result.currentIteration ?? result.loopIteration;
        const tot  = result.totalIterations ?? result.loopTotal;
        if (iter !== undefined && tot !== undefined && typeof iter === 'number' && typeof tot === 'number') {
            detailsParts.push(`<span class="info-item loop-iteration">Iter: ${iter + 1}/${tot}</span>`);
        }

        // --- General Status Indicator (Optional, could be redundant with border) ---
        // if (result.status === 'running') {
        //     detailsParts.push('<span class="status-indicator status-running">Running...</span>');
        // }

        // --- Combine and Render ---
        runtimeInfoDiv.innerHTML = detailsParts.join(' · '); // Use a separator
    }


    /** Optional: Clean up listeners when the component is destroyed. */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        // Remove dynamically added document listeners
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);
        document.removeEventListener('pointermove', this._handlePanMove);
        document.removeEventListener('pointerup', this._handlePanEnd);

        // Remove listeners attached to the mount point itself
        this.mountPoint?.removeEventListener('pointerdown', this._handlePanStart);
        this.mountPoint?.removeEventListener('wheel', this._handleWheel);
        this.mountPoint?.removeEventListener('touchstart', this._handleTouchStart);
        this.mountPoint?.removeEventListener('touchmove', this._handleTouchMove);
        this.mountPoint?.removeEventListener('touchend', this._handleTouchEnd);
        this.mountPoint?.removeEventListener('scroll', this._handleScroll);
        this.minimapContainer?.removeEventListener('mousedown', this._handleMinimapMouseDown);
        // Remove listeners attached to nodes (more complex, requires iterating nodes if needed)
        this.nodes?.forEach(nodeData => { // Add safe navigation
            if (nodeData.element) {
                nodeData.element.removeEventListener('mousedown', this._handleNodeMouseDown);
                // Assuming handleNodeClick is an instance method or bound function
                nodeData.element.removeEventListener('click', (e) => this.handleNodeClick(e, nodeData.id));
                 // Remove button listeners if they were attached individually
                 const delBtn = nodeData.element.querySelector('.btn-delete-node');
                 if (delBtn) {
                     // Need a way to remove the specific listener added in _createNodeElement
                     // This might require storing listener references or using a different approach
                     // For now, this won't remove the specific listener effectively
                 }
                 const toggleBtn = nodeData.element.querySelector('.btn-toggle-collapse');
                 if (toggleBtn) {
                      // Similar issue as delete button listener removal
                 }
            }
        });

        clearTimeout(this.debounceTimer);

        this.clear(); // Clears nodes map, canvas, svg
        // Nullify properties
        this.nodes = null;
        this.flowModel = null;
        this.svgConnectors = null;
        this.canvas = null;
        this.defs = null;
        this.draggedNode = null;
        this.options = null; // Release options/callbacks

        if (this.minimapContainer && this.minimapContainer.parentElement) {
            this.minimapContainer.parentElement.removeChild(this.minimapContainer);
        }

        this.minimapContainer = null;

        if (this.mountPoint) this.mountPoint.innerHTML = '';
        this.mountPoint = null;

        logger.info("FlowVisualizer destroyed.");
    }

    // --- Bound Event Handlers for Click/Delete (to handle 'this' context) ---
    // Method used as a listener
    handleNodeClick = (event, nodeId) => { // Use arrow function for auto-binding 'this'
        // Prevent selection if dragging just ended on this element
        const dx = Math.abs(event.clientX - this.dragStartX);
        const dy = Math.abs(event.clientY - this.dragStartY);
        if (this.isDraggingNode || dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
            // If it looks like a drag happened, don't treat it as a click for selection
            return;
        }

        if (this.options.onNodeSelect) {
            this.options.onNodeSelect(nodeId);
        }
        // The main render call handles the visual selection based on appState.selectedStepId
    }

    // Method used as a listener
    handleDeleteClick = (event, nodeId) => { // Use arrow function for auto-binding 'this'
        event.stopPropagation(); // Prevent triggering node selection
        if (this.options.onDeleteStep) {
            this.options.onDeleteStep(nodeId);
        }
    }
    // --- End Bound Handlers ---

    // --- Helper: Find step by id (depth-first) ---
    _findStepById(steps, id) {
        if (!steps || !Array.isArray(steps)) return null; // Added check for steps array
        for (const step of steps) {
            if (step.id === id) return step;
            let found = null;
            if (step.type === 'condition') {
                found = this._findStepById(step.thenSteps || [], id); // Use default empty array
                if (found) return found;
                found = this._findStepById(step.elseSteps || [], id);
                if (found) return found;
            } else if (step.type === 'loop') {
                found = this._findStepById(step.loopSteps || [], id);
                if (found) return found;
            }
        }
        return null;
    }


    // --- Helper: Collect all descendant step IDs (recursive) ---
    _collectDescendantIds(step, acc = new Set()) {
        const collect = (steps) => {
             if (!steps || !Array.isArray(steps)) return;
             for (const s of steps) {
                 if (!acc.has(s.id)) { // Avoid infinite loops in case of bad data
                     acc.add(s.id);
                     this._collectDescendantIds(s, acc); // Recurse using the instance method
                 }
             }
        };

        if (step.type === 'condition') {
            collect(step.thenSteps);
            collect(step.elseSteps);
        } else if (step.type === 'loop') {
            collect(step.loopSteps);
        }
        // No collection needed for 'request' or other simple types

        return acc; // Return the accumulated set
    }

    // --- Minimap Methods ---

    _addMiniRect(x, y, w, h) {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x);
        r.setAttribute('y', y);
        r.setAttribute('width', w);
        r.setAttribute('height', h);
        r.setAttribute('fill', 'none');
        r.setAttribute('stroke', 'rgba(0,0,0,.45)');
        r.setAttribute('stroke-width', '1');
        return r;
    }

    _updateMinimap() {
        if (!this.minimapContent) return;
        this.minimapContent.innerHTML = '';
        const cloneSvg = this.svgConnectors?.cloneNode(true);
        const cloneCanvas = this.canvas?.cloneNode(true);
        if (cloneSvg) {
            cloneSvg.style.transformOrigin = '0 0';

            // Remove styling that is only relevant in the main canvas
            cloneSvg.querySelectorAll('.connector-path').forEach(p => {
                p.removeAttribute('class');
                p.removeAttribute('stroke');      // ← avoids black line
            });
            this.minimapContent.appendChild(cloneSvg);

            // draw a thin rectangle for every visible node
            this.nodes.forEach(nd => {
                if (nd.element?.style.display !== 'none') {
                    cloneSvg.appendChild(this._addMiniRect(nd.x, nd.y, nd.width, nd.height));
                }
            });
        }
        if (cloneCanvas) {
            cloneCanvas.querySelectorAll('.node-actions').forEach(el => el.remove());
            cloneCanvas.querySelectorAll('.flow-node').forEach(n => n.classList.remove('flow-node'));
            cloneCanvas.style.transformOrigin = '0 0';
            this.minimapContent.appendChild(cloneCanvas);
        }
        const canvasWidth = parseFloat(this.canvas?.style.width || this.canvas?.offsetWidth || 0);
        const canvasHeight = parseFloat(this.canvas?.style.height || this.canvas?.offsetHeight || 0);
        const containerW = this.minimapContainer.clientWidth;
        const containerH = this.minimapContainer.clientHeight;
        if (canvasWidth > 0 && canvasHeight > 0) {
            this.minimapScale = Math.min(containerW / canvasWidth, containerH / canvasHeight);
        }
        const scale = this.minimapScale;
        this.minimapContent.style.transform = `scale(${scale})`;
        this._updateMinimapViewport();
    }

    _updateMinimapViewport() {
        if (this._minimapFrame) return;
        this._minimapFrame = requestAnimationFrame(() => {
            this._minimapFrame = null;
            this._doMinimapViewport();
        });
    }

    _doMinimapViewport() {
        if (!this.minimapViewport || !this.canvas) return;
        const scale = this.minimapScale;
        const vw = (this.mountPoint.clientWidth / this.zoomLevel) * scale;
        const vh = (this.mountPoint.clientHeight / this.zoomLevel) * scale;
        const left = (this.mountPoint.scrollLeft / this.zoomLevel) * scale;
        const top  = (this.mountPoint.scrollTop  / this.zoomLevel) * scale;
        const boundedLeft = Math.max(0, Math.min(this.minimapContainer.clientWidth - vw, left));
        const boundedTop = Math.max(0, Math.min(this.minimapContainer.clientHeight - vh, top));

        this.minimapViewport.style.width = `${vw}px`;
        this.minimapViewport.style.height = `${vh}px`;
        this.minimapViewport.style.left = `${boundedLeft}px`;
        this.minimapViewport.style.top = `${boundedTop}px`;
    }

    _handleMinimapMouseDown = (e) => {
        this.isMinimapDragging = true;
        this.minimapContainer.style.cursor = 'grabbing';
        document.addEventListener('mousemove', this._handleMinimapMouseMove);
        document.addEventListener('mouseup', this._handleMinimapMouseUp);
        this._panToMinimapPoint(e);
    }

    _handleMinimapMouseMove = (e) => {
        if (!this.isMinimapDragging) return;
        this._panToMinimapPoint(e);
    }

    _handleMinimapMouseUp = () => {
        this.isMinimapDragging = false;
        this.minimapContainer.style.cursor = 'pointer';
        document.removeEventListener('mousemove', this._handleMinimapMouseMove);
        document.removeEventListener('mouseup', this._handleMinimapMouseUp);
    }

    /** Double-click recenters the main canvas */
    _handleMinimapDoubleClick = (e) => {
        const rect = this.minimapContainer.getBoundingClientRect();
        const x = (e.clientX - rect.left) / this.minimapScale;
        const y = (e.clientY - rect.top)  / this.minimapScale;
        this._applyScroll(
            (x * this.zoomLevel) - this.mountPoint.clientWidth  / 2,
            (y * this.zoomLevel) - this.mountPoint.clientHeight / 2
        );
        this._updateMinimapViewport();
    };

    _panToMinimapPoint(e) {
        const rect = this.minimapContainer.getBoundingClientRect();
        const x = (e.clientX - rect.left) / this.minimapScale;
        const y = (e.clientY - rect.top) / this.minimapScale;
        this._applyScroll(
            (x * this.zoomLevel) - this.mountPoint.clientWidth  / 2,
            (y * this.zoomLevel) - this.mountPoint.clientHeight / 2
        );
        this._updateMinimapViewport();
    }

    // --- Touch Zoom ---
    _handleTouchStart = (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            this.pinchStartDistance = this._getTouchDistance(e.touches);
        }
    }

    _handleTouchMove = (e) => {
        if (this.pinchStartDistance && e.touches.length === 2) {
            e.preventDefault();
            const newDist = this._getTouchDistance(e.touches);
            const delta = newDist - this.pinchStartDistance;
            if (Math.abs(delta) > 2) {
                this.setZoom(this.zoomLevel + delta / 200);
                this.pinchStartDistance = newDist;
            }
        }
    }

    _handleTouchEnd = (e) => {
        if (e.touches.length < 2) {
            this.pinchStartDistance = null;
        }
    }

    _getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    showMinimap() {
        if (this.minimapContainer) {
            this.minimapContainer.style.display = '';
            this.minimapVisible = true;
            this._updateMinimap();
        }
    }

    hideMinimap() {
        if (this.minimapContainer) {
            this.minimapContainer.style.display = 'none';
            this.minimapVisible = false;
        }
    }

    toggleMinimap() {
        if (this.minimapVisible) {
            this.hideMinimap();
        } else {
            this.showMinimap();
        }
    }

    isMinimapVisible() {
        return this.minimapVisible;
    }
}