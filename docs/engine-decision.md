# Node-graph engine decision — bake-off report

**Lane:** `engine-spikes` (Sprint Wave 2, evidence-only — does **not** merge to the
sprint branch). **Author:** Wave 2 engine-spikes lane. **Date:** 2026-07-01.

## TL;DR

Replace the vendored, unmaintained Drawflow with a **React Flow island**
(`@xyflow/react` built by Vite) mounted at `#flow-visualizer-mount`, behind the
existing `FlowVisualizer` contract. A working proof-of-concept in
[`spikes/react-flow/`](../spikes/react-flow/) demonstrates the full
`docs/visualizer-contract.md` surface (13 methods + 7 callbacks), renders the real
nested flow model, and — critically — **builds to a bundle that loads under the
app's exact `script-src 'self'` CSP with no inline scripts, no CDN, and no
`eval`/`blob:`/`Worker`**.

Recommended, but with eyes open: it adds a **Vite/React build step** to a repo that
today ships un-bundled ES modules, and a **~122 kB gzip** runtime chunk. Both are
acceptable for a desktop Electron app and are contained entirely inside the island.

**Scores (0–5, higher better; weighted):**

| Option | CSP fit | Custom nodes | Subflow/minimap | Migration cost | Maintenance | Bundle | **Weighted** |
|---|---|---|---|---|---|---|---|
| **React Flow island** | 5 | 5 | 4 | 4 | 5 | 3 | **★ 4.4** |
| Svelte Flow island | 5 | 5 | 4 | 3 | 5 | 4 | 4.2 |
| Harden Drawflow | 4 | 2 | 3 | 5 | 1 | 5 | 3.1 |

Weights: CSP 0.25, custom nodes 0.15, subflow/minimap 0.10, migration 0.20,
maintenance 0.20, bundle 0.10. React Flow wins on the strength of an *actually
built and run* POC plus a first-party, actively maintained codebase; Svelte Flow is
a close, smaller-bundle alternative that loses on toolchain novelty for this team.

---

## Why we're doing this at all

`flowVisualizer.js` is a ~1,370-line adapter over **Drawflow**, vendored as a
global-script include:

- `assets/vendor/drawflow/drawflow.min.js` (48 kB), loaded via `<script>` in
  `index.html` and consumed as `globalThis.Drawflow`.
- Vendored version **0.0.60**; upstream's last npm publish was **2024-09-03** and it
  has never left `0.0.x`. It is effectively unmaintained and pre-1.0.
- Nodes are built by **`innerHTML` string templating** (`_getNodeHtml`), then
  re-decorated by querying the generated DOM and attaching listeners — brittle, and
  the reason a large fraction of `flowVisualizer.js` exists.

The Wave-1 foundation already de-risks the hard part around it: `autoLayout.js`
(ELK/dagre, main-thread, CSP-clean) computes positions independent of the engine,
and `docs/visualizer-contract.md` defines a clean swap seam. The engine itself is
the last coupled, unmaintained dependency in the flow map.

## The decisive constraint: CSP under packaged Electron

The packaged app ships (from `index.html:11`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: assets:; connect-src 'self' http: https:;
```

`script-src 'self'` with **no** `'unsafe-inline'`, **no** `'unsafe-eval'`, **no**
CDN. Any candidate must load as same-origin files with no inline `<script>` and no
runtime code generation. This is exactly where a naively-bundled SPA dies.

### Measured result (not assumed)

The POC's production build (`npm run build`) emits `dist/index.html` containing a
single script reference:

```html
<script type="module" crossorigin src="./assets/index.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index.css">
```

- **Relative, same-origin path** (`./assets/…`) thanks to `base:''` in
  `vite.config.js` → satisfies `script-src 'self'` on a `file://`/`app://` origin.
- **Zero inline scripts** in the built HTML (verified by grep).
- **Zero CDN/remote `src`** references.
- `analyze-bundle.js` scan of the built JS: **0** occurrences of `eval(`,
  `new Function`, `blob:`, `importScripts`, `new Worker`, `document.write`.

Serving `dist/` under the app's **exact** CSP meta tag and loading it in a browser
rendered all 6 nodes, branch edges, minimap, and zoom controls with **zero console
errors**. React Flow's own styles are emitted as a linked `.css` file (fully
`style-src 'self'` compliant); its per-element viewport transforms use inline
`style` attributes, already covered by the app's existing `style-src 'unsafe-inline'`.

> **Two build-time caveats for the real integration:**
> 1. `crossorigin` on the emitted tags is harmless on `file://` but pointless; set
>    `build.modulePreload` / a small transform to drop it if a stricter reviewer
>    objects. It does **not** violate CSP.
> 2. `vite dev` injects an inline HMR script + a websocket — those *would* trip a
>    strict CSP, which is why the CSP judgement rests on the **built** `dist/`, not
>    the dev server. The app only ever ships the built bundle.

