// ========== FILE: state.js (New module from app.js) ==========

// --- Application State ---
export let appState = {
    // flows: [], // Remove: No longer loading a list of all flows in memory from API
    currentFilePath: null, // --- NEW: Track path of the currently open file
    currentFlowModel: null,
    selectedStepId: null,
    isDirty: false, // Represents changes to flow structure, metadata, or step *content* after editor save
    stepEditorIsDirty: false, // Represents unsaved changes *within* the currently open step editor
    isLoading: false,
    runner: null,
    executionResults: [],
    currentView: 'list-editor',
    builderComponent: null,
    visualizerComponent: null,
    isInfoOverlayOpen: false,
    isVariablesPanelVisible: false, // Add this line
    definedVariables: {}, // Moved from builder, managed by app
    // NEW State Variables for Pane Collapse
    isSidebarCollapsed: false,
    isRunnerCollapsed: false,
    isContinuousRunActive: false, // Tracks if a continuous run session is active
};

// --- DOM Element References ---
export let domRefs = {}; // Populated by initializeDOMReferences