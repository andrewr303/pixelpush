// Measures WCAG 2 contrast for the colour pairs the side panel actually renders.
// Token values come straight from extension/panel/pixelpush.css, so this fails
// as soon as a palette edit breaks a pair.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const cssPath = fileURLToPath(new URL("../extension/panel/pixelpush.css", import.meta.url))
const css = readFileSync(cssPath, "utf8")
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")))
const tokens = Object.fromEntries(
  [...rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
)

// Colours are carried as linear-light sRGB plus alpha.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function oklchToLinear(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map((v) => Math.min(1, Math.max(0, v)))
}

function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function oklabToLinear([L, a, b]) {
  const C = Math.hypot(a, b)
  const H = (Math.atan2(b, a) * 180) / Math.PI
  return oklchToLinear(L, C, H)
}

function resolve(value) {
  value = value.trim()
  if (value === "transparent") return { rgb: [0, 0, 0], alpha: 0 }
  const ref = value.match(/^var\((--[\w-]+)\)$/)
  if (ref) return resolve(tokens[ref[1]])
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { rgb: [n >> 16, (n >> 8) & 255, n & 255].map((c) => toLinear(c / 255)), alpha: 1 }
  }
  const lch = value.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/)
  if (lch) return { rgb: oklchToLinear(+lch[1], +lch[2], +lch[3]), alpha: 1 }
  const mix = value.match(/^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/)
  if (mix) {
    const p = +mix[2] / 100
    const a = resolve(mix[1])
    const b = resolve(mix[3])
    const alpha = a.alpha * p + b.alpha * (1 - p)
    if (b.alpha === 0) return { rgb: a.rgb, alpha }
    const la = linearToOklab(a.rgb)
    const lb = linearToOklab(b.rgb)
    return { rgb: oklabToLinear(la.map((v, i) => v * p + lb[i] * (1 - p))), alpha }
  }
  throw new Error(`cannot resolve colour: ${value}`)
}

function over(top, bottom) {
  return top.rgb.map((c, i) => c * top.alpha + bottom[i] * (1 - top.alpha))
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function contrast(fg, bg) {
  const base = resolve(bg).rgb
  const top = over(resolve(fg), base)
  const [hi, lo] = [luminance(top), luminance(base)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, background, minimum, what it is]
const TEXT = 4.5
const UI = 3
const pairs = [
  ["var(--fg)", "var(--surface)", TEXT, "body text on the app background"],
  ["var(--fg)", "var(--bg)", TEXT, "text on cards"],
  ["var(--fg-2)", "var(--bg)", TEXT, "secondary text on cards"],
  ["var(--muted)", "var(--surface)", TEXT, "inactive tabs, field labels"],
  ["var(--muted)", "var(--bg)", TEXT, "field labels on cards"],
  ["var(--meta)", "var(--bg)", TEXT, "hints and ids on cards"],
  ["var(--meta)", "var(--field)", TEXT, "placeholders in fields"],
  ["var(--fg)", "var(--field)", TEXT, "typed values in fields"],
  ["var(--accent)", "var(--surface)", TEXT, "links and active icons"],
  ["var(--accent)", "var(--bg)", TEXT, "links on cards"],
  ["var(--accent-on)", "var(--accent)", TEXT, "label on the primary button"],
  ["var(--accent-on)", "var(--accent-hover)", TEXT, "primary button, hovered"],
  ["var(--accent-on)", "var(--accent-active)", TEXT, "primary button, pressed"],
  ["var(--accent)", "var(--color-electricblue-800)", TEXT, "selected segment label"],
  ["var(--danger)", "var(--bg)", TEXT, "error and Reset all text"],
  ["var(--warn)", "var(--bg)", TEXT, "warning text"],
  ["var(--success)", "var(--bg)", TEXT, "success text"],
  ["var(--teal-400)", "var(--surface)", TEXT, "class names in the element tree"],
  ["var(--orchid-400)", "var(--surface)", TEXT, "component names in the element tree"],
  ["var(--border)", "var(--bg)", UI, "field and control outlines on cards"],
  ["var(--border)", "var(--surface)", UI, "field and control outlines on the app background"],
  ["var(--focus)", "var(--surface)", UI, "focus ring on the app background"],
  ["var(--focus)", "var(--bg)", UI, "focus ring on cards"],
  ["#519C03", "#ffffff", UI, "page overlay outline on a white page"],
  ["#519C03", "#000000", UI, "page overlay outline on a black page"]
]

let failed = 0
for (const [fg, bg, min, label] of pairs) {
  const ratio = contrast(fg, bg)
  const ok = ratio >= min
  if (!ok) failed++
  console.log(`${ok ? "pass" : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`)
}

if (failed) {
  console.error(`\ncontrast: ${failed} pair(s) below their minimum`)
  process.exit(1)
}
console.log(`\ncontrast: all ${pairs.length} pairs pass`)
