
import { appState } from './state.js';
import { findStepById, generateUniqueId } from './flowCore.js';
import { showMessage } from './uiUtils.js'; // Needed for moveStepInModel

export function addNestedStepToModel(stepData, parentId, branch) {
    if (!parentId || !stepData) return false;
    const parentStep = findStepById(appState.currentFlowModel?.steps, parentId); // Use optional chaining
    if (!parentStep) return false;

    let added = false;
    if (parentStep.type === 'condition') {
        if (branch === 'then') {
            parentStep.thenSteps = parentStep.thenSteps || [];
            parentStep.thenSteps.push(stepData);
            added = true;
        } else if (branch === 'else') {
            parentStep.elseSteps = parentStep.elseSteps || [];
            parentStep.elseSteps.push(stepData);
            added = true;
        }
    } else if (parentStep.type === 'loop') {
        parentStep.loopSteps = parentStep.loopSteps || [];
        parentStep.loopSteps.push(stepData);
        added = true;
    } else {
        console.warn(`Cannot add nested step to parent of type ${parentStep.type}`);
        return false;
    }
    // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
    return added;
}

// --- [Modified Code] in app.js ---
// Finds step info including the parent array and index (crucial for modification)
export function findStepInfoRecursive(steps, idToFind, currentParentSteps = null, path = []) {
    // Ensure appState.currentFlowModel exists before accessing steps
    const rootSteps = appState.currentFlowModel?.steps;
    if (!steps || !rootSteps) return null; // Check model exists

    const parentArray = currentParentSteps || rootSteps; // Default to top-level

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        // Store path info: parent array ref, index in parent, step id, and optionally branch info if applicable
        const currentPathSegment = { parentSteps: parentArray, index: i, stepId: step.id };
        const currentFullPath = [...path, currentPathSegment];

        if (step.id === idToFind) {
            return { step: step, parentSteps: parentArray, index: i, path: currentFullPath };
        }

        let found = null;
        if (step.type === 'condition') {
            // Add branch info to path for children
            found = findStepInfoRecursive(step.thenSteps || [], idToFind, step.thenSteps, [...currentFullPath, { stepId: step.id, branch: 'then' }]);
            if (found) return found;
            found = findStepInfoRecursive(step.elseSteps || [], idToFind, step.elseSteps, [...currentFullPath, { stepId: step.id, branch: 'else' }]);
            if (found) return found;
        } else if (step.type === 'loop') {
            // Add loop info to path for children
            found = findStepInfoRecursive(step.loopSteps || [], idToFind, step.loopSteps, [...currentFullPath, { stepId: step.id, branch: 'loop' }]);
            if (found) return found;
        }
    }
    return null;
}

// --- [Modified Code] in app.js ---
export function moveStepInModel(sourceId, targetId, position) {
    if (!appState.currentFlowModel?.steps) return false; // Ensure model and steps exist

    try { // Add error handling block
        const sourceInfo = findStepInfoRecursive(appState.currentFlowModel.steps, sourceId);
        const targetInfo = findStepInfoRecursive(appState.currentFlowModel.steps, targetId);

        // --- Validation ---
        if (!sourceInfo) {
            throw new Error(`Move failed: Source step (ID: ${sourceId}) not found.`);
        }
        if (!targetInfo) {
             throw new Error(`Move failed: Target step (ID: ${targetId}) not found.`);
        }
        if (sourceId === targetId) {
            console.warn("Move ignored: Source and target are the same.");
            return false; // Cannot move onto itself
        }

        // --- Edge Case: Prevent dropping a parent into its own child branch/loop ---
        // Check if the target's path contains the source step's ID
        let isTargetInChildren = false;
        // Iterate through the path segments leading to the target. Each segment includes the stepId of its container.
        for (const pathSegment of targetInfo.path) {
            // Check if the container step's ID matches the source ID (excluding the target step itself)
             if (pathSegment.stepId === sourceId && targetInfo.step.id !== sourceId) { // If the source is one of the containers for the target
                isTargetInChildren = true;
                break;
            }
        }
        if (isTargetInChildren) {
            throw new Error("Invalid move: Cannot move a step into itself or one of its children.");
        }

        // --- Perform the move ---
        // 1. Remove source step
        const [sourceStep] = sourceInfo.parentSteps.splice(sourceInfo.index, 1);
        if (!sourceStep) {
             // This should be unlikely if sourceInfo was valid, but check for safety
            throw new Error("Move failed: Could not splice source step after finding it.");
        }

        // 2. Find target index AGAIN (indices might have shifted after removal)
        //    Important: Must search from the root again using the *same targetId*.
        const newTargetInfo = findStepInfoRecursive(appState.currentFlowModel.steps, targetId);

        if (!newTargetInfo) {
            // This can happen if the target was immediately after the source in the same array.
            // We need to figure out the correct insertion point based on the original target's parent.
            console.warn("Move adjustment: Target info shifted after source removal.");

            // Insert into the original target's parent array (targetInfo.parentSteps refers to the correct array *after* source splice).
            // If position was 'before' the target, insert at source's original index.
            // If position was 'after' the target, insert at source's original index (effect is still after the item that *was* before target).
            // This logic assumes drop target remains valid even if its index shifts.
            // The correct index in the original parent *after* removing source is just sourceInfo.index.
            const insertIndex = sourceInfo.index;
            targetInfo.parentSteps.splice(insertIndex, 0, sourceStep); // Use original target parent ref
            console.log(`Inserting ${sourceStep.id} into original parent at index ${insertIndex} (adjusted)`);

        } else {
             // Target still exists and was found again. Use its new info.
            // 3. Calculate insertion index within the target's NEW parent array
             const insertIndex = position === 'before' ? newTargetInfo.index : newTargetInfo.index + 1;

            // 4. Insert source step into the target's NEW parent array at the calculated index
            newTargetInfo.parentSteps.splice(insertIndex, 0, sourceStep);
            console.log(`Inserting ${sourceStep.id} into new target parent at index ${insertIndex}`);
        }

        // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
        return true;

    } catch (error) {
        console.error('Error moving step in model:', error);
        showMessage(`Error moving step: ${error.message}`, 'error'); // Show user-facing error
        // Consider reverting UI or model state if partial changes occurred, but complex.
        // For now, log and show message. Re-rendering might fix UI inconsistency.
        return false;
    }
}


