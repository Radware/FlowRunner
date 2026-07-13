// ========== FILE: llmService.js (main process) ==========
// The local AI engine service for the opt-in Copilot (beta 1.5).
//
// Design (see changelog "beta-1.5 local AI"):
//   - Runs ONLY in the Electron main process. node-llama-cpp is imported
//     LAZILY on first use so app startup and non-AI users pay zero cost.
//   - Model weights are NEVER bundled: they download on enable into
//     userData/models via node-llama-cpp's built-in resumable downloader.
//   - One generation at a time (a tiny promise queue): predictable memory,
//     no GPU/CPU thrash, and honest UX (the copilot is a helper, not a farm).
//   - Structured tasks use JSON-schema-constrained decoding (grammar) at
//     temperature 0 — the reliability backbone for 1-4B models.
//   - Prose tasks stream chunks to the renderer and are abortable.
//   - The model auto-unloads after idle time so FlowRunner never squats on
//     ~1GB of RAM while the user is just authoring flows.
//
// The renderer never touches this directly; preload exposes electronAPI.ai.*
// and main.js wires the IPC channels to these exports.

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { logger } from './logger.js';

// --- Model catalog -----------------------------------------------------------
// Small, instruction-tuned GGUF models with mature llama.cpp support.
// Sizes are approximate download sizes for the listed quant.
// NOTE: keep ids stable — they key user settings and on-disk filenames.
export const MODEL_CATALOG = [
    {
        id: 'gemma4-e2b',
        label: 'Gemma 4 E2B',
        detail: 'The balanced default. Google\'s edge model; strong all-rounder.',
        uri: 'hf:unsloth/gemma-4-E2B-it-GGUF:Q4_K_M',
        sizeMB: 3110,
        minRamGB: 8,
        license: 'Apache 2.0',
    },
    {
        id: 'qwen3-4b',
        label: 'Qwen 3 4B Instruct',
        detail: 'Cleanest structured output for its size.',
        uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M',
        sizeMB: 2500,
        minRamGB: 8,
        license: 'Apache 2.0',
    },
    {
        id: 'gemma4-e4b',
        label: 'Gemma 4 E4B',
        detail: 'Best quality. Wants a 16 GB machine.',
        uri: 'hf:unsloth/gemma-4-E4B-it-GGUF:Q4_K_M',
        sizeMB: 4980,
        minRamGB: 16,
        license: 'Apache 2.0',
    },
];

const IDLE_UNLOAD_MS = 5 * 60 * 1000;   // drop the model after 5 min of no use
const STRUCTURED_MAX_TOKENS = 640;
const PROSE_MAX_TOKENS = 800; // thought segments count against the budget on thinking-capable models
const CONTEXT_SIZE = 4096;

// --- Service state ------------------------------------------------------------
let deps = null;              // { getStore, userDataPath, sendToRenderer }
let llamaModule = null;       // the imported node-llama-cpp module
let llama = null;             // Llama instance
let loadedModel = null;       // { id, model, context }
let loadingPromise = null;
let idleTimer = null;
let generationQueue = Promise.resolve();
const downloadControllers = new Map(); // modelId -> AbortController
const generationControllers = new Map(); // requestId -> AbortController

function store() { return deps.getStore(); }
function modelsDir() { return path.join(deps.userDataPath, 'models'); }

function settings() {
    const s = store();
    return {
        enabled: !!s.get('ai.enabled', false),
        selectedModelId: s.get('ai.selectedModelId', null),
    };
}

function notifyState() {
    getState().then((state) => deps.sendToRenderer('ai:state-changed', state))
        .catch((err) => logger.warn('[llm] state notify failed:', err));
}

/** One-time wiring from main.js. */
export function initLlmService(options) {
    deps = options;
}

// --- Lazy engine --------------------------------------------------------------

async function ensureLlamaModule() {
    if (!llamaModule) {
        logger.info('[llm] importing node-llama-cpp…');
        llamaModule = await import('node-llama-cpp');
    }
    return llamaModule;
}

async function ensureLlama() {
    const mod = await ensureLlamaModule();
    if (!llama) {
        // Windows beta ships CPU binaries only — force CPU so the engine never
        // probes for Vulkan/CUDA builds we did not package. Elsewhere, auto
        // (Metal on Apple Silicon is free and fast).
        const gpu = process.platform === 'win32' ? false : 'auto';
        llama = await mod.getLlama({ gpu });
        logger.info(`[llm] engine ready (gpu: ${llama.gpu || 'cpu'})`);
    }
    return llama;
}

function touchIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        unloadModel().catch((e) => logger.warn('[llm] idle unload failed:', e));
    }, IDLE_UNLOAD_MS);
}

