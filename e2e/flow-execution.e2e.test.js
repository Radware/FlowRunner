// e2e/flow-execution.e2e.test.js
/*  Comprehensive flow run / step‑through
    – fixes invalid matcher, aligns with real title.
    – UPDATED: flowPath to look in e2e-test-data
    – UPDATED: "Run flow" test to wait more robustly for results
    – UPDATED: Dynamically create mock-flow.flow.json in test.beforeAll
*/

import { test, expect, _electron as electron } from '@playwright/test';
import path   from 'node:path';
import fs     from 'node:fs/promises'; // fs/promises for async operations
import { fileURLToPath } from 'url';
import fsSync from 'node:fs';
import { startHttpbinServer, stopHttpbinServer } from './httpbin-server.js';
import { setupMockUpdateRoute, removeMockUpdateRoute } from './mockUpdate.js';

/* ───────────── paths & constants ───────────── */

const __filename      = fileURLToPath(import.meta.url);
const __dirname       = path.dirname(__filename);
const projectRoot     = path.resolve(__dirname, '..'); // Renamed for clarity
const testDataDir     = path.resolve(__dirname, 'e2e-test-data'); // Define test data directory
const flowPath        = path.resolve(testDataDir, 'mock-flow.flow.json'); // Path for the flow file

const RECENT_FILES_KEY = 'flowrunnerRecentFiles';
const MAX_RECENT_FILES = 10;
const FLOW_TITLE       = 'E2E All‑Features Mock Flow';
let mockServer;
let mockUrl;

