# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Per-Thread `Shift+C` collapse replaces the global collapse-replies
  gesture (PRD #397 / ADR 0038).** GitHub-style minimize on both
  surfaces. `Shift+C` on the cursored Card folds the whole Thread
  (parent + Replies) into a one-liner showing chevron · author kind ·
  file:line · 60-char body preview · `💬 N` reply count; pressing
  `Shift+C` again expands. The webapp Card header also grows a
  clickable `▾` / `▸` chevron for mouse users. Modifying actions
  (`r` reply, `R` request-reply) auto-expand the Thread before
  acting; destructive cascading actions (`d` delete) refuse with a
  footer hint forcing manual expand-first; watcher-delivered events
  (replies authored elsewhere, in-flight pills from a sibling
  renderer) never auto-expand. Cascade-deleted Threads drop from the
  hide-set automatically. The cursor validator projects a Reply
  anchor onto the parent's id when the parent Thread is collapsed
  (cursor stays on the same Card). Footer legend label flips
  contextually: `C: collapse` when expanded, `C: expand` when
  collapsed; the retired `C: collapse replies` label is gone.
- **CLI guardrails against agent author-identity mistakes (issue #396).**
  Three independent improvements landed together:
  1. `tour comment ... --as-human --batch -` with non-TTY stdin now emits
     a one-line `tour: warning: ...` to stderr nudging an agent caller
     to drop `--as-human`. The operation still succeeds — the warning
     is captured in agent transcripts so the mistake is caught in the
     same turn. Interactive (TTY) stdin and the single-comment path are
     unaffected.
  2. The `--author <name>` flag in `--batch -` mode now acts as a
     per-batch default. Items that omit `author` pick up the CLI value;
     per-item `author` in the JSONL still wins. Symmetric with the
     existing `--as-agent` / `--as-human` cascade into `author_kind`.
     Pre-fix, the CLI `--author` flag was silently ignored in batch
     mode, leaving `author: "agent"` instead of e.g. `author: "claude"`.
  3. The `/tour` skill's authoring example now passes `--as-agent`
     explicitly, names the audience-vs-author confusion as Comment
     rule #8, and ships a post-authoring `tour pickup --json | jq -e`
     self-audit that fails loudly when any comment has `author_kind
     !== "agent"`. `REFERENCE.md` documents the new `--author`
     precedence.

### Fixed

- **TUI: `R` (request reply) now fires when the cursor sits on a reply
  node (issue #395).** ADR 0037 broadened `CardAnchor.commentId` to
  include reply ids, but `sendTarget` still assumed the cursor's id
  was a top-level. After submitting a Reply, the post-submit
  `scrollToComment` landed the cursor on the freshly-created Reply and
  pressing `R` was a silent no-op until the user manually `k`-stepped
  back up to the parent. `sendTarget` now resolves the cursor through
  `findThreadByNode` so `R` is Thread-scoped regardless of which node
  the cursor sits on — the same target the cursor-on-parent case has
  dispatched to since issue #196. Webapp gains the fix for free
  (shared pure module). Signature change:
  `sendTarget(cursor, threads)` replaces the prior
  `(cursor, topLevel, repliesByRoot)` — `threads` carries everything
  the resolution needs in one scan.

- **CLI flag parser accepts `--flag=value` (issue #393).** The argv
  scanner now splits long flags on the first `=`, so
  `tour tui --reply-agent=claude` is equivalent to
  `tour tui --reply-agent claude`. Pre-fix, the `=` form silently
  stored `flags["reply-agent=claude"] = true`, skipped
  `assertShippedAgent`, and the TUI launched without a reply-agent
  configured (no header chip, `R` shortcut a silent no-op). Empty
  values like `--reply-agent=` now error at startup with
  `missing value for \`--reply-agent\`` instead of falling through.
  `--flag=true` / `--flag=false` coerce to booleans so `--open=true`
  works for users who prefer the `=` form on a boolean flag. The
  scanner moved out of `src/main.ts` into `src/core/parse-args.ts`
  so the matrix can be unit-pinned in isolation.

- **TUI diff pane no longer breaks after comment / reply submit (issue
  #392).** The optimistic bundle fold issue #322 introduced was running
  in the same render cycle that unmounted the absolute-positioned
  `<Composer>` overlay. When the underlying diff-rows tree
  simultaneously gained a height-changing CommentRow, opentui's yoga
  layout pass left the affected file's content subtree empty — diff
  rows below the parent's anchor would vanish, and `j`/`k` scrolled
  through empty space until the user re-opened the Tour. The
  `composer.submitted` reducer branch now closes the composer
  synchronously and emits a new `optimisticInsertComment` intent; the
  runtime defers the `bundle.commentInserted` dispatch on a short
  (50 ms) post-paint timer so the heightful row add lands after
  opentui has reflowed the composer-close commit. Empirically verified
  that microtask and `setTimeout(0)` are both insufficient — opentui's
  render tick needs ~33 ms to settle before the next React commit can
  safely change layout-affecting state. Issue #322's goal is preserved
  — 50 ms is well under the watcher's ~500-600 ms RTT and sub-perceptual
  — and the existing id-collision short-circuit (a subsequent
  `bundle.refreshed` carrying the same id results in exactly one
  occurrence) carries over to the new `bundle.commentInserted` reducer
  branch. Shared between TUI and webapp; the webapp didn't exhibit the
  layout bug but now follows the same deferred cadence for parity.

### Changed

- **ADR 0030 amendment: three-tier keybinding framework.** Pre-1.0
  audit reframed the original lowercase/capital rule as bare / Shift /
  Ctrl + symbols, added a "different actor" sub-shape under Tier 2 to
  legitimise the `r` / `R` pair (which had silently violated the
  original "Tour-wide only" capital rule since issue #390), and
  reserved `?` (help) and `/` (search) as future-use symbols. No
  rebinds — every shipped letter fits cleanly under one of the three
  tiers or the symbol axis. Also fixes the TUI footer legend to read
  `Space: page (Shift: up)` so the previously-hidden `Shift+Space`
  half-page-up binding is discoverable from the always-on hint strip.

- **TUI composer is multi-line + fills the inner width (issue #391).**
  The comment composer now renders an opentui `<textarea>` instead of
  the single-line `<input>`. Two consequences. (1) Typed text fills the
  full inner width of the composer envelope before any horizontal
  scroll — the legacy `<input>`'s default `scrollMargin` of 0.2
  reserved ~15 cols of right-edge space, which made the open composer
  feel narrower than it looked. The textarea is configured with
  `scrollMargin: 0` and `wrapMode: "word"`. (2) Multi-paragraph
  markdown notes are possible — Enter inserts a newline, and a new
  `Ctrl+S` chord (surfaced in the hint row as
  `Ctrl+S: submit · Enter: newline · Esc: cancel`) submits the draft.
  The slice contract is unchanged: `composer.setBody` carries the
  live text (newlines and all), `composer.submit` persists a
  `Comment` whose `body` may contain embedded `\n` characters, and
  the `submitting` / `errored` render paths continue to display the
  preserved draft verbatim (issue #254 render-gate contract). `Esc`
  still cancels an open composer; `Enter` still retries from
  `errored`.

- **TUI composer adopts the Slack / Claude Code submit pattern
  (issue #394).** Enter now submits the draft; Shift+Enter (Kitty
  keyboard protocol terminals — kitty, Ghostty, WezTerm, iTerm2 with
  the protocol enabled, modern Windows Terminal, etc.) or Ctrl+J
  (universal — 0x0A LF, distinct from Enter's 0x0D CR, works in every
  terminal, multiplexer, and SSH / Docker exec session) inserts a
  literal newline at the cursor. The previous `Ctrl+S` submit chord
  from issue #391 is removed entirely — one canonical submit chord
  wins over the marginal switching-cost savings of preserving a few
  weeks of muscle memory. The hint row now reads
  `Enter: submit · Shift+Enter / Ctrl+J: newline · Esc: cancel`. The
  errored-state behaviour is unchanged: `Enter: retry · Esc: dismiss`,
  routed through the App-shell handler (operates outside the focused
  textarea). The slice contract (`composer.setBody`, `composer.submit`,
  `composer.retry`, `composer.dismissError`, `composer.close`) and the
  `submitting` / `errored` render-gate (issue #254 / issue #391) are
  unchanged; embedded `\n` characters composed via Ctrl+J still
  survive the submit / preserve-on-retry path. Kitty-keyboard-protocol
  background: see https://sw.kovidgoyal.net/kitty/keyboard-protocol/
  for the spec that lets terminals send a distinct sequence for
  Shift+Enter; the universal Ctrl+J fallback works regardless.

- **Reply-agent verb relabel + keybinding rebind (issue #390, ADR 0021
  addendum).** The action that asks the configured reply-agent to
  reply to a human Comment is now surfaced as `Request reply` instead
  of `Send to {agent}`, and the TUI / webapp keybinding moves from
  bare `s` to `R` (shift-r). Same letter as `r: reply` — case-shifted
  to mark "different actor": lowercase `r` is "I'll reply," uppercase
  `R` is "ask the agent to reply." Bare `s` is unbound. Both surfaces
  now render a persistent `Reply agent: <name> · separate session`
  header chip when `--reply-agent` is configured, so the reply-agent
  reads as a distinct entity from the user's current chat. Reply-
  agent–produced Replies (`author_kind === "agent"` AND
  `replies_to != null`) carry a ` · reply-agent` byline marker on
  their header. The in-flight pill copy names the worker role —
  `Reply agent (<name>) is replying…` — and the disabled-button
  tooltip changes in lockstep. Dispatch model is unchanged:
  `requestReply` signature + result discriminants, `.reply-lock.json`
  semantics, `annotations.jsonl` / `tour-events.jsonl` schema, and
  `tour pickup --json` all stay byte-identical. Footer legend now
  reads `… r: reply · R: request reply …` (no agent name on the
  label — it lives on the chip and tooltip).

### Added

- **TUI delete (`d` + confirm modal) (issue #388, ADR 0036, PRD #384,
  Slice D).** Pressing `d` while the cursor sits on a Comment card
  opens a confirmation modal targeting the cursored node — parent or
  Reply (ADR 0037 / Slice A's reply-level cursor stops make this
  uniform). The modal previews the target (author, relative age,
  body excerpt) and surfaces a cascade note: `N replies will remain
  under [deleted]` when the target is a parent with live Replies,
  `this reply will be removed from the thread.` when the target is
  a Reply, `the thread will vanish.` when the deletion retracts the
  whole Thread. `Enter` confirms — appends the `comment.deleted`
  event via the `createDelete` seam landed in Slice C — and the
  watcher's `comment-changed` event refreshes the projection; `Esc`
  cancels without writing. The modal joins the composer + picker
  under the `close-modal` precedence (ADR 0031): `Esc` closes the
  modal first. `d` on a row dispatches a labelled no-op
  (`noop-delete-on-row`); `d` in the sidebar is unbound. The diff-
  mode footer legend now reads `… r: reply  ·  d: delete …`.

- **Webapp delete (trash icon + confirm modal) (issue #389, ADR 0036,
  PRD #384, Slice E).** Every Comment card in the webapp gains a 🗑
  affordance — on the parent header and on each inline Reply. Hover
  (or focus) reveals the icon; clicking opens a confirmation modal
  that previews the target Comment (author kind, optional author
  token, file location, relative age, body excerpt) and surfaces the
  C4 cascade: "this reply will be removed from the thread.", "N
  replies will remain under [deleted].", or "the thread will vanish."
  Cancel dismisses; Delete dispatches a `DELETE
  /api/tours/<id>/comments/<comment-id>` request that wraps the
  shared `createDelete` seam with `by_kind: "human"` — the same path
  the CLI's `--delete` flag uses (Slice C). The watcher / SSE flow
  refreshes the projection in place; deleted leaf Replies vanish,
  deleted parents with surviving Replies render as a muted italic
  `[deleted]` stub Card with the Replies underneath, and
  fully-deleted Threads disappear entirely. The modal traps Tab
  inside its two buttons, autofocuses Delete so Enter confirms by
  default, and dismisses on Esc, scrim mousedown, or Cancel click.
  The bridge never asserts `--as-agent` — the webapp's delete is
  implicitly human by design.

- **CLI delete verb + humans-only permission predicate (issue #387, ADR
  0036, PRD #384, Slice C).** `tour comment <tour-id> --delete
  <comment-id>` appends a `comment.deleted` event via the new
  `createDelete` write seam, which enforces the humans-only contract
  by rejecting any caller asserting `by_kind === "agent"`. The CLI
  refuses `--as-agent --delete` before any I/O, and `--delete` is
  mutually exclusive with the `--file/--side/--line/--body`,
  `--reply-to/--body`, and `--batch` flag families. `--json` returns
  the `{ deleted: <comment-id> }` envelope (matching `tour delete`'s
  convention); the non-JSON path prints `Deleted comment <id>`.
  Validation mirrors `--reply-to`'s existence check: the target id
  must resolve in the projected state and not already be deleted —
  defence-in-depth against the fold's idempotency safety net. `tour
  pickup --json` now reflects the C4 cascade: deleted leaf Replies
  vanish, a deleted parent with surviving Replies surfaces as a
  `[deleted]` stub carrying `deleted: { at }` with the anchor
  retained, and fully-deleted Threads vanish entirely. The TUI `d`
  gesture, modal, and webapp trash icon land in subsequent slices.

### Changed

- **Event-sourced Tour persistence (issue #386, ADR 0036, PRD #384, Slice B).**
  Per-Tour on-disk persistence moves from a homogeneous Comment-snapshot
  log (`comments.jsonl`) to an append-only event log at
  `.tour/<id>/tour-events.jsonl`. Initial event union: `comment.created`
  + `reply.created` (this slice emits both) and `comment.deleted` (the
  fold implements the C4 cascade so it's testable now; the write verb
  lands in Slice C). Reads project events through a pure fold
  (`foldEventsToComments`) into `CommentState[]` — the new projected
  Comment shape gains an optional `deleted?: { at }` field (absent in
  this slice). Every existing consumer (CLI / TUI / webapp / `tour
  pickup` / reply-runner) is unchanged at its API; only the storage
  seam moves. The watcher collapses its dual-fingerprint
  (`comments.jsonl` → `annotations.jsonl`) logic to a single fingerprint
  of `tour-events.jsonl`. ADR 0029's Stage B addendum decision that
  predecessor read paths "stay forever" is superseded for the storage
  shape — pre-1.0 status makes the migration cost-free. Existing
  `.tour/<id>/` directories on disk become unreadable; affected
  contributors re-create their Tours.

### Removed

- **OpenTUI tree-sitter machinery retired (issue #377, PRD #374, slice 3).**
  After #376 ported the TUI to Shiki, the OpenTUI tree-sitter path was
  dead code that still shipped in the binary. Deleted `src/tui/syntax.ts`
  (whitelist + hand-tuned `getSyntaxStyle()` palette), `src/tui/parser-
  worker-bundle.js` (bespoke pre-bundled OpenTUI tree-sitter worker), and
  `src/tui/otui-worker-shim.ts` (the `OTUI_TREE_SITTER_WORKER_PATH` env-
  var indirection — the shim's only purpose). The hidden `tour selftest-
  syntax` verb (and `src/tui/selftest-runner.ts` / `src/cli/selftest.ts`)
  retire with it — the verb tested the tree-sitter worker boot; Shiki
  runs synchronously and has no equivalent worker. The binary build
  pipeline simplifies: `scripts/build-client.ts` no longer pre-bundles
  the OpenTUI parser worker (only the embedded webapp client string
  remains as a pre-build artefact), `scripts/build-binary.ts` invokes
  `bun build --compile` with only `src/main.ts` as an entrypoint (no
  second worker entrypoint), and the `otuiWorkerStub` snapshot/restore
  branch retires (issue #204's stub-restore state machine halves —
  only the embedded webapp client string still uses snapshot/restore).
  `scripts/smoke-binary.sh` drops the `selftest-syntax` invocation.
  Measured binary size delta on bun target (Linux x64):
  130,590,864 → 130,328,720 bytes (~256 KB reduction; smaller than
  the ~1–2 MB the PRD projected — the tree-sitter machinery
  minified down further than expected post-bundle).

  Issue: #377 · PRD: #374

### Added

- **TUI reply-level cursor stops (issue #385, ADR 0037).** `CardAnchor.commentId`
  now addresses any node in a Thread — parent or Reply — not just the
  top-level Comment. `j` from a parent with replies steps onto the
  first Reply (still a `CardAnchor`, same Card row, new `commentId`);
  subsequent `j` presses walk each Reply in append order; `j` from the
  last Reply exits the Card to the next flat row. `k` mirrors
  symmetrically. Threads with no replies behave exactly as today. The
  Card chrome (heavy border + accent background) still lights up when
  the cursor sits on any node in the Thread; the `●` glyph + reply-
  chrome tint narrow to the specific cursored node. `n`/`p` continues
  to enumerate top-level Comments only — from a reply, the walker
  treats the cursor as being on the reply's root, so `n` lands on the
  next Thread (the `[N/M]` pill counter is unchanged). `preferredSide`
  carries across all parent ↔ reply, reply ↔ reply, and last-reply →
  row-exit transitions. The webapp's cursor model is unchanged (ADR
  0037 is TUI-scoped). Scoped to the TUI by threading
  `nav.threads` through `moveCursor` / `nextCard` / `prevCard` /
  `resolveCursorRowIdx` / `validateCursor` / `stepDiffPane` /
  `pageMoveDiffPane` / `jumpDiffPane` — all four take an optional
  `threads?: Thread[]` parameter; webapp call sites pass nothing and
  preserve their prior behaviour. Unblocks per-node verbs (delete in
  ADR 0036's slice, future edit/resolve) without forcing each verb to
  ship its own in-modal node selector.

  Issue: #385 · ADR: 0037

- **Webapp mouse paths to open-in-editor — annotation filename link,
  file-header `↗` icon (issue #383, ADR 0035).** ADR 0032 wired the
  keyboard `o` to `POST /api/tours/<id>/open-in-editor` and deferred
  mouse on purpose. This slice unblocks discoverability for mouse-first
  users: the annotation card's `{comment.file}:{range}` header becomes a
  hover-underlined location-stamp link (matches Sentry / devtools /
  Sourcegraph), and the file header gains an unconditional `↗` icon in
  the right cell next to the conditional `↕` expand-all. Annotation
  click moves the cursor onto the card before dispatching at
  `line_end`; file-header click dispatches at line 1 without moving
  the cursor (file-level affordance, no cursor contract to inherit).
  Both reuse ADR 0032's endpoint, resolution chain, terminal-editor
  refusal (409 → footer), and success-message footer flash via the new
  `dispatchOpenInEditor` helper — the keyboard `o` keymap now also
  routes through the helper. `event.stopPropagation()` on both click
  sites prevents the surrounding `onCardClick` / `onToggleCollapse`
  semantics from double-firing.

  Issue: #383 · ADR: 0035

- **TUI paints every Shiki-supported language via
  `core/syntax-highlight.ts` (issue #376, PRD #374, slice 2).** Pre-fix
  the TUI's OpenTUI `<code>` path covered 5 grammars
  (TS/TSX/JS/JSX/Markdown) inherited from `@opentui/core`'s tree-sitter
  asset directory; anything else painted plain. Opening a `.proto`,
  `.rb`, `.kt`, `.swift`, `.java`, `.toml`, `.c`/`.cpp`, `.php`, `.sql`,
  `.lua`, `.zig`, etc. file in the TUI now paints with GitHub-Dark token
  colours, matching the webapp's coverage from #375. Comments paint
  italic via the cross-surface overlay. Implementation: the new
  `src/tui/syntax-paint.ts` adapter walks the surface-agnostic
  `TokenLine[]` from `core/syntax-highlight.ts` and builds OpenTUI
  `StyledText` via `fg(color)(text)` composed through `bold` / `italic`
  / `underline` from `@opentui/core`. The `useTuiHighlight(content,
  lang) → StyledText[] | null` hook (in `src/tui/use-tui-highlight.ts`)
  mirrors the webapp's `useLazyHighlight` shape — returns null until
  the per-lang grammar resolves, then one `StyledText` per source line.
  `DiffLine.tsx` drops the `filetype` / `syntaxStyle` props and accepts
  `styledLine?: StyledText`; the styled branch renders via `<text
  content={styledLine} wrapMode="word">` when present and falls
  through to the existing plain-text branch otherwise. The diff-pane
  assembly site (`app.tsx`'s new `<DiffPaneFile>` component) wires the
  hook per file and threads per-line `StyledText` through `DiffRows`'s
  new `stylesLeft` / `stylesRight` props. Non-truecolor terminals
  (`COLORTERM` unset or non-truecolor value) short-circuit to plain
  text — wrongly-mapped colour beats missing highlight only in the
  negative direction (PRD #374). `src/tui/syntax.ts`, the bespoke
  OpenTUI parser-worker pre-bundle, and the worker shim still ship in
  the binary; their retirement is scoped out of this slice (no new
  references to any of them).

  Issue: #376 · PRD: #374

- **Webapp paints every Shiki-supported language via the new
  `core/syntax-highlight.ts` module (issue #375, PRD #374, slice 1).**
  Pre-fix the webapp eagerly bundled 13 grammars (TS/TSX/JS/JSX/JSON/MD/
  bash/YAML/CSS/HTML/Python/Rust/Go); anything else painted plain. Opening
  a `.proto`, `.rb`, `.kt`, `.swift`, `.java`, `.toml`, `.c`/`.cpp`,
  `.php`, `.sql`, `.lua`, `.zig`, etc. file in the webapp now paints with
  GitHub-Dark token colours. Implementation: the new cross-surface
  `core/syntax-highlight.ts` module owns Shiki, the curated ~200-entry
  `EXT_TO_LANG` map, per-`(content, lang)` memoisation, per-lang lazy
  grammar load, and the italic-comment overlay; the webapp adapter
  (`src/web/client/syntax-paint.ts`) emits inline-styled `<span>` runs
  from the surface-agnostic `TokenLine[]` shape. The `tokenize(content,
  lang) → Map<lineNumber, html>` call-site contract for
  `useLazyHighlight`'s consumers (FileBlock + row-components) is
  preserved; the hook's external shape is unchanged. Comments now paint
  italic on the webapp via the cross-surface overlay
  (github-dark-default does not flag comment scopes as italic; we
  promote `italic: true` for tokens whose scope chain includes
  "comment"). TUI integration is a separate slice under #374.

  Issue: #375 · PRD: #374

### Changed

- **Webapp unified diff renders a two-column gutter — old | new —
  matching the TUI's `unifiedGutter` and GitHub's unified-view
  convention (issue #382 / ADR 0034).** Pre-fix, the unified-layout row
  rendered one gutter that swapped meaning across row kinds: addition
  rows showed `new#`, deletion rows showed `old#`, context rows showed
  `new#` (the old line number was dropped entirely). Side-of-anchor
  read from the `+/-` glyph; the click-to-seed-cursor handler defaulted
  to additions on context rows regardless of where the reviewer
  pointed. The row now emits four cells in DOM order — `gutter-old`,
  `gutter-new`, `sign`, `code` — with both numbers populated on
  context rows, the old column blank on pure-addition rows, and the
  new column blank on pure-deletion rows. Each gutter cell carries its
  own `data-side` (`"deletions"` on the old column, `"additions"` on
  the new column) and `data-line-number`. Click-to-seed-cursor reads
  `side` from the clicked column instead of from row kind — a context
  row's old gutter seeds `deletions`; its new gutter or code cell
  seeds `additions`. The `+` annotate button renders on every gutter
  cell that carries a number and dispatches `onAnnotate(side,
  lineNumber)` with that gutter's side. Per-file gutter min-width
  derives once from `max(maxOldDigits, maxNewDigits)` and plumbs in
  via the `--tour-gutter-ch` custom property on `.tour-file-block`, so
  both columns stay visually symmetric across files with mismatched
  old/new line counts. Each unified row exposes a single `aria-label`
  summarising the row (e.g. "Added line 13: return bar();"); the two
  gutter cells and the symbol cell are `aria-hidden="true"` so screen
  readers don't utter the redundant numbers + sign + code. Split
  layout is unchanged.

  Issue: #382 · ADR: 0034

- **Sidebar `y` on a folder row now copies the folder's repo-relative
  path (issue #371, extends PRD #356).** Pressing `y` with the sidebar
  focused and a folder selected used to flash `y: no file selected` and
  no-op; it now writes the folder's repo-relative path to the clipboard
  and flashes `Copied <path>` — symmetric to file-row yank. Same
  transport (`pbcopy` / OSC 52 fallback on TUI, `navigator.clipboard.
  writeText` on webapp); no trailing slash on the path. The resolver's
  `none` reason union collapses from `"no-cursor" | "no-file-selected"`
  to `"no-cursor" | "no-selection"`, and the footer flash on the
  degenerate-none case (null selection, or the defensive empty-path
  root sentinel) is now `y: no selection` on both surfaces. PRD #356
  intentionally scoped folder yank out; this is the small follow-up
  that extends the same design (path-not-filename, reversibility,
  ADR 0031 read-only-fires-in-sidebar) to folder rows.

  Issue: #371 · PRD: #356

### Fixed

- **TUI + web: hunk-header `↑` and standalone `↓` no longer reveal
  lines on the wrong edge of a hidden gap (issue #381).** Pre-fix,
  clicking the mid-file banner's `↑` revealed context lines at the
  **top** of the hidden gap (just below the previous hunk's end —
  far above the banner) instead of immediately above the banner
  where GitHub users expect them. The standalone `↓` (Expand Down)
  row mirrored the inversion — clicks revealed lines just above the
  current hunk (far below the standalone row) instead of immediately
  below it. Root cause: the producer-side mapping from user-facing
  direction (banner ↑ = "up", standalone ↓ = "down") to the
  reducer's gap-edge direction (`up` = top of gap = near `prevEnd`;
  `down` = bottom of gap = near `currentStart - 1`) was the
  identity, not an inversion. The reducer's `up` / `down` field
  names are correct from a gap-edge perspective and unchanged; only
  the producer's translation flips. Fixed in two canonical hand-off
  points — `core/primary-action-plan.ts` (TUI's
  `planPrimaryAction`) and `web/client/App.tsx`'s `dispatchExpand`
  (web's mouse-click + keyboard-Enter path). `boundary-top` /
  file-bottom (`expandTop` / `expandBottom`) are unilateral and
  unaffected; `primaryExpand: "all"` (the `↕` glyph) is symmetric
  and unaffected.

  Issue: #381

- **TUI: hunk-header / expand-down button cell widens to the gutter
  footprint so `@@` aligns with diff code (issue #380).** The banner's
  button cell was a fixed `paddingLeft=2 + 1 glyph + paddingRight=2 = 5`
  cells wide, while the adjacent diff rows reserved `1 (accent stripe) +
  8 (split gutter) = 9` cells (or `1 + 14 = 15` in unified) before the
  content column. Result: the `@@` text in the right cell started ~3
  columns left of code in split layout (~9 columns left in unified),
  and the standalone `expand-down` row's empty right cell drifted by
  the same amount. Widened the button cell to `1 + LINE_NUMBER_WIDTH +
  3 = 9` cells in split and `1 + LINE_NUMBER_WIDTH * 2 + 4 = 15` cells
  in unified — derived from the same `LINE_NUMBER_WIDTH` constant the
  gutter helpers use so alignment stays correct if the gutter format
  ever changes. Glyph centers horizontally inside the button cell via
  `alignItems="center"` (no hand-tuned paddings). Right cell drops its
  `paddingLeft=1` so `@@` (banner) / empty fill (`expand-down`) starts
  exactly at the same column as the diff code below. Applies
  identically to `↑` / `↕` (hunk-header banner) and `↓`
  (`expand-down`). Button bg stays `accentEmphasis`; the focus tint on
  the right cell from #379 is unchanged.

  Issue: #380

- **TUI: hunk-header and `expand-down` buttons no longer dim on cursor
  (issue #379).** The two-cell banner painted its focus tint on the
  saturated `accentEmphasis` button cell, so landing the diff cursor
  flipped the bg to `cursorRow.tui` (focused) or `accentCursor.tui`
  (parked) — both darker than `accentEmphasis`, producing a brightness
  ordering of **default > focused > parked** that reads as "focus
  removes prominence". Moved the focus tint to the right (text) cell,
  matching the webapp's "row lights up on the right; button stays
  bright" decision. Button cell now stays `accentEmphasis` in every
  cursor state; right cell flips from its uncursored `accentSubtle.tui`
  to `cursorRow.tui` / `accentCursor.tui` on cursor + focus. Applies
  to both the hunk-header banner (`↑` / `↕`) and the standalone
  `expand-down` row (`↓`). No theme or layout changes.

  Issue: #379

- **`tour serve --port 0` asks the OS for any free port (issue #373).**
  Five integration test files used to pick a port via `Math.floor(
  Math.random() * RANGE)` then pass it to `tour serve --port N`. The
  ranges overlapped across files (12000–52000, 18000–58000, 19500–
  20500, …); under vitest's concurrent scheduler two files could
  simultaneously target the same N, producing assertion failures that
  read as flakes ("expected 404 to be 400" when the wrong server
  answered a fetch). `--port 0` now flows through `resolveServePort`'s
  fast-path — probe + fallback walk are bypassed, `Bun.serve` binds an
  OS-assigned port, and the existing `Tour server running at
  http://127.0.0.1:PORT` banner carries the actual port back to the
  caller. `serve-open-in-editor.test.ts`, `serve-deep-url.test.ts`,
  `serve-tip.test.ts`, and the two non-blocker tests in
  `serve-reuse.test.ts` switched over. The deliberate-busy-port tests
  in `serve-port-collision.test.ts` and `serve-reuse.test.ts`'s
  busy-fallback AC cases keep their random-port pattern — they need a
  *known-busy* port, not any free port. Production behavior for
  non-zero `--port N` is unchanged.

  Issue: #373

- **TUI: clicking an expand button fires the expansion in one click
  (issue #372).** Pre-fix the TUI's `onInteractiveClick` only moved
  pane focus and the cursor — the row's primary action did not fire,
  forcing a click-then-Enter to actually expand the gap. Affected
  every interactive subKind: `boundary-top` / `hunk-separator` (`↑`
  and `↕` on the hunk-header banner), `expand-down` (the standalone
  `↓` row above mid-file large gaps and at file-bottom), and
  `collapsed-file` (the classifier-collapsed file's indicator row).
  Now the click steals pane focus, lands the cursor on the clicked
  row, *and* dispatches the same `expansion.*` + orphan-landing
  `cursor.set` the keyboard Enter path produces for the same target.
  Implementation lifts the dispatch logic out of `dispatchPrimaryAction`
  into a target-explicit `dispatchPrimaryActionAt` wrapper around a
  new pure `core/primary-action-plan.ts` planner; both the Enter and
  click paths delegate through the planner, so orphan-landing
  prediction (issue #306) is computed relative to the action target,
  not the pre-click cursor.

  Issue: #372 · ADR: 0013 / 0023 · Related: #306 / #280 / #359

- **Spawn integration tests no longer race the fake-editor argv-log
  flush (issue #370).** Six call sites across
  `tests/core/editor-spawn.test.ts`,
  `tests/integration/serve-open-in-editor.test.ts`, and
  `tests/integration/bare-tour-editor.test.ts` previously used a fixed
  `setTimeout(50|100)` to wait for a detached fake-editor child to
  flush its argv log to disk; under CI load the wait expired before the
  shell `>>` redirection had flushed and closed the file, producing
  intermittent ENOENT or empty-log false negatives. A shared
  `tests/_helpers/wait-for-file.ts` helper now polls until the log
  reaches a non-empty state (or a caller-supplied byte threshold)
  before the assertion proceeds, with a generous overall timeout and a
  path-bearing error on miss. Test-only change — no production code
  under `src/` was touched.

  Issue: #370

- **`tour` commands now resolve `.tour/` from the enclosing repo root,
  not `process.cwd()` (issue #369).** Pre-fix, every subcommand
  (`create`, `serve`, `tui`, `list`, `show`, `close`, `delete`, `prune`,
  `pickup`, `comment`) read and wrote `.tour/` at the literal current
  working directory; two shells in the same repo but different
  sub-directories saw two unrelated stores, and `tour tui <id>` from a
  fresh sub-directory failed with the same `No tours found` message as
  an unmatched prefix. A new resolver walks up from `cwd` looking for
  a `.git` ancestor (file or directory — git worktrees keep working)
  and threads that path through every CLI handler as the single
  "tour root" for the invocation. Outside a git repo the walk-up
  honours an existing `.tour/` ancestor; only when neither marker is
  found does behaviour fall back to today's `cwd`-grounded layout.
  `resolveIdPrefix` now distinguishes "no `.tour/` directory at
  `<root>`" from "no tour matching prefix" so the two failure modes are
  no longer indistinguishable. Sub-directory `.tour/` left over from
  before this change is surfaced as a one-line stderr warning pointing
  at the orphaned path; no files are moved automatically.

  Issue: #369

- **Sidebar keyboard cursor is now visible on folder rows (issue #367,
  PRD #343, ADR 0031).** Pressing `j` / `k` in sidebar mode moves the
  `:focus-visible` accent outline across every visible row — folders
  included. Previously folders were silently skipped because the
  folder-row component never registered its DOM node in the App-level
  ref map, so the focus-realisation effect's `registry.get(path)?.focus()`
  resolved `undefined` and no row gained DOM focus. `FolderRow` now
  accepts the same `registerRef` callback as `FileRow` and wires it
  through its `<button>`'s `ref`, registering on mount and deregistering
  on unmount. No change to hover styling, click semantics, roving
  `tabIndex`, or `paneFocus` flow.

  Issue: #367 · PRD: #343 · ADR: 0031

- **Collapse the hunk-header banner when there's nothing to expand
  (issue #359, ADR 0025 amendment).** The planner no longer emits a
  hunk-header row at gaps where the helper reports `primaryExpand:
  null`. Two cases converge: a file whose first hunk starts at line 1
  drops the top-of-file banner (the file-header chrome already names
  the file, the gutter conveys position); and once a reviewer fully
  expands a mid-file gap, the two adjacent hunks render as one
  continuous stream of diff/context rows with no inert `…` banner
  between them. The pure helper `hunkHeaderExpandPlan` keeps its
  current signature and `primaryExpand: null` return value — only the
  planner's downstream interpretation flips. The defensive
  null-`primaryExpand` guards in `flat-rows.ts` and both renderers
  remain as belt-and-braces but are now unreachable from real planner
  output.

  Issue: #359 · ADR: 0025

- **Bare `tour --editor <cmd>` now threads the flag into the dispatched
  surface (issue #364, PRD #349).** Previously, `tour --editor 'code -g'`
  with no subcommand either errored as `Unknown command: --editor` (a
  leading flag was treated as the subcommand) or, if it slipped through,
  silently dropped the editor before launching the surface — pressing
  `o` footered `o: editor not configured` even though `--editor` was on
  the command line. The argument parser now recognizes a leading flag as
  a bare invocation, and the smart-default branch resolves
  `--editor` → `$TOUR_EDITOR` → `$VISUAL` → `$EDITOR` via the same
  `resolveEditor()` call used by `tour tui` and `tour serve`, threading
  the result into both surfaces. Behaviorally indistinguishable from the
  explicit subcommand with the same flag. `--help` / `-h` / `--version`
  / `-v` remain command-name aliases.

  Issue: #364 · PRD: #349

### Added

- **`o` is now permissive: card cursor opens the annotation's `line_end`;
  sidebar file row opens line 1 (issue #354, PRD #349, ADR 0032).**
  Pressing `o` with the cursor on an annotation card opens the
  annotation's anchored file at its `line_end` — the line the reader's
  eye lands on before the card. Pressing `o` with the sidebar focused
  on a file row (no diff cursor yet) opens that file at line 1, so the
  shortcut works straight from the file tree without first pressing
  `j` in the diff pane. Folder selection and fully null state still
  surface `o: no file under cursor`. The slice-1 placeholder hints
  ("card cursor — j/k to land on a row first") are removed. Both
  surfaces inherit the new behavior via the shared
  `core/open-target-resolver`.

  Issue: #354 · PRD: #349 · ADR: 0032

- **`o` on a webapp diff row opens the file at that line in your GUI
  editor (issue #353, PRD #349, ADR 0032).** Webapp parity for the
  cross-surface open-in-editor feature. `tour serve --editor 'code -g'`
  honors the same precedence chain as the TUI (`--editor` →
  `$TOUR_EDITOR` → `$VISUAL` → `$EDITOR` → null). Pressing bare `o` on
  a diff row resolves `(file, line)` client-side, POSTs to a new
  `/api/tours/<id>/open-in-editor` endpoint, and pipes the server's
  `message` verbatim into the footer — `Opened <file>:<line>` on
  success, `o: <bin>: command not found` / `o: editor failed (code N)`
  on spawn failure, `o: editor not configured — set $TOUR_EDITOR or
  pass --editor` when no editor is configured, `o: terminal editor —
  open from TUI instead` when a terminal-classified editor is
  configured (the server refuses these with HTTP 409 — the webapp has
  no terminal to lend; users with vim/nvim/nano/emacs/hx/micro keep
  using the TUI for `o`). The server validates `file ∈ tour.diff.files`
  as defense-in-depth on top of the 127.0.0.1-only bind; a misbehaving
  local script can't compound into arbitrary spawn. `o` is suppressed
  by picker-open and editable-focus but fires through the
  composer-open gate so mid-compose fact-checking works. Footer legend
  gains `o: open` next to `r: reply` on both pane modes.

  Issue: #353 · PRD: #349 · ADR: 0032

- **`o` on a TUI diff row opens the file at that line in your GUI editor
  (issue #352, PRD #349, ADR 0032).** Tracer-bullet slice 1 of the
  cross-surface open-in-editor feature: `tour tui --editor 'code -g'`
  (or `$TOUR_EDITOR` / `$VISUAL` / `$EDITOR` fallbacks) configures the
  editor; pressing bare `o` while the cursor sits on a diff row spawns
  the editor detached at `(file, line)` and footer-flashes
  `Opened <file>:<line>` (auto-clears after ~1200ms). ENOENT, non-zero
  exit inside 200ms, missing config, missing working-tree file, and
  terminal-editor configs each surface a clear footer message. Card
  cursor / sidebar fallback / folder selection footer-fail with
  placeholder hints (full permissive resolution lands in #351).
  Establishes the shared `core/editor-config`, `core/editor-spawn`,
  `core/open-target-resolver` modules that subsequent slices (#353
  webapp parity, #354 permissive resolution, #355 terminal-editor TUI
  support) reuse.

  Issue: #352

- **TUI now honors terminal editors (`vim`, `nvim`, `vi`, `nano`,
  `emacs`, `hx`, `micro`) on `o` (issue #355, PRD #349, ADR 0032).**
  Replaces the slice-1 placeholder footer ("terminal editor — TUI
  support coming in a follow-up") with the real suspend / inherit /
  resume lifecycle, mirroring `git commit`'s editor dance and
  lazygit's `e`-key behavior. Pressing `o` with `$TOUR_EDITOR=vim`
  pauses the opentui renderer, hands the terminal to vim via
  `stdio: 'inherit'`, awaits exit, and resumes the renderer with a
  full repaint. Exit code is not surfaced (`:q` and `:cq` both
  return `Opened <file>:<line>`). Resume is guaranteed via
  try/finally even if the editor crashes or is killed (SIGKILL),
  so the TUI is never left in a paused state. The webapp continues
  to refuse terminal editors with 409 — that asymmetry is physics
  (no terminal to lend), not policy.

  Issue: #355 · PRD: #349

### Changed

- **TUI `y` is now context-aware (PRD #356, issue #357).** Semantics
  expansion of the shipped #326 binding: pressing bare `y` in diff mode
  with the cursor on a context / addition / deletion / change row now
  copies the raw line text (no `+` / `-` / ` ` prefix character, no
  trailing newline) to the system clipboard and flashes
  `Copied "<truncated preview>"`. Cursor on an interactive row
  (hunk-header / expand-down / boundary-top / collapsed-file) or on a
  Comment card falls back to the file path — same `Copied <path>`
  flash as #326. Sidebar selection of a file row keeps the
  copy-the-path semantics; folder rows and null states flash
  `y: no file selected` / `y: no cursor`. Resolution lives in a new
  shared `src/core/yank-target.ts` module that the upcoming webapp
  slice consumes unchanged. Persistent footer legend now reads
  `y: yank` (replacing `y: yank path`) to cover both outcomes.

  Issue: #357 · PRD: #356

- **Webapp `y` keyboard yank (PRD #356, issue #358).** Cross-surface
  parity with the TUI slice (#357): pressing bare lowercase `y` on the
  webapp resolves the context-aware yank target via the shared
  `core/yank-target.ts` resolver, writes the result to the clipboard
  via `navigator.clipboard.writeText`, and flashes a transient footer
  message through the existing `Footer.tsx` `aria-live="polite"` slot
  (screen-reader-announced). Diff-row cursor → line text; card /
  interactive / sidebar-file selection → file path; folder / null
  state → `y: no file selected` / `y: no cursor`. `Cmd-Y` / `Ctrl-Y` /
  `Alt-Y` keep their host shortcuts (redo / history-back); `Shift-Y`
  is reserved per ADR 0030; `y` inside an editable / open picker is
  absorbed by the existing suppression gates. `y` fires in BOTH pane
  modes (read-only — ADR 0031's auto-flip rationale for c/r/s
  doesn't apply). The existing per-file `📋` button (#317) and its
  checkmark indicator (#319) are unchanged. Webapp footer legend now
  reads `y: yank` in both diff and sidebar pane sections.

  Issue: #358 · PRD: #356

## [3.1.1] — 2026-05-15

### Changed

- **`n` / `p` smooth-scrolls the target Comment card to centre on both
  surfaces (issue #348, ADR 0011 Revisions 2026-05-15).** Every
  comment-jump frames the card mid-viewport with a perceptible tween
  — TUI via `animatedCenterChildInView`, webapp via `scrollIntoView({
  behavior: "smooth", block: "center" })`. Adjacent landings keep a
  predictable focal point; the smooth motion conveys travel direction
  between cards. Mashing `n n n n` converges on the last card without
  queueing animations on either surface (TUI's `animatedScrollTo`
  cancels any in-flight tween at the start of each call; webapps
  inherit browser-native smooth-scroll interruption). The
  `scrollCursorTarget` intent now carries `placement` *and* `behavior`
  (`"instant" | "smooth"`) as independent axes; the adapters take
  both and dispatch to the matching helper. Default for unspecified
  `behavior` preserves today's mapping (`center → instant, nearest →
  smooth`), so call sites that haven't migrated keep working.
  Click and `j` / `k` are unchanged (spatial gestures stay on
  `nearest + smooth`); fresh landings (materialize / URL `?ann=`
  restore / `r` / `s` auto-recall / post-submit scroll) stay on
  `center + instant`. Reverses the placement half of commit `4900d4c`;
  the other half (sidebar file-click parity) stands. PRD #348.

  Issue: #348

## [3.1.0] — 2026-05-15

### Added

- **Webapp keyboard sidebar navigation: `Esc` enters the sidebar tree;
  `j`/`k`/`ArrowDown`/`ArrowUp` walk file rows; `Enter` activates;
  `l`/`h` expand/collapse folders (issue #346, PRD #343, ADR 0031).**
  The webapp's file tree gains the same Esc/Enter pane-toggle the TUI
  ships with: `Esc` from the diff enters the sidebar (DOM focus moves
  to the selected row via roving tabindex), `Enter` on a file row
  selects the file and flips back to diff, `Enter` on a folder row
  toggles the fold. `c` / `r` / `s` are silent no-ops while paneFocus
  is sidebar (the user explicitly returns to diff first). Mouse +
  keyboard converge on the same `paneFocus` slice — clicking a sidebar
  row sets paneFocus = sidebar; clicking a diff row or Comment card
  sets paneFocus = diff. `n`/`p` auto-flip paneFocus to diff. The
  sidebar tree carries `role="tree"` / `role="treeitem"` /
  `aria-expanded` (W3C ARIA tree-widget pattern); exactly one row
  holds `tabindex="0"` so browser `Tab` walks the sidebar as a single
  tab stop (preserves WCAG 2.1.1 / 2.4.3). Pane-focus accent border
  (`.app-sidebar[data-pane-focus="sidebar"]`) plus per-row
  `:focus-visible` outline give two redundant visual cues. Empty tour
  → paneFocus = sidebar (first file row selected); Tour with Comments
  → paneFocus = diff (cursor seeded at first Comment — existing
  behavior preserved). Webapp footer legend gains `Esc: sidebar` in
  diff mode and swaps to the shorter sidebar string in sidebar mode.

  Issue: #346

### Changed

- **TUI keybinding: `Tab` / `Shift-Tab` removed; `Esc` now toggles
  between sidebar and diff (modal-unwind takes precedence). Folder-row
  `Enter` toggles the folder (issue #345, PRD #343, ADR 0031).** The
  TUI's two-year-old pane-focus model (`Tab` = toggle, `Shift-Tab` =
  force sidebar) is retired. `Esc` replaces both — pressing it with no
  modal open flips paneFocus between sidebar and diff; pressing it
  with the comment composer or Tour picker open closes the modal
  (existing behavior, unchanged). Folder-row `Enter` now dispatches
  `toggle-folder` (aligns with the W3C ARIA tree-widget convention);
  file-row `Enter` keeps its existing `select-file` semantic. The
  footer legend becomes pane-aware: sidebar mode shows `j/k: file ·
  h/l: fold · Enter: activate · e: expand all · y: yank · L: layout ·
  T: picker · Esc: diff · q: quit`; diff mode drops `Tab: pane` and
  adds `Esc: sidebar`. The cursor and sidebar-row selection are
  preserved across paneFocus flips — Esc-toggle-Esc returns the user
  to the exact prior state. Pre-1.0 semver license (CONTEXT.md
  packaging: "minor=breaking") covers the binding break. Webapp
  half-slice and ARIA tree-widget pattern land in issue #346.

  Issue: #345

## [3.0.0] — 2026-05-15

### Added

- **CLI: `tour comment` is the primary comment verb; `tour annotate`
  is a permanent silent alias (issue #336, PRD #335, ADR 0029).**
  Stage A slice 1/4 of the "Comment replaces Annotation" rename. Both
  verbs dispatch the same handler — identical flags, identical
  `--json` byte-shape, identical exit codes, identical on-disk effect.
  The alias produces no stderr deprecation warning. `tour --help` and
  `tour comment --help` list `tour comment <id> ...` as primary with
  `(alias: annotate)` noted. Human-readable stdout strings flip from
  "annotation"/"annotations" to "comment"/"comments" — `Added comment
  to <id>: <file>:<line>` (single) and `Added N comments to <id>`
  (batch). The "Added reply to <id> in <tour>" line is unchanged
  (Reply was never renamed). JSON wire-format is untouched: same
  fields, same record shape, same discriminator (presence/absence of
  `replies_to`). `README.md` and `skills/tour/*` examples flip to
  `tour comment ...` as the primary form; legacy `annotate` references
  in body prose stay (per Stage A scope — source-identifier rename
  and on-disk `annotations.jsonl → comments.jsonl` migration land in
  Stage B).

  Issue: #336

- **Webapp: annotation-create failures surface as transient footer
  status (issue #334).** The composer's `submitting → errored`
  transition (the runtime dispatches `composer.failed` on adapter
  rejection) now flashes the failure reason in the footer's
  transient status slot — `Comment failed: <reason>.` for top-level
  annotations and `Reply failed: <reason>.` for replies. The reason
  is the server's `error` field when the response is non-2xx with a
  JSON body, the literal `HTTP <status>` when the body is empty /
  non-JSON, and the thrown error's message on a fetch rejection
  (network failure, abort). Status follows the same ~2 s auto-dismiss
  + last-write-wins contract introduced in #333. Successful creates
  do NOT flash — the watcher-driven repaint is the confirmation, per
  PRD #330's Out of Scope (success-case status would be noise). The
  `aria-live="polite"` slot from #333 carries the announcement; no
  new ARIA wiring. Third slice of PRD #330.

  Drive-by: `<CardRow>` (`src/web/client/row-components.tsx`) now
  forwards `composerBody` and `onComposerBodyChange` to its
  `<AnnotationCard>` child. Without it the reply composer mounted via
  the FileBlock path (the resolved-bundle case, i.e. all of normal
  production usage) wired the textarea to a default-empty body with
  an undefined onChange — typed replies stayed in the local DOM but
  never reached the store, so `composer.submit` saw `body.trim() === ""`
  and silently no-op'd. The drive-by unblocks the reply submit path
  the issue's "Reply failed" routing covers.

  Issue: #334. PRD: #330.

- **Webapp: transient footer status surface for cursor-keymap miss
  reasons (issue #333).** The footer's status slot now flashes a
  one-line reason when the cursor-keymap `r` / `s` cross-axis miss
  branches fire — `r` on a diff row says "No annotation under
  cursor.", `s` on a diff row says "Send only works on annotation
  cards.", `s` on a non-human card says "Send only works on human
  annotations.", `s` on a human card while the tour-wide reply-lock
  is held says "`<agent>` is already replying." Status prepends onto
  the legend on the same line (`${status}  ·  ${legend}`), auto-
  dismisses after ~2s, and last-write-wins (a new status replaces the
  current one and resets the timer). The status `<span>` carries
  `aria-live="polite"` + `aria-atomic="true"` so screen readers
  announce the reason without re-announcing the static legend on
  every cursor move. Send-hint conditional on the legend (`s: send
  to {agent}` appears only when `--reply-agent` is set AND the
  cursor is on a human card AND the lock is free) lands in the same
  slice — the underlying `composeFooterHints` predicate already
  matched the TUI's. Slice 2 of PRD #330; the annotation-create
  failure path is deferred to a future slice.

  Issue: #333. PRD: #330.

- **Webapp: footer hint strip on first paint (issue #331).** The webapp
  now mounts a one-line muted footer at the bottom of the column-flex
  root, rendering the static keybinding legend `j/k: move  ·  h/l:
  side  ·  n/p: nav  ·  a: comment  ·  r: reply  ·  L: layout  ·  t:
  picker` — the bound-keys subset of the TUI footer string. First
  slice of PRD #330; the transient status surface (silent-failure
  reasons for `s` / `r` no-ops, network-error feedback, send-hint
  conditional) lands in subsequent slices. The legend composer
  (`composeFooterHints({ surface, replyAgent?, showSendHint? })`)
  lifts to `core/footer-hints.ts` so the shared key vocabulary
  (`j/k`, `h/l`, `n/p`, `a`, `r`, `s`, `L`, `t`) cannot drift
  between surfaces; the TUI consumer is now a thin `surface: "tui"`
  delegate and its output is byte-identical to today.

  Issue: #331

- **Webapp: footer `s: send to {agent}` segment is now dynamic
  (issue #332).** The legend now toggles the send-hint with the
  same predicate the TUI footer uses: `--reply-agent` is configured
  AND the cursor is on a human-authored annotation card AND the
  reply-lock is free tour-wide. Cursor moves, lock acquires /
  releases, and bundle reloads recompute the legend on the next
  render — no new timer or subscription beyond the App's existing
  render-time inputs. When the hint is suppressed, the legend is
  byte-identical to the static slice-1 string. Second slice of
  PRD #330; the transient status surface lands in a subsequent
  slice.

  Issue: #332

### Changed

- **Wire-format change (envelope only): `tour show --json` and `tour
  pickup --json` envelope key renamed from `annotations` to `comments`
  (PRD #335, ADR 0029).** Downstream agent scripts that parse the
  top-level array on either command must update from
  `data.annotations` to `data.comments`. The per-record schema is
  unchanged (`id`, `file`, `side`, `line_start`, `line_end`, `body`,
  `author`, `author_kind`, `created_at`, `replies_to?`, `kind`) — only
  the envelope key shifted. Decision recorded in ADR 0029's Stage B
  addendum; no back-compat alias is added (the CLI verb's permanent
  `tour annotate` alias covers write paths but envelope-key
  compatibility is not symmetric).

- **Source-identifier rename: `Annotation` → `Comment` across source,
  tests, intents, and CONTEXT.md prose (issue #341, PRD #335, ADR
  0029).** Stage B mechanical slice. The `Annotation` type renames to
  `Comment` in `src/core/types.ts`; every type annotation, import, and
  structural use across `src/` and `tests/` updates in lockstep. Module
  files `core/annotations-store.ts` → `core/comments-store.ts`,
  `core/write-annotation-input.ts` → `core/write-comment-input.ts`,
  `web/client/markdown/AnnotationMarkdown.tsx` →
  `web/client/markdown/CommentMarkdown.tsx`, plus paired TUI/test
  files (`tui/AnnotationCard.tsx`, `tui/annotation-jump.ts`,
  `tui/annotation-placement.ts`, `cli/annotate.ts`, and their paired
  test files) all rename to the `comment` vocabulary; every import
  that pointed at the old paths now points at the new ones. Function
  renames sweep through `createAnnotation` → `createComment`,
  `createAnnotations` → `createComments`, `readAnnotations` →
  `readComments`, `latestAnnotationId` → `latestCommentId`,
  `cursorFromAnnotation` → `cursorFromComment`, plus every other
  identifier carrying `Annotation` / `annotation`. The four keymap
  intent strings flip atomically: `next-annotation` → `next-comment`
  and `prev-annotation` → `prev-comment` (TUI),
  `nav-next-annotation` → `nav-next-comment` and
  `nav-prev-annotation` → `nav-prev-comment` (webapp); the verb
  intent `annotate-at-cursor` becomes `comment-at-cursor`. The
  `triggering_annotation` field on the agent-adapter envelope renames
  to `triggering_comment`. `LEGACY_ANNOTATIONS_FILENAME` and the
  string literal `"annotations.jsonl"` stay — they name the legacy
  on-disk filename per ADR 0029 addendum. CLI verbs (`tour annotate`
  alias, `case "annotate":` switch arm) stay — permanent alias per
  PRD #335. The "Rename in flight" callout at the top of CONTEXT.md's
  Language section is removed; the body prose flips. JSON wire-format
  (`--json` output keys: `id`, `file`, `side`, `line_start`,
  `line_end`, `body`, `author`, `author_kind`, `created_at`,
  `replies_to`, `kind`) is unchanged. No behavioural change —
  identifier-only rename. Test count: 2147 / 2147 pass.

  Issue: #341

- **On-disk: `annotations.jsonl` → `comments.jsonl` with permanent
  read-fallback (issue #342, PRD #335, ADR 0029 addendum).** Stage B
  on-disk slice. The per-Tour Comment log filename is now
  `comments.jsonl`. New Tours write only `comments.jsonl`; the first
  write to a pre-Stage-B Tour folder that has only `annotations.jsonl`
  atomically renames the file (`fs.promises.rename`, atomic on POSIX
  for same-volume renames; Tour is single-machine, single-volume per
  ADR 0020) and then appends the new record. The reader checks
  `comments.jsonl` first and falls back to `annotations.jsonl` when
  the new name is absent — this fallback path stays in the codebase
  indefinitely per the ADR 0029 addendum so existing `.tour/` dirs in
  the wild keep working without an explicit migration step. The FS
  watcher fires on either filename (the `.jsonl` extension match
  already covered both; the dedup fingerprint now prefers
  `comments.jsonl` and falls back to `annotations.jsonl`). If both
  files exist (impossible in practice — would mean a partial
  migration), the writer logs a stderr warning, leaves the legacy
  file alone, and treats `comments.jsonl` as authoritative. JSONL
  record schema is unchanged; the `--json` wire-format is unchanged.

  Issue: #342

- **Webapp keybindings: `a → c` and `t → T`; status messages flip
  from "annotation" to "comment" (issue #338, PRD #335).** Stage A
  slice 3/4 of ADR 0029 (Comment replaces Annotation) + ADR 0030
  (lowercase = cursor-target, capital = global). Bare `c` on a row
  dispatches `annotate-at-cursor` (was `a`); `T` (Shift+t)
  dispatches `open-picker` (was `t`). Bare `a` and bare `t` are now
  unbound noops — hard cutover, no alias. The three cross-axis-miss
  status messages flip vocabulary: `No annotation under cursor.` →
  `No comment under cursor.`, `Send only works on annotation
  cards.` → `Send only works on comment cards.`, and `Send only
  works on human annotations.` → `Send only works on human
  comments.`. The footer legend reads `c: comment` and `T: picker`.
  The TUI side of the rebind lands in slice #337; this slice only
  touches the webapp branch in `core/footer-hints.ts`.

  Issue: #338

- **Reply-agent system prompt: "Annotation" → "Comment" (issue #339,
  PRD #335, ADR 0029).** The Tour-canonical reply-agent system prompt
  in `src/core/system-prompt.ts` now says "responding to a Reply or
  Comment" and "writes that as the Comment body — verbatim". Both
  occurrences of "Annotation" flip to "Comment" so the LLM's output
  vocabulary aligns with what the rest of the system (UI, CLI,
  footer, glossary) now says. Output contract, capability boundary,
  always-reply, and style sections are unchanged in shape. Slice 4/4
  of Stage A; the highest-leverage single edit since the prompt
  shapes what every reply-agent invocation writes from this release
  forward. The snapshot test in `tests/core/system-prompt.test.ts`
  is updated atomically and locks the new text against accidental
  edits.

  Issue: #339. PRD: #335. ADR: 0029.

### Fixed

- **TUI: picker close now uses Shift+T instead of bare `t` (issue #340,
  ADR 0030).** The picker-open key handler in `src/tui/app.tsx` was
  the last surviving bare-`t` binding after the #337 cutover —
  pressing `t` while the picker was open closed it, bypassing the
  dispatcher (which already returns noop for bare `t` everywhere
  else). Picker open/close is now symmetric: `T` (Shift+t) toggles
  the picker in both directions. `Escape` continues to close the
  picker (no regression). Bare `t` is a plain noop in this state too,
  consistent with the dispatcher. The close arm was extracted into a
  small pure helper (`src/tui/picker-keymap.ts`) so the picker
  overlay's keyboard contract is exercisable in isolation.

  Issue: #340

## [2.5.0] — 2026-05-15

### Added

- **TUI: `y` yanks the focused file's repo-relative path to the system
  clipboard (issue #326).** Webapp parity for the copy-path affordance
  added by issues #16 / #225 / #317 / #319. Pressing `y` resolves the
  focused file with the same permissive policy as `e`'s expand-all —
  the row / card cursor first, then the sidebar's selected file row as
  a fallback — and writes the path to the clipboard. Primary transport
  is the platform clipboard binary (`pbcopy` on macOS, `wl-copy` /
  `xclip` / `xsel` on Linux, `clip` on Windows), shelled out via
  `spawnSync`; falls back to opentui's OSC 52 renderer API when the
  binary isn't on PATH (e.g. SSH sessions). Feedback is a one-line
  footer hint reading `Copied <path>` that auto-clears after ~1.2 s
  (same duration as the webapp's checkmark window in #319). When no
  file resolves (empty tour, no cursor, sidebar parked on a folder)
  the footer surfaces `y: no file under cursor` instead of going
  silent.

  Issue: #326

- **Webapp: drag-resizable sidebar with auto-fit on every tour switch
  (issue #323).** The previous `width: 280px; flex-shrink: 0` sidebar
  had no resize affordance — keyboard-only users had no escape valve
  for ellipsised paths and mouse users had to fall back to the hover
  tooltip on every truncated row. Now: a thin drag handle on the
  sidebar's right edge (`role="separator"`, `cursor: col-resize`)
  lets the user resize via `pointerdown` → `pointermove` →
  `pointerup`, with `setPointerCapture` so the drag survives the
  pointer leaving the window. Auto-fit runs once per tour switch
  against the visible tree rows, computing the minimum pixel width
  that fits the widest row's chevron / icon / displayName / badge
  decorations without `text-overflow: ellipsis` clipping.

  Cap formulas mirror the TUI's #312 / #315 work: auto-fit clamps at
  `viewportWidth - 600px` (defensible diff-pane floor), drag clamps
  at `viewportWidth - 240px` (only the symmetric sidebar floor), so
  an explicit user gesture can squeeze the diff past the auto-fit
  floor but auto-fit cannot. Both clamps share `SIDEBAR_MIN_PX = 240`
  as the lower bound.

  Both writers (auto-fit + drag) capture the cursor row's on-screen
  `getBoundingClientRect().top` BEFORE the `setSidebarWidth` write
  and apply `window.scrollBy(delta)` in a `useLayoutEffect` AFTER
  React commits the new width but BEFORE the browser paints. Without
  the wire, an annotation card above the cursor reflowing under the
  width change would walk the cursor up or down the screen — same
  failure mode the TUI's #318 / #303 follow-ups fixed.

  Manual drag width is session-local (mirrors the TUI semantics).
  Switching tours re-runs auto-fit; the drag override does NOT carry
  over. Folder expand / collapse within a tour does NOT re-fit. The
  layout-toggle preserveScreenY effect is unchanged — the new
  resize-apply effect is a parallel `useLayoutEffect` keyed on
  `sidebarWidth` (vs. `layout`).

  Issue: #323

- **Webapp: GitHub-style `+` button on every annotatable diff row
  (issue #320).** Hidden by default, revealed on row `:hover` and on
  the Cursor's focused side. Click opens the top-level Composer at
  `(file, side, line)` with `line_start == line_end` — one-click
  parity with GitHub's `+`, replacing the prior two-step `click-row →
  press a` mouse path. The existing keyboard `a` shortcut is
  unchanged; both paths converge on the same `composer.open`
  dispatch.

  When a Composer is already open (any of `open` / `submitting` /
  `errored`), every `+` reads in a muted **ghost** state and clicking
  invokes **auto-recall**: a new `composer.recall` reducer action
  emits a `scrollToComposer` intent that the web adapter realises as
  "scroll the in-flight Composer's anchor row into view + focus its
  textarea." The user can't open a second Composer while one is in
  flight and can't lose the in-flight one by scrolling away. CSS keys
  the ghost state off a `data-composer-open` attribute on `<html>`
  (mirrored to `composer.kind !== "closed"`).

  Side-effects: removed the `cursor: pointer` rule on annotatable
  `.tour-row[data-line-type=...]` selectors — the `+` button is now
  the only visible "click me" cue on a row. Row click still seeds the
  cursor (unchanged). The button is `tabIndex={-1}` so it stays out
  of Tab order; the keyboard `a` flow remains the canonical keyboard
  path. Empty-side gutters, interactive rows, and rows without an
  `onAnnotate` callback render no button. TUI is unaffected (no mouse
  hover surface; v1 of the TUI adapter implements `scrollToComposer`
  as a row-only scroll, no textarea focus parity).

  Issue: #320

### Changed

- **Default diff layout is now Unified on first open (issue #329).**
  The initial value of `TourSessionState.layout` flips from `"split"`
  to `"unified"`. Tour is annotation-driven, not diff-driven: users
  come to read a walkthrough, and unified's narrative top-to-bottom
  flow lines up with `n`/`p` annotation traversal — split forces eye
  zig-zag between columns while cards sit one side or span both.
  Cards also render cleanly inline as a row between diff lines in
  unified, where split clusters them one side or forces alignment
  beneath. And Tour eats more horizontal width before the diff
  starts (sidebar + annotation cards) than general code-review tools
  do, so halving the remaining real estate hurts more here. Split
  remains one click / keystroke away (`LayoutToggle` button on web,
  `Shift+L` on TUI); only the never-touched default changes. Users
  who explicitly chose Split see no change once per-tour persistence
  is wired (the persistence shape itself is unchanged by this issue).

  Issue: #329

- **Internal: scalar sidebar-width clamps lifted to `src/core/`
  (issue #328).** The TUI and webapp each inlined the same pair of
  clamp formulas — auto-fit `[hardMin, max(hardMin, container -
  softMin)]` and manual `[hardMin, max(hardMin, container - hardMin)]`
  — in different units (cols vs. px). The math is byte-identical;
  only the constants differ. Both `clampSidebarWidth*` exports now
  thin-wrap `clampPaneWidth` / `clampPaneWidthManual` in
  `src/core/sidebar-width-clamp.ts`, so any future change to the clamp
  shape (e.g. a hysteresis band or a soft warning ceiling) is applied
  once rather than twice. Per-surface call sites and existing tests
  are unchanged. `computeAutoFitWidth*` stays per-surface — it couples
  to row-cost helpers in different units, and threading a units-aware
  indent spec would be more invasive than the lift solves.

  Issue: #328

- **Webapp file header: copy-path button moved next to the filename
  (GitHub parity, issue #317).** The per-file sticky header's left
  region now renders `chevron · status-icon · rename-indicator? ·
  filename · copy-path`; the right region keeps the reason tag, diff-
  stats indicator, and the per-file Expand-all `↕` button (when ≥ 2
  hidden gaps). The button's behaviour is unchanged from #225 (click
  writes `file.name` to the clipboard, does NOT toggle collapse,
  keeps `aria-label="Copy file path"` and its hover chrome). The
  filename span gains `min-width: 0` + `overflow: hidden; text-
  overflow: ellipsis; white-space: nowrap` so a very long path
  truncates the filename instead of pushing the button or right
  region off-row.

  Issue: #317

### Fixed

- **TUI: tour-picker rows now react to mouse clicks (issue #321).**
  When the picker was open, the keyboard branch (`j`/`k`/`Enter`/
  `Esc`/`t`) worked but row clicks were silently swallowed — mouse
  users had no way to commit a tour without first reaching for the
  keyboard. The TUI picker (`src/tui/TourPicker.tsx`) is now a
  controlled view that accepts an `onSelect(idx)` prop and wires
  `onMouseDown` on every row to it; the host (`src/tui/app.tsx`)
  dispatches the same `picker.move` + `picker.commit` / `picker.close`
  sequence the keyboard's Enter branch already does: align cursor to
  the clicked row, then close-without-commit when the clicked row is
  the currently loaded tour, else commit. Matches the web picker's
  click semantics (which has had `onClick` on every row since the
  picker landed). Out of scope per the issue brief: hover-to-preview,
  scrim / click-outside-to-dismiss, and any reducer changes.

  Issue: #321

- **Webapp sidebar resize: active-file fallback when no cursor is set
  (issue #327, #323 follow-up).** The preserveScreenY plumbing on web
  fired only when a cursor was present — both writers (auto-fit
  `useEffect` and the drag handler) wrapped their snapshot capture in
  `if (cursor)`, so users who hadn't keyboard-navigated yet saw the
  diff body shift visibly under their eyes during a drag. The
  resize-apply `useLayoutEffect` early-returned on `if (!snap)`, no
  `window.scrollBy` ran, and the natural reflow on width change was
  exactly the failure mode #323's wire was supposed to suppress.

  Fix: a new pure helper `resizeReanchorTarget(cursor, flatRows,
  activeFile)` returns a discriminated descriptor — `{ kind: "cursor";
  cursor }` when the cursor exists and (for row cursors) resolves in
  `flatRows`, `{ kind: "file"; path }` when not but a sticky-header
  active file is set, else null. Both writers route through a shared
  `captureResizeSnapshot` callback that materialises the descriptor to
  an `HTMLElement` (`findCursorRowEl` for cursor targets,
  `findFileBlock` for file targets) and writes `{ top, target }`. The
  resize-apply `useLayoutEffect` re-resolves the same descriptor
  post-reflow and `window.scrollBy(delta)`s the difference. Mirrors
  the TUI's `resizeReanchorTargetId` priority (#318); the two surfaces
  duplicate with parallel documentation — DOM idioms differ
  (HTMLElement vs OpenTUI id) so a shared helper would have to thread
  a units-aware target spec through both, more invasive than the
  duplication.

  The layout-toggle preserveScreenY effect is unchanged — its input
  (`Shift+L`) is cursor-conditioned, so the no-cursor case there is
  different UX and out of scope.

  Issue: #327

- **Webapp annotate `+` button: per-side hover reveal in split layout
  (issue #325, #320 follow-up).** The hover-reveal rule was row-scoped
  (`.tour-row:hover .tour-row-annotate-btn`), so the descendant
  combinator matched every `.tour-row-annotate-btn` inside the hovered
  row — and in split layout that's two buttons, one per gutter.
  Hovering anywhere on a row revealed both `+`s simultaneously, against
  the locked per-side semantics from PRD #320's prototype phase and
  against GitHub's actual behaviour. The cursor-side reveal was already
  correctly side-scoped via `:has(.tour-row-cell[data-side="X"]
  .is-cursor)`; only the hover branch regressed. The fix scopes hover
  via `:has()` on a `[data-side]:hover` descendant — the gutter, symbol,
  and code cell on each half all carry `data-side`, so any of them
  under the pointer selects only that side's gutter + button. The
  button itself has no `data-side` but lives inside the gutter, so
  button-hover bubbles to gutter-hover and the rule keeps firing while
  the pointer sits on the button. Unified layout is unaffected (a
  single side per row). Ghost state inherits the same per-side reveal
  selectors via the `[data-composer-open]` attribute on `<html>`.

  Issue: #325

- **Webapp Composer auto-recall: unfold the anchor file before scrolling
  (issue #324, #320 follow-up).** When a Composer was open and the
  reviewer clicked a ghost `+` button while the in-flight Composer's
  anchor file was folded (manual user-fold, binary classification, or
  classifier-collapsed banner), the recall silently no-op'd — the web
  adapter's `scrollToComposer` queried the gutter cell inside the file
  block, the cell didn't exist because the rows weren't rendered, and
  the textarea-focus fallback was scoped to the same block. The user
  saw nothing happen and had to scroll or unfold manually to find the
  in-flight Composer.

  The adapter now follows the explicit-reveal pattern already used by
  `n` / `p` / URL `?ann=` restore: if the anchor file's body is hidden
  at recall time, dispatch `folds.setOverride { value: false }` to
  unfold first, then defer the scroll one rAF so React commits the
  unfolded body before the gutter-cell query runs. Visible files skip
  the dispatch (no redundant state churn). Reply targets inherit the
  same fix — the recall reads the parent annotation's file from the
  bundle and unfolds it the same way. Honest unreachable cases (parent
  annotation removed from the bundle between Composer-open and recall)
  remain a defensive no-op. PRD #320's *Further Notes* called this
  sequencing out explicitly; the shipped #320 implementation skipped it.

  Issue: #324

- **Annotation submit on large tours: new card renders in the same commit as
  composer dismissal (issue #322).** Before: the `composer.submitted`
  reducer transitioned the composer slice to `closed` (textarea removed
  from the DOM) and emitted `scrollToAnnotation`, but the new annotation
  card wasn't in `state.bundle.annotations` yet — that took a server-side
  `annotation-changed` SSE round-trip → full bundle re-fetch → `bundle.
  refreshed` dispatch (~500-600 ms on large tours, scaling with bundle
  size). The user saw an empty interval between "my textarea vanished"
  and "my annotation appeared", and the `scrollToAnnotation` intent fired
  against a card the ref map didn't yet contain — effectively a no-op
  until refresh. The POST response already carries the canonical
  `Annotation`; the reducer now folds it into the resolved bundle's
  `annotations` array on the same dispatch that closes the composer.
  Multi-client correctness preserved: the SSE-triggered `bundle.
  refreshed` still arrives later and overwrites the whole array,
  naturally de-duping by id (collision on the same dispatch is also
  guarded). Applies to both top-level annotations and replies (they
  share the same reducer branch). No-op on the bundle slice when the
  bundle isn't resolved (defence in depth).

  Issue: #322

- **Webapp file header: copy-path button now shows a checkmark for ~1.2 s
  after a successful clipboard write (restores #16, dropped during the
  #225 chrome restructure, issue #319).** Clicking the per-file copy-path
  button was fire-and-forget — clipboard write happened, but the icon
  never changed, so users had to paste somewhere to verify the copy
  landed. The button now swaps the CopyIcon for a CheckIcon for 1.2 s on
  a successful `navigator.clipboard.writeText` resolution, then reverts.
  Failure stays silent (no error icon, no toast — matches GitHub). Rapid
  re-clicks re-copy and re-arm the 1.2-s revert timer. The button's CSS
  gains a `min-width: 24px` so the icon swap is layout-stable (the two
  octicons share a 16 px intrinsic size today, but pinning the bounding
  box absorbs any future drift between the glyphs). The pending timer
  is cleared on unmount via a `useEffect` cleanup so a stale callback
  can't fire `setState` against a detached fiber.

  Issue: #319

- **TUI: `[`/`]` sidebar resize no longer drifts the diff viewport (issue
  #318).** The diff pane is a `flexGrow={1}` sibling of the fixed-width
  sidebar, so a width change reflows annotation cards (markdown blocks
  word-wrap to the new pane width). The scrollbox preserved `scrollTop`
  as a row offset across the re-render, so any card above the viewport
  that grew / shrank by N rows shifted everything below it by the same
  delta and the user's visual position drifted. After every `[`/`]`-
  driven width change, the diff scrollbox now re-anchors to the cursor
  row when a cursor exists (same culling-safe `scrollChildIntoView`
  primitive the cursor-tracking effect uses), falling back to the
  active file's card (`file-card-${activeFile}`) when no cursor is
  present. Tour-open auto-fit is unaffected: it didn't depend on
  scrollTop preservation, and the new re-anchor only fires from the
  keypress path.

  Issue: #318

## [2.3.0] — 2026-05-14

### Changed

- **Hunk-header banner is now a two-cell layout with the primary expand
  button on the leftmost cell (issue #280).** GitHub puts Expand Up /
  Expand All on the same row as the `@@` text — only the second
  `Expand Down` for mid-file large gaps is a standalone row above the
  banner. Tour was emitting one extra row per hunk vs GitHub (3 rows
  instead of 2 for mid-file large gaps; 2 rows instead of 1 for small
  gaps and file-top). This release folds `Up` / `All` onto the
  banner's left cell and keeps `expand-down` as the only standalone
  interactive row. `HunkHeaderRow` gains a
  `primaryExpand: "up" | "all" | null` field; `InteractiveSubKind`
  loses `expand-up` and `expand-all`; the file-bottom path always
  emits a single `expand-down` row regardless of gap size. The web
  banner exposes `role="button"` / `tabIndex={0}` on the left cell
  only — clicking the `@@` text does nothing (matches GitHub). The
  TUI mirrors the same shape with a saturated `bg.accentEmphasis`
  left cell carrying `↑` / `↕` / `…`. Cursor walks the banner via the
  existing `boundary-top` / `hunk-separator` identity whenever
  `primaryExpand !== null`.

  Issue: #280


## [2.0.0] — 2026-05-12

### Removed

- **Shift+Enter / Shift+Click whole-gap modifier removed from both
  surfaces (issue #275, PRD #270 Slice 5).** With the per-file
  `Expand all hidden` button (issue #274 / Slice 4) shipped as the
  whole-file escape hatch, the `Shift`-modifier short-circuit on
  interactive expand rows is no longer carrying its weight. The TUI
  keymap's `primary-action-all` action type is gone; `dispatchKey`
  returns `primary-action` on `Enter` regardless of `Shift`. The web's
  `<InteractiveRow>` strips the `e.shiftKey` branch from its `onClick`
  / `onKeyDown` handlers — `interactiveRowCount` reduces to
  `expand-all → gapAbove, everything else → EXPANSION_STEP`. The
  `expansionCount` helper is removed. The web `App.tsx` Enter handler
  drops the `Math.max(gapSize, EXPANSION_STEP)` Shift escalation.
  Net effect: maximally simple mental model — Enter / click does what
  the cursor is on; reviewers who want whole-file expansion use the
  per-file Expand-all button; reviewers who want directional 20-line
  expansion use Enter on Up / Down / All rows.

  Issue: #275

### Changed

- **Web: hunk-header banner is now display-only; the `#252` `::before`
  cue is removed (issue #272, PRD #270 Slice 2).** Slice 1 (issue #271)
  introduced explicit directional `expand-up` / `expand-down` /
  `expand-all` interactive rows as the cursor-walkable affordance for
  revealing hidden context. Slice 2 retires the now-redundant click
  target on the `<HunkHeaderBanner>` itself: the component drops its
  `onClick`, `onKeyDown`, `role="button"`, `tabIndex={0}`, and
  `onActivate` prop, becoming a pure display component that renders
  the parsed range segment (`@@ -X,Y +Z,W @@`) and function-context
  tail only. The `.tour-hunk-header::before` rule (the saturated-blue
  44px cue with a `…` glyph added in #252) is removed from
  `file-grid-css.ts`; `position: relative` and the 60px left-padding
  carve-out revert to the pre-#252 16px symmetric inset; `cursor:
  pointer` is dropped. `flatRows` no longer promotes hunk-header
  planner rows to interactive cursor stops — the cursor steps over
  the banner with `j` / `k` and lands on the next interactive row
  (typically a directional expand button or a diff row). The `data-
  subkind` / `data-direction` / `data-boundary-ref` attributes remain
  for selector-based lookups; the `.is-cursor` outline rule is
  retained structurally even though the cursor no longer walks here.

  Issue: #272

- **Top header right cluster: tour-level diff stats `+N -M` now leads,
  annotation-nav pill and layout toggle follow (issue #277).** Both
  surfaces previously read `‹ n/N › +N -M [Split | Unified]` — a static
  info element sandwiched between two interactive controls. The cluster
  now reads `+N -M ‹ n/N › [Split | Unified]`, matching GitHub's PR
  header strip convention: stats lead the right side as a navigational
  landmark, interactive controls (nav + toggle) cluster together after
  it. Empty / pure-addition / pure-deletion tours retain the existing
  per-side render rules — when both counts are zero the indicator
  renders nothing and the cluster collapses cleanly to `‹ n/N › [Split |
  Unified]` with no orphan leading gap. The TUI's TourStatsIndicator
  internal 1-col spacer flips from leading to trailing so the gap-to-
  next-sibling stays attached to the indicator's render condition (no
  orphan spacer when the indicator is null). No prop-surface change on
  any of the three components; no CSS class additions.

  Issue: #277

### Added

- **TUI: hunk-header banner adopts the directional `expand-up` /
  `expand-down` / `expand-all` model (issue #273, PRD #270 Slice 3).**
  Sibling change to #271 on the TUI surface. The TUI's hunk-header
  banner becomes a display-only metadata row — no DiffLine pipeline,
  no cursor-on-banner visual, no click handler — at every `gapAbove`.
  The cursor walks past it via `j` / `k`; the directional rows the
  planner emits adjacent to the banner are the only cursor-walkable
  affordances. A new `hunkHeaderCursorStop?: boolean` option on
  `flatRows()` (vestigial after Slice 2 landed — both surfaces now
  unconditionally skip hunk-header rows) is threaded through
  `deriveTourSessionView` / `useTourSessionView` so the TUI's view
  call passes `hunkHeaderCursorStop: false`. The TUI's
  `dispatchPrimaryAction` switch sheds the now-unreachable
  `hunk-separator` / `boundary-top` / `boundary-bottom` cases (and
  their orphan helpers `expandHunkBoundary` / `expandTopBoundary` /
  `expandBottomBoundary`); the `expand-up` / `expand-down` /
  `expand-all` cases route through the existing `expandDirectional`
  helper. Directional row text (`↑ Expand Up` / `↓ Expand Down` /
  `↕ Expand All N lines`) is painted from the planner's
  `expandRowText`, so cross-surface glyph consistency holds.

  Issue: #273

- **Per-file Expand-all-hidden affordance + `expand-file-all`
  reducer action (web + TUI) (issue #274, PRD #270 Slice 4).**
  A new pure helper `expandFileAll(state, file, boundaries)` in
  `core/expansion-state.ts` saturates every hidden gap in a single
  file in one pass (top / mid-file separators / bottom), reusing the
  existing per-boundary direction convention. A matching
  `expansion.expandFileAll` reducer action wraps it. The web file-
  header chrome gains a new icon-only button between the diff-stats
  indicator and the copy-path button — `aria-label="Expand all
  hidden context in this file"`, ASCII `↕` glyph (no Octicons per
  PRD scope), `event.stopPropagation()` mirrors the copy-path
  pattern from #225 so click does NOT toggle file collapse. The TUI
  surface opts in to a new planner option
  `emitExpandFileAllAffordance` (threaded through
  `useTourSessionView` / `deriveTourSessionView`) that emits a
  single `expand-file-all` interactive row at the very top of each
  file with hidden gaps; the cursor walks it like any other
  interactive row and `Enter` dispatches the same `expand-file-all`
  action. The row stops emitting once every gap is saturated (same
  "row gone when nothing to do" rule as the directional family).
  The web leaves the option off — its row stream is unchanged and
  the chrome button is the affordance.

  Issue: #274

- **Web: GitHub-style directional + Expand-All buttons replace the
  legacy `gap-mid-top` row family (issue #271, PRD #270 Slice 1).**
  The planner's `InteractiveSubKind` vocabulary gains three variants —
  `expand-up`, `expand-down`, `expand-all` — and loses `gap-mid-top`.
  A new pure helper `expandRowsForGap(gapAbove, isFirst, isLast)`
  encodes the per-edge-position + gap-size rules: `gapAbove === 0`
  emits no rows; `gapAbove < 40` emits a single `↕ Expand All ${gapAbove}
  lines` row that dispatches `direction: "both"` with `count =
  gapAbove`; `gapAbove >= 40` mid-file emits a two-row pair
  `[↓ Expand Down, ↑ Expand Up]` (DOM order: Down first at the top of
  the gap, Up second just above the hunk-header) that dispatch
  `direction: "down"` / `direction: "up"` respectively with the
  EXPANSION_STEP count; `gapAbove >= 40` file-top emits a single
  `↑ Expand Up`; `gapAbove >= 40` file-bottom emits a single
  `↓ Expand Down`. All three new subkinds render through the existing
  `<InteractiveRow>` primitive using its `glyph` field; the planner
  paints the row text from `expandRowText`. The reducer's
  `direction: "up" | "down" | "both"` state machine is reused
  unchanged — only the renderer + planner vocabulary changes. The
  `<HunkHeaderBanner>` click handler stays as a fallback during this
  slice (Slice 2 makes it display-only). The file-bottom path
  replaces the standalone `boundary-bottom` emission with the same
  directional family at `boundaryRef: "bottom"`; the `boundary-bottom`
  subkind remains in the vocabulary so the existing reducer / cursor
  paths keep routing. The TUI cursor dispatch grows handler cases for
  the new subkinds so cross-surface cursor walks still produce the
  right action; the TUI visual rendering of the new rows is in Slice
  3.

  Issue: #271

### Fixed

- **TUI: split-layout vertical divider now extends continuously through
  wrapped rows (issue #269, sibling fix to #267).** Pre-fix, the
  1-cell-wide divider column between the deletions and additions halves
  was a stretched `<box>` containing a single `│` (U+2502) text glyph.
  The box correctly stretched to the row's full visual height via
  `alignSelf="stretch"`, but the glyph is a leaf that occupies one
  cell — so on wrapped rows where the populated half spans N visual
  rows, the divider painted the glyph on visual row 1 and left N − 1
  cells of unpainted terminal background (a visible black gap) for
  visual rows 2..N. Issue #267 fixed the analogous bug on the side
  halves via flex-direction trickery, but the divider column couldn't
  take that route (its content is a leaf glyph). The fix replaces the
  glyph with a `backgroundColor={theme.border.muted}` paint on the
  same stretched box — same pattern as `DiffLine`'s annotation accent
  stripe (a 1-cell-wide `alignSelf="stretch"` box with `bg`, no glyph
  child). The bg paints the box's full height regardless of wrap
  depth, with no dependency on a per-visual-row repeated glyph.
  Un-wrapped rows render visually identically to before (1-cell
  vertical bar in `theme.border.muted`). Unified layout is unchanged
  (no divider). Annotation rows in split layout are unchanged (no
  divider between the card + empty sibling). Banner rows (hunk-header,
  interactive) take the full-width branch and continue to break the
  rule. The now-orphan `DIVIDER_GLYPH` constant is removed in the
  same commit per CLAUDE.md's "remove orphans" rule.

  Issue: #269

- **TUI: context-row gutter line numbers now render in `fg.muted` so
  bright numbers anchor scan on tinted rows (issue #268, inverse of
  webapp #248).** Pre-fix, `DiffLine.tsx`'s gutter `<text>` rendered
  with no explicit `fg`, inheriting OpenTUI's default white-ish
  foreground (`rgb(240, 246, 252)` ≈ `theme.fg.default`). Result:
  every gutter line number painted in `fg.default` regardless of row
  kind — context rows pulled attention away from the actual diff
  content because their numbers shone as brightly as the
  addition/deletion numbers on the `*Range.tui` rails. The fix is a
  one-line derivation inside `DiffLine`: `gutterFg = diffBg ?
  theme.fg.default : theme.fg.muted`, applied as `fg` to the existing
  gutter `<text>` element. Tinted rows (`addition` / `deletion`,
  including paired-change halves in split) keep `fg.default` so
  numbers stay readable against the bright tinted rail; context rows
  (no `diffBg`) drop to `fg.muted` (`#9198a1`). The `+`/`-` sign cell
  (post-#257) follows automatically — it shares the gutter `<text>`.
  Cursor glyph (`CURSOR_FG`) is independent, sitting on its own
  `<text>` element. Annotation tint composition, two-tone diff bg
  composition, empty-side neutral fill, hunk-header `mutedText`
  path, and the interactive-row branch are all unchanged.

  Issue: #268

- **TUI: empty half of a split-layout row no longer leaves a black gap
  when the populated half wraps (issue #267, parity with webapp #227).**
  Pre-fix, the TUI's split-layout rows nested each `DiffLine` inside a
  50%-width click wrapper with default (column) flex direction. When
  the populated half's content wrapped to N visual rows, the outer row
  container stretched to match, and the opposite click wrapper
  inherited the N-row height via the parent's default
  `alignItems="stretch"`. The `DiffLine` inside it, however, has
  `minHeight={1}` on its outer `<box>` and no `alignSelf="stretch"` /
  `flexGrow` against the wrapper's main axis — so it stayed 1 visual
  row tall, leaving N − 1 rows of unpainted terminal background (a
  visible black gap below the empty half's line-number cell). The fix
  is one prop on each 50%-width wrapper: `flexDirection="row"`. The
  wrapper hosts a single `DiffLine` child, so swapping the wrapper's
  main axis from column to row leaves child placement structurally
  unchanged but flips the default `alignItems="stretch"` onto the
  cross axis = vertical. The wrapper's N-row height now transmits to
  the `DiffLine`'s outer box, whose internal sub-boxes (accent stripe,
  gutter bg, content-bg wrapper) already escape its own
  `alignItems="flex-start"` via `alignSelf="stretch"` — so every bg
  layer (neutral fill / diff bg / annotation tint / cursor) paints
  across the wrapped row height for free. The line-number text stays
  anchored to visual row 1 (the `flex-start` pin inside `DiffLine` is
  preserved). Unified-layout rows are unaffected (single `DiffLine`
  per row, no sibling height mismatch); annotation rows in split
  layout are unchanged (their empty sibling already inherits the
  card's intrinsic row height through the outer row container).

  Issue: #267

- **TUI: tour-level diff stats `+N -M` in the top header (issue #266,
  parity with webapp #233).** Pre-fix, the TUI's top header carried
  hamburger toggle, tour title, source labels, annotation nav, and the
  Split/Unified toggle — but no tour-level diff stats. The webapp ships
  a `<TourStatsIndicator>` between the annotation nav and the layout
  toggle that sums additions / deletions across every file in the
  bundle. The TUI now renders the same `+N -M` text indicator in its
  top header's right cluster, between the SequencePill and the
  LayoutToggle. `+N` paints in `theme.fg.success`; `-M` in
  `theme.fg.danger`; a single-space gap separates them. Zero totals
  render nothing (a degenerate empty-diff tour would otherwise pay a
  `+0 -0` cost for no signal). Pure-addition / pure-deletion tours
  render only the non-zero side. The pure `countDiffStats` /
  `tourDiffStats` helpers move from `src/web/client/diff-stats.ts` to
  `src/core/diff-stats.ts` so both surfaces consume the same code;
  `proportionSegments` rides along (still webapp-only at the call
  site). Stats are memoized against the bundle / file-metadata refs —
  cursor moves, layout toggles, expansion changes, and annotation
  navigation do NOT re-walk.

  Issue: #266

- **TUI: per-file diff stats `+N -M` next to the sidebar file label
  (issue #265, parity with webapp #228).** Pre-fix, the TUI sidebar
  rendered each file as ` ${indent}${icon} ${name} [${N}] ` with the
  annotation count `[N]` as the only per-file numeric indicator —
  reviewer could not tell at a glance whether a file was a 5-line or
  500-line change. The webapp's #228 added a `+N -M` count + 5-segment
  proportion bar to each file's header; the TUI's natural analogue is
  the sidebar entry. The sidebar now renders `+N` in
  `theme.fg.success` and `-M` in `theme.fg.danger` between the
  filename and the annotation badge (e.g. ` M app.tsx +43 -27 [3] `).
  Segments are omitted when their count is 0: deleted files show only
  `-M`, new files show only `+N`, pure-rename files (no content
  change, both counts 0) render no stats segments. Stats are derived
  via the shared `countDiffStats` helper (relocated from
  `src/web/client/diff-stats.ts` to `src/core/diff-stats.ts` for
  cross-surface reuse) fed the file's `PlannedRow[]` from
  `rowsSlice.plannedRowsByFile`. `fileRowLabel` (returning one string)
  is replaced by `fileRowSegments` (returning structured leading /
  additions / deletions / badge / trailing segments) so the renderer
  can paint each segment in its own `<text>` foreground; the row is a
  flex-row `<box>` with the selected-row background applied to the
  box, preserving the existing selection highlight. `fileRowFixedCost`
  now takes the per-file stats so the name budget shrinks to make
  room for the stats segments — long filenames continue to truncate
  with `…`. No theme change, no planner / cursor / expansion /
  annotation-model change. No proportion bar in the TUI (text-only,
  same call as #233).

  Issue: #265

- **TUI: hunk-header rows now carry a `…` expand-affordance glyph at
  the leftmost edge (issue #264, mirrors webapp #252).** Pre-fix, the
  TUI hunk-header row gave no rest-state visual cue that it was
  interactive — a reviewer couldn't tell from looking at it that
  navigating the cursor onto it and pressing Enter would expand
  hidden context (per ADR 0013). The webapp shipped #252 with a
  saturated 44px `bg.accentEmphasis` block + `…` dots in white at
  the leftmost edge of the banner. The TUI's terminal-native
  equivalent: prepend a `…` (U+2026 HORIZONTAL ELLIPSIS) glyph
  painted in `theme.fg.accent` at column 0 of every hunk-header row
  (both the inert `gapAbove === 0` and the interactive `gapAbove > 0`
  paths). The accent-coloured glyph contrasts with the muted header
  text and reads as a "this row is interactive" cue. Path B from the
  brief: the glyph is rendered as a separate `<text>` element so it
  keeps the accent color while the header text stays muted (Path A's
  bake-into-text would have painted the glyph in muted grey, losing
  the contrast that IS the affordance signal). Cursor + Enter
  expansion behavior is unchanged — the glyph is purely decorative.
  Decorative-misdirection on `gapAbove === 0` headers (where Enter
  is a no-op) is accepted, matching the webapp's same trade-off.
  No planner / cursor / expansion / annotation model change.

  Issue: #264

- **TUI: horizontal `─` rule renders between consecutive files in the
  diff pane (issue #263, mirrors webapp #249).** Pre-fix, the TUI
  stacked every file in a tour's diff stream vertically inside a single
  outer `┌─ Diff ─┐` box with no visible boundary between consecutive
  files. The webapp shipped #249 to wrap each file in a 1px
  `border.muted` rounded card with 16px margin so the eye can anchor on
  file boundaries. The TUI now interleaves a 1-row horizontal rule of
  `─` (U+2500 BOX DRAWINGS LIGHT HORIZONTAL) characters in
  `theme.border.muted` between every consecutive pair of files inside
  the diff pane. The file card above carries `marginBottom={1}` which
  supplies the blank row above the rule; the separator owns the rule
  line and a 1-row blank below. No separator renders before the first
  file or after the last (the outer `┌─ Diff ─┐` box already provides
  those boundaries); single-file tours render with no separator at
  all. LIGHT weight matches the LIGHT `│` from #258 for visual
  consistency. The rule uses `wrapMode="none"` so a long pre-filled
  string is clipped by the 100%-width parent box rather than wrapping
  to a second line. No planner / cursor / expansion / annotation /
  scroll-helper change.

  Issue: #263

- **TUI: two-tone tint within a +/- row — bright gutter rail + soft
  code wash (issue #262, parity with webapp #221 + #247).** Pre-fix,
  `DiffLine` computed one `diffColor` from the row's diff kind and
  painted it across both the gutter and content cells: addition rows
  used `theme.bg.successRange.tui` (`#1c4328`) everywhere; deletion
  rows used `theme.bg.dangerRange.tui` (`#542426`) everywhere. The
  webapp's post-#247 pattern paints the brighter `*Range` rail on
  the gutter + symbol column and the softer `*Cell` wash on the
  code column — the bright rail anchors the vertical scan and the
  softer wash keeps syntax-highlighted tokens readable. The TUI
  inherits the same theme tokens (`bg.successCell.tui` `#142a20`,
  `bg.dangerCell.tui` `#24171c`) but was applying only the range
  value. `diffBgColor` is replaced by `diffBgTones`, which returns
  `{ gutter, content }` per row kind. `DiffLine` routes the gutter
  side to `gutterBg`'s diff-bg fallback and the content side to
  `contentBg`'s. All composition rules stay (cursor row-fill >
  annotation tint > +/- bg > empty-side neutral fill); only the
  diff-bg layer is split. No theme change, no `DiffLine` prop
  surface change from a caller's perspective, no planner / cursor
  / annotation-model change.
- **TUI: clicking an annotation card moves the cursor to that card
  (issue #261).** Pre-fix, the TUI's `DiffRows` annotation branch
  rendered an `AnnotationCard` (or a 50/50 split-layout wrapper
  containing the card on the appropriate side) with no `onMouseDown`
  handler anywhere in the tree — clicking a card was a no-op. The
  webapp moves the cursor to the clicked card via
  `setCursorFromCardClick`. The regression went unnoticed because the
  diff-rows test suite still asserted "annotation card rows do NOT
  receive a click handler on their wrapper" — a stale invariant from
  the pre-ADR 0022 design when annotation cards were not cursor
  stops. ADR 0022 unified the cursor (`CardAnchor` became
  first-class), the keyboard paths (`j`/`k`/`n`/`p`/`Enter`) were
  updated, but the mouse-click path was not. `DiffRows` now accepts
  an `onCardClick?: (annotationId: string) => void` prop — mirroring
  `onCursorClick` (diff rows) and `onInteractiveClick` (interactive
  rows) — and wires `onMouseDown` on the annotation card's wrapper.
  The App-shell supplies a callback that dispatches `cursor.set`
  with `cursorFromAnnotation(ann, preferredSideOf(cursor))` — the
  exact shape `jumpToAnnotation` (the `n`/`p` keyboard path) writes.
  In split layout only the half hosting the card carries the handler;
  the empty sibling stays a no-op. Clicks on a reply nested inside
  the card bubble up to the same wrapper, so the cursor lands on the
  parent top-level annotation (cursor walks top-levels only per ADR
  0022). Click on the already-current card is a no-op via the
  reducer's same-anchor short-circuit. Cursor-follow scroll runs
  through the existing `cursor.set` → `scrollCursorTarget` intent
  → `centerChildInView` path; no parallel scroll plumbing. The stale
  negative test is deleted; a new describe block ("mouse click on
  annotation card → cursor (issue #261)") asserts the positive
  behaviour: unified wrapper fires `onCardClick`, split layout fires
  only on the card half (additions / deletions), the
  `onCardClick`-omitted case wires no handler. No planner / cursor
  reducer / AnnotationCard / scroll-helper change.

  Issue: #261

- **TUI: split-layout single-side rows paint a neutral fill on the
  empty side (issue #260, mirrors webapp #227).** Pre-fix, the empty
  side of a pure-addition or pure-deletion row in split layout rendered
  as plain canvas — indistinguishable from the inter-row gap or the
  page's outer canvas. The half "floated" with no boundary signal that
  "this row exists; its other side is just blank." On consecutive
  single-side rows the diff body lost coherence; the eye read "content
  here, void there" rather than "row here, with one side intentionally
  blank." Webapp shipped #227 painting the three cells of the empty
  side with `theme.canvas.inset` (`#010409`, ~6% darker than
  `canvas.default`). TUI matches via a new `emptySide?: boolean` prop
  on `DiffLine`: when set, both the gutter and content cells paint
  `theme.canvas.inset` so the empty side recedes below canvas while
  the active side sits at canvas. `DiffRows` flags
  `leftEmptySide = row.type === "change" && row.leftLineNumber === null`
  (and the right-side mirror) on the split-layout branch and passes it
  to the per-side `DiffLine`. Composition: cursor row-fill (ADR 0011)
  and annotation range tint (ADR 0008) both win over the empty-side
  fill, but the empty side of a single-side row never carries either —
  the cursor anchors to the populated side and annotation ranges only
  apply where there's content — so the priority resolves consistently.
  Paired-change, context, and banner (hunk-header / interactive) rows
  never trip the flag (no empty side concept). Unified layout
  unchanged (one rendered column, no per-side concept). The diff +/-
  tint (`bg.successRange.tui` / `bg.dangerRange.tui`) on the active
  side is untouched. Three subtle depth layers now: empty side recedes
  (`canvas.inset`), context side sits at canvas level, tinted active
  cells lift "above" the page surface — same visual hierarchy the
  webapp #227 established. No planner / cursor / expansion /
  annotation / theme change; reuses the Tier-1 `theme.canvas.inset`
  token (same hex on both surfaces).

  Issue: #260

- **TUI: split-layout renders a vertical `│` rule between the
  deletions and additions halves (issue #258, mirrors webapp #251).**
  Pre-fix the two halves sat flush against each other with no visible
  separator. On context blocks where both halves carried identical
  content, the split layout read as one continuous wide grid rather
  than two parallel columns; with no cue at the column boundary, the
  eye lost the "this is the boundary between old and new" anchor.
  Webapp shipped a 1px `border.muted` vertical rule down every split
  row in #251. The TUI's terminal-native equivalent is a `│` (U+2502
  BOX DRAWINGS LIGHT VERTICAL) glyph painted in `theme.border.muted`
  (`#2f3742` — same token webapp picked for parity). The divider is
  a 1-cell-wide `<box width={1} alignSelf="stretch" flexShrink={0}>`
  containing a `<text fg={theme.border.muted}>│</text>`, inserted
  between the two 50%-width half columns in the split-layout row
  composition. Default `flexShrink=1` on the halves absorbs the 1-
  cell divider into the 100% row width with no visible alignment
  shift. The lighter LIGHT VERTICAL weight (vs the HEAVY `┃` the
  file-block uses for its outer border) keeps the inner divider from
  competing for attention with the outer box. Banner rows (hunk-
  header, interactive: gap / boundary / collapsed-file) take the
  full-width render branch and skip the split composition entirely,
  so the rule naturally breaks at each banner — matches GitHub's
  behaviour. Annotation card rows in split layout keep their existing
  two-half composition with the card slotted into one side; the
  divider is not threaded through the annotation render path, so the
  card visually breaks the rule where it occupies — acceptable per
  the issue brief because the card is a different content kind and
  the break correctly signals "this is a comment, not code". Cursor
  row-fill composition is unchanged: the cursor's `bg.cursorRow.tui`
  fills both halves' DiffLine cells but does not extend across the
  divider's 1-cell column, so the divider remains visible through
  cursored rows. Unified layout untouched — the change is layout-
  aware (the divider only renders in the `layout === "split"`
  branch). No planner / annotation / cursor / expansion / syntax-
  highlight change; no theme change (reuses `theme.border.muted`).

  Issue: #258

- **TUI: cursor materialises on the first top-level annotation on tour
  load (issue #256).** Pre-fix, opening a TUI tour with at least one
  annotation left the cursor null and the diff pane parked at
  `scrollTop = 0` — the first annotation was off-screen unless it
  happened to sit near the top of the first file, and the user had to
  scroll manually or press `n`/`j` to materialise the cursor and
  trigger a scroll. ADR 0011's "lazy materialization" rule (2026-05-10)
  was justified by surface parity with the webapp and a "land on first
  annotation" eye-catcher, but ADR 0022's URL-anchored mount broke the
  parity rationale (the webapp now materialises the cursor at `?ann=`
  or the first top-level annotation on mount unconditionally), and the
  eye-catcher only delivered when the first annotation sat inside the
  initial viewport. Fix dispatches `cursor.materialize` in the App-
  shell's existing tour-open `useEffect`, seeded by `initialCursor`
  with the live `topLevel` + `flatRowsList`. Same first-paint-per-tour
  guard (`seededTourIdRef` on `bundle.tour.id`) used by the tree-
  reveal side effect — `bundle.refreshed` does not re-seed, so user
  motion before a watcher reload survives. Empty tours and snapshot-
  lost bundles keep the lazy-materialization rule (no target to seed
  on; cursor stays null). ADR 0011 carries a new revision entry
  reverting the on-load rule for the non-empty path.

  Issue: #256

- **TUI: split-layout gutter renders `+` / `-` sign column (issue #257,
  mirrors webapp #221).** Pre-fix `splitGutter(lineNumber)` returned
  `${pad(lineNumber)} ` — line number + trailing space, no sign. Tint
  alone signalled addition / deletion / change rows in split layout,
  which is insufficient for color-blind readers and didn't match the
  TUI's own unified-layout behaviour (`unifiedSign` already emits
  `+` / `-` / blank). Webapp shipped the sign column in both layouts
  in #221; TUI was partial. Fix adds a `splitSign(row, side)` helper
  that mirrors `unifiedSign`'s vocabulary but reads the sign from the
  populated side: in split layout the planner emits both pure adds and
  pure dels as `type: "change"` with one side's line number null,
  so the sign on each side is `-` (left, deletions) or `+` (right,
  additions) when that side carries content, and a blank space when
  the side is empty or the row is `type: "context"`. `splitGutter`
  takes the sign as a second argument and appends `${sign} ` after
  the line-number column, keeping the gutter width uniform across all
  row kinds. `INTERACTIVE_PAD_GUTTER` widens to match (LINE_NUMBER_WIDTH
  + 3) so hunk-separator / collapsed-file rows still align their body
  text with the diff column. Paired-change rows: deletions side `-`,
  additions side `+`. Pure-add: additions side `+`, deletions side
  blank. Pure-del: deletions side `-`, additions side blank. Context:
  both sides blank. Unified layout unchanged.

  Issue: #257

- **TUI hunk-header renders in continuous fg.muted, no syntax highlighting on
  the function-context tail (issue #259).** Pre-fix the interactive
  hunk-header (`@@ -X,Y +Z,W @@ <function-context>` with `gapAbove > 0`)
  routed its text through `DiffLine` with the same `filetype` /
  `syntaxStyle` as the diff-row code cells. The function-context tail ran
  through the syntax highlighter — `import` painted red, identifiers blue,
  brackets white — and the banner read as a colourful element pulling
  attention from the diff rows below. GitHub renders the entire
  `td.blob-code-hunk` cell in one continuous `fg.muted` grey
  (`#9198a1`); the webapp's `.tour-hunk-header` matches. The TUI now does
  too: `DiffLine` grows a `mutedText?: boolean` prop that forces the plain
  `<text>` branch regardless of filetype and tints the content in
  `theme.fg.muted`. `DiffRows` passes `mutedText` for the interactive
  hunk-header. The inert path (`gapAbove === 0`) was already rendered as
  `<text fg={theme.fg.muted}>` and is unchanged. Cursor visual, gutter
  padding, and the `↑` / `↓` / `↕` direction glyph + `··· N hidden ···`
  suffix are unchanged — only the syntax pipeline is bypassed and the
  text is tinted muted.

  Issue: #259

- **TUI: top-level annotation submit no longer silently fails — diverged
  `WriteAnnotationInput` types and unrendered `errored` composer state fixed
  (issue #254).** Pre-fix `WriteAnnotationInput` was declared twice: once in
  `src/tui/app.tsx` (no `bundle` field) and once in `src/cli/tui.ts` (with
  `bundle: TourBundle`). The intent listener in `app.tsx` built a top-level
  input without `bundle`; the CLI's writer callback passed `input.bundle ===
  undefined` into `createAnnotation`'s anchor validator, which dereferenced
  `undefined.kind` and threw `TypeError`. The exception was caught and
  dispatched as `composer.failed`. The App rendered the composer only when
  `composer.kind === "open"` so the user saw the composer vanish on Enter
  with no error message. The type-system blind spot was hidden by an
  `as string` cast on the dynamic-import path in `src/cli/tui.ts` (the TUI
  source is excluded from tsc for opentui JSX intrinsics, so the duplicate
  types couldn't be cross-checked). Fix consolidates `WriteAnnotationInput`
  and the App's prop shape (`StartTuiProps`) into a new shared module
  `src/core/write-annotation-input.ts`. A pure builder
  `buildWriteAnnotationInput` constructs the payload from the live bundle —
  removing the bundle field from the type OR from the builder is now a tsc
  error rather than a runtime crash. The Composer renders all three visible
  slice kinds: `open` (editable input + submit hint), `submitting` (plain
  body + "Submitting…" hint, no input focus), and `errored` (plain body +
  the error message + "Enter: retry · Esc: dismiss" hint, muted border).
  The App's `useKeyboard` routes Enter / Esc to `composer.retry` /
  `composer.dismissError` on the errored state. Reply submit path
  unchanged — it never passed a bundle.

  Issue: #254

- **Hunk-header banner adopts monospace 12px / line-height 20px
  typography (issue #253).** Pre-fix `.tour-hunk-header` set no
  `font-family`, `font-size`, or `line-height`, so the banner and its
  child spans inherited the document body's system sans-serif at 16px
  with the browser-computed `line-height: normal` (≈19.2px). The diff-
  row code cells below (gutter, +/- symbol, code text) render in
  monospace 12px / line-height 20px per issue #241, so banner text was
  visually mismatched — larger, sans-serif, off-rhythm with the rows
  below. GitHub renders hunk-header text in the same monospace stack /
  size / line-height as the code cells. `.tour-hunk-header` acquires
  the three font declarations reusing the existing module-private
  `MONO_STACK` constant; the two child spans
  (`.tour-hunk-header-range`, `.tour-hunk-header-context`) and the
  `::before` cue area's `…` glyph all inherit from the parent. Banner
  height becomes ≈ 32px (20px line-height + 6px top/bottom padding),
  aligned to a 20px multiple matching the row rhythm. No JSX / prop /
  planner / theme change.

  Issue: #253

- **TUI: cursor-follow scroll defers to next macrotask so Yoga relayout
  completes before centering math runs (issue #250).** Pre-fix the cursor-
  follow `useEffect` in `src/tui/app.tsx` (deps: `[cursor, layout]`) called
  `centerChildInView` / `scrollChildIntoView` synchronously after React's
  commit. OpenTUI's Yoga relayout for newly-rendered rows runs on a later
  render tick, so the synchronous call read positions against the previous
  layout. Most visible trigger: cursor on an annotation card + `Shift-L`
  layout flip — `centerChildInView` computed `desired` against the stale
  content frame, parking the scrollbox where, in the new layout, only
  stacked annotation cards live; every diff code row was pushed off-screen
  above and below. The effect now schedules the scroll via `setTimeout(0)`,
  and the cleanup cancels the pending callback so rapid cursor motion only
  scrolls to the latest position. `requestAnimationFrame` does NOT work as
  a substitute in this runtime — in bun/node it shims to `setImmediate` or
  similar and fires before OpenTUI's render tick; the macrotask delay from
  `setTimeout(0)` is what lands the callback after the layout pass.
  Inline comment in the effect explains the race and explicitly warns
  against the rAF "improvement". No change to `centerChildInView` /
  `scrollChildIntoView`, the layout reducer, or the planner.

  Issue: #250

- **Hunk-header banner gains a visible expand affordance (issue #252).**
  Pre-fix the webapp hunk-header banner was clickable (per ADR 0013 the
  whole banner expands hidden context) but had no rest-state visual cue
  — only `cursor: pointer` on mouseover. GitHub paints a 44px saturated-
  blue leftmost cell with a `…` glyph on every hunk-header row as the
  rest-state signal. New `.tour-hunk-header::before` rule in
  `file-grid-css.ts` paints the analogous cue: width 44px, background
  `theme.bg.accentEmphasis` (#1f6feb solid), glyph `theme.fg.onEmphasis`
  (#ffffff), centered via flexbox, absolutely positioned to the banner's
  left edge. `.tour-hunk-header` acquires `position: relative` (anchor
  for the ::before) and `padding-left: 60px` (44 cue + 16 gap) so the
  range/context text clears the cue. Path B (`::before` pseudo-element)
  rather than Path A (inline span) so the cue cannot accidentally become
  a separate click target — per ADR 0013 the whole banner stays one
  click target. No JSX / prop / planner / theme change.

  Issue: #252

- **Split-layout diff rows render a 1px vertical rule between the
  deletions and additions halves (issue #251).** Pre-fix the two halves
  sat flush against each other with no visible separator — on context
  blocks where both halves had identical content, the split layout read
  as one continuous wide grid rather than two parallel columns. GitHub
  paints a thin vertical rule down every row at the column boundary,
  implemented as a `border-left` on the additions-side line-number
  gutter cell. New rule in `file-grid-css.ts` keys on
  `.tour-file-block[data-layout="split"] .tour-row-gutter[data-side="additions"]`
  and declares `border-left: 1px solid ${theme.border.muted}` (#2f3742) —
  visually nearly identical to GitHub's `rgba(61, 68, 77, 0.7)` blended
  over `canvas.default`. Reuses an existing token. Unified-layout rows
  are unaffected (selector qualifies on the layout attribute). Banner
  rows and annotation cards span full width with no additions-side
  gutter, so the rule naturally breaks at each banner — matches GitHub.
  Clipped to the file-card's rounded corners by the existing
  `.tour-file-outer` `overflow: hidden`. No DOM / prop change; no new
  theme tokens.

  Issue: #251

- **Diff body wraps each file in a bordered, rounded card (issue #249).**
  Pre-fix the per-file `.tour-file-outer` div was a style-less
  passthrough — files in the diff body stacked edge-to-edge with no
  border, no rounded corners, no margin, and no overflow clipping;
  scanning a multi-file tour required reading file-header text rather
  than recognizing card boundaries. New `.tour-file-outer` rule in
  `file-grid-css.ts` paints `1px solid theme.border.default` (#3d444d),
  `border-radius: 6px`, `margin-bottom: 16px`, `overflow: hidden`, and
  `background-color: theme.canvas.default` — matches GitHub's empirical
  `.file` container shape. `overflow: hidden` clips children to the
  rounded corners AND bounds the sticky file-header's stick range to
  its own card so only the current file's header sticks at any moment
  (instead of all file headers stacking at the viewport top). No DOM /
  prop change; no new theme tokens.

  Issue: #249

- **Diff-row gutter line numbers + `+` / `-` symbol promote to
  `fg.default` on tinted rows (issue #248).** Companion to #247: with
  the gutter+symbol now wearing the brighter range tint, the previously
  uniform `fg.muted` text color produced low-contrast grey digits on a
  saturated green/red rail. GitHub's pattern is white text on tinted
  rows (`addition` / `deletion` / `change-addition` / `change-deletion`)
  and muted text on plain-canvas context rows; color discrimination is
  carried by the background, not the foreground. New
  `[data-line-type]` × `{ .tour-row-gutter, .tour-row-symbol }` rule
  in `file-grid-css.ts` overrides the base muted color to
  `theme.fg.default` on the four tinted row kinds; context rows fall
  through to the unchanged base rule. No new tokens, no DOM/prop
  change.

  Issue: #248

- **Diff-row two-tone tint flipped to GitHub's empirical direction
  (issue #247).** The line-number gutter + `+`/`-` symbol cells now wear
  the brighter range tint (alpha .30 of fg.success / fg.danger); the
  code cell wears a softer wash (alpha .15 for additions, .10 for
  deletions — red sits one step softer than green at equal alpha to
  preserve visual balance, matching live PR-diff inspection). Pre-fix
  the direction was inverted (soft gutter, bright code) — the
  syntax-highlighted Shiki tokens sat over the more-saturated cell
  background, reducing legibility, and the gutter rail was muted
  enough that the eye lost the vertical-scan anchor in long
  addition / deletion runs. Token names are unchanged
  (`bg.successRange` / `bg.successCell` / `bg.dangerRange` /
  `bg.dangerCell`); only the alpha values flip and the corresponding
  TUI hex equivalents recalibrate (`#1c4328` / `#142a20` / `#542426`
  / `#24171c`). CSS rule wiring and the planner / row primitives are
  unchanged.

  Issue: #247

### Breaking changes

- **Reply-agent dispatch is now explicit, not implicit.** Previously, the
  renderer's watcher auto-fired a reply-agent dispatch on every new
  human-authored Annotation when `--reply-agent <name>` was set. Now,
  dispatch only happens when the user presses `s` on a focused human
  Annotation in the TUI, or clicks **Send to {agent}** on a human card
  in the webapp. The watcher's role narrows to state observation only
  (annotations.jsonl → bundle re-render; .reply-lock.json → in-flight
  pill + affordance disabled state). The new `POST /api/tours/:id/
  request-reply` endpoint maps the four dispatch result kinds to HTTP
  status codes (202 dispatched / 409 busy / 404 invalid-annotation /
  400 no-reply-agent). Reverses the auto-dispatch portion of ADR 0010;
  see ADR 0021 for rationale (paid-LLM-inference economics — every
  silent over-dispatch under the old model was real money).

  Issue: #184 · PRD: #181 · ADR: 0021

- **Bare `tour` picks the best surface for your environment.** Previously,
  `tour` (no subcommand) always launched the TUI. It now starts the
  webapp and prints its URL when a browser is reachable (desktop
  linux/darwin with a TTY, `open` or `xdg-open` on PATH, no SSH session)
  and falls back to the TUI otherwise (ssh, piped/non-TTY stdout,
  windows, no opener). The URL is Cmd/Ctrl-clickable in modern
  terminals — bare `tour` does **not** auto-open the browser, so
  re-running the command does not stack tabs. Users who want the
  browser launched automatically run `tour serve --open` explicitly,
  which is unchanged. `tour tui` is also unchanged. The first-run
  banner (no tours present) still prints unchanged.

  The deciding criterion is annotation fidelity: the webapp renders
  markdown + mermaid, the TUI shows raw source. New users on a desktop
  now get the higher-fidelity surface by default.

  Issue: #175 · PRD: #174

### Changed

- **Cutover: App.tsx swaps to `<FileBlock>`; Pierre adapter pile deleted
  (PRD #212 slice 7).** The webapp's diff body no longer mounts Pierre's
  `<FileDiff>` / `<MultiFileDiff>`. App.tsx now maps each parsed file to
  a `<FileBlock>` (#218) walking the planner's `PlannedRow[]`, wires
  `useState(ExpansionState)` from `core/expansion-state.ts` (orphan-
  windows seeded on bundle load; both surfaces now share the reducer),
  dispatches expansion via `onDispatchExpand`, mirrors clicks via
  `onRowClick`, and emits a single `<style>{FILE_GRID_CSS}</style>` at
  the diff pane root. Cursor outline is the `.is-cursor` className flow-
  ing through `<FileBlock>` → row components — no more `data-tour-cursor`
  attribute mutation. The Pierre worker pool, `WorkerPoolContextProvider`,
  and worker-bundling entry-point are removed from the binary build;
  `@pierre/diffs` stays only for `parsePatchFiles` and moves from
  `devDependencies` to `dependencies` to match its new runtime-only role.
  `shiki` is now a direct dependency.

  Deletions: `gap-row-overlay.ts`, `pierre-expansion-bridge.ts`,
  `cursor-overlay.ts` (DOM-mutation cursor + placement IO),
  `cursor-rows.ts` (Pierre shadow-DOM walker), `dom-walk.ts`,
  `plus-button-overlay.ts` (mouse `+` affordance — keyboard `a` still
  opens the composer), `click-anchor.ts`, `annotations.ts` (Pierre
  `lineAnnotations` + range-tint CSS injection), `cursor-css.ts`, the
  seven App-level CSS-string blobs, the `pendingAnchorRef` + R1/R2
  race mitigation, the wheel/touch/keydown cancel listeners,
  `BASE_DIFF_OPTIONS`, the legacy `<FileBlock>` and `CopyPathButton`
  in App.tsx. Test suite drops `parity-render.test.ts` (#219), its
  parity fixtures, the DOM-mutation overlay tests, and `annotations`,
  `click-anchor`, `cursor-css`, `plus-button-overlay`, `cursor-rows`,
  `cursor-overlay`, `gap-row-overlay`, `pierre-expansion-bridge` tests.

  Issue: #220 · PRD: #212 · ADR: 0024

### Added

- **Tour-session view: nav lifted to both branches; single early-narrow
  per App (issue #246, PRD #242 follow-up).** `TourSessionView`'s
  `snapshot-lost` branch now carries `nav: NavBase` (topLevel /
  repliesByRoot / navIndexById / navTotal); `currentIdx` and `sendTarget`
  stay ok-only on the NavSlice that extends NavBase. The webapp's
  inline `topLevelAnnotations` / `buildThreads` re-derivation in
  `AnnotationListSnapshotLost` (and the parallel call inside the
  re-anchor `useEffect`) is gone — both reads route through `view.nav`.
  The TUI's `navSlice` destructure flattens to a non-nullable `nav` of
  type NavBase | NavSlice; `EMPTY_NAV_INDEX` is deleted. The webapp's
  render branches on `view.kind === "snapshot-lost"` once (the sidebar
  and main body are inside one ternary); the body-proper `view.kind ===
  "ok"` ternaries for `navTotal` / `pillIdx` are gone (NavBase universal;
  pillIdx uses a property check on `nav.currentIdx`).

  Issue: #246 · PRD: #242

- **Webapp migration to Tour-session view (issue #245, PRD #242).**
  `web/client/App.tsx` now reads `const view = useTourSessionView(store,
  bundle)` at root and consumes namespace slices (`view.bundle.*`,
  `view.nav.*`, `view.rows.*`, `view.tree.*`, `view.cursor.*`) instead
  of the parallel `useMemo` chain it used to maintain. The eight
  derivation `useMemo`s (`topLevel`, `navIndexById`, `repliesByRoot`,
  `tree`, `annotationCounts`, `visibleRows`, `plannedRowsByFile`,
  `flatRowsList`), the inline cursor predicates (`currentIdx`,
  `cursorCardId`, `cursorCardFile`), and the parallel projections
  (`liveFiles`, `modelFilesByName`, `parsedFilesByName`) are gone.
  `CursorKeymapContext` now consumes `view.cursor.onCard`; the
  webapp's `s`-dispatch consumes `view.nav.sendTarget`, sharing the
  latest-human-leaf rule with the TUI through `core/send-target.ts`.
  The webapp adopts the view's `isFileFolded` rule (binary-only auto-
  fold; classifier-collapsed non-binary files emit a synthetic
  CollapsedFileRow via the planner), reconciling the prior
  `defaultCollapsedFor` divergence. Behaviour is observationally
  identical: keymaps fire the same actions, the planner emits rows
  in the same order, snapshot-lost still renders the banner, and the
  watcher-reload `revalidateCursor` intent re-derives the view inline
  to validate the cursor against the fresh bundle before React
  re-renders.

  Issue: #245 · PRD: #242

- **Tour-session view foundation: pure projection from `(bundle, state)`
  to the rendered shape both surfaces consume (issue #243, PRD #242).**
  New `core/tour-session-view.ts` exports a `TourSessionView`
  discriminated union mirroring `TourBundle`'s `ok` / `snapshot-lost`
  split, layered into `bundle` / `nav` / `rows` / `tree` / `cursor`
  namespaces, plus `deriveTourSessionView(bundle, state)` (pure, no
  React) and a `useTourSessionView(store, bundle)` hook that runs one
  `useMemo` per namespace so granular invalidation survives the move
  in slices 2 + 3. The view's `cursor.anchor` is the **validated**
  cursor — `state.cursor` pruned against the live `flatRowsList` (a
  CardAnchor to a deleted annotation resolves to null) — so the
  `validateCursor` call that lives inline in both Apps' useEffects
  is now derivable from one source. `core/send-target.ts` is the new
  canonical home for the `SendTarget` type + latest-human-leaf rule;
  `tui/send-target.ts` becomes a thin re-export so existing callers
  keep working until slice 2 migrates them through
  `view.nav.sendTarget`. No surface wiring — both `tui/app.tsx` and
  `web/client/App.tsx` are unchanged at the end of this slice; the
  verifiability story is the pure-data test battery (snapshot-lost
  short-circuit, killer cursor-validation fixture for a stale
  CardAnchor, namespace shape assertions, watcher-reload
  preservation). `CONTEXT.md` Language section gains a `Tour-session
  view` entry paired with `Tour-session` and `Tour bundle`.

  Issue: #243 · PRD: #242

- **TUI thins composer + folds + layout through the Tour-session store
  (issue #237).** The TUI's local `useState`s for `composer`,
  `collapsedOverrides`, `collapsedFolders`, `layout`, and the post-submit
  `pendingScrollAnnotationId` are gone — all reads route through
  `sessionState`, all mutations dispatch through the store. Keymap +
  click rewiring: `a` / `r` dispatch `composer.open { target }` with a
  `ComposerTarget` (top-level: file+side+line range; reply: parent id);
  composer keystrokes dispatch `composer.setBody { body }` on every
  change; Enter / submit dispatch `composer.submit`; Esc dispatches
  `composer.close`. Folder Enter / `c`-on-folder dispatch
  `folds.toggleFolder`; file-level `c` dispatches `folds.setOverride`;
  `Shift-L` and the top-header Split/Unified buttons dispatch
  `layout.set`. The intent listener gains two cases:
  `submitAnnotation { tourId, target, body }` calls
  `props.writeAnnotation` (mapping reply targets to their parent
  Annotation looked up from the live bundle) then dispatches
  `composer.submitted { annotation }` on success or
  `composer.failed { error }` on failure;
  `scrollToAnnotation { annotationId }` consumed via a ref +
  `plannedRowsByFile`-keyed useEffect that retries until the
  bundle-refresh re-render mounts the new card (matches the prior
  pendingScroll flow's correctness without the useState). The `loadTour`
  intent handler's hand-rolled composer / folds / overrides resets are
  deleted — the reducer's `tour.switched` cascade is the single home for
  every reset; only the sidebar `selectedRowIdx` reset remains in the
  surface (sidebar selection is out-of-scope per PRD #234). The
  watcher-reload-preserves-draft property — verifiable manually by
  editing an annotation in `.tour/<id>/` while a TUI composer is open —
  now passes as a tested property of the reducer (slice-3 foundation
  fixture). `src/tui/composer-submit.ts` is deleted in favor of the
  reducer's `composer.submit → submitting` no-op-on-resubmit guard plus
  the intent-driven write path; `composer-state.ts` helpers refactored
  to return `ComposerTarget` directly.

  Issue: #237 · PRD: #234

- **Webapp composer + folds + layout routed through the Tour-session store
  (issue #238).** The webapp no longer owns local `useState`s for
  `composerTarget`, `composerError`, the textarea `value`,
  `collapsedFolders`, `collapsedOverrides`, or `layout` — all five slices
  read from `sessionState` and mutate via `store.dispatch(...)`. The
  `<Composer>` textarea is now a controlled component reading
  `state.composer.body` and dispatching `composer.setBody` on every
  keystroke; the slice's tagged-union state machine collapses the
  webapp's three-`useState` composer split into one source of truth, and
  the watcher-reload-doesn't-eat-the-draft invariant is now a tested
  property of the reducer rather than a React-reconciliation accident.
  Keymap + click + segmented-control callsites route through
  `composer.open` / `composer.close` / `composer.submit` /
  `composer.setBody`, `folds.toggleFolder` / `folds.setOverride` /
  `folds.clearOverride`, and `layout.set`; the intent listener realises
  `submitAnnotation` (HTTP POST to `/api/tours/:id/annotations` + dispatch
  `composer.submitted` / `composer.failed`) and `scrollToAnnotation`
  (DOM `scrollIntoView({ block: "center" })`). The `loadTour` flow's
  hand-rolled `setComposerTarget(null)` / `setComposerError(null)` /
  `setCollapsedOverrides({})` / `setCollapsedFolders(new Set())` calls
  are gone — `tour.switched` in the reducer owns those resets. The only
  remaining surface-side reset is `selectedFile` (sidebar position,
  derivable from cursor, explicitly out of scope per PRD #234).
  CONTEXT.md's **Tour-session** entry updated to confirm composer,
  folds, and layout are now authoritative slices.

  Issue: #238 · PRD: #234

- **Tour-session slice 3 foundation: composer + folds + layout slices
  land in the reducer (issue #236).** `TourSessionState` gains three new
  slices: `composer: ComposerSlice` (tagged-union state machine —
  `closed | open | submitting | errored` — with `target: ComposerTarget`
  carrying the parent annotation **id** for replies so the slice doesn't
  go stale when the bundle refreshes mid-composition), `collapsedFolders:
  Set<string>`, and `collapsedOverrides: Record<string, boolean>`. Eight
  composer actions (`composer.open`, `composer.close`, `composer.setBody`,
  `composer.submit`, `composer.submitted`, `composer.failed`,
  `composer.retry`, `composer.dismissError`) drive the state machine;
  four fold actions (`folds.toggleFolder`, `folds.setOverride`,
  `folds.clearOverride`, `folds.clearAll`) own the fold slices; the
  slice-1-leftover `layout.set { layout }` action wires up the existing
  `layout` field. Two new intents on the union: `submitAnnotation
  { tourId, target, body }` (emitted by `composer.submit` / `composer.retry`
  for the surface to realise via its existing `writeAnnotation` plumbing
  — in-process TUI / HTTP webapp — then dispatch `composer.submitted` or
  `composer.failed`), and `scrollToAnnotation { annotationId }` (emitted
  by `composer.submitted` so the freshly-created card scrolls into view;
  replaces the TUI's `pendingScrollAnnotationId` useState). The
  `tour.switched` reset cascade extends to clear composer (→ closed) and
  both fold slices (→ empty Set + empty Record); layout preserved per
  CONTEXT.md's pinned rule. `bundle.refreshed` does **not** touch the
  composer slice — the composer-survives-watcher-reload killer fixture
  passes as a pure-data property of the reducer rather than as a
  React-reconciliation accident. No surface wiring in this slice: both
  Apps continue to own their local useStates for composer / folds /
  layout; the store is exercised only by tests. TUI + webapp migrations
  land separately (siblings #237 + #238).

  Issue: #236 · PRD: #234

- **Webapp `<App>` integration smoke test (issue #235).** A new
  `tests/web/App.integration.test.ts` mounts the top-level `<App>`
  React component once in `happy-dom` against a small two-file bundle
  fixture (paired-change + pure-addition diff, one annotation,
  non-empty `oldContent` / `newContent` so the `tourStats` useMemo
  exercises the `planRows(... { expansion: emptyExpansion(), ... })`
  path) and asserts the rendered DOM contains the tour title, a
  `.tour-file-header` for each file, the `.tour-stats` indicator, and
  at least one `.tour-row`. Closes the silent-merge-regression hole
  exposed by the #232↔#233 merge: pre-existing unit / component /
  helper / CSS tests all passed while the live page rendered blank
  because nothing exercised the App-level integration path. Verified
  by temporarily removing `emptyExpansion` from the App's import block
  — the smoke test fails with `ReferenceError: emptyExpansion is not
  defined` at the exact site the merge regression broke.

  Issue: #235

- **TUI cursor + expansion routed through the Tour-session store
  (issue #231).** The TUI no longer owns `useState<Cursor | null>` or
  `useState<ExpansionState>` — both slices are read from `sessionState`
  and mutated via `store.dispatch(...)`. Keymap dispatchers (`j` / `k`
  / `n` / `p` / `h` / `l` / `Enter` / `Shift-Enter` / arrows / Home /
  End / Space / PageUp/Down / mouse click on diff row / mouse click on
  interactive row / mouse click on annotation card / mouse click on
  sidebar file) compute the new anchor via the existing pure helpers in
  `core/cursor-state.ts` and dispatch `cursor.set` (or `cursor.clear`
  when the target is null). Expansion handlers dispatch
  `expansion.expand` / `expansion.expandTop` / `expansion.expandBottom`
  / `expansion.expandFile` / `expansion.seedFromOrphans` in place of
  their direct `setExpansion(...)` callsites. The watcher-reload and
  composer-submit refresh paths dispatch `expansion.seedFromOrphans`
  before `bundle.refreshed` so the reducer's `revalidateCursor` intent
  fires against the freshly-seeded expansion slice. Tour-switch resets
  for cursor + expansion now come from the reducer's `tour.switched`
  branch; the surface only resets folds / overrides / sidebar row
  index. The intent listener realizes `revalidateCursor` (running
  `validateCursor` against the surface-derived flat-rows + files),
  `scrollCursorTarget` (via `scrollChildIntoView` / `centerChildInView`
  on the diff scrollbox), and `revealSidebarFile` (via `revealAndLocate`
  on the file tree); `mirrorAnnUrl` is ignored — the TUI has no URL.
  Observable behavior is unchanged. The webapp remains untouched and
  continues to use local `useState`s for cursor + expansion until
  issue #232 lands.

  Issue: #231 · PRD: #229

- **Webapp thins cursor + expansion through the Tour-session store
  (issue #232).** The webapp's local `useState<Cursor | null>` and
  `useState<ExpansionState>` are gone; the store is authoritative for
  both slices. Keymap (j/k/h/l/arrows/n/p), click handlers, popstate's
  URL-`?ann=` mirror, and the SSE-driven bundle refresh all dispatch
  `cursor.*` / `expansion.*` actions; the intent listener realizes
  `revalidateCursor` (via `validateCursor` against the freshly-recomputed
  flat-rows from the new bundle), `scrollCursorTarget` (RAF-deferred
  scrollIntoView on the matching row cell or annotation card),
  `revealSidebarFile` (sidebar selection + folder reveal + collapsed
  override), and `mirrorAnnUrl` (`history.replaceState` so back/forward
  steps over Tour switches, not over every keystroke). The cursor's
  Tour-switch reset cascade moves into the reducer's `tour.switched`
  branch; the surface no longer hand-rolls the reset. `core/cursor-
  state.ts`'s `validateCursor` is the single home for snap-policy
  truth — the prior `validateWebappCursor` helper in
  `src/web/client/cursor-validation.ts` is deleted, and its
  collapse-preservation discriminator is reconciled into the core
  helper. Behavioural change: folding the cursor's file now preserves
  the anchor instead of walking it to the next file in stream order;
  uncollapsing restores the cursor in place. CONTEXT.md's Tour-session
  entry drops the obsolete `expansion`-as-shadow-slice example.

  Issue: #232 · PRD: #229

- **Webapp tour title bar: GitHub-style tour-level diff-stats indicator
  (issue #233).** The tour title bar gains a compact `+N -M` text
  indicator sitting between the annotation-navigation widget
  (`SequencePill`) and the Split/Unified layout toggle. The totals
  aggregate additions and deletions across every file in the loaded
  bundle, regardless of UI / classifier collapse state — collapse is a
  per-viewing concern, not a stats concern. New pure helper
  `tourDiffStats(files)` sits alongside `countDiffStats` /
  `proportionSegments` in the `diff-stats` module; it walks each file's
  `PlannedRow[]` via the existing `countDiffStats` and sums the results,
  inheriting the per-row change-shape inspection for free (new-file
  rows `+1`, deleted-file rows `-1`, paired-change rows `+1 -1`).
  Memoized against `parsedFiles` + `modelFilesByName` so cursor moves,
  layout toggles, expansion-state changes, and annotation navigation do
  not re-walk the rows. Sides are independently omitted at zero so
  pure-addition / pure-deletion tours read cleanly (`+12` only, not
  `+12 -0`). Display-only — no click handler. Uses `fg.success` /
  `fg.danger` for the colored counts, monospace + tabular numerals so
  the numbers don't jitter as the reviewer navigates. No proportion bar
  at the tour level — the per-file bars carry the finer-grain
  proportion signal already. Closes the diff-stats arc: per-row glyph
  → per-file header (5-segment bar + count) → per-tour total (count
  only).

  Issue: #233 · PRD: #212

- **Tour-session slice 2 foundation: cursor + expansion slices land in
  the reducer (issue #230).** `TourSessionState` gains `cursor: Cursor |
  null` and `expansion: ExpansionState` slices, alongside four new
  cursor actions (`cursor.set`, `cursor.clear`, `cursor.setSide`,
  `cursor.materialize` for the lazy first-interaction landing) and five
  new expansion actions (`expansion.expand`, `expansion.expandTop`,
  `expansion.expandBottom`, `expansion.expandFile`,
  `expansion.seedFromOrphans`). Four new intents on the union —
  `revalidateCursor`, `scrollCursorTarget`, `revealSidebarFile`,
  `mirrorAnnUrl` — encode the cross-async side-effect contract.
  `bundle.refreshed` now emits `revalidateCursor` when the cursor slice
  is non-null so the surface (which owns the substrate-derived flat-
  rows) drains via the pure `validateCursor` helper from
  `core/cursor-state.ts`. `tour.switched`'s reset cascade now also
  clears cursor + expansion. No surface wiring yet — both Apps continue
  to own their local `cursor` / `expansion` `useState`s; the store is
  exercised only by tests. Cross-async killer fixture covers the
  watcher-reload-snaps-to-first-row case end-to-end as a synchronous
  fixture sequence.

  Issue: #230 · PRD: #229

- **Webapp file header: GitHub-style per-file diff stats (5-segment
  proportion bar + count, issue #228).** The per-file sticky header
  gains a per-file stats indicator in the right region, sitting
  between the (existing) classification reason tag and the (existing)
  copy-path button. The indicator has two parts rendered left-to-
  right: a 5-segment proportion bar (greens for additions, reds for
  deletions, the muted border token for unfilled), then colored
  `+N -M` count text (omitted per side when the count is zero).
  Counts are derived from the planner's `PlannedRow[]` via two pure
  helpers in a new `diff-stats` module — `countDiffStats` (addition /
  deletion / paired-change tallying, non-diff-row kinds excluded) and
  `proportionSegments` (rounding-corner-safe 5-segment mapping, floor
  of 1 on a minority side that's non-zero, ceiling of 5 when the
  other side is zero). Both wrapped in `useMemo` against `rows`.
  Non-interactive — no click handler on the indicator, the only DOM-
  level handler is on the surrounding header which routes to
  `onToggleCollapse` exactly as before. Collapsed files still render
  the stats (counts come from `rows`, not the rendered DOM). Bar
  segments are 8px squares with a 2px gap; count text uses a
  monospace stack with `font-variant-numeric: tabular-nums` so widths
  don't jitter across files. Reuses pre-existing `fg.success`,
  `fg.danger`, and `border.muted` tokens — no `theme.ts` change.

  Issue: #228 · PRD: #212 · ADR: 0024

- **Webapp split layout: neutral fill on the empty side of single-side
  diff rows (issue #227).** In split layout, pure-addition and
  pure-deletion rows now paint a subtle `theme.canvas.inset` fill on the
  three cells (gutter + symbol + code cell) of the side with no line
  number, so each row reads as "one side intentionally blank" rather
  than "content on one side, void on the other". CSS-only: keys on the
  pre-existing `data-line-number=""` attribute that `<Column>` emits
  when `lineNumber` is null, and uses adjacent-sibling selectors to
  extend the cue onto the matching symbol and cell. Scoped to
  `.tour-file-block[data-layout="split"]` so unified-layout rows are
  unaffected. The rule sits between the two-tone line-type backgrounds
  and the per-cell `.in-range` tint, with a `:not(.in-range)` qualifier
  so range-tinted cells keep their accent fill on the rare empty-side-
  in-range case. No prop-surface change to `<DiffRow>` / `<Column>`,
  `<FileBlock>`, the planner, or the annotation model. Three subtle
  depth layers now: empty side recedes (`canvas.inset`), context side
  sits at canvas level, tinted active cells sit "above" the page surface.

  Issue: #227 · PRD: #212 · ADR: 0024

- **Webapp file header: GitHub-style chrome — status icon, collapse
  chevron, copy-path button (issue #225).** The per-file sticky header
  now renders as a flex row with a left disclosure / identity region and
  a right actions / metadata region, matching the GitHub PR
  file-header pattern. The left region carries a collapse chevron
  (`ChevronDownIcon` when expanded, `ChevronRightIcon` when collapsed)
  immediately followed by the diff-status icon (reuses the existing
  `fileIcon(file.type)` helper from the sidebar — `FileAddedIcon` for
  added in `fg.success`, `FileRemovedIcon` for deleted in `fg.danger`,
  `FileMovedIcon` for renames in `fg.muted`, `FileDiffIcon` for
  modified in `fg.muted`), then the existing rename indicator and
  file path. The right region carries the existing classification
  reason tag and a new icon-only copy-path button (`CopyIcon` from
  `@primer/octicons-react`, re-exported via `./icons.ts`). Clicking
  the copy button writes `file.name` to the clipboard via
  `navigator.clipboard.writeText(...)` and stops propagation so it
  doesn't toggle collapse. The button carries `aria-label="Copy file
  path"`, is keyboard-activatable, and shows a subtle hover tint
  (`bg.neutralSubtle`). The header retains its sticky position and
  `canvas.subtle` background. Clipboard failures are swallowed
  silently — the button is best-effort.

  Issue: #225 · PRD: #212 · ADR: 0024

- **Webapp interactive rows: banner treatment for gap / boundary /
  collapsed-file expansion affordances (issue #224).** The
  `<InteractiveRow>` primitive (gap-mid-top, boundary-top,
  boundary-bottom, collapsed-file) now renders as a quiet full-width
  section-divider banner instead of a small button-y blob anchored in
  the leftmost subgrid column. Background uses
  `theme.bg.neutralSubtle.web` — deliberately distinct from the hunk
  header's `bg.accentSubtle` accent tint so the two banner families
  differentiate at a glance (hunk header = navigation marker;
  interactive row = expansion control). The glyph centers
  horizontally in `theme.fg.muted` with 6px vertical padding.
  Click + key semantics are unchanged — plain click expands
  `EXPANSION_STEP`, shift-click expands `Math.max(gapAbove,
  EXPANSION_STEP)`, Enter while cursored dispatches the same.
  Cursor-outline scope stays row-wide (interactive rows have no
  per-side meaning). Implementation mirrors the
  `<HunkHeaderBanner>` pattern: drop the subgrid inline style so the
  row spans 1 / -1 as a block, and let a `.tour-row-interactive` CSS
  rule override `.tour-row`'s `display: grid` + subgrid template.

  Issue: #224 · PRD: #212 · ADR: 0024

- **Webapp hunk headers: GitHub-style banner with parsed range +
  context segments (issue #223).** Hunk-header rows now render as a
  full-width section-divider banner instead of the prior single-glyph
  interactive row. The header string is parsed via the canonical
  `^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)\s*(.*)$` regex into a range
  segment (`@@ -a,b +c,d @@`, muted `fg.muted` color) and a context
  segment (everything after the second `@@`, `fg.default` color); a
  malformed header falls through to a single muted span of the raw
  string. The banner spans the full file-grid width (`grid-column:
  1 / -1`) with a subtle `bg.accentSubtle` tint, 6px vertical padding
  for section weight, and `cursor: pointer`. Expansion semantics are
  unchanged — plain click expands `EXPANSION_STEP`, shift-click
  expands `Math.max(gapAbove, EXPANSION_STEP)`, Enter while cursored
  dispatches the same. A new `<HunkHeaderBanner>` primitive sits
  alongside `<DiffRow>` / `<CardRow>` / `<InteractiveRow>` in
  `row-components`; `<FileBlock>`'s `renderHunkHeader` switches from
  `<InteractiveRow>` to the new primitive while preserving the
  `data-subkind` / `data-boundary-ref` attributes the App-level
  `scrollCursorIntoView` queries. The cursor-outline + range-tint
  decorations remain row-keyed (`.tour-row.is-cursor` selector list
  unchanged).

  Issue: #223 · PRD: #212 · ADR: 0024

- **Webapp diff rows: two-tone tinting + `+`/`-` symbol column (GitHub
  parity, issue #221).** Diff rows now match GitHub's visual signature:
  the line-number gutter + a new symbol cell carry a lighter green/red
  tint (`bg.successRange.web` / `bg.dangerRange.web`); the code cell
  carries a darker green/red tint sourced from two new theme tokens
  (`bg.successCell.web` / `bg.dangerCell.web`). A narrow `+`/`-`/blank
  symbol cell now sits between each line-number gutter and its code
  cell — `+` on addition / change-addition rows, `-` on deletion /
  change-deletion rows (and on the deletion side of paired change rows
  in split layout), blank on context rows to keep columns aligned. Line
  numbers are right-aligned, muted (`fg.muted`), and padded so they
  don't butt the gutter edges. File-grid templates flip from 4 / 2
  tracks to 6 / 3: split `auto auto 1fr auto auto 1fr`, unified
  `auto auto 1fr`. Card / composer side-anchoring updates accordingly:
  in split layout deletion cards span cols 1-3, addition cards span
  cols 4-end. No planner / row-primitive-prop / annotation-model
  changes — purely renderer-side. The cursor outline, range tint, and
  interactive rows continue to span the full track count via
  `grid-column: 1 / -1`.

  Issue: #221 · PRD: #212 · ADR: 0024

- **Parity test harness: render canonical Tours through both renderers
  + compare (PRD #212 slice 6).** New `tests/web/parity-render.test.ts`
  is the merge gate for the Pierre → Tour-owned web row renderer
  cutover (next slice). For every canonical fixture under
  `tests/web/parity-fixtures/` (single-small-file, many-files,
  hidden-context, orphan-window-annotations, file-renames,
  binary-files, classifier-collapsed, stacked-annotations,
  deep-link-ann, layout-split-and-unified, expansion-applied), the
  harness parses the patch via `parsePatchFiles`, computes the
  planner's `PlannedRow[]`, mounts the new `<FileBlock>` (#218) per
  file in happy-dom, renders Pierre's SSR HTML per file via
  `@pierre/diffs/ssr`'s `preloadFileDiff` / `preloadMultiFileDiff`,
  extracts normalized row sequences from both DOMs, and asserts (a)
  the new-renderer DOM equals the planner expected sequence row-for-
  row (full parity including annotations + interactive rows), and (b)
  the new-renderer's Pierre-visible projection equals Pierre's SSR
  diff-row backbone (skipped for fixtures whose Pierre-side semantics
  diverge by design — classifier-collapsed files, fixtures with
  expansion state, and fixtures supplying full file contents where
  Pierre's `MultiFileDiff` re-computes hunk boundaries). Normalization
  strips React-generated keys, shadow-DOM vs light-DOM container
  differences, class strings, and syntax-highlighting span colors;
  preserves row kind, line numbers per side, plain-text row content,
  hunk-header text, and annotation anchor row. After the cutover
  deletes Pierre, the harness deletes itself.

  Issue: #219 · PRD: #212 · ADR: 0024

- **`<FileBlock>`: per-file React component owning the grid, lazy
  highlight, planner walk, and row dispatch (PRD #212 slice 5).** New
  `src/web/client/FileBlock.tsx` exports a `React.memo`'d `<FileBlock>`
  that renders one file's diff via the Tour-owned path. Owns the
  sticky file header (rename pill + classification reason), the
  file-level grid container (`<div class="tour-file-block"
  data-layout>`), and the per-file planner walk that dispatches each
  `PlannedRow` to `<DiffRow>` / `<CardRow>` / `<InteractiveRow>` from
  #217. Calls `useLazyHighlight` (#215) twice — additions side on
  `file.newContent`, deletions side on `file.oldContent` — and routes
  the resulting token maps into `<DiffRow>`'s `tokensLeft` /
  `tokensRight` props. Hunk-header rows promote to `<InteractiveRow>`
  (`boundary-top` for hunkIndex 0, `hunk-separator` otherwise) so the
  `@@` row and the expansion affordance share one component;
  `gap-mid-top` / `boundary-bottom` route directly. `isCursor` flows
  from the `cursor` prop via type-aware matching: `RowAnchor` (file +
  side + lineNumber, or `interactive.subKind` + `boundaryRef` for
  gap-row family) for rows, `CardAnchor` (annotationId) for cards.
  Expansion clicks dispatch a discriminated `ExpandAction` to the
  parent — `{ kind: "expand", file, boundaryRef, direction, count }`
  for gap expansion, `{ kind: "expand-file", file }` for collapsed
  files. Composer rendering: when `composerAnchor` matches a diff row
  in this file, the parent-supplied `composerSlot` renders inline at
  that row's position via a `.tour-card`-positioned wrapper (same
  grid-column rules as `<CardRow>`). Collapsed state suppresses the
  grid body while keeping the header visible + toggleable. Unused at
  this slice's merge time; slice 6 swaps `<FileDiff>` /
  `<MultiFileDiff>` → the `<FileBlock>` list and deletes the Pierre
  adapter pile.

  Issue: #218 · PRD: #212 · ADR: 0024

- **`row-components`: `<DiffRow>`, `<CardRow>`, `<InteractiveRow>` —
  memo'd prop-driven row primitives for the Tour-owned web row renderer
  (PRD #212 slice 4).** New `src/web/client/row-components.tsx` exports
  three `React.memo`'d components, each a stateless leaf the new web
  renderer mounts via `core/diff-rows.ts`'s `PlannedRow[]`. `<DiffRow>`
  renders a single diff line (split-pair or unified-single), paints
  token HTML via `dangerouslySetInnerHTML` from the per-line maps
  `useLazyHighlight` supplies, falls back to plain text when tokens are
  absent, applies `.is-cursor` / `.in-range` className cues from props,
  and reports the clicked column's `side` to `onClick` for annotation-
  creation seeding. `<CardRow>` wraps the existing `AnnotationCard`
  with inline `grid-column` per Layout × Side (full-width unified,
  1/3 deletions / 3/-1 additions split) and passes through all card
  props (registerRef, reply composer target, send-to-agent, replyLock).
  `<InteractiveRow>` renders the gap-row family (hunk-separator chevron,
  gap-mid-top, boundary-bottom, collapsed-file); its click handler
  honors shift-modifier for full-gap expansion (`Math.max(gapAbove,
  EXPANSION_STEP)`) and the keydown handler activates on Enter while
  `isCursor` is true (mirrors the chevron-click action — same modifier
  rules apply). Cursor decoration is a prop on all three (the legacy
  `data-tour-cursor` attribute-mutation pattern retires at slice 6).
  Unused at this slice's merge time; slice 5's `<FileBlock>` consumes
  these components; slice 6 swaps `App.tsx`'s renderer reference and
  deletes the Pierre adapter pile.

  Issue: #217 · PRD: #212 · ADR: 0024

- **`useLazyHighlight` hook: IntersectionObserver-driven lazy
  tokenization for the web row renderer (PRD #212 slice 2).** New
  `src/web/client/use-lazy-highlight.ts` exposes
  `useLazyHighlight(ref, content, lang) → Map<lineNumber, html> | null`.
  Returns `null` until an `IntersectionObserver` with `rootMargin:
  "200px"` reports the block element near the viewport; once visible,
  awaits `ensureHighlighter()` (if not already resolved) and returns the
  token map from `tokenize(content, lang)`. Memoizes on `(content, lang)`
  — same args across re-renders return the same Map reference so
  downstream `React.memo` rows don't churn. The hook also holds the
  plain-text-fallback reference stable for unsupported languages (the
  underlying `syntax-highlight` module stopped caching that path in
  #214). Observer is disconnected on unmount and resilient to the
  pre→post-init transition: when the highlighter resolves, the hook
  re-tokenizes and swaps in the styled map. No existing rendering paths
  change — Pierre's `<FileDiff>` continues to run unchanged.

  Issue: #215 · PRD: #212 · ADR: 0024

- **`file-grid-css` module for the Tour-owned web row renderer.** New
  `src/web/client/file-grid-css.ts` exports `FILE_GRID_CSS`, the layout
  + visual-cue stylesheet the new web row renderer (PRD #212 slice 3)
  injects at the diff pane root. Owns: per-file `<div>` grid with split
  (4-column: gutter-L, code-L, gutter-R, code-R) and unified (2-column:
  gutter, code) templates flipped by `data-layout`; per-row `<div>`
  subgrid spanning all columns; `+` / `-` / `change-*` line-type
  backgrounds keyed on `data-line-type`; cursor outline keyed on a
  `.is-cursor` className (prop-driven, ADR 0024's "cursor outline is a
  prop" decision — replaces the legacy attribute-mutated selector);
  range tint via `.in-range`; sticky `.tour-file-header`; comment-
  affordance pointer on annotatable rows; side-anchored cards
  (`.tour-card[data-side]`, cols 1-2 deletions / 3-4 additions in
  split, full-width in unified). All colors source from `core/theme.ts`
  tokens — no new tokens, no duplicated hex literals. Unused at this
  slice's merge time; slices 4-6 wire it into `<FileBlock>` and swap
  in `App.tsx`.

  Issue: #216 · PRD: #212 · ADR: 0024

- **Foundation for the Pierre → Tour-owned web row renderer migration.**
  New `src/web/client/syntax-highlight.ts` deep module exposes
  `tokenize(content, lang) → Map<lineNumber, html>` over a singleton
  Shiki highlighter pre-loaded with the common-language set (TypeScript,
  TSX, JavaScript, JSX, JSON, Markdown, Bash, YAML, CSS, HTML, Python,
  Rust, Go) under `github-dark-default`. Memoized per `(content, lang)`;
  returns a stable empty Map for empty content; HTML-escapes the
  plain-text fallback for unsupported langs or pre-init calls.
  `detectLang(filename)` maps file extensions to bundled languages.
  Companion ADR 0024 documents the renderer-replacement migration; no
  existing rendering paths change in this slice — the old Pierre
  renderer continues to run.

  Issue: #212 · ADR: 0024

- **Tour-session reducer: `bundle.loaded` split into `bundle.refreshed`
  + `tour.switched`.** The single `bundle.loaded` action conflated two
  semantically distinct events: same-tour refresh (watcher / SSE
  `annotation-changed`) and tour-switch (`picker.commit` / `popstate` /
  auto-pick resolution). The reducer now exports two actions:
  `bundle.refreshed { bundle }` replaces the bundle slice in place
  (does NOT touch picker / replyLock / currentTourId / layout — the
  user is still on the same tour) and `tour.switched { tourId, bundle }`
  applies the CONTEXT-pinned Tour-switch reset cascade (replaces
  bundle, sets currentTourId, closes picker, resets replyLock to idle,
  preserves layout). A new `replyLock.loaded { replyLock }` action
  replaces the reply-lock slice for the watcher / SSE paths; a new
  `isBundleResolved(state)` selector unwraps the outer `RemoteData.ok`
  layer and returns the TourBundle (or null). Both Apps' local
  `useState`s for the bundle (and the TUI's local `replyLock`
  `useState`) are deleted — rendering reads bundle from
  `isBundleResolved(sessionState)` as the single source of truth. The
  store's bundle slice is now authoritative, unblocking slice 2
  (Cursor + Watcher) which depends on synchronous reducer transitions
  when the watcher fires. (#211 · PRD #207)
- **TUI Picker now routes through the Tour-session store (slice 1
  surface wiring, TUI side).** The TUI's `t` keystroke, `j`/`k` picker
  navigation, `Enter` commit, and `Esc`/`t` close all dispatch into
  the `TourSessionStore` from `core/tour-session.ts`. Picker state
  (`pickerOpen` / `pickerCursor` / `pickerTours` / `pickerCounts`)
  is no longer held in `tui/app.tsx` `useState`; reads come from the
  store via `useTourSession`. The initial Tour-list fetch dispatches
  `tourList.loading` → `tourList.loaded` / `tourList.failed`. An
  intent listener realizes `loadTour` (in-process bundle reload +
  CONTEXT-pinned cursor / folds / overrides / expansion resets;
  picker close + reply-lock idle come from the reducer's
  `bundle.loaded` cascade) and `scrollPickerRow` (OpenTUI
  `scrollChildIntoView` on the picker modal scrollbox); `mirrorUrl`
  is ignored (TUI has no URL). Webapp untouched. (#209 · PRD #207)
- **Webapp Picker is thin through the Tour-session store (slice 1).**
  `src/web/client/App.tsx` no longer holds `useState` for `pickerOpen`
  or `tourList`; a per-mount `TourSessionStore` (PRD #207 / slice 1)
  owns those slots and the App reads them via `useTourSession(store)`.
  Keymap (`t` / `j` / `k` / `Enter` / `Esc`), hamburger button, scrim
  click, and row click / hover all dispatch `picker.open` / `.close` /
  `.move` / `.commit` actions. The intent listener realizes
  `loadTour` (→ `fetch('/api/tours/:id')` → `bundle.loaded` /
  `bundle.failed`), `scrollPickerRow` (→ DOM `scrollIntoView`), and
  `mirrorUrl` (→ `history.pushState`). The mount-time `/api/tours`
  fetch dispatches `tourList.loading` / `.loaded` / `.failed`. The
  `popstate` listener dispatches `bundle.loading` + triggers the
  bundle fetcher rather than mutating local React state. CONTEXT-
  pinned Tour-switch reset rules for the slice-1 slots (picker
  closed, reply-lock reset, layout preserved) are sourced from the
  reducer's `bundle.loaded` branch; slots not yet in the reducer
  (cursor / folds / composer / sidebar selection) still reset in the
  webapp on `currentTourId` change pending later slices. The TUI is
  untouched. `picker.move`'s `delta` widened from `1 | -1` to
  `number` so row-click / row-hover can jump to the target idx with
  a single dispatch. (#210 · PRD #207)
- **Tour-session foundation module (slice 1: Picker).** New
  `core/tour-session.ts` lands the live state aggregate a single
  surface drives for one opened Tour as a pure `(state, action) →
  {state, intents}` reducer wrapped in a small `TourSessionStore`
  (`getState` / `subscribe` / `onIntent` / `dispatch`) and a
  `useTourSession(store)` React hook over `useSyncExternalStore`.
  Slice 1 exports the Picker, bundle, tourList, replyLock, layout,
  and `currentTourId` slots plus the `RemoteData<T>` discriminated
  union (`idle | loading | ok | err`) and its `map` / `withDefault`
  / `isOk` helpers, the `Action` / `Intent` discriminated unions,
  and selectors `isPickerOpen` / `pickerHighlighted` /
  `currentTourSummary`. Cursor / folds / composer / expansion
  slices are intentionally absent from this slice and land in
  subsequent slices on top of the same module. No surface wiring:
  `tui/app.tsx` and `web/client/App.tsx` are unchanged; both Apps
  continue to own their state as parallel `useState`. The
  CONTEXT-pinned Tour-switch reset rules (layout preserved;
  picker closed; reply-lock cleared) live in the reducer's
  `bundle.loaded` branch. (#208 · PRD #207)
- **Core seam for explicit reply-agent dispatch.** Two new pure entry
  points land in `core/` ahead of the dispatch-trigger flip (PRD #181):
  `requestReply(opts)` in `core/reply-runner.ts` is the single dispatch
  entry point both surfaces will converge on — it validates the
  annotation (must exist, be human-authored, and not yet have a Reply),
  atomically acquires `.reply-lock.json`, spawns the configured agent,
  captures stdout as the Reply Annotation, and releases the lock,
  returning a discriminated `{ kind: "dispatched" | "busy" |
  "invalid-annotation" | "no-reply-agent" }`. `canSendToAgent(...)` in
  `core/can-send-to-agent.ts` is the pure predicate consumed by both
  surfaces to decide visibility/enabled state of the per-card
  affordance. No surface or watcher wiring is changed in this slice —
  the watcher-driven auto-dispatch still works exactly as today. (#182)
- `tour serve` prints a one-line tip when exactly one shipped agent CLI
  (`claude`, `codex`, `gemini`, `opencode`, `pi`) is reachable on PATH
  and `--reply-agent` is not passed, suggesting the flag. Zero or
  multiple matches stay silent. The tip is informational only — the
  reply watcher remains inert unless `--reply-agent` is explicitly
  given (ADR 0010 inert-by-default invariant). (#176)

### Changed

- **`n` / `p` is a pure topLevel-order jump again; cursor row position is
  not consulted (issue #206 reverts #203).** Pre-revert, `n` / `p` from
  a `RowAnchor` ran a position-aware walk over `topLevel` and returned
  the first annotation at or after the cursor's stream position.
  Design review concluded that's a design overreach: `n` / `p` is the
  **jump** gesture (ADR 0023) — its job is to drive the `[N/M]` pill
  counter through `topLevel` (created_at) order, period. The cursor's
  row position is a separate track. Under the canonical model, from a
  `RowAnchor` `n` enters the annotation track at `topLevel[0]`, `p`
  enters at `topLevel[topLevel.length - 1]`, and subsequent presses
  walk the `topLevel` index. Reviewers who want the next annotation in
  reading order from a row press `k` (which honours stream order
  natively) — `n` / `p` and `j` / `k` are deliberately different
  gestures. The `files: ReadonlyArray<string>` parameter introduced by
  #203 is removed from `nextCard` / `prevCard` / `walkCards`; both call
  sites drop the `.map(f => f.name)` rigging. `CardAnchor` semantics
  (still walks `topLevel` by index, issue #197) and null-cursor
  semantics (still falls back to the `topLevel` edge) are unchanged.
  Stale `CardAnchor` (id not in `topLevel`) falls back to the
  `topLevel` edge again — same as a null cursor — reversing the
  null-return introduced by #203. The pill counter logic
  (`currentIdx = topLevel.findIndex(a => a.id === cursorCardId)`
  showing `— / M` from a `RowAnchor`) is unchanged. (#206)

- **`tour serve` reuses a running server when one already exists for the
  same working directory — even on a fallback port.** Before binding,
  the entry point now probes **every** port in the fallback range
  (`GET /__alive`). If any of them hosts a Tour server whose `cwd`
  matches, prints `Tour already running at http://127.0.0.1:<port>`
  and exits 0 — no second server is started. Other-cwd Tours and
  non-Tour processes are silently skipped during the walk (no surprise
  `EADDRINUSE` surfaces to the user); the first free port is bound.
  Explicit `--port N` keeps single-port semantics: reuse if a same-cwd
  Tour is at N, else the existing `port N is in use` error. The
  slice-1.5 fix probed only the preferred port and missed same-cwd
  Tours that had landed on a fallback. Stable URLs across re-runs; no
  process / watcher proliferation, regardless of which port the
  existing server happens to be on. (#178, #195)
- **`tour serve <id>` prints a deep URL.** When a positional tour-id is
  passed, the startup line now includes `/<id>` as a path component
  (e.g. `Tour server running at http://127.0.0.1:8687/<id>`) so the
  user can Cmd-click straight to that tour in a modern terminal.
  `tour serve` without a tour-id is unchanged (bare base URL). The
  port-collision fallback path also includes `/<id>` and reflects the
  actually-bound port. `--open` opens the deep URL too. (#179)
- **SPA reads tour-id from the URL path and annotation-id from the URL
  fragment.** Precedence is path → query → baked global for tour-id,
  fragment → query for annotation-id. Loading `/<tour-id>` always
  displays that tour regardless of what id the server's HTML carries —
  the probe-reuse case (Issue #178) no longer mis-routes the printed
  deep URL. Loading `/<tour-id>#<ann-id>` scrolls to the named
  annotation. Internal navigation (tour-picker, n/p cursor) now writes
  the new path + fragment shape; legacy `?tour=&ann=` URLs remain
  readable as a back-compat fallback. (#179)
- **TUI footer hint labels the `a` action as `comment`** (was
  `annotate`), aligning Tour's vocabulary with the universal
  convention used by every collaborative code-review tool. The webapp
  composer's affordance already read "Comment" / "Leave a comment".
  The `a` keybinding, the `tour annotate` CLI verb, the "Annotation"
  domain noun, the schema, and the Pierre `AnnotationSide` coupling
  are all unchanged. (#183)

### Fixed

- **Webapp diff-row line-number gutter and `+`/`-` symbol render in
  monospace at 12px / 20px line-height (issue #241).** The gutter and
  symbol cells were inheriting the body's sans-serif font at 16px with
  browser-computed `line-height: normal`; line numbers rendered with
  proportional-width digits while the code cell rendered in monospace
  at 12px. Because the gutter's content-dependent line-height didn't
  match the code's, the gutter's number drifted out of vertical
  alignment with the first physical row of a wrapped code line. Empirical
  DOM inspection of a live GitHub PR diff shows monospace 12px with a
  fixed `line-height: 20px` on both `.blob-num` and `.blob-code-inner`.
  `.tour-row-gutter`, `.tour-row-symbol`, and `.tour-row-code` now all
  declare the same monospace stack (`ui-monospace, SFMono-Regular,
  "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`),
  `font-size: 12px`, and `line-height: 20px`. The pre-existing chrome
  (text-align, color, padding, user-select on the gutter; text-align,
  padding, color on the symbol; white-space, word-break, tab-size on the
  code) is preserved — the new declarations are additive. Compose
  correctly with the existing cursor outline, range tint, two-tone
  line-type backgrounds, and empty-side neutral fill (orthogonal —
  backgrounds + outline are unrelated to font / line-height).

  Issue: #241

- **Webapp diff-row long lines soft-wrap instead of producing per-cell
  horizontal scrollbars (issue #240).** The #239 monospace + preserved-
  whitespace fix picked Path A (`white-space: pre` + per-cell
  `overflow-x: auto`); the result was that every long line in every diff
  rendered its own horizontal scrollbar — and in split layout, a long
  addition and a long deletion on the same row each got their own,
  independently scrollable. Visually noisy and not how GitHub actually
  behaves (empirical DOM inspection of a live PR diff cell shows
  `white-space: pre-wrap` + `overflow-x: visible`, i.e. soft-wrap).
  `.tour-row-code` now declares `white-space: pre-wrap` (preserves leading
  + internal whitespace identically to `pre`, but breaks at the cell edge)
  + `word-break: break-all` (a single unbroken token — URL, base64 blob,
  generated hash, minified line — wraps at a character boundary rather
  than overflowing). `.tour-row-cell` drops `overflow-x: auto`; the
  default `overflow: visible` is the right behavior under soft-wrap.
  `min-width: 0` remains so the file-grid's `1fr` code track can still
  shrink below content size. The cursor outline, range tint, two-tone
  line-type backgrounds, and empty-side neutral fill all paint via
  `background-color` / `outline` / `box-shadow` which flex with the
  cell's actual height, so the taller wrapped rows compose correctly
  with no other rule change. Shiki token spans set `color: #…` inline;
  the parent's new `white-space` / `word-break` don't touch token colors.

  Issue: #240

- **Webapp diff-row code cells render as code again (issue #239).**
  Pre-Pierre-cutover, Pierre's `<FileDiff>` wrapped each diff line in a
  `<pre>` so the code cell inherited `font-family: monospace` +
  `white-space: pre`. The Pierre cutover (#220) replaced that wrapper
  with a Tour-owned `<span class="tour-row-code">` but didn't carry the
  CSS over — `.tour-row-code` had no rule in `file-grid-css.ts`, so the
  cell inherited the body's sans-serif stack and `white-space: normal`.
  Visible result: leading indentation collapsed, long lines wrapped
  mid-statement under one line number, characters had proportional
  widths. The Shiki token spans were correct; the wrapping container
  just wasn't told to treat its text as code. New `.tour-row-code` rule
  in `file-grid-css.ts` declares `font-family: ui-monospace,
  SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
  `white-space: pre` (Path A — long lines extend horizontally rather
  than wrap), `tab-size: 2`, and `font-size: 12px`. A companion
  `.tour-row-cell` rule adds `overflow-x: auto` + `min-width: 0` so the
  1fr code track can shrink below content size and the long-line
  overflow surfaces as a horizontal scrollbar at the cell instead of
  pushing the file-block past 100% width. Sits orthogonal to the
  existing line-type backgrounds, range tint, cursor outline, and
  empty-side neutral fill — all of which paint backgrounds or outlines,
  not text properties — so no other rule needed to change. Shiki's
  per-token inline `color: #…` styles continue to apply unchanged.

  Issue: #239

- **Webapp annotation range tint + 3px stripe scope to the annotated
  side in split layout (issue #226).** Before this fix, `<DiffRow>`
  received a single `isInRange: boolean` derived from
  `!!(row.leftTinted || row.rightTinted)`, dropped the side
  dimension, and painted the row-wide tint plus a stripe at the row's
  leftmost edge — visually misleading when the annotation lived on
  the additions (right) side. `<DiffRow>` now accepts `leftInRange?:
  boolean` + `rightInRange?: boolean`. Each side's `.tour-row-gutter`,
  `.tour-row-symbol`, and `.tour-row-cell` receive `.in-range` when
  that side is tinted; the leftmost tinted gutter additionally
  carries `.in-range-stripe` (the 3px accent stripe). Both-sides
  fallback preserves the row-leftmost stripe (deletions gutter wins).
  Unified layout collapses to a single tinted column with the stripe
  on the only gutter. Defensive fallback re-routes a side flag that
  points at a column without content to the side that carries a real
  `lineNumber`. The CSS module replaces the `.tour-row.in-range` rule
  with per-cell selectors (`.tour-row-gutter.in-range`,
  `.tour-row-symbol.in-range`, `.tour-row-cell.in-range`,
  `.tour-row-gutter.in-range-stripe`). (#226)

- **Webapp cursor outline no longer spans both columns in split layout
  (issue #222).** After the Pierre cutover (PRD #212 slice 7), the
  cursor outline was painted as `.is-cursor` on the diff row, which
  spans the full file-grid width. In split layout this drew the
  outline around both halves regardless of which side the cursor
  logically belonged to. `<DiffRow>` now accepts a `cursorSide?:
  Side` prop alongside `isCursor`, and emits `.is-cursor` on the
  cursored `.tour-row-cell` (not the row). `<FileBlock>` derives
  `cursorSide` from whichever side's `lineNumber` matched the
  cursor's anchor. `<InteractiveRow>` is unchanged — its outline
  stays full-width. The CSS rule keys on either `.tour-row.is-cursor`
  or `.tour-row-cell.is-cursor`. Falls back to the side carrying
  content when `cursorSide` disagrees (the addition-only /
  deletion-only edge case). (#222)

- **`syntax-highlight` no longer caches its pre-init fallback at the
  same key, so the first post-`ensureHighlighter()` call returns styled
  output (issue #214).** `tokenize()` cached every result, including the
  plain-text fallback returned when the Shiki highlighter had not yet
  initialised. Once a key was cached pre-init, no later post-init call
  at the same `(lang, content)` key returned the styled output —
  `useLazyHighlight`-driven calls that fired before
  `ensureHighlighter()` resolved would paint a file as plain text for
  the rest of the session. The fix is small: only cache the styled
  path. The fallback paint is cheap (split + escape) so recomputing on
  pre-init calls is sub-millisecond per file per render. A new
  `tokenize — init transition` regression test exercises the pre→post-
  init sequence without `resetForTests()` between calls. (#214)

- **`tour create` stdout is now the tour-id alone; the "Open with: tour
  tui &lt;id&gt;" hint moves to stderr (issue #205).** Previously the non-JSON
  path wrote both lines to stdout, so `TOUR_ID=$(tour create --head HEAD)`
  captured a two-line value and downstream `tour annotate "$TOUR_ID"` failed
  with a no-matching-prefix error because the prefix lookup saw the hint
  appended. The hint now goes to `console.error`, so it still reaches an
  interactive TTY (stderr defaults to the same terminal) but is excluded
  from `$()` substitution. `2>/dev/null` suppresses it cleanly without
  affecting the captured id. `--json` mode is unchanged: stdout carries
  the structured Tour object, stderr is empty. (#205)

- **`tour serve` dev mode discriminator no longer trips when
  `embedded-client.ts` is in a populated state (issue #204).** The
  dev-vs-binary discriminator inside `tour serve` was a truthy-check on
  the *content* of `EMBEDDED_CLIENT_JS` / `EMBEDDED_PIERRE_WORKER_JS` in
  `src/web/embedded-client.ts`. If the binary build pipeline was
  interrupted (Ctrl-C, crash, partial `git stash pop`, a stale checkout
  pulling the populated form) the file was left with real bundle strings
  but no flag distinguishing it from a real binary build, so any
  subsequent `tour serve` against that working tree silently fell into
  the compiled-binary fast-path and served the stale embedded bundle —
  the dev-mode auto-reload from #202 appeared broken with no log line or
  banner explaining why. The discriminator is now an explicit
  `EMBEDDED_BUILD_MODE: "dev" | "binary"` marker that the binary build
  pipeline flips atomically with populating the bundle strings;
  `scripts/build-binary.ts` restores both fields together (and now also
  on SIGINT/SIGTERM/uncaughtException, not just child exit). In dev mode
  the marker stays `"dev"` regardless of what's in the strings, so the
  cache falls through to the runtime Bun.build path. (#204)

- **`tour serve` no longer caches a stale client bundle across source
  edits (issue #202).** Dev-mode `tour serve` (running from
  `bun src/main.ts serve` or `npm run cli serve`) snapshotted the
  webapp client bundle on the very first `/client.js` request and held
  that snapshot for the lifetime of the process. Editing source and
  re-running `bun scripts/build-client.ts` kept serving the old bytes
  until the user killed and restarted serve — every hard browser
  reload returned the stale bundle silently, masking source-level
  fixes during live verification. The two-mode cache now sticks only
  on the immutable compiled-binary fast-path (`EMBEDDED_CLIENT_JS` /
  `EMBEDDED_PIERRE_WORKER_JS` are baked at compile time); in dev mode
  the bundle is rebuilt on every request, with concurrent calls
  coalesced into one in-flight `Bun.build` so a single page load
  fetching `/client.js` + `/pierre-worker.js` triggers one build, not
  two. Errors are also no longer sticky-cached — fixing a broken
  source file no longer requires a serve restart.

- **`tour create` defaults `--base` to the merge-base with HEAD's
  upstream on multi-commit branches (issue #201).** Previously the
  default was always `<head>^` (`HEAD` for `WIP`), which is correct for
  a single-commit branch but too narrow for a multi-commit one — only
  the last commit shows up in the Tour. Users worked around it by
  passing `--base origin/main`, which has the inverse failure mode:
  every commit that landed on main since the branch diverged appears
  as inverted deletions, burying the user's actual changes. The new
  default probes `<head>@{upstream}` (HEAD@{upstream} for `WIP`) and
  uses the merge-base only when it's strictly between `<head>` and
  `<head>^` (i.e. the branch is ≥2 commits ahead of upstream) —
  matching the scope GitHub uses for PR diffs. Detached HEAD, no
  configured upstream, single-commit branches, and any other
  resolution failure fall back to `<head>^` (or `HEAD` for `WIP`),
  unchanged from before. Explicit `--base <ref>` is honored verbatim
  in every case. `base_source` now records the resolved label
  (`merge-base(<tip>@{upstream})`, `HEAD^`, `HEAD`, or the user's
  literal flag) so `tour show` makes the choice visible.

- **`j`/`k` now steps onto Annotation cards instead of skipping them
  (PRD #192 / ADR 0023, supersedes ADR 0022's two-lane rule).** Pressing
  `j` from the diff row immediately above an Annotation card landed the
  cursor on the row AFTER the card, not the card itself — a `while
  (flatRows[next].kind === "card") next += step` loop in `moveCursor`
  filtered cards out of the row lane. The two-lane partition (`j`/`k`
  walks rows only, `n`/`p` walks cards only) was deliberate under ADR
  0022 but didn't match how reviewers actually walk a Tour: the eye
  reads in row order and expects the cursor to stop on every visible
  stop, including cards. Replaced with the **step / jump** model: `j`/`k`
  is one row per press, no destination filter (cards, diff rows, and
  interactive rows all count as one step); `n`/`p` stays one top-level
  Annotation per press regardless of distance. `CardAnchor` now also
  carries `preferredSide` so an `h`/`l` choice survives step-across-card
  and jump-between-cards — a `j` past an additions-side card from a
  `preferredSide: "deletions"` row keeps the deletions preference for
  the next paired row landing. Active under both surfaces via the
  shared `core/cursor-state.ts` helpers; the webapp's URL-mirror and
  re-anchor policies are unchanged (a CardAnchor still mirrors as
  `#<ann-id>` regardless of how the cursor arrived). (#200, PRD #192
  / ADR 0023)

- **Planner: `planRows` now scopes annotations to the file being planned
  (PRD #192 / ADR 0022).** Pressing `j` or `k` from a CardAnchor on the
  webapp jumped to a row in a different file: the row-anchored cursor
  landed in the alphabetically-earliest file whose line range overlapped
  the card's annotation `line_end`, rather than the annotation's own
  file. Root cause: the webapp called `planRows(file, allAnnotations,
  …)` per file (no upstream filter), and `interleaveAnnotations` +
  `applyAnnotationFlags` matched anchors by `(side, line_end)` without
  checking `ann.file`. Every file therefore got phantom card rows + tint
  flags for every foreign annotation whose `line_end` fell inside its
  line range. `flatRows()` emitted those phantoms into the cross-file
  flat-row stream, `resolveCursorRowIdx(CardAnchor, flatRows)` resolved
  to the first phantom, and `moveCursor` stepped into the wrong file's
  row. The fix scopes once at the top of `planRows` —
  `annotations.filter(a => a.file === file.name)` — so every downstream
  helper inherits a file-scoped list. The visible card rendering was
  unaffected because `<FileBlock>` filters Pierre's `lineAnnotations`
  upstream; only the planner-driven cursor-navigation model was poisoned.
  `nextCard`/`prevCard` were already correct after #197 (they walk the
  canonical top-level Annotation list). The TUI also routes through this
  planner — happened not to expose the bug because the TUI's call site
  pre-filtered annotations, but the fix is equally correct on both
  surfaces and removes a footgun for any future caller. (#199, PRD #192
  / ADR 0022)

- **Webapp: URL hash clears when the cursor moves from a card to a row
  (PRD #192 / ADR 0022).** Symmetric follow-up to #197's re-anchor fix.
  The URL-mirror effect's defer gate read `cursorCardId === null`, which
  under the unified-cursor model collapses two distinct cases: "cursor
  is null" (tour-load, the restorer is about to anchor — must defer to
  avoid strip-then-restore in one cycle, per Issue #180) and "cursor is
  a RowAnchor" (the user pressed `j`/`k` or clicked a diff row — must
  write a bare `/<tour-id>` so the stale `#<ann-id>` doesn't survive
  reload). The previous gate suppressed both, leaving the hash stuck on
  the card the user just left. The discriminator now keys off the full
  cursor via a new pure `decideMirrorUrl(cursor, topLevel, tourId)`
  policy in `web/client/mirror-policy.ts`: `cursor === null` with
  annotations → skip; CardAnchor → write `/<tour-id>#<ann-id>`;
  RowAnchor → write `/<tour-id>` (drop the hash). Mirrors `decideReanchor`
  from #197 — both effects key off the same shape now. (#198, PRD #192
  / ADR 0022)

- **Webapp: `n`/`p` walks top-level order; `j`/`k` no longer flickers
  back to a card (PRD #192 / ADR 0022).** Two regressions in the webapp's
  unified-cursor adoption:

  Bug A — `nextCard`/`prevCard` iterated the flat-row display stream
  while the `[N/M]` pill counter read top-level (JSONL `created_at`)
  order. When the two orderings diverged (any Tour whose annotations
  were not authored in file display order — most real-world Tours),
  pressing `n` from pill `1/19` could land on `8/19` rather than `2/19`.
  The walkers now consume the canonical top-level Annotation list
  directly, so `n` from `K/M` always lands on `K+1/M`. The TUI's
  navigation goes through the same walker — `liveTopLevel` replaces
  `flatRowsList` at the TUI call site too. The webapp's row cursor no
  longer needs `flatRowsList` to compute the card target, which also
  drops the `flatRowsListRef` mirror that existed for that one read.

  Bug B — the bundle-load re-anchor effect's null-check (`cursorCardId
  === null`) treated "user moved to a row" the same as "tour just
  loaded, no cursor yet". Pressing `j`/`k` from a CardAnchor cursor
  set the cursor to a RowAnchor, but the effect re-fired within the
  same render, read the still-stale URL fragment, and snapped the
  cursor back to the original CardAnchor — one frame of row-outline
  flicker, zero motion. The discriminator is now `cursor === null`
  via a new pure `decideReanchor(cursor, annFromUrl, topLevel)`
  policy in `web/client/re-anchor-policy.ts`: only the fully-null
  cursor takes the URL-restore branch; a CardAnchor whose id is
  missing from `topLevel` takes a stale-fallback branch; any
  RowAnchor cursor is a noop. The policy is testable independent of
  the App component. (#197, PRD #192 / ADR 0022)

- **TUI: `s` now dispatches the latest human leaf in the focused Thread,
  not the cursor-focused top-level Annotation.** Previously, once a
  Thread had any Reply, the per-Annotation `canSendToAgent` predicate
  rejected the top-level with `already-replied` — the footer hint
  disappeared and pressing `s` was a silent no-op, so `s` stopped
  working as soon as the conversation had started. The keystroke now
  targets the latest human leaf in the Thread via the existing
  `latestHumanLeafId` helper (the same one the webapp uses post-#190
  / #191). The footer `s: send to {agent}` hint appears whenever
  `--reply-agent` is set AND the focused Thread has a non-null latest
  human leaf; pressing `s` dispatches `requestReply` against that
  leaf's id. When the latest turn is agent-authored, the hint hides
  and `s` is a silent no-op (the user is expected to write a human
  Reply first). Lock-held + no-cursor footer-status flashes are
  preserved unchanged. `n`/`p` annotation navigation still walks
  top-levels only — this fix makes `s` Thread-aware so the navigation
  gap doesn't dead-end dispatch. (#196, PRD #181)

- **Webapp: unified Cursor + auto-recall (Slice 2 of PRD #192 / ADR 0022).**
  The webapp now uses the same tagged-union `Cursor` the TUI adopted in
  #193 — `currentAnnotationId` state is fully gone. Click on a diff row
  writes a `RowAnchor`; click anywhere on an Annotation card writes a
  `CardAnchor` for that card; `n`/`p` walks the card lane via
  `nextCard` / `prevCard` from `core/cursor-state.ts`; `j`/`k` walks the
  row lane and skips cards. New keyboard shortcuts: `r` on a card opens
  the Reply composer (targeting the thread's latest annotation per #191);
  `s` on a card dispatches to the configured reply-agent (with the
  unchanged `canSendToAgent` verdict gate). `r`/`s` are no-ops on a row
  / null cursor; `a` is row-only (no-op on a card). When `r` or `s`
  fires while the cursor's card is off-screen, the page smooth-scrolls
  the card into view BEFORE the composer mounts / agent dispatches —
  auto-recall, the webapp's at-action affordance equivalent of the
  TUI's footer-preview. Sequencing uses `scrollend` with a 250 ms
  timeout fallback for Safari < 18 (extracted to `auto-recall.ts` so
  it's testable without mounting <App />). The URL `?ann=<id>` /
  `#<ann-id>` mirror now keys off `cursor.kind === "card"`: present
  when the cursor is on a card, absent on a row or null; stale ids
  (Reply / deleted / hand-edited) fall back to the first top-level
  Annotation and `replaceState` rewrites the URL. `popstate` syncs the
  cursor back to the URL fragment. The top-header SequencePill renders
  `—/M` when the cursor isn't on a card. In-card Reply / Send mouse
  buttons additionally land the cursor on the clicked card so a
  follow-up keyboard `r` / `s` targets it. (#194, PRD #192)

- **TUI: unified Cursor walks diff rows + Annotation cards under a single
  anchor (Slice 1 of PRD #192 / ADR 0022).** Previously the TUI tracked
  two separate cursors — a `❯` line cursor for diff/interactive rows and
  `currentAnnotationId` for the heavy-bordered card — and pressing `r`
  after a wheel-scroll could reply to a card the user wasn't looking
  at. The two pieces of state are now collapsed into one tagged-union
  `Cursor = RowAnchor | CardAnchor` that walks rows and cards alike:
  `j`/`k` step rows (skipping cards), `n`/`p` step cards (skipping
  rows). Action keys dispatch by the cursor's row kind — `r`/`s` are
  card-only, `a` is row-only, mismatches surface a footer hint
  ("r: no annotation under cursor — n/p to navigate"). A new
  footer-preview line always renders the cursor's `r` target ("r: reply
  to "<title>"") and appends a direction indicator ("(cursor ↑ above
  viewport)") when wheel-scroll has parked the cursor off-screen. When
  `r` or `s` fires on a card whose row is off-screen, the diff pane
  scrolls the card into view before the composer mounts (auto-recall).
  `currentAnnotationId` is fully removed from `tui/app.tsx`; the
  top-header pill renders `—/M` when the cursor isn't on a card.
  `core/cursor-state.ts` exports the union and the new `nextCard` /
  `prevCard` walkers; `core/flat-rows.ts` emits `CardFlatRow` entries
  directly after the diff row each card anchors to. The webapp keeps
  RowAnchor-only behaviour for now (Slice 2 will mirror these changes).
  (#193, PRD #192)

- **Webapp: per-Annotation action rows collapsed into a single bottom
  action row per Thread.** Previously, each human Annotation in a Thread
  rendered its own Reply button and the top-level Annotation rendered
  another action row after the inline-Replies list — producing what
  looked like a duplicate Reply at the bottom of long Threads. The webapp
  `AnnotationCard` now renders exactly one action row at the bottom of
  the Thread (after the inline-Replies list, where the top-level's row
  already sat). The Reply button targets the latest Annotation in the
  Thread by `created_at` (id ascending tiebreak) via the new
  `latestAnnotationId` helper in `core/threads.ts`, so a new Reply
  continues from where the conversation is. The Send button still
  targets the latest human leaf per the unchanged #190 rule. The
  composer continues to render inline under whichever Annotation the
  user targeted; the bottom action row is suppressed while a composer
  is open anywhere in the Thread. `canSendToAgent`, the
  latest-human-leaf rule, `requestReply`, the HTTP endpoint, the
  watcher, the lock, and the on-disk schema are all unchanged. (PRD
  #181, #191)

- **Webapp: "Send to {agent}" renders on the latest human leaf only —
  at most one Send button per Thread.** Previously, the inline-Reply
  action row added in #189 rendered a Send button on every human
  Reply whose `canSendToAgent` verdict said visible, producing visual
  noise in Threads with multiple unanswered human siblings (a real
  Tour stacked two Send buttons under the same agent parent — only
  the chronologically later one was a natural dispatch target). The
  webapp `AnnotationCard` now gates each Send button on a per-Thread
  latest-human-leaf check in addition to the predicate. The
  computation is the pure `latestHumanLeafId(topLevel, descendants)`
  helper in `core/threads.ts`: the latest Annotation in the Thread
  by `created_at` (id ascending tiebreak) is always a leaf in a
  well-formed tree, so the rule collapses to "latest overall, if
  human; otherwise null". When the latest turn is agent-authored,
  no Send button renders anywhere — the user is expected to write a
  human Reply first, which becomes the new latest leaf. Per-Reply
  `Reply` button visibility, `canSendToAgent`'s input/output
  contract, the `requestReply` seam, the HTTP endpoint, the watcher,
  and the lock are all unchanged. (PRD #181 story 11, #190)

- **Webapp: "Send to {agent}" + "Reply" affordances now render on every
  human Reply, not just the top-level Annotation.** Previously, the
  webapp `AnnotationCard` rendered its action row exactly once per
  thread (after the inline Replies list), so a human Reply inside the
  Thread had header + body only — no `Send to {agent}`, no `Reply`. A
  human could author a reply to the agent's Reply via the keyboard
  composer, but the webapp surface offered no way to dispatch that
  human reply to the agent, terminating the Thread at the first human
  turn from the webapp's perspective. The inline-Reply rendering loop
  now produces an action row per human Reply, gated by the same shared
  `canSendToAgent` predicate applied per-Annotation — the one-shot-
  terminal rule applies per-Annotation, not per-Thread, so a Reply
  whose own child has landed hides its Send button. Agent-authored
  Replies render no action row (`agent-card` reason). The Send button
  on a Reply calls `POST /api/tours/:id/request-reply` with that
  Reply's id; the Reply button opens the composer targeted at the
  Reply. (PRD #181 story 11, #189)

- **"Send to {agent}" affordance is hidden once a Reply has landed on the
  parent.** Previously, the predicate returned `{ visible: true, enabled:
  false }` for the `already-replied` case, so the webapp rendered a
  permanently-greyed "Send to {agent}" button on every replied-to
  Annotation and the TUI footer showed the `s` hint with no tooltip on
  press. PRD #181 story 16 and ADR 0021's "one-shot terminal" clause
  both specify the affordance should *disappear* once a Reply lands.
  The predicate now returns `visible: false` on `already-replied`; both
  surfaces' existing visibility gates pick the change up. The
  `already-replied > lock-held` reason precedence is unchanged — both
  are simply now hidden. (#188)

- **Bare `tour serve` prints the auto-picked tour-id in the URL.**
  Previously, `tour serve` with no positional id printed
  `http://127.0.0.1:<port>` — a bare base URL. The SPA then auto-picked
  a tour client-side, but the terminal-printed URL was never refreshed,
  so a user copying the URL out of the terminal shared an ambiguous
  link. The server now pre-picks the same tour the SPA would
  auto-select — the most-recent **open** tour — and bakes that id into
  both `__INITIAL_TOUR_ID__` and the printed URL
  (`http://127.0.0.1:<port>/<id>`). Explicit `tour serve <id>` is
  unchanged. Zero open tours → bare URL, unchanged. The pick rule is
  extracted to a shared `pickAutoTour` helper consumed by both
  surfaces so the server's pre-pick and the SPA's auto-pick agree by
  construction, not by accident. (#187)

- **Address bar updates when the SPA is entered at bare `/`.** The
  URL-writer effect's "URL contradicts state" gate previously read the
  URL with a `null` fallback, so a bare `/` resolved to `null` and the
  writer treated it as a contradiction with the auto-selected tour-id
  in state — skipping the write on every cursor move and freezing the
  address bar at `/`. The gate now uses the state's tour-id as the
  fallback: a bare URL is no contradiction (the writer migrates `/`
  to `/<tour-id>#<ann-id>` on first cursor anchor), while a URL that
  asserts a *different* tour-id (the in-flight tour-switch window)
  still skips. (#180)
