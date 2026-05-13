// Lazy IntersectionObserver-driven wrapper around `syntax-highlight`'s
// `tokenize`. The caller hands the hook a ref to the file's outer block
// element; the hook returns `null` until the observer reports the
// element near the viewport (rootMargin: 200px), and the styled token
// map thereafter.
//
// Contract:
//
//   useLazyHighlight(ref, content, lang) → Map<lineNumber, html> | null
//
// - Returns null before IO fires for `ref.current`.
// - Once IO fires, awaits `ensureHighlighter()` (if not already ready)
//   and then calls `tokenize(content, lang)`.
// - Same `(content, lang)` across consecutive renders returns the same
//   Map reference (downstream React.memo siblings stay stable).
// - Memoizes the unsupported-lang plain-text fallback per `(content, lang)`
//   too — `syntax-highlight` doesn't cache that path internally, so the
//   hook owns reference stability for non-bundled languages.
// - Disconnects the observer on unmount.
// - Resilient to the pre→post-init transition: when the highlighter
//   resolves, the hook re-tokenizes and returns the styled map.

import {
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import {
  ensureHighlighter,
  isReady,
  tokenize,
  type TokenLines,
} from "./syntax-highlight.js";

export function useLazyHighlight(
  blockRef: RefObject<HTMLElement | null>,
  content: string,
  lang: string,
): TokenLines | null {
  // Two latches advance forward only:
  //   visible — flipped true once the IO callback fires for ref.current
  //   ready   — flipped true once the Shiki highlighter has resolved
  // Both gate the tokenize() call inside the useMemo below.
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState<boolean>(() => isReady());

  useEffect(() => {
    if (visible) return;
    const el = blockRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Fallback for environments without IO (older browsers, some test
      // runners). Paint immediately rather than withhold tokens forever.
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [blockRef, visible]);

  useEffect(() => {
    if (!visible) return;
    if (isReady()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void ensureHighlighter().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // `ready` is in the deps so the memo recomputes when the highlighter
  // transitions ready, swapping the plain-text fallback for the styled
  // output. `tokenize()` caches the styled path; the unsupported-lang
  // plain-text path's reference stability comes from this useMemo.
  return useMemo<TokenLines | null>(() => {
    if (!visible) return null;
    return tokenize(content, lang);
  }, [visible, ready, content, lang]);
}
