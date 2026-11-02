• I reviewed all four excerpts against each other (schema ↔ content script ↔ panel). Excerpt 3 (`background.js`) was submitted **empty**, so every background-side claim (allowlist `q`/`M`, `ne_critique`, `cfUrl`, `Ve_sync`) is unverifiable from the packet; I flag below exactly what must be checked there, and I rate the sinks that *are* visible in the excerpts I have.

  ---

  # P1 — Critical

  ## P1-1. Stored XSS via `innerHTML` in wireframe rendering (`inspector.js`, `renderAfsOverlays`)
  ```js
  wf.innerHTML=`<span>[${p.componentType.toUpperCase()}]</span><span style="font-size:10px;opacity:0.8;">${p.label||ann.comment||""}</span>`;
  ```
  - **Root cause:** `placement.label` and `comment` are annotation-controlled strings interpolated raw into `innerHTML`. Inline event handlers (`<img src=x onerror=…>`) in inserted DOM execute in the **page's** JS world. Annotation objects are not trusted locally: they arrive from `afs-sync-from-panel` (panel state), `run-self-driving-walkthrough` (AI output), and ultimately the MCP sync server (`AFS_SYNC_SERVER` → panel → content), whose default transport is plain `http://localhost:4747` (see P1-4). A MITM/rebound sync server or a prompt-injected AI critique that emits a `placement` annotation achieves page-context code execution on any visited site. Secondary DoS: synced `placement` without `componentType` throws on `.toUpperCase()`, killing `renderAfsOverlays` entirely.
  - **Fix:** build with DOM APIs only: `const s1=document.createElement("span"); s1.textContent=`[${(p.componentType||"box").toUpperCase()}]`;` same for the label span; `wf.append(s1,s2)`. Never `innerHTML` with annotation data anywhere.

  ## P1-2. Unfiltered CSS property sink on "Apply Fix" (both paths)
  - **Locations:**
    - `inspector.js`, `renderPopover` → Apply Fix button: `else target.style[ed.prop]=ed.value;`
    - `panel.js`, Changes tab → Apply Fix button: `for(let ed of ann.proposedEdits)W1(ann.nodeId,ed.prop,"",ed.value);` → `set-style` → `H.style[N.prop]=N.value` in `inspector.js`.
  - **Root cause:** `proposedEdits` originate from AI jobs (`self_driving_critique`, `propose_edits`) and from synced/MCP annotations — i.e. untrusted input. Neither sink enforces the 50-property allowlist that lives in `background.js` (`q`/`M`); the panel's propose-edits path correctly filters through `Uu(edits,l1)`, but these two Apply buttons bypass it. `ed.prop==="cssText"` yields arbitrary CSS injection into the victim page (phishing overlays via `::before`, `content`/`background-image` exfiltration primitives); `ed.prop==="__proto__"` hits the inherited prototype setter on the `CSSStyleDeclaration`. The panel path additionally mis-routes `prop==="textContent"` into `style.textContent` (silently no-op), diverging from the popover path.
  - **Fix:** enforce one allowlist at the sink: in the `set-style` handler and the popover Apply loop, reject unless `ALLOWED_PROPS.has(ed.prop)` (share the background list via a module/constant), and handle `textContent`/`innerText` as explicit branches in *both* paths. Defense-in-depth even if `ne_critique` validates — validators get bypassed by fallback paths (e.g. the HTTP-400 `response_format` retry) and by synced annotations.

  ## P1-3. Panel↔content message contract is broken (headline "bidirectional sync" is half dead)
  - **Locations:** `panel.js` `Q4e` senders vs `inspector.js` `chrome.runtime.onMessage.addListener`.
  - **Root cause (exact mismatches):**
    1. Panel sends **flat** `{type:"afs-upsert-annotation", nodeId, selectorPath, comment, intent, …}` (from `W1`, `_1`, `ss`, `bye.onAfsMetaChange`, `onConvertToAfs`); content handler requires `N.annotation` → always takes the `return Z?.({ok:!1})` branch. **Every panel-originated pin, note-pin, audit-finding pin and edit-annotation is silently dropped.**
    2. Panel sends `afs-get-annotations`; content implements `afs-get-state` → initial load gets `undefined`, panel keeps empty list until first broadcast.
    3. Panel sends `afs-set-mode`; content implements `afs-set-tool` → the four mode pills are no-ops.
    4. Panel sends `afs-toggle-toolbar`, `afs-toggle-markers`, `afs-freeze-animations`; content has no such handlers → no-ops while panel local state flips (UI lies).
    5. Panel sends `afs-update-annotation` (status select); content has none → status changes revert.
  - **Fix:** pick one contract. Minimal: in the content listener, accept the flat shape (`const base=N.annotation??N;`) and add alias cases (`afs-get-annotations`→`afs-get-state` response, `afs-set-mode`→`{tool:N.mode}`, `afs-update-annotation`→merge `N.patch` by `N.id`, and the three toggle types). Add a shared `messages.js` constant file so both bundles compile against the same strings.

  ## P1-4. SSRF / capture exfiltration via unvalidated sync endpoint & provider `baseUrl`
  - **Locations:** `panel.js` MCP Sync row (`afsSyncEndpoint`, default `http://localhost:4747`, `type="url"`, no validation) → `chrome.runtime.sendMessage({type:"AFS_SYNC_SERVER", endpoint, action:"push", payload})`; provider settings `ft.baseUrl` fetched by background (`cfUrl(accountId, baseUrl)`).
  - **Root cause:** the background fetches a caller-supplied URL with no scheme/host allowlist. The payload contains page URL, title, selected text, notes and forensic styles. Plain-HTTP loopback default is exposed to local MITM and to DNS-rebinding-style confusion; a user-pasted `https://attacker.example` or `http://169.254.169.254` exfiltrates/SSRFs with **no disclosure dialog**, unlike AI providers which gate through `B1(...)`. Combined with P1-1/P1-2, a compromised sync peer becomes a remote page-context RCE chain.
  - **Fix:** validate in background before fetch: scheme ∈ {https} or host ∈ {localhost, 127.0.0.1, [::1]} with fixed port list; reject literal IPs/IDNs otherwise; route the first push per origin through a `B1`-style `window.confirm` disclosure; pin `http://localhost:4747` to loopback-only resolution. Verify `cfUrl` applies the same allowlist to `baseUrl` (excerpt 3 missing).

  ---

  # P2 — High

  ## P2-1. Self-Drive double execution race (`inspector.js`, `renderToolbar` sdBtn)
  ```js
  sdBtn.onclick=e=>{…;chrome.runtime.sendMessage({type:"afs-trigger-self-drive"});runSelfDrivingAutoCritique();};
  ```
  - **Root cause:** one click fires the local deterministic walkthrough *and* the panel→AI→`run-self-driving-walkthrough` path concurrently. Two async walkers interleave over shared `spotlightEl`/`afsAnnotations`; self-driving annotations get fresh ids each run (dedupe in `upsertAfsAnnotation` only covers `source==="panel-note"`), so repeats accumulate duplicates.
  - **Fix:** choose one owner: toolbar button should only `sendMessage("afs-trigger-self-drive")` (panel decides deterministic-vs-AI), and add an in-flight guard (`if(selfDriveRunning)return`) around `runSelfDrivingWalkthrough`; dedupe self-driving upserts by `source+elementPath`.

  ## P2-2. Scroll-capture re-render destroys in-flight popover edits (`inspector.js`, scroll listener → `renderAfsOverlays` → `renderPopover`)
  - **Root cause:** `window.addEventListener("scroll",…,!0)` rebuilds *all* markers and the popover (`popoverEl.innerHTML=""` + fresh `<textarea>`) on every scroll tick, including scroll events originating **inside** the popover textarea. `ta.onchange` only commits on blur/change, so a mid-typing scroll (or scrolling a long comment) discards the draft and focus; full marker rebuild per tick is also a perf hazard.
  - **Fix:** (a) early-return in the scroll/resize handlers when `D1(event.target)`; (b) make `renderPopover` position-only on scroll (update `style.left/top` of an existing popover; rebuild only when `activePopoverId` or annotation identity/version changes); (c) commit comment on `input` with ~300 ms debounce.

  ## P2-3. Rearrange clobbers the page's own inline transform (`inspector.js`, `onMouseMove`/`onMouseUp`/`afs-clear-annotations`)
  - **Root cause:** drag writes `target.style.transform=translate(...)` over whatever the page had; clear does `el.style.transform=""`, erasing the original transform permanently. It also stamps `data-pp-tx/ty` into page DOM (page scripts can read/tamper → spoofed drag bases).
  - **Fix:** store `originalTransform` in `rearrangeGhostMap` (or a WeakMap) at drag start, compose as `original + translate(...)`, restore verbatim on clear/commit; keep offsets in a JS map, not `dataset`.

  ## P2-4. `formatAfsMarkdown` / `formatAfsJson` signature-vs-callsite mismatch (`panel.js`)
  - **Root cause:** defined as `(list, level="standard", pageUrl="")` but called as `formatAfsMarkdown(afsAnns,{level,pageUrl,pageTitle,groups})` and `formatAfsJson(afsAnns,{…})`. Consequences: the Compact/Standard/Detailed/Forensic selector is dead (object ≠ string → always standard); exported JSON gets `url: {pageUrl,pageTitle,groups}` (an object) instead of a URI; `groups` (style edits/notes) are never rendered despite the button living in the Changes tab. Field-name drift inside the formatter: `ProposedEdit` is `{prop,value,reason}` but formatter prints `e.from`/`e.to` → literal `undefined`; `ThreadMessage` is `{content}` but formatter prints `m.message`; `rearrange` carries rects but formatter prints `r.deltaX/dy/spatialAfter` → `dx=undefinedpx`; `placement.insertRelation/relatedSelector` don't exist in schema or producer. `$schema` URL (`www.agentation.com/schema/…`) also disagrees with the schema `$id` and the in-page Copy AFS string.
  - **Fix:** change signatures to `(list, opts={})`; read `opts.level/opts.pageUrl`; map `e.value??e.to`, `m.content??m.message`, compute `deltaX=currentRect.x-originalRect.x`; align `$schema` to the `$id`; drop dead `insertRelation` branch or add it to schema+producer.

  ## P2-5. `blockInteractions` is a dead toggle; design mode swallows *all* page clicks unconditionally (`inspector.js`, `L`)
  ```js
  if(U&&U.el&&(U.el===N.target||U.el.contains(N.target))||(N.preventDefault(),N.stopImmediatePropagation(),U))return;
  ```
  - **Root cause:** the comma-expression runs `preventDefault()+stopImmediatePropagation()` on **every** non-overlay click whenever `U` is null (the common case), because the result of the comma expression (`U`) is what feeds the `||`. So during design mode no page click listener or default action ever runs, independent of the "Block Clicks" pill — and `blockInteractions` is never read by any handler, making that pill cosmetic. `stopImmediatePropagation` from a window-capture listener also kills the page's own capture listeners.
  - **Fix:** rewrite explicitly: `if(U&&U.el&&(U.el===N.target||U.el.contains(N.target)))return; if(U||blockInteractions){N.preventDefault();N.stopImmediatePropagation();if(U)return;}` and otherwise don't touch the event; make `blockInteractions` the single gate for interaction blocking.

  ## P2-6. Unguarded `document.querySelector` on annotation-supplied selector (`inspector.js`, `renderPopover` inspectBtn)
  - **Root cause:** `ee.get(ann.elementPath)||document.querySelector(ann.elementPath)` — a synced/AI annotation with an invalid selector throws inside the click handler (every other query site uses `safeQuery`). Same pattern risk in any future caller.
  - **Fix:** `safeQuery(ann.elementPath)`.

  ---

  # P3 — Medium/Low

  1. **Schema/impl enum drift** (`annotation.v1.1.json`): panel renders `kind==="drawing"` but no code ever creates drawing annotations and `kind` enum lacks it (Draw strokes live only in ephemeral `drawPaths`, never in AFS); `edits` schema is `{property,before,after}` while all producers/consumers use `{prop,from,to}`. Fix: add `"drawing"` kind + persist strokes as annotations, or delete the branch; rename `StyleContentEdit` fields to match reality.
  2. **`D1` spoofable by the page**: any site can set `data-pixelpush-overlay-ui` on its own nodes to exempt them from hover/audit/self-drive (`collectSelfDrivingCandidates` skips `D1`). Fix: check overlay membership via the retained root references only (`afsRoot.contains(N)`), drop the attribute selector.
  3. **Contrast heuristic flaws** (`buildDeterministicCritiques`/`effectiveBg`): applies 4.5:1 to large text (WCAG large-text threshold is 3:1), ignores foreground alpha in `contrastRatio`, walks only `parentElement` for background (misses stacking/pseudo-elements), and the canned fix `color:#111827` *lowers* contrast on dark themes. Fix: branch on font-size/weight for threshold, honor alpha, and pick fix color from measured background luminance.
  4. **`toggleFreezePage(false)` replays finished animations** (`document.getAnimations().forEach(a=>a.play())` restarts completed ones) and unfreezes videos the user had paused before Freeze. Fix: snapshot `a.playState`/`v.paused` at freeze time and restore selectively.
  5. **`I0()` teardown leaks**: multi-select outlines (`2px dashed #06b6d4`), `activeDrawPath`, `dragState`, `activeTool`, `blockInteractions` are never reset; re-enabling design mode resumes in a hidden "blocked" state. Fix: clear them in `I0`.
  6. **`applyBlankCanvas` misses nodes added while active** and dims via inline opacity that page CSS can override; acceptable, but restore should also run on `spa-navigation`.
  7. **`run-self-driving-walkthrough` ignores `stepDelayMs`** (panel sends 380, content hardcodes 260/220) and places the spotlight from a rect measured mid-`smooth` scroll. Fix: honor the param and await `scrollend`/rAF-stable rect.
  8. **`Z.digest={candidates,…}` is appended after `hd()` size-gating** in `runSelfDrivingCritique`, so the pack can exceed provider limits post-validation. Fix: include candidates inside `hd`.
  9. **Panel `onMessage` listener trusts self-reported `tabId`** (`if(v!=null&&Z.tabId&&Z.tabId!==v)return;`) instead of `sender.tab?.id`; any extension context (e.g. a content script in another tab) can spoof it. Fix: validate `sender.tab?.id===v` for tab-scoped events.
  10. **WXT bootstrap `window.postMessage(…,"*")`** (`iT.stopOldScripts`) lets the page forge a "newer script started" event (name is guessable once the extension id is known) and abort the live content script — DoS only, but consider `noScriptStartedPostMessage` or an origin check.
  11. **A11y**: markers are clickable `div`s without `role="button"`/`tabindex`/keyboard handlers; popover pills lack `aria-pressed`. Cheap to fix while touching `renderAfsOverlays`.

  ---

  # Unverifiable from this packet (excerpt 3 empty) — must-check list for `background.js`

  - `ne_critique` must schema-validate each critique (`selectorPath` string, `proposedEdits[].prop` ∈ allowlist `q`, `value` string ≤ N chars) **and** cap array length; otherwise P1-2 is remotely reachable with zero filtering.
  - `set-style`-adjacent normalization `M` must run on AI output before it reaches tabs; confirm `rewrite_issue`/`propose_edits` validators strip unknown props rather than warn.
  - `cfUrl(accountId, baseUrl)`: confirm `baseUrl` is allowlisted to `api.cloudflare.com`/`workers.cloudflare.net` (else P1-4 SSRF applies); confirm the HTTP-400 `response_format` fallback re-validates the *second* response through the same validator (fallback paths are where validators get skipped).
  - `Ve_sync` (`afs-mcp-sync`): confirm it authenticates the loopback peer, rejects non-loopback redirects, enforces a payload size cap, and sanitizes pulled annotations (strip `placement.label`/`comment` HTML or rely on the P1-1 fix) before forwarding to tabs.
  - `Qe_annotateMain` framework detection: confirm Fiber/`__vue__`/`__svelte__/`ng probes are wrapped in try/catch and never serialize function objects into `reactComponents` (they flow into AI packs and markdown).

  **Bottom line:** no P0, four P1s. The two security-critical sinks (`innerHTML` wireframe, unfiltered `style[prop]`) are each one-line fixes; the P1-3 contract drift means the shipped "bidirectional Q4e sync" currently persists nothing from the panel side, which will read as data loss in QA before anyone reaches the security issues. Fix P1-3 and P2-4 first for correctness, P1-1/P1-2/P1-4 before any release that ships MCP sync or Self-Drive AI.

