// Renders brand/icon.svg into the PNG sizes Chrome asks for.
// brand/icon.svg embeds a 512px raster master, so every size is a clean downscale of it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Resvg } from "@resvg/resvg-js"

const root = fileURLToPath(new URL("..", import.meta.url))
const svg = readFileSync(join(root, "brand", "icon.svg"), "utf8")
const outDir = join(root, "extension", "icons")
mkdirSync(outDir, { recursive: true })

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()
  writeFileSync(join(outDir, `icon-${size}.png`), png)
  console.log(`icons: extension/icons/icon-${size}.png`)
}
