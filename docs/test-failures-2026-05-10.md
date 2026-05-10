# Pre-existing test failures (snapshot 2026-05-10)

Nine tests fail on `main` without any of this session's changes — I verified by
`git stash`'ing my edits and re-running. They split into two unrelated groups.

## Group A — `tests/tui/diff-line.test.ts` (5 failures)

Commit `7ee3e85` ("fix(tui): diff +/- bg fills full row, not just behind text")
moved `backgroundColor={contentBg}` from the `<code>` / `<text>` content child
onto the surrounding wrapper `<box>` (see `src/tui/DiffLine.tsx:109,122`).
The reason was good — `<code>` only paints behind characters, so a bg passed
to it left trailing whitespace unhighlighted.

The test helper `contentBgOf` was not updated. It still reads from the
content child:

```ts
if (last.type === "text") return last.props["bg"] ?? last.props["backgroundColor"];
const inner = childrenOf(last).filter(isElement);
const code = inner.find((c) => c.type === "code");
if (code) return code.props["bg"] ?? code.props["backgroundColor"];
```

Both paths look at children that no longer carry the bg, so the helper
returns `undefined`. The assertions all expect a theme colour.

Failing tests, all five with the same root cause:

- `paints dangerRange on gutter and content when diffBg='deletion'`
- `paints successRange on gutter and content when diffBg='addition'`
- `on a +/- row inside an annotation range, gutter shows annotation tint and content keeps the diff bg (ADR 0008)`
- `on a context row inside an annotation range, both gutter and content show annotation tint`
- `DiffLine cursorActive (ADR 0011) > leaves the content cell bg untouched when cursorActive=true`

**Fix**: update `contentBgOf` to read `last.props["backgroundColor"]` directly
on the wrapper `<box>`. Behaviour is correct; the helper is stale.

## Group B — `tests/integration/webapp.test.ts` (4 failures)

These tests `spawn` `bun` from the test process to launch the webapp server.
The error surfaces as `spawn bun ENOENT` — the test runner can't find the
binary on PATH. Commit `a9ac54d` ("test(webapp): resolve bun via PATH instead
of hardcoded ~/.bun") tried to fix this, but the runner's sub-shell can still
strip PATH in some setups.

Failing tests, all four with the same root cause:

- `GET /api/tours/:id returns tour with diff and annotations`
- `GET /api/tours/:id ships per-file oldContent/newContent for hidden context expansion (Issue #109)`
- `GET /api/tours/:id ships per-file orphanWindows for orphan annotation auto-expansion`
- `GET /api/tours/:id with prefix returns tour`

**Fix candidates**:

- `it.skipIf(!resolveBin('bun'))` so the suite skips cleanly when `bun` is
  unavailable instead of erroring.
- Or assert `bun` resolvable in `beforeAll` and skip the whole describe block.
- Or pass an explicit binary path through an env var so CI can override.
