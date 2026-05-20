// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DeleteConfirmModal,
  formatAge,
  truncateBody,
} from "../../src/web/client/DeleteConfirmModal.js";
import type { Comment } from "../../src/web/client/types.js";

// Issue #389 / ADR 0036 (Slice E). The webapp's delete-confirm modal.
// Renders preview + cascade note + Cancel/Delete; traps focus; Esc
// dismisses; scrim-click dismisses; the Delete button autofocuses so
// Enter confirms by default.

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function mount(el: React.ReactElement): HTMLDivElement {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  return container;
}

const baseTarget: Comment = {
  id: "ann-1",
  file: "src/foo.ts",
  side: "additions",
  line_start: 42,
  line_end: 48,
  body: "Why is this allocation here?",
  author: "human",
  author_kind: "human",
  created_at: "2026-05-16T00:00:00Z",
};

const FIXED_NOW = Date.parse("2026-05-16T01:30:00Z");

describe("formatAge", () => {
  it("returns 'just now' for sub-minute deltas", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(30 * 1000)).toBe("just now");
  });
  it("rounds down to whole units across the boundary classes", () => {
    expect(formatAge(2 * 60 * 1000)).toBe("2m ago");
    expect(formatAge(3 * 60 * 60 * 1000)).toBe("3h ago");
    expect(formatAge(4 * 24 * 60 * 60 * 1000)).toBe("4d ago");
  });
  it("clamps negative deltas to 'just now' instead of throwing", () => {
    expect(formatAge(-1)).toBe("just now");
  });
});

describe("truncateBody", () => {
  it("trims whitespace and leaves short bodies intact", () => {
    expect(truncateBody("  hello  ")).toBe("hello");
  });
  it("truncates long bodies with an ellipsis", () => {
    const long = "x".repeat(500);
    const out = truncateBody(long);
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("DeleteConfirmModal (issue #389)", () => {
  it("renders a role=dialog with aria-modal and an aria-labelledby title", () => {
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const card = c.querySelector(".delete-modal-card") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-modal")).toBe("true");
    const titleId = card.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(c.querySelector(`#${titleId}`)?.textContent).toBe(
      "Delete comment?",
    );
  });

  it("previews the target's author, file:range, age, and body", () => {
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: { ...baseTarget, body: "Pls explain" },
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const header = c.querySelector(
      ".delete-modal-preview-header",
    ) as HTMLElement;
    expect(header.textContent).toContain("[human]");
    expect(header.textContent).toContain("src/foo.ts:42-48");
    expect(header.textContent).toContain("1h ago");
    const body = c.querySelector(
      ".delete-modal-preview-body",
    ) as HTMLElement;
    expect(body.textContent).toBe("Pls explain");
  });

  it("collapses a single-line range to one number (no dash)", () => {
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: { ...baseTarget, line_start: 5, line_end: 5 },
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const header = c.querySelector(
      ".delete-modal-preview-header",
    )?.textContent ?? "";
    expect(header).toContain("src/foo.ts:5");
    expect(header).not.toContain("src/foo.ts:5-5");
  });

  it("renders the 'reply-only' cascade note when the target is a Reply with a live sibling", () => {
    const parent = { ...baseTarget, id: "p" };
    const r1: Comment = { ...baseTarget, id: "r1", thread_id: "p", body: "child" };
    const r2: Comment = { ...baseTarget, id: "r2", thread_id: "p", body: "other" };
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: r1,
        comments: [parent, r1, r2],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    expect(c.querySelector(".delete-modal-cascade")?.textContent).toBe(
      "this reply will be removed from the thread.",
    );
  });

  it("renders the 'parent-stub' cascade note when the target is a parent with surviving replies", () => {
    const parent = { ...baseTarget, id: "p" };
    const r1: Comment = { ...baseTarget, id: "r1", thread_id: "p" };
    const r2: Comment = { ...baseTarget, id: "r2", thread_id: "p" };
    const r3: Comment = { ...baseTarget, id: "r3", thread_id: "p" };
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: parent,
        comments: [parent, r1, r2, r3],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    expect(c.querySelector(".delete-modal-cascade")?.textContent).toBe(
      "3 replies will remain under [deleted].",
    );
  });

  it("renders the 'thread-vanishes' cascade note when the target is the only live node", () => {
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    expect(c.querySelector(".delete-modal-cascade")?.textContent).toBe(
      "the thread will vanish.",
    );
  });

  it("renders Cancel and Delete buttons in the actions row", () => {
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const actions = c.querySelector(".delete-modal-actions") as HTMLElement;
    const labels = Array.from(actions.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Cancel", "Delete"]);
  });

  it("autofocuses the Delete button so Enter confirms by default", () => {
    mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    expect(document.activeElement?.textContent).toBe("Delete");
  });

  it("fires onConfirm on the Delete button's click", () => {
    let confirmed = 0;
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {
          confirmed += 1;
        },
        onCancel: () => {},
      }),
    );
    const del = c.querySelector(
      ".delete-modal-confirm",
    ) as HTMLButtonElement;
    act(() => {
      del.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(confirmed).toBe(1);
  });

  it("fires onCancel on the Cancel button's click", () => {
    let cancelled = 0;
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    const cnl = c.querySelector(
      ".delete-modal-cancel",
    ) as HTMLButtonElement;
    act(() => {
      cnl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(cancelled).toBe(1);
  });

  it("dismisses on Esc keydown", () => {
    let cancelled = 0;
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    const card = c.querySelector(".delete-modal-card") as HTMLElement;
    act(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      });
      card.dispatchEvent(ev);
    });
    expect(cancelled).toBe(1);
  });

  it("dismisses on scrim mousedown (not on card mousedown)", () => {
    let cancelled = 0;
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    const scrim = c.querySelector(".delete-modal-scrim") as HTMLElement;
    const card = c.querySelector(".delete-modal-card") as HTMLElement;
    act(() => {
      card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(cancelled).toBe(0);
    act(() => {
      scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(cancelled).toBe(1);
  });

  it("traps Tab inside the modal — Tab on Delete wraps to Cancel; Shift+Tab on Cancel wraps to Delete", () => {
    const c = mount(
      createElement(DeleteConfirmModal, {
        target: baseTarget,
        comments: [baseTarget],
        now: FIXED_NOW,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const card = c.querySelector(".delete-modal-card") as HTMLElement;
    const cancel = c.querySelector(
      ".delete-modal-cancel",
    ) as HTMLButtonElement;
    const del = c.querySelector(
      ".delete-modal-confirm",
    ) as HTMLButtonElement;
    // Mount autofocuses Delete (last button). Tab wraps to first (Cancel).
    expect(document.activeElement).toBe(del);
    act(() => {
      const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      card.dispatchEvent(ev);
    });
    expect(document.activeElement).toBe(cancel);
    // Shift+Tab on Cancel wraps back to Delete.
    act(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      });
      card.dispatchEvent(ev);
    });
    expect(document.activeElement).toBe(del);
  });
});
