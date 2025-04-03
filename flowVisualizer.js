/**
 * flowVisualizer.js
 * Renders the flow as a node-graph and handles basic interaction.
 */
import { escapeHTML, getStepTypeIcon } from './flowStepComponents.js'; // Reuse helpers

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80; // Approximate initial height
const H_SPACING = 80;
const V_SPACING = 60;
const BRANCH_V_SPACING = 40; // Vertical space before branch starts

export class FlowVisualizer {
    constructor(mountPoint, options = {}) {
        this.mountPoint = mountPoint;
        this.options = options; // { onNodeSelect, onNodeMove, onAddStep }
        this.flowModel = null;
        this.selectedNodeId = null;
        this.nodes = []; // Array of { id, x, y, width, height, element }
        this.svgConnectors = null;

        // Simple panning state
        this.isPanning = false;
        this.startX = 0;
        this.startY = 0;
        this.scrollLeftStart = 0;
        this.scrollTopStart = 0;

        this._createBaseStructure();
        this._bindPanningListeners();
    }

    _createBaseStructure() {
        this.mountPoint.innerHTML = `
            <svg class="flow-connector" data-ref="svgConnectors"></svg>
            <div class="visualizer-canvas" data-ref="canvas">
                <!-- Nodes will be added here -->
            </div>
        `;
        this.canvas = this.mountPoint.querySelector('[data-ref="canvas"]');
        this.svgConnectors = this.mountPoint.querySelector('[data-ref="svgConnectors"]');
    }

    clear() {
        this.canvas.innerHTML = '';
        this.svgConnectors.innerHTML = '';
        this.nodes = [];
    }

    render(flowModel, selectedStepId) {
        this.flowModel = flowModel;
        this.selectedNodeId = selectedStepId;
        this.clear();

        if (!this.flowModel || !this.flowModel.steps || this.flowModel.steps.length === 0) {
            this.canvas.innerHTML = '<div class="placeholder-message">No steps to visualize.</div>';
            return;
        }

        // Layout and render nodes recursively
        this._layoutAndRenderSteps(this.flowModel.steps, 50, 50);

        // Adjust canvas size if needed (simple heuristic)
        let maxX = 0, maxY = 0;
        this.nodes.forEach(node => {
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        });
        this.canvas.style.width = `${Math.max(2000, maxX + 100)}px`;
        this.canvas.style.height = `${Math.max(1500, maxY + 100)}px`;
        // Set SVG size to match canvas initially
        this.svgConnectors.setAttribute('viewBox', `0 0 ${this.canvas.style.width.replace('px','')} ${this.canvas.style.height.replace('px','')}`);


        // Render connectors after all nodes are positioned
        this._renderConnectors(this.flowModel.steps);
    }

