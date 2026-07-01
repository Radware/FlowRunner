# Conformance fixtures: "from-the-future" flow maps

These `.flow.json` files deliberately contain constructs a newer FlowRunner / a
newer FlowMap `schemaVersion` might emit that an OLDER engine has never seen.
They exist to prove the JS engine is a **tolerant reader**: it must LOAD every
file here and DEGRADE gracefully (skip-with-warning, never crash, never silently
run the wrong thing, never abort the whole run).

They are the in-repo, minimal slice of the shared conformance corpus described in
`docs/flowmap-evolution.md` (Schema Evolution, Wave 3) and the rollout plan in
`docs/schema-versioning.md`. The cross-repo (CLI + portal) version is aspirational;
this folder is the part FlowRunner owns and keeps green today.

| Fixture | From-the-future construct | Expected degradation |
|---|---|---|
| `future-step-type.flow.json` | step `type: "quantum_request"` (unknown) | step skipped, `unsupported:true`, warning surfaced, run continues |
| `future-transform-op.flow.json` | transform `op: "homomorphic_encrypt"` (unknown) | op skipped with `unsupported_transform_op` warning; NOT downgraded to base64_decode; output var left unset |
| `future-condition-operator.flow.json` | conditionData `operator: "semantic_matches"` (unknown) | condition treated as NOT MET (false → Else branch); warning; run continues (no throw) |
| `future-fields-and-version.flow.json` | `schemaVersion: "2.0"` + several unknown top-level and per-step fields | file loads; unknown fields ignored; known steps still execute |

DO NOT "fix" these files to make them look valid — their strangeness is the test.
Every frozen wire key (`then`/`else`/`steps`, `staticVars`, `onFailure`, `type`,
`conditionData` operators, `##VAR##` markers, extract namespaces) is used exactly
as the contract requires; only the *values* are from the future.
