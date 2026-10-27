// Builds dist/pixelpush-<version>.zip for the Chrome Web Store or manual
// installs. Uses only Node built-ins so packaging needs no npm install.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32, deflateRawSync } from "node:zlib"

const root = fileURLToPath(new URL("..", import.meta.url))
const ext = join(root, "extension")
const { version } = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"))

function walk(dir) {
  return readdirSync(dir)
    .filter((name) => name !== ".DS_Store")
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })
}

const entries = [
  ...walk(ext).map((path) => ({ path, name: relative(ext, path) })),
  { path: join(root, "LICENSE"), name: "LICENSE" },
  { path: join(root, "THIRD_PARTY_NOTICES.md"), name: "THIRD_PARTY_NOTICES.md" },
  ...walk(join(root, "licenses")).map((path) => ({ path, name: relative(root, path) }))
].map((entry) => ({ ...entry, name: entry.name.split(sep).join("/") }))

entries.sort((a, b) => a.name.localeCompare(b.name))

// Fixed timestamp (2026-01-01 00:00) keeps the archive byte-for-byte reproducible.
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

const locals = []
const centrals = []
let offset = 0

for (const { path, name } of entries) {
  const data = readFileSync(path)
  const packed = deflateRawSync(data, { level: 9 })
  const useDeflate = packed.length < data.length
  const body = useDeflate ? packed : data
  const nameBuf = Buffer.from(name, "utf8")
  const crc = crc32(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6)
  local.writeUInt16LE(useDeflate ? 8 : 0, 8)
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  locals.push(local, nameBuf, body)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(useDeflate ? 8 : 0, 10)
  central.writeUInt16LE(DOS_TIME, 12)
  central.writeUInt16LE(DOS_DATE, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(offset, 42)
  centrals.push(central, nameBuf)

  offset += local.length + nameBuf.length + body.length
}

const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(offset, 16)

const outDir = join(root, "dist")
const outFile = join(outDir, `pixelpush-${version}.zip`)
mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]))
console.log(`package: ${relative(root, outFile)} (${entries.length} files)`)
