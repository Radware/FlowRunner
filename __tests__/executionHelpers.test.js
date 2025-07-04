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

    test('encodes special characters in URLs via FlowRunner option', () => {
        const runner = new FlowRunner({ encodeUrlVars: true });
        const step = {
            id: '1',
            type: 'request',
            name: 'login',
            url: '/api/auth/login?username={{u}}&password={{p}}'
        };
        const { processedStep } = substituteVariablesInStep.call(runner, step, {
            u: 'KevinHarris',
            p: 'KevinPass10&'
        });
        expect(processedStep.url).toBe(
            '/api/auth/login?username=KevinHarris&password=KevinPass10%26'
        );
    });

    test('does not encode absolute URLs', () => {
        const runner = new FlowRunner({ encodeUrlVars: true });
        const step = { id: '2', type: 'request', name: 'abs', url: '{{base}}/x' };
        const { processedStep } = substituteVariablesInStep.call(runner, step, {
            base: 'https://api.example.com'
        });
        expect(processedStep.url).toBe('https://api.example.com/x');
    });
});
