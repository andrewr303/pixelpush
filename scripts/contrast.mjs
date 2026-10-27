// WCAG 2 contrast for the colour pairs the side panel renders, measured against
// the worst case behind the glass. Tokens are read from extension/panel/pixelpush.css.
// It handles:
//   - oklch(L C H / A) and color-mix(..., transparent) alpha,
//   - browser-style compositing (premultiplied "over" in gamma-encoded sRGB),
//   - the body::before light field (geometry mirrors the stylesheet), sampled
//     across three panel sizes, plus an upper bound with every glow stacked at
//     its peak alpha (the value used for pass/fail),
//   - backdrop-filter saturate() applied to the backdrop of blurred glass.
// Every stack is also composited over pure black.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const cssPath =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  fileURLToPath(new URL("../extension/panel/pixelpush.css", import.meta.url))
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
const rootStart = css.indexOf(":root {")
const rootBlock = css.slice(rootStart, css.indexOf("\n}", rootStart))
const tokens = { "--color-white": "#ffffff", ...Object.fromEntries([...rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, n, v]) => [n, v.trim().replace(/\s+/g, " ")])) } // --color-white comes from the Tailwind theme layer

// ---- colour math -------------------------------------------------------------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp = (v) => Math.min(1, Math.max(0, v))
let gamutNotes = new Map()
function oklabToSrgb([L, a, b], name) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  const out = lin.some((v) => v < -1e-4 || v > 1 + 1e-4)
  if (out && name) gamutNotes.set(name, lin.map((v) => v.toFixed(3)).join(","))
  return lin.map((v) => toGam(clamp(v)))
}
function srgbToOklab(rgb) {
  const [r, g, b] = rgb.map(toLin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const oklch = (L, C, H) => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]

// A colour is { rgb: gamma sRGB [0..1], a }.
function resolve(value, name = value) {
  value = value.trim()
  if (value === "transparent") return { rgb: [0, 0, 0], a: 0 }
  const ref = value.match(/^var\((--[\w-]+)\)$/)
  if (ref) { if (!(ref[1] in tokens)) throw new Error("undefined " + ref[1]); return resolve(tokens[ref[1]], ref[1]) }
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) { const n = parseInt(hex[1], 16); return { rgb: [n >> 16, (n >> 8) & 255, n & 255].map((c) => c / 255), a: 1 } }
  const lch = value.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/)
  if (lch) return { rgb: oklabToSrgb(oklch(+lch[1], +lch[2], +lch[3]), name), a: lch[4] ? +lch[4] : 1 }
  const mix = value.match(/^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/)
  if (mix) {
    const p = +mix[2] / 100, A = resolve(mix[1]), B = resolve(mix[3])
    const a = A.a * p + B.a * (1 - p)
    if (a === 0) return { rgb: [0, 0, 0], a: 0 }
    const la = srgbToOklab(A.rgb), lb = srgbToOklab(B.rgb)
    const lab = la.map((v, i) => (v * A.a * p + lb[i] * B.a * (1 - p)) / a)
    return { rgb: oklabToSrgb(lab), a }
  }
  throw new Error(`cannot resolve colour: ${value}`)
}
const c = (v) => resolve(v.startsWith("--") ? `var(${v})` : v)
const withAlpha = (col, k) => ({ rgb: col.rgb, a: col.a * k })
const over = (top, bottom) => top.rgb.map((v, i) => v * top.a + bottom[i] * (1 - top.a))
const stack = (base, ...layers) => layers.reduce((acc, l) => over(l, acc), base)
const lum = (rgb) => { const [r, g, b] = rgb.map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (fgCol, bgRgb) => { const top = over(fgCol, bgRgb); const [h, l] = [lum(top), lum(bgRgb)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05) }
const brighter = (...rgbs) => rgbs.reduce((x, y) => (lum(y) > lum(x) ? y : x))

// saturate(s), Filter Effects matrix, in gamma space and in linear space.
function saturate(rgb, s, linear) {
  const v = linear ? rgb.map(toLin) : rgb
  const m = [[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]]
  const o = m.map((row) => clamp(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]))
  return linear ? o.map(toGam) : o
}
const backdrop = (rgb, s) => brighter(rgb, saturate(rgb, s, false), saturate(rgb, s, true))
const satOf = (tok) => +tokens[tok].match(/saturate\(([\d.]+)%\)/)[1] / 100

