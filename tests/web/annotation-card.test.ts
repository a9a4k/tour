// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnnotationCard } from "../../src/web/client/App.js";
import type { Annotation } from "../../src/web/client/types.js";

// Collapse rule mirrors the TUI side (see tests/tui/annotation-card.test.ts):
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

const baseAnnotation: Annotation = {
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

function headerText(container: HTMLElement, annotationId = "ann-1"): string {
  // The top-level header is `.annotation-block > .ann-header`; the reply
  // headers are `.ann-reply > .ann-header`. Both carry the kind bracket
  // and the optional author token.
  const block = container.querySelector(
    `.annotation-block, [id="annotation-${annotationId}"]`,
  );
  return block?.querySelector(".ann-header")?.textContent ?? "";
}

describe("AnnotationCard header collapses redundant `author` when author === author_kind", () => {
  it("omits the `human ·` prefix on the top-level header when author was defaulted", () => {
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
      createElement(AnnotationCard, {
        annotation: { ...baseAnnotation, author: "alice" },
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
    const parent: Annotation = { ...baseAnnotation, author: "alice" };
    const reply: Annotation = {
      ...baseAnnotation,
      id: "ann-2",
      body: "reply body",
      author: "human",
      replies_to: parent.id,
    };
    const container = mount(
      createElement(AnnotationCard, {
        annotation: parent,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    const replyHeader = container
      .querySelector(`[id="annotation-${reply.id}"]`)
      ?.querySelector(".ann-header");
    expect(replyHeader).not.toBeNull();
    const text = replyHeader?.textContent ?? "";
    expect(text).toContain("[human]");
    // The default literal must not be re-stated after the bracket.
    expect(text.replace("[human]", "")).not.toContain("human");
  });

  it("keeps `claude` on a reply header when the agent supplied its name", () => {
    const parent: Annotation = { ...baseAnnotation, author: "alice" };
    const reply: Annotation = {
      ...baseAnnotation,
      id: "ann-2",
      body: "reply body",
      author: "claude",
      author_kind: "agent",
      replies_to: parent.id,
    };
    const container = mount(
      createElement(AnnotationCard, {
        annotation: parent,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    const replyHeader = container
      .querySelector(`[id="annotation-${reply.id}"]`)
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
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
      }),
    );
    expect(container.querySelector(".author-kind.human")).not.toBeNull();
  });
});

describe("AnnotationCard `Send to {agent}` affordance (issue #184, PRD #181)", () => {
  // The "Send to {agent}" button lives next to the existing "Reply"
  // button on every human Annotation card. Visibility is delegated to
  // `canSendToAgent` in core; this suite covers the rendering side —
  // is the button there, is the label correct, is the disabled state
  // wired to the tour-wide lock.

  it("renders the button labelled with the agent name on a human card when replyAgent is set", () => {
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
      createElement(AnnotationCard, {
        annotation: { ...baseAnnotation, author_kind: "agent", author: "claude" },
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
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
    const reply: Annotation = {
      ...baseAnnotation,
      id: "ann-2",
      author: "claude",
      author_kind: "agent",
      replies_to: baseAnnotation.id,
      body: "agent reply body",
    };
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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

describe("AnnotationCard inline-Reply action row (issue #189, PRD #181 story 11)", () => {
  // Multi-turn Threads need a per-Reply action row so a human can drive
  // the conversation one human turn at a time. The Send affordance lives
  // beneath every human Reply (not just the top-level Annotation),
  // gated by the same `canSendToAgent` predicate applied per-card. The
  // one-shot-terminal rule applies per Annotation (not per Thread), so
  // a Reply that itself has a child hides the Send button.

  const makeReply = (overrides: Partial<Annotation> = {}): Annotation => ({
    ...baseAnnotation,
    id: "ann-r1",
    body: "human reply body",
    author: "alice",
    author_kind: "human",
    replies_to: baseAnnotation.id,
    ...overrides,
  });

  function replyActions(
    container: HTMLElement,
    replyId: string,
  ): HTMLElement | null {
    const block = container.querySelector(`[id="annotation-${replyId}"]`);
    return block?.querySelector(".ann-actions") as HTMLElement | null;
  }

  it("renders a Send button labelled with the agent name beneath a human Reply", () => {
    const reply = makeReply();
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const actions = replyActions(container, reply.id);
    expect(actions).not.toBeNull();
    const btn = actions?.querySelector(".send-to-agent-button");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Send to claude");
  });

  it("renders a Reply button beneath a human Reply", () => {
    const reply = makeReply();
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(replyActions(container, reply.id)?.querySelector(".reply-button"))
      .not.toBeNull();
  });

  it("renders NO action row beneath an agent-authored Reply (agent-card precedence)", () => {
    const reply = makeReply({ author: "claude", author_kind: "agent" });
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(replyActions(container, reply.id)).toBeNull();
  });

  it("hides the Send button when the human Reply itself has a child (one-shot terminal per Annotation)", () => {
    const reply = makeReply({ id: "ann-r1" });
    const nested: Annotation = {
      ...baseAnnotation,
      id: "ann-n1",
      author: "claude",
      author_kind: "agent",
      replies_to: reply.id,
      body: "nested agent body",
    };
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply, nested],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        replyAgent: "claude",
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    const actions = replyActions(container, reply.id);
    // Reply button still visible (the user can author another human Reply
    // at the same level); Send is hidden because the one-shot terminal
    // has already fired for this Annotation.
    expect(actions?.querySelector(".reply-button")).not.toBeNull();
    expect(actions?.querySelector(".send-to-agent-button")).toBeNull();
  });

  it("hides the Send button on every Reply when replyAgent is unset", () => {
    const reply = makeReply();
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply],
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        onSendToAgent: () => {},
        onOpenReply: () => {},
      }),
    );
    expect(replyActions(container, reply.id)?.querySelector(".send-to-agent-button"))
      .toBeNull();
  });

  it("disables the per-Reply Send button + carries the agent-name tooltip when the lock is held", () => {
    const reply = makeReply();
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply],
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
    const btn = replyActions(container, reply.id)?.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute("title")).toContain("claude is replying");
  });

  it("fires onSendToAgent with the Reply's id (not the top-level's) when clicked", () => {
    let lastId: string | null = null;
    const reply = makeReply({ id: "reply-xyz" });
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply],
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
    const btn = replyActions(container, reply.id)?.querySelector(
      ".send-to-agent-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(lastId).toBe("reply-xyz");
  });

  it("fires onOpenReply with the Reply's id (not the top-level's) when its Reply button is clicked", () => {
    let lastId: string | null = null;
    const reply = makeReply({ id: "reply-xyz" });
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
        replies: [reply],
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
    const btn = replyActions(container, reply.id)?.querySelector(
      ".reply-button",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(lastId).toBe("reply-xyz");
  });

  it("still wires the top-level Send button to the top-level annotation's id (regression)", () => {
    // The per-reply changes must not break the existing top-level closure.
    let lastId: string | null = null;
    const container = mount(
      createElement(AnnotationCard, {
        annotation: baseAnnotation,
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
    expect(lastId).toBe(baseAnnotation.id);
  });
});