     _layoutAndRenderSteps(steps, startX, startY, parentNode = null) {
        let currentY = startY;
        let prevNode = parentNode; // Track the previous node at this level for vertical connection

        steps.forEach((step, index) => {
            const nodeData = {
                id: step.id,
                x: startX,
                y: currentY,
                width: NODE_WIDTH,
                height: NODE_HEIGHT, // Will be adjusted after rendering content
                step: step,
                element: null,
                childrenLayout: null // Store layout info for nested structures
            };

            const nodeEl = this._createNodeElement(step);
            nodeData.element = nodeEl;
            this.canvas.appendChild(nodeEl);

            // Initial position before measuring height
            nodeEl.style.left = `${nodeData.x}px`;
            nodeEl.style.top = `${nodeData.y}px`;

            // Measure actual height and update
            nodeData.height = nodeEl.offsetHeight;
            nodeEl.style.height = `${nodeData.height}px`; // Set explicit height? Maybe not needed.

             // Adjust X for conditions/loops to center them visually?
             if (step.type === 'condition' || step.type === 'loop') {
                 // No easy centering without knowing child width yet. Keep simple linear layout for now.
             }


            this.nodes.push(nodeData);

            // Layout nested steps
            if (step.type === 'condition') {
                 const thenStartY = currentY + nodeData.height + BRANCH_V_SPACING;
                 const elseStartX = startX + nodeData.width + H_SPACING; // Place else branch beside then branch

                 // Layout THEN branch, returns its bounding box height
                 const thenLayout = this._layoutAndRenderSteps(step.thenSteps || [], startX, thenStartY, nodeData);
                 // Layout ELSE branch, using same Y start but different X
                 const elseLayout = this._layoutAndRenderSteps(step.elseSteps || [], elseStartX, thenStartY, nodeData);

                 // Store layout info for drawing connectors
                 nodeData.childrenLayout = { then: thenLayout, else: elseLayout };

                 // Advance Y based on the taller branch + spacing
                 currentY += nodeData.height + BRANCH_V_SPACING + Math.max(thenLayout.height, elseLayout.height) + V_SPACING;

            } else if (step.type === 'loop') {
                 const loopBodyStartY = currentY + nodeData.height + BRANCH_V_SPACING;
                 // Layout loop body directly below
                 const loopLayout = this._layoutAndRenderSteps(step.loopSteps || [], startX, loopBodyStartY, nodeData);

                  nodeData.childrenLayout = { loop: loopLayout };

                 // Advance Y
                 currentY += nodeData.height + BRANCH_V_SPACING + loopLayout.height + V_SPACING;

            } else {
                // Simple step, just advance Y
                currentY += nodeData.height + V_SPACING;
            }

            prevNode = nodeData; // Update previous node for next iteration
        });

        // Return bounding box height for this level (for parent layout)
         const totalHeight = currentY - startY - V_SPACING; // Subtract last spacing
         return { height: Math.max(0, totalHeight) }; // Ensure non-negative height
    }

    _createNodeElement(step) {
        const nodeEl = document.createElement('div');
        nodeEl.className = `flow-node type-${step.type}`;
        nodeEl.dataset.stepId = step.id;
        nodeEl.style.position = 'absolute'; // Crucial for positioning

        if (step.id === this.selectedNodeId) {
            nodeEl.classList.add('selected');
        }

        // Basic Content
        nodeEl.innerHTML = `
            <div class="node-header">
                <span class="node-icon">${getStepTypeIcon(step.type)}</span>
                <span class="node-name">${escapeHTML(step.name)}</span>
                 <!-- Optional: Add tiny '+' button for adding steps visually? Needs styling -->
                 <!-- <button class="btn-add-node-step" title="Add step after this">+</button> -->
            </div>
            <div class="node-content">
                ${this._getNodeContent(step)}
            </div>
             <!-- Placeholder for ports -->
             <div class="node-port output"></div>
             ${step.type === 'condition' ? '<div class="node-port branch-then"></div><div class="node-port branch-else"></div>' : ''}
             ${step.type === 'loop' ? '<div class="node-port loop-body"></div>' : ''}

        `;

        // Add listeners
        nodeEl.addEventListener('click', (e) => {
            if (!e.target.closest('button')) { // Ignore clicks on potential action buttons within node
                 if (this.options.onNodeSelect) {
                    this.options.onNodeSelect(step.id);
                }
            }
        });

        // Drag and Drop
        this._setupNodeDrag(nodeEl);

        return nodeEl;
    }

     _getNodeContent(step) {
        // Generate simplified content preview for the node
        switch (step.type) {
            case 'request':
                 const urlPreview = (step.url || '').length > 30 ? step.url.substring(0, 27) + '...' : step.url;
                 return `<span class="request-method ${step.method || 'GET'}">${step.method || 'GET'}</span> <code class="request-url">${escapeHTML(urlPreview)}</code>`;
            case 'condition':
                 let conditionPreview = 'No condition';
                  if (step.conditionData?.variable && step.conditionData?.operator) {
                     conditionPreview = generateConditionPreview(step.conditionData); // from flowCore? Need import. Assuming it's available via flowStepComponents
                 } else if (step.condition) {
                      conditionPreview = step.condition;
                 }
                 if (conditionPreview.length > 40) conditionPreview = conditionPreview.substring(0, 37) + '...';
                 return `If: <code class="condition-code">${escapeHTML(conditionPreview)}</code>`;
            case 'loop':
                 const sourcePreview = (step.source || '').length > 20 ? step.source.substring(0, 17) + '...' : step.source;
                 return `For each <code class="loop-variable">${escapeHTML(step.loopVariable || 'item')}</code> in <code class="loop-source">${escapeHTML(sourcePreview)}</code>`;
            default:
                return `Type: ${escapeHTML(step.type)}`;
        }
    }