**Verdict: CSP feasibility is proven, not hypothetical.** This was the single
biggest risk and it is retired.

## Bundle size (measured)

`npm run build` on the POC:

| Artifact | Raw | Gzip |
|---|---|---|
| `index.js` | 380.8 kB | 122.4 kB |
| `index.css` | 17.6 kB | 3.2 kB |
| **Total** | **~398 kB** | **~126 kB** |

Of the JS, roughly 45 kB gzip is React + React-DOM; the rest is
`@xyflow/react` + `@xyflow/system`. For a desktop app already shipping an Electron
runtime this is negligible on disk and parses in a few ms. It is **larger** than
Drawflow's 48 kB min (~14 kB gzip), which is the honest cost of the trade.

## Custom-node ergonomics

Drawflow: an `innerHTML` HTML string per node, then `querySelector` + manual
`addEventListener` re-wiring after insertion (`_decorateNodeElement`).

React Flow: a real component (`FlowStepNode.jsx`) with typed props, JSX, event
handlers bound declaratively, `<Handle>` elements for typed source/target ports, and
token-driven CSS. The POC reproduces the app's node (icon, name, delete action,
type-specific content line, runtime-details slot) in ~90 lines with no DOM
re-querying. This is a clear, large ergonomic win and removes the most fragile part
of `flowVisualizer.js`.

## Subflow / minimap / native features

- **Minimap:** first-party `<MiniMap>` component (`showMinimap`/`hideMinimap`/
  `isMinimapVisible` map directly). The POC wires it; the current adapter hand-rolls
  a canvas minimap (~200 lines) that this deletes.
- **Zoom/pan/controls:** native `<Controls>` + `zoomIn`/`zoomOut`/`fitView` instance
  methods map 1:1 onto the contract's zoom methods.