// Content for the local mock httpbin flow
const MOCK_FLOW_CONTENT = {
  "id": "flow_e2e_mock_all_features",
  "name": "E2E All‑Features Mock Flow",
  "description": "Comprehensive flow that touches every FlowRunner v1.0.0 feature using a local mock server.",
  "headers": {
    "X-Global-Header": "FlowRunner E2E",
    "Accept": "application/json"
  },
  "steps": [
    {
      "id": "step_e2e_1_get_ip",
      "name": "Get IP & Headers",
      "type": "request",
      "method": "GET",
      "url": "{{baseUrl}}/get?run={{randomNumber}}",
      "headers": {
        "X-Request-Name": "{{userName}}"
      },
      "onFailure": "stop",
      "extract": {
        "ip": "body.origin",
        "userAgent": "body.headers.User-Agent",
        "statusCode": ".status",
        "echoedRandom": "body.args.run"
      }
    },
    {
      "id": "step_e2e_2_check_status",
      "name": "Status OK?",
      "type": "condition",
      "condition": "",
      "conditionData": {
        "variable": "statusCode",
        "operator": "equals",
        "value": "200"
      },
      "then": [
        {
          "id": "step_e2e_3_post_data",
          "name": "POST echo data",
          "type": "request",
          "method": "POST",
          "url": "{{baseUrl}}/post",
          "headers": {
            "Content-Type": "application/json",
            "X-User": "{{userName}}"
          },
          "onFailure": "stop",
          "body": { // Note: Actual ##VAR## markers are used in the real file, for testing simplicity, placeholders are fine if substitution is tested elsewhere or not the focus here.
                    // If precise marker testing is needed, ensure the stringified body uses them.
            "ip": "{{ip}}", // Simpler for direct JSON stringification if not testing marker substitution here.
            "msg": "Hello from {{userName}}",
            "testMode": "{{testMode}}",
            "run": "{{randomNumber}}"
          },
          "extract": {
            "echoedIp": "body.json.ip",
            "echoedRun": "body.json.run",
            "contentTypeHeader": "headers.Content-Type"
          }
        },
        {
          "id": "step_e2e_4_check_type",
          "name": "Check JSON header",
          "type": "condition",
          "condition": "",
          "conditionData": {
            "variable": "contentTypeHeader",
            "operator": "contains",
            "value": "json"
          },
          "then": [
            {
              "id": "step_e2e_5_get_uuid",
              "name": "Get UUID",
              "type": "request",
              "method": "GET",
              "url": "{{baseUrl}}/uuid",
              "onFailure": "continue",
              "extract": {
                "uuid": "body.uuid"
              }
            },
            {
              "id": "step_e2e_15_final_anything",
              "name": "Final echo with UUID",
              "type": "request",
              "method": "GET",
              "url": "{{baseUrl}}/anything/final?uuid={{uuid}}",
              "onFailure": "continue",
              "extract": {
                "echoedUuid": "body.args.uuid"
              }
            }
          ],
          "else": [
            {
              "id": "step_e2e_5b_delay",
              "name": "Else Delay",
              "type": "request",
              "method": "GET",
              "url": "{{baseUrl}}/delay/1",
              "onFailure": "continue",
              "extract": {
                "delayStatus": ".status"
              }
            }
          ]
        }
      ],
      "else": [
        {
          "id": "step_e2e_6_teapot",
          "name": "Get Teapot",
          "type": "request",
          "method": "GET",
          "url": "{{baseUrl}}/status/418",
          "onFailure": "continue",
          "extract": {
            "teapotStatus": ".status"
          }
        },
        {
          "id": "step_e2e_7_check_teapot",
          "name": "Teapot is 418?",
          "type": "condition",
          "condition": "",
          "conditionData": {
            "variable": "teapotStatus",
            "operator": "equals",
            "value": "418"
          },
          "then": [
            {
              "id": "step_e2e_8_log_teapot",
              "name": "Log Teapot Success",
              "type": "request",
              "method": "GET",
              "url": "{{baseUrl}}/anything/teapot",
              "onFailure": "continue",
              "extract": {
                "anythingStatus": ".status"
              }
            }
          ],
          "else": []
        }
      ]
    },
    {
      "id": "step_e2e_9_get_json",
      "name": "Get slideshow JSON",
      "type": "request",
      "method": "GET",
      "url": "{{baseUrl}}/json",
      "onFailure": "stop",
      "extract": {
        "slides": "body.slideshow.slides"
      }
    },
    {
      "id": "step_e2e_10_has_slides",
      "name": "Has slides?",
      "type": "condition",
      "condition": "",
      "conditionData": {
        "variable": "slides",
        "operator": "is_array",
        "value": ""
      },
      "then": [
        {
          "id": "step_e2e_11_loop_slides",
          "name": "Loop Slides",
          "type": "loop",
          "source": "slides",
          "loopVariable": "slide",
          "steps": [
            {
              "id": "step_e2e_12_check_title",
              "name": "Title contains Widget??",
              "type": "condition",
              "condition": "{{slide}} && typeof {{slide}}.includes === 'function' && {{slide}}.includes(\"Widget\")",
              "conditionData": {
                "variable": "slide.title", // Corrected path for condition
                "operator": "contains",
                "value": "Widget",
                "preview": "slide.title contains \"Widget\""
              },
              "then": [
                {
                  "id": "step_e2e_13_echo_slide",
                  "name": "Echo slide via anything",
                  "type": "request",
                  "method": "GET",
                  "url": "{{baseUrl}}/anything/slide/{{slide.title}}",
                  "headers": {
                    "X-Slide-Title": "{{slide.title}}"
                  },
                  "onFailure": "continue",
                  "extract": {
                    "echoedTitle": "body.headers.X-Slide-Title"
                  }
                }
              ],
              "else": []
            }
          ]
        }
      ],
      "else": []
    },
    {
      "id": "step_e2e_14_get_headers",
      "name": "Echo headers",
      "type": "request",
      "method": "GET",
      "url": "{{baseUrl}}/headers",
      "onFailure": "stop",
      "extract": {
        "globalHeaderEcho": "body.headers.X-Global-Header"
      }
    }
  ],
  "staticVars": {
    "baseUrl": "http://localhost",
    "testMode": true,
    "randomNumber": 42,
    "userName": "FlowRunnerUser"
  },
  "visualLayout": { // Keeping visual layout simple or can be expanded
    "step_e2e_1_get_ip": { "x": 50, "y": 50 },
    "step_e2e_2_check_status": { "x": 350, "y": 50 }
    // Add other step layouts if needed for graph view testing, otherwise default layout will be used
  }
};


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

