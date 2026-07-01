// __tests__/fuzzySearch.test.js
// TDD spec for the Fuse.js-backed fuzzy search over recent files and steps.

import { searchFiles, searchSteps, filterList, flattenSteps } from '../fuzzySearch.js';

const files = [
    '/Users/me/flows/login-flow.flow.json',
    '/Users/me/flows/checkout-cart.flow.json',
    '/Users/me/work/user-profile.flow.json',
    '/Users/me/archive/legacy_export.flow.json'
];

const steps = [
    { id: 's1', name: 'Login Request', type: 'request', url: 'https://api/login' },
    { id: 's2', name: 'Check user profile', type: 'request', url: 'https://api/users/me' },
    { id: 's3', name: 'Loop over carts', type: 'loop' },
    {
        id: 's4', name: 'If admin', type: 'condition',
        then: [{ id: 's5', name: 'Grant access', type: 'request', url: 'https://api/grant' }],
        else: [{ id: 's6', name: 'Deny access', type: 'request' }]
    }
];

describe('searchFiles', () => {
    test('empty query returns all files in original order', () => {
        expect(searchFiles('', files)).toEqual(files);
    });

    test('whitespace-only query returns all files', () => {
        expect(searchFiles('   ', files)).toEqual(files);
    });

    test('matches on the basename, not just the full path', () => {
        const res = searchFiles('login', files);
        expect(res[0]).toBe('/Users/me/flows/login-flow.flow.json');
    });

    test('fuzzy / typo-tolerant match still finds the file', () => {
        const res = searchFiles('chekout', files); // missing a c
        expect(res).toContain('/Users/me/flows/checkout-cart.flow.json');
    });

    test('non-matching query returns an empty list', () => {
        expect(searchFiles('zzzzzzz-nope', files)).toEqual([]);
    });

    test('returns a plain array of the same string type as input (paths)', () => {
        const res = searchFiles('profile', files);
        expect(Array.isArray(res)).toBe(true);
        expect(res).toContain('/Users/me/work/user-profile.flow.json');
    });

    test('gracefully handles an empty/undefined file list', () => {
        expect(searchFiles('login', [])).toEqual([]);
        expect(searchFiles('login', undefined)).toEqual([]);
    });
});

describe('searchSteps', () => {
    test('empty query returns the full flattened step list (nested included)', () => {
        expect(searchSteps('', steps)).toEqual(flattenSteps(steps));
    });

    test('matches a top-level step by name', () => {
        const res = searchSteps('login', steps);
        const ids = res.map(s => s.id);
        expect(ids).toContain('s1');
    });

    test('matches a step nested inside a condition branch', () => {
        const res = searchSteps('grant', steps);
        const ids = res.map(s => s.id);
        expect(ids).toContain('s5');
    });

    test('matches on step url as well as name', () => {
        const res = searchSteps('users/me', steps);
        const ids = res.map(s => s.id);
        expect(ids).toContain('s2');
    });

    test('matches on step type', () => {
        const res = searchSteps('loop', steps);
        const ids = res.map(s => s.id);
        expect(ids).toContain('s3');
    });

    test('non-matching query returns empty', () => {
        expect(searchSteps('qqqqzz', steps)).toEqual([]);
    });

    test('handles empty / missing steps', () => {
        expect(searchSteps('x', [])).toEqual([]);
        expect(searchSteps('x', undefined)).toEqual([]);
    });
});

describe('filterList — generic key-based helper', () => {
    const items = [
        { label: 'Alpha widget', note: 'first' },
        { label: 'Beta gadget', note: 'second' },
        { label: 'Gamma widget', note: 'third' }
    ];

    test('filters objects by the provided keys', () => {
        const res = filterList('gadget', items, { keys: ['label', 'note'], threshold: 0.2 });
        expect(res).toHaveLength(1);
        expect(res[0].label).toBe('Beta gadget');
    });

    test('empty query returns the list as-is', () => {
        expect(filterList('', items, { keys: ['label'] })).toEqual(items);
    });
});
