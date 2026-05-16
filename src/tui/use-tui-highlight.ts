// Lazy per-file syntax-highlight hook for the TUI. Mirrors the webapp's
// `useLazyHighlight` shape: takes `(content, lang)` and returns
// `StyledText[] | null`. Returns `null` until tokenisation resolves —
// callers paint plain text in the meantime — then returns one
// `StyledText` per source line.
//
// Cross-surface tokenisation lives in `core/syntax-highlight.ts`; this
// hook is a thin React wrapper over `ensureLang` + `tokenizeSync` +
// `subscribe`. The TUI has no IntersectionObserver — file-card render
// is the visibility signal, and `viewportCulling` on the diff-pane
// scrollbox already defers work for off-screen file cards (see
// `app.tsx`'s `<scrollbox viewportCulling={true}>`).
//
// On non-truecolor terminals the hook short-circuits to null so the
// existing plain-text fallback applies. Wrongly-mapped colour beats
// missing highlight only in the negative direction; PRD #374 calls
// this out explicitly.

import { useEffect, useMemo, useState } from "react";
import { StyledText } from "@opentui/core";
import {
  ensureLang,
  isReady,
  subscribe,
  tokenizeSync,
} from "../core/syntax-highlight.js";
import { paintStyledText } from "./syntax-paint.js";
import { isTruecolorTerminal } from "./truecolor.js";

// Cache key is `${lang}::${content}` (matches core's memo key shape).
// Memoised StyledText[] survives across React re-renders so identical
// `(content, lang)` does not re-paint a long file every render.
const memo: Map<string, StyledText[]> = new Map();

export function useTuiHighlight(
  content: string,
  lang: string,
): StyledText[] | null {
  const truecolor = useMemo(() => isTruecolorTerminal(), []);
  const [ready, setReady] = useState<boolean>(() => isReady(lang));

  useEffect(() => {
    if (!truecolor) return;
    if (isReady(lang)) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const unsub = subscribe(lang, () => {
      if (!cancelled) setReady(true);
    });
    void ensureLang(lang).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [lang, truecolor]);

  return useMemo<StyledText[] | null>(() => {
    if (!truecolor) return null;
    if (content === "") return null;
    if (!ready) return null;
    const key = `${lang}::${content}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const tokens = tokenizeSync(content, lang);
    if (tokens === null) return null;
    const lines: StyledText[] = new Array(tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      lines[i] = paintStyledText(tokens[i]!);
    }
    memo.set(key, lines);
    return lines;
  }, [content, lang, ready, truecolor]);
}

/** Test-only — clears the StyledText[] memo. */
export function resetForTests(): void {
  memo.clear();
}
