// e2e/flow-execution.e2e.test.js
/*  Comprehensive flow run / step‑through
    – fixes invalid matcher, aligns with real title.
*/

import { test, expect, _electron as electron } from '@playwright/test';
import path   from 'node:path';
import fs     from 'node:fs/promises';
import { fileURLToPath } from 'url';
import fsSync from 'node:fs'; // Import fsSync for log capture helper

/* ───────────── paths & constants ───────────── */

const __filename      = fileURLToPath(import.meta.url);
const __dirname       = path.dirname(__filename);
const projectRoot     = path.resolve(__dirname, '..');
const flowPath        = path.resolve(projectRoot, 'httpbin-flow.flow.json');

const RECENT_FILES_KEY = 'flowrunnerRecentFiles';
const MAX_RECENT_FILES = 10;
const FLOW_TITLE       = 'E2E All‑Features HTTPBin Flow';

/* ───────────── helpers ───────────── */

async function pushRecent(page, fp) {
  await page.evaluate(
    ({ k, fp, m }) => {
      let a; try { a = JSON.parse(localStorage.getItem(k) || '[]'); }
      catch { a = []; }
      if (!Array.isArray(a)) a = [];
      a = a.filter(p => p !== fp); a.unshift(fp);
      if (a.length > m) a = a.slice(0, m);
      localStorage.setItem(k, JSON.stringify(a));
    },
    { k: RECENT_FILES_KEY, fp, m: MAX_RECENT_FILES }
  );
}

const esc = (p) => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** capture all renderer (console) logs to a file */
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


/* ───────────── suite ───────────── */

test.describe('E2E: Comprehensive Flow Execution', () => {
  let app, page;

  test.slow();

  test.beforeAll(async () => {
    console.log('--- E2E flow-execution setup ---');
    await fs.access(flowPath);                           // assert exists

    app = await electron.launch({
      args: [path.join(projectRoot, 'main.js')],
      cwd : projectRoot,
      env: { ...process.env, NODE_ENV: 'test', E2E: 'true' } // Ensure environment variable is set
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    page.setDefaultTimeout(30_000);
    setupRendererLogCapture(page); // <-- Capture renderer logs to file

    await pushRecent(page, flowPath);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.locator(
      `#flow-list .recent-file-item[data-file-path="${esc(flowPath)}"]`
    ).click(); // Click to load the flow

    // --- ADDED: Wait for the flow to actually render ---
    const firstStepSelector = `.flow-step[data-step-id="step_e2e_1_get_ip"]`;
    await expect(page.locator(firstStepSelector)).toBeVisible({ timeout: 15000 });
    // --- END ADDED WAIT ---

    await expect(page.locator('#workspace-title'))
      .toContainText(FLOW_TITLE, { timeout: 10_000 }); // Keep title check

    // Add the logging again for verification (optional but recommended for now)
    const loadedFlowInfo = await page.evaluate(() => {
       // Access internal state if possible (adjust based on your app's structure)
       // This is a *potential* way, might need refinement
       // @ts-ignore
       const internalState = window.appState || {};
       return {
           name: internalState?.currentFlowModel?.name,
           steps: internalState?.currentFlowModel?.steps?.length
       };
    });
    console.log('[E2E flow-execution setup] Verified loaded flow info:', loadedFlowInfo);


    await expect(page.locator('#save-flow-btn')).toBeDisabled(); // Should be disabled after load

    /* at least one step present */
    const stepCount = await page.locator('.flow-step').count();
    expect(stepCount).toBeGreaterThan(0);
    console.log(`[E2E DEBUG] Workspace title: ${await page.locator('#workspace-title').textContent()}, step count: ${stepCount}`);
    await expect(page.locator('#save-flow-btn')).toBeDisabled();
    console.log('--- Setup complete ---');
  });

  test.afterAll(async () => app && await app.close());

  test.beforeEach(async ({}, testInfo) => {
    console.log(`[BeforeEach] prepare clean runner results → ${testInfo.title}`);
    const clear = page.locator('#clear-results-btn');
    if (await clear.isEnabled().catch(() => false)) await clear.click();
    await expect(page.locator('#runner-results .no-results')).toBeVisible();
  });

  /* --------------- run whole flow --------------- */
  test('Run flow & verify a few key results', async () => {
    // Log workspace title and step count before running
    const title = await page.locator('#workspace-title').textContent();
    const stepCount = await page.locator('.flow-step').count();
    console.log(`[E2E DEBUG] Workspace title: ${title}, step count: ${stepCount}`);
    await page.locator('#run-flow-btn').click();
    await expect(page.locator('#stop-flow-btn')).toBeEnabled();

    // --- MODIFICATION START: Wait for results area to populate before specific check ---
    // Wait for the "no results" message OR any result item to ensure the panel is active
    await expect(
        page.locator('#runner-results .no-results').or(page.locator('#runner-results .result-item'))
    ).toHaveCount(1, { timeout: 15_000 }); // Wait up to 15s for *something* to show

    // Now specifically check for the first step's result
    const step1ResultLocator = page.locator('.result-item[data-step-id="step_e2e_1_get_ip"]');
    const step1StatusLocator = step1ResultLocator.locator('.result-status');

    await expect(step1ResultLocator).toBeVisible({ timeout: 20_000 });
    try {
      await expect(step1StatusLocator).toHaveText('SUCCESS', { timeout: 20_000 });
      console.log('[Test] Step 1 SUCCESS result verified.');
    } catch (e) {
      console.error('DEBUG: Failed to verify SUCCESS for step 1. Runner results HTML:');
      console.error(await page.locator('#runner-results').innerHTML());
      throw e;
    }
    // --- MODIFICATION END ---

    // Wait for run to finish
    await expect(page.locator('#run-flow-btn'))
      .toBeEnabled({ timeout: 90_000 });
    console.log('[Test] Flow run finished (run button enabled).');
  });

  /* --------------- step through first 3 --------------- */
  test('Step through first three steps & assert SUCCESS', async () => {
    const clickStep = () => page.locator('#step-flow-btn').click();

    console.log('[Test] Stepping: Step 1');
    await clickStep();
    await expect(
      page.locator('.result-item[data-step-id="step_e2e_1_get_ip"] .result-status')
    ).toHaveText('SUCCESS', { timeout: 15_000 });
    console.log('[Test] Stepping: Step 1 SUCCESS');

    console.log('[Test] Stepping: Step 2');
    await clickStep();
    await expect(
      page.locator('.result-item[data-step-id="step_e2e_2_check_status"] .result-status')
    ).toHaveText('SUCCESS');
    console.log('[Test] Stepping: Step 2 SUCCESS');

    console.log('[Test] Stepping: Step 3');
    await clickStep();
    await expect(
      page.locator('.result-item[data-step-id="step_e2e_3_post_data"] .result-status')
    ).toHaveText('SUCCESS', { timeout: 15_000 });
    console.log('[Test] Stepping: Step 3 SUCCESS. Test complete.');
  });
});