// ---- light field (mirrors body::before) ---------------------------------------
const voidC = c("--void")
const L = { indigo: c("--glow-indigo"), violet: c("--glow-violet"), plum: c("--glow-plum"), sheen: c("--glow-sheen"), sheen2: c("--glow-sheen-2"), vig: c("--vignette") }
function radialT(x, y, W, H, [rx, ry, px, py]) { return Math.hypot((x - px * W) / (rx * W), (y - py * H) / (ry * H)) }
function fieldAt(x, y, W, H) {
  const layers = []
  const fade = (col, t, end) => withAlpha(col, Math.max(0, 1 - t / end))
  layers.push(fade(L.plum, radialT(x, y, W, H, [0.96, 0.44, 0.22, 1.04]), 0.74))
  layers.push(fade(L.violet, radialT(x, y, W, H, [0.84, 0.46, 1.04, 0.46]), 0.72))
  layers.push(fade(L.indigo, radialT(x, y, W, H, [0.78, 0.42, 0.04, 0]), 0.72))
  let ang = (Math.atan2(x - 1.18 * W, -(y - -0.14 * H)) * 180) / Math.PI
  ang = (((ang - 196) % 360) + 360) % 360
  const tri = (a0, a1, a2) => (ang <= a0 || ang >= a2 ? 0 : ang <= a1 ? (ang - a0) / (a1 - a0) : (a2 - ang) / (a2 - a1))
  layers.push(withAlpha(L.sheen, tri(0, 22, 44)), withAlpha(L.sheen2, tri(52, 64, 82)))
  const tv = radialT(x, y, W, H, [1.5, 1.1, 0.5, 0.45])
  layers.push(withAlpha(L.vig, clamp((tv - 0.55) / 0.45)))
  return stack(voidC.rgb, ...layers)
}
let sampled = { rgb: voidC.rgb, at: "" }
const SIZES = []
for (const w of [320, 360, 400, 420, 480, 560, 640, 700]) for (const h of [480, 600, 720, 800, 900, 1000, 1200, 1440]) SIZES.push([w, h])
for (const [W, H] of SIZES)
  for (let y = 0; y <= H; y += 4) for (let x = 0; x <= W; x += 4) { const f = fieldAt(x, y, W, H); if (lum(f) > lum(sampled.rgb)) sampled = { rgb: f, at: `${x},${y} of ${W}x${H}` } }
const upper = stack(voidC.rgb, L.plum, L.violet, L.indigo, L.sheen, L.sheen2)
const FIELD = sampled.rgb
const BLACK = [0, 0, 0]
const WHITE = [1, 1, 1]

