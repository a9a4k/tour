# Threads are structurally flat

> **Status:** Tightens the Reply model introduced in ADR 0036. Narrows the `reply.created` event's parent-pointer contract from "any Comment in the Tour" to "the top-level Comment of the Thread." Breaking change to the on-disk event schema (`replies_to` → `thread_id`). Pre-1.0 with no external users; existing `.tour/<id>/` directories are explicitly invalidated, as in ADR 0036.

A Thread is one top-level Comment plus a flat list of Replies. Every Reply's `thread_id` references the Thread's root, never another Reply. The data model does not admit nested sub-threads. The seam, the projection, and the renderers all rely on this invariant.

## Why

The pre-ADR model carried a free parent pointer (`Comment.replies_to: string`) that could reference any Comment, including another Reply. The type admitted arbitrary tree depth. Three things made this a latent bug rather than a feature:

1. **The projection always flattened.** `buildThreads` walked the `replies_to` chain up to the root and collapsed every descendant into one flat list under that root, ordered by `created_at`. Tree shape on disk; flat list everywhere downstream.
2. **The renderers always flattened.** Web and TUI both render Replies as a flat `created_at`-ordered sequence under the root's card. No surface ever showed nesting; the parent pointer's exact value was invisible to the user.
3. **The writers disagreed on what `replies_to` meant.** `web/App.tsx` set it to the latest leaf (often a Reply); `tui/composer-state.ts` set it to the cursor's Comment (any kind); `reply-runner.ts` set it to the triggering Comment; `cli/comment.ts` set it to whatever the user typed. Four call sites, four different semantics — all stored without complaint, all flattened on read.

The drift between writers caused a real defect in `events-fold.ts`. With `A ← B ← C` (depth-2 tree), deleting `B`:

- The fold dropped deleted Replies from the projection, so `B` vanished entirely.
- `C.replies_to = B`, but `B` was no longer in the projection's `byId` map.
- `buildThreads.findRoot(C)` returned `null` — orphan — and `C` silently disappeared from every Thread list.

The cascade rule and the thread-rooting rule disagreed about what depth ≥ 2 meant. The bug stayed latent because almost every writer happened to produce depth-1 in practice. The tree shape was a footgun that bought nothing the UI used.

## Considered Options

