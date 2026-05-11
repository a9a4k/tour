// Probe a port to decide whether a Tour server is already running on it
// (issue #178). The `fetch` is injected so this module stays a pure
// function of its inputs — unit tests cover all branches without real
// network calls.
//
// "free" means the port is not in use (ECONNREFUSED, DNS failure, etc.)
// — the caller can bind it. "non-tour" means something is on the port
// but it's not Tour (different tool, garbage body, non-2xx) — the caller
// should fall back to the next port. "tour" carries the running server's
// cwd so the caller can decide whether to reuse it (same cwd) or fall
// back (different cwd).

export type ProbeResult =
  | { kind: "free" }
  | { kind: "non-tour" }
  | { kind: "tour"; cwd: string };

export async function probeTour(
  port: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetchImpl(`http://127.0.0.1:${port}/__alive`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { kind: "free" };
  }
  if (!res.ok) return { kind: "non-tour" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "non-tour" };
  }
  if (!isAliveBody(body)) return { kind: "non-tour" };
  return { kind: "tour", cwd: body.cwd };
}

function isAliveBody(b: unknown): b is { tour: true; cwd: string } {
  if (b === null || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  return x.tour === true && typeof x.cwd === "string";
}
