# Annotation anchor validated at write time

> **Builds on:** PRD #140 (consolidate Annotation create paths through a single validated seam), [ADR 0016 (no environment-dependent author defaults)](./0016-no-env-author-defaults.md), and slices [#141](../../../issues/141) (seam migration), [#142](../../../issues/142) (body trim), [#143](../../../issues/143) (author default). Locks in rule 4/5 of the five rules the seam enforces. Sibling to [ADR 0013](./0013-hidden-context-expansion.md) — the orphan-window machinery that handles render-time placement of legal-but-out-of-hunk anchors.

The Annotation creation seam (`createAnnotation` / `createReply` / `createAnnotations`) is the sole entry point for new Annotations under PRD #140. Rule 4 of the five rules it enforces is the **anchor-in-diff** rule: every top-level Annotation's `(file, side, line_start, line_end)` must resolve to a position inside the Tour's Diff at write time. Replies inherit their anchor from the parent and are exempt — the parent is already inside the Diff by construction.

Before this slice, four classes of bad anchor flowed silently to disk:

- **File typo.** Agent writes `--file src/main.js` for a Tour whose Diff has `src/main.ts`. The Annotation lands; the renderer drops it; `tour pickup --json` returns a conversation entry the human can't navigate to.
- **Path-shape confusion.** Agent supplies a repo-absolute path (`/home/me/repo/src/main.ts`) instead of the repo-relative form Tour uses. Identical failure mode.
- **Rename mismatch.** Agent annotates the old name of a renamed file. Pierre's diff model represents the file under its new name; the Annotation never finds a host file row.
- **Line-range overflow.** Agent supplies `--line 5000` on a 200-line file. The renderer has nothing to paint at row 5000; the annotation card disappears.

In every case, the failure is invisible at write time and surfaces only at render time — or never, if no one re-opens that section of the Diff. The agent driving `tour annotate` from a script gets exit 0 and assumes the write succeeded; the human reading the Tour misses an annotation they don't know exists. Detection latency was effectively unbounded.

The fix lands the validation at the seam, where every writer (CLI / TUI / webapp / reply-runner) funnels through under PRD #140. Replies inherit their anchor from the parent — already-in-diff by induction — so the new constraint scopes to top-level writes.

## Decisions

**`createAnnotation` and `createAnnotations` take a required `bundle: TourBundle` argument.** Their signatures grow to `createAnnotation(cwd, tourId, request, bundle)` and `createAnnotations(cwd, tourId, requests, bundle)`. The bundle carries `files[].name`, `files[].oldContent`, and `files[].newContent` — everything the validator needs. `createReply` does **not** gain the argument; replies inherit the parent's anchor and the parent already passed validation when it was written.

**The validator enforces four invariants per request:**

1. `request.file` must appear in `bundle.files` (matched by `name`).
2. `request.line_start ≥ 1`.
3. `request.line_end ≥ request.line_start`.
4. For `side === "additions"`: `request.line_end ≤ lineCount(file.newContent)`. For `side === "deletions"`: `request.line_end ≤ lineCount(file.oldContent)`.

The upper bound is **inclusive** — a single-line file allows `line_end = 1`. The lower bound is also inclusive (`line_start = 1` is a valid first line).

**Hidden-context anchors stay legal.** The validator checks file membership and line-range bounds only, not hunk membership. An anchor at line 5 of a 200-line file whose only hunk is around line 30 is a legal write; `orphan-window` (ADR 0013) handles render-time placement. The "stricter than orphan-window" framing in the PRD's *Further Notes* was a misread — the orphan-window code is read-side render machinery, not a write-side validator. The seam's check is in fact the same shape (`is the line inside the file?`) without the hunk-overlap question.

**Unchanged-context-row anchors stay legal.** CONTEXT.md's rule "Annotations on unchanged context lines pick `additions` by convention" is unchanged. The seam's check is range-based, not row-kind based — an addition-side anchor on a line that happens to be unchanged is just a valid in-range write.

**Snapshot-lost bundles reject with a clear error.** When `bundle.kind === "snapshot-lost"`, there is no Diff to validate against. Rather than skip validation, the seam refuses the write with `"Cannot validate annotation anchor against a snapshot-lost tour bundle"`. In practice the surfaces gate the composer on `kind === "ok"`, so this branch is defense-in-depth; without it, a snapshot-lost write could silently bypass the rule.

**The CLI loads the bundle exactly once per invocation.** `tour annotate` (single) loads via `loadTourBundle` immediately before its `createAnnotation` call. `tour annotate --batch` loads once before its `createAnnotations` call, regardless of item count — the bundle is the same for every item in a batch. The reply path (`--reply-to`) skips the load entirely; `createReply` doesn't need a bundle.

**The TUI passes its in-memory bundle through.** The `writeAnnotation` callback's `WriteAnnotationInput` discriminant gains a `bundle: TourBundle` field on the `"top-level"` variant. `App.tsx` reads the bundle from its component state (already there for rendering) and passes it through to the `cli/tui.ts` callback, which forwards it to `createAnnotation`. No second bundle load on the TUI write path.

