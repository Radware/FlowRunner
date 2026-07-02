// __tests__/assertionsEditor.test.js
// WAVE3 assertions lane — Power-mode assertion editor UI (flowStepComponents.js).
import { jest, describe, afterEach, test, expect } from '@jest/globals';
import { createStepEditor } from '../flowStepComponents.js';

function makeRequestStep(overrides = {}) {
    return {
        id: 'req1',
        type: 'request',
        name: 'Fetch User',
        method: 'GET',
        url: 'https://api.example.com/users/1',
        headers: {},
        body: '',
        extract: {},
        onFailure: 'stop',
        ...overrides,
    };
}

function mount(step, options = {}) {
    const onChange = options.onChange || jest.fn();
    const el = createStepEditor(step, {
        variables: {},
        onChange,
        onDirtyChange: options.onDirtyChange || jest.fn(),
        flowHeaders: {},
        flowVars: {},
        runtimeContext: null,
        ...options,
    });
    document.body.appendChild(el);
    return el;
}

describe('Assertion editor (Power mode)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('request editor exposes an Assertions tab with a live count', () => {
        const el = mount(makeRequestStep({
            assertions: [{ target: 'status', operator: 'equals', value: 200 }],
        }));
        const tab = el.querySelector('[data-tab="assertions"]');
        expect(tab).toBeTruthy();
        expect(tab.textContent).toContain('Assertions (1)');
    });

    test('renders one row per existing assertion, pre-filled', () => {
        const el = mount(makeRequestStep({
            assertions: [
                { target: 'status', operator: 'equals', value: 200 },
                { target: 'body.name', operator: 'contains', value: 'Ada', critical: true },
            ],
        }));
        const rows = el.querySelectorAll('.assertion-row');
        expect(rows.length).toBe(2);
        expect(rows[0].querySelector('.assertion-target').value).toBe('status');
        expect(rows[0].querySelector('.assertion-operator').value).toBe('equals');
        expect(rows[1].querySelector('.assertion-critical-input').checked).toBe(true);
    });

    test('Add Assertion appends an empty row without marking dirty yet', () => {
        const onDirtyChange = jest.fn();
        const el = mount(makeRequestStep(), { onDirtyChange });
        el.querySelector('.btn-add-assertion').click();
        expect(el.querySelectorAll('.assertion-row').length).toBe(1);
    });

    test('editing a row writes coerced values back on Save (status → number)', () => {
        const onChange = jest.fn();
        const el = mount(makeRequestStep(), { onChange });
        el.querySelector('.btn-add-assertion').click();
        const row = el.querySelector('.assertion-row');
        const target = row.querySelector('.assertion-target');
        const value = row.querySelector('.assertion-value');
        target.value = 'status';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        value.value = '200';
        value.dispatchEvent(new Event('input', { bubbles: true }));
        el.querySelector('.btn-save-step').click();
        expect(onChange).toHaveBeenCalled();
        const saved = onChange.mock.calls.at(-1)[0];
        expect(saved.assertions).toHaveLength(1);
        expect(saved.assertions[0]).toEqual({ target: 'status', operator: 'equals', value: 200 });
    });

    test('checking Critical persists critical:true on Save', () => {
        const onChange = jest.fn();
        const el = mount(makeRequestStep({ assertions: [{ target: 'status', operator: 'equals', value: 200 }] }), { onChange });
        const critical = el.querySelector('.assertion-critical-input');
        critical.checked = true;
        critical.dispatchEvent(new Event('change', { bubbles: true }));
        el.querySelector('.btn-save-step').click();
        const saved = onChange.mock.calls.at(-1)[0];
        expect(saved.assertions[0].critical).toBe(true);
    });

    test('a valueless operator (exists) drops the value field and omits value on Save', () => {
        const onChange = jest.fn();
        const el = mount(makeRequestStep(), { onChange });
        el.querySelector('.btn-add-assertion').click();
        const row = el.querySelector('.assertion-row');
        const target = row.querySelector('.assertion-target');
        const op = row.querySelector('.assertion-operator');
        target.value = 'body.token';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        op.value = 'exists';
        op.dispatchEvent(new Event('change', { bubbles: true }));
        expect(row.querySelector('.assertion-value').style.visibility).toBe('hidden');
        el.querySelector('.btn-save-step').click();
        const saved = onChange.mock.calls.at(-1)[0];
        expect(saved.assertions[0]).toEqual({ target: 'body.token', operator: 'exists' });
        expect('value' in saved.assertions[0]).toBe(false);
    });

    test('removing the last assertion deletes the assertions key on Save (stays additive)', () => {
        const onChange = jest.fn();
        const el = mount(makeRequestStep({ assertions: [{ target: 'status', operator: 'equals', value: 200 }] }), { onChange });
        el.querySelector('.btn-remove-assertion').click();
        el.querySelector('.btn-save-step').click();
        const saved = onChange.mock.calls.at(-1)[0];
        expect('assertions' in saved).toBe(false);
    });
});
