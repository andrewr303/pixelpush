# Pixelpush design system

Pixelpush is a dark, purple, liquid-glass tool. A near-black canvas is lit from behind
by a soft indigo-to-plum light field, and the panel's chrome, cards, fields and send bar
sit on top as translucent glass. Violet is the one accent. It marks what you can act on
and what is selected, and the selected tab is a lit amethyst pill.

Everything below is implemented in
[`extension/panel/pixelpush.css`](../extension/panel/pixelpush.css). That file is the
source of truth; this page explains the decisions behind it.

## Brand mark

![Pixelpush icon](../extension/icons/icon-128.png)

A pixel-art cursor pushing a single pixel, drawn on a 16 × 16 grid so it stays sharp at
every size Chrome asks for (16, 32, 48 and 128 px). The tile runs from violet `#804EFA`
to deep purple `#3E0C86`; the cursor is near-white and the pushed pixel is lavender.

| File | Use |
| --- | --- |
| [`brand/icon.svg`](../brand/icon.svg) | App icon. Source for the PNGs. |
| [`brand/mark.svg`](../brand/mark.svg) | The glyph alone, for dark surfaces. |

Run `npm install` once, then `npm run icons` to re-render `extension/icons/` after editing
`brand/icon.svg`.

## Light field and glass

- **Canvas:** `--void`, an opaque near-black with a violet cast.
- **Light field:** `body::before`, fixed behind the panel. It stacks three soft radial
  glows (indigo top-left, violet right, plum bottom), a faint two-ray conic sheen and a
  vignette. It never moves, so the blurred glass above it never has to re-render.
- **Glass:** translucent violet-black fills (`--glass-0` to `--glass-4`) with
  `backdrop-filter` blur and saturation, a bright specular top edge and a soft violet
  refraction along the inner bottom edge. Blur is limited to the large surfaces (header
  slab, send bar, cards, popovers, sticky toolbar), not individual rows.

## Navigation

The header and tabs are one floating glass slab, inset from the panel edges. The tabs
sit in a recessed track; the selected tab is a lit amethyst pill (`--uv-600` to
`--uv-700`) with white text and a specular sheen, and a count badge on it becomes a
dark chip. Icon buttons are glass chips. All six tabs fit at Chrome's narrowest side
panel width (320 px), including with count badges showing.

## Colour

All colours are `oklch()`. Primitives are named by hue (`--uv-*`, `--mist-*`,
`--glass-*`); components use role tokens.

| Role token | Value | Used for |
| --- | --- | --- |
| `--surface` | `--void` | The opaque canvas under everything |
| `--bg` | `--glass-2` | Cards and rows |
| `--field` | `--glass-0` | Inputs |
| `--fg` / `--fg-2` | `--mist-10` / `--mist-9` | Primary and secondary text |
| `--muted` / `--meta` | `--mist-8` / `--mist-7` | Labels, inactive tabs / hints, ids |
| `--border` | `--mist-6` | Control outlines, at least 3:1 against any glass |
| `--accent` | `--uv-600` | Primary fill, selected tab |
| `--accent-hi` | `--uv-300` | Accent text, links, active icons |
| `--accent-on` | `--uv-950` | Text on violet |
| `--focus` | `--uv-300` | Focus ring |
| `--success` / `--warn` / `--danger` | mint / amber / coral | Status |

The element tree uses jade for class names and orchid for element ids, so the two read
apart at a glance.

In-page overlays (hover outline, selection box) use violet `#804EFA`. It keeps 4.79:1 on
a white page and 4.39:1 on a black one.

`npm run verify` runs [`scripts/contrast.mjs`](../scripts/contrast.mjs). It reads the
tokens from the stylesheet, rebuilds the light field, and composites every translucent
surface over both the brightest point of the field and pure black, the way the browser
blends. It then measures 91 rendered pairs against WCAG 2 AA (4.5:1 for text, 3:1 for
outlines, focus and state indicators) and fails the build if any pair drops below its
threshold. The script mirrors the `body::before` geometry by hand, so update both together.

## Type

| Face | Role |
| --- | --- |
| Instrument Sans | Interface text, 400 to 700 |
| JetBrains Mono | Counts and badges, ids, selectors in the audit list, inline code, and form-field labels in Settings and Issue |

Both are bundled in `extension/panel/fonts/`, so the panel makes no font requests.
Chromium injects its own font rule into extension pages, so the `body` type rule is
deliberately unlayered. Nothing renders below 12 px: the stylesheet lifts the bundle's 9
to 11 px utilities to 12 px and turns tiny uppercase chips into lowercase mono tags.

## Shape and depth

- Radii are soft: 8 px for controls, 12 px for rows, 16 px for cards, 20 px for the
  header slab and send bar, and pills for tabs and icon buttons.
- Depth comes from specular inset highlights and tight contact shadows, not wide haze.
- Status dots are square, a single pixel of colour (Linear priority, connection state).
- **Selection handles:** an empty state that waits for you to pick something is drawn as
  a dashed marquee with four corner handles, like a selected layer in a design tool.

## Motion

- 120 ms for colour and fill changes and 200 ms for the tab pill, on
  `cubic-bezier(0.2, 0, 0, 1)`. Tailwind utility transitions use the same timing.
- Keyframe animations use only `transform` and `opacity`. Buttons press to `scale(0.96)`.
- A running AI job shows a thin violet bar sweeping along the button's bottom edge.
- With `prefers-reduced-motion: reduce`, transitions and animations collapse to near zero.

## Focus and accessibility

- Every focusable element gets a 2 px violet outline on `:focus-visible`. Inside the tab
  track and the style editor's clipped grids it is drawn inset so it is never cut off.
  The borderless style-editor fields also get a resting outline.
- In forced-colors mode, glass edges become system outlines, the light field is hidden,
  and the selected tab is marked with the system highlight.

## Previewing changes

```sh
npm run preview
# http://localhost:4173/__preview/?demo=1            built-in demo data
# http://localhost:4173/__preview/?demo=1&motion=off  frozen motion, for screenshots
# add &css=variants/name.css to try a draft stylesheet from tools/preview/variants/
```

The preview cannot reproduce styles Chromium injects into extension pages, so check
final changes in the real extension as well.
