# Tour Examples

Worked examples for the three phases.

## Example 1 — Narrative refactor tour

Context: user has refactored a function. Wants a narrative tour for a teammate.

```sh
TOUR_ID=$(tour create --head HEAD --title "Extract validation into its own module" --json | jq -r .id)

cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/validate.ts","side":"additions","line_start":1,"line_end":3,"body":"## Setup\n\nThis PR extracts the inline validation logic from `process.ts` into its own module so we can unit-test it without dragging in the file-I/O of the parent.\n\nNothing about the validation rules themselves changes."}
{"file":"src/validate.ts","side":"additions","line_start":12,"line_end":24,"body":"## The validator\n\nThis is the function that lived inline in `process.ts` until this PR. Behaviour is unchanged — same inputs, same outputs, same error shapes. Only the location moved."}
{"file":"src/process.ts","side":"deletions","line_start":40,"line_end":52,"body":"## The hole this leaves\n\nThe deleted block is exactly what's now in `validate.ts:12-24`. `process.ts` calls it via import."}
{"file":"src/process.ts","side":"additions","line_start":40,"body":"## The call site\n\nReplaces the deleted block with a one-line call. Reading order: this file's section is the *outcome*; `validate.ts` is *what got extracted*."}
JSONL

tour serve --open "$TOUR_ID" --reply-agent claude &
```

Four annotations as narrative beats: setup → what moved → what was left → what replaced it. No "as discussed in #142"; no "obviously".

## Example 2 — Findings batch from an external reviewer

Context: a security scan produced a list of issues. Convert to Tour for the human to triage.

```sh
TOUR_ID=$(tour create --head HEAD --title "Security scan findings — review" --json | jq -r .id)

# Findings from your scan tool, transformed to Tour JSONL
cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/auth.ts","side":"additions","line_start":34,"body":"**[high]** Unparameterised SQL. `user_id` is interpolated directly into the query string. Replace with a parameterised statement (`db.query(sql, [user_id])`)."}
{"file":"src/auth.ts","side":"additions","line_start":67,"body":"**[medium]** Password compared with `==` rather than a constant-time compare. Use `crypto.timingSafeEqual()` to avoid timing-attack surface."}
{"file":"src/session.ts","side":"additions","line_start":12,"body":"**[low]** Session token has no expiration. Add an `expires_at` and refuse expired tokens at read."}
JSONL

tour serve --open "$TOUR_ID" --reply-agent claude &
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
echo '{"file":"src/validate.ts","side":"additions","line_start":12,"replies_to":"ann_root_01","body":"Fair question — exporting from `process.ts` would have worked, but it means `process.ts` stays the dependency hub for any test that wants to validate. Pulling validation into its own module lets validation tests skip the file-I/O setup. Trade-off: one more file in the tree."}' \
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
