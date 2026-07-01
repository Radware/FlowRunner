# FlowMap Schema Versioning & Rollout Plan

*How the shared `.flow.json` FlowMap format evolves across the three apps that read it —
**FlowRunner UI** (Electron/JS), **flowrunner-cli** (Python, 24/7 headless, the strictest
parser), and the **ShowRunner Demo-Management-Portal** — without ever breaking a live demo.*

This is the operational companion to the strategy in
[`flowmap-evolution.md`](flowmap-evolution.md) (see *Schema Evolution* and *The Cross-App
FlowMap Contract*). Read that first for the *why*; this file is the *how* and the *when*.

---

## 1. The one field: `schemaVersion`

- **Type:** OPTIONAL top-level string, `"MAJOR.MINOR"` (e.g. `"1.0"`, `"1.9"`, `"2.0"`).
- **Absence means `"1.0"`.** Every existing `.flow.json` in the wild is already valid and needs
  no migration (this mirrors HAR's `log.version` precedent — zero-migration adoption).
- **Additive-only, forever.** It MUST NOT be added to the schema's `required` array, and the
  wire format MUST NOT be gated on it. A file with no `schemaVersion` and a file with
  `schemaVersion:"1.0"` are byte-equivalent in meaning.
- **String, not integer.** Resolves the planning-doc drift where one owner wrote `schemaVersion:2`
  (int) and another wrote `"1.0"` (string). The string form is canonical. A reader that sees an
  integer should coerce-and-warn, never crash.

Schema location: [`schemas/flow-v1.schema.json`](../schemas/flow-v1.schema.json)
(`properties.schemaVersion`, pattern `^[0-9]+\.[0-9]+$`). It is deliberately **not** in `required`.

### Semantics of MAJOR vs MINOR

| Bump | Meaning | Old reader's obligation |
|---|---|---|
| **MINOR** (`1.0 → 1.1`) | Purely additive: new optional fields, new step types/ops/operators, richer metadata. An old reader can run the file by ignoring what it doesn't know. | **Tolerate.** Read known parts, degrade gracefully on unknown parts (skip-with-warning). Never abort the run. |
| **MAJOR** (`1.x → 2.0`) | A deliberate, rare, breaking change to the meaning of existing structure. | **Reject loudly.** Refuse the file with a spec'd, machine-readable error + non-zero exit (CLI) / blocking UI error (UI) / rejected write (portal). Never best-effort guess. |

The point of the MAJOR gate is to convert *silent mis-execution* (the single most damaging
failure for a "what you see is what actually ran" demo tool) into a *principled, auditable refusal*.

---

## 2. The load-bearing ordering constraint

**Reader tolerance ships to the CLI FIRST, before any writer emits something a deployed old CLI
would choke on.** The CLI is the slowest to redeploy (it runs 24/7 in customer-facing containers
on a cadence FlowRunner does not control) and the strictest parser. Therefore:

> Never ship the UI/writer half of a format change unilaterally. The writer that emits a higher
> MAJOR must not go out until a CLI that *rejects unknown MAJOR loudly* is **deployed** — not merely
> merged, not "coordinated", **deployed**.

A `schemaVersion` field that no consumer enforces is **worse than nothing**: it manufactures false
confidence. So the writer side is gated on a written, scheduled CLI commitment (see §5).

---

## 3. What each app does, by phase

### Phase A — Tolerant readers everywhere (the safety floor). SHIPS FIRST.

This is graceful degradation, independent of `schemaVersion` — it is what keeps an old engine alive
when it meets a newer file. Status in **this** repo (FlowRunner UI, JS engine): **DONE.**

| Construct a newer file might carry | JS engine behavior (verified by `__tests__/schemaVersion.test.js` + fixtures) |
|---|---|
| Unknown **step type** | Skipped; result `status:"skipped"`, `unsupported:true`; machine-readable warning; run continues (`flowRunner.js` step dispatch). |
| Unknown **transform op** | Skipped with an `unsupported_transform_op` warning; output var left unset. **Never** silently downgraded to `base64_decode` (the historical CLI bug). (`transformOps.js`) |
| Unknown **condition operator** | Condition treated as **not met** (Else branch) + warning; run continues. Previously threw and aborted the whole run — hardened this lane (`executionHelpers.js evaluateCondition`). |
| Unknown **extract path / namespace** | Falls through to `evaluatePath`, which returns `undefined` and records an extraction failure; never throws. (`flowRunner.js _updateContextFromExtraction`) |
| Unknown **top-level / per-step fields** | Ignored by the reader (additive-lossy on re-save — see §6). Known steps still execute. |

CLI + portal must reach the same floor before Phase B:
- **flowrunner-cli:** replace the throw-on-unknown-type step dispatch and **stop** the silent
  `base64_decode` downgrade in `_normalize_transform_op`; add a flow-level `strict` vs `degrade`
  toggle so CI can fail hard while demos degrade gracefully. Log a **severity callout** in its
  changelog so past run artifacts corrupted by the silent downgrade can be audited.
- **portal:** its DB write path does **no** validation today; malformed flows persist to Postgres and
  get injected into live containers. It must at minimum not crash on unknown fields (it already uses
  `extra='ignore'` semantics for reads) — full validation is Phase C.

### Phase B — `schemaVersion` as the diagnostic (the version gate). GATED ON CLI COMMITMENT.

1. **UI (writer):** stamp `schemaVersion:"1.0"` on save. Bump the **MINOR** whenever it starts
   emitting a new additive construct; bump the **MAJOR** only for a deliberate break, and only once
   the CLI MAJOR-gate is deployed (§2).
2. **UI (reader):** on load, parse `schemaVersion` (absent ⇒ `"1.0"`). Unknown MINOR ⇒ proceed
   (Phase-A degradation covers any unknown constructs). Unknown MAJOR ⇒ show a blocking, plain-language
   error ("This flow needs a newer FlowRunner") and refuse to run rather than mis-execute.
3. **CLI:** unknown MINOR ⇒ tolerate + degrade (Phase A). Unknown MAJOR ⇒ **reject loudly** with a
   spec'd failure shape: a machine-readable error object, a stable log line, and a documented non-zero
   exit code so integrators can script around it.
4. **portal:** on import/write, record `schemaVersion`; reject unknown MAJOR at the API boundary
   (return 4xx with a typed error) instead of persisting a file the containers can't run.

### Phase C — One canonical schema + conformance fixtures (durable cure). MEDIUM/LONG TERM.

- One `flow.schema.json` (JSON Schema draft 2020-12), validated by `ajv` in the UI on save/run,
  `jsonschema` in the CLI, and **the portal's DB write path** (which does none today).
- Finish the internal drift fix: schema properties use `then`/`else`/`steps` (the wire keys), never
  `thenSteps`/`elseSteps`/`loopSteps`.
- **Shared "from-the-future" conformance fixtures.** The minimal, in-repo slice ships NOW:
  [`__tests__/fixtures/flowmaps/`](../__tests__/fixtures/flowmaps/) — unknown step type, unknown
  transform op, unknown condition operator, and extra unknown fields + `schemaVersion:"2.0"`, each with
  a test asserting the JS engine loads and degrades gracefully. The full 3-repo CI corpus is
  **aspirational** — do not commit a small team to own CI for two repos it doesn't control. Grow the
  shared corpus opportunistically as the CLI and portal adopt their tolerant readers.

---

## 4. Worked example — a newer UI exports a file an older CLI still runs

1. **Additive field** (e.g. a request step gains `retries`): old CLI ignores it (`extra='ignore'`),
   runs the flow. MINOR bump `1.0 → 1.1`; old CLI tolerates unknown MINOR.
2. **Genuinely new step type** (e.g. a `websocket` step): old CLI can't have it in its discriminated
   union yet ⇒ Phase-A skip-with-warning: it runs the rest of the flow and surfaces
   "this step needs a newer runner". Still a MINOR bump.
3. **Breaking reinterpretation** of an existing field: MAJOR bump `1.x → 2.0`; old CLI **refuses
   loudly**. The UI does not emit `2.0` until a `2.0`-aware CLI is deployed.

The one feature these rules **cannot** make backward-compatible on their own is **subflows** (a new
reference construct the old CLI's discriminated union rejects). It is gated the hardest: **deployed**
CLI resolution + a shared conformance fixture proving identical resolution + written maintainer
sign-off, *before* the UI can author one.

---

## 5. Rollout gate (do not skip)

`schemaVersion` writer-side stamping (Phase B, step 1's MAJOR path) does **not** land until:

- [ ] The flowrunner-cli maintainer commits **in writing** to the MAJOR-reject gate in the same
      release window, with a spec'd failure shape (error object, exit code, log format).
- [ ] Phase A tolerant readers are **deployed** in the CLI (not just merged).
- [ ] The type is settled as **string `"MAJOR.MINOR"`** in all three repos (no integer variant).
- [ ] The minimal conformance fixtures round-trip / degrade cleanly in every repo that has adopted its
      tolerant reader.

Until all four are checked, the UI stamps only `"1.0"` (or omits the field — semantically identical)
and never a higher MAJOR. MINOR bumps for purely additive changes are safe at any time because every
tolerant reader ignores unknown MINOR.

---

## 6. Known trap: additive fields are lossy through FlowRunner's OWN reader

`jsonToFlowModel` reads only known keys, so a naive additive **top-level** field (including
`schemaVersion` itself, and any org metadata) is dropped on the next UI save. This is why:

- Organization metadata (folders/tags/category) lives in a **sidecar** (`.flowrunner/workspace.json`),
  never on the `.flow.json`.
- If/when the UI needs to *preserve* `schemaVersion` (and other additive fields) across a save, that is
  a deliberate reader/serializer change in `flowCore.js` (`jsonToFlowModel` / `flowModelToJson`), made
  additively and covered by a round-trip test — **not** a side effect of an unrelated feature.

For read-and-degrade (this lane's scope), lossy-on-resave is acceptable and expected: the goal is that
a from-the-future file **loads and runs safely**, not that the old UI perfectly round-trips constructs
it doesn't understand.
