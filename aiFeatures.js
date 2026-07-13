// ========== FILE: aiFeatures.js ==========
// The AI Copilot's task contracts (beta 1.5). Each feature is a small,
// grounded task: we hand the LOCAL model REAL app data (a response body, a
// step definition, run results) plus a tight instruction, and — for anything
// structured — a JSON-schema grammar that constrains decoding to the exact
// shape FlowRunner understands. The model never acts: every output is a
// SUGGESTION the user reviews (fields are filled in, never saved).
//
// Consistency playbook baked in here:
//   - structured tasks: schema-constrained decoding + temperature 0 (in main)
//   - semantic validation against the app's own frozen vocabularies, with ONE
//     repair retry that feeds the validation error back to the model
//   - long response bodies are truncated head+tail so prompts stay small
//   - prose tasks get tight word budgets and calm, direct tone instructions
//
// DOM-free except for the electronAPI bridge; unit-testable helpers exported.

import { appState } from './state.js';
import { evaluatePath } from './flowCore.js';
import { logger } from './logger.js';

// The frozen conditionData/assertion operator vocabulary (executionHelpers.js).
export const OPERATORS = [
    'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
    'matches_regex', 'not_matches_regex',
    'greater_than', 'less_than', 'greater_equals', 'less_equals',
    'exists', 'not_exists',
    'is_number', 'is_text', 'is_boolean', 'is_array', 'is_object',
    'is_true', 'is_false', 'is_null', 'is_not_null', 'is_empty', 'is_not_empty',
];
export const OPERATORS_WITHOUT_VALUE = new Set([
    'exists', 'not_exists', 'is_number', 'is_text', 'is_boolean', 'is_array',
    'is_object', 'is_true', 'is_false', 'is_null', 'is_not_null', 'is_empty', 'is_not_empty',
]);

// The curated operator subset offered by the assertion editor UI
// (flowStepComponents ASSERTION_OPERATORS) — suggestions must be selectable.
export const ASSERTION_OPERATOR_SUBSET = [
    'equals', 'not_equals', 'greater_than', 'less_than', 'greater_equals', 'less_equals',
    'contains', 'not_contains', 'starts_with', 'ends_with', 'matches_regex',
    'exists', 'not_exists', 'is_empty', 'is_not_empty',
];
export const ASSERTION_VALUELESS = new Set(['exists', 'not_exists', 'is_empty', 'is_not_empty']);

// The condition builder select's operator subset (flowStepComponents cond-op options).
export const CONDITION_OPERATOR_SUBSET = [
    'equals', 'not_equals', 'greater_than', 'less_than', 'greater_equals', 'less_equals',
    'contains', 'starts_with', 'ends_with', 'matches_regex',
    'exists', 'not_exists', 'is_number', 'is_text', 'is_boolean', 'is_array',
    'is_true', 'is_false',
];

const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const BODY_BUDGET = 3500; // chars of response body we ground prompts with

const SYSTEM_BASE = 'You are the AI copilot inside FlowRunner, a desktop tool for building and running multi-step API flows. Be precise and grounded: use ONLY the data provided in the prompt. Never invent fields, paths, or values that are not present.';

// --- shared helpers (exported for tests) --------------------------------------

/** Head+tail truncation that keeps both the start and end of long bodies. */
export function truncateBody(value, budget = BODY_BUDGET) {
    let text;
    if (value == null) return '(no body)';
    if (typeof value === 'string') text = value;
    else { try { text = JSON.stringify(value, null, 1); } catch { text = String(value); } }
    if (text.length <= budget) return text;
    const half = Math.floor((budget - 60) / 2);
    return `${text.slice(0, half)}\n…[${text.length - half * 2} chars omitted]…\n${text.slice(-half)}`;
}

/**
 * Deterministic JSON "shape skeleton" for suggest tasks: keys + value types,
 * first array element only, strings sampled, depth-capped. Far better prompt
 * grounding than raw truncation for path suggestions (the model sees every
 * key without burning context on values).
 */