- **Subflows:** React Flow has first-class **parent/child nodes** (`parentId` +
  `extent:'parent'`), which is a materially better substrate for the condition/loop
  nesting FlowRunner models than Drawflow's flat node list + hand-drawn role edges.
  The POC uses role-coloured edges (matching today's behaviour) but the parent-node
  path is available for a future "collapse subflow" UX.

## Migration cost vs. the contract

The POC implements the **entire** `docs/visualizer-contract.md`:

- **13 methods** (`render`, `getAutoLayout`, `focusNode`, `highlightNode`,
  `clearHighlights`, `updateNodeRuntimeInfo`, `showMinimap`, `hideMinimap`,
  `isMinimapVisible`, `zoomIn`, `zoomOut`, `resetZoom`, `destroy`) —
  `ReactFlowVisualizer.jsx`.
- **7 callbacks** (`onNodeSelect`, `onNodeLayoutUpdate`, `onConnectionUpdate`,
  `onDeleteStep`, `onStepEdit`, `onEditorDirtyChange`, `onRequestAddStepAfter`) —
  wired or stubbed with the contract's "all optional" tolerance.
- Contract tolerances honoured: `clearHighlights` accepts-and-ignores an arg;
  `getAutoLayout` returns `{}` fallback; `focusNode`/`highlightNode`/
  `updateNodeRuntimeInfo` no-op on unknown `stepId`; the facade is `new`-able,
  throws on a falsy mount, and every method is null-safe before React commits.

`createVisualizerFacade.js` is a **plain-JS facade** whose public shape is identical
to the Drawflow `FlowVisualizer`. **The app never imports React.** The renderer's
only change is one import line in `app.js` → `initializeVisualizer()`. Everything
else in the renderer is untouched because the seam is respected exactly — which is
precisely what the contract was written to enable.

Residual migration work (not in the POC, sized for planning):

- In-graph node **editor modal** (`onStepEdit`/`onEditorDirtyChange`) — the POC
  fires node/select/delete but does not port the full editor. This is the largest
  remaining chunk (~1–2 days), reusing `flowStepComponents.js` inside a React portal.
- `updateNodeRuntimeInfo` **rich rendering** (status/duration/error detail styling)
  to match today's node runtime panel.
- Wiring `autoLayout.js` output into `flowModel.visualLayout` and the "Tidy Up"
  button (the adapter already returns positions; just feed them as node positions).

## The alternatives, steelmanned

### Svelte Flow (`@xyflow/svelte`) — reasoned, POC-optional

Svelte Flow is the **same team, same core** as React Flow: both wrap
`@xyflow/system` (the actual graph engine), so CSP behaviour, minimap, subflows and
custom-node model are equivalent. Its wrapper is smaller (76 kB packed vs React
Flow's 244 kB) and **Svelte compiles the framework away**, so a Svelte-Flow island
would likely land meaningfully **below** the React island's 122 kB gzip (no
React-DOM ~45 kB). Same `base:''` Vite build → same CSP-clean output.

Why it's *second*, not first:

- **Toolchain novelty.** The team ships vanilla ES modules today; introducing *any*
  bundler is new. React is the more widely-known target for this team and has the
  larger contributor pool if the island grows. Svelte adds a compiler whose mental
  model is less common here.
- **No first-party POC run.** The CSP/bundle claims are inferred from the shared
  `@xyflow/system` core and Svelte's compile model, not measured as they were for
  React. That's exactly the kind of assumption this lane exists to avoid.

If bundle size becomes the deciding factor, Svelte Flow is the pick and warrants a
follow-up POC. It is a genuinely close second, not a strawman.

### Harden Drawflow — the "do less" baseline

Keep the vendored library and invest in it instead: fork/vendor at a pinned commit,
patch the specific bugs, wrap its `innerHTML` node creation behind a safer builder,
and add tests.

- **Pros:** zero new toolchain, smallest bundle (5), lowest immediate migration cost
  (5) — the adapter already works.
- **Cons that sink it:** we would be **adopting maintenance of a dead 0.0.x
  library** (maintenance score 1) — every future fix is ours forever, with no
  upstream. The `innerHTML` node model stays (custom-node score 2). Subflows remain
  hand-rolled. We'd be pouring effort into a foundation we've already decided to
  leave. Reasonable as a *stopgap* if Wave 3 has no capacity, but it does not solve
  the actual problem (an unmaintained core dependency).

---

## Recommendation & migration plan (React Flow island)

**Adopt the React Flow island scoped to `#flow-visualizer-mount`.** Concrete plan:

1. **Vendor the build, not the source.** Add `spikes/react-flow/` as the island's
   home (or promote to `visualizer-island/`). Build with Vite (`base:''`) to a fixed
   output dir; the app loads the built `assets/index.js` + `index.css` as
   same-origin files. **Add those built files to `package.json` `build.files`** (the
   project's #1 rule — packaged builds crash silently otherwise). The island's own
   `node_modules`/React never enter the app's dependency tree.
2. **Keep the seam.** Ship `createReactFlowVisualizer(mount, options)` as a
   `FlowVisualizer`-shaped facade (already built in
   `spikes/react-flow/src/createVisualizerFacade.js`). Change **one import** in
   `app.js` → `initializeVisualizer()`. No other renderer file changes.
3. **Port the model adapter** (`flowModelAdapter.js`) as-is — it already consumes the
   frozen `.flow.json` fields and both branch shapes.
4. **Port the node editor** into a React portal reusing `flowStepComponents.js`
   (`onStepEdit`/`onEditorDirtyChange`/`onRequestAddStepAfter`). Largest remaining
   task.
5. **Wire `autoLayout.js`** → feed `computeLayout()` positions as node positions;
   `getAutoLayout()` reads them back into `flowModel.visualLayout`.
6. **Contract conformance.** Run the existing `__tests__/visualizerContract.test.js`
   against the new facade (it asserts all 13 methods exist as functions); add a jsdom
   render smoke test.
7. **Packaged smoke test.** `npm run dist` and manually confirm the map renders,
   minimap toggles, and "Tidy Up" lays out — per gotcha #1, CSP/packaging bugs never
   show up in `npm start`.
8. **Drop Drawflow** (`assets/vendor/drawflow/`, the `<script>`/`<link>` in
   `index.html`) only after the island is green end-to-end.

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Build step is new to the repo | Island builds are self-contained; CI runs one `vite build`; app stays un-bundled elsewhere. |
| `crossorigin` attr on emitted tags | Cosmetic on `file://`; strip via a tiny post-build transform if a reviewer objects. Does not violate CSP. |
| Bundle +108 kB gzip vs Drawflow | Acceptable for desktop Electron; revisit Svelte Flow if it ever matters. |
| Node editor port is non-trivial | Reuse `flowStepComponents.js` in a portal; sized at ~1–2 days above. |
| React version churn | Pin React + `@xyflow/react`; island is isolated so upgrades can't break the app. |

## Evidence index

- POC: [`spikes/react-flow/`](../spikes/react-flow/) (own `package.json`, not in root).
- CSP proof: built `dist/index.html` (relative same-origin script, no inline) +
  `analyze-bundle.js` scan (0 CSP-hostile primitives) + strict-CSP browser run with
  0 console errors.
- Bundle numbers: `npm run build` output (381 kB / 122 kB gzip JS).
- Contract coverage: `ReactFlowVisualizer.jsx` (13 methods) +
  `createVisualizerFacade.js` (facade) + `src/main.jsx` (drives every method).
- Maintenance facts: Drawflow last publish 2024-09-03 (v0.0.60); `@xyflow/*` last
  publish 2026-06-22.
