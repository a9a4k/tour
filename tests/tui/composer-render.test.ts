import { describe, it, expect, vi } from "vitest";

// @opentui/core eagerly loads tree-sitter highlights `.scm` assets at
// module-init, which esbuild can't transform under vitest. Composer only
// needs theme tokens at runtime; stub the heavy bits.
vi.mock("@opentui/core", () => ({
  RGBA: { fromHex: () => ({}) },
  SyntaxStyle: { fromStyles: () => ({ tokens: {} }) },
  pathToFiletype: () => undefined,
}));

import { Composer } from "../../src/tui/Composer.js";
import type { ComposerSlice } from "../../src/core/tour-session.js";

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

function textBodies(tree: unknown): string[] {
  return flatten(tree)
    .filter((el) => el.type === "text")
    .map((el) => {
      const c = el.props.children;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.join("");
      return "";
    });
}

function hasInputBox(tree: unknown): boolean {
  return flatten(tree).some((el) => el.type === "input");
}

const topLevelTarget = {
  kind: "top-level" as const,
  file: "src/x.ts",
  side: "additions" as const,
  line_start: 4,
  line_end: 4,
};

function render(state: Exclude<ComposerSlice, { kind: "closed" }>) {
  return Composer({
    state,
    parent: null,
    onInput: () => {},
    onSubmit: () => {},
  });
}

describe("Composer render gate (issue #254)", () => {
  it("open state shows an editable <input> and the submit hint", () => {
    const tree = render({ kind: "open", target: topLevelTarget, body: "draft" });
    expect(hasInputBox(tree)).toBe(true);
    const texts = textBodies(tree).join(" ");
    expect(texts).toContain("Enter: submit");
    expect(texts).toContain("Esc: cancel");
  });

  // The pre-fix UI rendered nothing when the slice was `submitting`, so a
  // successful-but-slow disk write looked like the composer silently
  // vanished. The submitting state must surface a "submitting…" hint so
  // the user knows the keystroke landed.
  it("submitting state shows the in-flight hint and no editable input", () => {
    const tree = render({
      kind: "submitting",
      target: topLevelTarget,
      body: "the draft",
    });
    expect(hasInputBox(tree)).toBe(false);
    const texts = textBodies(tree).join(" ");
    expect(texts).toContain("Submitting");
    // Body preserved so the user can see what they're submitting.
    expect(texts).toContain("the draft");
  });

  // The pre-fix UI rendered nothing on `errored` either — the silent-fail
  // class of bug the issue tracks. The errored state must surface the
  // error message plus retry / dismiss hints.
  it("errored state surfaces the error + retry / dismiss hints and preserves the body", () => {
    const tree = render({
      kind: "errored",
      target: topLevelTarget,
      body: "preserved draft",
      error: "disk full",
    });
    expect(hasInputBox(tree)).toBe(false);
    const texts = textBodies(tree).join(" ");
    expect(texts).toContain("disk full");
    expect(texts).toContain("Enter: retry");
    expect(texts).toContain("Esc: dismiss");
    expect(texts).toContain("preserved draft");
  });
});
