// __tests__/importCurlHar.test.js
import { describe, test, expect } from '@jest/globals';
import { parseCurl, parseHar } from '../importCurlHar.js';

describe('parseCurl', () => {
    test('parses a simple GET with implicit method', () => {
        const step = parseCurl('curl https://api.example.com/users');
        expect(step.type).toBe('request');
        expect(step.method).toBe('GET');
        expect(step.url).toBe('https://api.example.com/users');
        expect(step.headers).toEqual({});
        expect(step.onFailure).toBe('stop');
        expect(typeof step.id).toBe('string');
        expect(step.id.length).toBeGreaterThan(0);
    });

    test('parses explicit method via -X', () => {
        const step = parseCurl('curl -X DELETE https://api.example.com/users/1');
        expect(step.method).toBe('DELETE');
        expect(step.url).toBe('https://api.example.com/users/1');
    });

    test('parses --request long form', () => {
        const step = parseCurl('curl --request PUT https://api.example.com/x');
        expect(step.method).toBe('PUT');
    });

    test('parses headers via -H and --header', () => {
        const step = parseCurl(
            `curl -H "Accept: application/json" --header 'X-Token: abc123' https://api.example.com/x`
        );
        expect(step.headers['Accept']).toBe('application/json');
        expect(step.headers['X-Token']).toBe('abc123');
    });

    test('a data flag implies POST when no method given', () => {
        const step = parseCurl(`curl https://api.example.com/x -d '{"a":1}'`);
        expect(step.method).toBe('POST');
        expect(step.body).toBe('{"a":1}');
    });

    test('explicit method is not overridden by data flag', () => {
        const step = parseCurl(`curl -X PATCH https://api.example.com/x --data '{"a":1}'`);
        expect(step.method).toBe('PATCH');
        expect(step.body).toBe('{"a":1}');
    });

    test('parses --data-raw', () => {
        const step = parseCurl(`curl https://api.example.com/x --data-raw 'hello world'`);
        expect(step.method).toBe('POST');
        expect(step.body).toBe('hello world');
    });

    test('handles single-quoted URLs and mixed quoting', () => {
        const step = parseCurl(`curl 'https://api.example.com/search?q=a b'`);
        expect(step.url).toBe('https://api.example.com/search?q=a b');
    });

    test('handles line continuations (backslash-newline)', () => {
        const curl = [
            'curl -X POST https://api.example.com/x \\',
            "  -H 'Content-Type: application/json' \\",
            `  -d '{"k":"v"}'`
        ].join('\n');
        const step = parseCurl(curl);
        expect(step.method).toBe('POST');
        expect(step.headers['Content-Type']).toBe('application/json');
        expect(step.body).toBe('{"k":"v"}');
    });

    test('parses --url flag', () => {
        const step = parseCurl(`curl --url https://api.example.com/y -X GET`);
        expect(step.url).toBe('https://api.example.com/y');
    });

    test('ignores unknown/boolean flags like --compressed and -k', () => {
        const step = parseCurl(`curl --compressed -k https://api.example.com/z`);
        expect(step.url).toBe('https://api.example.com/z');
        expect(step.method).toBe('GET');
    });

    test('escaped quotes inside a quoted value are preserved', () => {
        const step = parseCurl(`curl https://x.test -d "{\\"a\\":\\"b\\"}"`);
        expect(step.body).toBe('{"a":"b"}');
    });

    test('throws on empty / non-curl input', () => {
        expect(() => parseCurl('')).toThrow();
        expect(() => parseCurl('not a curl command')).toThrow();
    });

    test('produces a step compatible with the request-step shape', () => {
        const step = parseCurl('curl https://api.example.com/users');
        expect(step).toHaveProperty('rawBodyWithMarkers');
        expect(step).toHaveProperty('extract');
        expect(step).toHaveProperty('name');
    });
});

describe('parseHar', () => {
    const sampleHar = {
        log: {
            version: '1.2',
            creator: { name: 'FlowRunner', version: '1.2.1' },
            entries: [
                {
                    request: {
                        method: 'GET',
                        url: 'https://api.example.com/a?x=1',
                        headers: [
                            { name: 'Accept', value: 'application/json' },
                            { name: 'X-Test', value: 'yes' }
                        ]
                    },
                    response: { status: 200 }
                },
                {
                    request: {
                        method: 'POST',
                        url: 'https://api.example.com/b',
                        headers: [{ name: 'Content-Type', value: 'application/json' }],
                        postData: { mimeType: 'application/json', text: '{"n":2}' }
                    },
                    response: { status: 201 }
                }
            ]
        }
    };

    test('parses each entry into a request step', () => {
        const steps = parseHar(sampleHar);
        expect(Array.isArray(steps)).toBe(true);
        expect(steps).toHaveLength(2);

        expect(steps[0].type).toBe('request');
        expect(steps[0].method).toBe('GET');
        expect(steps[0].url).toBe('https://api.example.com/a?x=1');
        expect(steps[0].headers['Accept']).toBe('application/json');
        expect(steps[0].headers['X-Test']).toBe('yes');

        expect(steps[1].method).toBe('POST');
        expect(steps[1].body).toBe('{"n":2}');
        expect(steps[1].headers['Content-Type']).toBe('application/json');
    });

    test('accepts a HAR provided as a JSON string', () => {
        const steps = parseHar(JSON.stringify(sampleHar));
        expect(steps).toHaveLength(2);
        expect(steps[0].url).toBe('https://api.example.com/a?x=1');
    });

    test('each step gets a unique id and stop onFailure default', () => {
        const steps = parseHar(sampleHar);
        expect(steps[0].id).not.toBe(steps[1].id);
        expect(steps[0].onFailure).toBe('stop');
    });

    test('names steps from method + path', () => {
        const steps = parseHar(sampleHar);
        expect(steps[0].name).toContain('GET');
        expect(steps[0].name).toContain('/a');
    });

    test('throws on a malformed HAR (missing log.entries)', () => {
        expect(() => parseHar({ log: {} })).toThrow();
        expect(() => parseHar('{ not json')).toThrow();
        expect(() => parseHar(null)).toThrow();
    });

    test('skips non-http(s) entries gracefully', () => {
        const har = {
            log: {
                entries: [
                    { request: { method: 'GET', url: 'data:text/plain,hi', headers: [] }, response: {} },
                    { request: { method: 'GET', url: 'https://ok.test/', headers: [] }, response: {} }
                ]
            }
        };
        const steps = parseHar(har);
        expect(steps).toHaveLength(1);
        expect(steps[0].url).toBe('https://ok.test/');
    });
});
