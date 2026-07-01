import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base '' + relative asset paths so the built bundle loads from a file:// / app://
// origin inside packaged Electron. This is the crux of the CSP feasibility test:
// with base:'' every <script>/<link> emitted by Vite is a same-origin relative
// path, satisfying `script-src 'self'` with no remote fetch.
export default defineConfig({
    base: '',
    plugins: [react()],
    build: {
        outDir: 'dist',
        // Single deterministic chunk names make bundle-size accounting simple and
        // make it trivial to add the emitted files to the app's build.files list.
        rollupOptions: {
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name][extname]',
            },
        },
        // Report compressed sizes so the report can cite real gzip numbers.
        reportCompressedSize: true,
    },
});
