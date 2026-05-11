## Unreleased — v2.0.0

### Breaking changes

- **Bare `tour` picks the best surface for your environment.** Previously,
  `tour` (no subcommand) always launched the TUI. It now launches the
  webapp when a browser is reachable (desktop linux/darwin with a TTY,
  `open` or `xdg-open` on PATH, no SSH session) and falls back to the
  TUI otherwise (ssh, piped/non-TTY stdout, windows, no opener). Explicit
  `tour tui` and `tour serve` are unchanged. The first-run banner (no
  tours present) still prints unchanged.

  The deciding criterion is annotation fidelity: the webapp renders
  markdown + mermaid, the TUI shows raw source. New users on a desktop
  now get the higher-fidelity surface by default.

  Issue: #175 · PRD: #174
