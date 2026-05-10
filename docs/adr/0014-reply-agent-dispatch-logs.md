# Per-dispatch reply-agent logs for post-mortem inspection

> **Builds on:** [ADR 0010 (bidirectional review via reply-agent + pickup)](./0010-bidirectional-review-via-reply-agent.md) and [ADR 0012 (stdout-as-reply contract)](./0012-stdout-as-reply.md). Nothing in either is revised; this ADR adds a diagnostics layer on top.

ADR 0012 routes the inner CLI's stdout into the Reply Annotation body and surfaces three failure modes on stderr — spawn-failed, non-zero-exit, empty-stdout — each as a single line. In practice, the failure-mode lines tell the user *that* something went wrong but not *why*. The why lives in the inner CLI's stderr (auth lookup failures, deprecated-flag warnings, model refusals, rate-limit notices, framework chatter that pushed the actual answer past the empty-after-trim bar) — and that stream is `inherit`-ed today, which means it streams to whichever process started the renderer. In a TUI session it's invisible (and a latent framebuffer-corruption hazard when the inner CLI prints ANSI to fd2 mid-render); in a `tour serve` session it's mixed into server logs and scrolled away by the time the user notices the failure line. The diagnostic information existed; it just had no capturable surface.

We persist a per-dispatch log file under `.tour/<id>/logs/`, one file per reply-agent invocation, keyed by the triggering Annotation id. Each file holds a small meta header, then stdout and stderr lines interleaved by arrival time and prefixed by stream (`OUT: ` / `ERR: `), then an exit footer. Stderr is captured into the log instead of inherited to the parent. The three existing failure-mode stderr lines gain a `; see <path>` suffix; the success path stays silent (the Reply Annotation is the success surface).

The intended job is **post-mortem on stdout-as-reply failures**, not live spectating. Live `tail -f` works as a free side-effect of writing append-as-you-go, but we don't promote it as a primary UX — the reply pill driven by `.reply-lock.json` already covers "is the agent on it?".

## Decisions

**Per-dispatch file, keyed by triggering Annotation id.** Each reply-agent invocation writes to `.tour/<id>/logs/reply-<triggering-id>.log`. The triggering Annotation id is the natural correlation key: Reply Annotations carry `replies_to`, so the question "what happened on parent X?" maps to one path. Single-flight + queue-of-1 from ADR 0010's reply-runner already guarantees one dispatch per file.

**Subdir, not flat.** Logs live under `logs/` rather than next to `tour.toml` and `annotations.jsonl`. The Tour folder stays scannable; `ls .tour/<id>/logs/` enumerates exactly what's recoverable. `.tour/` is gitignored by default per CONTEXT.md, so logs inherit that.

**Full triggering id, not `shortId()`.** The 4-char base36 suffix is collision-prone within a Tour with dozens of Annotations. The full id is unwieldy in shells, but it's a copy-paste path pointed at by an error message — uniqueness beats brevity.

**Interleave-by-arrival, line-prefixed by stream.** Each line written to the log is one of three forms: `=== <key>: <value>` (header / footer), `OUT: <line>` (a stdout line from the inner CLI), or `ERR: <line>` (a stderr line). The two streams are interleaved in arrival order so causality is preserved (the credential warning that arrived between tokens 1 and 2 of stdout is real diagnostic signal). The OUT:/ERR: prefix lets shell tooling reconstruct what would have been the Reply body via straightforward filtering.

**Append-as-you-go, not buffered-until-exit.** Lines are written to disk as they arrive from the inner CLI's pipes. This survives a SIGKILL'd renderer up to the kill point — buffer-until-exit would lose everything when the failure mode is "process died." It also gives `tail -f` for free as a debugging side-effect.

**Minimal meta header, no envelope or system-prompt body.** The header records agent name, triggering Annotation id, Tour id, started_at, pid, and byte-counts for envelope and system prompt. The bodies of envelope and system prompt are *not* serialised: both are deterministic from durable state (envelope reconstructable from `annotations.jsonl` + `tour.toml` at the moment of dispatch — Tour's reply-agents have no tools and read no mutable state; system prompt is Tour-canonical and won't drift between dispatches). Bytes-only summaries detect drift cheaply without doubling file size.

