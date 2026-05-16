# Unified Shiki tokenisation in `core/`

> **Status:** Supersedes the highlight-via-OpenTUI-`<code>` consequence of ADR 0009 and the bundled-13-langs / `shiki/bundle/web` claim in ADR 0024's *Syntax highlighting* section. The per-cell `DiffLine` row architecture of ADR 0009 and the row-stream + CSS-subgrid scaffolding of ADR 0024 stand verbatim — this ADR replaces the engine and the grammar set, not the renderer shape. Side-effect: retires the bespoke `parser-worker-bundle.js` half of issue #204's binary-build stub-restore state machine.

The webapp and the TUI converge on one tokeniser in `core/syntax-highlight.ts` — Shiki (powered by Oniguruma) with the full bundled grammar set (~200 langs) — feeding both surfaces through one `tokenize(content, lang) → TokenLine[]` contract. Each surface ships a thin paint adapter: the webapp emits inline-styled HTML spans (`src/web/client/syntax-paint.ts`); the TUI emits OpenTUI `StyledText` chunks (`src/tui/syntax-paint.ts`). An italic-comment overlay applies in `core/` so both surfaces gain the same comment treatment. The TUI gates on `COLORTERM=truecolor|24bit` and falls back to plain text otherwise.

## Why

ADR 0009 chose OpenTUI's `<code>` renderable + its bundled `tree-sitter` grammars to recover the syntax-highlighting consequence ADR 0007 had accepted as a v1 loss. ADR 0024 then independently picked Shiki on the webapp because Pierre's worker-pool highlighter retired with the renderer. The result was two engines, two grammar sets, two palettes, two ready-state semantics:

- **Webapp:** Shiki (`shiki/bundle/web`) covering 13 langs — TypeScript, JavaScript, JSON, Markdown, bash, YAML, CSS, HTML, Python, Rust, Go.
- **TUI:** OpenTUI's tree-sitter assets covering 5 langs — TypeScript, TSX, JavaScript, JSX, Markdown.

Everything outside those sets — `.proto`, `.rb`, `.kt`, `.swift`, `.java`, `.php`, `.c`/`.cpp`, `.cs`, `.sql`, `.toml`, `.dockerfile`, `.lua`, `.zig`, the long tail — painted plain on both surfaces. A reviewer touring a polyglot service mesh hit unhighlighted files within minutes. The split also created a hidden asymmetry: the webapp covered Rust / Python / Go where the TUI didn't. CONTEXT.md had already pinned Tour's stance that cross-surface concerns live in `core/`; Highlighting was the last meaningful one still implemented twice.

A second motivation was the binary build pipeline. Tree-sitter on the TUI was the single reason `scripts/build-binary.ts` carried a bespoke pre-bundled OpenTUI parser worker (`src/tui/parser-worker-bundle.js`) and a snapshot-restore state machine. Issue #204 documented the fragility of that dance, which only existed to keep the worker entry reversible across builds. A unified Shiki engine retires that worker — Shiki runs synchronously in Bun and in the browser without WASM-loader plumbing, so the parser-worker entrypoint and one half of the stub-restore branch retire as a side-effect.

The integration spike (`prototype/shiki-tui-spike/`, retired after this PRD lands) validated the technical posture: Shiki runs in Bun out of the box, `<text content={StyledText}>` is the TUI integration point, a React-prop edge case exists around `content` ↔ `children` (fixable by keying the `<text>` mid-transition), and `github-dark-default` does not emit `fontStyle: italic` on comment scopes (handled by a `core/`-side overlay so the cross-surface palette stays unified rather than each surface adding italics on its own).

## Considered Options

