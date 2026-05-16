// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchDeleteComment } from "../../src/web/client/dispatch-delete-comment.js";

// Issue #389 / ADR 0036 (Slice E). Transport wrapper for the webapp's
// delete-confirm modal. The endpoint wraps the shared `createDelete`
// seam (Slice C) — `dispatchDeleteComment` is a thin glue: DELETE
// /api/tours/<id>/comments/<comment-id>, return `{ ok }` on 2xx and
// `{ ok: false, message }` on every other path.

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("dispatchDeleteComment (issue #389)", () => {
  it("DELETEs the tour-scoped comment URL", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ target_id: "ann-1", at: "2026-05-16T00:00:00Z" }),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const result = await dispatchDeleteComment("tour-xyz", "ann-1");
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tours/tour-xyz/comments/ann-1");
    expect(init.method).toBe("DELETE");
  });

  it("returns ok=true on a 2xx response regardless of payload", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("", { status: 200 }))) as unknown as typeof fetch;
    const result = await dispatchDeleteComment("t", "c");
    expect(result.ok).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("returns ok=false with the server's error string on a 4xx response", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "no comment with id \"c\"" }), {
          status: 400,
        }),
      )) as unknown as typeof fetch;
    const result = await dispatchDeleteComment("t", "c");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no comment with id \"c\"");
  });

  it("returns ok=false with a generic message when the server omits an `error` field", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("{}", { status: 500 }))) as unknown as typeof fetch;
    const result = await dispatchDeleteComment("t", "c");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Delete failed: server error");
  });

  it("returns ok=false with a 'server unreachable' message on network failure", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
    const result = await dispatchDeleteComment("t", "c");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Delete failed: server unreachable");
  });

  it("URL-encodes safely by interpolating the raw ids — tour ids and comment ids are constrained server-side", async () => {
    // Defensive — tour and comment ids in the codebase are
    // [a-z0-9-]+ (uuid-shaped + slug-shaped), so the helper's literal
    // template-string interpolation is safe. This test pins the
    // contract by asserting the exact URL shape for a representative
    // id pair, so a future maintainer who introduces URL-unfriendly
    // characters has a failing test to read.
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response("", { status: 200 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await dispatchDeleteComment(
      "2026-05-13-000000-mytour",
      "01J9XYZ-comment-id",
    );
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(
      "/api/tours/2026-05-13-000000-mytour/comments/01J9XYZ-comment-id",
    );
  });
});
