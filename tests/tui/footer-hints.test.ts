import { describe, it, expect } from "vitest";
import {
  TUI_FOOTER_HINTS,
  composeFooterHints,
  composeFooterPreview,
} from "../../src/tui/footer-hints.js";
import { composeFooterHints as composeFooterHintsCore } from "../../src/core/footer-hints.js";
import type { Comment } from "../../src/core/types.js";
import type { Cursor } from "../../src/core/cursor-state.js";

function ann(o: Partial<Comment> & Pick<Comment, "id" | "body">): Comment {
  return {
    id: o.id,
    file: o.file ?? "x.txt",
    side: o.side ?? "additions",
    line_start: o.line_start ?? 1,
    line_end: o.line_end ?? 1,
    body: o.body,
    author: o.author ?? "agent",
    author_kind: o.author_kind ?? "agent",
    replies_to: o.replies_to,
    created_at: o.created_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("TUI_FOOTER_HINTS", () => {
  // Issue #183 / PRD #181: the top-level annotate affordance is labelled
  // "Comment" in both surfaces. Issue #337 / ADR 0029 + ADR 0030 moved
  // the binding from `a` to `c` (lowercase = cursor-target); the legend
  // must show `c: comment` and never the pre-cutover `a: comment` or
  // `a: annotate` shapes.
  it("labels the `c` action as `comment`, not `annotate` (post `a → c` cutover)", () => {
    expect(TUI_FOOTER_HINTS).toContain("c: comment");
    expect(TUI_FOOTER_HINTS).not.toContain("a: comment");
    expect(TUI_FOOTER_HINTS).not.toContain("c: annotate");
    expect(TUI_FOOTER_HINTS).not.toContain("a: annotate");
  });

  it("preserves the other top-level keybindings", () => {
    expect(TUI_FOOTER_HINTS).toContain("j/k: move");
    expect(TUI_FOOTER_HINTS).toContain("n/p: nav");
    expect(TUI_FOOTER_HINTS).toContain("r: reply");
    expect(TUI_FOOTER_HINTS).toContain("q: quit");
  });

  // Issue #312: `[`/`]` resize the sidebar by ±2 cols within
  // `[SIDEBAR_MIN_WIDTH, floor(termW * 0.4)]`. The hint sits next to
  // `Esc: sidebar` (formerly next to `Tab: pane`; both pane-affecting
  // global actions — Tab was retired in issue #345 / PRD #343).
  it("surfaces `[/]: width` as a persistent hint", () => {
    expect(TUI_FOOTER_HINTS).toContain("[/]: width");
  });

  // Issue #326 / PRD #356 / issue #357: `y: yank` is persistent (not
  // gated on a configured agent) — the action is always available; the
  // resolver picks line text or path based on cursor context, and the
  // App-side handler labels degenerate states via footer flash.
  it("surfaces `y: yank` as a persistent hint", () => {
    expect(TUI_FOOTER_HINTS).toContain("y: yank");
    expect(TUI_FOOTER_HINTS).not.toContain("y: yank path");
  });

  it("omits the `R: request reply` hint by default (no reply-agent configured)", () => {
    expect(TUI_FOOTER_HINTS).not.toContain("R: request reply");
    expect(TUI_FOOTER_HINTS).not.toContain("send to");
  });

  // Issue #331: the TUI string is now assembled by `core/footer-hints.ts`
  // and the TUI export is a thin `surface: "tui"` delegate. Lock the
  // refactor against drift: TUI surface output of the core composer
  // must stay byte-identical to today's TUI_FOOTER_HINTS and to the
  // TUI delegate's output across the send-hint matrix.
  it("is byte-identical to the core composer's `surface: tui` output", () => {
    expect(TUI_FOOTER_HINTS).toBe(composeFooterHintsCore({ surface: "tui" }));
    expect(composeFooterHints({ replyAgent: "claude", showSendHint: true })).toBe(
      composeFooterHintsCore({
        surface: "tui",
        replyAgent: "claude",
        showSendHint: true,
      }),
    );
    expect(composeFooterHints({ replyAgent: "claude", showSendHint: false })).toBe(
      composeFooterHintsCore({
        surface: "tui",
        replyAgent: "claude",
        showSendHint: false,
      }),
    );
  });
});

describe("composeFooterHints (issue #184 → relabelled in issue #390)", () => {
  // Issue #390 / ADR 0021 addendum: the action label no longer carries
  // the agent name and is bound to `R` (shift-r) rather than `s`. The
  // configured agent is surfaced via the button tooltip, the in-flight
  // pill, and the agent-reply byline — not the legend. (Pre-rollback
  // the header chip was the canonical home; ADR 0021 addendum amended
  // to record the chip retirement.)
  it("emits `R: request reply` (no agent name interpolated) when showSendHint is true", () => {
    const out = composeFooterHints({ replyAgent: "claude", showSendHint: true });
    expect(out).toContain("R: request reply");
    expect(out).not.toContain("R: request reply claude");
    expect(out).not.toContain("send to");
  });

  it("omits the send hint when replyAgent is unset (even if showSendHint is true)", () => {
    const out = composeFooterHints({ showSendHint: true });
    expect(out).not.toContain("R: request reply");
    expect(out).not.toContain("send to");
  });

  it("omits the send hint when showSendHint is false (e.g. focus is on an agent card)", () => {
    const out = composeFooterHints({ replyAgent: "claude", showSendHint: false });
    expect(out).not.toContain("R: request reply");
    expect(out).not.toContain("send to");
  });

  it("renders the send hint between `r: reply` and `Enter: expand` (next to the human-reply verb)", () => {
    // Issue #406 / ADR 0038 amended: `Enter:` is now cursor-contextual.
    // Pass `enterHintCursor: "interactive"` to assert the prior layout.
    const out = composeFooterHints({
      replyAgent: "codex",
      showSendHint: true,
      enterHintCursor: "interactive",
    });
    const r = out.indexOf("r: reply");
    const requestReply = out.indexOf("R: request reply");
    const enter = out.indexOf("Enter: expand");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(requestReply).toBeGreaterThan(r);
    expect(enter).toBeGreaterThan(requestReply);
  });
});

// PRD #192 / ADR 0022: the bottom-bar footer always renders the cursor's
// `r` action target — a card title (truncated) when the cursor is on a
// card, a no-comment placeholder otherwise. An off-screen suffix
// hints the cursor's direction relative to the viewport so a wheel-
// scrolled-away cursor doesn't surprise the user.
describe("composeFooterPreview (PRD #192)", () => {
  it("renders the no-comment placeholder when the cursor is null", () => {
    expect(composeFooterPreview({ cursor: null, comments: [] })).toBe(
      "r: — (no comment under cursor)",
    );
  });

  it("renders the no-comment placeholder when the cursor is on a row", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "x.txt",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };
    expect(composeFooterPreview({ cursor, comments: [] })).toBe(
      "r: — (no comment under cursor)",
    );
  });

  it("renders `r: reply to \"<title>\"` when the cursor is on a card", () => {
    const cursor: Cursor = { kind: "card", commentId: "a1", preferredSide: "additions" };
    const comments = [ann({ id: "a1", body: "fix the null check" })];
    expect(composeFooterPreview({ cursor, comments })).toBe(
      'r: reply to "fix the null check"',
    );
  });

  it("renders no-comment placeholder when the CardAnchor's id is gone (stale)", () => {
    const cursor: Cursor = { kind: "card", commentId: "ghost", preferredSide: "additions" };
    expect(composeFooterPreview({ cursor, comments: [] })).toBe(
      "r: — (no comment under cursor)",
    );
  });

  it("truncates long titles with an ellipsis", () => {
    const cursor: Cursor = { kind: "card", commentId: "a1", preferredSide: "additions" };
    const longBody = "a".repeat(100);
    const comments = [ann({ id: "a1", body: longBody })];
    const out = composeFooterPreview({ cursor, comments });
    // Expect the body to be truncated with an ellipsis somewhere in the
    // output — the exact width budget lives in the helper but the
    // contract is "title is shorter than the body and ends with an
    // ellipsis when truncated".
    expect(out).toContain('r: reply to "');
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(longBody.length);
  });

  it("uses only the first line of a multi-line body for the preview", () => {
    const cursor: Cursor = { kind: "card", commentId: "a1", preferredSide: "additions" };
    const comments = [ann({ id: "a1", body: "first line\nsecond line" })];
    const out = composeFooterPreview({ cursor, comments });
    expect(out).toContain("first line");
    expect(out).not.toContain("second line");
  });

  // Issue #302: the off-screen suffix is driven by a pixel-position
  // probe on the rendered card's box vs. the diff scrollbox's viewport
  // rect, not by a uniform-row-height index approximation. Cards have
  // very different heights from diff rows (a multi-line markdown block
  // vs. a single diff line), so the prior `avg = scrollHeight / rows`
  // estimate mis-reported visible cards as offscreen whenever tall
  // cards skewed prefix density. The helper now takes a single
  // `cardViewportPosition: "in" | "above" | "below"` signal — computed
  // at the App-shell call site from the rendered card's Y range — and
  // omits the suffix when it's `"in"` or undefined.
  it("appends `(cursor ↑ above viewport)` when the rendered card is above the viewport rect", () => {
    const cursor: Cursor = { kind: "card", commentId: "a1", preferredSide: "additions" };
    const comments = [ann({ id: "a1", body: "hi" })];
    const out = composeFooterPreview({
      cursor,
      comments,
      cardViewportPosition: "above",
    });
    expect(out).toContain("(cursor ↑ above viewport)");
  });

  it("appends `(cursor ↓ below viewport)` when the rendered card is below the viewport rect", () => {
    const cursor: Cursor = { kind: "card", commentId: "a1", preferredSide: "additions" };
    const comments = [ann({ id: "a1", body: "hi" })];
    const out = composeFooterPreview({
      cursor,
      comments,
      cardViewportPosition: "below",
    });
    expect(out).toContain("(cursor ↓ below viewport)");
  });

  it("omits the off-screen suffix when the rendered card intersects the viewport rect", () => {
    const cursor: Cursor = { kind: "card", commentId: "a1", preferredSide: "additions" };
    const comments = [ann({ id: "a1", body: "hi" })];
    const out = composeFooterPreview({
      cursor,
      comments,
      cardViewportPosition: "in",
    });
    expect(out).not.toContain("above viewport");
    expect(out).not.toContain("below viewport");
  });

  it("omits the off-screen suffix when the position probe couldn't resolve (pre-mount / culled)", () => {
    const cursor: Cursor = { kind: "card", commentId: "a1", preferredSide: "additions" };
    const comments = [ann({ id: "a1", body: "hi" })];
    const out = composeFooterPreview({
      cursor,
      comments,
      cardViewportPosition: undefined,
    });
    expect(out).toBe('r: reply to "hi"');
  });
});
