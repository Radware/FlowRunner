// ========== eval/consistency-harness.mjs ==========
// CONSISTENCY measurement for the AI Copilot: run every structured fixture
// N times with the shipped (winning) system prompt and measure whether
// grammar+greedy decoding is actually deterministic end-to-end, plus the
// semantic stability of the validated result. Prose runs measure length/shape
// stability at temp 0.6 (variance is expected there; we care about the floor).
//
// Run: node eval/consistency-harness.mjs [repeats=4]
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAssertions, validateExtractions, validateCondition, pathResolves } from '../aiFeatures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
const SYSTEM = JSON.parse(fs.readFileSync(path.join(__dirname, 'variants.json'), 'utf8'))
    .find((v) => v.id === 'baseline').system; // the eval winner = shipped prompt
const REPEATS = Number(process.argv[2]) || 4;

const modelPath = path.join(__dirname, '..', '.beta-models', 'hf_unsloth_gemma-4-E2B-it.Q4_K_M.gguf');
const llama = await getLlama({ gpu: 'auto' });
const model = await llama.loadModel({ modelPath });
const context = await model.createContext({ contextSize: 4096 });
const sequence = context.getSequence();
const session = new LlamaChatSession({ contextSequence: sequence });

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
log(`consistency: ${cases.length} cases x ${REPEATS} repeats (system = shipped baseline)`);

function validate(task, data, ctx) {
    try {
        if (task === 'assertions') return validateAssertions(data).filter((a) => pathResolves(a.target, { output: ctx.output }));
        if (task === 'extractions') return validateExtractions(data, ctx.knownVariables || []).filter((e) => pathResolves(e.path, { output: ctx.output }));
        if (task === 'condition') return validateCondition(data, ctx.knownVariables || []);
        return data;
    } catch (e) { return { __invalid: e.message }; }
}

const report = [];
for (const c of cases) {
    const isProse = c.task === 'explain';
    const rawOutputs = [];
    const validatedOutputs = [];
    for (let r = 0; r < REPEATS; r++) {
        session.setChatHistory([{ type: 'system', text: SYSTEM }]);
        try {
            if (isProse) {
                const text = await session.prompt(c.prompt, { temperature: 0.6, maxTokens: 800 });
                rawOutputs.push(text);
                validatedOutputs.push({ words: text.trim().split(/\s+/).length, nonEmpty: text.trim().length > 20 });
            } else {
                const grammar = await llama.createGrammarForJsonSchema(c.schema);
                const { response, stopReason } = await session.promptWithMeta(c.prompt, {
                    grammar, repeatPenalty: false, maxTokens: 640,
                });
                if (stopReason === 'maxTokens') throw new Error('truncated');
                const parsed = grammar.parse(response);
                rawOutputs.push(JSON.stringify(parsed));
                validatedOutputs.push(validate(c.task, parsed, c.context || {}));
            }
        } catch (e) {
            rawOutputs.push(`__ERROR__:${e.message}`);
            validatedOutputs.push({ __invalid: e.message });
        }
    }

    if (isProse) {
        const words = validatedOutputs.map((v) => v.words || 0);
        const allNonEmpty = validatedOutputs.every((v) => v.nonEmpty);
        report.push({ task: c.task, fixtureId: c.fixtureId,
            metric: 'prose-stability', allNonEmpty,
            wordCounts: words, spreadPct: Math.round(100 * (Math.max(...words) - Math.min(...words)) / Math.max(1, Math.max(...words))) });
        log(`${c.task}/${c.fixtureId}: nonEmpty=${allNonEmpty} words=${words.join('/')}`);
    } else {
        const uniqueRaw = new Set(rawOutputs).size;
        const uniqueValidated = new Set(validatedOutputs.map((v) => JSON.stringify(v))).size;
        const allValid = validatedOutputs.every((v) => !v.__invalid);
        report.push({ task: c.task, fixtureId: c.fixtureId,
            metric: 'structured-determinism',
            rawIdentical: uniqueRaw === 1, validatedIdentical: uniqueValidated === 1, allValid,
            uniqueRaw, uniqueValidated });
        log(`${c.task}/${c.fixtureId}: raw ${uniqueRaw === 1 ? 'IDENTICAL' : uniqueRaw + ' distinct'} | validated ${uniqueValidated === 1 ? 'IDENTICAL' : uniqueValidated + ' distinct'} | allValid=${allValid}`);
    }
}

fs.writeFileSync(path.join(__dirname, 'consistency-report.json'), JSON.stringify({ repeats: REPEATS, report }, null, 1));
const s = report.filter((r) => r.metric === 'structured-determinism');
console.log(`\n=== CONSISTENCY SUMMARY (${REPEATS} repeats) ===`);
console.log(`structured: ${s.filter(r => r.rawIdentical).length}/${s.length} byte-identical raw, ${s.filter(r => r.validatedIdentical).length}/${s.length} identical after validation, ${s.filter(r => r.allValid).length}/${s.length} valid on every repeat`);
const p = report.filter((r) => r.metric === 'prose-stability');
console.log(`prose: ${p.filter(r => r.allNonEmpty).length}/${p.length} non-empty on every repeat`);

session.dispose(); sequence.dispose();
await context.dispose(); await model.dispose(); await llama.dispose();
log('CONSISTENCY COMPLETE -> eval/consistency-report.json');
