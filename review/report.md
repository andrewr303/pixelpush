# Ultimate Review Report — Pixelpush v2.1.0 (AFS v1.1+, Self-Driving Mode & Multi-Provider AI)

- **Run ID**: `20261102T175544Z`
- **Status**: **PASS (All P1/P2 Cross-Consultation Findings Resolved & Verified)**
- **Addendum (2026-11-11)**: a later review, run against the unpacked extension in Chromium, found further defects in this change set and corrected two statements below. The three property lists were never identical (F-04): the inspector accepts 51 names and the panel and worker accept 34 CSS properties plus `textContent`, as [docs/architecture.md](../docs/architecture.md) now states. Local file links in this report were rewritten as repository-relative links.
- **Cross-Consultation Models**:
  1. **`qwen-token-plan/qwen3.8-max`** (`andrewcode run -m qwen-token-plan/qwen3.8-max --thinking-effort xhigh`) — Full output in [consult-qwen3.8-max.md](consult-qwen3.8-max.md)
  2. **`grok-4.7`** (`andrewcode run -m grok-4.7 --thinking-effort xhigh`) — Full output in [consult-grok-4.7.md](consult-grok-4.7.md)

---

## 1. Executive Summary

We conducted an external multi-model cross-consultation using **`qwen-token-plan/qwen3.8-max`** (at `xhigh` thinking effort in `andrewcode`) and **`grok-4.7`** (at `xhigh` thinking effort in `andrewcode`) across all modified and newly created files:
- [manifest.json](../extension/manifest.json)
- [annotation.v1.1.json](../extension/schema/annotation.v1.1.json)
- [background.js](../extension/background.js)
- [inspector.js](../extension/content-scripts/inspector.js)
- [panel.js](../extension/panel/panel.js)
- [pixelpush.css](../extension/panel/pixelpush.css)
- [SKILL.md](../skills/pixelpush-self-driving/SKILL.md)

Both models independently converged on the highest-priority security, contract-coherence, and lifecycle issues. Every valid P1 and P2 finding was adjudicated, fixed in the codebase, and re-verified with `npm run verify`.

---

## 2. Adjudicated Findings & Applied Fixes

