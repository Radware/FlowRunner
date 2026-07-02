# FlowRunner UI — Roadmap + UX Overhaul Sprint Plan

> **▶ Current status + what's done/not-done + how to resume: [sprint-status.md](sprint-status.md).** (This file is the plan; that one is the live state.)

> A long-lived sprint branch we live on until the roadmap + UI overhaul is fully done and verified. This plan sequences the [evolution proposal](flowmap-evolution.md) into **parallel waves** designed to be executed by maxed-out multi-agent workflows. The real limiter on parallelism is **file contention**, not item count — that analysis is the spine of this document.

## Baseline — the sprint starts from a clean, verified `main`

Already landed this cycle (do **not** re-do):
- **Graceful degradation** — unknown step type / transform op skip-with-warning, JS ([PR #81](https://github.com/Radware/FlowRunner/pull/81)) + CLI ([flowrunner-cli #35](https://github.com/rdwr-taly/flowrunner-cli/pull/35)). *(schema-evo P1 — DONE)*
- **Schema/serializer drift fixed** (`then/else/steps`), **cross-app contract documented** (bible), **sibling bugs fixed** (CLI base64, portal `visualLayout`).
- **CI**: NSIS installer, `paths-ignore`, `pull_request`/`workflow_dispatch` build-without-publish (verified), **`npm test` harness repaired** (122+ passing).

**Prerequisite to open the sprint branch:** merge PR #81 + the flowVisualizer test-green fix to `main`, then `git checkout -b sprint/roadmap-ux-overhaul` off `main`.

## Operating model

1. **One long-lived branch** `sprint/roadmap-ux-overhaul`. Feature work happens in **per-lane git worktrees** off it, merged back at each wave's integration gate.
2. **Waves.** Each wave = one `Workflow` whose `parallel()` lanes each run in `isolation: 'worktree'` (they edit files concurrently, so isolation prevents conflicts), followed by a **verify stage per lane** (run that lane's tests) and an **integration stage** (merge green lanes into the sprint branch), then an **adversarial review**.
3. **Verify gate between waves** (non-negotiable, "until fully done and verified"): `npm test` green + `npm run e2e` + a **packaged build** via `gh workflow run "FlowRunner Build" --ref sprint/roadmap-ux-overhaul` → `gh run download` → smoke-test the real installers. Only then start the next wave.
4. **Parallelism is bounded by file ownership** (see §"File-contention map"). Two lanes that write the same file are NOT parallel — they're either serialized or merged into one lane with one owner.

## Dependency graph (what gates what)

```
Wave 0 (baseline, done) ── fork sprint branch
        │
        ▼
Wave 1  FOUNDATIONS (5 fully-independent lanes, max parallel)
  ├─ node P0  FlowVisualizer contract-as-tested-port ─────────────┐
  ├─ ux P1    OKLCH tokens + projector theme ──────────┐          │
  ├─ file P0  workspace/sidecar + electron-store ──┐   │          │
  ├─ layout S elkjs-under-CSP spike + adapter seam ─┼───┼──┐       │
  └─ schema D schemaVersion spec + fixtures + xrepo ┘   │  │       │
        │                                               │  │       │
        ▼                                               ▼  ▼       ▼
Wave 2  BUILD ON FOUNDATIONS
  ├─ layout P1+P4  elkjs "Tidy Up"  (needs layout S) ──── owns flowVisualizer.js
  ├─ node P3       engine spikes    (needs node P0) ───── isolated spikes, no main code
  ├─ ux P2         inline inspector (needs ux P1) ─────── owns flowStepComponents editor
  ├─ node P1       search palette / on-node errors / JSON view (canvas-agnostic)
  ├─ file P1       Fuse search / Cmd+K / groups / undo (needs file P0)
  └─ feat A        retries+backoff / cURL+HAR import (self-contained)
        │
        ▼
Wave 3  DECISIONS + INTEGRATION
  ├─ ENGINE DECISION  React Flow island vs spike winner (needs node P3 evidence) ── owns flowVisualizer.js
  ├─ assertions       per-step assertions + test summary (needs schema D + CLI sign-off)
  ├─ ux P3            Demo mode + guided first-run (needs ux P2)
  └─ schema P3        schemaVersion + CLI version-gate (needs schema D + CLI commitment)
        │
        ▼
Wave 4  COORDINATED / FORMAT-TOUCHING (gated, cross-repo)
  ├─ subflows         (needs ENGINE + deployed CLI resolution + conformance fixture)
  ├─ environments     env vars / secrets (cross-app)
  ├─ canonical schema ajv + jsonschema across 3 repos + shared fixtures
  └─ node P4          visual language (needs ENGINE + ux P1 tokens)
```

## Waves in detail

### Wave 1 — Foundations (target: 5 concurrent lanes)
Each is dependency-free and touches a **disjoint** file set, so all five run in parallel worktrees.

| Lane | Work | Owns (files) | Unblocks |
|---|---|---|---|
| **node P0** | Formalize the FlowVisualizer↔app seam (5 methods + 1 options object at `app.js:261`) as a tested Jest fake/port | new test double; thin seam notes | engine spikes + swap |
| **ux P1** | OKLCH two-tier token layer (`--surface/--text/--accent/--run-*`) + projector-first light-default theme; delete gradient wordmark | `styles.css` (new token layer), `index.html` theme hook | all UX lanes |
| **file P0** | `electron-store` recent-files (real gap: none today) + sidecar workspace model (`.flowrunner/workspace.json` for folders/tags — keeps `.flow.json` byte-clean) | new `workspace*.js`, `fileOperations.js`, `main.js`/`preload.js` IPC | file features |
| **layout S** | Spike: does `elkjs` Web Worker instantiate under packaged CSP (`script-src 'self'`)? Build the `graph-in / {id→{x,y}}-out` adapter seam; `@dagrejs/dagre` fallback | new `autoLayout*.js` | Tidy Up |
| **schema D** | `schemaVersion` spec (string, absence⇒"1.0"); harden tolerant readers (done for exec — extend to `evaluatePath`/operators); minimal in-repo conformance fixtures; cross-repo rollout doc | `schemas/`, new `__tests__/fixtures/` | schemaVersion rollout |

### Wave 2 — Build on foundations
| Lane | Needs | Owns | Notes |
|---|---|---|---|
| **layout P1+P4** | layout S | `flowVisualizer.js` | elkjs "Tidy Up" welded to its UX contract (preserve manual positions, tidy-selection vs all, ~200ms ease-out, one-key undo). **Sole owner of `flowVisualizer.js` this wave.** |
| **node P3 spikes** | node P0 | isolated spike dirs | Svelte Flow + Rete-vanilla + "stay on Drawflow" null hypothesis, scored in a **packaged** build. No `main` code changes → freely parallel. |
| **ux P2** | ux P1 | `flowStepComponents.js` (editor), inspector CSS | Persistent inline inspector replacing the `document.body` dbl-click modal + Basic/Power disclosure. |
| **node P1 features** | (canvas-agnostic) | overlays, `runnerInterface.js` | Node-search palette, on-node error badges + jump-to-failed (reuse existing per-step results), View/Edit-as-JSON **read-only**. *Coordinate the on-canvas bits with layout P1+P4 (both eye `flowVisualizer.js`) — keep this lane to overlays or serialize after.* |
| **file P1** | file P0 | `uiUtils.js` list, sidebar | Fuse.js search + Cmd+K; canvas Groups (`visualLayout._groups`, opaque); immer undo/redo. |
| **feat A** | — | `flowRunner.js` | Retries/backoff (self-contained in engine); cURL/HAR import (new module, mirrors export). |

### Wave 3 — Decisions + integration
| Lane | Needs | Owns |
|---|---|---|
| **ENGINE decision** | node P3 evidence | `flowVisualizer.js` (rewrite as React-Flow island via Vite, or the spike winner) — the big one; **exclusive owner** |
| **assertions** | schema D + CLI sign-off | `flowRunner.js`/`executionHelpers.js` (reuse `evaluateCondition`), `flowCore.js` encoding |
| **ux P3** | ux P2 | first-run/empty-states, Demo mode chrome |
| **schema P3** | schema D + CLI commitment | `schemas/`, readers in JS (+ sibling repos) |

### Wave 4 — Coordinated / format-touching (cross-repo gated)
Subflows (pointer ref, gated on **deployed** CLI resolution + shared conformance fixture + sign-off), environments/secrets, one canonical schema validated by `ajv`+`jsonschema` across all three repos, node P4 visual language (glyph-chip step types on the new engine). These require sibling-repo PRs and are deliberately last.

## File-contention map (the real parallelism limiter)

| Hot file | Wanted by | Rule |
|---|---|---|
| `flowVisualizer.js` | node P0, layout P1, node P1 (canvas bits), ENGINE, node P4 | **One owner per wave.** W1: node P0 (read-mostly). W2: layout P1. W3: ENGINE (rewrite). Never two at once. |
| `styles.css` | ux P1, ux P2, ux P5 | ux P1 lands the token layer first (W1); later UX lanes only *consume* tokens + add scoped component CSS. |
| `flowStepComponents.js` | ux P2 (inspector), assertions editor, transform editor | ux P2 owns it W2; assertions edits sequence after in W3. |
| `flowRunner.js` | feat A (retries), assertions | feat A (W2) and assertions (W3) are in different waves → no clash. |
| `flowCore.js` | schema D, assertions encoding, subflows | schema D defines the shape first; consumers follow. |
| `fileOperations.js`/`main.js`/`preload.js` | file P0 | single lane owns the file+IPC surface. |
| **new files** (autoLayout, workspace, React island, fixtures, import) | their lane only | **low contention — favor new modules to widen parallelism.** |

**Takeaway:** ~5-6 lanes run truly parallel per wave *if* each owns a disjoint file set. The moment two lanes want `flowVisualizer.js` or `styles.css`, they serialize. So the plan front-loads the **token layer (ux P1)** and the **visualizer contract (node P0)** in Wave 1, and assigns `flowVisualizer.js` a **single owner per subsequent wave**.

## Critical path (longest dependency chain)

`node P0` → `node P3 spikes` (packaged-build scored) → **ENGINE decision** → node P4 visual language + subflows.
Parallel chain: `ux P1` → `ux P2` → `ux P3`.
Everything else hangs off Wave-1 foundations and can slot into whichever wave its owner-file is free.

## Verification ("until fully done and verified")

- **Per-lane:** the lane's own new/changed tests green in its worktree before it merges.
- **Per-wave gate:** full `npm test` green, `npm run e2e`, and a **packaged build on all 3 OSes** via the `pull_request`/`workflow_dispatch` CI (build-only, no publish) + `gh run download` smoke-test. An SE re-runs their top demos before any node-engine swap becomes default.
- **Cross-app:** shared conformance fixtures that all three repos' suites must pass; sibling-repo PRs for schemaVersion / assertions / subflows land **before** the UI authors them.
- **Definition of done:** every roadmap item shipped, green suite (no weakened assertions), packaged installers verified, cross-app contract intact, bible updated (changelog per change + gotchas for time-sinks).

## How to run a wave as a maxed multi-agent workflow

```
Workflow "wave-N":
  phase Build:    parallel(lanes.map(lane =>
                    agent(lane.brief, { isolation:'worktree', model:'opus', effort:'high' })))
  phase Verify:   per lane → agent runs the lane's tests in its worktree; adversarial review of the diff
  phase Integrate: merge each GREEN worktree into sprint/roadmap-ux-overhaul (owner-file disjoint ⇒ clean)
  phase Gate:     run full npm test + e2e + trigger a packaged build; block Wave N+1 until green
```
Between waves I stay in the loop: read each wave's result, run the gate, then author the next wave's workflow.
