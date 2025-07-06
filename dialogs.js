import { appState, domRefs } from './state.js';
import { escapeHTML } from './flowCore.js'; // Needs getStepTypeIcon
import { getStepTypeIcon } from './flowStepComponents.js';
import { showMessage, setDirty } from './uiUtils.js'; // Need showMessage, setDirty
import { handleBuilderEditorDirtyChange } from './eventHandlers.js'; // Need this for insertVariableIntoInput

// --- Step Type Dialog (Managed by App) ---

let stepTypeDialogCallback = null;

export function initializeStepTypeDialogListeners() {
    // Using the dialog provided in index.html
    if (!domRefs.stepTypeDialog) return;
    const closeButton = domRefs.stepTypeDialog.querySelector('.step-type-close');
    closeButton?.addEventListener('click', () => hideAppStepTypeDialog(null));

    domRefs.stepTypeDialog.querySelectorAll('.step-type-option').forEach(option => {
        option.addEventListener('click', () => {
            const type = option.dataset.type;
            hideAppStepTypeDialog(type);
        });
    });
    // Close if clicking backdrop
    domRefs.stepTypeDialog.addEventListener('click', (e) => {
        if (e.target === domRefs.stepTypeDialog) hideAppStepTypeDialog(null);
    });
}

export function showAppStepTypeDialog(onSelect) {
    stepTypeDialogCallback = onSelect;
    if (domRefs.stepTypeDialog) {
        try {
            // Populate icons dynamically
            domRefs.stepTypeDialog.querySelector('.request-icon').innerHTML = getStepTypeIcon('request');
            domRefs.stepTypeDialog.querySelector('.condition-icon').innerHTML = getStepTypeIcon('condition');
            domRefs.stepTypeDialog.querySelector('.loop-icon').innerHTML = getStepTypeIcon('loop');
            domRefs.stepTypeDialog.style.display = 'flex';
        } catch (error) {
            console.error("Error setting up step type dialog:", error);
        }
    } else {
        console.error("Step type dialog element not found.");
    }
}

export function hideAppStepTypeDialog(selectedType) {
    if (domRefs.stepTypeDialog) domRefs.stepTypeDialog.style.display = 'none';
    if (stepTypeDialogCallback) {
        try {
            stepTypeDialogCallback(selectedType);
        } catch (error) {
            console.error("Error in step type dialog callback:", error);
        } finally {
             stepTypeDialogCallback = null; // Reset callback regardless of error
        }
    }
}


// --- Variable Dropdown (Managed by App) ---
let currentVarDropdown = { button: null, targetInput: null, targetId: null, handler: null };

export function initializeVarDropdownListeners() {
    // Listener for the dropdown itself
    if (!domRefs.varDropdown) return;
    const searchInput = domRefs.varDropdown.querySelector('.var-search');
    const varList = domRefs.varDropdown.querySelector('.var-list');
    const closeBtn = domRefs.varDropdown.querySelector('.var-close');
    const noResultsMsg = domRefs.varDropdown.querySelector('.no-results-msg');

    searchInput?.addEventListener('input', () => {
        const filter = searchInput.value.toLowerCase();
        let hasVisibleItems = false;
        varList?.querySelectorAll('.var-item').forEach(item => {
            const varName = item.dataset.var?.toLowerCase() || '';
            const isVisible = varName.includes(filter);
            item.style.display = isVisible ? '' : 'none';
            if (isVisible) hasVisibleItems = true;
        });
        if (noResultsMsg) noResultsMsg.style.display = hasVisibleItems ? 'none' : 'block';
    });
    closeBtn?.addEventListener('click', () => hideVarDropdown());
    varList?.addEventListener('click', (e) => {
        const varItem = e.target.closest('.var-item');
        if (varItem && varItem.dataset.var) {
            insertVariableIntoInput(varItem.dataset.var);
            hideVarDropdown();
        }
    });
}

