// Screenshot markup: the drawing surface in the full composer and the PNG
// export that goes to Linear. Coordinates are CSS pixels of the captured
// viewport, so annotations stay put when you switch between the element
// crop and the full window.
import { h } from "./dom.js"

export const COLORS = [
  { name: "Red", css: "oklch(0.63 0.23 25)" },
  { name: "Amber", css: "oklch(0.8 0.16 75)" },
  { name: "Violet", css: "oklch(0.62 0.22 290)" },
  { name: "Jade", css: "oklch(0.76 0.14 160)" },
  { name: "White", css: "oklch(0.98 0.004 290)" }
]
const RING = "oklch(0.55 0.23 290)"
const STROKE = 2.5
const PIN_R = 10

export function ringRect(cap) {
  if (cap.kind !== "element" || !cap.anchorRect) return null
  const r = cap.anchorRect
  return { x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8, radius: Math.min((cap.radius || 0) + 4, 28) }
}

const norm = (a) => ({
  x: Math.min(a.x1, a.x2),
  y: Math.min(a.y1, a.y2),
  width: Math.abs(a.x2 - a.x1),
  height: Math.abs(a.y2 - a.y1)
})

function arrowHead(a, len = 12) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
  const p = (d) => [a.x2 - len * Math.cos(ang + d), a.y2 - len * Math.sin(ang + d)]
  return [p(0.45), [a.x2, a.y2], p(-0.45)]
}

function itemNodes(item, key) {
  const color = COLORS[item.color]?.css || COLORS[0].css
  const common = { stroke: color, "stroke-width": STROKE, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }
  if (item.type === "pen") {
    const d = item.points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")
    return h("path", { key, d, ...common })
  }
  if (item.type === "rect") {
    const r = norm(item)
    return h("rect", { key, x: r.x, y: r.y, width: r.width, height: r.height, rx: 4, ...common })
  }
  if (item.type === "ellipse") {
    const r = norm(item)
    return h("ellipse", { key, cx: r.x + r.width / 2, cy: r.y + r.height / 2, rx: r.width / 2, ry: r.height / 2, ...common })
  }
  if (item.type === "arrow") {
    const head = arrowHead(item)
    return h(
      "g",
      { key },
      h("line", { x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2, ...common }),
      h("polyline", { points: head.map((p) => p.join(",")).join(" "), ...common })
    )
  }
  if (item.type === "pin") {
    return h(
      "g",
      { key },
      h("circle", { cx: item.x, cy: item.y, r: PIN_R, fill: color, stroke: "#fff", "stroke-width": 2 }),
      h(
        "text",
        { x: item.x, y: item.y + 4, "text-anchor": "middle", "font-family": "Instrument Sans, system-ui, sans-serif", "font-size": 11, "font-weight": 700, fill: item.color === 4 ? "#1b1a1f" : "#fff" },
        String(item.n)
      )
    )
  }
  return null
}

// The interactive SVG. `frame` is the crop or full-window rect.
export function markupSvg(ctx, frame, { interactive = true } = {}) {
  const { cap, rec, draft } = ctx
  const ring = ringRect(cap)
  const items = [...draft.markup.items, ...(ctx.ui.drawing ? [ctx.ui.drawing] : [])]
  return h(
    "svg",
    {
      class: "fc-shot-svg",
      viewBox: `${frame.x} ${frame.y} ${frame.width} ${frame.height}`,
      preserveAspectRatio: "xMidYMid meet",
      onPointerDown: interactive ? (e) => pointerDown(ctx, e) : undefined,
      onPointerMove: interactive ? (e) => pointerMove(ctx, e) : undefined,
      onPointerUp: interactive ? (e) => pointerUp(ctx, e) : undefined,
      onPointerCancel: interactive ? () => cancelDraw(ctx) : undefined,
      role: interactive ? "img" : undefined,
      "aria-label": interactive ? "Screenshot. Draw on it with the markup tools." : undefined
    },
    h("image", { href: rec.shot, x: 0, y: 0, width: cap.vp.w, height: cap.vp.h, preserveAspectRatio: "none" }),
    ring && h("rect", { x: ring.x, y: ring.y, width: ring.width, height: ring.height, rx: ring.radius, fill: "none", stroke: RING, "stroke-width": 1.5 }),
    items.map((it, i) => itemNodes(it, `m${i}`))
  )
}

function point(e) {
  const svg = e.currentTarget
  const m = svg.getScreenCTM()
  if (!m) return { x: 0, y: 0 }
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }
}

