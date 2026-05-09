import type { Tour } from "./types.js";

export interface PickerRow {
  id: string;
  title: string;
  status: "open" | "closed";
  glyph: "●" | "○";
  age: string;
  annotationCount: number;
}

export interface BuildPickerRowsArgs {
  tours: Tour[];
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

export function buildPickerRows(args: BuildPickerRowsArgs): PickerRow[] {
  const { tours, annotationCounts, now } = args;
  const rows = tours.map<PickerRow>((t) => ({
    id: t.id,
    title: t.title && t.title.length > 0 ? t.title : "(untitled)",
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
