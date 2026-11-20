# Pixelpush design system

Pixelpush uses the *Ultraviolet, filtered* theme: one violet hue (290) over a near-neutral
graphite base. The panel's chrome, cards, fields and popovers are violet-tinted, translucent
surfaces with a specular top edge, but nothing is frosted: there is no `backdrop-filter`
anywhere. Violet is the one accent. It marks what you can act on and what is selected, and
the selected tab is a lit amethyst pill. The indigo-to-plum light field that used to sit
behind the panel is now an opt-in setting.

Everything below is implemented in
[`extension/panel/pixelpush.css`](../extension/panel/pixelpush.css). That file is the
source of truth; this page explains the decisions behind it.

**Docs:** [Home](README.md) · [Getting started](getting-started.md) · [Features](features.md) · [Audit](audit.md) · [AI providers](ai-providers.md) · [Linear](linear.md) · [Privacy and permissions](privacy-and-permissions.md) · [Architecture](architecture.md) · [Development](development.md) · **Design system**

## Brand mark

![Pixelpush icon](../extension/icons/icon-128.png)

A "layers" mark: three stacked rounded diamonds on a violet-to-deep-purple tile. The top
layer is filled lavender, and the two behind it are near-white outlines, each one hidden
wherever the layer in front covers it. Chrome gets it at 16, 32, 48 and 128 px, and the
panel header shows the 48 px render.

| File | Use |
| --- | --- |
| [`brand/icon.svg`](../brand/icon.svg) | App icon. It embeds a 512 px PNG master with transparent corners and is the source for the toolbar and store PNGs. |
| [`brand/mark.svg`](../brand/mark.svg) | The vector glyph alone (`viewBox` 0 0 64 64), for dark surfaces. |
| [`extension/icons/`](../extension/icons) | The four PNG renders (16, 32, 48, 128 px) that the manifest points to. |
| [`docs/assets/banner.svg`](assets/banner.svg) | The README banner. It redraws the glyph from the paths in `mark.svg`. |

The glyph uses two colours: `#FAF9FE` for the outlines and `#CABCFD` for the top layer's
fill, the same value as `--uv-300`. The tile is a diagonal gradient that the SVG stores
only as pixels. Sampled from the PNG master it runs from about `#773CF7` near the top
left to about `#430497` near the bottom right.

Run `npm install` once, then `npm run icons` to re-render the four PNGs in
`extension/icons/` from `brand/icon.svg` with resvg. The script reads only `icon.svg`, so
a change to the artwork means replacing the PNG embedded in it; `mark.svg` is not an input.

## Base, surfaces and the optional light field

- **Base:** `--pp-bg`, a graphite `oklch(0.22 0.005 290)` (about `#1b1a1f`). It is the
  panel and page background. Only the base is near-neutral: fields, cards, popovers and
  toasts keep their violet tint, so field wells read as recessed, darker than the panel.
- **Surfaces:** translucent violet tints (`--pp-surface`, `--pp-surface-raised`,
  `--pp-hairline`, `--pp-field`) with a bright specular top edge and a soft violet
  refraction along the inner bottom edge. They composite straight over the base; nothing
  blurs what is behind it. The Changes toolbar uses the opaque `--pp-surface-solid` so rows
  that scroll under it never show through.
- **Light field (opt-in):** **Settings → Appearance → Background glow** sets
  `html[data-light-field="on"]`, which paints `body::before`: three soft radial glows
  (indigo top-left, violet right, plum bottom), a faint two-ray conic sheen and a
  vignette, all on hue 290. It is off by default and never moves. The choice is stored in
  `chrome.storage.local` under `pixelpushLightField`.

## Navigation

The header and tabs are one floating glass slab, inset from the panel edges. The tabs
sit in a recessed track; the selected tab is a lit amethyst pill (`--uv-600` to
`--uv-700`) with white text and a specular sheen, and a count badge on it becomes a
dark chip. Icon buttons are glass chips. All six tabs fit at Chrome's narrowest side
panel width (320 px), including with count badges showing.

## Colour

All colours are `oklch()` on hue 290, except the status hues, which are the same in every
theme. Components read the `--pp-*` theme tokens. The older primitives (`--uv-*`,
`--mist-*`, `--glass-*`) and role tokens (`--fg`, `--bg`, `--accent`, …) still exist and
now point at the theme tokens, so rules written against them follow the theme.