    // --- Connectors ---

    _renderConnectors(steps, parentNodeData = null) {
        let prevNodeData = parentNodeData;

        steps.forEach((step, index) => {
             const currentNodeData = this.nodes.find(n => n.id === step.id);
             if (!currentNodeData) return;

             // Connect from previous step/parent output to current input
             if (prevNodeData) {
                 let startPort = 'output'; // Default output port
                 // Adjust start port if coming from a branch/loop of parent
                 if (parentNodeData && prevNodeData === parentNodeData) { // First step in a branch/loop
                     if (parentNodeData.step.type === 'condition') {
                         // Determine if this 'step' is in the 'then' or 'else' branch
                         const isInThen = parentNodeData.step.thenSteps?.some(s => s.id === step.id);
                         startPort = isInThen ? 'branch-then' : 'branch-else';
                     } else if (parentNodeData.step.type === 'loop') {
                         startPort = 'loop-body';
                     }
                 }
                 this._drawConnector(prevNodeData, currentNodeData, startPort, 'input');
             }


             // Recursively draw connectors for children
             if (step.type === 'condition') {
                 this._renderConnectors(step.thenSteps || [], currentNodeData);
                 this._renderConnectors(step.elseSteps || [], currentNodeData);
             } else if (step.type === 'loop') {
                 this._renderConnectors(step.loopSteps || [], currentNodeData);
             }

             prevNodeData = currentNodeData; // Update previous node for the next step at this level
        });
    }

     _getPortPosition(nodeData, portType) {
         const x = nodeData.x;
         const y = nodeData.y;
         const w = nodeData.width;
         const h = nodeData.height;
         // Approximation based on CSS port positioning
         switch (portType) {
             case 'input': return { x: x, y: y + h / 2 };
             case 'output': return { x: x + w, y: y + h / 2 };
             case 'branch-then': return { x: x + w * 0.33, y: y + h };
             case 'branch-else': return { x: x + w * 0.66, y: y + h };
             case 'loop-body': return { x: x + w / 2, y: y + h };
             default: return { x: x + w / 2, y: y + h / 2 }; // Default center
         }
     }

    _drawConnector(startNode, endNode, startPortType, endPortType) {
        const startPos = this._getPortPosition(startNode, startPortType);
        const endPos = this._getPortPosition(endNode, endPortType);

        // Basic straight line for simplicity - Needs improvement for curves/routing
        // Using SVG path 'd' attribute: M = moveto, L = lineto
        // Adding intermediate points for a slightly better look (vertical down, horizontal across, vertical down)
         const midY = startPos.y + (endPos.y - startPos.y) / 2;
         const pathData = `M ${startPos.x} ${startPos.y} L ${startPos.x} ${midY} L ${endPos.x} ${midY} L ${endPos.x} ${endPos.y}`;
         // Alternative: Simple Bezier curve (Q)
         // const controlX = startPos.x + 50; // Adjust control point
         // const controlY = startPos.y;
         // const endControlX = endPos.x - 50;
         // const endControlY = endPos.y;
         // const pathData = `M ${startPos.x} ${startPos.y} C ${controlX} ${controlY}, ${endControlX} ${endControlY}, ${endPos.x} ${endPos.y}`; // Cubic Bezier


        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('class', 'connector-path');
        path.dataset.from = startNode.id;
        path.dataset.to = endNode.id;

         // Add Arrowhead
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', `arrow-${startNode.id}-${endNode.id}`);
        marker.setAttribute('viewBox', '0 -5 10 10');
        marker.setAttribute('refX', '5');
        marker.setAttribute('refY', '0');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto');
        marker.innerHTML = '<path d="M0,-5L10,0L0,5" class="connector-arrowhead"></path>';

         // Ensure defs exist
         let defs = this.svgConnectors.querySelector('defs');
         if (!defs) {
             defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
             this.svgConnectors.appendChild(defs);
         }
         defs.appendChild(marker);

        path.setAttribute('marker-end', `url(#arrow-${startNode.id}-${endNode.id})`);

        this.svgConnectors.appendChild(path);
    }


