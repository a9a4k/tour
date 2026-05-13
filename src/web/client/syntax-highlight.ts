// Per-line syntax highlighting for the web row renderer.
//
// Contract:
//
//   tokenize(content, lang) → Map<lineNumber, html>
//
// The interface is a pure function; the internals own Shiki setup, eager
// grammar bundling for the common-language set, theme baking under
// `github-dark-default`, file-extension → language detection, and
// memoization. The caller — `<FileBlock>` via `useLazyHighlight` — paints
// each diff row's content cell with `dangerouslySetInnerHTML` from the
// returned map.
//
// Before `ensureHighlighter()` has resolved, `tokenize` returns the
// plain-text fallback (HTML-escaped, one entry per line). Once ready, it
// returns Shiki-rendered token spans for the bundled-language set and the
// same plain-text fallback for everything else. Empty content always
// returns an empty Map.

import {
  type HighlighterGeneric,
  createHighlighter,
} from "shiki";

export type TokenLines = Map<number, string>;

const THEME = "github-dark-default" as const;

// The fixed common-language set eagerly bundled into the highlighter.
// Listed in roughly descending order of expected webapp usage. Adding a
// language here adds a Shiki grammar to the main-bundle weight; we keep
// the list intentionally small.
const SUPPORTED_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "markdown",
  "bash",
  "yaml",
  "css",
  "html",
  "python",
  "rust",
  "go",
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_LANGS);

// File extension (lowercased, without leading dot) → bundled language id.
// Unknown extensions fall back to "plaintext" and tokenize() emits the
// plain-text Map.
const EXT_TO_LANG: ReadonlyMap<string, SupportedLang> = new Map([
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "jsx"],
  ["json", "json"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["sh", "bash"],
  ["bash", "bash"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
  ["css", "css"],
  ["html", "html"],
  ["htm", "html"],
  ["py", "python"],
  ["rs", "rust"],
  ["go", "go"],
]);

type Highlighter = HighlighterGeneric<SupportedLang, typeof THEME>;

let highlighter: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

// Stable empty Map returned for empty content so callers can rely on
// reference identity ("same args → same Map").
const EMPTY_MAP: TokenLines = new Map();

// Cache key is `${lang}::${content}`. Memory cost is bounded by the diff
// content size; once the user closes the tab the module unloads.
const memo = new Map<string, TokenLines>();

export function isSupportedLang(lang: string): lang is SupportedLang {
  return SUPPORTED_SET.has(lang);
}

export function detectLang(filename: string): SupportedLang | "plaintext" {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "plaintext";
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG.get(ext) ?? "plaintext";
}

export function isReady(): boolean {
  return highlighter !== null;
}

export async function ensureHighlighter(): Promise<void> {
  if (highlighter) return;
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: [...SUPPORTED_LANGS],
      themes: [THEME],
    }) as Promise<Highlighter>;
  }
  highlighter = await highlighterPromise;
}

export function tokenize(content: string, lang: string): TokenLines {
  if (content === "") return EMPTY_MAP;
  const key = `${lang}::${content}`;
  const cached = memo.get(key);
  if (cached) return cached;

  // Only cache the styled path. Caching the plain-text fallback would
  // poison the key for the rest of the session — once the highlighter
  // resolves, the same (lang, content) would still return the cached
  // fallback. The fallback is cheap to recompute (split + escape).
  const styled = highlighter !== null && isSupportedLang(lang);
  if (!styled) return plainTextLines(content);

  const result = renderTokens(highlighter, content, lang);
  memo.set(key, result);
  return result;
}

// Test-only escape hatch: clears the singleton and the memo cache so a
// test can start from a known pre-init state. Production code never calls
// this — the module is process-singleton by design.
export function resetForTests(): void {
  highlighter = null;
  highlighterPromise = null;
  memo.clear();
}

function renderTokens(
  h: Highlighter,
  content: string,
  lang: SupportedLang,
): TokenLines {
  const tokenLines = h.codeToTokensBase(content, { lang, theme: THEME });
  const out: TokenLines = new Map();
  for (let i = 0; i < tokenLines.length; i++) {
    const tokens = tokenLines[i];
    if (!tokens) continue;
    let html = "";
    for (const tok of tokens) {
      const color = tok.color ?? "";
      const text = escapeHtml(tok.content);
      html += color
        ? `<span style="color:${color}">${text}</span>`
        : `<span>${text}</span>`;
    }
    out.set(i + 1, html);
  }
  return out;
}

function plainTextLines(content: string): TokenLines {
  const out: TokenLines = new Map();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    out.set(i + 1, escapeHtml(lines[i] ?? ""));
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
