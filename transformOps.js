// transformOps.js
/**
 * Portable transform operations for FlowRunner.
 * No engine-specific logic; execute with provided evaluatePath function.
 */

const BASE64_VARIANTS = ['standard', 'url'];
const BASE64_PADDING = ['keep', 'strip', 'add'];
const BASE64_DECODE_OUTPUTS = ['text', 'json'];
const SIGNATURE_MODES = ['reuse', 'none', 'sign'];
const SIGNATURE_ALGORITHMS = ['HS256', 'HS384', 'HS512'];

export const TRANSFORM_OP_DEFS = {
    base64_decode: {
        label: 'Base64 Decode',
        args: [
            { key: 'input', label: 'Input' }
        ],
        options: [
            { key: 'base64', label: 'Variant', values: BASE64_VARIANTS, default: 'url' },
            { key: 'as', label: 'Output', values: BASE64_DECODE_OUTPUTS, default: 'text' }
        ]
    },
    base64_encode: {
        label: 'Base64 Encode',
        args: [
            { key: 'input', label: 'Input' }
        ],
        options: [
            { key: 'base64', label: 'Variant', values: BASE64_VARIANTS, default: 'url' },
            { key: 'padding', label: 'Padding', values: BASE64_PADDING, default: 'strip' }
        ]
    },
    jwt_decode: {
        label: 'JWT Decode',
        args: [
            { key: 'token', label: 'Token' }
        ],
        options: [
            { key: 'base64', label: 'Variant', values: BASE64_VARIANTS, default: 'url' },
            { key: 'stripBearer', label: 'Strip Bearer', values: ['true', 'false'], default: 'true' }
        ]
    },
    jwt_encode: {
        label: 'JWT Encode',
        args: [
            { key: 'header', label: 'Header' },
            { key: 'payload', label: 'Payload' },
            { key: 'signature', label: 'Signature' }
        ],
        options: [
            { key: 'base64', label: 'Variant', values: BASE64_VARIANTS, default: 'url' },
            { key: 'signatureMode', label: 'Signature', values: SIGNATURE_MODES, default: 'reuse' },
            { key: 'algorithm', label: 'Algorithm', values: SIGNATURE_ALGORITHMS, default: 'HS256', dependsOn: { key: 'signatureMode', values: ['sign'] } },
            { key: 'secret', label: 'Secret', input: 'value', dependsOn: { key: 'signatureMode', values: ['sign'] } }
        ]
    },
    json_set: {
        label: 'JSON Set',
        args: [
            { key: 'target', label: 'Target' },
            { key: 'path', label: 'Path' },
            { key: 'value', label: 'Value' }
        ],
        options: []
    },
    math_add: {
        label: 'Math Add',
        args: [
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' }
        ],
        options: []
    },
    math_sub: {
        label: 'Math Subtract',
        args: [
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' }
        ],
        options: []
    },
    math_mul: {
        label: 'Math Multiply',
        args: [
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' }
        ],
        options: []
    },
    math_div: {
        label: 'Math Divide',
        args: [
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' }
        ],
        options: []
    },
    to_number: {
        label: 'To Number',
        args: [
            { key: 'value', label: 'Value' }
        ],
        options: []
    },
    to_string: {
        label: 'To String',
        args: [
            { key: 'value', label: 'Value' }
        ],
        options: []
    },
    to_boolean: {
        label: 'To Boolean',
        args: [
            { key: 'value', label: 'Value' }
        ],
        options: []
    },
    boolean_not: {
        label: 'Boolean Not',
        args: [
            { key: 'value', label: 'Value' }
        ],
        options: []
    }
};

export const TRANSFORM_OP_NAMES = Object.keys(TRANSFORM_OP_DEFS);

export function isTransformOpName(name) {
    return !!TRANSFORM_OP_DEFS[name];
}

export function createTransformOp(opName = 'base64_decode') {
    const def = TRANSFORM_OP_DEFS[opName] || TRANSFORM_OP_DEFS.base64_decode;
    const args = Array.isArray(def.args) ? def.args.map(() => '') : [];
    const options = {};
    if (Array.isArray(def.options)) {
        def.options.forEach(opt => {
            if (opt.default !== undefined) {
                options[opt.key] = opt.default;
            }
        });
    }
    return {
        op: opName,
        set: '',
        args: args,
        options: options
    };
}

