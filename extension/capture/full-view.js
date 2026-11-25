// Full composer (design 5a): markup, per-section and per-entry control,
// model choice, every Linear field and the description preview.
import { h, cx } from "./dom.js"
import { icon, spinner } from "./icons.js"
import { fieldMenu } from "./field-menu.js"
import { COLORS, markupSvg } from "./markup.js"
import {
  componentPath,
  consoleLine,
  includedConsole,
  includedNetwork,
  isFailed,
  networkLine,
  pageRows,
  sectionNames,
  size,
  statusText,
  summaryLine
} from "./model.js"
import { avatar, metaOf, names, options, projectGlyph, teamOf, teamTile, priorityIcon, stateIcon } from "./fields.js"
import { consentCard, createButton, iconButton, keycaps, statusBlock } from "./quick-view.js"

const check = () => icon("check", 10, 3)

function box(on, size = 16) {
  return h("span", { class: cx("box", size < 16 && "sm"), "data-on": on ? "true" : "false", "aria-hidden": "true" }, check())
}

function seg(options, value, onPick, label) {
  return h(
    "div",
    { class: "seg", role: "group", "aria-label": label },
    options.map(([v, text]) =>
      h("button", { type: "button", key: String(v), class: "seg-btn", "data-on": v === value ? "true" : "false", "aria-pressed": v === value ? "true" : "false", onClick: () => onPick(v) }, text)
    )
  )
}

// ----------------------------------------------------------------- header
function header(ctx) {
  const { draft: d, actions: a } = ctx
  return h(
    "div",
    { class: "fc-head" },
    h("input", {
      class: "fc-title",
      placeholder: "Issue title",
      "aria-label": "Issue title",
      value: d.title,
      "data-focus": "title",
      onInput: (e) => a.setTitle(e.target.value)
    }),
    h(
      "button",
      { type: "button", class: "fc-collapse", title: "Back to the quick view", onClick: a.collapse },
      icon("minimize-2", 15),
      "Quick view"
    ),
    h("button", { type: "button", class: "icon-btn lg", title: "Close (Esc)", "aria-label": "Close", onClick: a.discard }, icon("x", 18))
  )
}

function well(ctx) {
  const { draft: d, cap, actions: a } = ctx
  const toggles = [["shot", "Screenshot"]]
  if (cap.kind !== "window") toggles.push(["el", cap.kind === "region" ? "Area" : "Element"])
  toggles.push(["page", "Page"], ["con", "Console"], ["net", "Network"])
  return h(
    "div",
    { class: "well fc-well" },
    h("textarea", {
      class: "fc-desc",
      placeholder: "Describe the problem in your own words. The captured details are added below this automatically.",
      "aria-label": "Description",
      value: d.body,
      "data-focus": "body",
      onInput: (e) => a.setBody(e.target.value)
    }),
    h(
      "div",
      { class: "fc-adds" },
      icon("corner-down-right", 14),
      h("span", { class: "fc-adds-label" }, "Added below your text:"),
      toggles.map(([k, label]) => {
        const empty = (k === "con" && !cap.console.length) || (k === "net" && !cap.network.length)
        return h(
          "button",
          {
            type: "button",
            key: k,
            class: "toggle",
            "data-on": d.include[k] && !empty ? "true" : "false",
            "aria-pressed": d.include[k] ? "true" : "false",
            disabled: empty,
            title: empty ? `No ${label.toLowerCase()} entries were captured` : undefined,
            onClick: () => a.toggleInclude(k)
          },
          label
        )
      }),
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "link-btn sm", onClick: () => a.setTab("pv") }, "Preview description", icon("arrow-right", 13, 2.5))
    )
  )
}

