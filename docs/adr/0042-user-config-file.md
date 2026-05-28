# User-scoped config file for `--reply-agent` and `--editor` defaults

> **Status:** Accepted — 2026-05-22. Adds a single TOML file at `$TOUR_HOME/config.toml` holding persistent defaults for the `--reply-agent` and `--editor` flags. Explicit `tour tui` and `tour serve` auto-create it with commented examples on first launch; values feed the existing resolution chains as one new layer. New read-only subcommand `tour config show` inspects the resolved values and their sources without auto-creating the file. No mutation surface after seeding — users hand-edit. Complements ADR 0032 (editor resolution chain) and ADR 0039 (storage in `$TOUR_HOME`).
>
> **Amended 2026-05-28:** ADR 0044 changes `reply_agent` from a shipped-agent name to a command template and validates it at config load. Bare names now fail with inline migration examples.
>
> **Amended 2026-05-28:** Issue #469 reverses the original "no auto-creation" decision for explicit launch surfaces only. `tour tui` and `tour serve` seed `$TOUR_HOME/config.toml` via temp-file + rename when it is missing, warn and continue with empty config when seeding fails, and never rewrite an existing file. Bare `tour` may read an existing config for its smart-default launch, but it does not seed a missing file. Read-only / one-shot verbs and `tour config show` do not load the seeding path.

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

- **Validate shipped-agent names at config load.** Rejected in the original name-based design because unrelated commands did not consume the value. Superseded by ADR 0044: `reply_agent` is now a command template and is validated at config load so placeholder typos and bare-name migrations fail early.

## Decisions

### Location and shape

- **Path:** `$TOUR_HOME/config.toml`. Single user-scoped file. Missing file remains honest for diagnostics, but explicit `tour tui` / `tour serve` create it on first launch from the canonical commented seed template.
- **Format:** TOML, parsed via `smol-toml` (already in the tree for `tour.toml`).
- **Schema:** flat — keys at the file root, no `[section]` headers. Current keys: `reply_agent` (string), `editor` (string), and `editor_terminal` (boolean, default false). Adding another scalar later is a one-line schema change; promoting to sections is an additive migration with no breakage.

```toml
# ~/.tour/config.toml
reply_agent = "claude --print --system-prompt {systemPrompt} {userPrompt}"
editor      = "code -g {file}:{line}"
editor_terminal = false
```

### Resolution chains

The config file is **one new layer** in each flag's resolution chain, not a replacement:

- **Reply-agent:** `--reply-agent` flag → `config.reply_agent` → null.
- **Editor:** `--editor` flag → `$TOUR_EDITOR` → `config.editor` → `$VISUAL` → `$EDITOR` → null.

The editor chain places config **between** the Tour-specific env (`$TOUR_EDITOR`) and the inherited shell envs (`$VISUAL`, `$EDITOR`). Two principles produce the ordering:

1. **Env beats config when the env is Tour-specific.** Matches the git convention (`GIT_EDITOR` overrides `core.editor`). A user who exports `TOUR_EDITOR=vim` for one terminal expects it to win over the persisted default — that's exactly what env vars are for.
2. **Config beats env when the env is not Tour-specific.** `$VISUAL` / `$EDITOR` were set for git, `crontab`, `visudo`, anything. If the user explicitly told Tour "use Cursor" in `config.toml`, an ambient `$EDITOR=vim` from their shell rc should not silently win.

Threading: `main.ts` calls `loadUserConfig(tourHome)` with seeding enabled only inside explicit `tui` and `serve` branches. Bare `tour` keeps its smart-default behavior by reading an existing config with seeding disabled after it knows there is a Tour to open. The result is passed into `resolveEditor(flag, env, configEditor)` (existing pure module from ADR 0032, signature extended by one optional arg) and inlined alongside `flag(flags, "reply-agent")` for the reply-agent surfaces (`tui.ts`, `serve.ts`). `tour list`, `tour create`, `tour comment`, `tour show`, `tour close`, `tour delete`, `tour prune`, `tour pickup`, `tour --help`, `tour --version`, and `tour config show` do not trigger config auto-creation.

### Auto-creation

