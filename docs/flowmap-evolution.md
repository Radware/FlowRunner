# FlowRunner Evolution: Decision-Grade Council Report

*Evolving FlowRunner and the shared FlowMap (`.flow.json`) format across FlowRunner UI, flowrunner-cli, and the ShowRunner portal. Every recommendation below is grounded in the two research artifacts and verified against source this session (specific file:line anchors cited inline).*

---

## Executive Summary

The council converged on a **sequenced, not big-bang** plan. Ship verified low-risk value first, quarantine every change that depends on the 24/7 CLI you don't control behind written cross-repo sign-off, and reach n8n / Postman-Flows tier without ever risking a live customer demo.

**The single most important constraint** is cross-app compatibility of the shared FlowMap contract. The Python CLI runs 24/7 in customer-facing containers on a deploy cadence FlowRunner does not control, is a **stricter** parser than the UI (verified: `onFailure` required, `type` is a discriminated union that rejects unknown types, method allow-list), and today fails in two dangerous ways: it **throws and aborts a whole run** on an unknown step type (flowRunner.js:471-472), and it **silently downgrades unknown transform ops to `base64_decode`** (flow_runner.py:735-736), executing the wrong operation against live traffic. Everything else in this report is subordinate to fixing that and never breaking it.

**The 5-8 highest-conviction moves (near-unanimous across all five council members and both serious personas):**

1. **Graceful-degrading readers, before any feature.** Replace the throw-on-unknown-type (flowRunner.js:471-472) and the CLI's silent `base64_decode` downgrade (flow_runner.py:736) with skip-with-machine-readable-warning + a flow-level strict/degrade toggle. This is the only live *production-safety bug* on the board, not a feature. Deploy reader tolerance to the CLI **first**, in JS+Python lockstep. *(schema-evolution P1 — every member's #1 or near-#1.)*

2. **Formalize the FlowVisualizer contract as a tested port (Jest fake), before touching the node view.** The sole coupling to Drawflow is verified: five public methods + one options-callback object at app.js:261. This makes every later engine decision a cheap swap and every spike honest. *(node-engine P0.)*

3. **One-click "Tidy Up" (elkjs) welded to its graceful-UX contract, in the same release.** Preserve hand-placed nodes, Tidy-selection vs Tidy-all, ~200ms ease-out, single-keystroke Cmd+Z undo. Zero schema risk (writes only `{x,y}` into opaque `visualLayout`). The SE persona's #1 pick. Verify the elkjs Web Worker instantiates under packaged Electron CSP on day one; ship the `@dagrejs/dagre` fallback in the same PR if it's flaky. *(auto-layout P1+P4.)*

4. **OKLCH design-token layer + projector-first light-default theme, as its own contrast-audited PR.** Pure CSS, zero schema impact, unblocks all downstream UX, and gives both the vanilla shell and any future React mount one token contract. Light-default is chosen from the actual projector scene, explicitly rejecting the "security = dark navy" reflex. *(ux-system P1.)*

5. **Persistent inline inspector replacing the document.body double-click modal, with Basic/Power disclosure.** Keeps the author in canvas context; Basic mode hides plumbing from the customer's screen. Scope into small PRs. *(ux-system P2/P3, incl. Demo mode.)*

6. **Sidecar-first workspace/organization model + electron-store recent-files.** Folders/tags/category live in `.flowrunner/workspace.json`, keeping every `.flow.json` byte-clean. This avoids a verified trap: additive org fields on the file are lossy through FlowRunner's *own* reader. *(file-project-mgmt.)*

7. **Fix the two verified concrete bugs + the schema/serializer drift, this week.** Portal drops camelCase `visualLayout` on import (flows.py:103/313 lack the `visualLayout` fallback that `static_vars` has at :101/:311); the schema declares `thenSteps/elseSteps/loopSteps` (lines 55/59/74) while the serializer and the schema's own `$comment` say `then/else/steps`. Near-zero risk, embarrassing to leave.

8. **Additive `schemaVersion` + CLI MAJOR version-gate — but only paired with a scheduled CLI commitment.** The one-time additive window; adds real value only if the CLI actually gates on it. Half-adopted, it is *worse than nothing* (false confidence). Resolve the format first: it must be one spec.

**Where the council split:** the React Flow engine swap (Visionary champions it as the only ceiling-raiser; Pragmatist/Skeptic/Guardian say "not until P0+P1+packaged-build evidence prove it's needed"); the scope of cross-repo conformance work (aspiration vs near-term commitment); and whether some quality-of-life features (command palette, canvas groups, live relayout) earn a slot at all.

---

## The Cross-App FlowMap Contract

*This section is the spine. Read it before any feature decision.*

### The frozen-field list (immutable — to change, add a NEW field alongside and keep reading the old)

Renaming or repurposing any of these silently breaks the 24/7 CLI. This list currently lives only in cross-repo discovery notes and the schema `$comment`; **write it into this repo's `architecture.md` and `gotchas.md`** (all five members' must-do), and add the currently-absent note that the CLI and portal consume the exported `.flow.json` at all.

