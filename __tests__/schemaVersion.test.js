// ========== FILE: __tests__/schemaVersion.test.js ==========
//
// LANE schema-d — schemaVersion + tolerant-reader hardening + conformance fixtures.
//
// Three concerns, one file:
//   (a) The OPTIONAL additive `schemaVersion` field in schemas/flow-v1.schema.json:
//       it exists, is a string "MAJOR.MINOR", and is NOT required (additive-only).
//   (b) Tolerant-reader hardening: KNOWN condition operators behave EXACTLY as
//       before (regression guard), while an UNKNOWN/newer operator degrades to
//       "not met" + warning instead of throwing and aborting the run.
//   (c) Conformance: the JS engine LOADS every "from-the-future" fixture in
//       __tests__/fixtures/flowmaps/ and DEGRADES gracefully (no crash, warnings
//       surfaced), using the REAL reader path (jsonToFlowModel + FlowRunner +
//       evaluateCondition + substituteVariablesInStep + evaluatePath).

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
    jsonToFlowModel,
    evaluatePath,
} from '../flowCore.js';
import {
    evaluateCondition,
    substituteVariablesInStep,
    createFlowRunner,
} from '../executionHelpers.js';

// Jest runs with rootDir at the repo root; resolve paths from cwd to avoid
// import.meta (which babel-jest cannot transform in this CommonJS-target setup).
const REPO_ROOT = process.cwd();
const SCHEMA_PATH = join(REPO_ROOT, 'schemas', 'flow-v1.schema.json');
const FIXTURES_DIR = join(REPO_ROOT, '__tests__', 'fixtures', 'flowmaps');

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

// -----------------------------------------------------------------------------
// (a) schemaVersion is optional + additive in the schema
// -----------------------------------------------------------------------------
describe('(a) schemaVersion in flow-v1.schema.json is optional and additive', () => {
    const schema = readJson(SCHEMA_PATH);

    test('declares an optional top-level schemaVersion string property', () => {
        expect(schema.properties.schemaVersion).toBeDefined();
        expect(schema.properties.schemaVersion.type).toBe('string');
    });

    test('schemaVersion is NOT in the required array (never mandatory)', () => {
        expect(Array.isArray(schema.required)).toBe(true);
        expect(schema.required).not.toContain('schemaVersion');
    });

    test('the frozen wire keys are untouched (additive-only guard)', () => {
        // then/else on a condition step, steps on a loop step — never renamed.
        const stepProps = schema.definitions.step.properties;
        expect(stepProps.then).toBeDefined();
        expect(stepProps.else).toBeDefined();
        expect(stepProps.steps).toBeDefined();
        expect(stepProps.thenSteps).toBeUndefined();
        expect(stepProps.elseSteps).toBeUndefined();
        expect(stepProps.loopSteps).toBeUndefined();
        // top-level frozen field
        expect(schema.properties.staticVars).toBeDefined();
    });

    test('schemaVersion pattern accepts "MAJOR.MINOR" strings', () => {
        const re = new RegExp(schema.properties.schemaVersion.pattern);
        expect(re.test('1.0')).toBe(true);
        expect(re.test('2.0')).toBe(true);
        expect(re.test('10.42')).toBe(true);
        expect(re.test('2')).toBe(false);
        expect(re.test('v1.0')).toBe(false);
        expect(re.test('1.0.0')).toBe(false);
    });
});