On explicit `tour tui` or `tour serve`, a missing config file is seeded with commented editor and reply-agent examples. The seed is written to a unique temp file under `$TOUR_HOME` and then renamed to `config.toml`, so concurrent first launches leave a complete file on disk. If two first launches race, the later rename overwrites the earlier seed with byte-identical contents. Existing `config.toml` files are read as-is and are never rewritten, preserving comments, blank lines, and key ordering.

If seeding fails (permission denied, full disk, read-only `$TOUR_HOME`), Tour writes a stderr warning naming the path and underlying error, then proceeds with empty config. A first launch must not fail only because the optional defaults file could not be created.

### Loader strictness

- **Malformed TOML:** throw with the file path in the error. Every command fails until the file is fixed or removed. Silent ignore would make defaults "mysteriously stop working" with no diagnostic — strictly worse.
- **Unknown keys:** throw with the bad key and the valid-keys list. The file has two known keys; an unknown key is virtually always a typo (`editorr`, `replyagent`). Liberal ignore turns a typo into a silent default and wastes the user's debugging time.
- **Bad value**: reply-agent template validation now rejects empty templates, unknown placeholders, and bare-name values with the config path and migration examples (ADR 0044).

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

`show` is the **diagnostic command that never seeds**: if the file is absent, it renders `Config file: <path> (does not exist)`. If the file is malformed, it catches the load error and renders `Config file: <path> (UNREADABLE: <error>)`, then prints env-resolved values for keys whose chain doesn't depend on the broken file. Commands that consume config (`tour tui`, `tour serve`) still hard-fail on malformed existing files per the loader strictness rule above.

### Discoverability

- **`tour --help`:** add the `tour config show` line to USAGE and a short "Defaults:" block at the bottom that prints the precedence chain in plain English. Lands an existing gap too — the current USAGE doesn't document `$TOUR_EDITOR` either.
- **First-run banner** (`firstRunBanner` in `src/main.ts`): one line next to the existing "Tours live at" line names the config path and says it is auto-created by explicit `tour tui` / `tour serve`.

## Consequences

- **One typed identifier instead of two on every launch.** `tour serve` and `tour tui` start with the right agent and the right editor with no flags. The CLI flag still wins for one-off overrides.
- **The `$TOUR_EDITOR` env-var users keep working unchanged.** Their existing setup beats the new config layer; no migration.
- **Reply-agent gains a persistence story for the first time.** Before this ADR, every `tour serve` / `tour tui` invocation either typed the flag or got no reply-agent at all.
- **Config-load is a launch-surface failure point only.** A malformed file fails `tour tui` / `tour serve`, and bare `tour` when it has an existing Tour to smart-open, where the values are consumed. Read-only / one-shot verbs do not load the file and keep their previous no-defaults behavior.
- **`tour config show` is the diagnostic surface for the new resolution chain.** Without it, debugging "why is Tour picking vim?" means bisecting against the chain with `unset` / `mv` gestures. With it, one command answers the question.
- **No round-trip writer means user-formatted files are safe.** Comments, blank lines, and ordering survive Tour-side reads. If `set` / `get` is ever added, that decision will need to take the comment-preservation question seriously.

## Small contracts pinned

- **The file is optional until a launch surface seeds it.** Missing file → empty config → resolver behaves exactly as it did before this ADR; `tour tui` / `tour serve` also create the commented seed for user discovery. Users who only use CLI flags or env vars are unaffected.
- **Schema is flat for now.** Adding a `[section]` header later requires reading both shapes; the migration cost is small and additive. Sectioning *now* would carry no benefit (two scalars).
- **No `$TOUR_REPLY_AGENT`.** The asymmetry with `$TOUR_EDITOR` is deliberate (no shell-env convention to compose with). If field evidence ever shows users want it, the addition is three lines in the resolver — same easy reversibility as user → repo scope.
- **Config provenance leaks into reply-agent template errors.** Without that breadcrumb, the user sees the same error whether the bad template came from `--reply-agent`, the config, or a future env var — three different files to inspect.
- **`tour config show` takes no flags.** No `--editor` / `--reply-agent` overrides at the inspector. The job is "what would Tour use given the current environment and file," not "simulate." This keeps the implementation small and the output unambiguous.
