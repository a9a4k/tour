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
