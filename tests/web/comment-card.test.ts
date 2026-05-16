// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentCard } from "../../src/web/client/App.js";
import type { Comment } from "../../src/web/client/types.js";

// Collapse rule mirrors the TUI side (see tests/tui/comment-card.test.ts):
// ADR 0016 keeps `author = author_kind` as the on-disk default, but the
// renderer suppresses the redundant identity slot when it would just
// re-state the kind bracket. `[human] human · file:42` becomes
// `[human] file:42`; a customised author still surfaces. The `[kind]`
// bracket itself must survive every case to preserve the redundant-cue
// principle (ADR 0008).

let root: Root | null = null;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function mount(element: React.ReactElement): HTMLElement {
  const container = document.getElementById("root")!;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

const baseComment: Comment = {
  id: "ann-1",
  file: "x.txt",
  side: "additions",
  line_start: 1,
  line_end: 1,
  body: "hello",
  author: "human",
  author_kind: "human",
  created_at: "2026-05-11T00:00:00Z",
};

function headerText(container: HTMLElement, commentId = "ann-1"): string {
  // The top-level header is `.comment-block > .ann-header`; the reply
  // headers are `.ann-reply > .ann-header`. Both carry the kind bracket
  // and the optional author token.
  const block = container.querySelector(
    `.comment-block, [id="comment-${commentId}"]`,
  );
  return block?.querySelector(".ann-header")?.textContent ?? "";
}

describe("CommentCard header collapses redundant `author` when author === author_kind", () => {
  it("omits the `human ·` prefix on the top-level header when author was defaulted", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    const text = headerText(container);
    expect(text).toContain("[human]");
    expect(text).toContain("x.txt:1");
    expect(text).not.toContain("human ·");
  });

  it("keeps the `alice ·` prefix on the top-level header when author is customised", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, author: "alice" },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    const text = headerText(container);
    expect(text).toContain("[human]");
    expect(text).toContain("alice");
    expect(text).toContain("·");
  });

  it("omits the trailing `human` on a reply header when author was defaulted", () => {
    const parent: Comment = { ...baseComment, author: "alice" };
    const reply: Comment = {
      ...baseComment,
      id: "ann-2",
      body: "reply body",
      author: "human",
      replies_to: parent.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    const replyHeader = container
      .querySelector(`[id="comment-${reply.id}"]`)
      ?.querySelector(".ann-header");
    expect(replyHeader).not.toBeNull();
    const text = replyHeader?.textContent ?? "";
    expect(text).toContain("[human]");
    // The default literal must not be re-stated after the bracket.
    expect(text.replace("[human]", "")).not.toContain("human");
  });

  it("keeps `claude` on a reply header when the agent supplied its name", () => {
    const parent: Comment = { ...baseComment, author: "alice" };
    const reply: Comment = {
      ...baseComment,
      id: "ann-2",
      body: "reply body",
      author: "claude",
      author_kind: "agent",
      replies_to: parent.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    const replyHeader = container
      .querySelector(`[id="comment-${reply.id}"]`)
      ?.querySelector(".ann-header");
    const text = replyHeader?.textContent ?? "";
    expect(text).toContain("[agent]");
    expect(text).toContain("claude");
  });

  it("keeps the kind bracket bold-class in every case (redundant cue per ADR 0008)", () => {
    // The kind bracket is the load-bearing structural cue. Whether or not
    // the parenthetical collapses, the `.author-kind.<kind>` class must
    // always be present so the redundant colour/structure pair survives.
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    expect(container.querySelector(".author-kind.human")).not.toBeNull();
  });
});

