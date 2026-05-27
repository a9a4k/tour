// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentCard } from "../../src/web/client/App.js";
import type { Comment } from "../../src/web/client/types.js";
import type { ReplyLock } from "../../src/core/reply-lock.js";
import { TEXT_SELECTABLE_CLASS } from "../../src/web/client/text-selection.js";

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
      thread_id: parent.id,
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
      thread_id: parent.id,
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

describe("CommentCard text selection", () => {
  it("marks visible comment text and metadata selectable while leaving action chrome unmarked", () => {
    const reply: Comment = {
      ...baseComment,
      id: "ann-2",
      body: "reply body",
      author_kind: "agent",
      author: "claude",
      thread_id: baseComment.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onFileClick: () => {},
        onOpenReply: () => {},
      }),
    );

    expect(
      container
        .querySelector(".comment-block > .ann-body")
        ?.classList.contains(TEXT_SELECTABLE_CLASS),
    ).toBe(true);
    expect(
      container
        .querySelector(`[id="comment-${reply.id}"] .ann-body`)
        ?.classList.contains(TEXT_SELECTABLE_CLASS),
    ).toBe(true);
    expect(
      container
        .querySelector(".ann-filename-link")
        ?.classList.contains(TEXT_SELECTABLE_CLASS),
    ).toBe(true);
    for (const selector of [
      ".nav-index",
      ".author-kind",
      ".reply-agent-byline",
    ]) {
      expect(
        container
          .querySelector(selector)
          ?.classList.contains(TEXT_SELECTABLE_CLASS),
      ).toBe(true);
    }
    expect(
      container
        .querySelector(".reply-button")
        ?.classList.contains(TEXT_SELECTABLE_CLASS),
    ).toBe(false);
  });

  it("keeps plain body clicks immediate but suppresses card activation after a body drag", () => {
    const calls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: (id: string) => {
          calls.push(id);
        },
      }),
    );
    const body = container.querySelector(".ann-body") as HTMLElement;
    expect(body).not.toBeNull();

    act(() => {
      body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });
    expect(calls).toEqual(["ann-1"]);

    act(() => {
      body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      body.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      body.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 34, clientY: 10 }),
      );
    });
    expect(calls).toEqual(["ann-1"]);
  });

  it("suppresses card activation after dragging visible metadata", () => {
    const calls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, author: "alice" },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: (id: string) => {
          calls.push(id);
        },
      }),
    );
    const author = container.querySelector(".author-kind") as HTMLElement;
    expect(author).not.toBeNull();

    act(() => {
      author.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      author.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      author.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      author.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 34, clientY: 10 }),
      );
    });

    expect(calls).toEqual([]);
  });

  it("keeps reply body plain clicks immediate but suppresses reply activation after a reply body drag", () => {
    const reply: Comment = {
      ...baseComment,
      id: "ann-2",
      body: "reply body",
      thread_id: baseComment.id,
    };
    const calls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: (id: string) => {
          calls.push(id);
        },
      }),
    );
    const body = container.querySelector(
      `[id="comment-${reply.id}"] .ann-body`,
    ) as HTMLElement;
    expect(body).not.toBeNull();

    act(() => {
      body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });
    expect(calls).toEqual(["ann-2"]);

    act(() => {
      body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      body.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      body.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 34, clientY: 10 }),
      );
    });
    expect(calls).toEqual(["ann-2"]);
  });

  it("keeps location-stamp clicks immediate but suppresses open-in-editor after a location-stamp drag", () => {
    const opens: Array<[string, string, number]> = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onFileClick: (id: string, file: string, lineEnd: number) => {
          opens.push([id, file, lineEnd]);
        },
      }),
    );
    const stamp = container.querySelector(".ann-filename-link") as HTMLElement;
    expect(stamp).not.toBeNull();

    act(() => {
      stamp.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });
    expect(opens).toEqual([["ann-1", "x.txt", 1]]);

    act(() => {
      stamp.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      stamp.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      stamp.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 34, clientY: 10 }),
      );
      stamp.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 34, clientY: 10 }),
      );
    });
    expect(opens).toEqual([["ann-1", "x.txt", 1]]);
  });
});

