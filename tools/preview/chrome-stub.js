// Minimal stand-in for the chrome.* APIs the side panel touches, so the real
// bundle can render in an ordinary browser tab. Storage lives in memory.
;(() => {
  const stores = { sync: {}, local: {}, session: {} }

  function area(name) {
    const data = stores[name]
    return {
      async get(keys) {
        if (keys == null) return { ...data }
        if (typeof keys === "string") keys = [keys]
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))
        }
        return Object.fromEntries(Object.entries(keys).map(([k, fallback]) => [k, k in data ? data[k] : fallback]))
      },
      async set(items) {
        Object.assign(data, structuredClone(items))
      },
      async remove(keys) {
        for (const key of [].concat(keys)) delete data[key]
      }
    }
  }

  const event = () => {
    const fns = new Set()
    return { addListener: (fn) => fns.add(fn), removeListener: (fn) => fns.delete(fn), hasListener: (fn) => fns.has(fn) }
  }

  const tab = { id: 1, windowId: 1, url: "https://example.com/", title: "Example Domain", active: true }

  globalThis.chrome = {
    runtime: {
      id: "pixelpush-preview",
      getURL: (path) => new URL(path.replace(/^\//, ""), location.origin + "/").href,
      sendMessage: async () => undefined,
      connect: () => ({ name: "preview", postMessage() {}, disconnect() {}, onMessage: event(), onDisconnect: event() }),
      onMessage: event(),
      onConnect: event()
    },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      sendMessage: async () => undefined,
      create: async ({ url }) => {
        window.open(url, "_blank", "noopener")
        return { id: 2 }
      },
      onActivated: event(),
      onUpdated: event()
    },
    storage: { sync: area("sync"), local: area("local"), session: area("session"), onChanged: event() }
  }
})()
