# Reply-agent dispatch is explicit, not implicit

Reply-agent dispatch flips from **implicit** (watcher fires on every new human-authored Annotation) to **explicit** (user presses `s` in the TUI or clicks "Send to {agent}" in the webapp). The watcher's role narrows to state observation only — `annotations.jsonl` changes drive bundle re-render; `.reply-lock.json` changes drive the in-flight pill and the disabled state of every Send affordance on the Tour. This reverses the auto-dispatch mechanism documented in [ADR 0010](./0010-bidirectional-review-via-reply-agent.md) (the watcher-as-trigger half). The rest of ADR 0010 — the reply-agent vs main-agent split, the pinned-SHA invariant, the no-MCP rejection, the no-resolution-status decision, the no-cross-Tour-Threads stance, and the in-tree TS adapter mechanics carried forward by ADR 0012 — stands unchanged.

Field evidence: the user's last Tour under the implicit model dispatched a paid LLM call on a literal `"test"` Annotation, and on directive notes meant for the main-agent at `tour pickup` time. The implicit model failed in the direction that costs real money on every silent over-dispatch.

## Considered Options

- **Status quo: every new human Annotation triggers dispatch.** Rejected. Treats reply-agent engagement as the default outcome of writing a comment, when CONTEXT.md describes the reply-agent as an *add-on*. The default direction of failure is silent over-dispatch — paid inference on WIP / directive / "test" notes the user never intended to send.

- **Per-Annotation "request reply" flag persisted on disk** (e.g. `requested_reply: true` on Annotation). Rejected. The trigger is an event, not state — once dispatch fires, no further action on the flag is meaningful; encoding it as a field invites questions ("can I unset it after the reply lands?") that the data model shouldn't have to answer. The presence-or-absence of a child Reply already encodes "was this asked of the agent?" with zero new schema.

- **Explicit verb on each human Annotation card** (selected). A new affordance — `Send to {agent}` — lives next to `Reply` on every human Annotation. TUI binds it to `s`; webapp renders it as a button. The agent name from `--reply-agent <name>` interpolates into the label (`Send to claude`, `Send to codex`). The watcher no longer dispatches; the only path to a paid LLM call is an explicit `s` / button click.

- **`--auto-reply` CLI flag to restore implicit dispatch.** Deferred until usage shows pure-conversation Tours are dominant. Adding optionality now bakes the implicit model into the surface area before we've seen whether anyone misses it.

## Consequences

- **The core dispatch seam (`requestReply`) is unchanged.** Slice 1 (#182) landed `requestReply({ cwd, tourId, annotationId, agent? })` returning a discriminated `{dispatched|busy|invalid-annotation|no-reply-agent}` result. Both surfaces converge on it: the webapp POSTs `/api/tours/:id/request-reply` and maps the result to HTTP status (202 / 409 / 404 / 400); the TUI calls `requestReply` in-process from the `s` keymap handler. The `shouldDispatchReply` predicate remains as a precondition assertion inside `requestReply` so a misbehaving caller still cannot make the agent reply to its own output.

- **Visibility / enabled rules live in one pure module.** `core/can-send-to-agent.ts` exports `canSendToAgent({ replyAgentConfigured, lockHeld, authorKind, hasReply })` returning `{ visible, enabled, reason? }`. Both surfaces consume the same predicate: the webapp uses it to decide whether to render the button and whether to disable it; the TUI uses it to decide whether to surface the `s send to {agent}` footer hint. Conflict precedence is encoded in the predicate (`agent-card > no-reply-agent` on visibility; `already-replied > lock-held` on enabled).

- **The watcher path narrows to state observation.** `TourWatcher` still fires `annotation-changed` on `annotations.jsonl` and `reply-in-flight`/`reply-cleared` on `.reply-lock.json`. Both surfaces now treat these purely as re-render triggers; neither holds a `ReplyRunner` anymore. The watcher-driven `ReplyRunner` class is removed from `core/reply-runner.ts` (no consumers left).

- **`.reply-lock.json` single-flight (ADR 0015) is unchanged.** `tryAcquireReplyLock`'s `O_CREAT|O_EXCL` write still gates one dispatch per Tour at a time. The atomic acquire matters because two clicks on the same Tour from different browser sessions / a TUI + browser combo can now race; the lock collapses the race to one dispatched + one busy. Stale-lock self-heal still fires via the PID-liveness probe.

- **`tour pickup --json` schema is unchanged.** No new fields. Reply Annotations are still ordinary Annotations with `replies_to`. Existing CLI consumers and the main-agent's pickup parser continue to work.

- **Surface asymmetry is intentional.** Webapp puts the action in-card (next to `Reply`) because it tracks mouse input; TUI surfaces it via the global footer hint (next to `r: reply`) because it tracks keyboard input. Same verb, same keybinding, different surfacing. The PRD's three-axis cue treatment (muted on peer cards, bright on focused card) applies only to the webapp; the TUI's single-line muted footer doesn't have a per-card emphasis slot.

- **One-shot terminal.** Once a Reply lands on an Annotation, the `Send to {agent}` affordance disappears for that parent. To continue the Thread, the user writes a human Reply pushing back and presses `s` on their Reply. No re-request on the same Annotation; no batch / "request reply on all" affordance.

- **The asymmetric failure mode flips.** Under the implicit model, the default outcome was silent over-dispatch (real money on every unintended dispatch). Under the explicit model, the default outcome is silent under-dispatch (zero financial cost; the user just doesn't get a reply when they didn't ask). This matches the "fail safe, not loud" direction.

- **Reversibility.** The flip preserves every other piece of the conversation model. Reverting to implicit dispatch (or adding a `--auto-reply` flag layered on top) is a small re-add of the `ReplyRunner` wiring inside `getOrCreateWatcher` — no schema changes, no migration of existing Tours. The data model is identical across the two models.
