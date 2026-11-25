// Capture composer. Runs in a transparent full-viewport frame over the page.
// One draft per capture is shared by the quick view and the full composer,
// so switching views never loses text, fields, markup or AI results. The
// draft is saved to the capture record (IndexedDB in the service worker)
// 300 ms after each change, so reloading the frame restores it.
import { h, morph } from "./dom.js"
import { derive, defaultDraft, buildDescription, includedConsole, includedNetwork, PRIORITIES } from "./model.js"
import { quickView, placeQuick } from "./quick-view.js"
import { fullView } from "./full-view.js"
import { menuKey, outsidePointer, close as closeMenu } from "./field-menu.js"
import { exportImage, blobToDataUrl, undo, redo, COLORS } from "./markup.js"
import { metaOf } from "./fields.js"
import * as linear from "./linear.js"

const captureId = new URLSearchParams(location.search).get("id") || ""
const root = document.getElementById("app")
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)")

const ctx = {
  captureId,
  rec: null,
  cap: null,
  draft: null,
  img: null,
  thumb: "",
  liveAnchor: null,
  mac: /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform),
  linear: { status: "loading", ws: null, teams: [], meta: {}, error: "" },
  ai: { info: null },
  ui: { menu: null, menuActive: 0, busy: false, phase: "", error: null, consent: null, drawing: null, growOrigin: "", fatal: "" },
  focusNext: null,
  restoreFocus: null,
  render,
  update,
  focus: (key) => {
    ctx.focusNext = key
    render()
  }
}

const send = (type, extra = {}) =>
  chrome.runtime.sendMessage({ type: `pp-capture:${type}`, captureId, ...extra }).catch((err) => ({ ok: false, error: String(err?.message || err) }))

// ------------------------------------------------------------------ render
let rendering = false
function render() {
  if (rendering) return
  rendering = true
  try {
    if (ctx.ui.fatal) morph(root, fatalView())
    else if (!ctx.draft) morph(root, [])
    else morph(root, ctx.draft.view === "full" ? fullView(ctx) : quickView(ctx))
    document.body.dataset.view = ctx.draft?.view || "loading"
  } finally {
    rendering = false
  }
  afterRender()
}

function fatalView() {
  return h(
    "div",
    { class: "qv qv-fatal", key: "fatal", role: "alertdialog", "aria-label": "Capture unavailable" },
    h(
      "div",
      { class: "qv-inner" },
      h(
        "div",
        { class: "qv-created" },
        h("span", { class: "qv-created-id" }, "This capture is no longer available"),
        h("span", { class: "qv-created-title" }, ctx.ui.fatal),
        h("div", { class: "qv-created-actions" }, h("button", { type: "button", class: "btn-ghost sm", "data-focus": "close", onClick: () => send("close") }, "Close"))
      )
    )
  )
}

const supportsFieldSizing = CSS.supports("field-sizing", "content")
function afterRender() {
  if (!supportsFieldSizing) {
    for (const ta of root.querySelectorAll("textarea[data-autogrow]")) {
      ta.style.height = "auto"
      ta.style.height = `${ta.scrollHeight}px`
    }
  }
  if (ctx.draft?.view !== "full" || ctx.ui.fatal) placeQuick(ctx, root)
  // Open a menu upward when it would run past the bottom of the window.
  const list = root.querySelector(".fm-list")
  if (list && ctx.ui.menuUp === undefined) {
    const r = list.getBoundingClientRect()
    const trigger = list.parentElement.getBoundingClientRect()
    ctx.ui.menuUp = r.bottom > innerHeight - 8 && trigger.top - r.height - 8 > 0
    list.classList.toggle("up", ctx.ui.menuUp)
  }
  const key = ctx.focusNext || ctx.restoreFocus
  ctx.focusNext = ctx.restoreFocus = null
  if (key) {
    const target = root.querySelector(`[data-focus="${CSS.escape(key)}"]`)
    if (target) {
      target.focus({ preventScroll: false })
      if (target.setSelectionRange && (key === "title" || key === "body")) {
        const n = target.value.length
        target.setSelectionRange(n, n)
      }
    }
  }
}

const resizeObserver = new ResizeObserver(() => {
  if (ctx.draft?.view !== "full") placeQuick(ctx, root)
})
new MutationObserver(() => {
  const qv = root.querySelector(".qv")
  if (qv && !qv._observed) {
    qv._observed = true
    resizeObserver.observe(qv)
  }
}).observe(root, { childList: true })

