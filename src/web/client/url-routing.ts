// Path + fragment URL routing for the SPA (Issue #179 reopen).
//
// The server prints `http://127.0.0.1:<port>/<tour-id>` when `tour serve <id>`
// is invoked. To make that URL reach the right tour in the probe-reuse case
// (Issue #178 — the already-running server's HTML carries the OLD
// `__INITIAL_TOUR_ID__`), the SPA reads tour-id from the URL path with
// higher precedence than the baked global. Annotation-id moves to the URL
// fragment to match the idiomatic web shape `<resource>#<element-within>`.
//
// Reader precedence: path → query → fallback (for tour-id), fragment →
// query (for annotation-id). The query forms are accepted only as a
// back-compat fallback so existing links keep working; new navigation
// always writes path + fragment via `composeUrl`.

// First non-empty path segment of `pathname` (e.g., "/abc" → "abc",
// "/abc/foo" → "abc", "/" → null). Decodes the segment so a hand-typed
// id with URL-encoded characters round-trips.
function readTourFromPath(pathname: string): string | null {
  const first = pathname.split("/").find((s) => s.length > 0);
  if (!first) return null;
  try {
    return decodeURIComponent(first);
  } catch {
    return first;
  }
}

function readTourFromQuery(search: string): string | null {
  const v = new URLSearchParams(search).get("tour");
  return v && v.length > 0 ? v : null;
}

function readAnnFromHash(hash: string): string | null {
  const v = hash.startsWith("#") ? hash.slice(1) : hash;
  if (v.length === 0) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function readAnnFromQuery(search: string): string | null {
  const v = new URLSearchParams(search).get("ann");
  return v && v.length > 0 ? v : null;
}

// Path wins over query wins over fallback. Fallback is the baked
// `__INITIAL_TOUR_ID__` global; it's used only when neither URL source
// produced an id (a `/` load with no query). When the server is reused
// for a different tour than the URL points to, the path wins so the user
// lands on the tour they clicked.
export function readTourFromLocation(
  loc: { pathname: string; search: string },
  fallback: string | null,
): string | null {
  return readTourFromPath(loc.pathname) ?? readTourFromQuery(loc.search) ?? fallback;
}

// Fragment wins over query. Both are optional; null means no anchor.
export function readAnnFromLocation(
  loc: { hash: string; search: string },
): string | null {
  return readAnnFromHash(loc.hash) ?? readAnnFromQuery(loc.search);
}

// Compose a path + fragment URL from state. `/` when no tour;
// `/<tour-id>` when tour but no annotation; `/<tour-id>#<ann-id>` when
// both. Encodes both segments so ids with reserved characters survive.
export function composeUrl(
  tourId: string | null,
  annId: string | null,
): string {
  if (tourId === null) return "/";
  const path = `/${encodeURIComponent(tourId)}`;
  return annId === null ? path : `${path}#${encodeURIComponent(annId)}`;
}
