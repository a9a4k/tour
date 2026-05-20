import { describe, it, expect, vi } from "vitest";

vi.mock("@opentui/core", () => ({
  RGBA: { fromHex: () => ({}) },
  SyntaxStyle: { fromStyles: () => ({ tokens: {} }) },
  pathToFiletype: () => undefined,
}));

import { DeleteConfirmModal } from "../../src/tui/DeleteConfirmModal.js";
import type { Comment } from "../../src/core/types.js";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function isElement(node: unknown): node is AnyElement {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

function flatten(node: unknown, out: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const c of node) flatten(c, out);
    return out;
  }
  if (!isElement(node)) return out;
  out.push(node);
  flatten(node.props.children, out);
  return out;
}

function textElements(node: unknown): AnyElement[] {
  return flatten(node).filter((el) => el.type === "text");
}

const comment: Comment = {
  id: "ann-123456",
  file: "src/app.ts",
  side: "additions",
  line_start: 12,
  line_end: 14,
  body: "delete me",
  author: "alice",
  author_kind: "human",
  created_at: "2026-05-20T00:00:00Z",
};

describe("DeleteConfirmModal (TUI)", () => {
  it("keeps action hints and the comment excerpt selectable", () => {
    const tree = DeleteConfirmModal({
      state: { kind: "open", targetId: comment.id },
      target: comment,
      threads: [{ root: comment, replies: [] }],
      now: Date.parse("2026-05-20T00:01:00Z"),
    });
    const texts = textElements(tree);
    const excerpt = texts.find((t) => t.props.children === "delete me");
    const hint = texts.find((t) =>
      typeof t.props.children === "string" &&
      t.props.children.includes("Enter: confirm"),
    );

    expect(excerpt).toBeDefined();
    expect(excerpt!.props["selectable"]).toBeUndefined();
    expect(hint).toBeDefined();
    expect(hint!.props["selectable"]).not.toBe(false);
  });
});
