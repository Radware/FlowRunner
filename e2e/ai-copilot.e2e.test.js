// e2e/ai-copilot.e2e.test.js
// Beta 1.5: the AI Copilot's REAL Electron seams — preload bridge, IPC
// round-trips, settings persistence, modal UI, and affordance gating.
// No model is downloaded in CI: everything here exercises the machinery
// up to (but not including) inference.
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { setupMockUpdateRoute, removeMockUpdateRoute } from './mockUpdate.js';
import { setupRendererLogCapture } from './testUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test.describe('E2E: AI Copilot (beta)', () => {
    let app, page;

    test.beforeAll(async () => {
        app = await electron.launch({
            args: [path.join(projectRoot, 'main.js')],
            cwd: projectRoot,
            env: { ...process.env, NODE_ENV: 'test', E2E: 'true' }
        });
        page = await app.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        page.setDefaultTimeout(30000);
        await setupMockUpdateRoute(page);
        setupRendererLogCapture(page);
        // Deterministic start: copilot disabled.
        await page.evaluate(() => window.electronAPI.ai.setEnabled(false));
    });

    test.afterAll(async () => {
        if (page) await removeMockUpdateRoute(page).catch(() => {});
        if (app) {
            await app.evaluate(({ BrowserWindow }) => {
                const win = BrowserWindow.getAllWindows()[0];
                if (win) win.destroy();
            });
            await app.close().catch(() => {});
        }
    });

    test('preload exposes the ai bridge and getState round-trips', async () => {
        const state = await page.evaluate(() => window.electronAPI.ai.getState());
        expect(state.success).toBe(true);
        expect(state.data.enabled).toBe(false);
        expect(Array.isArray(state.data.catalog)).toBe(true);
        expect(state.data.catalog.length).toBeGreaterThanOrEqual(3);
        expect(state.data.totalRamGB).toBeGreaterThan(0);
        // No model on CI disk
        state.data.catalog.forEach((m) => expect(m.downloading).toBe(false));
    });

    test('affordances are hidden while the copilot is off', async () => {
        const anyVisible = await page.evaluate(() =>
            [...document.querySelectorAll('.ai-only')].some((el) => el.offsetParent !== null));
        expect(anyVisible).toBe(false);
        await expect(page.locator('html')).not.toHaveClass(/ai-ready/);
    });

    test('rail button opens the settings modal with the catalog', async () => {
        await page.locator('#rail-ai-btn').click();
        await expect(page.locator('.ai-modal')).toBeVisible();
        await expect(page.locator('.ai-modal-title')).toContainText('AI Copilot');
        await expect(page.locator('[data-ai-modal="enable"]')).toBeVisible();
        expect(await page.locator('.ai-model-card').count()).toBeGreaterThanOrEqual(3);
        // All models show a Download button (nothing downloaded on CI)
        expect(await page.locator('[data-ai-modal="download"]').count()).toBeGreaterThanOrEqual(3);
    });

    test('enable + select persists through IPC and the store', async () => {
        await page.locator('[data-ai-modal="enable"]').check();
        await page.locator('.ai-model-card input[name="ai-model"]').first().check();
        await page.waitForTimeout(300);
        const state = await page.evaluate(() => window.electronAPI.ai.getState());
        expect(state.data.enabled).toBe(true);
        expect(state.data.selectedModelId).toBeTruthy();
        // ai-ready stays FALSE: enabled + selected but no weights on disk.
        await expect(page.locator('html')).not.toHaveClass(/ai-ready/);
    });

    test('generation without a downloaded model fails cleanly (no crash)', async () => {
        const res = await page.evaluate(() => window.electronAPI.ai.generateStructured({
            prompt: 'x', schema: { type: 'object', properties: { a: { type: 'string' } } },
        }));
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/not downloaded|No AI model/i);
    });

    test('disable cleans up and closes over Escape', async () => {
        await page.locator('[data-ai-modal="enable"]').uncheck();
        await page.waitForTimeout(200);
        const state = await page.evaluate(() => window.electronAPI.ai.getState());
        expect(state.data.enabled).toBe(false);
        await page.keyboard.press('Escape');
        await expect(page.locator('.ai-modal')).toHaveCount(0);
    });
});
