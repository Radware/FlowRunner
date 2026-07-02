// __tests__/flowRunnerAssertions.test.js
//
// WAVE3 assertions lane — integration between the runner and evaluateAssertions.
// Verifies that (1) a request step's assertions are evaluated after the request
// and annotate the result with an `assertionSummary`, (2) a failed non-critical
// assertion never stops the run, (3) a failed CRITICAL assertion stops the run,
// and (4) assertions never re-issue or change the request.
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { FlowRunner } from '../flowRunner.js';
import { evaluateAssertions, evaluateCondition } from '../executionHelpers.js';
import { evaluatePath } from '../flowCore.js';

function makeFetchResponse({ status = 200, body = {}, contentType = 'application/json' } = {}) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
        headers: {
            get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null),
            forEach: (cb) => { cb(contentType, 'content-type'); },
        },
    });
}

function makeRunner(overrides = {}) {
    return new FlowRunner({
        onStepStart: (step) => {
            runnerResultsPush(step);
            return null;
        },
        onStepComplete: jest.fn(),
        onMessage: jest.fn(),
        substituteVariablesFn: (step) => ({ processedStep: { ...step }, unquotedPlaceholders: {} }),
        evaluateConditionFn: evaluateCondition,
        evaluatePathFn: evaluatePath,
        evaluateAssertionsFn: evaluateAssertions,
        delay: 0,
        ...overrides,
    });
}

let runner;
function runnerResultsPush() { /* onStepStart placeholder — results handled by engine */ }

let originalFetch;
beforeEach(() => {
    originalFetch = global.fetch;
});
afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
});

describe('runner + assertions integration', () => {
    test('annotates a request result with a PASS assertionSummary', async () => {
        global.fetch = jest.fn(() => makeFetchResponse({ status: 200, body: { name: 'Ada' } }));
        runner = makeRunner();
        const step = {
            id: 'r1', name: 'get', type: 'request', method: 'GET', url: 'https://x/1', onFailure: 'stop',
            assertions: [{ target: 'status', operator: 'equals', value: 200 }],
        };
        await runner._executeSingleStepLogic(step, {});
        const result = runner.state.results[runner.state.results.length - 1];
        expect(result.assertionSummary).toBeDefined();
        expect(result.assertionSummary.total).toBe(1);
        expect(result.assertionSummary.passed).toBe(1);
        expect(result.assertionSummary.allPassed).toBe(true);
        expect(runner.state.stopRequested).toBe(false);
    });

    test('a failed NON-critical assertion does NOT stop the run', async () => {
        global.fetch = jest.fn(() => makeFetchResponse({ status: 200, body: { name: 'Ada' } }));
        runner = makeRunner();
        const step = {
            id: 'r2', name: 'get', type: 'request', method: 'GET', url: 'https://x/1', onFailure: 'stop',
            assertions: [{ target: 'body.name', operator: 'equals', value: 'Grace' }],
        };
        await runner._executeSingleStepLogic(step, {});
        const result = runner.state.results[runner.state.results.length - 1];
        expect(result.status).toBe('success'); // request itself succeeded
        expect(result.assertionSummary.failed).toBe(1);
        expect(result.assertionSummary.criticalFailed).toBe(false);
        expect(runner.state.stopRequested).toBe(false);
    });

    test('a failed CRITICAL assertion STOPS the run', async () => {
        global.fetch = jest.fn(() => makeFetchResponse({ status: 200, body: { name: 'Ada' } }));
        runner = makeRunner();
        const step = {
            id: 'r3', name: 'get', type: 'request', method: 'GET', url: 'https://x/1', onFailure: 'stop',
            assertions: [{ target: 'body.name', operator: 'equals', value: 'Grace', critical: true }],
        };
        runner.state.isRunning = true; // simulate an in-progress run so stop() takes effect
        await runner._executeSingleStepLogic(step, {});
        const result = runner.state.results[runner.state.results.length - 1];
        expect(result.status).toBe('success'); // request still succeeded — assertions don't change it
        expect(result.assertionSummary.criticalFailed).toBe(true);
        expect(runner.state.stopRequested).toBe(true);
    });

    test('assertions never re-issue the request (fetch called exactly once)', async () => {
        global.fetch = jest.fn(() => makeFetchResponse({ status: 200, body: { name: 'Ada' } }));
        runner = makeRunner();
        const step = {
            id: 'r4', name: 'get', type: 'request', method: 'GET', url: 'https://x/1', onFailure: 'stop',
            assertions: [
                { target: 'status', operator: 'equals', value: 200 },
                { target: 'body.name', operator: 'equals', value: 'Ada' },
            ],
        };
        await runner._executeSingleStepLogic(step, {});
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const result = runner.state.results[runner.state.results.length - 1];
        expect(result.assertionSummary.passed).toBe(2);
    });

    test('a request step WITHOUT assertions gets no assertionSummary (identical legacy behavior)', async () => {
        global.fetch = jest.fn(() => makeFetchResponse({ status: 200, body: {} }));
        runner = makeRunner();
        const step = { id: 'r5', name: 'get', type: 'request', method: 'GET', url: 'https://x/1', onFailure: 'stop' };
        await runner._executeSingleStepLogic(step, {});
        const result = runner.state.results[runner.state.results.length - 1];
        expect(result.assertionSummary).toBeUndefined();
    });

    test('the request output carries a numeric duration usable by the duration target', async () => {
        global.fetch = jest.fn(() => makeFetchResponse({ status: 200, body: {} }));
        runner = makeRunner();
        const step = {
            id: 'r6', name: 'get', type: 'request', method: 'GET', url: 'https://x/1', onFailure: 'stop',
            assertions: [{ target: 'duration', operator: 'greater_equals', value: 0 }],
        };
        await runner._executeSingleStepLogic(step, {});
        const result = runner.state.results[runner.state.results.length - 1];
        expect(typeof result.output.duration).toBe('number');
        expect(result.assertionSummary.results[0].passed).toBe(true);
    });
});
