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

const src = doc.querySelector('script[type="module"]').getAttribute("src")
let code = await (await fetch(src)).text()

if (params.get("demo") === "1") {
  const render = /(\.render\(\w+\.jsx\(\w+\.StrictMode,\{children:\w+\.jsx\(\w+,)\{\}\)/
  if (render.test(code)) code = code.replace(render, "$1{demo:!0})")
  else console.warn("[preview] demo hook not found; rendering the default state")
}

const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
await import(url)
document.documentElement.dataset.previewReady = "true"
