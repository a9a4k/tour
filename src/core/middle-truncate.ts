// Pure middle-ellipsis truncation. No dependencies on TUI types or renderer
// code — reusable for any column-budgeted slot (sidebar rows, status lines,
// picker rows). Issue #156.
//
// Contract:
//   - Input shorter than or equal to `budget` → returned unchanged.
//   - Input longer than `budget` → returned string of exactly `budget` width
//     containing `…` somewhere in the middle, preserving the first and last
//     characters when `budget ≥ 3`.
//   - `budget ≤ 0` → empty string.
//   - `budget` of 1 → `…`.
//   - `budget` of 2 → first char + `…` (length 2).
//
// Uses Array.from(input) so surrogate pairs (e.g. emoji) are treated as a
// single user-perceived character and never split.

const ELLIPSIS = "…";

export function middleTruncate(input: string, budget: number): string {
  if (budget <= 0) return "";
  const chars = Array.from(input);
  if (chars.length <= budget) return input;
  if (budget === 1) return ELLIPSIS;
  // `budget` slots for output. 1 is reserved for the ellipsis; the remaining
  // `budget - 1` are split between head and tail, head taking the extra on
  // an odd budget so the first character is always preserved.
  const remaining = budget - 1;
  const headLen = Math.ceil(remaining / 2);
  const tailLen = remaining - headLen;
  const head = chars.slice(0, headLen).join("");
  const tail = tailLen > 0 ? chars.slice(chars.length - tailLen).join("") : "";
  return `${head}${ELLIPSIS}${tail}`;
}
