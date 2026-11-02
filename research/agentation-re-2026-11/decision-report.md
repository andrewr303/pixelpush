# Reverse-Engineering & Clean-Room Integration Decision Report: Agentation + AFS v1.1+ in Pixelpush

## 1. Scope & Clean-Room Boundary

- **Inspected Targets**:
  1. Local reference repository: `/Users/andrew/Downloads/agentation-main` (`package/` and `mcp/`).
  2. Live schema and documentation site: `https://www.agentation.com/schema` (plus `/features`, `/output`, `/mcp`, `/api`, and its live bottom-right floating toolbar bundle).
  3. Attached specification artifacts: `schema.pdf` (Annotation Format Schema v1.1) and `annotation.v1.1.json`.
  4. User-provided skill specification: `agentation-self-driving` (adapted for Pixelpush as `skills/pixelpush-self-driving/SKILL.md`).
- **Licensing Constraint**:
  - `agentation-main` is distributed under **PolyForm Shield License 1.0.0**.
  - Pixelpush (`extension/`) is **MIT**.
  - Following clean-room reconstruction discipline (`ghidra-reconstruction-companion`), zero code or documentation prose was copied verbatim from `agentation-main`. Every capability was specified from behavioral contracts and the public AFS v1.1 specification, then cleanly implemented in Pixelpush's MV3 architecture (`extension/background.js`, `extension/content-scripts/inspector.js`, `extension/panel/panel.js`, `extension/panel/pixelpush.css`, and `extension/schema/annotation.v1.1.json`).

## 2. Reverse-Engineered Capabilities & Pixelpush Improvements

### A. Unified AFS v1.1+ Annotation Model (`extension/schema/annotation.v1.1.json`)
- **AFS v1.1 Core**:
  - Supports all three canonical annotation kinds: `feedback`, `placement`, and `rearrange`.
  - Captures `id`, `comment`, `element`, `elementPath`, `timestamp`, `x` (% of viewport width), `y` (px from top of document or viewport when `isFixed`), `boundingBox`, `selectedText`, `nearbyText`, `cssClasses`, `nearbyElements`, `computedStyles`, `fullPath`, `accessibility`, `isMultiSelect`, `isFixed`, `reactComponents`, `sourceFile`, `attributes`, `frame`, `url`, `intent` (`fix` | `change` | `question` | `approve`), `severity` (`blocking` | `important` | `suggestion`), `status` (`pending` | `acknowledged` | `resolved` | `dismissed`), `thread` (`ThreadMessage[]`), `sessionId`, `resolvedAt`, `resolvedBy`, `placement` (`PlacementData`), and `rearrange` (`RearrangeData`).
- **Pixelpush AFS v1.1+ Extensions**:
  - Backward-compatible extension fields allow **every** Pixelpush surface—sidebar element notes (`Instructions`), direct CSS/text/icon edits, layout placements, section rearrangements, promoted design audit findings, and self-driving critiques—to live in one unified AFS v1.1+ store:
    - `edits`: Array of `{ property, before, after, unit }` recording direct visual style/content edits on the annotated element.
    - `proposedEdits`: Array of `{ prop, value, reason }` returned by AI `propose_edits` or `self_driving_critique` ready for one-click application.
    - `auditFinding`: Structured link `{ ruleId, category, severity, metric, message }` when an audit finding is promoted or linked to an element annotation.
    - `spatialContext`: Structured `SpatialContext` (`container`, `siblings`, `ViewportY`, `nearestBefore`, `nearestAfter`, `overlaps`) for layout rearrangements and placements.
    - `forensicStyles`: Full forensic computed style map (`fontSize`, `fontWeight`, `fontFamily`, `color`, `backgroundColor`, `padding`, `margin`, `display`, `position`, `width`, `height`, `borderRadius`, `border`, `gap`, `lineHeight`, `letterSpacing`, `textAlign`, `opacity`, `overflow`, `boxShadow`, `zIndex`).
    - `source`: Provenance tag (`"panel-note"` | `"page-marker"` | `"multi-select"` | `"area-select"` | `"layout-place"` | `"layout-rearrange"` | `"audit-finding"` | `"self-driving"`).

