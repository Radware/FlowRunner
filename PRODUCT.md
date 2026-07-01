# PRODUCT.md — FlowRunner

## Product purpose

FlowRunner is a desktop tool (Electron; Windows / macOS / Linux) for visually
building, running, and debugging sequences of API calls ("API Flows"). It is
self-contained and offline: local `.flow.json` files, no backend, no account.

Its reason for existing, and the thing that shapes every priority: **Radware
Sales Engineers and Solution Architects use it to demonstrate Business Logic
Attack (BLA) protection.** They author both *legitimate* and *malicious*
multi-step API sequences and then present them live, often **mirrored to a
projector in a lit room**, walking a customer through what an attack looks like
and how Radware's defense responds in real time.

That makes FlowRunner an unusual thing: an internal engineering tool that is
**also a sales instrument shown to customers**. The interface is on stage. A
scrappy, Bootstrap-era look quietly undercuts a security pitch; a precise,
confident, modern one reinforces it. "Make it phenomenal" is not vanity here,
it is aligned with the product's job.

## Register

**Product.** The design serves the work (authoring and running flows). But it
has a **presentation mode** (Demo Mode, the projector view) where the design
briefly *becomes* the product. Default to product discipline; earn a moment of
brand confidence in the surfaces that get projected (run state, the flow graph,
result verdicts).

## Users

- **SE / Architect (primary).** Builds and *presents* attack/defense flows.
  Cares about visual clarity at projector distance, fast authoring, and a run
  that reads as unmistakable pass / fail / running from across a room.
- **Tester / QA.** Validates and debugs multi-step API behavior. Lives in the
  step editor and the results panel; wants dense, scannable detail.
- **Developer.** Prototypes multi-step API integrations. Values speed, keyboard
  flow (Cmd+K palette), and honest raw data (View-as-JSON, Copy cURL).

## Brand & personality

Radware ASE Team. The subject matter is **API attack and defense**, so the
personality has an edge: precise, technical, a little adversarial. But it must
read as **trustworthy infrastructure**, not theatrics. Confident, engineered,
legible. The feeling of a well-instrumented control surface, not a toy and not
a hacker movie.

Brand hue is **blue (OKLCH hue 262)**. Run states carry hard semantic meaning
(success green, error red, running amber, skipped grey) and must stay saturated
enough to survive a projector.

## Tone (UX copy)

Direct, specific, calm. Name things by what they do. No cheerleading, no
exclamation marks in the chrome. Errors state what happened and what to do next.
Empty states orient and offer the next action rather than apologizing.

## Anti-references (do NOT look like these)

- **Postman.** Powerful but heavy, cluttered, tab-and-panel soup. We win on
  clarity and calm, not feature density on the surface.
- **Generic Bootstrap / Material admin dashboards.** Flat grey buttons, uniform
  card grids, no hierarchy, no point of view. This is exactly what the app
  looks like today and what we are leaving behind.
- **"Hacker" neon-on-black.** The category reflex for a security tool is
  neon-green terminal on pure black. Reject it. It reads as costume, and it
  fails the projector-in-a-lit-room test.
- **Insurance-form blandness.** Endless label-over-input with no rhythm.

## Strategic principles

1. **Projector-legible by default.** Light theme is the default for a reason:
   an SE mirrors a live flow to a projector in a lit room. High contrast, big
   enough targets, saturated run-state color. Dark theme must be equally
   coherent (opt-in), never an afterthought.
2. **The run is the hero.** Pass / fail / running is the single most important
   thing to read instantly. Everything else is support.
3. **Calm density.** Three panes hold a lot of controls. Earn hierarchy through
   scale, weight, spacing, and restraint, so density never becomes noise.
4. **Additive, tokened, themeable.** All color flows through the OKLCH semantic
   token layer (see DESIGN.md). No hardcoded hex, no legacy per-color vars, so
   both themes and a future React island inherit the system for free.
5. **Author fast, present clean.** The two jobs (build vs show) share one
   surface; keep authoring dense and efficient while presentation surfaces stay
   uncluttered and bold.
