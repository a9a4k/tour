# Open-in-editor — server-spawned, terminal editors refused over webapp

> **Status:** Cross-surface. Adds a new `o` keybinding (lowercase, per ADR 0030) that opens the file under the cursor in the user's configured editor at the resolved line. The TUI spawns the editor in-process; the webapp routes through `POST /api/tours/<id>/open-in-editor` so the same `tour` server does the spawn. Terminal editors (`vim`, `nvim`, `nano`, `emacs`, `hx`, `vi`, `micro`) are honored from the TUI (suspend / inherit / resume, lazygit-style) and refused from the webapp with a footer message. Editor selection follows a single resolution chain shared by both surfaces: `--editor` flag → `$TOUR_EDITOR` → `$VISUAL` → `$EDITOR`. Complements ADR 0028 (footer parity) and ADR 0030 (key conventions).

## Why

Tours pair a pinned diff with annotations. The annotation tells the reviewer *what* about a line; the line itself lives in a working tree the reviewer often wants to fact-check in their real editor. Until now the path from "I see an annotation on `foo.ts:42`" to "I'm editing `foo.ts:42`" went through copy-the-path, switch-app, paste-into-quick-open — friction that drops a tour out of the reviewer's flow exactly when they want to dig in.

A first cut considered three architectures:

1. Browser-side **URI scheme** (`vscode://file/<abs>:<line>`) — no server change, but tied to per-editor schemes, gated by OS "allow this app?" prompts, and works only for editors that register a handler. Cross-platform behaviour is uneven.
2. **Per-surface editor config** (`--tui-editor` / `--web-editor`) — lets the webapp accept its own GUI editor while the TUI runs vim. But splits the configuration surface for an edge case (terminal-editor users on the webapp) that's narrow in practice.
3. **One config, server-spawned on both surfaces** — the TUI spawns in-process; the webapp delegates to its already-running local server. Same code path, same editor resolution, single config knob.

The third option also unifies the *failure* surface: every error (missing config, ENOENT, file not in working tree) is one footer message regardless of where `o` was pressed. ADR 0028 already invested in cross-surface footer parity for exactly this kind of feedback, so leaning on the footer here is reuse, not new infrastructure.

The asymmetric handling of terminal editors falls out of physics, not policy: the TUI owns a terminal it can lend to vim via `stdio: 'inherit'`; the webapp's server has no terminal to lend. Refusing terminal editors over the webapp with a clear footer message ("o: terminal editor — open from TUI instead") is honest about the constraint and preserves the user's single editor choice for the TUI path.

## Considered Options

