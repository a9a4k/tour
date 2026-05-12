// @vitest-environment happy-dom
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { act, createElement, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLazyHighlight } from "../../src/web/client/use-lazy-highlight.js";
import {
  ensureHighlighter,
  resetForTests,
  type TokenLines,
} from "../../src/web/client/syntax-highlight.js";

// `useLazyHighlight` wraps `syntax-highlight`'s `tokenize` with lazy
// IntersectionObserver-driven triggering. The contract (PRD #212 slice 2):
//
//   useLazyHighlight(ref, content, lang) → Map<lineNumber, html> | null
//
// — null until the IO fires on `ref.current`, then a token map. Memoized
// per `(content, lang)`. Observer is `rootMargin: 200px` and disconnects
// on unmount. Tests below cover the *contract* — happy-dom's stock
// IntersectionObserver stub doesn't match real IO semantics, so we
// substitute a hand-rolled fake we can fire manually.

// ---- Hand-rolled fake IntersectionObserver ---------------------------------

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  static reset(): void {
    FakeIntersectionObserver.instances = [];
  }

  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number> = [0];
  readonly root: Element | Document | null = null;
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    cb: IntersectionObserverCallback,
    opts: IntersectionObserverInit = {},
  ) {
    this.callback = cb;
    this.options = opts;
    this.rootMargin =
      typeof opts.rootMargin === "string" ? opts.rootMargin : "0px";
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.observed.push(el);
  }

  unobserve(el: Element): void {
    const i = this.observed.indexOf(el);
    if (i >= 0) this.observed.splice(i, 1);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.length = 0;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Manually deliver "near viewport" entries to the registered callback. */
  fire(): void {
    const entries = this.observed.map(
      (target) =>
        ({
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
          time: 0,
        }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

// ---- React harness ---------------------------------------------------------

// The hook depends on a RefObject<HTMLElement | null> pointing at the
// observed block. The harness mounts a host component, captures the most
// recent hook return value on a per-slot Snapshot, and exposes a forceRender
// callback for the same-input re-render reference-identity test.

type Snapshot = {
  tokens: TokenLines | null;
  renderCount: number;
};

function createSnapshot(): Snapshot {
  return { tokens: null, renderCount: 0 };
}

function HookHost({
  content,
  lang,
  snap,
  refOut,
}: {
  content: string;
  lang: string;
  snap: Snapshot;
  refOut: { current: RefObject<HTMLDivElement | null> | null };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  refOut.current = ref;
  const tokens = useLazyHighlight(ref, content, lang);
  snap.tokens = tokens;
  snap.renderCount += 1;
  return createElement("div", { ref });
}

let container: HTMLDivElement;
let root: Root | null = null;
let savedIO: typeof IntersectionObserver | undefined;

function installFakeIO(): void {
  FakeIntersectionObserver.reset();
  savedIO = (
    globalThis as { IntersectionObserver?: typeof IntersectionObserver }
  ).IntersectionObserver;
  (
    globalThis as { IntersectionObserver?: typeof IntersectionObserver }
  ).IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
}

function uninstallFakeIO(): void {
  if (savedIO) {
    (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver = savedIO;
  } else {
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
  }
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  installFakeIO();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
  uninstallFakeIO();
});

// ---- Tests -----------------------------------------------------------------

describe("useLazyHighlight — pre-IO", () => {
  beforeAll(async () => {
    // Pre-warm the highlighter so post-IO tokenize calls return styled
    // output without an additional async flush. The "race" describe later
    // resets and runs the pre→post-init scenario explicitly.
    await ensureHighlighter();
  });

  it("returns null before the IntersectionObserver fires", async () => {
    const snap = createSnapshot();
    const refOut: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(HookHost, {
          content: "const x = 1;",
          lang: "typescript",
          snap,
          refOut,
        }),
      );
    });
    // An IO instance is registered for the block element but not yet fired.
    expect(FakeIntersectionObserver.instances.length).toBe(1);
    expect(snap.tokens).toBeNull();
  });

  it("constructs the observer with rootMargin: 200px", async () => {
    const snap = createSnapshot();
    const refOut: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(HookHost, {
          content: "x",
          lang: "typescript",
          snap,
          refOut,
        }),
      );
    });
    const io = FakeIntersectionObserver.instances[0]!;
    expect(io.rootMargin).toBe("200px");
  });
});

