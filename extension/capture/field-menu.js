// One dropdown for the quick-view chips and the full composer's fields:
// listbox and option roles, one menu open at a time, closes on select, Esc
// or a pointer-down outside, arrow keys move, Enter selects, typing jumps.
import { h, cx } from "./dom.js"
import { icon } from "./icons.js"

// variant "chip": quick view, right-aligned, 180 px wide.
// variant "field": full composer, as wide as the field.
export function fieldMenu(ctx, { id, label, items, selected, variant, trigger, disabled = false }) {
  const open = ctx.ui.menu === id
  if (open) ctx.ui.menuItems = items
  const listId = `ppm-${id}`
  const active = open ? Math.min(ctx.ui.menuActive, items.length - 1) : -1
  return h(
    "div",
    { class: cx("fm", `fm-${variant}`), "data-pp-field": "" },
    h(
      "button",
      {
        type: "button",
        class: variant === "chip" ? "qv-chip" : "fc-field",
        title: variant === "chip" ? label : undefined,
        "aria-label": `${label}: ${items.find((i) => i.value === selected)?.label || "none"}`,
        "aria-haspopup": "listbox",
        "aria-expanded": open ? "true" : "false",
        "aria-controls": open ? listId : undefined,
        "aria-activedescendant": open && active >= 0 ? `${listId}-${active}` : undefined,
        disabled,
        "data-focus": `menu-${id}`,
        onClick: () => toggle(ctx, id, items, selected)
      },
      trigger,
      variant === "field" && icon("chevron-down", 15, 2, { class: "fc-field-chev" })
    ),
    open &&
      h(
        "div",
        { class: cx("fm-list", ctx.ui.menuUp && "up"), role: "listbox", id: listId, "aria-label": label, tabindex: "-1" },
        items.length
          ? items.map((item, i) =>
              h(
                "button",
                {
                  type: "button",
                  key: `${id}-${item.value ?? "none"}`,
                  id: `${listId}-${i}`,
                  class: cx("fm-opt", i === active && "is-active"),
                  role: "option",
                  "aria-selected": item.value === selected ? "true" : "false",
                  tabindex: "-1",
                  onPointerEnter: () => {
                    if (ctx.ui.menuActive !== i) {
                      ctx.ui.menuActive = i
                      ctx.render()
                    }
                  },
                  onClick: () => pick(ctx, item)
                },
                item.icon && h("span", { class: "fm-icon" }, item.icon),
                h("span", { class: "fm-label" }, item.label),
                h("span", { class: "fm-mark", "aria-hidden": "true" }, item.value === selected ? "✓" : "")
              )
            )
          : h("div", { class: "fm-empty" }, ctx.linear.status === "loading" ? "Loading…" : "Nothing to choose")
      )
  )
}

function toggle(ctx, id, items, selected) {
  if (ctx.ui.menu === id) return close(ctx)
  ctx.ui.menu = id
  ctx.ui.menuUp = undefined
  ctx.ui.menuItems = items
  ctx.ui.menuActive = Math.max(0, items.findIndex((i) => i.value === selected))
  ctx.ui.typed = ""
  ctx.render()
}

function pick(ctx, item) {
  close(ctx, false)
  ctx.restoreFocus = `menu-${ctx.ui.lastMenu}`
  item.pick()
  ctx.render()
}

export function close(ctx, rerender = true) {
  ctx.ui.lastMenu = ctx.ui.menu
  ctx.ui.menu = null
  ctx.ui.menuItems = null
  if (rerender) ctx.render()
}

// Document-level keys while a menu is open. Returns true when handled.
export function menuKey(ctx, e) {
  if (!ctx.ui.menu) return false
  const items = ctx.ui.menuItems || []
  if (e.key === "Escape") {
    e.preventDefault()
    e.stopPropagation()
    ctx.restoreFocus = `menu-${ctx.ui.menu}`
    close(ctx)
    return true
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault()
    const n = items.length
    if (!n) return true
    ctx.ui.menuActive = (ctx.ui.menuActive + (e.key === "ArrowDown" ? 1 : -1) + n) % n
    ctx.render()
    scrollActive()
    return true
  }
  if (e.key === "Home" || e.key === "End") {
    e.preventDefault()
    ctx.ui.menuActive = e.key === "Home" ? 0 : items.length - 1
    ctx.render()
    scrollActive()
    return true
  }
  if (e.key === "Enter" || e.key === " ") {
    if (e.key === " " && ctx.ui.typed) return typeAhead(ctx, e)
    e.preventDefault()
    const item = items[ctx.ui.menuActive]
    if (item) pick(ctx, item)
    return true
  }
  if (e.key === "Tab") {
    close(ctx)
    return false
  }
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) return typeAhead(ctx, e)
  return false
}

function typeAhead(ctx, e) {
  e.preventDefault()
  clearTimeout(ctx.ui.typedTimer)
  ctx.ui.typed = (ctx.ui.typed || "") + e.key.toLowerCase()
  ctx.ui.typedTimer = setTimeout(() => (ctx.ui.typed = ""), 700)
  const items = ctx.ui.menuItems || []
  const i = items.findIndex((it) => it.label.toLowerCase().startsWith(ctx.ui.typed))
  if (i >= 0) {
    ctx.ui.menuActive = i
    ctx.render()
    scrollActive()
  }
  return true
}

function scrollActive() {
  requestAnimationFrame(() => document.querySelector(".fm-opt.is-active")?.scrollIntoView({ block: "nearest" }))
}

// Close on pointer-down outside the open menu's field.
export function outsidePointer(ctx, e) {
  if (!ctx.ui.menu) return
  if (e.target.closest?.("[data-pp-field]")) return
  close(ctx)
}
