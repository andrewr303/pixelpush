# Pixelpush design system

Pixelpush is a precise tool for people who care about pixels, so the interface stays
quiet and exact and leaves the page in front of you as the loudest thing on screen. The
one burst of colour is lime. It means "you can act here" or "this is selected", and
nothing else.

Everything below is implemented in
[`extension/panel/pixelpush.css`](../extension/panel/pixelpush.css). That file is the
source of truth; this page explains the decisions behind it.

## Brand mark

![Pixelpush icon](../extension/icons/icon-128.png)

A pixel-art cursor pushing a single pixel, drawn on a 16 × 16 grid so it stays sharp at
every size Chrome asks for (16, 32, 48 and 128 px).

| File | Use |
| --- | --- |
| [`brand/icon.svg`](../brand/icon.svg) | App icon: ink tile with the lime glyph. Source for the PNGs. |
| [`brand/mark.svg`](../brand/mark.svg) | The glyph alone, for dark surfaces. |

Run `npm install` once, then `npm run icons` to re-render `extension/icons/` after editing
`brand/icon.svg`.

## Colour

All colours are `oklch()`. Primitives are named by hue; components only use role tokens.

| Role token | Primitive | Used for |
| --- | --- | --- |
| `--surface` | `--ink-1` | App background, header, send bar |
| `--bg` | `--ink-2` | Cards and list rows |
| `--field` | `--ink-3` | Inputs and hover fills |
| `--fg` / `--fg-2` | `--ink-10` / `--ink-9` | Primary and secondary text |
| `--muted` / `--meta` | `--ink-8` / `--ink-7` | Labels, inactive tabs / hints, ids |
| `--border` | `--ink-6` | Control outlines (at least 3:1 against cards) |
| `--border-soft` | `--ink-4` | Structural dividers |
| `--accent` | `--lime-500` | Primary button, links, selection, focus ring |
| `--accent-on` | `--lime-950` | Text on lime |
| `--success` / `--warn` / `--danger` | mint / amber / coral | Status |

Tree syntax uses teal for class names and orchid for component names, so the two read
apart at a glance.

In-page overlays (hover outline, selection box) use a deep lime, `#519C03`. It keeps
3.44:1 on a white page and 6.11:1 on a black one, which the bright panel lime cannot do.

`npm run verify` runs [`scripts/contrast.mjs`](../scripts/contrast.mjs), which reads the
tokens from the stylesheet and measures 25 rendered pairs against WCAG 2 AA: 4.5:1 for
text and 3:1 for control outlines and focus. It fails the build if any pair drops below
its threshold.

## Type

| Face | Role |
| --- | --- |
| Instrument Sans | Interface text, 400 to 700 |
| JetBrains Mono | Values, selectors, ids, counts, and form-field labels |

Both are bundled in `extension/panel/fonts/`, so the panel makes no font requests. The scale
is 12, 14, 16, 18, 22 and 28 px, plus 13 px for dense controls such as tabs and secondary
buttons and 15 px for the wordmark. Nothing renders below 12 px: the stylesheet lifts
the bundle's 9 to 11 px utilities to 12 px and turns tiny uppercase chips into lowercase
mono tags.

## Shape and depth

- Radii are small and squared: 6 px for controls, 8 px for rows, 10 px for cards.
- Borders carry structure. The panel's own components use no drop shadows.
- Status dots are square, a single pixel of colour (Linear priority, connection state).
- **Selection handles** are the signature detail. An empty state that waits for you to
  pick something is drawn as a dashed marquee with four lime corner handles, like a
  selected layer in a design tool.

## Motion

- 120 ms for colour and fill changes, 180 ms for the tab indicator, all on
  `cubic-bezier(0.2, 0, 0, 1)`.
- Only `transform`, `scale` and `opacity` animate. Buttons press to `scale(0.96)`.
- A running AI job shows a thin lime bar sweeping along the button's bottom edge.
- With `prefers-reduced-motion: reduce`, transitions and animations collapse to near zero.

## Focus and accessibility

- Every focusable element gets a 2 px lime outline on `:focus-visible`, including the
  borderless inputs in the style editor. Forced-colors mode uses the system highlight.
- Element defaults (`button`, `a`, headings) live in `@layer base`, so Tailwind utilities
  can still override them. The stylesheet itself is unlayered and wins over utilities
  where it restyles a component.
- The six tabs fit at Chrome's narrowest side panel width (320 px).

## Previewing changes

```sh
npm run preview
# http://localhost:4173/__preview/?demo=1            built-in demo data
# http://localhost:4173/__preview/?demo=1&motion=off  frozen motion, for screenshots
```
