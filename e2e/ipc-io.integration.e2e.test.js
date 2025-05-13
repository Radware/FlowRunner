// e2e/ipc-io.integration.e2e.test.js
/* eslint-disable @typescript-eslint/no-var-requires */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// --- Helper Functions for Stubbing Main Process Modules ---

/**
 * Stubs a method on a module within the Electron main process using createRequire.
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {string} moduleName - The name of the module (e.g., 'electron', 'node:fs/promises').
 * @param {string} functionPath - The path to the function (e.g., 'dialog.showOpenDialog', 'readFile').
 * @param {Function | any} mockImplementation - The function or value to replace the original with.
 */
async function stubMainProcessMethod(electronApp, moduleName, functionPath, mockImplementation) {
    await electronApp.evaluate(
        // This function runs in the main process context
        async (_app, { moduleName, functionPath, mockImplementationStr }) => {
          const requireFn = global.require;
          if (typeof requireFn !== 'function') {
            throw new Error('global.require is not available – make sure main.js exposes it when E2E runs');
          }

          const mod = requireFn(moduleName);
          const parts = functionPath.split('.');
          let obj = moduleName === 'electron' && mod.default ? mod.default : mod;

          for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
            if (obj === undefined) {
              throw new Error(`Path "${parts.slice(0, i + 1).join('.')}" not found in module "${moduleName}"`);
            }
          }

          const fnName = parts[parts.length - 1];
          const originalKey = `__original_${fnName}`;

          if (typeof obj[fnName] === 'function' && obj[originalKey] === undefined) {
            obj[originalKey] = obj[fnName];
          }

          /* eslint-disable no-eval */
          obj[fnName] = eval(`(${mockImplementationStr})`);
          /* eslint-enable no-eval */
        },
        { moduleName, functionPath, mockImplementationStr: mockImplementation.toString() }
    );
}


/**
 * Restores an original method on a module in the Electron main process using createRequire.
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {string} moduleName
 * @param {string} functionPath
 */
async function restoreMainProcessMethod(electronApp, moduleName, functionPath) {
    await electronApp.evaluate(
        // This function runs in the main process context
        async (_app, { moduleName, functionPath }) => {
          const requireFn = global.require;
          if (typeof requireFn !== 'function') return;

          const mod = requireFn(moduleName);
          const parts = functionPath.split('.');
          let obj = moduleName === 'electron' && mod.default ? mod.default : mod;

          for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
            if (obj === undefined) return;
          }

          const fnName = parts[parts.length - 1];
          const originalKey = `__original_${fnName}`;

          if (obj && obj[originalKey]) {
            obj[fnName] = obj[originalKey];
            delete obj[originalKey];
          }
        },
        { moduleName, functionPath }
    );
}

// --- Test Suite (Using Playwright's test.describe) ---
// The rest of the file remains the same as the previous version...

