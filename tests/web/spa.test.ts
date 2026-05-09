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
});
