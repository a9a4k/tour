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

- **`tour serve` reuses a running server when one already exists for the
  same working directory.** Before binding, the entry point probes the
  preferred port (`GET /__alive`) and, if it finds a Tour server whose
  `cwd` matches, prints `Tour already running at http://127.0.0.1:<port>`
  and exits 0 — no second server is started. Different-cwd Tour or
  non-Tour processes on the port behave as before (fall back to the
  next port, or surface `port N is in use` when `--port` was explicit).
  Stable URLs across re-runs; no process / watcher proliferation. (#178)
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
