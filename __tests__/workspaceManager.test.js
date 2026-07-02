import { describe, test, expect, beforeEach } from '@jest/globals';
import {
    WORKSPACE_SCHEMA_VERSION,
    createEmptyWorkspace,
    parseWorkspace,
    serializeWorkspace,
    addFolder,
    renameFolder,
    removeFolder,
    moveFolder,
    addFlow,
    removeFlow,
    moveFlowToFolder,
    setFlowTags,
    addFlowTag,
    removeFlowTag,
    setFlowCategory,
    getFlowEntry,
    listFlowsInFolder,
    listChildFolders
} from '../workspaceManager.js';

describe('workspaceManager', () => {
    describe('createEmptyWorkspace', () => {
        test('produces a versioned, empty workspace', () => {
            const ws = createEmptyWorkspace();
            expect(ws.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
            expect(Array.isArray(ws.folders)).toBe(true);
            expect(ws.folders).toHaveLength(0);
            expect(Array.isArray(ws.flows)).toBe(true);
            expect(ws.flows).toHaveLength(0);
        });

        test('returns a fresh object each call (no shared references)', () => {
            const a = createEmptyWorkspace();
            const b = createEmptyWorkspace();
            a.folders.push({ id: 'x' });
            expect(b.folders).toHaveLength(0);
        });
    });

    describe('parseWorkspace', () => {
        test('parses a valid workspace object', () => {
            const ws = createEmptyWorkspace();
            ws.flows.push({ path: '/a.flow.json', folderId: null, tags: [], category: null });
            const parsed = parseWorkspace(ws);
            expect(parsed.flows).toHaveLength(1);
            expect(parsed.flows[0].path).toBe('/a.flow.json');
        });

        test('parses a JSON string', () => {
            const parsed = parseWorkspace(JSON.stringify(createEmptyWorkspace()));
            expect(parsed.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
        });

        test('returns an empty workspace for null / undefined', () => {
            expect(parseWorkspace(null).flows).toHaveLength(0);
            expect(parseWorkspace(undefined).folders).toHaveLength(0);
        });

        test('returns an empty workspace for malformed JSON', () => {
            const parsed = parseWorkspace('{ not valid json');
            expect(parsed.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
            expect(parsed.flows).toHaveLength(0);
        });

        test('coerces missing arrays and normalizes flow entries', () => {
            const parsed = parseWorkspace({ schemaVersion: 1 });
            expect(parsed.folders).toEqual([]);
            expect(parsed.flows).toEqual([]);
        });

        test('normalizes flow entries with missing fields', () => {
            const parsed = parseWorkspace({ flows: [{ path: '/x.flow.json' }] });
            expect(parsed.flows[0]).toMatchObject({
                path: '/x.flow.json',
                folderId: null,
                tags: [],
                category: null
            });
        });

        test('drops flow entries without a path', () => {
            const parsed = parseWorkspace({ flows: [{ tags: ['a'] }, { path: '/ok.flow.json' }] });
            expect(parsed.flows).toHaveLength(1);
            expect(parsed.flows[0].path).toBe('/ok.flow.json');
        });

        test('drops folder entries without an id', () => {
            const parsed = parseWorkspace({ folders: [{ name: 'nope' }, { id: 'f1', name: 'ok' }] });
            expect(parsed.folders).toHaveLength(1);
            expect(parsed.folders[0].id).toBe('f1');
        });

        test('does not mutate the input object', () => {
            const input = { flows: [{ path: '/a.flow.json' }] };
            const snapshot = JSON.stringify(input);
            parseWorkspace(input);
            expect(JSON.stringify(input)).toBe(snapshot);
        });
    });

    describe('serializeWorkspace', () => {
        test('round-trips through parse', () => {
            const ws = createEmptyWorkspace();
            addFolder(ws, { id: 'f1', name: 'API Tests' });
            addFlow(ws, '/x.flow.json');
            const str = serializeWorkspace(ws);
            const parsed = parseWorkspace(str);
            expect(parsed.folders).toHaveLength(1);
            expect(parsed.flows).toHaveLength(1);
        });

        test('emits pretty-printed JSON', () => {
            const str = serializeWorkspace(createEmptyWorkspace());
            expect(str).toContain('\n');
        });
    });

    describe('folders', () => {
        let ws;
        beforeEach(() => { ws = createEmptyWorkspace(); });

        test('addFolder appends a folder with a generated id when none given', () => {
            const folder = addFolder(ws, { name: 'Smoke' });
            expect(folder.id).toEqual(expect.any(String));
            expect(folder.id.length).toBeGreaterThan(0);
            expect(folder.name).toBe('Smoke');
            expect(folder.parentId).toBeNull();
            expect(ws.folders).toHaveLength(1);
        });

        test('addFolder respects a provided id and parentId', () => {
            const parent = addFolder(ws, { name: 'Parent' });
            const child = addFolder(ws, { id: 'kid', name: 'Child', parentId: parent.id });
            expect(child.id).toBe('kid');
            expect(child.parentId).toBe(parent.id);
        });

        test('addFolder throws on duplicate id', () => {
            addFolder(ws, { id: 'dup', name: 'A' });
            expect(() => addFolder(ws, { id: 'dup', name: 'B' })).toThrow();
        });

        test('addFolder throws when parentId does not exist', () => {
            expect(() => addFolder(ws, { name: 'Orphan', parentId: 'ghost' })).toThrow();
        });

        test('renameFolder updates the name', () => {
            const f = addFolder(ws, { name: 'Old' });
            renameFolder(ws, f.id, 'New');
            expect(ws.folders[0].name).toBe('New');
        });

        test('renameFolder throws for unknown folder', () => {
            expect(() => renameFolder(ws, 'ghost', 'x')).toThrow();
        });

        test('moveFolder reparents a folder', () => {
            const a = addFolder(ws, { name: 'A' });
            const b = addFolder(ws, { name: 'B' });
            moveFolder(ws, b.id, a.id);
            expect(ws.folders.find(f => f.id === b.id).parentId).toBe(a.id);
        });

        test('moveFolder to root sets parentId null', () => {
            const a = addFolder(ws, { name: 'A' });
            const b = addFolder(ws, { name: 'B', parentId: a.id });
            moveFolder(ws, b.id, null);
            expect(ws.folders.find(f => f.id === b.id).parentId).toBeNull();
        });

        test('moveFolder rejects making a folder its own parent', () => {
            const a = addFolder(ws, { name: 'A' });
            expect(() => moveFolder(ws, a.id, a.id)).toThrow();
        });

        test('moveFolder rejects creating a cycle', () => {
            const a = addFolder(ws, { name: 'A' });
            const b = addFolder(ws, { name: 'B', parentId: a.id });
            const c = addFolder(ws, { name: 'C', parentId: b.id });
            // Moving A under C would create A->C->B->A cycle
            expect(() => moveFolder(ws, a.id, c.id)).toThrow();
        });

        test('removeFolder deletes the folder', () => {
            const f = addFolder(ws, { name: 'Gone' });
            removeFolder(ws, f.id);
            expect(ws.folders).toHaveLength(0);
        });

        test('removeFolder reparents child folders to the removed folder parent by default', () => {
            const root = addFolder(ws, { name: 'Root' });
            const mid = addFolder(ws, { name: 'Mid', parentId: root.id });
            const leaf = addFolder(ws, { name: 'Leaf', parentId: mid.id });
            removeFolder(ws, mid.id);
            expect(ws.folders.find(f => f.id === leaf.id).parentId).toBe(root.id);
        });

        test('removeFolder detaches flows in that folder (folderId -> null)', () => {
            const f = addFolder(ws, { name: 'F' });
            addFlow(ws, '/a.flow.json', { folderId: f.id });
            removeFolder(ws, f.id);
            expect(getFlowEntry(ws, '/a.flow.json').folderId).toBeNull();
        });

        test('listChildFolders returns direct children only', () => {
            const root = addFolder(ws, { name: 'Root' });
            addFolder(ws, { name: 'A', parentId: root.id });
            addFolder(ws, { name: 'B', parentId: root.id });
            const deep = addFolder(ws, { name: 'Deep' });
            addFolder(ws, { name: 'C', parentId: deep.id });
            expect(listChildFolders(ws, root.id)).toHaveLength(2);
            expect(listChildFolders(ws, null)).toHaveLength(2); // root + deep
        });
    });

    describe('flows', () => {
        let ws;
        beforeEach(() => { ws = createEmptyWorkspace(); });

        test('addFlow registers a flow at root with defaults', () => {
            const entry = addFlow(ws, '/x.flow.json');
            expect(entry.path).toBe('/x.flow.json');
            expect(entry.folderId).toBeNull();
            expect(entry.tags).toEqual([]);
            expect(entry.category).toBeNull();
            expect(ws.flows).toHaveLength(1);
        });

        test('addFlow is idempotent on path (returns existing entry, no duplicate)', () => {
            const a = addFlow(ws, '/x.flow.json', { tags: ['one'] });
            const b = addFlow(ws, '/x.flow.json');
            expect(ws.flows).toHaveLength(1);
            expect(b).toBe(a);
            expect(b.tags).toEqual(['one']);
        });

        test('addFlow throws for empty path', () => {
            expect(() => addFlow(ws, '')).toThrow();
            expect(() => addFlow(ws, null)).toThrow();
        });

        test('addFlow throws when folderId does not exist', () => {
            expect(() => addFlow(ws, '/x.flow.json', { folderId: 'ghost' })).toThrow();
        });

        test('addFlow accepts initial tags/category/folder', () => {
            const f = addFolder(ws, { name: 'F' });
            const entry = addFlow(ws, '/x.flow.json', { folderId: f.id, tags: ['smoke', 'smoke'], category: 'demo' });
            expect(entry.folderId).toBe(f.id);
            expect(entry.tags).toEqual(['smoke']); // deduped
            expect(entry.category).toBe('demo');
        });

        test('removeFlow deletes the entry', () => {
            addFlow(ws, '/x.flow.json');
            expect(removeFlow(ws, '/x.flow.json')).toBe(true);
            expect(ws.flows).toHaveLength(0);
        });

        test('removeFlow returns false when path is unknown', () => {
            expect(removeFlow(ws, '/nope.flow.json')).toBe(false);
        });

        test('moveFlowToFolder moves a flow into a folder', () => {
            const f = addFolder(ws, { name: 'F' });
            addFlow(ws, '/x.flow.json');
            moveFlowToFolder(ws, '/x.flow.json', f.id);
            expect(getFlowEntry(ws, '/x.flow.json').folderId).toBe(f.id);
        });

        test('moveFlowToFolder to null moves to root', () => {
            const f = addFolder(ws, { name: 'F' });
            addFlow(ws, '/x.flow.json', { folderId: f.id });
            moveFlowToFolder(ws, '/x.flow.json', null);
            expect(getFlowEntry(ws, '/x.flow.json').folderId).toBeNull();
        });

        test('moveFlowToFolder auto-registers an unknown flow path', () => {
            const f = addFolder(ws, { name: 'F' });
            moveFlowToFolder(ws, '/new.flow.json', f.id);
            expect(getFlowEntry(ws, '/new.flow.json').folderId).toBe(f.id);
        });

        test('moveFlowToFolder throws for unknown folder', () => {
            addFlow(ws, '/x.flow.json');
            expect(() => moveFlowToFolder(ws, '/x.flow.json', 'ghost')).toThrow();
        });

        test('listFlowsInFolder returns flows in a folder', () => {
            const f = addFolder(ws, { name: 'F' });
            addFlow(ws, '/a.flow.json', { folderId: f.id });
            addFlow(ws, '/b.flow.json');
            addFlow(ws, '/c.flow.json', { folderId: f.id });
            expect(listFlowsInFolder(ws, f.id).map(e => e.path).sort()).toEqual(['/a.flow.json', '/c.flow.json']);
            expect(listFlowsInFolder(ws, null).map(e => e.path)).toEqual(['/b.flow.json']);
        });
    });

    describe('tags & category', () => {
        let ws;
        beforeEach(() => { ws = createEmptyWorkspace(); addFlow(ws, '/x.flow.json'); });

        test('addFlowTag adds a tag', () => {
            addFlowTag(ws, '/x.flow.json', 'smoke');
            expect(getFlowEntry(ws, '/x.flow.json').tags).toEqual(['smoke']);
        });

        test('addFlowTag does not duplicate tags', () => {
            addFlowTag(ws, '/x.flow.json', 'smoke');
            addFlowTag(ws, '/x.flow.json', 'smoke');
            expect(getFlowEntry(ws, '/x.flow.json').tags).toEqual(['smoke']);
        });

        test('addFlowTag auto-registers an unknown flow', () => {
            addFlowTag(ws, '/new.flow.json', 'demo');
            expect(getFlowEntry(ws, '/new.flow.json').tags).toEqual(['demo']);
        });

        test('addFlowTag rejects empty tags', () => {
            expect(() => addFlowTag(ws, '/x.flow.json', '')).toThrow();
            expect(() => addFlowTag(ws, '/x.flow.json', '   ')).toThrow();
        });

        test('removeFlowTag removes a tag', () => {
            setFlowTags(ws, '/x.flow.json', ['a', 'b']);
            removeFlowTag(ws, '/x.flow.json', 'a');
            expect(getFlowEntry(ws, '/x.flow.json').tags).toEqual(['b']);
        });

        test('setFlowTags replaces tags and dedupes/trims', () => {
            setFlowTags(ws, '/x.flow.json', [' a ', 'a', 'b']);
            expect(getFlowEntry(ws, '/x.flow.json').tags).toEqual(['a', 'b']);
        });

        test('setFlowCategory sets and clears the category', () => {
            setFlowCategory(ws, '/x.flow.json', 'regression');
            expect(getFlowEntry(ws, '/x.flow.json').category).toBe('regression');
            setFlowCategory(ws, '/x.flow.json', null);
            expect(getFlowEntry(ws, '/x.flow.json').category).toBeNull();
        });
    });

    describe('getFlowEntry', () => {
        test('returns null for an unknown path', () => {
            const ws = createEmptyWorkspace();
            expect(getFlowEntry(ws, '/nope.flow.json')).toBeNull();
        });
    });
});
