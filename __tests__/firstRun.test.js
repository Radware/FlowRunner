// __tests__/firstRun.test.js
//
// WAVE3 demo-mode lane: guided first-run — teaching empty-states plus a
// lightweight, dismissible onboarding overlay that points to New / Open /
// Add-step / Run. "Seen" is persisted (localStorage) so it shows once.
// Copy is concise with no em dashes (asserted here so it can't regress).

import { jest } from '@jest/globals';
import {
    hasSeenFirstRun,
    markFirstRunSeen,
    resetFirstRun,
    renderEmptyState,
    createOnboarding,
    maybeShowOnboarding,
} from '../firstRun.js';
import { FIRST_RUN_SEEN_KEY } from '../config.js';

beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
});

describe('first-run seen flag (persistence)', () => {
    test('has not been seen by default', () => {
        expect(hasSeenFirstRun()).toBe(false);
    });

    test('markFirstRunSeen persists and flips the flag', () => {
        markFirstRunSeen();
        expect(window.localStorage.getItem(FIRST_RUN_SEEN_KEY)).toBe('true');
        expect(hasSeenFirstRun()).toBe(true);
    });

    test('resetFirstRun clears the flag (for a "show tips again" affordance)', () => {
        markFirstRunSeen();
        resetFirstRun();
        expect(hasSeenFirstRun()).toBe(false);
    });
});

describe('teaching empty-states', () => {
    test('no-flow-open state names New and Open actions', () => {
        const el = renderEmptyState('no-flow-open');
        expect(el).toBeInstanceOf(HTMLElement);
        const text = el.textContent;
        expect(text).toMatch(/New Flow/i);
        expect(text).toMatch(/Open/i);
    });

    test('empty-steps state points at Add step', () => {
        const el = renderEmptyState('empty-steps');
        expect(el.textContent).toMatch(/Add/i);
        expect(el.textContent).toMatch(/step/i);
    });

    test('empty-state markup carries a stable hook class for styling', () => {
        const el = renderEmptyState('empty-steps');
        expect(el.classList.contains('guided-empty-state')).toBe(true);
    });

    test('unknown kinds fall back gracefully to a generic empty-state', () => {
        const el = renderEmptyState('nonsense-kind');
        expect(el).toBeInstanceOf(HTMLElement);
        expect(el.classList.contains('guided-empty-state')).toBe(true);
    });

    test('copy contains no em dashes', () => {
        for (const kind of ['no-flow-open', 'empty-steps']) {
            expect(renderEmptyState(kind).textContent).not.toMatch(/—/);
        }
    });
});

describe('onboarding overlay', () => {
    test('createOnboarding builds a dismissible overlay pointing at the four actions', () => {
        const overlay = createOnboarding({});
        document.body.appendChild(overlay);
        const text = overlay.textContent;
        expect(text).toMatch(/New/i);
        expect(text).toMatch(/Open/i);
        expect(text).toMatch(/Add/i);
        expect(text).toMatch(/Run/i);
        // Dismiss affordance present.
        expect(overlay.querySelector('[data-action="dismiss-onboarding"]')).not.toBeNull();
    });

    test('dismissing marks first-run seen and removes the overlay', () => {
        const onDismiss = jest.fn();
        const overlay = createOnboarding({ onDismiss });
        document.body.appendChild(overlay);
        overlay.querySelector('[data-action="dismiss-onboarding"]').click();
        expect(hasSeenFirstRun()).toBe(true);
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(document.body.contains(overlay)).toBe(false);
    });

    test('onboarding copy contains no em dashes', () => {
        const overlay = createOnboarding({});
        expect(overlay.textContent).not.toMatch(/—/);
    });
});

describe('maybeShowOnboarding gate', () => {
    test('mounts the overlay only on first run', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        const shown = maybeShowOnboarding({ host });
        expect(shown).toBe(true);
        expect(host.querySelector('.guided-onboarding')).not.toBeNull();
    });

    test('does not mount again once seen', () => {
        markFirstRunSeen();
        const host = document.createElement('div');
        document.body.appendChild(host);

        const shown = maybeShowOnboarding({ host });
        expect(shown).toBe(false);
        expect(host.querySelector('.guided-onboarding')).toBeNull();
    });

    test('force:true shows the overlay even when already seen', () => {
        markFirstRunSeen();
        const host = document.createElement('div');
        document.body.appendChild(host);

        const shown = maybeShowOnboarding({ host, force: true });
        expect(shown).toBe(true);
        expect(host.querySelector('.guided-onboarding')).not.toBeNull();
    });
});
