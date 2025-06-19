// ========== FILE: domUtils.js (Updated) ==========

import { domRefs } from './state.js';
import { logger } from './logger.js';

export function initializeDOMReferences() {
    // Use Object.assign to modify the imported domRefs object
    Object.assign(domRefs, {
        // Sidebar
        sidebar: document.getElementById('sidebar'), // Reference to the aside element
        sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'), // NEW
        addFlowBtn: document.getElementById('add-flow-btn'), // Now just "New"
        openFlowBtn: document.getElementById('open-flow-btn'),
        flowList: document.getElementById('flow-list'), // Now shows recent files

        // Workspace
        workspace: document.getElementById('workspace'),
        workspaceTitle: document.getElementById('workspace-title'),
        workspaceContent: document.getElementById('workspace-content'),
        workspacePlaceholder: document.getElementById('workspace-placeholder'),
        toggleViewBtn: document.getElementById('toggle-view-btn'),

        // Views within Workspace Content
        flowBuilderMount: document.getElementById('flow-builder-mount'),
        flowVisualizerMount: document.getElementById('flow-visualizer-mount'),

        // Controls within Header
        saveFlowBtn: document.getElementById('save-flow-btn'),
        saveAsFlowBtn: document.getElementById('save-as-flow-btn'),
        cancelFlowBtn: document.getElementById('cancel-flow-btn'), // <<< Ensure this ID matches your HTML
        closeFlowBtn: document.getElementById('close-flow-btn'),   // <<< Ensure this ID matches your HTML
        toggleInfoBtn: document.getElementById('toggle-info-btn'),
        toggleVariablesBtn: document.getElementById('toggle-variables-btn'),
        zoomOutBtn: document.getElementById('zoom-out-btn'),
        zoomInBtn: document.getElementById('zoom-in-btn'),
        zoomResetBtn: document.getElementById('zoom-reset-btn'),
        toggleMinimapBtn: document.getElementById('toggle-minimap-btn'),

        // Panels relative to Workspace
        variablesPanel: document.querySelector('.variables-panel'),
        variablesContainer: document.querySelector('.variables-container'),
        actualVariablesPanelCloseBtn: document.getElementById('actual-close-variables-btn'),
        infoOverlay: document.querySelector('[data-ref="infoOverlay"]'), // Used by builder

        // +++ ADDED REFERENCE FOR INFO OVERLAY CLOSE BUTTON +++
        actualInfoOverlayCloseBtn: document.getElementById('actual-close-info-btn'), // <<< The added reference

        // References specific to the *content* of the Info Overlay (used by uiUtils & app.js)
        infoOverlayNameInput: document.getElementById('global-flow-name'),
        infoOverlayDescTextarea: document.getElementById('global-flow-description'),
        infoOverlayGlobalHeadersToggle: document.querySelector('[data-ref="globalHeadersToggle"]'),
        infoOverlayGlobalHeadersContent: document.querySelector('[data-ref="globalHeadersContent"]'),
        infoOverlayGlobalHeadersList: document.querySelector('[data-ref="globalHeadersList"]'),
        infoOverlayAddGlobalHeaderBtn: document.querySelector('[data-ref="addGlobalHeaderBtn"]'),
        infoOverlayFlowVarsToggle: document.querySelector('[data-ref="flowVarsToggle"]'),
        infoOverlayFlowVarsContent: document.querySelector('[data-ref="flowVarsContent"]'),
        infoOverlayFlowVarsList: document.querySelector('[data-ref="flowVarsList"]'),
        infoOverlayAddFlowVarBtn: document.querySelector('[data-ref="addFlowVarBtn"]'),

        // Messages
        builderMessages: document.getElementById('builder-messages'),

        // Runner Panel
        runnerPanel: document.getElementById('runner-panel'), // Reference to the aside element
        runnerToggleBtn: document.getElementById('runner-toggle-btn'), // NEW
        runFlowBtn: document.getElementById('run-flow-btn'),
        continuousRunCheckbox: document.getElementById('continuous-run-checkbox'),
        stepFlowBtn: document.getElementById('step-flow-btn'),
        stepIntoFlowBtn: document.getElementById('step-into-flow-btn'),
        stopFlowBtn: document.getElementById('stop-flow-btn'),
        clearResultsBtn: document.getElementById('clear-results-btn'),
        requestDelayInput: document.getElementById('request-delay'),
        encodeUrlVarsCheckbox: document.getElementById('encode-url-vars-checkbox'),
        resultsSearchInput: document.getElementById('results-search'),
        resultsStatusFilter: document.getElementById('results-status-filter'),
        runnerResultsList: document.getElementById('runner-results'),
        runnerResultsContainer: document.querySelector('.runner-results-container'),
        runnerStatusMessages: document.getElementById('runner-status-messages'), // <<< --- ADDED THIS LINE ---

        // Dialogs & Overlays
        stepTypeDialog: document.getElementById('step-type-dialog'),
        varDropdown: document.getElementById('var-dropdown'),
        globalLoadingOverlay: document.getElementById('global-loading-overlay'),
    });

    // Check for new/critical elements
    if (!domRefs.sidebarToggleBtn) logger.warn("Required button #sidebar-toggle-btn not found in HTML.");
    if (!domRefs.runnerToggleBtn) logger.warn("Required button #runner-toggle-btn not found in HTML.");
    if (!domRefs.sidebar) logger.warn("Required element #sidebar not found in HTML.");
    if (!domRefs.runnerPanel) logger.warn("Required element #runner-panel not found in HTML.");

    // Check for primary file operation buttons
    if (!domRefs.openFlowBtn) logger.warn("Button #open-flow-btn not found in HTML.");
    if (!domRefs.saveFlowBtn) logger.warn("Button #save-flow-btn not found in HTML.");
    if (!domRefs.saveAsFlowBtn) logger.warn("Button #save-as-flow-btn not found in HTML.");
    if (!domRefs.cancelFlowBtn) logger.warn("Button #cancel-flow-btn not found in HTML."); // <<< CHECK
    if (!domRefs.closeFlowBtn) logger.warn("Button #close-flow-btn not found in HTML.");   // <<< CHECK

    // Check for new/critical elements
    if (!domRefs.continuousRunCheckbox) logger.warn("Required checkbox #continuous-run-checkbox not found in HTML.");
    if (!domRefs.encodeUrlVarsCheckbox) logger.warn("Required checkbox #encode-url-vars-checkbox not found in HTML.");

    // Check for overlay close buttons
    if (!domRefs.actualVariablesPanelCloseBtn) logger.warn("Required button #actual-close-variables-btn not found in HTML.");
    if (!domRefs.actualInfoOverlayCloseBtn) logger.warn("Required button #actual-close-info-btn not found in HTML."); // <<< The added check

    // Check for runner status message container <<< --- ADDED THIS CHECK ---
    if (!domRefs.runnerStatusMessages) logger.warn("Required element #runner-status-messages not found in HTML.");
    if (!domRefs.resultsSearchInput) logger.warn("Required input #results-search not found in HTML.");
    if (!domRefs.resultsStatusFilter) logger.warn("Required select #results-status-filter not found in HTML.");

}