# Bare `tour` smart-defaults to webapp; does not auto-open browser

The bare `tour` command (no subcommand) picks the best surface for the current environment — webapp when a browser is reachable, TUI otherwise — and starts that surface without auto-opening the user's browser. The previous default (v1: bare `tour` → TUI, no surface selection) is gone.

## Considered Options

- **Always TUI** (v1 status quo) — Conservative and fast, but every new user lands on the lower-fidelity surface. The TUI shows annotation bodies as raw markdown source while the webapp renders them (including ` ```mermaid ` fences as SVG; ADR 0005). For an audience whose primary value is annotation content quality, defaulting to the lower-fidelity surface inverts the priority.
- **Always webapp** — Maximises annotation fidelity but breaks for `ssh` users (no port-forwarding setup), headless containers, piped output, and `win32` (no wired browser-opener today). Forces a port allocation and a server process when neither is wanted.
- **Always webapp + auto-open** — The first v2 implementation. Aggressive: re-running `tour` pollutes the user's tab history and steals focus on every invocation. Conventional CLI tools (`vite`, `next dev`, `gh`, `ngrok`, `stripe`, `http-server`) print the URL and offer an opt-in `--open`. Tour matches that convention.
- **Smart-default + no auto-open** (selected) — `tour` picks the highest-fidelity surface the environment supports (webapp when `process.platform ∈ {darwin, linux}`, `process.stdout.isTTY === true`, `SSH_TTY`/`SSH_CONNECTION` unset, and `open`/`xdg-open` reachable; TUI otherwise) and prints the URL without spawning the browser. Users who want the browser launched explicitly run `tour serve --open`.

## Consequences

- **Pure decision module.** The branching rule lives in `src/core/surface-picker.ts` as a pure function over an env shape; the glue in `src/main.ts` collects real env and dispatches. Future heuristics (Windows opener, headless-container detection, Wayland edge cases) land in the module without touching callers.
- **`tour tui` and `tour serve` are unchanged.** Explicit subcommands keep their existing semantics; the smart-default only applies to the bare command. `tour serve --open` is the explicit auto-open path.
- **Modern terminals make URLs Cmd/Ctrl-clickable.** The cost of "print URL, you click" is ~0.5s on iTerm2, Terminal.app, Alacritty, kitty, wezterm, Ghostty — near-zero, and intentional (Cmd+Click is consent).
- **First-run banner is unchanged.** When no tours exist, the banner still prints — it teaches the create + open flow before any surface is chosen.
- **No `--no-open` flag.** Two flags doing inverse things is the bad version; explicit `tour serve --open` opts into auto-open instead.
- **Breaking change shipped in v2.0.0.** CHANGELOG documents the behaviour shift; pre-existing scripts that relied on bare `tour` launching the TUI run `tour tui` explicitly.