| Theme token | Value | Used for |
| --- | --- | --- |
| `--pp-bg` | `oklch(0.22 0.005 290)` | Panel and page background |
| `--pp-text` / `--pp-text-strong` | `oklch(0.97 0.006 290)` / `oklch(0.985 0.007 290)` | Default text / text on the accent |
| `--pp-label` | `#ffffff` | Field labels, 13 px / 600 |
| `--pp-text-body` / `--pp-text-muted` / `--pp-text-subtle` | `oklch(0.9 0.014 290)` / `0.82 0.02` / `0.76 0.024` | Secondary text / captions, inactive tabs / hints, placeholders |
| `--pp-accent-a` → `--pp-accent-b` | `oklch(0.5 0.245 290)` → `oklch(0.44 0.235 290)` | Primary button and selected tab (vertical gradient) |
| `--pp-accent-text` | `oklch(0.83 0.09 290)` | Links, text buttons |
| `--pp-focus` | `oklch(0.77 0.125 290)` | Field focus rings, selection rings |
| `--pp-surface` / `--pp-surface-raised` | `oklch(0.2 0.032 290 / 0.5)` / `oklch(0.15 0.03 290 / 0.82)` | Cards, toolbars / sticky toolbars, popovers (0.95) |
| `--pp-hairline` | `oklch(0.36 0.05 290 / 0.36)` | Dividers, card borders, segmented-control wells |
| `--pp-field` / `--pp-field-focus` | `oklch(0.09 0.016 290 / 0.72)` / `oklch(0.13 0.024 290 / 0.9)` | Input well / while focused |
| `--pp-field-border` / `-hover` | `oklch(0.42 0.045 290 / 0.6)` / `oklch(0.56 0.06 290 / 0.8)` | Input ring / on hover |
| `--pp-pressed` | `oklch(0.48 0.07 290 / 0.6)` | Pressed toggle, pill and segment |
| `--pp-outline` | `oklch(0.68 0.035 290)` | Outline buttons |
| `--pp-jade` / `--pp-amber` / `--pp-coral` | `oklch(0.84 0.11 160)` / `oklch(0.8 0.13 75)` / `oklch(0.78 0.125 22)` | Success, AAA/AA, Done, low / edited, AA Large, In Progress, medium / errors, Fail, Reset all, high |

## Shared states

- **Fields.** One small field (`.pp-field`: 6×8 px padding, 6 px radius, 12 px text, mono
  and tabular numerals for numeric properties) and one large field (`.input`: 8×12 px,
  8 px radius, a real 1 px border). Hover brightens the ring; focus swaps the well to
  `--pp-field-focus` with a `--pp-focus` ring and a 3 px halo. Icon fields put the well on
  the wrapper and light it with `:focus-within`.
- **Edited.** A field whose value differs from the page's original wears an amber ring and
  an 8% amber fill (`[data-edited="true"]`) while it is not focused. Edited elements also
  get a 6 px amber dot at the end of their tree row, and the Changes tab count is amber.
- **Pressed.** Flow, alignment, text-align, auto flow, the size/corner/side toggles,
  intent and severity pills, segmented options, the palette strip and filter chips share
  one treatment: `--pp-pressed` fill, strong text and a 60% focus-coloured inset ring,
  always paired with `aria-pressed`.
- **Disabled.** Every button fades to 45% and shows `not-allowed`.
- **Toast.** One toast, centred 16 px above the bottom of the panel, 160 ms rise-in,
  hidden after 2.4 s (AI rationales stay 4 s), `role="status"`.

The element tree uses jade for class names and orchid for element ids, so the two read
apart at a glance.

In-page overlays (hover outline, selection box) use violet `#804EFA`. It keeps 4.79:1 on
a white page and 4.39:1 on a black one.

`npm run verify` runs [`scripts/contrast.mjs`](../scripts/contrast.mjs). It reads the
tokens from the stylesheet, rebuilds the optional light field over the graphite base, and
composites every translucent surface over both the brightest point of the field and pure
black, the way the browser blends. It then measures 133 rendered pairs against WCAG 2 AA
(4.5:1 for text, 3:1 for outlines, focus and state indicators) and fails the build if any
pair drops below its threshold. The script mirrors the `body::before` geometry by hand, so
update both together.

## Type

| Face | Role |
| --- | --- |
| Instrument Sans | Interface text, 400 to 700 |
| JetBrains Mono | Values in numeric fields, selectors, hex codes, ids, counts and inline code |

Base text is 14 px on a 21 px line. Section headings are 15 px / 700 with 0.375 px
tracking. Field labels are 13 px / 600 white on a 16 px line, everywhere. Body text and
controls are 12 to 13 px; chips are 11 px / 600.

Both are bundled in `extension/panel/fonts/`, so the panel makes no font requests.
Chromium injects its own font rule into extension pages, so the `body` type rule is
deliberately unlayered. Nothing renders below 12 px: the stylesheet lifts the bundle's 9
to 11 px utilities to 12 px and turns tiny uppercase chips into lowercase mono tags.

## Shape and depth

- Radii: 4 px for pills, 6 px for small fields and chips, 8 px for large fields and colour
  swatches, 10 px for buttons, 12 px for cards and the primary button, 13 px and 16 px for
  the tabs and their track, 20 px for the header slab, and 999 px for filter chips and
  property pills. Spacing follows a 4 px rhythm (4, 6, 8, 10, 12, 16, 24).
- Depth comes from specular inset highlights and tight contact shadows, not wide haze.
- Status dots are 8 px squares with a 2 px corner radius, one small block of colour
  (Linear priority, connection state).
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
  Fields show focus with the `--pp-focus` ring and halo instead of an outline.
- In forced-colors mode, surface edges become system outlines, the light field is hidden,
  pressed toggles and the selected tab are marked with the system highlight, and edited
  fields get a dashed highlight outline.

## Previewing changes

```sh
npm run preview
# http://localhost:4173/__preview/?demo=1            built-in demo data
# http://localhost:4173/__preview/?demo=1&motion=off  frozen motion, for screenshots
# add &css=variants/name.css to try a draft stylesheet from tools/preview/variants/
```

The preview cannot reproduce styles Chromium injects into extension pages, so check
final changes in the real extension as well.

## Next

- [Development](development.md): the preview harness and the helper scripts behind these rules.
- [Docs home](README.md): every page, by what you are trying to do.
