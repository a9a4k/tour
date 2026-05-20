// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFlashFooter } from "../../src/core/use-flash-footer.js";

type Snapshot = {
  status: string | null;
  flash: (message: string) => void;
};

function HookHost({ snap }: { snap: Snapshot }): null {
  const value = useFlashFooter();
  snap.status = value.status;
  snap.flash = value.flash;
  return null;
}

let root: Root | null = null;

function mount(): Snapshot {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const snap: Snapshot = {
    status: "not-mounted",
    flash: () => {
      throw new Error("hook not mounted");
    },
  };
  act(() => {
    root = createRoot(container);
    root.render(createElement(HookHost, { snap }));
  });
  return snap;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useFlashFooter", () => {
  it("sets status synchronously and auto-dismisses after the footer timeout", () => {
    const snap = mount();

    act(() => snap.flash("Saved"));

    expect(snap.status).toBe("Saved");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(snap.status).toBeNull();
  });

  it("keeps the latest flash visible when an older timer would have fired", () => {
    const snap = mount();

    act(() => snap.flash("First"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => snap.flash("Second"));

    expect(snap.status).toBe("Second");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(snap.status).toBe("Second");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(snap.status).toBeNull();
  });

  it("cleans up a pending dismiss timer on unmount", () => {
    const snap = mount();

    act(() => snap.flash("Pending"));

    expect(() => {
      act(() => root!.unmount());
      root = null;
      vi.advanceTimersByTime(2000);
    }).not.toThrow();
  });

  it("allows an empty-string flash and dismisses it like any other string", () => {
    const snap = mount();

    act(() => snap.flash(""));

    expect(snap.status).toBe("");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(snap.status).toBeNull();
  });
});
