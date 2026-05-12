import { describe, it, expect } from "vitest";
import { decideReanchor } from "../../src/web/client/re-anchor-policy.js";
import type { Annotation } from "../../src/core/types.js";
import type { Cursor } from "../../src/core/cursor-state.js";

function ann(id: string, file = "x.txt"): Annotation {
  return {
    id,
    file,
    side: "additions",
    line_start: 1,
    line_end: 1,
    body: "n",
    author: "human",
    author_kind: "human",
    created_at: "2026-01-01T00:00:00Z",
  };
}

const annA = ann("annA", "a.txt");
const annB = ann("annB", "b.txt");
const topLevel = [annA, annB];

describe("decideReanchor (issue #197 Bug B)", () => {
  it("noop when topLevel is empty (Tour with no annotations)", () => {
    expect(decideReanchor(null, null, [])).toEqual({ kind: "noop" });
    expect(decideReanchor(null, "annA", [])).toEqual({ kind: "noop" });
    expect(
      decideReanchor({ kind: "card", annotationId: "annA", preferredSide: "additions" }, null, []),
    ).toEqual({
      kind: "noop",
    });
  });

  it("url-restore on a null cursor with matching URL fragment (first-paint seed)", () => {
    expect(decideReanchor(null, "annB", topLevel)).toEqual({
      kind: "url-restore",
      target: annB,
    });
  });

  it("url-restore on a null cursor with no URL fragment (default to first top-level)", () => {
    expect(decideReanchor(null, null, topLevel)).toEqual({
      kind: "url-restore",
      target: annA,
    });
  });

  it("url-restore falls back to first top-level when URL fragment is stale", () => {
    expect(decideReanchor(null, "ghost", topLevel)).toEqual({
      kind: "url-restore",
      target: annA,
    });
  });

  it("noop on a valid CardAnchor cursor (no override)", () => {
    const cursor: Cursor = { kind: "card", annotationId: "annA", preferredSide: "additions" };
    expect(decideReanchor(cursor, "annA", topLevel)).toEqual({ kind: "noop" });
  });

  it("stale-fallback on a CardAnchor whose id is no longer in topLevel", () => {
    const cursor: Cursor = { kind: "card", annotationId: "ghost", preferredSide: "additions" };
    expect(decideReanchor(cursor, null, topLevel)).toEqual({
      kind: "stale-fallback",
      target: annA,
    });
  });

  // Bug B (issue #197). When the user presses `j` / `k` from a CardAnchor,
  // the cursor becomes a RowAnchor. The previous gate (`cursorCardId === null`)
  // routed the row cursor through the url-restore branch, snapping the
  // cursor back to a CardAnchor within the same render. The fix discriminates
  // on `cursor === null`, so a RowAnchor cursor is a noop — the user's row
  // motion survives.
  it("noop on a RowAnchor cursor (Bug B: j/k must not snap back to a card)", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "a.txt",
      lineNumber: 5,
      side: "additions",
      preferredSide: "additions",
    };
    // Stale URL fragment AND topLevel populated — under the old gate this
    // would have re-fired url-restore. Must be noop.
    expect(decideReanchor(cursor, "annA", topLevel)).toEqual({ kind: "noop" });
    expect(decideReanchor(cursor, null, topLevel)).toEqual({ kind: "noop" });
    expect(decideReanchor(cursor, "ghost", topLevel)).toEqual({ kind: "noop" });
  });

  it("noop on an interactive RowAnchor (gap-row / boundary cursor)", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "a.txt",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "hunk-separator", boundaryRef: 1 },
    };
    expect(decideReanchor(cursor, "annA", topLevel)).toEqual({ kind: "noop" });
  });
});
