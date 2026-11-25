// Capture data for the composer: what a capture record means for display,
// the default draft, and the Markdown description that goes to Linear.

export const PRIORITIES = ["No priority", "Urgent", "High", "Medium", "Low"]

export const isFailed = (r) => r.s >= 400 || (r.s === 0 && r.note !== "aborted")

export function size(r) {
  return `${Math.round(r.width)} × ${Math.round(r.height)}`
}

export function statusText(r) {
  if (r.s === -1) return "opaque"
  if (r.s === 0) return r.note === "aborted" ? "aborted" : "failed"
  return String(r.s)
}

function cropRect(kind, r, vp) {
  const full = { x: 0, y: 0, width: vp.w, height: vp.h }
  if (kind === "window" || !r) return full
  const clampToView = (c) => {
    const width = Math.min(c.width, vp.w)
    const height = Math.min(c.height, vp.h)
    return {
      x: Math.max(0, Math.min(c.x, vp.w - width)),
      y: Math.max(0, Math.min(c.y, vp.h - height)),
      width,
      height
    }
  }
  if (kind === "region") {
    const x = Math.max(0, r.x)
    const y = Math.max(0, r.y)
    return { x, y, width: Math.max(1, Math.min(r.x + r.width, vp.w) - x), height: Math.max(1, Math.min(r.y + r.height, vp.h) - y) }
  }
  // Element: the element plus room around it, framed at 16:10.
  const mx = Math.max(24, Math.min(r.width * 0.25, vp.w * 0.2))
  let width = r.width + mx * 2
  let height = Math.max(r.height + 48, width / 1.6)
  if (r.height + 48 > width / 1.6) width = Math.max(width, Math.min((r.height + 48) * 1.6, r.width + vp.w * 0.4))
  return clampToView({ x: r.x + r.width / 2 - width / 2, y: r.y + r.height / 2 - height / 2, width, height })
}

export function derive(rec) {
  const kind = rec.anchor?.kind || "window"
  const page = rec.page || {}
  const vp = page.viewport || { w: 1280, h: 800, dpr: 1 }
  const el = rec.element || rec.region?.subject || null
  const comp = rec.main?.component || null
  const chain = comp?.chain?.length ? comp.chain : el?.component ? [el.component] : []
  const consoleList = (rec.main?.console || []).filter((c) => c.level === "error" || c.level === "warn").slice(-20)
  const network = (rec.main?.network || []).slice(-40)
  const anchorRect = rec.anchor?.rect || null
  const crop = cropRect(kind, anchorRect, vp)
  let host = page.host || ""
  let pathLabel = page.path || ""
  if (!host) {
    try {
      const u = new URL(page.url)
      host = u.host
      pathLabel = u.pathname
    } catch {}
  }
  return {
    kind,
    page,
    vp,
    el,
    chain,
    source: comp?.source || "",
    definedIn: comp?.definedIn || "",
    framework: rec.main?.framework || "",
    region: rec.region || null,
    insideComponents: rec.main?.insideComponents || [],
    console: consoleList,
    network,
    recorder: rec.main ? rec.main.recorder !== false : false,
    anchorRect,
    radius: rec.anchor?.radius || el?.radius || 0,
    crop,
    full: { x: 0, y: 0, width: vp.w, height: vp.h },
    host,
    where: `${host}${pathLabel === "/" ? "" : pathLabel}`,
    errors: consoleList.filter((c) => c.level === "error").length,
    failed: network.filter(isFailed).length
  }
}

export function componentPath(cap, last = 3) {
  return cap.chain
    .slice(-last)
    .map((n) => `<${n}>`)
    .join(" › ")
}

// The short subject line under the quick view's screenshot.
export function subjectLine(cap) {
  if (cap.kind === "element") return componentPath(cap, 2) || (cap.el ? cap.el.selector.split(" > ").slice(-2).join(" › ") : "")
  const subject = cap.el
  if (subject) {
    const name = cap.chain.length ? `<${cap.chain[cap.chain.length - 1]}>` : subject.selector.split(" > ").pop()
    return `Likely subject: ${name}`
  }
  const n = cap.region?.count || 0
  return `${n} element${n === 1 ? "" : "s"}`
}

export function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date()
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return `${date} · ${time}`
}

