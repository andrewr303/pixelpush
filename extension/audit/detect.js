/**
 * Design-audit browser detector, as shipped in Pixelpush.
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * Derived from Impeccable (cli/engine/browser/injected/index.mjs).
 * Modified: Impeccable-specific identifiers were renamed when the detector
 * was vendored into the extension, and this header was rewritten for
 * Pixelpush. Pixelpush later changed the detector: it scrolls the page before
 * scanning, builds a page digest for the AI review, runs the copy and broken-image
 * rules that the browser build had declared but never ran, adds further rules,
 * and parses modern CSS colour spaces. Those additions are original Pixelpush
 * code, offered under the same Apache-2.0 license as this file.
 * See THIRD_PARTY_NOTICES.md at the repository root.
 */
(function () {
if (typeof window === "undefined") return;
// --- cli/engine/shared/constants.mjs ---
// ─── Section 1: Constants ───────────────────────────────────────────────────

const SAFE_TAGS = new Set([
  'blockquote', 'nav', 'a', 'input', 'textarea', 'select',
  'pre', 'code', 'span', 'th', 'td', 'tr', 'li', 'label',
  'button', 'hr', 'html', 'head', 'body', 'script', 'style',
  'link', 'meta', 'title', 'br', 'img', 'svg', 'path', 'circle',
  'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'use',
]);

// Per-check safe-tags override for the border (side-tab / border-accent)
// rule. We intentionally re-allow <label> here because card-shaped clickable
// labels (e.g. .checklist-item wrapping a checkbox + content) are one of the
// canonical side-tab anti-pattern shapes and must be detected. The rule's
// other preconditions (non-neutral color, width >= 2px on a single side,
// radius > 0 or width >= 3, element size >= 20x20 in the browser path)
// already filter out plain inline form labels so this does not introduce
// false positives. See modern-color-borders.html for the test matrix.
const BORDER_SAFE_TAGS = new Set(
  [...SAFE_TAGS].filter(t => t !== 'label')
);

const OVERUSED_FONTS = new Set([
  // Older monoculture (still ubiquitous):
  'inter', 'roboto', 'open sans', 'lato', 'montserrat', 'arial', 'helvetica',
  // Newer monoculture (the Anthropic-skill / Vercel / GitHub default wave):
  'fraunces', 'instrument sans', 'instrument serif',
  'geist', 'geist sans', 'geist mono',
  'mona sans',
  'plus jakarta sans', 'space grotesk', 'recoleta',
]);

// Brand-associated fonts: don't flag these as "overused" on the brand's own domains.
// Keys are font names, values are arrays of hostname suffixes where the font is allowed.
const GOOGLE_DOMAINS = [
  'google.com', 'youtube.com', 'android.com', 'chromium.org',
  'chrome.com', 'web.dev', 'gstatic.com', 'firebase.google.com',
];
const VERCEL_DOMAINS = ['vercel.com', 'nextjs.org', 'v0.app'];
const GITHUB_DOMAINS = ['github.com', 'githubnext.com'];
const BRAND_FONT_DOMAINS = {
  'roboto': GOOGLE_DOMAINS,
  'google sans': GOOGLE_DOMAINS,
  'product sans': GOOGLE_DOMAINS,
  'geist': VERCEL_DOMAINS,
  'geist sans': VERCEL_DOMAINS,
  'geist mono': VERCEL_DOMAINS,
  'mona sans': GITHUB_DOMAINS,
};

function isBrandFontOnOwnDomain(font) {
  if (typeof location === 'undefined') return false;
  const allowed = BRAND_FONT_DOMAINS[font];
  if (!allowed) return false;
  const host = location.hostname.toLowerCase();
  return allowed.some(suffix => host === suffix || host.endsWith('.' + suffix));
}

const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui',
  'inherit', 'initial', 'unset', 'revert',
]);

// WCAG large text thresholds are defined in points: 18pt normal text and
// 14pt bold text. Browsers expose font-size in CSS pixels at 96px per inch.
const WCAG_LARGE_TEXT_PX = 18 * (96 / 72);
const WCAG_LARGE_BOLD_TEXT_PX = 14 * (96 / 72);

// Serif faces that show up in italic-display heroes. The rule also fires when
// the primary face is unknown but the stack ends in the generic `serif` token,
// which catches custom/private faces with a serif fallback.
const KNOWN_SERIF_FONTS = new Set([
  'fraunces', 'recoleta', 'newsreader', 'playfair display', 'playfair',
  'cormorant', 'cormorant garamond', 'garamond', 'eb garamond',
  'tiempos', 'tiempos headline', 'tiempos text',
  'lora', 'vollkorn', 'spectral',
  'source serif pro', 'source serif 4', 'source serif',
  'ibm plex serif', 'merriweather',
  'libre caslon', 'libre baskerville', 'baskerville',
  'georgia', 'times new roman', 'times',
  'dm serif display', 'dm serif text',
  'instrument serif', 'gt sectra', 'ogg', 'canela',
  'freight display', 'freight text',
]);

// --- cli/engine/registry/antipatterns.mjs ---
const ANTIPATTERNS = [
  // ── AI slop: tells that something was AI-generated ──
  {
    id: 'side-tab',
    category: 'slop',
    name: 'Side-tab accent border',
    description:
      'Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.',
    skillSection: 'Visual Details',
    skillGuideline: 'colored accent stripe',
  },
  {
    id: 'border-accent-on-rounded',
    category: 'slop',
    name: 'Border accent on rounded element',
    description:
      'Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.',
    skillSection: 'Visual Details',
    skillGuideline: 'colored accent stripe',
  },
  {
    id: 'overused-font',
    category: 'slop',
    scopes: ['type'],
    name: 'Overused font',
    description:
      'Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk are used on so many sites they no longer feel distinctive. Each new wave of AI-generated UIs converges on the same handful of faces. Choose a face that gives your interface personality.',
    skillSection: 'Typography',
    skillGuideline: 'overused fonts like Inter',
  },
  {
    id: 'single-font',
    category: 'slop',
    scopes: ['type'],
    name: 'Single font for everything',
    description:
      'Only one font family is used for the entire page. Pair a distinctive display font with a refined body font to create typographic hierarchy.',
    skillSection: 'Typography',
    skillGuideline: 'only one font family for the entire page',
  },
  {
    id: 'flat-type-hierarchy',
    category: 'slop',
    scopes: ['type'],
    name: 'Flat type hierarchy',
    description:
      'Font sizes are too close together — no clear visual hierarchy. Use fewer sizes with more contrast (aim for at least a 1.25 ratio between steps).',
    skillSection: 'Typography',
    skillGuideline: 'flat type hierarchy',
  },
  {
    id: 'gradient-text',
    category: 'slop',
    name: 'Gradient text',
    description:
      'Gradient text is decorative rather than meaningful — a common AI tell, especially on headings and metrics. Use solid colors for text.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'gradient text for',
  },
  {
    id: 'ai-color-palette',
    category: 'slop',
    name: 'AI color palette',
    description:
      'Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'AI color palette',
  },
  {
    id: 'cream-palette',
    category: 'slop',
    name: 'Cream / beige palette',
    description:
      'A warm cream or beige page background has become the default "tasteful" AI surface, reached for by reflex. Choose a background that comes from a deliberate palette, not the safe warm off-white.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'cream and beige as the default surface',
  },
  {
    id: 'nested-cards',
    category: 'slop',
    scopes: ['layout'],
    name: 'Nested cards',
    description:
      'Cards inside cards create visual noise and excessive depth. Flatten the hierarchy — use spacing, typography, and dividers instead of nesting containers.',
    skillSection: 'Layout & Space',
    skillGuideline: 'Nest cards inside cards',
  },
  {
    id: 'monotonous-spacing',
    category: 'slop',
    scopes: ['layout'],
    name: 'Monotonous spacing',
    description:
      'The same spacing value used everywhere — no rhythm, no variation. Use tight groupings for related items and generous separations between sections.',
    skillSection: 'Layout & Space',
    skillGuideline: 'same spacing everywhere',
  },
  {
    id: 'bounce-easing',
    category: 'slop',
    name: 'Bounce or elastic easing',
    description:
      'Bounce and elastic easing feel dated and tacky. Real objects decelerate smoothly — use exponential easing (ease-out-quart/quint/expo) instead.',
    skillSection: 'Motion',
    skillGuideline: 'bounce or elastic easing',
  },
  {
    id: 'dark-glow',
    category: 'slop',
    name: 'Dark mode with glowing accents',
    description:
      'Dark backgrounds with colored box-shadow glows are the default "cool" look of AI-generated UIs. Use subtle, purposeful lighting instead — or skip the dark theme entirely.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'dark mode with glowing accents',
  },
  {
    id: 'icon-tile-stack',
    category: 'slop',
    scopes: ['layout'],
    name: 'Icon tile stacked above heading',
    description:
      'A small rounded-square icon container above a heading is the universal AI feature-card template — every generator outputs this exact shape. Try a side-by-side icon and heading, or let the icon sit in flow without its own container.',
    skillSection: 'Typography',
    skillGuideline: 'large icons with rounded corners above every heading',
  },
  {
    id: 'italic-serif-display',
    category: 'slop',
    scopes: ['type'],
    name: 'Italic serif display headline',
    description:
      'Oversized italic serif (Fraunces, Recoleta, Playfair, Newsreader-italic) as the primary hero headline reads as taste in isolation but has become the universal AI-startup landing page hero. Set roman, or move to a non-serif display face. Editorial / magazine register may legitimately want this — judge by context.',
    skillSection: 'Typography',
    skillGuideline: 'oversized italic serif as the hero headline',
  },
  {
    id: 'hero-eyebrow-chip',
    category: 'slop',
    scopes: ['type'],
    name: 'Hero eyebrow / pill chip',
    description:
      'A tiny uppercase letter-spaced label sitting immediately above an oversized hero headline — or the same shape rendered as a pill chip — is now the default AI SaaS hero. Drop the eyebrow, integrate the kicker into the headline, or run it as a navigation breadcrumb instead.',
    skillSection: 'Typography',
    skillGuideline: 'tiny uppercase tracked label above the hero headline',
  },
  {
    id: 'repeated-section-kickers',
    category: 'slop',
    scopes: ['type'],
    severity: 'advisory',
    name: 'Repeated section kicker labels',
    description:
      'Repeating tiny uppercase tracked labels above section headings turns a brand page into AI editorial scaffolding. Replace them with stronger structure, artifacts, imagery, or a deliberate brand system.',
    skillSection: 'Typography',
    skillGuideline: 'repeated eyebrow or kicker labels as section scaffolding',
  },
  {
    id: 'numbered-section-markers',
    category: 'slop',
    scopes: ['layout'],
    severity: 'advisory',
    name: 'Numbered section markers (01 / 02 / 03)',
    description:
      'Numbered display markers as section labels (01, 02, 03) are the AI editorial scaffold one tier deeper than tracked eyebrow chips. If you find yourself reaching for them, choose a different section cadence.',
    skillSection: 'Layout & Space',
    skillGuideline: 'numbered section markers',
  },
  {
    id: 'em-dash-overuse',
    category: 'slop',
    name: 'Em-dash overuse',
    description:
      'Eight or more em-dashes (— or --), at a rate above one per 500 characters of body copy, is an AI cadence tell. Use commas, colons, periods, or parentheses instead.',
    skillSection: 'Copy',
    skillGuideline: 'no em dashes',
  },
  {
    id: 'marketing-buzzword',
    category: 'slop',
    name: 'Marketing buzzword',
    description:
      'Generic SaaS phrases (streamline / empower / supercharge / world-class / enterprise-grade / next-generation / cutting-edge / etc) are instant AI tells. Pick a specific verb and noun that says what the product literally does.',
    skillSection: 'Copy',
    skillGuideline: 'marketing buzzwords',
  },
  {
    id: 'aphoristic-cadence',
    category: 'slop',
    name: 'Aphoristic-cadence copy',
    description:
      'Three or more sections landing on a short rebuttal sentence ("X. No Y." / "X. Just Y.") or a manufactured-contrast aphorism ("Not a feature. A platform.") reads as AI cadence, not voice. Once is fine; the pattern is the tell.',
    skillSection: 'Copy',
    skillGuideline: 'aphoristic cadence',
  },
  {
    id: 'oversized-h1',
    category: 'slop',
    scopes: ['type'],
    name: 'Oversized hero headline',
    description:
      'A full-sentence headline set at display size ends up dominating the viewport, leaving no room for anything else above the fold. A punchy one- or two-word headline at that size is fine — the problem is a long headline blown up too large. Set long headlines smaller, or tighten the copy.',
    skillSection: 'Typography',
    skillGuideline: 'long headline set at display size',
  },
  {
    id: 'extreme-negative-tracking',
    category: 'slop',
    scopes: ['type'],
    name: 'Crushed letter spacing',
    description:
      'Letter-spacing pulled tighter than the point where characters keep their own shapes costs legibility. Tighten display type optically, not destructively.',
    skillSection: 'Typography',
    skillGuideline: 'letter spacing crushed past legibility',
  },
  {
    id: 'broken-image',
    category: 'quality',
    name: 'Broken or placeholder image',
    description:
      '<img> tags with empty src, missing src, or placeholder values ship as broken-image boxes. Use real images, generated assets, or remove the tag.',
    skillSection: 'Imagery',
    skillGuideline: 'broken image references',
  },

  // ── Quality: general design and accessibility issues ──
  {
    id: 'gray-on-color',
    category: 'quality',
    name: 'Gray text on colored background',
    description:
      'Gray text looks washed out on colored backgrounds. Use a darker shade of the background color instead, or white/near-white for contrast.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'gray text on colored backgrounds',
  },
  {
    id: 'low-contrast',
    category: 'quality',
    name: 'Low contrast text',
    description:
      'Text does not meet WCAG AA contrast requirements (4.5:1 for body, 3:1 for large text). Increase the contrast between text and background.',
  },
  {
    id: 'layout-transition',
    category: 'quality',
    name: 'Layout property animation',
    description:
      'Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.',
    skillSection: 'Motion',
    skillGuideline: 'Animate layout properties',
  },
  {
    id: 'line-length',
    category: 'quality',
    scopes: ['type', 'layout'],
    name: 'Line length too long',
    description:
      'Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line. Add a max-width (65ch to 75ch) to text containers.',
    skillSection: 'Layout & Space',
    skillGuideline: 'wrap beyond ~80 characters',
  },
  {
    id: 'cramped-padding',
    category: 'quality',
    scopes: ['layout'],
    name: 'Cramped padding',
    description:
      'Text is too close to the edge of its container. Two shapes: (1) an element with its own text where the padding is too low for the font size, and (2) a wrapper with text-bearing children and near-zero padding against a visible boundary (border, outline, or non-transparent background) — children land flush against the boundary line. Add at least 8px (ideally 12–16px) of padding inside bordered, outlined, or colored containers.',
    skillSection: 'Layout & Space',
    skillGuideline: 'inside bordered or colored containers',
  },
  {
    id: 'body-text-viewport-edge',
    category: 'quality',
    scopes: ['layout'],
    name: 'Body text touching viewport edge',
    description:
      'Body paragraphs render flush against the left or right viewport edge with no container providing horizontal padding. Wrap content in a container with at least 16px (ideally 24-32px) of horizontal padding, or apply max-width with mx-auto.',
  },
  {
    id: 'tight-leading',
    category: 'quality',
    scopes: ['type'],
    name: 'Tight line height',
    description:
      'Line height below 1.3x the font size makes multi-line text hard to read. Use 1.5 to 1.7 for body text so lines have room to breathe.',
  },
  {
    id: 'skipped-heading',
    category: 'quality',
    scopes: ['type'],
    name: 'Skipped heading level',
    description:
      'Heading levels should not skip (e.g. h1 then h3 with no h2). Screen readers use heading hierarchy for navigation. Skipping levels breaks the document outline.',
  },
  {
    id: 'justified-text',
    category: 'quality',
    scopes: ['type'],
    name: 'Justified text',
    description:
      'Justified text without hyphenation creates uneven word spacing ("rivers of white"). Use text-align: left for body text, or enable hyphens: auto if you must justify.',
  },
  {
    id: 'tiny-text',
    category: 'quality',
    scopes: ['type'],
    name: 'Tiny body text',
    description:
      'Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.',
  },
  {
    id: 'all-caps-body',
    category: 'quality',
    scopes: ['type'],
    name: 'All-caps body text',
    description:
      'Long passages in uppercase are hard to read. We recognize words by shape (ascenders and descenders), which all-caps removes. Reserve uppercase for short labels and headings.',
    skillSection: 'Typography',
    skillGuideline: 'long body passages in uppercase',
  },
  {
    id: 'wide-tracking',
    category: 'quality',
    scopes: ['type'],
    name: 'Wide letter spacing on body text',
    description:
      'Letter spacing above 0.05em on body text disrupts natural character groupings and slows reading. Reserve wide tracking for short uppercase labels only.',
  },
  {
    id: 'text-overflow',
    category: 'quality',
    scopes: ['layout'],
    name: 'Content overflowing its container',
    description:
      'Content renders wider than its container, spilling out or forcing a horizontal scrollbar. Let text wrap, constrain widths, or give the region a deliberate scroll affordance.',
    skillSection: 'Layout & Space',
    skillGuideline: 'content wider than its container',
  },
  {
    id: 'clipped-overflow-container',
    category: 'quality',
    scopes: ['layout'],
    name: 'Positioned child clipped by overflow container',
    description:
      'A clipping container (overflow hidden or clip) wrapping an absolutely-positioned child cuts off tooltips, menus, and popovers that need to escape. Let the overflow be visible, or move the positioned layer out of the clip.',
    skillSection: 'Layout & Space',
    skillGuideline: 'overflow container clipping positioned children',
  },
  {
    id: 'design-system-font',
    category: 'quality',
    scopes: ['type'],
    name: 'Font outside DESIGN.md',
    description:
      'A font is used that is not declared in DESIGN.md typography. Use the documented type system or update DESIGN.md if this is an intentional brand addition.',
    skillSection: 'Typography',
    skillGuideline: 'font family outside the project design system',
  },
  {
    id: 'design-system-color',
    category: 'quality',
    severity: 'advisory',
    name: 'Color outside DESIGN.md',
    description:
      'A literal color is outside the DESIGN.md palette and sidecar tonal ramps. This may be legitimate, but it should be an intentional design-system addition rather than drift.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'literal color outside the project design system',
  },
  {
    id: 'design-system-radius',
    category: 'quality',
    severity: 'advisory',
    name: 'Radius outside DESIGN.md',
    description:
      'A border-radius value is outside the DESIGN.md rounded scale. Use a documented radius token or update the design system if the new shape is intentional.',
    skillSection: 'Visual Details',
    skillGuideline: 'border radius outside the project design system',
  },
  {
    id: 'design-system-font-size',
    category: 'quality',
    severity: 'advisory',
    scopes: ['type'],
    name: 'Font size outside DESIGN.md',
    description:
      'A literal font-size is off the type ramp documented in DESIGN.md typography. Use a documented size step or update the design system if the new step is intentional.',
    skillSection: 'Typography',
    skillGuideline: 'font size outside the project design system',
  },

  // ── Provider tells: opt-in via --gpt / --gemini (gated off by default) ──
  {
    id: 'gpt-thin-border-wide-shadow',
    category: 'slop',
    severity: 'advisory',
    gated: 'gpt',
    name: 'Hairline border with wide shadow',
    description:
      'A hairline border paired with a wide, diffuse shadow is a recurring generated-UI signature. Commit to one — a defined edge or a soft elevation — rather than both at once.',
    skillSection: 'Visual Details',
    skillGuideline: 'hairline border plus wide diffuse shadow',
  },
  {
    id: 'repeating-stripes-gradient',
    category: 'slop',
    severity: 'advisory',
    gated: 'gpt',
    name: 'Repeating-gradient stripes',
    description:
      'Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. Reach for a deliberate texture or leave the surface plain.',
    skillSection: 'Visual Details',
    skillGuideline: 'repeating-gradient decorative stripes',
  },
  {
    id: 'codex-grid-background',
    category: 'slop',
    severity: 'advisory',
    gated: 'gpt',
    name: 'Decorative grid-line background',
    description:
      'A two-axis grid drawn with hairline linear-gradient layers ("1px, transparent 1px" on both axes) is a recurring generated-UI signature. Reserve grid overlays for actual canvas, map, blueprint, or measurement surfaces; elsewhere use product structure or a plain surface.',
    skillSection: 'Visual Details',
    skillGuideline: 'two-axis grid-line gradient background',
  },
  {
    id: 'theater-slop-phrase',
    category: 'slop',
    severity: 'advisory',
    gated: 'gpt',
    name: 'Theater framing copy',
    description:
      'Dismissing something as "theater" is a recurring generated-copy tic. Say plainly what the thing does or does not do.',
    skillSection: 'Copy',
    skillGuideline: 'theater framing copy',
  },
  {
    id: 'image-hover-transform',
    category: 'slop',
    severity: 'advisory',
    gated: 'gemini',
    name: 'Image hover transform',
    description:
      'Scaling or rotating an image on hover is a recurring generated-UI signature. Let imagery sit still, or use a subtler, purposeful interaction.',
    skillSection: 'Motion',
    skillGuideline: 'image scale or rotate on hover',
  },
  {
    id: 'placeholder-copy',
    category: 'slop',
    name: "Placeholder copy",
    severity: 'warning',
    description:
      "Lorem ipsum, \"your title here\" and other template filler shipped in visible text. Replace it with real copy, or remove the block.",
  },
  {
    id: 'blob-decor',
    category: 'slop',
    name: "Blurred gradient blob",
    severity: 'advisory',
    description:
      "A large blurred round gradient used as background decoration is one of the most recognizable looks of generated landing pages. Use real imagery, a quiet solid, or a pattern that belongs to the brand.",
  },
  {
    id: 'emoji-icons',
    category: 'slop',
    name: "Emoji used as icons",
    severity: 'advisory',
    description:
      "Three or more emoji standing in for icons. They render differently on every platform and read as placeholder art. Use one consistent icon set, or drop the icons.",
  },
  {
    id: 'glass-overuse',
    category: 'slop',
    name: "Glassmorphism overuse",
    severity: 'advisory',
    description:
      "Four or more translucent, blurred glass surfaces on one page. Frosted glass works as a single accent over rich imagery; repeated everywhere it flattens hierarchy and hurts legibility.",
  },
  {
    id: 'stat-row-cliche',
    category: 'slop',
    name: "Headline stat strip",
    severity: 'advisory',
    description:
      "A row of three or four big numbers with small captions (\"10K+ teams\", \"99.9% uptime\") is a staple of generated pages and rarely carries evidence. Keep it only if every number is real and sourced.",
  },
  {
    id: 'uniform-card-grid',
    category: 'slop',
    name: "Identical feature cards",
    severity: 'advisory',
    description:
      "Three or four cards with the same size and the same icon, heading and sentence, in a row. It is the default shape of generated feature sections. Vary scale and layout, or show the product instead.",
  },
  {
    id: 'missing-alt',
    category: 'quality',
    name: "Image without alt text",
    severity: 'warning',
    description:
      "An <img> has no alt attribute, so screen readers announce the file name. Describe the image, or use alt=\"\" if it is purely decorative (WCAG 1.1.1).",
  },
  {
    id: 'input-no-label',
    category: 'quality',
    name: "Form field without a label",
    severity: 'warning',
    description:
      "A field has no label, or only a placeholder that disappears while typing. Add a visible <label> (or aria-label) so the field keeps its name (WCAG 1.3.1, 3.3.2).",
  },
  {
    id: 'small-tap-target',
    category: 'quality',
    name: "Tap target too small",
    severity: 'warning',
    description:
      "An interactive control is smaller than 24 by 24 CSS pixels and sits close to other controls, which makes it easy to miss on touch screens and for people with tremor (WCAG 2.2, 2.5.8). Enlarge the hit area or space the controls out.",
  },
  {
    id: 'link-not-distinguishable',
    category: 'quality',
    name: "Link looks like body text",
    severity: 'warning',
    description:
      "A link inside a paragraph differs from the surrounding text only by a subtle colour. People who cannot tell the colours apart will not find it. Underline it, or give it a 3:1 colour contrast and a second cue (WCAG 1.4.1).",
  },
  {
    id: 'focus-outline-removed',
    category: 'quality',
    name: "Focus outline removed",
    severity: 'warning',
    description:
      "A stylesheet removes the focus outline without a replacement, so keyboard users cannot see where they are (WCAG 2.4.7). Restyle :focus-visible instead of deleting it.",
  },
  {
    id: 'horizontal-overflow',
    category: 'quality',
    name: "Page scrolls sideways",
    severity: 'warning',
    description:
      "Something is wider than the viewport and makes the whole page scroll horizontally. Find the element that overflows and constrain it.",
  },
  {
    id: 'missing-lang',
    category: 'quality',
    name: "Missing page language",
    severity: 'advisory',
    description:
      "The <html> element has no lang attribute. Screen readers pick the wrong pronunciation and browsers cannot translate or hyphenate correctly (WCAG 3.1.1).",
  },
  {
    id: 'heading-one',
    category: 'quality',
    name: "Page heading problem",
    severity: 'advisory',
    description:
      "A page should have exactly one <h1> that names the page. A missing or repeated <h1> weakens the outline for screen reader users and search.",
  },
  {
    id: 'accent-word-headline',
    category: 'slop',
    name: "One accented word in the headline",
    severity: 'advisory',
    description:
      "A single word in a heading set apart by italics, colour, weight or a gradient (\"Ship <em>faster</em> than ever\") is the default flourish of generated pages. Let the whole line carry the weight, or use emphasis where meaning needs it.",
  },
  {
    id: 'radial-halo',
    category: 'slop',
    name: "Radial glow halo",
    severity: 'advisory',
    description:
      "A soft chromatic radial gradient glowing behind the content (on the page, a section, or a ::before/::after layer) is the stock \"atmosphere\" of generated pages. Use a real background, image or flat surface.",
  },
  {
    id: 'template-punctuation',
    category: 'slop',
    name: "Template punctuation",
    severity: 'advisory',
    description:
      "Meta strings joined with middle dots, links ending in a typed arrow, and \"WORD - fragment\" labels recur across generated pages. Use plain sentences, real icons and normal labels.",
  },
  {
    id: 'stock-avatars',
    category: 'slop',
    name: "Placeholder avatars",
    severity: 'warning',
    description:
      "Avatars from generator services (pravatar, dicebear, randomuser, ui-avatars) in testimonials or logo walls signal invented customers. Use real people with permission, or drop the avatars.",
  },
  {
    id: 'ai-voice-copy',
    category: 'slop',
    name: "Copy that reads as generated",
    severity: 'warning',
    description:
      "Phrasing such as \"stands as a testament\", \"it’s not just X, it’s Y\", \"delve into\" or \"ever-evolving landscape\" in headlines or body copy. One hit proves nothing; several together are a strong tell. Say the specific thing instead.",
  },
  {
    id: 'tinted-icon-coin',
    category: 'slop',
    name: "Icons in tinted squares",
    severity: 'advisory',
    description:
      "Three or more icons each sitting in a faint square of their own colour is a repeated template shape. Use bare icons, or give the icons a job that needs a container.",
  },
  {
    id: 'pulsing-dot',
    category: 'slop',
    name: "Decorative pulsing dot",
    severity: 'advisory',
    description:
      "A small dot that pulses beside a word like \"live\", \"new\" or \"available\" with no real status behind it. Animate only genuine, current state.",
  },
  {
    id: 'content-hidden-at-rest',
    category: 'quality',
    name: "Content stays invisible",
    severity: 'warning',
    description:
      "A large share of the page text is invisible even after scrolling through it, so a reveal-on-scroll script is not firing, or hides content again. People with reduced motion, print views and crawlers all see an empty page. Show content by default and treat reveal as an enhancement.",
  },
  {
    id: 'control-missing-name',
    category: 'quality',
    name: "Control without an accessible name",
    severity: 'warning',
    description:
      "A link or button has no text, aria-label or title, so screen readers announce just \"link\" or \"button\". Icon-only controls need a name (WCAG 4.1.2, 2.4.4).",
  },
  {
    id: 'generic-link-text',
    category: 'quality',
    name: "Repeated \"Learn more\" links",
    severity: 'warning',
    description:
      "Several links say only \"Learn more\", \"Read more\" or \"Click here\". Out of context they are indistinguishable, for screen reader users and for everyone skimming. Name the destination (WCAG 2.4.4).",
  },
  {
    id: 'placeholder-links',
    category: 'slop',
    name: "Links that go nowhere",
    severity: 'advisory',
    description:
      "Three or more links point to \"#\" with no handler, a sign of unfinished or generated markup. Wire them up, or make them buttons or plain text.",
  },
  {
    id: 'token-sprawl',
    category: 'quality',
    name: "No shared type, radius or shadow scale",
    severity: 'advisory',
    description:
      "Many near-identical font sizes, corner radii or shadows suggest values chosen one at a time instead of from a scale. Define a small set of tokens and reuse them.",
  },
];

// --- cli/engine/shared/color.mjs ---
// ─── Section 2: Color Utilities ─────────────────────────────────────────────

