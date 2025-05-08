// Simple path shim for display purposes
export const path = {
    basename: (p) => p.split(/[\\/]/).pop() || p
};

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}