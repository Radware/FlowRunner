import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderResultItemContent } from '../runnerInterface.js';
import { appState } from '../state.js';

describe('renderResultItemContent', () => {
    beforeEach(() => {
        appState.currentFlowModel = { steps: [{ id: 'r1', type: 'request', name: 'Req1' }] };
    });

    test('displays extracted values when provided', () => {
        const li = document.createElement('li');
        const data = {
            stepName: 'Req1',
            stepId: 'r1',
            status: 'success',
            output: { status: 200 },
            error: null,
            extractionFailures: [],
            extractedValues: { token: 'abc', id: 123 }
        };
        renderResultItemContent(li, data);
        const html = li.innerHTML;
        expect(html).toContain('Extracted Values');
        expect(html).toContain('token');
        expect(html).toContain('abc');
        expect(html).toContain('id');
        expect(html).toContain('123');
    });

    test('copy button writes output to clipboard', () => {
        const writeMock = jest.fn();
        Object.assign(navigator, { clipboard: { writeText: writeMock } });
        const li = document.createElement('li');
        const data = {
            stepName: 'Req1',
            stepId: 'r1',
            status: 'success',
            output: 'hello',
            error: null,
            extractionFailures: [],
            extractedValues: {}
        };
        renderResultItemContent(li, data);
        const btn = li.querySelector('.copy-btn');
        expect(btn).not.toBeNull();
        btn.dispatchEvent(new Event('click'));
        expect(writeMock).toHaveBeenCalledWith('hello');
    });
});
