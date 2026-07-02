// __tests__/palette.test.js
// WAVE2 node-features lane: reusable command/search palette overlay.
// The fuzzy-match core is a pure function tested exhaustively here; the DOM
// overlay is tested against a jsdom-mounted host element.

import { jest } from '@jest/globals';
import {
    fuzzyMatch,
    fuzzyFilter,
    getStepTypeItems,
    createPalette,
} from '../palette.js';

describe('fuzzyMatch (pure)', () => {
    test('returns null when characters are not a subsequence', () => {
        expect(fuzzyMatch('xyz', 'request')).toBeNull();
        expect(fuzzyMatch('qz', 'request')).toBeNull();
    });

    test('matches a subsequence and returns a numeric score', () => {
        const m = fuzzyMatch('req', 'request');
        expect(m).not.toBeNull();
        expect(typeof m.score).toBe('number');
    });

    test('empty query matches everything with a neutral score', () => {
        const m = fuzzyMatch('', 'anything');
        expect(m).not.toBeNull();
        expect(m.score).toBe(0);
    });

    test('is case-insensitive', () => {
        expect(fuzzyMatch('REQ', 'request')).not.toBeNull();
        expect(fuzzyMatch('req', 'REQUEST')).not.toBeNull();
    });

    test('a prefix / contiguous match scores higher than a scattered one', () => {
        const contiguous = fuzzyMatch('req', 'request');
        const scattered = fuzzyMatch('rst', 'request'); // r..s...t scattered
        expect(contiguous.score).toBeGreaterThan(scattered.score);
    });

    test('a match at the start scores higher than the same run later', () => {
        const atStart = fuzzyMatch('load', 'load flow');
        const later = fuzzyMatch('load', 'reload flow');
        expect(atStart.score).toBeGreaterThan(later.score);
    });

    test('returns match index positions for highlighting', () => {
        const m = fuzzyMatch('rq', 'request');
        expect(Array.isArray(m.indices)).toBe(true);
        expect(m.indices[0]).toBe(0); // 'r' at 0
        // 'q' appears at index 2 in "request" (r-e-q-u-e-s-t)
        expect(m.indices).toContain(2);
    });
});