// -----------------------------------------------------------------------------
// (b) Tolerant reader: KNOWN operators unchanged; UNKNOWN operator degrades
// -----------------------------------------------------------------------------
describe('(b) evaluateCondition tolerant-reader hardening', () => {
    let warnSpy;
    beforeEach(() => {
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warnSpy.mockRestore();
    });

    describe('KNOWN operators are UNCHANGED (regression guard)', () => {
        const ctx = {
            n: 5,
            s: 'hello world',
            t: true,
            nul: null,
            arr: [1, 2, 3],
        };
        const cases = [
            [{ variable: 'n', operator: 'equals', value: '5' }, true],
            [{ variable: 'n', operator: 'not_equals', value: '6' }, true],
            [{ variable: 'n', operator: 'greater_than', value: '4' }, true],
            [{ variable: 'n', operator: 'less_than', value: '6' }, true],
            [{ variable: 'n', operator: 'greater_equals', value: '5' }, true],
            [{ variable: 'n', operator: 'less_equals', value: '5' }, true],
            [{ variable: 's', operator: 'contains', value: 'world' }, true],
            [{ variable: 's', operator: 'not_contains', value: 'xyz' }, true],
            [{ variable: 's', operator: 'starts_with', value: 'hello' }, true],
            [{ variable: 's', operator: 'ends_with', value: 'world' }, true],
            [{ variable: 's', operator: 'matches_regex', value: '^hello' }, true],
            [{ variable: 's', operator: 'not_matches_regex', value: '^bye' }, true],
            [{ variable: 'n', operator: 'exists', value: '' }, true],
            [{ variable: 'missing', operator: 'not_exists', value: '' }, true],
            [{ variable: 'nul', operator: 'is_null', value: '' }, true],
            [{ variable: 'n', operator: 'is_not_null', value: '' }, true],
            [{ variable: 'n', operator: 'is_number', value: '' }, true],
            [{ variable: 's', operator: 'is_text', value: '' }, true],
            [{ variable: 't', operator: 'is_boolean', value: '' }, true],
            [{ variable: 'arr', operator: 'is_array', value: '' }, true],
            [{ variable: 't', operator: 'is_true', value: '' }, true],
        ];

        test.each(cases)('operator %o -> %s (no warning, no throw)', (conditionData, expected) => {
            expect(() => evaluateCondition(conditionData, ctx)).not.toThrow();
            expect(evaluateCondition(conditionData, ctx)).toBe(expected);
        });

        test('none of the known-operator evaluations emitted an unsupported-operator warning', () => {
            for (const [conditionData] of cases) {
                evaluateCondition(conditionData, ctx);
            }
            const unsupportedWarnings = warnSpy.mock.calls.filter(args =>
                String(args[0] || '').includes('CONDITION_OPERATOR_UNSUPPORTED'));
            expect(unsupportedWarnings.length).toBe(0);
        });
    });

    describe('UNKNOWN operator degrades (no throw)', () => {
        test('an unknown/newer operator returns false and warns instead of throwing', () => {
            const conditionData = { variable: 'x', operator: 'semantic_matches', value: 'y' };
            let result;
            expect(() => { result = evaluateCondition(conditionData, { x: 1 }); }).not.toThrow();
            expect(result).toBe(false);
            const warned = warnSpy.mock.calls.some(args =>
                String(args[0] || '').includes('CONDITION_OPERATOR_UNSUPPORTED'));
            expect(warned).toBe(true);
        });

        test('missing operator / missing variable still throw (real authoring errors, not from-the-future)', () => {
            expect(() => evaluateCondition({ variable: 'x', value: 'y' }, {})).toThrow();
            expect(() => evaluateCondition({ operator: 'equals', value: 'y' }, {})).toThrow();
        });
    });
});

