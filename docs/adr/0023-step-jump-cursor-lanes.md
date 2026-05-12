# `j`/`k` step every cursor-eligible row; `n`/`p` jump between Annotations

The unified Cursor's two motion gestures become **step** (`j`/`k`) and **jump** (`n`/`p`). Step walks the flat-row stream one cursor-eligible row at a time — diff rows, interactive rows, **and Annotation cards**. Jump targets the next/previous top-level Annotation in canonical `topLevel` order, regardless of intervening rows. Cards are valid stops for both gestures; the difference is **distance per press**, not which kinds of rows each gesture may land on. Supersedes the "Two navigation lanes, one cursor" consequence of [ADR 0022](./0022-unified-cursor-walks-annotation-cards.md) — specifically the rule that `j`/`k` skips Annotation cards and `n`/`p` skips diff/interactive rows. The rest of ADR 0022 (unified cursor, cards as cursor-eligible rows, action keys dispatched by `cursor.kind`, auto-recall on `r`/`s`, footer-preview, URL-mirror) stands.

Field evidence: a reviewer on a real Tour, cursor on the diff row immediately above an Annotation card, pressed `j` expecting to land on the card. The cursor skipped the card and landed on the row below it. The "two-lane" rule from ADR 0022 / PRD #192 (user stories 4 & 5) — *"`j`/`k` step through diff and interactive rows but skip Annotation cards, so the user can read code without their cursor stopping at every thread"* — was a hypothesis. Real usage produced the opposite preference: reviewers want `j` to be the universal one-step-down command and want to *stop* on threads as they encounter them in reading order. `n`/`p` becoming a *fast-lane* (skip everything that isn't a card) accelerates explicit thread-walking without removing card stops from the linear flow.

## Considered options

- **Status quo: two lanes that partition the stop set** (`j`/`k` rows-only; `n`/`p` cards-only). Rejected. The "read code without stopping" use case the partition was meant to serve isn't how reviewers actually walk a Tour; they want threads to surface in reading order. The partition also makes thread engagement discovery-dependent — the user has to know `n`/`p` exists to land on a card from a row-anchored cursor. Stopping on cards naturally is the more intuitive flow.

- **Unify only `j`/`k` to walk everything; leave `n`/`p` walking the flat stream of cards.** Rejected (this is the model that was briefly considered in PRD #192's drafting). With `n`/`p` keyed off `flatRows` (rather than `topLevel`), the bug class fixed in #197 — flat-row order disagrees with pill-counter order — comes back. The chosen design keeps `n`/`p` walking `topLevel` (the canonical Annotation order the `[N/M]` pill counts).

- **Make `j`/`k` step on cards but only at the card's "anchor row" boundary.** A half-step where `j` from line 21 lands on the card if 21 == card.line_end, but `j` from line 20 skips the card to line 22. Rejected. The rule "did your previous row exactly hit the card's anchor" is invisible and unpredictable — users would observe `j` sometimes-landing, sometimes-skipping with no apparent reason.

- **Step (`j`/`k`) + Jump (`n`/`p`)** (selected). `j`/`k` is the **step** gesture — one cursor-eligible row at a time through the flat stream, no filter on destination kind. `n`/`p` is the **jump** gesture — direct to the next/previous top-level Annotation, regardless of distance. The two differ in distance per press, not in which stops are allowed. Cards are first-class stops for both.

## Consequences

- **`moveCursor` drops the `skip-cards` loop.** Today:

  ```ts
  while (next >= 0 && next < flatRows.length && flatRows[next].kind === "card") {
    next += step;
  }
  ```

  becomes a no-op (the loop is removed). `j`/`k` now lands on whatever row sits at `idx + step` — diff, interactive, or card.

- **`cursorFromRow` produces a `CardAnchor` when the destination row is a card.** The previous synthesis of a `RowAnchor` at the card's `(file, side, line_end)` was a hack that worked only when the skip-cards loop guaranteed the helper never received a card row in `moveCursor`'s path. Under the new model `moveCursor` *does* hand it card rows; the helper returns `{kind: "card", annotationId, preferredSide}`. All call sites of `cursorFromRow` already pipe through `setCursor` which accepts either Cursor kind, so the contract widening is type-safe.

- **`CardAnchor` carries `preferredSide`.** Type extends to `{kind: "card", annotationId, preferredSide}`. `preferredSideOf(cursor)` reads `cursor.preferredSide` regardless of kind. The user's `h`/`l` choice survives card stops — a `j` past a card to the next row honours the previously-chosen side. Setters that produce a CardAnchor (`cursorFromRow` for card rows; the `decideReanchor` policy; `cursorFromAnnotation`; the click-on-card handler) pass `preferredSideOf(prevCursor)` through, with `"additions"` as the default for fresh seeds.

- **`nextCard` / `prevCard` semantics are unchanged.** They still walk `topLevel` in canonical order (issue #197). The jump gesture's contract — "next/prev annotation regardless of intervening rows" — is exactly that. Pill counter `[N/M]` stays in lockstep. Stacked cards (multiple top-level annotations at the same anchor) each count as one press apart in the jump lane (one press per topLevel entry).

- **Stacked cards count as separate stops for the step gesture.** Two top-level annotations at the same `(file, side, line_end)` emit two `CardFlatRow` entries back-to-back; `j` lands on each individually. Consistent with how `j` already walks paired diff rows in split layout — every flat-row entry is a stop.

- **TUI and webapp change together.** Both surfaces consume the same core helpers; the fix is a pure-module change that flips both navigations simultaneously. The TUI's footer-preview rule (its surface-specific affordance) is unchanged: the footer still mirrors the cursor's action target by `cursor.kind`.

- **Glossary terminology shifts.** CONTEXT.md's Cursor entry replaces the "two navigation lanes share the cursor: `j`/`k` step among diff/interactive rows (skip annotation cards); `n`/`p` step among annotation cards (skip diff/interactive rows)" framing with **step + jump**: `j`/`k` **steps** through every cursor-eligible row including cards; `n`/`p` **jumps** to the next/previous top-level Annotation. The `_Avoid_` line on the Cursor entry gains *"row lane", "card lane"* — the cursor has one stop set; the two gestures differ in distance, not destination filter.

- **PRD #192 user stories 4 and 5 are reversed.** US4 ("`j`/`k` skip Annotation cards") becomes "`j`/`k` step through every cursor-eligible row including cards." US5 ("`n`/`p` skip diff/interactive rows") stays *factually* true but its rationale ("walk threads quickly without manually passing every code line") is preserved as the jump gesture's purpose, not as a card-only filter on the stop set. The follow-up issue carrying this design captures the user-story revision in its agent brief.

- **No data-model changes.** `Annotation`, `tour.toml`, `annotations.jsonl`, `Cursor`'s overall shape (still tagged-union RowAnchor | CardAnchor) — all unchanged. The change is entirely in the cursor's motion semantics and the `CardAnchor` type's field set.

- **Reversibility.** Reinstating the partition is a re-add of the `skip-cards` loop in `moveCursor` and a revert of `cursorFromRow`'s card-row branch — about 10 lines of code plus tests. No data-on-disk implications. If real usage reveals that `j` stopping on cards is too noisy in practice, the rollback is cheap.
