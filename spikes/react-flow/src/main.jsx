import { createReactFlowVisualizer } from './createVisualizerFacade.js';
import { sampleFlow } from './sampleFlow.js';
import { countSteps } from './flowModelAdapter.js';
import './spike.css';

// Demo harness. Mounts the facade exactly the way app.js -> initializeVisualizer()
// would, then drives it through the contract surface to prove each method works.
const mount = document.getElementById('root');

// A crude naive layout so the demo renders without pulling in autoLayout.js
// (the real app would pass flowModel.visualLayout from computeLayout()).
function naiveLayout(flow) {
    const positions = {};
    let y = 0;
    (function walk(steps, x) {
        (steps || []).forEach((s) => {
            positions[s.id] = { x, y };
            y += 140;
            walk(s.then || s.thenSteps, x + 300);
            walk(s.else || s.elseSteps, x - 300);
            walk(s.steps || s.loopSteps, x + 300);
        });
    })(flow.steps, 0);
    return positions;
}

const flow = { ...sampleFlow, visualLayout: naiveLayout(sampleFlow) };

const vis = createReactFlowVisualizer(mount, {
    onNodeSelect: (id) => log(`onNodeSelect(${id})`),
    onNodeLayoutUpdate: (info) => log(`onNodeLayoutUpdate(${info.id})`),
    onConnectionUpdate: (c) => log(`onConnectionUpdate(${JSON.stringify(c)})`),
    onDeleteStep: (id) => log(`onDeleteStep(${id})`),
});

// Give React a tick to commit, then exercise the contract.
setTimeout(() => {
    vis.render(flow, 'step_1_get_ip');
    log(`render() — ${countSteps(flow)} steps mapped to nodes`);
    setTimeout(() => vis.showMinimap(), 400);
    setTimeout(() => {
        // Simulate a run: highlight + runtime info.
        vis.highlightNode('step_1_get_ip', 'active-step');
        vis.updateNodeRuntimeInfo('step_1_get_ip', { status: 'running', durationMs: 42 });
    }, 800);
    setTimeout(() => {
        vis.highlightNode('step_1_get_ip', 'error');
        vis.updateNodeRuntimeInfo('step_1_get_ip', { status: 'error', durationMs: 512 });
    }, 1600);
}, 50);

// Simple on-page event log so the demo is self-verifying.
function log(msg) {
    const el = document.getElementById('spike-log') || createLog();
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
    el.prepend(line);
}
function createLog() {
    const el = document.createElement('div');
    el.id = 'spike-log';
    el.className = 'spike-log';
    document.body.appendChild(el);
    return el;
}
