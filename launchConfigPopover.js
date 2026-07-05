// ========== FILE: launchConfigPopover.js ==========
// A small "quick config first" popover: Continuous + Delay + a Run button.
// Shared by the topbar send-current control and the sidebar bulk-run action bar
// so both confirm the same two settings before launching. Progressive
// disclosure, not a modal (DESIGN: modal only when inline won't do). Edge-aware
// like the context menu, keyboard-operable, remembers last-used settings.

import { formatRunLabel } from './listSelection.js';

const LS_KEY = 'flowrunnerBatchLaunchCfg';
const EDGE_GUTTER = 6;
let active = null;

function loadCfg() {
    try {
        const c = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        return { continuous: !!c.continuous, delayMs: Number.isFinite(c.delayMs) ? c.delayMs : 1000 };
    } catch { return { continuous: false, delayMs: 1000 }; }
}
function saveCfg(cfg) { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* ignore */ } }

function destroy() {
    if (!active) return;
    active.cleanup();
    active.el.remove();
    const anchor = active.anchorEl;
    active = null;
    if (anchor && typeof anchor.focus === 'function') { try { anchor.focus(); } catch { /* gone */ } }
}

/**
 * @param {object} config
 * @param {HTMLElement} config.anchorEl  the button the popover points at
 * @param {number} config.count          how many flows will launch (for the label)
 * @param {(cfg:{continuous:boolean,delayMs:number})=>void} config.onLaunch
 */
export function openLaunchConfig({ anchorEl, count = 1, onLaunch }) {
    destroy();
    const cfg = loadCfg();

    const el = document.createElement('div');
    el.className = 'launch-config-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Background run options');
    el.innerHTML = `
        <label class="lcp-row lcp-check">
            <input type="checkbox" data-lcp="continuous"${cfg.continuous ? ' checked' : ''}>
            <span>Continuous</span>
        </label>
        <label class="lcp-row lcp-delay">
            <span>Delay</span>
            <input type="number" data-lcp="delay" value="${cfg.delayMs}" min="0" step="100">
            <span class="lcp-unit">ms</span>
        </label>
        <button type="button" class="btn btn-run-go lcp-run" data-lcp="run">
            <svg class="icon icon--fill icon-sm" aria-hidden="true"><use href="#i-repeat"/></svg>
            <span>${formatRunLabel(count, { compact: true })}</span>
        </button>`;
    el.style.visibility = 'hidden';
    el.style.position = 'fixed';
    document.body.appendChild(el);

    // Position above the anchor by default, flip below if it would clip the top.
    const a = anchorEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let left = Math.min(a.left, window.innerWidth - r.width - EDGE_GUTTER);
    left = Math.max(EDGE_GUTTER, left);
    let top = a.top - r.height - EDGE_GUTTER;
    if (top < EDGE_GUTTER) top = a.bottom + EDGE_GUTTER; // flip under
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
    el.classList.add('open');

    const contInput = el.querySelector('[data-lcp="continuous"]');
    const delayInput = el.querySelector('[data-lcp="delay"]');
    const run = () => {
        const out = {
            continuous: !!contInput.checked,
            delayMs: Math.max(0, Number(delayInput.value) || 0),
        };
        saveCfg(out);
        destroy();
        onLaunch(out);
    };
    el.querySelector('[data-lcp="run"]').addEventListener('click', run);

    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); destroy(); }
        else if (e.key === 'Enter' && e.target !== delayInput) { e.preventDefault(); run(); }
        else if (e.key === 'Enter' && e.target === delayInput) { e.preventDefault(); run(); }
    };
    const onOutside = (e) => { if (!el.contains(e.target) && e.target !== anchorEl) destroy(); };
    const onScroll = () => destroy();
    el.addEventListener('keydown', onKey);
    setTimeout(() => {
        document.addEventListener('mousedown', onOutside, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
    }, 0);

    active = {
        el, anchorEl,
        cleanup() {
            el.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onOutside, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        },
    };
    contInput.focus();
}

export function closeLaunchConfig() { destroy(); }
