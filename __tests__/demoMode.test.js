// __tests__/demoMode.test.js
//
// WAVE3 demo-mode lane: the projector "Demo Mode" presentation toggle.
// Demo Mode is a pure class-on-<html> state machine with a localStorage-backed
// preference. It hides authoring chrome and enlarges run-status via CSS keyed on
// `html.demo-mode` (styling lives in styles.css). This file tests the state
// machine + persistence + the toolbar/shortcut wiring in isolation.

import { jest } from '@jest/globals';
import {
    DEMO_MODE_CLASS,
    isDemoModeActive,
    setDemoMode,
    toggleDemoMode,
    loadDemoModePreference,
    initDemoMode,
} from '../demoMode.js';
import { DEMO_MODE_KEY } from '../config.js';

describe('demo-mode state machine (pure DOM)', () => {
    let root;

    beforeEach(() => {
        // A throwaway root element stands in for <html>; the module accepts an
        // explicit root so tests never mutate the shared document element.
        root = document.createElement('div');
        window.localStorage.clear();
    });

    test('is inactive by default', () => {
        expect(isDemoModeActive(root)).toBe(false);
        expect(root.classList.contains(DEMO_MODE_CLASS)).toBe(false);
    });

    test('setDemoMode(true) adds the class and reports active', () => {
        setDemoMode(true, root);
        expect(root.classList.contains(DEMO_MODE_CLASS)).toBe(true);
        expect(isDemoModeActive(root)).toBe(true);
    });

    test('setDemoMode(false) removes the class', () => {
        setDemoMode(true, root);
        setDemoMode(false, root);
        expect(root.classList.contains(DEMO_MODE_CLASS)).toBe(false);
        expect(isDemoModeActive(root)).toBe(false);
    });

    test('setDemoMode is idempotent (double-on stays on)', () => {
        setDemoMode(true, root);
        setDemoMode(true, root);
        expect(isDemoModeActive(root)).toBe(true);
    });

    test('toggleDemoMode flips and returns the NEW state', () => {
        expect(toggleDemoMode(root)).toBe(true);
        expect(isDemoModeActive(root)).toBe(true);
        expect(toggleDemoMode(root)).toBe(false);
        expect(isDemoModeActive(root)).toBe(false);
    });
});

describe('demo-mode persistence', () => {
    let root;

    beforeEach(() => {
        root = document.createElement('div');
        window.localStorage.clear();
    });

    test('setDemoMode persists the preference to localStorage', () => {
        setDemoMode(true, root);
        expect(window.localStorage.getItem(DEMO_MODE_KEY)).toBe('true');
        setDemoMode(false, root);
        expect(window.localStorage.getItem(DEMO_MODE_KEY)).toBe('false');
    });

    test('loadDemoModePreference applies a persisted ON preference', () => {
        window.localStorage.setItem(DEMO_MODE_KEY, 'true');
        loadDemoModePreference(root);
        expect(isDemoModeActive(root)).toBe(true);
    });

    test('loadDemoModePreference leaves mode off when nothing is stored', () => {
        loadDemoModePreference(root);
        expect(isDemoModeActive(root)).toBe(false);
    });

    test('loadDemoModePreference treats a non-"true" value as off', () => {
        window.localStorage.setItem(DEMO_MODE_KEY, 'false');
        loadDemoModePreference(root);
        expect(isDemoModeActive(root)).toBe(false);
    });
});

describe('initDemoMode wiring (toolbar toggle)', () => {
    let root;
    let button;

    beforeEach(() => {
        root = document.createElement('div');
        button = document.createElement('button');
        window.localStorage.clear();
    });

    test('clicking the toggle button flips demo mode', () => {
        initDemoMode({ toggleButton: button, root });
        button.click();
        expect(isDemoModeActive(root)).toBe(true);
        button.click();
        expect(isDemoModeActive(root)).toBe(false);
    });

    test('the toggle button reflects state via aria-pressed', () => {
        initDemoMode({ toggleButton: button, root });
        expect(button.getAttribute('aria-pressed')).toBe('false');
        button.click();
        expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    test('init restores a persisted ON preference and syncs the button', () => {
        window.localStorage.setItem(DEMO_MODE_KEY, 'true');
        initDemoMode({ toggleButton: button, root });
        expect(isDemoModeActive(root)).toBe(true);
        expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    test('returns a controller whose toggle() also flips state (for the shortcut)', () => {
        const controller = initDemoMode({ toggleButton: button, root });
        expect(typeof controller.toggle).toBe('function');
        controller.toggle();
        expect(isDemoModeActive(root)).toBe(true);
        // Button stays in sync when toggled via the controller (keyboard path).
        expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    test('init does not throw when no toggle button is supplied', () => {
        expect(() => initDemoMode({ root })).not.toThrow();
    });
});
