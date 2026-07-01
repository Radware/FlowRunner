import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// The island builds to a SINGLE same-origin IIFE bundle emitted into the app's
// assets/visualizer-island/ directory. base:'' keeps every emitted reference a
// relative same-origin path so the bundle loads under the packaged app's exact
// CSP: `script-src 'self'` (no inline scripts, no CDN, no eval/blob/Worker).
// See docs/engine-decision.md "The decisive constraint: CSP under packaged
// Electron" — the spike proved this is feasible; this is the production build of
// that proof.
//
// Lib/IIFE mode (not an HTML app) is deliberate: the plain-JS facade
// (reactFlowVisualizer.js) loads island.js as a same-origin <script> and reads
// the global factory it defines. No index.html, no module preloads, no dynamic
// import() — one script tag, one stylesheet link, both same-origin.
export default defineConfig({
    base: '',
    plugins: [react()],
    build: {
        // Emit straight into the app repo's assets dir so build.files can ship it.
        outDir: resolve(here, '..', 'assets', 'visualizer-island'),
        emptyOutDir: true,
        reportCompressedSize: true,
        lib: {
            entry: resolve(here, 'src', 'islandEntry.jsx'),
            name: 'FlowRunnerReactIsland',
            formats: ['iife'],
            fileName: () => 'island.js',
        },
        rollupOptions: {
            output: {
                // Deterministic names so build.files can list exact assets, and the
                // facade can hard-code the stylesheet href.
                assetFileNames: 'island[extname]',
                // Inline dynamic imports so the whole island is one file (no code
                // splitting → no extra network fetches, simplest CSP story).
                inlineDynamicImports: true,
            },
        },
    },
});
