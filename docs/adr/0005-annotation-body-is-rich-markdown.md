# Annotation body is GitHub Flavored Markdown, rendered rich in the webapp

The annotation `body` is treated as GitHub Flavored Markdown with no raw HTML. The webapp renders it rich — headings, lists, tables, fenced code blocks (shiki-highlighted with the same `github-dark-default` theme as the diff), and ` ```mermaid ` fences as SVG diagrams. The TUI shows the raw markdown source unchanged. The on-disk shape is still a single `body` string — no `format` field, no `kind` enum.

This honours how agents already author annotations. `AGENTS.md` biases agents toward "Mermaid diagrams, tables, dependency maps" as preferred explanations, and existing annotations in `.tour/` already use `**bold**`, fenced code, and unicode arrows. The webapp was throwing that intent away by rendering body as plain text.

## Considered Options

- **CommonMark only.** Rejected: agents trained on GitHub assume GFM features (tables, autolinks, task lists). Tables in particular are useful for before/after notes.
- **Allow raw HTML pass-through with a sanitizer allow-list.** Rejected: agents don't need it — markdown + `mermaid` fences cover the embed cases — and it widens the security surface of a JSONL file that could be edited externally.
- **MDX / JSX-in-markdown.** Rejected: overkill; pulls a JSX parser into a free-form text field for no concrete use case.
- **Pre-bundle mermaid.** Rejected: mermaid is ~1MB; most annotations have no diagram. Lazy-loaded on first occurrence via dynamic import.
- **Render mermaid in the TUI as ASCII art.** Rejected: no maintained library handles the breadth of mermaid syntax; the depth-of-pain is not justified. TUI shows raw source instead.
- **Add a `format` field to the annotation schema.** Rejected: single string field keeps the on-disk shape minimal; the webapp's interpretation of the body is a renderer choice, not a data-model choice.

## Consequences

- The two renderers diverge by design. The webapp interprets the body as GFM; the TUI shows it raw. The contract is "the body is markdown" — what each surface does with it is the surface's call.
- Mermaid render failures surface a "⚠ mermaid render failed" header with the raw fence underneath, so the human reading the tour can see what the agent intended even when syntax is off.
- Mermaid runs with `securityLevel: 'strict'`, matching the no-raw-HTML policy. `click` handlers and HTML labels are blocked.
- Code-fence syntax highlighting reuses shiki (already loaded by Pierre for the diff). Annotation code blocks share the `github-dark-default` theme with the diff above them — no visual mismatch.
- Updating the annotation contract is "hard to reverse": once agents widely produce rich markdown and mermaid, backing out makes existing tours render badly. The CLI accepts any string today, so this decision is webapp-renderer-only and does not constrain future authoring tools.