export function normalizeTransformOp(op) {
    const safeOp = op && typeof op === 'object' ? op : {};
    const opName = isTransformOpName(safeOp.op) ? safeOp.op : 'base64_decode';
    const def = TRANSFORM_OP_DEFS[opName];
    const args = Array.isArray(safeOp.args) ? safeOp.args.slice(0, def.args.length) : [];
    while (args.length < def.args.length) {
        args.push('');
    }
    const options = {};
    if (Array.isArray(def.options)) {
        def.options.forEach(opt => {
            const provided = safeOp.options && Object.prototype.hasOwnProperty.call(safeOp.options, opt.key)
                ? safeOp.options[opt.key]
                : undefined;
            if (provided !== undefined) {
                options[opt.key] = provided;
            } else if (opt.default !== undefined) {
                options[opt.key] = opt.default;
            }
        });
    }
    return {
        op: opName,
        set: typeof safeOp.set === 'string' ? safeOp.set : '',
        args: args,
        options: options
    };
}

export function normalizeRefPath(refPath) {
    if (!refPath || typeof refPath !== 'string') return '';
    const trimmed = refPath.trim();
    if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
        return trimmed.slice(2, -2).trim();
    }
    return trimmed;
}

export function resolveTransformValue(value, context, evaluatePath) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === 'ref') {
            const path = normalizeRefPath(value.ref);
            if (!path) {
                throw new Error('Transform reference is empty.');
            }
            if (typeof evaluatePath !== 'function') {
                throw new Error('Transform reference requires a path evaluator.');
            }
            const resolved = evaluatePath(context, path);
            if (resolved === undefined) {
                throw new Error(`Transform reference "{{${path}}}" is undefined.`);
            }
            return resolved;
        }
        const resolvedObj = {};
        keys.forEach(key => {
            resolvedObj[key] = resolveTransformValue(value[key], context, evaluatePath);
        });
        return resolvedObj;
    }
    if (Array.isArray(value)) {
        return value.map(item => resolveTransformValue(item, context, evaluatePath));
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
            const path = normalizeRefPath(trimmed);
            if (!path) {
                throw new Error('Transform reference is empty.');
            }
            if (typeof evaluatePath !== 'function') {
                throw new Error('Transform reference requires a path evaluator.');
            }
            const resolved = evaluatePath(context, path);
            if (resolved === undefined) {
                throw new Error(`Transform reference "{{${path}}}" is undefined.`);
            }
            return resolved;
        }
    }
    return value;
}

export async function executeTransformOps(ops, context, options = {}) {
    const output = { updatedVars: [], warnings: [] };
    const list = Array.isArray(ops) ? ops : [];
    for (let i = 0; i < list.length; i++) {
        // Graceful degradation: an unknown/newer transform op is SKIPPED with a
        // machine-readable warning rather than silently downgraded to base64_decode
        // (which would run the wrong operation) or thrown (which would fail the step).
        const rawOp = list[i] && typeof list[i] === 'object' ? list[i] : {};
        if (!isTransformOpName(rawOp.op)) {
            const setHint = typeof rawOp.set === 'string' ? rawOp.set : null;
            output.warnings.push({
                type: 'unsupported_transform_op',
                op: rawOp.op ?? null,
                set: setHint,
                index: i,
                status: 'skipped',
                message: `Unsupported transform op "${rawOp.op}" at position ${i + 1}; skipped (${setHint ? `output variable "${setHint}" left unset` : 'no output variable set'}).`,
            });
            console.warn(`[transformOps] TRANSFORM_OP_UNSUPPORTED op=${JSON.stringify(rawOp.op)} set=${JSON.stringify(setHint)} index=${i} - skipped, not executed (refusing to silently substitute base64_decode).`);
            continue;
        }
        const normalized = normalizeTransformOp(list[i]);
        if (!normalized.set || typeof normalized.set !== 'string') {
            throw new Error(`Transform op ${i + 1} is missing a valid output variable.`);
        }
        const value = await executeTransformOp(normalized, context, options);
        context[normalized.set] = value;
        output.updatedVars.push(normalized.set);
    }
    return output;
}