export function pageRows(cap) {
  const vp = cap.vp
  return [
    ["URL", cap.page.url || ""],
    ["Browser", cap.page.browser || "Unknown"],
    ["Viewport", `${vp.w} × ${vp.h} @${Math.round((vp.dpr || 1) * 100) / 100}x`],
    ["App", cap.framework || "Not detected"],
    ["Captured", formatTime(cap.page.time)]
  ]
}

export function defaultDraft(cap) {
  return {
    v: 1,
    view: "quick",
    tab: "shot",
    title: "",
    body: "",
    fields: { teamId: null, projectId: null, stateId: null, priority: 0, assigneeId: null, labelIds: [] },
    include: { shot: true, full: cap.kind !== "window", el: cap.kind !== "window", page: true, con: true, net: true },
    con: cap.console.map(() => true),
    net: cap.network.map(isFailed),
    framing: cap.kind === "window" ? "full" : "crop",
    markup: { tool: "rect", color: 0, items: [], redo: [] },
    ai: { model: "fast", mode: "short", status: "idle", findings: [], suggest: null, applied: false, previous: null, label: "", error: "", steps: [], step: 0, imageDropped: false },
    created: null
  }
}

// ---------------------------------------------------------------- markdown

const esc = (s) => String(s ?? "").replace(/([\\`*_[\]<>#|~])/g, "\\$1")
function code(s) {
  const text = String(s ?? "").replace(/\n/g, " ")
  const ticks = (text.match(/`+/g) || []).reduce((m, t) => Math.max(m, t.length), 0)
  const fence = "`".repeat(ticks + 1)
  return `${fence}${ticks ? " " : ""}${text}${ticks ? " " : ""}${fence}`
}
function block(text, lang = "") {
  const ticks = (String(text).match(/`{3,}/g) || []).reduce((m, t) => Math.max(m, t.length), 2)
  const fence = "`".repeat(ticks + 1)
  return `${fence}${lang}\n${text}\n${fence}`
}
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")

export function includedConsole(draft, cap) {
  return cap.console.filter((_, i) => draft.con[i])
}
export function includedNetwork(draft, cap) {
  return cap.network.filter((_, i) => draft.net[i])
}

export function sectionNames(draft, cap, { hasShot = true } = {}) {
  const names = []
  if (draft.include.shot && hasShot) names.push("screenshot")
  if (draft.include.el && cap.kind !== "window" && cap.el) names.push(cap.kind === "region" ? "area" : "element")
  if (draft.include.page) names.push("page")
  if (draft.include.con && includedConsole(draft, cap).length) names.push("console")
  if (draft.include.net) {
    const nets = includedNetwork(draft, cap)
    if (nets.length) names.push(nets.every(isFailed) ? "failed requests" : "network")
  }
  return names
}

export function summaryLine(draft, cap) {
  const names = sectionNames(draft, cap)
  if (!names.length) return "Description: your text only"
  return `Description: your text, then ${names.length} section${names.length === 1 ? "" : "s"}: ${names.join(", ")}`
}

export function consoleLine(c) {
  return `[${c.level}] ${c.text}${c.src ? ` (${c.src})` : ""}${c.count > 1 ? ` ×${c.count}` : ""}`
}

export function networkLine(r) {
  return `${(r.m || "GET").padEnd(6)} ${r.u}  ${statusText(r)}${r.t ? `  ${r.t} ms` : ""}${r.note && r.s !== 0 ? `  (${r.note})` : ""}`
}

export function buildDescription(draft, cap, assets = {}, aiInfo = null) {
  const out = []
  const body = draft.body.trim()
  if (body) out.push(body, "---")

  if (draft.include.shot && (assets.crop || assets.full)) {
    const lines = ["### Screenshot", ""]
    const subject = cap.chain.length ? cap.chain[cap.chain.length - 1] : cap.el ? cap.el.tag : "page"
    if (assets.crop) lines.push(`![${esc(cap.kind === "window" ? `Full window of ${cap.where}` : `${subject} on ${cap.where}`)}](${assets.crop})`)
    if (assets.full) lines.push("", `![Full window of ${esc(cap.where)}](${assets.full})`)
    const pins = draft.markup.items.filter((m) => m.type === "pin" && m.note?.trim())
    if (pins.length) lines.push("", ...pins.map((p) => `${p.n}. ${esc(p.note.trim())}`))
    out.push(lines.join("\n"))
  }

  const el = cap.el
  if (draft.include.el && cap.kind !== "window" && (el || cap.region)) {
    const lines = []
    if (cap.kind === "element" && el) {
      lines.push("### Element", "")
      const path = componentPath(cap, 4)
      if (path || cap.source) lines.push([path && code(path), cap.source && `in ${code(cap.source)}`].filter(Boolean).join(" "), "")
      lines.push(`- **Selector:** ${code(el.selector)}`, `- **Size:** ${size(el.rect)}`)
      if (el.text) lines.push(`- **Text:** “${esc(el.text)}”`)
      if (el.role && (el.name || "") !== (el.text || "")) lines.push(`- **Accessibility:** ${esc(el.role)}${el.name ? `, named “${esc(el.name)}”` : ", no accessible name"}`)
      if (el.attributes?.["data-testid"]) lines.push(`- **Test id:** ${code(el.attributes["data-testid"])}`)
    } else {
      const r = cap.region.rect
      lines.push("### Area", "", `- **Size:** ${size(r)} at ${Math.round(r.x)}, ${Math.round(r.y)} in the viewport`)
      if (el) {
        const name = cap.chain.length ? `<${cap.chain[cap.chain.length - 1]}>` : el.tag
        lines.push(`- **Likely subject:** ${code(name)} ${code(el.selector)}${cap.source ? ` in ${code(cap.source)}` : ""}`)
      }
      const comps = cap.insideComponents.map(([n, c]) => `${n} ×${c}`).join(", ")
      lines.push(`- **Contains:** ${cap.region.count} element${cap.region.count === 1 ? "" : "s"}${comps ? ` · ${esc(comps)}` : ""}`)
    }
    if (el?.flags?.length) {
      lines.push(
        "",
        `**Differs from ${el.peers} similar element${el.peers === 1 ? "" : "s"}**${el.peerSelector ? ` (${code(el.peerSelector)})` : ""}`,
        "",
        "| Property | This element | Similar elements | Set by |",
        "| --- | --- | --- | --- |",
        ...el.flags.map((f) => {
          const row = el.styles.find((s) => s.k === f.prop)
          return `| ${cell(f.prop)} | ${cell(f.value)} | ${cell(f.expected)} | ${cell(row?.from || "")} |`
        })
      )
    }
    out.push(lines.join("\n"))
  }

  if (draft.include.page) {
    out.push(["### Page", "", ...pageRows(cap).map(([k, v]) => `- **${k}:** ${k === "URL" ? v : esc(v)}`)].join("\n"))
  }

  const cons = draft.include.con ? includedConsole(draft, cap) : []
  if (cons.length) out.push(["### Console", "", block(cons.map(consoleLine).join("\n"), "text")].join("\n"))

  const nets = draft.include.net ? includedNetwork(draft, cap) : []
  if (nets.length) {
    out.push([`### ${nets.every(isFailed) ? "Failed requests" : "Network"}`, "", block(nets.map(networkLine).join("\n"), "text")].join("\n"))
  }

  const details = []
  if (el && draft.include.el) {
    details.push(`**Full selector:** ${code(el.selectorPath)}`)
    if (cap.definedIn && cap.definedIn !== cap.source) details.push(`**Rendered in:** ${code(cap.definedIn)}`)
    if (el.styles?.length) {
      details.push(
        ["**Computed styles**", "", "| Property | Value | Set by |", "| --- | --- | --- |", ...el.styles.map((s) => `| ${cell(s.k)}${s.warn ? " ⚠" : ""} | ${cell(s.v)} | ${cell(s.from)} |`)].join("\n")
      )
    }
    const rules = (el.rules || []).slice(-8)
    if (rules.length) {
      details.push(["**Matching CSS rules**", "", block(rules.map((r) => `/* ${r.source}${r.media ? ` @media ${r.media}` : ""} */\n${r.selector} { ${r.css} }`).join("\n\n"), "css")].join("\n"))
    }
    if (el.html) details.push(["**HTML**", "", block(el.html, "html")].join("\n"))
  }
  if (draft.ai.findings?.length) {
    details.push(
      [`**What ${draft.ai.label || "AI"} found in the code**`, "", ...draft.ai.findings.map((f) => `- ${code(f.file)}: ${esc(f.note)}`)].join("\n")
    )
  }
  if (details.length) out.push(["+++ Details for developers", "", details.join("\n\n"), "", "+++"].join("\n"))

  out.push(`_Captured with [Pixelpush](https://github.com/andrewr303/pixelpush) on ${esc(cap.where)}${aiInfo ? ` · drafted with ${esc(aiInfo)}` : ""}_`)
  return out.join("\n\n")
}
