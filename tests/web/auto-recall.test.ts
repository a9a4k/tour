// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { recallCardIntoView } from "../../src/web/client/auto-recall.js";

// PRD #192 / ADR 0022 slice 2. The auto-recall helper sequences the
// scroll-into-view → composer-mount handshake so the user never sees a
// composer mount on top of an off-screen anchor.

function makeCardWithRect(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement("div");
  const filled: DOMRect = {
    top: rect.top ?? 0,
    bottom: rect.bottom ?? 0,
    left: rect.left ?? 0,
    right: rect.right ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    toJSON: () => ({}),
  };
  el.getBoundingClientRect = () => filled;
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recallCardIntoView: card already in viewport", () => {
  it("fires `then` synchronously and does NOT scroll", () => {
    const el = makeCardWithRect({ top: 100, bottom: 200 });
    let scrolled = false;
    el.scrollIntoView = () => {
      scrolled = true;
    };
    let fired = false;
    recallCardIntoView({
      cardElement: el,
      viewportHeight: 800,
      then: () => {
        fired = true;
      },
    });
    expect(fired).toBe(true);
    expect(scrolled).toBe(false);
  });
});

describe("recallCardIntoView: card missing from DOM", () => {
  it("fires `then` synchronously when cardElement is null (defensive — no scroll)", () => {
    let fired = false;
    recallCardIntoView({
      cardElement: null,
      viewportHeight: 800,
      then: () => {
        fired = true;
      },
    });
    expect(fired).toBe(true);
  });
});

describe("recallCardIntoView: card off-screen — scrollend path", () => {
  it("triggers scrollIntoView with smooth/center and defers `then` until scrollend fires", () => {
    const el = makeCardWithRect({ top: 1500, bottom: 1600 }); // below viewport
    const scrollCalls: ScrollIntoViewOptions[] = [];
    el.scrollIntoView = (opts?: ScrollIntoViewOptions | boolean) => {
      scrollCalls.push(typeof opts === "object" && opts !== null ? opts : {});
    };
    let fired = false;
    recallCardIntoView({
      cardElement: el,
      viewportHeight: 800,
      then: () => {
        fired = true;
      },
    });
    // The composer / dispatch is deferred until scrollend.
    expect(fired).toBe(false);
    expect(scrollCalls).toEqual([{ block: "center", behavior: "smooth" }]);
    // Simulate the browser firing scrollend after the smooth-scroll settles.
    window.dispatchEvent(new Event("scrollend"));
    expect(fired).toBe(true);
  });
});

describe("recallCardIntoView: 250 ms timeout fallback for browsers without scrollend", () => {
  it("fires `then` after 250 ms when scrollend never arrives (Safari < 18 path)", () => {
    vi.useFakeTimers();
    const el = makeCardWithRect({ top: 1500, bottom: 1600 });
    el.scrollIntoView = () => {};
    let fired = false;
    recallCardIntoView({
      cardElement: el,
      viewportHeight: 800,
      then: () => {
        fired = true;
      },
    });
    expect(fired).toBe(false);
    vi.advanceTimersByTime(249);
    expect(fired).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fired).toBe(true);
  });
});

describe("recallCardIntoView: scrollend wins over timeout (no double-fire)", () => {
  it("fires `then` exactly once when scrollend arrives before the 250 ms timeout", () => {
    vi.useFakeTimers();
    const el = makeCardWithRect({ top: 1500, bottom: 1600 });
    el.scrollIntoView = () => {};
    let count = 0;
    recallCardIntoView({
      cardElement: el,
      viewportHeight: 800,
      then: () => {
        count += 1;
      },
    });
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new Event("scrollend"));
    // Even if the timer fires later, the guard prevents a second call.
    vi.advanceTimersByTime(500);
    expect(count).toBe(1);
  });

  it("fires `then` exactly once when the 250 ms timeout wins (scrollend after fallback is ignored)", () => {
    vi.useFakeTimers();
    const el = makeCardWithRect({ top: 1500, bottom: 1600 });
    el.scrollIntoView = () => {};
    let count = 0;
    recallCardIntoView({
      cardElement: el,
      viewportHeight: 800,
      then: () => {
        count += 1;
      },
    });
    vi.advanceTimersByTime(250);
    expect(count).toBe(1);
    window.dispatchEvent(new Event("scrollend"));
    expect(count).toBe(1);
  });
});

describe("recallCardIntoView: off-screen above viewport", () => {
  it("treats top < 0 as off-screen and defers `then` until scrollend", () => {
    const el = makeCardWithRect({ top: -200, bottom: -100 });
    el.scrollIntoView = () => {};
    let fired = false;
    recallCardIntoView({
      cardElement: el,
      viewportHeight: 800,
      then: () => {
        fired = true;
      },
    });
    expect(fired).toBe(false);
    window.dispatchEvent(new Event("scrollend"));
    expect(fired).toBe(true);
  });
});
