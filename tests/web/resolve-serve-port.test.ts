import { describe, it, expect } from "vitest";
import type { ProbeResult } from "../../src/core/tour-probe.js";
import {
  isAddrInUseError,
  resolveServePort,
} from "../../src/web/resolve-serve-port.js";

// Unified probe-then-bind walk (issue #195). Replaces the slice-1.5
// "probe preferred + bind walk" composition that missed same-cwd Tours
// on fallback ports. The probe is now called at every port before
// deciding to reuse, skip, or bind.

function addrInUse(port: number): Error {
  const err = new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`);
  (err as Error & { code: string }).code = "EADDRINUSE";
  return err;
}

function mkProbe(table: Map<number, ProbeResult>): (port: number) => Promise<ProbeResult> {
  return async (port) => table.get(port) ?? { kind: "free" };
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

describe("resolveServePort — implicit fallback walk", () => {
  it("binds to the preferred port when probe says free", async () => {
    const probed: number[] = [];
    const bound: number[] = [];
    const result = await resolveServePort({
      preferred: 8687,
      explicit: false,
      cwd: "/repo-A",
      tryBind: (port) => {
        bound.push(port);
        return { port };
      },
      probe: async (port) => {
        probed.push(port);
        return { kind: "free" };
      },
    });
    expect(result).toEqual({
      kind: "bound",
      resource: { port: 8687 },
      port: 8687,
      preferredWasBusy: false,
    });
    expect(probed).toEqual([8687]);
    expect(bound).toEqual([8687]);
  });

  it("reuses when preferred port hosts a same-cwd Tour", async () => {
    const bound: number[] = [];
    const result = await resolveServePort({
      preferred: 8687,
      explicit: false,
      cwd: "/repo-A",
      tryBind: (port) => {
        bound.push(port);
        return { port };
      },
      probe: mkProbe(
        new Map<number, ProbeResult>([
          [8687, { kind: "tour", cwd: "/repo-A" }],
        ]),
      ),
    });
    expect(result).toEqual({ kind: "reuse", port: 8687 });
    expect(bound).toEqual([]);
  });

  it("reuses when a same-cwd Tour lives on a fallback port (issue #195 repro)", async () => {
    const bound: number[] = [];
    const result = await resolveServePort({
      preferred: 8687,
      explicit: false,
      cwd: "/repo-B",
      tryBind: (port) => {
        bound.push(port);
        return { port };
      },
      probe: mkProbe(
        new Map<number, ProbeResult>([
          [8687, { kind: "tour", cwd: "/repo-A" }],
          [8688, { kind: "tour", cwd: "/repo-B" }],
        ]),
      ),
    });
    expect(result).toEqual({ kind: "reuse", port: 8688 });
    expect(bound).toEqual([]);
  });

  it("walks past other-cwd Tours and binds the first free port", async () => {
    const probed: number[] = [];
    const bound: number[] = [];
    const probeTable = new Map<number, ProbeResult>([
      [8687, { kind: "tour", cwd: "/repo-A" }],
      [8688, { kind: "tour", cwd: "/repo-C" }],
    ]);
    const result = await resolveServePort({
      preferred: 8687,
      explicit: false,
      cwd: "/repo-B",
      tryBind: (port) => {
        bound.push(port);
        return { port };
      },
      probe: async (port) => {
        probed.push(port);
        return probeTable.get(port) ?? { kind: "free" };
      },
    });
    expect(result).toEqual({
      kind: "bound",
      resource: { port: 8689 },
      port: 8689,
      preferredWasBusy: true,
    });
    expect(probed).toEqual([8687, 8688, 8689]);
    expect(bound).toEqual([8689]);
  });

  it("skips non-Tour processes during the walk without surfacing EADDRINUSE", async () => {
    const bound: number[] = [];
    const result = await resolveServePort({
      preferred: 8687,
      explicit: false,
      cwd: "/repo-B",
      tryBind: (port) => {
        bound.push(port);
        return { port };
      },
      probe: mkProbe(
        new Map<number, ProbeResult>([[8687, { kind: "non-tour" }]]),
      ),
    });
    expect(result).toEqual({
      kind: "bound",
      resource: { port: 8688 },
      port: 8688,
      preferredWasBusy: true,
    });
    expect(bound).toEqual([8688]);
  });

  it("continues past a race-induced EADDRINUSE after a free probe", async () => {
    const bound: number[] = [];
    const result = await resolveServePort({
      preferred: 8687,
      explicit: false,
      cwd: "/repo-A",
      tryBind: (port) => {
        bound.push(port);
        if (port === 8687) throw addrInUse(port);
        return { port };
      },
      probe: mkProbe(new Map()),
    });
    expect(result).toEqual({
      kind: "bound",
      resource: { port: 8688 },
      port: 8688,
      preferredWasBusy: true,
    });
    expect(bound).toEqual([8687, 8688]);
  });

  it("throws after exhausting the fallback budget", async () => {
    const probeTable = new Map<number, ProbeResult>([
      [8687, { kind: "tour", cwd: "/repo-A" }],
      [8688, { kind: "non-tour" }],
      [8689, { kind: "tour", cwd: "/repo-C" }],
      [8690, { kind: "non-tour" }],
      [8691, { kind: "tour", cwd: "/repo-D" }],
    ]);
    await expect(
      resolveServePort({
        preferred: 8687,
        explicit: false,
        cwd: "/repo-B",
        tryBind: () => ({ port: -1 }),
        probe: mkProbe(probeTable),
        budget: 5,
      }),
    ).rejects.toThrow(/8687[^\d]+8691/);
  });

  it("re-throws non-EADDRINUSE bind errors immediately", async () => {
    let attempts = 0;
    await expect(
      resolveServePort({
        preferred: 8687,
        explicit: false,
        cwd: "/repo-A",
        tryBind: () => {
          attempts++;
          throw new Error("permission denied");
        },
        probe: mkProbe(new Map()),
      }),
    ).rejects.toThrow(/permission denied/);
    expect(attempts).toBe(1);
  });
});

describe("resolveServePort — explicit --port", () => {
  it("reuses when explicit port hosts a same-cwd Tour", async () => {
    const bound: number[] = [];
    const result = await resolveServePort({
      preferred: 8800,
      explicit: true,
      cwd: "/repo-A",
      tryBind: (port) => {
        bound.push(port);
        return { port };
      },
      probe: mkProbe(
        new Map<number, ProbeResult>([
          [8800, { kind: "tour", cwd: "/repo-A" }],
        ]),
      ),
    });
    expect(result).toEqual({ kind: "reuse", port: 8800 });
    expect(bound).toEqual([]);
  });

  it("binds when explicit port is free", async () => {
    const result = await resolveServePort({
      preferred: 8800,
      explicit: true,
      cwd: "/repo-A",
      tryBind: (port) => ({ port }),
      probe: mkProbe(new Map()),
    });
    expect(result).toEqual({
      kind: "bound",
      resource: { port: 8800 },
      port: 8800,
      preferredWasBusy: false,
    });
  });

  it("throws 'port N is in use' on explicit + non-tour (no walk)", async () => {
    const bound: number[] = [];
    await expect(
      resolveServePort({
        preferred: 8800,
        explicit: true,
        cwd: "/repo-A",
        tryBind: (port) => {
          bound.push(port);
          throw addrInUse(port);
        },
        probe: mkProbe(
          new Map<number, ProbeResult>([[8800, { kind: "non-tour" }]]),
        ),
      }),
    ).rejects.toThrow(/port 8800 is in use/);
    expect(bound).toEqual([8800]);
  });

  it("throws 'port N is in use' on explicit + different-cwd Tour (no walk)", async () => {
    const bound: number[] = [];
    await expect(
      resolveServePort({
        preferred: 8800,
        explicit: true,
        cwd: "/repo-A",
        tryBind: (port) => {
          bound.push(port);
          throw addrInUse(port);
        },
        probe: mkProbe(
          new Map<number, ProbeResult>([
            [8800, { kind: "tour", cwd: "/repo-other" }],
          ]),
        ),
      }),
    ).rejects.toThrow(/port 8800 is in use/);
    expect(bound).toEqual([8800]);
  });
});

// Issue #373: `--port 0` requests an OS-assigned port. resolveServePort
// must bypass the probe + fallback walk (irrelevant for port 0) and
// report the actual bound port from the resource, not the requested 0.
describe("resolveServePort — port 0 (OS-assigned)", () => {
  it("bypasses probe + walk and reports the actual bound port", async () => {
    const probed: number[] = [];
    const bound: number[] = [];
    const result = await resolveServePort({
      preferred: 0,
      explicit: true,
      cwd: "/repo-A",
      tryBind: (port) => {
        bound.push(port);
        // OS picks a real port; tryBind reports it on the resource.
        return { port: 54321 };
      },
      probe: async (port) => {
        probed.push(port);
        return { kind: "free" };
      },
    });
    expect(result).toEqual({
      kind: "bound",
      resource: { port: 54321 },
      port: 54321,
      preferredWasBusy: false,
    });
    expect(probed).toEqual([]);
    expect(bound).toEqual([0]);
  });
});