| Frozen element | Contract | Verified failure if violated |
|---|---|---|
| `staticVars` | camelCase; the CLI reads only this | snake_case-only reached the CLI once (D-025), `{{baseUrl}}`/credentials resolved to empty strings mid-demo |
| `then` / `else` (condition wire keys) | NOT `thenSteps`/`elseSteps` (UI-model-only) | CLI aliases to `else`; wrong key ⇒ silent empty branch |
| `steps` (loop wire key) | NOT `loopSteps` | wrong key ⇒ silent empty loop body |
| `onFailure` | REQUIRED on every request step for the CLI | `Field(...)` at flow_runner.py:93 ⇒ Pydantic ValidationError |
| `type` ∈ {request, condition, loop, transform} | CLI discriminated union REJECTS unknown types | whole flow rejected |
| `##VAR:type:name##` body markers | never raw `{{var}}` in body JSON | raw token shipped to endpoint as a literal string |
| `conditionData` operator vocabulary | shared across engines | operator mismatch ⇒ divergent evaluation |
| `extract` namespaces | `body.` / `headers.` / `.status` | other syntaxes fall through to a body-path search that fails |
| method allow-list | GET/POST/PUT/DELETE/HEAD/PATCH/OPTIONS | invalid method ⇒ ValidationError |

Additive fields are **safe for the CLI** (`extra='ignore'`), but **no app is a pass-through** — unknown fields are dropped on round-trip. Critically, they are also **lossy through FlowRunner's own reader**: `jsonToFlowModel` reads only known keys, so a naive additive top-level field vanishes on the next save. This is why organization metadata goes in a sidecar, not on the file.

### The schemaVersion + tolerant-reader + graceful-degradation plan

Three waves, in strict order. The ordering constraint is **load-bearing** and comes from the verified stricter-parser facts: because the CLI is slowest to redeploy and strictest, **every reader-side tolerance change ships to the CLI first, before any writer change that could emit something the old CLI would choke on.**

**Wave 1 — Graceful degradation (the actual safety fix).**
- flowRunner.js:471-472 `default: throw` → record a structured, **machine-readable** `skipped-unsupported` result status (enum, not just log text, so CI can gate on "zero degradations") and continue the run.
- executionHelpers.js default branch (transform-op/evaluator dispatch) → mirror the same.
- CLI step dispatch → same skip-with-warning.
- CLI `_normalize_transform_op` (flow_runner.py:736) → **stop** silently rewriting unknown ops to `base64_decode`; log an error and mark the op skipped/failed. Changelog with a **severity callout** so anyone can audit past run artifacts corrupted by the silent downgrade.
- Add a flow-level `strict` vs `degrade` toggle so CI can fail hard while demos degrade gracefully.

**Wave 2 — schemaVersion as the diagnostic.**
- Add an additive top-level `schemaVersion`, **string MAJOR.MINOR** (e.g. `"1.0"`), absence ⇒ `"1.0"` (HAR `log.version` precedent, zero migration). **Resolve the digest's own inconsistency first**: node-engine P4 wrote `schemaVersion:2` (integer) while schema-evolution P3 wrote `"1.0"` (string). Two owners independently naming one field with different types is *exactly* the `staticVars`/`static_vars` drift pattern reproduced in the planning doc. Pick the string form.
- Reader policy: unknown MINOR ⇒ tolerate (degrade per Wave 1); unknown MAJOR ⇒ **CLI rejects loudly** (log + refuse), with a spec'd failure shape (error message, exit code, log format) so integrators can script around it.
- **Gate: do not stamp until the CLI maintainer commits in writing to the MAJOR-reject gate in the same window.** A version field no consumer enforces is worse than none.

