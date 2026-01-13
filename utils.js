// Simple path shim for display purposes
export const path = {
    basename: (p) => p.split(/[\\/]/).pop() || p
};

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const DEFAULT_RANDOM_INT_MIN = 0;
const DEFAULT_RANDOM_INT_MAX = 1000000;
const DEFAULT_RANDOM_STRING_LENGTH = 12;
const MAX_RANDOM_STRING_LENGTH = 256;
const RANDOM_STRING_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateRandomInt(min = DEFAULT_RANDOM_INT_MIN, max = DEFAULT_RANDOM_INT_MAX) {
    let safeMin = Number.isFinite(min) ? Math.floor(min) : DEFAULT_RANDOM_INT_MIN;
    let safeMax = Number.isFinite(max) ? Math.floor(max) : DEFAULT_RANDOM_INT_MAX;
    if (safeMax < safeMin) [safeMin, safeMax] = [safeMax, safeMin];
    return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

export function generateRandomString(length = DEFAULT_RANDOM_STRING_LENGTH) {
    let safeLength = Number.isFinite(length) ? Math.floor(length) : DEFAULT_RANDOM_STRING_LENGTH;
    safeLength = Math.min(Math.max(safeLength, 1), MAX_RANDOM_STRING_LENGTH);
    let output = '';
    for (let i = 0; i < safeLength; i++) {
        const index = Math.floor(Math.random() * RANDOM_STRING_CHARS.length);
        output += RANDOM_STRING_CHARS[index];
    }
    return output;
}

function parseFunctionArgs(ref, name) {
    const pattern = new RegExp(`^${name}\\s*(?:\\(([^)]*)\\))?$`);
    const match = ref.match(pattern);
    if (!match) return null;
    if (!match[1]) return [];
    return match[1]
        .split(',')
        .map(part => part.trim())
        .filter(part => part.length > 0);
}

function getCachedRandomValue(runnerState, key, generator) {
    if (!runnerState) return undefined;
    if (!runnerState.randomCache || typeof runnerState.randomCache !== 'object') {
        runnerState.randomCache = {};
    }
    if (!Object.prototype.hasOwnProperty.call(runnerState.randomCache, key)) {
        runnerState.randomCache[key] = generator();
    }
    return runnerState.randomCache[key];
}

export function resolveSpecialVariable(ref, runnerState) {
    if (!runnerState || !ref || typeof ref !== 'string') return undefined;
    const trimmedRef = ref.trim();

    if (trimmedRef === 'RANDOM_IP') {
        if (!runnerState.randomIP) {
            runnerState.randomIP = generateRandomPublicIP();
        }
        return runnerState.randomIP;
    }

    const intArgs = parseFunctionArgs(trimmedRef, 'RANDOM_INT');
    if (intArgs) {
        let min = DEFAULT_RANDOM_INT_MIN;
        let max = DEFAULT_RANDOM_INT_MAX;
        if (intArgs.length === 1) {
            const parsedMax = parseInt(intArgs[0], 10);
            max = Number.isFinite(parsedMax) ? parsedMax : DEFAULT_RANDOM_INT_MAX;
        } else if (intArgs.length >= 2) {
            const parsedMin = parseInt(intArgs[0], 10);
            const parsedMax = parseInt(intArgs[1], 10);
            min = Number.isFinite(parsedMin) ? parsedMin : DEFAULT_RANDOM_INT_MIN;
            max = Number.isFinite(parsedMax) ? parsedMax : DEFAULT_RANDOM_INT_MAX;
        }
        const cached = getCachedRandomValue(runnerState, trimmedRef, () => generateRandomInt(min, max));
        return cached !== undefined ? String(cached) : undefined;
    }

    const stringArgs = parseFunctionArgs(trimmedRef, 'RANDOM_STRING');
    if (stringArgs) {
        let length = DEFAULT_RANDOM_STRING_LENGTH;
        if (stringArgs.length >= 1) {
            const parsedLength = parseInt(stringArgs[0], 10);
            length = Number.isFinite(parsedLength) ? parsedLength : DEFAULT_RANDOM_STRING_LENGTH;
        }
        const cached = getCachedRandomValue(runnerState, trimmedRef, () => generateRandomString(length));
        return cached !== undefined ? String(cached) : undefined;
    }

    return undefined;
}

/**
 * Generate a random public IPv4 address from IANA routable public IP ranges.
 * Excludes private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16),
 * loopback (127.0.0.0/8), link-local (169.254.0.0/16), and multicast (224.0.0.0/4).
 * @returns {string} A random public IPv4 address
 */
export function generateRandomPublicIP() {
    // Public IP ranges to choose from (simplified approach)
    // We'll generate from common public ranges, avoiding reserved blocks
    const publicRanges = [
        { start: [1, 0, 0, 0], end: [9, 255, 255, 255] },        // 1.0.0.0 - 9.255.255.255
        { start: [11, 0, 0, 0], end: [126, 255, 255, 255] },     // 11.0.0.0 - 126.255.255.255 (skip 10.x.x.x and 127.x.x.x)
        { start: [128, 0, 0, 0], end: [169, 253, 255, 255] },    // 128.0.0.0 - 169.253.255.255 (skip 169.254.x.x)
        { start: [169, 255, 0, 0], end: [172, 15, 255, 255] },   // 169.255.0.0 - 172.15.255.255
        { start: [172, 32, 0, 0], end: [191, 255, 255, 255] },   // 172.32.0.0 - 191.255.255.255 (skip 172.16-31.x.x)
        { start: [192, 0, 0, 0], end: [192, 167, 255, 255] },    // 192.0.0.0 - 192.167.255.255
        { start: [192, 169, 0, 0], end: [223, 255, 255, 255] }   // 192.169.0.0 - 223.255.255.255 (skip 192.168.x.x and 224+)
    ];

    // Select a random range
    const range = publicRanges[Math.floor(Math.random() * publicRanges.length)];
    
    // Generate IP within the selected range
    const octets = [];
    for (let i = 0; i < 4; i++) {
        const min = range.start[i];
        const max = range.end[i];
        octets[i] = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    return octets.join('.');
}
