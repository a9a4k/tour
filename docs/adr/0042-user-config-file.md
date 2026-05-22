# User-scoped config file for `--reply-agent` and `--editor` defaults

> **Status:** Accepted — 2026-05-22. Adds a single optional TOML file at `$TOUR_HOME/config.toml` holding persistent defaults for the `--reply-agent` and `--editor` flags. Read once at `main.ts` entry; values feed the existing resolution chains as one new layer. New read-only subcommand `tour config show` inspects the resolved values and their sources. No write surface — users hand-edit. Complements ADR 0032 (editor resolution chain) and ADR 0039 (storage in `$TOUR_HOME`).

## Why

Two flags persist between invocations for almost every user: `--reply-agent <name>` (which agent backs `R` / Request reply) and `--editor <cmd>` (which editor `o` spawns). Today the only persistence story is environment variables — and only `--editor` has one (`$TOUR_EDITOR`, ADR 0032). `--reply-agent` has no persistence at all; users retype it on every `tour serve` / `tour tui`.

Field evidence: every Tour session starts with the same two flags, or with no flags and the wrong defaults. The user's intent for these two knobs is session-stable; the missing piece is a place to record that intent once.

A file beats a second env var. A hypothetical `$TOUR_REPLY_AGENT` would solve the typing tax but only inside a single shell — GUI launches (browser opened from Finder), cron, and direnv-less workflows still wouldn't pick it up. A file in `$TOUR_HOME` survives every launch context and matches the existing storage shape ADR 0039 pinned.

## Considered Options

- **Status quo: keep retyping `--reply-agent` on every invocation; rely on `$TOUR_EDITOR` for editor.** Rejected: the typing tax is real and asymmetric — there's no persistence story for `--reply-agent` at all.

- **Add `$TOUR_REPLY_AGENT` env var, no file.** Rejected: solves a smaller problem (per-shell, not per-machine), and there's no pre-existing `$AGENT` / `$REPLY_AGENT` shell convention for `$TOUR_REPLY_AGENT` to compose with or override — unlike `$TOUR_EDITOR`, which slots above the well-established `$VISUAL` / `$EDITOR` chain. A lone Tour-only env var with no convention to anchor against is dominated by the CLI flag for every realistic use case.

- **Per-repo config file** at `$TOUR_HOME/<repo-key>/config.toml`. Deferred. Two scalars don't yet justify a layered resolver, and the user-scoped layer covers the dominant "same tools across all my repos" case. The user → repo direction is a pure additive change to the resolver if asked for later; the reverse (ship repo-scoped, add user-scoped) is the less-common shape.

- **Repo-tracked config** (e.g. `<repo>/.tour-config.toml`). Rejected: violates ADR 0039's "the repo is never touched" stance. Re-opens the auto-commit race the ADR-0039 move closed.

- **XDG config home** (`~/.config/tour/config.toml`). Rejected: `$TOUR_HOME` is already the canonical user-scoped knob (ADR 0039); a second home would split the surface.

- **`tour config set/get` writers.** Rejected for slice 1. `smol-toml` doesn't preserve comments on round-trip, so a writer either silently strips user comments or ships a constrained writer that only knows the current key set. Two scalars hand-edit fine; a `set` verb is an additive future change if growth demands.

- **Validate `reply_agent` at config load.** Rejected: would break unrelated commands (`tour create`, `tour list`) for a value those commands never read. The existing `assertShippedAgent` chokepoint in `tui.ts` / `serve.ts` already fires at the right moment; the config layer just feeds it.

## Decisions

### Location and shape

- **Path:** `$TOUR_HOME/config.toml`. Single user-scoped file. Optional — missing file is the documented happy path for any user who only uses CLI flags or env vars.
- **Format:** TOML, parsed via `smol-toml` (already in the tree for `tour.toml`).
- **Schema:** flat — keys at the file root, no `[section]` headers. Current keys: `reply_agent` (string) and `editor` (string). Adding a third scalar later is a one-line schema change; promoting to sections is an additive migration with no breakage.

```toml
# ~/.tour/config.toml
reply_agent = "claude"
editor      = "code -g {file}:{line}"
```

### Resolution chains

The config file is **one new layer** in each flag's resolution chain, not a replacement:

- **Reply-agent:** `--reply-agent` flag → `config.reply_agent` → null.
- **Editor:** `--editor` flag → `$TOUR_EDITOR` → `config.editor` → `$VISUAL` → `$EDITOR` → null.

The editor chain places config **between** the Tour-specific env (`$TOUR_EDITOR`) and the inherited shell envs (`$VISUAL`, `$EDITOR`). Two principles produce the ordering:

1. **Env beats config when the env is Tour-specific.** Matches the git convention (`GIT_EDITOR` overrides `core.editor`). A user who exports `TOUR_EDITOR=vim` for one terminal expects it to win over the persisted default — that's exactly what env vars are for.
2. **Config beats env when the env is not Tour-specific.** `$VISUAL` / `$EDITOR` were set for git, `crontab`, `visudo`, anything. If the user explicitly told Tour "use Cursor" in `config.toml`, an ambient `$EDITOR=vim` from their shell rc should not silently win.

