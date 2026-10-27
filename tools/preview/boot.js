// Loads the side panel's stylesheets and bundle exactly as sidepanel.html does.
// With ?demo=1 the root component renders in its built-in demo state, which
// ships sample element data so the inspector and style editor have content.
const params = new URLSearchParams(location.search)

const html = await (await fetch("/sidepanel.html")).text()
const doc = new DOMParser().parseFromString(html, "text/html")
for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
  const el = document.createElement("link")
  el.rel = "stylesheet"
  el.href = link.getAttribute("href")
  document.head.append(el)
}

// ?motion=off freezes transitions so screenshots never catch a frame mid-animation.
if (params.get("motion") === "off") {
  const style = document.createElement("style")
  style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}"
  document.head.append(style)
}

const src = doc.querySelector('script[type="module"]').getAttribute("src")
let code = await (await fetch(src)).text()

if (params.get("demo") === "1") {
  const render = /(\.render\(\w+\.jsx\(\w+\.StrictMode,\{children:\w+\.jsx\(\w+,)\{\}\)/
  if (render.test(code)) code = code.replace(render, "$1{demo:!0})")
  else console.warn("[preview] demo hook not found; rendering the default state")
  // Demo mode wraps the panel in a floating card; fill the viewport like the real side panel.
  const style = document.createElement("style")
  style.textContent = ".panel.w-96{width:auto;max-height:none;height:100vh;margin:0;border-radius:0;box-shadow:none}"
  document.head.append(style)
}

const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
await import(url)
document.documentElement.dataset.previewReady = "true"
