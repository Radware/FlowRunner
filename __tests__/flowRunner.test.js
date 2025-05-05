import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { FlowRunner } from '../flowRunner.js';

describe('FlowRunner state management', () => {
  let runner;
  beforeEach(() => {
    runner = new FlowRunner();
  });

  it('should initialize with isRunning and isStepping false', () => {
    expect(runner.isRunning()).toBe(false);
    expect(runner.isStepping()).toBe(false);
    expect(runner.state.stopRequested).toBe(false);
  });

  it('should set isRunning true during run and reset after', async () => {
    // Mock minimal flow and callbacks
    const flow = { steps: [] };
    runner.onFlowComplete = () => {};
    const runPromise = runner.run(flow);
    expect(runner.isRunning()).toBe(true);
    await runPromise;
    expect(runner.isRunning()).toBe(false);
  });

  it('should set isStepping true during step and reset after', async () => {
    const flow = { steps: [{ id: 's1', name: 'A', type: 'wait' }] };
    let checkPromiseResolve;
    const checkPromise = new Promise(res => { checkPromiseResolve = res; });
    
    runner._executeSingleStepLogic = async (step) => {
      const currentState = runner.isStepping();
      checkPromiseResolve(currentState);
      return { status: 'success', output: {}, error: null };
    };
    
    const stepPromise = runner.step(flow);
    const isSteppingDuringExecution = await checkPromise;
    expect(isSteppingDuringExecution).toBe(true);
    await stepPromise;
    expect(runner.isStepping()).toBe(false);
  });

  it('should set stopRequested true after stop() is called during run', async () => {
    // Use a flow with one step and block onStepStart to call stop during run
    let unblock;
    const blockPromise = new Promise(res => { unblock = res; });
    const flow = { steps: [{ id: 's1', name: 'A', type: 'request' }] };
    runner.onStepStart = () => { return 0; };
    runner.onStepComplete = async () => { await blockPromise; };
    const runPromise = runner.run(flow);
    // Wait a tick to ensure run() has started
    await new Promise(r => setTimeout(r, 10));
    runner.stop();
    expect(runner.state.stopRequested).toBe(true);
    unblock();
    await runPromise;
  });

  it('should stop execution and set stopRequested when stop() is called during a long-running step', async () => {
    const flow = {
      steps: [
        { id: 's1', name: 'Long Step', type: 'wait' },
        { id: 's2', name: 'Should Not Run', type: 'wait' }
      ]
    };
    let running = true;
    let executed = [];
    runner._executeSingleStepLogic = async (step) => {
      executed.push(step.id);
      if (step.id === 's1') {
        // Simulate a long-running step that checks for stopRequested
        for (let i = 0; i < 10; i++) {
          if (runner.state.stopRequested) break;
          await new Promise(r => setTimeout(r, 20));
        }
      }
      return { status: 'success', output: {}, error: null };
    };
    const runPromise = runner.run(flow);
    await new Promise(r => setTimeout(r, 30)); // Let s1 start
    runner.stop();
    await runPromise;
    expect(runner.state.stopRequested).toBe(true);
    expect(executed).toContain('s1');
    expect(executed).not.toContain('s2');
  });

  it('should reset state on reset()', () => {
    runner.state.isRunning = true;
    runner.state.isStepping = true;
    runner.state.stopRequested = true;
    runner.reset();
    expect(runner.isRunning()).toBe(false);
    expect(runner.isStepping()).toBe(false);
    expect(runner.state.stopRequested).toBe(false);
  });

  it('should execute steps sequentially and record results in order', async () => {
    const flow = {
      steps: [
        { id: 's1', name: 'Step 1', type: 'wait' },
        { id: 's2', name: 'Step 2', type: 'wait' },
        { id: 's3', name: 'Step 3', type: 'wait' }
      ]
    };
    const executed = [];
    runner._executeSingleStepLogic = async (step) => {
      executed.push(step.id);
      // Simulate async work
      await new Promise(r => setTimeout(r, 5));
      runner.state.results.push({ stepId: step.id, status: 'success' });
    };
    await runner.run(flow);
    expect(executed).toEqual(['s1', 's2', 's3']);
    expect(runner.state.results.map(r => r.stepId)).toEqual(['s1', 's2', 's3']);
  });

  it('should execute the then branch when condition is true', async () => {
    const flow = {
      steps: [
        { id: 'cond', name: 'Cond', type: 'condition', conditionData: { variable: 'x', operator: 'equals', value: '1' }, thenSteps: [
          { id: 'then1', name: 'Then1', type: 'wait' }
        ], elseSteps: [
          { id: 'else1', name: 'Else1', type: 'wait' }
        ] }
      ]
    };
    runner.evaluateConditionFn = () => true;
    const executed = [];
    const orig = runner._executeSingleStepLogic;
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'wait') { executed.push(step.id); return { status: 'success', output: {}, error: null }; }
      return await orig.call(this, step, context);
    };
    await runner.run(flow);
    expect(executed).toContain('then1');
    expect(executed).not.toContain('else1');
  });

  it('should execute the else branch when condition is false', async () => {
    const flow = {
      steps: [
        { id: 'cond', name: 'Cond', type: 'condition', conditionData: { variable: 'x', operator: 'equals', value: '1' }, thenSteps: [
          { id: 'then1', name: 'Then1', type: 'wait' }
        ], elseSteps: [
          { id: 'else1', name: 'Else1', type: 'wait' }
        ] }
      ]
    };
    runner.evaluateConditionFn = () => false;
    const executed = [];
    const orig = runner._executeSingleStepLogic;
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'wait') { executed.push(step.id); return { status: 'success', output: {}, error: null }; }
      return await orig.call(this, step, context);
    };
    await runner.run(flow);
    expect(executed).toContain('else1');
    expect(executed).not.toContain('then1');
  });

  it('should use evaluateConditionFn to determine condition branch', async () => {
    const flow = {
      staticVars: { x: 1 },
      steps: [
        { id: 'cond', name: 'Cond', type: 'condition', conditionData: { variable: 'x', operator: 'equals', value: '1' }, thenSteps: [
          { id: 'then1', name: 'Then1', type: 'wait' }
        ], elseSteps: [
          { id: 'else1', name: 'Else1', type: 'wait' }
        ] }
      ]
    };
    let calledWith;
    runner.evaluateConditionFn = (condData, context) => {
      calledWith = { condData, context };
      return condData.value === '1' && context.x === 1;
    };
    const orig = runner._executeSingleStepLogic;
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'wait') { return { status: 'success', output: {}, error: null }; }
      return await orig.call(this, step, context);
    };
    await runner.run(flow);
    expect(calledWith.condData).toEqual({ variable: 'x', operator: 'equals', value: '1' });
    expect(calledWith.context).toEqual({ x: 1 });
  });

  it('should skip loop body for empty array', async () => {
    const flow = {
      steps: [
        { id: 'loop', name: 'Loop', type: 'loop', source: 'arr', loopVariable: 'item', loopSteps: [
          { id: 'body1', name: 'Body1', type: 'wait' }
        ] }
      ]
    };
    runner.evaluatePathFn = () => [];
    const executed = [];
    runner._executeSingleStepLogic = async (step) => { executed.push(step.id); };
    await runner.run(flow);
    expect(executed).not.toContain('body1');
  });

  it('should execute loop body once for single item', async () => {
    const flow = {
      steps: [
        { id: 'loop', name: 'Loop', type: 'loop', source: 'arr', loopVariable: 'item', loopSteps: [
          { id: 'body1', name: 'Body1', type: 'wait' }
        ] }
      ]
    };
    runner.evaluatePathFn = () => [42];
    const executed = [];
    const orig = runner._executeSingleStepLogic;
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'wait') { executed.push(step.id); return { status: 'success', output: {}, error: null }; }
      return await orig.call(this, step, context);
    };
    await runner.run(flow);
    expect(executed.filter(id => id === 'body1').length).toBe(1);
  });

  it('should execute loop body for each item in array', async () => {
    const flow = {
      steps: [
        { id: 'loop', name: 'Loop', type: 'loop', source: 'arr', loopVariable: 'item', loopSteps: [
          { id: 'body1', name: 'Body1', type: 'wait' }
        ] }
      ]
    };
    runner.evaluatePathFn = () => [1, 2, 3];
    const executed = [];
    const orig = runner._executeSingleStepLogic;
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'wait') { executed.push(step.id); return { status: 'success', output: {}, error: null }; }
      return await orig.call(this, step, context);
    };
    await runner.run(flow);
    expect(executed.filter(id => id === 'body1').length).toBe(3);
  });

  it('should set loop variable in context for each iteration', async () => {
    const flow = {
      staticVars: {},
      steps: [
        { id: 'loop', name: 'Loop', type: 'loop', source: 'arr', loopVariable: 'item', loopSteps: [
          { id: 'body1', name: 'Body1', type: 'wait' }
        ] }
      ]
    };
    const seen = [];
    runner.evaluatePathFn = () => ['a', 'b'];
    
    const orig = runner._executeSingleStepLogic;
    runner._executeSingleStepLogic = async function(step, context) {
      // For loop body steps, capture the context before execution
      if (step.id === 'body1') {
        seen.push(context.item);
      }
      if (step.type === 'wait') {
        return { status: 'success', output: {}, error: null };
      }
      return await orig.call(this, step, context);
    };
    
    await runner.run(flow);
    expect(seen).toEqual(['a', 'b']);
  });

  it('should substitute variables in step fields using substituteVariablesFn', async () => {
    const flow = {
      staticVars: { host: 'localhost', token: 'abc123', bar: 42 },
      steps: [
        { id: 's1', name: 'Step 1', type: 'request', url: 'http://{{host}}/api', headers: { Auth: '{{token}}' }, body: { foo: '##VAR:string:bar##' } }
      ]
    };
    
    const executed = [];
    runner._executeRequestStep = async (step) => {
      executed.push({ url: step.url, auth: step.headers.Auth, foo: step.body.foo });
      return { status: 'success', output: {}, error: null };
    };

    runner.substituteVariablesFn = (step, context) => {
      if (step.type === 'request') {
        return {
          processedStep: {
            ...step,
            url: `http://${context.host}/api`,
            headers: { Auth: context.token },
            body: { foo: context.bar }
          },
          unquotedPlaceholders: {}
        };
      }
      return { processedStep: step, unquotedPlaceholders: {} };
    };

    await runner.run(flow);
    expect(executed[0]).toEqual({ url: 'http://localhost/api', auth: 'abc123', foo: 42 });
  });

  it('should respect the configured delay between steps during run', async () => {
    const flow = {
      steps: [
        { id: 's1', name: 'Step 1', type: 'wait' },
        { id: 's2', name: 'Step 2', type: 'wait' }
      ]
    };
    runner.setDelay(100); // 100ms delay between steps
    let timestamps = [];
    runner._executeSingleStepLogic = async (step) => {
      timestamps.push(Date.now());
      return { status: 'success', output: {}, error: null };
    };
    const start = Date.now();
    await runner.run(flow);
    expect(timestamps.length).toBe(2);
    const actualDelay = timestamps[1] - timestamps[0];
    expect(actualDelay).toBeGreaterThanOrEqual(95); // Allow some timing slack
  });
});