describe("CommentCard `Request reply` affordance (issue #184, PRD #181; relabelled in issue #390)", () => {
  // The "Request reply" button (issue #390 / ADR 0021 addendum —
  // formerly "Send to {agent}") lives next to the existing "Reply"
  // button on every human Comment card. Visibility is delegated to
  // `canSendToAgent` in core; this suite covers the rendering side —
  // is the button there, is the label correct, is the disabled state
  // wired to the tour-wide lock, does the tooltip name the configured
  // agent and clarify the separate-session fact.

  it("renders the button labelled `Request reply` (no agent name on the button) on a human card when replyAgent is set", () => {
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
    expect(btn?.textContent).toBe("Request reply");
    // The agent name is intentionally NOT on the button itself —
    // it lives on the tooltip, the in-flight pill, and the agent-
    // reply byline. (The header chip carried it pre-rollback; ADR
    // 0021 addendum amended to record the retirement.)
    expect(btn?.textContent).not.toContain("claude");
  });

  it("renders the same `Request reply` label irrespective of the configured agent (no interpolation on the button)", () => {
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
      "Request reply",
    );
    expect(
      container.querySelector(".send-to-agent-button")?.textContent,
    ).not.toContain("codex");
  });

  it("hovering the button shows a tooltip that names the configured reply-agent and clarifies the separate-session fact", () => {
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
    const btn = container.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    const tip = btn?.getAttribute("title") ?? "";
    expect(tip).toContain("claude");
    expect(tip.toLowerCase()).toContain("separate session");
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

  it("renders a Tour config hint instead of the button when replyAgent is unset", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onSendToAgent: () => {},
        onOpenReply: () => {},
        replyAgentConfigPath: "/tmp/tour-home/config.toml",
      }),
    );
    expect(container.querySelector(".send-to-agent-button")).toBeNull();
    expect(
      container.querySelector(".request-reply-config-hint")?.textContent,
    ).toBe("Set `reply_agent` in /tmp/tour-home/config.toml to enable Request reply");
  });

  it("omits the Tour config hint when Request reply is configured or already terminal", () => {
    const configured = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        replyAgentConfigPath: "/tmp/tour-home/config.toml",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(configured.querySelector(".request-reply-config-hint")).toBeNull();
    act(() => root!.unmount());
    root = null;

    const agentReply: Comment = {
      ...baseComment,
      id: "ann-2",
      author: "claude",
      author_kind: "agent",
      thread_id: "ann-1",
      created_at: "2026-05-11T00:00:01Z",
    };
    const alreadyRepliedByAgent = mount(
      createElement(CommentCard, {
        comment: baseComment,
        replies: [agentReply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgentConfigPath: "/tmp/tour-home/config.toml",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(
      alreadyRepliedByAgent.querySelector(".request-reply-config-hint"),
    ).toBeNull();
    act(() => root!.unmount());
    root = null;

    const humanReply: Comment = {
      ...baseComment,
      id: "ann-3",
      author: "almas",
      author_kind: "human",
      thread_id: "ann-1",
      created_at: "2026-05-11T00:00:02Z",
    };
    const alreadyRepliedByHuman = mount(
      createElement(CommentCard, {
        comment: baseComment,
        replies: [agentReply, humanReply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgentConfigPath: "/tmp/tour-home/config.toml",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(
      alreadyRepliedByHuman.querySelector(".request-reply-config-hint"),
    ).toBeNull();
  });

  it("hides the button when a reply has already landed (already-replied terminal)", () => {
    const reply: Comment = {
      ...baseComment,
      id: "ann-2",
      author: "claude",
      author_kind: "agent",
      thread_id: baseComment.id,
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

  it("disables the button + carries a worker-role tooltip when a reply-lock is held tour-wide", () => {
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
    // Issue #390: the lock-held tooltip names the worker role
    // ("Reply agent (<name>) is replying — wait") so the cue carries
    // the same role-naming framing as the in-flight pill and the
    // agent-reply byline. (Pre-rollback the header chip was the
    // canonical home; ADR 0021 addendum amended.)
    const tip = btn?.getAttribute("title") ?? "";
    expect(tip).toContain("Reply agent");
    expect(tip).toContain("claude");
    expect(tip).toContain("is replying");
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
      thread_id: agentTop.id,
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
      thread_id: agentTop.id,
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
      thread_id: agentTop.id,
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
      thread_id: humanTop.id,
      body: "agent r1 body",
      created_at: "2026-05-08T00:00:01Z",
    };
    const r2: Comment = {
      ...baseComment,
      id: "ann-r2",
      author: "alice",
      author_kind: "human",
      thread_id: r1.id,
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

  it("Reply button seats cursor on the leaf, not the parent (ADR 0037 mouse-path parity)", () => {
    // Pre-fix the handler dispatched `onCardClick(comment.id)` — the
    // parent's id, always. With cursor-on-reply now reachable (issue
    // #411), that seat downgraded the cursor back to the parent on
    // every Reply-button click. Seat on the leaf (replyTargetForOpen)
    // so the cursor follows the same node the composer attaches to.
    const r1 = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const r2 = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const clicks: string[] = [];
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
        onCardClick: (id: string) => clicks.push(id),
      }),
    );
    const btn = container.querySelector(".reply-button") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    // The handler fires exactly one onCardClick — with the leaf's id.
    expect(clicks).toEqual([r2.id]);
    expect(clicks).not.toContain(agentTop.id);
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

  it("Send button seats cursor on the leaf, not the parent (ADR 0037 mouse-path parity)", () => {
    // Symmetric with the Reply-button pin above. Pre-fix the handler
    // dispatched `onCardClick(comment.id)` — the parent's id, always.
    // With cursor-on-reply reachable (issue #411), that seat
    // downgraded the cursor on every Request-reply click. Seat on
    // the leaf (sendLeafId, the latest human leaf) so the cursor
    // follows the same node the dispatch targets.
    const older = humanReplyAt("ann-r-old", "2026-05-08T00:00:01Z");
    const latest = humanReplyAt("ann-r-new", "2026-05-08T00:00:02Z");
    const clicks: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        replies: [older, latest],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
        onCardClick: (id: string) => clicks.push(id),
      }),
    );
    const btn = container.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(clicks).toEqual([latest.id]);
    expect(clicks).not.toContain(agentTop.id);
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
    const tip2 = btn?.getAttribute("title") ?? "";
    expect(tip2).toContain("Reply agent");
    expect(tip2).toContain("claude");
    expect(tip2).toContain("is replying");
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

describe("CommentCard trash icon + `[deleted]` stub (issue #389 / ADR 0036)", () => {
  it("renders a pencil edit button on the parent header and calls onOpenEdit with the current body (Issue #465)", () => {
    const calls: Array<{ id: string; body: string }> = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: () => {},
        onOpenEdit: (id: string, body: string) => {
          calls.push({ id, body });
        },
      }),
    );
    const edit = container.querySelector(
      ".comment-block > .ann-header .ann-edit-button",
    ) as HTMLButtonElement | null;
    const trash = container.querySelector(
      ".comment-block > .ann-header .ann-trash-button",
    ) as HTMLButtonElement | null;
    expect(edit).not.toBeNull();
    expect(edit!.getAttribute("aria-label")).toBe("Edit comment");
    expect(trash).not.toBeNull();

    act(() => {
      edit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ id: "ann-1", body: "hello" }]);
  });

  it("renders a pencil edit button on each inline Reply header (Issue #465)", () => {
    const parent = { ...baseComment, id: "p" };
    const reply: Comment = {
      ...baseComment,
      id: "r1",
      body: "reply body",
      thread_id: parent.id,
    };
    const calls: Array<{ id: string; body: string }> = [];
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: () => {},
        onOpenEdit: (id: string, body: string) => calls.push({ id, body }),
      }),
    );
    const edit = container.querySelector(
      ".ann-reply .ann-edit-button",
    ) as HTMLButtonElement | null;
    expect(edit).not.toBeNull();
    expect(edit!.getAttribute("aria-label")).toBe("Edit comment");

    act(() => {
      edit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ id: "r1", body: "reply body" }]);
  });

  it("renders a trash button on the parent header when onDeleteClick is supplied", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: () => {},
      }),
    );
    const trash = container.querySelector(
      ".comment-block > .ann-header .ann-trash-button",
    ) as HTMLButtonElement | null;
    expect(trash).not.toBeNull();
    expect(trash!.getAttribute("aria-label")).toBe("Delete comment");
  });

  it("omits the trash button when onDeleteClick is not supplied", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    expect(container.querySelector(".ann-trash-button")).toBeNull();
  });

  it("clicking the parent trash button fires onDeleteClick with the parent's id", () => {
    const calls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: (id: string) => {
          calls.push(id);
        },
      }),
    );
    const trash = container.querySelector(
      ".comment-block > .ann-header .ann-trash-button",
    ) as HTMLButtonElement;
    act(() => {
      trash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual(["ann-1"]);
  });

  it("clicking the parent trash button does NOT also fire onCardClick (stopPropagation)", () => {
    let cardClicks = 0;
    let deleteClicks = 0;
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: () => {
          cardClicks += 1;
        },
        onDeleteClick: () => {
          deleteClicks += 1;
        },
      }),
    );
    const trash = container.querySelector(
      ".comment-block > .ann-header .ann-trash-button",
    ) as HTMLButtonElement;
    act(() => {
      trash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(deleteClicks).toBe(1);
    expect(cardClicks).toBe(0);
  });

  it("renders a trash button on each inline Reply header", () => {
    const parent = { ...baseComment, id: "p", author: "alice" };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "reply 1",
      thread_id: parent.id,
    };
    const r2: Comment = {
      ...baseComment,
      id: "r2",
      body: "reply 2",
      thread_id: parent.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: () => {},
      }),
    );
    const replyTrashes = container.querySelectorAll(
      ".ann-reply .ann-trash-button",
    );
    expect(replyTrashes.length).toBe(2);
    expect(replyTrashes[0].getAttribute("aria-label")).toBe("Delete reply");
  });

  it("clicking a reply's trash button fires onDeleteClick with the reply's id (not the parent's)", () => {
    const parent = { ...baseComment, id: "p" };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "reply 1",
      thread_id: parent.id,
    };
    const r2: Comment = {
      ...baseComment,
      id: "r2",
      body: "reply 2",
      thread_id: parent.id,
    };
    const calls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: (id: string) => {
          calls.push(id);
        },
      }),
    );
    const replyTrashes = container.querySelectorAll(
      ".ann-reply .ann-trash-button",
    ) as NodeListOf<HTMLButtonElement>;
    act(() => {
      replyTrashes[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual(["r2"]);
  });

  // Issue #411 — clicking inside a `.ann-reply` div lands the cursor on
  // the reply's id (not the parent). The reply-click handler must call
  // `event.stopPropagation()` so the surrounding wrapper's onClick does
  // NOT also fire with the parent id; otherwise both fire and the last-
  // dispatched (the wrapper) wins.
  it("clicking inside a `.ann-reply` div fires onCardClick with the reply's id (issue #411)", () => {
    const parent = { ...baseComment, id: "p" };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "reply 1",
      thread_id: parent.id,
    };
    const r2: Comment = {
      ...baseComment,
      id: "r2",
      body: "reply 2",
      thread_id: parent.id,
    };
    const calls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: (id: string) => calls.push(id),
      }),
    );
    const reply2 = container.querySelector("#comment-r2") as HTMLElement;
    expect(reply2).not.toBeNull();
    act(() => {
      reply2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The wrapper would have dispatched the parent's id if propagation
    // weren't stopped; the per-reply handler must dispatch only the
    // reply's id.
    expect(calls).toEqual(["r2"]);
  });

  it("clicking inside the parent body still fires onCardClick with the parent's id (issue #411)", () => {
    const parent = { ...baseComment, id: "p" };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "reply 1",
      thread_id: parent.id,
    };
    const calls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [r1],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: (id: string) => calls.push(id),
      }),
    );
    const parentBlock = container.querySelector(
      ".comment-block",
    ) as HTMLElement;
    const parentBody = parentBlock.querySelector(
      ":scope > .ann-body",
    ) as HTMLElement;
    act(() => {
      parentBody.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual(["p"]);
  });

  it("clicking a reply's trash button does NOT also fire onCardClick (existing stopPropagation, issue #411 regression)", () => {
    const parent = { ...baseComment, id: "p" };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "reply 1",
      thread_id: parent.id,
    };
    const cardCalls: string[] = [];
    const deleteCalls: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [r1],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onCardClick: (id: string) => cardCalls.push(id),
        onDeleteClick: (id: string) => deleteCalls.push(id),
      }),
    );
    const trash = container.querySelector(
      ".ann-reply .ann-trash-button",
    ) as HTMLButtonElement;
    act(() => {
      trash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(deleteCalls).toEqual(["r1"]);
    expect(cardCalls).toEqual([]);
  });

  it("renders the parent card as a `[deleted]` stub when comment.deleted is set", () => {
    const stubbed: Comment = {
      ...baseComment,
      body: "",
      deleted: { at: "2026-05-16T00:00:00Z" },
    };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "I survived",
      thread_id: stubbed.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: stubbed,
        replies: [r1],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: () => {},
      }),
    );
    const block = container.querySelector(
      ".comment-block",
    ) as HTMLElement;
    expect(block.classList.contains("deleted-stub")).toBe(true);
    // The body slot shows the [deleted] placeholder rather than the
    // (empty) markdown-rendered body.
    const body = block.querySelector(".ann-body") as HTMLElement;
    expect(body.textContent).toBe("[deleted]");
    // The reply text still renders under the stub.
    expect(container.textContent).toContain("I survived");
  });

  it("suppresses the trash button on the parent header when the card is a `[deleted]` stub", () => {
    const stubbed: Comment = {
      ...baseComment,
      body: "",
      deleted: { at: "2026-05-16T00:00:00Z" },
    };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "alive",
      thread_id: stubbed.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: stubbed,
        replies: [r1],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: () => {},
      }),
    );
    // The parent header has no trash button (CSS suppresses .deleted-stub
    // > .ann-trash-button; the markup omits it).
    const block = container.querySelector(".comment-block") as HTMLElement;
    expect(
      block.querySelector(":scope > .ann-header .ann-trash-button"),
    ).toBeNull();
    // The reply still carries its own trash button (the stub doesn't
    // strip the per-reply affordance).
    expect(
      block.querySelector(".ann-reply .ann-trash-button"),
    ).not.toBeNull();
  });

  it("suppresses the edit button on the parent header when the card is a `[deleted]` stub", () => {
    const stubbed: Comment = {
      ...baseComment,
      body: "",
      deleted: { at: "2026-05-16T00:00:00Z" },
    };
    const r1: Comment = {
      ...baseComment,
      id: "r1",
      body: "alive",
      thread_id: stubbed.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: stubbed,
        replies: [r1],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onDeleteClick: () => {},
        onOpenEdit: () => {},
      }),
    );
    const block = container.querySelector(".comment-block") as HTMLElement;
    expect(
      block.querySelector(":scope > .ann-header .ann-edit-button"),
    ).toBeNull();
    expect(
      block.querySelector(".ann-reply .ann-edit-button"),
    ).not.toBeNull();
  });
});

