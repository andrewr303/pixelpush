<div align="center">

<img src="docs/assets/banner.svg" alt="Pixelpush: pick an element, tweak it live, audit the page, file it to Linear." width="100%">

<p>
  <strong>A Chrome side panel for fixing UI in place.</strong><br>
  Inspect, tweak and audit any page, then file the fix to Linear, with your own AI model if you want one.
</p>

<p>
  <a href="#install">Install</a> &nbsp;·&nbsp;
  <a href="#features">Features</a> &nbsp;·&nbsp;
  <a href="#connect-linear">Linear</a> &nbsp;·&nbsp;
  <a href="#privacy">Privacy</a> &nbsp;·&nbsp;
  <a href="docs/README.md">Docs</a> &nbsp;·&nbsp;
  <a href="#develop">Develop</a>
</p>

<p>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-804efa?style=flat-square&amp;labelColor=15102b"></a>
  <a href="extension/manifest.json"><img alt="Manifest V3" src="https://img.shields.io/badge/manifest-V3-804efa?style=flat-square&amp;labelColor=15102b"></a>
  <img alt="Chrome 116 or later" src="https://img.shields.io/badge/chrome-116%2B-804efa?style=flat-square&amp;labelColor=15102b">
</p>

<table>
  <tr>
    <td align="center" valign="top">
      <a href="docs/screenshots/design.png"><img src="docs/screenshots/design.png" width="250" alt="Pixelpush Design tab: the page's element tree above the annotation fields and style editor for the selected element."></a><br>
      <sub><b>Design</b>: element tree, notes and live style editor</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/screenshots/audit.png"><img src="docs/screenshots/audit.png" width="250" alt="Pixelpush Audit tab: nine findings, an AI model switcher, Enrich with AI and Self-Drive, then findings grouped into AI tells and quality issues."></a><br>
      <sub><b>Audit</b>: findings, highlighted on the page</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/screenshots/changes.png"><img src="docs/screenshots/changes.png" width="250" alt="Pixelpush Changes tab: export buttons for AFS Markdown, AFS JSON, CSS and Tailwind, MCP sync, and a list of annotations with intent, severity and status."></a><br>
      <sub><b>Changes</b>: every edit and note, ready to export</sub>
    </td>
  </tr>
</table>

</div>

## Why Pixelpush

You can see what is wrong with a screen, but writing it up for whoever builds it takes
longer than the fix would. Pixelpush closes that gap. Pick an element, nudge its styles
until it looks right, run a design audit, and send the result to Linear as a ready-to-build
issue. An AI model you choose can rewrite the issue for you.

The issue carries the evidence: a From/To table for every property you changed, the audit
findings you selected, and the page it came from.

Pixelpush has no backend of its own. Requests go from your browser straight to Linear and
to the AI provider you configure.

## Install

Pixelpush is not on the Chrome Web Store yet, so you load it unpacked. You need Chrome 116
or later, the first version that lets an extension open its side panel on demand. There is
nothing to build.

1. Clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and choose the `extension/` folder.
4. Pin Pixelpush, then click its toolbar icon to open the side panel.

## Your first fix

1. Open any page and click the Pixelpush icon. Right-clicking the page and choosing
   **Design with Pixelpush** also opens the panel.
2. Click an element on the page. Selection mode (the cursor button in the panel header)
   starts on, and it is unavailable on the Audit tab.
3. Change a value in the **Design** tab, for example the padding or the font size.
4. Open **Changes** to see the diff, then use **Copy CSS** or **Copy Tailwind**.