function isNeutralColor(color) {
  if (!color || color === 'transparent') return true;

  // rgb/rgba — use channel spread. Threshold 30 ≈ 11.7% of the 0–255 range.
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    return (Math.max(+rgb[1], +rgb[2], +rgb[3]) - Math.min(+rgb[1], +rgb[2], +rgb[3])) < 30;
  }

  // oklch()/lch() — chroma is the second numeric component.
  // oklch chroma is ~0–0.4 in sRGB gamut; >= 0.02 reads as tinted, not gray.
  // lch chroma is ~0–150; >= 3 reads as tinted. jsdom emits both formats
  // literally (it does NOT convert them to rgb).
  const oklch = color.match(/oklch\(\s*[\d.]+%?\s*([\d.-]+)/i);
  if (oklch) return parseFloat(oklch[1]) < 0.02;
  const lch = color.match(/lch\(\s*[\d.]+%?\s*([\d.-]+)/i);
  if (lch) return parseFloat(lch[1]) < 3;

  // oklab()/lab() — a and b are signed axes; chroma = sqrt(a² + b²).
  // oklab a/b are ~-0.4..0.4, threshold 0.02. lab a/b are ~-128..127, threshold 3.
  const oklab = color.match(/oklab\(\s*[\d.]+%?\s*([\d.-]+)\s+([\d.-]+)/i);
  if (oklab) {
    const a = parseFloat(oklab[1]), b = parseFloat(oklab[2]);
    return Math.hypot(a, b) < 0.02;
  }
  const lab = color.match(/lab\(\s*[\d.]+%?\s*([\d.-]+)\s+([\d.-]+)/i);
  if (lab) {
    const a = parseFloat(lab[1]), b = parseFloat(lab[2]);
    return Math.hypot(a, b) < 3;
  }

  // hsl/hsla — saturation is the second numeric component (percent).
  // Modern jsdom usually converts hsl() to rgb, but handle it directly for
  // safety across versions and for any engine that preserves the format.
  const hsl = color.match(/hsla?\(\s*[\d.-]+\s*,?\s*([\d.]+)%/i);
  if (hsl) return parseFloat(hsl[1]) < 10;

  // hwb(hue whiteness% blackness%) — a pixel is fully gray when
  // whiteness + blackness >= 100; chroma-like saturation = 1 - (w+b)/100.
  const hwb = color.match(/hwb\(\s*[\d.-]+\s+([\d.]+)%\s+([\d.]+)%/i);
  if (hwb) {
    const w = parseFloat(hwb[1]), b = parseFloat(hwb[2]);
    return (1 - Math.min(100, w + b) / 100) < 0.1;
  }

  // Unknown / unrecognized format — err on the side of DETECTING rather
  // than silently skipping. This is the opposite of the previous default,
  // which was the root cause of the oklch bug.
  return false;
}

// Chrome serializes computed colours in the space they were authored in, so pages
// written with oklch()/lab()/color() (Tailwind v4, most modern design systems) hand
// us strings the rgb() regex cannot read. Those used to parse as "no colour", which
// fell back to white and produced bogus contrast failures. Let the browser convert.
const MODERN_COLOR_RE = /^(?:oklch|oklab|lab|lch|hwb|color|color-mix)\(/i;
const modernColorCache = new Map();
let modernColorCtx = null;
function parseModernColor(css) {
  if (modernColorCache.has(css)) return modernColorCache.get(css);
  let out = null;
  try {
    modernColorCtx = modernColorCtx || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    modernColorCtx.clearRect(0, 0, 1, 1);
    modernColorCtx.fillStyle = '#010203';
    modernColorCtx.fillStyle = css;
    // An unparseable colour leaves the sentinel in place. Otherwise paint one pixel and read
    // it back as sRGB: canvas serializes wide-gamut colours as strings we cannot parse.
    if (String(modernColorCtx.fillStyle).toLowerCase() !== '#010203') {
      modernColorCtx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = modernColorCtx.getImageData(0, 0, 1, 1).data;
      out = { r, g, b, a: Math.round((a / 255) * 100) / 100 };
    }
  } catch { /* no canvas: leave unparsed */ }
  modernColorCache.set(css, out);
  return out;
}

function parseRgb(color) {
  if (!color || color === 'transparent') return null;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) {
    const t = typeof color === 'string' ? color.trim() : '';
    return typeof document !== 'undefined' && MODERN_COLOR_RE.test(t) ? parseModernColor(t) : null;
  }
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseGradientColors(bgImage) {
  if (!bgImage || !bgImage.includes('gradient')) return [];
  const colors = [];
  for (const m of bgImage.matchAll(/rgba?\([^)]+\)/g)) {
    const c = parseRgb(m[0]);
    if (c) colors.push(c);
  }
  for (const m of bgImage.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1];
    if (h.length === 6) {
      colors.push({ r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 });
    } else {
      colors.push({ r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: 1 });
    }
  }
  return colors;
}

function hasChroma(c, threshold = 30) {
  if (!c) return false;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) >= threshold;
}

function getHue(c) {
  if (!c) return 0;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
}

function colorToHex(c) {
  if (!c) return '?';
  return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// --- cli/engine/shared/fonts.mjs ---
const GOOGLE_FONTS_URL_RE = /fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi;

function normalizeGoogleFontFamilyParam(value) {
  return String(value || '')
    .split('|')
    .map(part => part.split(':')[0].trim().toLowerCase())
    .filter(Boolean);
}

function extractGoogleFontFamilies(text) {
  const families = [];
  if (!text) return families;

  GOOGLE_FONTS_URL_RE.lastIndex = 0;
  let urlMatch;
  while ((urlMatch = GOOGLE_FONTS_URL_RE.exec(text)) !== null) {
    const url = urlMatch[0];
    const queryStart = url.indexOf('?');
    if (queryStart === -1) continue;

    const params = new URLSearchParams(url.slice(queryStart + 1).replace(/&amp;/g, '&'));
    for (const value of params.getAll('family')) {
      families.push(...normalizeGoogleFontFamilyParam(value));
    }
  }

  return families;
}

// --- cli/engine/rules/checks.mjs ---
const DETECTOR_IS_BROWSER = typeof window !== 'undefined';

// ─── Section 3: Pure Detection ──────────────────────────────────────────────

function checkBorders(tag, widths, colors, radius) {
  if (BORDER_SAFE_TAGS.has(tag)) return [];
  const findings = [];
  const sides = ['Top', 'Right', 'Bottom', 'Left'];

  for (const side of sides) {
    const w = widths[side];
    if (w < 1 || isNeutralColor(colors[side])) continue;

    const otherSides = sides.filter(s => s !== side);
    const maxOther = Math.max(...otherSides.map(s => widths[s]));
    if (!(w >= 2 && (maxOther <= 1 || w >= maxOther * 2))) continue;

    const sn = side.toLowerCase();
    const isSide = side === 'Left' || side === 'Right';

    if (isSide) {
      if (radius > 0) findings.push({ id: 'side-tab', snippet: `border-${sn}: ${w}px + border-radius: ${radius}px` });
      else if (w >= 3) findings.push({ id: 'side-tab', snippet: `border-${sn}: ${w}px` });
    } else {
      if (radius > 0 && w >= 2) findings.push({ id: 'border-accent-on-rounded', snippet: `border-${sn}: ${w}px + border-radius: ${radius}px` });
    }
  }

  return findings;
}

// Returns true if the given text is composed entirely of emoji characters
// (plus whitespace / variation selectors). Emojis render as multicolor glyphs
// regardless of CSS `color`, so contrast checks against the element's text
// color are meaningless for these nodes.
const EMOJI_CHAR_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/u;
const EMOJI_CHARS_GLOBAL = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;
function isEmojiOnlyText(text) {
  if (!text) return false;
  if (!EMOJI_CHAR_RE.test(text)) return false;
  return text.replace(EMOJI_CHARS_GLOBAL, '').trim() === '';
}

function checkColors(opts) {
  const { tag, textColor, bgColor, effectiveBg, effectiveBgStops, fontSize, fontWeight, hasDirectText, isEmojiOnly, bgClip, bgImage, classList } = opts;
  if (SAFE_TAGS.has(tag)) {
    // Exception for <a> and <button> elements styled as buttons. SAFE_TAGS
    // exists to suppress contrast noise on inline links and unstyled controls,
    // where the element has no own background and the contrast against the
    // ancestor surface is already the intended visual. When the element has
    // its own opaque background and direct text, it is a styled button — and
    // contrast on its own surface is a real, frequent bug worth flagging.
    const isStyledButton = (tag === 'a' || tag === 'button')
      && hasDirectText
      && bgColor && bgColor.a > 0.5;
    if (!isStyledButton) return [];
  }
  const findings = [];

  if (hasDirectText && textColor && !isEmojiOnly) {
    // Run background-dependent checks against either a solid bg or, if the
    // ancestor is a gradient, against every gradient stop (use the worst case).
    const bgs = effectiveBg ? [effectiveBg] : (effectiveBgStops && effectiveBgStops.length ? effectiveBgStops : null);
    if (bgs) {
      // Gray on colored background — flag if every stop is chromatic
      const textLum = relativeLuminance(textColor);
      const isGray = !hasChroma(textColor, 20) && textLum > 0.05 && textLum < 0.85;
      if (isGray && bgs.every(b => hasChroma(b, 40))) {
        const bgLabel = effectiveBg ? colorToHex(effectiveBg) : `gradient(${bgs.map(colorToHex).join(', ')})`;
        findings.push({ id: 'gray-on-color', snippet: `text ${colorToHex(textColor)} on bg ${bgLabel}` });
      }

      // Low contrast (WCAG AA) — worst case across all bg stops
      const ratios = bgs.map(b => contrastRatio(textColor, b));
      let worstIdx = 0;
      for (let i = 1; i < ratios.length; i++) if (ratios[i] < ratios[worstIdx]) worstIdx = i;
      const ratio = ratios[worstIdx];
      const isLargeText = fontSize >= WCAG_LARGE_TEXT_PX || (fontSize >= WCAG_LARGE_BOLD_TEXT_PX && fontWeight >= 700);
      const threshold = isLargeText ? 3.0 : 4.5;
      if (ratio < threshold) {
        // Skip the false-positive class where text has alpha < 1 AND we
        // couldn't find an opaque ancestor (effectiveBg is null, we're
        // comparing against gradient-stop fallback). In jsdom mode the
        // detector can't resolve `var(--X)` color tokens, so a dark
        // section sitting between the text and the body's decorative
        // gradient is invisible to us — we end up measuring contrast
        // against the body's paper-grain noise instead of the real
        // local bg. Real low-contrast bugs use alpha=1 and have a
        // resolvable opaque ancestor; semi-transparent Tailwind tokens
        // like `text-paper/60` on `bg-ink` sections are the FP pattern.
        const isAlphaFallbackFP = !DETECTOR_IS_BROWSER && !effectiveBg && (textColor.a != null && textColor.a < 1);
        if (!isAlphaFallbackFP) {
          findings.push({ id: 'low-contrast', snippet: `${ratio.toFixed(1)}:1 (need ${threshold}:1) — text ${colorToHex(textColor)} on ${colorToHex(bgs[worstIdx])}` });
        }
      }
    }

    // AI palette: purple/violet on headings
    if (hasChroma(textColor, 50)) {
      const hue = getHue(textColor);
      if (hue >= 260 && hue <= 310 && (['h1', 'h2', 'h3'].includes(tag) || fontSize >= 20)) {
        findings.push({ id: 'ai-color-palette', snippet: `Purple/violet text (${colorToHex(textColor)}) on heading` });
      }
    }
  }

  // Gradient text
  if (bgClip === 'text' && bgImage && bgImage.includes('gradient')) {
    findings.push({ id: 'gradient-text', snippet: 'background-clip: text + gradient' });
  }

  // Tailwind class checks
  if (classList) {
    const classStr = typeof classList === 'string' ? classList : Array.from(classList).join(' ');

    const grayMatch = classStr.match(/\btext-(?:gray|slate|zinc|neutral|stone)-\d+\b/);
    const colorBgMatch = classStr.match(/\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/);
    if (grayMatch && colorBgMatch) {
      findings.push({ id: 'gray-on-color', snippet: `${grayMatch[0]} on ${colorBgMatch[0]}` });
    }

    if (/\bbg-clip-text\b/.test(classStr) && /\bbg-gradient-to-/.test(classStr)) {
      findings.push({ id: 'gradient-text', snippet: 'bg-clip-text + bg-gradient (Tailwind)' });
    }

    const purpleText = classStr.match(/\btext-(?:purple|violet|indigo)-\d+\b/);
    if (purpleText && (['h1', 'h2', 'h3'].includes(tag) || /\btext-(?:[2-9]xl)\b/.test(classStr))) {
      findings.push({ id: 'ai-color-palette', snippet: `${purpleText[0]} on heading` });
    }

    if (/\bfrom-(?:purple|violet|indigo)-\d+\b/.test(classStr) && /\bto-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-\d+\b/.test(classStr)) {
      findings.push({ id: 'ai-color-palette', snippet: 'Purple/violet gradient (Tailwind)' });
    }
  }

  return findings;
}

function isCardLikeFromProps(hasShadow, hasBorder, hasRadius, hasBg) {
  if (!hasShadow && !hasBorder) return false;
  return hasRadius || hasBg;
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Pure check: given a heading and metrics about its previousElementSibling,
// decide if the sibling is the canonical "icon-tile-stacked-above-heading" shape.
//
// Triggers when ALL of the following hold for the sibling:
//   • size 32–128px on both axes (not too small, not a hero image)
//   • aspect ratio 0.7–1.4 (squarish — excludes wide thumbnails / pill badges)
//   • has a non-transparent background-color, background-image, OR a visible border
//     (covers solid colors, white-with-border, gradients — anything that visually
//      defines a tile)
//   • border-radius < width/2 (excludes round avatars; rounded squares pass)
//   • contains an <svg> or icon-class <i> element that's smaller than the tile
//   • the tile sits above the heading (its bottom is above the heading's top)
function checkIconTile(opts) {
  const { headingTag, headingText, headingTop,
          siblingTag, siblingWidth, siblingHeight, siblingBottom,
          siblingBgColor, siblingBgImage, siblingBorderWidth, siblingBorderRadius,
          hasIconChild, iconChildWidth } = opts;
  if (!HEADING_TAGS.has(headingTag)) return [];
  if (!siblingTag) return [];
  // Don't recurse into nested headings (e.g. h2 above h3 in a section header)
  if (HEADING_TAGS.has(siblingTag)) return [];

  // Size window: 32–128px on each axis
  if (!(siblingWidth >= 32 && siblingWidth <= 128)) return [];
  if (!(siblingHeight >= 32 && siblingHeight <= 128)) return [];

  // Squarish aspect ratio
  const ratio = siblingWidth / siblingHeight;
  if (ratio < 0.7 || ratio > 1.4) return [];

  // Must have something that visually defines the tile
  const bgVisible = (siblingBgColor && siblingBgColor.a > 0.1)
    || (siblingBgImage && siblingBgImage !== 'none' && siblingBgImage !== '');
  const borderVisible = siblingBorderWidth > 0;
  if (!bgVisible && !borderVisible) return [];

  // Exclude circles (avatars). Rounded squares pass.
  if (siblingBorderRadius >= siblingWidth / 2) return [];

  // Must contain an icon element smaller than the tile
  if (!hasIconChild) return [];
  if (iconChildWidth && iconChildWidth >= siblingWidth * 0.95) return [];

  // Vertical stacking: tile must end above where the heading starts.
  // (Allow the check to skip when both top/bottom are 0 — jsdom layout case.)
  if (headingTop && siblingBottom && siblingBottom > headingTop + 4) return [];

  const text = (headingText || '').trim().slice(0, 60);
  return [{
    id: 'icon-tile-stack',
    snippet: `${Math.round(siblingWidth)}x${Math.round(siblingHeight)}px icon tile above ${headingTag} "${text}"`,
  }];
}

// Resolve the primary (non-generic) face from a font-family string and return
// whether the resolved primary is serif. Two paths:
//   1. Primary face is in KNOWN_SERIF_FONTS → serif.
//   2. Primary face is unknown but the stack ends in the generic `serif`
//      token → treat as serif. Authors who declare `font-family: 'X', serif`
//      almost always have a serif primary; a sans declared with a serif
//      fallback is a code smell, not the common case.
// Returns { primary, isSerif } so the snippet can name the face.
function resolveSerif(fontFamily) {
  if (!fontFamily) return { primary: null, isSerif: false };
  const tokens = fontFamily.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  const primary = tokens.find(f => f && !GENERIC_FONTS.has(f)) || null;
  if (!primary) return { primary: null, isSerif: false };
  if (KNOWN_SERIF_FONTS.has(primary)) return { primary, isSerif: true };
  if (tokens.includes('serif')) return { primary, isSerif: true };
  return { primary, isSerif: false };
}

function checkItalicSerif(opts) {
  const { tag, fontStyle, fontFamily, fontSize, headingText } = opts;
  if (fontStyle !== 'italic') return [];
  // Anchor the rule on hero-scale text. h1 is the canonical hero element;
  // h2 ≥ 48px catches the cases where the design demotes the visual hero
  // to an h2 but keeps the size.
  if (tag !== 'h1' && !(tag === 'h2' && fontSize >= 48)) return [];
  if (fontSize < 48) return [];
  const { primary, isSerif } = resolveSerif(fontFamily);
  if (!isSerif) return [];

  const text = (headingText || '').trim().slice(0, 60);
  return [{
    id: 'italic-serif-display',
    snippet: `italic serif ${tag} (${primary || 'serif'}) at ${Math.round(fontSize)}px "${text}"`,
  }];
}

// Color saturation check. Returns true when the color has visible
// chroma — i.e., it's an "accent color" rather than near-neutral.
// Handles rgb()/rgba(), #hex, oklch(), and hsl(). var() refs are
// expected to be pre-resolved by the caller.
function isAccentColor(cssColor) {
  if (!cssColor) return false;
  const s = String(cssColor).trim();
  // rgb / rgba — direct channel-distance check.
  const rgbM = /rgba?\(\s*(\d+)\s*,?\s+|\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s.replace(/rgba?\(\s*/, 'rgb(').replace(/,/g, ', '));
  const rgbStrict = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgbStrict) {
    const r = +rgbStrict[1], g = +rgbStrict[2], b = +rgbStrict[3];
    return (Math.max(r, g, b) - Math.min(r, g, b)) >= 40;
  }
  // #hex — 3, 4, 6, or 8 digit.
  const hexM = /^#([0-9a-f]{3,8})\b/i.exec(s);
  if (hexM) {
    let h = hexM[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('').slice(0, 6);
    else h = h.slice(0, 6);
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (Math.max(r, g, b) - Math.min(r, g, b)) >= 40;
    }
  }
  // oklch(L C H) — chroma C is what matters. Typical neutral grays
  // have C < 0.02; visible accents are 0.05+. CSS minification can
  // collapse spaces between L% and C ("oklch(43%.15 34)"), so we
  // extract all numbers and take the second rather than matching a
  // strict L-then-whitespace-then-C pattern.
  if (/^oklch\(/i.test(s)) {
    const nums = s.match(/\d*\.\d+|\d+/g);
    if (nums && nums.length >= 2) {
      const c = parseFloat(nums[1]);
      return !Number.isNaN(c) && c >= 0.05;
    }
  }
  // hsl(H, S%, L%) — saturation > 20% reads as accent.
  const hslM = /hsla?\(\s*[\d.]+\s*,\s*([\d.]+)%/i.exec(s);
  if (hslM) {
    const sat = parseFloat(hslM[1]);
    return !Number.isNaN(sat) && sat >= 20;
  }
  return false;
}

// Sibling-relationship rule. Anchor on a hero-scale h1, look at the
// previousElementSibling, and gate on EITHER the classic tracked-
// uppercase eyebrow OR the modern accent-colored bold eyebrow.
function checkHeroEyebrow(opts) {
  const {
    headingTag, headingText, headingFontSize,
    siblingTag, siblingText, siblingTextTransform,
    siblingFontSize, siblingLetterSpacing,
    siblingFontWeight, siblingColor,
  } = opts;
  if (headingTag !== 'h1') return [];
  // We previously gated on headingFontSize >= 48 to anchor "hero scale".
  // But modern hero h1s use clamp() / vw / var(--text-*), none of which
  // jsdom can resolve — the computed value comes back as "2em" or
  // "var(--text-9xl)" and parseFloat returns 2 or NaN. The gate fails
  // on virtually every Tailwind v4 / framework build. The other gates
  // (sibling text 2-60 chars, font-size ≤ 14px, accent-bold OR
  // tracked-caps) are tight enough to avoid false positives on non-
  // hero h1s — a tiny tan label directly above any h1 is the
  // antipattern regardless of how big the h1 ends up.
  if (!siblingTag) return [];
  // An h2 above an h1 is a different anti-pattern (heading hierarchy / dual
  // headings) — never an eyebrow.
  if (HEADING_TAGS.has(siblingTag)) return [];

  const text = (siblingText || '').trim();
  if (text.length < 2 || text.length > 60) return [];
  if (!(siblingFontSize > 0 && siblingFontSize <= 14)) return [];

  // Branch A: classic tracked-uppercase eyebrow.
  const isUppercased = siblingTextTransform === 'uppercase'
    || (/[A-Z]/.test(text) && !/[a-z]/.test(text));
  const isClassicTracked = isUppercased && siblingLetterSpacing >= 1.6;

  // Branch B: modern accent-bold eyebrow — sentence case, low
  // tracking, but bold + accent-colored. The style choices changed;
  // the pattern is the same kicker-above-headline anti-pattern.
  const weight = Number(siblingFontWeight) || 400;
  const isAccentBold = weight >= 700 && isAccentColor(siblingColor || '');

  if (!isClassicTracked && !isAccentBold) return [];

  const headingTextSnippet = (headingText || '').trim().slice(0, 60);
  const eyebrowSnippet = text.slice(0, 40);
  const style = isClassicTracked ? 'tracked-caps' : 'accent-bold';
  return [{
    id: 'hero-eyebrow-chip',
    snippet: `eyebrow chip (${style}) "${eyebrowSnippet}" above ${headingTag} "${headingTextSnippet}"`,
  }];
}

function checkRepeatedSectionKickers(opts) {
  const { candidates, minCount = 3 } = opts;
  if (!Array.isArray(candidates) || candidates.length < minCount) return [];
  return candidates.map(candidate => ({
    id: 'repeated-section-kickers',
    snippet: `repeated section kicker "${candidate.kickerText}" before ${candidate.headingTag} "${candidate.headingText}" (${candidates.length} on page)`,
  }));
}

const LAYOUT_TRANSITION_PROPS = new Set([
  'width', 'height', 'padding', 'margin',
  'max-height', 'max-width', 'min-height', 'min-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
]);

function checkMotion(opts) {
  const { tag, transitionProperty, animationName, timingFunctions, classList } = opts;
  if (SAFE_TAGS.has(tag)) return [];
  const findings = [];

  // --- Bounce/elastic easing ---
  if (animationName && animationName !== 'none' && /bounce|elastic|wobble|jiggle|spring/i.test(animationName)) {
    findings.push({ id: 'bounce-easing', snippet: `animation: ${animationName}` });
  }
  if (classList && /\banimate-bounce\b/.test(classList)) {
    findings.push({ id: 'bounce-easing', snippet: 'animate-bounce (Tailwind)' });
  }

  // Check timing functions for overshoot cubic-bezier (y values outside [0, 1])
  if (timingFunctions) {
    const bezierRe = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/g;
    let m;
    while ((m = bezierRe.exec(timingFunctions)) !== null) {
      const y1 = parseFloat(m[2]), y2 = parseFloat(m[4]);
      if (y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1) {
        findings.push({ id: 'bounce-easing', snippet: `cubic-bezier(${m[1]}, ${m[2]}, ${m[3]}, ${m[4]})` });
        break;
      }
    }
  }

  // --- Layout property transition ---
  if (transitionProperty && transitionProperty !== 'all' && transitionProperty !== 'none') {
    const props = transitionProperty.split(',').map(p => p.trim().toLowerCase());
    const layoutFound = props.filter(p => LAYOUT_TRANSITION_PROPS.has(p));
    if (layoutFound.length > 0) {
      findings.push({ id: 'layout-transition', snippet: `transition: ${layoutFound.join(', ')}` });
    }
  }

  return findings;
}

function checkGlow(opts) {
  const { boxShadow, effectiveBg } = opts;
  if (!boxShadow || boxShadow === 'none') return [];
  if (!effectiveBg) return [];

  // Only flag on dark backgrounds (luminance < 0.1)
  const bgLum = relativeLuminance(effectiveBg);
  if (bgLum >= 0.1) return [];

  // Split multiple shadows (commas not inside parentheses)
  const parts = boxShadow.split(/,(?![^(]*\))/);
  for (const shadow of parts) {
    const colorMatch = shadow.match(/rgba?\([^)]+\)/);
    if (!colorMatch) continue;
    const color = parseRgb(colorMatch[0]);
    if (!color || !hasChroma(color, 30)) continue;

    // Extract px values — in computed style: "color Xpx Ypx BLURpx [SPREADpx]"
    const afterColor = shadow.substring(shadow.indexOf(colorMatch[0]) + colorMatch[0].length);
    const beforeColor = shadow.substring(0, shadow.indexOf(colorMatch[0]));
    const pxVals = [...beforeColor.matchAll(/([\d.]+)px/g), ...afterColor.matchAll(/([\d.]+)px/g)]
      .map(m => parseFloat(m[1]));

    // Third value is blur (offset-x, offset-y, blur, [spread])
    if (pxVals.length >= 3 && pxVals[2] > 4) {
      return [{ id: 'dark-glow', snippet: `Colored glow (${colorToHex(color)}) on dark background` }];
    }
  }

  return [];
}

/**
 * Regex-on-HTML checks shared between browser and Node page-level detection.
 * These don't need DOM access, just the raw HTML string.
 */
function checkHtmlPatterns(html) {
  const findings = [];

  // --- Color ---

  // AI color palette: purple/violet
  const purpleHexRe = /#(?:7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9|6366f1|764ba2|667eea)\b/gi;
  if (purpleHexRe.test(html)) {
    const purpleTextRe = /(?:(?:^|;)\s*color\s*:\s*(?:.*?)(?:#(?:7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9))|gradient.*?#(?:7c3aed|8b5cf6|a855f7|764ba2|667eea))/gi;
    if (purpleTextRe.test(html)) {
      findings.push({ id: 'ai-color-palette', snippet: 'Purple/violet accent colors detected' });
    }
  }

  // Gradient text (background-clip: text + gradient)
  const gradientRe = /(?:-webkit-)?background-clip\s*:\s*text/gi;
  let gm;
  while ((gm = gradientRe.exec(html)) !== null) {
    const start = Math.max(0, gm.index - 200);
    const context = html.substring(start, gm.index + gm[0].length + 200);
    if (/gradient/i.test(context)) {
      findings.push({ id: 'gradient-text', snippet: 'background-clip: text + gradient' });
      break;
    }
  }
  if (/\bbg-clip-text\b/.test(html) && /\bbg-gradient-to-/.test(html)) {
    findings.push({ id: 'gradient-text', snippet: 'bg-clip-text + bg-gradient (Tailwind)' });
  }

  // --- Layout ---

  // Monotonous spacing
  const spacingValues = [];
  const spacingRe = /(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*(\d+)px/gi;
  let sm;
  while ((sm = spacingRe.exec(html)) !== null) {
    const v = parseInt(sm[1], 10);
    if (v > 0 && v < 200) spacingValues.push(v);
  }
  const gapRe = /gap\s*:\s*(\d+)px/gi;
  while ((sm = gapRe.exec(html)) !== null) {
    spacingValues.push(parseInt(sm[1], 10));
  }
  const twSpaceRe = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-(\d+)\b/g;
  while ((sm = twSpaceRe.exec(html)) !== null) {
    spacingValues.push(parseInt(sm[1], 10) * 4);
  }
  const remSpacingRe = /(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*([\d.]+)rem/gi;
  while ((sm = remSpacingRe.exec(html)) !== null) {
    const v = Math.round(parseFloat(sm[1]) * 16);
    if (v > 0 && v < 200) spacingValues.push(v);
  }
  const roundedSpacing = spacingValues.map(v => Math.round(v / 4) * 4);
  if (roundedSpacing.length >= 10) {
    const counts = {};
    for (const v of roundedSpacing) counts[v] = (counts[v] || 0) + 1;
    const maxCount = Math.max(...Object.values(counts));
    const dominantPct = maxCount / roundedSpacing.length;
    const unique = [...new Set(roundedSpacing)].filter(v => v > 0);
    if (dominantPct > 0.6 && unique.length <= 3) {
      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      findings.push({
        id: 'monotonous-spacing',
        snippet: `~${dominant}px used ${maxCount}/${roundedSpacing.length} times (${Math.round(dominantPct * 100)}%)`,
      });
    }
  }

  // --- Motion ---

  // Bounce/elastic animation names
  const bounceRe = /animation(?:-name)?\s*:\s*([^;{}]*(?:bounce|elastic|wobble|jiggle|spring)[^;{}]*)/gi;
  const bounceMatch = bounceRe.exec(html);
  if (bounceMatch) {
    const animationToken = bounceMatch[1]
      .split(/[,\s]+/)
      .find((part) => /bounce|elastic|wobble|jiggle|spring/i.test(part));
    findings.push({ id: 'bounce-easing', snippet: `animation: ${animationToken || bounceMatch[1].trim()}` });
  }

  // Overshoot cubic-bezier
  const bezierRe = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/g;
  let bm;
  while ((bm = bezierRe.exec(html)) !== null) {
    const y1 = parseFloat(bm[2]), y2 = parseFloat(bm[4]);
    if (y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1) {
      findings.push({ id: 'bounce-easing', snippet: `cubic-bezier(${bm[1]}, ${bm[2]}, ${bm[3]}, ${bm[4]})` });
      break;
    }
  }

  // Layout property transitions
  const transRe = /transition(?:-property)?\s*:\s*([^;{}]+)/gi;
  let tm;
  while ((tm = transRe.exec(html)) !== null) {
    const val = tm[1].toLowerCase();
    if (/\ball\b/.test(val)) continue;
    const found = val.match(/\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/gi);
    if (found) {
      findings.push({ id: 'layout-transition', snippet: `transition: ${found.join(', ')}` });
      break;
    }
  }

  // --- Dark glow ---

  const darkBgRe = /background(?:-color)?\s*:\s*(?:#(?:0[0-9a-f]|1[0-9a-f]|2[0-3])[0-9a-f]{4}\b|#(?:0|1)[0-9a-f]{2}\b|rgb\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\))/gi;
  const twDarkBg = /\bbg-(?:gray|slate|zinc|neutral|stone)-(?:9\d{2}|800)\b/;
  if (darkBgRe.test(html) || twDarkBg.test(html)) {
    const shadowRe = /box-shadow\s*:\s*([^;{}]+)/gi;
    let shm;
    while ((shm = shadowRe.exec(html)) !== null) {
      const val = shm[1];
      const colorMatch = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!colorMatch) continue;
      const [r, g, b] = [+colorMatch[1], +colorMatch[2], +colorMatch[3]];
      if ((Math.max(r, g, b) - Math.min(r, g, b)) < 30) continue;
      const pxVals = [...val.matchAll(/(\d+)px|(?<![.\d])\b(0)\b(?![.\d])/g)].map(p => +(p[1] || p[2]));
      if (pxVals.length >= 3 && pxVals[2] > 4) {
        findings.push({ id: 'dark-glow', snippet: `Colored glow (rgb(${r},${g},${b})) on dark page` });
        break;
      }
    }
  }

  // --- Provider tells (gated): repeating-gradient stripes (GPT) ---
  if (/repeating-(?:linear|radial|conic)-gradient\s*\(/i.test(html)) {
    findings.push({ id: 'repeating-stripes-gradient', snippet: 'repeating-gradient decorative stripes' });
  }

  // --- Provider tells (gated): two-axis grid-line background (Codex/GPT) ---
  // The Codex grid tell is two hairline `linear-gradient(... <color> 1px,
  // transparent 1px)` layers (one per axis) tiled by a repeating
  // `background-size` cell. Both signals must co-occur in the SAME style block
  // (a CSS rule body or one inline `style="..."`): two hairline stops WITHOUT a
  // tiling background-size is a fixed crosshair, not a grid, and a single
  // hairline is a legitimate ruled line. Scoping to one block also stops
  // unrelated single-axis rules on separate elements from adding up across the
  // page. Count hairlines only inside `background`/`background-image` values so
  // a hairline in an unrelated property (mask-image, border-image) can't stand
  // in for the second axis. Colors like `oklch(96% 0.012 82 / 0.055)` carry
  // nested parens, so match the hairline stop directly rather than parsing
  // whole gradient layers.
  {
    const hairlineRe = /\b\d{1,3}px\s*,\s*transparent\s+\d{1,3}px/gi;
    const gridSizeRe = /background-size\s*:[^;{}"']*\b\d{1,3}px\b/i;
    const bgDeclRe = /\bbackground(?:-image)?\s*:\s*([^;{}"']*)/gi;
    const blockRe = /\{([^{}]*)\}|style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi;
    let blk;
    while ((blk = blockRe.exec(html)) !== null) {
      const block = blk[1] || blk[2] || blk[3] || '';
      if (!gridSizeRe.test(block)) continue;
      let hairlineCount = 0;
      let bm;
      bgDeclRe.lastIndex = 0;
      while ((bm = bgDeclRe.exec(block)) !== null) {
        const stops = bm[1].match(hairlineRe);
        if (stops) hairlineCount += stops.length;
      }
      if (hairlineCount >= 2) {
        findings.push({ id: 'codex-grid-background', snippet: 'two-axis grid-line gradient background' });
        break;
      }
    }
  }

  // --- Provider tells (gated): "X theater" framing copy (GPT) ---
  // Lives here (regex-on-HTML) rather than in the text-content analyzers so it
  // runs in the bundled browser path too, not just the CLI/static path.
  {
    const bodyText = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const tm = /\b(\w+)\s+theater\b/i.exec(bodyText);
    if (tm) findings.push({ id: 'theater-slop-phrase', snippet: `"${tm[0].trim()}"` });
  }

  // --- Provider tells (gated): image hover transform (Gemini) ---
  // A CSS `img...:hover { transform: ... }` rule, or a Tailwind hover:scale /
  // hover:rotate / hover:translate utility on an <img>. Each distinct
  // mechanism is its own finding.
  const imgHoverCss = /\bimg\b[^,{}]*:hover\b[^{}]*\{[^}]*\btransform\s*:\s*(?:scale|rotate|translate|matrix|skew)/i;
  if (imgHoverCss.test(html)) {
    findings.push({ id: 'image-hover-transform', snippet: 'img:hover { transform } rule' });
  }
  const imgTagRe = /<img\b[^>]*\bclass\s*=\s*"([^"]*)"/gi;
  let im;
  while ((im = imgTagRe.exec(html)) !== null) {
    if (/\bhover:(?:scale|rotate|translate|skew)-/.test(im[1])) {
      findings.push({ id: 'image-hover-transform', snippet: 'Tailwind hover transform on <img>' });
    }
  }

  return findings;
}

// ─── Section 4: resolveBackground (unified) ─────────────────────────────────

// Read the element's own background color, computed-style first, with a
// jsdom-friendly fallback that parses the inline `background:` shorthand
// from the raw style attribute. jsdom (~v29) does not decompose the
// shorthand into `backgroundColor`, so without this fallback the CLI silently
// returns null for any element styled via `background: rgb(...)` or
// `background: #abc`. Real browsers always decompose, so the fallback is
// a no-op there.
function readOwnBackgroundColor(el, computedStyle) {
  const bg = parseRgb(computedStyle.backgroundColor);
  if (DETECTOR_IS_BROWSER || (bg && bg.a >= 0.1)) return bg;
  const rawStyle = el.getAttribute?.('style') || '';
  const bgMatch = rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  const inlineBg = bgMatch ? bgMatch[1].trim() : '';
  if (!inlineBg) return bg;
  if (/gradient/i.test(inlineBg) || /url\s*\(/i.test(inlineBg)) return bg;
  const fromRgb = parseRgb(inlineBg);
  if (fromRgb) return fromRgb;
  const hexMatch = inlineBg.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 6) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
  }
  return bg;
}

function resolveBackground(el, win, customPropMap) {
  let current = el;
  while (current && current.nodeType === 1) {
    const style = DETECTOR_IS_BROWSER ? getComputedStyle(current) : win.getComputedStyle(current);
    const bgImage = style.backgroundImage || '';
    const hasGradientOrUrl = bgImage && bgImage !== 'none' && (/gradient/i.test(bgImage) || /url\s*\(/i.test(bgImage));

    // Try the solid bg-color FIRST. If the element has both a solid color
    // and a gradient/url overlay (a common pattern: `background: var(--paper)
    // radial-gradient(...)` for paper-grain texture), the solid color is the
    // dominant visible surface for contrast purposes; the overlay is
    // decorative. The old behavior bailed on any gradient ancestor, which
    // caused massive false-positive contrast findings on grain-textured
    // body backgrounds.
    let bg = parseRgb(style.backgroundColor);
    if (!DETECTOR_IS_BROWSER && (!bg || bg.a < 0.1)) {
      // jsdom returns literal "var(--X)" / "oklch(...)" strings. Resolve
      // through customPropMap so Tailwind v4 color tokens become RGB.
      if (customPropMap) {
        bg = parseColorResolved(style.backgroundColor, customPropMap);
      }
      if (!bg || bg.a < 0.1) {
        // Inline-style fallback. jsdom doesn't decompose background
        // shorthand, so colors set via inline style are otherwise invisible.
        const rawStyle = current.getAttribute?.('style') || '';
        const bgMatch = rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
        const inlineBg = bgMatch ? bgMatch[1].trim() : '';
        if (inlineBg && !/gradient/i.test(inlineBg) && !/url\s*\(/i.test(inlineBg)) {
          bg = parseColorResolved(inlineBg, customPropMap) || parseAnyColor(inlineBg);
        }
      }
    }

    if (bg && bg.a > 0.1) {
      if (DETECTOR_IS_BROWSER || bg.a >= 0.5) return bg;
    }
    // No solid bg-color at this level. If THIS level has a gradient/url
    // with no underlying solid color we can read:
    //   • on body/html: assume white. Body-level gradients are almost
    //     always decorative texture (paper grain, noise) on top of a
    //     solid bg-color the page set via `background: var(--paper)`
    //     shorthand — which jsdom can't decompose into bg-color. The
    //     downstream gradient-stops fallback path produces catastrophic
    //     false positives in this case (gradient noise stops have
    //     accidental browns/blacks that look like card backgrounds).
    //   • on other elements: bail to null and let the caller fall back
    //     to gradient stops (gradient buttons / hero sections are real
    //     bgs worth checking against).
    if (hasGradientOrUrl) {
      if (current.tagName === 'BODY' || current.tagName === 'HTML') {
        return { r: 255, g: 255, b: 255, a: 1 };
      }
      return null;
    }
    current = current.parentElement;
  }
  return { r: 255, g: 255, b: 255 };
}

// Walk parents looking for a gradient background and return its color stops.
// Used as a fallback when resolveBackground() returns null because the
// effective background is a gradient (no single solid color to compare against).
function resolveGradientStops(el, win) {
  let current = el;
  while (current && current.nodeType === 1) {
    const style = DETECTOR_IS_BROWSER ? getComputedStyle(current) : win.getComputedStyle(current);
    const bgImage = style.backgroundImage || '';
    if (bgImage && bgImage !== 'none' && /gradient/i.test(bgImage)) {
      const stops = parseGradientColors(bgImage);
      if (stops.length > 0) return stops;
    }
    if (!DETECTOR_IS_BROWSER) {
      // jsdom doesn't decompose `background:` shorthand — peek at the raw inline style
      const rawStyle = current.getAttribute?.('style') || '';
      const bgMatch = rawStyle.match(/background(?:-image)?\s*:\s*([^;]+)/i);
      if (bgMatch && /gradient/i.test(bgMatch[1])) {
        const stops = parseGradientColors(bgMatch[1]);
        if (stops.length > 0) return stops;
      }
    }
    current = current.parentElement;
  }
  return null;
}

// Parse a single CSS length token to pixels. Accepts "12px", "50%", a
// shorthand like "12px 4px" (uses the first value), or empty / null.
// Returns the pixel value, or null when the input is unparseable.
// Percentages convert against `widthPx` when one is supplied. Without a
// usable width (jsdom returns "auto" for many real-world elements,
// which parseFloat collapses to 0), fall back to the raw percentage
// number so callers gating on `> 0` (border-accent-on-rounded,
// isCardLike's hasRadius) still see a positive value, matching the
// original parseFloat("50%") === 50 behavior.
function parseRadiusToPx(value, widthPx) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  const num = parseFloat(first);
  if (Number.isNaN(num)) return null;
  if (/%$/.test(first)) {
    if (widthPx && widthPx > 0) return (num / 100) * widthPx;
    return num;
  }
  return num;
}

function resolveBorderRadiusPx(el, style, widthPx, win) {
  const fromComputed = parseRadiusToPx(style.borderRadius, widthPx);
  if (fromComputed !== null) return fromComputed;
  return 0;
}

// ─── Section 5: Element Adapters ────────────────────────────────────────────

// Browser adapters — call getComputedStyle/getBoundingClientRect on live DOM

function checkElementBordersDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (BORDER_SAFE_TAGS.has(tag)) return [];
  const rect = el.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return [];
  const style = getComputedStyle(el);
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = {}, colors = {};
  for (const s of sides) {
    widths[s] = parseFloat(style[`border${s}Width`]) || 0;
    colors[s] = style[`border${s}Color`] || '';
  }
  return checkBorders(tag, widths, colors, parseFloat(style.borderRadius) || 0);
}

function checkElementColorsDOM(el) {
  const tag = el.tagName.toLowerCase();
  // No early SAFE_TAGS bail here — checkColors() does its own gating that
  // includes the styled-button exception for <a> / <button> with their own
  // opaque background. Bailing here would prevent that exception from firing.
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return [];
  const style = getComputedStyle(el);
  const directText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasDirectText = directText.trim().length > 0;
  const effectiveBg = resolveBackground(el);
  return checkColors({
    tag,
    textColor: parseRgb(style.color),
    bgColor: readOwnBackgroundColor(el, style),
    effectiveBg,
    effectiveBgStops: effectiveBg ? null : resolveGradientStops(el),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText,
    isEmojiOnly: isEmojiOnlyText(directText),
    bgClip: style.webkitBackgroundClip || style.backgroundClip || '',
    bgImage: style.backgroundImage || '',
    classList: el.getAttribute('class') || '',
  });
}

function checkElementIconTileDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (!HEADING_TAGS.has(tag)) return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];

  const sibRect = sibling.getBoundingClientRect();
  const headRect = el.getBoundingClientRect();
  const sibStyle = getComputedStyle(sibling);

  // The tile may either contain an <svg>/<i> icon child, OR the tile itself
  // may contain an emoji/symbol character directly as its only text content
  // (the "card-icon" pattern from many AI-generated demos).
  const iconChild = sibling.querySelector('svg, i[data-lucide], i[class*="fa-"], i[class*="icon"]');
  const iconRect = iconChild?.getBoundingClientRect();
  const sibDirectText = [...sibling.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasInlineEmojiIcon = sibling.children.length === 0 && isEmojiOnlyText(sibDirectText);

  return checkIconTile({
    headingTag: tag,
    headingText: el.textContent || '',
    headingTop: headRect.top,
    siblingTag: sibling.tagName.toLowerCase(),
    siblingWidth: sibRect.width,
    siblingHeight: sibRect.height,
    siblingBottom: sibRect.bottom,
    siblingBgColor: parseRgb(sibStyle.backgroundColor),
    siblingBgImage: sibStyle.backgroundImage || '',
    siblingBorderWidth: parseFloat(sibStyle.borderTopWidth) || 0,
    siblingBorderRadius: parseFloat(sibStyle.borderRadius) || 0,
    hasIconChild: !!iconChild || hasInlineEmojiIcon,
    iconChildWidth: iconRect?.width || 0,
  });
}

function checkElementItalicSerifDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'h1' && tag !== 'h2') return [];
  const style = getComputedStyle(el);
  return checkItalicSerif({
    tag,
    fontStyle: style.fontStyle || '',
    fontFamily: style.fontFamily || '',
    fontSize: parseFloat(style.fontSize) || 0,
    headingText: el.textContent || '',
  });
}

function checkElementHeroEyebrowDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'h1') return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];
  const headStyle = getComputedStyle(el);
  const sibStyle = getComputedStyle(sibling);
  return checkHeroEyebrow({
    headingTag: tag,
    headingText: el.textContent || '',
    headingFontSize: parseFloat(headStyle.fontSize) || 0,
    siblingTag: sibling.tagName.toLowerCase(),
    siblingText: sibling.textContent || '',
    siblingTextTransform: sibStyle.textTransform || '',
    siblingFontSize: parseFloat(sibStyle.fontSize) || 0,
    siblingLetterSpacing: parseFloat(sibStyle.letterSpacing) || 0,
    siblingFontWeight: sibStyle.fontWeight || '',
    siblingColor: sibStyle.color || '',
  });
}

// Build a map of CSS custom properties declared on :root / :host / html.
// Used to resolve var(--X) refs that jsdom returns verbatim in
// getComputedStyle. Tailwind v4 routes every utility class through
// CSS vars (font-weight: var(--font-weight-bold), font-size:
// var(--text-xs), letter-spacing: var(--tracking-widest)), so without
// resolution every style-based check silently fails on Tailwind v4
// builds — the values come back as literal "var(--font-weight-bold)"
// strings and parseFloat returns NaN.
function buildCustomPropMap(document) {
  const map = new Map();
  let sheets;
  try { sheets = Array.from(document.styleSheets || []); }
  catch { return map; }
  for (const sheet of sheets) {
    let rules;
    try { rules = Array.from(sheet.cssRules || []); }
    catch { continue; }
    for (const rule of rules) {
      // Style rules only (type 1). Walk @media / @supports if present.
      if (rule.type === 4 /* MEDIA_RULE */ || rule.type === 12 /* SUPPORTS_RULE */) {
        try { rules.push(...Array.from(rule.cssRules || [])); } catch { /* ignore */ }
        continue;
      }
      if (rule.type !== 1 /* STYLE_RULE */) continue;
      const sel = rule.selectorText || '';
      if (!/(^|,\s*)(:root|html|:host)\b/i.test(sel)) continue;
      const style = rule.style;
      if (!style) continue;
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (!prop || !prop.startsWith('--')) continue;
        const val = style.getPropertyValue(prop).trim();
        if (val) map.set(prop, val);
      }
    }
  }
  return map;
}

// Resolve var(--X[, fallback]) refs in a computed-style value string.
// Recurses up to 8 levels for chained refs (--a: var(--b)). Returns
// the original string when no refs are present or the chain doesn't
// resolve. Safe to call on already-resolved values.
function resolveVarRefs(raw, customPropMap, depth = 0) {
  if (typeof raw !== 'string' || !raw.includes('var(')) return raw;
  if (depth > 8) return raw;
  return raw.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, name, fallback) => {
    const v = customPropMap.get(name);
    if (v != null) return resolveVarRefs(v, customPropMap, depth + 1);
    return fallback ? resolveVarRefs(fallback.trim(), customPropMap, depth + 1) : _m;
  });
}

// OKLCH → sRGB conversion (Björn Ottosson's matrices). L in 0..1 (or %),
// C in 0..~0.4 typical, H in degrees. Returns clamped {r,g,b,a:1} in 0..255.
// Needed because jsdom doesn't compute oklch() values — getComputedStyle
// returns the literal "oklch(...)" string. Without this, the entire
// Tailwind v4 color palette (which is OKLCH-based) is invisible to the
// detector's contrast / color checks.
function oklchToRgb(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc = s_ * s_ * s_;
  const rLin =  4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const gLin = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bLin = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
  const enc = (x) => {
    const c = Math.max(0, Math.min(1, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return {
    r: Math.round(enc(rLin) * 255),
    g: Math.round(enc(gLin) * 255),
    b: Math.round(enc(bLin) * 255),
    a: 1,
  };
}

// Extended color parser: rgb/rgba/hex/oklch. Returns null on no match.
// Use this when the input might be any CSS color form; use plain parseRgb
// when you only expect computed rgb() values from real browsers.
function parseAnyColor(s) {
  if (!s || typeof s !== 'string') return null;
  const str = s.trim();
  if (str === 'transparent' || str === 'currentcolor' || str === 'inherit') return null;
  let m;
  m = str.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
  if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: m[4] !== undefined ? +m[4] : 1 };
  m = str.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  // OKLCH parser. Tailwind v4's CSS minifier squishes the space after
  // `%` ("21.5%.02 50"), so the separator between L and C may be absent.
  // Match L (with optional %), then C and H separated permissively.
  m = str.match(/oklch\(\s*([\d.]+)(%?)\s*[\s,]*\s*([\d.]+)\s*[\s,]+\s*([-\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+)(%)?)?\s*\)/i);
  if (m) {
    const Lnum = parseFloat(m[1]);
    const L = m[2] === '%' ? Lnum / 100 : Lnum;
    const rgb = oklchToRgb(L, parseFloat(m[3]), parseFloat(m[4]));
    if (m[5] !== undefined) {
      const alpha = parseFloat(m[5]);
      rgb.a = m[6] === '%' ? alpha / 100 : alpha;
    }
    return rgb;
  }
  return null;
}

// Resolve var() refs in a color string (via customPropMap), then parse.
// Returns null on any failure. Used in jsdom-mode paths where
// getComputedStyle returns literal "var(--X)" or "oklch(...)" strings.
function parseColorResolved(str, customPropMap) {
  if (!str) return null;
  const resolved = customPropMap ? resolveVarRefs(str, customPropMap) : str;
  return parseAnyColor(resolved);
}

const REPEATED_KICKER_SKIP_SELECTOR = [
  'nav',
  'form',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'figure',
  'figcaption',
  'ol',
  'ul',
  'li',
  '[role="navigation"]',
  '[aria-label*="breadcrumb" i]',
  '[class*="breadcrumb" i]',
  '[aria-hidden="true"]',
  '[data-audit-allow-kickers]',
].join(',');

const REPEATED_KICKER_CARD_CONTEXT_SELECTOR = [
  'article',
  'button',
  'a',
  'li',
  '[role="listitem"]',
  '[role="option"]',
].join(',');

function cleanInlineText(el) {
  return [...el.childNodes]
    .filter(n => n.nodeType === 3)
    .map(n => n.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRepeatedKickerCardContext(heading, kicker) {
  const item = heading.closest?.(REPEATED_KICKER_CARD_CONTEXT_SELECTOR);
  return Boolean(item && (!item.contains || item.contains(kicker)));
}

function isRepeatedKickerCandidate(opts) {
  const {
    headingTag,
    headingText,
    headingFontSize,
    kickerTag,
    kickerText,
    kickerTextTransform,
    kickerFontSize,
    kickerLetterSpacing,
  } = opts;
  if (!['h2', 'h3', 'h4'].includes(headingTag)) return false;
  if (!headingText || headingText.length < 3) return false;
  if (/^\/[\w-]+/i.test(headingText.replace(/^"|"$/g, '').trim())) return false;
  if (!(headingFontSize >= 20)) return false;
  if (!kickerTag || HEADING_TAGS.has(kickerTag)) return false;
  if (!['p', 'span', 'div', 'small'].includes(kickerTag)) return false;
  if (!kickerText || kickerText.length < 2 || kickerText.length > 34) return false;
  if (/^step\s*\d+/i.test(kickerText) || /^\d{1,2}$/.test(kickerText)) return false;

  const isUppercased = kickerTextTransform === 'uppercase'
    || (/[A-Z]/.test(kickerText) && !/[a-z]/.test(kickerText));
  if (!isUppercased) return false;
  if (!(kickerFontSize > 0 && kickerFontSize <= 14)) return false;
  const minTrackedSpacing = Math.max(1, kickerFontSize * 0.08);
  if (!(kickerLetterSpacing >= minTrackedSpacing)) return false;
  return true;
}

function collectRepeatedSectionKickerCandidates(doc, getStyle, resolveLetterSpacing) {
  const candidates = [];
  for (const heading of doc.querySelectorAll('h2, h3, h4')) {
    if (heading.closest?.(REPEATED_KICKER_SKIP_SELECTOR)) continue;
    const kicker = heading.previousElementSibling;
    if (!kicker || kicker.closest?.(REPEATED_KICKER_SKIP_SELECTOR)) continue;
    if (isRepeatedKickerCardContext(heading, kicker)) continue;

    const headingStyle = getStyle(heading);
    const kickerStyle = getStyle(kicker);
    const headingText = (heading.textContent || '').replace(/\s+/g, ' ').trim();
    const kickerText = cleanInlineText(kicker) || (kicker.textContent || '').replace(/\s+/g, ' ').trim();
    const headingFontSize = resolveLetterSpacing(headingStyle.fontSize || '', 16) || parseFloat(headingStyle.fontSize) || 0;
    const kickerFontSize = resolveLetterSpacing(kickerStyle.fontSize || '', 16) || parseFloat(kickerStyle.fontSize) || 0;
    const kickerLetterSpacing = resolveLetterSpacing(kickerStyle.letterSpacing || '', kickerFontSize);

    if (!isRepeatedKickerCandidate({
      headingTag: heading.tagName.toLowerCase(),
      headingText,
      headingFontSize,
      kickerTag: kicker.tagName.toLowerCase(),
      kickerText,
      kickerTextTransform: kickerStyle.textTransform || '',
      kickerFontSize,
      kickerLetterSpacing,
    })) {
      continue;
    }

    candidates.push({
      headingTag: heading.tagName.toLowerCase(),
      headingText: headingText.replace(/^"|"$/g, '').slice(0, 60),
      kickerText: kickerText.slice(0, 40),
    });
  }
  return candidates;
}

function checkRepeatedSectionKickersDOM() {
  const candidates = collectRepeatedSectionKickerCandidates(
    document,
    (el) => getComputedStyle(el),
    (value, fontSize) => resolveLengthPx(value, fontSize) || 0,
  );
  return checkRepeatedSectionKickers({ candidates });
}

function checkElementMotionDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (SAFE_TAGS.has(tag)) return [];
  const style = getComputedStyle(el);
  return checkMotion({
    tag,
    transitionProperty: style.transitionProperty || '',
    animationName: style.animationName || '',
    timingFunctions: [style.animationTimingFunction, style.transitionTimingFunction].filter(Boolean).join(' '),
    classList: el.getAttribute('class') || '',
  });
}

function checkElementGlowDOM(el) {
  const tag = el.tagName.toLowerCase();
  const style = getComputedStyle(el);
  if (!style.boxShadow || style.boxShadow === 'none') return [];
  // Use parent's background — glow radiates outward, so the surrounding context matters
  // If resolveBackground returns null (gradient), try to infer from the gradient colors
  let parentBg = el.parentElement ? resolveBackground(el.parentElement) : resolveBackground(el);
  if (!parentBg) {
    // Gradient background — sample its colors to determine if it's dark
    let cur = el.parentElement;
    while (cur && cur.nodeType === 1) {
      const bgImage = getComputedStyle(cur).backgroundImage || '';
      const gradColors = parseGradientColors(bgImage);
      if (gradColors.length > 0) {
        // Average the gradient colors
        const avg = { r: 0, g: 0, b: 0 };
        for (const c of gradColors) { avg.r += c.r; avg.g += c.g; avg.b += c.b; }
        avg.r = Math.round(avg.r / gradColors.length);
        avg.g = Math.round(avg.g / gradColors.length);
        avg.b = Math.round(avg.b / gradColors.length);
        parentBg = avg;
        break;
      }
      cur = cur.parentElement;
    }
  }
  return checkGlow({ tag, boxShadow: style.boxShadow, effectiveBg: parentBg });
}

function checkElementAIPaletteDOM(el) {
  const style = getComputedStyle(el);
  const findings = [];

  // Check gradient backgrounds for purple/violet or cyan
  const bgImage = style.backgroundImage || '';
  const gradColors = parseGradientColors(bgImage);
  for (const c of gradColors) {
    if (hasChroma(c, 50)) {
      const hue = getHue(c);
      if (hue >= 260 && hue <= 310) {
        findings.push({ id: 'ai-color-palette', snippet: 'Purple/violet gradient background' });
        break;
      }
      if (hue >= 160 && hue <= 200) {
        findings.push({ id: 'ai-color-palette', snippet: 'Cyan gradient background' });
        break;
      }
    }
  }

  // Check for neon text (vivid cyan/purple color on dark background)
  const textColor = parseRgb(style.color);
  if (textColor && hasChroma(textColor, 80)) {
    const hue = getHue(textColor);
    const isAIPalette = (hue >= 160 && hue <= 200) || (hue >= 260 && hue <= 310);
    if (isAIPalette) {
      const parentBg = el.parentElement ? resolveBackground(el.parentElement) : null;
      // Also check gradient parents
      let effectiveBg = parentBg;
      if (!effectiveBg) {
        let cur = el.parentElement;
        while (cur && cur.nodeType === 1) {
          const gi = getComputedStyle(cur).backgroundImage || '';
          const gc = parseGradientColors(gi);
          if (gc.length > 0) {
            const avg = { r: 0, g: 0, b: 0 };
            for (const c of gc) { avg.r += c.r; avg.g += c.g; avg.b += c.b; }
            avg.r = Math.round(avg.r / gc.length);
            avg.g = Math.round(avg.g / gc.length);
            avg.b = Math.round(avg.b / gc.length);
            effectiveBg = avg;
            break;
          }
          cur = cur.parentElement;
        }
      }
      if (effectiveBg && relativeLuminance(effectiveBg) < 0.1) {
        const label = hue >= 260 ? 'Purple/violet' : 'Cyan';
        findings.push({ id: 'ai-color-palette', snippet: `${label} neon text on dark background` });
      }
    }
  }

  return findings;
}

const QUALITY_TEXT_TAGS = new Set(['p', 'li', 'td', 'th', 'dd', 'blockquote', 'figcaption']);

// Resolve a CSS font-size value to pixels by walking up the parent chain.
// Browsers resolve em/rem/% to px in getComputedStyle, but jsdom returns the
// specified value verbatim — so for the Node path we walk parents ourselves.
function resolveFontSizePx(el, win) {
  const chain = []; // raw font-size strings, leaf → root
  let cur = el;
  while (cur && cur.nodeType === 1) {
    const fs = (win ? win.getComputedStyle(cur) : getComputedStyle(cur)).fontSize;
    chain.push(fs || '');
    cur = cur.parentElement;
  }
  // Walk root → leaf, resolving each value relative to its parent context.
  let px = 16; // root default
  for (let i = chain.length - 1; i >= 0; i--) {
    const v = chain[i];
    if (!v || v === 'inherit') continue;
    const num = parseFloat(v);
    if (isNaN(num)) continue;
    if (v.endsWith('px')) px = num;
    else if (v.endsWith('rem')) px = num * 16;
    else if (v.endsWith('em')) px = num * px;
    else if (v.endsWith('%')) px = (num / 100) * px;
    else px = num; // unitless — already resolved
  }
  return px;
}

// Resolve a CSS length value (line-height, letter-spacing, etc.) given a
// known font-size context. Returns null for "normal" / unparseable values.
function resolveLengthPx(value, fontSizePx) {
  if (!value || value === 'normal' || value === 'auto' || value === 'inherit') return null;
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  if (value.endsWith('px')) return num;
  if (value.endsWith('rem')) return num * 16;
  if (value.endsWith('em')) return num * fontSizePx;
  if (value.endsWith('%')) return (num / 100) * fontSizePx;
  // Unitless line-height = multiplier, return px equivalent
  return num * fontSizePx;
}

function cssColorIsTransparent(value) {
  if (!value) return true;
  const str = String(value).trim().toLowerCase();
  if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return true;
  const parsed = parseAnyColor(str);
  if (parsed) return (parsed.a ?? 1) <= 0.05;
  return /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(str);
}

function colorsNearlyMatch(a, b) {
  const ca = parseAnyColor(a);
  const cb = parseAnyColor(b);
  if (!ca || !cb) return false;
  const alphaDelta = Math.abs((ca.a ?? 1) - (cb.a ?? 1));
  const channelDelta = Math.max(
    Math.abs(ca.r - cb.r),
    Math.abs(ca.g - cb.g),
    Math.abs(ca.b - cb.b),
  );
  return alphaDelta <= 0.03 && channelDelta <= 3;
}

function getComputedStyleFor(win, el) {
  if (win && typeof win.getComputedStyle === 'function') {
    try { return win.getComputedStyle(el); } catch {}
  }
  if (typeof getComputedStyle === 'function') {
    try { return getComputedStyle(el); } catch {}
  }
  return null;
}

function hasVisibleBackgroundBoundary(style, el, win) {
  const bg = style?.backgroundColor || '';
  if (cssColorIsTransparent(bg)) return false;

  let parent = el?.parentElement || null;
  while (parent) {
    const parentStyle = getComputedStyleFor(win, parent);
    const parentBg = parentStyle?.backgroundColor || '';
    if (!cssColorIsTransparent(parentBg)) {
      return !colorsNearlyMatch(bg, parentBg);
    }
    parent = parent.parentElement;
  }

  return true;
}

const TEXT_EDGE_TAGS = new Set(['A', 'BUTTON', 'CODE', 'DD', 'DT', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE', 'SPAN', 'TD', 'TH']);

function hasMeaningfulDirectText(node) {
  if (!node?.childNodes) return false;
  for (const child of node.childNodes) {
    if (child.nodeType === 3 && child.textContent.trim().length > 4) return true;
  }
  return false;
}

function textDescendantsFlushSides(el, rect) {
  const flush = { top: false, right: false, bottom: false, left: false };
  if (!rect || !el?.querySelectorAll) return flush;
  const TEXT_EDGE_THRESHOLD = 4;
  const candidates = el.querySelectorAll('a, button, code, dd, dt, figcaption, h1, h2, h3, h4, h5, h6, li, p, pre, span, td, th');
  for (const node of candidates) {
    if (!TEXT_EDGE_TAGS.has(node.tagName) || !hasMeaningfulDirectText(node)) continue;
    let nodeRect = null;
    try { nodeRect = node.getBoundingClientRect(); } catch {}
    if (!nodeRect || nodeRect.width <= 0 || nodeRect.height <= 0) continue;
    if (nodeRect.bottom < rect.top || nodeRect.top > rect.bottom || nodeRect.right < rect.left || nodeRect.left > rect.right) continue;
    if (nodeRect.top - rect.top <= TEXT_EDGE_THRESHOLD) flush.top = true;
    if (rect.right - nodeRect.right <= TEXT_EDGE_THRESHOLD) flush.right = true;
    if (rect.bottom - nodeRect.bottom <= TEXT_EDGE_THRESHOLD) flush.bottom = true;
    if (nodeRect.left - rect.left <= TEXT_EDGE_THRESHOLD) flush.left = true;
  }
  return flush;
}

// Pure quality checks. Most run on computed CSS and DOM-only inputs (work in
// jsdom and the browser). Two checks (line-length, cramped-padding) gate on
// element rect dimensions, which jsdom can't compute — pass `rect: null` from
// the Node adapter to skip those.
//
// Both adapters resolve font-size, line-height and letter-spacing to pixels
// before calling this so the pure function only deals with numbers.
function checkQuality(opts) {
  const { el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect, lineMax = 80, viewportWidth = 0, win = null } = opts;
  const findings = [];
  // Skip browser extension injected elements
  const elId = el.id || '';
  if (elId.startsWith('claude-') || elId.startsWith('cic-')) return findings;

  // --- Line length too long --- (browser-only: needs rect.width)
  if (rect && hasDirectText && QUALITY_TEXT_TAGS.has(tag) && rect.width > 0 && textLen > lineMax) {
    const charsPerLine = rect.width / (fontSize * 0.5);
    if (charsPerLine > lineMax + 5) {
      findings.push({ id: 'line-length', snippet: `~${Math.round(charsPerLine)} chars/line (aim for <${lineMax})` });
    }
  }

  // --- Cramped padding --- (browser-only: needs rect to skip small badges/labels)
  // Vertical and horizontal thresholds are independent because line-height
  // already provides built-in vertical breathing room (the line box is taller
  // than the cap height), but horizontal has no equivalent. Both scale with
  // font-size — bigger text demands proportionally more padding.
  //   vertical:   max(4px, fontSize × 0.3)
  //   horizontal: max(8px, fontSize × 0.5)
  const isInlineCode = tag === 'code' && !(el.closest && el.closest('pre'));
  if (!isInlineCode && rect && hasDirectText && textLen > 20 && rect.width > 100 && rect.height > 30) {
    const borders = {
      top: parseFloat(style.borderTopWidth) || 0,
      right: parseFloat(style.borderRightWidth) || 0,
      bottom: parseFloat(style.borderBottomWidth) || 0,
      left: parseFloat(style.borderLeftWidth) || 0,
    };
    const borderCount = Object.values(borders).filter(w => w > 0).length;
    const hasBg = hasVisibleBackgroundBoundary(style, el, win);
    if (borderCount >= 2 || hasBg) {
      const vPads = [], hPads = [];
      if (hasBg || borders.top > 0) vPads.push(parseFloat(style.paddingTop) || 0);
      if (hasBg || borders.bottom > 0) vPads.push(parseFloat(style.paddingBottom) || 0);
      if (hasBg || borders.left > 0) hPads.push(parseFloat(style.paddingLeft) || 0);
      if (hasBg || borders.right > 0) hPads.push(parseFloat(style.paddingRight) || 0);

      const vMin = vPads.length ? Math.min(...vPads) : Infinity;
      const hMin = hPads.length ? Math.min(...hPads) : Infinity;
      const vThresh = Math.max(4, fontSize * 0.3);
      const hThresh = Math.max(8, fontSize * 0.5);

      // Emit at most one finding per element — pick whichever axis is worse.
      if (vMin < vThresh) {
        findings.push({ id: 'cramped-padding', snippet: `${vMin}px vertical padding (need ≥${vThresh.toFixed(1)}px for ${fontSize}px text)` });
      } else if (hMin < hThresh) {
        findings.push({ id: 'cramped-padding', snippet: `${hMin}px horizontal padding (need ≥${hThresh.toFixed(1)}px for ${fontSize}px text)` });
      }
    }
  }

  // --- Flush against a visible boundary ---
  // Fires when a container has a visible boundary (border, outline, OR a
  // non-transparent background) AND near-zero padding on the bounded
  // side(s) AND text-bearing children land flush against the boundary.
  //
  // Distinct from cramped-padding: that rule needs the element itself to
  // have direct text (hasDirectText). This rule targets the OPPOSITE
  // shape — a container with NO direct text, only children — which is
  // exactly what cramped-padding misses (a section wrapping a label +
  // list lands a free pass).
  //
  // The classic shape: agent writes `padding: 28px 0 0` shorthand on a
  // section that also has a border, zeroing horizontal padding so the
  // text-bearing children touch the side borders. Background and
  // outline count too: a colored card with zero padding has the same
  // visual failure mode.
  {
    const FLUSH_SKIP_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ARTICLE', 'ASIDE', 'BUTTON', 'A', 'LABEL', 'SUMMARY', 'CODE', 'PRE', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM', 'FIGURE', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH']);
    const upperTag = tag ? tag.toUpperCase() : '';
    const elPosition = style.position || '';
    if (
      !FLUSH_SKIP_TAGS.has(upperTag) &&
      !hasDirectText &&
      !['fixed', 'absolute'].includes(elPosition) &&
      el.children && el.children.length > 0
    ) {
      const borderW = {
        top:    parseFloat(style.borderTopWidth)    || 0,
        right:  parseFloat(style.borderRightWidth)  || 0,
        bottom: parseFloat(style.borderBottomWidth) || 0,
        left:   parseFloat(style.borderLeftWidth)   || 0,
      };
      const borderVisible = {
        top:    borderW.top    > 0 && !cssColorIsTransparent(style.borderTopColor),
        right:  borderW.right  > 0 && !cssColorIsTransparent(style.borderRightColor),
        bottom: borderW.bottom > 0 && !cssColorIsTransparent(style.borderBottomColor),
        left:   borderW.left   > 0 && !cssColorIsTransparent(style.borderLeftColor),
      };
      // Outline detection. jsdom decomposes `border` shorthand into
      // border{Top,…}Width/Color but does NOT decompose `outline` —
      // the longhands come back empty when the value was set via the
      // shorthand. Fall back to parsing `style.outline` ourselves.
      let outlineW = parseFloat(style.outlineWidth) || 0;
      let outlineStyleVal = style.outlineStyle || '';
      let outlineColorVal = style.outlineColor || '';
      if (!outlineW && style.outline) {
        const wMatch = style.outline.match(/(\d+(?:\.\d+)?)\s*px/);
        if (wMatch) outlineW = parseFloat(wMatch[1]) || 0;
        if (!outlineStyleVal) {
          outlineStyleVal = /\b(solid|dashed|dotted|double|groove|ridge|inset|outset)\b/.test(style.outline) ? 'solid' : '';
        }
        if (!outlineColorVal) {
          const cMatch = style.outline.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*$/);
          if (cMatch) outlineColorVal = cMatch[1];
        }
      }
      const outlineVisible = outlineW > 0 && !cssColorIsTransparent(outlineColorVal) && outlineStyleVal && outlineStyleVal !== 'none';
      const bgVisible = hasVisibleBackgroundBoundary(style, el, win);

      const anyVisible = borderVisible.top || borderVisible.right || borderVisible.bottom || borderVisible.left || outlineVisible || bgVisible;
      if (anyVisible) {
        // Resolve padding to px (jsdom returns raw "1.5rem" etc., not the
        // computed px value; parseFloat would strip the unit and treat
        // 1.5rem as 1.5px, false-flagging legitimate insets).
        const pad = {
          top:    resolveLengthPx(style.paddingTop,    fontSize) ?? 0,
          right:  resolveLengthPx(style.paddingRight,  fontSize) ?? 0,
          bottom: resolveLengthPx(style.paddingBottom, fontSize) ?? 0,
          left:   resolveLengthPx(style.paddingLeft,   fontSize) ?? 0,
        };
        const PAD_THRESHOLD = 2;
        // Children-insulate-this-side: a side is insulated if ANY direct
        // child has its own padding ≥ 4px on that side. Rationale: in
        // typical flow, only the first/last (or leftmost/rightmost)
        // children actually sit at the parent's edges. If even one of
        // them has its own padding, the visual flush is broken on that
        // side. Classic example: a column-flow card frame where the
        // top child (header) has padding-top:12 and the bottom child
        // (footer) has padding-bottom:8 — the parent's padding:0 doesn't
        // matter; nothing is actually flush. The `any-child-insulates`
        // heuristic accepts some false negatives (a card with one heavily
        // padded middle child won't flag) for far fewer false positives.
        const CHILD_INSULATE_THRESHOLD = 4;
        const childrenInsulate = { top: false, right: false, bottom: false, left: false };
        for (const child of el.children) {
          let childStyle = getComputedStyleFor(win, child);
          if (!childStyle) continue;
          const childPad = {
            top:    resolveLengthPx(childStyle.paddingTop,    fontSize) ?? 0,
            right:  resolveLengthPx(childStyle.paddingRight,  fontSize) ?? 0,
            bottom: resolveLengthPx(childStyle.paddingBottom, fontSize) ?? 0,
            left:   resolveLengthPx(childStyle.paddingLeft,   fontSize) ?? 0,
          };
          const childMargin = {
            top:    resolveLengthPx(childStyle.marginTop,    fontSize) ?? 0,
            right:  resolveLengthPx(childStyle.marginRight,  fontSize) ?? 0,
            bottom: resolveLengthPx(childStyle.marginBottom, fontSize) ?? 0,
            left:   resolveLengthPx(childStyle.marginLeft,   fontSize) ?? 0,
          };
          if (rect && typeof child.getBoundingClientRect === 'function') {
            try {
              const childRect = child.getBoundingClientRect();
              if (childRect && childRect.width > 0 && childRect.height > 0) {
                if (childRect.top - rect.top >= CHILD_INSULATE_THRESHOLD) childrenInsulate.top = true;
                if (rect.right - childRect.right >= CHILD_INSULATE_THRESHOLD) childrenInsulate.right = true;
                if (rect.bottom - childRect.bottom >= CHILD_INSULATE_THRESHOLD) childrenInsulate.bottom = true;
                if (childRect.left - rect.left >= CHILD_INSULATE_THRESHOLD) childrenInsulate.left = true;
              }
            } catch {}
          }
          for (const s of ['top', 'right', 'bottom', 'left']) {
            if (childPad[s] >= CHILD_INSULATE_THRESHOLD || childMargin[s] >= CHILD_INSULATE_THRESHOLD) {
              childrenInsulate[s] = true;
            }
          }
        }

        const textFlush = rect ? textDescendantsFlushSides(el, rect) : null;
        const fullBleedBgBand = rect && viewportWidth > 0 && rect.width >= viewportWidth * 0.94 && bgVisible && !outlineVisible;
        const flushSides = [];
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const bgBoundsSide = bgVisible && !(fullBleedBgBand && (side === 'left' || side === 'right'));
          const sideBounded = borderVisible[side] || outlineVisible || bgBoundsSide;
          if (sideBounded && pad[side] <= PAD_THRESHOLD && !childrenInsulate[side] && (!textFlush || textFlush[side])) {
            flushSides.push(side);
          }
        }

        if (flushSides.length > 0) {
          // Confirm at least one direct child has substantial text content
          // (> 4 chars). Without this, the flush is harmless: e.g. an
          // image-only card.
          let hasTextChild = false;
          for (const child of el.children) {
            const childText = (child.textContent || '').trim();
            if (childText.length > 4) { hasTextChild = true; break; }
          }
          if (hasTextChild) {
            const cls = (typeof el.className === 'string' && el.className.trim())
              ? el.className.trim().split(/\s+/)[0]
              : '';
            const boundaryParts = [];
            const borderSidesVisible = ['top', 'right', 'bottom', 'left'].filter(s => borderVisible[s]);
            if (borderSidesVisible.length === 4) boundaryParts.push('border');
            else if (borderSidesVisible.length > 0) boundaryParts.push(`border-${borderSidesVisible.join('/')}`);
            if (outlineVisible) boundaryParts.push('outline');
            if (bgVisible) boundaryParts.push('bg');
            const sidesLabel = flushSides.length === 4 ? 'all sides' : flushSides.join('/');
            const ident = cls
              ? `<${tag.toLowerCase()}> "${cls}"`
              : `<${tag.toLowerCase()}>`;
            findings.push({
              id: 'cramped-padding',
              snippet: `${ident}: children flush against ${boundaryParts.join('+')} on ${sidesLabel} (no inset)`,
            });
          }
        }
      }
    }
  }

  // --- Body text touching viewport edge --- (browser-only: needs rect)
  // Catches the failure mode where the agent ships body paragraphs
  // with NO container providing horizontal padding — text bleeds
  // directly to the viewport edge. Different from cramped-padding,
  // which requires a colored/bordered container. Here the failure
  // is the absence of the container entirely.
  //
  // Gate aggressively to avoid false positives:
  //   - <p> or <li> only (body content; not headings, not nav, not
  //     wrappers)
  //   - text > 40 chars (paragraph-like, not a label)
  //   - rect.width > 50% of viewport (real body, not a pull-quote)
  //   - rect.left < 16 OR rect.right > viewport - 16 (actually
  //     touching the edge)
  //   - not inside <nav> or <header> (those legitimately bleed)
  //   - element itself has no background-color (intentional full-bleed
  //     sections set a bg-color and provide their own internal padding)
  if (rect && hasDirectText && textLen > 40 && ['P', 'LI'].includes(tag.toUpperCase()) && viewportWidth > 0) {
    const inNavHeader = el.closest && (el.closest('nav') || el.closest('header'));
    const hasOwnBg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
    const isPositioned = ['fixed', 'absolute'].includes(style.position || '');
    const widthRatio = rect.width / viewportWidth;
    const leftClose = rect.left < 16;
    const rightClose = rect.right > viewportWidth - 16;
    if (!inNavHeader && !hasOwnBg && !isPositioned && widthRatio > 0.5 && (leftClose || rightClose)) {
      const which = leftClose && rightClose
        ? `left ${Math.round(rect.left)}px / right ${Math.round(viewportWidth - rect.right)}px`
        : leftClose
          ? `left ${Math.round(rect.left)}px`
          : `right ${Math.round(viewportWidth - rect.right)}px`;
      findings.push({ id: 'body-text-viewport-edge', snippet: `<${tag.toLowerCase()}> with ${textLen}-char body bleeds to viewport edge (${which})` });
    }
  }

  // --- Tight line height ---
  if (hasDirectText && textLen > 50 && !['h1','h2','h3','h4','h5','h6'].includes(tag)) {
    if (lineHeightPx != null && fontSize > 0) {
      const ratio = lineHeightPx / fontSize;
      if (ratio > 0 && ratio < 1.3) {
        findings.push({ id: 'tight-leading', snippet: `line-height ${ratio.toFixed(2)}x (need >=1.3)` });
      }
    }
  }

  // --- Justified text (without hyphens) ---
  if (hasDirectText && style.textAlign === 'justify') {
    const hyphens = style.hyphens || style.webkitHyphens || '';
    if (hyphens !== 'auto') {
      findings.push({ id: 'justified-text', snippet: 'text-align: justify without hyphens: auto' });
    }
  }

  // --- Tiny body text ---
  // Only flag actual body content, not UI labels (buttons, tabs, badges, captions, footer text, etc.)
  if (hasDirectText && textLen > 20 && fontSize < 12) {
    const skipTags = ['sub', 'sup', 'code', 'kbd', 'samp', 'var', 'caption', 'figcaption'];
    const inUIContext = el.closest && el.closest('button, a, label, summary, pre, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], nav, footer, [aria-hidden="true"], [class*="badge" i], [class*="caption" i], [class*="chip" i], [class*="code" i], [class*="console" i], [class*="diff" i], [class*="label" i], [class*="meta" i], [class*="mock" i], [class*="pill" i], [class*="preview" i], [class*="tag" i], [class*="terminal" i], [class*="writes" i]');
    const isUppercase = style.textTransform === 'uppercase';
    if (!skipTags.includes(tag) && !inUIContext && !isUppercase) {
      findings.push({ id: 'tiny-text', snippet: `${fontSize}px body text` });
    }
  }

  // --- All-caps body text ---
  if (hasDirectText && textLen > 30 && style.textTransform === 'uppercase') {
    if (!['h1','h2','h3','h4','h5','h6'].includes(tag)) {
      findings.push({ id: 'all-caps-body', snippet: `text-transform: uppercase on ${textLen} chars of body text` });
    }
  }

  // --- Wide letter spacing on body text ---
  if (hasDirectText && textLen > 20 && style.textTransform !== 'uppercase') {
    if (letterSpacingPx != null && letterSpacingPx > 0 && fontSize > 0) {
      const trackingEm = letterSpacingPx / fontSize;
      if (trackingEm > 0.05) {
        findings.push({ id: 'wide-tracking', snippet: `letter-spacing: ${trackingEm.toFixed(2)}em on body text` });
      }
    }
  }

  // --- Crushed letter spacing (mirror of wide-tracking) ---
  // Tracking pulled tighter than ~-0.05em crushes characters into each other.
  // Optical tightening that display type legitimately wants (around -0.02em)
  // stays well above this floor.
  if (hasDirectText && textLen > 20 && fontSize > 0) {
    if (letterSpacingPx != null && letterSpacingPx < 0) {
      const trackingEm = letterSpacingPx / fontSize;
      if (trackingEm <= -0.05) {
        const excerpt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        findings.push({ id: 'extreme-negative-tracking', snippet: `letter-spacing: ${trackingEm.toFixed(2)}em — "${excerpt}"` });
      }
    }
  }

  return findings;
}

function checkElementQualityDOM(el) {
  const tag = el.tagName.toLowerCase();
  const style = getComputedStyle(el);
  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 10);
  const textLen = el.textContent?.trim().length || 0;
  // Browser getComputedStyle resolves everything to px — direct parseFloat
  // works.
  const fontSize = parseFloat(style.fontSize) || 16;
  const lineHeightPx = resolveLengthPx(style.lineHeight, fontSize);
  const letterSpacingPx = resolveLengthPx(style.letterSpacing, fontSize);
  const rect = el.getBoundingClientRect();
  const lineMax = (typeof window !== 'undefined' && window.__AUDIT_CONFIG__?.lineLengthMax) || 80;
  const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
  return checkQuality({ el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect, lineMax, viewportWidth, win: typeof window !== 'undefined' ? window : null });
}

// Pure page-level skipped-heading walk. Takes a Document so it works in both
// the browser and jsdom.
function checkPageQualityFromDoc(doc) {
  const findings = [];
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let prevLevel = 0;
  let prevText = '';
  for (const h of headings) {
    const level = parseInt(h.tagName[1]);
    const text = (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (prevLevel > 0 && level > prevLevel + 1) {
      findings.push({
        id: 'skipped-heading',
        snippet: `<h${prevLevel}> "${prevText}" followed by <h${level}> "${text}" (missing h${prevLevel + 1})`,
      });
    }
    prevLevel = level;
    prevText = text;
  }
  return findings;
}

// Browser adapter (returns the legacy { type, detail } shape used by the overlay loop)
function checkPageQualityDOM() {
  return checkPageQualityFromDoc(document).map(f => ({ type: f.id, detail: f.snippet }));
}

// Node adapters — take pre-extracted jsdom computed style

// jsdom doesn't lay out OR resolve em/rem/% to px — so we pre-resolve every
// CSS length the rule needs ourselves (walking the parent chain for
// font-size inheritance), and pass `rect: null` to skip the two rules that
// genuinely need element rects (line-length, cramped-padding).
function checkElementQuality(el, style, tag, window) {
  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 10);
  const textLen = el.textContent?.trim().length || 0;
  const fontSize = resolveFontSizePx(el, window);
  const lineHeightPx = resolveLengthPx(style.lineHeight, fontSize);
  const letterSpacingPx = resolveLengthPx(style.letterSpacing, fontSize);
  return checkQuality({ el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect: null, win: window });
}

function checkElementBorders(tag, style, overrides, resolvedRadius) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = {}, colors = {};
  for (const s of sides) {
    widths[s] = parseFloat(style[`border${s}Width`]) || 0;
    colors[s] = style[`border${s}Color`] || '';
    // jsdom silently drops any border shorthand containing var(), leaving
    // both width and color empty on the computed style. When the detectHtml
    // pre-pass pulled a resolved value off the rule, use it to fill in the
    // missing side so the side-tab check can run. Real browsers resolve
    // var() natively, so this fallback is a no-op in the browser path.
    if (widths[s] === 0 && overrides && overrides[s]) {
      widths[s] = overrides[s].width;
      colors[s] = overrides[s].color;
    } else if (colors[s] && colors[s].startsWith('var(') && overrides && overrides[s]) {
      // Longhand case: jsdom kept the width but left the color as the
      // literal `var(...)` string. Substitute the resolved color.
      colors[s] = overrides[s].color;
    }
  }
  // resolvedRadius lets the caller pre-resolve the radius via
  // resolveBorderRadiusPx so the value survives jsdom 29.1.0's broken
  // shorthand serialization. Falls back to the computed value for tests
  // and browser callers that don't pre-resolve.
  const radius = resolvedRadius != null
    ? resolvedRadius
    : (parseFloat(style.borderRadius) || 0);
  return checkBorders(tag, widths, colors, radius);
}

function checkElementColors(el, style, tag, window, customPropMap, hasAnchorInheritRule) {
  const directText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasDirectText = directText.trim().length > 0;

  const effectiveBg = resolveBackground(el, window, customPropMap);
  // jsdom returns literal "var(--X)" / "oklch(...)" for color, so plain
  // parseRgb misses Tailwind-tokenized text colors. Resolve through the
  // customPropMap first; fall back to parseRgb for vanilla rgb() pages.
  let textColor = customPropMap ? parseColorResolved(style.color, customPropMap) : null;
  if (!textColor) textColor = parseRgb(style.color);

  // Anchor-inherit FP workaround: jsdom's UA stylesheet has `:link { color:
  // blue }` at high specificity. The page's `a { color: inherit }` rule
  // (Tailwind v4 preflight) loses to jsdom even though it WINS in real
  // browsers (Chrome's UA wraps :link in :where() — zero specificity).
  // When the page declares the inherit rule AND we see jsdom's default
  // link blue on an anchor, walk to the nearest non-anchor ancestor and
  // use its color instead.
  if (
    hasAnchorInheritRule &&
    textColor &&
    textColor.r === 0 && textColor.g === 0 && textColor.b === 238 &&
    (tag === 'a' || el.closest?.('a'))
  ) {
    let cur = el.parentElement;
    while (cur && cur.tagName !== 'HTML') {
      if (cur.tagName !== 'A') {
        const ps = window.getComputedStyle(cur);
        const inh = (customPropMap ? parseColorResolved(ps.color, customPropMap) : null) || parseRgb(ps.color);
        if (inh && !(inh.r === 0 && inh.g === 0 && inh.b === 238)) {
          textColor = inh;
          break;
        }
      }
      cur = cur.parentElement;
    }
  }

  return checkColors({
    tag,
    textColor,
    bgColor: readOwnBackgroundColor(el, style),
    effectiveBg,
    effectiveBgStops: effectiveBg ? null : resolveGradientStops(el, window),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText,
    isEmojiOnly: isEmojiOnlyText(directText),
    bgClip: style.webkitBackgroundClip || style.backgroundClip || '',
    bgImage: style.backgroundImage || '',
    classList: el.getAttribute?.('class') || el.className || '',
  });
}

function checkElementIconTile(el, tag, window) {
  if (!HEADING_TAGS.has(tag)) return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];

  const sibStyle = window.getComputedStyle(sibling);
  // jsdom doesn't lay out — read explicit pixel dimensions from CSS instead.
  const sibWidth = parseFloat(sibStyle.width) || 0;
  const sibHeight = parseFloat(sibStyle.height) || 0;

  const iconChild = sibling.querySelector('svg, i[data-lucide], i[class*="fa-"], i[class*="icon"]');
  let iconWidth = 0;
  if (iconChild) {
    const iconStyle = window.getComputedStyle(iconChild);
    iconWidth = parseFloat(iconStyle.width) || parseFloat(iconChild.getAttribute('width')) || 0;
  }
  // Or: tile contains an emoji/symbol character directly as its only content
  const sibDirectText = [...sibling.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasInlineEmojiIcon = sibling.children.length === 0 && isEmojiOnlyText(sibDirectText);

  return checkIconTile({
    headingTag: tag,
    headingText: el.textContent || '',
    headingTop: 0, // jsdom: no layout, skip vertical-stacking gate
    siblingTag: sibling.tagName.toLowerCase(),
    siblingWidth: sibWidth,
    siblingHeight: sibHeight,
    siblingBottom: 0,
    siblingBgColor: parseRgb(sibStyle.backgroundColor),
    siblingBgImage: sibStyle.backgroundImage || '',
    siblingBorderWidth: parseFloat(sibStyle.borderTopWidth) || 0,
    siblingBorderRadius: resolveBorderRadiusPx(sibling, sibStyle, sibWidth, window),
    hasIconChild: !!iconChild || hasInlineEmojiIcon,
    iconChildWidth: iconWidth,
  });
}

function checkElementItalicSerif(el, style, tag) {
  if (tag !== 'h1' && tag !== 'h2') return [];
  return checkItalicSerif({
    tag,
    fontStyle: style.fontStyle || '',
    fontFamily: style.fontFamily || '',
    fontSize: parseFloat(style.fontSize) || 0,
    headingText: el.textContent || '',
  });
}

function checkElementHeroEyebrow(el, style, tag, window, customPropMap) {
  if (tag !== 'h1') return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];
  const sibStyle = window.getComputedStyle(sibling);
  // Resolve Tailwind v4 CSS-variable wrappers (font-weight:var(--font-weight-bold)
  // etc.) before parsing. jsdom returns these verbatim from getComputedStyle;
  // without resolution every style-based gate fails silently on Tailwind v4 builds.
  const fontSizeRaw = customPropMap ? resolveVarRefs(sibStyle.fontSize, customPropMap) : sibStyle.fontSize;
  const fontWeightRaw = customPropMap ? resolveVarRefs(sibStyle.fontWeight, customPropMap) : sibStyle.fontWeight;
  const letterSpacingRaw = customPropMap ? resolveVarRefs(sibStyle.letterSpacing, customPropMap) : sibStyle.letterSpacing;
  const colorRaw = customPropMap ? resolveVarRefs(sibStyle.color, customPropMap) : sibStyle.color;
  const headingFontSizeRaw = customPropMap ? resolveVarRefs(style.fontSize, customPropMap) : style.fontSize;
  const siblingFontSize = parseFloat(fontSizeRaw) || 0;
  // resolveLengthPx returns null for 'normal' / 'auto'; coerce to 0 so the
  // gate falls through cleanly. jsdom returns letter-spacing verbatim
  // (e.g. '0.15em'), unlike real browsers, so this conversion is required.
  return checkHeroEyebrow({
    headingTag: tag,
    headingText: el.textContent || '',
    headingFontSize: parseFloat(headingFontSizeRaw) || 0,
    siblingTag: sibling.tagName.toLowerCase(),
    siblingText: sibling.textContent || '',
    siblingTextTransform: sibStyle.textTransform || '',
    siblingFontSize,
    siblingLetterSpacing: resolveLengthPx(letterSpacingRaw, siblingFontSize) || 0,
    siblingFontWeight: fontWeightRaw || '',
    siblingColor: colorRaw || '',
  });
}

function checkRepeatedSectionKickersFromDoc(doc, win) {
  const candidates = collectRepeatedSectionKickerCandidates(
    doc,
    (el) => win.getComputedStyle(el),
    (value, fontSize) => resolveLengthPx(value, fontSize) || 0,
  );
  return checkRepeatedSectionKickers({ candidates });
}

function checkElementMotion(tag, style) {
  return checkMotion({
    tag,
    transitionProperty: style.transitionProperty || '',
    animationName: style.animationName || '',
    timingFunctions: [style.animationTimingFunction, style.transitionTimingFunction].filter(Boolean).join(' '),
    classList: '',
  });
}

function checkElementGlow(tag, style, effectiveBg) {
  if (!style.boxShadow || style.boxShadow === 'none') return [];
  return checkGlow({ tag, boxShadow: style.boxShadow, effectiveBg });
}

// ─── Section 6: Page-Level Checks ───────────────────────────────────────────

// Browser page-level checks — use document/getComputedStyle globals

function checkTypography() {
  const findings = [];

  // Walk actual text-bearing elements and tally font usage by *computed style*.
  // This is much more accurate than scanning CSS rules — it ignores rules that
  // exist in the stylesheet but apply to nothing (e.g. demo classes showing
  // anti-patterns), and counts what the user actually sees.
  const fontUsage = new Map(); // primary font name → count of elements
  let totalTextElements = 0;
  for (const el of document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, dd, blockquote, figcaption, a, button, label, span')) {
    // Skip audit's own elements
    if (el.closest && el.closest('.audit-overlay, .audit-label, .audit-banner, .audit-tooltip')) continue;
    // Only count elements that actually have visible direct text
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasText) continue;
    const style = getComputedStyle(el);
    const ff = style.fontFamily;
    if (!ff) continue;
    const stack = ff.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
    const primary = stack.find(f => f && !GENERIC_FONTS.has(f));
    if (!primary) continue;
    fontUsage.set(primary, (fontUsage.get(primary) || 0) + 1);
    totalTextElements++;
  }

  if (totalTextElements >= 20) {
    // A font is "primary" if it's used by at least 15% of text elements
    const PRIMARY_THRESHOLD = 0.15;
    for (const [font, count] of fontUsage) {
      const share = count / totalTextElements;
      if (share < PRIMARY_THRESHOLD) continue;
      if (!OVERUSED_FONTS.has(font)) continue;
      if (isBrandFontOnOwnDomain(font)) continue;
      findings.push({ type: 'overused-font', detail: `Primary font: ${font} (${Math.round(share * 100)}% of text)` });
    }

    // Single-font check: only one distinct primary font across all text
    if (fontUsage.size === 1) {
      const only = [...fontUsage.keys()][0];
      findings.push({ type: 'single-font', detail: `only font used is ${only}` });
    }
  }

  const sizes = new Set();
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,label,button,div')) {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs > 0 && fs < 200) sizes.add(Math.round(fs * 10) / 10);
  }
  if (sizes.size >= 3) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const ratio = sorted[sorted.length - 1] / sorted[0];
    if (ratio < 2.0) {
      findings.push({ type: 'flat-type-hierarchy', detail: `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)` });
    }
  }

  return findings;
}

function isCardLikeDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (SAFE_TAGS.has(tag) || ['input','select','textarea','img','video','canvas','picture'].includes(tag)) return false;
  const style = getComputedStyle(el);
  const cls = el.getAttribute('class') || '';
  const hasShadow = (style.boxShadow && style.boxShadow !== 'none') || /\bshadow(?:-sm|-md|-lg|-xl|-2xl)?\b/.test(cls);
  const hasBorder = /\bborder\b/.test(cls);
  const hasRadius = parseFloat(style.borderRadius) > 0 || /\brounded(?:-sm|-md|-lg|-xl|-2xl|-full)?\b/.test(cls);
  const hasBg = (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') || /\bbg-(?:white|gray-\d+|slate-\d+)\b/.test(cls);
  return isCardLikeFromProps(hasShadow, hasBorder, hasRadius, hasBg);
}

function checkLayout() {
  const findings = [];
  const flaggedEls = new Set();

  for (const el of document.querySelectorAll('*')) {
    if (!isCardLikeDOM(el) || flaggedEls.has(el)) continue;
    const cls = el.getAttribute('class') || '';
    const style = getComputedStyle(el);
    if (style.position === 'absolute' || style.position === 'fixed') continue;
    if (/\b(?:dropdown|popover|tooltip|menu|modal|dialog)\b/i.test(cls)) continue;
    if ((el.textContent?.trim().length || 0) < 10) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 30) continue;

    let parent = el.parentElement;
    while (parent) {
      if (isCardLikeDOM(parent)) { flaggedEls.add(el); break; }
      parent = parent.parentElement;
    }
  }

  for (const el of flaggedEls) {
    let isAncestor = false;
    for (const other of flaggedEls) {
      if (other !== el && el.contains(other)) { isAncestor = true; break; }
    }
    if (!isAncestor) findings.push({ type: 'nested-cards', detail: 'Card inside card', el });
  }

  return findings;
}

