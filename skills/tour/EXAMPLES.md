# Tour Examples

Worked examples for the Comment rules — each one anchored, plain-language, mechanism-as-story.

## Example 1 — Narrative refactor tour

Context: user has refactored a function. Wants a narrative tour for a teammate.

```sh
TOUR_ID=$(tour create --head HEAD --title "Extract validation into its own module")

cat <<'JSONL' | tour comment "$TOUR_ID" --batch -
{"file":"src/validate.ts","side":"additions","line_start":1,"line_end":3,"body":"## Setup\n\nValidation extracted from `process.ts` — pure move, no rule changes. Tests can now skip `process.ts`'s file-I/O setup."}
{"file":"src/validate.ts","side":"additions","line_start":12,"line_end":24,"body":"## The validator\n\nLifted from `process.ts`. Same inputs, outputs, error shapes — only location moved."}
{"file":"src/process.ts","side":"deletions","line_start":40,"line_end":52,"body":"## The hole this leaves\n\nNow in `validate.ts:12-24`, called via import."}
{"file":"src/process.ts","side":"additions","line_start":40,"body":"## The call site\n\nOne-line import call replaces the deleted block."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

Four comments, each leading with a single claim. Provenance ("as discussed in #142"), adverbs ("obviously"), and reading-order hints are reply material.

## Example 2 — Findings batch from an external reviewer

Context: a security scan produced a list of issues. Convert to Tour for the human to triage.

```sh
TOUR_ID=$(tour create --head HEAD --title "Security scan findings")

