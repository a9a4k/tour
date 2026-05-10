import { describe, it, expect } from "vitest";
import {
  buildReplyComposer,
  buildTopLevelComposer,
} from "../../src/tui/composer-state.js";
import type { Annotation } from "../../src/core/types.js";

function ann(overrides: Partial<Annotation> & Pick<Annotation, "id">): Annotation {
  return {
    id: overrides.id,
    file: overrides.file ?? "src/x.ts",
    side: overrides.side ?? "additions",
    line_start: overrides.line_start ?? 10,
    line_end: overrides.line_end ?? 10,
    body: overrides.body ?? "agent note",
    author: overrides.author ?? "agent",
    author_kind: overrides.author_kind ?? "agent",
    replies_to: overrides.replies_to,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("buildTopLevelComposer", () => {
  it("anchors to the current annotation when one is selected", () => {
    const current = ann({
      id: "a1",
      file: "src/foo.ts",
      side: "additions",
      line_start: 42,
      line_end: 44,
    });
    const state = buildTopLevelComposer({
      currentAnnotation: current,
      fallback: null,
    });
    expect(state).toEqual({
      kind: "top-level",
      file: "src/foo.ts",
      side: "additions",
      line_start: 42,
      line_end: 44,
    });
  });

  it("falls back to the provided fallback anchor when no annotation is current", () => {
    const state = buildTopLevelComposer({
      currentAnnotation: null,
      fallback: {
        file: "src/bar.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
      },
    });
    expect(state).toEqual({
      kind: "top-level",
      file: "src/bar.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
    });
  });

  it("returns null when there's neither a current annotation nor a fallback", () => {
    const state = buildTopLevelComposer({
      currentAnnotation: null,
      fallback: null,
    });
    expect(state).toBeNull();
  });
});

describe("buildReplyComposer", () => {
  it("captures the parent annotation to inherit its anchor at write time", () => {
    const parent = ann({
      id: "a1",
      file: "src/foo.ts",
      side: "deletions",
      line_start: 7,
      line_end: 7,
    });
    const state = buildReplyComposer({ currentAnnotation: parent });
    expect(state).toEqual({ kind: "reply", parent });
  });

  it("returns null when there's no current annotation to reply to", () => {
    const state = buildReplyComposer({ currentAnnotation: null });
    expect(state).toBeNull();
  });
});