// --------------------------------------------------------------- the draft
let saveTimer = 0
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => send("save-draft", { draft: ctx.draft }), 300)
}

function update(fn) {
  fn(ctx.draft)
  save()
  render()
}

function hasContent() {
  const d = ctx.draft
  return !!(d && (d.title.trim() || d.body.trim() || d.markup.items.length))
}

async function makeThumb() {
  try {
    const d = ctx.draft
    const frame = d.framing === "full" ? ctx.cap.full : ctx.cap.crop
    const blob = await exportImage(ctx, frame, { maxWidth: 480, type: "image/jpeg", quality: 0.88 })
    if (ctx.thumb) URL.revokeObjectURL(ctx.thumb)
    ctx.thumb = URL.createObjectURL(blob)
    render()
  } catch {}
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("The screenshot could not be read"))
    img.src = src
  })
}

// ------------------------------------------------------------------ Linear
async function loadLinear() {
  ctx.linear.status = "loading"
  ctx.linear.error = ""
  render()
  const ws = await linear.workspace()
  if (!ws) {
    ctx.linear.status = "off"
    return render()
  }
  ctx.linear.ws = ws
  try {
    ctx.linear.teams = await linear.teams(ws)
    const last = (await chrome.storage.local.get("pixelpushCaptureFields")).pixelpushCaptureFields || {}
    let teamId = ctx.draft.fields.teamId
    const fresh = !ctx.linear.teams.some((t) => t.id === teamId)
    if (fresh) teamId = ctx.linear.teams.find((t) => t.id === last.teamId)?.id || ctx.linear.teams[0]?.id || null
    if (teamId) await selectTeam(teamId, { keep: !fresh, lastProject: fresh && teamId === last.teamId ? last.projectId : null })
    ctx.linear.status = "ready"
  } catch (err) {
    ctx.linear.status = "error"
    ctx.linear.error = err.message
  }
  render()
}

async function selectTeam(teamId, { keep = false, lastProject = null } = {}) {
  update((d) => {
    d.fields.teamId = teamId
  })
  const meta = await linear.teamMeta(ctx.linear.ws, teamId)
  ctx.linear.meta[teamId] = meta
  if (ctx.draft.fields.teamId !== teamId) return
  update((d) => {
    const f = d.fields
    if (!keep || !meta.states.some((s) => s.id === f.stateId)) f.stateId = meta.defaultStateId
    if (lastProject && meta.projects.some((p) => p.id === lastProject)) f.projectId = lastProject
    if (!meta.projects.some((p) => p.id === f.projectId)) f.projectId = null
    if (!meta.members.some((m) => m.id === f.assigneeId)) f.assigneeId = null
    f.labelIds = f.labelIds.filter((id) => meta.labels.some((l) => l.id === id))
  })
}

// ---------------------------------------------------------------------- AI
async function loadAi() {
  const info = await send("ai-info")
  ctx.ai.info = info?.available ? info : null
  if (ctx.ai.info && ctx.draft.ai.status === "idle" && !ctx.draft.ai.touched) ctx.draft.ai.model = info.choice
  if (ctx.draft.ai.status === "busy") ctx.draft.ai.status = "idle"
  render()
}

