import { describe, test, expect } from '@jest/globals';
import { createListSelection, formatRunLabel } from '../listSelection.js';

describe('createListSelection', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];

    test('starts empty', () => {
        const s = createListSelection();
        expect(s.isEmpty()).toBe(true);
        expect(s.size()).toBe(0);
        expect(s.list()).toEqual([]);
        expect(s.anchor()).toBeNull();
    });

    test('toggle adds, re-toggle removes, sets/clears anchor', () => {
        const s = createListSelection();
        expect(s.toggle('b')).toBe(true);
        expect(s.has('b')).toBe(true);
        expect(s.anchor()).toBe('b');
        expect(s.toggle('b')).toBe(false);
        expect(s.has('b')).toBe(false);
        expect(s.anchor()).toBeNull();
    });

    test('range extends from the anchor over the ordered list, inclusive', () => {
        const s = createListSelection();
        s.toggle('b');            // anchor = b
        s.range('d', order);      // b..d
        expect(s.list().sort()).toEqual(['b', 'c', 'd']);
    });

    test('range with no anchor just selects the clicked row', () => {
        const s = createListSelection();
        s.range('c', order);
        expect(s.list()).toEqual(['c']);
    });

    test('range preserves selections outside the range', () => {
        const s = createListSelection();
        s.toggle('a');            // keep a (anchor = a)
        s.toggle('c');            // anchor = c
        s.range('e', order);      // c..e, a survives
        expect(s.list().sort()).toEqual(['a', 'c', 'd', 'e']);
    });

    test('set replaces everything and anchors on the last', () => {
        const s = createListSelection();
        s.toggle('a'); s.toggle('b');
        s.set(['x']);
        expect(s.list()).toEqual(['x']);
        expect(s.anchor()).toBe('x');
    });

    test('all adds every ordered path', () => {
        const s = createListSelection();
        s.toggle('c');
        s.all(order);
        expect(s.list().sort()).toEqual(order);
        expect(s.has('c')).toBe(true);
    });

    test('retain drops paths that no longer exist', () => {
        const s = createListSelection();
        s.set(['a', 'b', 'c']);   // anchor = c
        s.retain(['a', 'c']);
        expect(s.list().sort()).toEqual(['a', 'c']);
        s.retain(['a']);          // drops c, which was the anchor
        expect(s.anchor()).toBeNull();
    });

    test('clear empties selection and anchor', () => {
        const s = createListSelection();
        s.set(['a', 'b']);
        s.clear();
        expect(s.isEmpty()).toBe(true);
        expect(s.anchor()).toBeNull();
    });
});

describe('formatRunLabel', () => {
    test('singular / zero', () => {
        expect(formatRunLabel(0)).toBe('Run in background');
        expect(formatRunLabel(1)).toBe('Run in background');
    });
    test('plural, full and compact', () => {
        expect(formatRunLabel(3)).toBe('Run 3 flows in background');
        expect(formatRunLabel(3, { compact: true })).toBe('Run 3 in background');
    });
    test('no em dashes ever', () => {
        for (let n = 0; n < 5; n++) expect(formatRunLabel(n)).not.toMatch(/—|--/);
    });
});