Threading: `main.ts` calls `loadUserConfig(tourHome)` once before the verb switch; the result is passed into `resolveEditor(flag, env, configEditor)` (existing pure module from ADR 0032, signature extended by one optional arg) and inlined alongside `flag(flags, "reply-agent")` for the reply-agent surfaces (`tui.ts`, `serve.ts`).

### Loader strictness

- **Malformed TOML:** throw with the file path in the error. Every command fails until the file is fixed or removed. Silent ignore would make defaults "mysteriously stop working" with no diagnostic — strictly worse.
- **Unknown keys:** throw with the bad key and the valid-keys list. The file has two known keys; an unknown key is virtually always a typo (`editorr`, `replyagent`). Liberal ignore turns a typo into a silent default and wastes the user's debugging time.
- **Bad value** (e.g. `reply_agent = "made-up"`): pass through to the existing `assertShippedAgent` chokepoint in `tui.ts` / `serve.ts`. The error message there gains a `(from <config-path>)` suffix when the value originated in the config file.

The asymmetry between "unknown key" (load-time fail) and "bad value" (chokepoint fail) is intentional: structural problems with the file are always wrong; semantic problems are only wrong when the value is actually consumed.

### `tour config show` — read-only inspection

A single new subcommand prints the resolved state with provenance per key:

```
$ tour config show
Config file: /Users/almas/.tour/config.toml (exists)

reply_agent  = "claude"                    (from config)
editor       = "code -g {file}:{line}"     (from $TOUR_EDITOR)
```

Sources per key: `config`, `$TOUR_EDITOR`, `$VISUAL`, `$EDITOR`, or `default` (null). `show` takes no flags — its job is "what would Tour pick with no flags?" not "simulate a hypothetical flag combination."

`show` is the **one command that survives a malformed config file**: catches the load error and renders `Config file: <path> (UNREADABLE: <error>)`, then prints env-resolved values for keys whose chain doesn't depend on the broken file. Every other command still hard-fails per the loader strictness rule above. The asymmetry is honest — `show` exists to diagnose the resolver, so it makes sense for it to be more tolerant than commands that consume the resolver.

### Discoverability

- **`tour --help`:** add the `tour config show` line to USAGE and a short "Defaults:" block at the bottom that prints the precedence chain in plain English. Lands an existing gap too — the current USAGE doesn't document `$TOUR_EDITOR` either.
- **First-run banner** (`firstRunBanner` in `src/main.ts`): one new line next to the existing "Tours live at" line — `Defaults at: ~/.tour/config.toml (optional; run \`tour config show\`)`.
- **No auto-creation.** Tour does not write an empty `config.toml` on first run; the missing file is the documented happy path.

## Consequences

- **One typed identifier instead of two on every launch.** `tour serve` and `tour tui` start with the right agent and the right editor with no flags. The CLI flag still wins for one-off overrides.
- **The `$TOUR_EDITOR` env-var users keep working unchanged.** Their existing setup beats the new config layer; no migration.
- **Reply-agent gains a persistence story for the first time.** Before this ADR, every `tour serve` / `tour tui` invocation either typed the flag or got no reply-agent at all.
- **Config-load is a new failure point in `main.ts`.** A malformed file fails *every* command (including `tour list`, `tour create`). The user fixes the file once; the alternative — silent ignore — costs more in support load than the brief inconvenience of a loud failure.
- **`tour config show` is the diagnostic surface for the new resolution chain.** Without it, debugging "why is Tour picking vim?" means bisecting against the chain with `unset` / `mv` gestures. With it, one command answers the question.
- **No round-trip writer means user-formatted files are safe.** Comments, blank lines, and ordering survive Tour-side reads. If `set` / `get` is ever added, that decision will need to take the comment-preservation question seriously.

## Small contracts pinned

- **The file is optional.** Missing file → empty config → resolver behaves exactly as it did before this ADR. Users who only use CLI flags or env vars are unaffected.
- **Schema is flat for now.** Adding a `[section]` header later requires reading both shapes; the migration cost is small and additive. Sectioning *now* would carry no benefit (two scalars).
- **No `$TOUR_REPLY_AGENT`.** The asymmetry with `$TOUR_EDITOR` is deliberate (no shell-env convention to compose with). If field evidence ever shows users want it, the addition is three lines in the resolver — same easy reversibility as user → repo scope.
- **Config provenance leaks into the bad-agent error message.** `assertShippedAgent` gains a `(from <path>)` suffix when the value came from the config file. Without that breadcrumb, the user sees the same error whether the bad name came from `--reply-agent`, the config, or a future env var — three different files to inspect.
- **`tour config show` takes no flags.** No `--editor` / `--reply-agent` overrides at the inspector. The job is "what would Tour use given the current environment and file," not "simulate." This keeps the implementation small and the output unambiguous.
