# Auto-layout spike — elkjs under packaged Electron CSP

**Lane:** `layout-s` (Wave 1 foundation). **Status:** de-risked, adapter landed.
**Wires into UI in:** Wave 2 ("Tidy Up" button on the flow map).

## Question

Can we run automatic graph layout (elkjs) inside FlowRunner's packaged renderer,
whose Content-Security-Policy is effectively `script-src 'self'` with **no CDN
and no `worker-src`** directive? And what's the fallback if not?

## The CSP constraint (measured, not assumed)

`index.html` ships:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: assets:; connect-src 'self' http: https:;
```

There is **no `worker-src` and no `child-src`** directive. Per the CSP spec,
`worker-src` falls back to `child-src`, which falls back to **`script-src`**.
So workers are governed by `script-src 'self'`. Concretely:

- A **classic Web Worker from a same-origin file URL** (packaged app origin is
  `file://` / `app://`) is allowed.
- A **Worker created from a `blob:` URL** is **blocked** — `blob:` is not in
  `script-src`. Many bundlers ship ELK by inlining the worker as a Blob; that
  approach would be dead-on-arrival here without loosening CSP.

The renderer also runs with `contextIsolation: true`, `nodeIntegration: false`
(main.js), so `require('web-worker')` and Node's `worker_threads` are **not**
available in the renderer — the Node worker path is irrelevant for us.

## Finding: elkjs' bundled build runs main-thread, no Blob, no external worker

`elkjs` ships several entry points under `node_modules/elkjs/lib/`:

| Entry | What it does | CSP verdict |
|---|---|---|
| `main.js` | Node build; tries `require('web-worker')` / worker_threads. | N/A in renderer (no Node integration). |
| `elk.bundled.js` | ELK + worker **inlined**; when constructed with **no `workerUrl`**, installs a **synchronous "fake worker"** (a plain dispatcher object, `setTimeout`-scheduled). | ✅ Works. No `Worker`, no `Blob`, no `importScripts` — nothing CSP cares about. |
| `elk-api.js` + `elk-worker.min.js` | Real worker path: you pass `workerUrl` pointing at a bundled `elk-worker.min.js`, or your own `workerFactory`. | ✅ *If* the worker is loaded from a same-origin **file**, not a `blob:`. |

Proof in the vendored source (`lib/elk-worker.min.js`, minified):

```js
function j(b){var c=this;this.dispatcher=new h({postMessage:function(a){c.onmessage({data:a})}});
  this.postMessage=function(a){setTimeout(function(){c.dispatcher.saveDispatch({data:a})},0)}}
... module.exports={'default':j,Worker:j}
```

`j` is a fake worker: it holds a dispatcher and routes `postMessage` back to
`onmessage` via `setTimeout`. `elk.bundled.js`, when given no `workerUrl`, uses
exactly this. So `new ELK().layout(graph)` executes ELK's layered algorithm **on
the main thread**, returns a Promise, and touches **none** of the primitives CSP
restricts.

Verified empirically in this repo (Node + Jest, jsdom):

```
import ELK from 'elkjs/lib/elk.bundled.js';
const elk = new ELK();
await elk.layout({ id:'root', layoutOptions:{'elk.algorithm':'layered'},
  children:[{id:'a',width:30,height:30},{id:'b',width:30,height:30}],
  edges:[{id:'e1',sources:['a'],targets:['b']}] });
// -> [{id:'a',x:12,y:12},{id:'b',x:62,y:12}]
```

The 21 `__tests__/autoLayout.test.js` cases exercise this path green.

## Decision

**Ship `elkjs/lib/elk.bundled.js` and run it on the main thread (no Web Worker).**

Rationale:
- It is the only path that is unconditionally CSP-safe under `script-src 'self'`
  with no `worker-src` and no Node integration.