cat <<'JSONL' | tour comment "$TOUR_ID" --batch -
{"file":"src/auth.ts","side":"additions","line_start":34,"body":"`[issue, security]` Unparameterised SQL — `user_id` interpolated. Use `db.query(sql, [user_id])`."}
{"file":"src/auth.ts","side":"additions","line_start":67,"body":"`[issue, security]` Non-constant-time password compare. Use `crypto.timingSafeEqual()`."}
{"file":"src/session.ts","side":"additions","line_start":12,"body":"`[suggestion]` Session token has no expiration. Add `expires_at`; reject expired at read."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

Conventional Comments labels signal intent in sentence 0, leaving sentence 1 to be pure claim.

## Example 3 — Pickup → reply

Context: the human replied on a comment. User asks "what did Almas say on the tour, and respond".

```sh
tour pickup "$TOUR_ID" --json
```

Abridged output:

```json
{
  "id": "2026-05-15-131034-29on",
  "comments": [
    {
      "id": "2026-05-15-131200-h4of",
      "file": "src/validate.ts",
      "line_start": 12,
      "body": "## The validator\n\nLifted from `process.ts`...",
      "author": "agent",
      "author_kind": "agent",
      "replies": [
        {
          "id": "2026-05-15-141022-r1pl",
          "body": "Why didn't we keep this in `process.ts` and just export it?",
          "author": "almas",
          "author_kind": "human"
        }
      ]
    }
  ]
}
```

Reply in prose (no code change required):

```sh
echo '{"file":"src/validate.ts","side":"additions","line_start":12,"replies_to":"2026-05-15-131200-h4of","body":"Exporting from `process.ts` would have worked but kept it as the dependency hub for any validation test. Pulling out lets tests skip the file-I/O setup."}' \
  | tour comment "$TOUR_ID" --batch -
```

The reply inherits the parent's anchor via `replies_to`. The webapp slots it into the thread.

## Example 4 — Pickup → code change

Context: the human's reply was "this loop is O(n²); use a Map." Action required, not just words.

```sh
tour pickup "$TOUR_ID" --json   # confirm the request
```

Make the code change through your normal file-editing tools — Tour doesn't edit code. Then reply documenting the fix:

```sh
echo '{"file":"src/foo.ts","side":"additions","line_start":40,"replies_to":"2026-05-15-131200-zq2t","body":"Done in commit abc123. Replaced nested loop with `Map<id, item>` lookup. O(n) now."}' \
  | tour comment "$TOUR_ID" --batch -
```

The reply lives in the Tour; the actual change lives in your commit history.

## Example 5 — Rich GFM body (table)

Context: config schema rename. Table + claim, nothing else.

```sh
TOUR_ID=$(tour create --head HEAD --title "Migrate config from flat to namespaced keys")

cat <<'JSONL' | tour comment "$TOUR_ID" --batch -
{"file":"src/config.ts","side":"additions","line_start":1,"line_end":12,"body":"## Schema rename — one-way migration\n\n| Before | After |\n|---|---|\n| `timeout` | `network.timeout_ms` |\n| `retries` | `network.retries` |\n| `cache_size` | `cache.max_entries` |\n\n`migrateLegacyConfig` converts on-disk configs once; remove after one release."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

The table IS the claim — enabling the reader to judge the rename. "Why namespace" rationale is reply material if asked.

## Example 6 — Mermaid body (sequence diagram)

Context: agent introduces a background refresh queue. Diagram lands the flow faster than prose.

```sh
TOUR_ID=$(tour create --head HEAD --title "Add background refresh queue")

cat <<'JSONL' | tour comment "$TOUR_ID" --batch -
{"file":"src/queue.ts","side":"additions","line_start":1,"line_end":3,"body":"## Refresh pipeline — request path never waits\n\n```mermaid\nsequenceDiagram\n    Client->>API: GET /resource\n    API->>Cache: lookup\n    Cache-->>API: hit (possibly stale)\n    API-->>Client: response (fast path)\n    Note over API,Queue: if served stale\n    API->>Queue: enqueue refresh\n    Queue->>Source: fetch fresh\n    Source-->>Queue: data\n    Queue->>Cache: write\n```\n\nIf queue is full or source is down: stale served, refresh dropped — never the reverse."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

Diagrams render in the webapp; the TUI shows them as a fenced code block. Reserve diagrams for control/data flow that would otherwise need multiple paragraphs.

## Example 7 — Multi-comment narrative for a non-trivial mechanism

Context: a queue handler was hanging on stuck external LLM calls; the fix adds a hard timeout that reuses existing retry plumbing. Tour walks the reader through five anchors, each speaking to its line.

```sh
TOUR_ID=$(tour create --head HEAD --title "Add 10-min hard timeout to thematic-analysis handler")

cat <<'JSONL' | tour comment "$TOUR_ID" --batch -
{"file":"services/insights/src/thematic-analysis.constants.ts","side":"additions","line_start":4,"line_end":14,"body":"## Why 10 minutes — it sits between two existing limits\n\nSometimes the LLM call hangs and never returns. Without a timeout, the job stays in PROCESSING and the user eventually sees \"Analysis didn't complete\" with no retry path.\n\nThis PR adds a 10-minute hard timeout via `AbortSignal.timeout`. When it fires, the LLM call rejects with an abort error. Our existing error handler recognises it as retryable, sets the job back to PENDING, and re-throws. Because we re-throw, SQS never gets a confirmation for the message — so after its ~20-minute visibility window, SQS redelivers the same message to another worker, which retries the job.\n\nThe 10-minute number has to fit between two real limits:\n\n`slowest successful call (~2 min)  <  hard timeout (10 min)  <  SQS visibility (~20 min)`\n\nAnything in that range works; we picked 10. No new code paths — the fix reuses existing retry plumbing."}
{"file":"packages/maze-ai/src/types.ts","side":"additions","line_start":109,"line_end":116,"body":"## The package exposes the hook; the caller composes\n\nWe added `abortSignal` to `ExecuteOptions` so any caller can opt into cancellation. The JSDoc describes a *pattern*, not a built-in helper — the actual timeout value and `AbortSignal.any([...])` composition live at the call site, not in this package.\n\nDifferent callers have different wall-clock budgets: SQS handlers fit inside the visibility window, Temporal activities respect heartbeat, HTTP handlers care about request timeout. The package can't pick one number that's right for everyone."}
{"file":"services/insights/src/handler.ts","side":"additions","line_start":58,"line_end":60,"body":"## Why `deadlineSignal` is at outer scope (not inside the try)\n\nThe catch block at the bottom of this method needs to read `deadlineSignal.aborted` when logging — so we can tell whether an abort was a worker shutdown, a deadline timeout, or both. A `let` at outer scope keeps the variable visible from the catch. A `const` inside the try would be out of scope by then.\n\nWhy \"or both\"? When we compose the signals below with `AbortSignal.any([...])`, both `.aborted` flags can end up true if the worker and the deadline fire close together. The catch logs two independent booleans so the race case is visible in monitoring; a single enum would silently pick one and hide the other."}
{"file":"services/insights/src/handler.ts","side":"additions","line_start":144,"line_end":151,"body":"## The composition — two signals merged into one\n\nTwo cancellation signals feed into `AbortSignal.any([signal, deadlineSignal])`:\n\n- `signal` (worker-level) — already exists, comes from the queue consumer. Aborts when SQS visibility expires or the worker shuts down.\n- `deadlineSignal` (new in this PR) — `AbortSignal.timeout(10min)`. Aborts strictly on wall-clock.\n\nThe combined signal aborts when either input aborts. We pass it to the LLM call; when it fires, the call rejects and the existing `handleJobError` flips the job to PENDING and re-throws.\n\nNo new control flow, no explicit re-enqueue, no UI change."}
{"file":"services/insights/src/handler.spec.ts","side":"additions","line_start":427,"line_end":434,"body":"## Vitest's fake timers can't drive `AbortSignal.timeout`\n\nThe natural way to test a 10-minute deadline is `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(LLM_HARD_TIMEOUT_MS)`. It doesn't fire the abort.\n\nWhy: `vi.useFakeTimers()` only hooks the global `setTimeout`. `AbortSignal.timeout(ms)` is built into Node natively and doesn't go through `setTimeout`, so Vitest never sees it.\n\nWorkaround (inline in the spec): replace `AbortSignal.timeout` with a stub that *does* use `setTimeout` internally — create an AbortController and call `controller.abort()` from inside a `setTimeout` callback. Now the fake timer can advance the inner `setTimeout`, which fires the abort. Deterministic."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

Five comments, each anchored at the line that motivates it. Plain language throughout; technical terms only where the identifier IS the term (`AbortSignal.any`, `PENDING`, SQS visibility). Each heading carries the claim; bodies tell the mechanism as a story without forward-referencing code elsewhere in the diff. Length matches the mechanism — Comment 4 is ~110 words because there are two signals to introduce; Comment 5 is ~115 because the test workaround needs three steps; none exceeds ~165.

Contrast with Example 1 (validation refactor): each comment there is ~25 words because the mechanism is a single move. Same rule, different length — the mechanism sets the budget.