async function runAi(where) {
  const info = ctx.ai.info
  const d = ctx.draft
  if (!info || d.ai.status === "busy") return
  const model = where === "quick" ? "fast" : d.ai.model
  const mode = where === "quick" ? "short" : d.ai.mode
  if (!info.consent) {
    ctx.ui.consent = { where, model, mode }
    ctx.focusNext = "consent"
    return render()
  }
  update((dr) => {
    dr.ai.status = "busy"
    dr.ai.error = ""
    dr.ai.steps = []
    dr.ai.step = 0
  })
  let image = null
  if (d.include.shot) {
    try {
      const frame = d.framing === "full" ? ctx.cap.full : ctx.cap.crop
      image = await blobToDataUrl(await exportImage(ctx, frame, { maxWidth: 1280, type: "image/jpeg", quality: 0.82 }))
    } catch {}
  }
  const meta = metaOf(ctx)
  const res = await send("ai", {
    model,
    mode,
    title: d.title,
    body: d.body,
    image,
    console: d.include.con ? includedConsole(d, ctx.cap) : [],
    network: d.include.net ? includedNetwork(d, ctx.cap) : [],
    linear: {
      priorities: PRIORITIES,
      labels: (meta?.labels || []).map((l) => l.name).slice(0, 80),
      assignees: (meta?.members || []).map((m) => m.name).slice(0, 80)
    }
  })
  if (!res?.ok) {
    if (res?.error === "consent-required") {
      info.consent = false
      update((dr) => (dr.ai.status = "idle"))
      return runAi(where)
    }
    return update((dr) => {
      dr.ai.status = dr.ai.findings.length || dr.ai.label ? "done" : "idle"
      dr.ai.error = res?.error === "Cancelled." ? "" : res?.error || "The AI request failed."
      if (dr.ai.status === "done" && !dr.ai.label) dr.ai.status = "idle"
    })
  }
  const r = res.result
  update((dr) => {
    dr.ai.previous ||= { title: dr.title, body: dr.body }
    dr.title = r.title
    dr.body = r.body
    dr.ai.status = "done"
    dr.ai.findings = r.findings
    dr.ai.suggest = r.suggest
    dr.ai.applied = false
    dr.ai.label = r.model
    dr.ai.imageDropped = r.imageDropped
    dr.ai.steps = r.steps || dr.ai.steps
    dr.ai.step = (r.steps || dr.ai.steps).length
  })
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.captureId !== captureId || sender.id !== chrome.runtime.id) return
  if (msg.type === "pp-capture:ai-progress" && !sender.tab && ctx.draft?.ai.status === "busy") {
    ctx.draft.ai.steps = msg.steps
    ctx.draft.ai.step = msg.step
    render()
  } else if (msg.type === "pp-capture:anchor" && sender.tab && sender.tab.id === ctx.rec?.tabId) {
    ctx.liveAnchor = msg.anchor
    render()
  }
})

