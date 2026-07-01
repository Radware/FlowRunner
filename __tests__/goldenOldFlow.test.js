// __tests__/goldenOldFlow.test.js
//
// GOLDEN BACKWARD-COMPAT GUARD (schema evolution).
// Real pre-sprint .flow.json files must keep parsing/validating/round-tripping
// IDENTICALLY as the schema evolves. The core invariant the whole cross-app
// contract rests on: a flow with NO schemaVersion, a flow with schemaVersion
// "1.0", and a flow with an unknown future MINOR ("1.5") all read to the same
// execution-relevant model. Absence ⇒ "1.0". This test must stay green before
// and after any schemaVersion-gate / stamping code is written.
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { jsonToFlowModel, flowModelToJson, validateFlow } from '../flowCore.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const loadFlow = (name) => JSON.parse(readFileSync(join(repoRoot, name), 'utf8'));

// Real flows authored before the sprint — the golden baseline.
// Must be GIT-TRACKED so this guard runs in clean checkouts / worktrees / CI
// (jwt-manipulation-attacks.flow.json is gitignored, so it is deliberately not used here).
const GOLDEN_FLOWS = ['httpbin-flow.flow.json', 'random-ip-example.flow.json'];

// Execution-relevant projection of a parsed model (ignores UI-only extras).
const executionShape = (model) => JSON.stringify({
    headers: model.headers ?? {},
    staticVars: model.staticVars ?? {},
    steps: model.steps ?? [],
});

describe('golden old-flow backward compatibility (schema evolution guard)', () => {
    for (const name of GOLDEN_FLOWS) {
        describe(name, () => {
            test('is a genuine pre-sprint flow (no schemaVersion on disk)', () => {
                expect(loadFlow(name).schemaVersion).toBeUndefined();
            });

            test('parses IDENTICALLY with vs without schemaVersion (absence ⇒ 1.0)', () => {
                const base = loadFlow(name);
                const tagged = { ...base, schemaVersion: '1.0' };
                expect(executionShape(jsonToFlowModel(tagged)))
                    .toEqual(executionShape(jsonToFlowModel(base)));
            });

            test('an unknown future MINOR ("1.5") reads the same as the untagged flow', () => {
                const base = loadFlow(name);
                const future = { ...base, schemaVersion: '1.5' };
                expect(executionShape(jsonToFlowModel(future)))
                    .toEqual(executionShape(jsonToFlowModel(base)));
            });

            test('validation result is unaffected by the version tag', () => {
                const base = loadFlow(name);
                const a = validateFlow(jsonToFlowModel(base));
                const b = validateFlow(jsonToFlowModel({ ...base, schemaVersion: '1.0' }));
                expect(b.valid).toEqual(a.valid);
                expect(b.errors).toEqual(a.errors);
            });

            test('round-trips without dropping steps or the frozen wire keys', () => {
                const json = loadFlow(name);
                const back = flowModelToJson(jsonToFlowModel(json));
                expect(Array.isArray(back.steps)).toBe(true);
                expect(back.steps.length).toBe(json.steps.length);
            });
        });
    }
});
