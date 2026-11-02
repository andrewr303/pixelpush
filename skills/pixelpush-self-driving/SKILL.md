---
name: pixelpush-self-driving
description: Autonomous design critique and UI annotation mode for Pixelpush. Systematically walks a live web page across 6 visual/UX dimensions, measures computed styles and tokens, scrolls elements into view with spotlight feedback, and attaches numbered AFS v1.1+ annotations with concrete CSS/token recommendations.
---

# Pixelpush Self-Driving Critique Mode

Use Pixelpush's in-page annotation overlay and Side Panel as a **visual feedback and autonomous critique surface** to systematically review a live web page, attach numbered AFS v1.1+ annotations to specific DOM elements, and generate actionable CSS/token fixes.

## Core Principles

1. **Ground Every Critique in Measured Computed Styles & Tokens**:
   - Inspect actual `computedStyles`, `forensicStyles`, `boundingBox`, contrast ratios, `reactComponents`, and `sourceFile` telemetry before writing a note.
   - Never leave vague remarks like *"improve spacing"* or *"make this pop"*.
2. **Name the Design Principle + Exact Replacement Values**:
   - Every annotation must be **2–3 sentences maximum**:
     - Sentence 1: Identify the specific visual, structural, typographic, contrast, or conversion issue and the underlying design principle (e.g., *Figure-Ground Contrast*, *Typographic Scale & Measure*, *Gestalt Proximity*, *Fitts's Law Target Sizing*, *Visual Hierarchy*, *Anti-Slop Specificity*).
     - Sentence 2–3: Specify concrete current values vs. recommended CSS/token replacements (e.g., *"Current `color: rgb(148, 163, 184)` on `rgb(255, 255, 255)` yields 2.54:1 contrast; darken to `var(--text-secondary, #475569)` for >= 4.5:1 AA legibility and tighten `line-height` from `28px` to `1.45`."*).
3. **Classify Intent, Severity, and Proposed Edits**:
   - Assign AFS v1.1 `intent` (`fix`, `change`, `question`, `approve`) and `severity` (`blocking`, `important`, `suggestion`).
   - Attach machine-applicable `proposedEdits` (`[{ prop, value, reason }]`) whenever a critique can be previewed directly on the element.

## 6-Zone Systematic Page Walkthrough

When running Self-Driving Critique (either via the Pixelpush **Self-Drive** button in the Side Panel / floating toolbar or via automation), walk the page top-to-bottom across these six zones, aiming for **6 to 10 high-signal annotations**:

### 1. Hero & Value Proposition
- Is the primary headline immediately scannable within 3 seconds?
- Check display typography (`fontSize`, `lineHeight`, `letterSpacing`, `maxWidth` measure between `45ch` and `70ch`).
- Verify primary vs. secondary CTA visual weight, padding, hit-target height (`>= 40px`), and focal contrast.

### 2. Navigation & Wayfinding
- Are navigation items concise, evenly spaced (`gap`), and clear in active/hover affordance?
- Check sticky/fixed header height, backdrop blur/border separation, and mobile/compact overflow resilience.

### 3. Visuals, Cards & Interactive Demos
- Inspect card grids, media containers, and interactive widgets for consistent `borderRadius`, internal `padding`, and subtle borders vs. muddy shadows.
- Flag AI-slop visual patterns (generic gradient text, excessive glow shadows, symmetrical icon-pill boilerplate, or misaligned sibling card heights).

### 4. Content & Typographic Hierarchy
- Verify distinct scale steps between `h1`, `h2`, `h3`, body copy, and captions/eyebrows.
- Flag orphaned headings (where heading top margin <= bottom margin), cramped section transitions, or long-form text wider than `75ch`.

### 5. Copy & Microcopy Clarity
- Evaluate headlines, subheads, and button labels for specificity and active voice.
- Propose concrete copy rewrites (`textContent`) when headings or CTAs use generic filler (*"Unlock the Future of Solutions"*, *"Learn More"*, *"Get Started Now"*).

### 6. CTAs, Forms & Footer Conversion Architecture
- Check form inputs, labels, focus states, and bottom-of-page conversion blocks.
- Ensure every interactive control has an accessible name (`aria-label` or visible text) and at least `24x24px` (ideally `40x40px`) interactive target size.

## Execution Workflow inside Pixelpush

1. **Collect Page & Candidate Element Digest**:
   - Pixelpush's content script (`inspector.js`) gathers candidate elements across the 6 zones with full AFS v1.1+ metadata (`element`, `elementPath`, `fullPath`, `boundingBox`, `computedStyles`, `forensicStyles`, `accessibility`, `reactComponents`, `sourceFile`, `nearbyText`, and contrast metrics).
2. **Generate Critiques (`self_driving_critique`)**:
   - `background.js` routes the candidate digest to the configured AI provider (or runs the deterministic typographic/contrast/layout critique engine when offline) to produce structured AFS v1.1+ annotations with `comment`, `intent`, `severity`, `critiqueCategory`, and `proposedEdits`.
3. **Animated Page Walkthrough & Numbered Pinning**:
   - `inspector.js` smoothly scrolls each critiqued element into the viewport center, pulses a spotlight ring around the target, and places a numbered `[data-annotation-marker]` pin on the page.
4. **Review, Apply Edits & Export**:
   - All generated critiques appear immediately in the **Changes** tab, on the **Design** tab when selecting the element, and in the **Linear Issue** draft builder.
   - Click **Apply Proposed Fix** on any critique annotation to apply its CSS/text changes live on the page, or export the full session as **AFS v1.1 JSON** or **Markdown** (`compact`, `standard`, `detailed`, or `forensic`).