- **URI-scheme open from the browser, TUI spawns its own.** Rejected: per-editor scheme tax, OS prompt friction, and forces two divergent code paths to converge on the same UX.
- **Per-surface editor config (`--tui-editor` + `--web-editor`).** Rejected: doubles the config surface for an edge case. Users who set `vim` and want webapp parity can install a GUI editor; users who set `code` are unaffected.
- **Webapp refuses *all* editors that don't ship a GUI** (broader allowlist enforcement). Rejected as overreach: GUI-vs-terminal is an objective property (does the binary need a TTY?); "is this a *good* GUI editor?" is taste. The narrow terminal-editor allowlist is the minimum honest check.
- **Bare-key `e` for "open editor" (lazygit/tig/k9s convention).** Rejected: `e` is already bound to `expand-file-all` (issue #297). Every viable destination for the expand-all action is either foreclosed by ADR 0030 (Shift+E is reserved for a future *global* expand-all-files) or strictly worse (`x` for "expand" reads as "delete" in vim heritage; `+` is awkward to chord). Convention concession recorded under "Small contracts pinned" below.
- **`Shift+O` for safety against fat-finger.** Rejected by ADR 0030 derivation: `o` operates on cursor target (row → `(file, line)`; card → `(file, line_end)`; sidebar-file → `(file, 1)`), so it is lowercase. Disruption-of-action is a magnitude concern, and ADR 0030 explicitly rejects magnitude as the lowercase/capital cut.
- **Smart map from base-side line to current-tree line** (git-blame walk for `deletions` cursor). Rejected for slice 1: cost is real (per-press `git log -L`), correctness is still uncertain under uncommitted changes, and naive open lands within a few lines of the deletion in the common case. Can be revisited as a follow-up staleness warning without changing this ADR's architecture.

## Decisions

### Server-spawned on both surfaces, single editor resolution chain

A new pure module `src/core/editor-config.ts` resolves the editor at `main.ts` entry and threads the result into both `tui()` and `serve()`:

```
flag(--editor) → env.TOUR_EDITOR → env.VISUAL → env.EDITOR → null
```

The TUI path spawns directly in-process. The webapp path posts to `POST /api/tours/<id>/open-in-editor` with body `{ file, line, side }`; the server validates that `file` is in the tour's diff (defense-in-depth against arbitrary spawn from a malicious local script) and spawns from the same resolved config.

Argument syntax is **template with smart-default inference**: if the configured editor command contains `{file}`/`{line}` placeholders, substitute them; otherwise infer per binary name (`code|cursor|codium` → `-g {file}:{line}`; `idea|webstorm|…` → `--line {line} {file}`; `vim|nvim|nano|emacs|hx` → `+{line} {file}`; unknown → `{file}:{line}`). Spawn via `execFile` with parsed argv (never `sh -c`) so paths with spaces or special characters are injection-safe.

### Terminal editors honored in TUI, refused in webapp

The set `{vim, nvim, vi, nano, emacs, hx, micro}` is classified as terminal-editor by binary basename. The two surfaces handle the set differently:

- **TUI + terminal editor**: pause the opentui renderer → `spawn(stdio: 'inherit')` → await exit → resume the renderer. Mirrors `git commit`'s editor dance. Exit code is not surfaced — `:q` vs `:cq` in vim has no semantic meaning for `o` (no follow-up step to abort).
- **TUI + GUI editor**, **webapp + GUI editor**: `spawn(detached: true, stdio: 'ignore')` → `unref()` → race a 200ms timer against the `exit` / `error` events. ENOENT or non-zero exit inside the window → footer error; otherwise → footer "Opened foo.ts:42". The 200ms window also subsumes the terminal/GUI exit-handling distinction for GUI editors that exit cleanly: a real failure dies in <50ms; a healthy spawn doesn't exit at all in the window.
- **Webapp + terminal editor**: returns `409` with `{ ok: false, message: "o: terminal editor — open from TUI instead" }`. The client surfaces the message in the footer verbatim.

### Cursor resolution is permissive; card cursor targets `line_end`

The resolution mirrors `y` (yank-file-path) and `e` (expand-file-all): row cursor → `(file, line)`; card cursor → `(annotation.file, annotation.line_end)`; sidebar file selection → `(file, 1)`; folder selection or null → labelled footer no-op ("o: no file under cursor").

`line_end` (not `line_start`) on a card cursor is the deliberate choice: annotation cards render *below* their anchored range (GitHub convention, mirrored here), so the line the reader's eye lands on before the card is `line_end`. Opening at `line_end` matches the reader's perception of "the line this annotation is attached to." No major editor accepts a range via CLI (VS Code, Cursor, JetBrains, Sublime, Helix are all single-position; vim/emacs only via ex-command hacks), so range-aware open is dead code we declined to build.

### Naive working-tree open; staleness deferred

`o` opens `repo_root/<file>:<line>` against the working tree without mapping line numbers through git history. The dominant use case (reviewer on their own working branch, `HEAD == tour.head`) is correct; the `deletions`-side and drifted-HEAD cases land within a few lines and reviewers navigate from there. File missing in the working tree → footer "o: <file> not in working tree." A future follow-up can add a staleness warning (single `git rev-parse HEAD` + `git status --porcelain -- <file>`) without changing this ADR's architecture.

## Consequences

- **One editor configuration governs both surfaces.** Users set `$TOUR_EDITOR=code` once; `o` works the same in `tour tui` and `tour serve`.
- **Webapp users with vim get a clear failure.** The 409 + footer message ("o: terminal editor — open from TUI instead") tells them exactly what to do. The alternative — silent failure or a confusing zombie spawn — is foreclosed.
- **Reviewers gain a one-key path from annotation to source.** The `(annotation → o)` chord is the canonical "let me see this line in my real editor" gesture.
- **Defense-in-depth at the server boundary.** The tour-id scoped path lets the server reject `POST … {file: "/etc/passwd"}` even though the server binds 127.0.0.1; the check costs nothing and a future XSS-via-markdown bug doesn't compound into arbitrary spawn.
- **The naive-open choice means deletions-side `o` is "close enough" rather than line-accurate.** Acceptable for slice 1; a staleness-warning follow-up is the natural escalation if user feedback demands it.

## Small contracts pinned

- **`o` is lowercase by ADR 0030 derivation, not judgment.** The action operates on the cursor's target (row / card / sidebar file). On a degenerate cursor it's a labelled no-op. That is structurally identical to `e` and `y`. Future "disruption" arguments do not promote it to `Shift+O`; the cut is scope, not magnitude.
- **The lazygit/tig/k9s `e` convention is acknowledged and declined.** Tour's `e` is already `expand-file-all` (issue #297). Rebinding `e` would either churn shipped muscle memory or require co-opting `Shift+E`, which ADR 0030 reserves for a future *global* expand-all-files. `o` for "open" is the second-best mnemonic; one-time recalibration for lazygit-trained users is mitigated by the footer hint legend.
- **Terminal-editor classification is by binary basename, not capability detection.** A fixed allowlist (`vim`, `nvim`, `vi`, `nano`, `emacs`, `hx`, `micro`) keeps the rule readable and easy to test. Wrappers (`vim-wrapper.sh`) that resolve to a terminal editor are not detected; users with such setups can specify a GUI alias or accept the GUI-path code path's failure mode.
- **The 200ms early-failure window is a heuristic, not a guarantee.** Editors that fork-and-fail slower than 200ms will look like a successful launch from `o`'s perspective; the user discovers via the editor's own error reporting. Acceptable trade-off — tightening the window risks false negatives on slow disks.
- **`side` is carried in the API body even though slice 1 ignores it.** Adding a future staleness warning that reasons over which side the line came from costs zero protocol churn.
- **No new mouse affordance.** `o` is keyboard-only, mirroring `y`'s precedent. Footer-hint legends in both panes surface `o: open` next to `y` so mouse-only users can still discover it. A `↗` icon next to the file header's `↕` is the cheapest viable upgrade if feedback demands it.

## Addendum: `{workspace}` template placeholder

The editor template language gains a third placeholder alongside `{file}` and `{line}`: **`{workspace}`** substitutes the current worktree's working-tree directory (the value `findRepoRoot` returns; equivalent to `git rev-parse --show-toplevel`). The motivating gap: a Tour config user's natural attempt `editor = "code $(pwd) -g {file}:{line}"` fails silently because Tour spawns via `execFile` (not `sh -c`, per the section above) and the TOML parser performs no expansion. The substitution-language path is the safe, native equivalent.

### Decisions

- **Placeholder name: `{workspace}`.** Adopts VS Code's `${workspaceFolder}` convention (the dominant editor's vocabulary for this exact concept) without git-feature baggage. Rejected alternatives: `{repo}` (ambiguous in linked-worktree setups — does "repo" mean the main clone or this worktree?); `{worktree}` (collides with CONTEXT.md's **Worktree stamp** record field *and* implies the `git worktree` linked-checkout feature, which most users don't use); `{cwd}` / `{pwd}` (encode the wrong semantics — Tour substitutes `findRepoRoot(cwd)`, not `process.cwd()`); `{toplevel}` (requires git fluency to decode). VS Code's own evolution from `${workspaceRoot}` → `${workspaceFolder}` was driven by the same single-vs-multi ambiguity our `{repo}` walk surfaced; we inherit the conclusion.