function tabs(ctx) {
  const { draft: d, cap, actions: a } = ctx
  const dot = (on) => h("span", { class: "dot", "data-on": on ? "true" : "false" })
  const issues = cap.errors + cap.failed
  const list = [["shot", "Screenshot", dot(d.include.shot)]]
  if (cap.kind !== "window") list.push(["el", cap.kind === "region" ? "Area" : "Element", dot(d.include.el)])
  list.push([
    "page",
    "Page",
    dot(d.include.page),
    issues > 0 &&
      h(
        "span",
        { class: "badge", title: `${cap.errors} console error${cap.errors === 1 ? "" : "s"}, ${cap.failed} failed request${cap.failed === 1 ? "" : "s"}` },
        String(issues)
      )
  ])
  if (ctx.ai.info?.available) list.push(["ai", "AI", icon("sparkles", 14)])
  return h(
    "div",
    { class: "fc-tabs", role: "tablist", "aria-label": "Capture details" },
    list.map(([id, label, lead, extra]) =>
      h(
        "button",
        { type: "button", key: id, class: "tab", role: "tab", "aria-selected": d.tab === id ? "true" : "false", "data-on": d.tab === id ? "true" : "false", onClick: () => a.setTab(id) },
        lead,
        label,
        extra
      )
    ),
    h("span", { class: "spacer" }),
    h(
      "button",
      { type: "button", key: "pv", class: "tab", role: "tab", "aria-selected": d.tab === "pv" ? "true" : "false", "data-on": d.tab === "pv" ? "true" : "false", onClick: () => a.setTab("pv") },
      icon("eye", 14),
      "Description preview"
    )
  )
}

// --------------------------------------------------------------- screenshot
function shotTab(ctx) {
  const { draft: d, cap, actions: a } = ctx
  const m = d.markup
  const frame = d.framing === "full" ? cap.full : cap.crop
  const tool = (id, label, name) =>
    h("button", { type: "button", key: id, class: "tool", title: label, "aria-label": label, "aria-pressed": m.tool === id ? "true" : "false", "data-on": m.tool === id ? "true" : "false", onClick: () => a.setTool(id) }, icon(name, 17))
  const pins = m.items.filter((x) => x.type === "pin")
  return h(
    "div",
    { class: "fc-pane fc-shot-pane" },
    h(
      "div",
      { class: "fc-shot-bar" },
      h(
        "div",
        { class: "fc-shot-left" },
        cap.kind !== "window" && seg([["crop", cap.kind === "region" ? "Area" : "Element"], ["full", "Full window"]], d.framing, a.setFraming, "Screenshot framing"),
        cap.kind !== "window" &&
          h("button", { type: "button", class: "check", onClick: () => a.toggleInclude("full"), "aria-pressed": d.include.full ? "true" : "false" }, box(d.include.full, 14), "Attach full window"),
        h("button", { type: "button", class: "link-btn sm", onClick: a.recapture, disabled: ctx.ui.recapturing, title: "Take the screenshot again" }, ctx.ui.recapturing ? spinner(13) : icon("scan", 13), "Recapture")
      ),
      h(
        "div",
        { class: "tools", role: "toolbar", "aria-label": "Markup tools" },
        h(
          "button",
          { type: "button", class: "tool", title: `${COLORS[m.color].name}. Change colour`, "aria-label": `Colour: ${COLORS[m.color].name}. Change colour`, onClick: a.cycleColor },
          h("span", { class: "swatch", style: `background-color:${COLORS[m.color].css}` })
        ),
        tool("pen", "Pen", "pencil"),
        tool("rect", "Box", "square"),
        tool("ellipse", "Ellipse", "circle"),
        tool("arrow", "Arrow", "arrow-up-right"),
        tool("pin", "Numbered pin", "map-pin"),
        h("span", { class: "tools-sep" }),
        h("button", { type: "button", class: "tool", title: "Undo", "aria-label": "Undo", disabled: !m.items.length, onClick: a.undo }, icon("undo-2", 17)),
        h("button", { type: "button", class: "tool", title: "Redo", "aria-label": "Redo", disabled: !m.redo.length, onClick: a.redo }, icon("redo-2", 17)),
        h("button", { type: "button", class: "tool", title: "Clear markup", "aria-label": "Clear markup", disabled: !m.items.length, onClick: a.clearMarkup }, icon("trash-2", 17))
      )
    ),
    h(
      "div",
      { class: cx("fc-stage", `tool-${m.tool}`), style: `aspect-ratio: ${frame.width} / ${frame.height}` },
      markupSvg(ctx, frame),
      h("span", { class: "fc-dims" }, `${d.framing === "full" || cap.kind === "window" ? "Full window" : cap.kind === "region" ? "Area" : "Element"} · ${size(frame)}`)
    ),
    pins.map((p) =>
      h(
        "div",
        { class: "pin-row", key: `pin-${p.n}` },
        h("span", { class: "pin-dot", style: `background-color:${COLORS[p.color]?.css || COLORS[0].css}` }, String(p.n)),
        h("input", {
          class: "pin-note",
          placeholder: `Note for pin ${p.n}`,
          "aria-label": `Note for pin ${p.n}`,
          value: p.note,
          "data-focus": `pin-${p.n}`,
          onInput: (e) => a.setPinNote(p.n, e.target.value)
        })
      )
    )
  )
}

