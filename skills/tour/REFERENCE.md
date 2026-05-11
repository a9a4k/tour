# Tour Reference

## JSONL annotation schema

Each line of input to `tour annotate <id> --batch -` is a JSON object:

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | string | yes | Path relative to repo root, as it appears in the diff |
| `side` | `"additions"` \| `"deletions"` | yes | Which half of the diff; see decision rule below |
| `line_start` | int | yes | File-line number on that side at the pinned SHA |
| `line_end` | int | no | Inclusive end; defaults to `line_start` |
| `body` | string | yes | GitHub-Flavored Markdown; no raw HTML; ` ```mermaid ` fences render as diagrams in the webapp |
| `replies_to` | string | no | If set, this annotation is a Reply on the given parent annotation id; inherits parent's anchor |
| `author` | string | no | Display string; defaults to the `author_kind` literal (`"agent"`) |
| `author_kind` | `"agent"` \| `"human"` | no | Defaults to `"agent"` for CLI invocations |

### Side decision rule

- Annotation is about a **new** line (the `+` side in unified view) → `"additions"`
- Annotation is about a **deleted** line (the `-` side) → `"deletions"`
- For unchanged context rows visible in both columns, follow the column the comment is *about*

### Anchor validation

Anchors are validated at write time. A typo in `file` or an out-of-range line is rejected with a clear error. Always run `tour show <id> --json` after a batch to confirm all annotations landed.

## CLI surface

```
tour create --head <ref> [--base <ref>] [--title <s>] [--json]
tour annotate <id> --file <f> --side additions|deletions --line <n[-m]> --body <b> [--author <a>]
tour annotate <id> --batch -                         # JSONL on stdin
tour list [--status open|closed|all] [--json]
tour show <id> [--json]
tour pickup <id> [--json]
tour close <id>
tour delete <id>
tour prune --older-than 30d
tour tui [<id>] [--reply-agent <name>]
tour serve [--port 8687] [--open] [<id>] [--reply-agent <name>]
```

### Head magic values

- `--head HEAD` — latest commit
- `--head WIP` — synthetic snapshot of the working tree (uncommitted work)
- `--head <sha>` — specific commit

## Reply-agent selection

`--reply-agent <name>` on `tour serve` or `tour tui` enables bidirectional comments. Without it, human replies are saved but no response is generated — the commenting feature appears broken to the human.

Shipped registry:

| Name | Inner CLI |
|---|---|
| `claude` | Claude Code (`claude --print`) |
| `codex` | OpenAI Codex CLI |
| `gemini` | Gemini CLI |
| `opencode` | OpenCode |
| `pi` | Pi |

Pick the name matching your own agent identity. If you can't self-identify (you're inside Cursor, Windsurf, Aider, Continue, Augment, or similar wrapper), default to `claude` — most commonly installed.

The validation hard-fails at startup with the available list if the name is wrong or the inner CLI isn't installed. Surface that error to the user with the install hint; do **not** silently drop `--reply-agent`.

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
  annotations: PickupAnnotation[]
}

PickupAnnotation = Annotation & { replies: Annotation[] }

Annotation = {
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

If you set `--author claude` (custom override matching an adapter name), your annotations become indistinguishable from the `claude` reply-agent's responses in pickup output. Don't override `--author` to match a registry name. Leave it default (`"agent"`) or use a name outside the registry.

### Snapshot lost

If the working-tree snapshot (Tour created with `--head WIP`) gets garbage-collected by git, the renderer shows a snapshot-lost banner. Tours pinned to real commits are immune.

### Webapp port collision

`tour serve` defaults to port 8687 and auto-falls-back to the next free port on collision. No agent handling needed.

### Headless / SSH / CI

`tour serve --open <id> &` starts the server but no browser opens. Tell the user the URL or skip the open in headless contexts.

### Reply schema validation

Reply annotations (with `replies_to` set) still require `file`, `side`, and `line_start` for write-time validation — the planner uses them as a sanity check against the parent's anchor. Pass the parent's anchor verbatim.

## See also

- `tour --help` — current CLI surface (canonical when this doc drifts)
- `CONTEXT.md` in the Tour repo — full domain glossary
