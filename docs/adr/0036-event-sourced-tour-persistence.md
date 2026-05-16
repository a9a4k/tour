# Event-sourced Tour persistence

> **Status:** Supersedes the on-disk *storage shape* portion of ADR 0029 (Stage B Comment log). The vocabulary decision, CLI alias, glossary flip, keybinding, and every other ADR 0029 call remain intact — only the storage shape is replaced. The `comments.jsonl` / `annotations.jsonl` read paths and the rename-on-first-write migration are dropped along with the snapshot model itself. Acceptable because Tour is pre-1.0 with no users beyond contributors; existing `.tour/<id>/` directories are explicitly invalidated and must be re-created.

The per-Tour on-disk persistence shape moves from a homogeneous log of `Comment` snapshot records (`comments.jsonl`) to a heterogeneous log of events (`tour-events.jsonl`). Current Comment state is computed at read time by folding events through a pure projection. Initial event kinds are `comment.created`, `reply.created`, and `comment.deleted`. Future verbs (edit, resolve, re-anchor) slot in as new event kinds without changing the storage seam, the watcher, the lock semantics, or any surface's consumer contract.

## Why

ADR 0029 made the unit-vocabulary call ("Comment" replaces "Annotation") but kept the storage shape unchanged: one JSONL line per Comment, each line a final-shape record. This shape served single-verb usage (create) cleanly. Adding a *second* verb — delete — exposed the mismatch.

A delete record has no Comment shape; it is a verb, not a noun. Three ways to fit it into the snapshot log:

1. **Tombstone records on the Comment log** with a new `kind: "deleted"` discriminator grafted onto the Comment schema. Pollutes the schema every other consumer reads, and the same wedge repeats for every future non-creating verb.
2. **Rewrite the file** on every delete, removing the deleted Comment's line via tmp + rename. Breaks the append-only invariant the codebase already relies on: the watcher's fingerprint logic (`core/watcher.ts`), the reply-runner's lock semantics (ADR 0015), and the absence of any cross-process write lock across the four writers (CLI, TUI, webapp, reply-runner). Concurrent appends during a rewrite are silently lost.
3. **Soft-delete a line in place.** Variable-width JSONL doesn't permit safe random-access edits — rejected on mechanics alone.

Each carries cost that compounds the moment a *third* verb arrives. Edit and resolve are both visible on the product roadmap; both have the same shape problem. The cost is structural: snapshot-shape storage is a poor fit for any subtractive or mutating operation.

The decisive observation: **`core/tour-session.ts` is already event-sourced.** Its `Action` type is the event union, `reduce` is the pure projection, `Intent` is the side-effect request. The in-memory model is "events become state." The on-disk model has been "snapshot shape, appended" — an asymmetry. With this ADR, the on-disk shape mirrors the in-memory one: events become state at both layers. The fold function for the persisted log shares shape and intent with the reducer. Reasoning about persistence collapses into reasoning about a model already in the codebase.

## Considered Options

- **Tombstone-records-on-Comment-log.** Cheapest delete-only solution. Rejected because the cost compounds with every future non-creating verb on a roadmap that visibly contains at least two.
- **File-rewrite on delete.** Atomic at the OS level via tmp + rename, but requires a cross-process write-lock contract the codebase does not have — every current writer assumes append-only and takes no lock. Also loses audit trail and adds rename-aware watcher logic.
- **Defer delete entirely until edit/resolve forces the redesign.** Rejected. Delete is a real product gap today, and the redesign cost does not shrink by waiting.
- **Event log with on-close compaction.** Live Tour uses events; on `tour close`, compact into a final snapshot. Rejected as premature — Tour ephemerality (ADR 0003) keeps event logs short; compaction adds mechanism on close for no observable user benefit.
- **Event log, no compaction (selected).** Append-only events for the Tour's full lifetime. Read projects to current state.

## Decisions

### On-disk file: `tour-events.jsonl`

One file per Tour, at `.tour/<id>/tour-events.jsonl`. Append-only. POSIX `O_APPEND` writes serialise naturally — no new lock concept beyond what the codebase already relies on for the existing four writers. The reply-lock (ADR 0015) stays scoped to reply-runner serialisation; it is not promoted to a general write lock.

### Initial event kinds

```
{"kind":"comment.created","id":"<comment-id>","file":"src/x.ts","side":"additions","line_start":42,"line_end":42,"body":"…","author":"…","author_kind":"agent","at":"…"}
{"kind":"reply.created","id":"<comment-id>","replies_to":"<parent-id>","body":"…","author":"…","author_kind":"human","at":"…"}
{"kind":"comment.deleted","target_id":"<comment-id>","at":"…"}
```

- `comment.created` — top-level Comment authoring. Carries the full per-Comment shape today's `Comment` record carries (`id`, anchor fields, `body`, `author`, `author_kind`, `at`).
- `reply.created` — Reply authoring. Carries `id`, `replies_to`, `body`, `author`, `author_kind`, `at`. The reply's anchor is inherited from its parent at fold time, not stored on the event.
- `comment.deleted` — deletion. Carries `target_id` and `at`. `by_kind` is implicitly `"human"` (see permissions decision below) and not encoded.

Future kinds (`comment.edited`, `comment.resolved`, …) extend the union without changing the storage seam. The reducer in `core/tour-session.ts` already accepts an evolving `Action` union via TS `assertNever` exhaustiveness — the same pattern applies to the disk fold.

### Reads return projected state

