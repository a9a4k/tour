import { describe, it, expect } from "vitest";
import {
  buildReplyComposer,
  buildTopLevelComposer,
} from "../../src/tui/composer-state.js";
import type { Comment } from "../../src/core/types.js";
import type { Cursor, RowAnchor } from "../../src/core/cursor-state.js";

function ann(overrides: Partial<Comment> & Pick<Comment, "id">): Comment {
  return {
    id: overrides.id,
    file: overrides.file ?? "src/x.ts",
    side: overrides.side ?? "additions",
    line_start: overrides.line_start ?? 10,
    line_end: overrides.line_end ?? 10,
    body: overrides.body ?? "agent note",
    author: overrides.author ?? "agent",
    author_kind: overrides.author_kind ?? "agent",
    thread_id: overrides.thread_id,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
  };
}

const cursor = (overrides: Partial<RowAnchor> & Pick<RowAnchor, "file" | "lineNumber">): RowAnchor => ({
  kind: "row",
  file: overrides.file,
  lineNumber: overrides.lineNumber,
  side: overrides.side ?? "additions",
  preferredSide: overrides.preferredSide ?? overrides.side ?? "additions",
});

describe("buildTopLevelComposer", () => {
  it("anchors to the cursor when one is present (ADR 0011)", () => {
    const c = cursor({ file: "src/foo.ts", lineNumber: 42, side: "additions" });
    const state = buildTopLevelComposer({
      cursor: c,
      currentComment: null,
    });
    expect(state).toEqual({
      kind: "top-level",
      file: "src/foo.ts",
      side: "additions",
      line_start: 42,
      line_end: 42,
    });
  });

  it("collapses cursor to a single-line range (line_start === line_end)", () => {
    const c = cursor({ file: "src/foo.ts", lineNumber: 7, side: "deletions" });
    const state = buildTopLevelComposer({
      cursor: c,
      currentComment: null,
    });
    if (state?.kind !== "top-level") throw new Error("expected top-level");
    expect(state.line_start).toBe(7);
    expect(state.line_end).toBe(7);
  });

  it("cursor wins over the current comment when both are present", () => {
    const c = cursor({ file: "src/cursor.ts", lineNumber: 3, side: "deletions" });
    const a = ann({
      id: "a1",
      file: "src/ann.ts",
      side: "additions",
      line_start: 100,
      line_end: 110,
    });
    const state = buildTopLevelComposer({
      cursor: c,
      currentComment: a,
    });
    expect(state).toEqual({
      kind: "top-level",
      file: "src/cursor.ts",
      side: "deletions",
      line_start: 3,
      line_end: 3,
    });
  });

  it("falls back to the current comment when cursor is null", () => {
    const a = ann({
      id: "a1",
      file: "src/foo.ts",
      side: "additions",
      line_start: 42,
      line_end: 44,
    });
    const state = buildTopLevelComposer({
      cursor: null,
      currentComment: a,
    });
    expect(state).toEqual({
      kind: "top-level",
      file: "src/foo.ts",
      side: "additions",
      line_start: 42,
      line_end: 44,
    });
  });

  it("returns null when both cursor and current comment are null (silent no-op upstream)", () => {
    const state = buildTopLevelComposer({
      cursor: null,
      currentComment: null,
    });
    expect(state).toBeNull();
  });

  // ADR 0013 / PRD #107 US 9: interactive rows are not annotatable. `a`
  // on an interactive cursor falls through to the silent no-op path —
  // even when a fallback `currentComment` is available, we don't
  // silently retarget the composer to a different anchor.
  it("returns null when the cursor sits on an interactive row", () => {
    const c: Cursor = {
      kind: "row",
      file: "src/foo.ts",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "hunk-separator", boundaryRef: 1 },
    };
    expect(
      buildTopLevelComposer({ cursor: c, currentComment: null }),
    ).toBeNull();
  });

  it("returns null on interactive cursor even when a current comment exists (no silent retarget)", () => {
    const c: Cursor = {
      kind: "row",
      file: "src/foo.ts",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "boundary-top", boundaryRef: "top" },
    };
    const a = ann({ id: "a1", line_start: 10, line_end: 10 });
    expect(
      buildTopLevelComposer({ cursor: c, currentComment: a }),
    ).toBeNull();
  });
});

describe("buildReplyComposer", () => {
  it("captures the parent comment id to inherit its anchor at write time", () => {
    const parent = ann({
      id: "a1",
      file: "src/foo.ts",
      side: "deletions",
      line_start: 7,
      line_end: 7,
    });
    const state = buildReplyComposer({ currentComment: parent });
    expect(state).toEqual({ kind: "reply", thread_id: "a1" });
  });

  it("returns null when there's no current comment to reply to", () => {
    const state = buildReplyComposer({ currentComment: null });
    expect(state).toBeNull();
  });
});
