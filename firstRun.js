// ========== FILE: firstRun.js (WAVE3 demo-mode lane) ==========
//
// GUIDED FIRST-RUN — two cooperating pieces of teaching UI:
//
//   (A) EMPTY-STATES — `renderEmptyState(kind)` returns a friendly, instructive
//       empty-state element for the two "nothing here yet" moments:
//         * 'no-flow-open' — the workspace with no flow loaded.
//         * 'empty-steps'  — a flow that has zero steps.
//       Each names the exact next action (New / Open / Add step / Run) so a
//       first-time user is never staring at a blank canvas.
//
//   (B) ONBOARDING — a lightweight, dismissible overlay shown ONCE (persisted
//       via localStorage) that points at New / Open / Add step / Run. Dismiss
//       to never see it again; a "show tips again" affordance can call
//       `resetFirstRun()`.
//
// This module is pure DOM + localStorage. Styling lives in the
// `/* === WAVE3 demo-mode === */` block of styles.css (consumes OKLCH semantic
// tokens; no hardcoded colours). Copy is concise and uses NO em dashes.

import { FIRST_RUN_SEEN_KEY } from './config.js';
import { logger } from './logger.js';

// --- "seen" flag persistence (localStorage, best-effort) -------------------

/** @returns {boolean} whether the onboarding has already been dismissed. */
export function hasSeenFirstRun() {
    try {
        return window.localStorage.getItem(FIRST_RUN_SEEN_KEY) === 'true';
    } catch (e) {
        logger.warn('Could not read first-run flag:', e);
        return false;
    }
}

/** Record that the onboarding has been seen/dismissed. */
export function markFirstRunSeen() {
    try {
        window.localStorage.setItem(FIRST_RUN_SEEN_KEY, 'true');
    } catch (e) {
        logger.warn('Could not persist first-run flag:', e);
    }
}

/** Clear the flag so the onboarding shows again (a "show tips again" hook). */
export function resetFirstRun() {
    try {
        window.localStorage.removeItem(FIRST_RUN_SEEN_KEY);
    } catch (e) {
        logger.warn('Could not reset first-run flag:', e);
    }
}

// --- teaching empty-states -------------------------------------------------

// Copy for each empty-state. No em dashes anywhere by design.
const EMPTY_STATES = {
    'no-flow-open': {
        icon: '➕', // heavy plus
        title: 'No flow open yet',
        body: 'Create a fresh flow or open an existing one to get started.',
        actions: [
            { key: 'new', label: 'New Flow', hint: 'Start from scratch' },
            { key: 'open', label: 'Open Flow', hint: 'Load a .flow.json file' },
        ],
    },
    'empty-steps': {
        icon: '□', // white square
        title: 'This flow has no steps',
        body: 'Add your first step to start building the sequence of API calls.',
        actions: [
            { key: 'add-step', label: 'Add step', hint: 'Request, Transform, Condition or Loop' },
        ],
    },
};

// Fallback so an unknown kind never returns null.
const GENERIC_EMPTY_STATE = {
    icon: '□',
    title: 'Nothing here yet',
    body: 'Pick an action from the toolbar to begin.',
    actions: [],
};

/**
 * Build a teaching empty-state element.
 * @param {'no-flow-open'|'empty-steps'|string} kind
 * @returns {HTMLElement} a `.guided-empty-state` element (never null).
 */
export function renderEmptyState(kind) {
    const spec = EMPTY_STATES[kind] || GENERIC_EMPTY_STATE;

    const wrap = document.createElement('div');
    wrap.className = 'guided-empty-state';
    wrap.dataset.kind = kind;

    const icon = document.createElement('div');
    icon.className = 'guided-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = spec.icon;
    wrap.appendChild(icon);

    const title = document.createElement('h3');
    title.className = 'guided-empty-title';
    title.textContent = spec.title;
    wrap.appendChild(title);

    const body = document.createElement('p');
    body.className = 'guided-empty-body';
    body.textContent = spec.body;
    wrap.appendChild(body);

    if (spec.actions.length) {
        const list = document.createElement('ul');
        list.className = 'guided-empty-actions';
        for (const action of spec.actions) {
            const li = document.createElement('li');
            li.className = 'guided-empty-action';
            li.dataset.action = action.key;

            const label = document.createElement('span');
            label.className = 'guided-action-label';
            label.textContent = action.label;
            li.appendChild(label);

            if (action.hint) {
                const hint = document.createElement('span');
                hint.className = 'guided-action-hint';
                hint.textContent = action.hint;
                li.appendChild(hint);
            }
            list.appendChild(li);
        }
        wrap.appendChild(list);
    }

    return wrap;
}