To file it instead, [connect Linear](#connect-linear) and press the primary button in the
bar at the bottom of the panel. On every tab except Issue it builds a draft in the **Issue**
tab. Check the title, team and project, then press it again to create the issue.
[docs/getting-started.md](docs/getting-started.md) walks through the same steps in more detail.

## Features

| Tab | What you get |
| --- | --- |
| **Design** | An element tree for the page, a floating annotation toolbar on the page (**Annotate**, **Place UI**, **Rearrange**, **Draw**, **Self-Drive**, **Freeze**), per-element notes with intent and severity, and a live style editor for layout, spacing, size, colour, type, borders, radius and shadow. |
| **Inspect** | The selected element's size, colours, font, box model and text/background contrast ratio, plus its full DOM path, accessibility attributes and framework component stack. Copy it as CSS, Tailwind or AFS JSON. |
| **Colors** | The colours in use on the page, most used first, with the roles each one plays (text, background, border). Filter by hex or role, copy a value, or export the lot as CSS variables. |
| **Issue** | Writes up your edits, notes, annotations and audit findings as a Linear issue, then files it to the team and project you pick. Also lists recent and matching issues. |
| **Changes** | Every edit and annotation (pinned notes, placed UI, rearrangements, drawings, AI critiques) as a diff. Copy as CSS, Tailwind, AFS Markdown (`Compact`, `Standard`, `Detailed` or `Forensic`) or AFS JSON, or push the session to an MCP server (default `http://localhost:4747`). |
| **Audit** | Scrolls the page first so lazy-loaded sections exist, then runs 72 checks: 41 AI tells and 31 quality issues such as contrast, tiny text, cramped padding, missing labels and overused patterns. Each finding is highlighted on the page, and you can pin it to AFS or suppress it. See [docs/audit.md](docs/audit.md). |

**AFS** is the Annotation Format Schema (v1.1+), the structured format Pixelpush uses for
annotations. The schema is in [`extension/schema/annotation.v1.1.json`](extension/schema/annotation.v1.1.json).

<table>
  <tr>
    <td align="center" valign="top">
      <a href="docs/screenshots/inspect.png"><img src="docs/screenshots/inspect.png" width="250" alt="Pixelpush Inspect tab: size, colours, font, contrast and box model for a table cell, with Copy CSS, Tailwind and AFS JSON buttons."></a><br>
      <sub><b>Inspect</b>: size, colour, contrast and box model</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/screenshots/issue.png"><img src="docs/screenshots/issue.png" width="250" alt="Pixelpush Issue tab: a connected Linear workspace, an AI model switcher, the issue composer with team, priority and project, and a list of recent issues."></a><br>
      <sub><b>Issue</b>: composer and recent Linear issues</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/screenshots/settings.png"><img src="docs/screenshots/settings.png" width="250" alt="Pixelpush Settings: the Disable AI features checkbox, the Background glow option, app origins and the providers section."></a><br>
      <sub><b>Settings</b>: AI switch, app origins, providers</sub>
    </td>
  </tr>
</table>

Each tab is covered in [docs/features.md](docs/features.md).

### AI features

AI is optional and off until you add a provider. Four features use it:

- **Rewrite with AI** turns the raw capture, including annotations, wireframes and threads, into a clean issue.
- **Propose edits** suggests CSS for the selected element, across 34 layout, typography and visual properties plus its text, from a note you write.
- **Self-Drive** walks the page on its own and attaches structured design critiques, each with a one-click CSS or text fix.
- **Enrich with AI** reviews the audit. It can hide false hits and add findings, and the panel drops any suggestion it cannot tie back to the page outline it sent (see [How suggestions are checked](docs/audit.md#how-suggestions-are-checked)).

You can stay signed in to several providers at once, star favorite models (`★`), and switch
between them from the **AI Quick Switcher** in the Design, Audit and Issue tabs. The
**Disable AI features** checkbox in Settings turns every AI feature off and keeps your keys.

### Keyboard and accessibility

The panel is keyboard operable. The tabs move with the arrow keys, Home and End, Esc closes
Settings, and the divider between the element tree and the editor resizes with the up and
down arrow keys. Toasts and status messages go through live regions, and motion respects
`prefers-reduced-motion`. The full key list is in
[docs/features.md](docs/features.md#keyboard-navigation-and-accessibility).

### From capture to filed issue

```mermaid
flowchart LR
    pick["Pick an element"] --> edit["Edit styles live"]
    edit --> changes["Changes: diff, CSS, Tailwind"]
    scan["Audit the page"] --> findings["Findings, highlighted on the page"]
    changes --> draft["Issue draft"]
    findings --> draft
    draft --> rewrite["Rewrite with AI (optional)"]
    draft --> linear["Linear issue"]
    rewrite --> linear
```

You edit an element, audit the page, or do both. Either path ends in an issue draft, which
you can send through an AI rewrite before it is filed to Linear.

## Connect Linear

Pixelpush files issues with a Linear personal API key. Everything else works without one.

1. In Linear, open **Settings → API** and create a personal API key (it starts with `lin_api_`).
2. In Pixelpush, open **Issue → Connect Linear** and paste the key.

The key stays in this Chrome profile's local extension storage and carries your full Linear
permissions, so treat it like a password. Linear sign-in through OAuth is not configured in
this build.

Pixelpush treats `localhost`, `127.0.0.1` and `[::1]` as your own app. Add your production
and staging hosts under **Settings → App origins**. A capture from any other host asks you
to acknowledge that before it is filed, so you do not send someone else's site to Linear by
accident. Details: [docs/linear.md](docs/linear.md).

## AI providers

Open **Settings** (gear icon) and add one or more providers. Pixelpush uses the active
provider, which defaults to the first enabled one. Press **Test connection** on a provider
card to check the key and model.

| Provider | You supply | Notes |
| --- | --- | --- |
| OpenAI compatible | Base URL, model, API key | Defaults to `https://api.openai.com/v1` and `gpt-4.1-mini`. Any server that speaks the chat completions API works. |
| Cloudflare Workers AI | Account ID (or custom Base URL), `@cf/...` model, API token | Calls the account's `ai/v1/chat/completions` endpoint. Eight model presets, or any custom `@cf/...` ID. |
| Bedrock Mantle | AWS region (default `us-east-1`), model, Bedrock API key | Default model `openai.gpt-6.1-terra`. The key needs `bedrock-mantle:CreateInference`. |
| Bedrock Runtime | AWS region (default `us-east-1`), model, Bedrock API key | Default model `us.openai.gpt-6.1-terra`. Only the listed `us.` and `global.` inference profiles are accepted. The key needs `bedrock:InvokeModel`. |
| Local CLI | CLI profile (`claude`, `codex`, `grok`, `gemini`, `ollama`, `llm`) or a custom binary path | Talks to a local bridge on `127.0.0.1:58932`. The bridge is **not** included with Pixelpush, so this provider works only if you run your own. |

Model lists, endpoints, request formats and error messages for each provider are in
[docs/ai-providers.md](docs/ai-providers.md).

## Privacy

Pixelpush has no analytics and no telemetry. Network requests happen only when you ask
for them:

- **Linear** (`api.linear.app`) when you connect, list issues or file one.
- **Your AI provider**, at the endpoint you configured, when you press an AI button or
  **Test connection**. The first time an AI button sends something to a provider other
  than Local CLI, Pixelpush asks you to confirm what will be sent. Enrich with AI asks
  separately for each provider type, because it also sends a compact outline of the page
  (headings, button and link labels, short copy excerpts, style statistics) and the page URL
  without its query string or fragment.
- **The local bridge** on `127.0.0.1`, only if you added a Local CLI provider.

Settings sync through your Chrome profile (`chrome.storage.sync`). API keys and the Linear
credential stay in local extension storage (`chrome.storage.local`) and never sync. The only
trace of a saved key in synced settings is a short hint: its first three and last four
characters. The content scripts are injected into every page (`<all_urls>`) so the inspector
is ready as soon as you open the panel.

The extension asks Chrome for the `sidePanel`, `scripting`, `contextMenus` and `storage`
permissions, plus access to all sites.
[docs/privacy-and-permissions.md](docs/privacy-and-permissions.md) explains what each one is for.

## Develop

The `extension/` folder is the complete, loadable extension: plain files, no build step.
The side panel, page inspector, audit bridge and background worker are compiled, minified
bundles. The design-audit detector (`audit/detect.js`) and the panel's design layer
(`panel/pixelpush.css`) are readable source.

Node 22.2 or later runs the helper scripts. Only `npm run icons` needs `npm install`; the
others use Node built-ins.

```sh
npm run verify    # manifest references, syntax, licenses, leftover strings, colour contrast
npm run package   # verify, then write dist/pixelpush-<version>.zip for the Web Store
npm run preview   # serve the side panel in a normal tab at http://localhost:4173/__preview/?demo=1
npm run icons     # re-render extension/icons/ from brand/icon.svg
```

The preview harness stubs the `chrome.*` APIs and renders the real panel bundle, which is
how the Settings screenshot was captured. Add `?demo=1` for the built-in sample
element and `&motion=off` to freeze transitions for screenshots. Behaviour that needs a
live page, such as selection, the Audit tab and Linear, works only in Chrome.

Two fixture pages for the audit sit in `tools/preview/fixtures/`. `slop.html` is a
deliberately generic, AI-looking page with a section that only exists once scrolled into
view, and `clean.html` is a negative control that should report little or nothing.
[docs/audit.md](docs/audit.md#testing-it-yourself) shows how to run the detector on them by hand.

The look of the panel lives in one readable stylesheet, `extension/panel/pixelpush.css`.
[docs/DESIGN.md](docs/DESIGN.md) explains the palette, type, shape and motion rules behind
it. More in [docs/development.md](docs/development.md) and [docs/architecture.md](docs/architecture.md).

<details>
<summary>Repository layout</summary>

```text
extension/
  manifest.json            Manifest V3
  sidepanel.html           Side panel entry
  panel/
    panel.js               Side panel bundle
    tailwind.css           Compiled Tailwind utilities
    pixelpush.css          Design system: tokens, palette, components
    fonts/                 Instrument Sans and JetBrains Mono
  icons/                   Toolbar and store icons
  background.js            Service worker: injection, context menu, AI provider calls
  content-scripts/
    inspector.js           Element picking, live style edits, page tokens
    audit.js               Bridge between the panel and the detector
  audit/
    detect.js              Design-audit detector (Apache-2.0)
    antipatterns.json      Audit rule catalog (72 rules)
  schema/
    annotation.v1.1.json   Annotation Format Schema (AFS v1.1+) JSON Schema
skills/
  pixelpush-self-driving/  Autonomous visual critique & AFS v1.1+ annotation skill
brand/                     Icon sources: icon.svg (512 px PNG master), mark.svg (vector glyph)
docs/                      Documentation, design system notes, banner and screenshots
research/                  Research records: sources, claim ledgers, decision reports
review/                    Cross-model review of the AFS integration: report, evidence, consult transcripts
scripts/                   verify, contracts, contrast, package, icons
tools/preview/             Browser preview harness for the side panel, plus audit fixtures
licenses/                  Full license texts for bundled third-party code
```

</details>

## Documentation

The [documentation hub](docs/README.md) lists every page by what you are trying to do.

| Page | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install the extension, open the panel and make a first fix. |
| [Features](docs/features.md) | Every tab and control, one tab at a time. |
| [Audit](docs/audit.md) | How a scan runs, the page scroll, the 72 rules and how an AI review is checked. |
| [AI providers](docs/ai-providers.md) | The five provider types: what each needs, which models and endpoints it uses, and how to test it. |
| [Linear](docs/linear.md) | Connecting a personal API key, app origins and filing an issue. |
| [Privacy and permissions](docs/privacy-and-permissions.md) | Network requests, stored data and the permissions the extension asks for. |
| [Architecture](docs/architecture.md) | The service worker, content scripts and side panel, and how they work together. |
| [Development](docs/development.md) | Helper scripts, the preview harness and packaging. |
| [Design system](docs/DESIGN.md) | The Ultraviolet theme tokens, type, shared field and button states, motion and the layers brand mark. |

## Contributing

The repository has no `CONTRIBUTING.md`, CI configuration or test suite. Run `npm run verify`
before you open a pull request, and read the conventions in
[docs/development.md](docs/development.md#contributing). Bugs and doc mismatches go in
[GitHub issues](https://github.com/andrewr303/pixelpush/issues).

## License

Pixelpush is released under the [MIT License](LICENSE). It contains code from other
open-source projects under their own licenses, including the Apache-2.0 design-audit
detector in `extension/audit/`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
