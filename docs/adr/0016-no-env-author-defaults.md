# Annotation `author` has no environment-dependent defaults

> **Builds on:** PRD #140 (consolidate Annotation create paths through a single validated seam) and the slice that established the seam ([#141](../../../issues/141)). Locks in rule 2/5 of the five validation rules the seam enforces.

The Annotation creation seam (`createAnnotation` / `createReply` / `createAnnotations`) is the sole entry point for new Annotations under PRD #140. Among the five rules it enforces, rule 2 is the **author default**: when a caller omits `author`, the seam falls back to the `author_kind` literal — `"human"` if `author_kind === "human"`, `"agent"` if `author_kind === "agent"`.

Before this slice, three different surfaces had three different defaults:

- The CLI's `annotations-store` builder defaulted `author` to `"unknown"`.
- The TUI resolved `author` to `os.userInfo().username` via a `humanAuthor()` helper (falling back to `"human"` only if the lookup failed).
- The webapp's POST handler defaulted to a `DEFAULT_HUMAN_AUTHOR = "you"` constant.

The same human authoring the same Annotation through three surfaces would see three different display strings — `"unknown"`, `"<os-username>"`, or `"you"` — depending purely on which renderer they happened to launch. With the seam now mediating every write, the question is no longer "which default per surface" but "should `author` carry environment-derived state at all?"

We say no. `author` is one durable field in `annotations.jsonl`; it lives on disk for as long as the Tour does, and it crosses machine boundaries when a Tour folder is copied or committed. Reading `os.userInfo().username` at write time bakes the *writing machine's* identity into the *Tour's* permanent record. That's an environment leak into the data model — invisible at write time, surprising at read time. The TUI's helper was added before the seam existed, when the cost was just "match the webapp's default for the human path"; under the seam, the default becomes a Tour-wide contract, and a contract that says "your OS username will appear in version-controllable Tour data unless you remember to pass `--author`" is the wrong contract to default to.

The CLI's `--author "..."` flag continues to land verbatim, regardless of `author_kind`. This is the explicit channel for callers that *want* a custom display string (a script id, a team alias, a literal name) — `author` is a free-form display string per CONTEXT.md's on-disk schema entry, and the seam treats supplied values as opaque. The default fallback is what gets standardised, not the flag.

## Decisions

**Author defaults to the `author_kind` literal at the seam.** `createAnnotation` and `createReply` (and `createAnnotations` for both batch kinds) replace `input.author ?? "unknown"` with `input.author ?? input.author_kind`. A top-level `human`-kind Annotation with no `author` lands as `author: "human"`; an `agent`-kind without one lands as `author: "agent"`. The reply-runner already supplies the agent name explicitly, so this is a no-op for its happy path. Round-trip through `readAnnotations` is unchanged.

**The TUI's `humanAuthor()` helper is removed.** `src/cli/tui.ts` no longer imports `userInfo` from `node:os` and no longer resolves an author at the call site. The `writeAnnotation` callback passes only `author_kind: "human"` plus the anchor and body; the seam handles the rest.

**The webapp's `DEFAULT_HUMAN_AUTHOR` constant is removed.** `src/web/server.ts` no longer holds a per-surface default. The POST handler reads `author` from the JSON request body if present (a webapp client *could* still customise it via the request payload — out of scope today, but the contract permits it) and otherwise omits the field so the seam falls back to `"human"`.

**The CLI's `--author "..."` flag passes verbatim.** No change. `src/cli/annotate.ts` already pipes `args.author` (`undefined` when the flag is absent) into the seam, and the seam's `??` does the right thing in both cases.

**No environment-derived defaults survive in any surface.** No `os.userInfo()`, no hostname, no env var lookup, no per-surface "nicer" constant. The only ways to set a non-literal `author` are: pass `--author` on the CLI, supply `author` in the webapp's POST body, or reach in and edit `annotations.jsonl` by hand.

## Considered Options

