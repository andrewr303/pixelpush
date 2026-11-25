// Quick view (design 5b): the popover beside the captured element.
import { h, cx } from "./dom.js"
import { icon, spinner } from "./icons.js"
import { fieldMenu } from "./field-menu.js"
import { size, subjectLine } from "./model.js"
import { names, options, teamOf, teamTile, priorityIcon } from "./fields.js"

const W = 380

export function iconButton(name, label, onClick, cls = "icon-btn", sz = 16) {
  return h("button", { type: "button", class: cls, title: label, "aria-label": label, onClick }, icon(name, sz))
}

export function keycaps(ctx) {
  return h("span", { class: "keys", "aria-hidden": "true" }, h("kbd", {}, ctx.mac ? "⌘" : "Ctrl"), h("kbd", {}, "↵"))
}

export function statusBlock(ctx, where) {
  const { ui, linear } = ctx
  const out = []
  if (ui.error) {
    out.push(
      h(
        "div",
        { class: "banner is-error", role: "alert" },
        h("span", { class: "banner-text" }, ui.error.text),
        ui.error.action && h("button", { type: "button", class: "banner-btn", onClick: ui.error.action.run }, ui.error.action.label)
      )
    )
  } else if (linear.status === "off" && where) {
    out.push(
      h(
        "div",
        { class: "banner" },
        h("span", { class: "banner-text" }, "Linear is not connected. Add a personal API key on the side panel’s Issue tab."),
        h("button", { type: "button", class: "banner-btn", onClick: ctx.actions.openPanel }, "Open side panel")
      )
    )
  } else if (linear.status === "error") {
    out.push(
      h(
        "div",
        { class: "banner is-error", role: "alert" },
        h("span", { class: "banner-text" }, `Could not load Linear: ${linear.error}`),
        h("button", { type: "button", class: "banner-btn", onClick: ctx.actions.reloadLinear }, "Retry")
      )
    )
  }
  return out
}

export function createButton(ctx, cls) {
  const busy = ctx.ui.busy
  return h(
    "button",
    { type: "button", class: cx("btn-primary", cls), onClick: ctx.actions.create, disabled: busy, "aria-busy": busy ? "true" : undefined },
    busy && spinner(14),
    busy ? ctx.ui.phase || "Creating…" : "Create issue"
  )
}

export function consentCard(ctx) {
  const info = ctx.ai.info
  if (!ctx.ui.consent || !info) return null
  return h(
    "div",
    { class: "consent", role: "alertdialog", "aria-label": "Send this capture to your AI provider?" },
    h(
      "p",
      {},
      `Pixelpush does not host a model. Drafting sends ${info.endpoint} the screenshot, the captured element’s HTML, styles and matching CSS, the page URL, and the console and network lines you include. Thorough mode also sends excerpts of related files the page loaded. It never sends cookies, form values or keys.`
    ),
    h(
      "div",
      { class: "consent-actions" },
      h("button", { type: "button", class: "btn-ghost sm", onClick: ctx.actions.cancelConsent }, "Cancel"),
      h("button", { type: "button", class: "btn-primary sm", "data-focus": "consent", onClick: ctx.actions.acceptConsent }, "Continue")
    )
  )
}

function created(ctx) {
  const c = ctx.draft.created
  return h(
    "div",
    { class: "qv-created" },
    iconButton("x", "Close", ctx.actions.close, "icon-btn qv-created-close"),
    h("span", { class: "qv-check" }, icon("check", 18, 3)),
    h(
      "div",
      { class: "qv-created-text" },
      h("span", { class: "qv-created-id" }, `${c.identifier} created in ${c.team}`),
      h("span", { class: "qv-created-title" }, c.title)
    ),
    h(
      "div",
      { class: "qv-created-actions" },
      h("button", { type: "button", class: "btn-primary sm", "data-focus": "open-linear", onClick: ctx.actions.openLinear }, "Open in Linear", icon("external-link", 13)),
      h("button", { type: "button", class: "btn-ghost sm", onClick: ctx.actions.newCapture }, "New capture")
    )
  )
}

function aiButton(ctx) {
  const info = ctx.ai.info
  if (!info?.available) return null
  const st = ctx.draft.ai.status
  const busy = st === "busy"
  return h(
    "button",
    {
      type: "button",
      class: "qv-ai",
      title: busy ? "Stop drafting" : `Drafts with ${info.models.fast.label}`,
      onClick: () => (busy ? ctx.actions.stopAi() : ctx.actions.runAi("quick"))
    },
    busy ? spinner(13) : icon("sparkles", 13),
    busy ? "Drafting…" : st === "done" ? "Redraft" : "Draft with AI"
  )
}

