# Gap-row family with hunk-header as merge target for file-top

> **Builds on:** PRD #151 (promote hunk-header to first-class interactive gap-row across both surfaces) and [ADR 0013 (hidden context expansion)](./0013-hidden-context-expansion.md). Establishes the canonical row-kind taxonomy, the asymmetric merge into the `hunk-header` row, the gap-size-conditional row count, and the **D1 directional convention** that the implementation slices under PRD #151 ship on both surfaces. Pure-vocabulary slice — no code changes — so this ADR locks the design decisions before the first implementation slice lands.

ADR 0013 shipped Hidden context expansion with two row kinds at the file edges (`boundary-top`, `boundary-bottom`) and the existing `hunk-separator row` as the mid-file affordance. In practice that taxonomy left two visible holes:

- **Webapp half-wired.** The webapp inherited Pierre's `expandUnchanged: true` mechanism, which expands the whole file at once and was reverted in commit `c20a263` once the regression surfaced. After the revert the webapp had no gap-row affordance at all — every gap was silently swallowed, and CONTEXT.md's *Expand context* entry kept claiming a mechanism that no longer existed.
- **`@@` row half-wired on the TUI.** `flat-rows.ts` registered the hunk-separator as cursor-addressable, but `DiffRows.tsx` rendered it as inert text with no cursor visual and no `onMouseDown`. The mid-file `@@` row was a dead zone in both surfaces.

PRD #151 fixes both by promoting the **`hunk-header` row** to a first-class interactive member of the gap-row family on both surfaces, with gap-size-conditional rendering and surface-parity semantics. This ADR captures the cross-cutting decisions that the implementation slices have to honour. The five-kind row taxonomy below is the canonical contract; the planner, the cursor walker, and the per-surface renderers all derive from it.

```text
diff-row             — content (existing, unchanged)
annotation           — content (existing, unchanged)
collapsed-file       — interactive (existing, unchanged)
gap-mid-top          — interactive, emitted iff mid-file gap > 2N (NEW)
boundary-bottom      — interactive, emitted iff file-bottom gap > 0 (existing, unchanged emission)
hunk-header          — always emitted; interactive iff gapAbove > 0 (REPLACES inert-only HunkHeaderRow)
                       hunkIndex === 0 && gapAbove > 0    → file-top semantics (single direction toward file start)
                       hunkIndex >  0 && 0 < gapAbove ≤ 2N → symmetric expand
                       hunkIndex >  0 && gapAbove > 2N    → bottom direction (paired with gap-mid-top above)
```

## Decisions

### Asymmetric merge: file-top folds into `hunk-header`, file-bottom stays standalone

The first hunk's `hunk-header` absorbs what was previously a separate `boundary-top` row. For `hunkIndex === 0`, the row's `gapAbove` is the file-top gap (lines 1 to first-hunk-start) and expansion is single-direction toward the file's start. File-top now ships as one row instead of two; `boundary-top` ceases to exist as a row kind, including in the cursor walker.

The symmetric merge on the file-bottom side is **not** taken. `boundary-bottom` stays a standalone interactive row emitted after the last hunk's content. The asymmetry is structural: git's hunk format has hunk-headers (each hunk begins with `@@ -a,b +c,d @@`) but no hunk-footers — there is nothing on the file-bottom side to fold into. Inventing a synthetic hunk-footer row purely to symmetrise the model would buy nothing (the same UX is already cleanly addressable via the standalone `boundary-bottom` row) at the cost of fighting git's data shape on every render.

The asymmetric merge keeps the file-top case lean (one row per file with hidden top context, regardless of size) and accepts a one-time conceptual cost — the gap-row family has four kinds of emissions, not three — in exchange for not duplicating affordances at file-edges.

### Gap-size-conditional row count, threshold = `2N`

A mid-file gap renders as either one row or two, conditional on its size:

| `gapAbove` range          | Rows emitted                                        | Affordance shape                                |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `gapAbove === 0`          | `hunk-header` (inert)                               | none — row is plain `@@` metadata               |
| `0 < gapAbove ≤ 2N`       | `hunk-header` (interactive, symmetric)              | one cursor stop, one Enter / one chevron        |
| `gapAbove > 2N`           | `gap-mid-top` (interactive) + `hunk-header` (bottom) | two cursor stops, two Enter / two chevrons      |

