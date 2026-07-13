import { describe, test, expect } from '@jest/globals';
import {
    truncateBody, bodySkeleton, pathResolves,
    validateExtractions, validateAssertions, validateCondition, validateRequestDraft,
    OPERATORS, ASSERTION_OPERATOR_SUBSET, CONDITION_OPERATOR_SUBSET,
} from '../aiFeatures.js';

describe('truncateBody', () => {
    test('short values pass through', () => {
        expect(truncateBody('hello')).toBe('hello');
        expect(truncateBody({ a: 1 })).toContain('"a": 1');
        expect(truncateBody(null)).toBe('(no body)');
    });
    test('long values keep head and tail with a marker', () => {
        const long = 'x'.repeat(10000);
        const out = truncateBody(long, 1000);
        expect(out.length).toBeLessThan(1200);
        expect(out).toContain('chars omitted');
        expect(out.startsWith('xxx')).toBe(true);
        expect(out.endsWith('xxx')).toBe(true);
    });
});

describe('bodySkeleton', () => {
    test('keeps keys, samples arrays to first element with count', () => {
        const body = { items: [{ id: 1, name: 'a' }, { id: 2 }, { id: 3 }], total: 3 };
        const sk = bodySkeleton(body);
        expect(sk.total).toBe(3);
        expect(sk.items[0]).toEqual({ id: 1, name: 'a' });
        expect(String(sk.items[1])).toContain('3 items');
    });
    test('truncates long strings and caps depth', () => {
        const sk = bodySkeleton({ s: 'y'.repeat(200), deep: { a: { b: { c: { d: { e: 1 } } } } } });
        expect(sk.s.length).toBeLessThanOrEqual(60);
        expect(JSON.stringify(sk)).toContain('…');
    });
});

describe('pathResolves', () => {
    const result = { output: { status: 200, body: { user: { id: 7 }, items: [{ name: 'a' }] } } };
    test('resolves real body paths', () => {
        expect(pathResolves('body.user.id', result)).toBe(true);
        expect(pathResolves('body.items[0].name', result)).toBe(true);
        expect(pathResolves('body', result)).toBe(true);
        expect(pathResolves('.status', result)).toBe(true);
        expect(pathResolves('status', result)).toBe(true);
        expect(pathResolves('duration', result)).toBe(true);
    });
    test('rejects paths that do not exist', () => {
        expect(pathResolves('body.user.token', result)).toBe(false);
        expect(pathResolves('body.nope', result)).toBe(false);
        expect(pathResolves('garbage', result)).toBe(false);
    });
});

describe('validateExtractions', () => {
    test('accepts valid entries and caps the list', () => {
        const out = validateExtractions({ extractions: [
            { variable: 'authToken', path: 'body.token' },
            { variable: 'st', path: '.status' },
        ] });
        expect(out).toEqual([
            { variable: 'authToken', path: 'body.token' },
            { variable: 'st', path: '.status' },
        ]);
    });
    test('rejects bad names, duplicate names, and bad paths', () => {
        expect(() => validateExtractions({ extractions: [{ variable: '1bad', path: 'body.x' }] })).toThrow(/valid variable name/);
        expect(() => validateExtractions({ extractions: [{ variable: 'dup', path: 'body.x' }] }, ['dup'])).toThrow(/already in use/);
        expect(() => validateExtractions({ extractions: [{ variable: 'ok', path: 'nonsense' }] })).toThrow(/must be/);
        expect(() => validateExtractions({ extractions: [] })).toThrow(/at least one/);
    });
});

