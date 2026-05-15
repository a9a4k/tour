# "Comment" replaces "Annotation" as the canonical unit term

> **Status:** Cross-surface naming. The unit name flips from `Annotation` to `Comment` across UI copy, CLI verb, keybinding, glossary, and (eventually) source identifiers and on-disk filename. Staged: surface-side changes ship together; source/disk rename lands as a follow-up. Supersedes the unit-name carve-out in ADR 0004.

The unit that an agent or human anchors to `(file, side, line_start, line_end)` is renamed **Annotation → Comment**. CONTEXT.md's glossary flips first, the CLI gains `tour comment` with a permanent hidden `annotate` alias, the TUI keybinding moves `a → c`, and the webapp/TUI footer legends update via the shared `core/footer-hints.ts`. Source-code identifiers, the on-disk `annotations.jsonl` filename, and the dozens of in-prose references in CONTEXT.md follow in a tracked Stage B PR.

## Why

ADR 0004 renamed the *container* (`Review → Tour`) and explicitly kept the *unit* name: "`Annotation` is unchanged — it has no PR-review priors, Pierre's `AnnotationSide` contract (ADR 0001) survives untouched, and the diff-tool industry already uses the term." Three things have changed since that ADR landed.

- **Pierre's contract is gone.** ADR 0024 retired Pierre's renderer; the webapp now consumes `core/expansion-state.ts` and the shared row planner. `AnnotationSide` is no longer an external constraint — the name lives only where Tour chooses to put it.
- **The split already exists, half-done.** Issue #183 / PRD #181 moved the user-facing verb to "comment" (TUI footer `a: comment`, webapp button "Leave a comment"). Issue #334 / ADR 0028 added the webapp footer with the same `a: comment` legend. The codebase already speaks two vocabularies; the question is whether to close the gap or live with it permanently. Industry data point: GitLab lives with the gap permanently (UI = comment, API = note). GitHub, Gerrit, Phabricator, Reviewable, Graphite all converge on one word.
- **The primary reader of source code is now an AI agent.** Tour ships annotations *to* AI agents (via CLI) and the codebase is read *by* AI agents (Claude Code, Codex). Each agent that writes a comment and then reads `core/annotations-store.ts` to debug pays the vocab split twice. Human contributors pay it once; agents pay it constantly.

## Considered Options

- **Status quo (keep the split).** Defensible by GitLab precedent. Rejected: the cost of two vocabularies is paid by every agent reading the source forever, and the only reason to keep the split — Pierre's contract — no longer applies.
- **Rename only UI + CLI; keep source `Annotation`.** Reduces churn. Rejected: it leaves the same agent-side tax as status quo, plus adds inconsistency between CLI ("comment") and source (`Annotation`). Half-done is worse than either end-state.
- **Rename everything in one big-bang PR.** Cleanest end-state. Rejected: the source rename touches ~30 files, the on-disk migration touches every existing `.tour/*/annotations.jsonl`, and the CLI/keybinding changes are independently shippable. Big-bang concentrates risk.
- **Rename everything, staged (selected).** Stage A (this ADR) flips glossary + CLI + keybinding + UI copy in one release. Stage B (tracked separately) renames source identifiers and on-disk filename with a read-old/write-new shim.

## Decisions

### Rename the unit to **Comment** across user surfaces immediately

CONTEXT.md's **Annotation** glossary entry becomes **Comment**. The `_Avoid_` list flips: `annotation`, `review comment`, `note` now appear there (with a note that `annotation` is the legacy Pierre-era term). The opening paragraph's "persisted AI annotations" becomes "persisted AI comments". Reply's definition rewrites to reference Comment. Thread's stays — it's already correct in shape.

### CLI verb: `tour comment` primary, `tour annotate` permanent hidden alias

`tour comment` matches `gh pr comment` — the verb every agent already knows. `tour annotate` stays as a dispatch-table alias forever (≈10 LoC), so existing agent prompts and scripts keep working. No version-flag gating; the alias is documented in `--help` as `(alias: annotate)`. Wire-format JSON is unchanged — `kind: "reply" | "top-level"`, `author_kind`, no `kind: "annotation"` field ever existed. Human-readable stdout strings ("Added N annotations to …") flip to "comments".

### TUI keybinding: `a → c`, hard cutover

`a` moves to `c`. No alias bridge. The primary verb gets the mnemonic letter, consistent with how vim assigns its high-frequency verbs (`d` delete, `y` yank, `c` change). Hard cutover concentrates the muscle-memory hit in one release; an alias would muddy the footer legend and the in-code intent name (`open-top-level-composer`) without bridging anything that matters.

### Webapp keybinding: `a → c` in lockstep

`src/web/client/cursor-keymap.ts:116` flips identically. The shared `core/footer-hints.ts` legend updates once and both surfaces read the new key. Webapp status messages ("No annotation under cursor.", "Send only works on annotation cards.", "Send only works on human annotations.") flip to "comment(s)".

### Reply stays a named noun, not folded into "Comment with `replies_to`"

