# FlowVisualizer Contract

This document defines the **exact boundary** between the FlowRunner app (renderer
modules) and the node-graph rendering component (`flowVisualizer.js`, currently a
Drawflow adapter). It exists so the graph engine can later be swapped — for a
different library, a canvas renderer, a WebComponent, etc. — **without touching the
rest of the app**, as long as the replacement honors this contract.

The app never reaches into the visualizer's internals. It only:

1. Constructs it with `new FlowVisualizer(mountPoint, options)`.
2. Calls the **public methods** listed below.
3. Receives callbacks through the `options` object.

Anything not listed here (methods prefixed `_`, instance fields, DOM structure,
CSS class names, the `editor` handle, minimap internals) is **implementation
detail** and is NOT part of the contract. A replacement engine may implement those
however it likes.

The conformance test `__tests__/visualizerContract.test.js` asserts the real
`FlowVisualizer` exposes every method in the "Public methods" table as a function,
and exercises a fake double that implements this same contract. If you add or
remove a call into the visualizer instance anywhere in the app, update BOTH this
file and that test.

> Source of truth: every call site was found by grepping `visualizerComponent`
> (including optional-chaining `?.` calls) across the renderer modules. The
> owning field is `appState.visualizerComponent`, assigned in
> `app.js` → `initializeVisualizer()` (~line 261).

---

## Construction

```js
appState.visualizerComponent = new FlowVisualizer(mountPoint, options);
```

- **`mountPoint`** (`HTMLElement`, required) — the DOM element the graph mounts
  into. Constructing with a falsy mount point MUST throw. The visualizer owns the
  contents of this element (it may clear/replace `innerHTML`).
- **`options`** (`object`, optional) — the callbacks below. Every callback is
  **optional**; the visualizer MUST tolerate any of them being absent (the app
  currently passes a subset — see "Options callbacks").

The app treats the instance as **nullable** at every call site: it either guards
with `if (appState.visualizerComponent)` / `?.`, or is only reachable after
`initializeVisualizer()` ran. A replacement must be safe to leave un-constructed
(the app simply skips visualizer work when the field is null).

---

## Public methods

The app depends on exactly these methods. Each row lists the call sites so a future
change can find them.

| Method | Signature | App expects | Call sites |
|---|---|---|---|
| `render` | `render(flowModel, selectedStepId)` | (Re)draws the whole graph from the flow model, marking `selectedStepId` as selected. Called on every flow (re)render. | `uiUtils.js:252` |
| `getAutoLayout` | `getAutoLayout() → { [stepId]: {x, y} }` | Returns a computed auto-layout map keyed by step id (empty object when no steps). The app writes it to `flowModel.visualLayout`. Called via `?.` with `|| {}` fallback. | `eventHandlers.js:216` |
| `focusNode` | `focusNode(stepId)` | Scrolls/pans the viewport so the given node is centered. Return value is ignored by the app. Called via `?.`. | `eventHandlers.js:231`, `flowBuilderComponent.js:529` |
| `highlightNode` | `highlightNode(stepId, highlightType)` | Highlights one node with a status style. `highlightType` values the app passes: `'active-step'`, `'error'`, `'stopped'` (plus the default when omitted). Used to show live run status. | `runnerInterface.js:345,366,415,444,463` |
| `clearHighlights` | `clearHighlights()` | Clears run-status highlighting from all nodes/connections. The app sometimes passes a string argument (`'active-step'` at `runnerInterface.js:298`) — the argument MUST be safely ignorable; the app relies only on "highlights cleared". | `runnerInterface.js:235,298,421` |
| `updateNodeRuntimeInfo` | `updateNodeRuntimeInfo(stepId, result)` | Displays per-node runtime detail (status/duration/etc.) from an execution `result` object on the given node. | `runnerInterface.js:370` |
| `showMinimap` | `showMinimap()` | Shows the minimap/overview. | `eventHandlers.js:282`, `uiUtils.js:659` |
| `hideMinimap` | `hideMinimap()` | Hides the minimap/overview. | `eventHandlers.js:284`, `uiUtils.js:652` |
| `isMinimapVisible` | `isMinimapVisible() → boolean` | Reports current minimap visibility; the app toggles based on it. | `eventHandlers.js:280` |
| `zoomIn` | `zoomIn()` | Zooms the graph in one step (toolbar button). | `eventHandlers.js:63` |
| `zoomOut` | `zoomOut()` | Zooms the graph out one step (toolbar button). | `eventHandlers.js:64` |
| `resetZoom` | `resetZoom()` | Resets zoom to the default level (toolbar button). | `eventHandlers.js:65` |
| `destroy` | `destroy()` | Tears down all listeners/DOM the visualizer created; safe to call before re-init. The app guards with `typeof … === 'function'` before calling. | `uiUtils.js:486` |