export function deleteStepFromModel(stepId) {
    if (!appState.currentFlowModel?.steps) return false; // Ensure model and steps exist

    let deleted = false;
    const deleteRecursively = (steps) => {
        if (!steps || !Array.isArray(steps)) return null; // Return null for empty/invalid

        const filteredSteps = [];
        let changed = false; // Track changes at this level

        for (const step of steps) {
            if (step.id === stepId) {
                deleted = true;
                changed = true; // Mark change as we are skipping this step
                continue; // Skip this step
            }

            let currentStep = step; // Start with the original step
            if (step.type === 'condition') {
                const originalThen = step.thenSteps;
                const originalElse = step.elseSteps;
                const newThen = deleteRecursively(step.thenSteps);
                const newElse = deleteRecursively(step.elseSteps);
                // Create new step object only if children changed
                if (newThen !== originalThen || newElse !== originalElse) {
                    currentStep = { ...step, thenSteps: newThen || [], elseSteps: newElse || [] }; // Ensure arrays if null
                    changed = true; // Mark change as children were modified
                }
            } else if (step.type === 'loop') {
                 const originalLoop = step.loopSteps;
                 const newLoopSteps = deleteRecursively(step.loopSteps);
                 if (newLoopSteps !== originalLoop) {
                     currentStep = { ...step, loopSteps: newLoopSteps || [] }; // Ensure array if null
                     changed = true; // Mark change as children were modified
                 }
            }
             filteredSteps.push(currentStep); // Add the (potentially updated) step
        }

        // Return the original array if no changes were made at this level
         return changed ? filteredSteps : steps;
    };

    const originalSteps = appState.currentFlowModel.steps;
    const newSteps = deleteRecursively(originalSteps);

    // Update the model only if changes occurred
    if (newSteps !== originalSteps) {
         appState.currentFlowModel.steps = newSteps || []; // Ensure steps array exists even if all deleted
    }

    if (!deleted) {
        console.warn(`Delete step: Step with ID ${stepId} not found.`);
    }
    // Return true if the step was found and deleted
    // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
    return deleted;
}

export function cloneStepInModel(originalStepRef, newStepData) {
     if (!originalStepRef || !newStepData || !appState.currentFlowModel?.steps) return false;

     let inserted = false;
     const findAndInsertAfter = (steps) => {
         if (!steps || !Array.isArray(steps) || inserted) return steps; // Stop recursing if already inserted

         const resultSteps = [];
         let changed = false; // Track changes at this level

         for (let i = 0; i < steps.length; i++) {
             let currentStep = steps[i];
             resultSteps.push(currentStep); // Add original step first

             if (currentStep.id === originalStepRef.id) {
                 resultSteps.push(newStepData); // Insert clone immediately after original
                 inserted = true;
                 changed = true; // Mark change as we inserted
             } else if (!inserted) { // Only recurse if not yet inserted
                 if (currentStep.type === 'condition') {
                     const originalThen = currentStep.thenSteps;
                     const originalElse = currentStep.elseSteps;
                     const newThen = findAndInsertAfter(originalThen);
                     // Stop recursing into else if already inserted in then
                     const newElse = inserted ? originalElse : findAndInsertAfter(originalElse);
                     if (newThen !== originalThen || newElse !== originalElse) {
                          // Recreate step object if children changed
                          currentStep = { ...currentStep, thenSteps: newThen || [], elseSteps: newElse || [] }; // Ensure arrays
                          // Update the step in resultSteps array *in place* (it was already pushed)
                          resultSteps[resultSteps.length - 1] = currentStep;
                          changed = true;
                     }
                 } else if (currentStep.type === 'loop') {
                      const originalLoop = currentStep.loopSteps;
                      const newLoopSteps = findAndInsertAfter(originalLoop);
                      if (newLoopSteps !== originalLoop) {
                          currentStep = { ...currentStep, loopSteps: newLoopSteps || [] }; // Ensure array
                           resultSteps[resultSteps.length - 1] = currentStep;
                          changed = true;
                      }
                 }
             }
         }
         return changed ? resultSteps : steps; // Return new array only if changed
     };

     const originalSteps = appState.currentFlowModel.steps;
     const newSteps = findAndInsertAfter(originalSteps);

     if (newSteps !== originalSteps) {
        appState.currentFlowModel.steps = newSteps;
     }

     if (!inserted) {
         console.warn(`Clone step: Original step ID ${originalStepRef.id} not found.`);
     }
     // Do NOT call setDirty here, it's called by the caller (handleBuilderStepUpdate)
     return inserted;
}

// Helper for cloning (remains the same, used internally by fileOperations)
export function assignNewIdsRecursive(steps) {
    if (!steps || !Array.isArray(steps)) return [];
    return steps.map(step => {
        const newStep = { ...step, id: generateUniqueId() }; // Use imported generator
        if (newStep.type === 'condition') {
            newStep.thenSteps = assignNewIdsRecursive(newStep.thenSteps);
            newStep.elseSteps = assignNewIdsRecursive(newStep.elseSteps);
        } else if (newStep.type === 'loop') {
            newStep.loopSteps = assignNewIdsRecursive(newStep.loopSteps);
        }
        return newStep;
    });
}