export async function executeTransformOp(op, context, options = {}) {
    const evaluatePath = options.evaluatePath;
    const resolvedArgs = (op.args || []).map(arg => resolveTransformValue(arg, context, evaluatePath));
    const resolvedOptions = resolveTransformOptions(op.options || {}, context, evaluatePath);
    switch (op.op) {
        case 'base64_decode':
            return base64Decode(resolvedArgs[0], resolvedOptions);
        case 'base64_encode':
            return base64Encode(resolvedArgs[0], resolvedOptions);
        case 'jwt_decode':
            return jwtDecode(resolvedArgs[0], resolvedOptions);
        case 'jwt_encode':
            return await jwtEncode(resolvedArgs[0], resolvedArgs[1], resolvedArgs[2], resolvedOptions);
        case 'json_set':
            return jsonSet(resolvedArgs[0], resolvedArgs[1], resolvedArgs[2]);
        case 'math_add':
            return mathAdd(resolvedArgs[0], resolvedArgs[1]);
        case 'math_sub':
            return mathSub(resolvedArgs[0], resolvedArgs[1]);
        case 'math_mul':
            return mathMul(resolvedArgs[0], resolvedArgs[1]);
        case 'math_div':
            return mathDiv(resolvedArgs[0], resolvedArgs[1]);
        case 'to_number':
            return toNumber(resolvedArgs[0]);
        case 'to_string':
            return toStringValue(resolvedArgs[0]);
        case 'to_boolean':
            return toBoolean(resolvedArgs[0]);
        case 'boolean_not':
            return !toBoolean(resolvedArgs[0]);
        default:
            throw new Error(`Unsupported transform op "${op.op}".`);
    }
}

function resolveTransformOptions(options, context, evaluatePath) {
    const resolved = {};
    Object.entries(options || {}).forEach(([key, value]) => {
        resolved[key] = resolveTransformValue(value, context, evaluatePath);
    });
    return resolved;
}

function base64Encode(input, options = {}) {
    const variant = normalizeVariant(options.base64, 'url');
    const padding = normalizePadding(options.padding, variant === 'url' ? 'strip' : 'keep');
    const text = normalizeTextInput(input);
    const base64 = encodeTextToBase64(text);
    return applyBase64Variant(base64, variant, padding);
}

function base64Decode(input, options = {}) {
    const variant = normalizeVariant(options.base64, 'url');
    const outputAs = normalizeDecodeOutput(options.as);
    const normalized = normalizeBase64ForDecode(String(input ?? ''), variant);
    const bytes = decodeBase64ToBytes(normalized);
    const text = decodeBytesToText(bytes);
    if (outputAs === 'json') {
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new Error(`Base64 decode produced invalid JSON: ${error.message}`);
        }
    }
    return text;
}

function jwtDecode(tokenInput, options = {}) {
    let token = String(tokenInput ?? '').trim();
    const stripBearer = normalizeBoolean(options.stripBearer, true);
    if (stripBearer && /^bearer\s+/i.test(token)) {
        token = token.replace(/^bearer\s+/i, '').trim();
    }
    const parts = token.split('.');
    if (parts.length < 2) {
        throw new Error('JWT must contain at least header and payload segments.');
    }
    const variant = normalizeVariant(options.base64, 'url');
    const headerJson = base64Decode(parts[0], { base64: variant, as: 'text' });
    const payloadJson = base64Decode(parts[1], { base64: variant, as: 'text' });
    let header;
    let payload;
    try {
        header = JSON.parse(headerJson);
    } catch (error) {
        throw new Error(`JWT header is not valid JSON: ${error.message}`);
    }
    try {
        payload = JSON.parse(payloadJson);
    } catch (error) {
        throw new Error(`JWT payload is not valid JSON: ${error.message}`);
    }
    return {
        header: header,
        payload: payload,
        signature: parts[2] || '',
        parts: {
            header: parts[0],
            payload: parts[1],
            signature: parts[2] || ''
        }
    };
}

