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
            domRefs.stepTypeDialog.querySelector('.transform-icon').innerHTML = getStepTypeIcon('transform');
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

// --- Generic Confirm Dialog (non-blocking replacement for native confirm()) ---
// Native confirm()/alert() freeze the renderer (and kill a projected demo);
// this promise-based dialog keeps the event loop alive and inherits the theme.

let activeConfirmResolve = null;

/**
 * Show the in-app confirm dialog. Resolves true on confirm, false on
 * cancel / Escape / backdrop click. Only one dialog can be open at a time;
 * a second call while open resolves the first as cancelled.
 *
 * @param {string} message  Body text (plain text).
 * @param {object} [opts]
 * @param {string} [opts.title='Are you sure?']
 * @param {string} [opts.confirmText='Confirm']
 * @param {string} [opts.cancelText='Cancel']
 * @param {boolean} [opts.danger=false]  Destructive action → red confirm button.
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog(message, opts = {}) {
    const overlay = document.getElementById('app-confirm-dialog');
    if (!overlay) {
        // Fallback keeps behavior correct if the markup is ever missing.
        return Promise.resolve(window.confirm(message));
    }

    if (activeConfirmResolve) {
        activeConfirmResolve(false);
        activeConfirmResolve = null;
    }

    const titleEl = overlay.querySelector('#app-confirm-title');
    const messageEl = overlay.querySelector('#app-confirm-message');
    const okBtn = overlay.querySelector('#app-confirm-ok');
    const cancelBtn = overlay.querySelector('#app-confirm-cancel');

    titleEl.textContent = opts.title || 'Are you sure?';
    messageEl.textContent = message || '';
    okBtn.textContent = opts.confirmText || 'Confirm';
    cancelBtn.textContent = opts.cancelText || 'Cancel';
    okBtn.classList.toggle('btn-danger', !!opts.danger);
    okBtn.classList.toggle('btn-primary', !opts.danger);

    const previouslyFocused = document.activeElement;
    overlay.style.display = 'flex';

    return new Promise((resolve) => {
        activeConfirmResolve = resolve;

        const close = (result) => {
            overlay.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('mousedown', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus(); } catch { /* element may be gone */ }
            }
            if (activeConfirmResolve === resolve) activeConfirmResolve = null;
            resolve(result);
        };

        const onOk = () => close(true);
        const onCancel = () => close(false);
        const onBackdrop = (e) => { if (e.target === overlay) close(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(false); }
            else if (e.key === 'Enter') { e.stopPropagation(); close(true); }
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('mousedown', onBackdrop);
        document.addEventListener('keydown', onKey, true);

        // Danger defaults focus to the safe action; normal confirms to the primary.
        (opts.danger ? cancelBtn : okBtn).focus();
    });
}

// --- Generic Input Dialog (replacement for window.prompt) ------------------
// Electron renderers do not support window.prompt() at all (it throws), and
// native dialogs freeze the event loop anyway. Same non-blocking pattern as
// showConfirmDialog: resolves the entered string, or null on cancel/Escape.

let activeInputResolve = null;

/**
 * @param {object} [opts]
 * @param {string} [opts.title='Input']
 * @param {string} [opts.message='']      Short helper text above the field.
 * @param {string} [opts.placeholder='']
 * @param {string} [opts.confirmText='Import']
 * @param {string} [opts.initialValue='']
 * @param {boolean} [opts.mono=true]      Monospace field (code-like input).
 * @returns {Promise<string|null>}
 */
