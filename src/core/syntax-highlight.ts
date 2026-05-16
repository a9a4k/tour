// Cross-surface Shiki tokenisation. Webapp + (forthcoming) TUI both paint
// from the same `(content, lang) → TokenLine[]` contract; surface-specific
// emitters turn TokenLine arrays into HTML spans (web) or StyledText (TUI).
//
// The module encapsulates Shiki's full bundled grammar set (~230 languages),
// the theme choice (`github-dark-default`), per-`(content, lang)` memoisation,
// per-lang lazy grammar loading, and the italic-comment overlay (the chosen
// theme does not emit `fontStyle: italic` on comment scopes; we apply it
// here so both surfaces get italic comments).
//
// Surface-agnostic: no React, no DOM, no OpenTUI imports.

import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from "shiki/bundle/full";

const THEME = "github-dark-default" as const;

export type TokenChunk = {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
export type TokenLine = { chunks: TokenChunk[] };

const BUNDLED_LANG_IDS: ReadonlySet<string> = new Set<string>(
  Object.keys(bundledLanguages),
);

// File extension (lowercased, without leading dot) → bundled language id.
// Curated against Linguist's top tier cross-referenced with Shiki's bundled
// grammar set. Adding a language is one line; unknown extensions fall back
// to "plaintext".
const EXT_TO_LANG: ReadonlyMap<string, BundledLanguage> = new Map<
  string,
  BundledLanguage
>([
  // typescript / javascript
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "jsx"],
  // data / markup
  ["json", "json"],
  ["json5", "json5"],
  ["jsonc", "jsonc"],
  ["jsonl", "jsonl"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
  ["toml", "toml"],
  ["ini", "ini"],
  ["env", "dotenv"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["mdx", "mdx"],
  ["mdc", "mdc"],
  ["rst", "rst"],
  ["adoc", "asciidoc"],
  ["asciidoc", "asciidoc"],
  ["xml", "xml"],
  ["xsl", "xsl"],
  ["html", "html"],
  ["htm", "html"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["astro", "astro"],
  // styles
  ["css", "css"],
  ["scss", "scss"],
  ["sass", "sass"],
  ["less", "less"],
  ["postcss", "postcss"],
  ["styl", "stylus"],
  ["stylus", "stylus"],
  // shell
  ["sh", "bash"],
  ["bash", "bash"],
  ["zsh", "bash"],
  ["ksh", "bash"],
  ["fish", "fish"],
  ["ps1", "powershell"],
  ["psm1", "powershell"],
  ["psd1", "powershell"],
  ["bat", "bat"],
  ["cmd", "bat"],
  ["awk", "awk"],
  // python / ruby / php / perl / lua
  ["py", "python"],
  ["pyi", "python"],
  ["pyw", "python"],
  ["rb", "ruby"],
  ["rake", "ruby"],
  ["gemspec", "ruby"],
  ["erb", "erb"],
  ["php", "php"],
  ["phtml", "php"],
  ["pl", "perl"],
  ["pm", "perl"],
  ["lua", "lua"],
  // systems / compiled
  ["rs", "rust"],
  ["go", "go"],
  ["c", "c"],
  ["h", "c"],
  ["cpp", "cpp"],
  ["cc", "cpp"],
  ["cxx", "cpp"],
  ["hpp", "cpp"],
  ["hh", "cpp"],
  ["hxx", "cpp"],
  ["cs", "csharp"],
  ["csx", "csharp"],
  ["m", "objective-c"],
  ["mm", "objective-cpp"],
  ["zig", "zig"],
  ["nim", "nim"],
  ["d", "d"],
  ["v", "v"],
  ["odin", "odin"],
  // jvm
  ["java", "java"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["scala", "scala"],
  ["sc", "scala"],
  ["groovy", "groovy"],
  ["gradle", "groovy"],
  ["clj", "clojure"],
  ["cljs", "clojure"],
  ["cljc", "clojure"],
  // functional
  ["hs", "haskell"],
  ["lhs", "haskell"],
  ["elm", "elm"],
  ["erl", "erlang"],
  ["hrl", "erlang"],
  ["ex", "elixir"],
  ["exs", "elixir"],
  ["ml", "ocaml"],
  ["mli", "ocaml"],
  ["fs", "fsharp"],
  ["fsi", "fsharp"],
  ["fsx", "fsharp"],
  ["lisp", "common-lisp"],
  ["lsp", "common-lisp"],
  ["scm", "scheme"],
  ["rkt", "racket"],
  ["purs", "purescript"],
  // mobile / apple
  ["swift", "swift"],
  ["dart", "dart"],
  // protobuf / schema
  ["proto", "proto"],
  ["graphql", "graphql"],
  ["gql", "graphql"],
  ["prisma", "prisma"],
  // sql
  ["sql", "sql"],
  ["psql", "sql"],
  ["pgsql", "sql"],
  // build / config
  ["dockerfile", "docker"],
  ["mk", "make"],
  ["mak", "make"],
  ["cmake", "cmake"],
  ["nginx", "nginx"],
  // infra
  ["hcl", "hcl"],
  ["tf", "terraform"],
  ["tfvars", "terraform"],
  ["bicep", "bicep"],
  // chains
  ["sol", "solidity"],
  ["move", "move"],
  ["cairo", "cairo"],
  // scientific / R / matlab / julia
  ["r", "r"],
  ["rmd", "r"],
  ["jl", "julia"],
  ["matlab", "matlab"],
  // shaders
  ["wgsl", "wgsl"],
  ["glsl", "glsl"],
  ["hlsl", "hlsl"],
  // misc
  ["coffee", "coffee"],
  ["cr", "crystal"],
  ["tcl", "tcl"],
  ["vim", "viml"],
  ["log", "log"],
  ["tex", "tex"],
  ["latex", "latex"],
  ["bib", "bibtex"],
  ["pas", "pascal"],
  ["pp", "pascal"],
  ["raku", "raku"],
  ["vb", "vb"],
  ["abap", "abap"],
  ["ada", "ada"],
  ["wasm", "wasm"],
  ["wat", "wasm"],
  ["nix", "nix"],
  ["pug", "pug"],
  ["twig", "twig"],
  ["liquid", "liquid"],
  ["jinja", "jinja"],
  ["handlebars", "handlebars"],
  ["hbs", "handlebars"],
  ["diff", "diff"],
  ["patch", "diff"],
  ["csv", "csv"],
  ["tsv", "tsv"],
  ["typst", "typst"],
  ["typ", "typst"],
  ["edge", "edge"],
  ["http", "http"],
]);

// Stable empty array returned for empty content so callers can rely on
// reference identity ("same args → same array").
const EMPTY_LINES: TokenLine[] = Object.freeze([]) as unknown as TokenLine[];

let highlighter: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

const loadedLangs: Set<string> = new Set(["plaintext"]);
const loadingLangs: Map<string, Promise<void>> = new Map();
const listeners: Map<string, Set<() => void>> = new Map();

// Cache key is `${lang}::${content}`. Memoised TokenLine[] survives across
// surface paints — webapp and TUI consume the same array reference.
const memo: Map<string, TokenLine[]> = new Map();

export function detectLang(filename: string): BundledLanguage | "plaintext" {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "plaintext";
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG.get(ext) ?? "plaintext";
}

/** Returns true iff `lang` is the id of a Shiki bundled grammar. */
export function isBundledLang(lang: string): boolean {
  return BUNDLED_LANG_IDS.has(lang);
}

export function isReady(lang: string): boolean {
  return loadedLangs.has(lang);
}

export function subscribe(lang: string, cb: () => void): () => void {
  let set = listeners.get(lang);
  if (!set) {
    set = new Set();
    listeners.set(lang, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(lang);
    if (s) s.delete(cb);
  };
}

function fireReady(lang: string): void {
  const set = listeners.get(lang);
  if (!set) return;
  // Copy to a list before firing so a callback that unsubscribes mid-fire
  // doesn't mutate the iterator.
  const cbs = [...set];
  for (const cb of cbs) cb();
}

async function ensureHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter;
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: [],
      themes: [THEME],
    }) as Promise<Highlighter>;
  }
  highlighter = await highlighterPromise;
  return highlighter;
}

/**
 * Loads `lang`'s Shiki grammar (if not already loaded) and resolves once
 * `isReady(lang)` returns true. Unknown lang ids resolve immediately and
 * are marked ready so subsequent calls take the plain-text fallback path
 * synchronously. Concurrent callers for the same lang share one in-flight
 * load.
 */
export async function ensureLang(lang: string): Promise<void> {
  if (loadedLangs.has(lang)) return;
  if (!BUNDLED_LANG_IDS.has(lang)) {
    // Unknown lang: treat as plaintext-ready so subsequent calls memoise
    // the plain-text fallback (no async re-load).
    loadedLangs.add(lang);
    fireReady(lang);
    return;
  }
  let pending = loadingLangs.get(lang);
  if (!pending) {
    pending = (async () => {
      const h = await ensureHighlighter();
      await h.loadLanguage(lang as BundledLanguage);
      loadedLangs.add(lang);
      loadingLangs.delete(lang);
      fireReady(lang);
    })();
    loadingLangs.set(lang, pending);
  }
  await pending;
}

export async function tokenize(
  content: string,
  lang: string,
): Promise<TokenLine[]> {
  if (content === "") return EMPTY_LINES;
  const key = `${lang}::${content}`;
  const cached = memo.get(key);
  if (cached) return cached;

  if (!BUNDLED_LANG_IDS.has(lang)) {
    const result = plaintextTokens(content);
    memo.set(key, result);
    return result;
  }

  await ensureLang(lang);
  const h = highlighter;
  if (!h) {
    // Should not happen — ensureLang awaited the highlighter — but be
    // defensive rather than throw.
    return plaintextTokens(content);
  }
  const result = renderTokens(h, content, lang as BundledLanguage);
  memo.set(key, result);
  return result;
}

/**
 * Synchronous accessor — returns the memoised TokenLine[] for `(content,
 * lang)` if it has been computed, or `null` otherwise. Surfaces that need
 * to paint synchronously (e.g. the webapp's per-row HTML emitter) use this
 * to read a previously-resolved `tokenize` result without awaiting again.
 *
 * Empty content always returns an empty array (matches `tokenize`).
 * Unknown langs whose plain-text fallback has been computed return that
 * array. Bundled langs that have not yet been loaded return `null`.
 */
export function tokenizeSync(content: string, lang: string): TokenLine[] | null {
  if (content === "") return EMPTY_LINES;
  const key = `${lang}::${content}`;
  const cached = memo.get(key);
  if (cached) return cached;

  if (!BUNDLED_LANG_IDS.has(lang)) {
    const result = plaintextTokens(content);
    memo.set(key, result);
    return result;
  }

  if (!loadedLangs.has(lang) || !highlighter) return null;

  const result = renderTokens(highlighter, content, lang as BundledLanguage);
  memo.set(key, result);
  return result;
}

/** Test-only — clears all module state. Production code never calls this. */
export function resetForTests(): void {
  highlighter = null;
  highlighterPromise = null;
  loadedLangs.clear();
  loadedLangs.add("plaintext");
  loadingLangs.clear();
  listeners.clear();
  memo.clear();
}

function renderTokens(
  h: Highlighter,
  content: string,
  lang: BundledLanguage,
): TokenLine[] {
  // `includeExplanation: 'scopeName'` yields per-token scope info we need
  // for the italic-comment overlay; it is the cheaper of the two
  // explanation modes Shiki supports.
  const tokenLines = h.codeToTokensBase(content, {
    lang,
    theme: THEME,
    includeExplanation: "scopeName",
  });
  const out: TokenLine[] = new Array(tokenLines.length);
  for (let i = 0; i < tokenLines.length; i++) {
    const tokens = tokenLines[i] ?? [];
    const chunks: TokenChunk[] = new Array(tokens.length);
    for (let j = 0; j < tokens.length; j++) {
      const tok = tokens[j]!;
      const chunk: TokenChunk = { text: tok.content };
      if (tok.color) chunk.color = tok.color;
      // FontStyle is a bitmask: Italic = 1, Bold = 2, Underline = 4.
      const fs = tok.fontStyle;
      if (typeof fs === "number") {
        if ((fs & 1) !== 0) chunk.italic = true;
        if ((fs & 2) !== 0) chunk.bold = true;
        if ((fs & 4) !== 0) chunk.underline = true;
      }
      // Italic-comment overlay: github-dark-default does not flag comment
      // scopes as italic, but the project's TUI did historically; we
      // promote `italic: true` for any token whose scope chain includes
      // "comment" so both surfaces see italic comments.
      if (!chunk.italic && hasCommentScope(tok.explanation)) {
        chunk.italic = true;
      }
      chunks[j] = chunk;
    }
    out[i] = { chunks };
  }
  return out;
}

type ScopeExplanation = ReadonlyArray<{ scopes: ReadonlyArray<{ scopeName: string }> }>;

function hasCommentScope(explanation: ScopeExplanation | undefined): boolean {
  if (!explanation) return false;
  for (const e of explanation) {
    for (const s of e.scopes) {
      if (s.scopeName.startsWith("comment")) return true;
    }
  }
  return false;
}

function plaintextTokens(content: string): TokenLine[] {
  const lines = content.split("\n");
  const out: TokenLine[] = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    out[i] = { chunks: [{ text: lines[i] ?? "" }] };
  }
  return out;
}