async function jwtEncode(headerInput, payloadInput, signatureInput, options = {}) {
    const variant = normalizeVariant(options.base64, 'url');
    const headerJson = normalizeJsonInput(headerInput, 'JWT header');
    const payloadJson = normalizeJsonInput(payloadInput, 'JWT payload');
    const headerPart = base64Encode(headerJson, { base64: variant, padding: variant === 'url' ? 'strip' : 'keep' });
    const payloadPart = base64Encode(payloadJson, { base64: variant, padding: variant === 'url' ? 'strip' : 'keep' });
    const signatureMode = normalizeSignatureMode(options.signatureMode);
    let signaturePart = '';

    if (signatureMode === 'reuse') {
        signaturePart = signatureInput == null ? '' : String(signatureInput);
    } else if (signatureMode === 'sign') {
        const algorithm = normalizeSignatureAlgorithm(options.algorithm);
        const secret = options.secret;
        if (secret == null || secret === '') {
            throw new Error('JWT signing requires a secret.');
        }
        const toSign = `${headerPart}.${payloadPart}`;
        signaturePart = await hmacSign(algorithm, secret, toSign, variant);
    }

    return `${headerPart}.${payloadPart}.${signaturePart}`;
}

function normalizeJsonInput(value, label) {
    if (value == null) {
        throw new Error(`${label} is required.`);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            throw new Error(`${label} is empty.`);
        }
        try {
            JSON.parse(trimmed);
            return trimmed;
        } catch (error) {
            throw new Error(`${label} must be valid JSON: ${error.message}`);
        }
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        throw new Error(`${label} could not be stringified: ${error.message}`);
    }
}

function jsonSet(target, path, value) {
    const tokens = tokenizePath(String(path ?? '').trim());
    if (tokens.length === 0) {
        throw new Error('JSON set requires a path.');
    }
    const root = cloneValue(target);
    return setPathValue(root, tokens, value);
}

function tokenizePath(path) {
    if (!path) return [];
    const tokens = [];
    let current = '';
    let inBracket = false;
    let quote = null;
    for (let i = 0; i < path.length; i++) {
        const ch = path[i];
        if (inBracket) {
            if (quote) {
                if (ch === quote) {
                    quote = null;
                } else {
                    current += ch;
                }
                continue;
            }
            if (ch === '"' || ch === '\'') {
                quote = ch;
                continue;
            }
            if (ch === ']') {
                if (current.length > 0) {
                    tokens.push(current);
                    current = '';
                }
                inBracket = false;
                continue;
            }
            if (ch !== '[') {
                current += ch;
            }
            continue;
        }
        if (ch === '.') {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        if (ch === '[') {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
            inBracket = true;
            continue;
        }
        current += ch;
    }
    if (current.length > 0) {
        tokens.push(current);
    }
    return tokens.filter(token => token.length > 0);
}

function setPathValue(root, tokens, value) {
    if (tokens.length === 0) {
        return value;
    }
    const copy = Array.isArray(root) ? root.slice() : isPlainObject(root) ? { ...root } : {};
    let current = copy;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const isLast = i === tokens.length - 1;
        const nextToken = tokens[i + 1];
        if (isLast) {
            current[token] = cloneValue(value);
            break;
        }
        const nextIsIndex = isNumericToken(nextToken);
        const existing = current[token];
        let nextValue;
        if (Array.isArray(existing) || isPlainObject(existing)) {
            nextValue = Array.isArray(existing) ? existing.slice() : { ...existing };
        } else {
            nextValue = nextIsIndex ? [] : {};
        }
        current[token] = nextValue;
        current = nextValue;
    }
    return copy;
}

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map(item => cloneValue(item));
    }
    if (isPlainObject(value)) {
        const cloned = {};
        Object.entries(value).forEach(([key, val]) => {
            cloned[key] = cloneValue(val);
        });
        return cloned;
    }
    return value;
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNumericToken(token) {
    return /^\d+$/.test(token);
}

function mathAdd(a, b) {
    return toNumber(a) + toNumber(b);
}

function mathSub(a, b) {
    return toNumber(a) - toNumber(b);
}

function mathMul(a, b) {
    return toNumber(a) * toNumber(b);
}

function mathDiv(a, b) {
    const divisor = toNumber(b);
    if (divisor === 0) {
        throw new Error('Division by zero.');
    }
    return toNumber(a) / divisor;
}

function toNumber(value) {
    const num = Number(value);
    if (Number.isNaN(num)) {
        throw new Error(`Value "${value}" is not a number.`);
    }
    return num;
}

function toStringValue(value) {
    return value == null ? '' : String(value);
}

function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
    }
    return Boolean(value);
}

function normalizeVariant(value, fallback) {
    return BASE64_VARIANTS.includes(value) ? value : fallback;
}

