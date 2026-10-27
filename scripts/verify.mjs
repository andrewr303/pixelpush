// Static checks for the unpacked extension: manifest references, script syntax,
// required license files and leftover strings from the pre-Pixelpush build.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { Script } from "node:vm"

const root = fileURLToPath(new URL("..", import.meta.url))
const ext = join(root, "extension")
const errors = []
const fail = (msg) => errors.push(msg)

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

if (manifest.manifest_version !== 3) fail("manifest_version must be 3")
if (manifest.version !== pkg.version) {
  fail(`manifest version ${manifest.version} does not match package.json ${pkg.version}`)
}

const referenced = [
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.side_panel?.default_path,
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
  ...(manifest.web_accessible_resources ?? []).flatMap((war) => war.resources)
].filter(Boolean)

for (const file of new Set(referenced)) {
  if (!existsSync(join(ext, file))) fail(`manifest references missing file: ${file}`)
}

// Scripts loaded with type="module" parse as modules; everything else Chrome
// runs (service worker, content scripts, injected files) parses as a classic script.
const modules = new Set()
for (const page of ["sidepanel.html"]) {
  const html = readFileSync(join(ext, page), "utf8")
  for (const [, ref] of html.matchAll(/(?:src|href)="\/?([^"]+)"/g)) {
    if (!existsSync(join(ext, ref))) fail(`${page} references missing file: ${ref}`)
  }
  for (const [, ref] of html.matchAll(/<script[^>]*type="module"[^>]*src="\/?([^"]+)"/g)) {
    modules.add(join(ext, ref))
  }
}
if (manifest.background?.type === "module") modules.add(join(ext, manifest.background.service_worker))

const files = walk(ext)

for (const file of files.filter((f) => f.endsWith(".js"))) {
  if (modules.has(file)) {
    const result = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      input: readFileSync(file, "utf8"),
      encoding: "utf8"
    })
    if (result.status !== 0) fail(`syntax error in ${relative(root, file)} (module)\n${result.stderr}`)
  } else {
    try {
      new Script(readFileSync(file, "utf8"), { filename: file })
    } catch (err) {
      fail(`syntax error in ${relative(root, file)} (classic script): ${err.message}`)
    }
  }
}

for (const file of files.filter((f) => f.endsWith(".json"))) {
  try {
    JSON.parse(readFileSync(file, "utf8"))
  } catch (err) {
    fail(`invalid JSON in ${relative(root, file)}: ${err.message}`)
  }
}

for (const required of ["LICENSE", "THIRD_PARTY_NOTICES.md", "licenses/Apache-2.0.txt"]) {
  if (!existsSync(join(root, required))) fail(`missing ${required}`)
}

// Every bundled font needs its OFL license and a row in the notices.
const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")
const licenseFiles = readdirSync(join(root, "licenses"))
for (const font of files.filter((f) => f.endsWith(".woff2"))) {
  const name = basename(font)
  const expected = `ofl-1.1-${name.replace(/\.woff2$/, "")}.txt`
  if (!licenseFiles.some((l) => l.toLowerCase() === expected)) fail(`missing licenses/${expected} (any case) for ${name}`)
  if (!notices.includes(name)) fail(`THIRD_PARTY_NOTICES.md does not list ${name}`)
}

// Strings that only existed in the build Pixelpush was forked from.
const forbidden = [
  /tonkotsu/i,
  /statsig/i,
  /pfcfpjololfdopoglgplmijaohidmopj/,
  /data-handle-/,
  /"handle_[a-z_]+"/,
  /\[handle\]/,
  /content-scripts\/handle\.js/,
  /ai-sidecar/,
  /hypestake/i,
  /SF Pro/,
  /#0071e3|#2997ff|#4a90d9/i,
  /^var handle=|^handle;$/m,
  /coding agent/i
]

for (const file of files) {
  if (file.endsWith(".DS_Store")) {
    fail(`stray file: ${relative(root, file)}`)
    continue
  }
  if (!/\.(js|json|html|css|md|txt)$/.test(file)) continue
  const text = readFileSync(file, "utf8")
  for (const pattern of forbidden) {
    if (pattern.test(text)) fail(`${relative(root, file)} still contains ${pattern}`)
  }
}

if (errors.length) {
  console.error(`verify: ${errors.length} problem(s)\n`)
  for (const err of errors) console.error(`- ${err}`)
  process.exit(1)
}

console.log(`verify: ok (${files.length} files, manifest v${manifest.version})`)