    // --- Drag and Drop ---
    _setupNodeDrag(nodeEl) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;
        let placeholderEl = null; // Placeholder for drop position

        const handleMouseDown = (e) => {
            // Only drag with left mouse button and if target is the node itself or header (not buttons/content)
             if (e.button !== 0 || e.target.closest('button') || e.target.closest('.node-content')) {
                 return;
             }

            isDragging = true;
            nodeEl.classList.add('dragging');
            document.body.classList.add('flow-step-dragging'); // Use consistent global class

            const rect = nodeEl.getBoundingClientRect();
             // Calculate offset relative to the node's top-left corner
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            // Prevent panning while dragging node
             this.isPanning = false;
             this.mountPoint.style.cursor = 'grabbing';

             // Create visual placeholder for potential drop spots (simple rect for now)
             placeholderEl = document.createElement('div');
             placeholderEl.className = 'drag-placeholder';
             placeholderEl.style.width = `${nodeEl.offsetWidth}px`;
             placeholderEl.style.height = `${nodeEl.offsetHeight}px`;
             placeholderEl.style.display = 'none'; // Hidden initially
             this.canvas.appendChild(placeholderEl);


            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            e.preventDefault(); // Prevent text selection, etc.
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;

             // Calculate new position based on mouse movement and initial offset
             // Account for the mount point's scroll position
             const mountRect = this.mountPoint.getBoundingClientRect();
             let newX = e.clientX - mountRect.left + this.mountPoint.scrollLeft - offsetX;
             let newY = e.clientY - mountRect.top + this.mountPoint.scrollTop - offsetY;

             // Clamp position within canvas bounds (optional)
             newX = Math.max(0, Math.min(newX, this.canvas.offsetWidth - nodeEl.offsetWidth));
             newY = Math.max(0, Math.min(newY, this.canvas.offsetHeight - nodeEl.offsetHeight));

            nodeEl.style.left = `${newX}px`;
            nodeEl.style.top = `${newY}px`;

             // --- Drop Target Detection (Simplified) ---
             placeholderEl.style.display = 'none'; // Hide placeholder by default
             let closestNode = null;
             let closestDistance = Infinity;
             let dropPosition = 'after'; // 'before' or 'after' target

             this.nodes.forEach(node => {
                 if (node.element === nodeEl) return; // Skip self

                 const targetRect = node.element.getBoundingClientRect();
                 const dist = Math.sqrt(Math.pow(e.clientX - (targetRect.left + targetRect.width / 2), 2) + Math.pow(e.clientY - (targetRect.top + targetRect.height / 2), 2));

                  // Simple proximity check + vertical position check
                 if (dist < closestDistance && dist < 150) { // Check within a radius
                      closestNode = node;
                      closestDistance = dist;
                      // Determine before/after based on vertical position relative to target's midpoint
                      dropPosition = e.clientY < (targetRect.top + targetRect.height / 2) ? 'before' : 'after';
                 }
             });

             // Show placeholder near the potential target
             if (closestNode) {
                  placeholderEl.style.display = 'block';
                  let placeholderY;
                  if (dropPosition === 'before') {
                       placeholderY = closestNode.y - V_SPACING / 2 - nodeEl.offsetHeight / 2; // Approximate position
                  } else {
                       placeholderY = closestNode.y + closestNode.height + V_SPACING / 2 - nodeEl.offsetHeight / 2;
                  }
                   // Position placeholder horizontally aligned with target for now
                  placeholderEl.style.left = `${closestNode.x}px`;
                  placeholderEl.style.top = `${Math.max(0, placeholderY)}px`; // Ensure not negative
             }
        };

        const handleMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            nodeEl.classList.remove('dragging');
            document.body.classList.remove('flow-step-dragging');
            this.mountPoint.style.cursor = 'grab'; // Reset cursor

             let dropTargetNode = null;
             let dropPosition = 'after';