export function bodySkeleton(value, depth = 0) {
    if (depth > 4) return '…';
    if (value == null) return value;
    if (typeof value === 'string') return value.length > 60 ? value.slice(0, 57) + '…' : value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        if (!value.length) return [];
        return [bodySkeleton(value[0], depth + 1), value.length > 1 ? `…(${value.length} items)` : undefined]
            .filter((x) => x !== undefined);
    }
    const out = {};
    Object.keys(value).slice(0, 40).forEach((k) => { out[k] = bodySkeleton(value[k], depth + 1); });
    return out;
}

/** Best-effort: does this extraction/assertion path resolve on the real result? */
export function pathResolves(path, result) {
    try {
        const body = result?.output?.body;
        if (path === '.status' || path === 'status') return result?.output?.status != null;
        if (path === 'duration') return true;
        if (path === 'body') return body != null;
        if (path.startsWith('headers.')) return true; // headers vary by fetch; don't block
        if (path.startsWith('body.') || path.startsWith('body[')) {
            if (body == null) return false;
            const sub = path.startsWith('body.') ? path.slice(5) : path.slice(4);
            return evaluatePath(body, sub) !== undefined;
        }
        return false;
    } catch { return false; }
}

function ai() {
    const bridge = (typeof window !== 'undefined') && window.electronAPI && window.electronAPI.ai;
    if (!bridge) throw new Error('AI Copilot requires the desktop app.');
    return bridge;
}

async function callStructured({ system, prompt, schema, maxTokens }) {
    const res = await ai().generateStructured({ system, prompt, schema, maxTokens });
    if (!res || !res.success) throw new Error(res?.error || 'AI request failed.');
    return res.data;
}

/**
 * Run a structured task with semantic validation and ONE repair retry: the
 * validator throws with a human-readable reason, which we feed back so the
 * model can correct itself. Grammar guarantees shape; this guards meaning.
 */
async function structuredWithRepair(task, validate) {
    let raw = await callStructured(task);
    try {
        return validate(raw);
    } catch (firstError) {
        logger.warn('[ai] first pass failed validation, retrying:', firstError.message);
        const repairPrompt = `${task.prompt}\n\nYour previous answer was rejected: ${firstError.message}\nReturn a corrected answer that fixes exactly this problem.`;
        raw = await callStructured({ ...task, prompt: repairPrompt });
        return validate(raw); // second failure propagates to the caller
    }
}

function describeStepForPrompt(step) {
    const parts = [`type: ${step.type}`];
    if (step.type === 'request') {
        parts.push(`method: ${step.method}`, `url: ${step.url}`);
        if (step.headers && Object.keys(step.headers).length) parts.push(`headers: ${JSON.stringify(step.headers)}`);
        if (step.body) parts.push(`body: ${truncateBody(step.body, 600)}`);
    } else if (step.type === 'condition' && step.conditionData) {
        parts.push(`condition: ${JSON.stringify(step.conditionData)}`);
    } else if (step.type === 'loop') {
        parts.push(`loop source: ${step.source}`, `item variable: ${step.loopVariable}`);
    }
    return parts.join('\n');
}

// --- validators (exported for tests) -------------------------------------------

export function validateExtractions(data, knownVariables = []) {
    const list = Array.isArray(data) ? data : data?.extractions;
    if (!Array.isArray(list) || list.length === 0) throw new Error('Return at least one extraction.');
    const taken = new Set(knownVariables);
    return list.slice(0, 8).map((e) => {
        const variable = String(e.variable || '').trim();
        const path = String(e.path || '').trim();
        if (!VAR_NAME_RE.test(variable)) throw new Error(`"${variable}" is not a valid variable name (letters, digits, _ , not starting with a digit).`);
        if (taken.has(variable)) throw new Error(`Variable name "${variable}" is already in use; pick a different name.`);
        if (!path || /\s/.test(path)) throw new Error(`"${path}" is not a valid extraction path.`);
        if (!(path === '.status' || path === 'body' || path.startsWith('body.') || path.startsWith('body[') || path.startsWith('headers.'))) {
            throw new Error(`Path "${path}" must be ".status", "body", "body.…" or "headers.…".`);
        }
        taken.add(variable);
        return { variable, path };
    });
}

