// ========== FILE: workspaceManager.js ==========
// Pure data-layer for the FlowRunner sidecar WORKSPACE model.
//
// The workspace organizes flows (by absolute path) into folders, and decorates
// them with tags[] and an optional category. It is persisted OUT-OF-BAND in a
// sidecar file (`.flowrunner/workspace.json`) and NEVER inside a `.flow.json`.
//
// WHY sidecar-only: the `.flow.json` format is a cross-app contract (FlowRunner
// UI, flowrunner-cli, ShowRunner portal). Adding organization fields to the flow
// file is lossy through FlowRunner's own reader (`jsonToFlowModel` drops unknown
// keys on re-save) and violates the additive-only contract. Keeping org metadata
// in a sidecar keeps every `.flow.json` byte-clean and git-diffable.
//
// SHAPE (loosely aligned with the ShowRunner portal for future interop):
//   {
//     schemaVersion: 1,
//     folders: [{ id, name, parentId, category?, tags? }],   // parent_id tree
//     flows:   [{ path, folderId, tags: [], category }]        // reference by path
//   }
//
// This module is intentionally free of Electron / Node `fs` imports so it can be
// unit-tested under Jest+jsdom and reused from either process. Persistence I/O
// (reading/writing the sidecar file) is handled by the caller (main.js via IPC),
// which serializes with `serializeWorkspace` and rehydrates with `parseWorkspace`.

export const WORKSPACE_SCHEMA_VERSION = 1;

// --- id generation -------------------------------------------------------

function generateId() {
    // Prefer a real UUID (aligns with ShowRunner's UUID folder ids). Fall back to
    // a random string for environments where crypto.randomUUID is unavailable.
    try {
        if (typeof globalThis !== 'undefined'
            && globalThis.crypto
            && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }
    } catch (_) { /* ignore and fall through */ }
    return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// --- construction / normalization ---------------------------------------

/**
 * Create a fresh, empty workspace object.
 * @returns {{schemaVersion:number, folders:Array, flows:Array}}
 */
export function createEmptyWorkspace() {
    return {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        folders: [],
        flows: []
    };
}

function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of tags) {
        if (typeof raw !== 'string') continue;
        const t = raw.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

function normalizeFolder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
    return {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : '',
        parentId: (typeof raw.parentId === 'string' && raw.parentId.length > 0) ? raw.parentId : null,
        tags: normalizeTags(raw.tags),
        category: (typeof raw.category === 'string' && raw.category.length > 0) ? raw.category : null
    };
}

function normalizeFlowEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.path !== 'string' || raw.path.length === 0) return null;
    return {
        path: raw.path,
        folderId: (typeof raw.folderId === 'string' && raw.folderId.length > 0) ? raw.folderId : null,
        tags: normalizeTags(raw.tags),
        category: (typeof raw.category === 'string' && raw.category.length > 0) ? raw.category : null
    };
}

/**
 * Parse / rehydrate a workspace from either a JSON string, a plain object, or
 * null/undefined. Always returns a valid, normalized workspace — corrupt or
 * partial input degrades gracefully to an empty (or best-effort) workspace
 * rather than throwing. Does NOT mutate the input.
 * @param {string|object|null|undefined} input
 * @returns {{schemaVersion:number, folders:Array, flows:Array}}
 */
export function parseWorkspace(input) {
    let obj = input;
    if (typeof input === 'string') {
        try {
            obj = JSON.parse(input);
        } catch (_) {
            return createEmptyWorkspace();
        }
    }
    if (!obj || typeof obj !== 'object') {
        return createEmptyWorkspace();
    }

    const folders = Array.isArray(obj.folders)
        ? obj.folders.map(normalizeFolder).filter(Boolean)
        : [];
    const flows = Array.isArray(obj.flows)
        ? obj.flows.map(normalizeFlowEntry).filter(Boolean)
        : [];

    return {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        folders,
        flows
    };
}

/**
 * Serialize a workspace to a pretty-printed JSON string suitable for writing to
 * the sidecar file. Runs the workspace through normalization first so a clean,
 * canonical shape is always written.
 * @param {object} workspace
 * @returns {string}
 */
export function serializeWorkspace(workspace) {
    return JSON.stringify(parseWorkspace(workspace), null, 2);
}

// --- internal lookups ----------------------------------------------------

