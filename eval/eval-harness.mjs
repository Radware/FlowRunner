// ========== eval/eval-harness.mjs ==========
// System-prompt effectiveness matrix for the AI Copilot, run against the REAL
// local model with the app's REAL validators as the pass/fail contract.
//
// Inputs (written by the design agents):
//   eval/variants.json  — [{ id, label, system }]  system-prompt variants
//   eval/fixtures.json  — { cases: [{ task, fixtureId, prompt, schema, context }] }
//     task ∈ assertions | extractions | condition | explain
//     context carries what the validator needs (result body, knownVariables…)
// Output:
//   eval/results.json   — anonymized (V1..Vn) outputs + auto-validation + timing
//   eval/variant-key.json — the id mapping (judges must NOT read this)
//
// Run: node eval/eval-harness.mjs [modelFile]
import { getLlama, LlamaChatSession, resolveModelFile } from 'node-llama-cpp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    validateAssertions, validateExtractions, validateCondition, pathResolves,
} from '../aiFeatures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const variants = read('variants.json');
const { cases } = read('fixtures.json');

const MODEL = process.argv[2] || 'hf_unsloth_gemma-4-E2B-it.Q4_K_M.gguf';
const modelPath = path.join(__dirname, '..', '.beta-models', MODEL);
if (!fs.existsSync(modelPath)) { console.error('model missing:', modelPath); process.exit(1); }

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

const llama = await getLlama({ gpu: 'auto' });
const model = await llama.loadModel({ modelPath });
const context = await model.createContext({ contextSize: 4096 });
const sequence = context.getSequence();
const session = new LlamaChatSession({ contextSequence: sequence });
log(`model loaded (${MODEL}), ${variants.length} variants x ${cases.length} cases`);

function autoValidate(task, data, ctx) {
    try {
        if (task === 'assertions') {
            const cleaned = validateAssertions(data);
            const resolving = cleaned.filter((a) => pathResolves(a.target, { output: ctx.output }));
            return { valid: true, kept: resolving.length, total: cleaned.length, cleaned: resolving };
        }
        if (task === 'extractions') {
            const cleaned = validateExtractions(data, ctx.knownVariables || []);
            const resolving = cleaned.filter((e) => pathResolves(e.path, { output: ctx.output }));
            return { valid: true, kept: resolving.length, total: cleaned.length, cleaned: resolving };
        }
        if (task === 'condition') {
            const cleaned = validateCondition(data, ctx.knownVariables || []);
            return { valid: true, kept: 1, total: 1, cleaned };
        }
        return { valid: true, kept: 1, total: 1, cleaned: data };
    } catch (err) {
        return { valid: false, error: err.message };
    }
}

const results = [];
for (let vi = 0; vi < variants.length; vi++) {
    const variant = variants[vi];
    const anon = `V${vi + 1}`;
    for (const c of cases) {
        const isProse = c.task === 'explain';
        const started = Date.now();
        let output = null; let validation = null; let error = null;
        try {
            session.setChatHistory([{ type: 'system', text: variant.system }]);
            if (isProse) {
                output = await session.prompt(c.prompt, { temperature: 0.6, maxTokens: 800 });
                validation = { valid: output.trim().length > 20, prose: true };
            } else {
                const grammar = await llama.createGrammarForJsonSchema(c.schema);
                const { response, stopReason } = await session.promptWithMeta(c.prompt, {
                    grammar, repeatPenalty: false, maxTokens: 640,
                });
                if (stopReason === 'maxTokens') throw new Error('truncated');
                output = grammar.parse(response);
                validation = autoValidate(c.task, output, c.context || {});
            }
        } catch (err) {
            error = err.message;
            validation = { valid: false, error: err.message };
        }
        const ms = Date.now() - started;
        results.push({ variant: anon, task: c.task, fixtureId: c.fixtureId, ms, output, validation, error });
        log(`${anon} ${c.task}/${c.fixtureId} ${validation?.valid ? 'VALID' : 'INVALID'} kept=${validation?.kept ?? '-'} ${ms}ms`);
    }
}

fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ model: MODEL, results }, null, 1));
fs.writeFileSync(path.join(__dirname, 'variant-key.json'), JSON.stringify(
    variants.map((v, i) => ({ anon: `V${i + 1}`, id: v.id, label: v.label, system: v.system })), null, 1));

// quick scoreboard
const byVariant = {};
results.forEach((r) => {
    byVariant[r.variant] = byVariant[r.variant] || { valid: 0, total: 0, kept: 0, ms: 0 };
    const b = byVariant[r.variant];
    b.total++; b.ms += r.ms;
    if (r.validation?.valid) { b.valid++; b.kept += (r.validation.kept ?? 1); }
});
console.log('\n=== AUTO SCOREBOARD (validity only; judges assess quality) ===');
Object.entries(byVariant).forEach(([v, b]) =>
    console.log(`${v}: ${b.valid}/${b.total} valid, ${b.kept} kept suggestions, avg ${(b.ms / b.total / 1000).toFixed(1)}s`));

session.dispose(); sequence.dispose();
await context.dispose(); await model.dispose(); await llama.dispose();
log('EVAL COMPLETE -> eval/results.json');
