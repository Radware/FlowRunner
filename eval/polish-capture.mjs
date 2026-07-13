// ========== eval/polish-capture.mjs ==========
// Capture the REAL rendered app for the polish audit: screenshots of every
// surface (light + dark) + a computed-style dump (spacing, sizing, radii,
// typography) of the interactive elements, saved for audit agents.
// Run: node eval/polish-capture.mjs <outDir>
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'eval/audit';
fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({ executablePath: '/Applications/FlowRunner.app/Contents/MacOS/FlowRunner' });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
page.setDefaultTimeout(60000);
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot:', name); };
const sleep = (ms) => page.waitForTimeout(ms);

// AI on (sparkle affordances must be audited too — model already on disk)
await page.evaluate(async () => { await window.electronAPI.ai.setEnabled(true); await window.electronAPI.ai.selectModel('gemma4-e2b'); });
await page.waitForSelector('html.ai-ready');

// Force light theme first
await page.evaluate(() => { if (document.documentElement.dataset.theme === 'dark') document.getElementById('theme-toggle-btn').click(); });
await sleep(300);

// Deterministic inspector state: a persisted collapse (localStorage.runnerCollapsed)
// blanks the whole results pane and stalls every result-status wait.
await page.evaluate(() => {
    if (localStorage.getItem('runnerCollapsed') === 'true') document.getElementById('runner-toggle-btn')?.click();
});
await sleep(200);

// 1. empty state
await shot('01-empty-light');

// 2. flow + editor Basic
await page.locator('#add-flow-btn').click();
await page.locator('.btn-add-step').click();
await page.locator('.step-type-option[data-type="request"]').click();
await page.locator('.request-bar-url').fill('https://jsonplaceholder.typicode.com/users/1');
await page.locator('.btn-save-step').click();
await sleep(300);
await shot('02-editor-basic-light');

// 3. editor Power: extract + assertions rows visible (with AI suggest buttons)
await page.locator('[data-disclosure="power"]').click();
await page.locator('.tab-button[data-tab="extract"]').click();
await page.locator('.btn-add-extract').click();
await sleep(200);
await shot('03-editor-extract-light');
await page.locator('.tab-button[data-tab="assertions"]').click();
await page.locator('.btn-add-assertion').click();
await sleep(200);
await shot('04-editor-assertions-light');

// 4. condition editor (with the AI describe-it row)
await page.locator('[data-ref="addTopLevelStepBtn"]').click();
await page.locator('.step-type-option[data-type="condition"]').click();
await sleep(400);
await shot('05-editor-condition-light');
await page.locator('.btn-cancel-step, .btn-save-step').last().click().catch(() => {});
await sleep(200);

// 5. run -> results feed (collapsed + expanded + AI buttons)
await page.locator('#run-flow-btn').click();
await page.waitForSelector('.result-status:has-text("SUCCESS")', { timeout: 30000 });
await sleep(400);
await shot('06-results-light');
await page.locator('.result-item .result-header, .result-item').first().click().catch(() => {});
await sleep(200);
await shot('07-results-expanded-light');

// 6. step-type dialog
await page.locator('[data-ref="addTopLevelStepBtn"]').click();
await sleep(200);
await shot('08-step-type-dialog-light');
await page.keyboard.press('Escape');
await page.locator('.step-type-close').click().catch(() => {});
await sleep(200);

// 7. palette
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
await sleep(300);
await shot('09-palette-light');
await page.keyboard.press('Escape');

// 8. inspector expand mode (Config tab roomy)
await page.locator('.inspector-tab[data-tab="info"]').click();
await page.locator('#inspector-expand-btn').click();
await sleep(400);
await shot('10-inspector-expanded-config-light');
await page.locator('#inspector-expand-btn').click();
await page.locator('.inspector-tab[data-tab="results"]').click();
await sleep(300);

// 9. drawer select mode + action bar + context menu
await page.locator('#flow-select-toggle').click();
await page.locator('#flow-list .recent-file-item').first().click().catch(() => {});
await sleep(200);
await shot('11-select-mode-actionbar-light');
await page.locator('#flow-list .recent-file-item').first().click({ button: 'right' }).catch(() => {});
await sleep(200);
await shot('12-context-menu-light');
await page.keyboard.press('Escape');
await page.locator('#flow-select-toggle').click().catch(() => {});

// 10. AI modal
await page.locator('#rail-ai-btn').click();
await sleep(300);
await shot('13-ai-modal-light');
await page.keyboard.press('Escape');