describe('_updateContextFromExtraction', () => {
  let runner;
  beforeEach(() => {
    runner = new FlowRunner({
      evaluatePathFn: (data, path) => data && data[path]
    });
  });

  it('should extract variables from response body and update context', () => {
    const extractConfig = { foo: 'foo', bar: 'bar' };
    const responseOutput = { body: { foo: 1, bar: 2 } };
    const context = {};
    const failures = runner._updateContextFromExtraction(extractConfig, responseOutput, context);
    expect(context.foo).toBe(1);
    expect(context.bar).toBe(2);
    expect(failures).toEqual([]);
  });

  it('should report failures for missing paths', () => {
    const extractConfig = { foo: 'foo', missing: 'missing' };
    const responseOutput = { body: { foo: 1 } };
    const context = {};
    const failures = runner._updateContextFromExtraction(extractConfig, responseOutput, context);
    expect(context.foo).toBe(1);
    expect(context.missing).toBeUndefined();
    expect(failures.some(f => f.varName === 'missing')).toBe(true);
  });

  it('should handle empty extractConfig gracefully', () => {
    const context = { a: 1 };
    const failures = runner._updateContextFromExtraction({}, { body: {} }, context);
    expect(context).toEqual({ a: 1 });
    expect(failures).toEqual([]);
  });
});

