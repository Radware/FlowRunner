// e2e/close-confirm.e2e.test.js
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'url';
import { setupMockUpdateRoute, removeMockUpdateRoute } from './mockUpdate.js';
import { pushRecent, esc, setupRendererLogCapture } from './testUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataRoot    = path.resolve(__dirname, 'e2e-test-data');
const flowPath    = path.join(dataRoot, 'close-confirm.flow.json');

// Stub the main process close confirmation dialog
async function stubCloseConfirm(app) {
    await app.evaluate(() => {
        // @ts-ignore
        const electronRequire = global.require || require;
        const { dialog } = electronRequire('electron');
        if (!dialog.__original_showMessageBox) {
            dialog.__original_showMessageBox = dialog.showMessageBox;
        }
        dialog.showMessageBox = async () => {
            global.__closeConfirmCalled = true;
            return { response: 0 }; // Cancel
        };
    });
}

async function restoreCloseConfirm(app) {
    await app.evaluate(() => {
        // @ts-ignore
        const electronRequire = global.require || require;
        const { dialog } = electronRequire('electron');
        if (dialog.__original_showMessageBox) {
            dialog.showMessageBox = dialog.__original_showMessageBox;
            delete dialog.__original_showMessageBox;
        }
        delete global.__closeConfirmCalled;
    });
}

test.describe('E2E: Window Close Confirmation', () => {
    let app, page;

    test.beforeAll(async () => {
        await fs.mkdir(dataRoot, { recursive: true });
        const flow = { name: 'Close Confirm Flow', steps: [{ id: 's1', name: 'Step', type: 'request', url: 'http://a' }] };
        await fs.writeFile(flowPath, JSON.stringify(flow, null, 2));

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

        await pushRecent(page, flowPath);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator(`#flow-list .recent-file-item[data-file-path="${esc(flowPath)}"]`).click();
        await expect(page.locator('#workspace-title')).toContainText('Close Confirm Flow');
    });

    test.afterAll(async () => {
        if (page) await removeMockUpdateRoute(page).catch(() => {});
        if (app) {
            await app.evaluate(({ BrowserWindow }) => {
                const win = BrowserWindow.getAllWindows()[0];
                if (win) win.destroy();
            });
            await restoreCloseConfirm(app).catch(() => {});
            await app.close();
        }
        await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => {});
    });

    test('Dirty close shows confirmation and cancel keeps window', async () => {
        // Edit flow name to trigger dirty flag
        await page.locator('#toggle-info-btn').click();
        await page.locator('#global-flow-name').fill('Edited Flow');
        await expect(page.locator('#save-flow-btn')).toBeEnabled({ timeout: 8000 });

        await stubCloseConfirm(app);

        await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.close();
        });

        const called = await app.evaluate(() => global.__closeConfirmCalled || false);
        
        expect(called).toBe(true);
        expect(app.windows().length).toBe(1);
    });
});
