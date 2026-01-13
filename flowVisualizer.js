// ========== FILE: flowVisualizer.js (Drawflow adapter) ==========
/**
 * flowVisualizer.js
 * Renders the flow as a Drawflow-based node-graph with minimap support.
 */
import { escapeHTML, generateConditionPreview, findDefinedVariables } from './flowCore.js';
import { getStepTypeIcon, createStepEditor } from './flowStepComponents.js';
import { logger } from './logger.js';
import { appState } from './state.js';

// --- Constants for Layout ---
const NODE_WIDTH = 260;
const NODE_MIN_HEIGHT = 160;
const H_SPACING = 100;
const V_SPACING = 60;
const BRANCH_V_SPACING = 40;
const CANVAS_PADDING = 100;
const MINIMAP_PADDING = 16;

const CONNECTOR_ACTIVE_CLASS = 'active-connector';

const OUTPUT_ROLE_INDEX = {
    main: 1,
    then: 2,
    else: 3,
    loop: 2,
};

const ROLE_COLORS = {
    main: '#64748b',
    then: '#10b981',
    else: '#ef4444',
    loop: '#6366f1',
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class FlowVisualizer {
    constructor(mountPoint, options = {}) {
        if (!mountPoint) {
            throw new Error('FlowVisualizer requires a valid mount point element.');
        }
        this.mountPoint = mountPoint;
        this.options = options;
        this.flowModel = null;
        this.selectedNodeId = null;

        this.nodes = new Map();
        this.nodeIdByStepId = new Map();
        this.stepIdByNodeId = new Map();
        this.connections = [];
        this.collapsedNodes = new Set();
        this.hiddenNodeIds = new Set();

        this.editor = null;
        this.isRendering = false;

        this.zoomLevel = 1;
        this.minZoom = 0.5;
        this.maxZoom = 2;

        this.minimapContainer = null;
        this.minimapCanvas = null;
        this.minimapViewport = null;
        this.minimapScale = 1;
        this.minimapBounds = null;
        this.minimapVisible = false;
        this.isMinimapDragging = false;
        this._minimapNeedsRefresh = false;
        this._minimapFrame = null;
        this.isCanvasPanning = false;
        this.canvasPanStart = null;

        this.nodeEditorModal = null;
        this.nodeEditorDialog = null;
        this.nodeEditorTitle = null;
        this.nodeEditorMeta = null;
        this.nodeEditorBody = null;
        this.nodeEditorCloseBtn = null;
        this.nodeEditorAddBtn = null;
        this.nodeEditorDirty = false;
        this.activeEditorStepId = null;

        this._createBaseStructure();
        this._initializeEditor();
        this._bindMinimapListeners();
    }

    _createBaseStructure() {
        this.mountPoint.innerHTML = '';
        this.mountPoint.style.position = 'relative';

        this.placeholder = document.createElement('div');
        this.placeholder.className = 'placeholder-message';
        this.placeholder.style.position = 'absolute';
        this.placeholder.style.top = '50px';
        this.placeholder.style.left = '50px';
        this.placeholder.style.zIndex = '2';
        this.placeholder.style.pointerEvents = 'none';
        this.placeholder.style.display = 'none';
        this.placeholder.textContent = 'No steps to visualize.';
        this.mountPoint.appendChild(this.placeholder);

        this.minimapContainer = document.createElement('div');
        this.minimapContainer.className = 'visualizer-minimap';
        this.minimapContainer.style.display = 'none';

        this.minimapCanvas = document.createElement('canvas');
        this.minimapCanvas.className = 'minimap-canvas';
        this.minimapContainer.appendChild(this.minimapCanvas);

        this.minimapViewport = document.createElement('div');
        this.minimapViewport.className = 'minimap-viewport';
        this.minimapViewport.style.position = 'absolute';
        this.minimapViewport.style.pointerEvents = 'none';
        this.minimapContainer.appendChild(this.minimapViewport);

        this.mountPoint.appendChild(this.minimapContainer);

        this.nodeEditorModal = document.createElement('div');
        this.nodeEditorModal.className = 'node-editor-modal';
        this.nodeEditorModal.style.display = 'none';
        this.nodeEditorModal.setAttribute('aria-hidden', 'true');
        this.nodeEditorModal.innerHTML = `
            <div class="node-editor-dialog" role="dialog" aria-modal="true">
                <div class="node-editor-header">
                    <div class="node-editor-title"></div>
                    <div class="node-editor-header-actions">
                        <button class="btn btn-sm btn-secondary node-editor-add" type="button">+ Add Step</button>
                        <button class="btn btn-sm btn-secondary node-editor-close" type="button">Close</button>
                    </div>
                </div>
                <div class="node-editor-meta"></div>
                <div class="node-editor-body"></div>
            </div>
        `;
        document.body.appendChild(this.nodeEditorModal);

        this.nodeEditorDialog = this.nodeEditorModal.querySelector('.node-editor-dialog');
        this.nodeEditorTitle = this.nodeEditorModal.querySelector('.node-editor-title');
        this.nodeEditorMeta = this.nodeEditorModal.querySelector('.node-editor-meta');
        this.nodeEditorBody = this.nodeEditorModal.querySelector('.node-editor-body');
        this.nodeEditorCloseBtn = this.nodeEditorModal.querySelector('.node-editor-close');
        this.nodeEditorAddBtn = this.nodeEditorModal.querySelector('.node-editor-add');

        this.nodeEditorModal.addEventListener('click', (event) => {
            if (event.target === this.nodeEditorModal) {
                this._closeNodeEditor();
            }
        });
        this.nodeEditorCloseBtn?.addEventListener('click', () => this._closeNodeEditor());
    }

    _initializeEditor() {
        const DrawflowClass = globalThis.Drawflow;
        if (!DrawflowClass) {
            throw new Error('Drawflow library not loaded.');
        }

        this.editor = new DrawflowClass(this.mountPoint);
        this.editor.zoom_min = this.minZoom;
        this.editor.zoom_max = this.maxZoom;
        this.editor.zoom_value = 0.1;
        this.editor.editor_mode = 'edit';
        this.editor.start();

        this.editor.precanvas.classList.add('visualizer-canvas');
        this.editor.precanvas.style.transformOrigin = '0 0';

        this.editor.on('nodeSelected', (id) => {
            if (this.isRendering) return;
            const stepId = this.stepIdByNodeId.get(String(id));
            if (stepId) this.options.onNodeSelect?.(stepId);
        });

        this.editor.on('nodeMoved', (id) => {
            if (this.isRendering) return;
            const stepId = this.stepIdByNodeId.get(String(id));
            if (!stepId) return;
            const node = this.editor.getNodeFromId(id);
            if (!node) return;
            const nodeEl = this.editor.container.querySelector(`#node-${id}`);
            const rawLeft = nodeEl?.style?.left;
            const rawTop = nodeEl?.style?.top;
            const nodePosX = Number(node.pos_x);
            const nodePosY = Number(node.pos_y);
            const posX = Number.isFinite(parseFloat(rawLeft))
                ? parseFloat(rawLeft)
                : (Number.isFinite(nodePosX) ? nodePosX : (nodeEl ? nodeEl.offsetLeft : 0));
            const posY = Number.isFinite(parseFloat(rawTop))
                ? parseFloat(rawTop)
                : (Number.isFinite(nodePosY) ? nodePosY : (nodeEl ? nodeEl.offsetTop : 0));
            if (!Number.isFinite(posX) || !Number.isFinite(posY)) return;
            const nodeData = this.nodes.get(stepId);
            if (nodeData) {
                nodeData.x = posX;
                nodeData.y = posY;
            }
            this.options.onNodeLayoutUpdate?.(stepId, posX, posY);
            this._scheduleMinimapRefresh();
        });

        this.editor.on('connectionCreated', (info) => {
            if (this.isRendering) return;
            this._handleConnectionCreated(info);
        });

        this.editor.on('connectionRemoved', (info) => {
            if (this.isRendering) return;
            this._handleConnectionRemoved(info);
        });

        this.editor.on('zoom', (zoom) => {
            this.zoomLevel = zoom;
            this._updateMinimapViewport();
        });

        this.editor.on('translate', () => {
            this._updateMinimapViewport();
        });

        this.mountPoint.addEventListener('mousedown', this._handleCanvasPanStart, true);
        this.mountPoint.addEventListener('keydown', this._handleKeydown, true);
        this.mountPoint.addEventListener('contextmenu', this._handleContextMenu, true);
    }

    _handleKeydown = (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
        }
        if (event.key === 'Escape' && this.nodeEditorModal?.style.display === 'flex') {
            event.preventDefault();
            event.stopPropagation();
            this._closeNodeEditor();
        }
    };

    _handleContextMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const deleteUi = this.editor?.precanvas?.querySelector('.drawflow-delete');
        deleteUi?.remove();
    };

    _resetEditorDragState() {
        if (!this.editor) return;
        this.editor.drag = false;
        this.editor.connection = false;
        this.editor.drag_point = false;
        this.editor.editor_selected = false;
        this.editor.ele_selected = null;
    }

    _setNodeEditorDirty(dirty) {
        if (this.nodeEditorDirty === dirty) return;
        this.nodeEditorDirty = dirty;
        this.options.onEditorDirtyChange?.(dirty);
    }

    _getNodeContext(stepId) {
        const incoming = [];
        const outgoing = [];

        this.connections.forEach((conn) => {
            if (conn.to === stepId) {
                const step = this.nodes.get(conn.from)?.step;
                incoming.push({
                    id: conn.from,
                    name: step?.name || 'Unknown',
                    role: conn.role,
                });
            }
            if (conn.from === stepId) {
                const step = this.nodes.get(conn.to)?.step;
                outgoing.push({
                    id: conn.to,
                    name: step?.name || 'Unknown',
                    role: conn.role,
                });
            }
        });

        return { incoming, outgoing };
    }

    _renderNodeContext(stepId) {
        if (!this.nodeEditorMeta) return;
        const context = this._getNodeContext(stepId);
        const roleLabel = (role, direction) => {
            if (role === 'then') return 'Then';
            if (role === 'else') return 'Else';
            if (role === 'loop') return 'Loop';
            return direction === 'incoming' ? 'Prev' : 'Next';
        };

        const renderList = (items, emptyLabel, direction) => {
            if (!items.length) {
                return `<span class="node-editor-empty">${emptyLabel}</span>`;
            }
            return items.map((item) => `
                <span class="node-editor-chip">
                    <span class="node-editor-chip-role">${roleLabel(item.role, direction)}:</span>
                    <span class="node-editor-chip-name">${escapeHTML(item.name)}</span>
                </span>
            `).join('');
        };

        this.nodeEditorMeta.innerHTML = `
            <div class="node-editor-meta-row">
                <span class="node-editor-meta-label">Previous</span>
                <div class="node-editor-chip-list">
                    ${renderList(context.incoming, 'None', 'incoming')}
                </div>
            </div>
            <div class="node-editor-meta-row">
                <span class="node-editor-meta-label">Next</span>
                <div class="node-editor-chip-list">
                    ${renderList(context.outgoing, 'None', 'outgoing')}
                </div>
            </div>
        `;
    }

    _openNodeEditor(stepId) {
        if (!this.nodeEditorModal || !this.flowModel) return;
        const step = this._findStepById(this.flowModel.steps, stepId);
        if (!step) return;

        this.activeEditorStepId = stepId;
        this.nodeEditorTitle.textContent = step.name ? `Edit: ${step.name}` : 'Edit Step';
        this._renderNodeContext(stepId);
        this.nodeEditorBody.innerHTML = '';

        const variables = findDefinedVariables(this.flowModel);
        const editor = createStepEditor(step, {
            variables,
            onChange: (updatedStep) => {
                this.options.onStepEdit?.(updatedStep);
                this._setNodeEditorDirty(false);
                this.activeEditorStepId = updatedStep?.id || stepId;
                this._renderNodeContext(this.activeEditorStepId);
            },
            onDirtyChange: (dirty) => {
                this._setNodeEditorDirty(dirty);
            },
            flowHeaders: this.flowModel.headers || {},
            flowVars: this.flowModel.staticVars || {},
            runtimeContext: () => appState.lastRuntimeContext,
        });

        this.nodeEditorBody.appendChild(editor);
        if (this.nodeEditorAddBtn) {
            this.nodeEditorAddBtn.onclick = () => {
                if (!this.activeEditorStepId) return;
                this.options.onRequestAddStepAfter?.(this.activeEditorStepId, {
                    onAdded: () => {
                        if (this.activeEditorStepId) {
                            this._renderNodeContext(this.activeEditorStepId);
                        }
                    },
                });
            };
        }

        this._setNodeEditorDirty(false);
        this.nodeEditorModal.style.display = 'flex';
        this.nodeEditorModal.setAttribute('aria-hidden', 'false');
    }

    _closeNodeEditor(force = false) {
        if (!this.nodeEditorModal) return;
        if (this.nodeEditorDirty && !force) {
            const shouldClose = confirm('You have unsaved changes. Close the editor and discard them?');
            if (!shouldClose) return;
        }

        this.nodeEditorBody.innerHTML = '';
        this.nodeEditorModal.style.display = 'none';
        this.nodeEditorModal.setAttribute('aria-hidden', 'true');
        this.activeEditorStepId = null;
        this._setNodeEditorDirty(false);
    }

    _shouldStartCanvasPan(event) {
        if (!event || event.button !== 0) return false;
        if (!this.editor || !this.editor.precanvas) return false;

        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;
        if (target.classList.contains('drawflow')) return false;
        if (target.closest('.visualizer-minimap')) return false;
        if (target.closest('.drawflow-node')) return false;
        if (target.closest('.input') || target.closest('.output')) return false;
        if (target.closest('.connection') || target.closest('.main-path')) return false;
        if (target.closest('.drawflow-delete')) return false;
        if (target.closest('button, input, select, textarea')) return false;

        return true;
    }

    _handleCanvasPanStart = (event) => {
        if (!this._shouldStartCanvasPan(event)) return;
        event.preventDefault();
        event.stopPropagation();

        this._resetEditorDragState();
        if (this.editor?.node_selected) {
            this.editor.node_selected.classList.remove('selected');
            this.editor.node_selected = null;
            this.editor.dispatch?.('nodeUnselected', true);
        }
        if (this.editor?.connection_selected) {
            this.editor.connection_selected.classList.remove('selected');
            this.editor.removeReouteConnectionSelected?.();
            this.editor.connection_selected = null;
            this.editor.dispatch?.('connectionUnselected', true);
        }
        this.isCanvasPanning = true;
        this.canvasPanStart = {
            x: event.clientX,
            y: event.clientY,
            canvasX: this.editor?.canvas_x || 0,
            canvasY: this.editor?.canvas_y || 0,
        };
        this.mountPoint.classList.add('is-panning');
        document.addEventListener('mousemove', this._handleCanvasPanMove);
        document.addEventListener('mouseup', this._handleCanvasPanEnd);
    };

    _handleCanvasPanMove = (event) => {
        if (!this.isCanvasPanning || !this.canvasPanStart || !this.editor?.precanvas) return;
        const zoom = this.editor.zoom || 1;
        const translateX = this.canvasPanStart.canvasX + (event.clientX - this.canvasPanStart.x);
        const translateY = this.canvasPanStart.canvasY + (event.clientY - this.canvasPanStart.y);

        this.editor.canvas_x = translateX;
        this.editor.canvas_y = translateY;
        this.editor.precanvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoom})`;
        this.editor.dispatch?.('translate', { x: translateX, y: translateY });
        this._updateMinimapViewport();
    };

    _handleCanvasPanEnd = () => {
        if (!this.isCanvasPanning) return;
        this.isCanvasPanning = false;
        this.canvasPanStart = null;
        this.mountPoint.classList.remove('is-panning');
        document.removeEventListener('mousemove', this._handleCanvasPanMove);
        document.removeEventListener('mouseup', this._handleCanvasPanEnd);
    };

    _bindMinimapListeners() {
        if (!this.minimapContainer) return;
        this.minimapContainer.addEventListener('mousedown', this._handleMinimapMouseDown);
        this.minimapContainer.addEventListener('dblclick', this._handleMinimapDoubleClick);
    }

    _handleMinimapMouseDown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._resetEditorDragState();
        this.isMinimapDragging = true;
        this.minimapContainer.style.cursor = 'grabbing';
        document.addEventListener('mousemove', this._handleMinimapMouseMove);
        document.addEventListener('mouseup', this._handleMinimapMouseUp);
        this._panToMinimapPoint(event);
    };

    _handleMinimapMouseMove = (event) => {
        event.preventDefault();
        if (!this.isMinimapDragging) return;
        this._panToMinimapPoint(event);
    };

    _handleMinimapMouseUp = () => {
        this.isMinimapDragging = false;
        this.minimapContainer.style.cursor = 'pointer';
        document.removeEventListener('mousemove', this._handleMinimapMouseMove);
        document.removeEventListener('mouseup', this._handleMinimapMouseUp);
    };

    _handleMinimapDoubleClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._resetEditorDragState();
        this._panToMinimapPoint(event);
    };

    _scheduleMinimapRefresh = () => {
        if (this._minimapNeedsRefresh) return;
        this._minimapNeedsRefresh = true;
        requestAnimationFrame(() => {
            this._minimapNeedsRefresh = false;
            this._updateMinimap();
        });
    };

    render(flowModel, selectedStepId) {
        this.flowModel = flowModel;
        this.selectedNodeId = selectedStepId;
        this.nodes.clear();
        this.nodeIdByStepId.clear();
        this.stepIdByNodeId.clear();
        this.connections = [];
        this.collapsedNodes.clear();
        this.hiddenNodeIds.clear();

        this.isRendering = true;
        this.editor.clear();
        this.editor.nodeId = 1;

        if (!this.flowModel || !this.flowModel.steps || this.flowModel.steps.length === 0) {
            this.placeholder.style.display = 'block';
            this.isRendering = false;
            this._scheduleMinimapRefresh();
            return;
        }

        this.placeholder.style.display = 'none';

        this._layoutSteps(this.flowModel.steps, CANVAS_PADDING, CANVAS_PADDING);
        this._applySavedLayout();

        this.nodes.forEach((nodeData) => {
            this._addNode(nodeData);
        });

        this._renderConnections();
        this._applyCollapsedVisibility();
        this._applySelection();

        this.isRendering = false;
        this._scheduleMinimapRefresh();
    }

    getAutoLayout() {
        if (!this.flowModel || !this.flowModel.steps || this.flowModel.steps.length === 0) {
            return {};
        }

        const previousNodes = this.nodes;
        const previousCollapsed = this.collapsedNodes;
        const previousHidden = this.hiddenNodeIds;

        const tempNodes = new Map();
        const tempCollapsed = new Set();
        const tempHidden = new Set();

        this.nodes = tempNodes;
        this.collapsedNodes = tempCollapsed;
        this.hiddenNodeIds = tempHidden;

        try {
            this._layoutSteps(this.flowModel.steps, CANVAS_PADDING, CANVAS_PADDING);
            const layout = {};
            tempNodes.forEach((nodeData) => {
                layout[nodeData.id] = {
                    x: nodeData.x,
                    y: nodeData.y,
                    collapsed: !!nodeData.collapsed
                };
            });
            return layout;
        } finally {
            this.nodes = previousNodes;
            this.collapsedNodes = previousCollapsed;
            this.hiddenNodeIds = previousHidden;
        }
    }

    _addNode(nodeData) {
        const step = nodeData.step;
        const { inputs, outputs } = this._getPortCounts(step.type);
        const nodeClass = `flow-node type-${step.type}`;
        const nodeHtml = this._getNodeHtml(step, nodeData.collapsed);

        const drawflowId = this.editor.addNode(
            step.type,
            inputs,
            outputs,
            nodeData.x,
            nodeData.y,
            nodeClass,
            { stepId: nodeData.id },
            nodeHtml
        );

        const nodeEl = this.editor.container.querySelector(`#node-${drawflowId}`);
        if (!nodeEl) return;

        nodeEl.dataset.stepId = nodeData.id;
        nodeEl.style.width = `${NODE_WIDTH}px`;
        nodeEl.style.minHeight = `${NODE_MIN_HEIGHT}px`;

        nodeData.drawflowId = String(drawflowId);
        nodeData.element = nodeEl;

        this.nodeIdByStepId.set(nodeData.id, String(drawflowId));
        this.stepIdByNodeId.set(String(drawflowId), nodeData.id);

        this._decorateNodeElement(nodeEl, nodeData);
    }

    _decorateNodeElement(nodeEl, nodeData) {
        const step = nodeData.step;
        const deleteBtn = nodeEl.querySelector('.btn-delete-node');
        if (deleteBtn) {
            deleteBtn.addEventListener('mousedown', (event) => {
                event.stopPropagation();
                event.preventDefault();
            });
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.options.onDeleteStep?.(step.id);
            });
        }

        const toggleBtn = nodeEl.querySelector('.node-collapse-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('mousedown', (event) => {
                event.stopPropagation();
                event.preventDefault();
            });
            toggleBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const wasCollapsed = this.collapsedNodes.has(step.id);
                if (wasCollapsed) this.collapsedNodes.delete(step.id);
                else this.collapsedNodes.add(step.id);

                nodeData.collapsed = !wasCollapsed;
                toggleBtn.textContent = nodeData.collapsed ? 'v' : '^';
                nodeEl.classList.toggle('collapsed', nodeData.collapsed);

                this.options.onNodeLayoutUpdate?.(step.id, nodeData.x, nodeData.y, { collapsed: nodeData.collapsed });
                this.render(this.flowModel, this.selectedNodeId);
            });
        }

        const outputs = Array.from(nodeEl.querySelectorAll('.output'));
        outputs.forEach((output, index) => {
            output.dataset.portIndex = String(index + 1);
        });

        nodeEl.classList.toggle('collapsed', nodeData.collapsed);

        nodeEl.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._openNodeEditor(step.id);
        });
    }

    _getNodeHtml(step, collapsed) {
        const hasCollapse = step.type === 'condition' || step.type === 'loop';
        const name = escapeHTML(step.name || '');
        const collapseButton = hasCollapse
            ? `<button class="btn-node-action btn-toggle-collapse node-collapse-toggle" title="Toggle Collapse">${collapsed ? 'v' : '^'}</button>`
            : '';

        return `
            <div class="flow-node-inner">
                <div class="node-header${collapsed ? ' collapsed' : ''}">
                    <span class="node-icon">${getStepTypeIcon(step.type)}</span>
                    <span class="node-name">${name}</span>
                    <div class="node-actions">
                        ${collapseButton}${step.actions || ''}
                        <button class="btn-node-action btn-delete-node" title="Delete step">x</button>
                    </div>
                </div>
                <div class="node-content">
                    ${this._getNodeContentHTML(step)}
                    <div class="node-runtime-details"></div>
                </div>
            </div>
        `;
    }

    _getNodeContentHTML(step) {
        try {
            switch (step.type) {
                case 'request': {
                    const urlPreview = (step.url || '').length > 30 ? step.url.substring(0, 27) + '...' : step.url;
                    return `<span class="request-method ${step.method || 'GET'}">${step.method || 'GET'}</span> <code class="request-url" title="${escapeHTML(step.url)}">${escapeHTML(urlPreview)}</code>`;
                }
                case 'condition': {
                    let conditionPreview = 'No condition set';
                    if (step.conditionData?.variable && step.conditionData?.operator) {
                        conditionPreview = generateConditionPreview(step.conditionData);
                    } else if (step.condition) {
                        conditionPreview = `Legacy: ${escapeHTML(step.condition)}`;
                    }
                    if (conditionPreview.length > 40) conditionPreview = conditionPreview.substring(0, 37) + '...';
                    return `If: <code class="condition-code" title="${escapeHTML(generateConditionPreview(step.conditionData) || step.condition || '')}">${escapeHTML(conditionPreview)}</code>`;
                }
                case 'loop': {
                    const sourcePreview = !step.source ? 'No source specified' :
                        (step.source.length > 20 ? step.source.substring(0, 17) + '...' : step.source);
                    return `For <code class="loop-variable">${escapeHTML(step.loopVariable || 'item')}</code> in <code class="loop-source" title="${escapeHTML(step.source || '')}">${escapeHTML(sourcePreview)}</code>`;
                }
                case 'transform': {
                    const opCount = Array.isArray(step.ops) ? step.ops.length : 0;
                    return `Transform <code>${opCount} op(s)</code>`;
                }
                default:
                    return `Type: ${escapeHTML(step.type)}`;
            }
        } catch (error) {
            logger.error(`Error generating content HTML for step ${step.id}:`, error);
            return `Error displaying content. Type: ${escapeHTML(step.type)}`;
        }
    }

    _getPortCounts(stepType) {
        if (stepType === 'condition') return { inputs: 1, outputs: 3 };
        if (stepType === 'loop') return { inputs: 1, outputs: 2 };
        return { inputs: 1, outputs: 1 };
    }

    _getOutputRole(step, outputClass) {
        if (!step || !outputClass) return null;
        const index = parseInt(outputClass.replace('output_', ''), 10);
        if (Number.isNaN(index)) return null;

        if (step.type === 'condition') {
            if (index === 1) return 'main';
            if (index === 2) return 'then';
            if (index === 3) return 'else';
        }
        if (step.type === 'loop') {
            if (index === 1) return 'main';
            if (index === 2) return 'loop';
        }
        return 'main';
    }

    _getOutputClass(step, role) {
        const index = OUTPUT_ROLE_INDEX[role] || 1;
        return `output_${index}`;
    }

    _layoutSteps(steps, startX, startY) {
        let currentX = startX;
        let maxReachY = startY;
        let maxReachX = startX;

        if (!steps || steps.length === 0) {
            return { width: 0, height: 0 };
        }

        steps.forEach((step) => {
            let nodeData = this.nodes.get(step.id) || {
                id: step.id,
                width: NODE_WIDTH,
                height: NODE_MIN_HEIGHT,
                step,
                element: null,
                collapsed: false,
            };

            if (!this.nodes.has(step.id)) {
                this.nodes.set(step.id, nodeData);
            }

            nodeData.x = currentX;
            nodeData.y = startY;

            if (nodeData.collapsed === undefined) {
                nodeData.collapsed = !!(this.flowModel.visualLayout?.[step.id]?.collapsed);
            }
            if (nodeData.collapsed) {
                this.collapsedNodes.add(step.id);
            }

            let branchHeight = 0;
            let branchWidth = 0;

            if (step.type === 'condition' && !this.collapsedNodes.has(step.id)) {
                const branchStartX = currentX;
                const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;

                const thenLayout = this._layoutSteps(step.thenSteps || [], branchStartX, branchStartY);
                const elseStartY = branchStartY + (thenLayout.height > 0 ? thenLayout.height + V_SPACING : 0);
                const elseLayout = this._layoutSteps(step.elseSteps || [], branchStartX, elseStartY);

                branchHeight = BRANCH_V_SPACING + thenLayout.height + (thenLayout.height > 0 && elseLayout.height > 0 ? V_SPACING : 0) + elseLayout.height;
                branchWidth = Math.max(thenLayout.width, elseLayout.width);
            } else if (step.type === 'loop' && !this.collapsedNodes.has(step.id)) {
                const branchStartX = currentX;
                const branchStartY = startY + nodeData.height + BRANCH_V_SPACING;

                const loopLayout = this._layoutSteps(step.loopSteps || [], branchStartX, branchStartY);
                branchHeight = BRANCH_V_SPACING + loopLayout.height;
                branchWidth = loopLayout.width;
            }

            const currentStepReachX = currentX + Math.max(nodeData.width, branchWidth);
            const currentStepReachY = startY + nodeData.height + branchHeight;
            maxReachX = Math.max(maxReachX, currentStepReachX);
            maxReachY = Math.max(maxReachY, currentStepReachY);

            currentX += nodeData.width + H_SPACING;
        });

        return { width: maxReachX - startX, height: maxReachY - startY };
    }

    _applySavedLayout() {
        if (!this.flowModel?.visualLayout) return;
        this.nodes.forEach((nodeData) => {
            const savedLayout = this.flowModel.visualLayout[nodeData.id];
            if (savedLayout && typeof savedLayout.x === 'number' && typeof savedLayout.y === 'number') {
                nodeData.x = savedLayout.x;
                nodeData.y = savedLayout.y;
            }
            if (savedLayout && typeof savedLayout.collapsed === 'boolean') {
                nodeData.collapsed = savedLayout.collapsed;
                if (nodeData.collapsed) this.collapsedNodes.add(nodeData.id);
            }
        });
    }

    _renderConnections() {
        this.connections = [];
        if (!this.flowModel?.steps) return;

        this._collectConnections(this.flowModel.steps, null);
        this.connections.forEach((conn) => {
            if (this.hiddenNodeIds.has(conn.from) || this.hiddenNodeIds.has(conn.to)) return;

            const outputId = this.nodeIdByStepId.get(conn.from);
            const inputId = this.nodeIdByStepId.get(conn.to);
            if (!outputId || !inputId) return;

            const sourceStep = this.nodes.get(conn.from)?.step;
            if (!sourceStep) return;

            const outputClass = this._getOutputClass(sourceStep, conn.role);
            this.editor.addConnection(outputId, inputId, outputClass, 'input_1');
            this._tagConnection(outputId, inputId, outputClass, 'input_1', conn);
        });
    }

    _collectConnections(steps, previousStepId) {
        let prevId = previousStepId;
        steps.forEach((step) => {
            if (prevId) {
                this.connections.push({ from: prevId, to: step.id, role: 'main' });
            }

            if (!this.collapsedNodes.has(step.id)) {
                if (step.type === 'condition') {
                    const thenSteps = step.thenSteps || [];
                    const elseSteps = step.elseSteps || [];
                    if (thenSteps.length > 0) {
                        this.connections.push({ from: step.id, to: thenSteps[0].id, role: 'then' });
                        this._collectConnections(thenSteps, null);
                    }
                    if (elseSteps.length > 0) {
                        this.connections.push({ from: step.id, to: elseSteps[0].id, role: 'else' });
                        this._collectConnections(elseSteps, null);
                    }
                } else if (step.type === 'loop') {
                    const loopSteps = step.loopSteps || [];
                    if (loopSteps.length > 0) {
                        this.connections.push({ from: step.id, to: loopSteps[0].id, role: 'loop' });
                        this._collectConnections(loopSteps, null);
                    }
                }
            }

            prevId = step.id;
        });
    }

    _tagConnection(outputId, inputId, outputClass, inputClass, conn) {
        const selector = `.connection.node_in_node-${inputId}.node_out_node-${outputId}.${outputClass}.${inputClass}`;
        const connection = this.editor.container.querySelector(selector);
        if (!connection) return;
        connection.dataset.from = conn.from;
        connection.dataset.to = conn.to;
        connection.dataset.role = conn.role;
        connection.classList.add(`connector-${conn.role}`);

        const path = connection.querySelector('.main-path');
        if (path) {
            path.classList.add('connector-path');
            path.dataset.from = conn.from;
            path.dataset.to = conn.to;
            path.dataset.role = conn.role;
        }
    }

    _applyCollapsedVisibility() {
        this.hiddenNodeIds.clear();
        this.nodes.forEach((nodeData) => {
            if (nodeData.collapsed) {
                const step = this._findStepById(this.flowModel.steps, nodeData.id);
                if (step) this._collectDescendantIds(step, this.hiddenNodeIds);
            }
        });

        this.nodes.forEach((nodeData) => {
            if (!nodeData.element) return;
            const isHidden = this.hiddenNodeIds.has(nodeData.id);
            nodeData.element.style.display = isHidden ? 'none' : '';
        });

        const connections = Array.from(this.editor.precanvas.querySelectorAll('.connection'));
        connections.forEach((connection) => {
            const fromId = connection.dataset.from;
            const toId = connection.dataset.to;
            if (!fromId || !toId) return;
            const hidden = this.hiddenNodeIds.has(fromId) || this.hiddenNodeIds.has(toId);
            connection.style.display = hidden ? 'none' : '';
        });
    }

    _applySelection() {
        if (!this.selectedNodeId) return;
        const drawflowId = this.nodeIdByStepId.get(this.selectedNodeId);
        if (!drawflowId) return;
        const nodeEl = this.editor.container.querySelector(`#node-${drawflowId}`);
        if (nodeEl) nodeEl.classList.add('selected');
    }

    _updateMinimap() {
        if (!this.minimapCanvas || !this.minimapContainer || !this.minimapVisible) return;
        const ctx = this.minimapCanvas.getContext('2d');
        if (!ctx) return;

        const width = this.minimapContainer.clientWidth;
        const height = this.minimapContainer.clientHeight;
        if (width === 0 || height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        this.minimapCanvas.width = width * dpr;
        this.minimapCanvas.height = height * dpr;
        this.minimapCanvas.style.width = `${width}px`;
        this.minimapCanvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, width, height);

        const visibleNodes = Array.from(this.nodes.values()).filter(
            (node) => !this.hiddenNodeIds.has(node.id)
        );

        if (visibleNodes.length === 0) {
            this.minimapBounds = null;
            return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        visibleNodes.forEach((node) => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + NODE_WIDTH);
            maxY = Math.max(maxY, node.y + NODE_MIN_HEIGHT);
        });

        const contentWidth = Math.max(1, maxX - minX);
        const contentHeight = Math.max(1, maxY - minY);

        this.minimapScale = Math.min(
            (width - MINIMAP_PADDING * 2) / contentWidth,
            (height - MINIMAP_PADDING * 2) / contentHeight
        );

        this.minimapBounds = { minX, minY, maxX, maxY };

        this.connections.forEach((conn) => {
            if (this.hiddenNodeIds.has(conn.from) || this.hiddenNodeIds.has(conn.to)) return;
            const fromNode = this.nodes.get(conn.from);
            const toNode = this.nodes.get(conn.to);
            if (!fromNode || !toNode) return;

            const startX = (fromNode.x + NODE_WIDTH / 2 - minX) * this.minimapScale + MINIMAP_PADDING;
            const startY = (fromNode.y + NODE_MIN_HEIGHT / 2 - minY) * this.minimapScale + MINIMAP_PADDING;
            const endX = (toNode.x + NODE_WIDTH / 2 - minX) * this.minimapScale + MINIMAP_PADDING;
            const endY = (toNode.y + NODE_MIN_HEIGHT / 2 - minY) * this.minimapScale + MINIMAP_PADDING;

            ctx.strokeStyle = ROLE_COLORS[conn.role] || ROLE_COLORS.main;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        });

        visibleNodes.forEach((node) => {
            const x = (node.x - minX) * this.minimapScale + MINIMAP_PADDING;
            const y = (node.y - minY) * this.minimapScale + MINIMAP_PADDING;
            const w = NODE_WIDTH * this.minimapScale;
            const h = NODE_MIN_HEIGHT * this.minimapScale;

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);

            if (node.id === this.selectedNodeId) {
                ctx.strokeStyle = '#2563eb';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
            }
        });

        this._updateMinimapViewport();
    }

    _updateMinimapViewport() {
        if (!this.minimapViewport || !this.minimapBounds || !this.minimapVisible) return;
        if (this._minimapFrame) return;

        this._minimapFrame = requestAnimationFrame(() => {
            this._minimapFrame = null;
            const zoom = this.editor?.zoom || 1;
            const canvasX = this.editor?.canvas_x || 0;
            const canvasY = this.editor?.canvas_y || 0;

            const viewportW = this.mountPoint.clientWidth / zoom;
            const viewportH = this.mountPoint.clientHeight / zoom;
            const viewportX = -canvasX / zoom;
            const viewportY = -canvasY / zoom;

            const { minX, minY } = this.minimapBounds;

            const left = (viewportX - minX) * this.minimapScale + MINIMAP_PADDING;
            const top = (viewportY - minY) * this.minimapScale + MINIMAP_PADDING;
            const width = viewportW * this.minimapScale;
            const height = viewportH * this.minimapScale;

            const maxLeft = this.minimapContainer.clientWidth - width;
            const maxTop = this.minimapContainer.clientHeight - height;

            this.minimapViewport.style.width = `${width}px`;
            this.minimapViewport.style.height = `${height}px`;
            this.minimapViewport.style.left = `${clamp(left, 0, maxLeft)}px`;
            this.minimapViewport.style.top = `${clamp(top, 0, maxTop)}px`;
        });
    }

    _panToMinimapPoint(event) {
        if (!this.minimapBounds) return;
        const rect = this.minimapCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left - MINIMAP_PADDING) / this.minimapScale + this.minimapBounds.minX;
        const y = (event.clientY - rect.top - MINIMAP_PADDING) / this.minimapScale + this.minimapBounds.minY;

        const zoom = this.editor?.zoom || 1;
        const viewportW = this.mountPoint.clientWidth / zoom;
        const viewportH = this.mountPoint.clientHeight / zoom;

        const maxLeft = this.minimapBounds.maxX - viewportW;
        const maxTop = this.minimapBounds.maxY - viewportH;

        const newLeft = clamp(x - viewportW / 2, this.minimapBounds.minX, maxLeft);
        const newTop = clamp(y - viewportH / 2, this.minimapBounds.minY, maxTop);

        const translateX = -newLeft * zoom;
        const translateY = -newTop * zoom;

        this.editor.canvas_x = translateX;
        this.editor.canvas_y = translateY;
        this.editor.precanvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoom})`;
        this._updateMinimapViewport();
    }

    _handleConnectionCreated(info) {
        const sourceStepId = this.stepIdByNodeId.get(String(info.output_id));
        const targetStepId = this.stepIdByNodeId.get(String(info.input_id));
        if (!sourceStepId || !targetStepId) return;

        const sourceStep = this.nodes.get(sourceStepId)?.step;
        const outputRole = this._getOutputRole(sourceStep, info.output_class);
        if (!outputRole) return;

        if (!this.options.onConnectionUpdate) {
            this.render(this.flowModel, this.selectedNodeId);
            return;
        }

        this.options.onConnectionUpdate({
            action: 'connect',
            sourceStepId,
            targetStepId,
            outputRole,
            outputClass: info.output_class,
            inputClass: info.input_class,
        });
    }

    _handleConnectionRemoved(info) {
        const sourceStepId = this.stepIdByNodeId.get(String(info.output_id));
        const targetStepId = this.stepIdByNodeId.get(String(info.input_id));
        if (!sourceStepId || !targetStepId) return;

        if (!this.options.onConnectionUpdate) {
            this.render(this.flowModel, this.selectedNodeId);
            return;
        }

        this.options.onConnectionUpdate({
            action: 'disconnect',
            sourceStepId,
            targetStepId,
            outputRole: 'main',
            outputClass: info.output_class,
            inputClass: info.input_class,
        });
    }

    setZoom(level) {
        const target = clamp(level, this.minZoom, this.maxZoom);
        this.editor.zoom = target;
        this.editor.zoom_refresh();
        this.zoomLevel = target;
        this._updateMinimapViewport();
    }

    zoomIn() {
        this.editor.zoom_in();
        this.zoomLevel = this.editor.zoom;
        this._updateMinimapViewport();
    }

    zoomOut() {
        this.editor.zoom_out();
        this.zoomLevel = this.editor.zoom;
        this._updateMinimapViewport();
    }

    resetZoom() {
        this.editor.zoom_reset();
        this.zoomLevel = this.editor.zoom;
        this._updateMinimapViewport();
    }

    focusNode(stepId) {
        if (!stepId || !this.editor || !this.editor.precanvas) return false;
        const nodeData = this.nodes.get(stepId);
        if (!nodeData) return false;

        const zoom = this.editor.zoom || 1;
        const viewportW = this.mountPoint.clientWidth / zoom;
        const viewportH = this.mountPoint.clientHeight / zoom;
        const nodeCenterX = nodeData.x + (nodeData.width || NODE_WIDTH) / 2;
        const nodeCenterY = nodeData.y + (nodeData.height || NODE_MIN_HEIGHT) / 2;
        const targetLeft = nodeCenterX - viewportW / 2;
        const targetTop = nodeCenterY - viewportH / 2;
        const translateX = -targetLeft * zoom;
        const translateY = -targetTop * zoom;

        this.editor.canvas_x = translateX;
        this.editor.canvas_y = translateY;
        this.editor.precanvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoom})`;
        this.editor.dispatch?.('translate', { x: translateX, y: translateY });
        this._updateMinimapViewport();
        this._scheduleMinimapRefresh();
        return true;
    }

    showMinimap() {
        if (!this.minimapContainer) return;
        this.minimapContainer.style.display = '';
        this.minimapVisible = true;
        this._scheduleMinimapRefresh();
    }

    hideMinimap() {
        if (!this.minimapContainer) return;
        this.minimapContainer.style.display = 'none';
        this.minimapVisible = false;
    }

    toggleMinimap() {
        if (this.minimapVisible) this.hideMinimap();
        else this.showMinimap();
    }

    isMinimapVisible() {
        return this.minimapVisible;
    }

    highlightNode(stepId, highlightType = 'active') {
        this.clearHighlights();

        const nodeData = this.nodes.get(stepId);
        if (!nodeData || !nodeData.element) {
            logger.warn(`Highlight Error: Node data or element not found for step ${stepId}.`);
            return;
        }

        const highlightClass = highlightType === 'active' ? 'active-step'
            : highlightType === 'success' ? 'success'
            : highlightType === 'error' ? 'error'
            : highlightType === 'stopped' ? 'stopped'
            : highlightType;

        nodeData.element.classList.add(highlightClass);

        const connectorPaths = Array.from(
            this.editor.precanvas?.querySelectorAll(`.connector-path[data-to="${stepId}"]`) || []
        );

        connectorPaths.forEach((path) => {
            const statusClass = `status-${highlightType}`;
            path.classList.add(CONNECTOR_ACTIVE_CLASS, statusClass);
        });
    }

    clearHighlights() {
        const highlightClasses = ['active-step', 'success', 'error', 'stopped'];
        const statusClasses = ['status-active', 'status-success', 'status-error', 'status-stopped'];

        this.nodes.forEach((nodeData) => {
            if (nodeData.element) {
                nodeData.element.classList.remove(...highlightClasses);
                const runtimeInfoDiv = nodeData.element.querySelector('.node-runtime-details');
                if (runtimeInfoDiv) runtimeInfoDiv.innerHTML = '';
            }
        });

        const connectorPaths = this.editor.precanvas?.querySelectorAll('.connector-path') || [];
        connectorPaths.forEach((path) => {
            path.classList.remove(CONNECTOR_ACTIVE_CLASS, ...statusClasses);
        });
    }

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

        runtimeInfoDiv.innerHTML = '';
        const detailsParts = [];

        if (nodeData.step.type === 'request') {
            let requestInfoHtml = '';
            let hasRequestInfo = false;

            if (result.output && result.output.status !== undefined && result.output.status !== null) {
                const statusClass = result.output.status >= 400 ? 'error' : (result.output.status >= 300 ? 'warn' : 'success');
                requestInfoHtml += `<span class="info-item status-${statusClass}">Status: <strong>${escapeHTML(result.output.status)}</strong></span>`;
                hasRequestInfo = true;
            } else if (result.status === 'error') {
                requestInfoHtml += '<span class="info-item error">Request Error</span>';
                hasRequestInfo = true;
            }

            const hasConfiguredExtractions = nodeData.step.extract && Object.keys(nodeData.step.extract).length > 0;
            let extractionStatus = 'N/A';
            let extractionStatusClass = 'neutral';

            if (hasConfiguredExtractions) {
                if (result.status === 'success' || (result.status === 'error' && nodeData.step.onFailure === 'continue')) {
                    if (result.extractionFailures && result.extractionFailures.length > 0) {
                        extractionStatus = 'Failed';
                        extractionStatusClass = 'error';
                    } else {
                        extractionStatus = 'OK';
                        extractionStatusClass = 'success';
                    }
                } else {
                    extractionStatus = 'Skipped';
                    extractionStatusClass = 'neutral';
                }
            }

            if (extractionStatus !== 'N/A') {
                requestInfoHtml += `<span class="info-item extract-${extractionStatusClass}">Extract: <strong>${extractionStatus}</strong></span>`;
                hasRequestInfo = true;
            }

            if (hasRequestInfo) {
                detailsParts.push(requestInfoHtml);
            }
        } else if (result.status === 'error') {
            detailsParts.push('<span class="info-item error">Step Error</span>');
        }

        const iter = result.currentIteration ?? result.loopIteration;
        const tot = result.totalIterations ?? result.loopTotal;
        if (iter !== undefined && tot !== undefined && typeof iter === 'number' && typeof tot === 'number') {
            detailsParts.push(`<span class="info-item loop-iteration">Iter: ${iter + 1}/${tot}</span>`);
        }

        runtimeInfoDiv.innerHTML = detailsParts.join(' | ');
    }

    _findStepById(steps, id) {
        if (!steps || !Array.isArray(steps)) return null;
        for (const step of steps) {
            if (step.id === id) return step;
            let found = null;
            if (step.type === 'condition') {
                found = this._findStepById(step.thenSteps || [], id);
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

    _collectDescendantIds(step, acc = new Set()) {
        const collect = (steps) => {
            if (!steps || !Array.isArray(steps)) return;
            for (const s of steps) {
                if (!acc.has(s.id)) {
                    acc.add(s.id);
                    this._collectDescendantIds(s, acc);
                }
            }
        };

        if (step.type === 'condition') {
            collect(step.thenSteps);
            collect(step.elseSteps);
        } else if (step.type === 'loop') {
            collect(step.loopSteps);
        }

        return acc;
    }

    destroy() {
        this.mountPoint.removeEventListener('mousedown', this._handleCanvasPanStart, true);
        this.mountPoint.removeEventListener('keydown', this._handleKeydown, true);
        this.mountPoint.removeEventListener('contextmenu', this._handleContextMenu, true);
        this.minimapContainer?.removeEventListener('mousedown', this._handleMinimapMouseDown);
        this.minimapContainer?.removeEventListener('dblclick', this._handleMinimapDoubleClick);
        document.removeEventListener('mousemove', this._handleMinimapMouseMove);
        document.removeEventListener('mouseup', this._handleMinimapMouseUp);
        document.removeEventListener('mousemove', this._handleCanvasPanMove);
        document.removeEventListener('mouseup', this._handleCanvasPanEnd);

        if (this.editor) {
            this.editor.clear();
        }

        this.nodes.clear();
        this.nodeIdByStepId.clear();
        this.stepIdByNodeId.clear();

        if (this.nodeEditorModal?.parentNode) {
            this.nodeEditorModal.parentNode.removeChild(this.nodeEditorModal);
        }
    }
}

FlowVisualizer.prototype.__forceMinimapRefresh = function () {
    this._updateMinimap();
};
