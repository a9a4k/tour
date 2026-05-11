import { describe, it, expect } from "vitest";
import {
  bindWithFallback,
  isAddrInUseError,
} from "../../src/web/bind-with-fallback.js";

function addrInUse(port: number): Error {
  const err = new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`);
  (err as Error & { code: string }).code = "EADDRINUSE";
  return err;
}

describe("isAddrInUseError", () => {
  it("recognises Node-style errors with code === 'EADDRINUSE'", () => {
    expect(isAddrInUseError(addrInUse(8687))).toBe(true);
  });

  it("recognises Bun-style errors whose message contains EADDRINUSE", () => {
    expect(isAddrInUseError(new Error("Failed to start server: EADDRINUSE"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isAddrInUseError(new Error("boom"))).toBe(false);
    expect(isAddrInUseError(null)).toBe(false);
    expect(isAddrInUseError(undefined)).toBe(false);
  });
});

describe("bindWithFallback", () => {
  it("binds to the preferred port when free", async () => {
    const { resource, boundPort, preferredWasBusy } = await bindWithFallback(
      8687,
      false,
      (port) => ({ port }),
    );
    expect(resource.port).toBe(8687);
    expect(boundPort).toBe(8687);
    expect(preferredWasBusy).toBe(false);
  });

  it("falls back to the next free port when preferred is busy and not explicit", async () => {
    const busy = new Set([8687, 8688]);
    const calls: number[] = [];
    const { boundPort, preferredWasBusy } = await bindWithFallback(
      8687,
      false,
      (port) => {
        calls.push(port);
        if (busy.has(port)) throw addrInUse(port);
        return { port };
      },
    );
    expect(calls).toEqual([8687, 8688, 8689]);
    expect(boundPort).toBe(8689);
    expect(preferredWasBusy).toBe(true);
  });

  it("does NOT fall back when the port was supplied explicitly", async () => {
    const calls: number[] = [];
    await expect(
      bindWithFallback(8687, true, (port) => {
        calls.push(port);
        throw addrInUse(port);
      }),
    ).rejects.toThrow(/port 8687 is in use/);
    expect(calls).toEqual([8687]);
  });

  it("throws after exhausting the fallback budget", async () => {
    const calls: number[] = [];
    await expect(
      bindWithFallback(
        8687,
        false,
        (port) => {
          calls.push(port);
          throw addrInUse(port);
        },
        5,
      ),
    ).rejects.toThrow(/8687[^\d]+8691/);
    expect(calls).toHaveLength(5);
  });

  it("re-throws non-EADDRINUSE errors immediately", async () => {
    let attempts = 0;
    await expect(
      bindWithFallback(8687, false, () => {
        attempts++;
        throw new Error("permission denied");
      }),
    ).rejects.toThrow(/permission denied/);
    expect(attempts).toBe(1);
  });
});
