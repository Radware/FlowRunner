// ========== FILE: flowIndex.js ==========
// The corpus + ranking behind the background-run picker. Makes "tens of
// thousands of flows" real instead of a capped recent-files list:
//   - empty query  -> recent flows, frecency-ordered (recency bucket x run count)
//   - any query     -> fuzzy filter over the whole SCANNED corpus (a chosen root
//                      folder walked once by the fs:scanFlows IPC, cached),
//                      rendered top-N so 10k+ matches never jank the projector.
//
// DOM-free. Degrades gracefully with no desktop APIs (browser): corpus falls
// back to the recent-files list, and scanning is simply unavailable.

import { fuzzyFilter } from './palette.js';
import { getRecentFiles } from './fileOperations.js';
import { logger } from './logger.js';

const SCAN_ROOT_KEY = 'flowrunnerScanRoot';
const FRECENCY_KEY = 'flowrunnerFlowFrecency';
export const RENDER_CAP = 200; // rows painted at once; the rest are "refine your search"

let scanCache = null;        // { files: [{path,name,mtimeMs}], truncated } | null
let scanInFlight = null;     // Promise while a scan runs

function basename(p) { return String(p).split(/[\\/]/).pop() || String(p); }
function dirname(p) {
    const parts = String(p).split(/[\\/]/);
    parts.pop();
    return parts.join('/');
}

// --- scan root (persisted; localStorage, same posture as folder-collapse) ---

export function getScanRoot() {
    try { return localStorage.getItem(SCAN_ROOT_KEY) || null; } catch { return null; }
}
export function setScanRoot(dir) {
    try {
        if (dir) localStorage.setItem(SCAN_ROOT_KEY, dir);
        else localStorage.removeItem(SCAN_ROOT_KEY);
    } catch { /* ignore */ }
    scanCache = null; // force a re-scan against the new root
}

export function canScan() {
    return !!(typeof window !== 'undefined' && window.electronAPI
        && typeof window.electronAPI.scanFlows === 'function');
}

/**
 * Walk the chosen root for .flow.json files (cached after the first run).
 * @param {boolean} [force=false] bypass the cache
 * @returns {Promise<{files:Array,truncated:boolean}|null>}
 */
export async function scanFlows(force = false) {
    if (!canScan()) return null;
    const root = getScanRoot();
    if (!root) return null;
    if (scanCache && !force) return scanCache;
    if (scanInFlight && !force) return scanInFlight;

    scanInFlight = (async () => {
        try {
            const res = await window.electronAPI.scanFlows(root);
            if (res && res.success && Array.isArray(res.files)) {
                scanCache = { files: res.files, truncated: !!res.truncated };
            } else {
                scanCache = { files: [], truncated: false };
                if (res && res.error) logger.warn('[flowIndex] scanFlows error:', res.error);
            }
            return scanCache;
        } catch (err) {
            logger.warn('[flowIndex] scanFlows threw:', err);
            scanCache = { files: [], truncated: false };
            return scanCache;
        } finally {
            scanInFlight = null;
        }
    })();
    return scanInFlight;
}

export function invalidateScan() { scanCache = null; }

// --- frecency (recency bucket x run count), bumped on every launch -----------

function loadFrecency() {
    try { return JSON.parse(localStorage.getItem(FRECENCY_KEY) || '{}') || {}; }
    catch { return {}; }
}
function saveFrecency(map) {
    try { localStorage.setItem(FRECENCY_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

/**
 * Record that a flow was launched (raises it in the empty-query recents order).
 * @param {string} path
 * @param {number} [now=Date.now()]  injectable for tests
 */
export function bumpFrecency(path, now = Date.now()) {
    if (!path) return;
    const map = loadFrecency();
    const prev = map[path] || { count: 0, lastRun: 0 };
    map[path] = { count: prev.count + 1, lastRun: now };
    saveFrecency(map);
}

// Slack-style recency buckets (hours) -> weight; multiplied by run count.
function recencyWeight(lastRun, now) {
    if (!lastRun) return 1;
    const hrs = (now - lastRun) / 3_600_000;
    if (hrs < 4) return 100;
    if (hrs < 24) return 80;
    if (hrs < 72) return 60;
    if (hrs < 24 * 7) return 40;
    if (hrs < 24 * 30) return 20;
    if (hrs < 24 * 90) return 10;
    return 0;
}

/**
 * Frecency score for a path (higher = surfaces sooner). Pure; testable.
 * @param {string} path
 * @param {object} [frecency]  injectable store
 * @param {number} [now]
 */
export function frecencyScore(path, frecency = loadFrecency(), now = Date.now()) {
    const rec = frecency[path];
    if (!rec) return 0;
    return (recencyWeight(rec.lastRun, now) + 1) * (rec.count || 1);
}

// --- the picker's corpus + ranked results ------------------------------------

function toItem(path, mtimeMs) {
    return { id: path, path, label: basename(path), hint: dirname(path), mtimeMs: mtimeMs || 0 };
}

/**
 * Recent flows, frecency-ordered then by recency of use, for the empty query.
 * @param {number} [now]
 * @returns {Array} items
 */
export function getRecentItems(now = Date.now()) {
    const frecency = loadFrecency();
    const recents = getRecentFiles();
    return recents
        .map((p) => ({ item: toItem(p), score: frecencyScore(p, frecency, now) }))
        .sort((a, b) => b.score - a.score) // stable: Array.sort keeps original order on ties (recents already MRU)
        .map((x) => x.item);
}

/**
 * Ranked items for a query. Empty query -> recents; otherwise fuzzy over the
 * scanned corpus (union with recents so an open/recent flow always matches),
 * capped to RENDER_CAP with the true total for the "showing N of M" note.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @returns {{items:Array, total:number, capped:boolean, scanning:boolean, truncated:boolean}}
 */
export function getItems(query, opts = {}) {
    const now = opts.now || Date.now();
    const q = (query || '').trim();

    if (!q) {
        const items = getRecentItems(now).slice(0, RENDER_CAP);
        return { items, total: items.length, capped: false, scanning: false, truncated: false };
    }

    // Build the searchable corpus: scanned files (if present) unioned with recents.
    const seen = new Set();
    const corpus = [];
    const pushPath = (p, mtime) => { if (p && !seen.has(p)) { seen.add(p); corpus.push(toItem(p, mtime)); } };
    if (scanCache && scanCache.files) scanCache.files.forEach((f) => pushPath(f.path, f.mtimeMs));
    getRecentFiles().forEach((p) => pushPath(p));

    const matched = fuzzyFilter(q, corpus, (it) => it.label + ' ' + it.hint).map((m) => m.item);
    const total = matched.length;
    const items = matched.slice(0, RENDER_CAP);
    return {
        items,
        total,
        capped: total > RENDER_CAP,
        scanning: !!scanInFlight,
        truncated: !!(scanCache && scanCache.truncated),
    };
}

// Test hook: reset module state between cases.
export function __resetForTests() { scanCache = null; scanInFlight = null; }