**Exit footer at end.** A single `=== exit: code=<N> signal=<sig|null> duration_ms=<N>` line closes each run. Failure-mode disambiguation (was it spawn-failed, non-zero-exit, or empty-stdout?) is recoverable by combining this footer with the runner's own stderr message, which already enumerates those three cases.

**Capture-only stderr.** The shared spawn helper flips stderr from `inherit` to `pipe`. The inner CLI's stderr goes to the log file, full stop — it is not tee'd back to the parent's stderr. This re-imports zero live-spectator capability (which we don't want as primary), removes per-token CLI clutter from the `tour serve` terminal, and coincidentally fixes the latent TUI framebuffer-corruption hazard that `inherit` carried.

**Failure-only path surfacing.** The runner's three existing single-line stderr messages each gain a `; see <path>` suffix. The success path is silent — when the Reply lands, the user has the rendered Annotation, and printing the log path on every dispatch is stderr clutter. The log is recoverable by convention (`ls .tour/<id>/logs/`) for anyone who wants to audit a successful reply.

**Append-with-delimiter on hypothetical re-dispatch.** If a future change ever lets the same triggering id dispatch twice (today's runner's `seen` set prevents this within a process), open the log with `flag: "a"` and write a `--- Run started: <iso> ---` delimiter at the top of each new run. Truncate-on-write was rejected: a future bug that double-fires must not silently overwrite forensic data.

**Logs follow the Tour's lifecycle.** `logs/` is created lazily on first dispatch. `tour prune --older-than <duration>` deletes `.tour/<id>/` whole, taking `logs/` with it — no separate retention policy.

**Format is contract.** Once shipped, the OUT:/ERR: line-prefix scheme and the `=== ` header form become a contract for ad-hoc shell tooling. Changing the format later breaks every reader. Future format additions should layer on top (new `=== <new-key>: <value>` header lines) rather than mutate the existing shape.

## Considered Options