function pointerDown(ctx, e) {
  if (e.button !== 0) return
  e.preventDefault()
  const p = point(e)
  const { tool, color } = ctx.draft.markup
  if (tool === "pin") {
    const n = ctx.draft.markup.items.filter((m) => m.type === "pin").length + 1
    ctx.update((d) => {
      d.markup.items.push({ type: "pin", x: p.x, y: p.y, n, note: "", color })
      d.markup.redo = []
    })
    ctx.focusNext = `pin-${n}`
    return
  }
  e.currentTarget.setPointerCapture(e.pointerId)
  ctx.ui.drawing =
    tool === "pen" ? { type: "pen", color, points: [[p.x, p.y]] } : { type: tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
  ctx.render()
}

function pointerMove(ctx, e) {
  const d = ctx.ui.drawing
  if (!d) return
  const p = point(e)
  if (d.type === "pen") {
    const last = d.points[d.points.length - 1]
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5) return
    d.points.push([p.x, p.y])
  } else {
    d.x2 = p.x
    d.y2 = p.y
  }
  ctx.render()
}

function pointerUp(ctx) {
  const d = ctx.ui.drawing
  if (!d) return
  ctx.ui.drawing = null
  const big = d.type === "pen" ? d.points.length > 2 : Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 4
  if (!big) return ctx.render()
  ctx.update((draft) => {
    draft.markup.items.push(d)
    draft.markup.redo = []
  })
}

function cancelDraw(ctx) {
  ctx.ui.drawing = null
  ctx.render()
}

export function undo(draft) {
  const item = draft.markup.items.pop()
  if (item) draft.markup.redo.push(item)
}
export function redo(draft) {
  const item = draft.markup.redo.pop()
  if (item) draft.markup.items.push(item)
}

// ----------------------------------------------------------------- export

function roundRect(g, x, y, w, hgt, r) {
  g.beginPath()
  g.roundRect(x, y, w, hgt, r)
}

function drawItem(g, item) {
  const color = COLORS[item.color]?.css || COLORS[0].css
  g.strokeStyle = color
  g.fillStyle = color
  g.lineWidth = STROKE
  g.lineCap = "round"
  g.lineJoin = "round"
  if (item.type === "pen") {
    g.beginPath()
    item.points.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])))
    g.stroke()
  } else if (item.type === "rect") {
    const r = norm(item)
    roundRect(g, r.x, r.y, r.width, r.height, 4)
    g.stroke()
  } else if (item.type === "ellipse") {
    const r = norm(item)
    g.beginPath()
    g.ellipse(r.x + r.width / 2, r.y + r.height / 2, Math.max(r.width / 2, 0.5), Math.max(r.height / 2, 0.5), 0, 0, Math.PI * 2)
    g.stroke()
  } else if (item.type === "arrow") {
    g.beginPath()
    g.moveTo(item.x1, item.y1)
    g.lineTo(item.x2, item.y2)
    const head = arrowHead(item)
    g.moveTo(...head[0])
    g.lineTo(...head[1])
    g.lineTo(...head[2])
    g.stroke()
  } else if (item.type === "pin") {
    g.beginPath()
    g.arc(item.x, item.y, PIN_R, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = "#fff"
    g.stroke()
    g.fillStyle = item.color === 4 ? "#1b1a1f" : "#fff"
    g.font = '700 11px "Instrument Sans", system-ui, sans-serif'
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(String(item.n), item.x, item.y + 0.5)
  }
}

// Renders `frame` of the screenshot with the element ring and markup.
// `maxWidth` scales the output down (thumbnails, AI); otherwise it keeps
// the screenshot's own resolution.
export async function exportImage(ctx, frame, { maxWidth = 0, type = "image/png", quality, markup = true } = {}) {
  const { img, cap, draft } = ctx
  const scale = img.naturalWidth / cap.vp.w
  let out = scale
  if (maxWidth && frame.width * out > maxWidth) out = maxWidth / frame.width
  const width = Math.max(1, Math.round(frame.width * out))
  const height = Math.max(1, Math.round(frame.height * out))
  const canvas = new OffscreenCanvas(width, height)
  const g = canvas.getContext("2d")
  g.imageSmoothingQuality = "high"
  g.drawImage(img, frame.x * scale, frame.y * scale, frame.width * scale, frame.height * scale, 0, 0, width, height)
  g.setTransform(out, 0, 0, out, -frame.x * out, -frame.y * out)
  const ring = ringRect(cap)
  if (ring) {
    g.strokeStyle = RING
    g.lineWidth = 1.5
    roundRect(g, ring.x, ring.y, ring.width, ring.height, ring.radius)
    g.stroke()
  }
  if (markup) for (const item of draft.markup.items) drawItem(g, item)
  return canvas.convertToBlob(type === "image/png" ? { type } : { type, quality: quality ?? 0.85 })
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
