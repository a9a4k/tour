# CLI-first, not MCP-first

The original framing was "build it for MCP." We pivoted to a CLI-first design: agents drive the system by shelling out (`review create`, `review annotate`, …) with `--json` output. MCP is deferred and would be a thin wrapper over the CLI if added later.

## Considered Options

- **MCP-first** — typed tool calls for MCP-aware clients; requires a server lifecycle, per-client config, and a parallel CLI for human use. Rejected because it doesn't expand reach (Claude Code, Codex, Cursor, CI all shell out happily) and forces us to build two surfaces.
- **CLI-first, MCP wrapper on day one** — adds the wrapper proactively. Rejected as premature; we have no concrete MCP-only client to serve.

## Consequences

- Universal reach: any agent that can shell out can drive the tool, including ones that don't speak MCP.
- One surface, used by both agents and humans. The CLI's `--json` output is the agent contract; the human-facing output is just unflagged.
- If a specifically MCP-only client appears later, the wrapper is mechanical — call the CLI, parse JSON, return.
- Both reference projects (`Backlog.md`, `hunk`) made the same call, which is non-trivial signal.