describe("useLazyHighlight — post-IO", () => {
  beforeAll(async () => {
    await ensureHighlighter();
  });

  it("returns Shiki-styled tokens after IO fires for a supported lang", async () => {
    const snap = createSnapshot();
    const refOut: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(HookHost, {
          content: "const x = 1;",
          lang: "typescript",
          snap,
          refOut,
        }),
      );
    });
    await act(async () => {
      FakeIntersectionObserver.instances[0]!.fire();
    });
    await flushMicrotasks();
    expect(snap.tokens).not.toBeNull();
    const html = snap.tokens!.get(1) ?? "";
    expect(html).toMatch(/<span[^>]*style="[^"]*color:#/);
  });

  it("returns plain-text fallback for an unsupported lang (HTML-escaped)", async () => {
    const snap = createSnapshot();
    const refOut: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(HookHost, {
          content: "<script>alert(1)</script>",
          lang: "klingon",
          snap,
          refOut,
        }),
      );
    });
    await act(async () => {
      FakeIntersectionObserver.instances[0]!.fire();
    });
    await flushMicrotasks();
    expect(snap.tokens).not.toBeNull();
    const html = snap.tokens!.get(1) ?? "";
    expect(html).not.toMatch(/<span[^>]*style="[^"]*color:#/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("memoizes same (content, lang) — re-render returns the same Map reference", async () => {
    const snap = createSnapshot();
    const refOut: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(HookHost, {
          content: "let v: number = 42;",
          lang: "typescript",
          snap,
          refOut,
        }),
      );
    });
    await act(async () => {
      FakeIntersectionObserver.instances[0]!.fire();
    });
    await flushMicrotasks();
    const first = snap.tokens;
    expect(first).not.toBeNull();
    // Force a re-render with the same props; the hook must return the same
    // Map instance so React.memo siblings downstream don't churn.
    await act(async () => {
      root!.render(
        createElement(HookHost, {
          content: "let v: number = 42;",
          lang: "typescript",
          snap,
          refOut,
        }),
      );
    });
    expect(snap.tokens).toBe(first);
  });

  it("memoizes the unsupported-lang plain-text fallback per (content, lang)", async () => {
    // syntax-highlight stopped caching the plain-text path after #214 —
    // the hook now owns that stability so re-renders on non-bundled langs
    // don't cascade downstream React.memo invalidations.
    const snap = createSnapshot();
    const refOut: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(HookHost, {
          content: "alpha\nbeta\ngamma",
          lang: "klingon",
          snap,
          refOut,
        }),
      );
    });
    await act(async () => {
      FakeIntersectionObserver.instances[0]!.fire();
    });
    await flushMicrotasks();
    const first = snap.tokens;
    expect(first).not.toBeNull();
    await act(async () => {
      root!.render(
        createElement(HookHost, {
          content: "alpha\nbeta\ngamma",
          lang: "klingon",
          snap,
          refOut,
        }),
      );
    });
    expect(snap.tokens).toBe(first);
  });

  it("disconnects the observer on unmount", async () => {
    const snap = createSnapshot();
    const refOut: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(HookHost, {
          content: "x",
          lang: "typescript",
          snap,
          refOut,
        }),
      );
    });
    const io = FakeIntersectionObserver.instances[0]!;
    expect(io.disconnected).toBe(false);
    await act(async () => {
      root!.unmount();
      root = null;
    });
    expect(io.disconnected).toBe(true);
  });
});

describe("useLazyHighlight — pre→post-init race", () => {
  // Two hooks mount simultaneously BEFORE the highlighter has resolved.
  // Both fire IO; both await the shared ensureHighlighter() promise; both
  // must end up with styled output. Regression coverage extending #214 —
  // the pre-init fallback must not poison the post-init styled cache for
  // either hook's (content, lang) key.

  beforeEach(() => {
    resetForTests();
  });

  afterAll(() => {
    resetForTests();
  });

  it("two concurrent hooks during highlighter await both end up with styled output", async () => {
    const snapA = createSnapshot();
    const snapB = createSnapshot();
    const refOutA: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };
    const refOutB: { current: RefObject<HTMLDivElement | null> | null } = {
      current: null,
    };

    const containerA = container;
    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    let rootB: Root | null = null;

    try {
      await act(async () => {
        root = createRoot(containerA);
        rootB = createRoot(containerB);
        root.render(
          createElement(HookHost, {
            content: "const a = 1;",
            lang: "typescript",
            snap: snapA,
            refOut: refOutA,
          }),
        );
        rootB.render(
          createElement(HookHost, {
            content: "const b = 2;",
            lang: "typescript",
            snap: snapB,
            refOut: refOutB,
          }),
        );
      });

      // Two IO instances — one per hook.
      expect(FakeIntersectionObserver.instances.length).toBe(2);
      // Fire both before the highlighter has had a chance to resolve.
      await act(async () => {
        FakeIntersectionObserver.instances[0]!.fire();
        FakeIntersectionObserver.instances[1]!.fire();
      });
      // Now let the shared ensureHighlighter() promise resolve and React
      // re-render both hosts with the styled output.
      await flushMicrotasks();
      await flushMicrotasks();

      const htmlA = snapA.tokens?.get(1) ?? "";
      const htmlB = snapB.tokens?.get(1) ?? "";
      expect(htmlA).toMatch(/<span[^>]*style="[^"]*color:#/);
      expect(htmlB).toMatch(/<span[^>]*style="[^"]*color:#/);
      // Distinct content → distinct token maps.
      expect(snapA.tokens).not.toBe(snapB.tokens);
    } finally {
      if (rootB) {
        await act(async () => {
          rootB!.unmount();
        });
      }
    }
  });
});