The single read seam (`readComments` in `core/comments-store.ts`) parses events, folds them through a pure function `foldEventsToComments`, and returns `CommentState[]`. `CommentState` extends today's `Comment` with an optional `deleted?: { at: string }` field. Every surface (CLI, TUI, webapp, `tour pickup`, reply-runner) consumes the projection — no surface parses the event log directly.

The fold tolerates malformed lines (the existing reader already does), ignores delete events targeting unknown ids as defence-in-depth, and is idempotent on duplicate delete events. Write-time validation in `createDelete` is the primary guard against malformed deletes; the fold's tolerance is a safety net, not a primary contract.

### Cascade rule (C4), applied at fold time

- A deleted leaf **Reply** is removed from its Thread's projected reply list. No stub.
- A deleted **parent Comment** with ≥1 surviving Reply projects as a `[deleted]` stub Comment that retains the anchor; surviving Replies render under it.
- A **Thread** where every node (parent + every Reply) is deleted vanishes from the projection entirely.

The rule lives in the fold; surfaces consume `Thread[]` and render `[deleted]` Comments however they choose (stub card in TUI/webapp; first-class `deleted` field in `tour pickup --json`). Order independence is structural: the rule depends on the final set of deleted ids, not the order events were appended.

The rule treats deletion as **retraction**, not **resolution**. A retracted concern that still applies to the underlying code may be re-raised by an agent on a fresh review pass — that is correct behaviour. The product primitive for "stop bringing this up" is **resolve**, a separate event kind tracked for a future ADR.

### Permissions: humans only

Only humans emit `comment.deleted` events. Agents create only. Enforced at the write seam (`createDelete`) by rejecting non-human authorship at validation. The CLI's `--as-agent` flag is rejected for the delete operation; the webapp's delete button is implicitly human; the reply-runner never emits delete events.

This is a protocol contract, not a security boundary — `--as-agent` is caller-asserted (ADR 0016). The realistic failure mode (an honestly-tagged agent attempting to delete) is what the predicate catches; identity-spoofing is governed by the same trust assumption every write already operates under.

Rationale for the asymmetry: every agent-delete scenario considered (multi-batch supersession, retry-after-bad-draft, reconsider-after-pushback, consolidate-redundant-feedback) either resolves before the write seam, doesn't exist in the dispatch model, or is actively the wrong artifact for the user need. Restricting the verb shrinks agent surface area for free.

### Surfaces and gestures

- **CLI:** `tour comment <tour-id> --delete <comment-id>`. No interactive confirmation, consistent with the existing `tour delete <tour-id>` precedent. Mutually exclusive with the existing `--file/--side/--line/--body` and `--reply-to/--body` flag families. `--as-agent` is rejected at parse.
- **TUI:** `d` while cursor is on a Comment card opens a confirmation modal. The modal previews the targeted Comment (author, age, body excerpt) and surfaces cascade implications when the target is a parent with replies ("3 replies will remain under [deleted]"). `Enter` confirms, `Esc` cancels. Reply-level targeting depends on the cursor work tracked in ADR 0037 — when the cursor can address any node in a Thread, this verb works uniformly across parent and Reply.
- **Webapp:** trash icon on each Comment card opens a modal with the same content and gestures.

The TUI's two-modal pattern (composer + delete-confirm) shares the `close-modal` precedence already pinned in ADR 0031.

### Migration: predecessor files become invalid

`comments.jsonl` and the `annotations.jsonl` legacy fallback are no longer read. ADR 0029's Stage B addendum decision that "the read-fallback stays forever" is **superseded for the storage shape specifically** — the vocabulary, CLI alias, and other Stage B addendum decisions stand.

Any existing `.tour/<id>/` directory becomes unreadable after this ADR lands. Affected users — currently: contributors only — must re-create their Tours. The pre-1.0 status makes this acceptable; the cost of a migration shim outweighs its value when there are no external users.

## Consequences

- The reducer in `core/tour-session.ts` and the disk fold share substantial schema. Creation events ≈ the `composer.submitted` action's payload. Future actions that need persistence (edit, resolve) have a clear template to follow: define an event kind, extend the fold, extend the reducer.
- The watcher (`core/watcher.ts`) loses its dual-fingerprint logic. `effectiveCommentsFingerprint` collapses to `fingerprint(join(dir, "tour-events.jsonl"))`. One filename, one fingerprint, simpler watch.
- The reply-runner dispatch log (ADR 0014) stays separate for now. A future ADR may fold it into the event log as `reply.requested` / `reply.completed` events; not in scope here.
- `tour pickup --json` envelope keys are unchanged; the per-record `Comment` shape gains an optional `deleted?: { at }` field. Existing consumers that don't read this field are unaffected.
- Greppability: the event log is heterogeneous on `kind`. `grep '"kind":"comment.created"'` recovers the homogeneous-log experience when needed.
- The fold function is the single place where read-time invariants (cascade, unknown-target tolerance, idempotency) are enforced. Write-time validation in the create/delete seams remains the primary guard.
- Delete is a one-way operation in v1 — no `comment.restored` event, no undo UI. The TUI's confirmation modal and the webapp's confirmation modal are the safety net. An undo verb is straightforward to add later (just another event kind) but is deliberately out of scope.

## Small contracts pinned

- **No `by_kind` field on `comment.deleted`.** Implicit `"human"`. If a future ADR introduces system-driven deletes (e.g. compaction), the field gets added then; for now its absence enforces the permission decision at the schema level.
- **The fold is pure and totally ordered by file position.** `at` timestamps are metadata for display, not the ordering key. Append order is truth.
- **Reply-runner never emits `comment.deleted`.** The dispatch surface is restricted to `*.created` events. If a future agent flow needs to retract, the right surface for that decision is a new ADR re-opening the permissions call.