function editor(ctx) {
  const { draft: d, cap, actions: a } = ctx
  const n = names(ctx)
  const frame = d.framing === "full" ? cap.full : cap.crop
  const subject = subjectLine(cap)
  const pills = []
  if (cap.kind === "element") pills.push(["Element", "el"])
  if (cap.kind === "region") pills.push(["Area", "el"])
  pills.push(["Page", "page"])
  const linearOff = ctx.linear.status !== "ready"
  return [
    h(
      "div",
      { class: "qv-head" },
      h("textarea", {
        class: "qv-title",
        rows: 1,
        placeholder: "Issue title",
        "aria-label": "Issue title",
        value: d.title,
        "data-focus": "title",
        "data-autogrow": "",
        onInput: (e) => a.setTitle(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.isComposing) {
            e.preventDefault()
            ctx.focus("body")
          }
        }
      }),
      iconButton("maximize-2", "Full composer", () => a.expand("shot")),
      iconButton("x", "Discard", a.discard)
    ),
    h(
      "div",
      { class: "qv-body" },
      h(
        "div",
        { class: "well" },
        h("textarea", {
          class: "qv-desc",
          placeholder: "What’s wrong? The captured details are added below your text.",
          "aria-label": "Description",
          value: d.body,
          "data-focus": "body",
          onInput: (e) => a.setBody(e.target.value)
        }),
        h(
          "div",
          { class: "qv-attached" },
          icon("paperclip", 13),
          h("span", { class: "qv-attached-label" }, "Attached:"),
          pills.map(([label, tab]) =>
            h("button", { type: "button", key: label, class: "pill", onClick: () => a.expand(tab), title: `Open the ${label} tab` }, h("span", { class: "dot" }), label)
          )
        )
      ),
      h(
        "div",
        { class: "qv-shot" },
        h(
          "button",
          { type: "button", class: "qv-thumb", onClick: () => a.expand("shot"), "aria-label": "Open the screenshot" },
          ctx.thumb ? h("img", { src: ctx.thumb, alt: "" }) : null
        ),
        h(
          "div",
          { class: "qv-shot-text" },
          h("span", { class: "qv-shot-size" }, `Screenshot · ${size(frame)}`),
          subject && h("span", { class: "qv-subject", title: subject }, subject),
          h("button", { type: "button", class: "qv-markup", onClick: () => a.expand("shot") }, icon("pencil", 12), "Mark up")
        )
      ),
      ctx.ui.consent?.where === "quick" && consentCard(ctx),
      h(
        "div",
        { class: "qv-actions" },
        aiButton(ctx),
        h("span", { class: "spacer" }),
        fieldMenu(ctx, {
          id: "team",
          label: "Team",
          variant: "chip",
          items: options(ctx, "team"),
          selected: d.fields.teamId,
          disabled: linearOff && !ctx.linear.teams.length,
          trigger: [teamTile(teamOf(ctx)), h("span", { class: "chip-label" }, n.team)]
        }),
        fieldMenu(ctx, {
          id: "priority",
          label: "Priority",
          variant: "chip",
          items: options(ctx, "priority"),
          selected: d.fields.priority,
          trigger: [priorityIcon(d.fields.priority, 14), h("span", { class: "chip-label" }, n.priority)]
        })
      ),
      d.ai.error && h("p", { class: "ai-error", role: "status" }, d.ai.error)
    ),
    statusBlock(ctx, "quick").length ? h("div", { class: "qv-status" }, statusBlock(ctx, "quick")) : null,
    h(
      "div",
      { class: "qv-foot" },
      h("button", { type: "button", class: "link-btn", onClick: () => a.expand("shot") }, icon("maximize-2", 14), "Full composer"),
      h("span", { class: "spacer" }),
      keycaps(ctx),
      createButton(ctx, "qv-create")
    )
  ]
}

export function quickView(ctx) {
  const isCreated = ctx.draft.view === "created"
  return h(
    "div",
    { class: "qv", key: "qv", role: "dialog", "aria-label": isCreated ? "Linear issue created" : "New Linear issue" },
    h("span", { class: "qv-arrow", "aria-hidden": "true" }),
    h("div", { class: "qv-inner" }, isCreated ? created(ctx) : editor(ctx))
  )
}

// Placement rules from the design: 40 px beside the anchor, flipped left
// when it does not fit, vertically centred and clamped 12 px from the
// edges, with the arrow on the anchor's centre. Full-window captures sit
// bottom-right with no arrow.
export function placeQuick(ctx, root) {
  const el = root.querySelector(".qv")
  if (!el) return
  const arrow = el.querySelector(".qv-arrow")
  const vw = innerWidth
  const vh = innerHeight
  const width = Math.min(W, vw - 24)
  el.style.width = `${width}px`
  el.classList.toggle("is-tall", el.querySelector(".qv-inner").scrollHeight > vh - 24)
  const H = el.offsetHeight
  const a = ctx.liveAnchor
  let left
  let top
  let side = null
  let center = 0
  if (a && a.kind !== "window" && a.rect) {
    const x1 = Math.max(0, a.rect.x)
    const y1 = Math.max(0, a.rect.y)
    const x2 = Math.min(vw, a.rect.x + a.rect.width)
    const y2 = Math.min(vh, a.rect.y + a.rect.height)
    const cy = Math.max(0, Math.min(vh, (y1 + Math.max(y1, y2)) / 2))
    if (x2 + 40 + width + 12 <= vw) {
      side = "right"
      left = x2 + 40
    } else if (x1 - 40 - width >= 12) {
      side = "left"
      left = x1 - 40 - width
    }
    if (side) {
      top = Math.max(12, Math.min(cy - H / 2, vh - H - 12))
      center = Math.max(24, Math.min(cy - top, H - 24))
    } else {
      // Wider than the space on either side: sit below or above it.
      left = Math.max(12, Math.min(x2 - width, vw - width - 12))
      if (y2 + 16 + H + 12 <= vh) top = y2 + 16
      else if (y1 - 16 - H >= 12) top = y1 - 16 - H
      else {
        left = vw - width - 16
        top = vh - H - 16
      }
    }
  } else {
    left = vw - width - 16
    top = vh - H - 16
  }
  top = Math.max(12, top)
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
  el.classList.toggle("is-left", side === "left")
  if (arrow) {
    arrow.style.display = side ? "block" : "none"
    arrow.style.top = `${Math.round(center - 7)}px`
  }
  el.style.visibility = "visible"
}