// ---- surfaces: functions of the backdrop ------------------------------------------
const S1 = satOf("--glass-blur"), S2 = satOf("--glass-blur-soft")
const sheenTop = c("--sheen-top"), sheenLow = c("--sheen-low")
const W = (a) => ({ rgb: [1, 1, 1], a })
const ok = (s) => resolve(s)
const surf = {
  body: (b) => b,
  chrome: (b) => brighter(stack(backdrop(b, S1), c("--glass-1"), sheenTop), stack(backdrop(b, S1), c("--glass-1"), sheenLow)),
  track: (b) => stack(surf.chrome(b), c("--well")),
  tabPill: () => stack(c("--uv-600").rgb, W(0.12)),
  tabBadge: () => stack(surf.tabPill(), ok("oklch(0 0 0 / 0.28)")),
  tabHover: (b) => stack(surf.track(b), withAlpha(c("--uv-600"), 0.35)),
  iconHover: (b) => stack(surf.chrome(b), c("--glass-3"), W(0.1)),
  iconPressed: (b) => stack(surf.chrome(b), ok("color-mix(in oklab, var(--accent-hi) 16%, transparent)")),
  sendBar: (b) => surf.chrome(b),
  card: (b) => brighter(stack(backdrop(b, S2), c("--bg"), sheenTop), stack(backdrop(b, S2), c("--bg"), sheenLow)),
  row: (b) => stack(b, c("--bg")),
  rowHover: (b) => stack(b, c("--glass-3")),
  field: (b) => brighter(stack(b, c("--field")), stack(surf.card(b), c("--field"))),
  well: (b) => brighter(stack(surf.card(b), c("--well")), stack(b, c("--well"))),
  utilCard: (b) => stack(b, c("--color-slate-800")),
  utilChip: (b) => stack(surf.utilCard(b), c("--color-slate-700")),
  utilRaised: (b) => brighter(stack(surf.utilCard(b), c("--color-slate-600")), stack(b, c("--color-slate-600"))),
  utilRaisedHover: (b) => stack(surf.utilCard(b), ok("oklch(0.56 0.08 292 / 0.4)")),
  eb800: (b) => stack(surf.utilCard(b), c("--color-electricblue-800")),
  eb900: (b) => stack(surf.utilCard(b), c("--color-electricblue-900")),
  treeSel: (b) => stack(b, c("--accent-tint")),
  badgeCard: (b) => stack(surf.card(b), c("--glass-3")),
  badgeTrack: (b) => stack(surf.track(b), c("--glass-3")),
  badgeSel: () => c("--accent").rgb,
  sendDisabled: (b) => stack(surf.sendBar(b), c("--glass-3")),
  // Primary fill is opaque: the backdrop does not matter. Lightest stop + peak gloss.
  primary: () => stack(c("--uv-600").rgb, W(0.14)),
  primaryText: () => stack(c("--uv-600").rgb, W(0.07)),
  primaryHover: () => stack(c("--uv-600").rgb, W(0.14), W(0.05)),
  primaryActive: () => stack(c("--uv-600").rgb, W(0.14), ok("oklch(0.12 0.06 292 / 0.2)")),
  sendCount: () => stack(surf.primaryHover(), ok("oklch(0.16 0.09 292 / 0.42)")),
  utilFill: () => c("--color-electricblue-600").rgb,
  utilFillHover: () => c("--color-electricblue-700").rgb,
  utilFillHover2: () => c("--accent-hover").rgb,
  mint: () => c("--success").rgb,
  amber: () => c("--warn").rgb,
  // Floating glass over page-derived content: assume white behind.
  popover: () => stack(WHITE, c("--glass-pop")),
  sticky: () => stack(WHITE, ok("oklch(0.15 0.03 290 / 0.82)")),
  resetHover: (b) => stack(surf.utilCard(b), ok("color-mix(in oklab, var(--coral-500) 12%, transparent)")),
  pageWhite: () => WHITE,
  pageBlack: () => BLACK
}