- **Value: the current worktree's working-tree directory.** Plain clones get the clone's working tree (their only worktree). Linked-worktree setups get the linked worktree's working tree, not the main clone's — matches the workspace a user is actually editing in and matches the file paths Tour already resolves via `o`. Source-of-truth is `repoRoot` from `resolveTourLocation`; the placeholder and the file path agree about which worktree is in play.

- **Substitution timing: resolution-time, inside `resolveEditor`.** Add an optional fourth argument `repoRoot?: string` to `resolveEditor`; substitution happens once per Tour invocation when `EditorConfig` is built. The `argv(file, line)` closure signature is unchanged, so every downstream consumer (TUI editor-spawn, web `POST /api/tours/:id/open-in-editor`, integration tests) is unaffected. The spawn-time alternative — widening `argv` to `(file, line, workspace)` — was rejected as it propagates a context concern to every caller for a value they don't intrinsically care about.

- **Substitution applies in both branches.** `{workspace}` is a per-token `.replace(...)` rule applied uniformly to `rest`, in both the template branch (fires on `{file}` / `{line}` presence) and the smart-default branch (fires when neither is present). Consequence: `editor = "code {workspace}"` is a valid, useful configuration — `{workspace}` substitutes inside `rest`, then the `code`-family smart-default suffix (`-g {file}:{line}`) is appended and itself substituted. The shortest path to "open my workspace at the right line" is one token.