**The webapp loads the bundle inline per POST.** The webapp's `POST /api/tours/:id/annotations` handler loads via `loadTourBundle` immediately before its `createAnnotation` call. The watcher / SSE loop does not cache a bundle; the GET endpoint loads its own. Loading per POST is the simplest correct shape — same cost the GET endpoint already pays, ~tens-to-low-hundred ms on a moderate Tour. A future caching layer could amortize, but the write rate is low enough (one POST per human authoring action) that the cost doesn't justify it yet.

**The reply-runner is unaffected.** It calls `createReply`, which is exempt from the rule. No bundle load on the reply dispatch path.

## Considered Options

- **Validate at read time, not write time** (`readAnnotations` filters out anchors it can't resolve). Rejected. Pushes the failure mode to render time — exactly the place the seam is trying to lift it out of. A silently-filtered Annotation is indistinguishable to the agent from a successfully-rendered one until the human notices a missing card. The whole motivation for the seam under PRD #140 is to surface bad input at the place the input arrived, not downstream.

- **Validate at write time but only reject "file not in bundle"; leave the line bounds check for read time.** Rejected. Splitting the four invariants across two layers makes the contract harder to reason about — "which kinds of bad anchors fail loud, which fail silent?" is the kind of contract that erodes the moment someone needs to add a fifth check. The four invariants are conceptually one thing ("the anchor resolves to a paintable position"); the seam should own all of them.

- **Allow non-diff anchors and add a "file-only" annotation kind to the data model.** Rejected as out of scope. Annotating an unchanged file at the pinned SHA is a real future need (the deepening review identified it as a candidate), but it requires a new render row kind in the row planner, a Pierre fallback for files without diff metadata, and a CONTEXT.md amendment to the Annotation definition. None of that is in this slice. The data model stays one shape; future work can extend it under its own PRD.

- **Reject anchors that fall in Hidden context** (line in range but not in any hunk's `-U3` window). Rejected. `orphan-window` (ADR 0013) already handles their render-time placement — they're a legal Tour shape, not an edge case to forbid. Forbidding them at write time would break existing `.tour/` snapshots that have such anchors today and would force agents to know about hunk geometry to write valid annotations, which is exactly the kind of leak the seam is supposed to hide.

- **Lazy load the bundle (skip on reply paths)** vs. **eager load (always load)**. Adopted lazy for the CLI: `tour annotate --reply-to` skips the load entirely, saving ~tens-to-low-hundred ms on the reply path. The single and batch top-level paths load once. The TUI/webapp don't have this distinction because the bundle is already in scope at the call site (TUI) or cheap to load (webapp's existing GET cost).

- **Cache the bundle in the webapp** per-tour so POSTs reuse the GET-loaded one. Rejected for v1. The GET and POST handlers are separate stateless handlers in the current request fan-out; introducing a cache requires reasoning about invalidation (the diff is SHA-pinned, so the cache could be keyed on `tourId` and never invalidated — but adding the abstraction without a measured POST-rate justification is premature). The write rate is bounded by human authoring speed, so per-POST loads are not a hot path.

## Consequences

- **Four classes of silent failures become loud failures.** File typos, repo-absolute paths, rename mismatches, and line-range overflows all surface as a non-zero exit (CLI) / 400 response (webapp) / composer-error (TUI) at the point of write. The agent driving `tour annotate` sees the error immediately and can correct it before the next batch.

- **`tour annotate` end-to-end latency grows by the bundle-load cost.** Single-call ~tens-to-low-hundred ms on a moderate Tour (≤ 50 files); `--batch` amortizes that over the whole block. The PRD's ≤ 150 ms budget is met in practice. Agents driving `tour annotate` in a tight loop should prefer `--batch` to keep the per-item overhead near zero.

- **Existing `.tour/` data is not retroactively validated.** Annotations already on disk keep their anchors as-is; the seam only acts at write time. Any pre-existing bad anchors continue to be hidden by `orphan-window`'s read-time placement (orphan-window plus the renderer drop together cover the lenient legacy behavior). If a future audit pass were desired, it would be a separate one-shot CLI verb — not in scope here.

- **Reply-runner unchanged.** No new dispatch cost; the reply path's empty-stdout rejection (slice 2 / #142) remains the only seam-side failure mode for replies.

- **TUI `WriteAnnotationInput` API gains a `bundle` field on the top-level variant.** The reply variant is unchanged. The App's submit handler reads `bundle` from its component state (which already drives every render) and passes it through. No new state flows.

- **Webapp POST load.** Adds one `loadTourBundle` call per `POST /api/tours/:id/annotations`. The GET endpoint already does the same. Cost is acceptable for the bug class prevented; future caching could amortize if write rates climb.

- **Snapshot-lost surface is explicit.** Attempting to annotate a snapshot-lost Tour now rejects with a clear message; previously such a write would have landed on disk untethered to any diff. The composer is already gated by `kind === "ok"` in both surfaces, so this branch is defense-in-depth.

- **Future "annotate unchanged file" feature has a clear upgrade path.** Today's rule says "file must be in `bundle.files`." A future PRD that adds support for non-diff anchors would either widen `bundle.files` to include unchanged files (one shape change, no seam-API change) or pass a separate `extraFiles: BundleFile[]` argument. Either way, the validation seam stays in one place.

- **Reversibility.** The four-line `validateAnchor` helper is one git revert away; the four call sites' bundle arg becomes an unused parameter that the compiler can flag. The new ADR documents the trade-off so a future "this slows annotate down" thread has somewhere to point. Pre-1.0; the cost of changing course is small.