// ----------------------------------------------------------------- create
function fileName(kind) {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`
  const host = (ctx.cap.host || "page").replace(/[^a-z0-9.-]/gi, "-")
  return `pixelpush-${host}-${stamp}${kind ? `-${kind}` : ""}.png`
}

async function create() {
  const d = ctx.draft
  if (ctx.ui.busy || d.view === "created") return
  closeMenu(ctx, false)
  ctx.ui.error = null
  if (!d.title.trim()) {
    ctx.ui.error = { text: "Add a title before creating the issue." }
    ctx.focusNext = "title"
    return render()
  }
  if (ctx.linear.status === "off") {
    ctx.ui.error = { text: "Linear is not connected. Add a personal API key on the side panel’s Issue tab.", action: { label: "Open side panel", run: openPanel } }
    return render()
  }
  if (!ctx.linear.ws || !d.fields.teamId) {
    ctx.ui.error = { text: ctx.linear.status === "loading" ? "Linear is still loading. Try again in a moment." : "Pick a team first." }
    return render()
  }
  ctx.ui.busy = true
  ctx.ui.phase = d.include.shot ? "Uploading screenshot…" : "Creating issue…"
  render()
  try {
    const ws = ctx.linear.ws
    const assets = {}
    if (d.include.shot) {
      const frame = d.framing === "full" ? ctx.cap.full : ctx.cap.crop
      assets.crop = await linear.uploadImage(ws, await exportImage(ctx, frame), fileName(""))
      if (d.include.full && d.framing !== "full" && ctx.cap.kind !== "window") {
        assets.full = await linear.uploadImage(ws, await exportImage(ctx, ctx.cap.full), fileName("full-window"))
      }
    }
    ctx.ui.phase = "Creating issue…"
    render()
    const f = d.fields
    const input = {
      teamId: f.teamId,
      title: d.title.trim(),
      description: buildDescription(d, ctx.cap, assets, d.ai.status === "done" ? d.ai.label : null),
      priority: f.priority || 0,
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.stateId ? { stateId: f.stateId } : {}),
      ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
      ...(f.labelIds.length ? { labelIds: f.labelIds } : {})
    }
    const issue = await linear.createIssue(ws, input)
    if (ctx.cap.page.url) linear.attachLink(ws, issue.id, ctx.cap.page.url, ctx.cap.page.title || ctx.cap.where)
    chrome.storage.local.set({ pixelpushCaptureFields: { teamId: f.teamId, projectId: f.projectId } })
    ctx.ui.busy = false
    ctx.ui.phase = ""
    update((dr) => {
      dr.view = "created"
      dr.created = {
        identifier: issue.identifier,
        url: issue.url,
        team: issue.team?.name || ctx.linear.teams.find((t) => t.id === f.teamId)?.name || "Linear",
        title: issue.title
      }
    })
    ctx.focusNext = "open-linear"
    render()
  } catch (err) {
    ctx.ui.busy = false
    ctx.ui.phase = ""
    ctx.ui.error = { text: `Could not create the issue. ${err?.message || err}`, action: { label: "Retry", run: create } }
    render()
  }
}

function openPanel() {
  const tabId = ctx.rec?.tabId
  if (typeof tabId !== "number" || !chrome.sidePanel) return
  chrome.sidePanel.setOptions({ tabId, enabled: true, path: `sidepanel.html?tabId=${tabId}` })
  chrome.sidePanel.open({ tabId }).catch(() => {
    ctx.ui.error = { text: "Chrome did not open the side panel. Click the Pixelpush icon and choose Open side panel." }
    render()
  })
}

// ----------------------------------------------------------------- actions
function growOriginFromQuick() {
  const qv = root.querySelector(".qv")
  if (!qv || reduceMotion.matches) return ""
  const r = qv.getBoundingClientRect()
  const w = Math.min(1120, innerWidth - 80)
  const hgt = Math.min(832, innerHeight - 68)
  const left = (innerWidth - w) / 2
  const top = (innerHeight - hgt) / 2
  return `${Math.round(r.left + r.width / 2 - left)}px ${Math.round(r.top + r.height / 2 - top)}px`
}

ctx.actions = {
  setTitle: (v) => update((d) => (d.title = v.replace(/\n/g, " "))),
  setBody: (v) => update((d) => (d.body = v)),
  expand(tab) {
    closeMenu(ctx, false)
    ctx.ui.growOrigin = growOriginFromQuick()
    ctx.ui.consent = null
    update((d) => {
      d.view = "full"
      d.tab = tab
    })
    if (!document.activeElement || document.activeElement === document.body) ctx.focus("title")
  },
  collapse() {
    closeMenu(ctx, false)
    ctx.ui.consent = null
    update((d) => (d.view = "quick"))
    makeThumb()
    ctx.focus("title")
  },
  setTab: (tab) => update((d) => (d.tab = tab)),
  discard() {
    clearTimeout(saveTimer)
    const undoable = hasContent()
    send("save-draft", { draft: ctx.draft }).then(() => send("close", { undo: undoable }))
  },
  close: () => send("close", { undo: false }),
  create,
  newCapture: () => send("new", { mode: ctx.rec?.mode }),
  openLinear() {
    const url = ctx.draft.created?.url
    if (url && /^https:\/\/linear\.app\//.test(url)) chrome.tabs.create({ url, active: true })
  },
  openPanel,
  reloadLinear: () => loadLinear(),
  setTeam: (id) => {
    if (id !== ctx.draft.fields.teamId) selectTeam(id).catch((err) => ((ctx.linear.error = err.message), (ctx.linear.status = "error"), render()))
  },
  setField: (key, value) => update((d) => (d.fields[key] = value)),
  toggleLabel: (id) =>
    update((d) => {
      const set = new Set(d.fields.labelIds)
      set.has(id) ? set.delete(id) : set.add(id)
      d.fields.labelIds = [...set]
    }),
  toggleInclude: (k) => update((d) => (d.include[k] = !d.include[k])),
  toggleEntry: (k, i) => update((d) => (d[k][i] = !d[k][i])),
  setFraming(f) {
    update((d) => (d.framing = f))
    makeThumb()
  },
  setTool: (t) => update((d) => (d.markup.tool = t)),
  cycleColor: () => update((d) => (d.markup.color = (d.markup.color + 1) % COLORS.length)),
  undo: () => update((d) => undo(d)),
  redo: () => update((d) => redo(d)),
  clearMarkup: () =>
    update((d) => {
      d.markup.redo = [...d.markup.items].reverse()
      d.markup.items = []
    }),
  setPinNote: (n, v) =>
    update((d) => {
      const pin = d.markup.items.find((m) => m.type === "pin" && m.n === n)
      if (pin) pin.note = v
    }),
  async recapture() {
    if (ctx.ui.recapturing) return
    ctx.ui.recapturing = true
    ctx.ui.error = null
    render()
    const res = await send("recapture")
    ctx.ui.recapturing = false
    if (!res?.ok) {
      ctx.ui.error = { text: `Recapture failed. ${res?.error || ""}`.trim() }
      return render()
    }
    ctx.rec.shot = res.shot
    ctx.rec.anchor = res.anchor
    ctx.rec.page = res.page
    ctx.cap = derive(ctx.rec)
    ctx.liveAnchor = res.anchor
    ctx.img = await loadImage(res.shot)
    render()
    makeThumb()
  },
  runAi,
  stopAi() {
    send("ai-abort")
    update((d) => (d.ai.status = d.ai.label ? "done" : "idle"))
  },
  setAiModel(m) {
    send("ai-model", { choice: m })
    update((d) => {
      d.ai.model = m
      d.ai.touched = true
    })
  },
  setAiMode: (m) => update((d) => (d.ai.mode = m)),
  async acceptConsent() {
    const pending = ctx.ui.consent
    ctx.ui.consent = null
    const res = await send("ai-consent")
    if (res?.ok && ctx.ai.info) ctx.ai.info.consent = true
    render()
    if (res?.ok && pending) runAi(pending.where)
  },
  cancelConsent() {
    ctx.ui.consent = null
    render()
  },
  restoreText() {
    update((d) => {
      if (!d.ai.previous) return
      d.title = d.ai.previous.title
      d.body = d.ai.previous.body
      d.ai.previous = null
    })
  },
  applySuggest() {
    const meta = metaOf(ctx)
    const s = ctx.draft.ai.suggest
    if (!meta || !s) return
    update((d) => {
      if (s.priority) d.fields.priority = Math.max(0, PRIORITIES.indexOf(s.priority))
      const ids = (s.labels || []).map((n) => meta.labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id).filter(Boolean)
      if (ids.length) d.fields.labelIds = [...new Set([...d.fields.labelIds, ...ids])]
      if (s.assignee) {
        const m = meta.members.find((x) => x.name.toLowerCase() === s.assignee.toLowerCase())
        if (m) d.fields.assigneeId = m.id
      }
      d.ai.applied = true
    })
  }
}

// ---------------------------------------------------------------- keyboard
document.addEventListener("keydown", (e) => {
  if (!ctx.draft) {
    if (e.key === "Escape" && ctx.ui.fatal) send("close")
    return
  }
  if (menuKey(ctx, e)) return
  if (e.key === "Tab") {
    // Keep focus inside the composer: the page behind it is covered.
    const box = root.querySelector(".fc, .qv")
    const items = box ? [...box.querySelectorAll("button, input, textarea, [tabindex]:not([tabindex='-1'])")].filter((n) => !n.disabled && n.getClientRects().length) : []
    if (items.length) {
      const first = items[0]
      const last = items[items.length - 1]
      if (!box.contains(document.activeElement)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    }
    return
  }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    if (ctx.draft.view !== "created") create()
    return
  }
  if (e.key === "Escape") {
    e.preventDefault()
    if (ctx.ui.consent) return ctx.actions.cancelConsent()
    if (ctx.ui.drawing) {
      ctx.ui.drawing = null
      return render()
    }
    if (ctx.draft.view === "created") return ctx.actions.close()
    return ctx.actions.discard()
  }
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")
  if (ctx.draft.view === "full" && ctx.draft.tab === "shot" && !typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault()
    e.shiftKey ? ctx.actions.redo() : ctx.actions.undo()
  }
})
document.addEventListener("pointerdown", (e) => outsidePointer(ctx, e), true)
addEventListener("resize", () => render())
addEventListener("focus", () => {
  if (ctx.draft && (!document.activeElement || document.activeElement === document.body)) ctx.focus(ctx.draft.view === "created" ? "open-linear" : "title")
})

// -------------------------------------------------------------------- boot
async function boot() {
  if (!captureId) {
    ctx.ui.fatal = "No capture was given to this window."
    return render()
  }
  const res = await send("get")
  if (!res?.ok) {
    ctx.ui.fatal = res?.error || "Start a new capture from the Pixelpush menu."
    return render()
  }
  ctx.rec = res.record
  ctx.cap = derive(ctx.rec)
  ctx.liveAnchor = ctx.rec.anchor
  const base = defaultDraft(ctx.cap)
  const saved = ctx.rec.draft
  ctx.draft = saved && saved.v === base.v ? { ...base, ...saved, ai: { ...base.ai, ...saved.ai }, markup: { ...base.markup, ...saved.markup } } : base
  if (ctx.draft.ai.status === "busy") ctx.draft.ai.status = ctx.draft.ai.label ? "done" : "idle"
  try {
    ctx.img = await loadImage(ctx.rec.shot)
  } catch (err) {
    ctx.ui.fatal = err.message
    return render()
  }
  ctx.focusNext = ctx.draft.view === "created" ? "open-linear" : "title"
  render()
  makeThumb()
  loadLinear()
  loadAi()
}

boot()
