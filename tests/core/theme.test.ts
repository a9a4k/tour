import { describe, it, expect } from "vitest";
import { theme, themeCSSVars } from "../../src/core/theme.js";

describe("theme tokens", () => {
  it("pins fg.accent at #58a6ff (ADR 0008 contrast anchor)", () => {
    expect(theme.fg.accent).toBe("#58a6ff");
  });

  it("exposes the GitHub Dark Default canvas surfaces", () => {
    expect(theme.canvas.default).toBe("#0d1117");
    expect(theme.canvas.subtle).toBe("#151b23");
    expect(theme.canvas.inset).toBe("#010409");
    expect(theme.canvas.emphasis).toBe("#3d444d");
  });

  it("exposes the body / muted / subtle text tokens", () => {
    expect(theme.fg.default).toBe("#f0f6fc");
    expect(theme.fg.muted).toBe("#9198a1");
    expect(theme.fg.subtle).toBe("#656c76");
    expect(theme.fg.onEmphasis).toBe("#ffffff");
  });

  it("exposes status fg colors used by file-status icons + diff signs", () => {
    expect(theme.fg.success).toBe("#3fb950");
    expect(theme.fg.attention).toBe("#d29922");
    expect(theme.fg.danger).toBe("#f85149");
    expect(theme.fg.done).toBe("#ab7df8");
  });

  it("exposes border tokens", () => {
    expect(theme.border.default).toBe("#3d444d");
    expect(theme.border.muted).toBe("#2f3742");
    expect(theme.border.accent).toBe("#58a6ff");
  });

  it("exposes emphasis bg tokens for solid pills/badges", () => {
    expect(theme.bg.accentEmphasis).toBe("#1f6feb");
    expect(theme.bg.successEmphasis).toBe("#238636");
    expect(theme.bg.dangerEmphasis).toBe("#da3633");
  });

  it("emits Tier 2 alpha-on-canvas tokens with both web alpha and TUI baked solids", () => {
    // Cursor row (alpha .20)
    expect(theme.bg.accentCursor.web).toBe("rgba(31, 111, 235, 0.20)");
    expect(theme.bg.accentCursor.tui).toBe("#112441");
    // Currently-shown row (alpha .13)
    expect(theme.bg.accentCurrent.web).toBe("rgba(31, 111, 235, 0.13)");
    expect(theme.bg.accentCurrent.tui).toBe("#0f1e33");
    // Annotation row tint (alpha .15 of blue.4)
    expect(theme.bg.accentRange.web).toBe("rgba(56, 139, 253, 0.15)");
    expect(theme.bg.accentRange.tui).toBe("#132339");
    // Diff addition row bg (alpha .15 of fg.success)
    expect(theme.bg.successRange.web).toBe("rgba(63, 185, 80, 0.15)");
    expect(theme.bg.successRange.tui).toBe("#142a20");
    // Diff deletion row bg (alpha .15 of fg.danger)
    expect(theme.bg.dangerRange.web).toBe("rgba(248, 81, 73, 0.15)");
    expect(theme.bg.dangerRange.tui).toBe("#301b1e");
    // Inline <code> chip (alpha .20 of neutral)
    expect(theme.bg.neutralSubtle.web).toBe("rgba(110, 118, 129, 0.20)");
    expect(theme.bg.neutralSubtle.tui).toBe("#22262d");
  });
});

describe("themeCSSVars()", () => {
  const css = themeCSSVars();

  it("emits a :root block", () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/\}\s*$/);
  });

  it("declares the Tier 1 canvas/fg/border tokens as custom properties", () => {
    expect(css).toContain("--canvas-default: #0d1117");
    expect(css).toContain("--canvas-subtle: #151b23");
    expect(css).toContain("--fg-default: #f0f6fc");
    expect(css).toContain("--fg-muted: #9198a1");
    expect(css).toContain("--fg-accent: #58a6ff");
    expect(css).toContain("--fg-success: #3fb950");
    expect(css).toContain("--fg-attention: #d29922");
    expect(css).toContain("--fg-danger: #f85149");
    expect(css).toContain("--fg-done: #ab7df8");
    expect(css).toContain("--border-default: #3d444d");
    expect(css).toContain("--border-muted: #2f3742");
    expect(css).toContain("--border-accent: #58a6ff");
    expect(css).toContain("--bg-accent-emphasis: #1f6feb");
  });

  it("emits Tier 2 tokens as the web alpha values", () => {
    expect(css).toContain("--bg-accent-cursor: rgba(31, 111, 235, 0.20)");
    expect(css).toContain("--bg-accent-current: rgba(31, 111, 235, 0.13)");
    expect(css).toContain("--bg-accent-range: rgba(56, 139, 253, 0.15)");
    expect(css).toContain("--bg-success-range: rgba(63, 185, 80, 0.15)");
    expect(css).toContain("--bg-danger-range: rgba(248, 81, 73, 0.15)");
    expect(css).toContain("--bg-neutral-subtle: rgba(110, 118, 129, 0.20)");
  });
});