GitHub/Gerrit model Reply as a structural variant — same record shape, threading is the property. Tour's data shape is the same (the JSONL is one stream of `Annotation`s with optional `replies_to`), but the glossary keeps Reply as a named term because Thread's definition needs a unit smaller than itself ("a top-level Comment plus the chain of Replies attached to it"). Folding Reply means Thread becomes "a Comment whose `replies_to` is null plus the chain of Comments whose `replies_to` points at it" — uglier prose for no clarity gain.

### On-disk format: filename renames in Stage B with one-shot migration

`annotations.jsonl` becomes `comments.jsonl` in Stage B. The Stage B reader checks for `comments.jsonl` first, falls back to `annotations.jsonl`; the writer always writes `comments.jsonl` and renames `annotations.jsonl → comments.jsonl` on first write. JSONL record schema is unchanged (the keys never said "annotation"). The fallback read path can stay forever (≈3 LoC) so existing `.tour/` dirs in the wild keep working without an explicit migration step.

### ADR titles and bodies stay as historical record

ADRs 0003, 0005, 0008, 0010, 0017, 0018, 0022, 0024 reference "Annotation" in titles or rationale. They are not rewritten. They document decisions made under the old vocabulary; rewriting them rewrites history. New ADRs (including this one) use "Comment".

### Stage A scope (this release)

CONTEXT.md glossary entries flip (this commit). ADRs 0029 + 0030 land (this commit). The source-code rename, on-disk filename rename, and prose-reference sweep through the rest of CONTEXT.md are tracked as a follow-up PRD; the codebase remains internally consistent during the gap because the source still says `Annotation` and CONTEXT.md's body prose still references the source under the old name (annotated by the in-flight note at the top of the Language section).

## Consequences

- One vocabulary on every user-facing surface (UI, CLI verb, key legend, keybinding mnemonic, glossary) starting this release.
- Agent scripts using `tour annotate` keep working forever via the hidden alias.
- Existing `.tour/*/annotations.jsonl` files keep working forever via the read-fallback (added in Stage B).
- TUI users adapt one keybinding (`a → c`). Webapp users adapt the same key in lockstep — single muscle-memory event.
- Decision-log credibility is preserved: ADR 0004's "kept the unit name" call is cited and the changed premises (Pierre retirement, existing split, agent-as-reader) are named.
- Internal inconsistency window: between this release and Stage B, source identifiers and most of CONTEXT.md's prose still say `Annotation` while the glossary, CLI, and key labels say "Comment". The in-flight note at the top of CONTEXT.md's Language section marks the migration as ongoing.

## Small contracts pinned

- **CLI alias is silent, not noisy.** `tour annotate …` runs the same code path as `tour comment …` with no deprecation warning. The alias is documented in `--help` (`tour comment (alias: annotate)`) but produces no stderr nag — agents shouldn't be punished for using the old verb forever.
- **Footer legend update is atomic.** `core/footer-hints.ts` is the single edit point. TUI and webapp legends flip together; the shared keys (`j/k`, `h/l`, `n/p`, `c`, `r`, `s`, `L`, `t`) cannot drift between surfaces (ADR 0028's lift-to-core contract).
- **No JSON wire-format change.** Agents that parse `tour comment --json` output get the same record shape (`{ id, file, side, line_start, line_end, body, author, author_kind, created_at, replies_to? }`) as `tour annotate --json` does today. The `kind: "reply" | "top-level"` discriminator is unchanged.
- **`a` becomes a no-op on the TUI**, not an alias. Pressing `a` after the cutover dispatches `noop` with no footer status. The mnemonic clears; no half-state.

## Stage B addendum

Recorded after Stage A landed and Stage B kickoff was approved.

### Intent names flip in Stage B

The keymap dispatchers emit string-typed intents that the App shell switches on. After Stage A, four of these still carry the old vocabulary: `next-annotation`, `prev-annotation` (TUI) and `nav-next-annotation`, `nav-prev-annotation` (webapp). They flip in Stage B to `next-comment`, `prev-comment`, `nav-next-comment`, `nav-prev-comment` respectively. The rename is atomic across the keymap union type, the dispatcher's return arm, the App shell's switch case, and any tests asserting on the intent string — all four points must move in one commit so the typechecker stays green. No behavioural change; identifier-only.

### `AnnotationSide` is not a code identifier — only an ADR-prose artefact

ADR 0001 documented Pierre's external contract under the name `AnnotationSide`. Tour's actual source code never adopted that name — the type is declared as `Side = "additions" | "deletions"` in the files that need it, and the persisted field is just `side`. So Stage B has no `AnnotationSide` rename work in code; the only occurrences are in ADR 0001's text and ADR 0029's own framing, both of which stay as historical record per this ADR's "ADRs stay as historical record" decision above.

### `annotations.jsonl` migration: read-fallback stays forever

The on-disk filename rename (Slice B-disk) writes new state to `comments.jsonl` and renames `annotations.jsonl → comments.jsonl` on first write to any Tour folder that still has the old file. The reader's fallback path — `read comments.jsonl, else read annotations.jsonl` — is approved to stay in the codebase indefinitely (≈3 LoC). No release ever drops the fallback. The cost of carrying it is trivial relative to the cost of a forced migration step or a hard cutover that breaks existing `.tour/` dirs in the wild.