const TEXT = 4.5, UI = 3
const pairs = [
  // [fg, surface, min, label]
  ["--fg", "chrome", TEXT, "brand name, header text on the chrome slab"],
  ["--muted", "track", TEXT, "inactive tab labels on the tab track"],
  ["--fg", "tabHover", TEXT, "hovered tab label"],
  ["--accent-on", "tabPill", TEXT, "selected tab label on the amethyst pill"],
  ["--accent-on", "tabBadge", TEXT, "count badge inside the selected tab"],
  ["--muted", "chrome", TEXT, "header icon buttons (idle)"],
  ["--fg", "iconHover", TEXT, "header icon button, hovered"],
  ["--accent-hi", "iconPressed", TEXT, "selection mode / settings pressed (inline style)"],
  ["--fg-2", "chrome", TEXT, "workspace select text"],
  ["--fg-2", "badgeTrack", TEXT, "Changes badge, unselected tab"],
  ["--accent-on", "badgeSel", TEXT, "count badge on a selected segment (solid violet)"],
  ["--fg", "body", TEXT, "body text directly on the light field"],
  ["--muted", "body", TEXT, "empty states, labels on the field"],
  ["--meta", "body", TEXT, "hints, list-sub, ids on the field"],
  ["--fg", "card", TEXT, "text on glass cards"],
  ["--fg-2", "card", TEXT, "secondary text on cards"],
  ["--muted", "card", TEXT, "field labels on cards"],
  ["--meta", "card", TEXT, "hints and ids on cards"],
  ["--fg", "row", TEXT, "issue titles on rows"],
  ["--meta", "row", TEXT, "issue ids on rows"],
  ["--fg", "rowHover", TEXT, "issue row, hovered"],
  ["--fg", "field", TEXT, "typed values in fields"],
  ["--meta", "field", TEXT, "placeholders in fields"],
  ["--fg-2", "well", TEXT, "attachment chip text in wells"],
  ["--accent-hi", "body", TEXT, "links on the field"],
  ["--accent-hi", "card", TEXT, "links and link buttons on cards"],
  ["--accent-hi", "row", TEXT, "links on rows"],
  ["--fg-2", "badgeCard", TEXT, "badges on cards"],
  ["--accent-on", "primary", TEXT, "label on the primary fill (lightest stop + peak gloss)"],
  ["--accent-on", "primaryText", TEXT, "label on the primary fill (at text height)"],
  ["--accent-on", "primaryHover", TEXT, "primary, hovered (peak gloss + overlay)"],
  ["--accent-on", "primaryActive", TEXT, "primary, pressed"],
  ["--accent-on", "sendCount", TEXT, "send count chip on the hovered primary"],
  ["--accent-on", "utilFill", TEXT, "utility violet fills (AA chip, Star button)"],
  ["--accent-on", "utilFillHover", TEXT, "utility violet fill, hovered (700)"],
  ["--accent-on", "utilFillHover2", TEXT, "audit retry fill, hovered (accent-hover)"],
  ["oklch(0.22 0.045 165)", "mint", TEXT, "AAA chip / mint fills"],
  ["oklch(0.24 0.045 78)", "amber", TEXT, "AA Large chip"],
  ["--muted", "sendBar", TEXT, "connection status text"],
  ["--fg-2", "sendBar", TEXT, "connection status mono value"],
  ["--danger", "card", TEXT, "error text on cards"],
  ["--danger", "body", TEXT, "error text on the field"],
  ["--danger", "utilCard", TEXT, "Reset all on the utility header"],
  ["--danger", "resetHover", TEXT, "Reset all, hovered"],
  ["--warn", "card", TEXT, "warning text"],
  ["--success", "card", TEXT, "success text"],
  ["--teal-400", "body", TEXT, "class names in the element tree"],
  ["--orchid-400", "body", TEXT, "component names in the element tree"],
  ["--teal-400", "treeSel", TEXT, "class names on a selected tree row"],
  ["--orchid-400", "treeSel", TEXT, "component names on a selected tree row"],
  ["--fg", "treeSel", TEXT, "tag names on a selected tree row"],
  ["--color-slate-200", "utilCard", TEXT, "style editor values on utility cards"],
  ["--color-slate-400", "utilCard", TEXT, "style editor labels (slate-400)"],
  ["--color-slate-500", "utilCard", TEXT, "de-emphasised utility text (slate-500)"],
  ["--color-slate-400", "utilChip", TEXT, "tiny chips (slate-400 on slate-700)"],
  ["--color-slate-300", "utilChip", TEXT, "rating chip fallback (slate-300 on slate-700)"],
  ["--color-slate-300", "utilRaised", TEXT, "raised utility controls (slate-300 on slate-600)"],
  ["--color-white", "utilRaised", TEXT, "selected utility segment (white on slate-600)"],
  ["--color-electricblue-300", "utilRaised", TEXT, "selected utility segment (violet text on slate-600)"],
  ["--color-slate-300", "utilRaisedHover", TEXT, "raised control, hovered"],
  ["--color-electricblue-300", "eb800", TEXT, "selected chips (electricblue-300 on 800)"],
  ["--color-electricblue-300", "eb900", TEXT, "chips (electricblue-300 on 900)"],
  ["--color-electricblue-300", "utilCard", TEXT, "utility text links"],
  ["--fg", "popover", TEXT, "popover text over white page content"],
  ["--color-slate-300", "popover", TEXT, "popover secondary text over white"],
  ["--color-white", "popover", TEXT, "toast text over white page content"],
  ["--fg", "sticky", TEXT, "sticky header text over white content"],
  ["--meta", "sendDisabled", 0, "disabled primary label (exempt; info only)"],
  // Non-text: control outlines, focus, state indicators (3:1)
  ["--border", "card", UI, "field and control outlines on cards"],
  ["--border", "body", UI, "control outlines on the field"],
  ["--border", "chrome", UI, "workspace select outline on the chrome"],
  ["--border", "sendBar", UI, "copy button outline on the send bar"],
  ["--border", "utilCard", UI, "utility control outlines (border-slate-600 fix)"],
  ["--border", "field", UI, "field outline against its own interior"],
  ["--focus", "body", UI, "focus ring on the field"],
  ["--focus", "card", UI, "focus ring on cards"],
  ["--focus", "chrome", UI, "focus ring on the chrome"],
  ["--focus", "track", UI, "focus ring on the tab track"],
  ["--focus", "tabPill", UI, "focus ring inside the selected tab"],
  ["--focus", "field", UI, "focused field border / ring"],
  ["--focus", "sendBar", UI, "focus ring around the primary on the send bar"],
  ["--accent-line", "chrome", UI, "pressed icon button ring"],
  ["--accent-hi", "row", UI, "linked issue ring"],
  ["--accent-line", "body", UI, "empty-state marquee dashes"],
  ["--uv-400", "body", UI, "empty-state selection handles"],
  ["--mist-6", "row", UI, "low-priority dot on rows"],
  ["--meta", "row", UI, "medium-priority dot on rows"],
  ["--success", "sendBar", UI, "connected dot"],
  ["--warn", "sendBar", UI, "connecting ring"],
  // In-page overlays draw on arbitrary pages (content-scripts/inspector.js)
  ["#804efa", "pageWhite", UI, "page overlay outline on a white page"],
  ["#804efa", "pageBlack", UI, "page overlay outline on a black page"]
]

