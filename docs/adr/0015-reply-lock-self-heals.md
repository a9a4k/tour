# Reply lock self-heals via PID liveness; drop `tour reply-cancel`

> **Builds on:** [ADR 0010 (bidirectional review via reply-agent + pickup)](./0010-bidirectional-review-via-reply-agent.md) and [ADR 0012 (stdout-as-reply contract)](./0012-stdout-as-reply.md). Neither is revised — the dispatch contract and stdout-capture path are unchanged. This ADR scopes only the recovery model for stuck `.reply-lock.json` files and the in-memory shape of `ReplyLock`.

CONTEXT.md documents `.reply-lock.json` as a 4-field transient: `{agent, responding_to, started_at, pid}`. The in-memory `ReplyLock` interface had drifted to a 5th field — `tour_id` — hydrated by `readReplyLock` from the path it read off and never persisted. Its only consumer was a stale-pill hint on both surfaces: `Run: tour reply-cancel <tour_id>`. The hint was renderer convenience; the field existed only to carry the tour id far enough through the card hierarchy to print it without prop-drilling.

Pulled on, the thread unravels further than expected. Drop `tour_id` and the natural fix is to pass `tourId` as a sibling prop at the call sites — both renderers already have it in scope. But the deeper question is whether the CLI command the hint points at earns its keep at all. `replyCancel` does two things: SIGKILL the lock's recorded `pid`, then delete the lockfile. The lockfile-only piece of that is recovery from a *crashed renderer*, where the lock survives a process that's already dead. The SIGKILL piece targets *alive-but-hung agents*, which `reply-runner.ts`'s `finally` block makes vanishingly rare in practice (every clean exit path — success, non-zero exit, spawn error, empty stdout — already deletes the lock). And SIGKILL by recorded pid carries a recycled-PID risk that grows with the age of the lock: the longer a stale lock has been sitting, the more likely its recorded pid now belongs to an unrelated process.

Both recovery scenarios have a cheaper, safer answer than a manual CLI escape hatch. Crashed-renderer orphan locks self-clear if `readReplyLock` checks PID liveness on read. Alive-but-hung agents — rare enough that we have no instances on disk — recover by renderer restart, with the existing 2-minute stale-pill warning surfacing the situation in the meantime. The full simplification removes the CLI command, removes the pill hint, removes the `tour_id` enrichment, and lands the in-memory shape of `ReplyLock` exactly on the documented schema.

## Decisions

**`ReplyLock` matches the on-disk schema.** The interface is `{agent, responding_to, started_at, pid}` — the four fields CONTEXT.md already specifies. No `tour_id`, no `Omit<ReplyLock, …>` alias, no read-time enrichment. `readReplyLock` returns parsed JSON.

**`readReplyLock` performs PID-liveness on read.** When `pid > 0` and `process.kill(pid, 0)` throws (pid is dead), `readReplyLock` deletes the lockfile and returns `null`. When `pid > 0` and the probe succeeds, returns the lock. When `pid === 0` (the placeholder-write window in `reply-runner.ts` between the initial write and the spawn-pid patch — sub-millisecond in practice), returns as-is; the 2-minute stale safety net covers the absurd case of a renderer crash between those two writes.

**Side-effecting cleanup, not pure-read.** `readReplyLock` deletes the lockfile when it detects a dead pid. Returning `null` while leaving the orphan file invites the next reader to re-do the same probe and prevents the watcher from cleanly transitioning out of the in-flight state.

**`tour reply-cancel` CLI command is deleted.** `cli/reply-cancel.ts` is removed; the `reply-cancel` case in `main.ts`'s dispatch and the help-text line are removed; the integration test block in `tests/integration/cli.test.ts` is removed.

**Stale-pill hint is dropped.** Both surfaces (`tui/AnnotationCard.tsx`, `web/client/App.tsx`) collapse to a single warning line: `⚠️ <agent> is taking unusually long…`. No action text. Recovery for the alive-but-hung case is "restart the renderer" — implicit, not surfaced.

## Considered Options

- **Drop only `tour_id`; keep `tour reply-cancel`** (minimum change). Pass `tourId` as a sibling prop into the renderers' pill components. Rejected because once the schema-fidelity argument is taken seriously, the rest follows: the only reason `tour_id` was load-bearing was the CLI hint, and the CLI hint is a band-aid for a recovery problem that PID-liveness solves more safely. Halting at the minimum change preserves the recycled-PID risk and leaves a CLI command whose primary use case is now redundant.

- **Keep `tour reply-cancel` and add PID-liveness alongside it** (additive). Rejected for the same reason: PID-liveness fully covers the orphan-lock case, leaving the CLI command earning its keep only on the alive-but-hung edge. That edge is rare enough we have no instances of it; surfacing a discoverable command for a non-occurring failure mode is surface area without a job.

- **Surface the recorded `pid` in the stale-pill text** (`Stuck? Process <pid> in <agent>.`). Lets sophisticated users `kill <pid>` themselves without bringing back a Tour-specific verb. Rejected: turns the stale pill into a process-management tutorial. A user who needs the pid can find it in `.tour/<id>/.reply-lock.json`; the surfaces should communicate state, not teach `kill(1)`.

- **In-renderer cancel binding (TUI key, web button)**. The pill is already in the UI; the recovery action could live there instead of leaving the renderer to type a CLI command. Rejected for now: adds new keymap and button surface for a failure mode we have no evidence is recurring. Reachable later if alive-but-hung agents become a real recurring pain — the in-renderer surface would be more discoverable than the CLI command we just removed, so this is the right shape if cancellation comes back.

## Consequences

- **CONTEXT.md and `ReplyLock` agree.** The documented 4-field schema and the in-memory interface are now identical. The `Omit<ReplyLock, "tour_id">` indirection is gone.

- **Orphan locks self-clear.** Crashed-renderer scenarios — the most common stuck-lock cause given `reply-runner.ts`'s `finally`-based cleanup — recover with no user action on the next watcher tick.

- **Alive-but-hung agents require renderer restart.** The stale-pill warning surfaces the state but offers no inline action. If the agent process is genuinely hung and the user wants to kill it actively, they `kill <pid>` from another shell after reading `.tour/<id>/.reply-lock.json`. We accept this discoverability cost for the rarity of the case.

- **CLI surface shrinks.** One verb (`reply-cancel`) and one help-text line are removed. The `tour reply-cancel <id>` reference at CONTEXT.md:94 is replaced with the new auto-recovery wording; the verb is dropped from the CLI verbs list at CONTEXT.md:99.

- **Recycled-PID risk eliminated.** The deleted SIGKILL path was the only place Tour ever sent signals to a pid it didn't itself spawn in-process. Removing it removes a class of subtle correctness bugs that grew with stale-lock age.

- **Reversibility.** Re-adding `tour reply-cancel` is mechanical (~50 lines: restore `cli/reply-cancel.ts`, the `main.ts` case + help line, the integration test block, the pill hint on both surfaces). Re-adding `tour_id` to `ReplyLock` is one field on the interface and one spread in `readReplyLock`. Removing the PID-liveness check is one conditional. No data migration: `.reply-lock.json` is transient, gitignored, and never persisted across renderer restarts in any scenario worth caring about. Pre-1.0; the cost of changing course is small.
