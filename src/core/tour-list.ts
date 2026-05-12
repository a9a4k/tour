import type { Tour } from "./types.js";

export interface PickerRow {
  id: string;
  title: string;
  status: "open" | "closed";
  glyph: "●" | "○";
  age: string;
  annotationCount: number;
}

export type PickerTour = Pick<Tour, "id" | "title" | "status" | "created_at">;

export interface BuildPickerRowsArgs {
  tours: PickerTour[];
  annotationCounts: Record<string, number>;
  now: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function formatAge(deltaMs: number): string {
  const ms = Math.max(0, deltaMs);
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d ago`;
  if (ms < MONTH) return `${Math.floor(ms / WEEK)}w ago`;
  if (ms < YEAR) return `${Math.floor(ms / MONTH)}mo ago`;
  return `${Math.floor(ms / YEAR)}y ago`;
}

export type AutoPickTour = Pick<Tour, "id" | "status" | "created_at">;

// The shared "auto-pick a tour when none was specified" rule, consumed
// by both the server's bare-`tour serve` pre-pick (issue #187) and the
// SPA's auto-select in App.tsx. Picks the most-recent **open** tour by
// `created_at`. Returns null when no open tour exists — the server
// prints the bare URL in that case, and the SPA falls back to closed
// tours or shows the empty state. Tie-break on id (largest wins) keeps
// the result stable across surfaces.
export function pickAutoTour(tours: AutoPickTour[]): AutoPickTour | null {
  const open = tours.filter((t) => t.status === "open");
  if (open.length === 0) return null;
  let best = open[0];
  let bestMs = Date.parse(best.created_at);
  for (let i = 1; i < open.length; i++) {
    const t = open[i];
    const ms = Date.parse(t.created_at);
    if (ms > bestMs || (ms === bestMs && t.id.localeCompare(best.id) > 0)) {
      best = t;
      bestMs = ms;
    }
  }
  return best;
}

export function buildPickerRows(args: BuildPickerRowsArgs): PickerRow[] {
  const { tours, annotationCounts, now } = args;
  const rows = tours.map<PickerRow>((t) => ({
    id: t.id,
    title: t.title || "(untitled)",
    status: t.status,
    glyph: t.status === "open" ? "●" : "○",
    age: formatAge(now - Date.parse(t.created_at)),
    annotationCount: annotationCounts[t.id] ?? 0,
  }));
  const created = new Map(tours.map((t) => [t.id, Date.parse(t.created_at)]));
  rows.sort((a, b) => {
    const ta = created.get(a.id) ?? 0;
    const tb = created.get(b.id) ?? 0;
    if (ta !== tb) return tb - ta;
    return a.id.localeCompare(b.id);
  });
  return rows;
}