### B. Interactive Bottom-Right Floating Toolbar & On-Page Markers (`extension/content-scripts/inspector.js`)
- Inspired by the interactive floating toolbar on `https://www.agentation.com/schema`, Pixelpush now provides an in-page floating toolbar pill (`#pixelpush-floating-toolbar`) in the bottom-right corner alongside the Chrome Side Panel:
  - Collapses to a compact pill showing the active annotation count badge and expands to reveal one-click controls:
    1. **Annotate Mode** (single element, text selection, `Cmd/Ctrl+Click` or drag-lasso multi-select, and empty-space area selection)
    2. **Freehand Draw** (on-page SVG vector strokes with color picker and undo/clear)
    3. **Layout: Place** (12 wireframe component types with snap alignment guides, 8-direction resize handles, and **Blank Canvas** toggle)
    4. **Layout: Rearrange** (auto-detects page sections or captures clicked elements, shows original-position ghost outlines, tracks move/resize deltas, and computes `spatialContext`)
    5. **Self-Driving Critique** (triggers autonomous page walk + spotlight + numbered AFS critique pins)
    6. **Freeze Page** (freezes CSS animations/transitions, Web Animations API, `<video>` playback, and queues timers)
    7. **Block Interactions** (intercepts clicks/submits while inspecting interactive states)
    8. **Markers Toggle** (shows/hides numbered `[data-annotation-marker]` pins)
    9. **Copy Output** (copies AFS v1.1 Markdown or JSON directly to clipboard)
- Clicking any numbered marker pin on the page opens an inline popover to edit `comment`, `intent`, `severity`, `status`, add `thread` replies, or jump to that element in the Pixelpush Side Panel.

### C. Upgraded `propose_edits` and `rewrite_issue` AI Workflows (`extension/background.js` & `extension/panel/panel.js`)
- **`propose_edits`**:
  - Now consumes the full AFS v1.1+ telemetry for the selected element (`element`, `elementPath`, `fullPath`, `boundingBox`, `computedStyles`, `forensicStyles`, `accessibility`, `nearbyText`, `nearbyElements`, `reactComponents`, `sourceFile`, `attributes`, `intent`, `severity`, `thread` replies, linked `auditFinding`, and page design tokens).
  - Returns `{ edits: [{ prop, value, reason }], summary }` so each proposed CSS/text change includes a human-readable design rationale and can be applied individually or all at once.
- **`rewrite_issue`**:
  - Synthesizes all unified AFS v1.1+ annotations (`feedback`, `placement`, `rearrange`), direct CSS/text/icon edits, `intent`/`severity`/`status` workflow metadata, React component hierarchies, source file locations, and audit findings into a structured Linear-ready engineering brief.

### D. Integrated `pixelpush-self-driving` Autonomous Critique (`extension/background.js`, `extension/content-scripts/inspector.js`, `extension/panel/panel.js`)
- Implements a multi-phase autonomous design critique engine:
  1. **DOM & Section Discovery**: Scans the live page across 6 canonical critique zones (**Hero & Value Proposition**, **Navigation & Wayfinding**, **Visuals & Interactive Demos**, **Content & Typography Hierarchy**, **Copy & Microcopy Clarity**, **CTAs & Conversion Architecture**), extracting computed styles, contrast ratios, bounding boxes, React component paths, and source locations.
  2. **AI + Deterministic Hybrid Critique**: Routes the rich section digest through `self_driving_critique` on the active AI provider (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, or Custom Endpoint) and falls back seamlessly to a calibrated typographic/contrast/rhythm/hierarchy critique engine when no external API key is configured.
  3. **Live Walkthrough & Pinning**: Smoothly scrolls each critiqued element into view, highlights it with a spotlight pulse, attaches a numbered AFS v1.1+ annotation marker with a 2–3 sentence critique (citing the design principle + exact CSS/token values) and optional one-click `proposedEdits`.
