// A small view layer for the capture pages: h() builds a description of the
// DOM, morph() makes the live DOM match it. Elements are reused when the tag
// (and key, if given) match, so focus, caret, scroll and CSS animations
// survive a re-render.

const SVG_NS = "http://www.w3.org/2000/svg"

export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: flat(children), key: props?.key }
}

// Trusted markup written in this repository (icons). Never pass page data here.
export function raw(html, props = {}) {
  return { tag: "#raw", html, props, key: props.key }
}

function flat(list, out = []) {
  for (const c of list) {
    if (c == null || c === false || c === true) continue
    if (Array.isArray(c)) flat(c, out)
    else out.push(typeof c === "object" ? c : { tag: "#text", text: String(c) })
  }
  return out
}

export function morph(parent, vnodes) {
  patchChildren(parent, flat(Array.isArray(vnodes) ? vnodes : [vnodes]), parent.namespaceURI === SVG_NS)
}

function sameKind(node, v) {
  if (!node) return false
  if (v.tag === "#text") return node.nodeType === 3
  if (v.tag === "#raw") return node._raw !== undefined && node._raw === v.html && node._key === v.key
  return node.nodeType === 1 && node._raw === undefined && node.localName === v.tag && node._key === v.key
}

function patchChildren(parent, vnodes, svg) {
  const keyed = new Map()
  for (const node of parent.childNodes) if (node._key != null) keyed.set(node._key, node)
  let i = 0
  for (const v of vnodes) {
    const current = parent.childNodes[i] || null
    let node = null
    if (v.key != null) {
      const found = keyed.get(v.key)
      if (found && sameKind(found, v)) node = found
    } else if (sameKind(current, v)) node = current
    if (node) {
      if (node !== current) parent.insertBefore(node, current)
      update(node, v, svg)
    } else {
      parent.insertBefore(create(v, svg), current)
    }
    i++
  }
  while (parent.childNodes.length > i) parent.removeChild(parent.lastChild)
}

function create(v, svg) {
  if (v.tag === "#text") return document.createTextNode(v.text)
  if (v.tag === "#raw") {
    const tpl = document.createElement("template")
    tpl.innerHTML = v.html.trim()
    const node = tpl.content.firstElementChild || document.createElement("span")
    node._raw = v.html
    node._key = v.key
    applyProps(node, v.props, true)
    return node
  }
  const isSvg = svg || v.tag === "svg"
  const el = isSvg ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag)
  el._key = v.key
  applyProps(el, v.props, isSvg)
  patchChildren(el, v.children, isSvg && v.tag !== "foreignObject")
  if (typeof v.props.ref === "function") queueMicrotask(() => v.props.ref(el))
  return el
}

function update(node, v, svg) {
  if (v.tag === "#text") {
    if (node.data !== v.text) node.data = v.text
    return
  }
  applyProps(node, v.props, svg || v.tag === "svg")
  if (v.tag !== "#raw") patchChildren(node, v.children, (svg || v.tag === "svg") && v.tag !== "foreignObject")
  if (typeof v.props.ref === "function") queueMicrotask(() => v.props.ref(node))
}

function applyProps(el, props, svg) {
  const prev = el._props || {}
  for (const name of Object.keys(prev)) {
    if (name in props) continue
    if (name.startsWith("on")) el._on && delete el._on[name.slice(2).toLowerCase()]
    else if (name !== "key" && name !== "ref") el.removeAttribute(name === "className" ? "class" : name)
  }
  for (const [name, value] of Object.entries(props)) {
    if (name === "key" || name === "ref") continue
    if (name.startsWith("on") && typeof value === "function") {
      const type = name.slice(2).toLowerCase()
      el._on ||= {}
      el._bound ||= new Set()
      el._on[type] = value
      if (!el._bound.has(type)) {
        el._bound.add(type)
        el.addEventListener(type, (e) => el._on?.[type]?.(e))
      }
      continue
    }
    if (name === "value" && !svg) {
      if (el.value !== String(value ?? "")) el.value = String(value ?? "")
      continue
    }
    if (name === "checked" || name === "indeterminate") {
      el[name] = !!value
      continue
    }
    const attr = name === "className" ? "class" : name
    if (value == null || value === false) {
      if (el.hasAttribute(attr)) el.removeAttribute(attr)
    } else {
      const text = value === true ? "" : String(value)
      if (el.getAttribute(attr) !== text) el.setAttribute(attr, text)
    }
  }
  el._props = props
}

export function cx(...names) {
  return names.filter(Boolean).join(" ")
}
