// Simple path shim for display purposes
export const path = {
    basename: (p) => p.split(/[\\/]/).pop() || p
};

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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