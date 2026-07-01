# FlowRunner — Masterplan

> The product vision, who it's for, what's shipped, and what's next. Read this to understand *why the app exists* and *where it's going*. Update the roadmap as scope shifts; record the *why* of any roadmap decision in [changelog.md](changelog.md).

## Vision

FlowRunner is an Electron desktop app for visually creating, managing, running, and debugging sequences of API calls ("API Flows"). Self-contained, offline, local-filesystem storage, **no backend dependency** by design. Built by the Radware ASE Team.

**Primary internal motivation:** help Radware **Sales Engineers / Architects demonstrate Business Logic Attack (BLA) Protection** — by authoring and visually presenting both *legitimate* and *malicious* multi-step API sequences. This is the original reason the tool exists and shapes its priorities (visual clarity, easy demo authoring, runtime visualization).

## Ecosystem — FlowMap is a cross-app contract

FlowRunner UI is one of **three apps that share the `.flow.json` "FlowMap" filetype**:
- **FlowRunner UI** (this repo) — interactive authoring + single-instance runs; the canonical schema origin.
- **flowrunner-cli** (`/Users/taly/Development/flowrunner-cli`, Python) — headless containerized runner; ShowRunner runs many of these **24/7** to simulate realistic API traffic. Parses the same schema *more strictly* than the UI.
- **ShowRunner / Demo-Management-Portal** (`dump/Demo-Management-Portal`, Python + React) — orchestrator that also authors/manages flowmaps (with hierarchical folders) and drives the CLI fleet.

**Consequence:** the flow format is a shared contract, not a private file. Evolve it **additive-only**, keep the frozen fields immutable, and coordinate any non-additive change across all three repos. See [architecture.md](architecture.md) §4 and [gotchas.md](gotchas.md) (Cross-app FlowMap contract). A full schema-evolution + UX-modernization proposal is maintained in [docs/flowmap-evolution.md](docs/flowmap-evolution.md).

## Personas

- **SE / Architect** — demos (the primary driver): present BLA scenarios visually.
- **Tester / QA** — validate and debug multi-step API behavior.
- **Developer** — prototype multi-step API integrations.

## Current state (v1.2.1)

Shipped and solid:
- **Authoring:** flow metadata, global headers, typed static vars (String/Number/Boolean/JSON); four step types — **Request, Condition, Loop, Transform**; response extraction (`.status`/`headers.*`/`body`/JSON paths); `{{var}}` substitution (quoted/unquoted in body); special vars `RANDOM_IP` / `RANDOM_INT` / `RANDOM_STRING`; variable-insertion helper; Copy cURL.
- **Two views:** List/Editor and Node-Graph (Drawflow) with zoom, minimap, Auto-Arrange, collapsible branches.
- **Execution:** run / single-step / stop / continuous-run; configurable inter-step delay; `onFailure` stop|continue; live result highlighting; results panel with search/filter and copy.
- **Files:** local `.flow.json` new/open/save/save-as/close/clone; recent-files with drag-reorder.
- **Export:** results → JSON / CSV; execution → HAR 1.2.
- **Platforms:** Windows x64, macOS arm64, Linux x64 (AppImage). Update-check against GitHub releases (notify-only).

## Roadmap

### Near-term / concrete (specified but not built)
These came from the v1.2 task list and roadmap and remain genuinely **pending**:
- **"Step Into" execution** — step into nested (condition/loop) bodies, not just over them.
- **Non-JSON request bodies** — `x-www-form-urlencoded` and `form-data` body types (today only JSON-style bodies are first-class).
- **Environment variables** — `{{env.var}}` scope / environment switching.
- **Visual JSON Path Picker** — click a response field to build the extract path instead of typing it.
- **Workspace / folders model** — replace the flat recent-files list with an importable/exportable workspace that supports folders.

### v2.0 aspirations (larger bets)
Scripting step (arbitrary logic — deliberately deferred in favor of the safer Transform step), sub-flows / reusable flow components, delay step, advanced auth helpers, live execution-context viewer, secrets management, advanced templating, Postman/OpenAPI import, in-step assertions + test-summary reporting, customizable node layouts, collaboration, and web/Docker deployment. *(Results CSV/JSON export and Linux builds — once on this list — are now done.)*

### Known non-goals / scoped-down decisions
- **No true background/parallel runner.** "Continuous run" is intentionally a simple repeat-in-sequence mode; the UI is not usable during it and there's no inter-run delay (see [changelog.md](changelog.md) v1.1.0).
- **No arbitrary scripting** (yet) — Transform step covers computed variables without the security surface of running user code.
- **No code-signing / true auto-update.** Update-check is notify-only; builds are unsigned (hence the macOS `xattr` / Windows SmartScreen install steps in [gotchas.md](gotchas.md)).

## Quality bar — manual regression checklist

Automated coverage is summarized in [architecture.md](architecture.md) §10. These **manual UI regression cases** (from the v1.2.0 test plan) have no automated home yet — run them when touching the related areas:
1. **Step-mode Stop** halts immediately and clears queued steps.
2. **Auto-Arrange** layout persists across a reload.
3. Node-editor shows correct **"Prev:" labels** for the last node.
4. Insert-variable button width doesn't overflow.
5. **Copy cURL** resolves static / runtime / random vars (unresolved → variable name left readable).
6. `RANDOM_INT(1,1000)` / `RANDOM_STRING(16)` generated **once per run** and reused consistently.
7. **Step search** + List/Graph jump buttons navigate correctly.
8. Results **JSON / CSV export** produce correct files.
