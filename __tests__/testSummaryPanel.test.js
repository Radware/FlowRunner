// __tests__/testSummaryPanel.test.js
// WAVE3 assertions lane — runner test-summary panel + per-step assertion rows.
import { describe, test, expect, beforeEach } from '@jest/globals';
import { renderResultItemContent, renderTestSummaryPanel } from '../runnerInterface.js';
import { appState } from '../state.js';

describe('renderResultItemContent — per-step assertions', () => {
    beforeEach(() => {
        appState.currentFlowModel = { steps: [{ id: 'r1', type: 'request', name: 'Req1' }] };
    });

    test('renders a PASS badge and rows when all assertions pass', () => {
        const li = document.createElement('li');
        renderResultItemContent(li, {
            stepName: 'Req1', stepId: 'r1', status: 'success',
            output: { status: 200 }, error: null, extractionFailures: [], extractedValues: {},
            assertionSummary: {
                total: 1, passed: 1, failed: 0, allPassed: true, criticalFailed: false,
                results: [{ target: 'status', operator: 'equals', value: 200, critical: false, actual: 200, passed: true, label: 'status equals 200' }],
            },
        });
        expect(li.querySelector('.result-assert-badge.assert-pass')).toBeTruthy();
        expect(li.querySelector('.result-assertions.all-pass')).toBeTruthy();
        expect(li.querySelectorAll('.assert-row.assert-pass').length).toBe(1);
        expect(li.innerHTML).toContain('status equals 200');
    });

    test('renders a FAIL badge, the actual value, and a critical tag on failure', () => {
        const li = document.createElement('li');
        renderResultItemContent(li, {
            stepName: 'Req1', stepId: 'r1', status: 'success',
            output: { status: 500 }, error: null, extractionFailures: [], extractedValues: {},
            assertionSummary: {
                total: 1, passed: 0, failed: 1, allPassed: false, criticalFailed: true,
                results: [{ target: 'status', operator: 'equals', value: 200, critical: true, actual: 500, passed: false, label: 'status equals 200' }],
            },
        });
        expect(li.querySelector('.result-assert-badge.assert-critical')).toBeTruthy();
        expect(li.querySelector('.assert-row.assert-fail')).toBeTruthy();
        expect(li.innerHTML).toContain('got 500');
        expect(li.querySelector('.assert-crit-tag')).toBeTruthy();
    });

    test('no assertion markup when the step has no assertionSummary', () => {
        const li = document.createElement('li');
        renderResultItemContent(li, {
            stepName: 'Req1', stepId: 'r1', status: 'success',
            output: { status: 200 }, error: null, extractionFailures: [], extractedValues: {},
            assertionSummary: null,
        });
        expect(li.querySelector('.result-assertions')).toBeNull();
        expect(li.querySelector('.result-assert-badge')).toBeNull();
    });
});

describe('renderTestSummaryPanel — aggregate PASS/FAIL', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="runner-test-summary" style="display:none;"></div>';
        appState.executionResults = [];
    });

    function panel() { return document.getElementById('runner-test-summary'); }

    test('stays hidden when the run defined no assertions', () => {
        appState.executionResults = [
            { assertionSummary: null },
            { assertionSummary: { total: 0, passed: 0, failed: 0, allPassed: true, criticalFailed: false, results: [] } },
        ];
        renderTestSummaryPanel();
        expect(panel().style.display).toBe('none');
        expect(panel().innerHTML).toBe('');
    });

    test('shows a PASS verdict with aggregated counts', () => {
        appState.executionResults = [
            { assertionSummary: { total: 2, passed: 2, failed: 0, allPassed: true, criticalFailed: false, results: [] } },
            { assertionSummary: { total: 1, passed: 1, failed: 0, allPassed: true, criticalFailed: false, results: [] } },
        ];
        renderTestSummaryPanel();
        expect(panel().style.display).not.toBe('none');
        expect(panel().className).toContain('summary-pass');
        expect(panel().querySelector('.test-summary-verdict').textContent).toBe('PASS');
        expect(panel().innerHTML).toContain('3');   // total passed
        expect(panel().innerHTML).toContain('3 assertions');
    });

    test('shows a FAIL verdict and critical marker when a critical assertion failed', () => {
        appState.executionResults = [
            { assertionSummary: { total: 2, passed: 1, failed: 1, allPassed: false, criticalFailed: true, results: [] } },
        ];
        renderTestSummaryPanel();
        expect(panel().className).toContain('summary-critical');
        expect(panel().querySelector('.test-summary-verdict').textContent).toBe('FAIL');
        expect(panel().querySelector('.test-summary-count.critical')).toBeTruthy();
    });

    test('non-critical failure still reads FAIL but not critical', () => {
        appState.executionResults = [
            { assertionSummary: { total: 3, passed: 2, failed: 1, allPassed: false, criticalFailed: false, results: [] } },
        ];
        renderTestSummaryPanel();
        expect(panel().className).toContain('summary-fail');
        expect(panel().className).not.toContain('summary-critical');
        expect(panel().querySelector('.test-summary-count.critical')).toBeNull();
    });
});
