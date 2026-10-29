# Development

How to run, check, change and package Pixelpush from this repository.

**Docs:** [Home](README.md) · [Getting started](getting-started.md) · [Features](features.md) · [Audit](audit.md) · [AI providers](ai-providers.md) · [Linear](linear.md) · [Privacy and permissions](privacy-and-permissions.md) · [Architecture](architecture.md) · **Development** · [Design system](DESIGN.md)

> [!NOTE]
> The `extension/` folder is the complete extension, exactly as Chrome loads it. There is no build step and no test suite. The side panel, the page inspector, the audit bridge and the service worker are compiled, minified bundles with no source tree in this repository; read [Architecture](architecture.md#what-is-source-and-what-is-compiled) before you edit one.

## Requirements

| Need | Version | Where it is stated |
| --- | --- | --- |
| Node.js | 22.2 or later | `engines.node` in `package.json` |
| Chrome or another Chromium browser | 116 or later | `minimum_chrome_version` in `extension/manifest.json` (116 is the first version that lets an extension open its side panel on demand) |
| `npm install` | Only for `npm run icons` | `@resvg/resvg-js` (`^2.6.2`) is the one dependency, and it is a dev dependency. `verify`, `contrast`, `package` and `preview` use Node built-ins only |

## Quick start

```sh
git clone https://github.com/andrewr303/pixelpush.git
cd pixelpush
npm run verify
npm run preview
```

Then load the extension in Chrome (see [Load it unpacked](#load-it-unpacked-and-reload-after-edits)).

## npm scripts

| Script | Runs | What it does | Writes files? |
| --- | --- | --- | --- |
| `npm run verify` | `node scripts/verify.mjs && node scripts/contrast.mjs` | Static checks on the unpacked extension, then the colour-contrast check. Stops at the first failing step | No |
| `npm run package` | `npm run verify && node scripts/package.mjs` | Runs `verify`, then writes `dist/pixelpush-<version>.zip` | `dist/` |
| `npm run preview` | `node tools/preview/serve.mjs` | Serves the side panel in a normal browser tab with stubbed `chrome.*` APIs | No |
| `npm run icons` | `node scripts/icons.mjs` | Re-renders `extension/icons/icon-{16,32,48,128}.png` from `brand/icon.svg` | `extension/icons/` |

There is no `test`, `lint` or `build` script.

### `verify`

`scripts/verify.mjs` walks every file under `extension/` and fails (exit code 1) on any of these:

- `manifest_version` is not 3.
- `manifest.version` differs from `package.json` `version`.
- A file the manifest names does not exist: icons, the toolbar icon, the side panel page, the service worker, content-script files and web-accessible resources.
- `sidepanel.html` references a file that does not exist.
- A `.js` file has a syntax error. Scripts that `sidepanel.html` loads with `type="module"` are parsed as modules (`panel.js`); everything else is parsed as a classic script.
- A `.json` file is not valid JSON.
- `LICENSE`, `THIRD_PARTY_NOTICES.md` or `licenses/Apache-2.0.txt` is missing.
- A bundled `.woff2` font has no matching `licenses/OFL-1.1-<name>.txt` (any letter case) or is not named in `THIRD_PARTY_NOTICES.md`.
- A `.js`, `.json`, `.html`, `.css`, `.md` or `.txt` file under `extension/` contains one of a fixed list of strings that only appeared in the build Pixelpush was forked from.
- A stray `.DS_Store` sits under `extension/`.

With the current tree it prints:

```text
verify: ok (16 files, manifest v2.1.0)
```

On failure it prints `verify: N problem(s)` and one line per problem. The file count changes when files are added to `extension/`.

### `contrast`

`scripts/contrast.mjs` checks that the side panel stays readable on its translucent glass. It reads the design tokens from the `:root { ... }` block of `extension/panel/pixelpush.css`, rebuilds the `body::before` light field in code, and composites each translucent surface over the brightest sampled point of that field and over pure black, the way the browser blends. It then measures 91 colour pairs against WCAG 2 AA: 4.5:1 for text, 3:1 for control outlines, focus rings and state indicators. One pair (the disabled primary label) has a minimum of 0 and is listed for information only. A third figure, with every glow stacked at once, is printed per row for information only; pass or fail uses the lower of the other two ratios (brightest sampled field point and pure black).

```sh
node scripts/contrast.mjs                                # the shipped stylesheet
node scripts/contrast.mjs tools/preview/variants/x.css   # a draft stylesheet
node scripts/contrast.mjs --md                           # also print a Markdown table
```

The last line of a passing run is:

```text
contrast: all 91 pairs pass
```

A failing run ends with `contrast: N pair(s) below minimum` and exits with code 1. The script mirrors the `body::before` geometry by hand, so if you change the light field in `pixelpush.css`, change the script too (the comment at the top of the stylesheet says the same).

### `package`

`scripts/package.mjs` builds the archive with Node built-ins only (`node:zlib`, including `crc32`), so it needs no `npm install`. It writes `dist/pixelpush-<version>.zip`, where `<version>` comes from `extension/manifest.json`.

- **Contents:** every file under `extension/` (skipping `.DS_Store`) with paths relative to `extension/`, so `manifest.json` is at the root of the archive. It also adds `LICENSE`, `THIRD_PARTY_NOTICES.md` and everything in `licenses/`.
- **Order and compression:** entries are sorted by name, and each is deflated at level 9 unless that is not smaller.
- **Reproducibility:** every entry gets the same fixed timestamp (1 January 2026), which the script says keeps the archive byte-for-byte reproducible.
- **Output:** with the current tree, `package: dist/pixelpush-2.1.0.zip (21 files)`.

`dist/` and `*.zip` are in `.gitignore`.

### `icons`

See [Regenerate the icons](#regenerate-the-icons).

## The preview harness

`npm run preview` starts a small static server on `127.0.0.1` and prints the URL to open:

```text
preview: http://localhost:4173/__preview/?demo=1
```

It serves `extension/` at `/` and the harness at `/__preview/`. Set `PORT` to change the port, for example `PORT=5000 npm run preview`. Responses are sent with `Cache-Control: no-store`, so reloading the tab picks up a CSS edit.

The harness loads the real `panel.js`. `index.html` loads `chrome-stub.js`, a minimal in-memory stand-in for the `chrome.*` APIs the panel touches, and `boot.js`, which copies the stylesheets from `sidepanel.html` and imports the bundle.

| URL parameter | Effect |
| --- | --- |
| `demo=1` | Renders the panel in its built-in demo state, with a sample element tree and styles. `boot.js` finds the root render call in the minified bundle with a regular expression and passes `{ demo: !0 }` to it, and adds a style so the panel fills the viewport. If the expression no longer matches, it logs `[preview] demo hook not found; rendering the default state` |
| `motion=off` | Adds a style that turns off all transitions and animations, so a screenshot never catches a frame mid-animation |
| `css=variants/name.css` | Loads `tools/preview/variants/name.css` in place of `pixelpush.css`. `tools/preview/variants/` is gitignored, so drafts stay local |

Combine them with `&`: `http://localhost:4173/__preview/?demo=1&motion=off`.

Once the bundle has been imported, the harness sets `data-preview-ready="true"` on `<html>`, which an automated screenshot script can wait for.

What the harness cannot do: no service worker, content script, `sidePanel`, `scripting` or context-menu API runs there, and `runtime.sendMessage` and `tabs.sendMessage` resolve to nothing. Selection, the Audit tab, Linear and AI jobs only work in the real extension. To run the detector on its own, see [Audit fixtures](#audit-fixtures). It also cannot reproduce styles that Chromium injects into extension pages, so check final changes in the real extension too (`docs/DESIGN.md` makes the same point).

The root path `/` serves the raw side-panel page without the stub; use `/__preview/`.

### Audit fixtures

Two plain HTML pages under `tools/preview/fixtures/` let you try the design audit without a live site. The preview server serves them at `/__preview/fixtures/<name>.html`. It serves `extension/` at `/`, so `/audit/detect.js` and the `/icons/*.png` files the pages use resolve from the extension folder.

| Fixture | What it is | What to expect |
| --- | --- | --- |
| `slop.html` | A deliberately generic, AI-looking landing page ("Nimbus") with real design problems: a gradient headline, glow and blur decoration, glass cards, emoji icons, an identical card row, a stat strip, numbered steps, placeholder links and copy, a stock avatar and a block of text that never reveals. A "What teams say" section is only built when a sentinel scrolls into view, which exercises the scroll pass. It loads one external image, `https://i.pravatar.cc/80?img=3`, as the stock avatar. | Many findings in both categories. Without the scroll pass the lazy section is never built, so its cards are never audited. |
| `clean.html` | A plain, well-built page ("Harbour Bakery") that serves as a negative control. | Little or nothing. Its header comment says it exists to catch false positives when a rule changes, so a new finding here after an edit to `detect.js` points at a rule that is too loose. |

### Run a scan against a fixture

In the extension, the panel asks the `audit.js` bridge for a scan and the bridge loads `detect.js` into the page. In a plain tab you send the same command by hand. Keep the tab visible, because the scroll pass skips a hidden tab.

1. Run `npm run preview`.
2. Open `http://localhost:4173/__preview/fixtures/slop.html` (or `clean.html`) in a normal tab.
3. Paste this into the tab's console:

```js
// Extension mode: wait for commands instead of scanning on load
document.documentElement.dataset.auditExtension = "true"
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "audit-results") return
  const rows = e.data.findings.flatMap((f) =>
    f.findings.map((x) => ({ selector: f.selector, rule: x.type, category: x.category, detail: x.detail })))
  console.log(`${rows.length} findings, ${new Set(rows.map((r) => r.rule)).size} rule types`)
  console.table(rows)
})
const s = document.createElement("script")
s.src = "/audit/detect.js"
s.onload = () => window.postMessage({
  source: "audit-command",
  action: "scan",
  config: { scanId: "t", autoScroll: true, visualContrast: true, visualContrastMaxCandidates: 30, visualContrastScrollOffscreen: true }
}, "*")
document.head.append(s)
```

The `config` holds the options the panel sends by default. Set `autoScroll: false` to scan the page without the scroll pass. Post the same command again to rescan.

What you see:

- **Progress.** While the scroll pass runs, the page posts `audit-progress` messages (`phase: "scrolling"` with a `pct` from 0 to 1, then `phase: "scanning"`). The page walks to the bottom and returns to where you were, unless you scroll or type during the pass.
- **Results.** They arrive as `audit-results` messages on `window`: `findings` is one entry per element, each with its selector and a `findings` list. With `visualContrast: true`, two messages arrive for one scan. The first comes as soon as the rules have run, and the second repeats the list with any text-over-image contrast findings added. Use the last one.
- **Lazy content on `slop.html`.** On a freshly loaded page, `document.querySelector("#late").children.length` is 2 after a scan with `autoScroll: true`, because the walk scrolled the sentinel into view and the cards were built. After a scan with `autoScroll: false` it is 0. Reload the page between the two runs.
- **Overlays.** The detector draws its highlight overlays on the page. A new scan clears the previous ones.

If you leave out the `data-audit-extension` line, loading `detect.js` runs a single scan about 100 ms later, draws the overlays and prints a summary in the console. That path never runs the scroll pass, so the lazy section of `slop.html` stays unbuilt unless you scroll to the bottom first. Use it for a quick look, and extension mode to exercise the scroll pass.

The research report records 6 rule types on `slop.html` before the audit work and 29 after, scanned in extension mode in Chromium. Treat those as a rough reference: the count moves when rules change, and nothing in the repository checks it automatically.

### Audit research record

`research/audit-2026-10/` is the evidence behind the October 2026 audit changes: the scroll pass, the 26 added rules, the page digest and the grounding gates. It is a record, not code. Nothing under `extension/` reads it, and `npm run verify` and `npm run package` do not touch it.

| File | Holds |
| --- | --- |
| `outputs/audit-improvements-decision-report.md` | The decision report: root causes, a provenance map from each adopted idea to its source and to the Pixelpush code that implements it, licence decisions, rejected and deferred ideas, what was verified and what is still unresolved. Start here. |
| `sources/sources.jsonl` | The 102 sources the four research arms read, one JSON object per line. |
| `artifacts/claim_ledger.jsonl` | 13 claims (`clm_001` to `clm_013`) with their source ids. Executable claims carry the script and output that was run, and numeric ones a counter-search. |
| `arms.json` | The notes of the four research arms: sources, proposals, gaps and rejected ideas. |

The report says every adopted item is an idea, threshold or failure mode re-implemented from scratch, with no third-party code or text copied. It also lists what was not calibrated: all numeric thresholds for the added rules are starting values, and the AI review was tested only through its deterministic parts (digest, grounding gates, prompt text), never against a live model. Read it before changing a threshold.

## Repository layout

```text
pixelpush/
  extension/                    The loadable extension. No build step
    manifest.json               Manifest V3
    sidepanel.html              Side panel entry
    background.js               Service worker (compiled)
    panel/
      panel.js                  Side panel bundle (compiled)
      tailwind.css              Compiled Tailwind utilities
      pixelpush.css             Design system: tokens, palette, components (source)
      fonts/                    Instrument Sans and JetBrains Mono (woff2)
    content-scripts/
      inspector.js              Page inspector (compiled)
      audit.js                  Audit bridge (compiled)
    audit/
      detect.js                 Design-audit detector (source, Apache-2.0)
      antipatterns.json         Audit rule catalog
    icons/                      icon-16, -32, -48 and -128 PNGs
  brand/
    icon.svg                    App icon; embeds a 512 px PNG master
    mark.svg                    The glyph alone, as vector
  docs/
    README.md                   Documentation hub
    getting-started.md  features.md  audit.md  ai-providers.md  linear.md
    privacy-and-permissions.md  architecture.md  development.md
    DESIGN.md                   Palette, type, shape and motion rules
    assets/                     Images used by the docs
    screenshots/                Side-panel captures used by the README and docs
  scripts/
    verify.mjs  contrast.mjs  package.mjs  icons.mjs
  tools/preview/
    serve.mjs  index.html  boot.js  chrome-stub.js
    fixtures/
      slop.html                 A deliberately flawed, AI-looking page (has a lazy section)
      clean.html                A well-built page: the audit's negative control
  research/
    audit-2026-10/              Sources, claim ledger and decision report behind the audit work
  licenses/                     Full texts: Apache-2.0 and the two OFL font licenses
  LICENSE                       MIT
  THIRD_PARTY_NOTICES.md        Notices for bundled third-party code
  package.json  package-lock.json  .editorconfig  .gitignore
```

Not tracked: `node_modules/`, `dist/`, `*.zip`, `*.pem`, `.DS_Store` and `tools/preview/variants/`.

## Load it unpacked and reload after edits

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder (the one that contains `manifest.json`).
3. Pin Pixelpush, then click its toolbar icon to open the side panel on the current tab.

After you change a file under `extension/`:

- Click the reload arrow on Pixelpush's card in `chrome://extensions`.
- Close and reopen the side panel so it loads the new `panel.js` and CSS.
- The service worker's install hook injects `inspector.js` and `audit.js` into open `http` and `https` tabs, but if the panel says it cannot reach the page after a reload, reload that tab.
- To see the service worker's console and network traffic, use the **service worker** link on the card. For the panel, right-click inside it and choose **Inspect**.

## Regenerate the icons

`scripts/icons.mjs` reads only `brand/icon.svg`. That file embeds a 512 px PNG master (the layers glyph on a violet-to-deep-purple tile) as an `<image>`, and the script resizes it with resvg to 16, 32, 48 and 128 px width and writes `extension/icons/icon-<size>.png`.

```sh
npm install        # once, for @resvg/resvg-js
npm run icons
```

It prints one line per file:

```text
icons: extension/icons/icon-16.png
icons: extension/icons/icon-32.png
icons: extension/icons/icon-48.png
icons: extension/icons/icon-128.png
```

`brand/mark.svg` is the vector glyph alone (`viewBox` `0 0 64 64`) for dark surfaces. The script does not read it. The side panel header shows `icons/icon-48.png`. To change the artwork, replace the embedded PNG in `brand/icon.svg` and run the script; commit the regenerated PNGs with the SVG.

## Editing guidance

| What you want to change | Edit | Notes |
| --- | --- | --- |
| Colours, glass, spacing, type, component styling of the panel | `extension/panel/pixelpush.css` | Loaded after `tailwind.css` and unlayered, so it wins over utilities. Check changes in the preview, then run `npm run verify`. If you touch the light field, update `scripts/contrast.mjs` too |
| A style for a new class in the panel | `pixelpush.css` | `tailwind.css` is compiled and there is no Tailwind build here, so a utility class that is not already in the file has no styles |
| Permissions, content-script scope, version, icons | `extension/manifest.json` | Keep `version` equal to `package.json`; `verify` checks it |
| Audit rules and detection | `extension/audit/detect.js`, `extension/audit/antipatterns.json` | Vendored from Impeccable under Apache-2.0. `detect.js` marks its own additions as "Pixelpush additions". The catalog and the `ANTIPATTERNS` array in `detect.js` list the same 72 rule ids. The panel reads the JSON for the rule names in Audit settings and the detector reads its own array, so change both together. After a change, scan both [audit fixtures](#audit-fixtures) and check that `clean.html` stays quiet. If you change the logic or the catalog, keep the "Changes from the upstream source" paragraph in `THIRD_PARTY_NOTICES.md` accurate |
| Fonts | `extension/panel/fonts/` | Each font needs its OFL text in `licenses/` and a row in `THIRD_PARTY_NOTICES.md`, or `verify` fails |
| Panel behaviour, the AI router, the inspector, the audit bridge | `panel.js`, `background.js`, `inspector.js`, `audit.js` | Compiled, minified, single-letter identifiers. See below |

### Working with the compiled bundles

The repository does not contain the build that produced them, so a change to bundled behaviour has to be made in the minified output itself. A few habits make that tolerable:

- **Search for strings, not names.** UI text, message `type` values and storage keys survive minification. The bundles are mostly very long lines, so print only the match with some context:

  ```sh
  grep -o '.\{80\}AI_COMPLETE.\{200\}' extension/background.js
  grep -o '.\{120\}Disable AI features.\{200\}' extension/panel/panel.js
  ```

- **Make small, anchored edits** and keep each one to a single, well-understood expression.
- **Run `npm run verify` after every edit.** It syntax-checks every script.
- **Keep the preview's demo hook in mind.** `boot.js` locates the root render call in `panel.js` with a regular expression, `/(\.render\(\w+\.jsx\(\w+\.StrictMode,\{children:\w+\.jsx\(\w+,)\{\}\)/`, which matches a call of the form `.render(a.jsx(b.StrictMode,{children:a.jsx(App,{})}))`. A change to that call, or a rebuilt bundle, can break `?demo=1`.
- **Check in the real extension.** Anything that involves selection, the audit, Linear or AI needs a live page and cannot be tested in the preview.

If you rebuild the bundles from an upstream source tree, drop the new output into the same paths and re-run `verify`.

## Release and packaging

1. Choose the version. Set it in `extension/manifest.json` and in `package.json`. `package-lock.json` carries the version in two places as well; `verify` does not check the lockfile, so update it too.
2. Run `npm run verify`. It must end with `contrast: all 91 pairs pass` (the count follows the number of pairs in the script).
3. Run `npm run package` to create `dist/pixelpush-<version>.zip`.
4. Smoke-test the archive: unzip it into an empty folder and load that folder with **Load unpacked**. The archive's root is the extension, with `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/` alongside.
5. Upload the archive wherever you distribute it. `scripts/package.mjs` describes the archive as one "for the Chrome Web Store or manual installs", and the README says Pixelpush is not on the Chrome Web Store yet. Nothing in this repository describes a store submission process.

## Contributing

The repository has no `CONTRIBUTING.md`, no CI configuration and no test suite, so these are the conventions the files themselves state.

- **Report problems and ask for changes** at [github.com/andrewr303/pixelpush/issues](https://github.com/andrewr303/pixelpush/issues). The panel's feedback icon links there.
- **Run `npm run verify`** before you share a change. It is the only automated check. It does not cover `tools/` or `research/`, and it does not run the audit, so after a change to a rule, scan the [audit fixtures](#run-a-scan-against-a-fixture) by hand.
- **Follow `.editorconfig`:** UTF-8, LF line endings, a final newline, two-space indentation.
- **Keep the licenses honest.** Pixelpush is MIT-licensed (`LICENSE`, copyright 2026 Andrew Rodriguez). Third-party code keeps its own license and needs an entry in `THIRD_PARTY_NOTICES.md`; the packager copies that file and `licenses/` into every archive.
- **Keep design changes in step with their documentation.** `pixelpush.css` is the source of truth for the look; [DESIGN.md](DESIGN.md) explains the decisions behind it.

## Next

- [Architecture](architecture.md): components, messages and what is compiled.
- [Privacy and permissions](privacy-and-permissions.md): what the extension can access and send.
- [DESIGN.md](DESIGN.md): the design system behind `pixelpush.css`.
