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

function findTextarea(tree: unknown): AnyElement | undefined {
  return flatten(tree).find((el) => el.type === "textarea");
}

function hasEditor(tree: unknown): boolean {
  return flatten(tree).some((el) => el.type === "textarea" || el.type === "input");
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

describe("Composer render gate (issue #254 + issue #391)", () => {
  // Issue #391: the open composer must use a multi-line editor, not the
  // single-line <input>. <input>'s default `scrollMargin` reserves ~15
  // cols of right-edge space before scrolling and binds Enter to submit,
  // making multi-paragraph notes impossible.
  it("open state shows an editable <textarea> seeded from the slice body", () => {
    const tree = render({ kind: "open", target: topLevelTarget, body: "draft" });
    const ta = findTextarea(tree);
    expect(ta).toBeDefined();
    // No legacy <input> renderable — those defaults are exactly what we're
    // trying to escape.
    expect(flatten(tree).some((el) => el.type === "input")).toBe(false);
    // The slice's body seeds `initialValue` so re-mounts after errored →
    // open restore the preserved draft. The textarea reports edits back
    // via onContentChange (wired in app.tsx via a ref).
    expect(ta?.props.initialValue).toBe("draft");
    // Multi-line is the whole point — char/word wrap and scrollMargin: 0
    // are the two settings that fix the visible-text-stops-15-cols-early
    // bug. Pin them so a future refactor can't silently regress.
    expect(ta?.props.wrapMode === "word" || ta?.props.wrapMode === "char").toBe(true);
    expect(ta?.props.scrollMargin).toBe(0);
  });

  it("open state's hint row documents the submit / newline / cancel chord", () => {
    const tree = render({ kind: "open", target: topLevelTarget, body: "draft" });
    const texts = textBodies(tree).join(" ");
    // Slack-pattern submit chord (issue #394): Enter submits, Shift+Enter
    // (Kitty-protocol terminals) or Ctrl+J (universal fallback) inserts
    // a newline. The hint row must surface all three chords plus Esc.
    expect(texts).toContain("Enter: submit");
    expect(texts).toContain("Esc: cancel");
    // At least one of the newline chord names must appear — both is
    // even better. Pin "newline" so a future copy refresh that drops
    // both names would still fail.
    expect(texts.includes("Shift+Enter") || texts.includes("Ctrl+J")).toBe(
      true,
    );
    expect(texts).toContain("newline");
    // Negatives: the retired Ctrl+S copy and the original "Enter:
    // newline" wording from issue #391 must not appear anywhere — users
    // shouldn't be told to use either pattern.
    expect(texts).not.toContain("Ctrl+S: submit");
    expect(texts).not.toContain("Enter: newline");
  });

  // Issue #394 acceptance: pin the textarea's `keyBindings` prop to
  // include the Enter → submit override. opentui's defaults bind
  // `return` to `newline`; without this entry the merge would leave
  // Enter as newline. `linefeed` → newline (Ctrl+J) is opentui's
  // default and remains in effect via merge.
  it("open state's <textarea> binds Enter to submit", () => {
    const tree = render({ kind: "open", target: topLevelTarget, body: "" });
    const ta = findTextarea(tree);
    expect(ta).toBeDefined();
    const bindings = ta?.props.keyBindings as
      | Array<{ name: string; shift?: boolean; ctrl?: boolean; action: string }>
      | undefined;
    expect(Array.isArray(bindings)).toBe(true);
    const hasEnterSubmit = (bindings ?? []).some(
      (b) => b.name === "return" && !b.shift && !b.ctrl && b.action === "submit",
    );
    expect(hasEnterSubmit).toBe(true);
    // Negative: the retired Ctrl+S submit binding must not be present.
    const hasCtrlSSubmit = (bindings ?? []).some(
      (b) => b.name === "s" && b.ctrl === true && b.action === "submit",
    );
    expect(hasCtrlSSubmit).toBe(false);
  });

  // The pre-fix UI rendered nothing when the slice was `submitting`, so a
  // successful-but-slow disk write looked like the composer silently
  // vanished. The submitting state must surface a "submitting…" hint so
  // the user knows the keystroke landed.
  it("submitting state shows the in-flight hint and no editable editor", () => {
    const tree = render({
      kind: "submitting",
      target: topLevelTarget,
      body: "the draft",
    });
    expect(hasEditor(tree)).toBe(false);
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
    expect(hasEditor(tree)).toBe(false);
    const texts = textBodies(tree).join(" ");
    expect(texts).toContain("disk full");
    expect(texts).toContain("Enter: retry");
    expect(texts).toContain("Esc: dismiss");
    expect(texts).toContain("preserved draft");
  });

  // Issue #391: an embedded newline must round-trip through the
  // submitting / errored render path verbatim — the preserved draft is
  // rendered as plain text, and `\n` in a <text> body must survive into
  // the rendered children unchanged so retry from `errored` keeps the
  // user's paragraph structure.
  it("preserves embedded newlines in the submitting / errored draft render", () => {
    const tree = render({
      kind: "submitting",
      target: topLevelTarget,
      body: "line one\nline two",
    });
    // The body appears in a <text> child — assert the exact \n survives.
    const allText = textBodies(tree).join("␟");
    expect(allText).toContain("line one\nline two");
  });
});