describe('Request step onFailure logic', () => {
  let runner;
  beforeEach(() => {
    runner = new FlowRunner();
  });

  it('should stop flow on request error if onFailure is stop (default)', async () => {
    const flow = {
      steps: [
        { id: 'r1', name: 'Req1', type: 'request', url: 'http://fail', onFailure: 'stop' },
        { id: 'r2', name: 'Req2', type: 'request', url: 'http://shouldNotRun' }
      ]
    };
    let executed = [];
    let stopCalled = false;
    runner._executeRequestStep = async (step) => {
      executed.push(step.id);
      if (step.id === 'r1') {
        stopCalled = true;
        runner.state.stopRequested = true;
        return { status: 'error', output: null, error: 'Simulated error' };
      }
      return { status: 'success', output: {}, error: null };
    };
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'request') return await this._executeRequestStep(step);
      return { status: 'success', output: {}, error: null };
    };
    await runner.run(flow);
    expect(executed).toEqual(['r1']);
    expect(stopCalled).toBe(true);
  });

  it('should continue flow on request error if onFailure is continue', async () => {
    const flow = {
      steps: [
        { id: 'r1', name: 'Req1', type: 'request', url: 'http://fail', onFailure: 'continue' },
        { id: 'r2', name: 'Req2', type: 'request', url: 'http://shouldRun' }
      ]
    };
    let executed = [];
    runner._executeRequestStep = async (step) => {
      executed.push(step.id);
      if (step.id === 'r1') return { status: 'error', output: null, error: 'Simulated error' };
      return { status: 'success', output: {}, error: null };
    };
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'request') return await this._executeRequestStep(step);
      return { status: 'success', output: {}, error: null };
    };
    await runner.run(flow);
    expect(executed).toEqual(['r1', 'r2']); // r2 should run
  });

  it('should continue flow on non-2xx status if onFailure is continue', async () => {
    const flow = {
      steps: [
        { id: 'r1', name: 'Req1', type: 'request', url: 'http://fail', onFailure: 'continue' },
        { id: 'r2', name: 'Req2', type: 'request', url: 'http://shouldRun' }
      ]
    };
    let executed = [];
    runner._executeRequestStep = async (step) => {
      executed.push(step.id);
      if (step.id === 'r1') return { status: 'success', output: { status: 404 }, error: null };
      return { status: 'success', output: { status: 200 }, error: null };
    };
    runner._executeSingleStepLogic = async function(step, context) {
      if (step.type === 'request') return await this._executeRequestStep(step);
      return { status: 'success', output: {}, error: null };
    };
    await runner.run(flow);
    expect(executed).toEqual(['r1', 'r2']); // r2 should run
  });

  it('should report extraction failures in the result when extraction path is missing', async () => {
    const flow = {
      steps: [
        { id: 'r1', name: 'Req1', type: 'request', extract: { foo: 'foo', missing: 'missing' } }
      ]
    };
    runner._executeRequestStep = async (step) => {
      return { status: 'success', output: { body: { foo: 1 } }, error: null };
    };
    runner._executeSingleStepLogic = undefined; // Use real logic for extraction
    const runnerInstance = new FlowRunner({
      evaluatePathFn: (data, path) => data && data[path],
      substituteVariablesFn: (step, context) => ({ processedStep: step, unquotedPlaceholders: {} })
    });
    runnerInstance._executeRequestStep = runner._executeRequestStep;
    const results = [];
    runnerInstance.onStepComplete = (idx, step, result) => { results.push(result); };
    await runnerInstance.run(flow);
    const extractionFailures = results[0].extractionFailures;
    expect(Array.isArray(extractionFailures)).toBe(true);
    expect(extractionFailures.some(f => f.varName === 'missing')).toBe(true);
  });
});