- **Keep `humanAuthor()` in the TUI; standardise only the webapp + CLI defaults.** Rejected. The strongest argument for keeping the TUI's OS-username resolution was "the TUI is a *local* tool, so reading the local username is fine." But the data the TUI writes is the same `annotations.jsonl` the webapp reads, that `tour pickup` emits, and that travels with the Tour folder. The "local tool" framing applies to runtime, not to persisted output — and Tour's persistence is the load-bearing surface here. Picking one surface to retain environment leak would mean different defaults again the moment the user switches renderers.

- **Default to `os.userInfo().username` uniformly across all surfaces (i.e. push `humanAuthor()` into the seam).** Rejected. This makes the leak universal rather than removing it, and uniformity-by-leakage isn't worth more than uniformity-by-literal. It also introduces a determinism break for tests and `tour pickup --json` consumers: the same writer process yields different `author` strings on different machines. The literal-fallback path is deterministic and inspectable.

- **Read a `~/.tourrc` for a user-configurable default.** Rejected for v1. Adds a new on-disk config surface with no concrete demand, expands the file-IO contract of `createAnnotation` (it now reads two files, not one), and re-introduces environment dependence through a different door. If real users ask for it, the explicit channel is `--author` or a per-surface customised value — the rc file is a UX shortcut for a problem we don't yet have.

- **Surface the OS username only in the TUI's pre-fill of the composer, not in the persisted record.** Rejected as out-of-scope churn. The composer doesn't currently expose an editable author field, and adding one to dodge the persistence question creates new UI without addressing the data-model concern (an unedited pre-fill is still a write of OS state). If the TUI ever grows a composer-level author override, the seam contract is unchanged — the override would supply `author` explicitly.

- **Default `author` to `"unknown"` (the pre-seam CLI behavior) uniformly.** Rejected. `"unknown"` is a stand-in that loses information the system already has — `author_kind` is on every record, and the kind literal is more honest than a third string that pretends not to know which kind it is. `"unknown"` was a builder-internal placeholder, not a user-visible decision.

## Consequences

- **Same human, same Annotation, same display string across surfaces.** A reviewer authoring through the TUI and the webapp without `--author` will see `"human"` on both. The cost is that they no longer see their OS username automatically; the gain is that the Tour's records are independent of the writing machine's identity.

- **The recurring "OS-username feels nicer in the TUI" temptation has a written answer.** A future architecture review can point at this ADR rather than re-debating the leak. The temptation is real (it *does* feel nicer in interactive use); the cost is real and persistent (it lands in version-controllable data).

- **TUI no longer imports `node:os`.** One less Node-stdlib coupling at the renderer-bridge layer. The TUI module shrinks by the `humanAuthor()` helper (~8 lines) plus its import.

- **Webapp's POST handler no longer holds a default constant.** The `DEFAULT_HUMAN_AUTHOR = "you"` line is removed; `asString(body.author)` flows directly into the seam (`undefined` when absent, which triggers the kind-literal fallback).

- **`tour pickup --json` output is more uniform.** Consumers (main-agents) see `"human"` or the supplied custom string, never an OS username. Pickup-format documentation can describe `author` as "a free-form display string, defaults to the author_kind literal when not customised" without per-surface caveats.

- **Tests gain deterministic defaults.** Test fixtures that omit `author` get `"human"` / `"agent"` deterministically, no `userInfo()`-dependent setup. Two existing tests in `tests/core/annotations-store.test.ts` (`defaults author to 'unknown'`) had to be rewritten — they were asserting the placeholder, not behavior. The replacement assertions cover both kinds plus the verbatim-passthrough case.

- **Reversibility.** Re-adding a per-surface helper is mechanical (~10 lines per surface) and the seam's fallback is one `??` operator away from any other choice. The seam contract is the load-bearing decision; the specific fallback string is one line. Pre-1.0; the cost of changing course is small. Existing `.tour/` data on developer machines is not retroactively rewritten — Annotations already on disk keep whatever `author` they were written with, since the seam only acts at write time.