// --- onboarding overlay ----------------------------------------------------

// The four moves we teach, in order. Concise, no em dashes.
const ONBOARDING_STEPS = [
    { label: 'New Flow', hint: 'Create a flow from scratch.' },
    { label: 'Open Flow', hint: 'Load an existing .flow.json file.' },
    { label: 'Add step', hint: 'Build the sequence one API call at a time.' },
    { label: 'Run', hint: 'Execute the flow and watch each step pass or fail.' },
];

/**
 * Build the dismissible first-run onboarding overlay.
 * @param {object} opts
 * @param {()=>void} [opts.onDismiss] called after the user dismisses it.
 * @returns {HTMLElement} the `.guided-onboarding` overlay element.
 */
export function createOnboarding({ onDismiss } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'guided-onboarding';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'false');
    overlay.setAttribute('aria-label', 'Getting started with FlowRunner');

    const card = document.createElement('div');
    card.className = 'guided-onboarding-card';
    overlay.appendChild(card);

    const header = document.createElement('div');
    header.className = 'guided-onboarding-header';
    const heading = document.createElement('h3');
    heading.textContent = 'Welcome to FlowRunner';
    header.appendChild(heading);
    card.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'guided-onboarding-intro';
    intro.textContent = 'Four steps to your first run:';
    card.appendChild(intro);

    const list = document.createElement('ol');
    list.className = 'guided-onboarding-steps';
    ONBOARDING_STEPS.forEach((step, i) => {
        const li = document.createElement('li');
        li.className = 'guided-onboarding-step';

        const num = document.createElement('span');
        num.className = 'guided-onboarding-num';
        num.setAttribute('aria-hidden', 'true');
        num.textContent = String(i + 1);
        li.appendChild(num);

        const label = document.createElement('span');
        label.className = 'guided-onboarding-label';
        label.textContent = step.label;
        li.appendChild(label);

        const hint = document.createElement('span');
        hint.className = 'guided-onboarding-hint';
        hint.textContent = step.hint;
        li.appendChild(hint);

        list.appendChild(li);
    });
    card.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'guided-onboarding-footer';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn btn-primary btn-sm';
    dismiss.dataset.action = 'dismiss-onboarding';
    dismiss.textContent = 'Got it';
    footer.appendChild(dismiss);
    card.appendChild(footer);

    const close = () => {
        markFirstRunSeen();
        overlay.remove();
        if (typeof onDismiss === 'function') {
            try { onDismiss(); } catch (e) { logger.warn('onboarding onDismiss failed:', e); }
        }
    };

    dismiss.addEventListener('click', close);
    // Clicking the scrim (but not the card) also dismisses.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    return overlay;
}

/**
 * Show the onboarding overlay if it has not been seen (or if forced).
 * @param {object} opts
 * @param {HTMLElement} opts.host mount point for the overlay.
 * @param {boolean} [opts.force] show even if already seen ("show tips again").
 * @param {()=>void} [opts.onDismiss]
 * @returns {boolean} whether the overlay was mounted.
 */
export function maybeShowOnboarding({ host, force = false, onDismiss } = {}) {
    if (!host) return false;
    if (!force && hasSeenFirstRun()) return false;

    // Never stack two overlays.
    const existing = host.querySelector('.guided-onboarding');
    if (existing) existing.remove();

    host.appendChild(createOnboarding({ onDismiss }));
    return true;
}