async function modelFilePath(entry) {
    // resolveModelFile with download:false tells us whether it is on disk.
    const mod = await ensureLlamaModule();
    try {
        return await mod.resolveModelFile(entry.uri, {
            directory: modelsDir(),
            download: false,
            verify: false,
            cli: false,
        });
    } catch {
        return null; // not downloaded
    }
}

async function ensureModelLoaded() {
    const { enabled, selectedModelId } = settings();
    if (!enabled) throw new Error('AI Copilot is not enabled.');
    const entry = MODEL_CATALOG.find((m) => m.id === selectedModelId);
    if (!entry) throw new Error('No AI model selected. Pick one in AI Copilot settings.');

    if (loadedModel && loadedModel.id === entry.id) { touchIdleTimer(); return loadedModel; }
    if (loadingPromise) { await loadingPromise; if (loadedModel?.id === entry.id) return loadedModel; }

    loadingPromise = (async () => {
        await unloadModel();
        const filePath = await modelFilePath(entry);
        if (!filePath) throw new Error(`Model "${entry.label}" is not downloaded yet.`);
        const engine = await ensureLlama();
        logger.info(`[llm] loading ${entry.label} from ${filePath}`);
        notifyStateSoon('loading');
        const model = await engine.loadModel({ modelPath: filePath });
        const context = await model.createContext({ contextSize: Math.min(CONTEXT_SIZE, model.trainContextSize || CONTEXT_SIZE) });
        // ONE persistent sequence + session per loaded model. Recreating a
        // session/sequence per request leaks sequence slots ("No sequences
        // left" — caught by the beta harness); instead each request RESETS the
        // chat history, which also lets it swap the system prompt per task.
        const mod2 = await ensureLlamaModule();
        const sequence = context.getSequence();
        const session = new mod2.LlamaChatSession({ contextSequence: sequence });
        loadedModel = { id: entry.id, model, context, sequence, session };
        logger.info(`[llm] ${entry.label} ready`);
        return loadedModel;
    })();
    try {
        const result = await loadingPromise;
        touchIdleTimer();
        notifyState();
        return result;
    } finally {
        loadingPromise = null;
    }
}

let stateHint = null;
function notifyStateSoon(hint) { stateHint = hint; notifyState(); }

async function unloadModel() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (!loadedModel) return;
    const { model, context, sequence, session, id } = loadedModel;
    loadedModel = null;
    try {
        session.dispose();
        sequence.dispose();
        await context.dispose();
        await model.dispose();
        logger.info(`[llm] unloaded ${id}`);
    } catch (err) {
        logger.warn('[llm] dispose error:', err);
    }
    notifyState();
}

// --- Public API (wired to IPC in main.js) --------------------------------------

export async function getState() {
    const { enabled, selectedModelId } = settings();
    const catalog = [];
    for (const entry of MODEL_CATALOG) {
        const onDisk = deps ? await modelFilePath(entry) : null;
        catalog.push({
            id: entry.id, label: entry.label, detail: entry.detail,
            sizeMB: entry.sizeMB, minRamGB: entry.minRamGB, license: entry.license,
            downloaded: !!onDisk,
            downloading: downloadControllers.has(entry.id),
        });
    }
    return {
        enabled,
        selectedModelId,
        catalog,
        totalRamGB: Math.round(os.totalmem() / (1024 ** 3)),
        gpu: llama ? (llama.gpu || 'cpu') : null,
        modelLoaded: loadedModel?.id || null,
        loading: !!loadingPromise || stateHint === 'loading',
        generating: generationControllers.size > 0,
    };
}

export async function setEnabled(enabled) {
    store().set('ai.enabled', !!enabled);
    if (!enabled) await unloadModel();
    notifyState();
    return getState();
}

export async function selectModel(modelId) {
    const entry = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);
    store().set('ai.selectedModelId', modelId);
    if (loadedModel && loadedModel.id !== modelId) await unloadModel();
    notifyState();
    return getState();
}

export async function downloadModel(modelId) {
    const entry = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);
    if (downloadControllers.has(modelId)) throw new Error('Download already in progress.');

    const mod = await ensureLlamaModule();
    await fs.mkdir(modelsDir(), { recursive: true });
    const controller = new AbortController();
    downloadControllers.set(modelId, controller);
    notifyState();
    let lastSent = 0;
    try {
        await mod.resolveModelFile(entry.uri, {
            directory: modelsDir(),
            signal: controller.signal,
            cli: false,
            onProgress: ({ totalSize, downloadedSize }) => {
                const now = Date.now();
                if (now - lastSent > 250) { // coalesce progress spam
                    lastSent = now;
                    deps.sendToRenderer('ai:download-progress', {
                        modelId, downloadedSize, totalSize,
                    });
                }
            },
        });
        logger.info(`[llm] downloaded ${entry.label}`);
        return { ok: true };
    } catch (err) {
        if (controller.signal.aborted) return { ok: false, cancelled: true };
        logger.error(`[llm] download failed for ${entry.label}:`, err);
        throw new Error(`Download failed: ${err?.message || err}`);
    } finally {
        downloadControllers.delete(modelId);
        notifyState();
    }
}

