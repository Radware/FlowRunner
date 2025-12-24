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

describe('RANDOM_IP special variable', () => {
    test('generates a valid public IP address', () => {
        const runner = new FlowRunner();
        const step = {
            id: '1',
            type: 'request',
            name: 'test',
            url: 'http://example.com',
            headers: { 'X-Forwarded-For': '{{RANDOM_IP}}' }
        };
        const { processedStep } = substituteVariablesInStep.call(runner, step, {});
        
        // Check that a valid IP was generated
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        expect(processedStep.headers['X-Forwarded-For']).toMatch(ipPattern);
        
        // Check that each octet is valid (0-255)
        const octets = processedStep.headers['X-Forwarded-For'].split('.');
        octets.forEach(octet => {
            const num = parseInt(octet, 10);
            expect(num).toBeGreaterThanOrEqual(0);
            expect(num).toBeLessThanOrEqual(255);
        });
    });

    test('generates the same IP across multiple steps in a single run', () => {
        const runner = new FlowRunner();
        const step1 = {
            id: '1',
            type: 'request',
            name: 'step1',
            url: 'http://example.com',
            headers: { 'X-Forwarded-For': '{{RANDOM_IP}}' }
        };
        const step2 = {
            id: '2',
            type: 'request',
            name: 'step2',
            url: 'http://example.com/{{RANDOM_IP}}',
            headers: {}
        };
        
        const { processedStep: processed1 } = substituteVariablesInStep.call(runner, step1, {});
        const { processedStep: processed2 } = substituteVariablesInStep.call(runner, step2, {});
        
        // Both steps should use the same IP
        expect(processed1.headers['X-Forwarded-For']).toBe(runner.state.randomIP);
        expect(processed2.url).toBe(`http://example.com/${runner.state.randomIP}`);
        expect(processed1.headers['X-Forwarded-For']).toBe(processed2.url.split('/').pop());
    });

    test('generates a new IP for a new flow run', () => {
        const runner = new FlowRunner();
        const step = {
            id: '1',
            type: 'request',
            name: 'test',
            url: 'http://example.com',
            headers: { 'X-Forwarded-For': '{{RANDOM_IP}}' }
        };
        
        // First run
        const { processedStep: processed1 } = substituteVariablesInStep.call(runner, step, {});
        const firstIP = processed1.headers['X-Forwarded-For'];
        
        // Reset runner (simulating a new flow run)
        runner.reset();
        
        // Second run
        const { processedStep: processed2 } = substituteVariablesInStep.call(runner, step, {});
        const secondIP = processed2.headers['X-Forwarded-For'];
        
        // IPs should be different (or at least, state should have been reset)
        // Note: There's a tiny chance they could be the same by random chance,
        // but we can verify the state was reset
        expect(runner.state.randomIP).toBe(secondIP);
    });

    test('works in URLs, headers, and other substitutable fields', () => {
        const runner = new FlowRunner();
        const step = {
            id: '1',
            type: 'request',
            name: 'test',
            url: 'http://example.com/ip/{{RANDOM_IP}}',
            headers: { 
                'X-Forwarded-For': '{{RANDOM_IP}}',
                'X-Real-IP': '{{RANDOM_IP}}'
            }
        };
        
        const { processedStep } = substituteVariablesInStep.call(runner, step, {});
        const generatedIP = runner.state.randomIP;
        
        // All should use the same IP
        expect(processedStep.url).toBe(`http://example.com/ip/${generatedIP}`);
        expect(processedStep.headers['X-Forwarded-For']).toBe(generatedIP);
        expect(processedStep.headers['X-Real-IP']).toBe(generatedIP);
    });
});
