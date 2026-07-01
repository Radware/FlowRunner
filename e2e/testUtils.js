// e2e/testUtils.js
// Common helper utilities shared across Playwright tests
import fsSync from 'node:fs';

export async function pushRecent(page, filePath, key = 'flowrunnerRecentFiles', max = 10) {
    await page.evaluate(
        async ({ k, fp, m }) => {
            let arr; try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch { arr = []; }
            if (!Array.isArray(arr)) arr = [];
            arr = arr.filter(p => p !== fp);
            arr.unshift(fp);
            if (arr.length > m) arr = arr.slice(0, m);
            localStorage.setItem(k, JSON.stringify(arr));
            // Mirror into the durable electron-store: hydrateRecentFiles() treats
            // it as the source of truth on reload and would wipe a localStorage-only seed.
            if (window.electronAPI && typeof window.electronAPI.setRecentFiles === 'function') {
                try { await window.electronAPI.setRecentFiles(arr); } catch { /* best effort */ }
            }
        },
        { k: key, fp: filePath, m: max }
    );
}

export const esc = (p) => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function setupRendererLogCapture(page, logFile = 'e2e-renderer-logs.txt') {
    try {
        fsSync.writeFileSync(logFile, '');
        console.log(`[E2E Log Capture] Cleared/Created log file: ${logFile}`);
    } catch (err) {
        console.error(`[E2E Log Capture] Error clearing log file ${logFile}:`, err);
    }

    page.on('console', msg => {
        const line = `[renderer][${msg.type()}] ${msg.text()}\n`;
        fsSync.appendFileSync(logFile, line);
    });
}
