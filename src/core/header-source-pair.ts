import type { Tour } from "./types.js";

// Issue #308: the always-visible web + TUI header used to render the
// original ref names (`${base_source} ← ${head_source}`) the user typed at
// `tour create` time. On a re-opened tour those labels are stale — `main`
// and `HEAD` naturally read as "current main" / "current HEAD" even
// though the tour's underlying commits are pinned by SHA.
//
// The fix renders the stable identifiers as 7-char short SHAs (git /
// GitHub default) so the header can't lie at a glance. For tours with
// `wip_snapshot === true` the head side renders the literal `WIP` —
// the stored head SHA is a synthetic working-tree snapshot the user
// can't `git show`. The discriminator is the boolean, not a string
// match against `head_source === "WIP"`.
//
// `tour show` (CLI inspect) intentionally keeps the longer
// `sha[:12] (source)` form — the asymmetry is deliberate per the brief.
const SHORT_SHA_LEN = 7;

export function headerSourcePair(tour: Tour): string {
  const base = tour.base_sha.slice(0, SHORT_SHA_LEN);
  const head = tour.wip_snapshot ? "WIP" : tour.head_sha.slice(0, SHORT_SHA_LEN);
  return `${base} ← ${head}`;
}