let failed = 0
const rows = []
for (const [fg, s, min, label] of pairs) {
  const fgCol = c(fg)
  const worst = surf[s](FIELD), black = surf[s](BLACK)
  const rw = ratio(fgCol, worst), rb = ratio(fgCol, black), ru = ratio(fgCol, surf[s](upper))
  const lo = Math.min(rw, rb)
  const pass = lo >= min
  if (!pass) failed++
  rows.push({ pass, min, rw, rb, ru, fg, s, label })
}
const pad = (s, n) => String(s).padEnd(n)
console.log(`light field: upper bound (all glows stacked) L*=${(srgbToOklab(upper)[0]).toFixed(3)} Y=${lum(upper).toFixed(4)}; brightest sampled point L=${srgbToOklab(sampled.rgb)[0].toFixed(3)} Y=${lum(sampled.rgb).toFixed(4)} at ${sampled.at}`)
console.log(`backdrop saturate: chrome ${S1}, cards ${S2}; worst of gamma/linear/unsaturated used`)
console.log(`\n${pad("", 5)} ${pad("bright", 7)} ${pad("black", 7)} ${pad("stack*", 7)} min  pair     (*all glows stacked: unreachable bound, info only)`)
for (const r of rows) console.log(`${r.pass ? "pass" : "FAIL"}  ${r.rw.toFixed(2).padStart(5)}  ${r.rb.toFixed(2).padStart(5)}  ${r.ru.toFixed(2).padStart(5)}${r.ru < r.min ? "!" : " "}  ${String(r.min).padEnd(3)}  ${r.fg} on ${r.s} - ${r.label}`)
if (gamutNotes.size) console.log(`\nout-of-sRGB-gamut tokens (clipped in linear light): ${[...gamutNotes.keys()].join(", ")}`)
if (process.argv.includes("--md")) {
  console.log("\n| Pair | Surface | Min | Brightest field point | Pure black | All glows stacked (info) |\n|---|---|---|---|---|---|")
  for (const r of rows) console.log(`| ${r.label} (\`${r.fg}\`) | ${r.s} | ${r.min} | ${r.rw.toFixed(2)} | ${r.rb.toFixed(2)} | ${r.ru.toFixed(2)} |`)
}
console.log(failed ? `\ncontrast: ${failed} pair(s) below minimum` : `\ncontrast: all ${pairs.length} pairs pass`)
process.exit(failed ? 1 : 0)
