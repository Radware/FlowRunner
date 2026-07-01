// ========== FILE: importCurlHar.js ==========
// WAVE2 engine-features lane: zero-dependency import of cURL commands and HAR
// files into FlowRunner request step(s). Mirrors the request-step shape produced
// by createNewStep('request') in flowCore.js and the HAR shape emitted by
// harExporter.js — the inverse direction (import instead of export).
//
// Public surface:
//   parseCurl(curlString)  -> a single request step object
//   parseHar(harInput)     -> an array of request step objects
//
// Both return objects that are drop-in compatible with the flow model's
// request steps. No third-party parsers are used (CSP + build.files discipline).

import { generateUniqueId } from './flowCore.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Build a request step with the canonical shape (see flowCore.createNewStep).
 * @param {Object} fields - { name, method, url, headers, body }
 * @returns {Object} request step
 */
function makeRequestStep({ name, method, url, headers, body }) {
    return {
        id: generateUniqueId(),
        name: name || 'Imported Request',
        type: 'request',
        method: (method || 'GET').toUpperCase(),
        url: url || '',
        headers: headers || {},
        body: body != null ? body : '',
        rawBodyWithMarkers: null,
        extract: {},
        onFailure: 'stop'
    };
}

/**
 * Derive a friendly step name from a method and URL, e.g. "GET /users".
 * @param {string} method
 * @param {string} url
 * @returns {string}
 */
function nameFromRequest(method, url) {
    let path = url || '';
    try {
        const u = new URL(url);
        path = u.pathname || '/';
    } catch (e) {
        // Non-absolute or malformed URL — fall back to the raw string.
        path = url || '';
    }
    return `${(method || 'GET').toUpperCase()} ${path}`.trim();
}

// ----------------------------------------------------------------------------
// cURL parsing
// ----------------------------------------------------------------------------

/**
 * Tokenize a shell-style command line into argv, honoring single quotes,
 * double quotes, backslash escapes and backslash-newline line continuations.
 * This is intentionally minimal (no variable/glob expansion) — enough for the
 * cURL commands users paste from browser devtools.
 * @param {string} input
 * @returns {string[]} argv tokens
 */
function tokenize(input) {
    const tokens = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let hasToken = false; // distinguishes '' token from no token

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (inSingle) {
            if (ch === "'") {
                inSingle = false;
            } else {
                current += ch;
            }
            continue;
        }

        if (inDouble) {
            if (ch === '\\') {
                const next = input[i + 1];
                // In double quotes, backslash only escapes a few characters.
                if (next === '"' || next === '\\' || next === '$' || next === '`') {
                    current += next;
                    i++;
                } else {
                    current += ch;
                }
            } else if (ch === '"') {
                inDouble = false;
            } else {
                current += ch;
            }
            continue;
        }

        // Unquoted context
        if (ch === '\\') {
            const next = input[i + 1];
            if (next === '\n') {
                // Line continuation — skip the newline.
                i++;
            } else if (next === '\r' && input[i + 2] === '\n') {
                i += 2;
            } else if (next !== undefined) {
                current += next;
                i++;
                hasToken = true;
            }
            continue;
        }

        if (ch === "'") {
            inSingle = true;
            hasToken = true;
            continue;
        }
        if (ch === '"') {
            inDouble = true;
            hasToken = true;
            continue;
        }

        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            if (hasToken) {
                tokens.push(current);
                current = '';
                hasToken = false;
            }
            continue;
        }

        current += ch;
        hasToken = true;
    }

    if (inSingle || inDouble) {
        throw new Error('Unbalanced quotes in cURL command.');
    }
    if (hasToken) {
        tokens.push(current);
    }
    return tokens;
}

/**
 * Split a raw header string ("Name: value") into [name, value].
 * @param {string} raw
 * @returns {[string, string] | null}
 */
function splitHeader(raw) {
    const idx = raw.indexOf(':');
    if (idx === -1) return null;
    const name = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!name) return null;
    return [name, value];
}

/**
 * Parse a cURL command string into a single request step.
 * @param {string} curlString
 * @returns {Object} request step
 */
