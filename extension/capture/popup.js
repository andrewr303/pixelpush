// Toolbar popup: start a capture (element, area, full window) or open the
// side panel on this tab.
import { iconSvg } from "./icons.js"

const $ = (sel) => document.querySelector(sel)
const modes = [...document.querySelectorAll(".pop-mode")]
let tab = null

for (const node of document.querySelectorAll("[data-icon]")) {
  node.innerHTML = iconSvg(node.dataset.icon, node.classList.contains("pop-tile") ? 18 : 15)
}

const BLOCKED = {
  "chrome-page": "Chrome does not let extensions capture its own pages. Open a website to capture it.",
  "extension-page": "This page belongs to an extension, and Chrome keeps it off-limits to other extensions.",
  "web-store": "Chrome does not let extensions run on the Chrome Web Store.",
  policy: "Your organization's policy blocks extensions on this site.",
  "file-access": "To capture local files, turn on Allow access to file URLs for Pixelpush in chrome://extensions.",
  blocked: "Chrome does not let Pixelpush run on this page."
}

function block(kind) {
  modes.forEach((b) => (b.disabled = true))
  const note = $("#blocked")
  note.textContent = BLOCKED[kind] || BLOCKED.blocked
  note.hidden = false
}

function keycaps(shortcut) {
  if (!shortcut) return ""
  const mac = /Mac/i.test(navigator.platform)
  // Chrome reports "Alt+Shift+E" on Windows and Linux and "⌥⇧E" on macOS.
  const parts = shortcut.includes("+") ? shortcut.split("+") : [...shortcut]
  return parts
    .map((k) => {
      const label = mac ? { Alt: "⌥", Shift: "⇧", Command: "⌘", MacCtrl: "⌃", Ctrl: "⌘" }[k] || k : k
      return `<kbd>${label.replace(/[<>&]/g, "")}</kbd>`
    })
    .join("")
}

async function start(mode) {
  if (!tab?.id) return
  modes.forEach((b) => (b.disabled = true))
  const res = await chrome.runtime.sendMessage({ type: "pp-capture:begin", tabId: tab.id, mode }).catch((err) => ({ ok: false, error: String(err) }))
  if (res?.ok) window.close()
  else block(res?.kind || "blocked")
}

function openPanel() {
  if (!tab?.id) return
  // Same calls as the toolbar icon made before the popup existed. Both run
  // inside the click so Chrome still counts it as a user gesture.
  chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true, path: `sidepanel.html?tabId=${tab.id}` })
  chrome.sidePanel
    .open({ tabId: tab.id })
    .then(() => window.close())
    .catch(() => {
      const note = $("#blocked")
      note.textContent = "Chrome did not open the side panel. Right-click the page and choose Design with Pixelpush."
      note.hidden = false
    })
}

modes.forEach((b) => b.addEventListener("click", () => start(b.dataset.mode)))
$("#panel").addEventListener("click", openPanel)
$("#shortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
  window.close()
})

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const key = e.key.toLowerCase()
  const byKey = { e: "element", a: "area", w: "window", f: "window" }[key]
  if (byKey && !modes[0].disabled) {
    e.preventDefault()
    start(byKey)
    return
  }
  if (key === "p") {
    e.preventDefault()
    openPanel()
    return
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const focusables = [...modes.filter((b) => !b.disabled), $("#panel")]
    const i = focusables.indexOf(document.activeElement)
    const next = e.key === "ArrowDown" ? (i + 1) % focusables.length : (i - 1 + focusables.length) % focusables.length
    focusables[next].focus()
    e.preventDefault()
  }
})

async function init() {
  ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  modes[0].focus()

  chrome.commands?.getAll?.().then((commands) => {
    for (const c of commands) {
      const slot = document.querySelector(`[data-command="${c.name}"]`)
      if (slot) slot.innerHTML = keycaps(c.shortcut)
    }
  })

  chrome.storage.local.get("linearAuth").then(({ linearAuth }) => {
    const ws = linearAuth?.workspaces?.[linearAuth.activeOrgId] || Object.values(linearAuth?.workspaces || {})[0]
    const label = $("#linear")
    if (ws?.name) {
      label.textContent = `Linear · ${ws.name}`
      label.title = `Issues go to the ${ws.name} workspace`
    } else {
      label.textContent = "Linear not connected"
      label.classList.add("off")
      label.title = "Connect Linear on the side panel's Issue tab"
    }
  })

  if (!tab?.id) return block("blocked")
  const res = await chrome.runtime.sendMessage({ type: "pp-capture:can", tabId: tab.id }).catch(() => null)
  if (res && !res.ok) block(res.kind)
}

init()