export function validateAssertions(data) {
    const list = Array.isArray(data) ? data : data?.assertions;
    if (!Array.isArray(list) || list.length === 0) throw new Error('Return at least one assertion.');
    return list.slice(0, 8).map((a) => {
        const target = String(a.path || a.target || '').trim().replace(/^\.status$/, 'status');
        const operator = String(a.operator || '').trim();
        let value = a.value;
        if (!target) throw new Error('Every assertion needs a target.');
        if (!(target === 'status' || target === 'duration' || target === 'body'
            || target.startsWith('body.') || target.startsWith('body[') || target.startsWith('headers.'))) {
            throw new Error(`Target "${target}" must be "status", "duration", "headers.…" or "body.…".`);
        }
        if (!ASSERTION_OPERATOR_SUBSET.includes(operator)) throw new Error(`Operator "${operator}" is not one of the allowed assertion operators.`);
        if (target === 'status' && /^(equals|not_equals)$/.test(operator)) {
            const digits = String(value ?? '').match(/\d{3}/); // eval: models sometimes wrap the code ("?:403")
            if (digits) value = digits[0];
        }
        if (ASSERTION_VALUELESS.has(operator)) value = '';
        else if (value == null || String(value).length === 0) throw new Error(`Operator "${operator}" needs a value.`);
        return { target, operator, value: String(value ?? '') };
    });
}

