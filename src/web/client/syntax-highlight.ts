// Per-line syntax highlighting for the web row renderer. Thin adapter over
// `core/syntax-highlight.ts` — that module owns Shiki, the full bundled
// grammar set, theme baking, file-extension detection, the italic-comment
// overlay, and per-(content, lang) memoisation of TokenLine[] arrays. This
// module owns the HTML rendering and the legacy `Map<lineNumber, html>`
// contract `useLazyHighlight`'s consumers (FileBlock + row-components) read.
//
// Contract:
//
//   tokenize(content, lang) → Map<lineNumber, html>
//
// Pre-init / per-lang pre-load, `tokenize` returns the plain-text fallback
// (HTML-escaped, one entry per line). Once `ensureLang(lang)` resolves it
// returns Shiki-rendered styled spans. Empty content always returns an
// empty Map.

import {
  detectLang as coreDetectLang,
  ensureLang as coreEnsureLang,
  isBundledLang,
  isReady as coreIsReady,
  resetForTests as coreResetForTests,
  subscribe as coreSubscribe,
  tokenizeSync as coreTokenizeSync,
} from "../../core/syntax-highlight.js";
import { escapeHtml, paintHtml } from "./syntax-paint.js";

export type TokenLines = Map<number, string>;

// Stable empty Map returned for empty content so callers can rely on
// reference identity ("same args → same Map").
const EMPTY_MAP: TokenLines = new Map();

// HTML memo: `${lang}::${content}` → TokenLines (HTML Map). Populated when
// the lang is ready and the underlying core tokens have been resolved.
// Plain-text fallback is intentionally NOT cached here — the pre-ready
// transition flips the same key from plain-text to styled output, and a
// cache hit would otherwise pin the key at the fallback (regression for
// issue #214). The hook (`useLazyHighlight`) owns per-`(content, lang)`
// reference stability for the fallback path via its own useMemo.
const htmlMemo: Map<string, TokenLines> = new Map();

export function detectLang(filename: string): string {
  return coreDetectLang(filename);
}

export function isReady(lang: string = "typescript"): boolean {
  return coreIsReady(lang);
}

/** Returns true iff `lang` is a Shiki bundled grammar (excludes plaintext). */
export function isSupportedLang(lang: string): boolean {
  return isBundledLang(lang);
}

/**
 * Triggers async lazy-load of `lang`'s Shiki grammar. Returns when the lang
 * is ready (or immediately if already ready). Subsequent `tokenize`
 * (content, lang) calls within the same render will return styled output.
 *
 * Pre-#375 this took no arguments and loaded a fixed 13-lang bundle. Now
 * it takes a lang parameter so the hook can lazy-load the specific lang it
 * needs. The no-arg call form is kept for backward compat with the
 * existing pre-warm tests (loads typescript as the default).
 */
export async function ensureHighlighter(lang: string = "typescript"): Promise<void> {
  await coreEnsureLang(lang);
}

export function tokenize(content: string, lang: string): TokenLines {
  if (content === "") return EMPTY_MAP;
  const key = `${lang}::${content}`;
  const cached = htmlMemo.get(key);
  if (cached) return cached;

  // Sync read of core's memo. Returns null when a bundled lang has not yet
  // been loaded — caller sees plain-text fallback in that case (the hook
  // will lazy-load and re-render once ready).
  const tokens = coreTokenizeSync(content, lang);
  if (tokens === null) {
    // Plain-text fallback. Not cached — see note on htmlMemo above.
    return plainTextLines(content);
  }

  const map: TokenLines = new Map();
  for (let i = 0; i < tokens.length; i++) {
    map.set(i + 1, paintHtml(tokens[i]!));
  }
  htmlMemo.set(key, map);
  return map;
}

/**
 * Subscribe to "lang became ready" notifications. The hook uses this so
 * the React tree re-renders when a previously-not-ready lang resolves.
 */
export function subscribeReady(lang: string, cb: () => void): () => void {
  return coreSubscribe(lang, cb);
}

/** Test-only — clears all module state. Production code never calls this. */
export function resetForTests(): void {
  htmlMemo.clear();
  coreResetForTests();
}

function plainTextLines(content: string): TokenLines {
  const out: TokenLines = new Map();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    out.set(i + 1, escapeHtml(lines[i] ?? ""));
  }
  return out;
}
