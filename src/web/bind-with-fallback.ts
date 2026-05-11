export const DEFAULT_PORT = 8687;
export const PORT_FALLBACK_BUDGET = 20;

export interface BindResult<T> {
  resource: T;
  boundPort: number;
  preferredWasBusy: boolean;
}

export function isAddrInUseError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "EADDRINUSE") return true;
  if (typeof e.message === "string" && /EADDRINUSE|address already in use/i.test(e.message)) {
    return true;
  }
  return false;
}

// Tries `tryBind(port)` at `preferred` and walks the next ports up until one
// binds. `explicit === true` disables fallback entirely — a clear EADDRINUSE
// is reported back as `port <preferred> is in use` and no further ports are
// tried. `budget` caps the implicit-fallback walk so we don't scan forever.
export async function bindWithFallback<T>(
  preferred: number,
  explicit: boolean,
  tryBind: (port: number) => T | Promise<T>,
  budget: number = PORT_FALLBACK_BUDGET,
): Promise<BindResult<T>> {
  const attempts = explicit ? 1 : budget;
  for (let i = 0; i < attempts; i++) {
    const port = preferred + i;
    try {
      const resource = await tryBind(port);
      return { resource, boundPort: port, preferredWasBusy: i > 0 };
    } catch (err) {
      if (!isAddrInUseError(err)) throw err;
      if (explicit) {
        throw new Error(`port ${preferred} is in use`);
      }
    }
  }
  throw new Error(
    `no free port found in range ${preferred}-${preferred + attempts - 1}; all in use`,
  );
}