**Wave 3 — One canonical schema + conformance fixtures (medium/long-term).**
- One `flow.schema.json` (draft 2020-12), validated by `ajv` (JS) on save/run and `jsonschema` (Python) in the CLI **and the portal's DB write path** (which today does NO validation — malformed flows persist to Postgres and get injected into live containers).
- Fix the internal drift: schema properties → `then`/`else`/`steps` (fix the schema, not the serializer, so the CLI's `then`/`else_(alias='else')`/`steps` model still parses).
- Minimal shared `fixtures/` folder + manifest, including deliberately "from-the-future" files (unknown top-level fields, unknown step types/ops/operators) each repo must round-trip or gracefully degrade on. **Ship the minimal version in this repo early**; treat full 3-repo CI as aspiration — do not commit a small team to maintain CI for two repos it doesn't own.

### How a newer UI exports a file the older CLI still runs

This is the crux question, and the plan answers it directly:

1. **Additive-only for anything the CLI must read.** New optional fields are ignored by the CLI (`extra='ignore'`). A newer UI adding, say, `retries` or `assertions` to a request step produces a file the old CLI runs by simply ignoring those fields.
2. **`schemaVersion` MINOR bump for additive changes; the old CLI tolerates unknown MINOR and runs.** MAJOR is reserved for a rare deliberate break and is gated: the CLI refuses loudly rather than mis-executing, and the UI does not emit a higher MAJOR until the CLI supports it and is deployed.
3. **Graceful degradation covers the gap for genuinely new step types/ops.** If a newer UI ships a new step *type*, an old CLI (which can't be in the discriminated union yet) hits Wave-1 skip-with-warning: it runs the rest of the flow and surfaces a machine-readable "this step needs a newer runner" signal, instead of aborting or silently doing the wrong thing.
4. **Never touch a frozen field.** New meaning always rides a new field name; the old field keeps its old meaning.

The one feature that **cannot** be made backward-compatible by these rules alone is **subflows** (a new reference construct the old CLI's discriminated union rejects). It is therefore gated the hardest: **deployed** CLI resolution + a shared conformance fixture proving identical resolution + written maintainer sign-off, *before* the UI can author one. "Coordinated" is not enough; the word that matters is **deployed**.

### How each new feature is encoded to stay compatible

| Feature | Encoding | Cross-app impact |
|---|---|---|
| **Auto-layout / Tidy Up** | only `{x,y}` into opaque `visualLayout` | **None** — CLI drops via `extra='ignore'`, no schema bump |
| **Canvas Groups/frames** | editor-only `visualLayout._groups: [{id,name,color,memberStepIds[],collapsed}]` | **None** — opaque, CLI-ignored. Must never grow *execution* semantics; if it does, it becomes a subflow and goes through the subflow gate |
| **Pinned/mock output** | reserved `_editor.pinnedOutput` (editor-only) | **None** — CLI ignores; must be glaringly flagged in-UI so a demo never presents stale mock data as live |
| **Org metadata** (folders/tags/category) | **sidecar** `.flowrunner/workspace.json`; export echoes ShowRunner's `folder_id`/`folderId`/`tags`/`category` | Sidecar = none. Export echo aligns with the portal's existing dual-accept; gate the UUID mapping behind a real round-trip fixture, not prose |
| **Assertions** | declarative `assertions[]` on request steps, **reusing the frozen `conditionData` operator vocabulary**; reconcile with the portal's existing `step.assertions[]` shape | Execution-semantics change; CLI evaluates with existing vocab — no JS engine needed. Design jointly |
| **Environments/secrets** | sibling `*.env.json`, not inside `.flow.json`; CLI must also load/merge; design secret-masking once (HAR export, results JSON/CSV, logs) and mirror in Python | Execution-semantics change; coordinate the merge + masking |
| **Subflows** | pointer `{id/path + version}`, **never inline**; additive top-level `schemaVersion` bump only on files that use it | **HIGH** — the one format-touching feature; MAJOR-gated, CLI-co-designed, deployed-first |
| **Scripting** | **rejected outright** — would force the Python CLI to embed a JS engine and breaks the declarative contract; grow `transformOps.js`'s op registry instead | N/A — preserves the shared contract |

---

## Node Engine

**Narrowed recommendation.** Sequence, do not big-bang. **Now:** P0 (formalize the FlowVisualizer contract as a tested Jest fake) + the three canvas-agnostic P1 wins on **incumbent Drawflow** (Tidy Up, node-search palette, on-node error badges). **Slow-walk** the fourth P1 item (View/Edit-as-JSON). Run P3 spikes (Svelte Flow, Rete vanilla) in parallel, scored in a **packaged** build. **Next:** decide the engine on P3 evidence; the steelmanned default is P2 (@xyflow/react as a Vite-built React island scoped to `#flow-visualizer-mount`), but let evidence override the reflex. **Later:** P4 visual language (folds into ux-system P1) and — gated hardest — subflows.

**Steelman (the Visionary, verified in source).** You cannot reach n8n/Postman-Flows tier by patching Drawflow. render() calls `editor.clear()` and rebuilds every node from scratch on every change — O(N) teardown, no diffing — inside ~1370 lines that hand-roll a minimap, connector coloring, and collapse/expand, on an upstream last shipped 2024-10 with 272 open issues. React Flow ships all of that first-party (skinnable minimap, changed-node-only rendering, native subflow primitives via `parentId`+`extent:'parent'`), is MIT, company-backed, 37k+ stars. The swap is *safe* because the seam is real (verified: five methods + one options object at app.js:261) and *transparent to the ecosystem* (every candidate needs only `{x,y}`, a strict subset of `visualLayout`, which flowCore treats as opaque and the CLI drops). ShowRunner already proves the family works (it uses `@vue-flow/core`, the xyflow sibling).

**Key dissent (the Skeptic/Pragmatist/Guardian, and the maintainer persona's deal-breaker-adjacent flag).** "Best library" and "right size for a small team maintaining a zero-runtime-dep, CSP-locked, framework-free offline Electron app" are different questions, and P2 answers the first. It injects Vite, a bundler pipeline, a new build artifact, and a **second permanent renderer paradigm** (React island + vanilla shell) — a forever complexity tax where onboarding now requires vanilla ES modules AND React AND a bundler AND the IPC bridge, in a team whose single most-repeated documented mistake is forgetting `build.files`. The SE persona (who lives on this canvas every demo) doesn't care about the framework and fears exactly one thing: a canvas-feel regression (selection, drag, connector routing, collapse/expand) discovered **live**. And P1 alone may close most of the perceptible gap — an explicit "stay on Drawflow, maintain the fork harder" null hypothesis must be timeboxed.

**Why the call.** The two positions reconcile through **sequencing and evidence**: nobody disputes the direction; the fight is timing. P0 + P1 are unanimous and cheap. The disagreement (should the L-effort swap happen) is *deferred behind evidence* — P3 spikes measured in a packaged build, plus a demonstration that P1 didn't close the gap, plus a beta where the SE re-runs their top-5 flows before it's default. That satisfies the Visionary's ceiling argument (the swap is on the table and directionally endorsed) and the skeptics' cost-fit argument (it's gated, not reflexive). The `View/Edit-as-JSON` panel is **read-only until an automated test proves a hand-typed `{{var}}` can never reach saved body JSON** — every member flagged it as a contract landmine.

---

## Auto-Layout

**Narrowed recommendation.** P1 (elkjs one-click Tidy Up: `algorithm='layered'`, `direction='RIGHT'`, `hierarchyHandling='INCLUDE_CHILDREN'`, `edgeRouting='ORTHOGONAL'`, in its Web Worker) and P4 (the graceful-UX contract) ship as **one indivisible deliverable**. P2 (`@dagrejs/dagre`, the scoped package — never dead plain `dagre`) rides in the same PR as the synchronous fallback. P3 (layout-on-add) and P5 (orthogonal routing + collapse-aware) are mid-term polish. **P6 (live incremental relayout) ships OFF by default, buried in preferences, or is cut entirely.**

**Steelman.** This is the rare high-value feature with genuinely zero cross-app risk. elkjs's `INCLUDE_CHILDREN` compound-node model maps 1:1 onto FlowRunner's then/else/loop nesting (which `_layoutSteps` already walks), replacing hand-rolled recursive layout that has no crossing-minimization or real edge routing. dagre has an open, unresolved issue for exactly this nested shape, which is why elkjs is primary. Imported/AI-generated/hand-edited flows become legible with one click — the single most-requested pattern in this tool category (n8n Tidy Up, Make Auto-Align).

**Key dissent (and the resolution baked into P4).** P1 *without* P4 is a foot-gun: a Tidy Up that reflows an SE's hand-tuned "attacker-path-on-top, defended-path-below" demo layout — positioned so their pointer sweeps left-to-right as they narrate — right before a customer call is worse than no button. The UX Purist scores P1-alone a 6 and P1+P4 a 10; the SE persona named exactly this as a deal-breaker. So P4 is part of P1's **definition-of-done**, not a follow-up: preserve manual positions, obvious Tidy-selection vs Tidy-all, ~200ms ease-out (animate transform/opacity only), single-keystroke Cmd+Z undo, idempotent layout, and a guarantee that opening an 8-month-old saved demo never jumps.

**Why the call.** The named integration unknown — does the elkjs Web Worker instantiate under the packaged Electron CSP (`script-src 'self'`)? — is answered on **day one** of the spike, not after M-effort work; the `@dagrejs/dagre` fallback (convergent with ShowRunner, which already uses dagre) ships in the same PR if it's flaky. Build the layout adapter as a clean `graph-in / {id→{x,y}, bendpoints}-out` seam so it survives the likely engine swap (ELK plugs into React Flow's `useAutoLayout` recipe with no rework). Keep the "pinned" bit **session-only for v1** to avoid touching `visualLayout`'s on-disk shape until you're sure.

---

## Features

*Merging the competitor-UX picks with the old masterplan roadmap items (Step-Into, form-urlencoded bodies, environment vars, JSON Path picker) by value/effort.*

**Narrowed recommendation, in value-to-effort order:**

1. **On-node error badges + jump-to-next-failed-step** (reuses per-step result data `updateNodeRuntimeInfo` already receives) — the SE's live-recovery lifeline. Near-free.
2. **Per-step assertions + test summary** (reuses `evaluateCondition`/`evaluatePath` and the frozen `conditionData` operator vocabulary) — highest-value new capability; encoded additively and CLI-safe.
3. **View/Edit-as-JSON with diff-against-last-saved** — cheap because `.flow.json` is already the source of truth, but **read-only until round-trip safety is test-proven** (contract landmine).
4. **Environments/secrets** (old roadmap item) — sibling `*.env.json`, CLI must load/merge; design masking once.
5. **cURL/HAR import** (old roadmap item) — import fidelity matters to the integrator persona.
6. **Data-driven CSV/JSON iteration**, **JSON tree response view + Visual JSON Path Picker** (old roadmap item — click a response field to generate an extract path).
7. **Per-node pin/mock output** — clever insurance for flaky/rate-limited partner APIs, but **glaringly flagged** and `_editor`-namespaced.
8. **Command palette (Cmd+K) + Tab/double-click node-search picker** — power-user affordance; the SE (a clicker) deprioritized it, so keep it additive and never the only path to any action.
9. **Retries/backoff**, **Step-Into debugging** (old roadmap item), **form-urlencoded/multipart bodies** (old roadmap item).

**Steelman + dissent.** The UX Purist and Visionary want the full authoring-depth suite; the Skeptic wants most of it deferred behind demonstrated demand ("the scope is quietly ballooning across five pillars… together it's a small team signing up to maintain a platform"). **Why the call:** features that reuse existing engine data and stay editor-only or additive (error badges, assertions, JSON diff read-only, pins) are cheap and safe and ship early; features that touch execution semantics (environments, assertions evaluation) are designed jointly with the CLI; **scripting is rejected outright** to preserve the shared contract (grow `transformOps.js` instead). The command palette and live-relayout earn slots only after the core wins prove demand.

---

## UX / Design System

**Narrowed recommendation.** P1 (OKLCH token layer + projector-first dual theme) ships **first** as a standalone, contrast-audited PR. P2 (IA + Basic/Power disclosure + persistent inspector) and P3 (guided first-run + Demo mode) follow, scoped into small PRs. P4 (command palette) and P5 (on-node affordances + motion system) layer on. **P6 (accessibility/reduced-motion/projector-legibility) is a cross-cutting acceptance gate applied to all of the above, not a late phase.**

**Steelman (the UX Purist — treats the design thesis as settled).** The money-moment is an SE mirroring a live attack-and-defense flow to a projector 15 feet from a customer in a *lit* room. That scene-sentence forces **light-default, dark-as-opt-in**, explicitly rejecting the reflexive "security tool = dark navy" AI-slop aesthetic — and it's *right* (the SE persona confirmed text washing out on cheap projectors). On that thesis: a two-tier token system (primitive OKLCH ramp → semantic `--surface`/`--text`/`--accent`/`--run-*`), banning the gradient wordmark (styles.css:165-167, `background-clip:text`), decorative gradients (styles.css:150), pure `#000`/`#fff`, and **side-stripe accent bars**; step **type via a leading glyph chip** (not a left border), single high-chroma accent reserved for selection ring + primary action at ≤10% of surface; status via full-border + pip (never a whole-node fill flip); a real modular type scale (the current flat 14px is too small for projection); disciplined motion (ease-out quart/quint ~150-220ms, transform/opacity only, no bounce). Replacing the `document.body` double-click modal with a persistent inline inspector + Basic/Power disclosure is the literal embodiment of "guiding for beginners, deep for power users."

**Key dissent (minor, and about scope/risk, not direction).** P2 is L-effort/medium-risk touching *every* step-editing entry point at once (the most-patched subsystem, gotchas #24-30) — break it into small PRs (inspector shell → disclosure → advanced/raw views), keep a fallback modal behind a flag until proven. The **raw `##VAR` marker view** in the advanced disclosure is the landmine the integrator persona would "block a release over": it must be **read-only or round-trip through `preProcessBody` unchanged**, never letting a hand-typed `{{var}}` reach body JSON. Version-history diffs must be **plain-language before/after** for the non-developer SE, not a raw JSON diff (a developer workflow leaking onto a beginner's surface).

**Why the call.** P1 is pure CSS, zero schema and zero framework impact, and *de-risks the eventual React island* by establishing the token contract both renderers consume — so it must land first. The Demo mode (hide authoring chrome, enlarge nodes/status, make pass/fail the visual focus) is the most on-the-nose feature for FlowRunner's actual purpose; the SE ranked it #1. P6-as-a-gate (distinct glyphs, not hue alone, for the ~8% color-vision-deficient stakeholder in the demo room) is cheap if baked in and protects the signature moment.

---

## File / Project Management

**Narrowed recommendation.** Two no-regret moves first: **electron-store workspace + recent-files** (fixes a real gap — there is NO recent-files list today) and the **sidecar organization model** (`.flowrunner/workspace.json` for folders/tags/category, mirrored into electron-store, keeping every `.flow.json` byte-clean). Then Fuse.js fuzzy search + Cmd+K, and canvas Groups as `visualLayout._groups`. Mid-term: the portal-aligned folder-tree sidebar (`@headless-tree/core` + Pragmatic DnD) and immer-based session undo/redo + save-snapshots. The `schemaVersion` slice belongs to the schema-evolution pillar and must not land as a side effect of an unrelated undo feature.

**Steelman.** The sidecar-vs-additive decision is **the standout piece of engineering judgment in the whole document**, and it's verified: additive org fields on `.flow.json` are "safe" for the CLI (`extra='ignore'`) but **lossy through FlowRunner's own reader** — `jsonToFlowModel` reads only known keys and drops the rest on the next save, so folders/tags silently vanish the moment a user re-saves. The sidecar sidesteps this entirely and keeps files portable, git-diffable, and directly consumable by the CLI/portal. Every recommended library (electron-store, `@tanstack/virtual-core`, `@headless-tree/core`, Pragmatic DnD, Fuse.js, immer, CodeMirror 6) is genuinely framework-agnostic and works with today's vanilla renderer, so none of this depends on the React decision. Aligning with ShowRunner's *existing* scheme (`parent_id` tree, `tags[]`, `category`, `folder_id`/`folderId` dual-accept, UUID folder ids) means a flow organized locally maps cleanly onto the portal.

**Key dissent (the Skeptic).** Cut the ambition. The ShowRunner UUID/`folder_id` echo is a second team's schema you don't control — **prove it with one round-trip fixture against a real portal export before matching it**, not prose agreement. Don't build the full `@headless-tree` DnD folder tree (it has no official vanilla renderer, so you'd own the adapter) until recent-files + search prove demand. And the integrator persona's sharp question must be answered explicitly: if FlowRunner *exports* `tags`/`category`, does it read them *back* on re-import, or is that round-trip **known-lossy**? Document the answer either way.

**Why the call.** Sidecar-as-source-of-truth is unanimous and correct for a verified reason. The workspace/recent-files gap is real and cheap. The portal-interop echo is valuable but **secondary to the local sidecar and gated behind a fixture**. Canvas Groups are fine (opaque, CLI-ignored) but low-priority (the SE builds 5-15-step flows) and must never quietly acquire execution semantics.

---

## Schema Evolution

**Narrowed recommendation.** This pillar is the spine (see the Cross-App Contract section). Adopt **Option B (additive `schemaVersion` + version-gate)** over **Option A (additive-only + must-ignore-unknown as the written house rule)** as baseline, with **Option E (one canonical schema + shared fixtures)** as the medium-term target. **Reject Option C (capability flags)** as premature complexity for a mostly-additive format. Sequence: **P1 graceful degradation → P2 concrete bug fixes → P3 schemaVersion+gate** (reader tolerance to the CLI first) → **P4 canonical schema** → **P5 fixtures** → **P6 per-feature reference representations** as each feature is scheduled.

**Steelman (the Cross-App Guardian).** P1 is the only proposal that protects the shared contract *today*. Consider the sequence the ecosystem is one release away from: a newer UI (or the portal, whose DB write path does no validation) authors a flow with a step type the 24/7 CLI doesn't recognize; it's injected into a live customer-facing container; the container either hard-crashes mid-run or — worse — silently runs the wrong transform against real traffic and returns fabricated-looking output. For a Business-Logic-Attack demo tool whose entire credibility rests on "what you see is what actually ran," silent wrong-execution is the single most damaging thing the system can do. schemaVersion makes the CLI's rejections *principled* instead of best-effort guessing; the canonical schema makes "frozen contract" a *testable invariant* across three hand-maintained parsers.

**Key dissent (Skeptic/Pragmatist on scope).** schemaVersion is a **cross-repo coordination task disguised as a small JS change**, and it is *dangerous half-adopted*: stamp it while the CLI keeps `extra='ignore'` (its default) and you've decorated files and manufactured false confidence — worse than the honest status quo. So P3 does not land until the CLI maintainer commits, in writing, to the MAJOR-reject gate in the same window. And the full Option-E vision (one schema vendored + validated across all three repos with drift-check CI, portal DB-write validation) is **L-effort cross-team process the ecosystem has deliberately avoided** — fix *our* file's drift now, ship a *minimal* fixtures folder in this repo, but don't sign a small team up to own two other repos' CI.

**Why the call.** The graceful-degradation fix is the highest-leverage item in the entire document and precedes everything, because it is what keeps the CLI alive when a newer UI ships. schemaVersion is the *diagnostic*, not the fix — valuable but contingent, so it's gated. The canonical schema and fixtures are the durable cure for three-engine drift but are correctly medium/long-term. **Fix the two verified concrete bugs and the schema/serializer drift immediately** (S-effort, verified, undercut the payoff of everything else).

---

## Phased Roadmap (Now / Next / Later)

Tags: **effort** S/M/L/XL · **risk** low/med/high · **cross-app** none/low/med/high. Old roadmap items from masterplan.md marked *[OLD]*.

### NOW (weeks — verified low-risk, high-ROI, mostly framework-free)

| Item | Effort | Risk | Cross-app |
|---|---|---|---|
| **schema-evo P1** — graceful skip-with-warning (kill flowRunner.js:471 throw + CLI base64_decode downgrade); machine-readable status; strict/degrade toggle; **CLI first, JS+Py lockstep** | M | med | **med** (execution contract) |
| **node P0** — FlowVisualizer contract as a tested Jest fake (five methods + one options object) | S | low | none |
| **auto-layout P1+P4** — elkjs Tidy Up **welded to** preserve-position/tidy-selection-vs-all/~200ms undo; dagre fallback in same PR; verify Worker under packaged CSP day one | M | med | none |
| **ux P1** — OKLCH tokens + projector-first light-default theme (+ dark, + Projector mode); delete gradient wordmark; own contrast-audited PR | M | low | none |
| **file-mgmt** — electron-store workspace + recent-files; sidecar org model foundation | M | low | none |
| **Fix schema/serializer drift** — schema properties → then/else/steps (fix schema, not serializer) | S | low | low |
| **File 2 verified bugs** — portal visualLayout drop (flows.py:103/313); CLI base64_decode (rides with P1) | S | low | med (other repos) |
| **Write frozen-field list + ecosystem note** into architecture.md/gotchas.md | S | low | none |
| **node P3 spikes** — Svelte Flow + Rete vanilla + "stay on Drawflow" null hypothesis, scored in **packaged** build | S | low | none |
| **node P1 (3 of 4)** — node-search palette, on-node error badges + jump-to-failed; *View-as-JSON read-only only* | M | low | none |

### NEXT (1-2 months — authoring depth + the evidence-gated engine decision)

| Item | Effort | Risk | Cross-app |
|---|---|---|---|
| **Engine decision** — P2 (@xyflow/react island via Vite) *or* P3 spike winner; guardrails: `build.files` + packaged-CSP verify as release-checklist lines | L | med | none (needs only `{x,y}`) |
| **ux P2** — persistent inline inspector replacing double-click modal + Basic/Power disclosure (small PRs); raw `##VAR` view read-only | L | med | none (if raw view read-only) |
| **ux P3** — guided first-run + teaching empty states + **Demo mode** | M | low | none |
| **Per-step assertions + test summary** — reuse `conditionData` vocab; reconcile with portal `step.assertions[]` | M | med | med (CLI evaluates) |
| **schema-evo P3** — additive `schemaVersion` (string MAJOR.MINOR) + CLI MAJOR-gate — **only with scheduled CLI commitment** | M | med | **high** (3-repo coordination) |
| **file-mgmt** — Fuse.js search + Cmd+K; canvas Groups (`visualLayout._groups`); immer undo/redo + save-snapshots | M | low | none |
| **auto-layout P3/P5** — layout-on-add; orthogonal routing + collapse-aware | M | med | none |
| **ux P5** — on-node result affordances + pin/mock (glaringly flagged, `_editor`-namespaced) + motion system | M | low | low |
| ***[OLD]* Environment variables** — sibling `*.env.json`; CLI must load/merge; masking designed once | M | med | med |
| ***[OLD]* cURL/HAR import**; ***[OLD]* Visual JSON Path Picker**; ***[OLD]* form-urlencoded/multipart bodies** | M | low-med | low |

### LATER (quarter+ — coordinated format changes + convergence)

| Item | Effort | Risk | Cross-app |
|---|---|---|---|
| **node P4 visual language** — glyph-chip type, ≤10% accent, recolored edges (folds into ux P1 tokens) | L | low | none |
| **Subflows** — pointer reference + `schemaVersion` bump; **gated on DEPLOYED CLI resolution + shared conformance fixture + written sign-off** | XL | high | **high** |
| **schema-evo P4** — one canonical `flow.schema.json` + `ajv`/`jsonschema` in all three (incl. portal DB-write path) | L | med | high |
| **schema-evo P5** — shared from-the-future conformance fixtures across 3-repo CI (minimal version ships NOW in this repo) | L | low | high (process) |
| **auto-layout P6** — live incremental relayout, **OFF by default**, debounced, local, never physics (or cut) | L | high | none |
| **ux P4** — full command palette (started NEXT); ***[OLD]* Step-Into debugging** | M | low | none |
| ***[OLD]* Workspace import/export**, folder-tree sidebar (`@headless-tree` — own the adapter), portal UUID echo (gated on fixture) | L | med | med |

---

## Top Extracted: The Definitive Prioritized Answer

*What to do first and why — the single most important output.*

1. **Ship graceful-degrading readers (schema-evo P1) before anything else.** It is the only *live production-safety bug fix* on the board, not a feature. flowRunner.js:471-472 throws on unknown step type (crashes a live container mid-run); flow_runner.py:736 silently downgrades unknown ops to `base64_decode` (runs the wrong operation against real customer traffic — a credibility bomb). Replace both with skip-with-machine-readable-warning + a strict/degrade toggle. **Deploy the CLI change first, in JS+Python lockstep.** *Why first: highest ROI, only customer-facing blast radius today, unblocks safe forward-compat for every feature below.*

2. **Land P0 (tested FlowVisualizer contract) before touching the node view.** S-effort insurance; the seam is verified real (app.js:261). *Why: turns every future engine decision from a rewrite into a swap and makes the P3 spikes honest.*

3. **Ship elkjs Tidy Up + its UX contract (auto-layout P1+P4) as one deliverable.** The SE's #1 pick, zero schema risk. Never P1 alone. *Why: highest value-to-effort authoring win, and welding P4 in is what makes it trustworthy instead of a demo-day foot-gun.*

4. **Land the OKLCH token layer + projector theme (ux P1) as its own PR.** *Why: pure CSS, unblocks all downstream UX, and establishes the one token contract both the vanilla shell and any future React mount consume — de-risking the whole engine question.*

5. **Fix the three verified defects this week:** the schema/serializer drift (schema says `thenSteps` at lines 55/59/74, serializer + `$comment` say `then`), the portal `visualLayout` drop (flows.py:103/313), and the CLI `base64_decode` downgrade (rides with #1). *Why: small, verified, and each undercuts the payoff of everything else.*

6. **Stand up the sidecar workspace/recent-files model (file-mgmt).** *Why: fixes a real gap with zero schema impact and avoids the verified lossy-on-resave trap.*

7. **Replace the double-click modal with a persistent inspector + Basic/Power disclosure (ux P2), in small PRs.** *Why: kills the worst IA sin (context loss on the most common action) and delivers the beginner/power-user progressive-disclosure thesis.*

8. **Only then decide the engine (P2 React Flow vs a P3 spike winner), on packaged-build evidence, behind an SE beta.** *Why: React Flow is technically superior but adds a permanent framework/bundler tax to a small team; the disciplined move is to let evidence — not popularity — pick it, after P1 has shown whether the gap even remains.*

9. **Gate subflows and enforced `schemaVersion` as ONE cross-repo initiative behind DEPLOYED CLI support + a shared conformance fixture + written maintainer sign-off. Never ship the UI/writer half unilaterally.** *Why: subflows are the one format-touching feature, and the catastrophic failure mode — a demo that looks perfect in the editor but silently mis-runs in a live customer POC container — is the exact scenario all three serious personas named as a deal-breaker.*

**Non-negotiable across every item:** add every new JS module (elkjs, dagre, electron-store, any React/Vite bundle + sources) to `package.json build.files` in the *same commit* — the team's most-repeated documented mistake, silent only in packaged builds (CLAUDE.md #1).

---

## Honest Trade-offs and Where the Council Disagreed

**React Flow engine swap (the sharpest split).** *Pro (Visionary):* the only ceiling-raiser; Drawflow's `editor.clear()`-and-rebuild render path and dead upstream cap the product one tier below competitors permanently, and the swap is cross-app-transparent. *Con (Skeptic/Pragmatist/Guardian + maintainer persona):* a permanent second-paradigm complexity tax (React+Vite+vanilla+IPC) on a small team, with the SE's real fear being a live canvas-feel regression; P1 alone may close most of the gap. **Resolution:** directionally endorsed but hard-gated behind P0 + packaged-build P3 evidence + a demonstration that P1 didn't suffice + an SE beta. Not committed now.

**schemaVersion.** *Pro:* the one-time additive window, gets more expensive later, and is the diagnostic that makes subflows shippable. *Con:* worthless — actively harmful (false confidence) — if the CLI doesn't gate on it, and it's a cross-repo task masquerading as a small JS change. **Resolution:** stamp only with a scheduled CLI MAJOR-reject commitment; resolve the integer-vs-string inconsistency to string first.

**Conformance-fixture scope.** *Pro (integrator persona's favorite):* turns prose alignment into tested parity and is the tripwire against subflow scope-creep. *Con:* full 3-repo CI is a shared-artifacts home the ecosystem has deliberately avoided; a small team shouldn't own it for two other repos. **Resolution:** ship the minimal fixtures folder + manifest in this repo now; treat cross-repo CI as aspiration.

**Live incremental relayout (auto-layout P6).** Near-unanimous *against* as anything but off-by-default — the SE flagged self-moving nodes mid-demo as a soft deal-breaker with near-zero upside. Several members would cut it entirely.

**Command palette + canvas groups.** Genuinely useful but the SE (a clicker, 5-15-step flows) deprioritized both. **Resolution:** additive, never the only path to any action; earn slots after core wins prove demand.

**Two consistency issues found in the planning inputs themselves** (both flagged by the integrator persona and multiple members, and worth surfacing because they are the *exact* drift pattern the whole effort exists to prevent): (a) `schemaVersion` typed as integer `2` in node-engine P4 vs string `"1.0"` in schema-evolution P3 — resolve to string before any code; (b) the schema's `$comment` (line 4) now correctly documents the `then/else/steps` contract, yet the schema's own `properties` block (lines 55/59/74) still declares `thenSteps/elseSteps/loopSteps` — the drift is half-fixed and must be finished.

---

### Files and anchors referenced (all absolute)

- `/Users/taly/Development/FlowX/flowRunner.js:471-472` — throw-on-unknown-type (schema-evo P1 target)
- `/Users/taly/Development/FlowX/flowCore.js:111-116` — serializer writes `then`/`else`/`steps`; `:71-72` `onFailure` default; `jsonToFlowModel` reads known keys only (lossy-on-resave)
- `/Users/taly/Development/FlowX/app.js:261-271` — FlowVisualizer construction (the verified seam; node P0)
- `/Users/taly/Development/FlowX/schemas/flow-v1.schema.json:4` — `$comment` cross-app contract (correct); `:55,:59,:74` — properties still declare `thenSteps`/`elseSteps`/`loopSteps` (drift to fix)
- `/Users/taly/Development/flowrunner-cli/flow_runner.py:735-736` — silent `base64_decode` downgrade (schema-evo P1/P2 target); `:93` `onFailure` required
- `/Users/taly/Development/dump/Demo-Management-Portal/api/routers/flows.py:101/311` — `static_vars`/`staticVars` dual-accept; `:103/:313` — `visual_layout` with **no** `visualLayout` fallback (verified drop bug)
- Research artifacts: `/private/tmp/claude-502/-Users-taly-Development-FlowX/19367f39-1583-4cc9-a4b6-4a2229d43b86/scratchpad/discovery_findings.json` and `.../research_findings.json`