export function parseCurl(curlString) {
    if (typeof curlString !== 'string' || !curlString.trim()) {
        throw new Error('cURL input is empty.');
    }

    const argv = tokenize(curlString.trim());
    if (argv.length === 0 || argv[0] !== 'curl') {
        throw new Error('Input does not start with "curl".');
    }

    let method = null;
    let url = null;
    let body = null;
    const headers = {};

    // Flags that consume the following token as their value.
    const valueFlags = new Set([
        '-X', '--request',
        '-H', '--header',
        '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
        '--url',
        '-u', '--user',
        '-e', '--referer',
        '-A', '--user-agent',
        '-b', '--cookie'
    ]);

    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];

        // Support --flag=value form.
        let flag = arg;
        let inlineValue = null;
        if (arg.startsWith('--') && arg.includes('=')) {
            const eq = arg.indexOf('=');
            flag = arg.slice(0, eq);
            inlineValue = arg.slice(eq + 1);
        }

        const takeValue = () => {
            if (inlineValue !== null) return inlineValue;
            i++;
            return argv[i];
        };

        if (flag === '-X' || flag === '--request') {
            const v = takeValue();
            if (v) method = v.toUpperCase();
        } else if (flag === '-H' || flag === '--header') {
            const v = takeValue();
            const parsed = v != null ? splitHeader(v) : null;
            if (parsed) headers[parsed[0]] = parsed[1];
        } else if (
            flag === '-d' || flag === '--data' || flag === '--data-raw' ||
            flag === '--data-binary' || flag === '--data-ascii'
        ) {
            const v = takeValue();
            body = v != null ? v : '';
        } else if (flag === '--url') {
            const v = takeValue();
            if (v) url = v;
        } else if (valueFlags.has(flag)) {
            // Known flags whose value we accept but don't map onto the step
            // (auth/cookie/referer/user-agent) — consume their value so it is
            // not mistaken for the URL.
            takeValue();
        } else if (arg.startsWith('-')) {
            // Unknown boolean flag (e.g. --compressed, -k, -s, -L). Ignore it.
            continue;
        } else {
            // First bare argument is the URL.
            if (url === null) {
                url = arg;
            }
        }
    }

    if (!url) {
        throw new Error('No URL found in cURL command.');
    }

    // curl semantics: a data flag implies POST unless a method was given.
    if (!method) {
        method = body !== null ? 'POST' : 'GET';
    }

    return makeRequestStep({
        name: nameFromRequest(method, url),
        method,
        url,
        headers,
        body: body !== null ? body : ''
    });
}

// ----------------------------------------------------------------------------
// HAR parsing
// ----------------------------------------------------------------------------

/**
 * Convert HAR header array ([{name,value}]) into a plain object.
 * @param {Array} harHeaders
 * @returns {Object}
 */
function harHeadersToObject(harHeaders) {
    const out = {};
    if (!Array.isArray(harHeaders)) return out;
    for (const h of harHeaders) {
        if (!h || typeof h.name !== 'string') continue;
        // Skip HTTP/2 pseudo-headers (":method", ":path", ...) — they are not
        // real request headers and fetch() would reject them.
        if (h.name.startsWith(':')) continue;
        out[h.name] = h.value != null ? String(h.value) : '';
    }
    return out;
}

/**
 * Parse a HAR (object or JSON string) into an array of request steps.
 * @param {Object|string} harInput
 * @returns {Object[]} request steps
 */
export function parseHar(harInput) {
    let har = harInput;
    if (typeof harInput === 'string') {
        try {
            har = JSON.parse(harInput);
        } catch (e) {
            throw new Error(`Invalid HAR JSON: ${e.message}`);
        }
    }

    if (!har || typeof har !== 'object' || !har.log || !Array.isArray(har.log.entries)) {
        throw new Error('Malformed HAR: expected log.entries array.');
    }

    const steps = [];
    for (const entry of har.log.entries) {
        const request = entry && entry.request;
        if (!request || typeof request.url !== 'string') continue;

        // Only import http(s) requests — skip data:, blob:, ws:, etc.
        if (!/^https?:\/\//i.test(request.url)) continue;

        const method = (request.method || 'GET').toUpperCase();
        const headers = harHeadersToObject(request.headers);

        let body = '';
        if (request.postData && typeof request.postData.text === 'string' &&
            METHODS_WITH_BODY.has(method)) {
            body = request.postData.text;
        }

        steps.push(makeRequestStep({
            name: nameFromRequest(method, request.url),
            method,
            url: request.url,
            headers,
            body
        }));
    }

    return steps;
}
