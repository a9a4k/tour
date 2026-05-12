import type { Cursor } from "../../core/cursor-state.js";
import { validateCursor } from "../../core/cursor-state.js";
import type { FlatRow } from "../../core/flat-rows.js";

/**
 * Webapp-specific cursor validation policy. The webapp's `flatRowsList`
 * already excludes collapsed files (they contribute zero rows), so a
 * naïve `validateCursor(cursor, flatRows)` can't tell apart "file
 * collapsed but still in the bundle" from "file removed from the bundle"
 * — both cases produce zero rows for the cursor's file.
 *
 * The two cases need different behaviour per ADR 0012 / issue #125:
 *   - Collapsed: anchor preserved (cursor's `(file, lineNumber, side)`
 *     is still semantically valid — uncollapsing restores its outline).
 *   - Removed:  anchor is gone, cursor goes null and re-materializes on
 *     next interaction per the lazy-materialization rule.
 *
 * Resolution order:
 *   1. Cursor null → null.
 *   2. cursor.file not in `files` (removed from the bundle entirely)
 *      → null.
 *   3. cursor.file collapsed but present in `files`
 *      → cursor unchanged.
 *   4. Otherwise delegate to `core/cursor-state.ts::validateCursor` for
 *      the in-place snap rules (anchor still resolves → unchanged;
 *      anchor's specific row gone → snap to file's first row).
 */
export function validateWebappCursor(
  cursor: Cursor | null,
  flatRows: FlatRow[],
  files: ReadonlyArray<{ name: string }>,
  isCollapsed: (file: string) => boolean,
): Cursor | null {
  if (!cursor) return null;
  // CardAnchor: delegate to `validateCursor` — its annotationId match
  // against the flat-row stream is the right resolution for cards. The
  // webapp doesn't currently produce CardAnchor (slice-2 work), but a
  // type-safe pass-through means future migration doesn't break here.
  if (cursor.kind !== "row") return validateCursor(cursor, flatRows);
  const fileExists = files.some((f) => f.name === cursor.file);
  if (!fileExists) return null;
  if (isCollapsed(cursor.file)) return cursor;
  return validateCursor(cursor, flatRows);
}
