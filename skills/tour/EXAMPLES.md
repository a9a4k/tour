# Tour Examples

Worked examples through the lead-with-claim + un-evaluable rule.

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