describe('validateAssertions', () => {
    test('accepts subset operators, blanks value for value-less ops, maps .status', () => {
        const out = validateAssertions({ assertions: [
            { path: '.status', operator: 'equals', value: '200' },
            { path: 'body.user.id', operator: 'exists', value: 'ignored' },
        ] });
        expect(out[0]).toEqual({ target: 'status', operator: 'equals', value: '200' });
        expect(out[1]).toEqual({ target: 'body.user.id', operator: 'exists', value: '' });
    });
    test('extracts the 3-digit code from a wrapped status value (eval case "?:403")', () => {
        const out = validateAssertions({ assertions: [{ path: 'status', operator: 'equals', value: '?:403' }] });
        expect(out[0].value).toBe('403');
    });
    test('rejects out-of-subset operators and bad targets', () => {
        expect(() => validateAssertions({ assertions: [{ path: 'status', operator: 'is_number', value: '' }] })).toThrow(/allowed assertion operators/);
        expect(() => validateAssertions({ assertions: [{ path: 'weird', operator: 'equals', value: '1' }] })).toThrow(/Target/);
        expect(() => validateAssertions({ assertions: [{ path: 'status', operator: 'equals', value: '' }] })).toThrow(/needs a value/);
    });
});

describe('validateCondition', () => {
    test('accepts a known variable and strips braces', () => {
        const out = validateCondition({ variable: '{{total}}', operator: 'greater_than', value: '1000' }, ['total']);
        expect(out).toEqual({ variable: 'total', operator: 'greater_than', value: '1000' });
    });
    test('dotted paths validate on the base variable', () => {
        const out = validateCondition({ variable: 'resp.user.id', operator: 'exists', value: '' }, ['resp']);
        expect(out.variable).toBe('resp.user.id');
        expect(out.value).toBe('');
    });
    test('strips a comparator echoed into a numeric value (harness case)', () => {
        const out = validateCondition({ variable: 'orderTotal', operator: 'greater_than', value: '>1000' }, ['orderTotal']);
        expect(out.value).toBe('1000');
    });
    test('rejects unknown variables and operators', () => {
        expect(() => validateCondition({ variable: 'ghost', operator: 'equals', value: '1' }, ['real'])).toThrow(/not a defined variable/);
        expect(() => validateCondition({ variable: 'real', operator: 'not_matches_regex', value: 'x' }, ['real'])).toThrow(/not allowed/);
    });
});

describe('validateRequestDraft', () => {
    test('accepts a clean draft and normalizes fields', () => {
        const out = validateRequestDraft({
            name: 'Create order', method: 'post', url: 'https://api.example.com/orders',
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            body: '{"qty": 2, "user": "{{userId}}"}',
        });
        expect(out.method).toBe('POST');
        expect(out.headers['Content-Type']).toBe('application/json');
        expect(out.url).toContain('https://');
    });
    test('accepts a {{variable}} base URL and empty body', () => {
        const out = validateRequestDraft({ name: 'x', method: 'GET', url: '{{baseUrl}}/users', headers: [], body: '' });
        expect(out.url).toBe('{{baseUrl}}/users');
        expect(out.body).toBe('');
    });
    test('rejects bad methods, spaced URLs, and non-JSON bodies', () => {
        expect(() => validateRequestDraft({ method: 'FETCH', url: 'https://x.co' })).toThrow(/Method/);
        expect(() => validateRequestDraft({ method: 'GET', url: 'https://x.co/a b' })).toThrow(/single token/);
        expect(() => validateRequestDraft({ method: 'GET', url: 'ftp://x.co' })).toThrow(/http/);
        expect(() => validateRequestDraft({ method: 'POST', url: 'https://x.co', body: 'not json' })).toThrow(/JSON/);
    });
    test('body with {{variables}} validates as JSON after substitution', () => {
        const out = validateRequestDraft({ method: 'POST', url: 'https://x.co', body: '{"n": {{count}}}' });
        expect(out.body).toContain('{{count}}');
    });
});

describe('vocabularies stay inside the frozen contract', () => {
    test('assertion subset ⊂ full operator vocabulary', () => {
        ASSERTION_OPERATOR_SUBSET.forEach((op) => expect(OPERATORS).toContain(op));
    });
    test('condition subset ⊂ full operator vocabulary', () => {
        CONDITION_OPERATOR_SUBSET.forEach((op) => expect(OPERATORS).toContain(op));
    });
});
