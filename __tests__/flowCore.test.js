import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import {
  generateUniqueId,
  flowModelToJson,
  jsonToFlowModel,
  extractVariableReferences,
  findDefinedVariables,
  evaluatePath,
  validateFlow,
  preProcessBody,
  decodeMarkersRecursive,
  validateRequestBodyJson,
  formatJson,
  createNewStep,
  cloneStep,
  findStepById,
  parseConditionString,
  generateConditionString,
  generateConditionPreview,
  doesOperatorNeedValue
} from '../flowCore.js';

describe('generateUniqueId', () => {
  it('should return a non-empty string', () => {
    const id = generateUniqueId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should return unique values on multiple calls', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateUniqueId());
    }
    expect(ids.size).toBe(1000);
  });
});

describe('flowModelToJson and jsonToFlowModel', () => {
  it('should preserve basic fields and visualLayout in round-trip conversion', () => {
    const model = {
      id: 'flow1',
      name: 'Test Flow',
      description: 'desc',
      headers: { Accept: 'application/json' },
      staticVars: { foo: 'bar' },
      visualLayout: { node1: { x: 10, y: 20 } },
      steps: [
        { id: 'node1', name: 'Step 1', type: 'request', method: 'GET', url: 'http://a', headers: {}, body: '', extract: {} }
      ]
    };
    const json = flowModelToJson(model);
    expect(json.visualLayout).toEqual(model.visualLayout);
    expect(json.name).toBe(model.name);
    expect(json.steps[0].id).toBe('node1');
    const roundTrip = jsonToFlowModel(json);
    expect(roundTrip.visualLayout).toEqual(model.visualLayout);
    expect(roundTrip.name).toBe(model.name);
    expect(roundTrip.steps[0].id).toBe('node1');
  });

  it('should handle variable markers in request body', () => {
    const model = {
      id: 'flow2',
      name: 'Marker Test',
      description: '',
      headers: {},
      staticVars: {},
      visualLayout: {},
      steps: [
        { id: 's1', name: 'Step', type: 'request', method: 'POST', url: 'http://b', headers: {}, body: '{"id": "{{userId}}"}', extract: {} }
      ]
    };
    const json = flowModelToJson(model);
    // Should encode {{userId}} as a marker in JSON
    expect(JSON.stringify(json)).toContain('##VAR:string:userId##');
    const roundTrip = jsonToFlowModel(json);
    // Should decode marker back to {{userId}}
    expect(roundTrip.steps[0].body).toContain('{{userId}}');
  });
});

describe('extractVariableReferences', () => {
  it('should return an empty array if no variables are present', () => {
    expect(extractVariableReferences('no variables here')).toEqual([]);
  });
  it('should extract a single variable', () => {
    expect(extractVariableReferences('Hello {{foo}}!')).toEqual(['foo']);
  });
  it('should extract multiple variables', () => {
    expect(extractVariableReferences('A: {{foo}}, B: {{bar}}')).toEqual(['foo', 'bar']);
  });
  it('should not extract malformed variables', () => {
    expect(extractVariableReferences('Hello {foo}} and {{bar}')).toEqual([]);
  });
  it('should extract variables with underscores and numbers', () => {
    expect(extractVariableReferences('ID: {{user_123}}')).toEqual(['user_123']);
  });
  it('should extract duplicate variables only once', () => {
    expect(extractVariableReferences('X: {{foo}}, Y: {{foo}}')).toEqual(['foo']);
  });
});

describe('findDefinedVariables', () => {
  it('should return static variables from the flow model', () => {
    const model = {
      staticVars: { foo: 'bar', baz: 123 },
      steps: []
    };
    const vars = findDefinedVariables(model);
    expect(Object.keys(vars)).toEqual(expect.arrayContaining(['foo', 'baz']));
  });

  it('should return variables defined via extract in steps', () => {
    const model = {
      staticVars: {},
      steps: [
        { id: 's1', type: 'request', extract: { userId: 'body.id', token: 'headers.token' } },
        { id: 's2', type: 'request', extract: { session: 'body.session' } }
      ]
    };
    const vars = findDefinedVariables(model);
    expect(Object.keys(vars)).toEqual(expect.arrayContaining(['userId', 'token', 'session']));
  });

  it('should return loop-scoped variables', () => {
    const model = {
      staticVars: {},
      steps: [
        { id: 's1', type: 'loop', loopVar: 'item', steps: [] }
      ]
    };
    const vars = findDefinedVariables(model);
    expect(Object.keys(vars)).toEqual(expect.arrayContaining(['item']));
  });
});

