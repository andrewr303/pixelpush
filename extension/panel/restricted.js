/*
 * Behaviour for restricted.html, the side panel's view of a tab Pixelpush
 * cannot script. It keeps only the copy for the reason it was opened with, and
 * hands the panel back to sidepanel.html as soon as the tab becomes reachable
 * (the tab navigated to a normal page, or Check again succeeds).
 */
;(() => {
  const params = new URLSearchParams(location.search)
  const tabId = Number(params.get("tabId"))
  const kinds = ["chrome-page", "extension-page", "web-store", "policy", "blocked"]
  const kind = kinds.includes(params.get("kind")) ? params.get("kind") : "blocked"

  for (const el of document.querySelectorAll("[data-only]")) {
    if (!el.dataset.only.split(" ").includes(kind)) el.remove()
  }

  const button = document.getElementById("pp-recheck")
  const status = document.getElementById("pp-status")

  async function recheck(silent) {
    if (!Number.isInteger(tabId)) return
    if (!silent) {
      button.disabled = true
      status.textContent = "Checking"
    }
    let reply = null
    try {
      reply = await chrome.runtime.sendMessage({ type: "pixelpush-page-check", tabId })
    } catch {
      // Worker unreachable: treat as still blocked.
    }
    if (reply && reply.ok) {
      location.replace(`sidepanel.html?tabId=${tabId}`)
      return
    }
    if (reply && reply.kind && reply.kind !== kind) {
      location.replace(`restricted.html?tabId=${tabId}&kind=${encodeURIComponent(reply.kind)}`)
      return
    }
    if (!silent) {
      status.textContent = "Still blocked"
      button.disabled = false
    }
  }

  button.addEventListener("click", () => recheck(false))

  chrome.tabs.onUpdated.addListener((id, info) => {
    if (id === tabId && info.status === "complete") recheck(true)
  })
})()
