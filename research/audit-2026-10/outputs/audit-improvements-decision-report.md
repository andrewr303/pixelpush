# Design audit improvements: research decision report

Scope: make the Pixelpush design audit find real design problems and AI-generated-page tells, scroll pages
before scanning, and give the optional AI review the page itself instead of only the detector's own output.
Ledgers: [sources](../sources/sources.jsonl) (102 sources), [claims](../artifacts/claim_ledger.jsonl) (13 claims).
Source ids (`A1-…` to `A4-…`) are the four research arms; `L-fixture` is this repository's own test page.
Nothing was cloned or executed from third-party repositories, and no third-party code or text was copied:
every adopted item is an idea, threshold or failure mode re-implemented from scratch.

## Root causes found in the existing audit

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | Six of the 46 vendored rules never run in the extension build (`marketing-buzzword`, `aphoristic-cadence`, `em-dash-overuse`, `numbered-section-markers`, `broken-image`, `design-system-font-size`), including all the copy tells of generated text. | clm_001 |
| 2 | The scan never scrolls, so lazily built and reveal-on-scroll sections are invisible to it. | clm_002 |
| 3 | Colour parsing only understood `rgb()`. Pages using `oklch()` (Tailwind v4, most modern systems) parsed as "no colour", fell back to white and produced false contrast failures. | clm_003 |
| 4 | The AI step received only the detector's findings and tokens, never the page, so anything it "added" was ungrounded. | `panel.js` pack builder (`hd`), `background.js` prompt (read before the change) |

## Provenance map

| Requirement | Adopted idea | Evidence (`repo@sha:path`) | Claim | Original implementation |
| --- | --- | --- | --- | --- |
| Reach lazy and reveal-on-scroll content | Walk the page in viewport steps, wait for quiet, restore position; skip when the tab is hidden; stop on stall or real user input; cap time, steps and distance; treat repeated growth at the bottom as an infinite feed | `pbakaus/impeccable@5e745ac:crates/browser/src/lib.rs` (reveal sweep), `web.dev` lazy-loading docs, `A3-s8/s9/s10` crawler helpers | clm_002, clm_010 | `settlePage()` in `extension/audit/detect.js` |
| Report content that never reveals | Count text that is still at opacity 0 after the sweep, probe each block, fire at 200/150/30 % | `impeccable@5e745ac:crates/core/src/checks/measures.rs`; `Nutlope/hallmark@8f6969f:gates.md` gate 62 | clm_010 | `ppHiddenTextBlocks`, `ppProbeHiddenBlocks`, rule `content-hidden-at-rest` |
| Detect generated copy | Implement the declared-but-dead copy rules; calibrate em-dash to 8 and 1 per 500 characters; AI-voice phrase and lexicon scoring | `impeccable@5e745ac:crates/foundation/src/rules/text.rs`; Wikipedia *Signs of AI writing*; `petergyang/no-ai-slop@000650b` | clm_001, clm_008, clm_011 | `collectPixelpushExtras`, `collectPixelpushTells` |
| Detect generated visuals | Accent word in headline, radial halo (incl. pseudo-elements), blobs, glass, emoji icons, identical cards, stat strips, tinted icon squares, pulsing dots, template punctuation | `yetone/kill-ai-slop@f6e2ae3`; `Nutlope/hallmark@8f6969f`; `anthropics/skills@ca45fc4:frontend-design` | clm_007, clm_012 | rules in `collectPixelpushTells` |
| Real accessibility and quality problems | Alt text, input labels, accessible names, 24 px target size with spacing exception, link distinctness, focus outline removal, overflow, `lang`, `h1`, generic link text, placeholder links, token sprawl | axe-core `6b52b84` (target-size, link-in-text-block, image-alt, label), Lighthouse `772c9e2` (link-text), WCAG 2.5.8 / F73 / 2.4.7, Project Wallace analyzer | clm_005, clm_006 | `collectPixelpushExtras` and controls block |
| Stop false positives on modern pages | Resolve any CSS colour space through the browser | CSS Color 4 | clm_003 | `parseModernColor` |
| Give the AI the page | Compact digest with short element refs, copy sample, hero facts, style census, coverage; every page string untrusted | `browser-use@2cc7189`, `stagehand@d59afde`, `agent-browser@1453dd3` (element-id grounding) | clm_009 | `buildPageDigest()` |
| Stop invented AI findings | Cite a ref and a quote from the digest; drop restatements; cap AI-tell severity at medium; ignore mostly-ungrounded output; strip URL query | A4 grounding design (A4-02/03/04/09) | clm_009, clm_013 | `ppGround` in `panel.js`; prompt in `background.js` |

## Licence decisions

The detector this extension vendors is Apache-2.0 (Impeccable) and stays so. Every other source is used for
ideas only: no file, regex list, prompt text or code was copied. The AGPL projects found (`webrecorder`,
`gildas-lormeau`) were read for technique only and nothing from them was adopted.

## Rejected or deferred

- Chrome DevTools Protocol viewport inflation (Lighthouse full-page screenshots): needs the `debugger`
  permission and a visible "debugging this browser" banner, a far larger trust cost than an in-page scroll.
- Hook patching of `IntersectionObserver` at `document_start` (SingleFile style): fragile, cannot retrigger
  observers created earlier.
- Two-call (blind discovery, then adjudication) AI topology and model-computed screenshots or boxes: more cost and
  latency than a first version needs; the grounding gates already bound false positives.
- Deferred rules with high false-positive risk or no calibration corpus: mono-as-costume labels, default
  semantic palette, `transition: all` counts, corner-integrity checks, fake window chrome, shape-assembled
  illustrations, template hero skeleton, uniform scroll-reveal across sections.

## Verification actually performed

- Fixture `tools/preview/fixtures/slop.html` scanned in extension mode in Chromium: 6 rule types before, 29 after;
  scroll position restored; no errors (clm_002, clm_004).
- The Pixelpush panel (a deliberately designed page) scanned before and after the colour fix: 8 false contrast
  failures removed (clm_003).
- Grounding gates unit-tested with legitimate, fabricated, restating and mostly-ungrounded suggestions (clm_013).
- Content-script bridge exercised in Node with stubs: valid progress and digest messages forwarded, malformed
  ones dropped, digest request reaches the detector.
- `npm run verify` (manifest, syntax, licences, 91 contrast pairs) passes.

## Unresolved

- clm_011: the em-dash calibration (8 dashes, 1 per 500 characters) comes from one organisation; no independent
  source was found. It is adopted because the previous threshold (3) is plainly noisier, and is disclosed here.
- clm_012: the placeholder-avatar host list comes from one catalog (Hallmark); the rule requires a
  testimonial-shaped container or three or more images to limit damage.
- All numeric thresholds for the new rules (stat rows, card grids, token sprawl, AI-voice score, halo area) are
  initial values from the cited tools and have not been calibrated on a labelled corpus of real pages.
- The AI review was tested only through its deterministic parts (digest, grounding gates, prompt text). It was not
  run against a live model, so output quality and the false-positive rate on real models are unmeasured.
- The scroll pass was tested on one fixture in a Chromium tab; its behaviour on infinite feeds, scroll-jacked
  pages and single-page apps is designed from the cited sources but not exercised.
- The in-app test browser reports itself as a hidden tab; the scroll pass deliberately skips hidden tabs, so tests
  forced the visibility value. A normal visible tab needs no override.

## Refuted

None of the 13 claims was refuted by a counter-search or by execution.