// ------------------------------------------------------------------ element
function elementTab(ctx) {
  const { cap } = ctx
  const el = cap.el
  const rows = []
  if (cap.kind === "region") {
    const r = cap.region.rect
    rows.push(["Area", `${size(r)} at ${Math.round(r.x)}, ${Math.round(r.y)}`, false])
    rows.push(["Contains", `${cap.region.count} element${cap.region.count === 1 ? "" : "s"}${cap.insideComponents.length ? ` · ${cap.insideComponents.map(([n, c]) => `${n} ×${c}`).join(", ")}` : ""}`, false])
    if (el) rows.push(["Subject", cap.chain.length ? `<${cap.chain[cap.chain.length - 1]}>` : `<${el.tag}>`, true, true])
  }
  if (el) {
    if (cap.kind === "element" && cap.chain.length) rows.push(["Component", componentPath(cap, 4), true, true])
    if (cap.source) rows.push(["Source", cap.source, true])
    rows.push(["Selector", el.selector, true])
    rows.push(["Size", size(el.rect), true])
    if (el.text) rows.push(["Text", `“${el.text}”`, false])
    if (el.role) rows.push(["Role", `${el.role}${el.name && el.name !== el.text ? ` · “${el.name}”` : ""}`, false])
    if (el.attributes?.["data-testid"]) rows.push(["Test id", el.attributes["data-testid"], true])
  }
  const flagged = el ? el.styles.filter((s) => s.warn).length : 0
  return h(
    "div",
    { class: "fc-pane fc-el" },
    h(
      "div",
      { class: "fc-el-top" },
      h("div", { class: "fc-el-thumb" }, ctx.thumb ? h("img", { src: ctx.thumb, alt: "" }) : null),
      h(
        "div",
        { class: "kv" },
        rows.map(([k, v, mono, accent]) => [h("span", { class: "kv-k", key: `k-${k}` }, k), h("span", { class: cx("kv-v", mono && "mono", accent && "accent"), key: `v-${k}` }, v)])
      )
    ),
    el?.styles?.length > 0 &&
      h(
        "div",
        { class: "table" },
        h("div", { class: "table-head" }, h("span", {}, "COMPUTED STYLES"), flagged > 0 && h("span", { class: "amber", title: el.peerSelector ? `Compared with ${el.peers} similar elements (${el.peerSelector})` : undefined }, `${flagged} flagged`)),
        el.styles.map((s, i) =>
          h(
            "div",
            { class: cx("style-row", s.warn && "is-warn"), key: `s${i}`, title: s.note || undefined },
            h("span", { class: "style-k" }, s.k),
            h("span", { class: "style-v" }, s.v),
            h("span", { class: "style-from" }, s.warn && s.note ? `${s.from ? `${s.from} · ` : ""}${s.note}` : s.from)
          )
        )
      ),
    !el && h("p", { class: "muted" }, "No single element stood out in this area.")
  )
}

