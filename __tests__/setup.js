// Jest setup file
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';

// Mock SVG namespace for connector rendering
global.SVGElement = class SVGElement extends HTMLElement {
    getBBox() {
        return { x: 0, y: 0, width: 100, height: 100 };
    }
};

// Mock ResizeObserver
class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

// Mock getComputedStyle for layout calculations
global.getComputedStyle = () => ({
    getPropertyValue: () => '0px'
});

// Helper to create mouse events with coordinates
global.createMouseEvent = (type, x, y, button = 0) => {
    return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: button
    });
};

// Mock fetch for tests
global.fetch = jest.fn();

// Setup basic DOM elements that might be needed
document.body.innerHTML = `
    <div id="flow-container"></div>
    <div id="variables-toggle"></div>
`;

// Reset all mocks after each test
afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
        <div id="flow-container"></div>
        <div id="variables-toggle"></div>
    `;
});