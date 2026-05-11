import { describe, it, expect } from "vitest";
import { probeTour } from "../../src/core/tour-probe.js";

// Pure tour-probe unit tests (issue #178). `fetch` is injected, so all
// branches — free / non-tour / tour same-cwd / tour different-cwd — are
// covered without real network calls.

function mkFetch(impl: (url: string) => Promise<Response> | Response): typeof fetch {
  return (input) => Promise.resolve(impl(String(input))) as Promise<Response>;
}

describe("probeTour", () => {
  it("returns free when fetch throws (ECONNREFUSED, timeout, DNS)", async () => {
    const fakeFetch = mkFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    expect(await probeTour(8687, fakeFetch, 100)).toEqual({ kind: "free" });
  });

  it("returns non-tour on non-2xx response", async () => {
    const fakeFetch = mkFetch(() => new Response("nope", { status: 404 }));
    expect(await probeTour(8687, fakeFetch, 100)).toEqual({ kind: "non-tour" });
  });

  it("returns non-tour when body is not JSON", async () => {
    const fakeFetch = mkFetch(() => new Response("<html></html>", { status: 200 }));
    expect(await probeTour(8687, fakeFetch, 100)).toEqual({ kind: "non-tour" });
  });

  it("returns non-tour when body is JSON but missing the tour marker", async () => {
    const fakeFetch = mkFetch(() => Response.json({ version: "1.2.3" }));
    expect(await probeTour(8687, fakeFetch, 100)).toEqual({ kind: "non-tour" });
  });

  it("returns non-tour when body has tour=false", async () => {
    const fakeFetch = mkFetch(() => Response.json({ tour: false, cwd: "/x" }));
    expect(await probeTour(8687, fakeFetch, 100)).toEqual({ kind: "non-tour" });
  });

  it("returns tour with cwd when body is the documented shape", async () => {
    const fakeFetch = mkFetch(() =>
      Response.json({ tour: true, cwd: "/path/to/repo", port: 8687, startedAt: "x" }),
    );
    expect(await probeTour(8687, fakeFetch, 100)).toEqual({
      kind: "tour",
      cwd: "/path/to/repo",
    });
  });

  it("returns non-tour when cwd is missing or wrong type", async () => {
    const fakeFetch = mkFetch(() => Response.json({ tour: true, cwd: 42 }));
    expect(await probeTour(8687, fakeFetch, 100)).toEqual({ kind: "non-tour" });
  });
});
