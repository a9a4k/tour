# Webapp mouse paths to open-in-editor — annotation filename links, file-header `↗` icon

> **Status:** Refines ADR 0032's "No new mouse affordance" / `↗`-only escalation paragraph. The webapp gains two mouse paths to `POST /api/tours/<id>/open-in-editor`: the annotation card's `foo.ts:42-48` location stamp becomes a hover-underlined link, and the file header gets an `↗` icon in `tour-file-header-right` next to `↕`. Treatment is asymmetric on purpose — annotation filename reads as a location reference and matches the stack-trace linkification convention; the file header filename is a section title surrounded by competing click targets (chevron-collapse, copy-path, expand-all) and gets an icon button instead of overloaded text. Both paths reuse ADR 0032's resolution chain, endpoint, and footer feedback. Keyboard `o` is unchanged.

## Why

ADR 0032 deferred mouse on purpose ("`o` is keyboard-only, mirroring `y`'s precedent") and named a single escalation: a `↗` icon next to the file header's `↕`. That hedge under-served the annotation card. The card's `[human] alice · src/cli/serve.ts:42-48` header is a *location stamp* — the same visual shape that Sentry, browser devtools, compiler output, and Sourcegraph all linkify by convention. Leaving it as inert text is the surprise; linkifying it matches the rest of the user's tools.

The file header is a different surface. Its filename is the section title for a diff block, not a location reference, and the header already wires three click targets in pixel-adjacent positions: chevron-collapse (whole header), copy-path button, and the conditional `↕` expand-all button. Hijacking the filename text for a fourth distinct action ("this part of the header collapses, this part copies, this part opens") is the overload pattern that drives users to defensive `cmd+click`. The cleaner answer is the icon ADR 0032 already prescribed.

## Considered Options

- **Symmetric linkification — both filenames clickable.** Rejected: solves discoverability on the annotation card but creates the click-target overload described above on the file header.
- **Symmetric icons — `↗` next to every `foo.ts:42` in every annotation card.** Rejected: visually busier than a hover-underline and loses the natural location-stamp affordance. The annotation card filename *looks like* a link by virtue of being a `path:line`; the redundant icon is noise.
- **Keep ADR 0032's keyboard-only stance.** Rejected: the webapp is a mouse-first surface, and the annotation card filename is the highest-friction omission in practice. Discoverability of `o` from a cold browser visit is approximately zero without a footer-hint scan.

## Decisions

### Annotation card filename → linkified text, cursor moves first

The `{comment.file}:{range}` span in the `.ann-header` (`App.tsx:2442`) becomes a click target. Styling: hover-underline + `cursor: pointer`; no link-blue by default — the location-stamp text stays in-flow with surrounding header text.

Click behaviour mirrors `o` on a card cursor: `(file, line: line_end, side: "additions")`. The click *also* moves the focus cursor to that annotation before dispatching, so subsequent `j`/`k`/`o` continue from the clicked card. `event.stopPropagation()` keeps the surrounding `onCardClick` semantics intact for clicks elsewhere on the card.

### File header → `↗` icon in `tour-file-header-right`, no cursor move

A new icon button renders next to the conditional `↕` expand-all button in the file header's right cell. Click dispatches `(file, line: 1, side: "additions")` — same payload as sidebar-file `o`. The cursor is not moved; the file header click semantics elsewhere (collapse) are unchanged. `event.stopPropagation()` prevents the icon click from also toggling collapse.

The filename text in the file header stays inert. No hover treatment, no pointer cursor.

### Both paths reuse ADR 0032's endpoint, resolution, and failure surface

Same `POST /api/tours/<id>/open-in-editor`, same editor resolution chain, same 409-for-terminal-editor refusal, same footer flash for success and failure messages. No new backend, no new resolver, no new feedback channel.

## Consequences

- **Two contracts diverge in this ADR's text:** ADR 0032 said "no new mouse affordance" full-stop and named `↗`-only as the escalation. This ADR adds annotation-filename linkification on top of the icon and pins the asymmetric reasoning so future readers don't read the divergence as drift.
- **Cursor side-effect on annotation click is new.** The card's existing `onCardClick` already selects the card; linkifying the filename inherits that selection semantic by also moving the cursor. The file-header path stays side-effect-free because no cursor-move contract exists there to inherit.
- **TUI parity is preserved trivially.** Both mouse paths are additive to the keyboard `o` that already works in both surfaces. TUI users see no change.
- **Terminal-editor refusal still surfaces via the footer.** Mouse-clicker users get the same 409 → footer message as `o`-pressers. Acceptable because the footer is already the cross-surface feedback channel (ADR 0028).
- **A future "open with…" picker (for users with multiple editors configured) lands on the icon, not the filename text.** The icon is the stable affordance for richer editor UX; the filename link stays a one-shot convenience.