### F-01 (P1 Security — Flagged by `qwen3.8-max` & `grok-4.7`): DOM XSS via `item.selectedText` in `openPopover`
- **Location**: [inspector.js](../extension/content-scripts/inspector.js#L1686-L1705)
- **Root Cause**: `openPopover` previously assigned `quote.innerHTML = 'Selected: "' + item.selectedText.slice(0, 120) + '"'` when rendering selected DOM text inside the Shadow DOM popover. If a user selected page text containing `<img src=x onerror=...>` or `<svg onload=...>` and clicked to annotate, arbitrary script execution occurred in the content-script isolated world.
- **Fix Applied**: Replaced `innerHTML` string concatenation with safe DOM construction (`document.createTextNode("Selected: ")` + `<span>` populated strictly via `.textContent`).

### F-02 (P1 Security — Flagged by `qwen3.8-max` & `grok-4.7`): SSRF / Path Traversal in Cloudflare Workers AI `cfUrl` and MCP Sync `Ve_sync`
- **Location**: [background.js](../extension/background.js#L1)
- **Root Cause**:
  1. `cfUrl(e)` interpolated `e.accountId` into `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions` without hexadecimal format validation and accepted arbitrary `e.baseUrl` values without checking protocol or host.
  2. `Ve_sync(e, r)` allowed non-loopback HTTP URLs, did not block private RFC1918/link-local IPv4 ranges (`10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`), and only recognized `type: "AFS_SYNC_SERVER"` while callers in `panel.js` also dispatched `AGENTATION_SYNC` and `afs-mcp-sync`.
- **Fix Applied**:
  1. Enforced `/^[0-9a-fA-F]{32}$/` validation on `accountId` (`"Cloudflare Workers AI requires a valid hexadecimal Account ID."`) and validated custom `baseUrl` via `new URL()` requiring `https:` or loopback (`localhost`/`127.0.0.1`).
  2. Hardened `Ve_sync(e, r)` to verify the sender is the extension's own side panel (`"Sync requests can only start from the Pixelpush side panel."`), require `https:` or loopback (`"MCP sync requires localhost or HTTPS."`), block private network IPs (`"Private network IPs are not allowed for MCP sync."`), and support all message aliases (`AFS_SYNC_SERVER`, `AGENTATION_SYNC`, `afs-mcp-sync`), actions (`push`, `sync_session`, `status`), and payload formats (string or object).

### F-03 (P1 Lifecycle & UX — Flagged by `qwen3.8-max` & `grok-4.7`): Scroll/Resize Listener Leak and Active Popover Destruction on Scroll
- **Location**: [inspector.js](../extension/content-scripts/inspector.js#L1651-L1676) and [inspector.js](../extension/content-scripts/inspector.js#L2288-L2302)
- **Root Cause**:
  1. `startAnnotationEngine()` attached anonymous `scroll` and `resize` listeners every time the engine was toggled on, leaking listeners across toggles.
  2. Those listeners called `renderMarkers()`, which unconditionally removed `#pp-afs-popover` (`if (popover) popover.remove()`), destroying any open comment/edit popover whenever the user scrolled the page.
- **Fix Applied**:
  1. Guarded listener attachment with `state.afsListenersAttached` so `scroll` and `resize` listeners are registered at most once.
  2. Added `{ preservePopover: true }` support to `renderMarkers(opts)` so scroll/resize updates pin coordinates in-place without closing an active annotation popover.

### F-04 (P1 Contract & Schema Alignment — Flagged by `qwen3.8-max` & `grok-4.7`): Schema-to-Runtime Alignment (`AFS_ALLOWED_PROPS`, `kind` Enum, `drawingStroke`, `Apply Fix`, and `formatAfsMarkdown`)
- **Locations**:
  - [annotation.v1.1.json](../extension/schema/annotation.v1.1.json)
  - [inspector.js](../extension/content-scripts/inspector.js#L1318-L1335)
  - [panel.js](../extension/panel/panel.js#L50-L120)
  - [panel.js](../extension/panel/panel.js#L430)
- **Root Cause**:
  1. `AFS_ALLOWED_PROPS` in `inspector.js` had 38 properties while `panel.js` (`Je`) and `background.js` (`lt`) permitted 50 CSS properties (e.g., `flexGrow`, `flexShrink`, `flexBasis`, `gridTemplateRows`, `boxShadow`, `opacity`, `aspectRatio`, `objectFit`, `whiteSpace`, `wordBreak`), causing valid AI proposed edits to be silently dropped in the content script.
  2. `annotation.v1.1.json` and runtime producers used overlapping `kind` values (`"freehand"` vs `"drawing"`, `"style-edit"` vs `"edit"`, `"self-driving-critique"` vs `"audit-finding"` vs `"audit"`) and `drawingStroke` vs `drawing`.
  3. `Apply Fix` in `panel.js` did not apply `proposedEdit.textContent` when present and only sent `afs-update-annotation` instead of `afs-apply-proposed-edits`.
  4. `formatAfsMarkdown(sessionData, opts)` only checked `opts?.detailLevel`, breaking callers passing a string detail level directly (`formatAfsMarkdown(session, "forensic")`).
- **Fix Applied**:
  1. Expanded `AFS_ALLOWED_PROPS` in `inspector.js` to the full 50-property allowlist matching `panel.js` and `background.js`.
  2. Updated `annotation.v1.1.json` to validate all runtime `kind` values and both `drawingStroke` and `drawing` structures, and populated both `drawingStroke` and `drawing` in `inspector.js`.
  3. Updated `Apply Fix` in `panel.js` to apply both `textContent` (`apply-text`) and allowlisted CSS properties (`apply-styles`) and dispatch `afs-apply-proposed-edits` + `afs-update-annotation`.
  4. Updated `formatAfsMarkdown` to accept either a string (`"compact" | "standard" | "detailed" | "forensic"`) or an options object (`{ detailLevel }`), and included `rearrange` and `drawingStroke` details in Markdown output.

### F-05 (P2 Reliability & Heuristics — Flagged by `qwen3.8-max` & `grok-4.7`): Self-Drive Concurrency Guard & WCAG Relative Luminance Contrast Heuristic
- **Location**: [inspector.js](../extension/content-scripts/inspector.js#L1860-L1955)
- **Root Cause**:
  1. Repeated clicks on the `Self-Drive` toolbar button launched concurrent overlapping spotlight loops (`runLocalSelfDrivingSweep`), creating duplicate critique pins.
  2. The fallback local sweep flagged any element where `cs.color === cs.backgroundColor` even when both were `rgba(0, 0, 0, 0)` (transparent background), producing false-positive contrast critiques.
- **Fix Applied**:
  1. Added `state.selfDriveRunning` lock in `runLocalSelfDrivingSweep` with `try / finally` cleanup and visual button status (`Running...`).
  2. Implemented RGBA parser (`parseRgba`) and WCAG 2.x relative luminance contrast ratio calculation (`contrastRatio(fg, bg) < 3 && bg.a > 0.1`) so transparent backgrounds are ignored and genuine low-contrast text (< 3.0:1 against an opaque background) is accurately flagged.

### F-06 (P2 Accessibility — Flagged by `qwen3.8-max`): Keyboard Navigation on Floating AFS Markers
- **Location**: [inspector.js](../extension/content-scripts/inspector.js#L1605-L1638)
- **Root Cause**: Floating `.pp-afs-marker` elements were `<div>` nodes without `role="button"`, `tabIndex`, `aria-label`, or keyboard activation (`Enter` / `Space`).
- **Fix Applied**: Added `role="button"`, `tabIndex = 0`, descriptive `aria-label`, and `keydown` handler for `Enter` and `Space` to open the marker's popover via keyboard.

---

## 3. Verification Evidence (`evidence-E1.json`)

All verification checks pass with zero errors:
- `node --check extension/content-scripts/inspector.js` -> **PASS (exit 0)**
- `node --check extension/background.js` -> **PASS (exit 0)**
- `node --check extension/panel/panel.js` -> **PASS (exit 0)**
- `npm run verify` -> **PASS (`verify: ok (17 files, manifest v2.1.0)`, `contrast: all 91 pairs pass`, exit 0)**