- **Unified Shiki in `core/` with full bundled grammar set on both surfaces.** Chosen. One tokeniser, one palette, one ready-state semantics. Per-surface paint adapters fan out from `TokenLine[]` — the surface-agnostic payload from the spike. Webapp emits inline-styled `<span>`; TUI emits OpenTUI `StyledText`. Italic-comment overlay in `core/`. TUI gates on truecolor terminals; non-truecolor falls back to plain text (unhighlighted is preferable to wrongly-highlighted; PRD #374 user story 14).
- **Lazy fine-grained Shiki chunking on the webapp.** Rejected. The binary serves the webapp as one embedded string (`EMBEDDED_CLIENT_JS`); chunks would still ship inside the binary, so lazy saves no *shipping* cost. The cold-parse saving on first open (~300–600 ms on a dev machine) doesn't justify the additional engineering complexity (per-grammar load orchestration on top of the cross-surface tokeniser) or the dynamic-`import()`-vs-bundle-string complication. Eager full bundle with lazy per-lang load (already chosen) reaches the same parse-cost profile as the user scrolls files.
- **Server-side highlighting.** Rejected. Bigger refactor: the webapp would need a new IPC channel, the TUI would need either a separate path or a same-process call, and per-row main-thread tokenisation (ADR 0024's preserved contract) would invert to per-file server-side response. Loses the spike's key property — Shiki runs in Bun without WASM-loader plumbing, so client-side stays operationally simple. Adds latency to first paint of every file rather than amortising it across the user's scroll.
- **Curated long-tail expansion of OpenTUI's tree-sitter assets directory.** Rejected. Each new grammar would need sourcing from the language's tree-sitter repo, building the `.scm` files, and shipping the binary blob inside `@opentui/core` (an upstream change) or inside our binary (a fork). Doesn't reach parity with Shiki's curated bundle; per-language sourcing cost is unbounded; and leaves the bespoke `parser-worker-bundle.js` pre-bundle in place — the long-tail fix and the build-pipeline simplification stay decoupled.
- **Status-quo asymmetry (keep two engines).** Rejected. Doesn't serve the wide-audience goal — a reviewer of a Rails monolith or a Kotlin app hits unhighlighted files within minutes on the TUI. Doesn't simplify the binary build. Doesn't unify the comment-italic treatment. Tour's "cross-surface concerns live in `core/`" stance has no exception for highlighting.

## Decisions

### Cross-surface contract from the spike

The payload `core/syntax-highlight.ts` returns:

```ts
type TokenChunk = {
  text: string;
  color?: string;      // hex, e.g. "#FF7B72"
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
type TokenLine = { chunks: TokenChunk[] };
type Tokens = TokenLine[];   // one TokenLine per source line
```

Surface paint adapters fan out from this shape:

- **Webapp** (`src/web/client/syntax-paint.ts`): one `<span style="color:...; font-weight:bold; font-style:italic; text-decoration:underline">text</span>` per chunk per line.
- **TUI** (`src/tui/syntax-paint.ts`): OpenTUI `TextChunk`s via `fg(color)(text)` composed with `bold(...)` / `italic(...)` / `underline(...)`, wrapped in `new StyledText(chunks)` per line.

### Four-function module interface

`core/syntax-highlight.ts` exposes:

- `detectLang(filename) → BundledLanguage | "plaintext"` — sync extension lookup against the curated `EXT_TO_LANG` map (~150–200 entries hand-curated against Linguist's top tier cross-referenced with Shiki's `bundledLanguagesInfo`).
- `tokenize(content, lang) → Promise<TokenLine[]>` — async, memoised on `${lang}::${content}`, lazy-loads the grammar.
- `isReady(lang) → boolean` — per-lang.
- `subscribe(lang, cb) → unsubscribe` — fires on `isReady` flip.

Plus `isBundledLang(lang)` (sync grammar-id membership check), `tokenizeSync(content, lang) → TokenLine[] | null` (sync accessor used by the webapp's HTML emitter), and `ensureLang(lang)` (warm a per-lang grammar without a dummy tokenise call).

### Per-lang lazy loading

`getSingletonHighlighter`-style `loadLanguage(lang)` instead of pre-loading all ~200 grammars at startup. Cold-paint cost is paid per first-view of each file rather than upfront on Tour open. The webapp's `useLazyHighlight` and the TUI's `useTuiHighlight` both subscribe to per-lang ready-flip so the React tree re-renders cleanly when the grammar resolves under it.

### Italic-comment overlay in `core/`

`github-dark-default` does not emit `fontStyle: italic` on comment scopes. The TUI's old hand-tuned palette did add it. `core/syntax-highlight.ts` runs a post-process pass on Shiki's `codeToTokensBase` output that promotes `italic: true` on tokens whose TextMate scope chain contains `comment`. Cross-surface: the webapp gets italic comments too, tightening parity rather than diverging.

### Webapp full grammar bundle — eager

Webapp imports `shiki/bundle/full` (~230 grammars). The binary serves the webapp as one embedded string, so lazy fine-grained chunking would save no shipping cost (rejected alternative above). Expected delta: +5–8 MB embedded webapp bundle. Cold parse on a dev machine ~300–600 ms one-shot on first open; cached by the browser thereafter (within a binary version).

### TUI grammar coverage — same Shiki bundled set

The TUI gets the full Shiki bundled grammar set. Binary growth on the TUI side ~5–8 MB (Shiki compiled for the Bun runtime target). **Bun cannot share compiled Shiki between the browser-target embedded webapp string and the Bun-target main binary** — different compile targets, no dedup. Total binary delta is +10–15 MB. The post-#377 measurement (issue #377 retired the OpenTUI tree-sitter machinery as a cleanup slice) recorded a ~256 KB binary reduction from the retirement, well under the ~1–2 MB the original PRD projected — the tree-sitter machinery minified further than expected. The Shiki growth dominates the size delta; the retirement is mostly about build-pipeline simplification rather than size.

### Truecolor terminal requirement on the TUI

`COLORTERM=truecolor` or `COLORTERM=24bit` (case-insensitive). On non-truecolor terminals, the TUI paints content as plain text — the same fallback that already existed for unsupported filetypes under ADR 0009. Wrongly-mapped 256-colour rendering is foreclosed: unhighlighted is preferable to wrongly-highlighted.

### Extension map — single curated table in `core/`

`EXT_TO_LANG: Map<string, BundledLanguage>` lives in `core/syntax-highlight.ts`. Adding a language is a one-line change that ships to both surfaces simultaneously. Long-tail expansion is on-demand.

### Side-effect: `parser-worker-bundle.js` retires

`scripts/build-binary.ts`'s stub-restore state machine (issue #204) halves: the `OTUI_WORKER_STUB_PATH` snapshot+restore branch retires entirely. Only the embedded webapp client string still uses the snapshot/restore pattern. `scripts/build-client.ts` drops the OpenTUI parser-worker copy step. `src/tui/otui-worker-shim.ts` retires with its sole `OTUI_TREE_SITTER_WORKER_PATH` env-var indirection. The hidden `tour selftest-syntax` verb (which asserted that the OpenTUI tree-sitter worker booted and returned tokens) retires too — Shiki runs synchronously in the main thread, so any tokenisation failure surfaces as a normal exception that the existing TUI / webapp smokes already catch.

## Tradeoffs

- **+10–15 MB binary growth.** Shiki ships twice — once in the embedded webapp string, once in the TUI portion of the binary. Bun can't dedupe across browser and Bun compile targets. Acceptable for the wide-audience win; the binary is still a single-file distribution.
- **Truecolor terminal requirement.** Reviewers on non-truecolor terminals get plain text instead of mis-mapped colours. The fallback is structurally identical to today's unsupported-filetype path and adds no new surface for the reviewer to learn.
- **+300–600 ms cold parse on webapp first open.** One-shot per binary version, browser-cached thereafter. Measured on a representative dev machine; production hardware likely faster.
- **Per-file (not per-line) parse on the TUI** — different from ADR 0009's per-line-parse property, but the trade-off is favourable: multi-line constructs (template literals, JSX blocks, multi-line comments) keep their cross-line context inside a file's content. Per-cell rendering reads from the pre-tokenised line, so cursor movement still doesn't re-tokenise.

## Reversibility

Per-surface revert is straightforward — reverting the TUI half (`DiffLine.tsx` + `use-tui-highlight.ts` + the parser-worker restore) leaves the webapp's full-grammar win intact. `core/syntax-highlight.ts` continues to power the webapp regardless. The reverse — keeping the TUI on Shiki but reverting the webapp — is symmetrically easy (`src/web/client/syntax-highlight.ts`'s adapter delegation is one file).

## Consequences

- **Wide-audience grammar coverage.** A reviewer touring a `.proto`, `.rb`, `.kt`, `.swift`, `.java`, `.php`, `.c`/`.cpp`, `.toml`, `.sql`, `.lua`, `.zig` file sees full Shiki highlight on both surfaces, where the same file previously rendered plain.
- **One file to edit when adding a new extension.** `EXT_TO_LANG` in `core/syntax-highlight.ts` is the only change required to map a new file extension; the new mapping ships to both surfaces in the same release.
- **Italic comments on the webapp too.** The cross-surface italic-comment overlay applies on both surfaces; the prior TUI-only italic treatment is now cross-surface, tightening parity.
- **Binary build pipeline simplifies.** Issue #204's stub-restore state machine drops one of its two branches; `scripts/build-binary.ts` calls `bun build --compile` with one entrypoint instead of two; the OpenTUI parser-worker pre-bundle step retires from `scripts/build-client.ts`.
- **Cross-surface dogfooding stops jolting.** A maintainer toggling between TUI and webapp on the same Tour gets the same colours on both surfaces (PRD #374 user story 9).
- **Future-proof palette tweaks ship to both surfaces.** The italic-comment overlay is the first cross-surface palette tweak; future ones (e.g. bold keyword emphasis, custom string colour) live in `core/` and reach both surfaces in one change.
- **Future grammar additions follow the same shape.** Shiki's bundled set already covers the long tail of "common in real reviews" languages. When a reviewer needs a missing grammar, the addition is a Shiki upgrade (zero Tour-side code) rather than a tree-sitter sourcing exercise.
