// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TourHeaderPath } from "../../src/web/client/App.js";

// `TourHeaderPath` renders the currently-selected file's full filesystem
// path in the left cluster of `.tour-header`, prefixed with the same
// `·` (U+00B7) separator the TUI uses, and renders nothing when no
// file is selected. The path is the full filesystem path — NOT the
// basename, NOT any app-side truncation; if the header runs out of
// horizontal space, CSS overflow handles it the same way it handles
// the existing title and source-refs.

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

describe("TourHeaderPath", () => {
  it("renders the full filesystem path with the `·` separator when a file is selected", () => {
    const container = mount(
      createElement(TourHeaderPath, {
        path: "supabase/migrations/20260508144406_setup_public_api.sql",
      }),
    );
    const slot = container.querySelector(".tour-header-path");
    expect(slot).not.toBeNull();
    // The slot template is "· <path>" — same shape as TopHeaderTui so the
    // two surfaces feel consistent.
    expect(slot?.textContent).toContain("·");
    expect(slot?.textContent).toContain(
      "supabase/migrations/20260508144406_setup_public_api.sql",
    );
  });

  it("renders nothing when path is null (no file selected)", () => {
    const container = mount(createElement(TourHeaderPath, { path: null }));
    expect(container.querySelector(".tour-header-path")).toBeNull();
    // The `·` separator is unique to this slot — its absence is the contract.
    expect(container.textContent ?? "").not.toContain("·");
  });

  it("renders nothing when path is an empty string", () => {
    const container = mount(createElement(TourHeaderPath, { path: "" }));
    expect(container.querySelector(".tour-header-path")).toBeNull();
    expect(container.textContent ?? "").not.toContain("·");
  });

  it("echoes the path verbatim, never abbreviated by app code", () => {
    // The component must echo `path` verbatim — no basename, no ellipsis.
    // Long paths overflow via CSS just like the existing title / refs.
    const longPath =
      "very/deep/nested/structure/with/many/segments/that/exceeds/any/reasonable/width.ts";
    const container = mount(createElement(TourHeaderPath, { path: longPath }));
    expect(container.querySelector(".tour-header-path")?.textContent).toContain(longPath);
  });
});

// Issue #168: when a path is selected, the slot must sit as a direct
// child of `.tour-header` (a sibling of `.tour-header-left` /
// `.tour-header-right`) so the CSS `flex-basis: 100%` rule can wrap it
// onto its own line. If the slot is nested inside `.tour-header-left`
// the wrap rule has no effect — the slot would stay on row 1 and
// compete with title / sources for width.
describe("App lays out TourHeaderPath as a row-2 sibling, not inside .tour-header-left (Issue #168)", () => {
  it("the path slot is a direct child of `.tour-header`, not a descendant of `.tour-header-left`", async () => {
    // Mount the App; stub fetches so the route resolves to a tour with one
    // annotation, which makes the in-App `setSelectedFile(target.file)`
    // effect fire (App.tsx) and the path slot render.
    const { App } = await import("../../src/web/client/App.js");
    const tourId = "2026-05-11-000000-test";
    const tourFile = "src/example.ts";
    const tourSummary = {
      id: tourId,
      title: "Test tour",
      status: "open",
      created_at: "2026-05-11T00:00:00Z",
      closed_at: "",
      head_sha: "deadbeef",
      base_sha: "cafebabe",
      head_source: "feature/x",
      base_source: "main",
      wip_snapshot: false,
    };
    const bundle = {
      tour: tourSummary,
      annotations: [
        {
          id: "a1",
          tour_id: tourId,
          file: tourFile,
          line: 1,
          body_md: "n",
          status: "open",
          author_kind: "human",
          author: "tester",
          created_at: "2026-05-11T00:00:00Z",
          parent_id: null,
          file_kind: "modified",
          rename: null,
        },
      ],
      files: [],
      snapshot_missing: false,
    };
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;
    globalThis.fetch = ((url: string): Promise<Response> => {
      if (typeof url === "string" && url.endsWith("/api/tours?status=all")) {
        return Promise.resolve(
          new Response(JSON.stringify([tourSummary]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (typeof url === "string" && url.includes(`/api/tours/${tourId}`)) {
        return Promise.resolve(
          new Response(JSON.stringify(bundle), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), { status: 404 }),
      );
    }) as unknown as typeof fetch;
    class StubEventSource {
      onmessage: ((e: MessageEvent) => void) | null = null;
      close(): void {}
    }
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      StubEventSource as unknown as typeof EventSource;

    try {
      const container = document.getElementById("root")!;
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(App, { initialTourId: tourId }));
      });
      // Let pending promises (the two fetches) flush and React's effects
      // settle.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const slot = container.querySelector(".tour-header-path");
      expect(slot).not.toBeNull();
      // Direct child of `.tour-header`, not nested in `.tour-header-left`.
      expect(slot!.parentElement!.classList.contains("tour-header")).toBe(true);
      expect(container.querySelector(".tour-header-left .tour-header-path"))
        .toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEventSource === undefined) {
        delete (globalThis as Partial<typeof globalThis>).EventSource;
      } else {
        globalThis.EventSource = originalEventSource;
      }
    }
  });
});
