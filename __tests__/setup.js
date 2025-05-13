// __tests__/setup.js
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';

// Mock SVG namespace (keep as is)
global.SVGElement = class SVGElement extends HTMLElement {
    getBBox() { return { x: 0, y: 0, width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }; }
    createSVGPoint() { return { x: 0, y: 0, matrixTransform: jest.fn().mockReturnThis() }; }
    getScreenCTM() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: jest.fn().mockReturnThis(), multiply: jest.fn().mockReturnThis(), }; }
    getBoundingClientRect() {
        let left = 0, top = 0;
        if (this.style && this.style.left) left = parseFloat(this.style.left) || 0;
        if (this.style && this.style.top) top = parseFloat(this.style.top) || 0;
        return {
            x: left, y: top,
            width: parseFloat(this.style?.width) || 100,
            height: parseFloat(this.style?.height) || NODE_MIN_HEIGHT, // Default to a constant if not set
            top: top,
            right: left + (parseFloat(this.style?.width) || 100),
            bottom: top + (parseFloat(this.style?.height) || NODE_MIN_HEIGHT),
            left: left
        };
    }
};
global.SVGSVGElement = class SVGSVGElement extends global.SVGElement {};
global.SVGPathElement = class SVGPathElement extends global.SVGElement {};
global.SVGDefsElement = class SVGDefsElement extends global.SVGElement {};
global.SVGGElement = class SVGGElement extends global.SVGElement {};
global.SVGMarkerElement = class SVGMarkerElement extends global.SVGElement {};

// Mock ResizeObserver (keep as is)
class ResizeObserverMock {
    observe = jest.fn(); unobserve = jest.fn(); disconnect = jest.fn();
}
global.ResizeObserver = ResizeObserverMock;

// Constants for fallback dimensions if not set (used in getBoundingClientRect and getComputedStyle)
const NODE_MIN_HEIGHT = 160;
const NODE_WIDTH = 240;


// Mock getComputedStyle
global.getComputedStyle = (element) => {
    const style = {
        getPropertyValue: (prop) => {
            if (element && element.style && element.style[prop]) return element.style[prop];
            if (prop === 'height' && element && typeof element.offsetHeight === 'number' && element.offsetHeight > 0) return `${element.offsetHeight}px`;
            if (prop === 'width' && element && typeof element.offsetWidth === 'number' && element.offsetWidth > 0) return `${element.offsetWidth}px`;
            if (prop === 'width') return `${NODE_WIDTH}px`;
            if (prop === 'height') return `${NODE_MIN_HEIGHT}px`;
            if (prop.startsWith('padding')) return '0px';
            if (prop === '--steps-width' || prop === '--steps-height') return '300px';
            return '0px';
        },
    };
    if (element && element.style) {
        for (const key in element.style) {
            if (Object.prototype.hasOwnProperty.call(element.style, key) && isNaN(parseInt(key,10))) {
                 style[key] = element.style[key];
            }
        }
    }
    style.width = style.width || element?.style?.width || (element?.offsetWidth?.toString() + 'px') || `${NODE_WIDTH}px`;
    style.height = style.height || element?.style?.height || (element?.offsetHeight?.toString() + 'px') || `${NODE_MIN_HEIGHT}px`;
    return style;
};


// Mock fetch for tests (keep as is)
global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200, json: async () => ({}), text: async () => "",
    headers: { get: jest.fn(h => h.toLowerCase() === 'content-type' ? 'application/json' : null), forEach: jest.fn(), [Symbol.iterator]: function* () { if (this.get('content-type')) { yield ['content-type', this.get('content-type')]; } } },
}));

// Mock localStorage (keep as is)
const localStorageMock = (function() {
    let store = {};
    return { getItem: (k) => store[k]||null, setItem: (k,v) => store[k]=String(v), removeItem: (k) => delete store[k], clear: () => store={}, get length(){return Object.keys(store).length;}, key: (i) => Object.keys(store)[i]||null };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// Mock window.showAppStepTypeDialog (keep as is)
global.window.showAppStepTypeDialog = jest.fn();

// --- requestAnimationFrame Mock (Corrected Scope) ---
let rAFCallbacks_setup = []; // Renamed to avoid conflict and ensure it's in the correct scope for the functions below
global.requestAnimationFrame = (callback) => {
    rAFCallbacks_setup.push(callback);
    return rAFCallbacks_setup.length; // Return a pseudo-ID
};
global.cancelAnimationFrame = (id) => {
    // Simple mock, doesn't truly cancel if flushAllRAF runs all
    // For more precise cancellation, would need to filter rAFCallbacks_setup
};

global.flushAllRAF = async (maxRuns = 10) => {
    for (let i = 0; i < maxRuns; i++) {
        if (rAFCallbacks_setup.length === 0) break;

        const callbacksToRun = [...rAFCallbacks_setup];
        rAFCallbacks_setup = [];

        for (const cb of callbacksToRun) {
            try {
                cb(performance.now());
            } catch (e) {
                console.error("Error in rAF callback during flushAllRAF (setup.js):", e);
            }
        }
        await Promise.resolve(); // Allow microtasks to process
    }
    if (rAFCallbacks_setup.length > 0) {
        console.warn(`flushAllRAF (setup.js): Still ${rAFCallbacks_setup.length} rAF callbacks pending after ${maxRuns} runs. Test might hang or be flaky.`);
        rAFCallbacks_setup = [];
    }
};
// --- End requestAnimationFrame Mock ---

// Setup basic DOM (keep as is)
const setupGlobalDOM = () => { /* ... (no change needed here for now) ... */ };
beforeAll(() => { setupGlobalDOM(); });

afterEach(async () => {
    await global.flushAllRAF(5);
    jest.clearAllMocks();
    localStorageMock.clear();
    rAFCallbacks_setup = []; // Reset the setup.js rAF queue
});

// Mock offsetHeight/offsetWidth for nodes more directly
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: function() {
        if (this.classList && this.classList.contains('flow-node')) {
            // Attempt to get height from style, otherwise default
            const styleHeight = parseFloat(this.style.height);
            if (!isNaN(styleHeight) && styleHeight > 0) return styleHeight;
            return NODE_MIN_HEIGHT; // Default for nodes
        }
        // Fallback for other elements if JSDOM doesn't provide it
        return parseFloat(this.style.height) || 0;
    }
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: function() {
        if (this.classList && this.classList.contains('flow-node')) {
            const styleWidth = parseFloat(this.style.width);
            if (!isNaN(styleWidth) && styleWidth > 0) return styleWidth;
            return NODE_WIDTH;
        }
        return parseFloat(this.style.width) || 0;
    }
});