describe('fuzzyFilter (pure)', () => {
    const items = [
        { id: 'a', label: 'Open Recent Flow' },
        { id: 'b', label: 'Save Flow' },
        { id: 'c', label: 'Add Request Step' },
        { id: 'd', label: 'Toggle Minimap' },
    ];
    const keyFn = (it) => it.label;

    test('returns all items (order preserved) for an empty query', () => {
        const out = fuzzyFilter('', items, keyFn);
        expect(out.map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('filters out non-matching items', () => {
        const out = fuzzyFilter('zzz', items, keyFn);
        expect(out).toEqual([]);
    });

    test('ranks better matches first', () => {
        const out = fuzzyFilter('save', items, keyFn);
        expect(out.length).toBe(1);
        expect(out[0].item.id).toBe('b');
    });

    test('returns the match object (with indices) alongside each item', () => {
        const out = fuzzyFilter('req', items, keyFn);
        expect(out[0].item.id).toBe('c');
        expect(out[0].match).not.toBeNull();
        expect(Array.isArray(out[0].match.indices)).toBe(true);
    });

    test('is stable for equal scores (input order kept)', () => {
        const dupes = [
            { id: '1', label: 'flow' },
            { id: '2', label: 'flow' },
        ];
        const out = fuzzyFilter('flow', dupes, keyFn);
        expect(out.map((r) => r.item.id)).toEqual(['1', '2']);
    });
});

describe('getStepTypeItems', () => {
    test('returns the four known step types with type + label', () => {
        const items = getStepTypeItems();
        const types = items.map((i) => i.type).sort();
        expect(types).toEqual(['condition', 'loop', 'request', 'transform']);
        for (const it of items) {
            expect(typeof it.label).toBe('string');
            expect(it.label.length).toBeGreaterThan(0);
        }
    });
});

describe('createPalette (DOM overlay)', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    afterEach(() => {
        host.remove();
    });

    function makeItems() {
        return [
            { id: 'a', label: 'Save Flow', action: jest.fn() },
            { id: 'b', label: 'Open Recent', action: jest.fn() },
            { id: 'c', label: 'Add Request', action: jest.fn() },
        ];
    }

    test('is closed initially and renders no visible root until opened', () => {
        const p = createPalette({ mount: host });
        expect(p.isOpen()).toBe(false);
        p.destroy();
    });

    test('open() shows the overlay and populates the list', () => {
        const p = createPalette({ mount: host });
        p.open({ items: makeItems() });
        expect(p.isOpen()).toBe(true);
        const rows = host.querySelectorAll('.palette-item');
        expect(rows.length).toBe(3);
        p.destroy();
    });

    test('typing in the search input filters the list', () => {
        const p = createPalette({ mount: host });
        p.open({ items: makeItems() });
        const input = host.querySelector('.palette-search');
        input.value = 'save';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const rows = host.querySelectorAll('.palette-item');
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('Save Flow');
        p.destroy();
    });

    test('clicking an item invokes its action and closes the palette', () => {
        const items = makeItems();
        const p = createPalette({ mount: host });
        p.open({ items });
        const row = host.querySelector('.palette-item');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(items[0].action).toHaveBeenCalledTimes(1);
        expect(p.isOpen()).toBe(false);
        p.destroy();
    });

    test('onSelect callback receives the chosen item when provided', () => {
        const onSelect = jest.fn();
        const items = makeItems();
        const p = createPalette({ mount: host });
        p.open({ items, onSelect });
        host.querySelector('.palette-item').dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        expect(onSelect).toHaveBeenCalledWith(items[0]);
        p.destroy();
    });

    test('Enter activates the highlighted (first) item', () => {
        const items = makeItems();
        const p = createPalette({ mount: host });
        p.open({ items });
        const input = host.querySelector('.palette-search');
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        expect(items[0].action).toHaveBeenCalledTimes(1);
        p.destroy();
    });

    test('ArrowDown moves the active selection', () => {
        const items = makeItems();
        const p = createPalette({ mount: host });
        p.open({ items });
        const input = host.querySelector('.palette-search');
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
        );
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        expect(items[1].action).toHaveBeenCalledTimes(1);
        expect(items[0].action).not.toHaveBeenCalled();
        p.destroy();
    });

    test('Escape closes the palette without selecting', () => {
        const items = makeItems();
        const p = createPalette({ mount: host });
        p.open({ items });
        const input = host.querySelector('.palette-search');
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        expect(p.isOpen()).toBe(false);
        for (const it of items) expect(it.action).not.toHaveBeenCalled();
        p.destroy();
    });

    test('clicking the backdrop closes the palette', () => {
        const p = createPalette({ mount: host });
        p.open({ items: makeItems() });
        const backdrop = host.querySelector('.palette-overlay');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(p.isOpen()).toBe(false);
        p.destroy();
    });

    test('placeholder can be customised per open() call', () => {
        const p = createPalette({ mount: host });
        p.open({ items: makeItems(), placeholder: 'Search step types…' });
        const input = host.querySelector('.palette-search');
        expect(input.getAttribute('placeholder')).toBe('Search step types…');
        p.destroy();
    });

    test('shows an empty-state message when nothing matches', () => {
        const p = createPalette({ mount: host });
        p.open({ items: makeItems() });
        const input = host.querySelector('.palette-search');
        input.value = 'zzzzzz';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(host.querySelectorAll('.palette-item').length).toBe(0);
        expect(host.querySelector('.palette-empty')).not.toBeNull();
        p.destroy();
    });

    test('destroy() removes the overlay DOM from the mount', () => {
        const p = createPalette({ mount: host });
        p.open({ items: makeItems() });
        p.destroy();
        expect(host.querySelector('.palette-overlay')).toBeNull();
    });
});
