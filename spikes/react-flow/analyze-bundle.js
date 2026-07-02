// Reports the built bundle's raw + gzipped size and scans for CSP-hostile
// primitives. Run after `npm run build`. Pure Node, no deps.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const distAssets = join(import.meta.dirname, 'dist', 'assets');
let files;
try {
    files = readdirSync(distAssets);
} catch {
    console.error('No dist/ — run `npm run build` first.');
    process.exit(1);
}

console.log('=== Bundle sizes ===');
let totalRaw = 0;
let totalGz = 0;
for (const f of files) {
    const buf = readFileSync(join(distAssets, f));
    const gz = gzipSync(buf).length;
    totalRaw += buf.length;
    totalGz += gz;
    console.log(`${f.padEnd(24)} ${(buf.length / 1024).toFixed(1)} kB raw  ${(gz / 1024).toFixed(1)} kB gzip`);
}
console.log(`${'TOTAL'.padEnd(24)} ${(totalRaw / 1024).toFixed(1)} kB raw  ${(totalGz / 1024).toFixed(1)} kB gzip`);

console.log('\n=== CSP primitive scan (want all 0) ===');
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(distAssets, f), 'utf8')).join('\n');
const patterns = ['eval(', 'new Function', 'blob:', 'importScripts', 'new Worker', 'document.write'];
for (const p of patterns) {
    const count = js.split(p).length - 1;
    console.log(`${p.padEnd(16)} ${count}`);
}
