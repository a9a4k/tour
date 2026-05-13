import { describe, it, expect } from "vitest";
import {
  createClientAssetsCache,
  type AssetsResult,
  type ClientAsset,
} from "../../src/web/client-assets.js";
import { resolveEmbedded } from "../../src/web/embedded-client.js";

// Issue #202: `tour serve` snapshotted the client bundle at first
// request and never invalidated, so re-running `bun scripts/build-client.ts`
// against new source left the running server serving the stale bundle.
// The fix keeps the compiled-binary fast-path cached (those constants are
// immutable for the life of the process) but drops the cache in dev mode
// so source edits reach the next request.

function asset(body: string): ClientAsset {
  return { body, contentType: "application/javascript; charset=utf-8" };
}

describe("createClientAssetsCache", () => {
  it("caches the embedded bundle (compiled-binary path is immutable)", async () => {
    let buildCalls = 0;
    const cache = createClientAssetsCache({
      getEmbedded: () => ({ client: "EMBED_CLIENT" }),
      buildFromSource: async () => {
        buildCalls++;
        return { assets: new Map(), error: null } satisfies AssetsResult;
      },
    });

    const r1 = await cache();
    const r2 = await cache();
    expect(r1.assets?.get("/client.js")?.body).toBe("EMBED_CLIENT");
    expect(r2.assets?.get("/client.js")?.body).toBe("EMBED_CLIENT");
    expect(buildCalls).toBe(0);
  });

  it("rebuilds in dev mode on every sequential call (issue #202)", async () => {
    let buildCalls = 0;
    const outputs = ["BUILD_1", "BUILD_2", "BUILD_3"];
    const cache = createClientAssetsCache({
      getEmbedded: () => null,
      buildFromSource: async () => {
        const body = outputs[buildCalls++];
        return {
          assets: new Map([["/client.js", asset(body)]]),
          error: null,
        };
      },
    });

    const r1 = await cache();
    expect(r1.assets?.get("/client.js")?.body).toBe("BUILD_1");
    const r2 = await cache();
    expect(r2.assets?.get("/client.js")?.body).toBe("BUILD_2");
    const r3 = await cache();
    expect(r3.assets?.get("/client.js")?.body).toBe("BUILD_3");
    expect(buildCalls).toBe(3);
  });

  it("coalesces concurrent dev-mode calls into a single in-flight build", async () => {
    let buildCalls = 0;
    let resolveBuild: ((r: AssetsResult) => void) | null = null;
    const cache = createClientAssetsCache({
      getEmbedded: () => null,
      buildFromSource: () => {
        buildCalls++;
        return new Promise<AssetsResult>((resolve) => {
          resolveBuild = resolve;
        });
      },
    });

    const p1 = cache();
    const p2 = cache();
    const p3 = cache();
    expect(buildCalls).toBe(1);

    resolveBuild!({
      assets: new Map([["/client.js", asset("ONCE")]]),
      error: null,
    });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.assets?.get("/client.js")?.body).toBe("ONCE");
    expect(r2.assets?.get("/client.js")?.body).toBe("ONCE");
    expect(r3.assets?.get("/client.js")?.body).toBe("ONCE");
    expect(buildCalls).toBe(1);
  });

  it("dev-mode errors are not sticky — next call retries the build", async () => {
    let buildCalls = 0;
    const results: AssetsResult[] = [
      { assets: null, error: "bundle failed" },
      {
        assets: new Map([["/client.js", asset("OK")]]),
        error: null,
      },
    ];
    const cache = createClientAssetsCache({
      getEmbedded: () => null,
      buildFromSource: async () => results[buildCalls++],
    });

    const r1 = await cache();
    expect(r1.error).toBe("bundle failed");
    const r2 = await cache();
    expect(r2.error).toBe(null);
    expect(r2.assets?.get("/client.js")?.body).toBe("OK");
    expect(buildCalls).toBe(2);
  });

  it("falls through to the dev builder when mode is \"dev\" but the embedded string is populated (issue #204)", async () => {
    // Simulates a working tree where a binary build was interrupted (Ctrl-C,
    // crash, partial stash pop) and left src/web/embedded-client.ts with a
    // real bundle string but the committed `EMBEDDED_BUILD_MODE: "dev"`
    // marker intact. `tour serve` MUST still rebuild from source on every
    // request rather than silently serving the stale embedded bytes.
    let buildCalls = 0;
    const cache = createClientAssetsCache({
      getEmbedded: () => resolveEmbedded("dev", "STALE_EMBEDDED_CLIENT"),
      buildFromSource: async () => {
        buildCalls++;
        return {
          assets: new Map([["/client.js", asset("FRESH_FROM_SOURCE")]]),
          error: null,
        } satisfies AssetsResult;
      },
    });

    const r1 = await cache();
    expect(r1.assets?.get("/client.js")?.body).toBe("FRESH_FROM_SOURCE");
    expect(buildCalls).toBe(1);
  });

  it("after an in-flight dev build resolves, the next call kicks off a fresh build (issue #202)", async () => {
    let buildCalls = 0;
    const outputs = ["FIRST", "SECOND"];
    const cache = createClientAssetsCache({
      getEmbedded: () => null,
      buildFromSource: async () => {
        const body = outputs[buildCalls++];
        return {
          assets: new Map([["/client.js", asset(body)]]),
          error: null,
        };
      },
    });

    const r1 = await cache();
    expect(r1.assets?.get("/client.js")?.body).toBe("FIRST");
    // Same caller-id flow `tour serve` would see after `bun scripts/build-client.ts`
    // overwrites the source: the next request must rebuild from the new source.
    const r2 = await cache();
    expect(r2.assets?.get("/client.js")?.body).toBe("SECOND");
    expect(buildCalls).toBe(2);
  });
});

// Issue #204: the dev-vs-binary discriminator is the explicit
// `EMBEDDED_BUILD_MODE` marker, not the truthiness of the bundle string.
// A working tree left with a populated string (e.g. by an interrupted
// binary build) but the committed `"dev"` marker must still fall through
// to the runtime builder.
describe("resolveEmbedded (issue #204 build-mode discriminator)", () => {
  it("mode \"dev\" + empty string → null (falls through to dev builder)", () => {
    expect(resolveEmbedded("dev", "")).toBeNull();
  });

  it("mode \"dev\" + populated string → null (the new behaviour: marker wins over string content)", () => {
    expect(resolveEmbedded("dev", "STALE_CLIENT")).toBeNull();
  });

  it("mode \"binary\" + populated string → embedded fast-path", () => {
    expect(resolveEmbedded("binary", "REAL_CLIENT")).toEqual({
      client: "REAL_CLIENT",
    });
  });
});
