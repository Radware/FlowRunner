// __tests__/jsonView.test.js
// WAVE2 node-features lane: read-only "View as JSON" panel with a
// diff-against-last-saved. Pure helpers (serialization + line diff) are tested
// here; the DOM panel is tested against a jsdom-mounted host.

import { jest } from '@jest/globals';
import {
    flowToPrettyJson,
    computeLineDiff,
    createJsonView,
} from '../jsonView.js';

const sampleFlow = () => ({
    id: 'flow-1',
    name: 'Sample',
    description: 'A demo',
    headers: { Authorization: 'Bearer {{token}}' },
    staticVars: { token: 'abc' },
    steps: [
        { id: 's1', name: 'Login', type: 'request', method: 'POST', url: 'https://api/login' },
    ],
});

describe('flowToPrettyJson (pure)', () => {
    test('serializes a flow model to indented JSON text', () => {
        const text = flowToPrettyJson(sampleFlow());
        expect(text).toContain('"name": "Sample"');
        // Two-space indentation (pretty-printed)
        expect(text).toMatch(/\n {2}"name"/);
    });

    test('is stable / deterministic for the same model', () => {
        const a = flowToPrettyJson(sampleFlow());
        const b = flowToPrettyJson(sampleFlow());
        expect(a).toBe(b);
    });

    test('produces valid, re-parseable JSON', () => {
        const text = flowToPrettyJson(sampleFlow());
        expect(() => JSON.parse(text)).not.toThrow();
        expect(JSON.parse(text).name).toBe('Sample');
    });

    test('handles a null / empty model without throwing', () => {
        expect(() => flowToPrettyJson(null)).not.toThrow();
        expect(flowToPrettyJson(null)).toBe('');
    });
});

describe('computeLineDiff (pure)', () => {
    test('reports every line as unchanged for identical text', () => {
        const text = 'a\nb\nc';
        const diff = computeLineDiff(text, text);
        expect(diff.every((d) => d.type === 'context')).toBe(true);
        expect(diff.map((d) => d.text)).toEqual(['a', 'b', 'c']);
    });

    test('flags an added line', () => {
        const diff = computeLineDiff('a\nb', 'a\nb\nc');
        const added = diff.filter((d) => d.type === 'add');
        expect(added.length).toBe(1);
        expect(added[0].text).toBe('c');
    });

    test('flags a removed line', () => {
        const diff = computeLineDiff('a\nb\nc', 'a\nc');
        const removed = diff.filter((d) => d.type === 'remove');
        expect(removed.length).toBe(1);
        expect(removed[0].text).toBe('b');
    });

    test('a changed line shows as one remove + one add', () => {
        const diff = computeLineDiff('a\nb\nc', 'a\nB\nc');
        expect(diff.filter((d) => d.type === 'remove').map((d) => d.text)).toContain('b');
        expect(diff.filter((d) => d.type === 'add').map((d) => d.text)).toContain('B');
    });

    test('reports hasChanges = false only when equal', () => {
        expect(computeLineDiff('x', 'x').some((d) => d.type !== 'context')).toBe(false);
        expect(computeLineDiff('x', 'y').some((d) => d.type !== 'context')).toBe(true);
    });

    test('handles an empty baseline (all lines added)', () => {
        const diff = computeLineDiff('', 'a\nb');
        const added = diff.filter((d) => d.type === 'add');
        expect(added.map((d) => d.text)).toEqual(['a', 'b']);
    });
});

describe('createJsonView (DOM panel)', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    afterEach(() => {
        host.remove();
    });

    test('renders read-only JSON (no editable inputs/textarea)', () => {
        const view = createJsonView({ mount: host });
        view.update({ model: sampleFlow(), savedJson: null });
        const editable = host.querySelectorAll('textarea, input, [contenteditable="true"]');
        expect(editable.length).toBe(0);
        expect(host.textContent).toContain('"name": "Sample"');
        view.destroy();
    });

    test('shows "no unsaved changes" when current matches savedJson', () => {
        const view = createJsonView({ mount: host });
        const saved = flowToPrettyJson(sampleFlow());
        view.update({ model: sampleFlow(), savedJson: saved });
        expect(view.hasChanges()).toBe(false);
        view.destroy();
    });

    test('marks changes and renders add/remove rows when model differs from saved', () => {
        const view = createJsonView({ mount: host });
        const saved = flowToPrettyJson(sampleFlow());
        const changed = sampleFlow();
        changed.name = 'Renamed';
        view.update({ model: changed, savedJson: saved });
        expect(view.hasChanges()).toBe(true);
        // Diff view should surface at least one add and one remove row.
        expect(host.querySelector('.jsonview-line.add')).not.toBeNull();
        expect(host.querySelector('.jsonview-line.remove')).not.toBeNull();
        view.destroy();
    });

    test('treats a brand-new (never-saved) flow as fully added', () => {
        const view = createJsonView({ mount: host });
        view.update({ model: sampleFlow(), savedJson: null });
        // Everything is new when there is no saved baseline.
        expect(view.hasChanges()).toBe(true);
        expect(host.querySelector('.jsonview-line.add')).not.toBeNull();
        view.destroy();
    });

    test('toggling to full-JSON mode renders the raw pretty JSON', () => {
        const view = createJsonView({ mount: host });
        view.update({ model: sampleFlow(), savedJson: flowToPrettyJson(sampleFlow()) });
        const toggle = host.querySelector('.jsonview-mode-toggle');
        expect(toggle).not.toBeNull();
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(host.querySelector('.jsonview-raw')).not.toBeNull();
        expect(host.textContent).toContain('"name": "Sample"');
        view.destroy();
    });

    test('update() with a null model clears to an empty state', () => {
        const view = createJsonView({ mount: host });
        view.update({ model: null, savedJson: null });
        expect(host.querySelector('.jsonview-empty')).not.toBeNull();
        expect(view.hasChanges()).toBe(false);
        view.destroy();
    });

    test('destroy() removes the panel DOM', () => {
        const view = createJsonView({ mount: host });
        view.update({ model: sampleFlow(), savedJson: null });
        view.destroy();
        expect(host.querySelector('.jsonview-panel')).toBeNull();
    });
});
