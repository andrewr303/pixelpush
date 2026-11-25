// Pixelpush capture: on-page selection overlay.
//
// Injected on demand into the top frame (content-script world) when you
// start a capture from the toolbar popup, a keyboard shortcut or the context
// menu. It lets you pick an element or drag an area, describes what you
// picked, asks the service worker for the screenshot, then keeps a highlight
// on the subject and hosts the composer frame until you file or discard.
;(() => {
  if (window.__pixelpushCapture) return
  window.__pixelpushCapture = true

  const ACCENT = "oklch(0.55 0.23 290)"
  const MARK = "data-pixelpush-capture"
  const state = {
    phase: "idle", // idle | picking | shooting | composer
    mode: "element",
    hover: null,
    trail: [],
    pointer: null,
    drag: null,
    capture: null, // { id, anchor, mode }
    toastTimer: 0
  }

  let host = null
  let root = null
  const $ = (sel) => root.querySelector(sel)

  // ---------------------------------------------------------------- styles
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; pointer-events: auto; cursor: default; background: transparent; }
    .layer.area { cursor: crosshair; }
    .hl { position: fixed; pointer-events: none; border-radius: 6px; background: oklch(0.6 0.22 290 / .1);
      box-shadow: 0 0 0 2px ${ACCENT}; transition: left 70ms ease-out, top 70ms ease-out, width 70ms ease-out, height 70ms ease-out; display: none; }
    .tag { position: fixed; pointer-events: none; display: none; max-width: min(520px, 90vw); padding: 3px 8px; border-radius: 7px;
      font: 500 12px/18px ui-monospace, "JetBrains Mono", Menlo, monospace; color: oklch(0.97 0.006 290);
      background: oklch(0.2 0.03 290); box-shadow: 0 0 0 1px oklch(0 0 0 / .4), 0 8px 20px -8px oklch(0 0 0 / .5);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tag b { font-weight: 600; color: oklch(0.83 0.09 290); }
    .hint { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center; gap: 10px;
      padding: 7px 8px 7px 14px; border-radius: 12px; font: 500 14px/20px ui-sans-serif, system-ui, sans-serif; color: oklch(0.97 0.006 290);
      background: oklch(0.2 0.03 290); box-shadow: inset 0 1px 0 oklch(1 0 0 / .16), 0 0 0 1px oklch(0 0 0 / .4), 0 16px 32px -12px oklch(0 0 0 / .5);
      animation: pp-drop 180ms ease-out; white-space: nowrap; }
    .hint kbd { font: 500 12px/18px ui-monospace, "JetBrains Mono", Menlo, monospace; padding: 0 5px; border-radius: 5px; background: oklch(1 0 0 / .1); }
    .hint .keys { display: flex; align-items: center; gap: 6px; color: oklch(0.9 0.012 290); font-size: 13px; }
    .hint button { all: unset; cursor: pointer; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; color: oklch(0.9 0.012 290); }
    .hint button:hover { background: oklch(1 0 0 / .08); color: oklch(0.97 0.006 290); }
    .region { position: fixed; pointer-events: none; border-radius: 4px; box-shadow: 0 0 0 1.5px ${ACCENT}, 0 0 0 100vmax oklch(0.12 0.02 290 / .38); background: oklch(0.6 0.22 290 / .06); }
    .region span { position: absolute; left: 0; top: calc(100% + 6px); padding: 1px 6px; border-radius: 6px; font: 500 12px/18px ui-monospace, Menlo, monospace;
      color: oklch(0.97 0.006 290); background: oklch(0.2 0.03 290); white-space: nowrap; }
    .pin { position: fixed; pointer-events: none; background: oklch(0.6 0.22 290 / .1); box-shadow: 0 0 0 2px ${ACCENT}; }
    iframe { position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; margin: 0; padding: 0; background: transparent;
      color-scheme: dark; pointer-events: auto; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center; gap: 12px;
      padding: 8px 8px 8px 16px; border-radius: 12px; font: 500 14px/20px ui-sans-serif, system-ui, sans-serif; color: oklch(0.97 0.006 290);
      background: oklch(0.2 0.03 290); box-shadow: inset 0 1px 0 oklch(1 0 0 / .16), 0 0 0 1px oklch(0 0 0 / .4), 0 16px 32px -12px oklch(0 0 0 / .5);
      animation: pp-rise 180ms ease-out; max-width: calc(100vw - 32px); }
    .toast button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 8px; font-weight: 600; color: oklch(0.83 0.09 290); }
    .toast button:hover { background: oklch(0.5 0.245 290 / .16); }
    .toast.error { box-shadow: inset 0 0 0 1px oklch(0.74 0.17 25 / .5), 0 16px 32px -12px oklch(0 0 0 / .5); }
    @keyframes pp-drop { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
    @keyframes pp-rise { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
    @media (prefers-reduced-motion: reduce) { .hint, .toast { animation: none; } .hl { transition: none; } }
  `

  function ensureHost() {
    if (host && host.isConnected) return
    host = document.createElement("pixelpush-capture")
    host.setAttribute(
      "style",
      "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important; contain: layout style !important;"
    )
    root = host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = STYLES
    root.append(style)
    document.documentElement.append(host)
  }

  function clearUi(keep = []) {
    if (!root) return
    for (const node of [...root.children]) {
      if (node.localName === "style" || keep.some((k) => node.matches(k))) continue
      node.remove()
    }
  }

  function el(tag, cls, html) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (html != null) node.innerHTML = html
    return node
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

  // ---------------------------------------------------------------- picking
  function start(mode) {
    if (state.phase === "composer" || state.phase === "shooting") {
      focusComposer()
      return
    }
    ensureHost()
    clearUi()
    hideToast(true)
    state.mode = mode
    state.hover = null
    state.trail = []
    state.drag = null
    if (mode === "window") {
      shoot({ kind: "window", rect: null }, null)
      return
    }
    state.phase = "picking"
    const layer = el("div", `layer${mode === "area" ? " area" : ""}`)
    root.append(layer, el("div", "hl"), el("div", "tag"))
    const hint = el(
      "div",
      "hint",
      mode === "area"
        ? `<span>Drag over the area to capture</span><span class="keys"><kbd>Esc</kbd> cancel</span>`
        : `<span>Click an element to capture</span><span class="keys"><kbd>↑</kbd><kbd>↓</kbd> parent / child <kbd>↵</kbd> pick <kbd>Esc</kbd> cancel</span>`
    )
    const cancel = el(
      "button",
      "",
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
    )
    cancel.title = "Cancel (Esc)"
    cancel.setAttribute("aria-label", "Cancel capture")
    cancel.addEventListener("click", stopPicking)
    hint.append(cancel)
    root.append(hint)
    layer.addEventListener("pointermove", onMove)
    layer.addEventListener("pointerdown", onDown)
    layer.addEventListener("pointerup", onUp)
    layer.addEventListener("click", (e) => e.preventDefault())
    layer.addEventListener("contextmenu", (e) => {
      e.preventDefault()
      stopPicking()
    })
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("scroll", onScroll, true)
  }

  function stopPicking() {
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("scroll", onScroll, true)
    if (state.phase === "picking") state.phase = "idle"
    clearUi()
  }

  function elementAt(x, y) {
    for (const node of document.elementsFromPoint(x, y)) {
      if (node === host || node === document.documentElement || node === document.body) continue
      return node
    }
    return document.body
  }

  function onMove(e) {
    state.pointer = { x: e.clientX, y: e.clientY }
    if (state.mode === "area") {
      if (state.drag) {
        state.drag.x2 = e.clientX
        state.drag.y2 = e.clientY
        drawRegion()
      }
      return
    }
    const target = elementAt(e.clientX, e.clientY)
    if (target !== state.hover && !state.trail.includes(target)) {
      state.hover = target
      state.trail = []
    }
    drawHover()
  }

  function onScroll() {
    if (state.mode === "element" && state.pointer && !state.trail.length) {
      state.hover = elementAt(state.pointer.x, state.pointer.y)
    }
    drawHover()
  }

  function onDown(e) {
    e.preventDefault()
    if (e.button !== 0) return
    if (state.mode === "area") {
      state.drag = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY }
      e.target.setPointerCapture?.(e.pointerId)
      drawRegion()
    }
  }

  function onUp(e) {
    if (e.button !== 0) return
    if (state.mode === "area") {
      if (!state.drag) return
      const r = dragRect()
      state.drag = null
      if (r.width < 8 || r.height < 8) {
        $(".region")?.remove()
        return
      }
      pickRegion(r)
    } else if (state.hover) {
      pickElement(state.hover)
    }
  }

  function onKey(e) {
    if (state.phase !== "picking") return
    const handled = ["Escape", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)
    if (!handled) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.key === "Escape") return stopPicking()
    if (state.mode !== "element" || !state.hover) return
    if (e.key === "ArrowUp") {
      const parent = state.hover.parentElement
      if (parent && parent !== document.documentElement && parent !== document.body) {
        state.trail.push(state.hover)
        state.hover = parent
      }
    } else if (e.key === "ArrowDown") {
      if (state.trail.length) state.hover = state.trail.pop()
      else if (state.hover.firstElementChild) state.hover = state.hover.firstElementChild
    } else if (e.key === "Enter") {
      return pickElement(state.hover)
    }
    drawHover()
  }

  function drawHover() {
    const hl = $(".hl")
    const tag = $(".tag")
    if (!hl || !tag) return
    const target = state.hover
    if (!target || !target.isConnected) {
      hl.style.display = tag.style.display = "none"
      return
    }
    const r = target.getBoundingClientRect()
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0
    Object.assign(hl.style, {
      display: "block",
      left: `${r.left - 4}px`,
      top: `${r.top - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`,
      borderRadius: `${Math.min(radius + 4, 24)}px`
    })
    const comp = target.closest("[data-pixelpush-component]")?.getAttribute("data-pixelpush-component")
    tag.innerHTML = `${comp ? `<b>&lt;${esc(comp)}&gt;</b> ` : ""}${esc(segment(target, false))} · ${Math.round(r.width)} × ${Math.round(r.height)}`
    tag.style.display = "block"
    const above = r.top - 30 > 8
    tag.style.left = `${Math.max(8, Math.min(r.left - 4, innerWidth - tag.offsetWidth - 8))}px`
    tag.style.top = `${above ? r.top - 32 : Math.min(r.bottom + 8, innerHeight - 28)}px`
  }

  function dragRect() {
    const d = state.drag
    const x = Math.max(0, Math.min(d.x1, d.x2))
    const y = Math.max(0, Math.min(d.y1, d.y2))
    const r = Math.min(innerWidth, Math.max(d.x1, d.x2))
    const b = Math.min(innerHeight, Math.max(d.y1, d.y2))
    return { x, y, width: r - x, height: b - y }
  }

  function drawRegion() {
    let box = $(".region")
    if (!box) {
      box = el("div", "region", "<span></span>")
      root.append(box)
    }
    const r = dragRect()
    Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })
    box.firstChild.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`
  }

  // ------------------------------------------------------------ describing
  const UTILITY =
    /^(?:-?[a-z]{1,2}[xytrbl]?-\S+|text-|bg-|font-|flex|grid|items-|justify-|content-|self-|place-|gap-|space-|rounded|shadow|border|ring|outline|opacity-|leading-|tracking-|col-|row-|order-|z-|top-|left-|right-|bottom-|inset-|overflow-|truncate|hidden|block|inline|absolute|relative|fixed|sticky|static|transition|duration-|ease-|animate-|cursor-|select-|pointer-|sr-only|container|mx-|my-|css-|sc-|jsx-|svelte-|emotion-|chakra-|MuiBox)/
  const GENERATED = /[:[\]/@!]|^_|__[a-zA-Z0-9]{4,}$|_[a-zA-Z0-9]{5,}$|^[a-z]{1,3}[A-Z0-9][a-zA-Z0-9]{4,}$|\d{4,}/

  function goodClasses(node) {
    return [...node.classList].filter((c) => !UTILITY.test(c) && !GENERATED.test(c))
  }

  function stableId(id) {
    return id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}|^(radix|headlessui|react-aria|mui|rc-|ember)/i.test(id)
  }

  function segment(node, withNth = true) {
    let s = node.localName
    if (stableId(node.id)) return `${s}#${node.id}`
    const classes = goodClasses(node).slice(0, 2)
    if (classes.length) s += classes.map((c) => `.${CSS.escape(c)}`).join("")
    if (withNth && node.parentElement) {
      const same = [...node.parentElement.children].filter((c) => c.localName === node.localName)
      if (same.length > 1 && (!classes.length || same.filter((c) => classes.every((k) => c.classList.contains(k))).length > 1)) {
        s += `:nth-of-type(${same.indexOf(node) + 1})`
      }
    }
    return s
  }

  function selectorPath(node) {
    const parts = []
    for (let n = node; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      parts.unshift(segment(n))
      if (stableId(n.id)) break
    }
    return parts.join(" > ")
  }

  function compactSelector(node) {
    const parts = selectorPath(node).split(" > ")
    for (let k = 1; k <= parts.length; k++) {
      const sel = parts.slice(-k).join(" > ")
      try {
        if (document.querySelectorAll(sel).length === 1) return sel
      } catch {}
      if (k >= 4) return sel
    }
    return parts.join(" > ")
  }

  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim()

  function rectOf(node) {
    const r = node.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }

  function implicitRole(node) {
    const t = node.localName
    if (t === "a" && node.hasAttribute("href")) return "link"
    if (t === "button" || (t === "input" && /^(button|submit|reset)$/.test(node.type))) return "button"
    if (t === "input") return { checkbox: "checkbox", radio: "radio", range: "slider", search: "searchbox" }[node.type] || "textbox"
    return { textarea: "textbox", select: "combobox", img: "img", nav: "navigation", main: "main", header: "banner", footer: "contentinfo", ul: "list", ol: "list", li: "listitem", table: "table", tr: "row", h1: "heading", h2: "heading", h3: "heading", h4: "heading", dialog: "dialog", form: "form" }[t] || ""
  }

  function accessibleName(node) {
    const label = node.getAttribute("aria-label")
    if (label) return clean(label)
    const by = node.getAttribute("aria-labelledby")
    if (by) {
      const text = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      if (clean(text)) return clean(text)
    }
    if (node.localName === "img") return clean(node.getAttribute("alt") || "")
    if (node.labels?.length) return clean(node.labels[0].textContent)
    const text = clean(node.innerText || node.textContent || "")
    return text || clean(node.getAttribute("title") || node.getAttribute("placeholder") || "")
  }

  const ATTRS = /^(role|aria-[\w-]+|name|type|href|alt|title|placeholder|for|data-(?:testid|test-id|test|qa|cy|state|variant|size)|disabled|tabindex)$/

  function keyAttributes(node) {
    const out = {}
    for (const a of node.attributes) {
      if (!ATTRS.test(a.name)) continue
      let v = a.value
      if (a.name === "href") {
        try {
          const u = new URL(v, location.href)
          v = u.origin === location.origin ? u.pathname : u.origin + u.pathname
        } catch {}
      }
      out[a.name] = clip(v, 120)
    }
    return out
  }

  function htmlSnippet(node) {
    const copy = node.cloneNode(true)
    copy.querySelectorAll("script, style, noscript, template").forEach((n) => n.remove())
    copy.querySelectorAll("svg").forEach((svg) => {
      svg.innerHTML = ""
    })
    for (const n of [copy, ...copy.querySelectorAll("*")]) {
      for (const a of [...n.attributes]) {
        if (a.name === "value" || a.name.startsWith("on") || a.name === "srcset" || a.name === "style" || a.name.startsWith("data-pixelpush")) n.removeAttribute(a.name)
        else if (a.value.length > 120) n.setAttribute(a.name, `${a.value.slice(0, 80)}…`)
      }
      if (n.localName === "input" || n.localName === "textarea") n.textContent = ""
    }
    let html = copy.outerHTML.replace(/\s{2,}/g, " ")
    html = html.replace(/[A-Za-z0-9_-]{32,}/g, "[token]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    return clip(html, 1800)
  }

  // CSS rules that match the element, with the file and line they come from.
  const sheetText = new Map()
  async function textOfSheet(sheet) {
    const node = sheet.ownerNode
    if (node && node.localName === "style") return node.textContent || ""
    if (!sheet.href) return ""
    if (sheetText.has(sheet.href)) return sheetText.get(sheet.href)
    let text = ""
    try {
      const u = new URL(sheet.href)
      if (u.origin === location.origin) {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 1200)
        const res = await fetch(sheet.href, { cache: "force-cache", credentials: "same-origin", signal: ctrl.signal })
        clearTimeout(t)
        if (res.ok && Number(res.headers.get("content-length") || 0) < 3e6) text = await res.text()
      }
    } catch {}
    sheetText.set(sheet.href, text)
    return text
  }

  function sheetLabel(sheet) {
    const node = sheet.ownerNode
    const name = (p) => (p || "").split(/[?#]/)[0].split("/").filter(Boolean).pop() || ""
    if (sheet.href) return { file: name(sheet.href), href: sheet.href }
    if (node?.getAttribute) {
      const dev = node.getAttribute("data-vite-dev-id") || node.getAttribute("data-href") || node.getAttribute("data-filename")
      if (dev) return { file: name(dev), href: dev }
      if (node.hasAttribute("data-emotion")) return { file: "emotion", href: "" }
      if (node.hasAttribute("data-styled")) return { file: "styled-components", href: "" }
    }
    return { file: "<style>", href: "" }
  }

  function lineOf(text, selector) {
    if (!text || text.split("\n", 6).length < 5) return 0
    const first = selector.split(",")[0].trim()
    const pattern = first
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s*([>+~])\s*/g, "\\s*$1\\s*")
      .replace(/\s+/g, "\\s+")
    let m
    try {
      m = new RegExp(`(^|[}\\s,;])${pattern}\\s*[,{]`, "m").exec(text)
    } catch {
      return 0
    }
    if (!m) return 0
    return text.slice(0, m.index + m[1].length).split("\n").length
  }

  function matchingPart(node, selectorText) {
    const parts = selectorText.split(/,(?![^(]*\))/).map((s) => s.trim())
    const hits = parts.filter((p) => {
      try {
        return node.matches(p)
      } catch {
        return false
      }
    })
    return hits.length ? hits.join(", ") : selectorText
  }

  function collectRules(node, limit = 40) {
    const out = []
    const walk = (rules, sheet, media) => {
      for (const rule of rules) {
        if (out.length >= 160) return
        if (rule.selectorText !== undefined && rule.style) {
          if (/^[\s,]*(\*|::?(before|after|backdrop|marker))?([\s,]+(\*|::?(before|after|backdrop|marker)))*[\s,]*$/.test(rule.selectorText)) continue
          let ok = false
          try {
            ok = node.matches(rule.selectorText)
          } catch {}
          if (ok) out.push({ rule, sheet, media })
        } else if (rule.cssRules) {
          let active = true
          if (rule.media && rule.conditionText !== undefined && rule.constructor.name === "CSSMediaRule") {
            active = matchMedia(rule.media.mediaText).matches
          } else if (rule.constructor.name === "CSSSupportsRule") {
            try {
              active = CSS.supports(rule.conditionText)
            } catch {}
          }
          if (active) walk(rule.cssRules, sheet, rule.media ? rule.media.mediaText : media)
        }
      }
    }
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      if (rules) walk(rules, sheet, "")
    }
    return out.slice(-limit)
  }

  async function describeRules(node) {
    const matched = collectRules(node)
    const rules = []
    for (const m of matched) {
      const label = sheetLabel(m.sheet)
      const text = await textOfSheet(m.sheet)
      const line = lineOf(text, m.rule.selectorText)
      rules.push({
        selector: clip(matchingPart(node, m.rule.selectorText), 200),
        css: clip(m.rule.style.cssText, 400),
        media: m.media || "",
        file: label.file,
        href: label.href ? clip(label.href.split(/[?#]/)[0], 300) : "",
        line,
        source: line ? `${label.file}:${line}` : label.file,
        style: m.rule.style
      })
    }
    return rules
  }

  function sourceOf(prop, rules, node) {
    if (node.style && node.style.getPropertyValue(prop)) return "inline style"
    let best = null
    for (const r of rules) {
      const v = r.style.getPropertyValue(prop)
      if (!v) continue
      if (!best || r.style.getPropertyPriority(prop) || !best.style.getPropertyPriority(prop)) best = r
    }
    return best ? best.source : ""
  }

  // Elements that should look like this one: the same component in the
  // neighbouring cards or rows, and elements that share its main class.
  function peersOf(node) {
    const peers = new Set()
    for (let depth = 1, a = node; depth <= 4 && a.parentElement && a.parentElement !== document.body; depth++) {
      const path = []
      let n = node
      while (n !== a) {
        path.unshift([...n.parentElement.children].indexOf(n))
        n = n.parentElement
      }
      const parent = a.parentElement
      for (const sib of parent.children) {
        if (sib === a || sib.localName !== a.localName) continue
        let c = sib
        for (const i of path) c = c?.children[i]
        if (c && c !== node && c.localName === node.localName) peers.add(c)
      }
      if (peers.size >= 2) break
      a = parent
    }
    const main = goodClasses(node)[0]
    if (main && peers.size < 6) {
      try {
        for (const c of document.querySelectorAll(`${node.localName}.${CSS.escape(main)}`)) {
          if (c !== node && peers.size < 12) peers.add(c)
        }
      } catch {}
    }
    return [...peers].filter((p) => p.getClientRects().length)
  }

  const COMPARE = [
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "height", "font-size", "font-weight", "line-height", "letter-spacing", "border-top-left-radius", "gap", "border-top-width"
  ]

  function flagsFor(node, cs) {
    const peers = peersOf(node)
    if (peers.length < 2) return { peers: peers.length, flags: [] }
    const flags = []
    for (const prop of COMPARE) {
      const counts = new Map()
      for (const p of peers) {
        const v = getComputedStyle(p).getPropertyValue(prop)
        counts.set(v, (counts.get(v) || 0) + 1)
      }
      const [common, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      const mine = cs.getPropertyValue(prop)
      if (mine !== common && n >= 2 && n / peers.length >= 0.6) {
        flags.push({ prop: prop === "border-top-left-radius" ? "border-radius" : prop, value: mine, expected: common, peers: peers.length })
      }
    }
    return { peers: peers.length, flags, peerSelector: segment(peers[0], false) }
  }

  function box(cs, side) {
    const v = ["top", "right", "bottom", "left"].map((s) => cs.getPropertyValue(`${side}-${s}`))
    if (v.every((x) => x === v[0])) return v[0]
    if (v[0] === v[2] && v[1] === v[3]) return `${v[0]} ${v[1]}`
    if (v[1] === v[3]) return `${v[0]} ${v[1]} ${v[2]}`
    return v.join(" ")
  }

  function styleRows(node, cs, rules, flags) {
    const rows = []
    const flagged = new Set(flags.map((f) => f.prop))
    for (const f of flags) {
      rows.push({
        k: f.prop,
        v: f.value,
        from: sourceOf(f.prop === "border-radius" ? "border-top-left-radius" : f.prop, rules, node),
        warn: true,
        note: `${f.expected} on ${f.peers} similar element${f.peers === 1 ? "" : "s"}`
      })
    }
    const add = (k, v, prop = k) => {
      if (v == null || v === "" || flagged.has(k)) return
      rows.push({ k, v, from: sourceOf(prop, rules, node), warn: false })
    }
    add("display", cs.display)
    if (cs.position !== "static") add("position", cs.position)
    add("width", cs.width)
    add("height", cs.height)
    const margin = box(cs, "margin")
    if (margin !== "0px" && !flags.some((f) => f.prop.startsWith("margin"))) add("margin", margin, "margin-top")
    const padding = box(cs, "padding")
    if (padding !== "0px" && !flags.some((f) => f.prop.startsWith("padding"))) add("padding", padding, "padding-top")
    if (/flex|grid/.test(cs.display) && cs.gap !== "normal") add("gap", cs.gap)
    add("font", `${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily.split(",")[0].replace(/["']/g, "")}`, "font-size")
    add("color", cs.color)
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)") add("background", cs.backgroundColor, "background-color")
    if (cs.backgroundImage !== "none") add("background-image", clip(cs.backgroundImage, 120))
    if (cs.borderTopWidth !== "0px") add("border", `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, "border-top-width")
    if (cs.borderTopLeftRadius !== "0px" && !flagged.has("border-radius")) add("border-radius", cs.borderTopLeftRadius, "border-top-left-radius")
    if (cs.boxShadow !== "none") add("box-shadow", clip(cs.boxShadow, 120))
    if (cs.opacity !== "1") add("opacity", cs.opacity)
    if (cs.zIndex !== "auto") add("z-index", cs.zIndex)
    if (cs.overflow !== "visible") add("overflow", cs.overflow)
    if (cs.visibility !== "visible") add("visibility", cs.visibility)
    return rows
  }

  async function describeElement(node) {
    const cs = getComputedStyle(node)
    const rect = rectOf(node)
    const rules = await describeRules(node)
    const { flags, peers, peerSelector } = flagsFor(node, cs)
    const ancestors = []
    for (let n = node.parentElement; n && n !== document.body && ancestors.length < 6; n = n.parentElement) ancestors.push(segment(n, false))
    const text = node.matches("input, textarea, select")
      ? ""
      : clip(clean(node.innerText || node.textContent || ""), 160)
    return {
      tag: node.localName,
      id: node.id || "",
      classes: [...node.classList].slice(0, 12),
      selector: compactSelector(node),
      selectorPath: clip(selectorPath(node), 600),
      rect,
      radius: parseFloat(cs.borderTopLeftRadius) || 0,
      text,
      role: node.getAttribute("role") || implicitRole(node),
      name: clip(accessibleName(node), 120),
      attributes: keyAttributes(node),
      focusable: node.tabIndex >= 0,
      disabled: !!node.disabled || node.getAttribute("aria-disabled") === "true",
      html: htmlSnippet(node),
      ancestors,
      styles: styleRows(node, cs, rules, flags),
      flags,
      peers,
      peerSelector: peerSelector || "",
      rules: rules.map(({ style, ...r }) => r),
      component: node.closest("[data-pixelpush-component]")?.getAttribute("data-pixelpush-component") || ""
    }
  }

  function describeRegion(rect) {
    const area = rect.width * rect.height || 1
    const candidates = new Set()
    const cols = 7
    const rows = 5
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = rect.x + ((i + 0.5) / cols) * rect.width
        const y = rect.y + ((j + 0.5) / rows) * rect.height
        for (const n of document.elementsFromPoint(x, y)) {
          if (n === host || n === document.documentElement || n === document.body) continue
          for (let a = n; a && a !== document.body; a = a.parentElement) candidates.add(a)
        }
      }
    }
    let best = null
    let bestScore = 0
    for (const n of candidates) {
      const r = n.getBoundingClientRect()
      const ix = Math.max(0, Math.min(r.right, rect.x + rect.width) - Math.max(r.left, rect.x))
      const iy = Math.max(0, Math.min(r.bottom, rect.y + rect.height) - Math.max(r.top, rect.y))
      const inter = ix * iy
      const union = r.width * r.height + area - inter
      const iou = union > 0 ? inter / union : 0
      if (iou > bestScore) {
        bestScore = iou
        best = n
      }
    }
    const inside = []
    const all = document.body.getElementsByTagName("*")
    for (let i = 0; i < all.length && i < 6000; i++) {
      const n = all[i]
      if (n === host) continue
      const r = n.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      if (r.left >= rect.x - 1 && r.top >= rect.y - 1 && r.right <= rect.x + rect.width + 1 && r.bottom <= rect.y + rect.height + 1) {
        inside.push(n)
      }
    }
    return { best: bestScore >= 0.35 ? best : null, score: bestScore, inside }
  }

  async function browserLabel() {
    const ua = navigator.userAgentData
    let name = "Chrome"
    let version = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || ""
    let os = /Mac OS X/.test(navigator.userAgent) ? "macOS" : /Windows/.test(navigator.userAgent) ? "Windows" : /CrOS/.test(navigator.userAgent) ? "ChromeOS" : /Linux/.test(navigator.userAgent) ? "Linux" : ""
    try {
      if (ua) {
        const brand = ua.brands.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) || ua.brands.find((b) => /Chromium/.test(b.brand))
        if (brand) {
          name = brand.brand.replace("Google ", "")
          version = brand.version
        }
        const hi = await ua.getHighEntropyValues(["platformVersion"])
        const pv = (hi.platformVersion || "").split(".")
        if (ua.platform === "macOS" && pv[0]) os = `macOS ${pv[0]}${pv[1] && pv[1] !== "0" ? `.${pv[1]}` : ""}`
        else if (ua.platform === "Windows") os = +pv[0] >= 13 ? "Windows 11" : "Windows 10"
        else if (ua.platform) os = ua.platform
      }
    } catch {}
    return [`${name} ${version}`.trim(), os].filter(Boolean).join(" · ")
  }

  async function describePage() {
    return {
      url: location.href.split("#")[0],
      origin: location.origin,
      host: location.host,
      path: location.pathname,
      title: clip(document.title || "", 200),
      lang: document.documentElement.lang || "",
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 },
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
      docSize: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
      browser: await browserLabel(),
      time: new Date().toISOString(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || ""
    }
  }

  function unmark() {
    document.querySelectorAll(`[${MARK}]`).forEach((n) => n.removeAttribute(MARK))
  }

  function failed(err) {
    state.phase = "idle"
    unmark()
    showToast(`Pixelpush could not read this page: ${err?.message || err}`, null, true)
  }

  async function pickElement(node) {
    stopPicking()
    unmark()
    state.phase = "shooting"
    try {
      node.setAttribute(MARK, "target")
      const element = await describeElement(node)
      await shoot({ kind: "element", rect: element.rect, radius: element.radius }, { element })
    } catch (err) {
      failed(err)
    }
  }

  async function pickRegion(rect) {
    stopPicking()
    unmark()
    state.phase = "shooting"
    try {
      const { best, inside } = describeRegion(rect)
      inside.slice(0, 400).forEach((n) => n.setAttribute(MARK, "inside"))
      let subject = null
      if (best) {
        best.setAttribute(MARK, "target")
        subject = await describeElement(best)
      }
      await shoot({ kind: "region", rect: { ...rect } }, { region: { rect, count: inside.length, subject } })
    } catch (err) {
      failed(err)
    }
  }

  async function shoot(anchor, details) {
    state.phase = "shooting"
    ensureHost()
    let payload
    try {
      if (anchor.kind === "window") {
        const all = describeRegion({ x: 0, y: 0, width: innerWidth, height: innerHeight })
        all.inside.slice(0, 400).forEach((n) => n.setAttribute(MARK, "inside"))
        details = { region: { rect: { x: 0, y: 0, width: innerWidth, height: innerHeight }, count: all.inside.length, subject: null } }
      }
      payload = { mode: state.mode, anchor, ...details, page: await describePage() }
    } catch (err) {
      state.phase = "idle"
      showToast(`Pixelpush could not read this page: ${err?.message || err}`, null, true)
      return
    }
    host.style.setProperty("display", "none", "important")
    await frames(2)
    await wait(40)
    let res
    try {
      res = await chrome.runtime.sendMessage({ type: "pp-capture:shoot", payload })
    } catch (err) {
      res = { ok: false, error: String(err?.message || err) }
    }
    host.style.setProperty("display", "block", "important")
    if (!res?.ok) {
      state.phase = "idle"
      unmark()
      showToast(`Capture failed: ${res?.error || "unknown error"}`, null, true)
      return
    }
    openComposer(res.captureId, anchor)
  }

  const frames = (n) => new Promise((r) => (n <= 0 ? r() : requestAnimationFrame(() => frames(n - 1).then(r))))
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  // ------------------------------------------------------------- composer
  function measureAnchor() {
    const cap = state.capture
    if (!cap) return null
    if (cap.anchor.kind !== "element") return cap.anchor
    const target = document.querySelector(`[${MARK}="target"]`)
    if (!target) return cap.anchor
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0
    cap.anchor = { ...cap.anchor, rect: rectOf(target), radius }
    return cap.anchor
  }

  function drawPin() {
    $(".pin")?.remove()
    const cap = state.capture
    if (!cap || cap.anchor.kind === "window" || !cap.anchor.rect) return
    const r = cap.anchor.rect
    const pad = cap.anchor.kind === "element" ? 4 : 0
    const pin = el("div", "pin")
    Object.assign(pin.style, {
      left: `${r.x - pad}px`,
      top: `${r.y - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
      borderRadius: `${cap.anchor.kind === "element" ? Math.min((cap.anchor.radius || 0) + 4, 28) : 4}px`
    })
    const frame = $("iframe")
    frame ? root.insertBefore(pin, frame) : root.append(pin)
  }

  function openComposer(captureId, anchor) {
    ensureHost()
    clearUi([".toast"])
    hideToast()
    state.phase = "composer"
    state.capture = { id: captureId, anchor, mode: state.mode }
    drawPin()
    const frame = document.createElement("iframe")
    frame.src = chrome.runtime.getURL(`capture/composer.html?id=${encodeURIComponent(captureId)}`)
    frame.title = "Pixelpush: new Linear issue"
    frame.setAttribute("allow", "clipboard-write")
    frame.addEventListener("load", () => focusComposer())
    root.append(frame)
    window.addEventListener("resize", onViewportChange)
    window.addEventListener("scroll", onViewportChange, true)
  }

  function focusComposer() {
    const frame = root && $("iframe")
    if (!frame) return
    try {
      frame.focus()
      frame.contentWindow?.focus()
    } catch {}
  }

  let raf = 0
  function onViewportChange() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const anchor = measureAnchor()
      drawPin()
      if (anchor && state.capture) {
        chrome.runtime.sendMessage({ type: "pp-capture:anchor", captureId: state.capture.id, anchor }).catch(() => {})
      }
    })
  }

  function closeComposer(keepMarks = false) {
    window.removeEventListener("resize", onViewportChange)
    window.removeEventListener("scroll", onViewportChange, true)
    clearUi([".toast"])
    if (!keepMarks) unmark()
    state.phase = "idle"
  }

  function teardown(msg) {
    const cap = state.capture
    const undoable = !!(msg.undo && cap)
    // Keep the subject marked while Undo is offered, so a restored composer
    // can still follow and recapture it.
    closeComposer(undoable)
    if (undoable) {
      showToast("Capture discarded", {
        label: "Undo",
        run: () => {
          state.mode = cap.mode
          openComposer(cap.id, cap.anchor)
        },
        expire: () => {
          if (state.phase === "idle") unmark()
          chrome.runtime.sendMessage({ type: "pp-capture:forget", captureId: cap.id }).catch(() => {})
        }
      })
    } else {
      state.capture = null
    }
  }

  function showToast(text, action, error = false) {
    ensureHost()
    hideToast(true)
    const toast = el("div", `toast${error ? " error" : ""}`)
    toast.setAttribute("role", error ? "alert" : "status")
    const span = el("span")
    span.textContent = text
    toast.append(span)
    if (action) {
      const btn = el("button")
      btn.textContent = action.label
      btn.addEventListener("click", () => {
        clearTimeout(state.toastTimer)
        toast.remove()
        action.run()
      })
      toast.append(btn)
    }
    root.append(toast)
    state.toastTimer = setTimeout(() => {
      toast.remove()
      action?.expire?.()
    }, 6000)
    toast._action = action
  }

  function hideToast(runExpire = false) {
    if (!root) return
    const toast = $(".toast")
    if (!toast) return
    clearTimeout(state.toastTimer)
    if (runExpire) toast._action?.expire?.()
    toast.remove()
  }

  // ------------------------------------------------- code for the AI draft
  // Fetches up to five related files the page already loaded (stylesheets
  // and, when the page serves them or their source maps, component sources)
  // so the thorough model can read code. Same-origin only, time-boxed.
  async function collectCode(hints) {
    const deadline = Date.now() + 3500
    const files = []
    const seen = new Set()
    const left = () => deadline - Date.now()
    const get = async (url, max = 4e6) => {
      if (left() < 150) return ""
      try {
        const u = new URL(url, location.href)
        if (u.origin !== location.origin) return ""
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), Math.min(1500, left()))
        const res = await fetch(u.href, { cache: "force-cache", credentials: "same-origin", signal: ctrl.signal })
        clearTimeout(t)
        if (!res.ok) return ""
        const text = await res.text()
        return text.length > max ? "" : text
      } catch {
        return ""
      }
    }
    const excerpt = (text, line, needle, span = 28) => {
      const lines = text.split("\n")
      let at = line > 0 ? line - 1 : -1
      if (at < 0 && needle) at = lines.findIndex((l) => l.includes(needle))
      const from = at < 0 ? 0 : Math.max(0, at - span)
      const to = at < 0 ? Math.min(lines.length, span * 2) : Math.min(lines.length, at + span)
      return { from: from + 1, text: clip(lines.slice(from, to).join("\n"), 5000) }
    }
    const push = (label, lang, ex) => {
      if (files.length >= 5 || !ex.text.trim() || seen.has(label)) return
      seen.add(label)
      files.push({ label, lang, from: ex.from, text: ex.text })
    }

    // Stylesheets that hold the element's rules.
    for (const rule of hints.rules || []) {
      if (files.length >= 2 || left() < 300) break
      const sheet = [...document.styleSheets].find((s) => sheetLabel(s).file === rule.file)
      if (!sheet) continue
      const text = await textOfSheet(sheet)
      if (text && text.split("\n").length > 4) push(rule.file, "css", excerpt(text, rule.line, rule.selector.split(",")[0], 14))
    }

    // Component sources: a dev server serves them as modules with inline
    // source maps; a production build may ship .map files.
    const wanted = (hints.sources || []).map((s) => s.replace(/:\d+(:\d+)?$/, "")).filter(Boolean)
    const names = hints.components || []
    const scripts = new Set()
    for (const e of performance.getEntriesByType("resource")) if (e.initiatorType === "script" || /\.(m?[jt]sx?|vue|svelte)(\?|$)/.test(e.name)) scripts.add(e.name.split("#")[0])
    for (const s of document.scripts) if (s.src) scripts.add(s.src.split("#")[0])
    const lineFor = (path) => +((hints.sources || []).find((s) => s.startsWith(path))?.match(/:(\d+)/)?.[1] || 0)

    const fromMap = (map, sourceWanted) => {
      if (!map || !Array.isArray(map.sources)) return null
      const idx = map.sources.findIndex((s) => sourceWanted.some((w) => s.endsWith(w) || s.endsWith(w.split("/").pop())))
      if (idx < 0 || !map.sourcesContent?.[idx]) return null
      return { path: map.sources[idx], text: map.sourcesContent[idx] }
    }
    const parseMap = async (code, scriptUrl) => {
      const m = code.match(/\/[/*][#@]\s*sourceMappingURL=([^\s*]+)\s*(?:\*\/)?\s*$/)
      if (!m) return null
      try {
        if (m[1].startsWith("data:")) return JSON.parse(atob(m[1].split(",")[1]))
        const text = await get(new URL(m[1], scriptUrl).href, 8e6)
        return text ? JSON.parse(text) : null
      } catch {
        return null
      }
    }

    // 1. Module URLs that end with a wanted source path (Vite and similar).
    for (const path of wanted) {
      if (files.length >= 5 || left() < 300) break
      const tail = path.replace(/^.*?(src\/)/, "$1")
      const url = [...scripts].find((s) => new URL(s).pathname.endsWith(tail)) || (tail.startsWith("src/") ? `/${tail}` : "")
      if (!url) continue
      const code = await get(url)
      if (!code) continue
      const map = await parseMap(code, new URL(url, location.href).href)
      const original = fromMap(map, [path]) || { path: tail, text: code }
      push(`${original.path.split("/").pop()}`, "tsx", excerpt(original.text, lineFor(path), names[names.length - 1]))
    }

    // 2. Bundles with source maps that contain the component files.
    if (files.length < 5 && (wanted.length || names.length) && left() > 600) {
      const targets = wanted.length ? wanted : names.map((n) => `/${n}.`)
      let tried = 0
      for (const url of scripts) {
        if (files.length >= 5 || left() < 400 || tried >= 6) break
        if (new URL(url).origin !== location.origin) continue
        tried++
        const code = await get(url)
        if (!code) continue
        const map = await parseMap(code, url)
        if (!map?.sourcesContent) continue
        map.sources.forEach((src, i) => {
          if (files.length >= 5 || !map.sourcesContent[i]) return
          const hit = targets.some((t) => (t.startsWith("/") ? src.includes(t) : src.endsWith(t) || src.endsWith(t.split("/").pop())))
          if (!hit || /node_modules/.test(src)) return
          const file = src.split("/").pop()
          const want = wanted.find((w) => src.endsWith(w) || src.endsWith(w.split("/").pop()))
          push(file, "tsx", excerpt(map.sourcesContent[i], want ? lineFor(want) : 0, names[names.length - 1]))
        })
      }
    }
    return { files, ms: 3500 - Math.max(0, left()) }
  }

  // --------------------------------------------------------------- messages
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== "string" || !msg.type.startsWith("pp-capture:")) return
    switch (msg.type) {
      case "pp-capture:ping":
        respond({ ok: true, phase: state.phase, captureId: state.capture?.id || null })
        return
      case "pp-capture:start":
        start(msg.mode === "area" || msg.mode === "window" ? msg.mode : "element")
        respond({ ok: true, phase: state.phase })
        return
      case "pp-capture:teardown":
        if (!state.capture || state.capture.id === msg.captureId) teardown(msg)
        respond({ ok: true })
        return
      case "pp-capture:focus":
        focusComposer()
        respond({ ok: true })
        return
      case "pp-capture:hide":
        if (host) host.style.setProperty("display", "none", "important")
        frames(2)
          .then(() => wait(40))
          .then(() => respond({ ok: true, anchor: measureAnchor(), viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 } }))
        return true
      case "pp-capture:show":
        if (host) host.style.setProperty("display", "block", "important")
        drawPin()
        respond({ ok: true })
        return
      case "pp-capture:code":
        collectCode(msg.hints || {}).then(respond, () => respond({ files: [] }))
        return true
    }
  })
})()
