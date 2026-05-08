# Name the tool Tour, not Review

The container concept is renamed from `Review` to `Tour`. The unit `Annotation` keeps its name — the original problem was PR-review baggage on the *container*, not the unit. A Tour is a guided traversal of a pinned git diff with annotations at notable spots; an agent walks the diff, marks the points worth attention, and hands the artifact off to a human who follows the same path.

## Considered Options

- **Review** (status quo) — fails on PR-review baggage (LLMs and humans pattern-match to approve/block/merge-gate semantics) and verdict framing (annotations are observations, not grades). The constraint that triggered the rename.
- **Walkthrough** — semantically accurate but eleven letters and one-directional; the metaphor doesn't accommodate the future bidirectional model where the human can reply at each stop.
- **Margin** — vivid and short, but Placek-fails the anti-description test: annotations literally live *in the margin* of a split-view diff, so the name describes the function. Marginalia is also single-reader by tradition; bidirectional fit is weaker than it appears.
- **Cairn** — Placek-passable (familiar word, unexpected category), bidirectional via trail-marker tradition, but the author and likely international users don't know the word; pronunciation is non-obvious. Accessibility-fatal.
- **Trail** — common, short, picture-able, naturally multi-traveler; passes every test except per-anchor conversation. Trails imply observations distributed *across* a path, not multi-turn dialogue *at* a point.
- **Riff** — clever portmanteau of `review` + `diff` with strong conversational metaphor (jazz call-and-response). Rejected because riffs are *symmetric peer improvisation*; the tool is *asymmetric* (agent leads, human follows). The name would describe a different product.
- **Tour** (selected) — most accurate metaphor for the actual workflow (agent guides through diff, stops at points worth pointing out, human follows). Modern guided tours include Q&A at each stop, which accommodates the future bidirectional model. Short, universally understood, anti-(a)/(c) baggage, unexpected category application (tourism → code review) — the Azure/Outback shape Placek's framework prizes.

## Consequences

- **Container only.** `Review` → `Tour` across types, files, paths, refs, CLI binary. `Annotation` is unchanged — it has no PR-review priors, Pierre's `AnnotationSide` contract (ADR 0001) survives untouched, and the diff-tool industry already uses the term.
- **On-disk:** `.review/` → `.tour/`, `review.toml` → `tour.toml`, `refs/review/<id>` → `refs/tour/<id>`. `annotations.jsonl` keeps its name.
- **CLI verbs unchanged.** `tour create`, `tour annotate`, `tour list`, `tour show`, `tour close`, `tour delete`, `tour prune`, `tour tui`, `tour serve`. Verbs describe actions, not nouns.
- **Bidirectional v2 deferred.** The name accommodates a future where each annotation hosts a multi-turn thread, but the v1 data model is unchanged (one annotation per anchor). The new container concept (`Stop` holding multiple `Turn`s) gets introduced in a separate ADR when that feature ships.
- **Existing dogfood data discarded.** Pre-rename `.review/` folders and `refs/review/<id>` are throwaway; cleaned with `rm -rf .review .git/refs/review`. No migration tooling — pre-1.0 single-user project.