             // Determine drop target based on placeholder visibility/position
             if (placeholderEl && placeholderEl.style.display !== 'none') {
                  // Find the node the placeholder was positioned relative to (needs better tracking)
                  // For now, re-run closest node logic
                  let closestNode = null;
                  let closestDistance = Infinity;
                  this.nodes.forEach(node => {
                      if (node.element === nodeEl) return;
                      const targetRect = node.element.getBoundingClientRect();
                      const dist = Math.sqrt(Math.pow(e.clientX - (targetRect.left + targetRect.width / 2), 2) + Math.pow(e.clientY - (targetRect.top + targetRect.height / 2), 2));
                      if (dist < closestDistance && dist < 150) {
                           closestNode = node;
                           closestDistance = dist;
                           dropPosition = e.clientY < (targetRect.top + targetRect.height / 2) ? 'before' : 'after';
                      }
                  });
                 dropTargetNode = closestNode;
             }


            // If dropped on a valid target, notify the parent
            if (dropTargetNode && this.options.onNodeMove) {
                const sourceId = nodeEl.dataset.stepId;
                const targetId = dropTargetNode.id;
                this.options.onNodeMove(sourceId, targetId, dropPosition);
                // The parent (app.js) will handle the model update and trigger a re-render.
                // Visual update happens on re-render.
            } else {
                // Snap back animation? For now, just let the re-render handle it if no move occurred.
                // If no valid drop, we might need to manually revert the position before re-render?
                 const originalNodeData = this.nodes.find(n => n.id === nodeEl.dataset.stepId);
                 if (originalNodeData) {
                     nodeEl.style.left = `${originalNodeData.x}px`;
                     nodeEl.style.top = `${originalNodeData.y}px`;
                 }
            }

            // Clean up placeholder
            if (placeholderEl) {
                placeholderEl.remove();
                placeholderEl = null;
            }

            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        nodeEl.addEventListener('mousedown', handleMouseDown);
    }

    // --- Panning ---
     _bindPanningListeners() {
        this.mountPoint.addEventListener('mousedown', (e) => {
            // Only pan with left button if not clicking on a node or button
             if (e.button !== 0 || e.target.closest('.flow-node') || e.target.closest('button')) {
                 this.isPanning = false;
                 return;
             }
            this.isPanning = true;
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.scrollLeftStart = this.mountPoint.scrollLeft;
            this.scrollTopStart = this.mountPoint.scrollTop;
            this.mountPoint.style.cursor = 'grabbing';
            this.mountPoint.style.userSelect = 'none'; // Prevent text selection during pan
            // Add mousemove/mouseup listeners to the document to capture events outside the mount point
            document.addEventListener('mousemove', this._handlePanMove);
            document.addEventListener('mouseup', this._handlePanEnd);
            e.preventDefault(); // Prevent default drag behavior
        });
    }

     // Use arrow functions for handlers bound to document to maintain 'this' context
    _handlePanMove = (e) => {
        if (!this.isPanning) return;
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        this.mountPoint.scrollLeft = this.scrollLeftStart - dx;
        this.mountPoint.scrollTop = this.scrollTopStart - dy;
    }

    _handlePanEnd = (e) => {
        if (!this.isPanning) return;
        this.isPanning = false;
        this.mountPoint.style.cursor = 'grab'; // Reset cursor
        this.mountPoint.style.userSelect = ''; // Re-enable text selection
        // Remove document listeners
        document.removeEventListener('mousemove', this._handlePanMove);
        document.removeEventListener('mouseup', this._handlePanEnd);
    }


    // --- Highlighting ---
    highlightNode(stepId, highlightClass = 'active-step') { // 'active-step', 'success', 'error' etc.
        this.clearHighlights(); // Clear previous highlights first
        const node = this.nodes.find(n => n.id === stepId);
        if (node && node.element) {
            node.element.classList.add(highlightClass);
            // Scroll node into view if needed
            node.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

             // Highlight incoming connector
             const connector = this.svgConnectors.querySelector(`.connector-path[data-to="${stepId}"]`);
             if (connector) {
                 connector.classList.add('active-connector'); // Apply animation/style
             }
        }
    }

    clearHighlights() {
         this.nodes.forEach(node => {
             if (node.element) {
                 node.element.classList.remove('active-step', 'success', 'error', 'stopped'); // Remove known highlight classes
             }
         });
         this.svgConnectors.querySelectorAll('.connector-path.active-connector').forEach(p => {
             p.classList.remove('active-connector');
         });
    }
}