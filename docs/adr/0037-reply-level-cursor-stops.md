# Reply-level cursor stops in TUI

> **Status:** Generalises the cursor anchor introduced in ADR 0022 (unified-cursor-walks-annotation-cards). `n`/`p` semantics from ADR 0023 are preserved — they continue to jump top-level Comments only. The change adds `j`/`k` traversal across nodes inside a Card, so the cursor can address any Comment in a Thread (parent or Reply), not just the parent.

`CardAnchor` (`core/cursor-state.ts`) currently addresses Cards by `commentId`, where `commentId` is always the top-level Comment's id. Replies render inside the parent's Card but have no cursor stop. This ADR generalises `CardAnchor.commentId` to address **any** Comment in the Thread — parent or Reply — so per-node verbs can act on the cursored node directly without an in-modal selector.

## Why

Per-node verbs are arriving. ADR 0036 lands delete as the first; edit, resolve, and reply-to-reply are visible on the roadmap. Each wants the same primitive: "act on a specific node in a Thread." Two ways to expose it:

1. **Selector inside each verb's modal.** Each destructive modal lists thread nodes; the user picks one inside the modal via in-modal `j`/`k`. Solves the problem per-verb, replicates the selector UI three or four times, and conflates *what to act on* (an addressing concern) with *do I want to do it* (a confirmation concern).
2. **Generalise the cursor to address every node.** Every per-node verb becomes "key-on-cursored-node." Solves the problem once for every future verb.

The principle: **cursors address, modals confirm.** (1) puts addressing inside the modal — a category error that compounds with each new verb. (2) puts addressing in the cursor where it belongs.

The cost of (2) is bounded. `CardAnchor.commentId` already holds a comment id; loosening which ids are legal is most of the work. The flat-row generator does not need to split a Card row into sub-rows — the cursor's `commentId` simply picks which node inside the existing Card row is "active," and the renderer highlights it accordingly.

## Considered Options

- **Per-verb selector modal.** Rejected per the framing above — the same problem is solved repeatedly, addressing concerns leak into confirmation surfaces.
- **TUI deletes parent only; reply-targeting deferred to webapp/CLI.** Defensible as a stopgap if delivery pressure forces it, but Tour is TUI-first; shipping a permanently-incomplete primary surface is the wrong default.
- **Per-reply cursor stops via separate `ReplyAnchor` type.** Introduces a parallel anchor with the same shape as `CardAnchor`. Rejected for redundancy — `commentId` is already the unit; loosening its meaning is enough.
- **Per-reply cursor stops via generalised `CardAnchor.commentId` (selected).**

## Decisions

### `CardAnchor.commentId` addresses any Comment

The field's contract changes from "the top-level Comment's id" to "any Comment id in the Thread — parent or Reply." All other `CardAnchor` fields (notably `preferredSide`) keep their current contracts and continue to carry across cursor transitions per the existing issue #200 AC.

### `j`/`k` traverses within a Card before exiting

When the cursor sits on a `CardAnchor` pointing at a parent Comment with replies, `j` advances to the first Reply (still a `CardAnchor`, same Card row, new `commentId`). Subsequent `j` presses advance through replies in append order. After the last Reply, `j` exits the Card and lands on the next flat row.

`k` mirrors symmetrically: from a Reply, `k` steps to the previous Reply (or to the parent); from the parent, `k` exits to the previous flat row.

Threads with no replies behave exactly as today — the parent is the only stop on the Card.

### `n`/`p` unchanged

The card-lane walker continues to jump between top-level Comments. ADR 0023's promise — one Comment-Thread per press — stands. Within-Thread navigation is `j`/`k`'s job exclusively. Where `n` / `p` land on a Thread, they land on the parent (the addressable anchor for the Thread as a whole); the user can then descend with `j`.

### Rendering highlights the active node

Today's Card render highlights the whole Card when its top-level `commentId` matches the cursor. After this ADR, the highlight narrows to the specific node inside the Card. The Card's overall geometry, gutter, and tint do not change — only the active-node indicator does.

### Scroll-into-view targets the Card row

The scroll-into-view intent continues to target the Card row's position, not the sub-node's position. In practice Threads are short enough that the whole Card fits on screen when the Card row is scrolled into view. Sub-positioning inside the Card is a follow-up if long Threads become common.

### Deleted-node behaviour

A node projected as `deleted` (per ADR 0036's fold) is still a cursor stop — `j`/`k` traverse onto it, and the highlight indicates it as the active node. This keeps the cursor model uniform (every node in the Thread is a stop) and lets the user `r` to reply to a `[deleted]` stub if they want to refer to the retracted concern. A `[deleted]` stub Reply with no live content is also a stop; cursor symmetry trumps the slight aesthetic case for skipping over stubs.

## Consequences

- Reply-level delete becomes a trivial verb on top of this work: `d` on cursored node opens the confirm modal, no selector required.
- Future verbs (edit, resolve, reply-to-a-reply) inherit the same addressing primitive without per-verb design work.
- `r` (reply) and `s` (send-to-agent) gestures continue to fire only when `cursorOnCard` is true (per the existing keymap context); their existing footer no-op messages are unchanged. With the cursor able to land on a Reply, `r` from a Reply still opens a composer that creates a Reply in the same Thread — Tour's data model has only one level of nesting (CONTEXT's Reply definition), so `r` semantics don't visibly change.
- `j`/`k` muscle memory shifts only for threads-with-replies — exactly the case where per-node addressing was missing. Threads-without-replies are unchanged.
- Existing tests for `nextCard` / `prevCard` walker semantics are unchanged (they continue to enumerate top-level only). New tests cover `j`/`k` traversal across mixed Threads.
- The webapp's cursor model (`src/web/client/cursor-keymap.ts`) does **not** change in this ADR — the webapp's primary interaction is mouse-driven, and clicking a Reply directly is already an option there. If keyboard-driven Reply targeting in the webapp becomes desirable later, that's a parallel decision tracked separately.