// --- [Modified Code] in app.js ---
export function initializeVariableInsertionListener() {
    document.body.addEventListener('click', (event) => {
        const insertButton = event.target.closest('.btn-insert-var');
        if (insertButton) {
            let targetInput = null;
            const targetId = insertButton.dataset.targetInput;

            try { // Add try-catch for DOM operations
                if (targetId) {
                    // Search within common parent containers first, then globally
                    targetInput = insertButton.closest('.step-editor, .flow-info-overlay, .key-value-editor')
                                     ?.querySelector(`#${targetId}`)
                                     || document.getElementById(targetId);
                } else {
                    // Fallback: More robust search for sibling/cousin input/textarea
                     const inputContainer = insertButton.closest('.input-with-vars, .header-row, .global-header-row, .flow-var-row, .key-value-row'); // Added common classes
                     if (inputContainer) {
                         targetInput = inputContainer.querySelector('input[type="text"], input:not([type]), textarea');
                     } else {
                         // Try finding adjacent input/textarea if button is directly next to it
                         targetInput = insertButton.previousElementSibling;
                         if (!targetInput || (targetInput.tagName !== 'INPUT' && targetInput.tagName !== 'TEXTAREA')) {
                            // If previous sibling isn't it, check parent's direct children
                            targetInput = insertButton.parentElement?.querySelector('input[type="text"], input:not([type]), textarea');
                         }
                     }
                }

                if (targetInput && (targetInput.tagName === 'INPUT' || targetInput.tagName === 'TEXTAREA')) {
                    // Use cached defined variables
                    const currentVars = appState.definedVariables || {}; // Use cached variables
                    const varNames = Object.keys(currentVars);
                    showVarDropdown(insertButton, targetInput, varNames);
                } else {
                    console.warn("Could not find target input/textarea for variable insertion button.", insertButton);
                    showMessage("Could not find the target field for variable insertion.", "warning");
                }
            } catch (error) {
                console.error("Error finding target input for variable insertion:", error);
                showMessage("Error preparing variable insertion.", "error");
            }
        }
    });
}

// --- [Modified Code] in app.js ---
export function showVarDropdown(button, targetInput, availableVarNames) {
    hideVarDropdown(); // Hide any existing dropdown

    if (!domRefs.varDropdown) {
         console.error("Variable dropdown element not found.");
         return;
    }

    if (!availableVarNames || availableVarNames.length === 0) {
        showMessage("No variables defined or extracted yet to insert.", "info");
        return;
    }

    currentVarDropdown = { button, targetInput, targetId: targetInput?.id };
    const varList = domRefs.varDropdown.querySelector('.var-list');
    const searchInput = domRefs.varDropdown.querySelector('.var-search');
    const noResultsMsg = domRefs.varDropdown.querySelector('.no-results-msg');

    if (!varList || !searchInput || !noResultsMsg) {
        console.error("Variable dropdown is missing required elements (list, search, no-results).");
        return;
    }

    try { // Add try-catch for DOM updates
        varList.innerHTML = availableVarNames.sort()
            .map(varName => `<div class="var-item" data-var="${escapeHTML(varName)}" title="Insert {{${escapeHTML(varName)}}}">${escapeHTML(varName)}</div>`)
            .join('');
        searchInput.value = '';
        noResultsMsg.style.display = 'none';
        varList.querySelectorAll('.var-item').forEach(item => item.style.display = ''); // Ensure all are visible

        // --- Improved Positioning ---
        const rect = button.getBoundingClientRect();
        domRefs.varDropdown.style.display = 'block'; // Make visible before measuring
        const dropdownHeight = domRefs.varDropdown.offsetHeight;
        const dropdownWidth = domRefs.varDropdown.offsetWidth;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let topPos = rect.bottom + window.scrollY + 2;
        // Check if dropdown goes below viewport
        if (topPos + dropdownHeight > viewportHeight + window.scrollY) {
            topPos = rect.top + window.scrollY - dropdownHeight - 2; // Position above button
        }
         // Ensure top position isn't negative
         if (topPos < window.scrollY) {
             topPos = window.scrollY + 5;
         }

        let leftPos = rect.left + window.scrollX;
        // Check if dropdown goes off-screen right
        if (leftPos + dropdownWidth > viewportWidth + window.scrollX) {
            leftPos = viewportWidth + window.scrollX - dropdownWidth - 10; // Adjust left
        }
        // Ensure left position isn't negative
        if (leftPos < window.scrollX) {
            leftPos = window.scrollX + 10;
        }

        domRefs.varDropdown.style.top = `${topPos}px`;
        domRefs.varDropdown.style.left = `${leftPos}px`;

        searchInput.focus(); // Instantly focus after display

        // Click-outside handler (remains same)
        currentVarDropdown.handler = (event) => {
             // Check if the click is outside the dropdown AND outside the button that opened it
             if (domRefs.varDropdown && !domRefs.varDropdown.contains(event.target) && event.target !== button && !button.contains(event.target)) {
                 hideVarDropdown();
             }
        };
        // Use setTimeout 0 to attach the listener after the current event loop cycle (which handles the button click)
        document.addEventListener('click', currentVarDropdown.handler, { capture: true }); // Attach listener

    } catch (error) {
        console.error("Error populating or positioning variable dropdown:", error);
        showMessage("Error showing variable list.", "error");
        hideVarDropdown(); // Ensure it's hidden on error
    }
}