// Node page-level checks — take document/window as parameters

function checkPageTypography(doc, win) {
  const findings = [];

  const fonts = new Set();
  const overusedFound = new Set();

  for (const sheet of doc.styleSheets) {
    let rules;
    try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.type !== 1) continue;
      const ff = rule.style?.fontFamily;
      if (!ff) continue;
      const stack = ff.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
      const primary = stack.find(f => f && !GENERIC_FONTS.has(f));
      if (primary) {
        fonts.add(primary);
        if (OVERUSED_FONTS.has(primary)) overusedFound.add(primary);
      }
    }
  }

  // Check Google Fonts links in HTML
  const html = doc.documentElement?.outerHTML || '';
  for (const f of extractGoogleFontFamilies(html)) {
    fonts.add(f);
    if (OVERUSED_FONTS.has(f)) overusedFound.add(f);
  }

  // Also parse raw HTML/style content for font-family (jsdom may not expose all via CSSOM)
  const ffRe = /font-family\s*:\s*([^;}]+)/gi;
  let fm;
  while ((fm = ffRe.exec(html)) !== null) {
    for (const f of fm[1].split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())) {
      if (f && !GENERIC_FONTS.has(f)) {
        fonts.add(f);
        if (OVERUSED_FONTS.has(f)) overusedFound.add(f);
      }
    }
  }

  for (const font of overusedFound) {
    findings.push({ id: 'overused-font', snippet: `Primary font: ${font}` });
  }

  // Single font
  if (fonts.size === 1) {
    const els = doc.querySelectorAll('*');
    if (els.length >= 20) {
      findings.push({ id: 'single-font', snippet: `only font used is ${[...fonts][0]}` });
    }
  }

  // Flat type hierarchy
  const sizes = new Set();
  const textEls = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button, div');
  for (const el of textEls) {
    const fontSize = parseFloat(win.getComputedStyle(el).fontSize);
    // Filter out sub-8px values (jsdom doesn't resolve relative units properly)
    if (fontSize >= 8 && fontSize < 200) sizes.add(Math.round(fontSize * 10) / 10);
  }
  if (sizes.size >= 3) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const ratio = sorted[sorted.length - 1] / sorted[0];
    if (ratio < 2.0) {
      findings.push({ id: 'flat-type-hierarchy', snippet: `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)` });
    }
  }

  return findings;
}

function isCardLike(el, win) {
  const tag = el.tagName.toLowerCase();
  if (SAFE_TAGS.has(tag) || ['input', 'select', 'textarea', 'img', 'video', 'canvas', 'picture'].includes(tag)) return false;

  const style = win.getComputedStyle(el);
  const rawStyle = el.getAttribute?.('style') || '';
  const cls = el.getAttribute?.('class') || '';

  const hasShadow = (style.boxShadow && style.boxShadow !== 'none') ||
    /\bshadow(?:-sm|-md|-lg|-xl|-2xl)?\b/.test(cls) || /box-shadow/i.test(rawStyle);
  const hasBorder = /\bborder\b/.test(cls);
  const widthPx = parseFloat(style.width) || 0;
  const hasRadius = resolveBorderRadiusPx(el, style, widthPx, win) > 0 ||
    /\brounded(?:-sm|-md|-lg|-xl|-2xl|-full)?\b/.test(cls) || /border-radius/i.test(rawStyle);
  const hasBg = /\bbg-(?:white|gray-\d+|slate-\d+)\b/.test(cls) ||
    /background(?:-color)?\s*:\s*(?!transparent)/i.test(rawStyle);

  return isCardLikeFromProps(hasShadow, hasBorder, hasRadius, hasBg);
}

function checkPageLayout(doc, win) {
  const findings = [];

  // Nested cards
  const allEls = doc.querySelectorAll('*');
  const flaggedEls = new Set();
  for (const el of allEls) {
    if (!isCardLike(el, win)) continue;
    if (flaggedEls.has(el)) continue;

    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute?.('class') || '';
    const rawStyle = el.getAttribute?.('style') || '';

    if (['pre', 'code'].includes(tag)) continue;
    if (/\b(?:absolute|fixed)\b/.test(cls) || /position\s*:\s*(?:absolute|fixed)/i.test(rawStyle)) continue;
    if ((el.textContent?.trim().length || 0) < 10) continue;
    if (/\b(?:dropdown|popover|tooltip|menu|modal|dialog)\b/i.test(cls)) continue;

    // Walk up to find card-like ancestor
    let parent = el.parentElement;
    while (parent) {
      if (isCardLike(parent, win)) {
        flaggedEls.add(el);
        break;
      }
      parent = parent.parentElement;
    }
  }

  // Only report innermost nested cards
  for (const el of flaggedEls) {
    let isAncestorOfFlagged = false;
    for (const other of flaggedEls) {
      if (other !== el && el.contains(other)) {
        isAncestorOfFlagged = true;
        break;
      }
    }
    if (!isAncestorOfFlagged) {
      findings.push({ id: 'nested-cards', snippet: `Card inside card (${el.tagName.toLowerCase()})` });
    }
  }

  return findings;
}

// ─── Cream / beige palette (the default "tasteful" AI surface) ────────────────
// A warm, lightly-tinted off-white page background — light, with R≥G≥B and a
// small warm tint (not white, not a strong color). The current reflex surface.
function isCreamColor(rgb) {
  if (!rgb) return false;
  const { r, g, b } = rgb;
  if (Math.min(r, g, b) < 209) return false;   // must be light
  if (!(r >= g && g >= b)) return false;        // warm ordering
  const warmth = r - b;
  return warmth >= 6 && warmth <= 48;           // tinted, not white, not strong
}

// Tailwind background utilities that render as a warm off-white surface. The
// static engine doesn't fetch Tailwind's CSS, so a `bg-amber-50` on <body>
// resolves to nothing in computed style — catch it from the class list
// instead. Candidate tokens map to their actual Tailwind hex and are still
// filtered through isCreamColor, so neutral grays (stone) and over-saturated
// shades drop out on their own.
const TAILWIND_BG_HEX = {
  'bg-amber-50': '#fffbeb', 'bg-amber-100': '#fef3c7',
  'bg-orange-50': '#fff7ed', 'bg-orange-100': '#ffedd5',
  'bg-yellow-50': '#fefce8',
  'bg-stone-50': '#fafaf9', 'bg-stone-100': '#f5f5f4', 'bg-stone-200': '#e7e5e4',
};

function creamFromClassList(cls) {
  if (!cls) return null;
  // Arbitrary value: bg-[#f5f0e6] / bg-[rgb(245_240_230)] (underscores = spaces).
  const arb = cls.match(/\bbg-\[([^\]]+)\]/);
  if (arb && isCreamColor(parseAnyColor(arb[1].replace(/_/g, ' ')))) return `bg-[${arb[1]}]`;
  // Named warm-light utilities.
  for (const [tok, hex] of Object.entries(TAILWIND_BG_HEX)) {
    if (new RegExp(`(^|\\s)${tok}($|\\s)`).test(cls) && isCreamColor(parseAnyColor(hex))) return tok;
  }
  return null;
}

function checkCreamPalette(doc, win) {
  const findings = [];
  const body = doc.body || (doc.querySelector ? doc.querySelector('body') : null);
  if (!body) return findings;
  const html = doc.documentElement;
  const getCS = (el) => (win ? win.getComputedStyle(el) : getComputedStyle(el));

  // 1. Computed background — covers inline / <style> / linked CSS, and Tailwind
  //    once it's actually rendered (browser path).
  let bg = readOwnBackgroundColor(body, getCS(body));
  if (!bg || bg.a === 0) {
    if (html) bg = readOwnBackgroundColor(html, getCS(html));
  }
  if (isCreamColor(bg)) {
    findings.push({ id: 'cream-palette', snippet: `cream/beige page background rgb(${bg.r}, ${bg.g}, ${bg.b})` });
    return findings;
  }

  // 2. Tailwind class fallback — for the static path, where utility classes
  //    never resolve to computed CSS.
  for (const el of [body, html]) {
    const tok = creamFromClassList(el && el.getAttribute ? el.getAttribute('class') : '');
    if (tok) {
      findings.push({ id: 'cream-palette', snippet: `cream/beige page background (Tailwind ${tok})` });
      break;
    }
  }
  return findings;
}

// ─── Oversized hero headline ────────────────────────────────────────────────
// Fires when a *long* headline is set at display size and actually dominates
// the viewport. A punchy one- or two-word headline at the same size is a
// legitimate stylistic choice, and a large-but-contained two-line hero should
// pass too — length and viewport share together are the tell.
const OVERSIZED_H1_FONT_PX = 72;
const OVERSIZED_H1_MIN_CHARS = 40;
const OVERSIZED_H1_MIN_VIEWPORT_HEIGHT_RATIO = 0.28;
const OVERSIZED_H1_MIN_VIEWPORT_AREA_RATIO = 0.25;
function checkOversizedH1({ tag, fontSize, headingText, rect = null, viewportWidth = 0, viewportHeight = 0 }) {
  if (tag !== 'h1') return [];
  const textLen = headingText.length;
  if (fontSize >= OVERSIZED_H1_FONT_PX && textLen >= OVERSIZED_H1_MIN_CHARS) {
    let viewportDetail = '';
    if (rect && viewportWidth > 0 && viewportHeight > 0) {
      const heightRatio = rect.height / viewportHeight;
      const areaRatio = (rect.width * rect.height) / (viewportWidth * viewportHeight);
      const dominatesViewport = heightRatio >= OVERSIZED_H1_MIN_VIEWPORT_HEIGHT_RATIO
        || areaRatio >= OVERSIZED_H1_MIN_VIEWPORT_AREA_RATIO;
      if (!dominatesViewport) return [];
      viewportDetail = `, ${Math.round(heightRatio * 100)}vh`;
    }
    return [{ id: 'oversized-h1', snippet: `${Math.round(fontSize)}px h1, ${textLen} chars${viewportDetail} "${headingText.slice(0, 60)}"` }];
  }
  return [];
}

function checkElementOversizedH1(el, style, tag, window) {
  if (tag !== 'h1') return [];
  const fontSize = resolveFontSizePx(el, window);
  const headingText = (el.textContent || '').trim().replace(/\s+/g, ' ');
  return checkOversizedH1({ tag, fontSize, headingText });
}

function checkElementOversizedH1DOM(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'h1') return [];
  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 0;
  const headingText = (el.textContent || '').trim().replace(/\s+/g, ' ');
  const rect = el.getBoundingClientRect();
  const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
  const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
  return checkOversizedH1({ tag, fontSize, headingText, rect, viewportWidth, viewportHeight });
}

// ─── GPT tell: hairline border + wide diffuse shadow (gated --gpt) ────────────
const CSS_COLOR_TOKEN_RE = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-fA-F]{3,8}\b|\b(?:black|white|transparent|currentcolor)\b/gi;

function shadowLayerAlpha(layer) {
  CSS_COLOR_TOKEN_RE.lastIndex = 0;
  const match = CSS_COLOR_TOKEN_RE.exec(layer);
  if (!match) return 1;
  if (match[0].toLowerCase() === 'transparent') return 0;
  const parsed = parseAnyColor(match[0]);
  return parsed ? (parsed.a ?? 1) : 1;
}

function shadowMaxBlurPx(boxShadow, { minAlpha = 0 } = {}) {
  if (!boxShadow || boxShadow === 'none') return 0;
  let maxBlur = 0;
  // Split into layers on commas not inside parentheses (rgba(...) etc.).
  for (const layer of boxShadow.split(/,(?![^()]*\))/)) {
    if (shadowLayerAlpha(layer) < minAlpha) continue;
    // Strip colors and keywords (rgba()/hsl()/hex/named/inset/px), leaving the
    // ordered length tokens: offsetX offsetY blur [spread]. Static jsdom keeps
    // unitless zeros ("0 0 24px"); browsers normalize to px ("0px 0px 24px") —
    // both reduce to the same numbers here.
    const cleaned = layer.replace(CSS_COLOR_TOKEN_RE, ' ').replace(/\b[a-z]+\b/gi, ' ');
    const nums = [...cleaned.matchAll(/-?\d*\.?\d+/g)].map(m => parseFloat(m[0]));
    if (nums.length >= 3) maxBlur = Math.max(maxBlur, nums[2]);
  }
  return maxBlur;
}

function cssColorAlpha(value) {
  if (cssColorIsTransparent(value)) return 0;
  const parsed = parseAnyColor(value);
  return parsed ? (parsed.a ?? 1) : 1;
}

function checkGptThinBorderWideShadow({ borderWidths, borderColors, boxShadow }) {
  const visibleThinBorders = borderWidths
    .map((width, index) => ({ width, alpha: cssColorAlpha(borderColors?.[index] || '') }))
    .filter(({ width, alpha }) => width > 0 && width <= 1.5 && alpha >= 0.28);
  const maxBorder = Math.max(0, ...visibleThinBorders.map(({ width }) => width));
  const blur = shadowMaxBlurPx(boxShadow, { minAlpha: 0.12 });
  if (visibleThinBorders.length >= 2 && blur >= 16) {
    return [{ id: 'gpt-thin-border-wide-shadow', snippet: `${maxBorder}px border + ${Math.round(blur)}px shadow blur` }];
  }
  return [];
}

function borderWidthsFromStyle(style) {
  return [
    parseFloat(style.borderTopWidth) || 0,
    parseFloat(style.borderRightWidth) || 0,
    parseFloat(style.borderBottomWidth) || 0,
    parseFloat(style.borderLeftWidth) || 0,
  ];
}

function borderColorsFromStyle(style) {
  return [
    style.borderTopColor || '',
    style.borderRightColor || '',
    style.borderBottomColor || '',
    style.borderLeftColor || '',
  ];
}

function checkElementGptBorderShadow(el, style) {
  return checkGptThinBorderWideShadow({ borderWidths: borderWidthsFromStyle(style), borderColors: borderColorsFromStyle(style), boxShadow: style.boxShadow || '' });
}

function checkElementGptBorderShadowDOM(el) {
  const style = getComputedStyle(el);
  return checkGptThinBorderWideShadow({ borderWidths: borderWidthsFromStyle(style), borderColors: borderColorsFromStyle(style), boxShadow: style.boxShadow || '' });
}

// ─── Clipped overflow container ───────────────────────────────────────────────
// A clipping container (overflow hidden/clip, not a scroll region) wrapping an
// absolutely/fixed-positioned descendant clips popovers/menus that must escape.
function classSelector(el) {
  const cls = (el.getAttribute ? el.getAttribute('class') : el.className) || '';
  const tokens = String(cls).trim().split(/\s+/).filter(Boolean);
  const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
  return tokens.length ? `${tag}.${tokens.join('.')}` : tag;
}

function positionedChildIsDecorative(child) {
  if (!child || typeof child.getAttribute !== 'function') return false;
  if (child.closest?.('[aria-hidden="true"]')) return true;
  const role = (child.getAttribute('role') || '').toLowerCase();
  if (role === 'none' || role === 'presentation') return true;
  const tag = child.tagName ? child.tagName.toLowerCase() : '';
  if (['img', 'svg', 'canvas', 'video'].includes(tag)) return true;
  const ident = `${child.getAttribute('class') || ''} ${child.getAttribute('id') || ''}`;
  if (
    /\b(art|bg|background|badge|blob|crop|decor|dot|glow|grain|image|mask|ornament|overlay|photo|scrim|shadow|shine|texture)\b/i.test(ident) &&
    !positionedChildHasSubstantiveContent(child)
  ) {
    return true;
  }
  return false;
}

const POSITIONED_CHILD_INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'summary',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="dialog"]',
  '[role="link"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tooltip"]',
].join(',');

function positionedChildHasSubstantiveContent(child) {
  const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length > 0) return true;
  if (typeof child.matches === 'function') {
    try {
      if (child.matches(POSITIONED_CHILD_INTERACTIVE_SELECTOR)) return true;
    } catch {}
  }
  if (typeof child.querySelector === 'function') {
    try {
      if (child.querySelector(POSITIONED_CHILD_INTERACTIVE_SELECTOR)) return true;
    } catch {}
  }
  return false;
}

