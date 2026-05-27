# Comment edits are body-only and history-free in projection

Tour's Comment event log (ADR 0036) gains a `comment.edited` verb — humans-only, body-only, rejected at the seam for deleted targets / empty-after-trim bodies / identical-after-trim bodies. The projection collapses the edit history: only the latest body surfaces. Surfaces show no `(edited)` indicator, and `tour pickup --json` omits any edit metadata. Prior bodies remain recoverable from `tour-events.jsonl` for forensic purposes.

## Considered options

- **Body + anchor edits in one verb.** Rejected — re-anchoring a Comment (changing `file` / `side` / `line_start` / `line_end`) is a structurally different problem (the new anchor needs validation against the Tour bundle exactly like `createComment` does, and the meaning of an anchor edit is fuzzy: did the agent intend the new lines or the old?). ADR 0036 already reserves `re-anchor` as a separate future verb. Keeping `edit` body-only honours that split and stays forward-compatible with anchor mutations as a separate event kind.

- **Agents allowed to edit their own comments.** Rejected — symmetry with the existing `comment.deleted` humans-only rule. The principle is "agents leave a trail; humans curate it." Letting an agent rewrite its own past comments would break the audit guarantee on `tour-events.jsonl` — the projected log would no longer reflect what the agent originally said. Agents that want to correct themselves post a Reply or a new top-level Comment.

- **GitHub-style `(edited)` tag on the card.** Rejected — symmetry with `tour pickup --json`. The main-agent consuming pickup acts on the current conversation state, not its history; if the human edited their question, the agent reads the human's final phrasing. Surfacing the indicator only on the cards and not in pickup would split the projection's idea of "what this comment is" by audience. Forensics live in the event log for whoever needs them.

- **Empty-edit-as-delete.** Rejected — conflates two verbs. The user already has `comment.deleted` (humans-only with its own confirm modal on the TUI); routing empty-body edits to deletion would smuggle a delete through an edit event and break the per-verb humans-only protocol layer. The seam rejects empty-after-trim, identical to the create-path invariant.

- **Conflict surface on concurrent cross-surface edit.** Rejected — multi-surface concurrent edit of the same Comment is rare in practice, and the Tour-session runtime's existing "watcher reload arrives mid-composer" rule already covers it (last-write-wins at the seam). The event log preserves both edits for whoever wants to reconstruct the timeline.

## Consequences

- The event log grows monotonically with `comment.edited` events; no compaction. For a Comment edited N times the log carries N+1 bodies. Acceptable — Tours are per-pass and short-lived; the log is bounded by realistic edit frequency.

- A future `re-anchor` verb extending the same union can land without disturbing this ADR; the body-only scope here is forward-compatible with anchor mutations as a separate event kind.

- The TUI's `e` keybinding becomes cursor-row-kind-contextual (card → open edit composer; row → expand-all-in-file). The keymap is already row-kind-aware (`a` is row-only, `r`/`s` are card-only); the footer-preview rule surfaces the active meaning per cursor position, so the collision is disambiguated for the user without a separate key allocation.
