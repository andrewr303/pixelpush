// Cross-file contract checks for the unpacked extension. The bundles have no
// source tree, so the same list or name is written by hand in several files.
// Each check reads the copies and fails when they disagree. A check that
// cannot find its anchor fails too, so a renamed identifier is noticed.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const ext = join(root, "extension")
const read = (file) => readFileSync(join(ext, file), "utf8")
const errors = []
const fail = (msg) => errors.push(msg)
let checks = 0

const inspector = read("content-scripts/inspector.js")
const panel = read("panel/panel.js")
const worker = read("background.js")
const detect = read("audit/detect.js")
const catalog = JSON.parse(read("audit/antipatterns.json"))
const schema = JSON.parse(read("schema/annotation.v1.1.json"))

// A flat array literal of strings, found by the text that introduces it.
function stringArray(source, pattern, label) {
  const match = source.match(pattern)
  if (!match) {
    fail(`${label}: anchor not found (${pattern})`)
    return null
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

const diff = (a, b) => a.filter((x) => !b.includes(x))

// 1. The AI property allowlist is written twice: the panel validates proposals
//    against one copy and the worker against the other.
checks++
const panelProps = stringArray(panel, /var jye=\[([^\]]*)\]/, "panel AI allowlist (jye)")
const workerProps = stringArray(worker, /const q=\[([^\]]*)\]/, "worker AI allowlist (q)")
if (panelProps && workerProps) {
  const onlyPanel = diff(panelProps, workerProps)
  const onlyWorker = diff(workerProps, panelProps)
  if (onlyPanel.length || onlyWorker.length) {
    fail(
      `AI allowlists differ: only in panel.js [${onlyPanel.join(", ")}], only in background.js [${onlyWorker.join(", ")}]`
    )
  }
}

// 2. Every CSS property an AI proposal may use must be one the inspector will
//    apply. Text goes through set-text, so textContent is exempt.
checks++
const inspectorProps = stringArray(
  inspector,
  /AFS_ALLOWED_PROPS=new Set\(\[([^\]]*)\]\)/,
  "inspector write allowlist (AFS_ALLOWED_PROPS)"
)
if (panelProps && inspectorProps) {
  const refused = diff(panelProps, inspectorProps).filter((name) => name !== "textContent")
  if (refused.length) fail(`AI allowlist names the inspector refuses to apply: ${refused.join(", ")}`)
}

// 3. Every annotation source and kind the inspector writes must be in the
//    schema the exports claim to follow.
checks++
const handWritten = inspector.slice(inspector.indexOf("AFS_ALLOWED_PROPS"))
function writtenValues(key) {
  const direct = [...handWritten.matchAll(new RegExp(`\\b${key}:"([a-z-]+)"`, "g"))].map((m) => m[1])
  const fallback = handWritten.match(new RegExp(`\\b${key}:raw\\.${key}\\|\\|\\(([^)]*)\\)`))
  if (!fallback) fail(`inspector ${key} fallback: anchor not found`)
  const derived = fallback ? [...fallback[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]) : []
  return [...new Set([...direct, ...derived])]
}
for (const key of ["source", "kind"]) {
  const allowed = schema.properties?.[key]?.enum
  if (!Array.isArray(allowed)) {
    fail(`schema has no enum for "${key}"`)
    continue
  }
  const unknown = diff(writtenValues(key), allowed)
  if (unknown.length) fail(`inspector writes ${key} values the schema rejects: ${unknown.join(", ")}`)
}

// 4. The detector carries its own copy of the rule table; the panel reads the
//    JSON catalog. Ids, names, categories and descriptions must match.
checks++
const tableStart = detect.indexOf("const ANTIPATTERNS = [")
if (tableStart < 0) {
  fail("detector rule table: anchor not found (const ANTIPATTERNS = [)")
} else {
  const open = detect.indexOf("[", tableStart)
  let depth = 0
  let close = -1
  for (let i = open; i < detect.length; i++) {
    if (detect[i] === "[") depth++
    else if (detect[i] === "]" && --depth === 0) {
      close = i
      break
    }
  }
  let table = null
  try {
    table = new Function(`return ${detect.slice(open, close + 1)}`)()
  } catch (err) {
    fail(`detector rule table could not be read: ${err.message}`)
  }
  if (table) {
    const byId = new Map(catalog.map((rule) => [rule.id, rule]))
    const tableIds = table.map((rule) => rule.id)
    const missing = diff(tableIds, [...byId.keys()])
    const extra = diff([...byId.keys()], tableIds)
    if (missing.length) fail(`rules in detect.js but not in antipatterns.json: ${missing.join(", ")}`)
    if (extra.length) fail(`rules in antipatterns.json but not in detect.js: ${extra.join(", ")}`)
    for (const rule of table) {
      const listed = byId.get(rule.id)
      if (!listed) continue
      for (const field of ["name", "category", "description"]) {
        if (rule[field] !== listed[field]) fail(`rule ${rule.id}: "${field}" differs between detect.js and antipatterns.json`)
      }
    }
  }
}

if (errors.length) {
  console.error(`contracts: ${errors.length} problem(s)`)
  for (const msg of errors) console.error(`  - ${msg}`)
  process.exit(1)
}
console.log(`contracts: ok (${checks} checks)`)
