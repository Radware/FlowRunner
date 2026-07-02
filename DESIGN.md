# DESIGN.md — FlowRunner

The visual language. Everything here resolves to CSS custom properties in
`styles.css`. The color layer is a **two-tier OKLCH system** (contract in
[docs/design-tokens.md](docs/design-tokens.md)); this file adds the
non-color scales (space, type, elevation, radius, motion) and the component
posture the overhaul commits to. Consume **semantic** tokens only.

## Color

OKLCH, brand hue **262 (blue)**. Never `#000` / `#fff`; every neutral is tinted
toward 262 (chroma 0.004–0.022). Strategy: **Restrained** — tinted-neutral
surfaces carrying the app, one blue accent under ~10% of the surface, plus the
four hard-semantic run-state hues which are *meaning*, not decoration.

Semantic tokens (Tier 2, theme-flipping):
`--surface`, `--surface-raised`, `--surface-sunken`, `--text`, `--text-muted`,
`--accent`, `--accent-hover`, `--accent-contrast`, `--border`, `--border-strong`,
`--focus-ring`, and run states `--run-success` / `--run-error` /
`--run-running` / `--run-skipped`.

Additions this overhaul introduces (theme-aware, semantic):
- `--surface-overlay` — dialogs/menus that float above everything.
- `--accent-soft` — low-chroma accent wash for selected/active rows and subtle
  fills (a tint of accent, not a border stripe).
- `--text-faint` — tertiary text (placeholders, disabled labels).
- Per-run-state **soft** companions (`--run-success-soft`, `--run-error-soft`,
  …) for background tints of status pills and result rows, so status reads as a
  filled chip, never a `border-left` stripe.

**Theme.** Default **light**, tuned for a projector in a lit room (SE demoing a
live attack/defense flow to a customer). Dark is opt-in
(`[data-theme="dark"]` or OS `prefers-color-scheme` unless `light` is pinned)
and must be fully coherent, not a dimmed light theme.

## Typography

System UI stack (`--font-family`) for chrome; monospace (`--font-family-code`)
for URLs, variable tokens, JSON, cURL, and result payloads (data must look like
data). No web-font dependency (offline app).

Type scale, ratio ~1.25, defined as tokens:
`--fs-caption 12px` · `--fs-body 13px` · `--fs-base 14px` · `--fs-label 15px` ·
`--fs-h4 16px` · `--fs-h3 19px` · `--fs-h2 24px` · `--fs-display 30px`.
Weights: 400 body, 500 controls/labels, 600 headings, 700 wordmark/emphasis.
Body measure capped 65–75ch. Hierarchy comes from **scale + weight**, never from
color alone.

## Space

8px-based rhythm, exposed as tokens so spacing stops being ad hoc (names as
implemented in styles.css):
`--space-2xs 2px` · `--space-xs 4px` · `--space-sm 8px` · `--space-md 12px` ·
`--space-lg 16px` · `--space-xl 24px` · `--space-2xl 32px` · `--space-3xl 48px`.
Vary spacing for rhythm (section gaps > control gaps > inline gaps). Panels
breathe; dense editors stay tight but consistent.

## Radius

`--radius-sm 6px` (controls, inputs, small chips) · `--radius-md 10px` (cards,
panels, step rows) · `--radius-lg 14px` (dialogs, floating surfaces) ·
`--radius-full 999px` (pills, avatars, toggles). The current flat 4px reads
dated; the step up to 6/10/14 is a large part of the "modern" delta.

## Elevation

Soft, brand-tinted shadows (not black), four rungs as tokens:
- `--elev-1` — resting cards / list rows (hairline + faint shadow).
- `--elev-2` — raised panels, popovers, the active step.
- `--elev-3` — dialogs, palette, dropdowns.
- `--elev-4` — Demo Mode focus / drag ghost.
Shadows use `oklch(... / alpha)` of a dark brand-tinted neutral so they tint
correctly in both themes. Elevation pairs with a hairline `--border`, never
replaces it.

## Motion

Ease-out, exponential (`--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1)`),
durations `--dur-1 120ms` (hover/press), `--dur-2 200ms` (panels, reveals),
`--dur-3 320ms` (view/graph transitions). Never animate layout properties
(animate `transform` / `opacity`). No bounce, no elastic. Run-state changes get
a brief, legible transition so a projected audience can follow causality.
Respect `prefers-reduced-motion`.

## Component posture

- **Buttons.** One accent primary (solid blue), a quiet secondary (tinted-
  neutral surface + hairline border), destructive/success/warning reserved for
  true semantics. `--radius-sm`, 500 weight, `--dur-1` press feedback. No sea of
  identical grey buttons: demote secondary/tertiary actions to low-emphasis.
- **Inputs.** `--surface-raised` fill, hairline border, `--focus-ring` on focus,
  `--radius-sm`. Monospace where the value is code.
- **Cards / step rows.** `--surface-raised`, `--elev-1`, `--radius-md`, hairline
  border. Never nested cards. Status shown via a filled soft chip or a leading
  status dot, never a side stripe.
- **Panels (sidebar / runner).** `--surface-raised` with a single hairline
  divider from the workspace; headers use weight + scale, not heavy fills.
- **Status.** Run states are filled pills / dots using `--run-*` and their
  `-soft` backgrounds, sized to read at projector distance.

## Bans (enforced)

No side-stripe accent borders (`border-left`/`right` > 1px as an accent). No
gradient text (`background-clip:text`). No decorative glassmorphism. No hero-
metric template. No identical card grids. Modals only when inline/progressive
truly won't do. No em dashes in UI copy.