export function cancelDownload(modelId) {
    downloadControllers.get(modelId)?.abort();
    return true;
}

export async function deleteModel(modelId) {
    const entry = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);
    if (loadedModel?.id === modelId) await unloadModel();
    const filePath = await modelFilePath(entry);
    if (filePath) await fs.rm(filePath, { force: true });
    notifyState();
    return getState();
}

/**
 * Structured generation: JSON-schema-constrained decoding at temperature 0.
 * Returns parsed JSON. The renderer still validates against app vocabulary —
 * the grammar guarantees SHAPE, not semantic truth.
 */
export async function generateStructured({ system, prompt, schema, maxTokens }) {
    return enqueue(async () => {
        const loaded = await ensureModelLoaded();
        const grammar = await llama.createGrammarForJsonSchema(schema);
        const entry = MODEL_CATALOG.find((m) => m.id === loaded.id);
        const systemPrompt = (system || '') + (entry?.systemSuffix || '');

        const attempt = async () => {
            loaded.session.setChatHistory(systemPrompt ? [{ type: 'system', text: systemPrompt }] : []);
            const { response, stopReason } = await loaded.session.promptWithMeta(prompt, {
                grammar,
                // temperature omitted -> greedy (deterministic); penalties off:
                // they degrade grammar-constrained JSON structural tokens.
                repeatPenalty: false,
                maxTokens: maxTokens || STRUCTURED_MAX_TOKENS,
            });
            if (stopReason === 'maxTokens') throw new Error('truncated');
            return grammar.parse(response);
        };
        try {
            const out = await attempt();
            touchIdleTimer();
            return out;
        } catch (err) {
            // One syntax-level retry (truncation / unparsable) — the semantic
            // repair loop lives in the renderer (aiFeatures).
            logger.warn('[llm] structured attempt failed, retrying once:', err?.message);
            const out = await attempt();
            touchIdleTimer();
            return out;
        }
    });
}

/**
 * Prose generation: streams chunks to the renderer (ai:chunk events),
 * abortable via cancelGeneration(requestId). Resolves the full text.
 */
export async function generateProse({ system, prompt, maxTokens, requestId }) {
    return enqueue(async () => {
        const loaded = await ensureModelLoaded();
        const entry = MODEL_CATALOG.find((m) => m.id === loaded.id);
        const controller = new AbortController();
        if (requestId) generationControllers.set(requestId, controller);
        try {
            // Thinking-capable models (Gemma 4) route deliberation into hidden
            // thought segments that eat the token budget before any visible
            // text; instruct directness explicitly (harness-verified fix).
            const directness = ' Answer directly and briefly. Never deliberate out loud.';
            const systemPrompt = ((system || '') + directness + (entry?.systemSuffix || ''));
            loaded.session.setChatHistory(systemPrompt ? [{ type: 'system', text: systemPrompt }] : []);
            const text = await loaded.session.prompt(prompt, {
                temperature: 0.6,
                maxTokens: maxTokens || PROSE_MAX_TOKENS,
                signal: controller.signal,
                stopOnAbortSignal: true, // graceful: return what we have
                onTextChunk: (chunk) => {
                    if (requestId) deps.sendToRenderer('ai:chunk', { requestId, text: chunk });
                },
            });
            touchIdleTimer();
            return text;
        } finally {
            if (requestId) generationControllers.delete(requestId);
        }
    });
}

/** Fire-and-forget: load the selected model so the first suggestion is instant. */
export async function prewarm() {
    const { enabled, selectedModelId } = settings();
    if (!enabled || !selectedModelId) return { warmed: false };
    try {
        await ensureModelLoaded();
        return { warmed: true };
    } catch (err) {
        logger.warn('[llm] prewarm skipped:', err?.message);
        return { warmed: false, reason: err?.message };
    }
}

export function cancelGeneration(requestId) {
    generationControllers.get(requestId)?.abort();
    return true;
}

function enqueue(job) {
    const run = generationQueue.then(job, job);
    // keep the queue alive after failures
    generationQueue = run.then(() => undefined, () => undefined);
    return run;
}

/** App teardown: abort everything and free the model. */
export async function shutdownLlm() {
    downloadControllers.forEach((c) => c.abort());
    generationControllers.forEach((c) => c.abort());
    await unloadModel().catch(() => {});
    if (llama) { try { await llama.dispose(); } catch { /* teardown */ } llama = null; }
}
