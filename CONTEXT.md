# Review

A code-review tool that pairs an ephemeral, GitHub-style split-view diff with persisted AI annotations. Drives the same data from a TUI and a webapp, with MCP as the primary write surface for agents.

## Language

**Review**:
A single review-pass over a pinned git diff, with zero or more annotations attached. Lives in `.review/<id>/`.
_Avoid_: PR, pull request, code review session, changeset

**Diff**:
The set of file changes shown in a Review, recomputed from git on every open. Never persisted.
_Avoid_: patch, changes, delta

**Head**:
The git ref the Review's diff ends at. Resolved to a SHA at create time. May be a real commit or a synthetic snapshot of the working tree.
_Avoid_: tip, target

**Base**:
The git ref the Review's diff starts from. Resolved to a SHA at create time. Defaults to `head^` for single-commit reviews.
_Avoid_: parent, ancestor

**Annotation**:
A note anchored to a `(file, line-range)` inside a Review's diff. Authored by an agent (via MCP) or a human (via TUI/webapp). Persisted in the Review's folder.
_Avoid_: comment, review comment, note

**Working-tree snapshot**:
A synthetic commit object capturing uncommitted changes at the moment a Review is created, so the Diff stays pinned even as the working tree keeps moving.
_Avoid_: stash, WIP commit

## Relationships

- A **Review** has exactly one **Head** and one **Base**, both stored as SHAs.
- A **Review** has zero or more **Annotations**.
- An **Annotation** belongs to exactly one **Review** and anchors to one file + line-range inside that Review's **Diff**.
- A **Working-tree snapshot** acts as a synthetic **Head** when an agent creates a Review of uncommitted work.

## Example dialogue

> **Dev:** "If the agent amends the commit after creating a **Review**, do the **Annotations** still line up?"
> **User:** "The **Review** is pinned to the original SHA. Amending creates a new SHA — the old one is still in git's object store, so the **Diff** and **Annotations** still resolve. If the agent wants to review the amended version, they create a new **Review**."

## Flagged ambiguities

- _none yet_

## Resolved decisions

- **Annotation lifetime**: per-review-pass. Annotations are not re-anchored across rebases or amendments. Stale Reviews are abandoned, not migrated.
- **Diff source**: commit-pinned only. Working-tree reviews are supported by snapshotting to a synthetic commit at create time, so the rest of the system only ever sees SHAs.
- **Multiplicity**: many Reviews coexist, ordered by creation time. Default open behavior surfaces the most recent unfinished one.
