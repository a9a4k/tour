# Tour Reference

## JSONL comment schema

Each line of input to `tour comment <id> --batch -` is a JSON object:

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | string | yes | Path relative to repo root, as it appears in the diff |
| `side` | `"additions"` \| `"deletions"` | yes | Which half of the diff; see decision rule below |
| `line_start` | int | yes | File-line number on that side at the pinned SHA |
| `line_end` | int | no | Inclusive end; defaults to `line_start` |
| `body` | string | yes | GitHub-Flavored Markdown; no raw HTML; ` ```mermaid ` fences render as diagrams in the webapp |
| `replies_to` | string | no | If set, this comment is a Reply on the given parent comment id; inherits parent's anchor |
| `author` | string | no | Display string; defaults to the `author_kind` literal (`"agent"`) |
| `author_kind` | `"agent"` \| `"human"` | no | Defaults to `"agent"` for CLI invocations |

### Side decision rule

- Comment is about a **new** line (the `+` side in unified view) → `"additions"`
- Comment is about a **deleted** line (the `-` side) → `"deletions"`
- For unchanged context rows visible in both columns, follow the column the comment is *about*

### Anchor validation

Anchors are validated at write time. A typo in `file` or an out-of-range line is rejected with a clear error. Always run `tour show <id> --json` after a batch to confirm all comments landed.

## CLI surface

```
tour                                                                                # opens best surface for env (v2.0.0+); when no id, pre-picks most-recent open tour and prints its deep URL
tour create --head <ref> [--base <ref>] [--title <s>] [--json]
tour comment <id> --file <f> --side additions|deletions --line <n[-m]> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
tour comment <id> --reply-to <ann-id> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
tour comment <id> --batch - [--json]                                                # JSONL on stdin   (alias: annotate)
tour list [--status open|closed|all] [--json]
tour show <id> [--json]
tour pickup <id> [--json]
tour close <id>
tour delete <id>
tour prune --older-than 30d
tour tui [<id>] [--reply-agent <name>]
tour serve [--port 8687] [--open] [<id>] [--reply-agent <name>]                     # when no <id>, pre-picks most-recent open tour and includes it in the printed URL
```

### Head magic values

- `--head HEAD` — latest commit
- `--head WIP` — synthetic snapshot of the working tree (uncommitted work)
- `--head <sha>` — specific commit

## Reply-agent selection

`--reply-agent <name>` on `tour serve` or `tour tui` enables the per-card "Send to {agent}" affordance: each human comment gets a Send button (webapp) / `s` keybinding (TUI) the human can press to explicitly dispatch the reply-agent on that one comment. Without it, the Send affordance is hidden entirely — human comments are still saved and flow to the main-agent at `tour pickup` time, but there is no in-Tour reply-agent path.

Dispatch is always explicit; pressing `s` / clicking Send is the only trigger. New human comments never auto-dispatch.

Shipped registry:

| Name | Inner CLI |
|---|---|
| `claude` | Claude Code (`claude --print`) |
| `codex` | OpenAI Codex CLI |
| `gemini` | Gemini CLI |
| `opencode` | OpenCode |
| `pi` | Pi |

**Rule:** pass `--reply-agent <name>` only when you can **confidently self-identify** as one of the shipped CLIs. Claude Code → `claude`, Codex → `codex`, Gemini CLI → `gemini`, OpenCode → `opencode`, Pi → `pi`.

If you can't confidently self-identify (you're running inside Cursor, Windsurf, Aider, Continue, Augment, or another wrapper that uses a shipped CLI under the hood without exposing its name), **drop the flag entirely**. Don't guess — defaulting to `claude` when the user might have `codex` or `gemini` installed is surprising and invasive.

When `--reply-agent` is unset, Tour v2.0.0+ auto-detects shipped CLIs on the user's `PATH` and prints a one-line tip after server startup:

```
Tip: detected 'claude' on PATH. Run with --reply-agent claude to enable agent replies.
```

The user reads the tip and reruns with the right name. Zero or multiple shipped CLIs detected → tip stays silent; the user can still review the tour as a static walkthrough.

`assertShippedAgent` hard-fails at startup if `--reply-agent <name>` is wrong or the inner CLI isn't installed, listing the available names in the error. Surface that error to the user with the install hint — don't silently retry without the flag.

## Pickup output shape

```typescript
{
  id: string,
  title?: string,
  head_sha: string,
  base_sha: string,
  head_source: string,            // human-readable: "HEAD", "WIP", "abc123"
  base_source: string,
  status: "open" | "closed",
  comments: PickupComment[]
}

PickupComment = Comment & { replies: Comment[] }

Comment = {
  id: string,
  file: string,
  side: "additions" | "deletions",
  line_start: number,
  line_end: number,
  body: string,
  author: string,
  author_kind: "agent" | "human",
  replies_to?: string,
  created_at: string
}
```

## Edge cases

### Author-name collision

If you set `--author claude` (custom override matching an adapter name), your comments become indistinguishable from the `claude` reply-agent's responses in pickup output. Don't override `--author` to match a registry name. Leave it default (`"agent"`) or use a name outside the registry.

### Snapshot lost

If the working-tree snapshot (Tour created with `--head WIP`) gets garbage-collected by git, the renderer shows a snapshot-lost banner. Tours pinned to real commits are immune.

### Webapp port collision

`tour serve` defaults to port 8687 and auto-falls-back to the next free port on collision. No agent handling needed.

### Headless / SSH / CI

The canonical flow is `tour serve <id> --reply-agent <name> &` — no `--open`. The server starts and prints a deep URL to stdout. In headless / SSH / CI contexts the user reads the URL from the terminal and opens it in a browser they can reach (a forwarded port, a remote desktop session, copy-paste to a local machine). Don't fall back to `--open`; auto-opening a browser process in a headless environment fails silently or noisily depending on the platform.

### Reply schema validation

Reply comments (with `replies_to` set) still require `file`, `side`, and `line_start` for write-time validation — the planner uses them as a sanity check against the parent's anchor. Pass the parent's anchor verbatim.

## See also

- `tour --help` — current CLI surface (canonical when this doc drifts)
- `CONTEXT.md` in the Tour repo — full domain glossary