describe("CommentCard reply-agent byline marker (issue #390 / ADR 0021 addendum)", () => {
  // Issue #390 AC: "When the reply-agent's reply lands as a child
  // Annotation, its byline renders the agent as a distinct participant
  // — e.g. `claude · reply-agent` — so the second instance becomes a
  // visible entity in the conversation."
  //
  // The structural marker is `author_kind === "agent" && thread_id`
  // — those replies are by construction produced by `reply-runner`'s
  // `createReply` call. Top-level agent annotations don't carry the
  // marker (they came in via ingestion, not the dispatch path).

  const parent: Comment = {
    ...baseComment,
    id: "parent-1",
    author: "alice",
    author_kind: "human",
  };

  it("renders ` · reply-agent` next to an agent-authored Reply's byline", () => {
    const reply: Comment = {
      ...baseComment,
      id: "ann-reply-from-agent",
      body: "agent reply body",
      author: "claude",
      author_kind: "agent",
      thread_id: parent.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const replyBlock = container.querySelector(`[id="comment-${reply.id}"]`);
    expect(replyBlock).not.toBeNull();
    const marker = replyBlock?.querySelector(".reply-agent-byline");
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain("reply-agent");
  });

  it("does NOT render the marker on a human-authored Reply", () => {
    const reply: Comment = {
      ...baseComment,
      id: "ann-reply-from-human",
      body: "human reply body",
      author: "alice",
      author_kind: "human",
      thread_id: parent.id,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: parent,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onOpenReply: () => {},
      }),
    );
    const replyBlock = container.querySelector(`[id="comment-${reply.id}"]`);
    expect(replyBlock?.querySelector(".reply-agent-byline")).toBeNull();
  });

  it("does NOT render the marker on an agent-authored top-level Comment (no thread_id)", () => {
    const agentTop: Comment = {
      ...baseComment,
      id: "agent-top",
      author: "claude",
      author_kind: "agent",
    };
    const container = mount(
      createElement(CommentCard, {
        comment: agentTop,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    expect(container.querySelector(".reply-agent-byline")).toBeNull();
  });
});

// PRD #397 / ADR 0038 / issue #399. Webapp parity with the TUI per-
// Thread collapse — when `collapsed` is true, the Card renders as a
// single-row one-liner: chevron · author kind · file:line · "first 60
// chars…" · 💬 N. Header chevron flips between ▾ (expanded) and ▸
// (collapsed); clicking it dispatches `onToggleCollapse(id)` AND
// `onCardClick(id)` so the cursor follows the click. The in-flight
// reply-lock pill still renders on the collapsed Card when the lock
// targets the Thread ("honest signal over tidy hiding").
describe("CommentCard collapsed one-liner (PRD #397 / ADR 0038 / issue #399)", () => {
  const longBody =
    "this is a fairly long parent body that should be truncated to the first sixty characters with an ellipsis appended to the end";

  it("renders the .collapsed comment-block when collapsed is true", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, body: "hello world" },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
      }),
    );
    const block = container.querySelector(".comment-block");
    expect(block?.classList.contains("collapsed")).toBe(true);
    // The expanded body slot must not render in collapsed mode.
    expect(block?.querySelector(".ann-body")).toBeNull();
  });

  it("renders the one-liner header with author_kind tag, file:line, body preview, and reply count", () => {
    const r1: Comment = { ...baseComment, id: "r1", body: "reply", thread_id: "ann-1" };
    const r2: Comment = { ...baseComment, id: "r2", body: "reply2", thread_id: "ann-1" };
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, body: "short body", line_start: 42, line_end: 42 },
        replies: [r1, r2],
        isCurrent: false,
        navIndex: 1,
        navTotal: 3,
        collapsed: true,
      }),
    );
    const header = container.querySelector(".ann-header-collapsed");
    expect(header).not.toBeNull();
    const text = header?.textContent ?? "";
    expect(text).toContain("[human]");
    expect(text).toContain("x.txt:42");
    expect(text).toContain('"short body"');
    expect(text).toContain("💬 2");
  });

  it("omits the 💬 N reply count when the Thread has no Replies", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
      }),
    );
    expect(container.querySelector(".ann-collapsed-reply-count")).toBeNull();
    expect(container.textContent).not.toContain("💬");
  });

  it("truncates the body preview to 60 chars with an ellipsis when longer", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: { ...baseComment, body: longBody },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
      }),
    );
    const preview = container.querySelector(".ann-collapsed-preview");
    expect(preview).not.toBeNull();
    const text = preview?.textContent ?? "";
    // Tail "…" plus a 59-char slice inside the surrounding `"…"` quotes
    // — total length stays at a snug 60 visible characters of body.
    expect(text).toContain("…");
    expect(text.includes(longBody)).toBe(false);
  });

  it("renders the chevron as ▸ when collapsed", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
        onToggleCollapse: () => {},
      }),
    );
    const chevron = container.querySelector(".ann-collapse-chevron");
    expect(chevron).not.toBeNull();
    expect(chevron?.textContent).toBe("▸");
    expect(chevron?.getAttribute("aria-label")).toBe("Expand comment");
  });

  it("renders the chevron as ▾ when expanded", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: false,
        onToggleCollapse: () => {},
      }),
    );
    const chevron = container.querySelector(".ann-collapse-chevron");
    expect(chevron).not.toBeNull();
    expect(chevron?.textContent).toBe("▾");
    expect(chevron?.getAttribute("aria-label")).toBe("Collapse comment");
  });

  it("clicking the chevron in the collapsed state fires onToggleCollapse AND onCardClick with the comment id", () => {
    const toggles: string[] = [];
    const clicks: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
        onToggleCollapse: (id: string) => toggles.push(id),
        onCardClick: (id: string) => clicks.push(id),
      }),
    );
    const chevron = container.querySelector(
      ".ann-collapse-chevron",
    ) as HTMLButtonElement;
    act(() => {
      chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The chevron click moves the cursor first (onCardClick), then
    // toggles. Both fire exactly once on the targeted Card.
    expect(clicks).toEqual(["ann-1"]);
    expect(toggles).toEqual(["ann-1"]);
  });

  it("clicking the chevron in the expanded state fires the same pair (cursor follows, then toggle)", () => {
    const toggles: string[] = [];
    const clicks: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: false,
        onToggleCollapse: (id: string) => toggles.push(id),
        onCardClick: (id: string) => clicks.push(id),
      }),
    );
    const chevron = container.querySelector(
      ".ann-collapse-chevron",
    ) as HTMLButtonElement;
    act(() => {
      chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clicks).toEqual(["ann-1"]);
    expect(toggles).toEqual(["ann-1"]);
  });

  it("omits the chevron entirely when onToggleCollapse is not supplied (defensive)", () => {
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: false,
      }),
    );
    // The expanded variant only renders the chevron when the callback
    // is provided — there's no use case for a non-interactive `▾`.
    expect(container.querySelector(".ann-collapse-chevron")).toBeNull();
  });

  it("clicking elsewhere on the collapsed card still fires onCardClick (cursor follows the click) without toggling", () => {
    const toggles: string[] = [];
    const clicks: string[] = [];
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
        onToggleCollapse: (id: string) => toggles.push(id),
        onCardClick: (id: string) => clicks.push(id),
      }),
    );
    const block = container.querySelector(".comment-block") as HTMLElement;
    // Click on the preview span (not the chevron) — should move the
    // cursor (onCardClick) but NOT toggle collapse state. Only the
    // chevron click is a toggle gesture.
    const preview = block.querySelector(".ann-collapsed-preview") as HTMLElement;
    act(() => {
      preview.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clicks).toEqual(["ann-1"]);
    expect(toggles).toEqual([]);
  });

  it("collapsed Card with a reply-lock targeting the Thread renders the inline ReplyPill (watcher signal survives the hide intent)", () => {
    const lock: ReplyLock = {
      agent: "claude",
      responding_to: baseComment.id,
      started_at: new Date(Date.now() - 1000).toISOString(),
      pid: 1,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
        replyLock: lock,
        replyAgent: "claude",
      }),
    );
    expect(container.querySelector(".reply-pill")).not.toBeNull();
  });

  it("collapsed Card with a reply-lock targeting a different Thread does NOT render the pill", () => {
    const lock: ReplyLock = {
      agent: "claude",
      responding_to: "some-other-comment",
      started_at: new Date(Date.now() - 1000).toISOString(),
      pid: 1,
    };
    const container = mount(
      createElement(CommentCard, {
        comment: baseComment,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        collapsed: true,
        replyLock: lock,
        replyAgent: "claude",
      }),
    );
    expect(container.querySelector(".reply-pill")).toBeNull();
  });
});
