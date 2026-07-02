// __tests__/schemaStamp.test.js
// schemaVersion is stamped on save (additive), preserved on round-trip, and never
// changes the execution model. Absence ⇒ "1.0". Pairs with goldenOldFlow.test.js.
import { describe, test, expect } from '@jest/globals';
import { flowModelToJson, jsonToFlowModel, createTemplateFlow } from '../flowCore.js';

describe('schemaVersion stamping (additive, absence ⇒ 1.0)', () => {
    test('flowModelToJson stamps "1.0" when the model has no version', () => {
        const model = createTemplateFlow();
        expect(model.schemaVersion).toBeUndefined();
        expect(flowModelToJson(model).schemaVersion).toBe('1.0');
    });

    test('flowModelToJson preserves an existing version (lossless, no forced downgrade)', () => {
        const model = createTemplateFlow();
        model.schemaVersion = '1.5';
        expect(flowModelToJson(model).schemaVersion).toBe('1.5');
    });

    test('round-trips schemaVersion (json -> model -> json)', () => {
        const json = { ...flowModelToJson(createTemplateFlow()), schemaVersion: '1.3' };
        const model = jsonToFlowModel(json);
        expect(model.schemaVersion).toBe('1.3');
        expect(flowModelToJson(model).schemaVersion).toBe('1.3');
    });

    test('stamping is additive: reopening a stamped flow preserves the execution model', () => {
        const original = createTemplateFlow();          // no version
        const saved = flowModelToJson(original);          // now carries schemaVersion "1.0"
        expect(saved.schemaVersion).toBe('1.0');
        const reopened = jsonToFlowModel(saved);
        expect(reopened.steps.length).toBe(original.steps.length);
        expect(reopened.staticVars).toEqual(original.staticVars);
        expect(reopened.headers).toEqual(original.headers);
    });
});
