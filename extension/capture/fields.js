// Linear field options and the small glyphs that sit in field buttons.
import { h } from "./dom.js"
import { PRIORITIES } from "./model.js"
import { priorityIcon, stateIcon } from "./icons.js"

const HEX = /^#[0-9a-f]{3,8}$/i

export function teamOf(ctx) {
  return ctx.linear.teams.find((t) => t.id === ctx.draft.fields.teamId) || null
}
export function metaOf(ctx) {
  return ctx.linear.meta[ctx.draft.fields.teamId] || null
}

export function teamTile(team, size = 14) {
  const bg = team && HEX.test(team.color || "") ? team.color : "oklch(0.58 0.2 290)"
  return h(
    "span",
    { class: "tile", style: `width:${size}px;height:${size}px;font-size:${size <= 14 ? 9 : 10}px;background-color:${bg}`, "aria-hidden": "true" },
    (team?.name || "?").trim().charAt(0).toUpperCase()
  )
}

export function initials(name) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

export function avatar(member) {
  return member
    ? h("span", { class: "avatar", "aria-hidden": "true" }, initials(member.displayName || member.name))
    : h("span", { class: "avatar is-empty", "aria-hidden": "true" })
}

export const projectGlyph = () => h("span", { class: "project-glyph", "aria-hidden": "true" })

export function names(ctx) {
  const f = ctx.draft.fields
  const meta = metaOf(ctx)
  const team = teamOf(ctx)
  const state = meta?.states.find((s) => s.id === f.stateId)
  const member = meta?.members.find((m) => m.id === f.assigneeId)
  return {
    team: team?.name || (ctx.linear.status === "loading" ? "Loading…" : ctx.linear.status === "off" ? "No team" : "Pick a team"),
    project: meta?.projects.find((p) => p.id === f.projectId)?.name || "No project",
    state,
    status: state?.name || (meta ? "Default" : "…"),
    priority: PRIORITIES[f.priority] || "No priority",
    member,
    assignee: member ? member.displayName || member.name : "Unassigned"
  }
}

export function options(ctx, key) {
  const meta = metaOf(ctx)
  const a = ctx.actions
  switch (key) {
    case "team":
      return ctx.linear.teams.map((t) => ({ value: t.id, label: t.name, pick: () => a.setTeam(t.id) }))
    case "project":
      return [
        ...(meta?.projects || []).map((p) => ({ value: p.id, label: p.name, pick: () => a.setField("projectId", p.id) })),
        { value: null, label: "No project", pick: () => a.setField("projectId", null) }
      ]
    case "status":
      return (meta?.states || []).map((s) => ({ value: s.id, label: s.name, icon: stateIcon(s.type, s.color), pick: () => a.setField("stateId", s.id) }))
    case "priority":
      return PRIORITIES.map((name, i) => ({ value: i, label: name, pick: () => a.setField("priority", i) }))
    case "assignee":
      return [
        { value: null, label: "Unassigned", pick: () => a.setField("assigneeId", null) },
        ...(meta?.members || []).map((m) => ({ value: m.id, label: m.displayName && m.displayName !== m.name ? `${m.name} (${m.displayName})` : m.name, pick: () => a.setField("assigneeId", m.id) }))
      ]
  }
  return []
}

export { priorityIcon, stateIcon }