export function showInputDialog(opts = {}) {
    const overlay = document.getElementById('app-input-dialog');
    if (!overlay) return Promise.resolve(null);

    if (activeInputResolve) {
        activeInputResolve(null);
        activeInputResolve = null;
    }

    const titleEl = overlay.querySelector('#app-input-title');
    const messageEl = overlay.querySelector('#app-input-message');
    const field = overlay.querySelector('#app-input-textarea');
    const okBtn = overlay.querySelector('#app-input-ok');
    const cancelBtn = overlay.querySelector('#app-input-cancel');

    titleEl.textContent = opts.title || 'Input';
    messageEl.textContent = opts.message || '';
    messageEl.style.display = opts.message ? '' : 'none';
    field.placeholder = opts.placeholder || '';
    field.value = opts.initialValue || '';
    field.classList.toggle('mono', opts.mono !== false);
    const multiline = opts.multiline !== false;
    field.classList.toggle('single', !multiline);
    field.rows = multiline ? 6 : 1;
    okBtn.textContent = opts.confirmText || 'Import';

    const previouslyFocused = document.activeElement;
    overlay.style.display = 'flex';

    return new Promise((resolve) => {
        activeInputResolve = resolve;

        const close = (result) => {
            overlay.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('mousedown', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus(); } catch { /* element may be gone */ }
            }
            if (activeInputResolve === resolve) activeInputResolve = null;
            resolve(result);
        };

        const onOk = () => close(field.value);
        const onCancel = () => close(null);
        const onBackdrop = (e) => { if (e.target === overlay) close(null); };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(null); }
            // Multiline: Cmd/Ctrl+Enter confirms (plain Enter = newline).
            // Single-line: plain Enter confirms.
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !multiline)) {
                e.preventDefault(); e.stopPropagation(); close(field.value);
            }
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('mousedown', onBackdrop);
        document.addEventListener('keydown', onKey, true);

        field.focus();
    });
}

function handleVarDropdownListClick(e) {
    const varItem = e.target.closest('.var-item');
    if (varItem && varItem.dataset.var) {
        insertVariableIntoInput(varItem.dataset.var);
        hideVarDropdown();
    }
}
// --- Variable Dropdown (Managed by App) ---
let currentVarDropdown = { button: null, targetInput: null, targetId: null, handler: null };

export function initializeVarDropdownListeners() {
    if (!domRefs.varDropdown) return;
    const searchInput = domRefs.varDropdown.querySelector('.var-search');
    const varList = domRefs.varDropdown.querySelector('.var-list');
    const closeBtn = domRefs.varDropdown.querySelector('.var-close');
    const noResultsMsg = domRefs.varDropdown.querySelector('.no-results-msg');

    // These listeners are safe to re-add, but we can make them idempotent too for safety.
    if (searchInput) {
        searchInput.oninput = () => { // Using oninput overwrites previous, which is safe here
            const filter = searchInput.value.toLowerCase();
            let hasVisibleItems = false;
            varList?.querySelectorAll('.var-item').forEach(item => {
                const varName = item.dataset.var?.toLowerCase() || '';
                const isVisible = varName.includes(filter);
                item.style.display = isVisible ? '' : 'none';
                if (isVisible) hasVisibleItems = true;
            });
            if (noResultsMsg) noResultsMsg.style.display = hasVisibleItems ? 'none' : 'block';
        };
    }
    if (closeBtn) {
        closeBtn.onclick = () => hideVarDropdown(); // Using onclick is also safe
    }
    
    // --- THIS IS THE CRITICAL FIX ---
    // The varList listener must be managed carefully to prevent duplicates.
    if (varList) {
        // 1. Remove the previously attached listener using its named function reference.
        varList.removeEventListener('click', handleVarDropdownListClick);
        // 2. Add the listener back, ensuring there is now only one.
        varList.addEventListener('click', handleVarDropdownListClick);
    }
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
                    const specialVars = ['RANDOM_IP', 'RANDOM_INT', 'RANDOM_STRING'];
                    const varNames = Array.from(new Set([...Object.keys(currentVars), ...specialVars]));
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

export function insertVariableIntoInput(varName) {
    // Get the target input directly from the state object captured when the dropdown opened.
    const targetInput = currentVarDropdown.targetInput;

    // CRITICAL: Check if the target is still valid.
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

    try {
        const textToInsert = `{{${varName}}}`;
        const currentVal = targetInput.value;
        const selectionStart = targetInput.selectionStart;
        const selectionEnd = targetInput.selectionEnd;

        targetInput.value = currentVal.substring(0, selectionStart) + textToInsert + currentVal.substring(selectionEnd);

        const newCursorPos = selectionStart + textToInsert.length;
        targetInput.selectionStart = newCursorPos;
        targetInput.selectionEnd = newCursorPos;

        targetInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetInput.focus();

         // Mark editor dirty if appropriate
         const editorPanel = targetInput.closest('.step-editor-panel .step-editor');
         if (appState.builderComponent && editorPanel) {
              handleBuilderEditorDirtyChange(true);
         } else {
               const infoOverlay = targetInput.closest('.flow-info-overlay');
               if (infoOverlay) {
                   // No extra call needed; existing input listeners on these fields handle the dirty state.
               }
         }
    } catch (error) {
         console.error("Error inserting variable text:", error);
         showMessage("Failed to insert variable text.", "error");
    }
}
