// __tests__/designTokens.test.js
// Guards the OKLCH design-token contract in styles.css (ux-p1 lane).
// The token layer is consumed by both renderers today and a future React
// island, so its shape is a contract — these tests fail loudly if a semantic
// token is dropped, if the gradient wordmark returns, or if the projector
// theme regresses to pure black/white.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

// Strip CSS comments so "#fff" mentioned in a comment never trips the guards.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

const SEMANTIC_TOKENS = [
    '--surface',
    '--surface-raised',
    '--text',
    '--text-muted',
    '--accent',
    '--border',
    '--run-success',
    '--run-error',
    '--run-skipped',
    '--run-running',
];

describe('OKLCH design-token layer', () => {
    test('defines every semantic token in :root', () => {
        for (const token of SEMANTIC_TOKENS) {
            expect(cssNoComments).toMatch(
                new RegExp(`${token}\\s*:`)
            );
        }
    });

    test('semantic tokens resolve from a primitive OKLCH ramp', () => {
        // At least one primitive ramp step, expressed in oklch().
        expect(cssNoComments).toMatch(/--ramp-[a-z0-9-]+\s*:\s*oklch\(/i);
        // Semantic tokens reference primitives via var(), not raw values.
        expect(cssNoComments).toMatch(/--surface\s*:\s*var\(--ramp-/);
        expect(cssNoComments).toMatch(/--accent\s*:\s*var\(--ramp-/);
    });

    test('primitive ramp is authored in OKLCH', () => {
        const oklchCount = (cssNoComments.match(/oklch\(/gi) || []).length;
        // A two-tier ramp needs a meaningful number of oklch() stops.
        expect(oklchCount).toBeGreaterThanOrEqual(8);
    });

    test('exposes a dark opt-in via [data-theme="dark"]', () => {
        expect(cssNoComments).toMatch(/\[data-theme=["']dark["']\]/);
    });

    test('honours prefers-color-scheme for automatic dark', () => {
        expect(cssNoComments).toMatch(/prefers-color-scheme\s*:\s*dark/);
    });

    test('never tints ramp/semantic neutrals to pure black or pure white', () => {
        // Scope the guard to the token-definition blocks (the contract this
        // lane owns). Wave 2 migrates the rest of the legacy stylesheet.
        const tokenBlocks = (cssNoComments.match(/--ramp-[\s\S]*?(?=\n\n)/g) || []).join('\n');
        expect(tokenBlocks.length).toBeGreaterThan(0);
        // No pure #000/#fff (any case, 3- or 6-digit) in token definitions.
        expect(tokenBlocks).not.toMatch(/#fff(?![0-9a-f])/i);
        expect(tokenBlocks).not.toMatch(/#ffffff(?![0-9a-f])/i);
        expect(tokenBlocks).not.toMatch(/#000(?![0-9a-f])/i);
        expect(tokenBlocks).not.toMatch(/#000000(?![0-9a-f])/i);
    });
});

describe('gradient wordmark removal (deliverable b)', () => {
    test('wordmark uses a single solid color, not background-clip:text', () => {
        // Isolate the .app-name-text rule body.
        const match = cssNoComments.match(/\.app-name-text\s*\{([^}]*)\}/);
        expect(match).not.toBeNull();
        const body = match[1];
        expect(body).not.toMatch(/background-clip\s*:\s*text/);
        expect(body).not.toMatch(/-webkit-text-fill-color\s*:\s*transparent/);
        expect(body).toMatch(/color\s*:/);
    });

    test('no decorative linear-gradient remains on branding surfaces', () => {
        const brandingMatch = cssNoComments.match(/\.app-branding\s*\{([^}]*)\}/);
        expect(brandingMatch).not.toBeNull();
        expect(brandingMatch[1]).not.toMatch(/linear-gradient/);
    });
});

describe('proof-of-life surfaces mapped to tokens (deliverable c)', () => {
    test('workspace header consumes surface/border tokens', () => {
        const match = cssNoComments.match(/\.workspace-header\s*\{([^}]*)\}/);
        expect(match).not.toBeNull();
        expect(match[1]).toMatch(/var\(--(surface|surface-raised)\)/);
    });

    test('primary button consumes the accent token', () => {
        const match = cssNoComments.match(/\.btn-primary\s*\{([^}]*)\}/);
        expect(match).not.toBeNull();
        expect(match[1]).toMatch(/var\(--accent\)/);
    });

    test('a run-status pip consumes a run-state token', () => {
        expect(cssNoComments).toMatch(/var\(--run-(success|error|running|skipped)\)/);
    });
});