function normalizePadding(value, fallback) {
    return BASE64_PADDING.includes(value) ? value : fallback;
}

function normalizeDecodeOutput(value) {
    return BASE64_DECODE_OUTPUTS.includes(value) ? value : 'text';
}

function normalizeSignatureMode(value) {
    return SIGNATURE_MODES.includes(value) ? value : 'reuse';
}

function normalizeSignatureAlgorithm(value) {
    return SIGNATURE_ALGORITHMS.includes(value) ? value : 'HS256';
}

function normalizeBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
    }
    return fallback;
}

function normalizeTextInput(input) {
    if (input == null) return '';
    if (typeof input === 'string') return input;
    try {
        return JSON.stringify(input);
    } catch {
        return String(input);
    }
}

function applyBase64Variant(base64, variant, padding) {
    let value = base64;
    if (variant === 'url') {
        value = value.replace(/\+/g, '-').replace(/\//g, '_');
    }
    if (padding === 'strip') {
        value = value.replace(/=+$/g, '');
    } else if (padding === 'add') {
        value = addBase64Padding(value);
    }
    return value;
}

function normalizeBase64ForDecode(value, variant) {
    let normalized = value.replace(/\s+/g, '');
    if (variant === 'url') {
        normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
    }
    normalized = addBase64Padding(normalized);
    return normalized;
}

function addBase64Padding(value) {
    const mod = value.length % 4;
    if (mod === 0) return value;
    return value + '='.repeat(4 - mod);
}

function encodeTextToBase64(text) {
    const bytes = encodeText(text);
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    if (typeof btoa === 'function') {
        let binary = '';
        bytes.forEach(byte => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }
    throw new Error('Base64 encoding is not supported in this environment.');
}

function decodeBase64ToBytes(base64) {
    if (typeof Buffer !== 'undefined') {
        const buffer = Buffer.from(base64, 'base64');
        return new Uint8Array(buffer);
    }
    if (typeof atob === 'function') {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    throw new Error('Base64 decoding is not supported in this environment.');
}

function encodeText(text) {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(text);
    }
    if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(text, 'utf8'));
    }
    const encoded = unescape(encodeURIComponent(text));
    const bytes = new Uint8Array(encoded.length);
    for (let i = 0; i < encoded.length; i++) {
        bytes[i] = encoded.charCodeAt(i);
    }
    return bytes;
}

function decodeBytesToText(bytes) {
    if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder().decode(bytes);
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('utf8');
    }
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return decodeURIComponent(escape(binary));
}

async function hmacSign(algorithm, secret, data, variant) {
    const hash = algorithmToHash(algorithm);
    const webCrypto = getWebCrypto();
    if (webCrypto) {
        const key = await webCrypto.subtle.importKey(
            'raw',
            encodeText(String(secret)),
            { name: 'HMAC', hash: { name: hash } },
            false,
            ['sign']
        );
        const signature = await webCrypto.subtle.sign('HMAC', key, encodeText(data));
        const bytes = new Uint8Array(signature);
        const base64 = encodeBytesToBase64(bytes);
        return applyBase64Variant(base64, variant, variant === 'url' ? 'strip' : 'keep');
    }
    const nodeCrypto = await getNodeCrypto();
    if (!nodeCrypto) {
        throw new Error('JWT signing is not supported in this environment.');
    }
    const hmac = nodeCrypto.createHmac(hash.toLowerCase().replace('-', ''), String(secret));
    hmac.update(String(data));
    const raw = hmac.digest();
    const base64 = encodeBytesToBase64(Uint8Array.from(raw));
    return applyBase64Variant(base64, variant, variant === 'url' ? 'strip' : 'keep');
}

function getWebCrypto() {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        return crypto;
    }
    return null;
}

async function getNodeCrypto() {
    try {
        const module = await import('crypto');
        return module;
    } catch {
        return null;
    }
}

function algorithmToHash(algorithm) {
    switch (algorithm) {
        case 'HS384':
            return 'SHA-384';
        case 'HS512':
            return 'SHA-512';
        case 'HS256':
        default:
            return 'SHA-256';
    }
}

function encodeBytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    if (typeof btoa === 'function') {
        let binary = '';
        bytes.forEach(byte => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }
    throw new Error('Base64 encoding is not supported in this environment.');
}