export function validateCondition(data, knownVariables = []) {
    const variable = String(data?.variable || '').trim().replace(/^\{\{|\}\}$/g, '');
    const operator = String(data?.operator || '').trim();
    let value = data?.value;
    if (!variable) throw new Error('Pick the variable to check.');
    const base = variable.split(/[.[]/)[0];
    if (knownVariables.length && !knownVariables.includes(base)) {
        throw new Error(`"${base}" is not a defined variable. Choose from: ${knownVariables.slice(0, 20).join(', ')}.`);
    }
    if (!CONDITION_OPERATOR_SUBSET.includes(operator)) throw new Error(`Operator "${operator}" is not allowed. Allowed: ${CONDITION_OPERATOR_SUBSET.join(', ')}.`);
    if (/^(greater|less)_/.test(operator) && typeof value === 'string') {
        value = value.replace(/^\s*[<>=!]+\s*/, ''); // model echoing the comparator into the value
    }
    if (OPERATORS_WITHOUT_VALUE.has(operator)) value = '';
    else if (value == null) throw new Error(`Operator "${operator}" needs a value.`);
    return { variable, operator, value: String(value ?? '') };
}

// --- features -------------------------------------------------------------------

/** Prose: explain a failed (or suspicious) step result. Streams via requestId. */
export function explainResult(step, result, requestId) {
    const prompt = [
        'A step in an API flow produced this result. Explain briefly what happened and what to check or try next.',
        `STEP:\n${describeStepForPrompt(step)}`,
        `RESULT status: ${result.status}${result.output?.status ? ` (HTTP ${result.output.status})` : ''}`,
        result.error ? `ERROR: ${truncateBody(result.error, 500)}` : '',
        result.output?.body != null ? `RESPONSE BODY:\n${truncateBody(result.output.body)}` : '',
        (result.extractionFailures || []).length ? `EXTRACTION FAILURES: ${JSON.stringify(result.extractionFailures)}` : '',
        'Answer in plain language, max 120 words: 1) what happened, 2) the most likely cause, 3) one concrete next step. No headings, no markdown.',
    ].filter(Boolean).join('\n\n');
    return ai().generateProse({ system: SYSTEM_BASE, prompt, maxTokens: 800, requestId });
}

/** Structured: suggest extraction rules from a step's REAL response. */
export function suggestExtractions(step, result, knownVariables = []) {
    // Grammar note: every listed property is always emitted (no `required`);
    // maxItems/maxLength bound the output so maxTokens truncation is rare.
    const schema = {
        type: 'object',
        properties: {
            extractions: {
                type: 'array',
                minItems: 1,
                maxItems: 5,
                items: {
                    type: 'object',
                    properties: {
                        variable: { type: 'string', maxLength: 40 },
                        path: { type: 'string', maxLength: 160 },
                    },
                },
            },
        },
    };
    const prompt = [
        'Suggest 1-4 useful values to extract from this API response into variables for LATER steps (ids, tokens, counts, statuses).',
        `REQUEST: ${step.method} ${step.url}`,
        `RESPONSE BODY SHAPE (keys and value types from the real response):\n${truncateBody(bodySkeleton(result.output?.body))}`,
        `Paths must start with "body." (JSON path into the body, e.g. body.user.id or body.items[0].name), or be ".status" for the HTTP status.`,
        knownVariables.length ? `Names already in use (do NOT reuse): ${knownVariables.join(', ')}` : '',
        'Variable names: short camelCase identifiers.',
        'Example: {"variable":"authToken","path":"body.token"}. Skip request-echo fields like page numbers.',
    ].filter(Boolean).join('\n\n');
    return structuredWithRepair(
        { system: SYSTEM_BASE, prompt, schema },
        (raw) => {
            const cleaned = validateExtractions(raw, knownVariables);
            // Semantic gate: only offer paths that resolve on the REAL response.
            const resolving = cleaned.filter((e) => pathResolves(e.path, result));
            if (!resolving.length) throw new Error('None of the suggested paths exist in the actual response body. Suggest paths that appear in the body shape.');
            return resolving;
        },
    );
}

/** Structured: suggest assertions from a step's REAL response. */
export function suggestAssertions(step, result) {
    const schema = {
        type: 'object',
        properties: {
            assertions: {
                type: 'array',
                minItems: 1,
                maxItems: 5,
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', maxLength: 160 },
                        operator: { enum: ASSERTION_OPERATOR_SUBSET },
                        value: { type: 'string', maxLength: 120 },
                    },
                },
            },
        },
    };
    const prompt = [
        'Suggest 1-4 assertions that verify this API response is healthy. Prefer stable checks (status code, required fields existing, types) over brittle exact values.',
        `REQUEST: ${step.method} ${step.url}`,
        `ACTUAL HTTP STATUS: ${result.output?.status ?? 'unknown'}`,
        `RESPONSE BODY SHAPE (keys and value types from the real response):\n${truncateBody(bodySkeleton(result.output?.body))}`,
        `Target paths: "status" for the HTTP status code, "duration" for elapsed ms, "body.…" for body fields, "headers.…" for headers.`,
        `Allowed operators: ${ASSERTION_OPERATOR_SUBSET.join(', ')}. Operators exists/not_exists/is_empty/is_not_empty take an empty value "".`,
        'Example of good assertions: {"path":"status","operator":"equals","value":"200"}, {"path":"body.token","operator":"is_not_empty","value":""}. Body fields ALWAYS use the "body." prefix; prefer is_not_empty over exists for values that must be present and non-blank.',
    ].join('\n\n');
    return structuredWithRepair(
        { system: SYSTEM_BASE, prompt, schema },
        (raw) => {
            // Eval-identified dominant failure: bare targets missing the "body."
            // prefix. Repair deterministically when the prefixed path resolves
            // on the real response instead of burning the retry.
            const list = Array.isArray(raw) ? raw : raw?.assertions;
            if (Array.isArray(list)) {
                for (const a of list) {
                    const p = String(a?.path || '').trim();
                    if (p && !/^(status|duration|body\b|headers\.)/.test(p)
                        && pathResolves(`body.${p}`, result)) a.path = `body.${p}`;
                }
            }
            const cleaned = validateAssertions(raw);
            const resolving = cleaned.filter((a) => pathResolves(a.target, result));
            if (!resolving.length) throw new Error('None of the suggested targets exist in the actual response. Target fields that appear in the body shape, or "status".');
            return resolving;
        },
    );
}