// --------------------------------------------------------------------- page
function pageTab(ctx) {
  const { draft: d, cap, actions: a } = ctx
  const cons = includedConsole(d, cap).length
  const nets = includedNetwork(d, cap)
  const onlyFailed = nets.length > 0 && nets.every(isFailed) && nets.length === cap.failed
  const section = (k, label, extra, body) =>
    h(
      "div",
      { class: "fc-section", key: k },
      h(
        "div",
        { class: "fc-section-head" },
        h("button", { type: "button", class: "check", onClick: () => a.toggleInclude(k), "aria-pressed": d.include[k] ? "true" : "false" }, box(d.include[k]), h("span", { class: "md-tag" }, `### ${label}`)),
        extra && h("span", { class: "fc-section-note" }, extra)
      ),
      body
    )
  return h(
    "div",
    { class: "fc-pane fc-page" },
    h("p", { class: "lede" }, "Each section is added under its own heading, after your text. Untick single messages or requests to leave them out."),
    section("page", "Page", null, h("div", { class: "kv kv-page" }, pageRows(cap).map(([k, v]) => [h("span", { class: "kv-k", key: `k${k}` }, k), h("span", { class: cx("kv-v", k === "URL" && "mono"), key: `v${k}` }, v)]))),
    section(
      "con",
      "Console",
      cap.console.length ? `${cons} of ${cap.console.length} included` : cap.recorder ? "Nothing logged" : "Not recorded on this page load",
      cap.console.length
        ? h(
            "div",
            { class: "con-list" },
            cap.console.map((c, i) =>
              h(
                "button",
                { type: "button", key: `c${i}`, class: "con-row", onClick: () => a.toggleEntry("con", i), "aria-pressed": d.con[i] ? "true" : "false" },
                box(d.con[i], 15),
                h("span", { class: cx("con-level", c.level) }, c.level === "error" ? "Error" : "Warn"),
                h("span", { class: "con-text" }, c.text, c.count > 1 ? ` ×${c.count}` : ""),
                h("span", { class: "con-src" }, c.src)
              )
            )
          )
        : h("p", { class: "muted indent" }, cap.recorder ? "No errors or warnings were logged before the capture." : "Pixelpush starts recording when a page loads. Reload the page and capture again to include its console.")
    ),
    section(
      "net",
      "Network",
      cap.network.length ? `${onlyFailed ? "Failed requests only · " : ""}${nets.length} of ${cap.network.length}` : "",
      cap.network.length
        ? h(
            "div",
            { class: "net-list" },
            cap.network.map((r, i) =>
              h(
                "button",
                { type: "button", key: `n${i}`, class: cx("net-row", !isFailed(r) && "is-ok"), onClick: () => a.toggleEntry("net", i), "aria-pressed": d.net[i] ? "true" : "false" },
                box(d.net[i], 15),
                h("span", { class: "net-m" }, r.m),
                h("span", { class: "net-u", title: r.u }, r.u),
                h("span", { class: cx("net-s", isFailed(r) ? "bad" : "ok") }, statusText(r)),
                h("span", { class: "net-t" }, r.t ? `${r.t} ms` : "")
              )
            )
          )
        : h("p", { class: "muted indent" }, "No fetch or XHR requests were recorded.")
    )
  )
}

// ----------------------------------------------------------------------- AI
function aiTab(ctx) {
  const { draft: d, actions: a } = ctx
  const info = ctx.ai.info
  const ai = d.ai
  const models = info.models
  const busy = ai.status === "busy"
  const current = models[ai.model] || models.fast
  const note =
    ai.model === "thorough"
      ? `${current.label} also reads the element’s stylesheet and up to 5 related source files the page loaded${info.same ? ", with more reasoning effort" : ""}. Takes longer.`
      : `${current.label} is what the quick view uses. It reads the screenshot, the captured element, its CSS and the console. Usually a few seconds.`
  return h(
    "div",
    { class: "fc-pane fc-ai" },
    h("p", { class: "lede" }, "AI writes the title and your part of the description. The captured sections are still added below it unchanged."),
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "card-row" },
        h("span", { class: "label" }, "MODEL"),
        seg([["fast", `${models.fast.label} · Fast`], ["thorough", `${models.thorough.label} · Thorough`]], ai.model, a.setAiModel, "Model")
      ),
      h("span", { class: "card-note" }, note)
    ),
    ctx.ui.consent?.where === "full" && consentCard(ctx),
    h(
      "div",
      { class: "fc-ai-run" },
      h("button", { type: "button", class: "btn-primary", onClick: () => (busy ? a.stopAi() : a.runAi("full")) }, busy ? spinner(14) : icon("sparkles", 14), busy ? "Stop" : ai.status === "done" ? "Redraft" : "Draft with AI"),
      seg([["detailed", "Detailed"], ["short", "Short"], ["steps", "With steps"]], ai.mode, a.setAiMode, "Style"),
      ai.previous && !busy && h("button", { type: "button", class: "link-btn sm", onClick: a.restoreText, title: "Put back the title and description you had before the AI draft" }, icon("rotate-ccw", 13), "Restore your text")
    ),
    ai.error && h("p", { class: "ai-error", role: "status" }, ai.error),
    ai.steps?.length > 0 &&
      (busy || ai.status === "done") &&
      h(
        "div",
        { class: "steps" },
        ai.steps.map((s, i) => {
          const done = i < ai.step || ai.status === "done"
          const now = !done && i === ai.step && busy
          return h("div", { key: `st${i}`, class: cx("step", done && "done", now && "now") }, h("span", { class: "step-mark" }, done ? "✓" : now ? "•" : "·"), s)
        })
      ),
    ai.status === "done" &&
      ai.imageDropped &&
      h("p", { class: "muted" }, `${ai.label} did not accept images, so it drafted from the page data only.`),
    ai.status === "done" &&
      ai.findings.length > 0 &&
      h(
        "div",
        { class: "table pop-in" },
        h("div", { class: "table-head" }, h("span", {}, `WHAT ${String(ai.label).toUpperCase()} FOUND IN THE CODE`)),
        ai.findings.map((f, i) => h("div", { class: "finding", key: `f${i}` }, h("span", { class: "mono accent" }, f.file), h("span", {}, f.note)))
      ),
    ai.status === "done" && ai.suggest && suggestCard(ctx)
  )
}

