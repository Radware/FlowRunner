// __tests__/assertions.test.js
//
// WAVE3 assertions lane — per-step assertions.
// Assertions are an ADDITIVE optional field `step.assertions` = an array of
// { target, operator, value, critical? } checks evaluated against a step's
// result, REUSING the existing conditionData operator vocabulary + evaluatePath.
// Targets: status, headers.X, body.path, duration.
// Assertions NEVER change request execution: evaluateAssertions is pure and only
// reports pass/fail. This suite guards the shape and the operator reuse.
import { describe, test, expect } from '@jest/globals';
import { evaluateAssertions, buildAssertionSubject } from '../executionHelpers.js';
import { jsonToFlowModel, flowModelToJson } from '../flowCore.js';

const requestOutput = {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-token': 'abc123' },
    body: { id: 42, name: 'Ada', items: [{ id: 1 }, { id: 2 }] },
};

describe('buildAssertionSubject', () => {
    test('exposes status, headers, body, duration for evaluatePath', () => {
        const subject = buildAssertionSubject(requestOutput, 123);
        expect(subject.status).toBe(200);
        expect(subject.headers['content-type']).toBe('application/json');
        expect(subject.body.name).toBe('Ada');
        expect(subject.duration).toBe(123);
    });

    test('tolerates a null/missing output', () => {
        const subject = buildAssertionSubject(null, undefined);
        expect(subject.status).toBeUndefined();
        expect(subject.headers).toEqual({});
        expect(subject.body).toBeNull();
        expect(subject.duration).toBeUndefined();
    });
});

describe('evaluateAssertions', () => {
    test('returns empty summary when no assertions are present', () => {
        const summary = evaluateAssertions(undefined, requestOutput, 100);
        expect(summary.total).toBe(0);
        expect(summary.passed).toBe(0);
        expect(summary.failed).toBe(0);
        expect(summary.allPassed).toBe(true);
        expect(summary.results).toEqual([]);
    });

    test('evaluates a status equals assertion (reusing conditionData vocab)', () => {
        const assertions = [{ target: 'status', operator: 'equals', value: 200 }];
        const summary = evaluateAssertions(assertions, requestOutput, 50);
        expect(summary.total).toBe(1);
        expect(summary.passed).toBe(1);
        expect(summary.failed).toBe(0);
        expect(summary.allPassed).toBe(true);
        expect(summary.results[0].passed).toBe(true);
        expect(summary.results[0].actual).toBe(200);
    });

    test('marks a failing status assertion', () => {
        const assertions = [{ target: 'status', operator: 'equals', value: 404 }];
        const summary = evaluateAssertions(assertions, requestOutput, 50);
        expect(summary.passed).toBe(0);
        expect(summary.failed).toBe(1);
        expect(summary.allPassed).toBe(false);
        expect(summary.results[0].passed).toBe(false);
    });

    test('evaluates a headers.X target with contains', () => {
        const assertions = [{ target: 'headers.content-type', operator: 'contains', value: 'json' }];
        const summary = evaluateAssertions(assertions, requestOutput, 50);
        expect(summary.results[0].passed).toBe(true);
    });

    test('evaluates a body.path target with a dotted/array path', () => {
        const assertions = [
            { target: 'body.name', operator: 'equals', value: 'Ada' },
            { target: 'body.items[1].id', operator: 'equals', value: 2 },
        ];
        const summary = evaluateAssertions(assertions, requestOutput, 50);
        expect(summary.passed).toBe(2);
        expect(summary.allPassed).toBe(true);
    });

    test('evaluates a duration target with less_than', () => {
        const pass = evaluateAssertions([{ target: 'duration', operator: 'less_than', value: 1000 }], requestOutput, 120);
        expect(pass.results[0].passed).toBe(true);
        const fail = evaluateAssertions([{ target: 'duration', operator: 'less_than', value: 100 }], requestOutput, 120);
        expect(fail.results[0].passed).toBe(false);
    });

    test('an unknown operator does NOT throw and is reported as failed (tolerant reader)', () => {
        const assertions = [{ target: 'status', operator: 'totally_new_operator_v9', value: 200 }];
        let summary;
        expect(() => { summary = evaluateAssertions(assertions, requestOutput, 50); }).not.toThrow();
        expect(summary.failed).toBe(1);
        expect(summary.allPassed).toBe(false);
    });

    test('flags a failed CRITICAL assertion for the runner to act on', () => {
        const assertions = [
            { target: 'status', operator: 'equals', value: 200 },
            { target: 'body.id', operator: 'equals', value: 999, critical: true },
        ];
        const summary = evaluateAssertions(assertions, requestOutput, 50);
        expect(summary.failed).toBe(1);
        expect(summary.criticalFailed).toBe(true);
    });

    test('a failed NON-critical assertion never sets criticalFailed', () => {
        const assertions = [{ target: 'body.id', operator: 'equals', value: 999 }];
        const summary = evaluateAssertions(assertions, requestOutput, 50);
        expect(summary.failed).toBe(1);
        expect(summary.criticalFailed).toBe(false);
    });

    test('ignores non-array / malformed assertions safely', () => {
        expect(evaluateAssertions({ not: 'an array' }, requestOutput, 50).total).toBe(0);
        expect(evaluateAssertions([null, 42, { target: '', operator: '', value: '' }], requestOutput, 50).total).toBe(0);
    });

    test('each result carries a human-readable label and the target/operator/value', () => {
        const assertions = [{ target: 'status', operator: 'equals', value: 200 }];
        const r = evaluateAssertions(assertions, requestOutput, 50).results[0];
        expect(r.target).toBe('status');
        expect(r.operator).toBe('equals');
        expect(r.value).toBe(200);
        expect(typeof r.label).toBe('string');
        expect(r.label.length).toBeGreaterThan(0);
    });
});

describe('assertions encoding (flowCore round-trip, additive)', () => {
    const flowWithAssertions = {
        name: 'assert flow',
        steps: [{
            id: 's1',
            name: 'get user',
            type: 'request',
            method: 'GET',
            url: 'https://api/users/1',
            onFailure: 'stop',
            assertions: [
                { target: 'status', operator: 'equals', value: 200 },
                { target: 'body.name', operator: 'contains', value: 'Ada', critical: true },
            ],
        }],
    };

    test('jsonToFlowModel preserves step.assertions', () => {
        const model = jsonToFlowModel(flowWithAssertions);
        expect(model.steps[0].assertions).toHaveLength(2);
        expect(model.steps[0].assertions[1].critical).toBe(true);
    });

    test('flowModelToJson re-emits step.assertions verbatim (round-trip stable)', () => {
        const model = jsonToFlowModel(flowWithAssertions);
        const back = flowModelToJson(model);
        expect(back.steps[0].assertions).toEqual(flowWithAssertions.steps[0].assertions);
    });

    test('a request step with NO assertions never gains an empty assertions key', () => {
        const model = jsonToFlowModel({ name: 'x', steps: [{ id: 'a', type: 'request', method: 'GET', url: 'u' }] });
        const back = flowModelToJson(model);
        expect('assertions' in back.steps[0]).toBe(false);
    });
});
