// Serves extension/ at / and this preview harness at /__preview/.
// Usage: npm run preview  (then open http://localhost:4173/__preview/?demo=1)
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const ext = fileURLToPath(new URL("../../extension/", import.meta.url))
const port = Number(process.env.PORT ?? 4173)
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost")
  const [base, rel] = pathname.startsWith("/__preview/")
    ? [here, pathname.slice("/__preview/".length) || "index.html"]
    : [ext, pathname.slice(1) || "sidepanel.html"]
  const file = normalize(join(base, decodeURIComponent(rel)))
  if (!file.startsWith(base)) {
    res.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" })
    res.end(body)
  } catch {
    res.writeHead(404).end("Not found")
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`preview: http://localhost:${port}/__preview/?demo=1`)
})
