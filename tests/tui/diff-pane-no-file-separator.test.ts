import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Issue #314 regression. The pre-#307 TUI diff pane interleaved a
// `FileSeparator` (horizontal `─` rule + blank row) between every
// consecutive pair of file cards via `withFileSeparators(files, ...)`.
// Once #307 gave each file card its own labeled `borderStyle="single"`
// frame, the rule duplicated the boundary cue the frames already carry
// and burned ~2 viewport rows per file boundary. The component and the
// helper were removed entirely — the diff scrollbox's content children
// are now file-card boxes only, separated by each card's `marginBottom={1}`.
//
// This test pins the absence at the source-text level. A full-app render
// test is out of reach without spinning up OpenTUI; the contract we care
// about ("no separator nodes interleaved between cards") collapses
// cleanly onto the wiring in `src/tui/app.tsx`.
describe("diff pane has no FileSeparator between file cards (issue #314)", () => {
  const appPath = resolve(__dirname, "../../src/tui/app.tsx");
  const appSrc = readFileSync(appPath, "utf8");

  it("does not import FileSeparator or withFileSeparators", () => {
    expect(appSrc).not.toMatch(/FileSeparator/);
    expect(appSrc).not.toMatch(/withFileSeparators/);
  });

  it("renders file cards via a plain files.map, not an interleaver", () => {
    expect(appSrc).toMatch(/\{files\.map\(\(file\) => \{/);
  });

  it("preserves each card's marginBottom={1} (the sole inter-card spacing)", () => {
    expect(appSrc).toMatch(/marginBottom=\{1\}/);
  });

  it("the FileSeparator module no longer exists", () => {
    expect(existsSync(resolve(__dirname, "../../src/tui/FileSeparator.tsx"))).toBe(false);
  });
});