- **Keep `replies_to` as a free parent pointer.** Status quo. Permits nesting that no surface renders, requires chain-walking on every projection, ships the depth-2 delete bug. Rejected.
- **Single event kind with `thread_id` on every Comment (root's `thread_id === id`).** Collapses `comment.created` and `reply.created` into one event. Tempting for symmetry but forces every root to carry a redundant self-reference, weakens runtime type-narrowing (root-ness becomes an id-equality check rather than field presence), and bloats the event-log eyeball view. Rejected.
- **Narrow `replies_to`'s contract via documentation; keep the field name.** Cheapest. Rejected because the name continues to mislead every future reader — exactly the trap that produced the drift between writers. The semantic shift wants a name to match it.
- **Rename to `thread_id`, narrow the contract, enforce at the seam, hard-fail in the fold (selected).** Field name matches the semantics. Type-level distinction stays crisp: `thread_id?: string` — presence means Reply, absence means top-level. Every layer can throw on violations because the invariant is unambiguous.

### Why not allow nested replies "for the future"

Slack-style nesting and GitHub-style reply-to-specific-message are both real product shapes. Closing the door is deliberate:

- The current product never rendered nesting in any surface. Building the *storage* for a UI shape that doesn't exist is premature flexibility.
- If nested quoting ever becomes a product requirement, the natural extension is a second optional field `in_reply_to_comment_id` that carries *display-only* lineage while `thread_id` keeps the structural pointer. The two concerns separate cleanly — the structural shape (one root, flat children) doesn't need to change to support visual reply-to-message.
- Conflating "what Thread does this belong to" with "what Comment am I responding to" was the root cause of every drift the pre-ADR model produced. Keeping the structural pointer narrow and reserving the display lineage for a future, optional field is the lesson.

## Decisions

### Field: `Comment.thread_id?: string`

Replaces `replies_to`. Present iff the Comment is a Reply. By contract references a top-level Comment of the same Tour. The "root id of any Comment" is `c.thread_id ?? c.id` — inline at every call site; no helper.

### Event: `reply.created` carries `thread_id`

```
{"kind":"reply.created","id":"<comment-id>","thread_id":"<root-id>","body":"…","author":"…","author_kind":"human","at":"…"}
```

The `replies_to` JSON field is gone. Storage matches the TS type 1:1; no per-event rename in `events-fold.ts` or `events-store.ts`. The two event kinds (`comment.created`, `reply.created`) remain separate — discriminated by `kind`, with each kind carrying exactly the fields it needs.

### Seam: `createReply` validates strictly

`comments-store.ts:createReply` looks up `thread_id`'s target. The call throws when:

- The target doesn't exist: `No comment with id "<thread_id>" in this tour`.
- The target exists but is itself a Reply: `thread_id "<id>" is a Reply (root of its Thread is "<root>"); pass thread_id="<root>"`.

The second error message resolves the offending Reply's own `thread_id` so the caller can act on the suggestion. The `readComments` call the seam already performs covers the lookup; the validation is one extra Map read.

### Fold: hard-fail on malformed events

`events-fold.ts` throws if a `reply.created` event's `thread_id` references a Comment with non-undefined `thread_id` (i.e. another Reply) or references an unknown id. The fold has historically been permissive (silent orphan-drop). The new behavior is louder because the seam is now the only legitimate writer; any malformed log entry indicates manual edit or a corrupted file, and silent absorption would hide the corruption from the user.

### Projection: `buildThreads` is a groupBy

`threads.ts:buildThreads` reduces to: bucket Replies by `c.thread_id`, attach each bucket to its top-level Comment, sort each bucket by `(created_at, id)`. No chain walker, no cycle detection, no orphan handling — the seam and fold both enforce the invariant upstream, so the projection can assume well-formed input.

The following helpers are deleted: `findRoot` (chain walker), `isTopLevel` (inline `c.thread_id === undefined`), `threadRootIdOf` (inline `c.thread_id ?? c.id` — every call site has the Comment in hand). `findThreadByNode` keeps its signature; its body becomes O(1) via a `Map<rootId, Thread>`.

### Action sites: inline normalization in the GUI, strict pass-through in the CLI

- **TUI** (`composer-state.ts`): `{ kind: "reply", thread_id: cur.thread_id ?? cur.id }` — one inline expression at the composer-target construction site.
- **Web** (`App.tsx`): same inline expression where the composer target is built. The "latest comment" helper still returns a Reply id when the latest leaf is a Reply; the action-site dereferences `thread_id ?? id` on the resolved Comment.
- **CLI** (`comment.ts`): `--reply-to <id>` and batch `thread_id` pass straight through to the seam. No `threadRootIdOf` lookup, no bundle load for normalization. The seam's throw is the user-facing error.
- **Reply-runner** (`reply-runner.ts`): same inline expression at the `createReply` call site.

### Cascade rules: unchanged shape, simpler implementation

The C4 cascade (ADR 0036) does not change semantically:

- Deleted Reply → vanishes from the projection.
- Deleted root with ≥1 live Reply → renders as a `[deleted]` stub.
- Deleted Thread (all nodes deleted) → vanishes entirely.

The implementation simplifies: `parentsWithSurvivingReplies` is now keyed off `thread_id` (a root id by construction) rather than the chain-walked `replies_to`. The depth-2 delete bug becomes impossible — no path through the data structure can produce an orphaned Reply.

## Consequences

- The depth-2 delete bug is structurally impossible. The fold + projection no longer disagree about what "a deleted Reply" means.
- The four writers now produce identical Thread shapes by construction. Adding a fifth writer cannot reintroduce drift — the seam refuses non-root `thread_id` values regardless of caller.
- `findRoot`, cycle detection, orphan handling, `isTopLevel`, `threadRootIdOf` — five helpers' worth of accidental complexity disappears. The remaining helpers (`buildThreads`, `findThreadByNode`, `latestCommentId`, `latestHumanLeafId`) each express genuine business logic.
- Nested replies are explicitly closed off as a product direction at the structural layer. Visual reply-to-message lineage, if ever needed, lives in a future optional field — not in the Thread structure.
- Existing `.tour/<id>/` directories from before this ADR are invalid (the on-disk field name changed). Same posture as ADR 0036 — pre-1.0, no external users, no migration tooling.

## Small contracts pinned

- **A Reply's `thread_id` references a top-level Comment, period.** Type-level, seam-level, fold-level, projection-level — every layer asserts the same invariant.
- **A Comment is a Reply iff `thread_id !== undefined`.** No other discriminator. No `kind` enum, no parallel boolean.
- **The seam's throw is the user-facing error.** No action-site validation, no GUI-side error states, no CLI-side pre-validation. The contract lives in one place.
- **The fold throws on malformed input.** No silent orphan-drop, no recovery. The event log is either well-formed (seam-produced) or the Tour fails to open with a precise message.