### Notes on the contract's tolerances

- **`clearHighlights` arity.** The real implementation takes no parameters, but the
  app calls it with `'active-step'` in one place. A replacement MUST accept (and may
  ignore) an optional argument. The app does **not** rely on selective clearing —
  it treats every `clearHighlights` call as "clear everything".
- **Return values.** Only `getAutoLayout` (map) and `isMinimapVisible` (boolean)
  have return values the app reads. All other methods are called for side effects;
  their return values are ignored (`focusNode` returns a boolean internally, unused).
- **Idempotency / null-safety.** `highlightNode`, `updateNodeRuntimeInfo`, and
  `focusNode` may be called with a `stepId` that isn't currently rendered; they MUST
  no-op rather than throw.

---

## Options callbacks

Passed in the `options` object at construction. The app currently wires these seven
in `app.js` → `initializeVisualizer()`. The visualizer invokes them (via optional
chaining internally) in response to user interaction with the graph.

| Callback | Signature | Fired when |
|---|---|---|
| `onNodeSelect` | `(stepId)` | A node is selected/clicked in the graph. |
| `onNodeLayoutUpdate` | `(layoutInfo)` | A node is moved/dropped (position changed). |
| `onConnectionUpdate` | `(connectionInfo)` | A connection between nodes is created/removed/edited. |
| `onDeleteStep` | `(stepId)` | Delete is requested from a node (app maps to a delete update). |
| `onStepEdit` | `(…)` | The in-graph node editor modal is saved. |
| `onEditorDirtyChange` | `(dirty)` | The in-graph node editor's dirty state changes. |
| `onRequestAddStepAfter` | `(…)` | "Add step after" is requested from a node. |

All callbacks are **optional**. A replacement engine that doesn't support in-graph
editing simply never fires `onStepEdit` / `onEditorDirtyChange` / `onRequestAddStepAfter`;
the app tolerates that. Conversely, an engine MUST NOT require any callback to be
present — the visualizer's own test double constructs it with a subset.

> `flowVisualizer.js` internally also references `options.onAddStep` / `onCloneStep`
> as future hooks; the app does **not** pass them today, so they are NOT part of the
> depended-upon contract. Listed here only to prevent confusion when reading source.

---

## What is explicitly OUT of contract

To keep the seam swappable, the app must NOT depend on (and a replacement is free to
omit or change) any of:

- The `editor` field or any Drawflow-specific object/handle.
- Instance fields (`nodes`, `connections`, `minimapContainer`, `zoomLevel`, …).
- Private `_`-prefixed methods and `FlowVisualizer.prototype.__forceMinimapRefresh`
  (a test-only helper).
- DOM structure, generated markup, or CSS class names inside the mount point.
- `setZoom`, `zoomTo`, `toggleMinimap` — present on the current class but **not**
  called by the app, hence not contract. (The app toggles via
  `isMinimapVisible` + `showMinimap`/`hideMinimap`.)

If a future change needs one of these, promote it into the "Public methods" table
first (and add it to the conformance test), rather than reaching around the seam.