- No CSP relaxation required — we do **not** want to add `blob:` or `worker-src`
  to the policy just for layout (widens the app's attack surface).
- Flow graphs in FlowRunner are small (tens of nodes, not thousands). ELK
  layered on the main thread completes in single-digit milliseconds for these
  sizes in testing — a background worker buys nothing and would need a
  same-origin worker file plumbed through electron-builder.

### If we ever DO want a real worker (future, not now)

Two CSP-clean options, in preference order:

1. **Same-origin worker file.** Vendor `elk-worker.min.js` next to the app,
   construct `new ELK({ workerUrl: 'elk-worker.min.js' })` so the browser loads
   the worker from a `file://`/`app://` URL (allowed by `script-src 'self'`).
   Must add the worker file to `build.files`.
2. **Custom `workerFactory`** returning a `new Worker(<same-origin url>)`. Same
   constraint: the URL must be same-origin, never a `blob:`.

Neither is needed for Wave 2. Revisit only if profiling shows main-thread layout
janking the UI on very large flows.

## Bundling implications

- **App-imported deps must be in `package.json` `build.files`** (the project's
  #1 rule). This lane adds `elkjs` and `@dagrejs/dagre` as **`dependencies`**.
  electron-builder packages `node_modules` production deps automatically, so the
  library code ships. `build.files` governs our own top-level files; `autoLayout.js`
  is added to `build.files` now so the module is present once Wave 2 imports it.
- Use the **`elk.bundled.js`** entry explicitly (`import ELK from
  'elkjs/lib/elk.bundled.js'`), **not** `elkjs` (which resolves to `main.js` and
  its Node worker path).
- No CSP edits required. Do not add `blob:`/`worker-src`.

## Fallback engine: @dagrejs/dagre

`autoLayout.js` uses ELK as primary and **`@dagrejs/dagre`** as a fallback: if
ELK import/layout throws for any reason, or the caller passes `engine: 'dagre'`,
the adapter computes positions with dagre instead. Dagre is pure-JS,
synchronous, main-thread, and equally CSP-clean. It reports node **centers**
(the adapter converts to top-left). The public result reports which engine
actually produced the layout (`{ engine: 'elk' | 'dagre' }`).

## Adapter contract (delivered)

`autoLayout.js` — engine-agnostic, no dependency on `flowVisualizer.js`:

```
computeLayout(steps, {
  engine = 'elk',            // 'elk' | 'dagre'; falls back to the other on failure
  nodeSizes,                 // optional { [stepId]: { width, height } }
  direction = 'DOWN',        // 'DOWN' | 'UP' | 'RIGHT' | 'LEFT'
}) -> Promise<{ positions: { [stepId]: { x, y } }, engine }>
```

- **Input:** the flow step tree, respecting then/else/loop nesting. Accepts
  **both** the in-memory model shape (`thenSteps`/`elseSteps`/`loopSteps`) and
  the on-disk `.flow.json` shape (`then`/`else`/`steps`).
- **Output:** flat `{ stepId: { x, y } }`, top-left coordinates,
  origin-normalised (min x/y == 0), one entry per step including nested ones.
- **Layout:** ELK `layered` + `hierarchyHandling: INCLUDE_CHILDREN` +
  `edgeRouting: ORTHOGONAL`. Dagre uses a compound graph for nesting.
- **Deterministic:** nodes/edges are fed in stable document order with fixed
  spacing, so identical input yields identical output across runs (asserted in
  the test suite for both engines).

## Wave 2 handoff notes

- Call `computeLayout(flowModel.steps, { nodeSizes })` where `nodeSizes` comes
  from the rendered node bounding boxes (so layout respects real card sizes).
- Apply the returned `positions` to the visualizer nodes; ELK/dagre both assume
  a single flow direction — FlowRunner's map is top-to-bottom, so default
  `direction: 'DOWN'`.
- When wiring the import into `flowVisualizer.js`, confirm `autoLayout.js` is in
  `build.files` (it is) and that a packaged build still lays out (smoke test the
  "Tidy Up" button in a `npm run dist` build, per gotcha #1).