describe('evaluatePath', () => {
  const data = {
    status: 200,
    headers: { token: 'abc', nested: { foo: 'bar' } },
    body: {
      id: 123,
      user: { name: 'Alice', roles: ['admin', 'user'] },
      items: [ { value: 1 }, { value: 2 } ]
    }
  };

  it('should access top-level property in body by default', () => {
    expect(evaluatePath(data, 'status')).toBeUndefined(); // Now undefined, not 200
    expect(evaluatePath(data, 'id')).toBe(123); // Defaults to body.id
  });
  it('should access nested property in body by default', () => {
    expect(evaluatePath(data, 'user.name')).toBe('Alice'); // Defaults to body.user.name
  });
  it('should access array element property in body by default', () => {
    expect(evaluatePath(data, 'items[1].value')).toBe(2); // Defaults to body.items[1].value
  });
  it('should access headers property', () => {
    expect(evaluatePath(data, 'headers.token')).toBe('abc');
  });
  it('should access nested headers property', () => {
    expect(evaluatePath(data, 'headers.nested.foo')).toBe('bar');
  });
  it('should access body property directly', () => {
    expect(evaluatePath(data, 'body.id')).toBe(123);
  });
  it('should return undefined for invalid path', () => {
    expect(evaluatePath(data, 'body.missing')).toBeUndefined();
  });
  it('should return undefined for out-of-bounds array index', () => {
    expect(evaluatePath(data, 'body.items[10].value')).toBeUndefined();
  });
  it('should handle .status special case', () => {
    expect(evaluatePath(data, '.status')).toBe(200);
  });
  it('should access body and headers root objects', () => {
    expect(evaluatePath(data, 'body')).toEqual(data.body);
    expect(evaluatePath(data, 'headers')).toEqual(data.headers);
  });
  it('should access nested header by dot notation', () => {
    expect(evaluatePath(data, 'headers.nested.foo')).toBe('bar');
  });
  it('should access body property by dot notation', () => {
    expect(evaluatePath(data, 'body.user.name')).toBe('Alice');
  });
  it('should default to body for top-level fields if present', () => {
    expect(evaluatePath(data, 'id')).toBe(123);
    expect(evaluatePath(data, 'user.name')).toBe('Alice');
  });
  it('should return undefined for missing fields', () => {
    expect(evaluatePath(data, 'body.missing')).toBeUndefined();
    expect(evaluatePath(data, 'headers.missing')).toBeUndefined();
    expect(evaluatePath(data, 'missing')).toBeUndefined();
  });
});

describe('validateFlow', () => {
  it('should return no errors for a valid flow', () => {
    const model = {
      id: 'f1',
      name: 'Valid Flow',
      steps: [
        { id: 's1', name: 'Step 1', type: 'request', method: 'GET', url: 'http://a', headers: {}, body: '', extract: {} }
      ]
    };
    const result = validateFlow(model);
    expect(result.errors.length).toBe(0);
  });

  it('should return errors for missing required fields', () => {
    const model = {
      id: 'f2',
      name: '',
      steps: [
        { id: 's1', type: 'request' } // missing name, method, url
      ]
    };
    const result = validateFlow(model);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).toMatch(/name|method|url/i);
  });

  it('should return errors for invalid step type', () => {
    const model = {
      id: 'f3',
      name: 'Invalid Step Type',
      steps: [
        { id: 's1', name: 'Step 1', type: 'notAType' }
      ]
    };
    const result = validateFlow(model);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).toMatch(/invalid|type|unknown/i);
  });
});

describe('validateRequestBodyJson', () => {
  it('should validate correct JSON', () => {
    expect(validateRequestBodyJson('{"a": 1, "b": "x"}').valid).toBe(true);
  });
  it('should validate JSON with quoted placeholders', () => {
    expect(validateRequestBodyJson('{"id": "{{userId}}"}').valid).toBe(true);
  });
  it('should validate JSON with unquoted placeholders', () => {
    expect(validateRequestBodyJson('{"id": {{userId}}}').valid).toBe(true);
  });
  it('should fail on invalid JSON', () => {
    const result = validateRequestBodyJson('{"a": 1, }');
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Invalid JSON|syntax|JSON validation failed/i);
  });
  it('should treat empty string as valid', () => {
    expect(validateRequestBodyJson('').valid).toBe(true);
  });
});

