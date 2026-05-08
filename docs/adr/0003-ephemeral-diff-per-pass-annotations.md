# Ephemeral diff with per-review-pass annotations

A Review pins to a fixed `head_sha` and `base_sha` at create time; the Diff is recomputed from git on every open and never persisted. Annotations are scoped to that single review pass and are not re-anchored across rebases, amends, or force-pushes — if the underlying code moves, the Review goes stale and a new one is created.

## Considered Options

- **Per-diff-reference, with reconciliation across amends/rebases** — annotations carry content-hash anchors and re-attach when the code shifts. Rejected for v1: real anchoring drift is hard, the heuristics are brittle, and the MCP-first single-pass flow doesn't need it.
- **Per-work-item (GitHub-PR-style)** — annotations survive across the lifetime of a feature branch, complete with "outdated" markers. Rejected: a much bigger product than what we're building, and we'd inherit GitHub's ambiguity around what "outdated" means.

## Consequences

- No anchoring code to maintain. The data model is trivially correct because the diff is pinned.
- A Review is conceptually disposable. Stale Reviews are deleted, not migrated.
- If a workflow emerges where reviews need to survive rebases, we'd grow into the per-diff-reference model — additive, but not free. The current data model is a strict subset of that future shape, so migration is forward-compatible.
- The simple "no drift" property only holds because we also pin working-tree reviews via `git stash create` + `refs/review/<id>` (see CONTEXT.md). Without that, working-tree edits during review would silently invalidate annotations.
