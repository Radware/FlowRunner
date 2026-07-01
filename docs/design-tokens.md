# FlowRunner Design Tokens

The visual foundation for the UX overhaul. A **two-tier OKLCH token layer**
defined in `styles.css`. This is a **contract**: both renderers today and a
future React island consume these tokens, so the semantic names below are
stable. Evolve **additively** — never rename or repurpose a shipped token.

Guarded by `__tests__/designTokens.test.js`.

## Why OKLCH

OKLCH (Lightness, Chroma, Hue) is perceptually uniform: equal lightness steps
*look* equally spaced, and changing lightness does not shift the apparent hue.
That gives us a neutral ramp with consistent contrast and run-state colors that
stay legible when projected. Every color is tinted toward the FlowRunner brand
hue (**262°**, blue) so neutrals never land on pure `#000` / `#fff`.

## The two tiers

### Tier 1 — primitive ramp (`--ramp-*`)

Raw OKLCH stops. **Do not consume these directly in feature CSS.** They exist
so semantic tokens can be re-pointed in one place.

- `--ramp-neutral-0 … --ramp-neutral-1000` — brand-tinted neutrals, light→dark.
- `--ramp-accent-400 … --ramp-accent-700` — brand blue.
- `--ramp-success-*`, `--ramp-error-*`, `--ramp-warning-500`,
  `--ramp-running-500`, `--ramp-skipped-500` — run-state hues, projector-saturated.

### Tier 2 — semantic tokens (consume these)

| Token | Role |
|---|---|
| `--surface` | App / window background |
| `--surface-raised` | Panels, cards, headers (sits above `--surface`) |
| `--surface-sunken` | Wells, list backgrounds (sits below `--surface`) |
| `--text` | Primary text |
| `--text-muted` | Secondary / meta text |
| `--accent` | Primary / brand action color |
| `--accent-hover` | Hover state for accent fills |
| `--accent-contrast` | Text/icon color that sits **on** an accent fill |
| `--border` | Default hairline border |
| `--border-strong` | Emphasized border |
| `--run-success` | Run state: succeeded |
| `--run-error` | Run state: failed |
| `--run-skipped` | Run state: skipped |
| `--run-running` | Run state: in progress |
| `--focus-ring` | Focus outline color (includes alpha) |

## Theming

**Default is LIGHT, tuned for projector legibility** — an SE mirrors a live API
attack/defense flow to a projector in a lit room, so surfaces stay bright, text
stays high-contrast, and run-state colors stay saturated.

Dark is **opt-in two ways**:

1. **Explicit** — set `data-theme="dark"` on `<html>` (or any ancestor).
   ```js
   document.documentElement.setAttribute("data-theme", "dark");
   ```
2. **Automatic** — `@media (prefers-color-scheme: dark)` applies dark when the
   OS asks for it, **unless** `data-theme="light"` is set (explicit opt-back-in
   to the projector default).

Only the **semantic tier** flips between themes; the primitive ramp is stable.
That means a React island can read the same semantic tokens and inherit the
active theme for free — no per-component theme logic.

### Consuming from a React island

Reference tokens via `var(--token)` in CSS/CSS-in-JS, or read the resolved
value with `getComputedStyle(document.documentElement).getPropertyValue('--accent')`.
Do not hardcode hex values; do not read Tier-1 `--ramp-*` tokens.

## Legacy variables

The pre-existing `--primary-color`, `--success-color`, `--border-color-light`,
etc. remain in `:root` for now. Wave 1 (this lane) only maps a few proof
surfaces (workspace header, primary button, run-status pip, branding wordmark)
onto the new semantic tokens. **Wave 2** migrates the rest of the stylesheet and
retires the legacy variables. Prefer semantic tokens for any new work.

## Rules

- Consume **semantic** tokens, never Tier-1 `--ramp-*`.
- Never hardcode `#000` / `#fff` — use `--text` / `--surface-raised`.
- No gradient wordmarks, decorative gradients, or side-stripe (`border-left`)
  accent bars in new work.
- Additive evolution only: add tokens, don't rename shipped ones.