- **Optional arg with leave-literal fallback.** If `resolveEditor` is called without `repoRoot` and the configured value contains `{workspace}`, the token is left as the literal string `{workspace}`. Production never hits this case — `main.ts` only calls `resolveEditor` after `resolveTourLocation` succeeds (which requires a git working tree per ADR 0039). Tests that don't care about `{workspace}` can omit the arg without ceremony; tests that do exercise it pass `repoRoot` explicitly. A throw was considered and rejected as louder-than-warranted for a production-unreachable branch.

- **`tour config show` is unaffected.** The `show` inspector renders the raw configured `editor` string verbatim — it doesn't substitute `{file}` / `{line}` today and doesn't substitute `{workspace}` either. Users see exactly what's in their `~/.tour/config.toml`. The substitution is a spawn-path concern, not an inspection-path concern.

- **Scope: only `{workspace}`.** No siblings (`{tour_id}`, `{head_sha}`, `{file_dir}`, `{file_relative}`) ship in this addendum. Each would require its own naming walk and semantic decisions (full SHA vs short SHA? relative to what in linked worktrees?), and none have a motivating user ask. The substitution mechanism is one `.replace(...)` per variable; additions are trivially additive when warranted.

- **`--help` documents the template language.** USAGE gains a short "Editor template:" section naming the three placeholders with one concrete example. Lands an existing gap — `{file}` / `{line}` were undocumented in USAGE until now. The error message at the `editor not configured` chokepoint (issue #459) is unchanged; adding template syntax to it would bloat the error past usefulness.

### What did NOT change

- The editor resolution chain (flag → `$TOUR_EDITOR` → Tour config → `$VISUAL` → `$EDITOR` → null) — unchanged.
- The `execFile`-not-`sh-c` spawn posture — explicitly re-affirmed. `{workspace}` is substituted by Tour, not by a shell.
- The smart-default-per-binary inference table (vscode-family, jetbrains-family, terminal-allowlist) — unchanged.
- The terminal-editor classification — unchanged.
- The `EditorConfig.argv(file, line)` signature — unchanged. The new `repoRoot` arg is captured in `resolveEditor`'s closure.
