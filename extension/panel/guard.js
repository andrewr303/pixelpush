/*
 * Runs before the panel bundle. Asks the service worker whether Pixelpush can
 * reach the tab this panel belongs to, and swaps in restricted.html when it
 * cannot (chrome:// pages, other extensions' pages, the Web Store, policy
 * blocks). sidepanel.html loads it as a classic script ahead of panel.js, which
 * is a module and so runs after it. The page stays hidden until the answer
 * arrives, so a blocked tab never flashes the empty inspector first.
 */
;(() => {
  const tabId = Number(new URLSearchParams(location.search).get("tabId"))
  if (!Number.isInteger(tabId) || !globalThis.chrome?.runtime?.sendMessage) return

  const root = document.documentElement
  const show = () => {
    root.style.visibility = ""
  }

  async function check() {
    try {
      const reply = await chrome.runtime.sendMessage({ type: "pixelpush-page-check", tabId })
      if (reply && reply.ok === false) {
        location.replace(`restricted.html?tabId=${tabId}&kind=${encodeURIComponent(reply.kind || "blocked")}`)
        return
      }
    } catch {
      // Worker unreachable: keep the panel rather than hide it.
    }
    show()
  }

  root.style.visibility = "hidden"
  setTimeout(show, 1500)
  check()

  // The tab finished loading, possibly on a different kind of page.
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "tab-refreshed" && message.tabId === tabId) check()
  })
})()
