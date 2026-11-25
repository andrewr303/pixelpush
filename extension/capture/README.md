# Quick capture

Readable source for Pixelpush's quick capture: pick an element, an area or the whole window on any page and file it to Linear with a screenshot and what Pixelpush can tell about the page, without opening the side panel. Everything here is plain JavaScript, CSS and HTML with no build step. The user-facing description is in [docs/features.md](../../docs/features.md#quick-capture); what is read, stored and sent is in [docs/privacy-and-permissions.md](../../docs/privacy-and-permissions.md#quick-capture).

## Files

| File | Runs in | What it does |
| --- | --- | --- |
| `popup.html`, `popup.css`, `popup.js` | The toolbar popup (`action.default_popup`) | The three capture modes, their shortcuts, the Linear workspace, and **Open side panel**. Blocks the modes on pages Chrome will not let it script |
| `page-hook.js` | Every page, the page's own world, `document_start` (manifest content script) | Records the last 50 console errors and warnings and the last 100 fetch and XHR results in memory. Exposed to the worker as `window[Symbol.for("pixelpush.capture.log")].snapshot()` |
| `overlay.js` | The top frame, content-script world, injected on demand | The picker (element, area), the description of the subject, the on-page highlight, the composer frame in a closed shadow root, the Undo toast, and the related-file reader for **Thorough** AI drafts |
| `worker.js` | The service worker, loaded by `../service-worker.js` with `importScripts` | Starts captures (popup, `commands`, context menu), takes the screenshot, runs `pageMain` in the page's world, keeps capture records in IndexedDB, serves the composer, runs **Draft with AI** |
| `composer.html`, `composer.css`, `composer.js` | A transparent full-viewport frame over the page (web-accessible) | The shared draft, rendering, persistence, Linear loading, the create flow and keyboard handling |
| `quick-view.js` | Composer | The quick view popover (design 5b) and its placement |
| `full-view.js` | Composer | The full composer (design 5a): tabs, markup toolbar, sections, AI tab, preview, fields |
| `field-menu.js` | Composer | The dropdown used by the quick view chips and the five field buttons |
| `fields.js` | Composer | Linear field options and the team tile, avatar and project glyphs |
| `markup.js` | Composer | The SVG drawing surface and the PNG export (crop or full window, element ring, annotations) |
| `model.js` | Composer | Display data derived from a capture record, the default draft and the Markdown description |
| `linear.js` | Composer | Linear GraphQL: teams, team fields, `fileUpload`, `issueCreate`, `attachmentLinkURL`. Reads `linearAuth`; never writes credentials |
| `dom.js` | Composer, popup | `h()` and `morph()`: a small keyed DOM patcher, so focus, caret and animations survive a re-render |
| `icons.js` | Composer, popup | Lucide icon paths (ISC) and the priority and workflow-state glyphs |

## Flow

1. **Start.** The popup sends `pp-capture:begin`; a shortcut or context-menu item calls the same code in the worker. The worker injects `overlay.js` into the top frame and sends `pp-capture:start` with the mode.
2. **Pick.** The overlay covers the page with a transparent layer (so the page gets no clicks) and outlines what is under the pointer. A click, <kbd>Enter</kbd> or a drag picks; <kbd>Esc</kbd> cancels.
3. **Describe.** The overlay reads the subject in its own world and marks it with `data-pixelpush-capture="target"` (an area also marks the elements inside with `"inside"`).
4. **Shoot.** The overlay hides itself and sends `pp-capture:shoot`. The worker calls `captureVisibleTab`, runs `pageMain` in the page's world to add component names, source locations, the framework and the log, stores the record and answers with its id.
5. **Compose.** The overlay draws the highlight and opens `composer.html?id=<captureId>`. The composer loads the record with `pp-capture:get`, opens the quick view, and saves the draft back with `pp-capture:save-draft` 300 ms after each change.
6. **File.** The composer uploads the screenshot to Linear, creates the issue, attaches the page link and shows the created state. **New capture** and closing tell the worker, which tears the overlay down and deletes the record. Discarding a draft with text or markup keeps the record for the six-second **Undo** toast.

## The anchor

`pp-capture:shoot` carries `anchor: { kind: "element" | "region" | "window", rect, radius }`. `rect` is `{ x, y, width, height }` in viewport CSS pixels at capture time (`null` for `window`), and `radius` is the element's corner radius. The record keeps it for the screenshot crop and the element ring; the overlay sends `pp-capture:anchor` with a re-measured rect after a resize or scroll so the quick view can follow the element.

## The capture record

```js
{
  id, tabId, windowId, createdAt, mode,          // mode: "element" | "area" | "window"
  anchor,                                         // see above
  element,                                        // tag, selector, selectorPath, rect, text, role, name,
                                                  // attributes, html, styles[], flags[], peers, rules[]
  region,                                         // { rect, count, subject } for area and window captures
  page,                                           // url, host, path, title, viewport { w, h, dpr }, browser, time
  main,                                           // from pageMain: component { chain, source, definedIn },
                                                  // insideComponents, framework, console[], network[], recorder
  shot,                                           // PNG data URL of the visible tab
  draft                                           // the composer's draft, below
}
```

Records live in the worker's IndexedDB database `pixelpush-capture`, store `captures`. Records older than 12 hours are deleted on the next capture.

## The draft

One draft per capture, shared by both views:

```js
{
  v: 1,
  view: "quick" | "full" | "created",
  tab: "shot" | "el" | "page" | "ai" | "pv",        // full composer tab
  title, body,
  fields: { teamId, projectId, stateId, priority, assigneeId, labelIds },
  include: { shot, full, el, page, con, net },      // sections added below your text
  con: [true, …], net: [false, true, …],            // per console line and per request
  framing: "crop" | "full",
  markup: { tool, color, items: [], redo: [] },     // items in viewport CSS px
  ai: { model: "fast" | "thorough", mode: "short" | "detailed" | "steps",
        status: "idle" | "busy" | "done", findings, suggest, applied, previous, label, error, steps, step },
  created: null | { identifier, url, team, title }
}
```

Menu state, the busy and error banners and the AI confirmation are not part of the draft; they reset when the frame reloads.

## Storage keys

| Area | Key | Holds |
| --- | --- | --- |
| `local` | `pixelpushCaptureLinear_<orgId>` | Teams and per-team fields, five-minute cache |
| `local` | `pixelpushCaptureFields` | The last team and project filed to |
| `local` | `pixelpushCaptureModel` | `fast` or `thorough` |
| `local` | `pixelpushCaptureConsent` | Provider kinds confirmed for **Draft with AI** |
| IndexedDB | `pixelpush-capture` | Capture records |

It reads, but never writes, `linearAuth` (the side panel's Linear credential), `pixelpushAiSettings` and `pixelpushAiSecret:<providerId>`.

## Trying it

`tools/preview/fixtures/capture.html` is a billing page with one layout bug, a console error, a warning and a failed request. Load the extension unpacked, run `npm run preview`, open `http://localhost:4173/__preview/fixtures/capture.html`, press <kbd>Alt</kbd><kbd>Shift</kbd><kbd>E</kbd> and click the Pro card's **Upgrade** button.