/** Structured: natural language -> conditionData. */
export function nlToCondition(text, knownVariables = []) {
    // When the variable list is short, make it a grammar-level enum — an
    // undefined variable becomes IMPOSSIBLE to emit, not just repairable.
    // (Dotted paths are then entered by editing after accept; the base name
    // is what matters for validity.)
    const variableSchema = (knownVariables.length && knownVariables.length <= 20)
        ? { enum: knownVariables }
        : { type: 'string', maxLength: 80 };
    const schema = {
        type: 'object',
        properties: {
            variable: variableSchema,
            operator: { enum: CONDITION_OPERATOR_SUBSET },
            value: { type: 'string', maxLength: 120 },
        },
    };
    const prompt = [
        `Convert this description into a single flow condition: "${text}"`,
        knownVariables.length ? `Defined variables (choose "variable" from these; dotted paths into them are allowed): ${knownVariables.join(', ')}` : 'Use the variable name mentioned in the description.',
        `Allowed operators: ${CONDITION_OPERATOR_SUBSET.join(', ')}. Value-less operators (exists, is_number, …) take an empty value "".`,
        'Variable is the bare name or dotted path WITHOUT {{ }} braces.',
        'Value is the bare literal only — write "50", never ">50" or "=50"; the operator field already carries the comparison.',
        'When the description refers to an HTTP outcome (forbidden, unauthorized, not found), prefer a status-code variable with the numeric code (e.g. httpStatus equals 403) over a word literal.',
    ].filter(Boolean).join('\n\n');
    return structuredWithRepair(
        { system: SYSTEM_BASE, prompt, schema },
        (raw) => validateCondition(raw, knownVariables),
    );
}

/** Structured: short, specific step name. */
export async function suggestStepName(step) {
    const schema = {
        type: 'object',
        properties: { name: { type: 'string', maxLength: 60 } },
    };
    const prompt = [
        'Name this API-flow step. 2-5 words, specific and verb-first (e.g. "Fetch user profile", "Check balance limit"). No quotes, no step numbers.',
        describeStepForPrompt(step),
    ].join('\n\n');
    const raw = await callStructured({ system: SYSTEM_BASE, prompt, schema, maxTokens: 60 });
    const name = String(raw?.name || '').trim().replace(/^["']|["']$/g, '').slice(0, 60);
    if (!name) throw new Error('No name produced.');
    return name;
}

/** Structured: one-sentence flow description. */
export async function suggestFlowDescription(flowModel) {
    const schema = {
        type: 'object',
        properties: { description: { type: 'string', maxLength: 300 } },
    };
    const stepsBrief = (flowModel.steps || []).map((s, i) =>
        `${i + 1}. [${s.type}] ${s.name}${s.type === 'request' ? ` (${s.method} ${s.url})` : ''}`).join('\n');
    const prompt = [
        `Write a 1-2 sentence description of what this API flow does, for its file header. Plain, specific, no marketing.`,
        `FLOW: ${flowModel.name}`,
        `STEPS:\n${truncateBody(stepsBrief, 1500)}`,
    ].join('\n\n');
    const raw = await callStructured({ system: SYSTEM_BASE, prompt, schema, maxTokens: 120 });
    const description = String(raw?.description || '').trim();
    if (!description) throw new Error('No description produced.');
    return description.slice(0, 300);
}

/** Prose: digest of the latest run. Streams via requestId. */
export function runDigest(requestId) {
    const results = appState.executionResults || [];
    if (!results.length) return Promise.reject(new Error('Run the flow first.'));
    const lines = results.map((r) => {
        const bits = [`${r.stepName || r.stepId} [${r.status}]`];
        if (r.output?.status) bits.push(`HTTP ${r.output.status}`);
        if (r.error) bits.push(`error: ${String(r.error).slice(0, 160)}`);
        if ((r.extractionFailures || []).length) bits.push(`extraction failures: ${r.extractionFailures.length}`);
        return bits.join(' · ');
    }).join('\n');
    const prompt = [
        'Summarize this API flow run for the person who ran it.',
        `RESULTS (${results.length} steps):\n${truncateBody(lines, 2500)}`,
        'Max 90 words: overall verdict first, then what failed or looks fragile (if anything), then one suggestion. Plain language, no markdown.',
    ].join('\n\n');
    return ai().generateProse({ system: SYSTEM_BASE, prompt, maxTokens: 800, requestId });
}
