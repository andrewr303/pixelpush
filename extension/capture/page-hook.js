// Pixelpush capture: page log recorder.
//
// Runs in the page's own JavaScript world from document_start so a capture
// can include the console errors and failed requests that led up to it.
// It keeps a short ring buffer in this page's memory only. Nothing is sent
// anywhere: the service worker reads the buffer when you take a capture,
// and the data leaves the page only if you file that capture.
//
// console.error/warn, fetch and XMLHttpRequest are wrapped with Proxy so
// their names, arity and toString stay the same for the page.
;(() => {
  const KEY = Symbol.for("pixelpush.capture.log")
  if (window[KEY]) return

  const MAX_CONSOLE = 50
  const MAX_NETWORK = 100
  const MAX_TEXT = 600
  const consoleLog = []
  const network = []
  let stackBudget = 300

  const clip = (s, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}…` : s)

  function maskUrl(input) {
    let url
    try {
      url = new URL(String(input), location.href)
    } catch {
      return clip(String(input), 300)
    }
    if (url.protocol === "data:" || url.protocol === "blob:") return `${url.protocol}…`
    const secret = /token|key|secret|sig|signature|auth|password|session|code/i
    for (const [k, v] of url.searchParams) {
      if (secret.test(k) || /^[A-Za-z0-9_\-.=]{24,}$/.test(v)) url.searchParams.set(k, "[redacted]")
    }
    url.hash = ""
    const text = url.origin === location.origin ? url.pathname + url.search : url.origin + url.pathname + url.search
    return clip(text.replace(/%5Bredacted%5D/g, "[redacted]"), 300)
  }

  function frameFromStack(stack) {
    if (typeof stack !== "string") return null
    for (const line of stack.split("\n").slice(1)) {
      const m = line.match(/((?:https?|file|webpack|blob):\/\/?[^\s)]+?):(\d+):(\d+)\)?\s*$/)
      if (!m) continue
      if (/chrome-extension:/.test(line)) continue
      const path = m[1].split(/[?#]/)[0]
      return { url: path, file: path.split("/").pop() || path, line: +m[2], col: +m[3] }
    }
    return null
  }

  function describe(arg) {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`
    if (typeof arg === "string") return arg
    if (arg === undefined) return "undefined"
    if (typeof arg === "function") return `ƒ ${arg.name || "anonymous"}()`
    if (typeof Element !== "undefined" && arg instanceof Element) {
      return `<${arg.localName}${arg.id ? `#${arg.id}` : ""}>`
    }
    try {
      const seen = new WeakSet()
      return clip(
        JSON.stringify(arg, (_, v) => {
          if (typeof v === "object" && v !== null) {
            if (seen.has(v)) return "[Circular]"
            seen.add(v)
          }
          return typeof v === "bigint" ? `${v}n` : v
        }) ?? String(arg),
        300
      )
    } catch {
      return String(arg)
    }
  }

  function format(args) {
    const list = [...args]
    let out = ""
    if (typeof list[0] === "string" && /%[sdifoOc]/.test(list[0])) {
      const fmt = list.shift()
      out = fmt.replace(/%([sdifoOc])/g, (_, k) => {
        if (!list.length) return ""
        const v = list.shift()
        return k === "c" ? "" : describe(v)
      })
    }
    const rest = list.map(describe).join(" ")
    return clip([out, rest].filter(Boolean).join(" ").replace(/\s+\n/g, "\n").trim())
  }

  function record(level, text, frame) {
    const last = consoleLog[consoleLog.length - 1]
    if (last && last.level === level && last.text === text) {
      last.count++
      return
    }
    consoleLog.push({
      level,
      text,
      src: frame ? `${frame.file}:${frame.line}` : "",
      url: frame?.url || "",
      line: frame?.line || 0,
      count: 1,
      at: Date.now()
    })
    if (consoleLog.length > MAX_CONSOLE) consoleLog.shift()
  }

  for (const level of ["error", "warn"]) {
    const original = console[level]
    if (typeof original !== "function") continue
    console[level] = new Proxy(original, {
      apply(target, self, args) {
        try {
          const err = args.find((a) => a instanceof Error)
          let frame = err ? frameFromStack(err.stack) : null
          if (!frame && stackBudget > 0) {
            stackBudget--
            frame = frameFromStack(new Error().stack)
          }
          record(level, format(args), frame)
        } catch {}
        return Reflect.apply(target, self, args)
      }
    })
  }

  window.addEventListener(
    "error",
    (e) => {
      try {
        if (e.error || e.message) {
          const frame =
            frameFromStack(e.error?.stack) ||
            (e.filename ? { url: e.filename, file: e.filename.split(/[?#]/)[0].split("/").pop(), line: e.lineno } : null)
          record("error", clip(e.error ? `Uncaught ${e.error.name || "Error"}: ${e.error.message}` : `Uncaught ${e.message}`), frame)
        } else if (e.target && e.target !== window && (e.target.src || e.target.href)) {
          const el = e.target
          pushRequest("GET", el.src || el.href, 0, 0, `${el.localName} failed to load`)
        }
      } catch {}
    },
    true
  )

  window.addEventListener("unhandledrejection", (e) => {
    try {
      const r = e.reason
      record("error", clip(`Unhandled rejection: ${r instanceof Error ? `${r.name}: ${r.message}` : describe(r)}`), frameFromStack(r?.stack))
    } catch {}
  })

  function pushRequest(method, url, status, ms, note) {
    network.push({ m: method, u: maskUrl(url), s: status, t: Math.round(ms), note: note || "", at: Date.now() })
    if (network.length > MAX_NETWORK) {
      // Drop the oldest successful request first so failures survive longer.
      const i = network.findIndex((r) => r.s > 0 && r.s < 400)
      network.splice(i >= 0 ? i : 0, 1)
    }
  }

  if (typeof window.fetch === "function") {
    window.fetch = new Proxy(window.fetch, {
      apply(target, self, args) {
        const start = performance.now()
        let method = "GET"
        let url = ""
        try {
          const [input, init] = args
          if (typeof Request !== "undefined" && input instanceof Request) {
            method = input.method
            url = input.url
          } else url = String(input)
          if (init && init.method) method = String(init.method).toUpperCase()
        } catch {}
        const promise = Reflect.apply(target, self, args)
        try {
          promise.then(
            (res) => pushRequest(method, url, res.type === "opaque" ? -1 : res.status, performance.now() - start),
            (err) =>
              pushRequest(method, url, 0, performance.now() - start, err && err.name === "AbortError" ? "aborted" : "network error")
          )
        } catch {}
        return promise
      }
    })
  }

  if (typeof XMLHttpRequest === "function") {
    const meta = new WeakMap()
    const proto = XMLHttpRequest.prototype
    proto.open = new Proxy(proto.open, {
      apply(target, xhr, args) {
        try {
          meta.set(xhr, { method: String(args[0] || "GET").toUpperCase(), url: String(args[1] || "") })
        } catch {}
        return Reflect.apply(target, xhr, args)
      }
    })
    proto.send = new Proxy(proto.send, {
      apply(target, xhr, args) {
        try {
          const m = meta.get(xhr)
          if (m) {
            const start = performance.now()
            xhr.addEventListener(
              "loadend",
              () => pushRequest(m.method, m.url, xhr.status, performance.now() - start, xhr.status === 0 ? "network error" : ""),
              { once: true }
            )
          }
        } catch {}
        return Reflect.apply(target, xhr, args)
      }
    })
  }

  Object.defineProperty(window, KEY, {
    value: Object.freeze({
      version: 1,
      snapshot: () => ({
        console: consoleLog.map((e) => ({ ...e })),
        network: network.map((e) => ({ ...e }))
      })
    }),
    enumerable: false
  })
})()