`N = 20` is the per-direction step size (matching Pierre's `expansionLineCount: 20` and the TUI's prior symmetric-20 semantics), so the two-row threshold is `gap > 40`. The threshold's chosen so that one symmetric press can absorb the entire gap when it's small enough to make a directional split pointless; above that, splitting the affordance gives the reviewer real choice ("peek at the previous hunk's end" vs. "peek at the next hunk's start") instead of forcing two presses to traverse the gap.

File-edges (`hunk-header` on `hunkIndex === 0` with file-top gap; `boundary-bottom` on file-bottom gap) do **not** get the two-row treatment even when their gap exceeds `2N`. File-edges have a single meaningful direction (toward the file's start / end), so a directional split would be cosmetic. Users who want to skip to line 1 / EOF in one keystroke use `Shift+Enter` / shift-click to expand all.

### D1: row position == end of gap, divergent from GitHub's chevron-direction convention

Two coherent directional conventions exist:

- **D1** — the row's spatial position determines which end of the gap it expands. Top row of a gap → expand the top end → newly-revealed lines appear above the row. Bottom row → expand the bottom end → newly-revealed lines appear below.
- **D2** — the affordance's iconography (e.g. a `↑` chevron) determines which end is expanded. GitHub's chevron-direction model: `↑` on the upper position reveals lines from above; `↓` on the lower position reveals lines from below — same outcome as D1 in GitHub's specific layout, but the *invariant* is the chevron's direction, not the row's position.

Tour adopts **D1** on both surfaces. The reasoning:

- **Spatial directness.** Newly-revealed lines always appear adjacent to the row that revealed them. The cursor moves naturally — pressing Enter on a `gap-mid-top` row makes lines appear right above it, where the eye is already focused.
- **Surface parity.** D1 maps cleanly to both Pierre's DOM grid (insert reveals adjacent to the gap row) and OpenTUI's row stream (planner re-emits adjacent rows on the next render). D2 would force the webapp's chevron icons to flip when the user changes split / unified layout (chevrons mean different sides in different visual contexts), or force the TUI to invent glyph-direction semantics where its row stream gives them for free.
- **One-shot learning cost.** GitHub-savvy users have to learn that Tour's convention diverges. We accept that cost once for the consistency win across surfaces. The visual idiom remains similar enough (chevrons + adjacent reveal) that the surprise is small.

### `N = 20` step size, `Shift+Enter` / shift-click for "expand all"

Per-direction press reveals 20 lines. Both surfaces share this constant — it matches Pierre's `expansionLineCount: 20` (so the webapp's `expandHunk` call site is a one-line wiring) and the TUI's prior symmetric-20 expansion (so existing `core/expansion-state.ts` reducers don't change shape). The two-row threshold (`gap > 2N = 40`) is a derived constant, not an independent knob.

`Shift+Enter` (TUI) and shift-click (webapp) bypass the step and expand the entire gap. This is the escape hatch for "I know I want the whole thing" — useful at file-edges (jump to line 1 / EOF) and on small-to-medium mid-file gaps where the step-by-step reveal is busywork.

The step size is deliberately uniform across surfaces. A future PRD could expose it as a setting (per-tour or per-surface), but the marginal win doesn't justify the configuration surface today.

### Surface parity: same logical row stream, surface-divergent rendering

Both surfaces consume the same `PlannedRow[]` from `core/diff-rows.ts`. Visual rendering differs by surface:

- **TUI** renders each row kind via OpenTUI primitives — `▶` glyph + line-number gutter bg for interactive rows, plain muted text for inert hunk-headers. Direction glyphs (`↑`, `↕`, `↓`) on interactive rows give the user a visible cue for which end the row addresses.
- **Webapp** injects gap rows into Pierre's grid as DOM nodes (mirroring the existing `plus-button-overlay.ts` pattern). The `@@` row's height is slimmed via `unsafeCSS` injected into Pierre's shadow root to read at code-line height; a chevron-icon overlay on the row's left edge carries the affordance; the `gap-mid-top` and `boundary-bottom` rows are standalone injected rows above / below the relevant `@@` cell.