function suggestCard(ctx) {
  const s = ctx.draft.ai.suggest
  const bits = [s.priority && `Priority ${s.priority}`, s.labels?.length && s.labels.join(", "), s.assignee].filter(Boolean)
  return h(
    "div",
    { class: "card card-inline pop-in" },
    h(
      "div",
      { class: "card-col" },
      h("span", { class: "label" }, "SUGGESTED FIELDS"),
      h("span", { class: "card-main" }, bits.join(" · ")),
      s.why && h("span", { class: "card-note" }, s.why)
    ),
    ctx.draft.ai.applied
      ? h("span", { class: "applied" }, "Applied")
      : h("button", { type: "button", class: "btn-outline", onClick: ctx.actions.applySuggest, disabled: !metaOf(ctx) }, "Apply")
  )
}

// ------------------------------------------------------------------ preview
function previewTab(ctx) {
  const { draft: d, cap } = ctx
  const el = cap.el
  const cons = d.include.con ? includedConsole(d, cap) : []
  const nets = d.include.net ? includedNetwork(d, cap) : []
  const frame = d.framing === "full" ? cap.full : cap.crop
  const pins = d.markup.items.filter((m) => m.type === "pin" && m.note.trim())
  const names = sectionNames(d, cap)
  return h(
    "div",
    { class: "fc-pane" },
    h("p", { class: "lede" }, `As it will read in Linear · ${teamOf(ctx)?.name || "no team yet"}`),
    h(
      "div",
      { class: "pv" },
      h("span", { class: "pv-title" }, d.title.trim() || "Untitled issue"),
      d.body.trim() ? h("p", { class: "pv-body" }, d.body) : h("p", { class: "pv-empty" }, "Your text goes here. Write it above, or draft it in the AI tab."),
      h("div", { class: "pv-rule" }),
      d.include.shot &&
        h(
          "div",
          { class: "pv-sec" },
          h("span", { class: "pv-h" }, "Screenshot"),
          h("div", { class: "pv-shot", style: `aspect-ratio: ${frame.width} / ${frame.height}` }, markupSvg(ctx, frame, { interactive: false })),
          d.include.full && d.framing !== "full" && cap.kind !== "window" && h("span", { class: "muted" }, "+ the full window as a second image"),
          pins.map((p) => h("span", { key: `pp${p.n}` }, `${p.n}. ${p.note}`))
        ),
      d.include.el &&
        el &&
        cap.kind === "element" &&
        h(
          "div",
          { class: "pv-sec" },
          h("span", { class: "pv-h" }, "Element"),
          (cap.chain.length || cap.source) && h("span", {}, cap.chain.length ? h("span", { class: "mono accent" }, componentPath(cap, 4)) : null, cap.source ? [" in ", h("span", { class: "mono" }, cap.source)] : null),
          h("span", {}, "Selector: ", h("span", { class: "mono" }, el.selector)),
          h("span", {}, `Size: ${size(el.rect)}${el.text ? ` · Text: “${el.text}”` : ""}`),
          el.flags.length > 0 && h("span", { class: "amber" }, `${el.flags.map((f) => `${f.prop} ${f.value} (similar elements: ${f.expected})`).join(" · ")}`)
        ),
      d.include.el &&
        cap.kind === "region" &&
        h(
          "div",
          { class: "pv-sec" },
          h("span", { class: "pv-h" }, "Area"),
          h("span", {}, `• Size: ${size(cap.region.rect)}`),
          el && h("span", {}, "• Likely subject: ", h("span", { class: "mono" }, el.selector)),
          h("span", {}, `• Contains: ${cap.region.count} elements`)
        ),
      d.include.page &&
        h(
          "div",
          { class: "pv-sec tight" },
          h("span", { class: "pv-h" }, "Page"),
          pageRows(cap).map(([k, v]) => h("span", { key: k }, "• ", h("b", {}, `${k}:`), ` ${v}`))
        ),
      cons.length > 0 && h("div", { class: "pv-sec" }, h("span", { class: "pv-h" }, "Console"), h("pre", { class: "pv-pre" }, cons.map(consoleLine).join("\n"))),
      nets.length > 0 &&
        h("div", { class: "pv-sec" }, h("span", { class: "pv-h" }, nets.every(isFailed) ? "Failed requests" : "Network"), h("pre", { class: "pv-pre" }, nets.map(networkLine).join("\n"))),
      el && d.include.el && h("span", { class: "muted" }, "▸ Details for developers: full selector, computed styles, matching CSS rules and HTML"),
      h("span", { class: "pv-foot" }, `Captured with Pixelpush on ${cap.where}${names.length ? "" : ""}`)
    )
  )
}