- **Rolling per-(Tour, agent) file with `--- Run started ---` delimiters** (sandcastle's shape). Rejected. Failure surfacing has to say "the latest run in `<path>`" — fragile against a subsequent dispatch landing while the user is investigating. Agent name in the path also conflicts with renderer-scoped `--reply-agent` (a single Tour can be opened with claude in TUI and codex in webapp simultaneously); per-(Tour, agent) splits don't reflect how humans think about a Tour ("what happened on this thread?", not "what happened on this thread when the claude renderer was attached?"). Pruning a single rolling file with mixed-age content is also harder than dropping a per-Tour directory.

- **Sectioned-by-stream layout with a meta header.** A single file containing `=== meta ===`, `--- stdout ---`, `--- stderr ---` regions, written at exit. Rejected. Requires buffering both streams to exit, which kills `tail -f` and — load-bearing — leaves an empty file when the failure mode is "parent process died." Causality across the two streams is also erased: "the credential warning arrived *between* tokens 1 and 2" is real diagnostic signal that the sectioned layout cannot represent.

- **Capture stdout into log, leave stderr `inherit`-ed.** The minimum change to expose stdout for post-mortem. Rejected. The information value for diagnosing failures is overwhelmingly on stderr, not stdout — empty-stdout failures by definition have nothing to capture on stdout, and the why-it-was-empty answer always lives on stderr. Halfway also doesn't fix the TUI framebuffer hazard.

- **Capture-and-tee stderr** (write to log AND echo to parent's stderr). Considered as a way to keep `tour serve` users' live "is the agent talking?" view. Rejected. Re-imports a live-spectator capability we ruled out as the primary job, and mixes per-token inner-CLI chatter into the parent stderr stream — a regression in signal density (`tour serve` printing "listening on ..." plus the runner's three failure lines is the right level). Users wanting live can `tail -f` the log file; survives `tour serve` restarts.

- **Renderer-conditional stdio** (capture in TUI, capture+tee in webapp). Rejected as too clever. Cross-layer concern (the spawn helper would need to know whether the parent is a TUI), and the asymmetry would itself be a future debugging cost ("why did webapp users see X but TUI users didn't?").

- **Always print the log path at dispatch start** (sandcastle's `tail -f` hint pattern). Rejected. Sandcastle prints those because live-spectating *is* its UX. Tour's success surface is the reply pill + landed Reply Annotation; printing the path on every dispatch is stderr clutter that competes with the pill UX. Failure-only surfacing is the lower-noise option that still serves the post-mortem job.

- **Persist the full envelope JSON and system prompt body in the log header.** Considered for forensic completeness. Rejected. Reply-agents have zero tools and read no mutable state, so the envelope is deterministic from `annotations.jsonl` + `tour.toml` at the moment of dispatch — full bodies are recoverable forensically without writing them. Bytes-only summaries cost ~2 bytes per run and detect drift; full bodies double file size for a recovery path most failures don't traverse.

- **Persist the argv handed to the inner CLI.** Considered for "what command did Tour actually run?" recovery. Rejected. Adapter-specific, easy to recover from each shipped agent's TS module, and could leak future secret-bearing flags (model API keys, organisation ids) by accident if a maintainer adds a flag without thinking about the log surface. Not worth it for the post-mortem job.

- **Truncate-on-write on hypothetical re-dispatch.** Rejected. Today the runner's `seen` set prevents same-id re-dispatch within a process, so the question is hypothetical — but a future bug that double-fires must not silently overwrite forensic data. Append-with-delimiter is the safer-by-default choice; the file-open flag is one character of code either way.

## Consequences

- **The shared spawn helper's stdio shape changes from `["ignore", "pipe", "inherit"]` to `["ignore", "pipe", "pipe"]`.** Every shipped reply-agent (claude, codex, gemini, opencode, pi) routes through this helper, so the change is a single-file edit. The helper's result type extends to expose stderr observably (or, equivalently, to accept a writer for each stream).

- **`SpawnResult` (or its successor) ceases to be a buffered final-state shape.** The runner needs the streams as they arrive, not as a post-hoc string. The simplest refactor exposes per-chunk callbacks on `SpawnedAdapter` (`onStdout`, `onStderr`) plus the existing `exit` promise; the runner attaches a log-writer to both and a stdout-buffer-for-Reply-body to the first. The stdout-as-reply contract from ADR 0012 is preserved unchanged — the body is still `stdout.trim()`, just accumulated chunk-by-chunk instead of read once at exit.

- **A new diagnostic surface ships.** The user gains a stable, deterministic path to inspect any reply-agent run, including ones that succeeded. The log is forensic, not a live UX, and the existing reply pill remains the in-flight surface.

- **TUI display hygiene improves.** Inner CLIs that wrote ANSI to fd2 mid-render no longer corrupt the OpenTUI framebuffer — fd2 is now a pipe, not the TUI's terminal.

- **The OUT:/ERR: line-prefix scheme becomes a contract.** Ad-hoc shell tooling will start to depend on it. Format-changing future work needs to additive (new `=== <key>: <value>` header lines, new prefix forms reserved later) rather than mutate the existing scheme.

- **Logs have a new chunk-boundary correctness constraint.** Stream chunks from the child do not align with line boundaries. The writer must accumulate per-stream partial-line buffers and flush prefixed lines on `\n`, with a trailing-partial-line flush on stream close — otherwise a chunk ending mid-line followed by a chunk on the *other* stream produces a corrupt interleave. This is implementer-side discipline, but it is the one place where "just append the chunk" is wrong.

- **Disk usage grows linearly with dispatch count per Tour.** Bounded by human reply rate, capped by `tour prune` lifecycle, and dwarfed by `annotations.jsonl` + git's object store in practice. No size cap, no rotation policy.

- **Reversibility.** Reverting is mechanical: flip the spawn helper back to `inherit`, drop the log writer, drop the path suffix on the failure-mode messages. The `.tour/<id>/logs/` directories left behind on disk would become orphans but are cheap to leave (or sweep with `tour prune`). The diagnostic regression — losing the post-mortem trail — is the cost of reversal, and it's the cost we're paying today.