The contract is the row stream. Either surface can swap its renderer without touching the planner or the other surface; future surfaces (e.g. an LSP-style inline view, or a printable export) would consume the same `PlannedRow[]` and ship their own rendering.

## Considered Options

- **Symmetric file-edge merge (file-bottom into a synthetic hunk-footer)** — emit a per-hunk `hunk-footer` row that mirrors `hunk-header`, fold `boundary-bottom` semantics into the last hunk's footer. Rejected. There is no git diff construct corresponding to a hunk-footer; introducing one purely to symmetrise the row model would invent a row kind that has no metadata to carry (no `@@` line, no line-number gutter info) and would render as a chevron-only row anyway. `boundary-bottom` as a standalone row already gives that exact UX without inventing a synthetic metadata header to host it. The asymmetry between file-top (folds in) and file-bottom (standalone) is structural; documenting it is cheaper than papering over it.
- **Always two rows for file-edges with non-trivial gaps** — emit a top-direction row above the first `hunk-header` when `gapAbove > 2N`, mirroring the mid-file two-row model. Rejected. File-edges have a single meaningful direction (toward file's start / end). The directional split that's useful mid-file ("peek at previous hunk's end" vs. "peek at next hunk's start") collapses at file-edges because there is no "previous hunk's end" on the file-top side. A two-row file-edge would have one direction that's exactly equivalent to "expand all" — pointless surface area. `Shift+Enter` / shift-click covers the "all at once" case for users who want it.
- **Always one row for mid-file gaps, regardless of size** — single `hunk-header` with symmetric expand on every mid-file gap. Rejected. Symmetric expand is fine for small gaps (`gap ≤ 40`) where the whole thing absorbs in one press; for large gaps it forces 2+ presses just to traverse, and worse, the user can't choose which end to peek at without expanding the other end first. The `gap-mid-top` row pays for itself the first time a reviewer wants to skim 200 lines of unchanged context for the few lines near a hunk's edge.
- **Three rows for mid-file large gaps** (`gap-mid-top` + a middle "expand all" row + `hunk-header`) — symmetric directional pair plus a one-shot "give me everything" row in the middle. Rejected. The middle row's job is covered by `Shift+Enter` / shift-click on either of the two directional rows; adding a third row inflates the row count without giving the user a new capability. Mid-file gaps already cost two rows of vertical density on large hunks — a third would push the cost into the "starts to compete with the diff content" zone.
- **D2 (chevron-direction convention) on both surfaces** — match GitHub's visual idiom: the chevron's direction declares which end is expanded, regardless of the row's position. Rejected. On a webapp split-layout, chevron icons would have to flip when layout toggles between split and unified; on the TUI, the row stream doesn't carry "chevron direction" as a first-class concept, so D2 would force the renderer to invent and maintain it. D1's "row position == end of gap" is a property the planner already produces (the row's spatial position is exactly the position of the end it expands), so adopting D1 makes the contract free.
- **D2 on the webapp, D1 on the TUI** — let each surface match its idiomatic neighbour (GitHub on the webapp, vim-style spatial directness on the TUI). Rejected. The cross-surface inconsistency is a worse cost than the one-shot learning curve of "Tour's convention diverges from GitHub on the webapp." Reviewers who switch surfaces would have to mentally re-translate which end each row expands; the surface-parity principle (same row stream, same semantics) is worth more than per-surface idiom matching.
- **Configurable `N` (per-tour or per-surface step size)** — expose the 20-line step as a setting. Rejected for now. The setting surface area (where it lives, how it's persisted, whether it syncs across surfaces, how the threshold `2N` follows it) is non-trivial to design, and the marginal UX win for users who'd want a different step is small relative to the cost. Pierre's `expansionLineCount: 20` is the de-facto upstream default; matching it is the path of least surprise.
- **Mirror Pierre's expansion state in Tour** — Tour holds its own per-file `expandedHunks` set and recomputes gap counts from it directly. Rejected (decision **A1** in the PRD's design discussion). Pierre owns its expansion state today, and `expandHunk` is the synchronous click-handler primitive; mirroring would mean either a one-way "Tour reads Pierre's state" coupling (which Pierre doesn't expose cleanly) or a two-way sync that drifts. The chosen path — Tour calls `expandHunk` via a ref, then re-renders so the planner reads Pierre's updated `FileDiffMetadata` — keeps Pierre as the single source of truth for revealed lines on the webapp, with the TUI continuing to use `core/expansion-state.ts` as its source of truth.
- **Pierre fork or upstream contribution** — get an externally-controlled `expandedHunks` prop into Pierre so Tour can drive expansion via props rather than via a side-effecting ref. Rejected as out of scope. The current Pierre API gives us what we need (`expandHunk` + `hunkSeparators: 'metadata'`); the fork / upstream cost dwarfs the marginal architectural cleanliness gain. If Pierre's API grows that prop in a future version, switching to it is a one-file refactor (decision **A2** in the PRD).
- **Feature-flag the new gap-row family** — ship behind a flag and let the old broken status quo coexist until the flag is removed. Rejected. The change is contained and observable; behind a flag it would have to coexist with the half-wired status quo (webapp gaps silently swallowed, mid-file `@@` rows dead-zone on the TUI), which is worse than landing the new behaviour directly. PRD #151 explicitly takes this stance.

## Consequences

- **CONTEXT.md vocabulary aligns with code.** The `hunk-separator row` term is gone — replaced by `hunk-header row` (matching `HunkHeaderRow` in `core/diff-rows.ts`). The `boundary-top` term is gone — its semantics live in the first hunk's `hunk-header`. A new `gap-mid-top` term enters the vocabulary. `boundary-bottom` stays. Future readers see one row-kind vocabulary across docs, code, and tests; the prior drift (CONTEXT.md describing a `expandUnchanged: true` webapp mechanism that no longer existed) is closed.
- **The planner's row contract gains one new kind.** `gap-mid-top` is additive; `boundary-top` is removed; `hunk-header`'s `gapAbove` field replaces the previous `expandUp` / `expandDown` cosmetic split. Test suites for `core/diff-rows.ts` and `core/flat-rows.ts` extend to cover the new emissions and the cursor-walkability conditional on `gapAbove > 0`.
- **The webapp gains its first Tour-owned gap-row affordances.** Until now the webapp had either no expansion (post-revert) or whole-file expansion (pre-revert via `expandUnchanged: true`). The new model puts Tour in control of the affordance UI while keeping Pierre as the source of truth for revealed lines.
- **The TUI's mid-file `@@` row becomes interactive** for the first time. The cursor visual + `onMouseDown` wiring follows the existing `boundary-bottom` and `collapsed-file` rendering primitives; no new visual idiom is introduced.
- **D1's divergence from GitHub's chevron-direction convention is a one-shot learning cost.** GitHub-savvy users will momentarily expect a `↑` chevron at the top of a gap to reveal lines from above (D2); they will instead see the *row*'s position decide. The visual idiom is similar enough that the surprise is small and the consistency gain (surface parity, no chevron-flipping on layout toggle) is large.
- **No on-disk migration.** Annotations anchor to `(file, side, line_start, line_end)`; the gap-row family is a render-time concept. Existing `.tour/` data is unaffected.
- **Reversibility.** The row-kind taxonomy is the load-bearing part; reverting would unwind the planner's new emissions (`gap-mid-top`, `hunk-header.gapAbove`), the cursor walker's interactive-row generalisation, the TUI rendering branches, the webapp overlay module, and the CONTEXT.md vocabulary updates. Bounded but not trivial. The most painful piece to revert would be the `boundary-top → hunk-header` merge, since it's a removal rather than an addition; downstream callers (dispatch routing, footer hints) carry its absence. Pre-1.0; the cost is acceptable.
- **Future row kinds slot in cleanly.** The pattern — "planner emits a row kind, cursor walker recognises it if interactive, both surfaces render it through their existing row-render switch" — generalises. A future "load more annotations" row, an "expand surrounding function" row, or an LLM-suggested "review this hunk first" row could join the gap-row family or sit beside it under the same contract.