describe("CommentCard `Send to {agent}` affordance (issue #184, PRD #181)", () => {
  // The "Send to {agent}" button lives next to the existing "Reply"
  // button on every human Comment card. Visibility is delegated to
  // `canSendToAgent` in core; this suite covers the rendering side —
  // is the button there, is the label correct, is the disabled state
  // wired to the tour-wide lock.

  it("renders the button labelled with the agent name on a human card when replyAgent is set", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const btn = container.querySelector(".send-to-agent-button");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Send to claude");
  });

  it("interpolates a different agent name verbatim from the prop", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "codex",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelector(".send-to-agent-button")?.textContent).toBe(
      "Send to codex",
    );
  });

  it("hides the button on agent-authored cards (agent-card precedence)", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, author_kind: "agent", author: "claude" },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelector(".send-to-agent-button")).toBeNull();
  });

  it("hides the button when replyAgent is unset (renderer launched without --reply-agent)", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelector(".send-to-agent-button")).toBeNull();
  });

  it("hides the button when a reply has already landed (already-replied terminal)", () => {
    const reply: Comment = {
      ...baseComment,
      id: "ann-2",
      author: "claude",
      author_kind: "agent",
      replies_to: baseComment.id,
      body: "agent reply body",
    };
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelector(".send-to-agent-button")).toBeNull();
  });

  it("disables the button + carries an agent-name tooltip when a reply-lock is held tour-wide", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        replyLock: {
          agent: "claude",
          responding_to: "other-ann",
          started_at: "2026-05-12T09:00:00Z",
          pid: 1,
        },
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const btn = container.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute("title")).toContain("claude is replying");
  });

  it("fires onSendToAgent on click when enabled, swallowing event propagation", () => {
    let fired = 0;
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {
          fired += 1;
        },
        onOpenReply: () => {},
      }),
    );
    const btn = container.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(fired).toBe(1);
  });

  it("renders Reply and Send buttons side-by-side in the ann-actions row", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: true,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const actions = container.querySelector(".ann-actions");
    expect(actions).not.toBeNull();
    expect(actions?.querySelector(".reply-button")).not.toBeNull();
    expect(actions?.querySelector(".send-to-agent-button")).not.toBeNull();
  });
});

