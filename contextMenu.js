// ========== FILE: contextMenu.js ==========
// A small reusable right-click / context menu. The codebase had none
// (flowVisualizer._handleContextMenu is a stub); this serves the sidebar flow
// rows now and can serve graph nodes later. Floating surface in DESIGN tokens
// (--surface-overlay / --elev-3 / --radius-lg), edge-aware (flips/shifts so it
// never clips off a projector), and fully keyboard-operable (browsers give no
// free keyboard support for custom menus).
//
// openContextMenu({ x, y, items, anchorEl }):
//   items: [{ id, label, icon?, danger?, disabled?, separator?, action() }]
//   Returns nothing; the menu owns its own dismissal.

import { escapeHTML } from './flowCore.js';

let activeMenu = null;

const EDGE_GUTTER = 6;

function destroyActive() {
    if (!activeMenu) return;
    const { el, cleanup } = activeMenu;
    cleanup();
    el.remove();
    activeMenu = null;
}

/**
 * Open a context menu at viewport coordinates (x, y).
 * @param {{x:number,y:number,items:Array,anchorEl?:HTMLElement}} config
 */
export function openContextMenu({ x, y, items, anchorEl = null }) {
    destroyActive();
    const menuItems = (items || []).filter(Boolean);
    if (!menuItems.some((it) => !it.separator)) return;

    const el = document.createElement('div');
    el.className = 'context-menu';
    el.setAttribute('role', 'menu');
    el.tabIndex = -1;

    menuItems.forEach((it, i) => {
        if (it.separator) {
            const sep = document.createElement('div');
            sep.className = 'context-menu-sep';
            sep.setAttribute('role', 'separator');
            el.appendChild(sep);
            return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'context-menu-item' + (it.danger ? ' danger' : '');
        btn.setAttribute('role', 'menuitem');
        btn.dataset.index = String(i);
        if (it.disabled) btn.setAttribute('aria-disabled', 'true');
        btn.disabled = !!it.disabled;
        const icon = it.icon
            ? `<svg class="icon icon-sm context-menu-icon" aria-hidden="true"><use href="#${escapeHTML(it.icon)}"/></svg>`
            : '<span class="context-menu-icon" aria-hidden="true"></span>';
        btn.innerHTML = `${icon}<span class="context-menu-label">${escapeHTML(it.label)}</span>`;
        if (!it.disabled) {
            btn.addEventListener('click', () => {
                destroyActive();
                try { it.action && it.action(); } catch (e) { /* caller logs */ }
            });
        }
        el.appendChild(btn);
    });

    // Off-screen measure, then place with flip/shift.
    el.style.visibility = 'hidden';
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - EDGE_GUTTER) left = Math.max(EDGE_GUTTER, x - rect.width);
    if (top + rect.height > window.innerHeight - EDGE_GUTTER) top = Math.max(EDGE_GUTTER, y - rect.height);
    left = Math.min(Math.max(EDGE_GUTTER, left), window.innerWidth - rect.width - EDGE_GUTTER);
    top = Math.min(Math.max(EDGE_GUTTER, top), window.innerHeight - rect.height - EDGE_GUTTER);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
    el.classList.add('open');

    const focusables = () => [...el.querySelectorAll('.context-menu-item:not([disabled])')];
    const focusAt = (idx) => {
        const items2 = focusables();
        if (!items2.length) return;
        const wrapped = (idx + items2.length) % items2.length;
        items2[wrapped].focus();
    };

    const onKey = (e) => {
        const items2 = focusables();
        const cur = items2.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(cur + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(cur - 1); }
        else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
        else if (e.key === 'End') { e.preventDefault(); focusAt(items2.length - 1); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === 'Tab') { e.preventDefault(); focusAt(cur + (e.shiftKey ? -1 : 1)); }
    };
    const onOutside = (e) => { if (!el.contains(e.target)) close(false); };
    const onScroll = () => close(false);

    const close = (returnFocus) => {
        destroyActive();
        if (returnFocus && anchorEl && typeof anchorEl.focus === 'function') {
            try { anchorEl.focus(); } catch { /* gone */ }
        }
    };

    const cleanup = () => {
        el.removeEventListener('keydown', onKey);
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('contextmenu', onOutside, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('blur', onScroll);
        window.removeEventListener('resize', onScroll);
    };

    el.addEventListener('keydown', onKey);
    // Defer outside listeners so the opening click/contextmenu event does not self-close.
    setTimeout(() => {
        document.addEventListener('mousedown', onOutside, true);
        document.addEventListener('contextmenu', onOutside, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('blur', onScroll);
        window.addEventListener('resize', onScroll);
    }, 0);

    activeMenu = { el, cleanup };
    focusAt(0);
}

export function closeContextMenu() { destroyActive(); }
export function isContextMenuOpen() { return !!activeMenu; }
