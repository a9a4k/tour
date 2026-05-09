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
});
