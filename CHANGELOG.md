# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — Unreleased

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

### Added

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
