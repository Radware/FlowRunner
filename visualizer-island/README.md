# visualizer-island

A self-contained **Vite + React** app that renders the FlowRunner flow model with
[React Flow](https://reactflow.dev/) (`@xyflow/react`). It is the **flag-gated,
off-by-default** alternative to the shipped Drawflow engine (`../flowVisualizer.js`),
per [`../docs/engine-decision.md`](../docs/engine-decision.md).

The renderer shell (the FlowRunner app) is vanilla ES modules with **no bundler**
and a strict CSP (`script-src 'self'`). React cannot live in the shell directly, so
it is compiled into an **island**: a single same-origin IIFE bundle the app loads at
runtime.

## How it fits together

```
app.js  ── new ReactFlowVisualizer(mount, options)   (only when the flag is set)
              │  (../reactFlowVisualizer.js — plain-JS facade, NO React import)
              ▼
        loads <script src="assets/visualizer-island/island.js">   (same-origin)
              │
              ▼
        window.FlowRunnerReactIsland.createReactFlowVisualizer(mount, options)
              │  (src/islandEntry.jsx)
              ▼
        React root → ReactFlowVisualizer.jsx → @xyflow/react
```

The facade honors the **entire** `FlowVisualizer` contract
([`../docs/visualizer-contract.md`](../docs/visualizer-contract.md)) so the app
constructs it identically to Drawflow.

## Build

```
npm install      # island's own deps (react, react-dom, @xyflow/react, vite)
npm run build    # → ../assets/visualizer-island/island.js + island.css
```

From the repo root this is wired as `npm run build:island`, and runs automatically
via the `prebuild`/`predist`/`prepack` hooks before `npm run dist`.

## Why IIFE / `base:''`

`vite.config.js` builds in **lib/IIFE mode** with `base:''` and
`inlineDynamicImports`, so the whole island is **one same-origin script** with **no
inline scripts, no dynamic `import()`, no `eval`/`blob:`/`Worker`** — the CSP
feasibility the wave2 spike proved. React Flow's stylesheet is emitted as a linked
`island.css` (loaded by the facade), satisfying `style-src`.

## Enabling the engine

Off by default. To opt in (dev/dogfooding):

```js
localStorage.setItem('flowrunner.visualizerEngine', 'react');   // then reload
localStorage.removeItem('flowrunner.visualizerEngine');         // back to Drawflow
```

## Do NOT

- Import anything under `src/**` from the renderer shell or from Jest tests — it's
  JSX/React and only ever runs *inside the built bundle*. The app touches this code
  exclusively through the plain-JS facade.
- Delete or rewrite `../flowVisualizer.js` — Drawflow stays the default engine.
