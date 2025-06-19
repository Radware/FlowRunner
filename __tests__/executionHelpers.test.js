import { jest, describe, test, expect } from '@jest/globals';
import { substituteVariables, substituteVariablesInStep } from '../executionHelpers.js';
import { FlowRunner } from '../flowRunner.js';

describe('substituteVariables encoding', () => {
    test('encodes values when opts.encode is true', () => {
        const context = { q: 'a&b#c' };
        const url = 'http://example/?v={{q}}';
        const plain = substituteVariables(url, context);
        const encoded = substituteVariables(url, context, { encode: true });
        expect(plain).toBe('http://example/?v=a&b#c');
        expect(encoded).toBe('http://example/?v=' + encodeURIComponent('a&b#c'));
    });

    test('substituteVariablesInStep respects FlowRunner.encodeUrlVars', () => {
        const runner = new FlowRunner({ encodeUrlVars: true });
        const step = { id: '1', type: 'request', name: 't', url: 'http://x/?q={{q}}' };
        const { processedStep } = substituteVariablesInStep.call(runner, step, { q: 'a&b#c' });
        expect(processedStep.url).toBe('http://x/?q=' + encodeURIComponent('a&b#c'));
    });

    test('does not double encode pre-encoded values', () => {
        const context = { q: 'a%26b' };
        const url = 'http://example/?v={{q}}';
        const encoded = substituteVariables(url, context, { encode: true });
        expect(encoded).toBe('http://example/?v=a%26b');
    });
});