export function hideVarDropdown() {
    if (domRefs.varDropdown) domRefs.varDropdown.style.display = 'none';
    if (currentVarDropdown.handler) {
        // Clean up listener
        document.removeEventListener('click', currentVarDropdown.handler, { capture: true });
    }
    currentVarDropdown = { button: null, targetInput: null, targetId: null, handler: null };
}

// --- [Modified Code] in app.js ---
export function insertVariableIntoInput(varName) {
    let targetInput = currentVarDropdown.targetInput;
    if (!targetInput || !targetInput.isConnected) {
        // Attempt to re-query the element if it was re-rendered
        if (currentVarDropdown.targetId) {
            targetInput = document.getElementById(currentVarDropdown.targetId);
        }
        // Fallback: search near the button if still not found
        if (!targetInput && currentVarDropdown.button) {
            const btn = currentVarDropdown.button;
            const container = btn.closest('.input-with-vars, .header-row, .global-header-row, .flow-var-row, .key-value-row');
            if (container) {
                targetInput = container.querySelector('input[type="text"], input:not([type]), textarea');
            } else {
                targetInput = btn.previousElementSibling;
                if (!targetInput || (targetInput.tagName !== 'INPUT' && targetInput.tagName !== 'TEXTAREA')) {
                    targetInput = btn.parentElement?.querySelector('input[type="text"], input:not([type]), textarea');
                }
            }
        }
        currentVarDropdown.targetInput = targetInput;
    }
    // --- CRITICAL: Add checks ---
    if (!targetInput) {
        console.error("Cannot insert variable: Target input is null or undefined.");
        showMessage("Insertion target lost.", "error");
        return;
    }
     if (typeof targetInput.value === 'undefined' || targetInput.selectionStart === null || targetInput.selectionEnd === null) {
        console.error("Cannot insert variable: Target input is not a valid text input/textarea or selection is not available.", targetInput);
         showMessage("Cannot insert into target field.", "error");
        return;
    }
    if (targetInput.readOnly || targetInput.disabled) {
        console.warn("Cannot insert variable: Target input is read-only or disabled.");
        showMessage("Cannot insert into read-only field.", "warning");
        return;
    }

    try { // Wrap DOM manipulation
        const textToInsert = `{{${varName}}}`;
        const currentVal = targetInput.value;
        const selectionStart = targetInput.selectionStart;
        const selectionEnd = targetInput.selectionEnd;

        // Insert text, replacing selection if any
        targetInput.value = currentVal.substring(0, selectionStart) + textToInsert + currentVal.substring(selectionEnd);

        // Update cursor position to end of inserted text
        const newCursorPos = selectionStart + textToInsert.length;
        targetInput.selectionStart = newCursorPos;
        targetInput.selectionEnd = newCursorPos;

        // Trigger input event for frameworks/listeners and focus
        targetInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetInput.focus();

        // Trigger change event as well, sometimes needed

         // --- CRITICAL: Mark editor dirty if appropriate ---
         // Check if the target input is within the step editor managed by the builder component
         const editorPanel = targetInput.closest('.step-editor-panel .step-editor');
         if (appState.builderComponent && editorPanel) {
              // Directly mark editor as dirty
              handleBuilderEditorDirtyChange(true);
         } else {
              // Check if input is part of flow info overlay (headers, static vars)
               const infoOverlay = targetInput.closest('.flow-info-overlay');
               if (infoOverlay) {
                   // These changes directly modify the flow model via their own input listeners,
                   // which already call setDirty(true) via the appState.isDirty flag. No extra call needed here.
                   // We just rely on the existing 'input' or 'change' event listeners on those fields.
               }
         }
    } catch (error) {
         console.error("Error inserting variable text:", error);
         showMessage("Failed to insert variable text.", "error");
    }
}