describe("CommentCard single bottom action row (issue #191, PRD #181)", () => {
  // A Thread renders exactly one action row at the bottom of the card,
  // collapsing the per-Comment rows from #189 / #190 into a single
  // row. The Reply button targets the latest Comment in the Thread
  // (so a new Reply continues from where the conversation is); the
  // Send button targets the latest human leaf per the unchanged rule
  // from #190.

  const agentTop: Comment = {
    ...baseComment,
    id: "top-agent",
    author: "claude",
    author_kind: "agent",
    created_at: "2026-05-08T00:00:00Z",
  };

  function humanReplyAt(id: string, t: string): Comment {
    return {
      ...baseComment,
      id,
      author: "alice",
      author_kind: "human",
      body: `reply body ${id}`,
      replies_to: agentTop.id,
      created_at: t,
    };
  }

  it("renders exactly one .ann-actions element in a Thread with multiple human Replies", () => {
    const r1 = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const r2 = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelectorAll(".ann-actions")).toHaveLength(1);
  });

  it("renders NO .ann-actions inside any inline-Reply block", () => {
    const r1 = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const r2 = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    for (const reply of [r1, r2]) {
      const block = container.querySelector(`[id="comment-${reply.id}"]`);
      expect(block).not.toBeNull();
      expect(block?.querySelector(".ann-actions")).toBeNull();
    }
  });

  it("renders the bottom action row after the inline Replies list", () => {
    const r1 = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [r1],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const block = container.querySelector(".comment-block");
    const children = Array.from(block?.children ?? []);
    const repliesIdx = children.findIndex((c) =>
      c.classList?.contains("ann-replies"),
    );
    const actionsIdx = children.findIndex((c) =>
      c.classList?.contains("ann-actions"),
    );
    expect(repliesIdx).toBeGreaterThan(-1);
    expect(actionsIdx).toBeGreaterThan(repliesIdx);
  });

  it("shows exactly one Send button (the latest human Reply's) when two human siblings are leaves", () => {
    const r1 = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const r2 = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelectorAll(".send-to-agent-button")).toHaveLength(1);
  });

  it("renders NO Send button anywhere when the latest turn in the Thread is agent-authored", () => {
    const human = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const agentLatest: Comment = {
      ...baseComment,
      id: "ann-r-agent-latest",
      author: "claude",
      author_kind: "agent",
      replies_to: agentTop.id,
      body: "agent latest body",
      created_at: "2026-05-08T00:00:02Z",
    };
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [human, agentLatest],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelectorAll(".send-to-agent-button")).toHaveLength(0);
  });

  it("still renders the Reply button even when the latest turn is agent-authored", () => {
    // PRD #181 — Reply is always available so the user can drive the
    // conversation. Send is not, but Reply is.
    const human = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const agentLatest: Comment = {
      ...baseComment,
      id: "ann-r-agent-latest",
      author: "claude",
      author_kind: "agent",
      replies_to: agentTop.id,
      body: "agent latest body",
      created_at: "2026-05-08T00:00:02Z",
    };
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [human, agentLatest],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelectorAll(".reply-button")).toHaveLength(1);
  });

  it("renders the Reply button on an agent-only Thread (agent top-level, no replies)", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(container.querySelectorAll(".reply-button")).toHaveLength(1);
    // No Send — latest is the agent top-level itself.
    expect(container.querySelectorAll(".send-to-agent-button")).toHaveLength(0);
  });

  it("Reply button fires onOpenReply with the latest Comment's id (not the top-level's)", () => {
    let lastId: string | null = null;
    const r1 = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const r2 = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: (id: string) => {
          lastId = id;
        },
      }),
    );
    const btn = container.querySelector(".reply-button") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(lastId).toBe(r2.id);
  });

  it("Reply button fires onOpenReply with the top-level's id when the Thread has no Replies", () => {
    let lastId: string | null = null;
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: (id: string) => {
          lastId = id;
        },
      }),
    );
    const btn = container.querySelector(".reply-button") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(lastId).toBe(agentTop.id);
  });

  it("Reply button targets the latest Comment by created_at when it's a Reply-to-Reply descendant", () => {
    // [human] top + [agent] r1 + [human] r2 (latest leaf) — the chain
    // descends through r1; Reply must target r2, not the top-level.
    let lastId: string | null = null;
    const humanTop: Comment = {
      ...baseComment,
      id: "top-human",
      author: "alice",
      author_kind: "human",
      created_at: "2026-05-08T00:00:00Z",
    };
    const r1: Comment = {
      ...baseComment,
      id: "ann-r1",
      author: "claude",
      author_kind: "agent",
      replies_to: humanTop.id,
      body: "agent r1 body",
      created_at: "2026-05-08T00:00:01Z",
    };
    const r2: Comment = {
      ...baseComment,
      id: "ann-r2",
      author: "alice",
      author_kind: "human",
      replies_to: r1.id,
      body: "human r2 body",
      created_at: "2026-05-08T00:00:02Z",
    };
    const container = mount(
      createElement(CommentCard, {
        comment: humanTop,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: (id: string) => {
          lastId = id;
        },
      }),
    );
    const btn = container.querySelector(".reply-button") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(lastId).toBe(r2.id);
  });

  it("Send button fires onSendToAgent with the latest human leaf's id (not an older human sibling's)", () => {
    let lastId: string | null = null;
    const older = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const latest = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [older, latest],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: (id: string) => {
          lastId = id;
        },
        onOpenReply: () => {},
      }),
    );
    const btn = container.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(lastId).toBe(latest.id);
  });

  it("keeps the lock-held disabled + tooltip on the single rendered Send button", () => {
    const older = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const latest = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [older, latest],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        replyLock: {
          agent: "claude",
          responding_to: "other-ann",
          started_at: "2026-05-12T09:00:00Z",
          pid: 1,
        },
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const btn = container.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute("title")).toContain("claude is replying");
    expect(container.querySelectorAll(".send-to-agent-button")).toHaveLength(1);
  });

  it("suppresses the bottom action row when the composer is open under the top-level", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        replyTargetId: agentTop.id,
        onSendToAgent: () => {},
        onOpenReply: () => {},
        onSubmitReply: () => {},
        onCancelReply: () => {},
      }),
    );
    expect(container.querySelectorAll(".ann-actions")).toHaveLength(0);
    expect(container.querySelector(".ann-reply-composer")).not.toBeNull();
  });

  it("suppresses the bottom action row when the composer is open under an inline Reply", () => {
    const r1 = humanReplyAt("ann-r1", "2026-05-08T00:00:01Z");
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [r1],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        replyTargetId: r1.id,
        onSendToAgent: () => {},
        onOpenReply: () => {},
        onSubmitReply: () => {},
        onCancelReply: () => {},
      }),
    );
    expect(container.querySelectorAll(".ann-actions")).toHaveLength(0);
    // Composer renders inline within the Reply block.
    const replyBlock = container.querySelector(`[id="comment-${r1.id}"]`);
    expect(replyBlock?.querySelector(".ann-reply-composer")).not.toBeNull();
  });
});

