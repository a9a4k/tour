// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchOpenInEditor } from "../../src/web/client/dispatch-open-in-editor.js";

// Issue #383 / ADR 0035: the dispatchOpenInEditor helper is the single
// transport wrapper for the three webapp callers (keyboard `o`, annotation
// filename link, file-header `↗` icon). Tests pin the network contract,
// the body shape, the success-message piping, and the failure surfaces.

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function flashSpy(): { calls: string[]; fn: (m: string) => void } {
  const calls: string[] = [];
  return {
    calls,
    fn: (m: string) => {
      calls.push(m);
    },
  };
}

describe("dispatchOpenInEditor", () => {
  it("POSTs to /api/tours/<id>/open-in-editor with a JSON body of {file, line, side}", async () => {
    let capturedUrl: string | null = null;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ message: "Opened foo.ts:42" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
    const flash = flashSpy();
    await dispatchOpenInEditor("tour-1", "foo.ts", 42, "additions", flash.fn);
    expect(capturedUrl).toBe("/api/tours/tour-1/open-in-editor");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBe("application/json");
    const body = JSON.parse((capturedInit?.body ?? "") as string) as {
      file: string;
      line: number;
      side: string;
    };
    expect(body).toEqual({ file: "foo.ts", line: 42, side: "additions" });
  });

  it("pipes the server's `message` field verbatim into flash on success", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Opened foo.ts:42" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;
    const flash = flashSpy();
    await dispatchOpenInEditor("t", "foo.ts", 42, "additions", flash.fn);
    expect(flash.calls).toEqual(["Opened foo.ts:42"]);
  });

  it("pipes the server's `message` field verbatim even on a non-2xx response (e.g. 409 terminal-editor refusal)", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            message:
              "o: terminal editor — open from TUI instead",
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    ) as unknown as typeof fetch;
    const flash = flashSpy();
    await dispatchOpenInEditor("t", "foo.ts", 42, "additions", flash.fn);
    expect(flash.calls).toEqual([
      "o: terminal editor — open from TUI instead",
    ]);
  });

  it("flashes 'o: server unreachable' when the fetch promise rejects", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as unknown as typeof fetch;
    const flash = flashSpy();
    await dispatchOpenInEditor("t", "foo.ts", 42, "additions", flash.fn);
    expect(flash.calls).toEqual(["o: server unreachable"]);
  });

  it("flashes 'o: server error' when the response body is not JSON", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<html>500</html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
      ),
    ) as unknown as typeof fetch;
    const flash = flashSpy();
    await dispatchOpenInEditor("t", "foo.ts", 42, "additions", flash.fn);
    expect(flash.calls).toEqual(["o: server error"]);
  });

  it("flashes 'o: server error' when the JSON body is missing the `message` field", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;
    const flash = flashSpy();
    await dispatchOpenInEditor("t", "foo.ts", 42, "additions", flash.fn);
    expect(flash.calls).toEqual(["o: server error"]);
  });

  it("propagates the side argument unchanged (deletions → body.side === 'deletions')", async () => {
    let bodyJson: { side?: string } = {};
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      bodyJson = JSON.parse((init?.body ?? "") as string);
      return Promise.resolve(
        new Response(JSON.stringify({ message: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
    const flash = flashSpy();
    await dispatchOpenInEditor("t", "foo.ts", 7, "deletions", flash.fn);
    expect(bodyJson.side).toBe("deletions");
  });
});