function findFolder(workspace, folderId) {
    return workspace.folders.find(f => f.id === folderId) || null;
}

function assertFolderExists(workspace, folderId) {
    if (folderId === null || folderId === undefined) return;
    if (!findFolder(workspace, folderId)) {
        throw new Error(`Unknown folder id: ${folderId}`);
    }
}

function isDescendantOf(workspace, candidateId, ancestorId) {
    // Returns true if candidateId is ancestorId or sits somewhere below it.
    let cursor = candidateId;
    const guard = new Set();
    while (cursor) {
        if (cursor === ancestorId) return true;
        if (guard.has(cursor)) break; // pre-existing cycle safety
        guard.add(cursor);
        const folder = findFolder(workspace, cursor);
        cursor = folder ? folder.parentId : null;
    }
    return false;
}

// --- folder operations ---------------------------------------------------

/**
 * Add a folder. Generates a UUID id when none is supplied.
 * @param {object} workspace
 * @param {{id?:string, name?:string, parentId?:string|null, tags?:string[], category?:string|null}} [opts]
 * @returns {object} the created folder
 */
export function addFolder(workspace, opts = {}) {
    const id = (typeof opts.id === 'string' && opts.id.length > 0) ? opts.id : generateId();
    if (findFolder(workspace, id)) {
        throw new Error(`Folder id already exists: ${id}`);
    }
    const parentId = (typeof opts.parentId === 'string' && opts.parentId.length > 0) ? opts.parentId : null;
    assertFolderExists(workspace, parentId);

    const folder = {
        id,
        name: typeof opts.name === 'string' ? opts.name : '',
        parentId,
        tags: normalizeTags(opts.tags),
        category: (typeof opts.category === 'string' && opts.category.length > 0) ? opts.category : null
    };
    workspace.folders.push(folder);
    return folder;
}

/**
 * Rename a folder.
 * @returns {object} the updated folder
 */
export function renameFolder(workspace, folderId, name) {
    const folder = findFolder(workspace, folderId);
    if (!folder) throw new Error(`Unknown folder id: ${folderId}`);
    folder.name = typeof name === 'string' ? name : '';
    return folder;
}

/**
 * Reparent a folder. Pass newParentId=null to move it to the root. Rejects
 * self-parenting and cycles.
 * @returns {object} the moved folder
 */
export function moveFolder(workspace, folderId, newParentId) {
    const folder = findFolder(workspace, folderId);
    if (!folder) throw new Error(`Unknown folder id: ${folderId}`);

    const parentId = (typeof newParentId === 'string' && newParentId.length > 0) ? newParentId : null;
    if (parentId === folderId) {
        throw new Error('A folder cannot be its own parent.');
    }
    if (parentId !== null) {
        assertFolderExists(workspace, parentId);
        // Moving under one of its own descendants would create a cycle.
        if (isDescendantOf(workspace, parentId, folderId)) {
            throw new Error('Cannot move a folder into its own descendant.');
        }
    }
    folder.parentId = parentId;
    return folder;
}

/**
 * Remove a folder. Child folders are reparented to the removed folder's parent
 * (they are NOT deleted), and any flows referencing it are detached to root
 * (folderId -> null). This is deliberately non-destructive to flow references.
 * @returns {boolean} true if a folder was removed
 */
export function removeFolder(workspace, folderId) {
    const idx = workspace.folders.findIndex(f => f.id === folderId);
    if (idx === -1) return false;
    const removed = workspace.folders[idx];

    // Reparent direct children to the removed folder's parent.
    for (const child of workspace.folders) {
        if (child.parentId === folderId) {
            child.parentId = removed.parentId;
        }
    }
    // Detach flows that lived in this folder.
    for (const entry of workspace.flows) {
        if (entry.folderId === folderId) {
            entry.folderId = null;
        }
    }
    workspace.folders.splice(idx, 1);
    return true;
}

/**
 * List the direct child folders of a given folder (or of the root when
 * parentId is null/undefined).
 * @returns {object[]}
 */
export function listChildFolders(workspace, parentId = null) {
    const pid = (typeof parentId === 'string' && parentId.length > 0) ? parentId : null;
    return workspace.folders.filter(f => f.parentId === pid);
}

// --- flow operations -----------------------------------------------------

/**
 * Look up a flow entry by path.
 * @returns {object|null}
 */
export function getFlowEntry(workspace, flowPath) {
    return workspace.flows.find(e => e.path === flowPath) || null;
}

