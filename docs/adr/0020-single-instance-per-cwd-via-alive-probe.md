# Single-instance Tour per cwd via `/__alive` probe

A second `tour serve` invocation against the same working directory reuses the existing server instead of binding a new one. The check is a tiny HTTP probe against the preferred port: the server publishes `GET /__alive` returning `{ tour: true, cwd, port, startedAt }`, and the second invocation matches `cwd` to decide whether to reuse the existing URL or fall through to the existing port-fallback walk.

## Considered Options

- **Always new server** (v1 status quo) — Each invocation binds an unused port, accumulating duplicate processes, duplicate file watchers (which would race on reply-agent dispatch; ADR 0010), and URL drift across re-runs (8687 → 8688 → 8689). For a tool people re-invoke every time an agent finishes a tour, the proliferation is real.
- **Pidfile + lifecycle management** (e.g. `.tour/.server.pid`) — Captures pid+port+started-at on disk. Real cost: stale-lock cleanup after crashes, lock-contention edge cases, cross-process synchronisation, on-disk garbage when the process exits via `SIGKILL`. The bound port is already a kernel-managed lock; adding an in-process pidfile increases correctness risk without new capability.
- **Daemon model** — A long-lived process serving multiple repos. Over-engineered: introduces daemon lifecycle, crash recovery, cross-repo permission boundaries, attach/detach semantics. Wrong shape for a tool whose typical session is "open, look, Ctrl+C."
- **Port-probe + cwd-match** (selected) — `GET /__alive` is unauthenticated and tourId-agnostic; the response carries the running server's `cwd`. Before `bindWithFallback`, the entry point fetches with a 150ms timeout. Same-cwd hit → log existing URL, exit 0. Different-cwd, non-Tour, or no response → fall through to the existing bind-and-fallback logic. No on-disk state, no lifecycle management; the bound port is the lock and `/__alive` is the identity probe.

## Consequences

- **Stable URLs across re-runs.** Browser tabs the user pinned to `http://127.0.0.1:8687` keep pointing at the live server. Bookmarkability survives invocation cycles.
- **No process / watcher proliferation in the common case.** One `.tour/<id>/` directory → one watcher → one reply-agent dispatch path. Preserves the inert-by-default property from ADR 0010 cleanly.
- **Different repos coexist gracefully.** A Tour for repo A on 8687 → repo B's `tour serve` falls back to 8688; the cwd-match check prevents wrong-tour reuse.
- **Non-Tour processes on the preferred port fall back unchanged.** The probe distinguishes "Tour for our cwd" from "anything else"; in the latter case the existing collision behaviour applies.
- **Explicit `--port N` honors reuse too.** A same-cwd Tour on `N` is reused even when the user passed `--port` explicitly; a non-Tour or different-cwd process surfaces the existing `port N is in use` error.
- **No `tour stop` / `tour restart` / `--new` flag.** Users who want a fresh server kill the existing process (Ctrl+C in its terminal). One way to do each thing.
- **`/__alive` is unauthenticated by design.** It exposes only the identity envelope: `tour: true`, `cwd`, `port`, `startedAt`. No tour data, no annotations, no PII. Bound to `127.0.0.1` like everything else in `tour serve` — not reachable off-host.
- **Pure probe module.** `src/core/tour-probe.ts` is a pure function over an injected `fetch`; the unit tests cover all branches without real network calls.
- **Shipped in v2.0.0.** CHANGELOG documents the reuse behaviour.

## Update (issue #195)

The slice-1.5 implementation probed only the preferred port, then handed off to a non-probing `bindWithFallback` walk. This missed same-cwd Tours that had landed on a *fallback* port (e.g. cwd-A bound 8688 because 8687 was held by an unrelated process). A later invocation in cwd-A would probe 8687 (non-tour), fall through to bind, and end up on 8689 — defeating the single-instance promise.

Fix: the probe is now interleaved with the bind walk. `src/web/resolve-serve-port.ts` replaces the two-step "probe preferred + bindWithFallback" composition with a single loop that, at every port: reuses on same-cwd Tour, skips on other-cwd Tour or non-Tour, otherwise binds. Explicit `--port N` keeps single-port semantics. The pure `probeTour` and `/__alive` envelope are unchanged.
