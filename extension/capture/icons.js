// Lucide icons (ISC license, see THIRD_PARTY_NOTICES.md) as inline SVG
// strings, plus the few Pixelpush-specific glyphs the composer needs.
import { raw } from "./dom.js"

const PATHS = {
  "maximize-2": '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  "minimize-2": '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  paperclip:
    '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "external-link":
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "corner-down-right": '<path d="m15 10 5 5-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  "map-pin":
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  "redo-2": '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  "trash-2":
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  "file-text":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "mouse-pointer-click":
    '<path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>',
  "square-dashed":
    '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  "app-window":
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  "panel-right": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'
}

export function iconSvg(name, size = 16, strokeWidth = 2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`
}

export function icon(name, size = 16, strokeWidth = 2, props = {}) {
  return raw(iconSvg(name, size, strokeWidth), props)
}

export function spinner(size = 13) {
  return raw(
    `<svg class="pp-spin" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
  )
}

// Priority bars: Low 1, Medium 2, High and Urgent 3, No priority 0.
export function priorityLevel(priority) {
  return { 1: 3, 2: 3, 3: 2, 4: 1 }[priority] || 0
}

export function priorityIcon(priority, size = 16) {
  const lit = priorityLevel(priority)
  const bar = (x, y, hgt, n) =>
    `<rect x="${x}" y="${y}" width="3" height="${hgt}" rx="1" fill="oklch(0.92 0.01 290)" opacity="${lit >= n ? 1 : 0.3}"/>`
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${bar(2, 9, 5, 1)}${bar(6.5, 6, 8, 2)}${bar(11, 3, 11, 3)}</svg>`,
    { key: `pri-${lit}` }
  )
}

// Workflow state glyph by Linear state type, tinted with the state's colour.
export function stateIcon(type, color) {
  const c = /^#[0-9a-f]{3,8}$/i.test(color || "") ? color : "currentColor"
  let inner
  if (type === "backlog" || type === "triage") {
    inner = `<circle cx="8" cy="8" r="6" stroke="${c}" stroke-width="1.6" stroke-dasharray="2.2 2"/>`
  } else if (type === "unstarted") {
    inner = `<circle cx="8" cy="8" r="6" stroke="${c}" stroke-width="1.6"/>`
  } else if (type === "started") {
    inner = `<circle cx="8" cy="8" r="6" stroke="${c}" stroke-width="1.6"/><path d="M8 4a4 4 0 0 1 0 8z" fill="${c}"/>`
  } else if (type === "completed") {
    inner = `<circle cx="8" cy="8" r="7" fill="${c}"/><path d="m5 8.2 2 2 4-4.2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  } else if (type === "canceled") {
    inner = `<circle cx="8" cy="8" r="7" fill="${c}"/><path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`
  } else {
    inner = `<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2"/>`
  }
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">${inner}</svg>`,
    { key: `state-${type}-${c}` }
  )
}
