// ========== FILE: demoMode.js (WAVE3 demo-mode lane) ==========
//
// DEMO MODE — a presentation toggle for projecting a live flow to a customer.
//
// What it does (all via a single class on the document element):
//   * Hides authoring chrome (sidebar + runner panel + editor overlays) so the
//     graph and its run-status are the whole screen.
//   * Enlarges nodes and the run-status readout, and makes pass/fail the visual
//     focus — with a GLYPH (not hue alone) on each status so it survives a
//     washed-out projector and colour-blind viewers (WCAG 1.4.1).
//   * Keeps the light-default projector theme + the OKLCH semantic tokens.
//
// This module owns ONLY the state machine + persistence + toolbar/shortcut
// wiring. Every visual change lives in the `/* === WAVE3 demo-mode === */`
// block in styles.css, keyed on `html.demo-mode`. No app state, no imports from
// feature modules, so it stays trivially unit-testable against a throwaway root.

import { DEMO_MODE_KEY } from './config.js';
import { logger } from './logger.js';

// The class we toggle on <html>. styles.css keys every Demo-Mode rule on this.
export const DEMO_MODE_CLASS = 'demo-mode';

/**
 * Resolve the root element the class lives on. Callers may pass an explicit
 * root (tests do, to avoid mutating the shared document element); production
 * callers omit it and get `document.documentElement` (<html>).
 */
function resolveRoot(root) {
    if (root) return root;
    return (typeof document !== 'undefined') ? document.documentElement : null;
}

/** @returns {boolean} whether Demo Mode is currently active on `root`. */
export function isDemoModeActive(root) {
    const el = resolveRoot(root);
    return !!el && el.classList.contains(DEMO_MODE_CLASS);
}

/** Persist the current Demo-Mode preference (best-effort; never throws). */
function persist(on) {
    try {
        window.localStorage.setItem(DEMO_MODE_KEY, on ? 'true' : 'false');
    } catch (e) {
        logger.warn('Could not persist demo-mode preference:', e);
    }
}

/**
 * Set Demo Mode on/off. Idempotent. Toggles the class on `root` and persists
 * the preference so a presenter's setup survives a relaunch.
 * @returns {boolean} the resulting state.
 */
export function setDemoMode(on, root) {
    const el = resolveRoot(root);
    const next = !!on;
    if (el) el.classList.toggle(DEMO_MODE_CLASS, next);
    persist(next);
    return next;
}

/**
 * Flip Demo Mode.
 * @returns {boolean} the NEW state (true = now on).
 */
export function toggleDemoMode(root) {
    return setDemoMode(!isDemoModeActive(root), root);
}

/**
 * Apply the persisted preference on startup. Only an explicit "true" turns it
 * on; anything else (absent / "false" / garbage) leaves Demo Mode off so the
 * app opens in normal authoring mode by default.
 */
export function loadDemoModePreference(root) {
    let stored = null;
    try {
        stored = window.localStorage.getItem(DEMO_MODE_KEY);
    } catch (e) {
        logger.warn('Could not read demo-mode preference:', e);
    }
    const on = stored === 'true';
    const el = resolveRoot(root);
    // Apply without re-persisting (we're mirroring what's already stored).
    if (el) el.classList.toggle(DEMO_MODE_CLASS, on);
    return on;
}

/** Reflect the current state onto the toolbar toggle button (pressed + label). */
function syncButton(button, on) {
    if (!button) return;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('active', on);
    button.title = on
        ? 'Exit Demo Mode (presentation view)'
        : 'Enter Demo Mode (presentation view for projecting a live flow)';
}

/**
 * Wire the Demo-Mode toolbar toggle and restore any persisted preference.
 *
 * @param {object} opts
 * @param {HTMLElement} [opts.toggleButton] the toolbar button (optional).
 * @param {HTMLElement} [opts.root] override the class root (tests).
 * @param {(on:boolean)=>void} [opts.onChange] optional callback after each flip
 *        (e.g. so the shell can re-fit the graph to the new viewport size).
 * @returns {{toggle:()=>boolean, set:(on:boolean)=>boolean, isActive:()=>boolean}}
 *          a controller the keyboard shortcut path can drive.
 */
export function initDemoMode({ toggleButton = null, root, onChange } = {}) {
    // Restore persisted state first, then reflect it on the button.
    const initial = loadDemoModePreference(root);
    syncButton(toggleButton, initial);

    const emit = (on) => {
        syncButton(toggleButton, on);
        if (typeof onChange === 'function') {
            try { onChange(on); } catch (e) { logger.warn('demo-mode onChange failed:', e); }
        }
        logger.info(`Demo Mode ${on ? 'enabled' : 'disabled'}.`);
        return on;
    };

    const controller = {
        toggle() { return emit(toggleDemoMode(root)); },
        set(on) { return emit(setDemoMode(on, root)); },
        isActive() { return isDemoModeActive(root); },
    };

    if (toggleButton) {
        toggleButton.addEventListener('click', () => controller.toggle());
    }

    return controller;
}
