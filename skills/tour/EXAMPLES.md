# Tour Examples

Worked examples for the three phases.

## Example 1 — Narrative refactor tour

Context: user has refactored a function. Wants a narrative tour for a teammate.

```sh
TOUR_ID=$(tour create --head HEAD --title "Extract validation into its own module")

cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/validate.ts","side":"additions","line_start":1,"line_end":3,"body":"## Setup\n\nExtracts inline validation from `process.ts` into its own module. Lets us unit-test validation without `process.ts`'s file-I/O. No rule changes."}
{"file":"src/validate.ts","side":"additions","line_start":12,"line_end":24,"body":"## The validator\n\nThe function that lived inline in `process.ts`. Same inputs, outputs, error shapes — only location moved."}
{"file":"src/process.ts","side":"deletions","line_start":40,"line_end":52,"body":"## The hole this leaves\n\nThe deleted block is now in `validate.ts:12-24`, called via import."}
{"file":"src/process.ts","side":"additions","line_start":40,"body":"## The call site\n\nReplaces the deleted block with a one-line call. Reading order: this file is the *outcome*; `validate.ts` is *what moved*."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

Four annotations as narrative beats: setup → what moved → what was left → what replaced it. No "as discussed in #142"; no "obviously".

## Example 2 — Findings batch from an external reviewer

Context: a security scan produced a list of issues. Convert to Tour for the human to triage.

```sh
TOUR_ID=$(tour create --head HEAD --title "Security scan findings")

# Findings from your scan tool, transformed to Tour JSONL
cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/auth.ts","side":"additions","line_start":34,"body":"**[high]** Unparameterised SQL. `user_id` is interpolated directly into the query string. Replace with a parameterised statement (`db.query(sql, [user_id])`)."}
{"file":"src/auth.ts","side":"additions","line_start":67,"body":"**[medium]** Password compared with `==` rather than a constant-time compare. Use `crypto.timingSafeEqual()` to avoid timing-attack surface."}
{"file":"src/session.ts","side":"additions","line_start":12,"body":"**[low]** Session token has no expiration. Add an `expires_at` and refuse expired tokens at read."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

Findings style — no narrative arc. Each annotation stands alone. Severity labels in the body help the human triage.

## Example 3 — Pickup → reply

Context: the human replied on an annotation. User asks "what did Almas say on the tour, and respond".

```sh
tour pickup "$TOUR_ID" --json
```

Abridged output:

```json
{
  "id": "ann_a7c4",
  "annotations": [
    {
      "id": "ann_root_01",
      "file": "src/validate.ts",
      "line_start": 12,
      "body": "## The validator\n\nThis is the function that lived inline...",
      "author": "agent",
      "author_kind": "agent",
      "replies": [
        {
          "id": "ann_reply_01",
          "body": "Why didn't we keep this in `process.ts` and just export it?",
          "author": "almas",
          "author_kind": "human"
        }
      ]
    }
  ]
}
```

The human asked a clarification question. Decision: reply in prose, no code change. Write the reply:

```sh
echo '{"file":"src/validate.ts","side":"additions","line_start":12,"replies_to":"ann_root_01","body":"Exporting from `process.ts` would have worked, but it stays the dependency hub for any validation test. Pulling out lets tests skip the file-I/O setup. Trade-off: one more file."}' \
  | tour annotate "$TOUR_ID" --batch -
```

The reply inherits the parent's anchor via `replies_to`. The webapp slots it into the thread.

## Example 4 — Pickup → code change

Context: the human's reply was "this loop is O(n²); use a Map." Action required, not just words.

```sh
tour pickup "$TOUR_ID" --json   # confirm the request
```

Identify the file/lines and make the code change through your normal file-editing tools — Tour doesn't edit code itself. Then close the loop with a reply documenting the fix:

```sh
echo '{"file":"src/foo.ts","side":"additions","line_start":40,"replies_to":"ann_xxx","body":"Done in commit abc123. Replaced the nested loop with a `Map<id, item>` lookup. O(n) now."}' \
  | tour annotate "$TOUR_ID" --batch -
```

The reply lives in the Tour; the actual change lives in your commit history. The Tour is now ready for the human to re-read or close.

## Example 5 — Rich GFM body (table + lists + code)

Context: agent walks through a config schema rename. Compact body with table, bullet list, and inline code — all render natively in the webapp.

```sh
TOUR_ID=$(tour create --head HEAD --title "Migrate config from flat to namespaced keys")

cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/config.ts","side":"additions","line_start":1,"line_end":12,"body":"## Schema rename\n\n| Before | After |\n|---|---|\n| `timeout` | `network.timeout_ms` |\n| `retries` | `network.retries` |\n| `cache_size` | `cache.max_entries` |\n\n**Why namespace:** flat keys had started to collide — `timeout` meant two different things in different code paths. Namespacing makes ownership obvious and prevents future collisions.\n\n**One-way migration:** old keys are not read after this PR. The bottom-of-file `migrateLegacyConfig` helper converts on-disk configs once; remove it after one release."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

One annotation, four GFM elements (heading, table, bold, inline code). The webapp renders all four; the TUI shows the same as raw markdown source.

## Example 6 — Mermaid body (sequence diagram)

Context: agent introduces a background refresh queue. A diagram lands the flow faster than a paragraph would.

```sh
TOUR_ID=$(tour create --head HEAD --title "Add background refresh queue")

cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/queue.ts","side":"additions","line_start":1,"line_end":3,"body":"## Refresh pipeline\n\nThis PR adds a background queue so stale items refresh without blocking the request path.\n\n```mermaid\nsequenceDiagram\n    Client->>API: GET /resource\n    API->>Cache: lookup\n    Cache-->>API: hit (possibly stale)\n    API-->>Client: response (fast path)\n    Note over API,Queue: if served stale\n    API->>Queue: enqueue refresh\n    Queue->>Source: fetch fresh\n    Source-->>Queue: data\n    Queue->>Cache: write\n```\n\n**Invariant:** the request path never waits on the queue. If the queue is full or the source is down, stale-served data is returned and the refresh is dropped — never the reverse."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

Mermaid fences render as diagrams in the webapp; the TUI shows them as a fenced code block (still readable, just not graphical). Reserve diagrams for control/data flow that would otherwise need multiple paragraphs — overuse dilutes their value.