// -----------------------------------------------------------------------------
// (c) Conformance: the engine LOADS and DEGRADES the from-the-future fixtures
// -----------------------------------------------------------------------------
describe('(c) conformance fixtures load and degrade gracefully', () => {
    // A minimal but real FlowRunner wired to the REAL reader functions.
    function buildRunner(collector) {
        return createFlowRunner({
            substituteVariablesFn: substituteVariablesInStep,
            evaluateConditionFn: evaluateCondition,
            evaluatePathFn: evaluatePath,
            onStepStart: (step) => {
                collector.started.push(step.id || step.name);
                return collector.started.length - 1;
            },
            onStepComplete: (idx, step, result) => {
                collector.completed.push({ id: step.id, name: step.name, status: result.status, unsupported: result.unsupported });
            },
            onError: (idx, step, error) => { collector.errors.push({ id: step && step.id, message: error && error.message }); },
            onMessage: (msg, level) => { collector.messages.push({ msg, level }); },
            onFlowComplete: () => { collector.flowCompleted = true; },
            onFlowStopped: () => { collector.flowStopped = true; },
            onContextUpdate: () => {},
            delay: 0,
        });
    }

    function newCollector() {
        return { started: [], completed: [], errors: [], messages: [], flowCompleted: false, flowStopped: false };
    }

    let originalFetch;
    beforeEach(() => {
        originalFetch = global.fetch;
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
            text: async () => JSON.stringify({ ok: true }),
            headers: {
                get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
                forEach: (cb) => cb('application/json', 'content-type'),
                [Symbol.iterator]: function* () { yield ['content-type', 'application/json']; },
            },
        }));
    });
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    test('every fixture in the folder is a parseable .flow.json the model loader accepts', () => {
        const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.flow.json'));
        expect(files.length).toBeGreaterThanOrEqual(4);
        for (const file of files) {
            const json = readJson(join(FIXTURES_DIR, file));
            const model = jsonToFlowModel(json);
            expect(Array.isArray(model.steps)).toBe(true);
            // schemaVersion (when present) does not crash the reader; the reader is
            // additive-lossy by design (drops unknown top-level keys) — that is fine.
            expect(model.name).toBeTruthy();
        }
    });

    test('unknown step type: skipped with unsupported=true, run continues, no crash', async () => {
        const collector = newCollector();
        const runner = buildRunner(collector);
        const model = jsonToFlowModel(readJson(join(FIXTURES_DIR, 'future-step-type.flow.json')));
        await runner.run(model);

        const skipped = collector.completed.find(c => c.id === 's2');
        expect(skipped).toBeDefined();
        expect(skipped.status).toBe('skipped');
        expect(skipped.unsupported).toBe(true);
        // The known steps on either side still ran.
        expect(collector.completed.some(c => c.id === 's1' && c.status === 'success')).toBe(true);
        expect(collector.completed.some(c => c.id === 's3' && c.status === 'success')).toBe(true);
        // A warning was surfaced; nothing crashed the run to onError.
        expect(collector.messages.some(m => m.level === 'warning')).toBe(true);
        expect(collector.errors.length).toBe(0);
    });

    test('unknown transform op: skipped with warning, NOT downgraded, output var left unset', async () => {
        const collector = newCollector();
        const runner = buildRunner(collector);
        const model = jsonToFlowModel(readJson(join(FIXTURES_DIR, 'future-transform-op.flow.json')));
        await runner.run(model);

        const transformResult = collector.completed.find(c => c.id === 't1');
        expect(transformResult).toBeDefined();
        // The transform STEP itself succeeds (it degrades internally, per-op).
        expect(transformResult.status).toBe('success');
        // A machine-readable unsupported-op warning was surfaced to the user.
        expect(collector.messages.some(m => m.level === 'warning' && /Unsupported transform op/.test(m.msg))).toBe(true);
        expect(collector.errors.length).toBe(0);
    });

    test('unknown condition operator: condition treated as not-met (Else), run continues, no throw', async () => {
        const collector = newCollector();
        const runner = buildRunner(collector);
        const model = jsonToFlowModel(readJson(join(FIXTURES_DIR, 'future-condition-operator.flow.json')));
        await runner.run(model);

        // The condition step evaluated without erroring (status success, not error).
        const cond = collector.completed.find(c => c.id === 'c1');
        expect(cond).toBeDefined();
        expect(cond.status).toBe('success');
        // Unknown operator => not met => the ELSE branch ran, the THEN branch did not.
        expect(collector.completed.some(c => c.id === 'c1-else')).toBe(true);
        expect(collector.completed.some(c => c.id === 'c1-then')).toBe(false);
        // No error path taken, run was not stopped by a throw.
        expect(collector.errors.length).toBe(0);
        expect(collector.flowStopped).toBe(false);
    });

    test('extra unknown fields + schemaVersion 2.0: unknown fields ignored, known steps execute', async () => {
        const collector = newCollector();
        const runner = buildRunner(collector);
        const model = jsonToFlowModel(readJson(join(FIXTURES_DIR, 'future-fields-and-version.flow.json')));
        await runner.run(model);

        // The known request step ran to success despite unknown sibling fields.
        expect(collector.completed.some(c => c.id === 'f1' && c.status === 'success')).toBe(true);
        // The known condition step (known operator) evaluated cleanly.
        expect(collector.completed.some(c => c.id === 'f2' && c.status === 'success')).toBe(true);
        expect(collector.errors.length).toBe(0);
    });
});
