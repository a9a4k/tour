import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TUI footer flash plumbing", () => {
  it("routes transient footer status through the shared flash hook", () => {
    const source = readFileSync("src/tui/app.tsx", "utf8");

    expect(source).toContain('useFlashFooter } from "../core/use-flash-footer.js"');
    expect(source).toContain("const { status: footerStatus, flash } = useFlashFooter()");
    expect(source).not.toContain("setFooterStatus");
    expect(source).not.toContain("FooterTimerRef");
  });
});
