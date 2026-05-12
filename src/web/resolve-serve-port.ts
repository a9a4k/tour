import { probeTour, type ProbeResult } from "../core/tour-probe.js";

export const DEFAULT_PORT = 8687;
export const PORT_FALLBACK_BUDGET = 20;
const DEFAULT_PROBE_TIMEOUT_MS = 150;

export function isAddrInUseError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "EADDRINUSE") return true;
  if (typeof e.message === "string" && /EADDRINUSE|address already in use/i.test(e.message)) {
    return true;
  }
  return false;
}

export type ResolveServePortResult<T> =
  | { kind: "reuse"; port: number }
  | { kind: "bound"; resource: T; port: number; preferredWasBusy: boolean };

export interface ResolveServePortArgs<T> {
  preferred: number;
  explicit: boolean;
  cwd: string;
  tryBind: (port: number) => T | Promise<T>;
  probe?: (port: number) => Promise<ProbeResult>;
  budget?: number;
}

// Unified probe-then-bind walk (issue #195). Replaces the slice-1.5
// composition of "probe preferred + bindWithFallback" that missed
// same-cwd Tours living on fallback ports. At every port:
//   tour, same cwd  → reuse (log existing URL, exit 0)
//   tour, other cwd → skip (during walk) or bind-then-fail (explicit)
//   non-tour        → skip (during walk) or bind-then-fail (explicit)
//   free            → bind; on race-induced EADDRINUSE continue (walk)
//                     or surface `port N is in use` (explicit)
// Explicit `--port N` keeps single-port semantics: at most one probe +
// one bind attempt; never falls through to the next port.
export async function resolveServePort<T>(
  args: ResolveServePortArgs<T>,
): Promise<ResolveServePortResult<T>> {
  const {
    preferred,
    explicit,
    cwd,
    tryBind,
    probe = (port) => probeTour(port, fetch, DEFAULT_PROBE_TIMEOUT_MS),
    budget = PORT_FALLBACK_BUDGET,
  } = args;

  const attempts = explicit ? 1 : budget;
  for (let i = 0; i < attempts; i++) {
    const port = preferred + i;
    const probeResult = await probe(port);

    if (probeResult.kind === "tour" && probeResult.cwd === cwd) {
      return { kind: "reuse", port };
    }
    if (!explicit && probeResult.kind === "tour") continue;
    if (!explicit && probeResult.kind === "non-tour") continue;

    try {
      const resource = await tryBind(port);
      return { kind: "bound", resource, port, preferredWasBusy: i > 0 };
    } catch (err) {
      if (!isAddrInUseError(err)) throw err;
      if (explicit) throw new Error(`port ${preferred} is in use`);
    }
  }
  throw new Error(
    `no free port found in range ${preferred}-${preferred + attempts - 1}; all in use`,
  );
}