function requireFlowPath(flowPath) {
    if (typeof flowPath !== 'string' || flowPath.length === 0) {
        throw new Error('A non-empty flow path is required.');
    }
}

/**
 * Register a flow in the workspace. Idempotent on path: if the flow is already
 * registered, the existing entry is returned unchanged (initial opts are NOT
 * re-applied). Use the mutation helpers to update an existing entry.
 * @param {object} workspace
 * @param {string} flowPath absolute path to the `.flow.json`
 * @param {{folderId?:string|null, tags?:string[], category?:string|null}} [opts]
 * @returns {object} the flow entry
 */
export function addFlow(workspace, flowPath, opts = {}) {
    requireFlowPath(flowPath);
    const existing = getFlowEntry(workspace, flowPath);
    if (existing) return existing;

    const folderId = (typeof opts.folderId === 'string' && opts.folderId.length > 0) ? opts.folderId : null;
    assertFolderExists(workspace, folderId);

    const entry = {
        path: flowPath,
        folderId,
        tags: normalizeTags(opts.tags),
        category: (typeof opts.category === 'string' && opts.category.length > 0) ? opts.category : null
    };
    workspace.flows.push(entry);
    return entry;
}

/**
 * Remove a flow reference from the workspace. Does NOT touch the file on disk.
 * @returns {boolean} true if an entry was removed
 */
export function removeFlow(workspace, flowPath) {
    const idx = workspace.flows.findIndex(e => e.path === flowPath);
    if (idx === -1) return false;
    workspace.flows.splice(idx, 1);
    return true;
}

/**
 * Move a flow into a folder (or to root with folderId=null). Auto-registers the
 * flow if it is not already known.
 * @returns {object} the flow entry
 */
export function moveFlowToFolder(workspace, flowPath, folderId) {
    requireFlowPath(flowPath);
    const targetFolderId = (typeof folderId === 'string' && folderId.length > 0) ? folderId : null;
    assertFolderExists(workspace, targetFolderId);

    const entry = getFlowEntry(workspace, flowPath) || addFlow(workspace, flowPath);
    entry.folderId = targetFolderId;
    return entry;
}

/**
 * List flows in a folder (or at the root when folderId is null/undefined).
 * @returns {object[]}
 */
export function listFlowsInFolder(workspace, folderId = null) {
    const fid = (typeof folderId === 'string' && folderId.length > 0) ? folderId : null;
    return workspace.flows.filter(e => e.folderId === fid);
}

// --- tags & category -----------------------------------------------------

/**
 * Replace a flow's tags wholesale (deduped/trimmed). Auto-registers the flow.
 * @returns {object} the flow entry
 */
export function setFlowTags(workspace, flowPath, tags) {
    requireFlowPath(flowPath);
    const entry = getFlowEntry(workspace, flowPath) || addFlow(workspace, flowPath);
    entry.tags = normalizeTags(tags);
    return entry;
}

/**
 * Add a single tag to a flow (no duplicates). Auto-registers the flow.
 * @returns {object} the flow entry
 */
export function addFlowTag(workspace, flowPath, tag) {
    requireFlowPath(flowPath);
    if (typeof tag !== 'string' || tag.trim().length === 0) {
        throw new Error('A non-empty tag is required.');
    }
    const entry = getFlowEntry(workspace, flowPath) || addFlow(workspace, flowPath);
    const t = tag.trim();
    if (!entry.tags.includes(t)) {
        entry.tags.push(t);
    }
    return entry;
}

/**
 * Remove a single tag from a flow.
 * @returns {object|null} the flow entry, or null if the flow is unknown
 */
export function removeFlowTag(workspace, flowPath, tag) {
    const entry = getFlowEntry(workspace, flowPath);
    if (!entry) return null;
    const t = typeof tag === 'string' ? tag.trim() : tag;
    entry.tags = entry.tags.filter(x => x !== t);
    return entry;
}

/**
 * Set (or clear, with null) a flow's category. Auto-registers the flow.
 * @returns {object} the flow entry
 */
export function setFlowCategory(workspace, flowPath, category) {
    requireFlowPath(flowPath);
    const entry = getFlowEntry(workspace, flowPath) || addFlow(workspace, flowPath);
    entry.category = (typeof category === 'string' && category.length > 0) ? category : null;
    return entry;
}
