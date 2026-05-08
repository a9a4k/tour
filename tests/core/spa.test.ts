import { describe, it, expect } from "vitest";
import { html } from "../../src/web/spa.js";

describe("spa html", () => {
  const output = html();

  it("file-diff-header has position sticky", () => {
    expect(output).toMatch(/\.file-diff-header\s*\{[^}]*position:\s*sticky/);
  });

  it("file-diff uses overflow clip instead of overflow hidden", () => {
    expect(output).toMatch(/\.file-diff\s*\{[^}]*overflow:\s*clip/);
    expect(output).not.toMatch(/\.file-diff\s*\{[^}]*overflow:\s*hidden/);
  });

  it("file-diff-header has opaque background", () => {
    expect(output).toMatch(/\.file-diff-header\s*\{[^}]*background:\s*#161b22/);
  });

  it("file-diff-header has z-index for stacking over scrolled content", () => {
    expect(output).toMatch(/\.file-diff-header\s*\{[^}]*z-index:\s*1/);
  });

  it("has copy-path button styling", () => {
    expect(output).toMatch(/\.copy-path\s*\{/);
  });

  it("copy-path button handler uses stopPropagation", () => {
    expect(output).toContain("stopPropagation");
  });

  it("copy-path button uses navigator.clipboard.writeText", () => {
    expect(output).toContain("navigator.clipboard.writeText");
  });

  it("copy-path button has aria-label", () => {
    expect(output).toContain('aria-label');
  });

  it("copy-path button is a real button element", () => {
    expect(output).toContain("<button");
    expect(output).toContain("copy-path");
  });
});
