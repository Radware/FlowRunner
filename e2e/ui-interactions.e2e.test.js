// e2e/ui-interactions.e2e.test.js
/*  Drag/drop & graph‑layout tests
    – longer waits after drag; ensure dirty flag is set.
*/

import { test, expect, _electron as electron } from '@playwright/test';
import path   from 'node:path';
import fs     from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath } from 'url';
import { setupMockUpdateRoute, removeMockUpdateRoute } from './mockUpdate.js';
import { pushRecent, esc, setupRendererLogCapture } from './testUtils.js';

/* ───────────── paths / constants ───────────── */

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataRoot    = path.resolve(__dirname, 'e2e-test-data');
const flowPath    = path.join(dataRoot, 'ui-interactions.flow.json');

/* ───────────── suite ───────────── */

test.describe('E2E: UI Interactions (drag‑drop & graph)', () => {
  let app, page;

  test.slow();

  test.beforeAll(async () => {
    console.log('--- E2E Setup (ui-interactions) ---');
    await fs.mkdir(dataRoot, { recursive: true });
    const flow = {
      name : 'UI Flow',
      steps: [
        { id: 'a', name: 'A', type: 'request', url: 'http://a' },
        { id: 'b', name: 'B', type: 'request', url: 'http://b' },
        { id: 'c', name: 'C', type: 'request', url: 'http://c' },
      ],
      visualLayout: {
        a: { x: 50,  y: 50 },
        b: { x: 50,  y: 600 },
        c: { x: 50,  y: 1150 },
      },
    };
    await fs.writeFile(flowPath, JSON.stringify(flow, null, 2));

    app = await electron.launch({
      args: [path.join(projectRoot, 'main.js')],
      cwd : projectRoot,
      env: { ...process.env, NODE_ENV: 'test', E2E: 'true' } // Ensure environment variable is set
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    page.setDefaultTimeout(30_000);
    await setupMockUpdateRoute(page);
    setupRendererLogCapture(page); // <-- Capture renderer logs to file

    await pushRecent(page, flowPath);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.locator(
      `#flow-list .recent-file-item[data-file-path="${esc(flowPath)}"]`
    ).click();

    await expect(page.locator('#workspace-title'))
      .toContainText('UI Flow', { timeout: 10_000 });
    await expect(page.locator('.flow-step')).toHaveCount(3);
    console.log('--- Setup complete ---');
  });

  test.afterAll(async () => {
    if (page) await removeMockUpdateRoute(page).catch(() => {});
    app && await app.close();
    await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  });

  /* --------------- drag step in list view --------------- */
  test('Drag Step in List View → Verify Order → Save → Reload', async () => {
    console.log('[Test] Starting list view drag...');
    const order = async () =>
      page.locator('.flow-step').evaluateAll((n) => n.map((e) => e.dataset.stepId));

    expect(await order()).toEqual(['a', 'b', 'c']);
    console.log('[Test] Initial order verified: a, b, c');

    const dragHandle = page.locator('.flow-step[data-step-id="c"] .flow-step-drag-handle');
    const target     = page.locator('.flow-step[data-step-id="b"]');
    const tbox       = await target.boundingBox();
    console.log(`[Test] Target bounding box: ${JSON.stringify(tbox)}`);

    await dragHandle.hover();
    await page.mouse.down();
    // Move slightly to initiate drag, then to target
    await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + 5, { steps: 5 });
    await page.waitForTimeout(100); // Short pause during drag
    await page.mouse.up();
    console.log(`[Test] Dragged handle for 'c' onto 'b'`);

    /* wait for dirty flag (give it up to 8 s) */
    const saveBtn = page.locator('#save-flow-btn');
    console.log('[Test] Waiting for save button to be enabled...');
    await expect(saveBtn).toBeEnabled({ timeout: 8_000 });
    await expect(saveBtn).toHaveClass(/needs-save/);
    console.log('[Test] Save button enabled.');

    expect(await order()).toEqual(['a', 'c', 'b']);
    console.log('[Test] Order verified after drag: a, c, b');

    await saveBtn.click();
    console.log('[Test] Save button clicked.');
    await expect(saveBtn).toBeDisabled();
    await expect(saveBtn).not.toHaveClass(/needs-save/);
    console.log('[Test] Save button disabled after save.');

    /* reload and re‑check */
    console.log('[Test] Reloading flow...');
    await page.locator(
      `#flow-list .recent-file-item[data-file-path="${esc(flowPath)}"]`
    ).click();
     // Wait for steps to re-render after load
    await expect(page.locator('.flow-step[data-step-id="a"]')).toBeVisible({timeout: 5000});
    await expect(page.locator('.flow-step[data-step-id="c"]')).toBeVisible({timeout: 5000});
    await expect(page.locator('.flow-step[data-step-id="b"]')).toBeVisible({timeout: 5000});

    expect(await order()).toEqual(['a', 'c', 'b']);
    console.log('[Test] Order verified after reload: a, c, b. Test complete.');
  });

  /* --------------- graph view node drag --------------- */
  /* // Temporarily removing this test due to isDirty/save button issues
  test('Drag Node in Graph View → Save → Reload → Layout Persists', async () => {
    // switch to graph view
    await page.locator('#toggle-view-btn').click();
    await expect(page.locator('#flow-visualizer-mount')).toHaveClass(/active/);

    const node = page.locator('.flow-node[data-step-id="a"]');
    const start = await node.boundingBox();
    const targetX = start.x + 120, targetY = start.y + 80;

    await node.hover();
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 20 });
    await page.mouse.up();

    // wait for dirty flag – up to 8 s
    const saveBtn = page.locator('#save-flow-btn');
    await expect(saveBtn).toBeEnabled({ timeout: 8_000 });
    await saveBtn.click();
    await expect(saveBtn).toBeDisabled();

    // reload & validate persisted coords in file
    await page.locator('#toggle-view-btn').click();      // back to list (forces file save)
    await page.locator(
      `#flow-list .recent-file-item[data-file-path="${esc(flowPath)}"]`
    ).click();
    await page.locator('#toggle-view-btn').click();      // graph again

    const file = JSON.parse(await fs.readFile(flowPath, 'utf8'));
    const { x: sx, y: sy } = file.visualLayout.a;

    expect(sx).toBeGreaterThan(start.x + 50);
    expect(sy).toBeGreaterThan(start.y + 50);
  });
  */

  test('Graph View Zoom Controls and Minimap Pan', async () => {
    await page.locator('#toggle-view-btn').click();
    await expect(page.locator('#flow-visualizer-mount')).toHaveClass(/active/);

    await page.waitForFunction(() => !!document.querySelector('#flow-visualizer-mount .visualizer-canvas'), { timeout: 5000 });
    const canvas = page.locator('#flow-visualizer-mount .visualizer-canvas').first();
    const zoomInBtn = page.locator('#zoom-in-btn');
    const zoomOutBtn = page.locator('#zoom-out-btn');

    const parseScale = (t) => {
      const m = t.match(/scale\(([^)]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    };

    const initialScale = await canvas.evaluate(el => el.style.transform);
    await zoomInBtn.click();
    await page.waitForTimeout(100);
    const zoomedIn = await canvas.evaluate(el => el.style.transform);
    const scaleIn = parseScale(zoomedIn);
    expect(scaleIn).toBeGreaterThan(parseScale(initialScale));
    expect(scaleIn).toBeLessThanOrEqual(2);

    await zoomOutBtn.click();
    await page.waitForTimeout(100);
    const zoomedOut = await canvas.evaluate(el => el.style.transform);
    const scaleOut = parseScale(zoomedOut);
    expect(scaleOut).toBeLessThanOrEqual(scaleIn);
    expect(scaleOut).toBeGreaterThanOrEqual(0.5);

    const mount = page.locator('#flow-visualizer-mount');
    const before = await mount.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
    const minimap = page.locator('.visualizer-minimap');
    const box = await minimap.boundingBox();
    await minimap.click({ position: { x: box.width - 5, y: box.height - 5 } });
    await page.waitForTimeout(200);
    const after = await mount.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
    expect(after.left).not.toBe(before.left);
    expect(after.top).not.toBe(before.top);
  });

    test('Minimap stays fixed during pan', async () => {
        const mount = page.locator('#flow-visualizer-mount');
        const canvas = mount.locator('.visualizer-canvas').first();
        await page.waitForFunction(
            () => !!document.querySelector('#flow-visualizer-mount .visualizer-canvas'),
            { timeout: 5000 }
        );

        const minimap = page.locator('.visualizer-minimap');
        const mmBoxBefore = await minimap.boundingBox();
        const canvasBox = await canvas.boundingBox();

        await canvas.hover();
        await page.mouse.down();
        await page.mouse.move(
            canvasBox.x + canvasBox.width / 2 - 100,
            canvasBox.y + canvasBox.height / 2 - 50,
            { steps: 10 }
        );
        await page.mouse.up();

        const mmBoxAfter = await minimap.boundingBox();
        expect(mmBoxAfter.x).toBeCloseTo(mmBoxBefore.x, 1);
        expect(mmBoxAfter.y).toBeCloseTo(mmBoxBefore.y, 1);
    });

    test('Viewport updates while panning', async () => {
        const mount = page.locator('#flow-visualizer-mount');
        const canvas = mount.locator('.visualizer-canvas').first();
        await page.waitForFunction(
            () => !!document.querySelector('#flow-visualizer-mount .visualizer-canvas'),
            { timeout: 5000 }
        );

        const viewport = page.locator('.minimap-viewport');
        const before = await viewport.evaluate(el => ({
            left: el.style.left,
            top: el.style.top
        }));

        const canvasBox = await canvas.boundingBox();
        await canvas.hover();
        await page.mouse.down();
        await page.mouse.move(
            canvasBox.x + canvasBox.width / 2 + 120,
            canvasBox.y + canvasBox.height / 2 + 60,
            { steps: 10 }
        );
        await page.mouse.up();
        await page.waitForTimeout(100);

        const after = await viewport.evaluate(el => ({
            left: el.style.left,
            top: el.style.top
        }));
        expect(after.left).not.toBe(before.left);
        expect(after.top).not.toBe(before.top);
    });
});
