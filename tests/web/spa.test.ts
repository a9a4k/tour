import { describe, it, expect } from "vitest";
import { html } from "../../src/web/spa.js";

describe("spa shell html()", () => {
  it("renders a #root mount point for the React app", () => {
    expect(html()).toContain('<div id="root">');
  });

  it("loads the client bundle as an ES module", () => {
    expect(html()).toMatch(/<script\s+type="module"\s+src="\/client\.js">/);
  });

  it("threads the initial tour id into a window global", () => {
    expect(html("abc123")).toContain('window.__INITIAL_TOUR_ID__ = "abc123"');
    expect(html()).toContain("window.__INITIAL_TOUR_ID__ = null");
  });

  it("threads the configured reply-agent name into a window global (issue #184)", () => {
    expect(html("abc123", "claude")).toContain(
      'window.__INITIAL_REPLY_AGENT__ = "claude"',
    );
    // Defaulting to null means "no --reply-agent" — both globals are nullable.
    expect(html()).toContain("window.__INITIAL_REPLY_AGENT__ = null");
  });

  it("styles the Send-to-agent button with a focused-card accent + disabled treatment (issue #184)", () => {
    const out = html();
    expect(out).toMatch(/\.send-to-agent-button\s*\{/);
    expect(out).toMatch(
      /\.comment-block\.current\s+\.send-to-agent-button:not\(:disabled\)\s*\{[^}]*color:\s*var\(--fg-accent\)/,
    );
    expect(out).toMatch(
      /\.send-to-agent-button:disabled\s*\{[^}]*cursor:\s*not-allowed/,
    );
  });

  it("declares the dark canvas color and sidebar layout", () => {
    const out = html();
    expect(out).toContain("#0d1117");
    // The fixed 280px is the fallback default (the inline style from
    // React state wins at runtime); position: relative anchors the
    // absolutely-positioned drag handle (issue #323).
    expect(out).toMatch(/\.app-sidebar\s*\{[^}]*width:\s*280px/);
    expect(out).toMatch(/\.app-sidebar\s*\{[^}]*position:\s*relative/);
  });

  it("declares the sidebar drag-resize handle (issue #323)", () => {
    const out = html();
    // Handle is positioned at the right edge with col-resize cursor.
    expect(out).toMatch(/\.sidebar-resize-handle\s*\{[^}]*position:\s*absolute/);
    expect(out).toMatch(/\.sidebar-resize-handle\s*\{[^}]*cursor:\s*col-resize/);
    // While dragging, the aside carries .is-resizing which suppresses
    // text selection so the cursor doesn't paint a selection across
    // the diff body during the drag.
    expect(out).toMatch(/\.app-sidebar\.is-resizing/);
    expect(out).toMatch(/\.app-sidebar\.is-resizing[\s\S]*?user-select:\s*none/);
  });

  it("emits the GitHub Dark Default token block as :root custom properties (Issue #57)", () => {
    const out = html();
    // Spot-check Tier 1 + Tier 2 tokens to lock centralization.
    expect(out).toMatch(/:root\s*\{[\s\S]*--canvas-default:\s*#0d1117/);
    expect(out).toMatch(/--fg-accent:\s*#58a6ff/);
    expect(out).toMatch(/--fg-default:\s*#f0f6fc/);
    expect(out).toMatch(/--border-default:\s*#3d444d/);
    expect(out).toMatch(/--bg-accent-cursor:\s*rgba\(31, 111, 235, 0\.20\)/);
    expect(out).toMatch(/--bg-accent-range:\s*rgba\(56, 139, 253, 0\.15\)/);
  });

  it("references theme tokens via var(--...) for body / sidebar chrome (Issue #57)", () => {
    const out = html();
    expect(out).toMatch(/body\s*\{[^}]*background:\s*var\(--canvas-default\)/);
    expect(out).toMatch(/body\s*\{[^}]*color:\s*var\(--fg-default\)/);
    expect(out).toMatch(/\.app-sidebar\s*\{[^}]*border-right:\s*1px solid var\(--border-default\)/);
  });

  it("paints the active layout-toggle with the solid accent emphasis pill (Issue #57)", () => {
    const out = html();
    expect(out).toMatch(/\.layout-toggle-btn\.active\s*\{[^}]*background:\s*var\(--bg-accent-emphasis\)/);
    expect(out).toMatch(/\.layout-toggle-btn\.active\s*\{[^}]*color:\s*var\(--fg-on-emphasis\)/);
  });

  it("does not declare a .file-block-header rule (Pierre owns the header now)", () => {
    expect(html()).not.toContain(".file-block-header");
  });

  it("replaces the letter-badge .file-icon rules with Octicon-driven .status-icon rules (Issue #62)", () => {
    const out = html();
    // Letter-badge rules are gone.
    expect(out).not.toMatch(/\.file-icon\.A\b/);
    expect(out).not.toMatch(/\.file-icon\.M\b/);
    expect(out).not.toMatch(/\.file-icon\.D\b/);
    expect(out).not.toMatch(/\.file-icon\.R\b/);
    // Base sizing: 16x16 box, never compressed by flex siblings.
    expect(out).toMatch(/\.status-icon\s*\{[^}]*width:\s*16px/);
    expect(out).toMatch(/\.status-icon\s*\{[^}]*height:\s*16px/);
    expect(out).toMatch(/\.status-icon\s*\{[^}]*flex-shrink:\s*0/);
    // Per-status colors lifted from the GitHub diff palette.
    expect(out).toMatch(/\.status-icon\.added\s*\{[^}]*color:\s*#3fb950/);
    expect(out).toMatch(/\.status-icon\.modified\s*\{[^}]*color:\s*#d29922/);
    expect(out).toMatch(/\.status-icon\.deleted\s*\{[^}]*color:\s*#f85149/);
    expect(out).toMatch(/\.status-icon\.renamed\s*\{[^}]*color:\s*#a371f7/);
  });

  it("does not inline highlight.js theme css anymore", () => {
    expect(html()).not.toContain("hljs-keyword");
    expect(html()).not.toContain("highlight.js");
  });

  it("does not embed a vanilla render loop", () => {
    expect(html()).not.toContain("function renderDiff");
    expect(html()).not.toContain("highlightedLines");
  });

  it("removes top padding from .app-main scroll container so sticky header pins flush", () => {
    const out = html();
    expect(out).toMatch(/\.app-main\s*\{[^}]*padding:\s*0\s+16px\s+16px/);
    expect(out).not.toMatch(/\.app-main\s*\{[^}]*padding:\s*16px\s*;/);
  });

  it("preserves visual top spacing via padding-top on .tour-header", () => {
    expect(html()).toMatch(/\.tour-header\s*\{[^}]*padding-top:\s*16px/);
  });

  it("preserves visual top spacing on empty/loading/error state via padding-top on .empty", () => {
    expect(html()).toMatch(/\.empty\s*\{[^}]*padding-top:\s*16px/);
  });

  it("styles the current comment card with an accent border + soft shadow (Issue #162)", () => {
    const out = html();
    // Focus is additive: swap border color to accent + add elevation shadow.
    // Background fill stays the same as rest so only 1–2 channels change.
    expect(out).toMatch(/\.comment-block\.current\s*\{[^}]*border-color:\s*var\(--border-accent\)/);
    expect(out).toMatch(/\.comment-block\.current\s*\{[^}]*box-shadow/);
  });

  it("styles the selection-marker glyph in accent so the `●` reads on the current card (TUI parity)", () => {
    // Third cue, parallel to the TUI's heavy-border + bg-tier + `●` triad
    // (#169): the marker is painted by the React tree only when isCurrent,
    // and the rule sets it to the accent foreground.
    expect(html()).toMatch(/\.comment-block\s+\.selection-marker\s*\{[^}]*color:\s*var\(--fg-accent\)/);
  });

  it("prefixes the within-Card active node with a `●` glyph via ::before (issue #409 — TUI parity)", () => {
    // Issue #408 shipped a CSS-only active-node cue (left-accent stroke
    // + tint). Dogfood revealed it read as too subtle next to the
    // unchanged Card chrome — the TUI's matching surface paints three
    // cues (heavy border + accent background + `●` glyph) so the
    // webapp needs the third cue to match. The glyph rides the
    // existing `.active-node` class via a `::before` pseudo so the
    // class stays the single source of truth — when `j` / `k` flips
    // the class the glyph moves with it.
    const out = html();
    expect(out).toMatch(
      /\.comment-block\s+\.ann-header\.active-node::before,\s*\.comment-block\s+\.ann-reply\.active-node::before\s*\{[^}]*content:\s*"●\s*"/,
    );
    expect(out).toMatch(
      /\.comment-block\s+\.ann-header\.active-node::before,\s*\.comment-block\s+\.ann-reply\.active-node::before\s*\{[^}]*color:\s*var\(--fg-accent\)/,
    );
  });

  it("renders a baseline container at rest — neutral 1px border + tinted surface (Issue #162)", () => {
    const out = html();
    // The unfocused card must read as a card, not raw text: visible neutral
    // border on top/right/bottom + faint fill, in addition to the existing
    // left accent stripe.
    expect(out).toMatch(/\.comment-block\s*\{[^}]*border:\s*1px solid var\(--border-default\)/);
    expect(out).toMatch(/\.comment-block\s*\{[^}]*background:\s*var\(--canvas-subtle\)/);
    expect(out).not.toMatch(/\.comment-block\s*\{[^}]*border:\s*2px solid transparent/);
  });

  it("relocates the sequence pill into the header — no longer fixed-positioned (Issue #69)", () => {
    const out = html();
    expect(out).not.toMatch(/\.sequence-pill\s*\{[^}]*position:\s*fixed/);
    expect(out).not.toMatch(/\.sequence-pill\s*\{[^}]*bottom:\s*16px/);
    expect(out).not.toMatch(/\.sequence-pill\s*\{[^}]*right:\s*16px/);
    expect(out).not.toMatch(/\.sequence-pill\s*\{[^}]*box-shadow/);
    expect(out).not.toMatch(/\.sequence-pill\s*\{[^}]*z-index/);
    expect(out).toMatch(/\.sequence-pill\s*\{[^}]*display:\s*inline-flex/);
  });

  it("dims disabled pill chevrons so boundary state is visible", () => {
    expect(html()).toMatch(/\.sequence-pill\s+\.pill-chevron:disabled/);
  });

  it("declares color-scheme: dark so native scrollbars render in dark", () => {
    expect(html()).toMatch(/html\s*\{[^}]*color-scheme:\s*dark/);
  });

  it("stacks #root vertically so the tour-header can sit above the columns", () => {
    expect(html()).toMatch(/#root\s*\{[^}]*flex-direction:\s*column/);
  });

  it("declares an .app-body row that hosts the two scroll columns", () => {
    const out = html();
    expect(out).toMatch(/\.app-body\s*\{[^}]*display:\s*flex/);
    expect(out).toMatch(/\.app-body\s*\{[^}]*min-height:\s*0/);
  });

  it("drops .tour-header margin-bottom now that it sits outside .app-main", () => {
    const out = html();
    expect(out).not.toMatch(/\.tour-header\s*\{[^}]*margin-bottom/);
  });

  it("pads .tour-header horizontally so it lines up with the columns", () => {
    const out = html();
    expect(out).toMatch(/\.tour-header\s*\{[^}]*padding-left:\s*16px/);
    expect(out).toMatch(/\.tour-header\s*\{[^}]*padding-right:\s*16px/);
  });

  it("styles folder rows in the tree sidebar (Issue #63)", () => {
    const out = html();
    expect(out).toMatch(/\.folder-entry\s*\{/);
    expect(out).toMatch(/\.folder-name\s*\{/);
    // The caret-only `.folder-icon` rule is gone — replaced by chevron +
    // folder Octicons sized 16x16 via the new `.tree-icon` rule.
    expect(out).not.toMatch(/\.folder-icon\s*\{/);
    expect(out).toMatch(/\.tree-icon\s*\{[^}]*width:\s*16px/);
    expect(out).toMatch(/\.tree-icon\s*\{[^}]*height:\s*16px/);
    expect(out).toMatch(/\.tree-icon\s*\{[^}]*flex-shrink:\s*0/);
    expect(out).toMatch(/\.tree-icon\s*\{[^}]*color:\s*var\(--fg-muted\)/);
  });

  it("lays out the tour-header as a wrapping flex row with two clusters (Issue #92)", () => {
    const out = html();
    expect(out).toMatch(/\.tour-header\s*\{[^}]*display:\s*flex/);
    // Group-wrap: when the row can't fit, the right cluster drops to row 2.
    // align-items: stretch is gone — the single-line shape no longer hosts a
    // 2-line content column, so the hamburger doesn't need to stretch.
    expect(out).toMatch(/\.tour-header\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(out).not.toMatch(/\.tour-header\s*\{[^}]*align-items:\s*stretch/);
  });

  it("anchors the right cluster to the right edge via margin-left: auto (Issue #92)", () => {
    // With flex-wrap: wrap, margin-left: auto on the right cluster pushes it
    // to the right edge whether it sits on the same row as the left cluster
    // or wraps to its own row. justify-content: space-between would not
    // survive the wrap (single child on a line ignores it).
    expect(html()).toMatch(/\.tour-header-right\s*\{[^}]*margin-left:\s*auto/);
  });

  it("removes the old vertical-stack content/controls columns (Issue #92)", () => {
    // The 2-line shape (.tour-header-content + .tour-header-controls as
    // column flex containers) is replaced by .tour-header-left /
    // .tour-header-right rows. Old line1 wrapper for h1+id is gone too.
    const out = html();
    expect(out).not.toMatch(/\.tour-header-content\s*\{/);
    expect(out).not.toMatch(/\.tour-header-controls\s*\{/);
    expect(out).not.toMatch(/\.tour-header-line1\s*\{/);
  });

  it("removes the .tour-id rule — short-id no longer rendered in header (Issue #92)", () => {
    expect(html()).not.toMatch(/\.tour-id\s*\{/);
  });

  it("ellipsizes the sources string on overflow (Issue #92)", () => {
    const out = html();
    expect(out).toMatch(/\.tour-refs\s*\{[^}]*overflow:\s*hidden/);
    expect(out).toMatch(/\.tour-refs\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(out).toMatch(/\.tour-refs\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("styles the segmented layout toggle and highlights the active button", () => {
    const out = html();
    expect(out).toMatch(/\.layout-toggle\s*\{/);
    expect(out).toMatch(/\.layout-toggle-btn\s*\{/);
    expect(out).toMatch(/\.layout-toggle-btn\.active\s*\{/);
  });

  it("drops the monospace pre-wrap body styling now that comment body is rich markdown", () => {
    const out = html();
    expect(out).not.toMatch(/\.comment-block\s+\.ann-body\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(out).not.toMatch(/\.comment-block\s*\{[^}]*font-family:\s*'SF Mono'/);
  });

  it("uses a proportional system font for the comment card body", () => {
    expect(html()).toMatch(/\.comment-block\s*\{[^}]*font-family:[^}]*-apple-system/);
  });

  it("preserves the blue left accent on the comment card via the shared theme token", () => {
    expect(html()).toMatch(/\.comment-block\s*\{[^}]*border-left:\s*3px solid var\(--border-accent\)/);
  });

  it("zeroes the comment card's left margin so the accent border column-aligns with the gutter stripe (Issue #68)", () => {
    const out = html();
    // The card no longer offsets its border inward — left margin is 0 so the
    // border-left lands at the same x-column as the gutter accent stripe
    // painted by `buildRangeBackgroundCSS` on the annotated [data-line] rows.
    expect(out).toMatch(/\.comment-block\s*\{[^}]*margin:\s*4px\s+16px\s+4px\s+0/);
    // Old symmetric `margin: 4px 16px` (which inset the border 16px) is gone.
    expect(out).not.toMatch(/\.comment-block\s*\{[^}]*margin:\s*4px\s+16px\s*;/);
  });

  it("styles inner markdown elements (headings, lists, tables, blockquotes, links, code, pre)", () => {
    const out = html();
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s+h2\b/);
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s+ul\b/);
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s+table\b/);
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s+blockquote\b/);
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s+a\b/);
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s+code\b/);
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s+pre\b/);
  });

  it("overrides Pierre's inherited white-space: pre-wrap on .ann-body so newlines between <li>s don't render as visible gaps (Issue #173)", () => {
    // Pierre's diff container sets white-space: pre-wrap, which .ann-body
    // inherits. React leaves "\n" text nodes between adjacent </li><li>
    // tags; under pre-wrap those render as a full line-height of vertical
    // space, producing loose-list rendering on tight Markdown source.
    const out = html();
    expect(out).toMatch(/\.comment-block\s+\.ann-body\s*\{[^}]*white-space:\s*normal/);
  });

  it("declares a mermaid-block rule whose svg fits the card width without an inner scrollbar", () => {
    const out = html();
    expect(out).toMatch(/\.mermaid-block\s+svg\s*\{[^}]*max-width:\s*100%/);
    expect(out).toMatch(/\.mermaid-block\s+svg\s*\{[^}]*height:\s*auto/);
    expect(out).not.toMatch(/\.mermaid-block\s*\{[^}]*overflow/);
  });

  it("styles the mermaid loading placeholder and the failure header", () => {
    const out = html();
    expect(out).toMatch(/\.mermaid-loading\s*\{/);
    expect(out).toMatch(/\.mermaid-failed\s+\.mermaid-error-header\s*\{/);
  });

  it("styles the tour picker overlay (scrim, card, rows, current, cursor)", () => {
    const out = html();
    expect(out).toMatch(/\.picker-scrim\s*\{[^}]*position:\s*fixed/);
    expect(out).toMatch(/\.picker-card\s*\{/);
    expect(out).toMatch(/\.picker-row\s*\{/);
    // current/cursor rows pull from theme Tier 2 tokens (Issue #57). Cursor
    // additionally gets the border-accent left edge per the shared "cursor
    // vs current" treatment.
    expect(out).toMatch(/\.picker-row\.current\s*\{[^}]*background:\s*var\(--bg-accent-current\)/);
    expect(out).toMatch(/\.picker-row\.cursor\s*\{[^}]*background:\s*var\(--bg-accent-cursor\)/);
    expect(out).toMatch(/\.picker-row\.cursor\s*\{[^}]*border-left-color:\s*var\(--border-accent\)/);
  });

  it("constrains the comment card to its host column so long inline content cannot push it wider (Issue #47)", () => {
    const out = html();
    expect(out).toMatch(/\.comment-block\s*\{[^}]*min-width:\s*0/);
    expect(out).toMatch(/\.comment-block\s*\{[^}]*max-width:\s*100%/);
  });

  it("wraps long unbreakable tokens inside the comment body so they do not force horizontal overflow (Issue #47)", () => {
    expect(html()).toMatch(/\.comment-block\s+\.ann-body\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it("preserves horizontal scroll on fenced code blocks so pre content does not wrap (Issue #47)", () => {
    expect(html()).toMatch(/\.comment-block\s+\.ann-body\s+pre\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("removes the .tour-title-btn rule — title is plain text, hamburger owns picker (Issue #69)", () => {
    expect(html()).not.toMatch(/\.tour-title-btn\b/);
  });

  it("styles the bordered hamburger picker button (Issue #69)", () => {
    const out = html();
    expect(out).toMatch(/\.picker-button\s*\{[^}]*border:\s*1px solid var\(--border-default\)/);
    expect(out).toMatch(/\.picker-button\s*\{[^}]*cursor:\s*pointer/);
    expect(out).toMatch(/\.picker-button:hover\s*\{[^}]*background:\s*var\(--canvas-subtle\)/);
    expect(out).toMatch(/\.picker-button:focus-visible\s*\{[^}]*outline:\s*1px solid var\(--border-accent\)/);
  });

  it("sizes the hamburger button by its own content, not the title block height (Issue #89)", () => {
    const out = html();
    // The button must NOT stretch to match the parent's cross-axis height —
    // when the title wraps to two lines, a stretched button grows into a
    // tall rectangle. Override the parent's `align-items: stretch` with a
    // self-centered alignment so the button sizes by its content + padding.
    expect(out).not.toMatch(/\.picker-button\s*\{[^}]*align-self:\s*stretch/);
    expect(out).toMatch(/\.picker-button\s*\{[^}]*align-self:\s*center/);
    // Keep a comfortably tappable click target via min-height so the button
    // does not collapse to a thin strip once stretch is gone.
    expect(out).toMatch(/\.picker-button\s*\{[^}]*min-height:\s*32px/);
  });

  it("declares left/right cluster rows with intrinsic widths (Issue #92)", () => {
    const out = html();
    // Left cluster takes available space (so its title can ellipsize), right
    // cluster shrinks to its content (so the controls don't smear).
    expect(out).toMatch(/\.tour-header-left\s*\{[^}]*display:\s*flex/);
    expect(out).toMatch(/\.tour-header-left\s*\{[^}]*min-width:\s*0/);
    expect(out).toMatch(/\.tour-header-right\s*\{[^}]*display:\s*flex/);
  });

  it("styles the muted base ← head refs (Issue #92)", () => {
    expect(html()).toMatch(/\.tour-refs\s*\{[^}]*color:\s*var\(--fg-muted\)/);
  });

  it("styles the tour-level diff-stats indicator with monospace + tabular numerals (Issue #233)", () => {
    const out = html();
    expect(out).toMatch(/\.tour-stats\s*\{[^}]*display:\s*inline-flex/);
    expect(out).toMatch(/\.tour-stats\s*\{[^}]*font-family:[^}]*'SF Mono'/);
    expect(out).toMatch(/\.tour-stats\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(out).toMatch(/\.tour-stats-count\.added\s*\{[^}]*color:\s*var\(--fg-success\)/);
    expect(out).toMatch(/\.tour-stats-count\.deleted\s*\{[^}]*color:\s*var\(--fg-danger\)/);
  });

  it("styles the inline composer card with shared theme tokens (Issue #77)", () => {
    const out = html();
    expect(out).toMatch(/\.composer\s*\{[^}]*border:\s*1px solid var\(--border-default\)/);
    expect(out).toMatch(/\.composer\s*\{[^}]*background:\s*var\(--canvas-subtle\)/);
    expect(out).toMatch(/\.composer-textarea\s*\{[^}]*background:\s*var\(--canvas-default\)/);
    expect(out).toMatch(/\.composer-textarea\s*\{[^}]*resize:\s*vertical/);
    expect(out).toMatch(/\.composer-submit\s*\{[^}]*background:\s*var\(--bg-accent-emphasis\)/);
    expect(out).toMatch(/\.composer-submit:disabled\s*\{/);
    expect(out).toMatch(/\.composer-error\s*\{[^}]*color:\s*var\(--fg-danger\)/);
  });

  it("styles the per-card Reply button as a subtle bordered chip (Issue #77)", () => {
    const out = html();
    expect(out).toMatch(/\.reply-button\s*\{[^}]*border:\s*1px solid var\(--border-default\)/);
    expect(out).toMatch(/\.reply-button\s*\{[^}]*color:\s*var\(--fg-muted\)/);
    expect(out).toMatch(/\.reply-button:hover\s*\{[^}]*background:\s*var\(--canvas-subtle\)/);
    expect(out).toMatch(/\.ann-reply-composer\s*\{[^}]*border-left:\s*2px solid var\(--border-muted\)/);
  });

  it("styles the rename path-pair and pure-rename placeholder body (Issue #145)", () => {
    const out = html();
    expect(out).toMatch(/\.rename-path\s*\{[^}]*color:\s*var\(--fg-muted\)/);
    expect(out).toMatch(/\.rename-path\s*\{[^}]*font-family:[^}]*'SF Mono'/);
    expect(out).toMatch(/\.rename-placeholder\s*\{[^}]*color:\s*var\(--fg-muted\)/);
    expect(out).toMatch(/\.rename-placeholder\s*\{[^}]*font-style:\s*italic/);
  });
});