describe('formatJson', () => {
  beforeAll(() => {
    global.alert = () => {}; // Mock alert for Node.js
  });
  it('should pretty-print valid JSON', () => {
    const input = '{"a":1,"b":2}';
    const output = formatJson(input);
    expect(output).toMatch(/\n/); // Should contain newlines
    expect(output).toMatch(/\s+"a": 1,/); // Should be indented
  });
  it('should pretty-print JSON with placeholders', () => {
    const input = '{"id": {{userId}}, "name": "{{username}}"}';
    const output = formatJson(input);
    expect(output).toMatch(/"id": "\{\{userId\}\}"/);
    expect(output).toMatch(/"name": "\{\{username\}\}"/);
  });
  it('should return original text on invalid JSON', () => {
    const input = '{"a": 1, }';
    const output = formatJson(input);
    expect(output).toBe(input);
  });
});

describe('preProcessBody and decodeMarkersRecursive', () => {
  it('should encode quoted and unquoted placeholders', () => {
    const input = '{"id": "{{userId}}", "count": {{num}}}';
    const processed = preProcessBody(input);
    expect(processed).toContain('##VAR:string:userId##');
    expect(processed).toContain('##VAR:unquoted:num##');
  });
  it('should decode markers back to {{variable}}', () => {
    const data = {
      id: '##VAR:string:userId##',
      count: '##VAR:unquoted:num##'
    };
    const decoded = decodeMarkersRecursive(data);
    expect(decoded.id).toBe('{{userId}}');
    expect(decoded.count).toBe('{{num}}');
  });
  it('should handle empty input gracefully', () => {
    expect(preProcessBody('')).toBe('');
    expect(decodeMarkersRecursive('')).toBe('');
  });
  it('should decode markers in nested structures', () => {
    const data = {
      arr: [ '##VAR:string:x##', { y: '##VAR:unquoted:y##' } ]
    };
    const decoded = decodeMarkersRecursive(data);
    expect(decoded.arr[0]).toBe('{{x}}');
    expect(decoded.arr[1].y).toBe('{{y}}');
  });
});

describe('createNewStep', () => {
  it('should create a new request step with default fields', () => {
    const step = createNewStep('request');
    expect(step.type).toBe('request');
    expect(step.method).toBe('GET');
    expect(step.url).toBe('');
    expect(step.headers).toEqual({});
    expect(step.body).toBe('');
    expect(step.extract).toEqual({});
    expect(step.onFailure).toBe('stop');
    expect(typeof step.id).toBe('string');
  });
  it('should create a new condition step with default fields', () => {
    const step = createNewStep('condition');
    expect(step.type).toBe('condition');
    expect(step.condition).toBe('');
    expect(step.conditionData).toEqual({ variable: '', operator: '', value: '' });
    expect(step.thenSteps).toEqual([]);
    expect(step.elseSteps).toEqual([]);
    expect(typeof step.id).toBe('string');
  });
  it('should create a new loop step with default fields', () => {
    const step = createNewStep('loop');
    expect(step.type).toBe('loop');
    expect(step.source).toBe('');
    expect(step.loopVariable).toBe('item');
    expect(step.loopSteps).toEqual([]);
    expect(typeof step.id).toBe('string');
  });
  it('should throw on unknown step type', () => {
    expect(() => createNewStep('unknown')).toThrow();
  });
});

describe('cloneStep', () => {
  it('should deep clone a step and assign new IDs', () => {
    const orig = createNewStep('request');
    orig.name = 'Original';
    const clone = cloneStep(orig);
    expect(clone).not.toBe(orig);
    expect(clone.id).not.toBe(orig.id);
    expect(clone.name).toBe('Original');
  });
  it('should deep clone nested steps and assign new IDs', () => {
    const cond = createNewStep('condition');
    cond.thenSteps.push(createNewStep('request'));
    cond.elseSteps.push(createNewStep('loop'));
    const clone = cloneStep(cond);
    expect(clone.id).not.toBe(cond.id);
    expect(clone.thenSteps[0].id).not.toBe(cond.thenSteps[0].id);
    expect(clone.elseSteps[0].id).not.toBe(cond.elseSteps[0].id);
  });
});

describe('findStepById', () => {
  it('should find a step by ID in a flat array', () => {
    const s1 = createNewStep('request');
    const s2 = createNewStep('loop');
    const steps = [s1, s2];
    expect(findStepById(steps, s1.id)).toBe(s1);
    expect(findStepById(steps, s2.id)).toBe(s2);
  });
  it('should find a step by ID recursively in nested steps', () => {
    const cond = createNewStep('condition');
    const nested = createNewStep('request');
    cond.thenSteps.push(nested);
    const steps = [cond];
    expect(findStepById(steps, nested.id)).toBe(nested);
  });
  it('should return null if step not found', () => {
    const steps = [createNewStep('request')];
    expect(findStepById(steps, 'nonexistent')).toBeNull();
  });
});
