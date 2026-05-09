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

  it("declares the dark canvas color and sidebar layout", () => {
    const out = html();
    expect(out).toContain("#0d1117");
    expect(out).toMatch(/\.app-sidebar\s*\{[^}]*width:\s*280px/);
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

  it("still styles the sidebar reason tag", () => {
    expect(html()).toMatch(/\.reason-tag\s*\{[^}]*font-style:\s*italic/);
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

  it("styles the current annotation card with an accent border + tint", () => {
    const out = html();
    expect(out).toMatch(/\.annotation-block\.current\s*\{[^}]*border-color/);
  });

  it("pins the sequence pill bottom-right with fixed positioning", () => {
    const out = html();
    expect(out).toMatch(/\.sequence-pill\s*\{[^}]*position:\s*fixed/);
    expect(out).toMatch(/\.sequence-pill\s*\{[^}]*bottom:\s*16px/);
    expect(out).toMatch(/\.sequence-pill\s*\{[^}]*right:\s*16px/);
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

  it("styles folder rows in the tree sidebar", () => {
    const out = html();
    expect(out).toMatch(/\.folder-entry\s*\{/);
    expect(out).toMatch(/\.folder-icon\s*\{/);
    expect(out).toMatch(/\.folder-name\s*\{/);
  });

  it("lays out the tour-header as a row so the layout toggle can sit on the right", () => {
    const out = html();
    expect(out).toMatch(/\.tour-header\s*\{[^}]*display:\s*flex/);
    expect(out).toMatch(/\.tour-header\s*\{[^}]*align-items:\s*center/);
  });

  it("styles the segmented layout toggle and highlights the active button", () => {
    const out = html();
    expect(out).toMatch(/\.layout-toggle\s*\{/);
    expect(out).toMatch(/\.layout-toggle-btn\s*\{/);
    expect(out).toMatch(/\.layout-toggle-btn\.active\s*\{/);
  });

  it("drops the monospace pre-wrap body styling now that annotation body is rich markdown", () => {
    const out = html();
    expect(out).not.toMatch(/\.annotation-block\s+\.ann-body\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(out).not.toMatch(/\.annotation-block\s*\{[^}]*font-family:\s*'SF Mono'/);
  });

  it("uses a proportional system font for the annotation card body", () => {
    expect(html()).toMatch(/\.annotation-block\s*\{[^}]*font-family:[^}]*-apple-system/);
  });

  it("preserves the blue left accent on the annotation card via the shared theme token", () => {
    expect(html()).toMatch(/\.annotation-block\s*\{[^}]*border-left:\s*3px solid var\(--border-accent\)/);
  });

  it("styles inner markdown elements (headings, lists, tables, blockquotes, links, code, pre)", () => {
    const out = html();
    expect(out).toMatch(/\.annotation-block\s+\.ann-body\s+h2\b/);
    expect(out).toMatch(/\.annotation-block\s+\.ann-body\s+ul\b/);
    expect(out).toMatch(/\.annotation-block\s+\.ann-body\s+table\b/);
    expect(out).toMatch(/\.annotation-block\s+\.ann-body\s+blockquote\b/);
    expect(out).toMatch(/\.annotation-block\s+\.ann-body\s+a\b/);
    expect(out).toMatch(/\.annotation-block\s+\.ann-body\s+code\b/);
    expect(out).toMatch(/\.annotation-block\s+\.ann-body\s+pre\b/);
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

  it("constrains the annotation card to its host column so long inline content cannot push it wider (Issue #47)", () => {
    const out = html();
    expect(out).toMatch(/\.annotation-block\s*\{[^}]*min-width:\s*0/);
    expect(out).toMatch(/\.annotation-block\s*\{[^}]*max-width:\s*100%/);
  });

  it("wraps long unbreakable tokens inside the annotation body so they do not force horizontal overflow (Issue #47)", () => {
    expect(html()).toMatch(/\.annotation-block\s+\.ann-body\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it("preserves horizontal scroll on fenced code blocks so pre content does not wrap (Issue #47)", () => {
    expect(html()).toMatch(/\.annotation-block\s+\.ann-body\s+pre\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("styles the clickable tour-title button as text-only (no chrome)", () => {
    const out = html();
    expect(out).toMatch(/\.tour-title-btn\s*\{[^}]*background:\s*transparent/);
    expect(out).toMatch(/\.tour-title-btn\s*\{[^}]*cursor:\s*pointer/);
  });
});
