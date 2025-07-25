// e2e/simple-request-flow.e2e.test.js
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath } from 'url';
import { startHttpbinServer, stopHttpbinServer } from './httpbin-server.js';
import { setupMockUpdateRoute, removeMockUpdateRoute } from './mockUpdate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const electronAppPath = path.resolve(__dirname, '..');
const testDataRoot    = path.resolve(__dirname, 'e2e-test-data');
const simpleFlowPath  = path.join(testDataRoot, 'simple-request.flow.json');

const RECENT_FILES_KEY = 'flowrunnerRecentFiles';
const MAX_RECENT_FILES = 10;
let mockServer;
let mockUrl;

async function pushToRecentFiles(page, filePath) {
  return page.evaluate(
    ({ key, filePath, max }) => {
      let arr = [];
      try {
        const raw = localStorage.getItem(key);
        if (raw) arr = JSON.parse(raw);
        if (!Array.isArray(arr)) arr = [];
      } catch { arr = []; }
      arr = arr.filter((p) => p !== filePath);
      arr.unshift(filePath);
      if (arr.length > max) arr = arr.slice(0, max);
      localStorage.setItem(key, JSON.stringify(arr));
      return true;
    },
    { key: RECENT_FILES_KEY, filePath, max: MAX_RECENT_FILES }
  );
}

function setupRendererLogCapture(page, logFile = 'e2e-renderer-logs.txt') {
  // Clear the log file at the start of capture setup
  try {
    fsSync.writeFileSync(logFile, ''); // Overwrite existing or create new empty file
    console.log(`[E2E Log Capture] Cleared/Created log file: ${logFile}`);
  } catch (err) {
    console.error(`[E2E Log Capture] Error clearing log file ${logFile}:`, err);
  }

  page.on('console', msg => {
    const line = `[renderer][${msg.type()}] ${msg.text()}\n`;
    fsSync.appendFileSync(logFile, line);
  });
}


test.describe('E2E: Simple Request Flow Execution', () => {
  let electronApp;
  let page;

  test.slow();

  test.beforeAll(async () => {
    console.log('--- E2E Setup (simple-request) ---');
    await fs.mkdir(testDataRoot, { recursive: true });
    ({ server: mockServer, baseUrl: mockUrl } = await startHttpbinServer());

    const flow = {
      name : 'Simple Request Flow',
      steps: [
        {
          id   : 'step_simple_1',
          name : 'Get IP',
          type : 'request',
          method: 'GET',
          url  : `${mockUrl}/get`,
          headers: { Accept: 'application/json' },
          body : '',
          extract: { clientIp: 'body.origin' },
          onFailure: 'stop',
        },
        {
          id   : 'step_simple_2',
          name : 'Get UUID',
          type : 'request',
          method: 'GET',
          url  : `${mockUrl}/uuid`,
          headers: { Accept: 'application/json' },
          body : '',
          extract: { uuid: 'body.uuid' },
          onFailure: 'stop',
        }
      ],
    };
    await fs.writeFile(simpleFlowPath, JSON.stringify(flow, null, 2));

    electronApp = await electron.launch({
      args: [path.join(electronAppPath, 'main.js')],
      cwd : electronAppPath,
      env: { ...process.env, NODE_ENV: 'test', E2E: 'true' } // Ensure environment variable is set
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    page.setDefaultTimeout(20_000);
    await setupMockUpdateRoute(page);
    setupRendererLogCapture(page); // <-- Capture renderer logs to file

    // Ensure a clean recent files list
    await page.evaluate(key => localStorage.setItem(key, '[]'), RECENT_FILES_KEY);
    await pushToRecentFiles(page, simpleFlowPath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.locator('#flow-list .recent-file-item').filter({ hasText: 'simple-request.flow.json' }).click();

    await expect(page.locator('#workspace-title')).toContainText('Simple Request Flow', { timeout: 10000 });

    // Log loaded flow info for verification
    const loadedFlowInfo = await page.evaluate(() => {
        // @ts-ignore
       const internalState = window.appState || {};
       return {
           name: internalState?.currentFlowModel?.name,
           steps: internalState?.currentFlowModel?.steps?.length
       };
    });
    console.log('[E2E simple-request setup] Verified loaded flow info:', loadedFlowInfo);

    console.log('--- E2E Setup Complete ---');
  });

  test.afterAll(async () => {
    if (page) await removeMockUpdateRoute(page).catch(() => {});
    if (electronApp) await electronApp.close();
    if (mockServer) await stopHttpbinServer(mockServer);
    try { await fs.rm(simpleFlowPath, { force: true }); } catch {}
  });

  test('Launch App → Open via Recent → Run → Check Results', async () => {
    console.log('[Test] prepare clean runner results');
    const clearBtn = page.locator('#clear-results-btn');
    if (await clearBtn.isEnabled()) await clearBtn.click();
    await expect(page.locator('#runner-results .no-results')).toBeVisible();

    // run flow
    console.log('[Test] Running flow...');
    await page.locator('#run-flow-btn').click();

    // instead of racing the stop‑button, just wait for SUCCESS
    console.log('[Test] Waiting for SUCCESS result...');
    const step1 = page.locator('#runner-results .result-item[data-step-id="step_simple_1"]');
    await expect(step1.locator('.result-status')).toHaveText('SUCCESS', { timeout: 15_000 });
    await expect(step1.locator('.result-body pre')).toContainText('"origin"');
    console.log('[Test] Step 1 SUCCESS result found.');

    const step2 = page.locator('#runner-results .result-item[data-step-id="step_simple_2"]');
    await expect(step2.locator('.result-status')).toHaveText('SUCCESS', { timeout: 15_000 });
    await expect(step2.locator('.result-body pre')).toContainText('"uuid"');
    console.log('[Test] Step 2 SUCCESS result found.');

    // final UI state
    await expect(page.locator('#run-flow-btn')).toBeEnabled();
    console.log('[Test] Run button re-enabled. Test complete.');
  });
});
