// __tests__/flowStepInspector.test.js
// Wave 2 — inspector lane: Basic/Power progressive disclosure inside createStepEditor.
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { createStepEditor } from '../flowStepComponents.js';

function makeRequestStep(overrides = {}) {
    return {
        id: 'req1',
        type: 'request',
        name: 'Fetch User',
        method: 'GET',
        url: 'https://api.example.com/users/{{userId}}',
        headers: { Authorization: 'Bearer {{token}}' },
        body: '',
        extract: { userId: 'body.id' },
        onFailure: 'stop',
        ...overrides
    };
}

function mount(step, options = {}) {
    const el = createStepEditor(step, {
        variables: { userId: {}, token: {} },
        onChange: options.onChange || jest.fn(),
        onDirtyChange: options.onDirtyChange || jest.fn(),
        flowHeaders: {},
        flowVars: {},
        runtimeContext: null,
        ...options
    });
    document.body.appendChild(el);
    return el;
}

describe('Step inspector — Basic/Power progressive disclosure', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('editor exposes a disclosure toggle with Basic active by default', () => {
        const el = mount(makeRequestStep());
        const toggle = el.querySelector('.inspector-disclosure');
        expect(toggle).toBeTruthy();
        const basicBtn = toggle.querySelector('[data-disclosure="basic"]');
        const powerBtn = toggle.querySelector('[data-disclosure="power"]');
        expect(basicBtn).toBeTruthy();
        expect(powerBtn).toBeTruthy();
        expect(basicBtn.classList.contains('active')).toBe(true);
        expect(powerBtn.classList.contains('active')).toBe(false);
        // Editor root reflects the active mode for CSS-driven disclosure.
        expect(el.classList.contains('inspector-mode-basic')).toBe(true);
        expect(el.classList.contains('inspector-mode-power')).toBe(false);
    });

    test('Basic mode keeps common request fields visible and marks advanced blocks power-only', () => {
        const el = mount(makeRequestStep());
        // Common fields are never power-only.
        const methodGroup = el.querySelector(`#request-method-req1`).closest('.form-group');
        const urlGroup = el.querySelector(`#request-url-req1`).closest('.form-group');
        expect(methodGroup.classList.contains('power-only')).toBe(false);
        expect(urlGroup.classList.contains('power-only')).toBe(false);
        // The advanced tab strip (extract/options/raw) is power-only.
        const advanced = el.querySelector('.form-tabs');
        expect(advanced.classList.contains('power-only')).toBe(true);
    });

    test('clicking Power reveals advanced fields and flips the editor mode class', () => {
        const el = mount(makeRequestStep());
        const powerBtn = el.querySelector('[data-disclosure="power"]');
        powerBtn.click();
        expect(el.classList.contains('inspector-mode-power')).toBe(true);
        expect(el.classList.contains('inspector-mode-basic')).toBe(false);
        expect(powerBtn.classList.contains('active')).toBe(true);
        expect(el.querySelector('[data-disclosure="basic"]').classList.contains('active')).toBe(false);
    });

    test('switching disclosure mode does NOT mark the editor dirty', () => {
        const onDirtyChange = jest.fn();
        const el = mount(makeRequestStep(), { onDirtyChange });
        el.querySelector('[data-disclosure="power"]').click();
        el.querySelector('[data-disclosure="basic"]').click();
        expect(onDirtyChange).not.toHaveBeenCalled();
        expect(el.querySelector('.btn-save-step').disabled).toBe(true);
    });

    test('Basic mode surfaces a key-headers summary for request steps', () => {
        const el = mount(makeRequestStep());
        const summary = el.querySelector('.inspector-summary');
        expect(summary).toBeTruthy();
        expect(summary.textContent).toContain('Authorization');
    });

    test('condition steps show a condition summary in Basic mode', () => {
        const step = {
            id: 'cond1',
            type: 'condition',
            name: 'Check status',
            condition: '',
            conditionData: { variable: 'status', operator: 'equals', value: 'ok' },
            thenSteps: [],
            elseSteps: []
        };
        const el = mount(step, { variables: { status: {} } });
        const summary = el.querySelector('.inspector-summary');
        expect(summary).toBeTruthy();
        expect(summary.textContent.length).toBeGreaterThan(0);
    });
});

describe('Step inspector — read-only raw body-marker view', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('raw ##VAR marker view renders preProcessBody output and is read-only', () => {
        const step = makeRequestStep({ body: '{ "id": {{userId}}, "name": "{{userName}}" }' });
        const el = mount(step);
        el.querySelector('[data-disclosure="power"]').click();
        const raw = el.querySelector('.raw-body-markers');
        expect(raw).toBeTruthy();
        expect(raw.readOnly).toBe(true);
        // Unquoted number marker + quoted string marker, produced by preProcessBody.
        expect(raw.value).toContain('##VAR:unquoted:userId##');
        expect(raw.value).toContain('##VAR:string:userName##');
    });

    test('editing the read-only raw marker view never reaches saved body JSON', () => {
        const onChange = jest.fn();
        const step = makeRequestStep({ body: '{ "id": {{userId}} }' });
        const el = mount(step, { onChange });
        el.querySelector('[data-disclosure="power"]').click();
        const raw = el.querySelector('.raw-body-markers');
        // Simulate a hostile hand-typed {{var}} in the raw view.
        raw.value = '{ "id": {{EVIL}} }';
        raw.dispatchEvent(new Event('input', { bubbles: true }));

        // Make an unrelated real edit so Save is enabled, then save.
        const urlInput = el.querySelector('#request-url-req1');
        urlInput.value = 'https://api.example.com/changed';
        urlInput.dispatchEvent(new Event('input'));
        el.querySelector('.btn-save-step').click();

        expect(onChange).toHaveBeenCalledTimes(1);
        const saved = onChange.mock.calls[0][0];
        // The raw marker view is display-only: it must never mutate the body.
        expect(saved.body).toBe('{ "id": {{userId}} }');
        expect(saved.body).not.toContain('EVIL');
    });
});

describe('Step inspector — save/cancel/dirty regression', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('real field edits still mark dirty and Save still fires onChange', () => {
        const onChange = jest.fn();
        const onDirtyChange = jest.fn();
        const el = mount(makeRequestStep(), { onChange, onDirtyChange });
        const urlInput = el.querySelector('#request-url-req1');
        urlInput.value = 'https://api.example.com/v2';
        urlInput.dispatchEvent(new Event('input'));
        expect(onDirtyChange).toHaveBeenCalledWith(true);
        el.querySelector('.btn-save-step').click();
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example.com/v2' }));
    });
});
