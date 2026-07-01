# React Flow spike — FlowRunner node-graph engine bake-off

Self-contained proof-of-concept for **Wave 3 decision evidence**. It renders the
FlowRunner flow model with [React Flow](https://reactflow.dev)
(`@xyflow/react`) via Vite. **This is not shipped code** and is intentionally
isolated from the app: its own `package.json`, its own `node_modules`, no entry
in the root `package.json` and no import from any app module.

> Conclusion and scored recommendation live in **[`docs/engine-decision.md`](../../docs/engine-decision.md)**.

## Run it

```bash
cd spikes/react-flow
npm install
npm run dev       # http://localhost:5173 — live spike
npm run build     # produces dist/ (the CSP-relevant artifact)
npm run analyze   # bundle sizes + CSP-primitive scan of the built JS
```

## What it proves

| File | Evidence it produces |
|---|---|
| `src/flowModelAdapter.js` | The tree→graph mapping. Consumes the frozen `.flow.json` fields (`type`, `then`/`else`/`steps`, `conditionData`, `loopVariable`/`source`, `onFailure`) and both the on-disk and in-memory branch shapes. This is the real migration cost of the model mapping. |
| `src/FlowStepNode.jsx` | Custom-node ergonomics — a typed React component with real event handlers and token-driven CSS, replacing Drawflow's `innerHTML` string templating. |
| `src/ReactFlowVisualizer.jsx` | The **contract shim**: all 13 methods + 7 callbacks of `docs/visualizer-contract.md` implemented over React Flow. |
| `src/createVisualizerFacade.js` | A plain-JS facade whose public shape is byte-for-byte the Drawflow `FlowVisualizer`. The app-side seam changes by **one import line**; the app never imports React. |
| `vite.config.js` (`base:''`) + `dist/index.html` | The CSP artifact: the built HTML references a single **relative same-origin** `./assets/index.js` — no inline scripts, no CDN, so `script-src 'self'` is satisfied. |
| `analyze-bundle.js` | Measured bundle size (~381 kB raw / ~122 kB gzip JS) and a scan proving **zero** `eval`/`new Function`/`blob:`/`importScripts`/`new Worker` in the output. |

## Verified

`npm run build` + serving `dist/` under the app's exact CSP
(`script-src 'self'`) renders all 6 nodes (request/condition/loop/transform),
branch edges, minimap and zoom controls, with **zero console errors**. Screenshot
evidence and numbers are in the decision doc.