// Issue #383 / ADR 0035: the annotation card filename becomes a clickable
// location-stamp link. Click moves the cursor onto the card AND
// dispatches open-in-editor at line_end; `stopPropagation` keeps the
// surrounding card-onClick (cursor-on-card) from double-firing. The link
// renders as an interactive element with an aria-label so the affordance
// is announced to assistive tech.
describe("CommentCard annotation filename link (issue #383)", () => {
  it("renders the filename as an interactive button with an aria-label naming the file:range", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, line_start: 42, line_end: 48 },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onFileClick: () => {},
      }),
    );
    const link = container.querySelector(
      ".ann-filename-link",
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    expect(link!.tagName).toBe("BUTTON");
    expect(link!.textContent).toBe("x.txt:42-48");
    expect(link!.getAttribute("aria-label")).toBe(
      "Open x.txt:42-48 in editor",
    );
  });

  it("uses a single line number (no range) when line_start === line_end", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onFileClick: () => {},
      }),
    );
    const link = container.querySelector(".ann-filename-link");
    expect(link?.textContent).toBe("x.txt:1");
  });

  it("falls back to inert text (no button) when onFileClick is not supplied", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    expect(container.querySelector(".ann-filename-link")).toBeNull();
    const header = container.querySelector(".ann-header");
    expect(header?.textContent).toContain("x.txt:1");
  });

  it("clicking the link fires onFileClick with (commentId, file, line_end)", () => {
    const calls: Array<[string, string, number]> = [];
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, line_start: 42, line_end: 48 },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onFileClick: (id: string, file: string, lineEnd: number) => {
          calls.push([id, file, lineEnd]);
        },
      }),
    );
    const link = container.querySelector(
      ".ann-filename-link",
    ) as HTMLButtonElement;
    act(() => {
      link.click();
    });
    expect(calls).toEqual([["ann-1", "x.txt", 48]]);
  });

  it("clicking the link does NOT also fire the surrounding onCardClick (stopPropagation)", () => {
    let cardClicks = 0;
    let fileClicks = 0;
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: () => {
          cardClicks += 1;
        },
        onFileClick: () => {
          fileClicks += 1;
        },
      }),
    );
    const link = container.querySelector(
      ".ann-filename-link",
    ) as HTMLButtonElement;
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fileClicks).toBe(1);
    expect(cardClicks).toBe(0);
  });

  it("clicking elsewhere on the card still fires onCardClick (link does not steal the card click)", () => {
    let cardClicks = 0;
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: () => {
          cardClicks += 1;
        },
        onFileClick: () => {},
      }),
    );
    const body = container.querySelector(".ann-body") as HTMLElement;
    act(() => {
      body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(cardClicks).toBe(1);
  });
});