// ------------------------------------------------------------------- fields
function fieldsColumn(ctx) {
  const { draft: d } = ctx
  const n = names(ctx)
  const meta = metaOf(ctx)
  const field = (id, label, trigger) =>
    h(
      "div",
      { class: "fc-field-wrap", key: id },
      h("span", { class: "label" }, label),
      fieldMenu(ctx, { id, label: label.charAt(0) + label.slice(1).toLowerCase(), variant: "field", items: options(ctx, id), selected: valueOf(d, id), trigger, disabled: ctx.linear.status !== "ready" && !ctx.linear.teams.length })
    )
  return h(
    "div",
    { class: "fc-fields" },
    field("team", "TEAM", [teamTile(teamOf(ctx), 16), h("span", { class: "fc-field-text" }, n.team)]),
    field("project", "PROJECT", [projectGlyph(), h("span", { class: "fc-field-text" }, n.project)]),
    field("status", "STATUS", [n.state ? stateIcon(n.state.type, n.state.color) : stateIcon("backlog"), h("span", { class: "fc-field-text" }, n.status)]),
    field("priority", "PRIORITY", [priorityIcon(d.fields.priority, 16), h("span", { class: "fc-field-text" }, n.priority)]),
    field("assignee", "ASSIGNEE", [avatar(n.member), h("span", { class: "fc-field-text" }, n.assignee)]),
    h(
      "div",
      { class: "fc-field-wrap" },
      h("span", { class: "label" }, "LABELS"),
      h(
        "div",
        { class: "labels" },
        meta?.labels.length
          ? meta.labels.map((l) =>
              h(
                "button",
                { type: "button", key: l.id, class: "toggle", "data-on": d.fields.labelIds.includes(l.id) ? "true" : "false", "aria-pressed": d.fields.labelIds.includes(l.id) ? "true" : "false", onClick: () => ctx.actions.toggleLabel(l.id) },
                l.name
              )
            )
          : h("span", { class: "muted" }, meta ? "This team has no labels" : ctx.linear.status === "loading" ? "Loading…" : "—")
      )
    )
  )
}

function valueOf(d, id) {
  return { team: d.fields.teamId, project: d.fields.projectId, status: d.fields.stateId, priority: d.fields.priority, assignee: d.fields.assigneeId }[id]
}

export function fullView(ctx) {
  const { draft: d, ui } = ctx
  const tab = d.tab === "ai" && !ctx.ai.info?.available ? "shot" : d.tab
  const pane = { shot: shotTab, el: elementTab, page: pageTab, ai: aiTab, pv: previewTab }[tab] || shotTab
  const status = statusBlock(ctx, "full")
  return [
    h("div", { class: "fc-backdrop", key: "fc-backdrop" }),
    h(
      "div",
      { class: "fc", key: "fc", role: "dialog", "aria-modal": "true", "aria-label": "New Linear issue", style: ui.growOrigin ? `transform-origin: ${ui.growOrigin}` : undefined },
      header(ctx),
      well(ctx),
      tabs(ctx),
      h("div", { class: "fc-grid" }, h("div", { class: "fc-main", key: `pane-${tab}` }, pane(ctx)), fieldsColumn(ctx)),
      status.length ? h("div", { class: "fc-status" }, status) : null,
      h(
        "div",
        { class: "fc-foot" },
        icon("file-text", 16),
        h("span", { class: "fc-summary" }, summaryLine(d, ctx.cap)),
        keycaps(ctx),
        createButton(ctx, "fc-create")
      )
    )
  ]
}

export { iconButton }
