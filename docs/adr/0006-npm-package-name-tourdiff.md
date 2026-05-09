# npm package is `tourdiff`, binary is `tour`

The unscoped npm package is `tourdiff`; the installed binary is `tour`. Per-platform sub-packages follow the same prefix: `tourdiff-darwin-arm64`, `tourdiff-darwin-x64`, `tourdiff-linux-arm64`, `tourdiff-linux-x64`, `tourdiff-windows-x64`. Install command is `npm i -g tourdiff` (or `bun add -g tourdiff`); after install users type `tour …`.

## Considered Options

- **`tour`** — the bare domain word. Already published on npm by an unrelated owner (`tour@2.0.3`). Not available.
- **`@tour/cli`** — scoped under an npm org named `tour`. Org name `tour` is already taken on npm; without it the scope advantage (keeping the bare word `tour` everywhere) is lost.
- **`@almeynman/tour`** — personal scope. Rejected: package shouldn't be tied to an individual handle when the long-term home is a project, not a person.
- **`tour.md`** — direct mirror of `backlog.md` (the precedent we copied for the multi-binary install shape). Rejected: the `.md` suffix telegraphs "operates on markdown files" the way Backlog.md does, but tour operates on git diffs — annotations *happen* to use markdown bodies, but markdown isn't the subject. Also, dots in package names trip some shell completion and regex tooling.
- **`gotour` / `usetour` / `mytour`** — cute prefixes. Rejected: harder to find on npm search; no domain meaning.

## Consequences

- The package name encodes both domain terms from `CONTEXT.md` (Tour and Diff). The `*diff` suffix sits naturally next to the existing dependencies `hunkdiff` and `@pierre/diffs`.
- The package-name / binary-name split (`tourdiff` → `tour`) mirrors Backlog.md (`backlog.md` → `backlog`) exactly. The shim, `resolveBinary` logic, and `optionalDependencies` shape can be lifted from `Backlog.md/scripts/` with only a name swap.
- Sub-packages are unscoped. If a `tour` org becomes available later we can republish under a scope without renaming the parent — `tourdiff` stays the canonical install name.