// 11. Runs page + picker + launch popover
await page.locator('#rail-runs-btn').click();
await sleep(300);
await shot('14-runs-page-light');
await page.locator('#runs-new-run-btn').click();
await sleep(300);
await shot('15-run-picker-light');
await page.keyboard.press('Escape');
await page.locator('#rail-runs-btn').click(); // back to flow
await page.locator('#bg-run-current-btn').click();
await sleep(300);
await shot('16-launch-popover-light');
await page.keyboard.press('Escape');

// 12. DARK theme sweep of the key surfaces
await page.locator('#theme-toggle-btn').click();
await sleep(300);
await shot('17-editor-dark');
await page.locator('#run-flow-btn').click();
await page.waitForSelector('.result-status:has-text("SUCCESS")', { timeout: 30000 });
await shot('18-results-dark');
await page.locator('#rail-ai-btn').click(); await sleep(300);
await shot('19-ai-modal-dark');
await page.keyboard.press('Escape');
await page.locator('#rail-runs-btn').click(); await sleep(300);
await shot('20-runs-page-dark');
await page.locator('#rail-runs-btn').click();
await page.locator('#theme-toggle-btn').click(); // back to light
await sleep(200);

// 13. Present mode
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+d' : 'Control+Shift+d');
await sleep(500);
await shot('21-present-light');
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+d' : 'Control+Shift+d');
await sleep(300);

// 14. computed-style dump of interactive elements (both themes)
async function styleDump() {
    return page.evaluate(() => {
        const PROPS = ['padding', 'margin', 'gap', 'height', 'width', 'font-size', 'font-weight',
            'border-radius', 'border-width', 'color', 'background-color', 'line-height', 'align-items'];
        const SELECTORS = [
            '.topbar-run', '#run-flow-btn', '#step-flow-btn', '#stop-flow-btn', '#bg-run-current-btn',
            '#save-flow-btn', '#save-as-flow-btn', '.workspace-file-controls', '.topbar-flow', '.segmented', '.segmented__cell',
            '.app-rail', '.rail-btn', '.rail-divider', '#system-status-pip', '.run-verdict',
            '.sidebar-actions', '.sidebar-actions .btn', '.sidebar-search', '.drawer-section-head', '.drawer-section-actions',
            '.flow-list-item', '.flow-item-content', '.flowlist-actionbar', '#flowlist-run-btn', '#flowlist-selcount',
            '.inspector-tabs', '.inspector-tab', '.runner-header-actions', '.btn-inspector-expand', '.runner-header',
            '.runner-options', '.runner-option', '#bg-run-btn', '#clear-results-btn', '.results-filter', '.results-actions',
            '#results-search', '#results-status-filter', '.result-item', '.result-header', '.result-header-right', '.btn-ai-explain',
            '.step-editor', '.step-editor .form-group', '.request-bar-url', '.btn-save-step', '.tab-button',
            '.btn-add-extract', '.btn-ai-suggest', '.extract-row', '.assertion-row', '.ai-inline-field', '.btn-ai-sparkle',
            '.condition-builder', '.condition-item', '.ai-nl-condition',
            '.runs-page-head', '.runs-launcher', '#runs-new-run-btn', '.bg-run-card', '.bg-run-head', '.bg-run-meta', '.bg-feed-row',
            '.ai-modal-head', '.ai-modal-body', '.ai-enable-row', '.ai-model-card', '.ai-model-actions', '.ai-modal-status', '.ai-modal-quality',
            '.palette-panel', '.palette-search', '.context-menu', '.context-menu-item', '.launch-config-pop', '.lcp-row',
            '.run-picker', '.run-picker-head', '.run-picker-row', '.run-picker-foot',
            '.btn', '.btn-sm', '.btn-primary', '.btn-secondary', '.btn-ghost',
        ];
        const out = {};
        for (const sel of SELECTORS) {
            const el = document.querySelector(sel);
            if (!el) { out[sel] = null; continue; }
            const cs = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            out[sel] = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]));
            out[sel].rect = { w: Math.round(rect.width), h: Math.round(rect.height) };
        }
        return out;
    });
}
fs.writeFileSync(path.join(OUT, 'styles-light.json'), JSON.stringify(await styleDump(), null, 1));
await page.locator('#theme-toggle-btn').click(); await sleep(300);
fs.writeFileSync(path.join(OUT, 'styles-dark.json'), JSON.stringify(await styleDump(), null, 1));
await page.locator('#theme-toggle-btn').click();

await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.destroy());
await app.close().catch(() => {});
console.log('CAPTURE COMPLETE ->', OUT);