function setupRendererLogCapture(page, logFile = 'e2e-renderer-logs.txt') {
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

/* ───────────── suite ───────────── */

test.describe('E2E: Comprehensive Flow Execution', () => {
  let app, page;

  test.slow();

  test.beforeAll(async () => {
    console.log('--- E2E flow-execution setup ---');

    ({ server: mockServer, baseUrl: mockUrl } = await startHttpbinServer());
    MOCK_FLOW_CONTENT.staticVars.baseUrl = mockUrl;

    // Ensure the test data directory exists
    await fs.mkdir(testDataDir, { recursive: true });
    // Write the flow file content dynamically
    await fs.writeFile(flowPath, JSON.stringify(MOCK_FLOW_CONTENT, null, 2));
    console.log(`[E2E flow-execution setup] Dynamically created flow file at: ${flowPath}`);

    // The fs.access check is now redundant here if we just created it, but good for sanity
    try {
        await fs.access(flowPath);
        console.log(`[E2E flow-execution setup] Successfully accessed flow file at: ${flowPath}`);
    } catch (error) {
        console.error(`[E2E flow-execution setup] Error accessing dynamically created flow file at ${flowPath}. Error: ${error.message}`);
        throw error;
    }
    
    app = await electron.launch({
      args: [path.join(projectRoot, 'main.js')],
      cwd : projectRoot,
      env: { ...process.env, NODE_ENV: 'test', E2E: 'true' }
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
    page.setDefaultTimeout(30_000);
    await setupMockUpdateRoute(page);
    setupRendererLogCapture(page);

    await pushRecent(page, flowPath);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });

    await page.locator(
      `#flow-list .recent-file-item[data-file-path="${esc(flowPath)}"]`
    ).click();

    const firstStepSelector = `.flow-step[data-step-id="step_e2e_1_get_ip"]`;
    await expect(page.locator(firstStepSelector)).toBeVisible({ timeout: 20000 });

    await expect(page.locator('#workspace-title'))
      .toContainText(FLOW_TITLE, { timeout: 15_000 });

    const loadedFlowInfo = await page.evaluate(() => {
       // @ts-ignore
       const internalState = window.appState || {};
       return {
           name: internalState?.currentFlowModel?.name,
           steps: internalState?.currentFlowModel?.steps?.length
       };
    });
    console.log('[E2E flow-execution setup] Verified loaded flow info:', loadedFlowInfo);

    await expect(page.locator('#save-flow-btn')).toBeDisabled();

    const stepCount = await page.locator('.flow-step').count();
    expect(stepCount).toBeGreaterThan(0);
    console.log(`[E2E DEBUG] Workspace title: ${await page.locator('#workspace-title').textContent()}, step count: ${stepCount}`);
    await expect(page.locator('#save-flow-btn')).toBeDisabled();
    console.log('--- Setup complete ---');
  });

  // Modified afterAll to clean up the dynamically created file and directory if it's empty
  test.afterAll(async () => {
    if (page) await removeMockUpdateRoute(page).catch(() => {});
    if (app) await app.close();
    if (mockServer) await stopHttpbinServer(mockServer);
    try {
      await fs.rm(flowPath, { force: true }); // Remove the specific flow file
      console.log(`[E2E flow-execution teardown] Removed flow file: ${flowPath}`);
      // Optionally, try to remove the directory if it's empty
      const filesInTestDataDir = await fs.readdir(testDataDir);
      if (filesInTestDataDir.length === 0) {
        await fs.rmdir(testDataDir);
        console.log(`[E2E flow-execution teardown] Removed empty test data directory: ${testDataDir}`);
      }
    } catch (error) {
      console.warn(`[E2E flow-execution teardown] Error during cleanup: ${error.message}`);
    }
  });


  test.beforeEach(async ({}, testInfo) => {
    console.log(`[BeforeEach] prepare clean runner results → ${testInfo.title}`);
    const clear = page.locator('#clear-results-btn');
    if (await clear.isEnabled({timeout: 5000}).catch(() => false)) {
        await clear.click();
    }
    await expect(page.locator('#runner-results .no-results')).toBeVisible({timeout: 5000});
  });

  /* --------------- run whole flow --------------- */
  test('Run flow & verify a few key results', async () => {
    const title = await page.locator('#workspace-title').textContent();
    const stepCount = await page.locator('.flow-step').count();
    console.log(`[E2E DEBUG] Workspace title: ${title}, step count: ${stepCount}`);
    await page.locator('#run-flow-btn').click();
    await expect(page.locator('#stop-flow-btn')).toBeEnabled();

    const step1ResultLocator = page.locator('.result-item[data-step-id="step_e2e_1_get_ip"]');
    const step1StatusLocator = step1ResultLocator.locator('.result-status');

    await expect(step1StatusLocator).toHaveText('SUCCESS', { timeout: 30_000 });
    console.log('[Test] Step 1 SUCCESS result verified.');

    await expect(page.locator('#run-flow-btn'))
      .toBeEnabled({ timeout: 90_000 });
    console.log('[Test] Flow run finished (run button enabled).');
  });

  /* --------------- results search & filter --------------- */
  test('Search and filter runner results', async () => {
    await page.locator('#run-flow-btn').click();
    await expect(page.locator('#run-flow-btn'))
      .toBeEnabled({ timeout: 90_000 });

    await page.evaluate(() => {
      const list = document.getElementById('runner-results');
      if (!list) return;
      const entries = [
        { text: 'zxqsuccess', status: 'success' },
        { text: 'zxqerrorOne', status: 'error' },
        { text: 'zxqskip', status: 'skipped' },
        { text: 'zxqerrorTwo', status: 'error' },
      ];
      entries.forEach(({ text, status }) => {
        const li = document.createElement('li');
        li.className = 'result-item';
        li.dataset.status = status;
        li.dataset.searchText = text;
        li.textContent = `${status} - ${text}`;
        list.appendChild(li);
      });
    });

    const total = await page.locator('li.result-item').count();

    await page.fill('#results-search', 'zxqerr');
    await page.waitForTimeout(200);
    await expect(page.locator('li.result-item:visible')).toHaveCount(2);

    await page.selectOption('#results-status-filter', 'error');
    await page.waitForTimeout(200);
    await expect(page.locator('li.result-item:visible')).toHaveCount(2);

    await page.fill('#results-search', '');
    await page.selectOption('#results-status-filter', '');
    await page.waitForTimeout(200);
    await expect(page.locator('li.result-item:visible')).toHaveCount(total);
  });

  /* --------------- step through first 3 --------------- */
  test('Step through first three steps & assert SUCCESS', async () => {
    const clickStep = () => page.locator('#step-flow-btn').click();

    console.log('[Test] Stepping: Step 1');
    await clickStep();
    await expect(
      page.locator('.result-item[data-step-id="step_e2e_1_get_ip"] .result-status')
    ).toHaveText('SUCCESS', { timeout: 20_000 });
    console.log('[Test] Stepping: Step 1 SUCCESS');

    console.log('[Test] Stepping: Step 2');
    await clickStep();
    await expect(
      page.locator('.result-item[data-step-id="step_e2e_2_check_status"] .result-status')
    ).toHaveText('SUCCESS', { timeout: 15000 });
    console.log('[Test] Stepping: Step 2 SUCCESS');

    console.log('[Test] Stepping: Step 3');
    await clickStep();
    await expect(
      page.locator('.result-item[data-step-id="step_e2e_3_post_data"] .result-status')
    ).toHaveText('SUCCESS', { timeout: 20_000 });
    console.log('[Test] Stepping: Step 3 SUCCESS. Test complete.');
  });
});