test.describe('IPC and File I/O Integration Tests', () => {
    let electronApp;
    let page;

    test.beforeAll(async () => {
        electronApp = await electron.launch({
            args: [path.join(projectRoot, 'main.js')],
            cwd: projectRoot,
            env: { ...process.env, NODE_ENV: 'test', E2E: 'true' }
        });
        page = await electronApp.firstWindow();
        await page.waitForLoadState('domcontentloaded');
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test.afterEach(async () => {
        if (electronApp) {
            await restoreMainProcessMethod(electronApp, 'electron', 'dialog.showOpenDialog');
            await restoreMainProcessMethod(electronApp, 'electron', 'dialog.showSaveDialog');
            // Use correct module path for node built-ins in ESM
            await restoreMainProcessMethod(electronApp, 'node:fs/promises', 'readFile');
            await restoreMainProcessMethod(electronApp, 'node:fs/promises', 'writeFile');
        }
    });

    // --- File Dialog Tests ---

    test.describe('dialog:openFile', () => {
        test('Renderer receives success and path when file selected', async () => {
            await stubMainProcessMethod(
                electronApp,
                'electron',
                'dialog.showOpenDialog',
                async () => ({ canceled: false, filePaths: ['/fake/path/to/selected/flow.flow.json'] })
            );

            const rendererResult = await page.evaluate(async () => {
                // @ts-ignore
                return window.electronAPI.showOpenFile();
            });

            expect(rendererResult).toEqual({ success: true, cancelled: false, filePath: '/fake/path/to/selected/flow.flow.json' });
        });

        test('Renderer receives cancellation status when dialog cancelled', async () => {
            await stubMainProcessMethod(
                electronApp,
                'electron',
                'dialog.showOpenDialog',
                async () => ({ canceled: true, filePaths: [] })
            );

            const rendererResult = await page.evaluate(async () => {
                 // @ts-ignore
                return window.electronAPI.showOpenFile();
            });

            expect(rendererResult).toEqual({ success: true, cancelled: true, filePath: null });
        });

        test('Renderer receives error when main process dialog throws', async () => {
            await stubMainProcessMethod(
                electronApp,
                'electron',
                'dialog.showOpenDialog',
                async () => { throw new Error('Main process dialog exploded'); }
            );

            const rendererResult = await page.evaluate(async () => {
                // @ts-ignore
                return window.electronAPI.showOpenFile();
            });

            expect(rendererResult).toEqual({ success: false, error: expect.stringContaining('Main process dialog exploded') });
        });
    });

    test.describe('dialog:saveFile & fs:writeFile', () => {
        const mockPath = '/fake/path/to/save/new-flow.flow.json';
        const suggestedName = 'new-flow.flow.json';
        const fileContent = '{"name":"Test Save"}';

        test('Renderer receives success on successful save and write', async () => {
            await stubMainProcessMethod(
                electronApp,
                'electron',
                'dialog.showSaveDialog',
                async () => ({ canceled: false, filePath: '/fake/path/to/save/new-flow.flow.json' })
            );
            await stubMainProcessMethod(
                electronApp,
                'node:fs/promises',
                'writeFile',
                async () => undefined
            );

            const rendererResult = await page.evaluate(async ({ suggestedName, fileContent }) => {
                 // @ts-ignore
                const saveResult = await window.electronAPI.showSaveFile(suggestedName);
                 if (saveResult?.success && !saveResult.cancelled) {
                     // @ts-ignore
                    const writeResult = await window.electronAPI.writeFile(saveResult.filePath, fileContent);
                    return { saveResult, writeResult };
                }
                return { saveResult };
            }, { suggestedName, fileContent });

            expect(rendererResult.saveResult).toEqual({ success: true, cancelled: false, filePath: '/fake/path/to/save/new-flow.flow.json' });
            expect(rendererResult.writeResult).toEqual({ success: true, path: '/fake/path/to/save/new-flow.flow.json' });
        });

        test('Renderer handles save dialog cancellation correctly', async () => {
             await stubMainProcessMethod(
                electronApp,
                'electron',
                'dialog.showSaveDialog',
                async () => ({ canceled: true, filePath: null })
             );

             const rendererResult = await page.evaluate(async ({ suggestedName, fileContent }) => {
                 // @ts-ignore
                 const saveResult = await window.electronAPI.showSaveFile(suggestedName);
                 if (saveResult?.success && !saveResult.cancelled) {
                      // @ts-ignore
                     const writeResult = await window.electronAPI.writeFile(saveResult.filePath, fileContent);
                     return { saveResult, writeResult };
                 }
                 return { saveResult };
             }, { suggestedName, fileContent });

             expect(rendererResult.saveResult).toEqual({ success: true, cancelled: true, filePath: null });
             expect(rendererResult.writeResult).toBeUndefined();
        });

        test('Renderer receives error correctly if writeFile fails (e.g., EACCES)', async () => {
             await stubMainProcessMethod(
                electronApp,
                'electron',
                'dialog.showSaveDialog',
                async () => ({ canceled: false, filePath: '/fake/path/to/save/new-flow.flow.json' })
             );
             await stubMainProcessMethod(
                electronApp,
                'node:fs/promises',
                'writeFile',
                async () => { const err = new Error('Permission denied to write file'); err.code = 'EACCES'; throw err; }
             );

             const rendererResult = await page.evaluate(async ({ suggestedName, fileContent }) => {
                 // @ts-ignore
                 const saveResult = await window.electronAPI.showSaveFile(suggestedName);
                 if (saveResult?.success && !saveResult.cancelled) {
                      // @ts-ignore
                     const writeResult = await window.electronAPI.writeFile(saveResult.filePath, fileContent);
                     return { saveResult, writeResult };
                 }
                 return { saveResult };
             }, { suggestedName, fileContent });

             expect(rendererResult.saveResult).toEqual({ success: true, cancelled: false, filePath: '/fake/path/to/save/new-flow.flow.json' });
             expect(rendererResult.writeResult).toEqual({
                 success: false,
                 error: expect.stringContaining('Permission denied to write file'),
                 code: 'EACCES',
                 path: '/fake/path/to/save/new-flow.flow.json'
             });
        });
    });

    // --- File System Tests ---

    test.describe('fs:readFile', () => {
        test('Renderer receives success and data on successful read', async () => {
            await stubMainProcessMethod(
                electronApp,
                'node:fs/promises',
                'readFile',
                async () => '{"name": "Read Test"}'
            );

            const mockPath = '/fake/path/read/exists.flow.json';
            const mockContent = '{"name": "Read Test"}';
            const rendererResult = await page.evaluate(async (path) => {
                 // @ts-ignore
                return window.electronAPI.readFile(path);
            }, mockPath);

            expect(rendererResult).toEqual({ success: true, data: mockContent, path: mockPath });
        });

        test('Renderer receives error correctly for file not found (ENOENT)', async () => {
             await stubMainProcessMethod(
                electronApp,
                'node:fs/promises',
                'readFile',
                async () => { const err = new Error('File not found'); err.code = 'ENOENT'; throw err; }
             );

             const mockPath = '/fake/path/read/notfound.flow.json';
             const rendererResult = await page.evaluate(async (path) => {
                 // @ts-ignore
                 return window.electronAPI.readFile(path);
             }, mockPath);

             expect(rendererResult).toEqual({
                 success: false,
                 error: expect.stringContaining(mockPath),
                 code: 'ENOENT',
                 path: mockPath
             });
        });

        test('Renderer receives error correctly for permission denied (EACCES)', async () => {
             await stubMainProcessMethod(
                electronApp,
                'node:fs/promises',
                'readFile',
                async () => { const err = new Error('Permission denied'); err.code = 'EACCES'; throw err; }
             );

             const mockPath = '/fake/path/read/protected.flow.json';
             const rendererResult = await page.evaluate(async (path) => {
                  // @ts-ignore
                 return window.electronAPI.readFile(path);
             }, mockPath);

             expect(rendererResult).toEqual({
                 success: false,
                 error: expect.stringContaining('Permission denied'),
                 code: 'EACCES',
                 path: mockPath
             });
        });

         test('Renderer receives error for invalid path input', async () => {
             const invalidPath = null;

             const rendererResult = await page.evaluate(async (path) => {
                  // @ts-ignore
                 return window.electronAPI.readFile(path);
             }, invalidPath);

             // UPDATED: Match the new error message from main.js
             expect(rendererResult).toEqual({
                 success: false,
                 error: 'Invalid file path provided. Please select a valid file.',
                 path: invalidPath,
                 // code: undefined // This remains correct as main.js doesn't set 'code' for this error
             });
         });
    });
});