function clippingContainerIsIntentionalViewport(el) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  const roleDescription = (el.getAttribute('aria-roledescription') || '').toLowerCase();
  if (/\b(carousel|slider)\b/.test(roleDescription)) return true;
  const ident = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`.toLowerCase();
  return /\b(carousel|comparison|compare|fisheye|marquee|preview|scroller|slider|slideshow|split|viewport)\b/.test(ident) ||
    /\b(demo-area|demo-stage|demo-viewport)\b/.test(ident);
}

function elementRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  try {
    const rect = el.getBoundingClientRect();
    if (!rect) return null;
    const values = [rect.top, rect.right, rect.bottom, rect.left, rect.width, rect.height];
    if (!values.every(Number.isFinite)) return null;
    if (rect.width <= 0 && rect.height <= 0) return null;
    return rect;
  } catch {
    return null;
  }
}

function positionedStyleImpliesEscape(style) {
  const values = [
    style.top,
    style.right,
    style.bottom,
    style.left,
    style.inset,
    style.insetBlock,
    style.insetInline,
    style.insetBlockStart,
    style.insetBlockEnd,
    style.insetInlineStart,
    style.insetInlineEnd,
  ].filter(Boolean).map(value => String(value).trim().toLowerCase());
  for (const value of values) {
    if (/(^|[\s(])-+(?:\d|\.)/.test(value)) return true;
    if (/(^|[\s(])100(?:\.0+)?%/.test(value)) return true;
  }
  return false;
}

function positionedChildEscapesClip(el, child, clipX, clipY) {
  const parentRect = elementRect(el);
  const childRect = elementRect(child);
  if (!parentRect || !childRect) return null;
  const threshold = 2;
  return Boolean(
    (clipX && (childRect.left < parentRect.left - threshold || childRect.right > parentRect.right + threshold)) ||
    (clipY && (childRect.top < parentRect.top - threshold || childRect.bottom > parentRect.bottom + threshold))
  );
}

function checkClippedOverflow(el, style, getStyle) {
  const clips = (v) => v === 'hidden' || v === 'clip';
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const ox = style.overflowX || '', oy = style.overflowY || '', ov = style.overflow || '';
  const clipX = clips(ox) || clips(ov);
  const clipY = clips(oy) || clips(ov);
  const anyClip = clipX || clipY;
  const anyScroll = scrolls(ox) || scrolls(oy) || scrolls(ov);
  if (!anyClip || anyScroll) return [];
  if (clippingContainerIsIntentionalViewport(el)) return [];
  if (!el.querySelectorAll) return [];
  for (const child of el.querySelectorAll('*')) {
    const childStyle = getStyle(child);
    const pos = childStyle.position || '';
    if (pos === 'absolute' || pos === 'fixed') {
      if (positionedChildIsDecorative(child)) continue;
      const escapes = positionedChildEscapesClip(el, child, clipX, clipY);
      if (escapes === false) continue;
      if (escapes === null && !positionedStyleImpliesEscape(childStyle)) continue;
      return [{ id: 'clipped-overflow-container', snippet: `${classSelector(el)} clips a positioned child` }];
    }
  }
  return [];
}

function checkElementClippedOverflow(el, style, tag, window) {
  return checkClippedOverflow(el, style, (n) => window.getComputedStyle(n));
}

function checkElementClippedOverflowDOM(el) {
  const style = getComputedStyle(el);
  return checkClippedOverflow(el, style, (n) => getComputedStyle(n));
}

// ─── Text overflow (browser-only: needs scrollWidth/clientWidth) ──────────────
const TEXT_OVERFLOW_SKIP_TAGS = new Set(['pre', 'code', 'textarea', 'svg', 'canvas', 'select', 'option', 'marquee']);

function metricLengthPx(value, fontSizePx = 16) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  return resolveLengthPx(value, fontSizePx);
}

function firstMetricLengthPx(fontSizePx, ...values) {
  for (const value of values) {
    const parsed = metricLengthPx(value, fontSizePx);
    if (parsed !== null) return parsed;
  }
  return null;
}

function expandBoxShorthand(parts) {
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

function clippedByInset(clipPath) {
  const match = String(clipPath || '').trim().toLowerCase().match(/^inset\s*\(([^)]*)\)$/);
  if (!match) return false;
  const beforeRound = match[1].split(/\s+round\s+/)[0].trim();
  if (!beforeRound) return false;
  const values = expandBoxShorthand(beforeRound.split(/\s+/).slice(0, 4));
  const percents = values.map(value => String(value).trim().match(/^(-?\d+(?:\.\d+)?)%$/));
  if (percents.some(match => !match)) return false;
  const [top, right, bottom, left] = percents.map(match => parseFloat(match[1]));
  return top + bottom >= 100 || left + right >= 100;
}

function clippedByRect(clip) {
  const match = String(clip || '').trim().toLowerCase().match(/^rect\s*\(([^)]*)\)$/);
  if (!match) return false;
  const values = match[1].split(/[,\s]+/).map(value => value.trim()).filter(Boolean);
  if (values.length !== 4) return false;
  const [top, right, bottom, left] = values.map(value => metricLengthPx(value, 16));
  if ([top, right, bottom, left].some(value => value === null)) return false;
  return bottom <= top || right <= left;
}

function isScreenReaderOnlyTextStyle(style, metrics = {}) {
  if (!style) return false;
  const overflowValues = [style.overflow, style.overflowX, style.overflowY]
    .map(value => String(value || '').toLowerCase());
  const clipsOverflow = overflowValues.some(value => value === 'hidden' || value === 'clip');

  const fontSize = metricLengthPx(style.fontSize, 16) || 16;
  const width = firstMetricLengthPx(fontSize, metrics.width, metrics.clientWidth, style.width, style.inlineSize);
  const height = firstMetricLengthPx(fontSize, metrics.height, metrics.clientHeight, style.height, style.blockSize);
  const isTiny = width !== null && height !== null && width <= 2 && height <= 2;
  const isAbsolutelyHidden = String(style.position || '').toLowerCase() === 'absolute' && isTiny && clipsOverflow;

  const clipPath = String(style.clipPath || style.webkitClipPath || '').trim();
  const clip = String(style.clip || '').trim();
  return isAbsolutelyHidden || clippedByInset(clipPath) || clippedByRect(clip);
}

function isRenderedForBrowserRule(el) {
  for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
    if (cur.getAttribute?.('aria-hidden') === 'true') return false;
    const style = getComputedStyle(cur);
    const visibility = String(style.visibility || '').toLowerCase();
    if (style.display === 'none' || visibility === 'hidden' || visibility === 'collapse') return false;
    if ((parseFloat(style.opacity) || 0) <= 0.01) return false;
    if (String(style.contentVisibility || '').toLowerCase() === 'hidden') return false;
  }
  return true;
}

function checkElementTextOverflowDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (TEXT_OVERFLOW_SKIP_TAGS.has(tag)) return [];
  if (!isRenderedForBrowserRule(el)) return [];
  // Only the element that actually owns overflowing text — not its ancestors,
  // which inherit a wider scrollWidth from the spilling descendant.
  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
  if (!hasDirectText) return [];
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  if (isScreenReaderOnlyTextStyle(style, {
    width: rect?.width,
    height: rect?.height,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
  })) return [];
  const isScrollRegion = (s) => /(auto|scroll)/.test(s.overflowX || '') || /(auto|scroll)/.test(s.overflow || '');
  if (isScrollRegion(style)) return [];
  // A scrollable ancestor means this overflow is intentional and scrollable.
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (isScrollRegion(getComputedStyle(p))) return [];
  }
  const delta = el.scrollWidth - el.clientWidth;
  if (el.clientWidth > 0 && delta >= 16) {
    return [{ id: 'text-overflow', snippet: `${classSelector(el)} overflows its box by ${Math.round(delta)}px` }];
  }
  return [];
}

// --- cli/engine/browser/injected/index.mjs ---
const IS_BROWSER = typeof window !== 'undefined';

// ─── Section 7: Browser UI (IS_BROWSER only) ────────────────────────────────

if (IS_BROWSER) {
  // Detect extension mode via the script tag's data attribute or the document element fallback.
  // currentScript is reliable for synchronously-executing scripts (which our IIFE is).
  const _myScript = document.currentScript;
  const EXTENSION_MODE = (_myScript && _myScript.dataset.auditExtension === 'true')
    || document.documentElement.dataset.auditExtension === 'true';

  // Kinpaku gold — pinned to the site's brand token (see
  // site/styles/kinpaku-tokens.css --ks-kinpaku). Keep this in sync with
  // the picker's C.brand in skill/scripts/live-browser.js and the kit's
  // picker section in site/styles/kinpaku-kit.css.
  //
  // One color across both light and dark host pages. The outline is a
  // 2px gesture pointing at an element + a labeled tag — it's a marker,
  // not body text, so it doesn't need WCAG AA against the page. The
  // label text inside the gold tag is dark (LABEL_INK) which has ~16:1
  // against the leaf gold, so reading the rule name is solid in both
  // modes. Hover deepens the gold (preserves chroma — never drops it,
  // dropping chroma washes the gold into a sand/olive tone).
  const BRAND_COLOR = 'oklch(84% 0.19 80.46)';
  const BRAND_COLOR_HOVER = 'oklch(74% 0.18 80)';
  const LABEL_INK = 'oklch(4% 0.004 95)';
  const LABEL_BG = BRAND_COLOR;
  const OUTLINE_COLOR = BRAND_COLOR;

  // Inject hover styles via CSS (more reliable than JS event listeners)
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes audit-reveal {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .audit-overlay:not(.audit-banner) {
      pointer-events: none;
      outline: 2px solid ${OUTLINE_COLOR};
      border-radius: 4px;
      transition: outline-color 0.15s ease, opacity 0.2s ease, filter 0.2s ease;
      animation: audit-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
      animation-play-state: paused;
      border-top-left-radius: 0;
    }
    .audit-overlay.audit-visible {
      animation-play-state: running;
    }
    .audit-overlay.audit-hover {
      outline-color: ${BRAND_COLOR_HOVER};
      z-index: 100001 !important;
    }
    .audit-label button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      min-height: 24px;
      border-radius: 4px;
      transition: background-color 0.15s ease, transform 0.15s ease;
    }
    .audit-label button:active {
      transform: scale(0.96);
    }
    .audit-label button:focus-visible {
      outline: 2px solid ${LABEL_INK};
      outline-offset: -2px;
    }
    @media (hover: hover) {
      .audit-label button:hover {
        background: rgba(0, 0, 0, 0.12) !important;
      }
    }
    .audit-overlay.audit-hover .audit-label {
      background: ${BRAND_COLOR_HOVER};
    }
    .audit-overlay .audit-label {
      box-sizing: border-box;
      width: max-content;
      max-width: min(560px, calc(100vw - 16px));
      white-space: normal !important;
      overflow-wrap: anywhere;
      text-wrap: pretty;
      line-height: 1.4 !important;
    }
    .audit-overlay.audit-spotlight {
      z-index: 100002 !important;
    }
    .audit-overlay.audit-spotlight-dimmed {
      opacity: 0.15 !important;
      filter: blur(3px);
    }
    .audit-spotlight-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      backdrop-filter: blur(3px) brightness(0.6);
      -webkit-backdrop-filter: blur(3px) brightness(0.6);
      pointer-events: none;
      z-index: 99998;
      opacity: 0;
      transition: opacity 0.2s ease;
      outline: none !important;
      animation: none !important;
    }
    .audit-spotlight-backdrop.audit-visible {
      opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
      .audit-overlay:not(.audit-banner) {
        animation-duration: 0.2s !important;
        animation-delay: 0s !important;
        animation-timing-function: linear !important;
      }
      .audit-overlay.audit-banner {
        transform: none !important;
        transition: none !important;
        animation: audit-reveal 0.2s linear both;
      }
    }
    @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
      .audit-spotlight-backdrop {
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
        background: rgba(0, 0, 0, 0.6);
      }
    }
    .audit-hidden .audit-overlay${EXTENSION_MODE ? '' : ':not(.audit-banner)'} {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(styleEl);

  // Spotlight backdrop element (created lazily on first use)
  let spotlightBackdrop = null;
  let spotlightTarget = null;

  function getSpotlightBackdrop() {
    if (!spotlightBackdrop) {
      spotlightBackdrop = document.createElement('div');
      spotlightBackdrop.className = 'audit-spotlight-backdrop';
      document.body.appendChild(spotlightBackdrop);
    }
    return spotlightBackdrop;
  }

  function updateSpotlightClipPath() {
    if (!spotlightBackdrop || !spotlightTarget) return;
    const r = spotlightTarget.getBoundingClientRect();
    // Match the overlay's outer edge: element rect + 4px (2px overlay offset + 2px outline width)
    const inset = 4;
    const radius = 6; // outline border-radius (4) + outline width (2)
    const x1 = r.left - inset;
    const y1 = r.top - inset;
    const x2 = r.right + inset;
    const y2 = r.bottom + inset;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Outer rect + rounded inner rect (evenodd creates a hole)
    const path = `M0 0H${vw}V${vh}H0Z M${x1 + radius} ${y1}H${x2 - radius}A${radius} ${radius} 0 0 1 ${x2} ${y1 + radius}V${y2 - radius}A${radius} ${radius} 0 0 1 ${x2 - radius} ${y2}H${x1 + radius}A${radius} ${radius} 0 0 1 ${x1} ${y2 - radius}V${y1 + radius}A${radius} ${radius} 0 0 1 ${x1 + radius} ${y1}Z`;
    spotlightBackdrop.style.clipPath = `path(evenodd, "${path}")`;
  }

  function showSpotlight(target) {
    if (!target || !target.getBoundingClientRect) return;
    // Respect the spotlightBlur setting: if disabled, don't show the backdrop
    if (window.__AUDIT_CONFIG__?.spotlightBlur === false) {
      spotlightTarget = target;
      return;
    }
    spotlightTarget = target;
    const bd = getSpotlightBackdrop();
    updateSpotlightClipPath();
    bd.classList.add('audit-visible');
  }

  function hideSpotlight() {
    spotlightTarget = null;
    if (spotlightBackdrop) spotlightBackdrop.classList.remove('audit-visible');
  }

  function isInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  }

  // Reposition spotlight on scroll/resize
  window.addEventListener('scroll', () => {
    if (spotlightTarget) updateSpotlightClipPath();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (spotlightTarget) updateSpotlightClipPath();
  });

  const overlays = [];
  const TYPE_LABELS = {};
  const RULE_CATEGORY = {};
  for (const ap of ANTIPATTERNS) {
    TYPE_LABELS[ap.id] = ap.name.toLowerCase();
    RULE_CATEGORY[ap.id] = ap.category || 'quality';
  }

  function isInFixedContext(el) {
    let p = el;
    while (p && p !== document.body) {
      if (getComputedStyle(p).position === 'fixed') return true;
      p = p.parentElement;
    }
    return false;
  }

  function positionOverlay(overlay) {
    const el = overlay._targetEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (overlay._isFixed) {
      // Viewport-relative coords for fixed targets
      overlay.style.top = `${rect.top - 2}px`;
      overlay.style.left = `${rect.left - 2}px`;
    } else {
      // Document-relative coords for normal targets
      const bodyBox = getComputedStyle(document.body).position === 'static' ? null : document.body.getBoundingClientRect();
      overlay.style.top = `${bodyBox ? rect.top - bodyBox.top - document.body.clientTop - 2 : rect.top + scrollY - 2}px`;
      overlay.style.left = `${bodyBox ? rect.left - bodyBox.left - document.body.clientLeft - 2 : rect.left + scrollX - 2}px`;
    }
    overlay.style.width = `${rect.width + 4}px`;
    overlay.style.height = `${rect.height + 4}px`;
    const lbl = overlay.firstElementChild;
    if (lbl && lbl.classList.contains('audit-label')) {
      const flip = rect.top < 26;
      const below = rect.bottom + 26 < window.innerHeight;
      lbl.style.top = flip ? (below ? '100%' : Math.max(0, 6 - rect.top) + 'px') : 'auto';
      lbl.style.bottom = flip ? 'auto' : '100%';
      lbl.style.borderRadius = flip ? (below ? '0 0 4px 4px' : '4px') : '4px 4px 0 0';
    }
  }

  function repositionOverlays() {
    for (const o of overlays) {
      if (!o._targetEl || o.classList.contains('audit-banner')) continue;
      // Skip overlays whose target is currently hidden (display: none on the overlay)
      if (o.style.display === 'none') continue;
      positionOverlay(o);
    }
  }

  let resizeRAF;
  const onResize = () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(repositionOverlays);
  };
  window.addEventListener('resize', onResize);
  // Reposition on scroll too -- catches sticky/parallax shifts
  window.addEventListener('scroll', onResize, { passive: true });
  // Reposition when body resizes (lazy-loaded images, dynamic content, fonts loading)
  if (typeof ResizeObserver !== 'undefined') {
    const bodyResizeObserver = new ResizeObserver(onResize);
    bodyResizeObserver.observe(document.body);
  }

  // Track target element visibility via IntersectionObserver.
  // Uses a huge rootMargin so all *rendered* elements count as intersecting,
  // while display:none / closed <details> / hidden modals etc. do not.
  // This is event-driven -- no polling needed.
  let overlayIndex = 0;
  const visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const overlay = entry.target._auditOverlay;
      if (!overlay) continue;
      if (entry.isIntersecting) {
        overlay.style.display = '';
        positionOverlay(overlay);
        if (!overlay._revealed) {
          overlay._revealed = true;
          if (firstScanDone) {
            // Subsequent reveals (re-scans, scroll-into-view): instant, no animation
            overlay.style.animation = 'none';
          } else {
            // Initial scan: staggered cascade reveal
            overlay.style.animationDelay = `${Math.min((overlay._staggerIndex || 0) * 60, 600)}ms`;
          }
          requestAnimationFrame(() => {
            overlay.classList.add('audit-visible');
            if (overlay._checkLabel) overlay._checkLabel();
          });
        }
      } else {
        overlay.style.display = 'none';
      }
    }
  }, { rootMargin: '99999px' });

  function detachOverlay(overlay) {
    if (!overlay) return;
    if (typeof overlay._cleanup === 'function') {
      try { overlay._cleanup(); } catch { /* best effort overlay teardown */ }
    }
    if (overlay._targetEl && overlay._targetEl._auditOverlay === overlay) {
      visibilityObserver.unobserve(overlay._targetEl);
      delete overlay._targetEl._auditOverlay;
    }
    const idx = overlays.indexOf(overlay);
    if (idx >= 0) overlays.splice(idx, 1);
    overlay.remove();
  }

  // Reposition overlays after CSS transitions end (e.g. reveal animations).
  // Listens at document level so it catches transitions on ancestor elements
  // (the transform may be on a parent, not the flagged element itself).
  document.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'transform') return;
    for (const o of overlays) {
      if (!o._targetEl || o.classList.contains('audit-banner') || o.style.display === 'none') continue;
      if (e.target === o._targetEl || e.target.contains(o._targetEl)) {
        positionOverlay(o);
      }
    }
  });

  const highlight = function(el, findings) {
    if (el._auditOverlay) detachOverlay(el._auditOverlay);
    const hasSlop = findings.some(f => RULE_CATEGORY[f.type || f.id] === 'slop');

    const fixed = isInFixedContext(el);
    const rect = el.getBoundingClientRect();
    const outline = document.createElement('div');
    outline.className = 'audit-overlay';
    outline._targetEl = el;
    outline._isFixed = fixed;
    Object.assign(outline.style, {
      position: fixed ? 'fixed' : 'absolute',
      top: fixed ? `${rect.top - 2}px` : `${rect.top + scrollY - 2}px`,
      left: fixed ? `${rect.left - 2}px` : `${rect.left + scrollX - 2}px`,
      width: `${rect.width + 4}px`, height: `${rect.height + 4}px`,
      zIndex: '99999', boxSizing: 'border-box',
    });

    // Build per-finding label entries: ✦ prefix for slop
    const entries = findings.map(f => {
      const name = TYPE_LABELS[f.type || f.id] || f.type || f.id;
      const prefix = RULE_CATEGORY[f.type || f.id] === 'slop' ? '\u2726 ' : '';
      return { name: prefix + name, detail: f.detail || f.snippet };
    });
    const allText = entries.map(e => e.name).join(', ');

    const label = document.createElement('div');
    label.className = 'audit-label';
    Object.assign(label.style, {
      position: 'absolute', bottom: '100%', left: '-2px',
      display: 'flex', alignItems: 'center',
      whiteSpace: 'nowrap',
      fontSize: '11px', fontWeight: '600', letterSpacing: '0.02em',
      color: LABEL_INK, lineHeight: '14px',
      background: LABEL_BG,
      fontFamily: 'system-ui, sans-serif',
      borderRadius: '4px 4px 0 0',
    });

    const textSpan = document.createElement('span');
    textSpan.style.padding = '3px 8px';
    textSpan.textContent = allText;
    label.appendChild(textSpan);

    // State for cycling mode
    let cycleMode = false;
    let cycleIndex = 0;
    let isHovered = false;
    let prevBtn, nextBtn;

    function updateCycleText() {
      const e = entries[cycleIndex];
      textSpan.textContent = isHovered ? e.detail : e.name;
    }

    function enableCycleMode() {
      if (cycleMode || entries.length < 2) return;
      cycleMode = true;

      const btnStyle = {
        background: 'none', border: 'none', color: LABEL_INK,
        fontSize: '11px', cursor: 'pointer', padding: '3px 4px',
        fontFamily: 'system-ui, sans-serif', lineHeight: '14px',
        pointerEvents: 'auto',
      };

      const navGroup = document.createElement('span');
      Object.assign(navGroup.style, {
        display: 'inline-flex', alignItems: 'center', flexShrink: '0',
      });

      prevBtn = document.createElement('button');
      prevBtn.textContent = '\u2039';
      Object.assign(prevBtn.style, btnStyle);
      prevBtn.type = 'button';
      prevBtn.setAttribute('aria-label', 'Previous finding');
      prevBtn.style.paddingLeft = '6px';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleIndex = (cycleIndex - 1 + entries.length) % entries.length;
        updateCycleText();
      });

      nextBtn = document.createElement('button');
      nextBtn.textContent = '\u203A';
      Object.assign(nextBtn.style, btnStyle);
      nextBtn.type = 'button';
      nextBtn.setAttribute('aria-label', 'Next finding');
      nextBtn.style.paddingRight = '2px';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleIndex = (cycleIndex + 1) % entries.length;
        updateCycleText();
      });

      navGroup.appendChild(prevBtn);
      navGroup.appendChild(nextBtn);
      label.insertBefore(navGroup, textSpan);
      textSpan.style.padding = '3px 8px 3px 4px';
      updateCycleText();
    }

    outline.appendChild(label);

    // Start hidden; the IntersectionObserver will show it once the target is rendered
    outline.style.display = 'none';
    outline._staggerIndex = overlayIndex++;
    el._auditOverlay = outline;
    visibilityObserver.observe(el);

    // After first paint, check label width vs outline
    outline._checkLabel = () => {
      if (entries.length > 1 && label.offsetWidth > outline.offsetWidth) {
        enableCycleMode();
      }
    };

    // Hover: show detail text, darken
    const onMouseEnter = () => {
      isHovered = true;
      outline.classList.add('audit-hover');
      outline.style.outlineColor = BRAND_COLOR_HOVER;
      label.style.background = BRAND_COLOR_HOVER;
      if (cycleMode) {
        updateCycleText();
      } else {
        textSpan.textContent = entries.map(e => e.detail).join(' | ');
      }
    };
    const onMouseLeave = () => {
      isHovered = false;
      outline.classList.remove('audit-hover');
      outline.style.outlineColor = '';
      label.style.background = LABEL_BG;
      if (cycleMode) {
        updateCycleText();
      } else {
        textSpan.textContent = allText;
      }
    };
    el.addEventListener('mouseenter', onMouseEnter);
    el.addEventListener('mouseleave', onMouseLeave);
    outline._cleanup = () => {
      el.removeEventListener('mouseenter', onMouseEnter);
      el.removeEventListener('mouseleave', onMouseLeave);
    };

    document.body.appendChild(outline);
    overlays.push(outline);
  };

  const showPageBanner = function(findings) {
    if (!findings.length) return;
    const banner = document.createElement('div');
    banner.className = 'audit-overlay audit-banner';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '100000',
      background: LABEL_BG, color: LABEL_INK,
      fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      display: 'flex', alignItems: 'center', pointerEvents: 'auto',
      height: '36px', overflow: 'hidden', maxWidth: '100vw',
      transform: 'translateY(-100%)',
      transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      banner.style.transform = 'translateY(0)';
    }));

    // Scrollable findings area
    const scrollArea = document.createElement('div');
    Object.assign(scrollArea.style, {
      flex: '1', minWidth: '0', overflowX: 'auto', overflowY: 'hidden',
      display: 'flex', gap: '8px', alignItems: 'center',
      padding: '0 12px', scrollSnapType: 'x mandatory',
      scrollbarWidth: 'none',
    });
    for (const f of findings) {
      const prefix = RULE_CATEGORY[f.type] === 'slop' ? '\u2726 ' : '';
      const tag = document.createElement('span');
      tag.textContent = `${prefix}${TYPE_LABELS[f.type] || f.type}: ${f.detail}`;
      Object.assign(tag.style, {
        background: 'rgba(255,255,255,0.15)', padding: '2px 8px',
        borderRadius: '3px', fontSize: '12px', fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap', flexShrink: '0', scrollSnapAlign: 'start',
      });
      scrollArea.appendChild(tag);
    }
    banner.appendChild(scrollArea);

    // Controls area (only in standalone mode, not extension)
    if (!EXTENSION_MODE) {
      const controls = document.createElement('div');
      Object.assign(controls.style, {
        display: 'flex', alignItems: 'center', gap: '2px',
        padding: '0 8px', flexShrink: '0',
      });

      // Toggle visibility button
      const toggle = document.createElement('button');
      toggle.textContent = '\u25C9'; // circle with dot (visible state)
      toggle.title = 'Toggle overlay visibility';
      Object.assign(toggle.style, {
        background: 'none', border: 'none',
        color: 'white', fontSize: '16px', cursor: 'pointer', padding: '0 4px',
        opacity: '0.85', transition: 'opacity 0.15s',
      });
      let overlaysVisible = true;
      toggle.addEventListener('click', () => {
        overlaysVisible = !overlaysVisible;
        document.body.classList.toggle('audit-hidden', !overlaysVisible);
        toggle.textContent = overlaysVisible ? '\u25C9' : '\u25CB'; // filled vs empty circle
        toggle.style.opacity = overlaysVisible ? '0.85' : '0.5';
      });
      controls.appendChild(toggle);

      // Close button
      const close = document.createElement('button');
      close.textContent = '\u00d7';
      close.title = 'Dismiss banner';
      Object.assign(close.style, {
        background: 'none', border: 'none',
        color: 'white', fontSize: '18px', cursor: 'pointer', padding: '0 4px',
      });
      close.addEventListener('click', () => banner.remove());
      controls.appendChild(close);

      banner.appendChild(controls);
    }
    document.body.appendChild(banner);
    overlays.push(banner);
  };

  // Heuristic for skipping CSS-in-JS hashed class names like "css-1a2b3c" or "_2x4hG_".
  // These change between builds and produce brittle, ugly selectors.
  function isLikelyHashedClass(c) {
    if (!c) return true;
    if (/^(css|sc|emotion|jsx|module)-[\w-]{4,}$/i.test(c)) return true;
    if (/^_[\w-]{5,}$/.test(c)) return true;
    if (/^[a-z0-9]{6,}$/i.test(c) && /\d/.test(c)) return true;
    return false;
  }

  function buildSelectorSegment(el) {
    const tag = el.tagName.toLowerCase();
    let sel = tag;

    if (el.classList && el.classList.length > 0) {
      const classes = [...el.classList]
        .filter(c => !c.startsWith('audit-') && !isLikelyHashedClass(c))
        .slice(0, 2);
      if (classes.length > 0) {
        sel += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }

    // Disambiguate among siblings only if the parent has multiple matches
    const parent = el.parentElement;
    if (parent) {
      try {
        const matching = parent.querySelectorAll(':scope > ' + sel);
        if (matching.length > 1) {
          const sameType = [...parent.children].filter(c => c.tagName === el.tagName);
          const idx = sameType.indexOf(el) + 1;
          sel += `:nth-of-type(${idx})`;
        }
      } catch {
        const idx = [...parent.children].indexOf(el) + 1;
        sel = `${tag}:nth-child(${idx})`;
      }
    }
    return sel;
  }

  function generateSelector(el) {
    if (el === document.body) return 'body';
    if (el === document.documentElement) return 'html';
    if (el.id) return '#' + CSS.escape(el.id);

    const parts = [];
    let current = el;
    let depth = 0;
    const MAX_DEPTH = 10;

    while (current && current !== document.body && current !== document.documentElement && depth < MAX_DEPTH) {
      parts.unshift(buildSelectorSegment(current));

      // Anchor on an ancestor's ID and stop walking up
      if (current.id) {
        parts[0] = '#' + CSS.escape(current.id);
        break;
      }

      // Stop as soon as the partial selector uniquely identifies the target
      const trySelector = parts.join(' > ');
      try {
        const matches = document.querySelectorAll(trySelector);
        if (matches.length === 1 && matches[0] === el) {
          return trySelector;
        }
      } catch { /* invalid selector — keep walking */ }

      current = current.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  function getDirectText(el) {
    return [...el.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent || '')
      .join('');
  }

  function getDirectTextRect(el) {
    const rects = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !(node.textContent || '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width >= 1 && rect.height >= 1) rects.push(rect);
      }
      range.detach?.();
    }
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      x: left,
      y: top,
    };
  }

  function collectVisualContrastReasons(el, style) {
    const reasons = new Set();
    const bgClip = style.webkitBackgroundClip || style.backgroundClip || '';
    const ownBgImage = style.backgroundImage || '';
    if (bgClip === 'text' && ownBgImage && ownBgImage !== 'none') {
      reasons.add('background-clip text');
    }
    if (style.textShadow && style.textShadow !== 'none') reasons.add('text shadow');

    let current = el;
    while (current && current.nodeType === 1) {
      const tag = current.tagName?.toLowerCase();
      const currentStyle = getComputedStyle(current);
      const bgImage = currentStyle.backgroundImage || '';
      const isDocumentSurface = tag === 'body' || tag === 'html';

      if (!isDocumentSurface && bgImage && bgImage !== 'none') {
        if (/url\s*\(/i.test(bgImage)) reasons.add('image background');
        if (/gradient/i.test(bgImage)) reasons.add('gradient background');
      }
      if (parseFloat(currentStyle.opacity) < 0.99) reasons.add('opacity stack');
      if (currentStyle.mixBlendMode && currentStyle.mixBlendMode !== 'normal') reasons.add('blend mode');
      if (currentStyle.filter && currentStyle.filter !== 'none') reasons.add('filter');
      if (currentStyle.backdropFilter && currentStyle.backdropFilter !== 'none') reasons.add('backdrop filter');

      const solidBg = parseRgb(currentStyle.backgroundColor);
      if (solidBg && solidBg.a >= 0.95 && (!bgImage || bgImage === 'none')) break;
      current = current.parentElement;
    }

    const sampleRect = getDirectTextRect(el) || el.getBoundingClientRect();
    if (sampleRect && document.elementsFromPoint) {
      const points = [
        [sampleRect.left + sampleRect.width / 2, sampleRect.top + sampleRect.height / 2],
        [sampleRect.left + Math.min(sampleRect.width - 1, Math.max(1, sampleRect.width * 0.25)), sampleRect.top + sampleRect.height / 2],
        [sampleRect.left + Math.min(sampleRect.width - 1, Math.max(1, sampleRect.width * 0.75)), sampleRect.top + sampleRect.height / 2],
      ];
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        const stack = document.elementsFromPoint(x, y);
        const selfIndex = stack.findIndex(node => node === el || el.contains(node) || node.contains?.(el));
        if (selfIndex < 0) continue;
        for (const node of stack.slice(selfIndex + 1)) {
          const nodeTag = node.tagName?.toLowerCase();
          if (nodeTag === 'img' || nodeTag === 'picture' || nodeTag === 'video' || nodeTag === 'canvas' || nodeTag === 'svg') {
            reasons.add(`${nodeTag} underlay`);
            break;
          }
        }
      }
    }

    return [...reasons];
  }

  function collectVisualContrastCandidates(options = {}) {
    const maxCandidates = Number.isFinite(options.maxCandidates) ? options.maxCandidates : 12;
    const candidates = [];
    for (const el of document.querySelectorAll('*')) {
      if (candidates.length >= maxCandidates) break;
      if (el.closest('.audit-overlay, .audit-label, .audit-banner, .audit-tooltip')) continue;
      if (el.closest('[id^="audit-live-"]')) continue;
      if (el === document.body || el === document.documentElement) continue;
      if (!isRenderedForBrowserRule(el)) continue;

      const tag = el.tagName.toLowerCase();
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const directText = getDirectText(el);
      const hasDirectText = directText.trim().length > 0;
      if (!hasDirectText || isEmojiOnlyText(directText)) continue;

      const bgColor = readOwnBackgroundColor(el, style);
      const isStyledButton = (tag === 'a' || tag === 'button')
        && bgColor && bgColor.a > 0.5;
      if (SAFE_TAGS.has(tag) && !isStyledButton) continue;

      const rect = getDirectTextRect(el) || el.getBoundingClientRect();
      if (!rect || rect.width < 4 || rect.height < 4) continue;

      const reasons = collectVisualContrastReasons(el, style);
      if (reasons.length === 0) continue;

      const textColor = parseRgb(style.color);
      const fontSize = parseFloat(style.fontSize) || 16;
      const fontWeight = parseInt(style.fontWeight) || 400;
      const isLargeText = fontSize >= WCAG_LARGE_TEXT_PX || (fontSize >= WCAG_LARGE_BOLD_TEXT_PX && fontWeight >= 700);
      const threshold = isLargeText ? 3.0 : 4.5;
      const clip = {
        x: Math.max(0, Math.floor(rect.left + window.scrollX - 2)),
        y: Math.max(0, Math.floor(rect.top + window.scrollY - 2)),
        width: Math.max(1, Math.ceil(rect.width + 4)),
        height: Math.max(1, Math.ceil(rect.height + 4)),
      };

      candidates.push({
        selector: generateSelector(el),
        tagName: tag,
        text: directText.trim().replace(/\s+/g, ' ').slice(0, 80),
        threshold,
        reasons,
        clip,
        textColor,
        preferRenderedForeground: !textColor || textColor.a < 0.99 || reasons.some(reason =>
          reason === 'opacity stack' ||
          reason === 'blend mode' ||
          reason === 'filter' ||
          reason === 'backdrop filter' ||
          reason === 'background-clip text'
        ),
        backgroundClipText: reasons.includes('background-clip text'),
      });
    }
    return candidates;
  }

  const visualContrastImageCache = new Map();
  const visualContrastRasterCache = new WeakMap();

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function blendRgba(fg, bg) {
    if (!fg) return bg || null;
    if (!bg || fg.a == null || fg.a >= 0.999) {
      return { r: clampByte(fg.r), g: clampByte(fg.g), b: clampByte(fg.b), a: fg.a == null ? 1 : fg.a };
    }
    const alpha = Math.max(0, Math.min(1, fg.a));
    return {
      r: clampByte(fg.r * alpha + bg.r * (1 - alpha)),
      g: clampByte(fg.g * alpha + bg.g * (1 - alpha)),
      b: clampByte(fg.b * alpha + bg.b * (1 - alpha)),
      a: 1,
    };
  }

  function pickWorstContrastColor(textColor, colors) {
    const usable = (colors || []).filter(Boolean);
    if (!usable.length) return null;
    let worst = usable[0];
    let worstRatio = contrastRatio(textColor, worst);
    for (const color of usable.slice(1)) {
      const ratio = contrastRatio(textColor, color);
      if (ratio < worstRatio) {
        worst = color;
        worstRatio = ratio;
      }
    }
    return worst;
  }

  function firstCssUrl(value) {
    const match = String(value || '').match(/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/i);
    if (!match) return '';
    return (match[1] || match[2] || match[3] || '').trim();
  }

  function getLayerValue(value, index = 0) {
    return String(value || '').split(',')[index]?.trim() || '';
  }

  function parsePositionToken(token, container, painted) {
    if (!token || token === 'center') return (container - painted) / 2;
    if (token === 'left' || token === 'top') return 0;
    if (token === 'right' || token === 'bottom') return container - painted;
    if (/%$/.test(token)) {
      const pct = parseFloat(token) / 100;
      return (container - painted) * pct;
    }
    if (/px$/.test(token)) return parseFloat(token) || 0;
    return (container - painted) / 2;
  }

  function parsePositionPair(positionValue) {
    const tokens = String(positionValue || '50% 50%').trim().split(/\s+/).filter(Boolean);
    const first = tokens[0] || '50%';
    if (tokens.length < 2) {
      if (first === 'top' || first === 'bottom') return ['50%', first];
      return [first, '50%'];
    }
    return [first, tokens[1] || '50%'];
  }

  function resolvePaintedImageRect(containerRect, image, sizeValue, positionValue) {
    const intrinsicWidth = image.naturalWidth || image.videoWidth || image.width || 1;
    const intrinsicHeight = image.naturalHeight || image.videoHeight || image.height || 1;
    let paintedWidth = intrinsicWidth;
    let paintedHeight = intrinsicHeight;
    const size = String(sizeValue || 'auto').trim();

    if (size === 'cover' || size === 'contain') {
      const scale = size === 'cover'
        ? Math.max(containerRect.width / intrinsicWidth, containerRect.height / intrinsicHeight)
        : Math.min(containerRect.width / intrinsicWidth, containerRect.height / intrinsicHeight);
      paintedWidth = intrinsicWidth * scale;
      paintedHeight = intrinsicHeight * scale;
    } else if (size && size !== 'auto') {
      const parts = size.split(/\s+/);
      const widthToken = parts[0];
      const heightToken = parts[1] || 'auto';
      if (/%$/.test(widthToken)) paintedWidth = containerRect.width * (parseFloat(widthToken) / 100);
      else if (/px$/.test(widthToken)) paintedWidth = parseFloat(widthToken) || paintedWidth;
      if (heightToken === 'auto') paintedHeight = paintedWidth * (intrinsicHeight / intrinsicWidth);
      else if (/%$/.test(heightToken)) paintedHeight = containerRect.height * (parseFloat(heightToken) / 100);
      else if (/px$/.test(heightToken)) paintedHeight = parseFloat(heightToken) || paintedHeight;
    }

    const [xToken, yToken] = parsePositionPair(positionValue);
    const positionX = parsePositionToken(xToken, containerRect.width, paintedWidth);
    const positionY = parsePositionToken(yToken, containerRect.height, paintedHeight);
    return {
      left: containerRect.left + positionX,
      top: containerRect.top + positionY,
      width: paintedWidth,
      height: paintedHeight,
      intrinsicWidth,
      intrinsicHeight,
    };
  }

  function parseObjectPosition(positionValue) {
    return parsePositionPair(positionValue);
  }

  function resolveObjectImageRect(containerRect, image, style) {
    const intrinsicWidth = image.naturalWidth || image.videoWidth || image.width || 1;
    const intrinsicHeight = image.naturalHeight || image.videoHeight || image.height || 1;
    const fit = style.objectFit || 'fill';
    let paintedWidth = containerRect.width;
    let paintedHeight = containerRect.height;
    if (fit === 'contain' || fit === 'cover') {
      const scale = fit === 'cover'
        ? Math.max(containerRect.width / intrinsicWidth, containerRect.height / intrinsicHeight)
        : Math.min(containerRect.width / intrinsicWidth, containerRect.height / intrinsicHeight);
      paintedWidth = intrinsicWidth * scale;
      paintedHeight = intrinsicHeight * scale;
    } else if (fit === 'none') {
      paintedWidth = intrinsicWidth;
      paintedHeight = intrinsicHeight;
    } else if (fit === 'scale-down') {
      const containScale = Math.min(containerRect.width / intrinsicWidth, containerRect.height / intrinsicHeight, 1);
      paintedWidth = intrinsicWidth * containScale;
      paintedHeight = intrinsicHeight * containScale;
    }
    const [xToken, yToken] = parseObjectPosition(style.objectPosition);
    return {
      left: containerRect.left + parsePositionToken(xToken, containerRect.width, paintedWidth),
      top: containerRect.top + parsePositionToken(yToken, containerRect.height, paintedHeight),
      width: paintedWidth,
      height: paintedHeight,
      intrinsicWidth,
      intrinsicHeight,
    };
  }

  function pointToImageSource(point, paintedRect) {
    if (
      point.x < paintedRect.left ||
      point.y < paintedRect.top ||
      point.x > paintedRect.left + paintedRect.width ||
      point.y > paintedRect.top + paintedRect.height
    ) {
      return null;
    }
    return {
      x: Math.max(0, Math.min(paintedRect.intrinsicWidth - 1, ((point.x - paintedRect.left) / paintedRect.width) * paintedRect.intrinsicWidth)),
      y: Math.max(0, Math.min(paintedRect.intrinsicHeight - 1, ((point.y - paintedRect.top) / paintedRect.height) * paintedRect.intrinsicHeight)),
    };
  }

  async function loadVisualContrastImage(src) {
    if (!src) return null;
    if (visualContrastImageCache.has(src)) return visualContrastImageCache.get(src);
    const promise = new Promise(resolve => {
      const img = new Image();
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 800);
      try {
        const absolute = new URL(src, location.href);
        if (absolute.origin !== location.origin && absolute.protocol !== 'data:' && absolute.protocol !== 'blob:') {
          img.crossOrigin = 'anonymous';
        }
      } catch {
        // Let the browser resolve unusual URLs itself.
      }
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = src;
    });
    visualContrastImageCache.set(src, promise);
    return promise;
  }

  function sampleDrawablePixel(drawable, sourcePoint) {
    if (visualContrastRasterCache.has(drawable)) {
      const cached = visualContrastRasterCache.get(drawable);
      if (!cached || !cached.ctx) return { status: 'unresolved', reason: cached?.reason || 'image sample failed' };
      try {
        const x = Math.max(0, Math.min(cached.width - 1, Math.floor(sourcePoint.x * cached.scaleX)));
        const y = Math.max(0, Math.min(cached.height - 1, Math.floor(sourcePoint.y * cached.scaleY)));
        const data = cached.ctx.getImageData(x, y, 1, 1).data;
        return {
          status: 'sampled',
          color: { r: data[0], g: data[1], b: data[2], a: data[3] / 255 },
        };
      } catch (err) {
        return {
          status: 'unresolved',
          reason: /taint|cross-origin|Security/i.test(err?.message || '') ? 'tainted image' : 'image sample failed',
        };
      }
    }

    const canvas = document.createElement('canvas');
    const intrinsicWidth = drawable.naturalWidth || drawable.videoWidth || drawable.width || 1;
    const intrinsicHeight = drawable.naturalHeight || drawable.videoHeight || drawable.height || 1;
    const maxRasterSide = 640;
    const scale = Math.min(1, maxRasterSide / Math.max(intrinsicWidth, intrinsicHeight));
    canvas.width = Math.max(1, Math.round(intrinsicWidth * scale));
    canvas.height = Math.max(1, Math.round(intrinsicHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { status: 'unresolved', reason: 'canvas unavailable' };
    try {
      ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
      const cached = {
        ctx,
        width: canvas.width,
        height: canvas.height,
        scaleX: canvas.width / intrinsicWidth,
        scaleY: canvas.height / intrinsicHeight,
      };
      visualContrastRasterCache.set(drawable, cached);
      const x = Math.max(0, Math.min(cached.width - 1, Math.floor(sourcePoint.x * cached.scaleX)));
      const y = Math.max(0, Math.min(cached.height - 1, Math.floor(sourcePoint.y * cached.scaleY)));
      const data = ctx.getImageData(x, y, 1, 1).data;
      return {
        status: 'sampled',
        color: { r: data[0], g: data[1], b: data[2], a: data[3] / 255 },
      };
    } catch (err) {
      const reason = /taint|cross-origin|Security/i.test(err?.message || '') ? 'tainted image' : 'image sample failed';
      visualContrastRasterCache.set(drawable, { ctx: null, reason });
      return {
        status: 'unresolved',
        reason,
      };
    }
  }

  async function sampleCssBackground(el, style, point, textColor) {
    const rect = el.getBoundingClientRect();
    const bgImage = style.backgroundImage || '';
    if (bgImage && bgImage !== 'none') {
      if (/gradient/i.test(bgImage)) {
        const color = pickWorstContrastColor(textColor, parseGradientColors(bgImage));
        if (color) return { status: 'sampled', color, method: 'analytic-gradient' };
      }
      if (/url\s*\(/i.test(bgImage)) {
        const img = await loadVisualContrastImage(firstCssUrl(bgImage));
        if (!img) return { status: 'unresolved', reason: 'image unavailable' };
        const paintedRect = resolvePaintedImageRect(
          rect,
          img,
          getLayerValue(style.backgroundSize) || 'auto',
          getLayerValue(style.backgroundPosition) || '50% 50%',
        );
        const sourcePoint = pointToImageSource(point, paintedRect);
        if (!sourcePoint) return { status: 'unresolved', reason: 'point outside background image' };
        const sample = sampleDrawablePixel(img, sourcePoint);
        if (sample.status === 'sampled') return { ...sample, method: 'canvas-background-image' };
        return sample;
      }
    }
    const bg = parseRgb(style.backgroundColor);
    if (bg && bg.a > 0.05) return { status: 'sampled', color: bg, method: 'solid-background' };
    return { status: 'unresolved', reason: 'no readable background' };
  }

  async function sampleImageElement(img, point) {
    const rect = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    const paintedRect = resolveObjectImageRect(rect, img, style);
    const sourcePoint = pointToImageSource(point, paintedRect);
    if (!sourcePoint) return { status: 'unresolved', reason: 'point outside image' };
    const sample = sampleDrawablePixel(img, sourcePoint);
    if (sample.status === 'sampled') return { ...sample, method: 'canvas-img-underlay' };

    if (img.currentSrc || img.src) {
      const loaded = await loadVisualContrastImage(img.currentSrc || img.src);
      if (loaded) {
        const loadedRect = { ...paintedRect, intrinsicWidth: loaded.naturalWidth || loaded.width || paintedRect.intrinsicWidth, intrinsicHeight: loaded.naturalHeight || loaded.height || paintedRect.intrinsicHeight };
        const loadedPoint = pointToImageSource(point, loadedRect);
        if (loadedPoint) {
          const loadedSample = sampleDrawablePixel(loaded, loadedPoint);
          if (loadedSample.status === 'sampled') return { ...loadedSample, method: 'canvas-img-underlay' };
        }
      }
    }
    return sample;
  }

  function textSamplePoints(rect) {
    const insetX = Math.min(12, Math.max(1, rect.width * 0.12));
    const insetY = Math.min(8, Math.max(1, rect.height * 0.22));
    const xs = rect.width < 28
      ? [rect.left + rect.width / 2]
      : [rect.left + insetX, rect.left + rect.width / 2, rect.right - insetX];
    const ys = rect.height < 22
      ? [rect.top + rect.height / 2]
      : [rect.top + insetY, rect.top + rect.height / 2, rect.bottom - insetY];
    const points = [];
    for (const y of ys) {
      for (const x of xs) {
        if (x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight) points.push({ x, y });
      }
    }
    return points;
  }

  async function sampleVisualBackgroundAtPoint(el, point, textColor, depth = 0) {
    if (depth > 8) {
      return { status: 'unresolved', reason: 'background stack too deep' };
    }
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(point.x, point.y)
      : [];
    const selfIndex = stack.findIndex(node => node === el || el.contains(node));
    const nodes = selfIndex >= 0 ? stack.slice(selfIndex) : [el, ...stack];
    const unresolved = [];

    for (const node of nodes) {
      if (!node || node.nodeType !== 1) continue;
      if (node.closest?.('.audit-overlay, .audit-label, .audit-banner, .audit-tooltip')) continue;
      const tag = node.tagName?.toLowerCase();
      if (tag === 'img') {
        const sample = await sampleImageElement(node, point);
        if (sample.status === 'sampled') return sample;
        unresolved.push(sample.reason);
        continue;
      }
      if (tag === 'canvas' || tag === 'video') {
        const rect = node.getBoundingClientRect();
        const sourcePoint = pointToImageSource(point, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          intrinsicWidth: node.width || node.videoWidth || rect.width,
          intrinsicHeight: node.height || node.videoHeight || rect.height,
        });
        if (sourcePoint) {
          const sample = sampleDrawablePixel(node, sourcePoint);
          if (sample.status === 'sampled') return { ...sample, method: `canvas-${tag}-underlay` };
          unresolved.push(sample.reason);
        }
        continue;
      }
      const style = getComputedStyle(node);
      const sample = await sampleCssBackground(node, style, point, textColor);
      if (sample.status === 'sampled') {
        if (!sample.color || sample.color.a == null || sample.color.a >= 0.95) return sample;
        const under = await sampleVisualBackgroundAtPoint(node.parentElement || document.body, point, textColor, depth + 1);
        if (under.status === 'sampled') {
          return {
            status: 'sampled',
            color: blendRgba(sample.color, under.color),
            method: `${sample.method}+alpha`,
          };
        }
        return sample;
      }
      unresolved.push(sample.reason);
    }

    return {
      status: 'unresolved',
      reason: [...new Set(unresolved.filter(Boolean))].slice(0, 3).join(', ') || 'no readable visual background',
    };
  }

  async function analyzeVisualContrastCandidate(candidate) {
    let el;
    try {
      el = document.querySelector(candidate.selector);
    } catch {
      return { ...candidate, status: 'unresolved', confidence: 'none', reason: 'stale selector' };
    }
    if (!el) return { ...candidate, status: 'unresolved', confidence: 'none', reason: 'missing element' };
    if (!isRenderedForBrowserRule(el)) return { ...candidate, status: 'unresolved', confidence: 'none', reason: 'hidden element' };

    const blockingReason = (candidate.reasons || []).find(reason =>
      reason === 'background-clip text' ||
      reason === 'blend mode' ||
      reason === 'filter' ||
      reason === 'backdrop filter' ||
      reason === 'opacity stack' ||
      reason === 'text shadow'
    );
    if (blockingReason) {
      return { ...candidate, status: 'unresolved', confidence: 'none', reason: `${blockingReason} needs screenshot pixels` };
    }

    const style = getComputedStyle(el);
    const textColor = parseRgb(style.color) || candidate.textColor;
    if (!textColor) return { ...candidate, status: 'unresolved', confidence: 'none', reason: 'unreadable text color' };

    const rect = getDirectTextRect(el) || el.getBoundingClientRect();
    if (!rect || rect.width < 4 || rect.height < 4) {
      return { ...candidate, status: 'unresolved', confidence: 'none', reason: 'missing text rect' };
    }

    const points = textSamplePoints(rect);
    if (points.length === 0) {
      return { ...candidate, status: 'unresolved', confidence: 'none', reason: 'text outside viewport' };
    }

    const ratios = [];
    const methods = new Set();
    const unresolved = [];
    for (const point of points) {
      const sample = await sampleVisualBackgroundAtPoint(el, point, textColor);
      if (sample.status !== 'sampled' || !sample.color) {
        unresolved.push(sample.reason);
        continue;
      }
      const fg = blendRgba(textColor, sample.color);
      ratios.push(contrastRatio(fg, sample.color));
      if (sample.method) methods.add(sample.method);
    }

    if (ratios.length < Math.min(3, points.length)) {
      return {
        ...candidate,
        status: 'unresolved',
        confidence: 'none',
        samples: ratios.length,
        reason: [...new Set(unresolved.filter(Boolean))].slice(0, 3).join(', ') || 'not enough readable samples',
      };
    }

    ratios.sort((a, b) => a - b);
    const pick = pct => ratios[Math.min(ratios.length - 1, Math.max(0, Math.floor((pct / 100) * ratios.length)))];
    const measuredRatio = pick(10);
    const medianRatio = pick(50);
    const status = measuredRatio < candidate.threshold ? 'fail' : 'pass';
    const method = [...methods].sort().join(', ') || 'browser-visual';
    const textLabel = candidate.text ? ` "${candidate.text}"` : '';
    const detail = `browser contrast ${measuredRatio.toFixed(1)}:1 median ${medianRatio.toFixed(1)}:1 (need ${candidate.threshold}:1) via ${method}${textLabel}`;
    return {
      ...candidate,
      status,
      confidence: method.includes('canvas-') ? 'high' : 'medium',
      method,
      ratio: measuredRatio,
      medianRatio,
      samples: ratios.length,
      finding: status === 'fail' ? { id: 'low-contrast', snippet: detail } : null,
    };
  }

  function waitForVisualPaint() {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function analyzeVisualContrast(options = {}) {
    const candidates = collectVisualContrastCandidates(options);
    const results = [];
    const shouldScrollOffscreen = options.scrollOffscreen === true;
    const restoreScroll = { x: window.scrollX, y: window.scrollY };
    for (const candidate of candidates) {
      if (shouldScrollOffscreen && (window.scrollX !== restoreScroll.x || window.scrollY !== restoreScroll.y)) {
        window.scrollTo(restoreScroll.x, restoreScroll.y);
        await waitForVisualPaint();
      }
      let result = await analyzeVisualContrastCandidate(candidate);
      if (shouldScrollOffscreen && result.status === 'unresolved' && result.reason === 'text outside viewport') {
        let el = null;
        try {
          el = document.querySelector(candidate.selector);
        } catch {
          el = null;
        }
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          await waitForVisualPaint();
          result = await analyzeVisualContrastCandidate(candidate);
        }
      }
      results.push(result);
    }
    if (shouldScrollOffscreen && (window.scrollX !== restoreScroll.x || window.scrollY !== restoreScroll.y)) {
      window.scrollTo(restoreScroll.x, restoreScroll.y);
    }
    return results;
  }

  function isElementHidden(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (typeof el.checkVisibility === 'function') return !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    // Fallback: zero size or no offsetParent (covers display:none and detached subtrees)
    return el.offsetWidth === 0 && el.offsetHeight === 0;
  }

  function serializeFindings(allFindings) {
    return allFindings.map(({ el, findings }) => ({
      selector: generateSelector(el),
      tagName: el.tagName?.toLowerCase() || 'unknown',
      rect: (el !== document.body && el !== document.documentElement && el.getBoundingClientRect)
        ? el.getBoundingClientRect().toJSON() : null,
      isPageLevel: el === document.body || el === document.documentElement,
      isHidden: isElementHidden(el),
      findings: findings.map(f => {
        const ap = ANTIPATTERNS.find(a => a.id === (f.type || f.id));
        return {
          type: f.type || f.id,
          category: ap ? ap.category : 'quality',
          severity: ap?.severity || 'warning',
          detail: f.detail || f.snippet,
          ignoreValue: f.ignoreValue || f.value || '',
          name: ap ? ap.name : (f.type || f.id),
          description: ap ? ap.description : '',
        };
      }),
    }));
  }

  const printSummary = function(allFindings) {
    if (allFindings.length === 0) {
      console.log('%c[audit] No anti-patterns found.', 'color: #22c55e; font-weight: bold');
      return;
    }
    console.group(
      `%c[audit] ${allFindings.length} anti-pattern${allFindings.length === 1 ? '' : 's'} found`,
      'color: oklch(84% 0.19 80.46); font-weight: bold'
    );
    for (const { el, findings } of allFindings) {
      for (const f of findings) {
        console.log(`%c${f.type || f.id}%c ${f.detail || f.snippet}`,
          'color: oklch(84% 0.19 80.46); font-weight: bold', 'color: inherit', el);
      }
    }
    console.groupEnd();
  };

  function addBrowserFindings(groupMap, el, findings) {
    if (!findings || findings.length === 0) return;
    const existing = groupMap.get(el);
    if (existing) existing.push(...findings);
    else groupMap.set(el, [...findings]);
  }

  function browserFindingsFromMap(groupMap) {
    return [...groupMap.entries()].map(([el, findings]) => ({ el, findings }));
  }

  const DESIGN_COLOR_TOLERANCE = 6;
  const DESIGN_RADIUS_TOLERANCE_PX = 0.5;
  const DESIGN_SKIP_TAGS = new Set(['head', 'title', 'meta', 'link', 'style', 'script', 'noscript', 'template', 'source']);

  function normalizeBrowserFontName(value) {
    return String(value || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function browserPrimaryFont(stack) {
    if (!stack || /var\(/i.test(stack)) return '';
    return String(stack || '')
      .split(',')
      .map(normalizeBrowserFontName)
      .find(font => font && !GENERIC_FONTS.has(font)) || '';
  }

  function browserDesignSystemConfig() {
    const raw = window.__AUDIT_CONFIG__?.designSystem;
    if (!raw?.present) return null;
    const allowedFonts = new Set((raw.allowedFonts || []).map(normalizeBrowserFontName).filter(Boolean));
    const allowedColors = (raw.allowedColors || [])
      .filter(color => color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b))
      .map(color => ({ r: color.r, g: color.g, b: color.b }));
    const allowedRadii = (raw.allowedRadii || [])
      .map(Number)
      .filter(px => Number.isFinite(px));
    return {
      present: true,
      hasFonts: raw.hasFonts === true && allowedFonts.size > 0,
      allowedFonts,
      hasColors: raw.hasColors === true && allowedColors.length > 0,
      allowedColors,
      hasRadii: raw.hasRadii === true && allowedRadii.length > 0,
      allowedRadii,
      hasPillRadius: raw.hasPillRadius === true,
    };
  }

  function browserColorsClose(a, b) {
    if (!a || !b) return false;
    return Math.max(
      Math.abs(a.r - b.r),
      Math.abs(a.g - b.g),
      Math.abs(a.b - b.b),
    ) <= DESIGN_COLOR_TOLERANCE;
  }

  function isBrowserDesignColorAllowed(raw, designSystem) {
    if (!designSystem?.hasColors) return true;
    const text = String(raw || '').trim().toLowerCase();
    if (!text || text === 'transparent' || text === 'currentcolor' || text === 'inherit' || text === 'initial') return true;
    if (text.includes('var(')) return true;
    const parsed = parseAnyColor(text);
    if (!parsed) return true;
    if ((parsed.a ?? 1) <= 0.05) return true;
    return designSystem.allowedColors.some(color => browserColorsClose(parsed, color));
  }

  function isBrowserTransparentCss(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'transparent') return true;
    const parsed = parseAnyColor(text);
    return parsed ? (parsed.a ?? 1) <= 0.05 : false;
  }

  function isBrowserDesignRadiusAllowed(raw, designSystem) {
    if (!designSystem?.hasRadii) return true;
    const text = String(raw || '').trim().toLowerCase();
    if (!text || text === '0' || text === 'none' || text === 'initial' || text === 'inherit') return true;
    if (text.includes('var(') || text.includes('%')) return true;
    const px = resolveLengthPx(text, 16);
    if (px == null || !Number.isFinite(px) || px <= DESIGN_RADIUS_TOLERANCE_PX) return true;
    if (designSystem.hasPillRadius && px >= 99) return true;
    return designSystem.allowedRadii.some(allowed => Math.abs(allowed - px) <= DESIGN_RADIUS_TOLERANCE_PX);
  }

  function browserRadiusTokens(value) {
    return String(value || '')
      .replace(/\s*\/\s*/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(Boolean);
  }

  function browserHasDirectText(el) {
    return [...(el.childNodes || [])].some(node => node.nodeType === 3 && node.textContent.trim().length > 0);
  }

  function browserSampleText(el) {
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    return text ? ` "${text.slice(0, 40)}"` : '';
  }

  function shouldSkipDesignElement(el) {
    const tag = el.tagName?.toLowerCase?.() || '';
    return DESIGN_SKIP_TAGS.has(tag) || isElementHidden(el);
  }

  function checkElementDesignSystemDOM(el, designSystem, seen) {
    if (!designSystem?.present || shouldSkipDesignElement(el)) return [];
    const findings = [];
    const tag = el.tagName?.toLowerCase?.() || 'unknown';
    const style = getComputedStyle(el);

    if (designSystem.hasFonts && browserHasDirectText(el)) {
      const font = browserPrimaryFont(style.fontFamily || '');
      if (font && !designSystem.allowedFonts.has(font) && !seen.fonts.has(font)) {
        seen.fonts.add(font);
        findings.push({
          type: 'design-system-font',
          detail: `${tag}${browserSampleText(el)} uses ${font}; not declared in DESIGN.md typography`,
          ignoreValue: font,
        });
      }
    }

    if (designSystem.hasColors) {
      const colorChecks = [];
      if (browserHasDirectText(el)) colorChecks.push(['text color', style.color]);
      if (!isBrowserTransparentCss(style.backgroundColor)) colorChecks.push(['background', style.backgroundColor]);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if ((parseFloat(style[`border${side}Width`]) || 0) > 0) {
          colorChecks.push([`border-${side.toLowerCase()}`, style[`border${side}Color`]]);
        }
      }
      if ((parseFloat(style.outlineWidth) || 0) > 0) colorChecks.push(['outline', style.outlineColor]);

      for (const [kind, raw] of colorChecks) {
        const label = String(raw || '').trim().replace(/\s+/g, ' ');
        if (isBrowserDesignColorAllowed(label, designSystem)) continue;
        const key = `${kind}:${label}`;
        if (seen.colors.has(key)) continue;
        seen.colors.add(key);
        findings.push({
          type: 'design-system-color',
          detail: `${kind} ${label} on ${tag}${browserSampleText(el)} is outside DESIGN.md colors`,
          ignoreValue: label,
        });
      }
    }

    if (designSystem.hasRadii) {
      for (const token of browserRadiusTokens(style.borderRadius || '')) {
        if (isBrowserDesignRadiusAllowed(token, designSystem)) continue;
        if (seen.radii.has(token)) continue;
        seen.radii.add(token);
        findings.push({
          type: 'design-system-radius',
          detail: `border-radius ${token} on ${tag}${browserSampleText(el)} is outside the DESIGN.md rounded scale`,
          ignoreValue: token,
        });
      }
    }

    return findings;
  }

  function decodeBrowserGoogleFamily(value) {
    const family = String(value || '').split(':')[0].replace(/\+/g, ' ');
    try {
      return decodeURIComponent(family);
    } catch {
      return family;
    }
  }

  function checkBrowserDesignSystemSources(designSystem, seen) {
    if (!designSystem?.hasFonts) return [];
    const findings = [];
    for (const link of document.querySelectorAll('link[href*="fonts.googleapis.com/css"]')) {
      const href = link.getAttribute('href') || '';
      for (const match of href.matchAll(/[?&]family=([^&]+)/g)) {
        const display = decodeBrowserGoogleFamily(match[1]);
        const font = normalizeBrowserFontName(display);
        if (!font || designSystem.allowedFonts.has(font) || seen.fonts.has(font)) continue;
        seen.fonts.add(font);
        findings.push({
          type: 'design-system-font',
          detail: `Google Fonts: ${display} is not declared in DESIGN.md typography`,
          ignoreValue: display,
        });
      }
    }
    return findings;
  }

  function collectBrowserFindings() {
    const groupMap = new Map();
    const _disabled = EXTENSION_MODE ? (window.__AUDIT_CONFIG__?.disabledRules || []) : [];
    const _ruleOk = (id) => !_disabled.length || !_disabled.includes(id);
    const designSystem = browserDesignSystemConfig();
    const designSeen = { fonts: new Set(), colors: new Set(), radii: new Set() };
    // Note: provider-gated rules (--gpt / --gemini) are NOT filtered here. In a
    // real browser env (detector page, live overlay, extension) running every
    // check is free, so we always surface them; the gating is purely a CLI
    // output concern, applied in the Node engines' detect* return paths.

    for (const el of document.querySelectorAll('*')) {
      // Skip audit's own elements and any descendants (overlays, labels, banner, nav buttons)
      if (el.closest('.audit-overlay, .audit-label, .audit-banner, .audit-tooltip')) continue;
      // Skip browser extension elements (Claude, etc.)
      const elId = el.id || '';
      if (elId.startsWith('claude-') || elId.startsWith('cic-')) continue;
      // Skip the audit live-mode overlay (highlight, tooltip, bar, picker, toast).
      // These are inspector chrome, not part of the user's design.
      if (el.closest('[id^="audit-live-"]')) continue;
      // Skip html/body -- page-level findings go in the banner, not a full-page overlay
      if (el === document.body || el === document.documentElement) continue;

      const findings = [
        ...checkElementBordersDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementColorsDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementMotionDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementGlowDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementAIPaletteDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementIconTileDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementItalicSerifDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementQualityDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementOversizedH1DOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementClippedOverflowDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementGptBorderShadowDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementTextOverflowDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementDesignSystemDOM(el, designSystem, designSeen),
      ].filter(f => _ruleOk(f.type));

      addBrowserFindings(groupMap, el, findings);

      // Hero eyebrow: the offending element is the eyebrow above the heading,
      // not the heading itself — highlight the previous sibling instead.
      const eyebrowFindings = checkElementHeroEyebrowDOM(el)
        .map(f => ({ type: f.id, detail: f.snippet }))
        .filter(f => _ruleOk(f.type));
      if (eyebrowFindings.length > 0 && el.previousElementSibling) {
        addBrowserFindings(groupMap, el.previousElementSibling, eyebrowFindings);
      }
    }

    const pageLevelFindings = [];

    const designSourceFindings = checkBrowserDesignSystemSources(designSystem, designSeen)
      .filter(f => _ruleOk(f.type));
    if (designSourceFindings.length > 0) {
      pageLevelFindings.push(...designSourceFindings);
      addBrowserFindings(groupMap, document.body, designSourceFindings);
    }

    const typoFindings = checkTypography().filter(f => _ruleOk(f.type));
    if (typoFindings.length > 0) {
      pageLevelFindings.push(...typoFindings);
      addBrowserFindings(groupMap, document.body, typoFindings);
    }

    const sectionKickerFindings = checkRepeatedSectionKickersDOM()
      .map(f => ({ type: f.id, detail: f.snippet }))
      .filter(f => _ruleOk(f.type));
    if (sectionKickerFindings.length > 0) {
      pageLevelFindings.push(...sectionKickerFindings);
      addBrowserFindings(groupMap, document.body, sectionKickerFindings);
    }

    const layoutFindings = checkLayout().filter(f => _ruleOk(f.type));
    for (const f of layoutFindings) {
      const el = f.el || document.body;
      addBrowserFindings(groupMap, el, [{ type: f.type, detail: f.detail || f.snippet }]);
    }

    // Page-level quality checks (headings, etc.)
    const qualityFindings = checkPageQualityDOM().filter(f => _ruleOk(f.type));
    if (qualityFindings.length > 0) {
      pageLevelFindings.push(...qualityFindings);
      addBrowserFindings(groupMap, document.body, qualityFindings);
    }

    const creamFindings = checkCreamPalette(document)
      .map(f => ({ type: f.id, detail: f.snippet }))
      .filter(f => _ruleOk(f.type));
    if (creamFindings.length > 0) {
      pageLevelFindings.push(...creamFindings);
      addBrowserFindings(groupMap, document.body, creamFindings);
    }

    try { collectPixelpushExtras(groupMap, _ruleOk); } catch (err) { if (!EXTENSION_MODE) console.warn('[audit] extra rules failed', err); }

    // Regex-on-HTML checks (shared with Node)
    // Clone the document and strip audit-live overlay nodes before the
    // regex scan, so the inspector's own inline styles (transitions on top/
    // left/width/height, etc.) don't register as page anti-patterns.
    const docClone = document.documentElement.cloneNode(true);
    for (const node of docClone.querySelectorAll('[id^="audit-live-"]')) {
      node.remove();
    }
    const htmlPatternFindings = checkHtmlPatterns(docClone.outerHTML);
    if (htmlPatternFindings.length > 0) {
      const mapped = htmlPatternFindings.map(f => ({ type: f.id, detail: f.snippet })).filter(f => _ruleOk(f.type));
      pageLevelFindings.push(...mapped);
      addBrowserFindings(groupMap, document.body, mapped);
    }

    return {
      groupMap,
      allFindings: browserFindingsFromMap(groupMap),
      pageLevelFindings,
    };
  }

  function shouldRunVisualContrast(options = {}) {
    return options.visualContrast === true || window.__AUDIT_CONFIG__?.visualContrast === true;
  }

  function visualContrastOptions(options = {}) {
    const config = window.__AUDIT_CONFIG__ || {};
    const scrollOffscreen = typeof options.scrollOffscreen === 'boolean'
      ? options.scrollOffscreen
      : typeof options.visualContrastScrollOffscreen === 'boolean'
        ? options.visualContrastScrollOffscreen
        : typeof config.visualContrastScrollOffscreen === 'boolean'
          ? config.visualContrastScrollOffscreen
          : false;
    return {
      ...options,
      maxCandidates: Number.isFinite(options.visualContrastMaxCandidates)
        ? options.visualContrastMaxCandidates
        : Number.isFinite(options.maxCandidates)
          ? options.maxCandidates
          : Number.isFinite(config.visualContrastMaxCandidates)
            ? config.visualContrastMaxCandidates
            : undefined,
      scrollOffscreen,
    };
  }

  let lastVisualContrastAnalyses = [];
  let lazyVisualContrastObserver = null;
  let lazyVisualContrastPending = new WeakMap();
  const lazyVisualContrastResolving = new WeakSet();
  let scanGeneration = 0;

  function rememberVisualContrastAnalysis(result) {
    if (!result?.selector) {
      lastVisualContrastAnalyses.push(result);
      return;
    }
    const idx = lastVisualContrastAnalyses.findIndex(item => item.selector === result.selector);
    if (idx >= 0) lastVisualContrastAnalyses[idx] = result;
    else lastVisualContrastAnalyses.push(result);
  }

  function disconnectLazyVisualContrastObserver() {
    if (lazyVisualContrastObserver) {
      lazyVisualContrastObserver.disconnect();
      lazyVisualContrastObserver = null;
    }
    lazyVisualContrastPending = new WeakMap();
  }

  function addVisualContrastResult(groupMap, result, options = {}) {
    if (result.status !== 'fail' || !result.finding || !result.selector) return false;
    let el = null;
    try {
      el = document.querySelector(result.selector);
    } catch {
      el = null;
    }
    if (!el) return false;
    const findingType = result.finding.type || result.finding.id || 'low-contrast';
    const existing = groupMap.get(el) || [];
    if (existing.some(f => (f.type || f.id) === findingType)) return false;
    addBrowserFindings(groupMap, el, [{
      type: findingType,
      detail: result.finding.detail || result.finding.snippet,
    }]);
    if (options.decorate && el !== document.body && el !== document.documentElement) {
      highlight(el, groupMap.get(el) || []);
    }
    return true;
  }

  function scanResultMeta(options = {}) {
    const scanId = options.scanId;
    if (typeof scanId !== 'string' && typeof scanId !== 'number') return {};
    return { scanId: String(scanId) };
  }

  function postSerializedFindings(groupMap, options = {}) {
    if (!EXTENSION_MODE) return;
    const allFindings = browserFindingsFromMap(groupMap);
    window.postMessage({
      source: 'audit-results',
      findings: serializeFindings(allFindings),
      count: allFindings.length,
      ...scanResultMeta(options),
    }, '*');
  }

  function postExtensionError(err) {
    if (!EXTENSION_MODE) return;
    window.postMessage({
      source: 'audit-error',
      message: err?.message || String(err),
    }, '*');
  }

  function reportVisualContrastError(err, detail = {}) {
    window.dispatchEvent(new CustomEvent('audit-visual-contrast-error', {
      detail: {
        ...detail,
        message: err?.message || String(err),
      },
    }));
    if (EXTENSION_MODE) {
      postExtensionError(err);
    } else {
      console.warn('[audit] visual contrast scan failed', err);
    }
  }

  function scheduleLazyVisualContrast(groupMap, analyses, options = {}, runtime = {}) {
    disconnectLazyVisualContrastObserver();
    if (options.visualContrastLazy === false || options.scrollOffscreen !== false) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const unresolved = (analyses || []).filter(result =>
      result?.status === 'unresolved' &&
      result.reason === 'text outside viewport' &&
      result.selector
    );
    if (unresolved.length === 0) return;
    const generation = runtime.generation || scanGeneration;

    lazyVisualContrastObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        const candidate = lazyVisualContrastPending.get(el);
        if (!candidate || lazyVisualContrastResolving.has(el)) continue;
        lazyVisualContrastObserver?.unobserve(el);
        lazyVisualContrastPending.delete(el);
        lazyVisualContrastResolving.add(el);
        waitForVisualPaint()
          .then(() => analyzeVisualContrastCandidate(candidate))
          .then(result => {
            if (generation !== scanGeneration) return;
            rememberVisualContrastAnalysis(result);
            const added = addVisualContrastResult(groupMap, result, { decorate: true });
            if (added) {
              postSerializedFindings(groupMap, options);
              window.dispatchEvent(new CustomEvent('audit-visual-contrast-resolved', {
                detail: {
                  selector: result.selector,
                  status: result.status,
                  finding: result.finding || null,
                },
              }));
            }
          })
          .catch(err => {
            reportVisualContrastError(err, { selector: candidate.selector });
          })
          .finally(() => {
            lazyVisualContrastResolving.delete(el);
          });
      }
    }, { threshold: 0.5 });

    for (const candidate of unresolved) {
      let el = null;
      try {
        el = document.querySelector(candidate.selector);
      } catch {
        el = null;
      }
      if (!el) continue;
      lazyVisualContrastPending.set(el, candidate);
      lazyVisualContrastObserver.observe(el);
    }
  }

  async function addVisualContrastFindings(groupMap, options = {}, runtime = {}) {
    if (!shouldRunVisualContrast(options)) {
      lastVisualContrastAnalyses = [];
      disconnectLazyVisualContrastObserver();
      return [];
    }
    const resolvedOptions = visualContrastOptions(options);
    const analyses = await analyzeVisualContrast(resolvedOptions);
    if (runtime.generation && runtime.generation !== scanGeneration) return analyses;
    lastVisualContrastAnalyses = analyses;
    for (const result of analyses) {
      addVisualContrastResult(groupMap, result, { decorate: runtime.decorate });
    }
    if (runtime.decorate || runtime.scheduleLazy) scheduleLazyVisualContrast(groupMap, analyses, resolvedOptions, runtime);
    return analyses;
  }

  async function collectBrowserFindingsAsync(options = {}, runtime = {}) {
    const collected = collectBrowserFindings();
    await addVisualContrastFindings(collected.groupMap, options, runtime);
    return {
      ...collected,
      allFindings: browserFindingsFromMap(collected.groupMap),
      visualContrastAnalyses: lastVisualContrastAnalyses,
    };
  }

  function clearOverlays() {
    scanGeneration += 1;
    disconnectLazyVisualContrastObserver();
    for (const o of [...overlays]) detachOverlay(o);
    overlays.length = 0;
    visibilityObserver.disconnect();
    overlayIndex = 0;
  }

  function renderBrowserFindings(collected, options = {}) {
    const { allFindings, pageLevelFindings } = collected;

    for (const { el, findings } of allFindings) {
      if (el === document.body || el === document.documentElement) continue;
      highlight(el, findings);
    }

    if (pageLevelFindings.length > 0) {
      showPageBanner(pageLevelFindings);
    }

    if (!EXTENSION_MODE) printSummary(allFindings);

    // In extension mode, post serialized results for the DevTools panel
    if (EXTENSION_MODE) {
      window.postMessage({
        source: 'audit-results',
        findings: serializeFindings(allFindings),
        count: allFindings.length,
        ...scanResultMeta(options),
      }, '*');
    }

    // After this scan completes, all subsequent reveals are instant (no stagger, no animation)
    setTimeout(() => { firstScanDone = true; }, 1000);

    return allFindings;
  }

  let firstScanDone = false;
  const scan = function(options = {}) {
    clearOverlays();
    const generation = scanGeneration;
    const collected = collectBrowserFindings();
    const allFindings = renderBrowserFindings(collected, options);
    if (shouldRunVisualContrast(options)) {
      addVisualContrastFindings(collected.groupMap, options, { decorate: true, generation })
        .then(() => {
          if (generation === scanGeneration) postSerializedFindings(collected.groupMap, options);
        })
        .catch(err => {
          reportVisualContrastError(err);
        });
    }
    return allFindings;
  };

  const scanAsync = async function(options = {}) {
    clearOverlays();
    const generation = scanGeneration;
    if (shouldRunVisualContrast(options)) {
      const collected = await collectBrowserFindingsAsync(options, { generation, scheduleLazy: true });
      if (generation !== scanGeneration) return [];
      return renderBrowserFindings(collected, options);
    }
    lastVisualContrastAnalyses = [];
    return renderBrowserFindings(collectBrowserFindings(), options);
  };

  const detect = function(options = {}) {
    lastVisualContrastAnalyses = [];
    const { allFindings } = collectBrowserFindings();
    return options.serialize === false ? allFindings : serializeFindings(allFindings);
  };

  const detectAsync = async function(options = {}) {
    if (shouldRunVisualContrast(options)) {
      const { allFindings } = await collectBrowserFindingsAsync(options);
      return options.serialize === false ? allFindings : serializeFindings(allFindings);
    }
    lastVisualContrastAnalyses = [];
    const { allFindings } = collectBrowserFindings();
    return options.serialize === false ? allFindings : serializeFindings(allFindings);
  };

  // ── Pixelpush additions: extra rules ────────────────────────────────────
  // Rules that the vendored detector declared but never ran in the browser (copy
  // tells, broken images) plus common, standards-backed problems it never covered.
  // One pass over the page; every finding goes through the same groupMap as the
  // original checks so highlighting, grouping and "disabled rules" keep working.

  const PP_PLACEHOLDER_IMG_RE = /(?:placehold\.(?:co|it)|via\.placeholder\.com|placeimg\.com|dummyimage\.com|picsum\.photos|placekitten\.com|loremflickr\.com|\/(?:image-?)?placeholder[-_.\w]*\.(?:png|jpe?g|svg|webp|gif)\b)/i;
  const PP_PLACEHOLDER_COPY_RE = /\b(lorem ipsum|dolor sit amet|consectetur adipiscing|your (?:text|title|headline|company|name|tagline) here|(?:heading|title|subtitle|description|text|content|tagline) goes here|insert (?:text|title|image|content|copy) here|click to edit|sample text|john doe|jane doe)\b/i;

  // Generic SaaS filler. Matched as whole words/phrases; a single hit in body copy is
  // normal, so the rule needs two distinct phrases or one in the hero.
  const PP_BUZZWORDS = [
    'streamline', 'streamlined', 'empower', 'empowers', 'empowering', 'supercharge', 'supercharged',
    'world-class', 'enterprise-grade', 'next-generation', 'next-gen', 'cutting-edge', 'state-of-the-art',
    'best-in-class', 'game-changing', 'game changer', 'revolutionize', 'revolutionary', 'seamless',
    'seamlessly', 'unleash', 'unlock the power', 'harness the power', 'take your .{1,24} to the next level',
    'elevate your', 'reimagine', 'reimagined', 'effortless', 'effortlessly', 'robust and scalable',
    'all-in-one', 'one-stop', 'in today’s fast-paced', "in today's fast-paced", 'at the forefront', 'built for the future',
    'transform the way', 'future-proof', 'turbocharge', 'synergy', 'holistic',
  ];
  const PP_BUZZ_RE = new RegExp(`(?:^|[^\\w-])(${PP_BUZZWORDS.join('|')})(?![\\w-])`, 'gi');

  function ppVisibleTextNodes(limit = 60000) {
    const nodes = [];
    let total = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|TEMPLATE|CODE|PRE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('.audit-overlay, .audit-label, .audit-banner, .audit-tooltip, [id^="audit-live-"]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode() && total < limit) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (isElementHidden(parent)) continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      nodes.push({ text, el: parent });
      total += text.length;
    }
    return nodes;
  }

  function ppShort(text, max = 60) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  function ppIsInlineLink(a) {
    const cs = getComputedStyle(a);
    if (cs.display !== 'inline') return false;
    const parent = a.parentElement;
    if (!parent) return false;
    const own = [...parent.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    return own.length >= 12;
  }

  // ── Pixelpush additions: calibrated tells (see docs/audit.md for sources) ───

  const PP_DESIGNED_HIDDEN = '[hidden], [inert], [aria-hidden="true"], details:not([open]), dialog:not([open]), [role="tooltip"], [role="menu"], .sr-only, .visually-hidden, [class*="skeleton"], [class*="cookie"], [class*="consent"], [class*="tooltip"], [class*="dropdown"], [class*="swiper-slide"], [class*="slick-slide"], [class*="splide__slide"], [aria-roledescription="slide"]';

  // Product of opacity up the ancestor chain; text under 0.02 is invisible.
  function ppEffectiveOpacity(el) {
    let o = 1;
    let n = 0;
    for (let e = el; e && n < 12; e = e.parentElement, n++) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return 0;
      o *= parseFloat(cs.opacity);
      if (o <= 0.02) return o;
    }
    return o;
  }

  // Text blocks that exist but are invisible (a reveal animation that never ran, or ran and undid itself).
  function ppHiddenTextBlocks(nodes) {
    let total = 0;
    let hidden = 0;
    const groups = new Map();
    for (const { text, el } of nodes) {
      total += text.length;
      if (el.closest(PP_DESIGNED_HIDDEN)) continue;
      if (ppEffectiveOpacity(el) > 0.02) continue;
      hidden += text.length;
      const block = el.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, div, section') || el;
      groups.set(block, (groups.get(block) || 0) + text.length);
    }
    return { total, hidden, groups };
  }

  // Scroll each still-hidden block to the middle of the screen and see whether it reveals.
  async function ppProbeHiddenBlocks(scrollTo, isCurrent, budgetMs = 5000) {
    const info = ppHiddenTextBlocks(ppVisibleTextNodes());
    if (info.total < 200 || info.hidden < 150 || info.hidden / info.total <= 0.3) return;
    const started = Date.now();
    for (const block of [...info.groups.keys()].slice(0, 20)) {
      if (Date.now() - started > budgetMs || !isCurrent()) break;
      const r = block.getBoundingClientRect();
      scrollTo(Math.max(0, r.top + window.scrollY - window.innerHeight / 2));
      for (let i = 0; i < 4; i++) {
        await auditPause(60);
        if (ppEffectiveOpacity(block) > 0.02) break;
      }
    }
  }

  const PP_AVATAR_HOST_RE = /(?:^|\/\/|\.)(?:i\.)?(?:pravatar\.cc|dicebear\.com|randomuser\.me|thispersondoesnotexist\.com|ui-avatars\.com)/i;

  // Phrase lists live in data so they can drift with the models (Wikipedia: Signs of AI writing).
  const PP_AI_VOICE_PHRASES = [
    /\b(?:stands?|serves?|remains?) as an? (?:testament|reminder|beacon)\b/i, /\bis an? testament to\b/i,
    /\bplays? an? (?:vital|pivotal|crucial|significant|key) role\b/i, /\bunderscor(?:es|ing) (?:the|its|how|why)\b/i,
    /\bmarks? a (?:pivotal|significant|key|watershed) (?:moment|shift|turning point)\b/i, /\brich (?:cultural )?tapestry\b/i,
    /\b(?:ever-evolving|ever-changing) (?:landscape|world)\b/i, /\bdelves? (?:into|deeper)\b/i, /\bhere['’]s the thing\b/i,
    /\blet me be clear\b/i, /\bwhat (?:nobody|no one|most people) (?:tells you|gets|realize)\b/i,
    /\bthe (?:part|thing) (?:most people|everyone) (?:miss|skip|get wrong)\b/i, /\bit['’]s worth (?:noting|mentioning) that\b/i,
    /\b(?:it['’]s|this is|that['’]s) not (?:just )?[^.!?]{2,40}[,;—-]\s*(?:it['’]s|but)\b/i,
    /\bno [^.!?,]{2,20}, no [^.!?,]{2,20},? just\b/i,
  ];
  const PP_AI_VOICE_HEADLINES = [
    /^(?:build|shape|create|power|scale|ship) the future of\b/i, /^your (?:all-in-one|one-stop|ultimate|complete) /i, /\bscale without limits\b/i,
    /^everything you need to\b/i, /^empowering (?:teams|businesses|creators|developers)\b/i, /^(?:the )?(?:smarter|better|faster) way to\b/i,
    /\bsay goodbye to\b/i, /\bmeet your new\b/i,
  ];
  const PP_AI_VOICE_LEXICON = /\b(?:delve|tapestry|multifaceted|meticulous(?:ly)?|intricate|interplay|pivotal|embark|beacon|paramount|bolstered|garner|vibrant|boasts|showcasing|fostering|testament)\b/gi;

  // Accessible name, close to the browser's own computation (aria-labelledby, aria-label,
  // subtree text with img alt and svg title, alphabetic generated content, title).
  function ppAccessibleName(el) {
    const labelledby = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (labelledby) return labelledby;
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    let text = '';
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { text += c.textContent; continue; }
        if (c.nodeType !== 1) continue;
        const ccs = getComputedStyle(c);
        if (ccs.display === 'none' || ccs.visibility === 'hidden' || c.getAttribute('aria-hidden') === 'true') continue;
        const t = c.tagName.toLowerCase();
        if (t === 'img') text += ` ${c.getAttribute('alt') || ''}`;
        else if (t === 'svg') text += ` ${c.getAttribute('aria-label') || ''}${c.querySelector('title')?.textContent || ''}`;
        else { text += ` ${c.getAttribute('aria-label') || ''}`; walk(c); }
      }
    };
    walk(el);
    for (const p of ['::before', '::after']) {
      const content = getComputedStyle(el, p).content;
      if (content && content !== 'none' && content !== 'normal') {
        const inner = content.replace(/^["']|["']$/g, '');
        if (/[A-Za-z]/.test(inner)) text += ` ${inner}`;
      }
    }
    text = text.replace(/\s+/g, ' ').trim();
    return text || (el.getAttribute('title') || '').trim();
  }

  function collectPixelpushTells({ add, ruleOk, nodes, body }) {
    // Accent word in a headline: one italic / coloured / heavier / gradient word set apart.
    if (ruleOk('accent-word-headline')) {
      const hits = [];
      for (const h of body.querySelectorAll('h1, h2')) {
        if (isElementHidden(h) || h.closest('blockquote, q, nav, footer, [class*="brand"], [class*="logo"]')) continue;
        const text = (h.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.split(' ').filter(Boolean).length < 4 || h.querySelector('a, abbr, code, sup, sub, img, svg, br')) continue;
        const hcs = getComputedStyle(h);
        const accents = [];
        for (const d of h.querySelectorAll('em, i, b, strong, mark, u, span')) {
          const dt = (d.textContent || '').replace(/\s+/g, ' ').trim();
          if (!dt || dt.split(' ').length > 3 || dt.length > text.length * 0.4) continue;
          const dcs = getComputedStyle(d);
          const reasons = [];
          if ((dcs.fontStyle === 'italic') !== (hcs.fontStyle === 'italic')) reasons.push('italic');
          if (Math.abs((parseInt(dcs.fontWeight, 10) || 400) - (parseInt(hcs.fontWeight, 10) || 400)) >= 200) reasons.push('weight');
          const hc = parseRgb(hcs.color);
          const dc = parseRgb(dcs.color);
          if (hc && dc && hc.a > 0.1 && dc.a > 0.1 && Math.hypot(hc.r - dc.r, hc.g - dc.g, hc.b - dc.b) >= 90) reasons.push('colour');
          if (browserPrimaryFont(dcs.fontFamily) !== browserPrimaryFont(hcs.fontFamily)) reasons.push('typeface');
          if (/text/.test(dcs.webkitBackgroundClip || dcs.backgroundClip || '') && /gradient/.test(dcs.backgroundImage)) reasons.push('gradient');
          if (reasons.length) accents.push({ dt, reasons });
        }
        if (accents.length === 1) hits.push({ h, ...accents[0] });
      }
      if (hits.length && (hits.some(x => x.h.tagName === 'H1') || hits.length >= 2)) {
        add(hits[0].h, 'accent-word-headline', `"${ppShort(hits[0].dt, 24)}" is set apart in the heading by ${hits[0].reasons.join(' + ')}`);
      }
    }

    // Chromatic radial-gradient glow, including ::before / ::after layers.
    if (ruleOk('radial-halo')) {
      const cands = new Set([document.documentElement, body]);
      for (const el of body.querySelectorAll('main, section, header, [class*="hero"], [class*="glow"]')) { if (cands.size > 140) break; cands.add(el); }
      const vp = window.innerWidth * window.innerHeight;
      let halo = null;
      for (const el of cands) {
        for (const pseudo of [null, '::before', '::after']) {
          const cs = pseudo ? getComputedStyle(el, pseudo) : getComputedStyle(el);
          if (pseudo && (cs.content === 'none' || cs.content === 'normal' || !/^(?:absolute|fixed)$/.test(cs.position))) continue;
          const bi = cs.backgroundImage || '';
          if (!/radial-gradient\(/.test(bi) || /url\(/.test(bi)) continue;
          const glows = bi.split(/(?=radial-gradient\()/).filter(x => x.startsWith('radial-gradient(')).some(layer => {
            const toks = layer.match(/(?:rgba?|oklch|oklab|lab|lch|color)\([^)]*\)|transparent/g) || [];
            const first = toks.find(t => t !== 'transparent');
            const c = first && parseRgb(first);
            const last = toks[toks.length - 1];
            const fades = last === 'transparent' || (parseRgb(last)?.a ?? 1) <= 0.02;
            return c && hasChroma(c, 30) && c.a >= 0.12 && fades;
          });
          if (!glows) continue;
          const area = pseudo ? (parseFloat(cs.width) || 0) * (parseFloat(cs.height) || 0) : el.getBoundingClientRect().width * el.getBoundingClientRect().height;
          if (el !== document.documentElement && el !== body && area < vp * 0.05) continue;
          halo = halo || { el, pseudo };
        }
      }
      if (halo) add(halo.el, 'radial-halo', `Chromatic radial-gradient glow on ${halo.el.tagName.toLowerCase()}${halo.pseudo || ''}`);
    }

    // Template punctuation: middle-dot meta strings, arrow-suffixed links, WORD - label fragments.
    if (ruleOk('template-punctuation')) {
      const skip = 'nav, footer, [aria-label*="breadcrumb" i], pre, code, time, ol, [class*="marquee"], [class*="ticker"]';
      const dots = new Map();
      const labels = new Map();
      for (const { text, el } of nodes) {
        if (el.closest(skip)) continue;
        if ((text.match(/\s[·•]\s/g) || []).length >= 2) dots.set(text, el);
        if (text.length < 60 && /^[A-Z]{3,}\s+[-—–]\s+\S/.test(text)) labels.set(text, el);
      }
      const arrows = [...body.querySelectorAll('a, button')].filter(c => !isElementHidden(c) && !c.closest(skip) && /(?:→|->|›|»|⟶)\s*$/.test((c.textContent || '').trim()));
      const first = dots.size >= 2 ? [...dots.values()][0] : arrows.length >= 3 ? arrows[0] : labels.size >= 2 ? [...labels.values()][0] : null;
      if (first) {
        const why = dots.size >= 2 ? `${dots.size} meta strings joined with middle dots` : arrows.length >= 3 ? `${arrows.length} links end in a typed arrow` : `${labels.size} "WORD - fragment" labels`;
        add(first, 'template-punctuation', `${why}, e.g. "${ppShort(first.textContent, 44)}"`);
      }
    }

    // Placeholder avatar services inside testimonial-shaped blocks (or three or more anywhere).
    if (ruleOk('stock-avatars')) {
      const hits = [];
      for (const img of body.querySelectorAll('img')) {
        if (isElementHidden(img) || img.closest('pre, code')) continue;
        if (PP_AVATAR_HOST_RE.test(`${img.getAttribute('src') || ''} ${img.getAttribute('srcset') || ''}`)) hits.push(img);
      }
      const testimonial = hits.find(i => i.closest('blockquote, figure, [class*="testimonial"], [class*="review"], [class*="quote"], [class*="customer"]'));
      if (testimonial || hits.length >= 3) add(testimonial || hits[0], 'stock-avatars', `${hits.length} placeholder avatar${hits.length === 1 ? '' : 's'} from a generator service (${ppShort((hits[0].getAttribute('src') || '').replace(/^https?:\/\//, ''), 34)})`);
    }

    // AI-voice copy: puffery and faux-insight phrases scored by density.
    if (ruleOk('ai-voice-copy')) {
      const lang = (document.documentElement.lang || '').toLowerCase();
      const prose = nodes.filter(n => !n.el.closest('blockquote, q, cite, pre, code, textarea, [contenteditable], [class*="comment"], [class*="review"], nav, footer'));
      const wordCount = prose.reduce((s, n) => s + n.text.split(' ').length, 0);
      if (wordCount >= 120 && (!lang || lang.startsWith('en'))) {
        let score = 0;
        let sample = '';
        let headlineHit = false;
        let hitEl = null;
        const seen = new Set();
        for (const { text, el } of prose) {
          const inHead = !!el.closest('h1, h2') || !!el.closest('header, [class*="hero"]');
          for (const re of PP_AI_VOICE_PHRASES) {
            const m = re.exec(text);
            if (m && !seen.has(re.source)) { seen.add(re.source); score += 2; sample = sample || m[0]; hitEl = hitEl || el; if (inHead) headlineHit = true; }
          }
          if (el.closest('h1, h2, [class*="hero"] p, header p')) {
            for (const re of PP_AI_VOICE_HEADLINES) {
              if (re.test(text) && !seen.has(re.source)) { seen.add(re.source); score += 2; sample = sample || text; hitEl = hitEl || el; headlineHit = true; }
            }
          }
          PP_AI_VOICE_LEXICON.lastIndex = 0;
          let lm;
          while ((lm = PP_AI_VOICE_LEXICON.exec(text)) !== null) {
            const w = lm[0].toLowerCase();
            if (!seen.has(w)) { seen.add(w); score += 1; sample = sample || lm[0]; hitEl = hitEl || el; }
          }
        }
        if (score >= 4 || (score >= 2 && headlineHit)) add(hitEl || body, 'ai-voice-copy', `Phrasing that reads as generated (score ${score}), e.g. "${ppShort(sample, 48)}"`);
      }
    }

    // Icons in a translucent tint of their own colour, repeated.
    if (ruleOk('tinted-icon-coin')) {
      const bySection = new Map();
      let seen = 0;
      for (const k of body.querySelectorAll('div, span, i')) {
        if (++seen > 4000) break;
        if (k.closest('nav, aside, [role="toolbar"], button, a, [class*="avatar"]') || isElementHidden(k)) continue;
        const r = k.getBoundingClientRect();
        if (r.width < 28 || r.width > 72 || r.height < 28 || r.height > 72 || r.width / r.height > 1.25 || r.height / r.width > 1.25) continue;
        if (k.textContent.trim() && !isEmojiOnlyText(k.textContent.trim())) continue;
        const icons = k.querySelectorAll('svg, i, img');
        if (icons.length !== 1 && !(icons.length === 0 && isEmojiOnlyText(k.textContent.trim()))) continue;
        const cs = getComputedStyle(k);
        if (parseFloat(cs.borderTopLeftRadius) < 6 && !cs.borderTopLeftRadius.includes('%')) continue;
        const bg = parseRgb(cs.backgroundColor);
        if (!bg || !hasChroma(bg, 12)) continue;
        const translucent = bg.a >= 0.04 && bg.a <= 0.25;
        const pale = bg.a >= 0.9 && relativeLuminance(bg) >= 0.75;
        if (!translucent && !pale) continue;
        const icon = icons[0];
        const ic = icon ? parseRgb(getComputedStyle(icon).stroke !== 'none' && parseRgb(getComputedStyle(icon).stroke) ? getComputedStyle(icon).stroke : getComputedStyle(icon).color) : null;
        if (ic && hasChroma(ic, 30)) {
          let d = Math.abs(getHue(bg) - getHue(ic));
          d = Math.min(d, 360 - d);
          if (d > 20) continue;
        } else if (icon) continue;
        const section = k.closest('section') || body;
        const list = bySection.get(section) || [];
        list.push(k);
        bySection.set(section, list);
      }
      for (const list of bySection.values()) {
        if (list.length >= 3) { add(list[0], 'tinted-icon-coin', `${list.length} icons sit in a tinted square of their own colour`); break; }
      }
    }

    // Decorative pulsing "live" dot.
    if (ruleOk('pulsing-dot')) {
      const dots = [];
      let seen = 0;
      for (const el of body.querySelectorAll('span, i, div')) {
        if (++seen > 3000) break;
        const cs = getComputedStyle(el);
        if (cs.animationName === 'none' || !/pulse|ping|blink|breath|glow/i.test(cs.animationName) || cs.animationIterationCount !== 'infinite') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.width > 16 || r.height > 16 || r.width / r.height > 1.5 || r.height / r.width > 1.5) continue;
        if (el.closest('[role="status"], [aria-live], [data-status]')) continue;
        const parent = el.parentElement;
        const sibText = parent ? (parent.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const pill = parent && parseFloat(getComputedStyle(parent).borderTopLeftRadius) >= 99;
        if (/(?:live|online|ready|available|open|new|beta|now|shipping|accepting|active)/i.test(sibText) || pill) dots.push({ el, top: r.top + window.scrollY });
      }
      if (dots.length >= 2 || dots.some(d => d.top < window.innerHeight * 2)) add(dots[0].el, 'pulsing-dot', 'A pulsing status dot with no live data behind it');
    }

    // Text that stays invisible after the scroll pass.
    if (ruleOk('content-hidden-at-rest')) {
      const info = ppHiddenTextBlocks(nodes);
      if (info.total >= 200 && info.hidden >= 150 && info.hidden / info.total > 0.3) {
        const first = [...info.groups.keys()][0];
        add(first || body, 'content-hidden-at-rest', `${Math.round((info.hidden / info.total) * 100)}% of the page text (${info.hidden} characters) is still invisible after scrolling through it`);
      }
    }

    // ── Controls and tokens (axe, Lighthouse and design-token calibration) ──
    if (ruleOk('control-missing-name') || ruleOk('generic-link-text') || ruleOk('placeholder-links')) {
      const sig = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}`;
      const unnamed = [];
      const unnamedSigs = new Set();
      let unnamedCount = 0;
      const generic = new Map();
      const placeholders = [];
      let seen = 0;
      for (const el of body.querySelectorAll('a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]')) {
        if (++seen > 2500) break;
        if (isElementHidden(el) || el.closest(PP_DESIGNED_HIDDEN + ', .audit-overlay, [id^="audit-live-"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 2 && r.height <= 2) continue;
        const cs = getComputedStyle(el);
        if (/rect\(\s*0(?:px)?[ ,]+0(?:px)?[ ,]+0(?:px)?[ ,]+0(?:px)?\s*\)/.test(cs.clip || '') || (r.bottom <= 0 && cs.position !== 'fixed')) continue;
        const name = ppAccessibleName(el);
        if (!name) {
          unnamedCount++;
          if (!unnamedSigs.has(sig(el)) && unnamed.length < 10) { unnamedSigs.add(sig(el)); unnamed.push(el); }
        }
        if (el.tagName === 'A') {
          const norm = name.toLowerCase().replace(/^[\s→›»>↗↘⟶…·|\-–—]+|[\s→›»>↗↘⟶…·|\-–—]+$/g, '').replace(/\s+/g, ' ');
          if (!el.closest('nav, header, footer') && /^(?:click here|click this|go|here|information|learn more|more|more info|more information|right here|read more|see more|start|this)$/.test(norm)) {
            const list = generic.get(norm) || [];
            list.push(el);
            generic.set(norm, list);
          }
          const href = (el.getAttribute('href') || '').replace(/\s+/g, '');
          const framework = Object.keys(el).some(k => k.startsWith('__reactProps$') && el[k] && el[k].onClick) || el._vei?.onClick || [...el.attributes].some(a => /^(?:@|x-on:|v-on:|\(click\)|ng-click)/.test(a.name));
          if (/^(?:#!?|javascript:(?:void\(?0?\)?)?;?)$/i.test(href) && !el.getAttribute('role') && !el.hasAttribute('onclick') && !el.onclick && !framework
            && !el.closest('[role="tablist"], [role="menu"], [role="menubar"]') && !el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-controls') && !el.hasAttribute('aria-haspopup')
            && !el.hasAttribute('data-toggle') && !el.hasAttribute('data-bs-toggle') && !el.hasAttribute('data-action') && !el.hasAttribute('data-target')) placeholders.push(el);
        }
      }
      if (unnamedCount > 0) {
        add(unnamed[0], 'control-missing-name', `${unnamedCount} control${unnamedCount === 1 ? ' has' : 's have'} no accessible name (screen readers announce just "${unnamed[0].tagName.toLowerCase() === 'a' ? 'link' : 'button'}"), e.g. <${sig(unnamed[0])}>`);
      }
      for (const [name, list] of generic) {
        const sections = new Set(list.map(a => a.closest('section, article, li, div')));
        if (list.length >= 3 && sections.size >= 3) { add(list[0], 'generic-link-text', `${list.length} links just say "${name}"; link text should describe the destination`); break; }
      }
      if (placeholders.length >= 3) add(placeholders[0], 'placeholder-links', `${placeholders.length} links point to "#" and have no handler, so they go nowhere`);
    }

    if (ruleOk('token-sprawl')) {
      const sizes = new Map();
      const radii = new Map();
      const shadows = new Map();
      let totalChars = 0;
      let seen = 0;
      for (const el of body.querySelectorAll('*')) {
        if (++seen > 6000) break;
        const tag = el.tagName.toLowerCase();
        if (DESIGN_SKIP_TAGS.has(tag) || /^(?:svg|canvas|img|video|code|pre|path|g)$/.test(tag) || isElementHidden(el)) continue;
        if (el.closest('svg, canvas, pre, code, [class*="chart"], [class*="graph"], .audit-overlay, [id^="audit-live-"]')) continue;
        const cs = getComputedStyle(el);
        if (browserHasDirectText(el)) {
          const chars = [...el.childNodes].filter(n => n.nodeType === 3).reduce((n, t) => n + t.textContent.trim().length, 0);
          const px = Math.round((parseFloat(cs.fontSize) || 0) * 2) / 2;
          const e = sizes.get(px) || { chars: 0, els: 0 };
          e.chars += chars; e.els++;
          sizes.set(px, e);
          totalChars += chars;
        }
        const r = el.getBoundingClientRect();
        if (r.width >= 24 && r.height >= 24) {
          const rad = parseFloat(cs.borderTopLeftRadius) || 0;
          if (rad > 0) { const k = rad >= 9999 || cs.borderTopLeftRadius.includes('%') ? 'full' : String(Math.round(rad)); radii.set(k, (radii.get(k) || 0) + 1); }
          if (cs.boxShadow && cs.boxShadow !== 'none' && !/^inset/.test(cs.boxShadow)) shadows.set(cs.boxShadow.replace(/\d+(?:\.\d+)?px/g, m => `${Math.round(parseFloat(m))}px`), (shadows.get(cs.boxShadow.replace(/\d+(?:\.\d+)?px/g, m => `${Math.round(parseFloat(m))}px`)) || 0) + 1);
        }
      }
      const significant = [...sizes.entries()].filter(([, v]) => v.chars >= totalChars * 0.015 || v.els >= 4).map(([px]) => px).sort((a, b) => a - b);
      const fractional = significant.filter(px => px % 1 !== 0).length >= significant.length / 2;
      const limit = fractional ? 14 : 11;
      let dupes = 0;
      for (let i = 1; i < significant.length; i++) if (significant[i] - significant[i - 1] <= 1 || significant[i] / significant[i - 1] <= 1.07) dupes++;
      const reasons = [];
      if (significant.length >= limit) reasons.push(`${significant.length} font sizes in real use (${significant.slice(0, 8).join(', ')}px…)`);
      else if (dupes >= 2) reasons.push(`${dupes} near-duplicate font sizes (${significant.join(', ')}px)`);
      const radiiUsed = [...radii.entries()].filter(([, n]) => n >= 3);
      if (radiiUsed.length > 5) reasons.push(`${radiiUsed.length} different corner radii`);
      const shadowsUsed = [...shadows.entries()].filter(([, n]) => n >= 3);
      if (shadowsUsed.length > 5) reasons.push(`${shadowsUsed.length} different box shadows`);
      if (reasons.length) add(body, 'token-sprawl', `No shared scale: ${reasons.join('; ')}`);
    }
  }

  function collectPixelpushExtras(groupMap, ruleOk) {
    const add = (el, id, detail, ignoreValue) => {
      if (!ruleOk(id) || !el) return;
      const existing = groupMap.get(el) || [];
      if (existing.some(f => (f.type || f.id) === id)) return;
      addBrowserFindings(groupMap, el, [{ type: id, detail, ...(ignoreValue ? { ignoreValue } : {}) }]);
    };
    const body = document.body;
    if (!body) return;

    // Page-level document checks.
    if (!(document.documentElement.getAttribute('lang') || '').trim()) {
      add(body, 'missing-lang', 'The <html> element has no lang attribute');
    }
    const h1s = [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')].filter(h => !isElementHidden(h) && !h.closest('.audit-overlay, [id^="audit-live-"]'));
    if (h1s.length === 0) add(body, 'heading-one', 'The page has no <h1>');

    // Elements: one pass.
    const targets = [];
    const emojiOnly = [];
    const glass = [];
    let all = 0;
    for (const el of body.querySelectorAll('*')) {
      if (++all > 6000) break;
      if (el.closest('.audit-overlay, .audit-label, .audit-banner, .audit-tooltip, [id^="audit-live-"]')) continue;
      const tag = el.tagName.toLowerCase();
      if (DESIGN_SKIP_TAGS.has(tag) || isElementHidden(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      if (tag === 'img') {
        const rect = el.getBoundingClientRect();
        const src = el.getAttribute('src');
        const lazy = el.loading === 'lazy' || el.hasAttribute('data-src') || el.hasAttribute('data-lazy-src') || el.hasAttribute('srcset');
        if (src === null && !lazy) add(el, 'broken-image', '<img> has no src');
        else if (src !== null && src.trim() === '' && !lazy) add(el, 'broken-image', '<img> has an empty src');
        else if (src && PP_PLACEHOLDER_IMG_RE.test(src)) add(el, 'broken-image', `Placeholder image: ${ppShort(src, 50)}`);
        else if (el.complete && el.naturalWidth === 0 && el.currentSrc && !el.currentSrc.startsWith('data:')) add(el, 'broken-image', `Image failed to load: ${ppShort(el.currentSrc, 50)}`);
        const decorative = el.getAttribute('role') === 'presentation' || el.getAttribute('role') === 'none' || el.getAttribute('aria-hidden') === 'true';
        const named = (el.getAttribute('aria-label') || '').trim() || (el.getAttribute('title') || '').trim()
          || ((el.getAttribute('aria-labelledby') || '').split(/\s+/).some(id => (document.getElementById(id)?.textContent || '').trim()));
        if (!el.hasAttribute('alt') && !decorative && !named && (rect.width >= 8 || rect.height >= 8)) {
          add(el, 'missing-alt', `<img${src ? ` src="${ppShort(src.split('/').pop(), 36)}"` : ''}> has no alt attribute`);
        } else if (el.hasAttribute('alt') && !decorative && (/\.(?:jpe?g|png|webp|gif|svg|avif)$/i.test(el.alt.trim()) || /^(?:img|image|dsc|screenshot)[-_ ]?\d+$/i.test(el.alt.trim()))) {
          add(el, 'missing-alt', `alt text "${ppShort(el.alt, 30)}" is a file name, not a description`);
        }
      }

      if ((tag === 'input' || tag === 'select' || tag === 'textarea')) {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type) && !el.disabled) {
          const named = (el.labels && el.labels.length > 0) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
          if (!named) {
            const ph = el.getAttribute('placeholder');
            add(el, 'input-no-label', ph
              ? `Field "${ppShort(ph, 30)}" has only a placeholder; it disappears as soon as someone types`
              : `${tag}${type !== 'text' && tag === 'input' ? `[type=${type}]` : ''} has no label`);
          }
        }
      }

      const interactive = tag === 'a' ? el.hasAttribute('href')
        : tag === 'button' || tag === 'summary' || tag === 'select' || (tag === 'input' && !['hidden'].includes((el.getAttribute('type') || '').toLowerCase()))
          || ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch'].includes(el.getAttribute('role'));
      if (interactive && !el.disabled && !(tag === 'a' && ppIsInlineLink(el))) {
        const r = el.getBoundingClientRect();
        const visuallyHidden = (r.width <= 2 && r.height <= 2) || (/rect\(\s*0(?:px)?[ ,]+0(?:px)?[ ,]+0(?:px)?[ ,]+0(?:px)?\s*\)/.test(cs.clip || '') && /absolute|fixed/.test(cs.position))
          || /inset\((?:[5-9]\d|100)%/.test(cs.clipPath || '');
        const offscreen = cs.position !== 'fixed' && (r.bottom <= 0 || r.right <= 0);
        const inert = cs.pointerEvents === 'none' || el.getAttribute('aria-disabled') === 'true'
          || (el.getAttribute('tabindex') === '-1' && !el.getAttribute('role'));
        const nativeBox = tag === 'input' && /^(?:checkbox|radio)$/i.test(el.getAttribute('type') || '') && !el.style.width && !el.style.height;
        if (r.width > 0 && r.height > 0 && !visuallyHidden && !offscreen && !inert && !nativeBox) {
          targets.push({ el, r, label: ppShort(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || tag, 24), href: tag === 'a' ? (() => { try { const u = new URL(el.getAttribute('href'), document.baseURI); return /^javascript:/i.test(u.href) || u.hash === '' && /#$/.test(u.href) ? '' : u.href; } catch { return ''; } })() : '' });
        }
      }

      if (tag === 'a' && el.hasAttribute('href') && ppIsInlineLink(el) && !el.closest('nav, footer')) {
        let block = el.parentElement;
        while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
        block = block || el.parentElement;
        const bcs = getComputedStyle(block);
        const linkC = parseRgb(cs.color);
        const textC = parseRgb(bcs.color);
        const border = (side) => (parseFloat(cs[`border${side}Width`]) || 0) > 0 && cs[`border${side}Style`] !== 'none';
        const distinct = /underline|overline|line-through/.test(cs.textDecorationLine || '')
          || cs.textDecorationLine !== bcs.textDecorationLine || cs.textDecorationStyle !== bcs.textDecorationStyle
          || (cs.backgroundImage && cs.backgroundImage !== 'none') || border('Top') || border('Bottom')
          || ((parseFloat(cs.outlineWidth) || 0) > 0 && cs.outlineStyle !== 'none')
          || /inset\s+0(?:px)?\s+-[1-9]/.test(cs.boxShadow || '')
          || browserPrimaryFont(cs.fontFamily) !== browserPrimaryFont(bcs.fontFamily)
          || cs.fontStyle !== bcs.fontStyle || cs.fontSize !== bcs.fontSize
          || Math.abs((parseInt(cs.fontWeight, 10) || 400) - (parseInt(bcs.fontWeight, 10) || 400)) >= 100;
        // Decorative ::before/::after underlines are the usual false positive: leave those to the human.
        const pseudo = ['::before', '::after'].some(p => { const pc = getComputedStyle(el, p); return pc.content !== 'none' && pc.content !== 'normal' && (parseFloat(pc.height) <= 3 || pc.position === 'absolute'); });
        if (linkC && textC && !distinct && !pseudo && contrastRatio(linkC, textC) < 3) {
          add(el, 'link-not-distinguishable', `Link "${ppShort(el.textContent, 28)}" differs from the surrounding text only by a subtle colour (${contrastRatio(linkC, textC).toFixed(1)}:1); add an underline`);
        }
      }

      // Decorative blurred blob: big, blurred, round, coloured, no text.
      const blur = /blur\(\s*([\d.]+)px/.exec(cs.filter || '');
      const rect0 = (blur || cs.backdropFilter !== 'none') ? el.getBoundingClientRect() : null;
      if (blur && parseFloat(blur[1]) >= 30 && rect0 && rect0.width >= 160 && rect0.height >= 160 && !el.textContent.trim()
        && (parseFloat(cs.borderTopLeftRadius) >= 50 || cs.borderTopLeftRadius.includes('%'))
        && (/gradient\(/.test(cs.backgroundImage) || (readOwnBackgroundColor(el, cs)?.a || 0) > 0.2)) {
        add(el, 'blob-decor', `Blurred gradient blob (${Math.round(rect0.width)}px, blur ${blur[1]}px) used as decoration`);
      }

      const bd = cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none' ? cs.webkitBackdropFilter : '');
      if (/blur/.test(bd)) {
        const bg = readOwnBackgroundColor(el, cs);
        if (bg && bg.a < 0.9) glass.push(el);
      }

      if (browserHasDirectText(el) && isEmojiOnlyText(getDirectText(el)) && !el.closest('button, a, [role="button"]')) emojiOnly.push(el);
    }

    // Tap targets (WCAG 2.2, 2.5.8): under 24x24 unless spacing keeps a 24px circle clear.
    const small = targets.filter(t => t.r.width < 24 || t.r.height < 24);
    let reported = 0;
    for (const t of small) {
      if (reported >= 8) break;
      const cx = t.r.left + t.r.width / 2;
      const cy = t.r.top + t.r.height / 2;
      if (t.r.width >= 240 && t.r.height >= 240) continue;
      const clear = targets.every(o => {
        if (o === t) return true;
        if (t.el.contains(o.el) || o.el.contains(t.el)) return true;
        if (t.href && t.href === o.href) return true; // two links to one place count as one target
        if ((t.el.labels && [...t.el.labels].includes(o.el)) || (o.el.labels && [...o.el.labels].includes(t.el))) return true;
        const dx = Math.max(o.r.left - cx, 0, cx - o.r.right);
        const dy = Math.max(o.r.top - cy, 0, cy - o.r.bottom);
        if (Math.hypot(dx, dy) < 12) return false;
        const oSmall = o.r.width < 24 || o.r.height < 24;
        if (oSmall && Math.hypot(cx - (o.r.left + o.r.width / 2), cy - (o.r.top + o.r.height / 2)) < 24) return false;
        return true;
      });
      if (clear) continue;
      reported++;
      add(t.el, 'small-tap-target', `"${t.label}" is ${Math.round(t.r.width)}×${Math.round(t.r.height)}px and sits close to other controls; WCAG 2.2 asks for 24×24px`);
    }

    if (emojiOnly.length >= 3) add(emojiOnly[0], 'emoji-icons', `${emojiOnly.length} emoji used as icons (${emojiOnly.slice(0, 4).map(e => ppShort(getDirectText(e), 4)).join(' ')})`);
    if (glass.length >= 4) add(glass[0], 'glass-overuse', `${glass.length} translucent blurred glass surfaces on one page`);

    // Visible copy.
    const nodes = ppVisibleTextNodes();
    const proseText = [];
    const buzz = new Map();
    let buzzFirst = null;
    let heroBuzz = false;
    let emDashes = 0;
    let emDashEl = null;
    const aphorisms = [];
    for (const { text, el } of nodes) {
      const tag = el.tagName.toLowerCase();
      if (PP_PLACEHOLDER_COPY_RE.test(text)) {
        add(el, 'placeholder-copy', `Placeholder copy: "${ppShort(text.match(PP_PLACEHOLDER_COPY_RE)[0], 40)}"`);
      }
      if (/^(P|LI|H[1-6]|BLOCKQUOTE|DD|FIGCAPTION)$/i.test(tag) || el.closest('p, li, h1, h2, h3, blockquote')) {
        proseText.push(text);
        const dashes = (text.match(/—|(?<=\w)\s--\s(?=\w)/g) || []).length;
        if (dashes) { emDashes += dashes; emDashEl = emDashEl || el; }
        // Aphoristic cadence: a short "No X." / "Just X." rebuttal, or "Not a X. A Y."
        const sentences = text.split(/(?<=[.!?])\s+/);
        const last = sentences[sentences.length - 1] || '';
        if (sentences.length >= 2 && /^(?:no|just|only|zero)\b[^.!?]{0,30}[.!]$/i.test(last)) aphorisms.push({ el, quote: ppShort(sentences.slice(-2).join(' '), 70) });
        else if (/\bnot (?:a|an|just|only|another)\b[^.!?]{1,40}[.!]\s+(?:a|an|it['’]s|your|the)\b[^.!?]{1,40}[.!]/i.test(text)) aphorisms.push({ el, quote: ppShort(text.match(/\bnot (?:a|an|just|only|another)\b[^.!?]{1,40}[.!]\s+(?:a|an|it['’]s|your|the)\b[^.!?]{1,40}[.!]/i)[0], 70) });
      }
      PP_BUZZ_RE.lastIndex = 0;
      let m;
      while ((m = PP_BUZZ_RE.exec(text)) !== null) {
        const phrase = m[1].toLowerCase();
        buzz.set(phrase, (buzz.get(phrase) || 0) + 1);
        buzzFirst = buzzFirst || el;
        if (el.closest('h1, h2') || (el.closest('p') && el.closest('section, header')?.getBoundingClientRect().top + window.scrollY < window.innerHeight * 1.2)) heroBuzz = true;
      }
    }
    const proseChars = proseText.reduce((n, t) => n + t.length, 0);
    if (emDashes >= 8 && emDashes * 500 >= proseChars) add(emDashEl || body, 'em-dash-overuse', `${emDashes} em-dashes in ${proseChars} characters of body copy`);
    if (buzz.size >= 2 || (buzz.size === 1 && heroBuzz)) {
      add(buzzFirst || body, 'marketing-buzzword', `Generic phrases: ${[...buzz.keys()].slice(0, 5).map(p => `"${p}"`).join(', ')}`);
    }
    if (aphorisms.length >= 3) add(aphorisms[0].el, 'aphoristic-cadence', `${aphorisms.length} blocks end on a punchy rebuttal, e.g. "${aphorisms[0].quote}"`);

    // Numbered section markers: 01 / 02 / 03 as display labels.
    const markers = [];
    for (const { text, el } of nodes) {
      if (/^0[1-9]$/.test(text) && !el.closest('li, td, th, time, a, button')) markers.push({ text, el });
    }
    if (new Set(markers.map(m => m.text)).size >= 3) add(markers[0].el, 'numbered-section-markers', `Numbered markers ${markers.slice(0, 4).map(m => m.text).join(' / ')} used as section labels`);

    // Stat strip: 3-4 big numbers, each with a small caption.
    const BIG_NUM_RE = /^[~<>]?\d[\d.,]*\s?(?:[kKmMbB]|%|x|×)?\+?\s?[★]?$/;
    const statSeen = new Set();
    for (const { text, el } of nodes) {
      if (!BIG_NUM_RE.test(text) || !(parseFloat(getComputedStyle(el).fontSize) >= 28)) continue;
      let cell = el;
      while (cell.parentElement && cell.parentElement !== body && cell.parentElement.children.length < 3) cell = cell.parentElement;
      const row = cell.parentElement;
      if (!row || statSeen.has(row)) continue;
      const cells = [...row.children].filter(c => !isElementHidden(c));
      if (cells.length < 3 || cells.length > 5) continue;
      const nums = cells.map(c => [...c.querySelectorAll('*')].concat(c).find(n => browserHasDirectText(n) && BIG_NUM_RE.test(n.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) >= 28));
      if (nums.filter(Boolean).length >= 3) {
        statSeen.add(row);
        add(row, 'stat-row-cliche', `A row of ${cells.length} headline numbers (${nums.filter(Boolean).slice(0, 3).map(n => n.textContent.trim()).join(', ')}) with small captions`);
      }
    }

    // Identical cards: 3-4 siblings, same structure and size, each a short icon + heading + sentence.
    const cardSeen = new Set();
    for (const h of body.querySelectorAll('h3, h4')) {
      if (isElementHidden(h)) continue;
      const card = h.parentElement;
      const row = card && card.parentElement;
      if (!row || cardSeen.has(row)) continue;
      const kids = [...row.children].filter(k => !isElementHidden(k));
      if (kids.length < 3 || kids.length > 4) continue;
      const sig = elementStructureSignature(kids[0]);
      if (!/(?:div|span|svg|img|i)\+h[34]\+p/.test(sig.replace(/^(?:div|span|svg|img|i)\+/, m => m)) && !/^(?:div|span|svg|img|i|picture)\+h[34]\+p$/.test(sig)) continue;
      if (kids.some(k => elementStructureSignature(k) !== sig)) continue;
      const widths = kids.map(k => Math.round(k.getBoundingClientRect().width));
      if (Math.max(...widths) - Math.min(...widths) > 6) continue;
      const kcs = getComputedStyle(kids[0]);
      const cardLike = (kcs.boxShadow && kcs.boxShadow !== 'none') || (parseFloat(kcs.borderTopWidth) || 0) > 0 || ((readOwnBackgroundColor(kids[0], kcs)?.a || 0) > 0.03 && parseFloat(kcs.borderTopLeftRadius) >= 8);
      if (!cardLike || kids.some(k => (k.textContent || '').trim().length > 260)) continue;
      cardSeen.add(row);
      add(row, 'uniform-card-grid', `${kids.length} identical cards in a row (${sig.replace(/\+/g, ' + ')}), each the same size and structure`);
    }

    collectPixelpushTells({ add, ruleOk, nodes, body });

    // Removed focus outlines in the page's own stylesheets (WCAG 2.4.7).
    if (ruleOk('focus-outline-removed')) {
      const offenders = [];
      const walk = (rules) => {
        for (const rule of rules) {
          if (offenders.length >= 3) return;
          if (rule.cssRules && !rule.selectorText) { try { walk(rule.cssRules); } catch { /* cross-origin */ } continue; }
          const sel = rule.selectorText || '';
          if (!/:focus(?!-visible|-within)/.test(sel) || /:not\(\s*:focus-visible/.test(sel) || sel.includes('\\:')) continue; // utility classes (focus\:outline-none) pair with ring utilities
          const st = rule.style;
          const none = st.outlineStyle === 'none' || st.outline === 'none' || st.outline === '0' || st.outlineWidth === '0px' || /^0(px)?\s+none/.test(st.outline || '');
          if (!none) continue;
          const replaced = (st.boxShadow && st.boxShadow !== 'none') || st.borderColor || st.border || st.background || st.backgroundColor || st.textDecoration;
          if (!replaced) offenders.push(ppShort(sel, 50));
        }
      };
      let restyled = false;
      const scanVisible = (rules) => {
        for (const rule of rules) {
          if (restyled) return;
          if (rule.cssRules && !rule.selectorText) { try { scanVisible(rule.cssRules); } catch { /* cross-origin */ } continue; }
          if (/:focus-visible/.test(rule.selectorText || '') && (rule.style.outlineStyle !== 'none' && (rule.style.outlineWidth || rule.style.outline) || rule.style.boxShadow || rule.style.borderColor)) restyled = true;
        }
      };
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        if (rules) { walk(rules); scanVisible(rules); }
      }
      if (offenders.length && !restyled) add(body, 'focus-outline-removed', `${offenders.join(', ')} removes the focus outline and offers no replacement`);
    }

    // Horizontal overflow of the page itself.
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 4 && getComputedStyle(root).overflowX !== 'hidden' && getComputedStyle(body).overflowX !== 'hidden') {
      let culprit = null;
      for (const el of body.querySelectorAll('*')) {
        if (el.closest('.audit-overlay, [id^="audit-live-"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.right > root.clientWidth + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed' && !isElementHidden(el)) { culprit = el; break; }
      }
      add(culprit || body, 'horizontal-overflow', `The page scrolls sideways: content is ${root.scrollWidth - root.clientWidth}px wider than the viewport`);
    }
  }

  // ── Pixelpush additions: page settling (auto-scroll) ────────────────────
  // Lazy-loaded images, reveal-on-scroll sections and infinite lists only exist
  // after the page has been scrolled, so a scan of the untouched DOM misses them.
  // settlePage() walks the page once, then puts the reader back where they were.

  const SETTLE_DEFAULTS = {
    maxMs: 6000,        // hard wall-clock budget
    maxSteps: 48,       // scroll steps
    maxViewports: 30,   // never walk past this many viewport heights (infinite feeds)
    stepRatio: 0.7,     // each step is 70% of a viewport (clamped 240-900px) so nothing is skipped
    stepDelayMs: 130,   // pause after each step for observers, lazy images and transitions
    bottomWaitMs: 350,  // extra wait at the bottom to catch infinite-scroll growth
  };

  function auditPause(ms) {
    // setTimeout only: requestAnimationFrame is paused in hidden tabs.
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function postAuditProgress(config, phase, extra = {}) {
    if (!EXTENSION_MODE) return;
    window.postMessage({
      source: 'audit-progress',
      phase,
      ...(config && config.scanId != null ? { scanId: String(config.scanId) } : {}),
      ...extra,
    }, '*');
  }

  // The element that actually scrolls: the document, or (for app shells with
  // `overflow: auto` on a main pane) the biggest inner scroll container.
  function findPrimaryScroller() {
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollHeight - root.clientHeight > 40) return { el: root, isDocument: true };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let best = null;
    let bestOverflow = 0;
    let seen = 0;
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      if (++seen > 6000) break;
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow < 80 || el.clientWidth * el.clientHeight < vw * vh * 0.35) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
      if (overflow > bestOverflow) { best = el; bestOverflow = overflow; }
    }
    return best ? { el: best, isDocument: false } : { el: root, isDocument: true };
  }

  // Overlapping passes (a rescan while one is scrolling) must restore to the reader's
  // original spot, not to wherever the earlier pass had got to.
  let settleOrigin = null;
  let settleDepth = 0;
  let lastSettleStats = null; // coverage of the latest pass, shared with the AI digest

  async function settlePage(config = {}, control = {}) {
    const opts = {
      ...SETTLE_DEFAULTS,
      ...(Number.isFinite(config.autoScrollMaxMs) ? { maxMs: Math.max(500, Math.min(15000, config.autoScrollMaxMs)) } : {}),
    };
    const isCurrent = control.isCurrent || (() => true);
    const { el: scroller, isDocument } = findPrimaryScroller();
    const clientHeight = () => (isDocument ? window.innerHeight : scroller.clientHeight);
    const totalHeight = () => scroller.scrollHeight;
    const getTop = () => (isDocument ? window.scrollY : scroller.scrollTop);
    const setTop = (y) => {
      if (isDocument) window.scrollTo({ top: y, left: window.scrollX, behavior: 'instant' });
      else scroller.scrollTop = y;
    };

    if (!settleOrigin || settleOrigin.scroller !== scroller) {
      settleOrigin = { scroller, top: getTop(), left: isDocument ? window.scrollX : scroller.scrollLeft };
    }
    const startTop = settleOrigin.top;
    const startLeft = settleOrigin.left;
    const heightBefore = totalHeight();
    const stats = { scrolled: false, steps: 0, heightBefore, heightAfter: heightBefore, hitCap: false, interrupted: false, blocked: false, feed: 'finite', stoppedBy: 'bottom', scrolledPx: 0, container: isDocument ? 'document' : generateSelector(scroller) };
    lastSettleStats = stats;
    const startPath = location.pathname + location.search;

    // Nothing to walk: the page already fits in one screen.
    if (heightBefore - clientHeight() < 40) { if (settleDepth === 0) settleOrigin = null; return stats; }
    settleDepth++;

    // Smooth scrolling would turn every step into an animation; force instant jumps.
    const htmlEl = document.documentElement;
    const savedHtmlBehavior = htmlEl.style.scrollBehavior;
    const savedScrollerBehavior = scroller.style.scrollBehavior;
    htmlEl.style.scrollBehavior = 'auto';
    if (!isDocument) scroller.style.scrollBehavior = 'auto';

    // A person scrolling or typing always wins over the scan.
    let interrupted = false;
    // Only real input counts: pages that dispatch synthetic wheel or key events must not cancel the scan.
    const onUser = (e) => {
      if (e.isTrusted === false) return;
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      interrupted = true;
    };
    const userEvents = ['wheel', 'touchstart', 'keydown', 'mousedown', 'pointerdown'];
    for (const ev of userEvents) window.addEventListener(ev, onUser, { capture: true, passive: true });

    const started = Date.now();
    try {
      let y = startTop;
      let stable = 0;
      const step = Math.min(900, Math.max(240, Math.round(clientHeight() * opts.stepRatio)));
      let stall = 0;
      let growth = 0;
      let prevActual = getTop();
      const maxTop = clientHeight() * opts.maxViewports;
      postAuditProgress(config, 'scrolling', { pct: 0 });

      while (stats.steps < opts.maxSteps && Date.now() - started < opts.maxMs && isCurrent() && !interrupted) {
        // A hidden tab throttles timers and never runs IntersectionObservers; a route change makes the walk meaningless.
        if (document.visibilityState !== 'visible') { stats.stoppedBy = 'hidden'; break; }
        if (location.pathname + location.search !== startPath) { interrupted = true; stats.stoppedBy = 'navigated'; break; }
        const limit = Math.max(0, totalHeight() - clientHeight());
        const next = Math.min(y + step, limit, maxTop);
        const moving = next > y + 1;
        if (moving) {
          setTop(next);
          stats.steps++;
          stats.scrolled = true;
        }
        await auditPause(opts.stepDelayMs);
        // Lazy images that entered the viewport get a short grace period to load.
        for (let w = 0; w < 9; w++) {
          const loading = [...document.images].some(img => { const r = img.getBoundingClientRect(); return !img.complete && r.bottom > 0 && r.top < window.innerHeight; });
          if (!loading) break;
          await auditPause(50);
        }
        // Trust the browser, not our intent: scroll locks, overflow:clip and snap-back stop us moving.
        const actual = getTop();
        const moved = actual - prevActual;
        prevActual = actual;
        y = actual;
        if (moving && moved < step * 0.25 && actual < limit - 2) {
          if (++stall >= 3) { stats.blocked = true; stats.stoppedBy = 'blocked'; break; }
        } else {
          stall = 0;
        }
        stats.scrolledPx = Math.max(stats.scrolledPx, Math.round(actual - startTop));
        const nowLimit = Math.max(0, totalHeight() - clientHeight());
        postAuditProgress(config, 'scrolling', { pct: nowLimit > 0 ? Math.min(1, y / nowLimit) : 1 });
        if (y >= maxTop - 1) { stats.hitCap = true; stats.stoppedBy = 'distance'; break; }
        if (y >= nowLimit - 2) {
          // At the bottom: give lazy content and infinite scroll a moment to extend the page.
          const before = totalHeight();
          await auditPause(opts.bottomWaitMs);
          const grew = totalHeight() - before;
          if (grew <= 2) {
            if (++stable >= 2) break;
          } else {
            stable = 0;
            if (grew >= clientHeight() * 0.5 && ++growth >= 3) { stats.feed = 'infinite'; stats.stoppedBy = 'feed'; break; }
          }
        }
      }
      if (stats.steps >= opts.maxSteps || Date.now() - started >= opts.maxMs) { stats.hitCap = true; if (stats.stoppedBy === 'bottom') stats.stoppedBy = stats.steps >= opts.maxSteps ? 'steps' : 'time'; }
      // Reveal-on-view blocks that the walk did not trigger: nudge each one into the middle of the screen.
      if (!interrupted && isCurrent()) await ppProbeHiddenBlocks(setTop, () => isCurrent() && !interrupted);
      stats.interrupted = interrupted;
      if (interrupted && stats.stoppedBy === 'bottom') stats.stoppedBy = 'interrupted';
    } finally {
      for (const ev of userEvents) window.removeEventListener(ev, onUser, { capture: true });
      // Put the reader back (the last overlapping pass does it), then let observers and
      // transitions settle before we measure.
      settleDepth--;
      if (settleDepth === 0) {
        if (!interrupted) {
          if (isDocument) window.scrollTo({ top: startTop, left: startLeft, behavior: 'instant' });
          else { scroller.scrollTop = startTop; scroller.scrollLeft = startLeft; }
        }
        settleOrigin = null;
      }
      htmlEl.style.scrollBehavior = savedHtmlBehavior;
      if (!isDocument) scroller.style.scrollBehavior = savedScrollerBehavior;
      await auditPause(450);
    }
    stats.heightAfter = totalHeight();
    if (stats.heightAfter / Math.max(1, stats.heightBefore) >= 2.5) stats.feed = 'infinite';
    postAuditProgress(config, 'scanning');
    return stats;
  }

  let activeScanToken = 0;
  async function runExtensionScan(config = {}) {
    const token = ++activeScanToken;
    try {
      if (config.autoScroll !== false) {
        await settlePage(config, { isCurrent: () => token === activeScanToken });
        if (token !== activeScanToken) return; // a newer scan took over
      }
      scan(config);
    } catch (err) {
      postExtensionError(err);
    }
  }

  // ── Pixelpush additions: compact page digest for the AI review ──────────
  // A bounded, privacy-conscious outline of the page: structure, copy excerpts and
  // style statistics. No HTML, no form values, no URLs. Every element the model may
  // cite gets an opaque ref ("e1"); the panel maps refs back to selectors, so a
  // finding that cites an unknown ref is dropped instead of invented.

  const DIGEST_MAX_BYTES = 14000;

  function redactDigestText(value, max = 160) {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    text = text
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/\b[A-Za-z0-9_-]{28,}\b/g, '[token]')
      .replace(/\+?\d[\d\s().-]{8,}\d/g, '[number]');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function bumpCount(map, key) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  }

  function topCounts(map, n) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  function elementStructureSignature(el) {
    const parts = [];
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') continue;
      parts.push(tag);
      if (parts.length >= 6) break;
    }
    return parts.join('+');
  }

  // A row of 3+ siblings that share one structure (the "three feature cards" shape).
  function findRepeatedGroup(section) {
    let best = null;
    const scan = [section, ...section.querySelectorAll('*')].slice(0, 400);
    for (const container of scan) {
      const kids = [...container.children].filter(c => {
        const r = c.getBoundingClientRect();
        return r.width > 80 && r.height > 60 && !isElementHidden(c);
      });
      if (kids.length < 3 || kids.length > 12) continue;
      const sig = elementStructureSignature(kids[0]);
      if (!sig || sig.split('+').length < 2) continue;
      const same = kids.filter(k => elementStructureSignature(k) === sig).length;
      if (same < 3 || same / kids.length < 0.75) continue;
      if (!best || same > best.count) best = { count: same, signature: sig, ref: container };
    }
    return best;
  }

  function buildPageDigest() {
    const refByEl = new Map();
    const refs = {};
    let refN = 0;
    const refOf = (el) => {
      if (refByEl.has(el)) return refByEl.get(el);
      const id = `e${++refN}`;
      refByEl.set(el, id);
      try { refs[id] = generateSelector(el); } catch { refs[id] = el.tagName.toLowerCase(); }
      return id;
    };

    const fonts = new Map();
    const sizes = new Map();
    const weights = new Map();
    const textColors = new Map();
    const bgColors = new Map();
    const radii = new Map();
    const stats = {
      elements: 0, gradients: 0, glass: 0, blurDecor: 0, shadows: 0, emojiHeadings: 0,
      images: 0, imagesNoAlt: 0, imagesBroken: 0, lazyImages: 0,
      inputs: 0, inputsUnlabelled: 0, smallTargets: 0, fixedOrSticky: 0, h1: 0, emojiOnly: 0,
    };

    let seen = 0;
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      if (++seen > 6000) break;
      if (el.closest('.audit-overlay, .audit-label, .audit-banner, .audit-tooltip, [id^="audit-live-"]')) continue;
      const tag = el.tagName.toLowerCase();
      if (DESIGN_SKIP_TAGS.has(tag) || isElementHidden(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      stats.elements++;

      if (tag === 'img') {
        stats.images++;
        if (!el.hasAttribute('alt')) stats.imagesNoAlt++;
        if (el.complete && el.naturalWidth === 0 && el.currentSrc) stats.imagesBroken++;
        if (el.loading === 'lazy') stats.lazyImages++;
      }
      if (tag === 'h1') stats.h1++;
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) {
          stats.inputs++;
          const labelled = el.labels?.length > 0 || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
          if (!labelled) stats.inputsUnlabelled++;
        }
      }

      const hasText = browserHasDirectText(el);
      if (hasText) {
        bumpCount(fonts, browserPrimaryFont(cs.fontFamily || ''));
        bumpCount(sizes, `${Math.round(parseFloat(cs.fontSize) || 0)}px`);
        bumpCount(weights, String(cs.fontWeight));
        const tc = parseRgb(cs.color);
        if (tc) bumpCount(textColors, colorToHex(tc));
      }
      const bg = readOwnBackgroundColor(el, cs);
      if (bg && bg.a > 0.5) bumpCount(bgColors, colorToHex(bg));
      if (cs.backgroundImage && /gradient\(/.test(cs.backgroundImage)) stats.gradients++;
      const backdrop = cs.backdropFilter || cs.webkitBackdropFilter;
      if (backdrop && backdrop !== 'none' && /blur/.test(backdrop)) stats.glass++;
      const blurMatch = /blur\(\s*([\d.]+)px/.exec(cs.filter || '');
      if (blurMatch && parseFloat(blurMatch[1]) >= 30 && (parseFloat(cs.borderTopLeftRadius) >= 50 || cs.borderRadius.includes('%'))) stats.blurDecor++;
      if (cs.boxShadow && cs.boxShadow !== 'none') stats.shadows++;
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      if (radius > 0) bumpCount(radii, `${Math.round(radius)}px`);
      if (cs.position === 'fixed' || cs.position === 'sticky') stats.fixedOrSticky++;
      if (/^h[1-6]$/.test(tag) && EMOJI_CHAR_RE.test(el.textContent || '')) stats.emojiHeadings++;
      if (hasText && isEmojiOnlyText(getDirectText(el))) stats.emojiOnly++;
      if ((tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button') && hasText) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.width < 24 || r.height < 24)) stats.smallTargets++;
      }
    }

    // Heading outline.
    const headings = [];
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (headings.length >= 28) break;
      if (isElementHidden(h)) continue;
      const text = redactDigestText(h.textContent, 90);
      if (text) headings.push({ ref: refOf(h), level: Number(h.tagName[1]), text });
    }

    // Calls to action.
    const ctas = [];
    for (const a of document.querySelectorAll('a,button,[role="button"]')) {
      if (ctas.length >= 14) break;
      if (isElementHidden(a)) continue;
      const text = redactDigestText(a.textContent, 40);
      if (!text || text.length < 2) continue;
      const cs = getComputedStyle(a);
      const bg = readOwnBackgroundColor(a, cs);
      const gradient = /gradient\(/.test(cs.backgroundImage || '');
      const filled = !!(bg && bg.a > 0.5) || gradient;
      const bordered = (parseFloat(cs.borderTopWidth) || 0) > 0;
      if (!filled && !bordered && a.tagName !== 'BUTTON') continue; // plain text links are noise here
      ctas.push({ ref: refOf(a), text, style: gradient ? 'gradient' : filled ? 'filled' : bordered ? 'outline' : 'plain' });
    }

    // Top-level sections.
    let root = document.querySelector('main') || document.body;
    for (let i = 0; i < 3; i++) {
      const kids = [...root.children].filter(c => !DESIGN_SKIP_TAGS.has(c.tagName.toLowerCase()) && !isElementHidden(c));
      if (kids.length === 1 && kids[0].getBoundingClientRect().height > window.innerHeight * 0.8) root = kids[0];
      else break;
    }
    const sections = [];
    for (const sec of root.children) {
      if (sections.length >= 16) break;
      const tag = sec.tagName.toLowerCase();
      if (DESIGN_SKIP_TAGS.has(tag) || isElementHidden(sec) || sec.closest('.audit-overlay, [id^="audit-live-"]')) continue;
      const r = sec.getBoundingClientRect();
      if (r.height < 100 || r.width < window.innerWidth * 0.4) continue;
      if (!(sec.innerText || '').trim() && !sec.querySelector('img,svg,picture,video,canvas')) continue; // empty spacer
      const cs = getComputedStyle(sec);
      const heading = sec.querySelector('h1,h2,h3');
      const bg = readOwnBackgroundColor(sec, cs);
      const group = findRepeatedGroup(sec);
      const entry = {
        ref: refOf(sec),
        tag,
        y: Math.round(r.top + window.scrollY),
        h: Math.round(r.height),
        heading: heading ? redactDigestText(heading.textContent, 90) : '',
        text: redactDigestText(sec.innerText || sec.textContent, 200),
        bg: bg && bg.a > 0.3 ? colorToHex(bg) : (/gradient\(/.test(cs.backgroundImage) ? 'gradient' : ''),
        align: cs.textAlign === 'center' ? 'center' : '',
        images: sec.querySelectorAll('img,svg,picture').length,
        buttons: sec.querySelectorAll('a[class*="btn"],a[class*="button"],button').length,
      };
      if (group) entry.repeat = { ref: refOf(group.ref), count: group.count, structure: group.signature };
      sections.push(entry);
    }

    const copy = [];
    const h1 = document.querySelector('h1');
    if (h1) copy.push(`h1: ${redactDigestText(h1.textContent, 140)}`);
    const lead = h1 && (h1.nextElementSibling || h1.parentElement?.querySelector('p'));
    if (lead && lead.tagName === 'P') copy.push(`lead: ${redactDigestText(lead.textContent, 180)}`);
    for (const c of ctas.slice(0, 6)) copy.push(`cta: ${c.text}`);

    // A few prose samples (start, middle, end) so the model can judge voice and specificity.
    const proseBlocks = [];
    for (const p of document.querySelectorAll('p, blockquote, li')) {
      if (isElementHidden(p) || p.closest('nav, footer, pre, code, [contenteditable], .audit-overlay, [id^="audit-live-"]')) continue;
      const t = redactDigestText(p.textContent, 220);
      if (t.length >= 60) proseBlocks.push({ ref: refOf(p), text: t });
    }
    const pickAt = [0, 1, Math.floor(proseBlocks.length / 2) - 1, Math.floor(proseBlocks.length / 2), proseBlocks.length - 2, proseBlocks.length - 1];
    const copySample = [...new Set(pickAt.filter(i => i >= 0 && i < proseBlocks.length))].map(i => proseBlocks[i]);
    const heroEl = document.querySelector('h1');
    const hero = heroEl ? (() => {
      const hr = heroEl.getBoundingClientRect();
      const hcs = getComputedStyle(heroEl);
      const box = heroEl.closest('section, header, main > div') || heroEl.parentElement;
      return {
        h1Words: (heroEl.textContent || '').trim().split(/\s+/).filter(Boolean).length,
        h1Px: Math.round(parseFloat(hcs.fontSize) || 0),
        align: hcs.textAlign === 'center' ? 'center' : 'start',
        mediaInFirstScreen: !!(box && [...box.querySelectorAll('img, video, canvas, svg')].some(m => { const r = m.getBoundingClientRect(); return r.width >= 240 && r.height >= 160 && r.top < window.innerHeight; })),
        ctasInFirstScreen: ctas.filter(c => { const el = document.querySelector(refs[c.ref] || ''); return el && el.getBoundingClientRect().top < window.innerHeight; }).length,
        top: Math.round(hr.top + window.scrollY),
      };
    })() : null;

    const landmarks = ['header', 'nav', 'main', 'footer', 'aside'].filter(t => document.querySelector(t));
    const digest = {
      v: 1,
      title: redactDigestText(document.title, 100),
      lang: document.documentElement.lang || '',
      viewport: { w: window.innerWidth, h: window.innerHeight },
      page: { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth, landmarks, hasViewportMeta: !!document.querySelector('meta[name="viewport"]') },
      stats,
      type: {
        families: topCounts(fonts, 5),
        sizes: topCounts(sizes, 10),
        distinctSizes: sizes.size,
        weights: topCounts(weights, 6),
      },
      color: {
        text: topCounts(textColors, 6),
        background: topCounts(bgColors, 8),
        distinctText: textColors.size,
        distinctBackground: bgColors.size,
        accentHues: (() => { const bins = new Set(); for (const map of [textColors, bgColors]) for (const [hex] of map) { const c = parseRgb(`rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`); if (c && hasChroma(c, 60)) bins.add(Math.floor(getHue(c) / 28)); } return bins.size; })(),
      },
      radii: { top: topCounts(radii, 6), distinct: radii.size },
      headings,
      ctas,
      sections,
      copy,
      copySample,
      hero,
      coverage: lastSettleStats ? {
        stoppedBy: lastSettleStats.stoppedBy, scrolledPx: lastSettleStats.scrolledPx, pageHeightStart: lastSettleStats.heightBefore,
        pageHeightEnd: lastSettleStats.heightAfter, complete: !['time', 'steps', 'distance', 'blocked', 'hidden', 'navigated', 'interrupted', 'feed'].includes(lastSettleStats.stoppedBy), feed: lastSettleStats.feed,
      } : { stoppedBy: 'not-scrolled' },
    };

    // Stay inside the budget: shed the least useful detail first.
    const fit = () => JSON.stringify(digest).length <= DIGEST_MAX_BYTES;
    for (const trim of [
      () => { digest.headings.length = Math.min(digest.headings.length, 16); },
      () => { for (const s of digest.sections) s.text = s.text.slice(0, 100); },
      () => { digest.ctas.length = Math.min(digest.ctas.length, 8); },
      () => { digest.sections.length = Math.min(digest.sections.length, 10); },
      () => { digest.headings.length = Math.min(digest.headings.length, 8); digest.copy.length = Math.min(digest.copy.length, 4); },
    ]) {
      if (fit()) break;
      trim();
    }
    // Drop refs the trimmed digest no longer mentions.
    const used = new Set(JSON.stringify(digest).match(/"e\d+"/g)?.map(s => s.slice(1, -1)) || []);
    for (const id of Object.keys(refs)) if (!used.has(id)) delete refs[id];

    return { digest, refs };
  }

  if (EXTENSION_MODE) {
    // Extension mode: listen for commands, don't auto-scan
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.source !== 'audit-command') return;
      if (e.data.action === 'scan') {
        if (e.data.config) window.__AUDIT_CONFIG__ = e.data.config;
        runExtensionScan(e.data.config || {});
      }
      if (e.data.action === 'digest') {
        try {
          const { digest, refs } = buildPageDigest();
          window.postMessage({ source: 'audit-digest', requestId: String(e.data.requestId || ''), digest, refs }, '*');
        } catch (err) {
          window.postMessage({ source: 'audit-digest', requestId: String(e.data.requestId || ''), error: err?.message || String(err) }, '*');
        }
      }
      if (e.data.action === 'toggle-overlays') {
        const visible = !document.body.classList.contains('audit-hidden');
        document.body.classList.toggle('audit-hidden', visible);
        window.postMessage({ source: 'audit-overlays-toggled', visible: !visible }, '*');
      }
      if (e.data.action === 'remove') {
        clearOverlays();
        styleEl.remove();
        if (spotlightBackdrop) { spotlightBackdrop.remove(); spotlightBackdrop = null; }
        document.body.classList.remove('audit-hidden');
      }
      if (e.data.action === 'highlight') {
        try {
          const target = e.data.selector ? document.querySelector(e.data.selector) : null;
          if (target) {
            // Scroll first so positionOverlay reads the post-scroll rect
            if (!isInViewport(target) && target.scrollIntoView) {
              target.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
            for (const o of overlays) {
              if (o.classList.contains('audit-banner')) continue;
              const isMatch = o._targetEl === target;
              o.classList.toggle('audit-spotlight', isMatch);
              o.classList.toggle('audit-spotlight-dimmed', !isMatch);
              if (isMatch) {
                // Force the matching overlay visible immediately, don't wait for IntersectionObserver
                o.style.display = '';
                o.style.animation = 'none';
                o.classList.add('audit-visible');
                o._revealed = true;
                positionOverlay(o);
              }
            }
            showSpotlight(target);
          }
        } catch { /* invalid selector */ }
      }
      if (e.data.action === 'unhighlight') {
        hideSpotlight();
        for (const o of overlays) {
          o.classList.remove('audit-spotlight');
          o.classList.remove('audit-spotlight-dimmed');
        }
      }
    });
    window.postMessage({ source: 'audit-ready' }, '*');
  } else {
    if (window.__AUDIT_CONFIG__?.autoScan !== false) {
      const runAutoScan = () => {
        try {
          scan();
        } catch (err) {
          console.warn('[audit] scan failed', err);
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(runAutoScan, 100));
      } else {
        setTimeout(runAutoScan, 100);
      }
    }
  }

  window.auditDetect = detect;
  window.auditDetectAsync = detectAsync;
  window.auditScan = scan;
  window.auditScanAsync = scanAsync;
  window.auditCollectVisualContrastCandidates = collectVisualContrastCandidates;
  window.auditAnalyzeVisualContrast = analyzeVisualContrast;
  window.auditGetLastVisualContrastAnalyses = () => lastVisualContrastAnalyses.slice();
}

})();
